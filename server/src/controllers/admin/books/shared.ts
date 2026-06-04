import prisma from "../../../lib/prisma";
import fs from "fs";
import path from "path";
import { createLogger } from "../../../lib/logger";
import { searchAudible } from "../../../utils/audible";
import {
  isAudibleCliAvailable,
  searchAudibleCli,
} from "../../../utils/audibleCli";
import { searchGoogleBooks } from "../../../utils/googleBooks";
import { searchGoodreads } from "../../../utils/goodreads";
import { downloadCover, findCoverInFolder, getCoverUrl } from "../../../utils/covers";
import {
  toNullableString,
  toNullableNumber,
} from "../shared";

export const adminLogger = createLogger("admin");

export type MetadataProvider = "audible" | "google" | "goodreads" | "combined";
export type DuplicateFileAction = "keep" | "delete" | "keep_sub";

export const duplicateFileActions = new Set<DuplicateFileAction>(["keep", "delete", "keep_sub"]);

export const parseAsinValue = (value: string | null | undefined) =>
  value?.match(/\bASIN[:\s-]*([A-Z0-9]{10})\b/i)?.[1]?.toUpperCase() ?? null;

export const isAsinLike = (value: string | null | undefined) => /^[A-Z0-9]{10}$/i.test(value?.trim() ?? "");

export const parseMetadataProvider = (value: unknown): MetadataProvider => {
  if (value === "google") return "google";
  if (value === "goodreads") return "goodreads";
  if (value === "combined") return "combined";
  return "audible";
};

export const normalizeLanguageValue = (value: unknown) => {
  if (typeof value !== "string") return "";
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!normalized) return "";

  const firstToken = normalized.split(/\s+/)[0];
  const aliases: Record<string, string> = {
    en: "en",
    eng: "en",
    english: "en",
    fr: "fr",
    fra: "fr",
    fre: "fr",
    french: "fr",
    es: "es",
    spa: "es",
    spanish: "es",
    de: "de",
    deu: "de",
    ger: "de",
    german: "de",
    it: "it",
    ita: "it",
    italian: "it",
    pt: "pt",
    por: "pt",
    portuguese: "pt",
    nl: "nl",
    nld: "nl",
    dutch: "nl",
    ru: "ru",
    rus: "ru",
    russian: "ru",
    ja: "ja",
    jpn: "ja",
    japanese: "ja",
    zh: "zh",
    zho: "zh",
    chi: "zh",
    chinese: "zh",
  };

  return aliases[firstToken] || firstToken;
};

export const languageMatches = (candidateLanguage: unknown, requestedLanguage: unknown) => {
  const filter = normalizeLanguageValue(requestedLanguage);
  if (!filter) return true;

  const candidate = normalizeLanguageValue(candidateLanguage);
  if (!candidate) return true;

  return candidate === filter;
};

export const filterCandidatesByLanguage = <T extends { metadata: { language: string | null } }>(
  candidates: T[],
  requestedLanguage: unknown,
) => candidates.filter((candidate) => languageMatches(candidate.metadata.language, requestedLanguage));

export const REVIEW_TAG = "review";
export const MATCHED_TAG = "matched";
export const QUICK_MATCHED_TAG = "quick-matched";

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const removeBookFolder = async (folderPath: string) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.promises.rm(folderPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 250,
      });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOTEMPTY" || attempt === 4) {
        throw error;
      }

      await wait(250 * (attempt + 1));
    }
  }
};

export const normalizeTagList = (value: unknown) => {
  if (typeof value !== "string") return [];

  const tags = value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }

  return normalized;
};

export const serializeTagList = (tags: string[]) => (tags.length > 0 ? tags.join(", ") : null);

export const mergeManagedTags = (baseTags: unknown, managedTags: string[]) => {
  const tags = normalizeTagList(baseTags);

  for (const managedTag of managedTags) {
    if (!tags.some((tag) => tag.toLowerCase() === managedTag)) {
      tags.push(managedTag);
    }
  }

  return tags;
};

export const hasManagedTag = (baseTags: unknown, tag: string) =>
  normalizeTagList(baseTags).some((existingTag) => existingTag.toLowerCase() === tag);


export type MatchSearchBook = {
  id: string;
  title: string;
  subtitle?: string | null;
  asin?: string | null;
  description?: string | null;
  language?: string | null;
  duration: number | null;
  author: { name: string };
};

