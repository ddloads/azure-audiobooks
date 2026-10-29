import prisma from "../lib/prisma";
import { createLogger } from "../lib/logger";
import { buildApiArgs, resolveAudibleProfile, runAudible } from "./audibleCli";

// Copies the titles a linked Audible account owns into AudibleLibraryItem, and
// works out which of them are not in the library yet (the Missing page).

const logger = createLogger("audible-library");

const PAGE_SIZE = 1000;
// One page of 1000 titles can take a while on Audible's side.
const PAGE_TIMEOUT_MS = 120_000;
const LIBRARY_RESPONSE_GROUPS = "contributors,media,product_attrs,product_desc,series";
// Podcasts and periodicals live in the Audible library too, but aren't audiobooks.
const SKIPPED_DELIVERY_TYPES = new Set(["PodcastParent", "PodcastSeason", "PodcastEpisode", "Periodical"]);
export const ACTIVE_DOWNLOAD_STATUSES = ["queued", "downloading", "converting", "importing"];

type AudibleLibraryApiItem = {
  asin: string;
  title?: string | null;
  subtitle?: string | null;
  authors?: Array<{ name: string }> | null;
  narrators?: Array<{ name: string }> | null;
  series?: Array<{ title: string; sequence?: string | null }> | null;
  runtime_length_min?: number | null;
  product_images?: Record<string, string> | null;
  release_date?: string | null;
  purchase_date?: string | null;
  content_delivery_type?: string | null;
  content_type?: string | null;
};

export type AudibleLibraryEntry = {
  asin: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  seriesName: string | null;
  seriesSequence: string | null;
  durationSeconds: number | null;
  coverUrl: string | null;
  releaseDate: string | null;
  purchaseDate: string | null;
  ignored: boolean;
  downloadStatus: string | null;
  downloadError: string | null;
  /** Set when the title is already in the library. */
  bookId: string | null;
};

const pickCover = (images: Record<string, string> | null | undefined): string | null => {
  if (!images) return null;
  for (const key of ["500", "900", "1215", "300", "225"]) {
    if (images[key]) return images[key];
  }
  return Object.values(images)[0] ?? null;
};

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const fetchAudibleLibrary = async (profile: string): Promise<AudibleLibraryApiItem[]> => {
  const items: AudibleLibraryApiItem[] = [];
  for (let page = 1; ; page++) {
    const raw = await runAudible(
      buildApiArgs("/1.0/library", {
        num_results: String(PAGE_SIZE),
        page: String(page),
        response_groups: LIBRARY_RESPONSE_GROUPS,
        sort_by: "-PurchaseDate",
      }),
      profile,
      PAGE_TIMEOUT_MS,
    );
    const parsed = JSON.parse(raw) as { items?: AudibleLibraryApiItem[] };
    const pageItems = parsed.items ?? [];
    items.push(...pageItems);
    if (pageItems.length < PAGE_SIZE) return items;
  }
};

let syncing = false;
export const isAudibleLibrarySyncing = () => syncing;

/** Replaces the stored copy of a profile's Audible library. Ignored and download state survive. */
export const syncAudibleLibrary = async (requestedProfile?: string | null) => {
  const profile = resolveAudibleProfile(requestedProfile);
  if (!profile) throw new Error("No Audible account is linked. Add one under Settings → Metadata.");
  if (syncing) throw new Error("A sync is already running.");

  syncing = true;
  try {
    const syncedAt = new Date();
    const items = (await fetchAudibleLibrary(profile)).filter(
      (item) =>
        item.asin &&
        item.title &&
        !SKIPPED_DELIVERY_TYPES.has(item.content_delivery_type ?? "") &&
        item.content_type !== "Podcast",
    );

    const rows = items.map((item) => ({
      title: item.title!.trim(),
      subtitle: item.subtitle?.trim() || null,
      author: item.authors?.map((a) => a.name).join(", ") || null,
      narrator: item.narrators?.map((n) => n.name).join(", ") || null,
      seriesName: item.series?.[0]?.title || null,
      seriesSequence: item.series?.[0]?.sequence || null,
      durationSeconds: item.runtime_length_min != null ? item.runtime_length_min * 60 : null,
      coverUrl: pickCover(item.product_images),
      releaseDate: item.release_date || null,
      purchaseDate: parseDate(item.purchase_date),
      syncedAt,
    }));

    for (let i = 0; i < items.length; i += 200) {
      await prisma.$transaction(
        items.slice(i, i + 200).map((item, offset) =>
          prisma.audibleLibraryItem.upsert({
            where: { profile_asin: { profile, asin: item.asin } },
            create: { profile, asin: item.asin, ...rows[i + offset] },
            update: rows[i + offset],
          }),
        ),
      );
    }

    // Titles returned or removed on Audible's side drop off the list.
    const removed = await prisma.audibleLibraryItem.deleteMany({
      where: {
        profile,
        syncedAt: { lt: syncedAt },
        OR: [{ downloadStatus: null }, { downloadStatus: { notIn: ACTIVE_DOWNLOAD_STATUSES } }],
      },
    });

    logger.info("Audible library synced", { profile, titles: items.length, removed: removed.count });
    return { profile, titles: items.length, removed: removed.count };
  } finally {
    syncing = false;
  }
};