export const findBookMatchCandidates = async (
  book: MatchSearchBook,
  provider: MetadataProvider,
  queryOverride?: string | null,
  authorOverride?: string | null,
  languageOverride?: string | null,
) => {
  const query = queryOverride || book.asin || parseAsinValue(book.description) || book.title;
  const author = authorOverride || book.author.name;
  const catalogQuery = isAsinLike(query) ? book.title : query;
  const language = languageOverride || book.language || undefined;
  const context = {
    title: book.title,
    author: book.author.name,
    asin: book.asin || parseAsinValue(book.description),
    duration: book.duration || null,
  };

  const loadAudibleCandidates = async () => {
    const cliAvailable = await isAudibleCliAvailable();
    let audibleCandidates: Awaited<ReturnType<typeof searchAudible>> = [];
    if (cliAvailable) {
      audibleCandidates = await searchAudibleCli(query, context, author);
    }

    if (!audibleCandidates.length) {
      audibleCandidates = await searchAudible(query, context, author);
    }

    return audibleCandidates;
  };

  if (provider === "combined") {
    const [audibleCandidates, googleCandidates] = await Promise.all([
      loadAudibleCandidates(),
      searchGoogleBooks(catalogQuery, author),
    ]);

    const candidates = [...audibleCandidates];
    for (const google of googleCandidates) {
      const isDuplicate = candidates.some(
        (audible) =>
          audible.metadata.title?.toLowerCase() === google.metadata.title?.toLowerCase() &&
          audible.metadata.author?.toLowerCase() === google.metadata.author?.toLowerCase(),
      );
      if (!isDuplicate) candidates.push(google);
    }

    return { provider, query: catalogQuery, author, language, candidates: filterCandidatesByLanguage(candidates, language) };
  }

  const candidates = provider === "audible"
    ? await loadAudibleCandidates()
    : provider === "google"
      ? await searchGoogleBooks(catalogQuery, author)
      : await searchGoodreads(catalogQuery, author);

  return {
    provider,
    query: provider === "audible" ? query : catalogQuery,
    author,
    language,
    candidates: filterCandidatesByLanguage(candidates, language),
  };
};

export const buildFieldsFromMatchCandidate = (
  candidate: Awaited<ReturnType<typeof searchAudible>>[number],
) => ({
  title: candidate.metadata.title ?? "",
  subtitle: candidate.metadata.subtitle ?? "",
  author: candidate.metadata.author ?? "",
  narrator: candidate.metadata.narrator ?? "",
  seriesName: candidate.metadata.seriesName ?? "",
  seriesSequence:
    candidate.metadata.seriesSequence === null || candidate.metadata.seriesSequence === undefined
      ? ""
      : String(candidate.metadata.seriesSequence),
  description: candidate.metadata.description ?? "",
  publisher: candidate.metadata.publisher ?? "",
  year: candidate.metadata.year ?? "",
  genres: candidate.metadata.genres ?? "",
  tags: candidate.metadata.tags ?? "",
  language: candidate.metadata.language ?? "",
  isbn: candidate.metadata.isbn ?? "",
  asin: candidate.metadata.asin ?? "",
  abridged: candidate.metadata.abridged ?? false,
  imageUrl: candidate.metadata.imageUrl ?? "",
});

export const defaultQuickMatchSelectedFields = {
  title: true,
  subtitle: true,
  author: true,
  narrator: true,
  seriesName: true,
  seriesSequence: true,
  description: true,
  publisher: true,
  year: true,
  genres: true,
  tags: true,
  language: true,
  isbn: true,
  asin: true,
  abridged: true,
  imageUrl: true,
};

export const chooseQuickMatchCandidate = (
  book: MatchSearchBook,
  candidates: Awaited<ReturnType<typeof searchAudible>>,
  minConfidence: number,
) => {
  const [top, second] = candidates;
  if (!top) {
    return { candidate: null, reason: "No metadata candidates found" };
  }

  const sourceAsin = book.asin || parseAsinValue(book.description);
  const candidateAsin = top.metadata.asin?.toUpperCase() || null;
  if (sourceAsin && candidateAsin === sourceAsin) {
    return { candidate: top, reason: "ASIN matched exactly" };
  }

  if (top.id.startsWith("google_")) {
    return { candidate: null, reason: "Google Books results require manual review" };
  }

  if (top.id.startsWith("goodreads_")) {
    return { candidate: null, reason: "Goodreads results require manual review" };
  }

  const confidence = Number(top.confidence) || 0;
  if (confidence < minConfidence) {
    return { candidate: null, reason: `Top match confidence ${Math.round(confidence * 100)}% is below threshold` };
  }

  const secondConfidence = second ? Number(second.confidence) || 0 : 0;
  if (second && confidence - secondConfidence < 0.12) {
    return { candidate: null, reason: "Top match is too close to the next candidate" };
  }

  return { candidate: top, reason: `Confidence ${Math.round(confidence * 100)}%` };
};

export const applyMatchedFieldsToBook = async (
  book: { id: string; title: string; folderPath: string; tags: string | null },
  selectedFields: Record<string, unknown>,
  sourceFields: Record<string, unknown>,
  managedTags: string[],
) => {
  const updateData: Record<string, unknown> = {};

  if (selectedFields.title) {
    const title = toNullableString(sourceFields.title);
    if (!title) throw new Error("Title cannot be empty when selected");
    updateData.title = title;
  }

  if (selectedFields.subtitle) updateData.subtitle = toNullableString(sourceFields.subtitle);
  if (selectedFields.narrator) updateData.narrator = toNullableString(sourceFields.narrator);
  if (selectedFields.description) updateData.description = toNullableString(sourceFields.description);
  if (selectedFields.publisher) updateData.publisher = toNullableString(sourceFields.publisher);
  if (selectedFields.year) updateData.year = toNullableString(sourceFields.year);
  if (selectedFields.genres) updateData.genres = toNullableString(sourceFields.genres);
  if (selectedFields.language) updateData.language = toNullableString(sourceFields.language);
  if (selectedFields.isbn) updateData.isbn = toNullableString(sourceFields.isbn);
  if (selectedFields.asin) updateData.asin = toNullableString(sourceFields.asin)?.toUpperCase() || null;
  if (selectedFields.abridged) updateData.abridged = Boolean(sourceFields.abridged);

  const baseTags = selectedFields.tags ? sourceFields.tags : book.tags;
  updateData.tags = serializeTagList(mergeManagedTags(baseTags, managedTags));

  if (selectedFields.imageUrl) {
    const imageUrl = toNullableString(sourceFields.imageUrl);
    if (imageUrl) {
      const oldCoverFile = findCoverInFolder(book.folderPath);
      if (oldCoverFile) fs.rmSync(oldCoverFile, { force: true });

      const downloaded = await downloadCover(imageUrl, book.folderPath);
      if (downloaded) {
        updateData.coverPath = getCoverUrl(book.id);
      }
    }
  }

  if (selectedFields.author) {
    const authorName = toNullableString(sourceFields.author);
    if (!authorName) throw new Error("Author cannot be empty when selected");

    const author = await prisma.author.upsert({
      where: { name: authorName },
      update: {},
      create: { name: authorName },
    });
    updateData.authorId = author.id;
  }

  const seriesNameSelected = Boolean(selectedFields.seriesName);
  const sequenceSelected = Boolean(selectedFields.seriesSequence);
  if (seriesNameSelected || sequenceSelected) {
    const seriesName = toNullableString(sourceFields.seriesName);

    if (seriesNameSelected) {
      if (seriesName) {
        const series = await prisma.series.upsert({
          where: { name: seriesName },
          update: {},
          create: { name: seriesName },
        });
        updateData.seriesId = series.id;
      } else {
        updateData.seriesId = null;
      }
    }

    if (sequenceSelected) {
      updateData.sequence = toNullableNumber(sourceFields.seriesSequence);
    }
  }

  try {
    return await prisma.book.update({
      where: { id: book.id },
      data: updateData,
      include: {
        author: true,
        series: true,
        library: true,
        audioFiles: { orderBy: { index: "asc" } },
      },
    });
  } catch (error: any) {
    if (
      error?.code === "P2002" &&
      (error.meta?.target?.includes("title") || error.meta?.target?.includes("authorId"))
    ) {
      const disambiguatedTitle = `${updateData.title || book.title} (${path.basename(book.folderPath)})`;
      console.log(
        `Title collision on quick match for "${updateData.title || book.title}". Renaming to "${disambiguatedTitle}"`,
      );
      return await prisma.book.update({
        where: { id: book.id },
        data: { ...updateData, title: disambiguatedTitle },
        include: {
          author: true,
          series: true,
          library: true,
          audioFiles: { orderBy: { index: "asc" } },
        },
      });
    }
    throw error;
  }
};