// ─── Matching against the library ─────────────────────────────────────────

const normalizeText = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The full title, the title without a trailing "(…)", and the part before a colon. */
const titleVariants = (title: string) => {
  const variants = [
    title,
    title.replace(/\s*\([^)]{1,80}\)\s*$/, ""),
    title.split(/:\s/)[0],
  ];
  return Array.from(new Set(variants.map(normalizeText).filter(Boolean)));
};

// Initials and short words ("j", "r", "de") would match nearly anyone.
const authorTokens = (author: string | null | undefined) =>
  new Set(normalizeText(author).split(" ").filter((token) => token.length > 2));

type LibraryIndex = {
  byAsin: Map<string, string>;
  byTitle: Map<string, Array<{ bookId: string; authorTokens: Set<string> }>>;
};

const buildLibraryIndex = async (): Promise<LibraryIndex> => {
  const books = await prisma.book.findMany({
    select: { id: true, title: true, asin: true, author: { select: { name: true } } },
  });
  const index: LibraryIndex = { byAsin: new Map(), byTitle: new Map() };
  for (const book of books) {
    if (book.asin) index.byAsin.set(book.asin.toUpperCase(), book.id);
    const tokens = book.author.name === "Unknown Author" ? new Set<string>() : authorTokens(book.author.name);
    for (const variant of titleVariants(book.title)) {
      const entries = index.byTitle.get(variant) ?? [];
      entries.push({ bookId: book.id, authorTokens: tokens });
      index.byTitle.set(variant, entries);
    }
  }
  return index;
};

const findBookForTitle = (
  index: LibraryIndex,
  item: { asin: string; title: string; author: string | null },
): string | null => {
  const byAsin = index.byAsin.get(item.asin.toUpperCase());
  if (byAsin) return byAsin;

  const itemAuthors = authorTokens(item.author);
  for (const variant of titleVariants(item.title)) {
    for (const entry of index.byTitle.get(variant) ?? []) {
      // A book with no known author matches on title alone.
      if (!entry.authorTokens.size || !itemAuthors.size) return entry.bookId;
      for (const token of itemAuthors) {
        if (entry.authorTokens.has(token)) return entry.bookId;
      }
    }
  }
  return null;
};

/** Every synced title for the profile, each marked with the library book it matches (if any). */
export const listAudibleLibrary = async (requestedProfile?: string | null) => {
  const profile = resolveAudibleProfile(requestedProfile);
  if (!profile) return { profile: null, lastSyncedAt: null, items: [] as AudibleLibraryEntry[] };

  const [rows, index] = await Promise.all([
    prisma.audibleLibraryItem.findMany({
      where: { profile },
      orderBy: [{ purchaseDate: { sort: "desc", nulls: "last" } }, { title: "asc" }],
    }),
    buildLibraryIndex(),
  ]);

  const lastSyncedAt = rows.reduce<Date | null>(
    (latest, row) => (!latest || row.syncedAt > latest ? row.syncedAt : latest),
    null,
  );

  const items: AudibleLibraryEntry[] = rows.map((row) => ({
    asin: row.asin,
    title: row.title,
    subtitle: row.subtitle,
    author: row.author,
    narrator: row.narrator,
    seriesName: row.seriesName,
    seriesSequence: row.seriesSequence,
    durationSeconds: row.durationSeconds,
    coverUrl: row.coverUrl,
    releaseDate: row.releaseDate,
    purchaseDate: row.purchaseDate?.toISOString() ?? null,
    ignored: row.ignoredAt !== null,
    downloadStatus: row.downloadStatus,
    downloadError: row.downloadError,
    bookId: findBookForTitle(index, row),
  }));

  return { profile, lastSyncedAt: lastSyncedAt?.toISOString() ?? null, items };
};

export const setAudibleTitlesIgnored = async (profile: string, asins: string[], ignored: boolean) => {
  const result = await prisma.audibleLibraryItem.updateMany({
    where: { profile, asin: { in: asins } },
    data: { ignoredAt: ignored ? new Date() : null },
  });
  return result.count;
};
