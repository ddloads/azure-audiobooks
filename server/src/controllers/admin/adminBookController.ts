import prisma from "../../lib/prisma";
import fs from "fs";
import path from "path";
import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import { createLogger } from "../../lib/logger";
import { requestLibraryScan } from "../../lib/scanJobPool";
import { searchAudible } from "../../utils/audible";
import {
  isAudibleCliAvailable,
  searchAudibleCli,
} from "../../utils/audibleCli";
import { GoogleBooksSearchError, searchGoogleBooks } from "../../utils/googleBooks";
import { GoodreadsSearchError, searchGoodreads } from "../../utils/goodreads";
import { downloadCover, findCoverInFolder, getCoverUrl, normalizeCoverPath } from "../../utils/covers";
import { autoChapterizeBook, rescanBook } from "../../utils/scanner";
import { invalidateFilterOptionsCache } from "../libraryController";
import { setLogTitle } from "../../middleware/loggingMiddleware";
import { booksArePotentialDuplicates, findDuplicateGroups } from "../../utils/duplicates";
import {
  getSingleParam,
  getOptionalBodyValue,
  pathBelongsToRoot,
  toNullableString,
  toNullableNumber,
} from "./shared";

const adminLogger = createLogger("admin");

type MetadataProvider = "audible" | "google" | "goodreads" | "combined";

const parseAsinValue = (value: string | null | undefined) =>
  value?.match(/\bASIN[:\s-]*([A-Z0-9]{10})\b/i)?.[1]?.toUpperCase() ?? null;

const isAsinLike = (value: string | null | undefined) => /^[A-Z0-9]{10}$/i.test(value?.trim() ?? "");

const parseMetadataProvider = (value: unknown): MetadataProvider => {
  if (value === "google") return "google";
  if (value === "goodreads") return "goodreads";
  if (value === "combined") return "combined";
  return "audible";
};

const normalizeLanguageValue = (value: unknown) => {
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

const languageMatches = (candidateLanguage: unknown, requestedLanguage: unknown) => {
  const filter = normalizeLanguageValue(requestedLanguage);
  if (!filter) return true;

  const candidate = normalizeLanguageValue(candidateLanguage);
  if (!candidate) return true;

  return candidate === filter;
};

const filterCandidatesByLanguage = <T extends { metadata: { language: string | null } }>(
  candidates: T[],
  requestedLanguage: unknown,
) => candidates.filter((candidate) => languageMatches(candidate.metadata.language, requestedLanguage));

const REVIEW_TAG = "review";
const MATCHED_TAG = "matched";
const QUICK_MATCHED_TAG = "quick-matched";

const normalizeTagList = (value: unknown) => {
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

const serializeTagList = (tags: string[]) => (tags.length > 0 ? tags.join(", ") : null);

const mergeManagedTags = (baseTags: unknown, managedTags: string[]) => {
  const tags = normalizeTagList(baseTags);

  for (const managedTag of managedTags) {
    if (!tags.some((tag) => tag.toLowerCase() === managedTag)) {
      tags.push(managedTag);
    }
  }

  return tags;
};

const hasManagedTag = (baseTags: unknown, tag: string) =>
  normalizeTagList(baseTags).some((existingTag) => existingTag.toLowerCase() === tag);

export const listAdminBooks = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const books = await prisma.book.findMany({
      select: {
        id: true,
        title: true,
        duration: true,
        folderPath: true,
        coverPath: true,
        createdAt: true,
        author: { select: { name: true } },
        series: { select: { name: true } },
        library: { select: { id: true, name: true } },
        _count: {
          select: {
            audioFiles: true,
            progress: true,
          },
        },
      },
      orderBy: [{ library: { name: "asc" } }, { author: { name: "asc" } }, { title: "asc" }],
    });

    res.json(books);
  } catch (error) {
    console.error("List admin books error:", error);
    res.status(500).json({ error: "Failed to load library" });
  }
};

export const deleteBook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    const { deleteFiles } = req.body as { deleteFiles?: boolean };

    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        library: {
          include: {
            sources: true,
          },
        },
      },
    });

    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    setLogTitle(book.title);

    // Delete from DB first
    await prisma.book.delete({ where: { id: bookId } });

    // Delete physical files if requested
    if (deleteFiles) {
      const matchingSource = book.library.sources.find((source) =>
        pathBelongsToRoot(book.folderPath, source.path),
      );

      if (matchingSource && fs.existsSync(book.folderPath)) {
        fs.rmSync(book.folderPath, { recursive: true, force: true });
      }
    }

    adminLogger.info("Book deleted", {
      bookId,
      title: book.title,
      deleteFiles: !!deleteFiles,
    });

    res.status(204).send();
  } catch (error) {
    console.error("Delete book error:", error);
    res.status(500).json({ error: "Failed to delete book" });
  }
};

export const rescanSingleBookHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    await rescanBook(bookId);
    res.json({ message: "Book rescanned successfully" });
  } catch (error) {
    console.error("Rescan book error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to rescan book" });
  }
};

export const autoChapterizeBookHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    const replaceExisting = req.body?.replaceExisting !== false;
    const result = await autoChapterizeBook(bookId, replaceExisting);

    res.json({
      message: result.skipped
        ? "Book already has chapters"
        : `Generated ${result.created} ${result.created === 1 ? "chapter" : "chapters"}`,
      ...result,
    });
  } catch (error) {
    console.error("Auto chapterize book error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to auto chapterize book" });
  }
};

export const rescanLibrary = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scanRequest = await requestLibraryScan();
    adminLogger.info("Full library rescan requested", {
      status: scanRequest.status,
    });
    res.status(202).json({ message: scanRequest.message, status: scanRequest.status, jobId: scanRequest.jobId });
  } catch (error) {
    console.error("Rescan library error:", error);
    res.status(500).json({ error: "Failed to rescan library" });
  }
};

export const rescanSingleLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      select: { id: true, name: true },
    });

    if (!library) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    const scanRequest = await requestLibraryScan(libraryId);
    adminLogger.info("Single library rescan requested", {
      libraryId: library.id,
      name: library.name,
      status: scanRequest.status,
    });
    res.status(202).json({
      message:
        scanRequest.status === "queued" ? `${library.name} scan queued` : `${library.name} scan started`,
      status: scanRequest.status,
      jobId: scanRequest.jobId,
    });
  } catch (error) {
    console.error("Rescan single library error:", error);
    res.status(500).json({ error: "Failed to rescan library" });
  }
};

export const searchBookMatches = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId },
      select: {
        id: true,
        title: true,
        subtitle: true,
        asin: true,
        description: true,
        language: true,
        duration: true,
        author: { select: { name: true } },
      },
    });

    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    const query =
      getOptionalBodyValue(req.body?.query) || book.asin || parseAsinValue(book.description) || book.title;
    const author = getOptionalBodyValue(req.body?.author) || book.author.name;
    const language = getOptionalBodyValue(req.body?.language) || book.language || undefined;
    const provider = parseMetadataProvider(req.body?.provider);
    const catalogQuery = isAsinLike(query) ? book.title : query;

    const loadAudibleCandidates = async () => {
      const context = {
        title: book.title,
        author: book.author.name,
        asin: book.asin || parseAsinValue(book.description),
        duration: book.duration || null,
      };

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

    let candidates: Awaited<ReturnType<typeof searchAudible>> = [];

    if (provider === "combined") {
      const [audibleCandidates, googleCandidates] = await Promise.all([
        loadAudibleCandidates(),
        searchGoogleBooks(catalogQuery, author),
      ]);

      candidates = [...audibleCandidates];
      for (const google of googleCandidates) {
        const isDuplicate = candidates.some(
          (audible) =>
            audible.metadata.title?.toLowerCase() === google.metadata.title?.toLowerCase() &&
            audible.metadata.author?.toLowerCase() === google.metadata.author?.toLowerCase(),
        );
        if (!isDuplicate) {
          candidates.push(google);
        }
      }
    } else if (provider === "audible") {
      candidates = await loadAudibleCandidates();
    } else if (provider === "google") {
      candidates = await searchGoogleBooks(catalogQuery, author);
    } else {
      candidates = await searchGoodreads(catalogQuery, author);
    }

    candidates = filterCandidatesByLanguage(candidates, language);

    res.json({
      provider,
      query: provider === "audible" ? query : catalogQuery,
      author,
      language,
      candidates,
    });
  } catch (error) {
    if (error instanceof GoogleBooksSearchError || error instanceof GoodreadsSearchError) {
      res.status(502).json({ error: error.message });
      return;
    }
    console.error("Search book matches error:", error);
    res.status(500).json({ error: "Failed to search metadata" });
  }
};

type MatchSearchBook = {
  id: string;
  title: string;
  subtitle?: string | null;
  asin?: string | null;
  description?: string | null;
  language?: string | null;
  duration: number | null;
  author: { name: string };
};

const findBookMatchCandidates = async (
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

const buildFieldsFromMatchCandidate = (
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

const defaultQuickMatchSelectedFields = {
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

const chooseQuickMatchCandidate = (
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

const applyMatchedFieldsToBook = async (
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

export const quickMatchBooks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookIds: string[] = Array.isArray(req.body?.bookIds)
      ? req.body.bookIds.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
      : [];
    const provider = parseMetadataProvider(req.body?.provider);
    const mode = req.body?.mode === "apply" ? "apply" : "preview";
    const parsedThreshold = Number(req.body?.minConfidence);
    const minConfidence = Number.isFinite(parsedThreshold)
      ? Math.min(1, Math.max(0, parsedThreshold))
      : 0.9;
    const language = getOptionalBodyValue(req.body?.language);
    const selectedFields = {
      ...defaultQuickMatchSelectedFields,
      ...(req.body?.selectedFields && typeof req.body.selectedFields === "object" ? req.body.selectedFields : {}),
    };

    if (bookIds.length === 0) {
      res.status(400).json({ error: "At least one book id is required" });
      return;
    }

    const books = await prisma.book.findMany({
      where: { id: { in: bookIds } },
      include: {
        author: true,
        series: true,
      },
    });
    const orderedBooks = bookIds
      .map((id) => books.find((book) => book.id === id))
      .filter((book): book is (typeof books)[number] => Boolean(book));

    const result: {
      mode: "preview" | "apply";
      provider: MetadataProvider;
      minConfidence: number;
      applied: Array<{ bookId: string; title: string; candidateTitle: string | null; confidence: number; reason: string }>;
      ready: Array<{ bookId: string; title: string; candidateTitle: string | null; confidence: number; reason: string }>;
      skippedAlreadyMatched: Array<{ bookId: string; title: string; tags: string | null }>;
      needsReview: Array<{ bookId: string; title: string; reason: string; candidates: Awaited<ReturnType<typeof searchAudible>> }>;
      noResult: Array<{ bookId: string; title: string; reason: string }>;
      failed: Array<{ bookId: string; title: string; error: string }>;
    } = {
      mode,
      provider,
      minConfidence,
      applied: [],
      ready: [],
      skippedAlreadyMatched: [],
      needsReview: [],
      noResult: [],
      failed: [],
    };

    for (const book of orderedBooks) {
      if (hasManagedTag(book.tags, MATCHED_TAG) || hasManagedTag(book.tags, QUICK_MATCHED_TAG)) {
        result.skippedAlreadyMatched.push({ bookId: book.id, title: book.title, tags: book.tags });
        continue;
      }

      try {
        const searchResult = await findBookMatchCandidates(book, provider, undefined, undefined, language);
        const decision = chooseQuickMatchCandidate(book, searchResult.candidates, minConfidence);

        if (!decision.candidate) {
          if (searchResult.candidates.length === 0) {
            result.noResult.push({ bookId: book.id, title: book.title, reason: decision.reason });
          } else {
            result.needsReview.push({
              bookId: book.id,
              title: book.title,
              reason: decision.reason,
              candidates: searchResult.candidates.slice(0, 3),
            });
          }
          continue;
        }

        const item = {
          bookId: book.id,
          title: book.title,
          candidateTitle: decision.candidate.metadata.title,
          confidence: decision.candidate.confidence,
          reason: decision.reason,
        };

        if (mode === "apply") {
          const sourceFields = buildFieldsFromMatchCandidate(decision.candidate);
          await applyMatchedFieldsToBook(
            book,
            selectedFields,
            sourceFields,
            [MATCHED_TAG, QUICK_MATCHED_TAG],
          );
          result.applied.push(item);
        } else {
          result.ready.push(item);
        }
      } catch (error) {
        result.failed.push({
          bookId: book.id,
          title: book.title,
          error: error instanceof Error ? error.message : "Quick match failed",
        });
      }
    }

    if (mode === "apply" && result.applied.length > 0) {
      invalidateFilterOptionsCache();
    }

    res.json(result);
  } catch (error) {
    console.error("Quick match books error:", error);
    res.status(500).json({ error: "Failed to quick match books" });
  }
};

export const applyBookMatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    const selected = req.body?.selectedFields;
    const fields = req.body?.fields;
    const markForReview = Boolean(req.body?.markForReview);

    if (!selected || typeof selected !== "object" || !fields || typeof fields !== "object") {
      res.status(400).json({ error: "selectedFields and fields are required" });
      return;
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        author: true,
        series: true,
      },
    });

    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    setLogTitle(book.title);

    const selectedFields = selected as Record<string, unknown>;
    const sourceFields = fields as Record<string, unknown>;
    const updateData: Record<string, unknown> = {};

    if (selectedFields.title) {
      const title = toNullableString(sourceFields.title);
      if (!title) {
        res.status(400).json({ error: "Title cannot be empty when selected" });
        return;
      }
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

    const bookHasReviewTag = normalizeTagList(book.tags).some((tag) => tag.toLowerCase() === REVIEW_TAG);
    const keepReviewTag = markForReview || bookHasReviewTag;

    const managedTags = [MATCHED_TAG, ...(keepReviewTag ? [REVIEW_TAG] : [])];
    if (selectedFields.tags || managedTags.length > 0) {
      const baseTags = selectedFields.tags ? sourceFields.tags : book.tags;
      updateData.tags = serializeTagList(mergeManagedTags(baseTags, managedTags));
    }

    if (selectedFields.imageUrl) {
      const imageUrl = toNullableString(sourceFields.imageUrl);
      if (imageUrl) {
        // Delete old cover from book folder before downloading new one
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
      if (!authorName) {
        res.status(400).json({ error: "Author cannot be empty when selected" });
        return;
      }

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

    updateData.metadataVersion = book.metadataVersion;

    try {
      const updatedBook = await prisma.book.update({
        where: { id: bookId },
        data: updateData,
        include: {
          author: true,
          series: true,
          library: true,
          audioFiles: { orderBy: { index: "asc" } },
        },
      });

      invalidateFilterOptionsCache();
      res.json(updatedBook);
    } catch (error: any) {
      if (
        error?.code === "P2002" &&
        (error.meta?.target?.includes("title") || error.meta?.target?.includes("authorId"))
      ) {
        const disambiguatedTitle = `${updateData.title || book.title} (${path.basename(book.folderPath)})`;
        console.log(
          `Title collision on apply match for "${updateData.title || book.title}". Renaming to "${disambiguatedTitle}"`,
        );

        const retryData = { ...updateData, title: disambiguatedTitle };
        const updatedBook = await prisma.book.update({
          where: { id: bookId },
          data: retryData,
          include: {
            author: true,
            series: true,
            library: true,
            audioFiles: { orderBy: { index: "asc" } },
          },
        });

        invalidateFilterOptionsCache();
        res.json(updatedBook);
        return;
      }

      throw error;
    }
  } catch (error: any) {
    console.error("Apply book match error:", error);
    if (error?.code === "P2002") {
      res.status(400).json({ error: "That metadata would duplicate an existing book title/author entry" });
      return;
    }
    res.status(500).json({ error: "Failed to save fetched metadata" });
  }
};

export const updateBookMetadata = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    const fields = req.body;
    if (!fields || typeof fields !== "object") {
      res.status(400).json({ error: "Fields object is required" });
      return;
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: { author: true, series: true },
    });

    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    setLogTitle(book.title);

    const updateData: Record<string, unknown> = {};

    if ("title" in fields) {
      const title = toNullableString(fields.title);
      if (!title) {
        res.status(400).json({ error: "Title cannot be empty" });
        return;
      }
      updateData.title = title;
    }

    if ("subtitle" in fields) updateData.subtitle = toNullableString(fields.subtitle);
    if ("narrator" in fields) updateData.narrator = toNullableString(fields.narrator);
    if ("description" in fields) updateData.description = toNullableString(fields.description);
    if ("publisher" in fields) updateData.publisher = toNullableString(fields.publisher);
    if ("year" in fields) updateData.year = toNullableString(fields.year);
    if ("genres" in fields) updateData.genres = toNullableString(fields.genres);
    if ("tags" in fields) updateData.tags = toNullableString(fields.tags);
    if ("language" in fields) updateData.language = toNullableString(fields.language);
    if ("isbn" in fields) updateData.isbn = toNullableString(fields.isbn);
    if ("asin" in fields) updateData.asin = toNullableString(fields.asin)?.toUpperCase() || null;
    if ("abridged" in fields) updateData.abridged = Boolean(fields.abridged);

    if ("author" in fields) {
      const authorName = toNullableString(fields.author);
      if (!authorName) {
        res.status(400).json({ error: "Author cannot be empty" });
        return;
      }

      const author = await prisma.author.upsert({
        where: { name: authorName },
        update: {},
        create: { name: authorName },
      });
      updateData.authorId = author.id;
    }

    if ("seriesName" in fields) {
      const seriesName = toNullableString(fields.seriesName);
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

    if ("seriesSequence" in fields) {
      updateData.sequence = toNullableNumber(fields.seriesSequence);
    }

    try {
      const updatedBook = await prisma.book.update({
        where: { id: bookId },
        data: updateData,
        include: {
          author: true,
          series: true,
          library: true,
          audioFiles: { orderBy: { index: "asc" } },
        },
      });

      invalidateFilterOptionsCache();
      res.json(updatedBook);
    } catch (error: any) {
      if (
        error?.code === "P2002" &&
        (error.meta?.target?.includes("title") || error.meta?.target?.includes("authorId"))
      ) {
        const disambiguatedTitle = `${(updateData.title as string) || book.title} (${path.basename(book.folderPath)})`;
        console.log(
          `Title collision on update metadata for "${updateData.title || book.title}". Renaming to "${disambiguatedTitle}"`,
        );

        const retryData = { ...updateData, title: disambiguatedTitle };
        const updatedBook = await prisma.book.update({
          where: { id: bookId },
          data: retryData,
          include: {
            author: true,
            series: true,
            library: true,
            audioFiles: { orderBy: { index: "asc" } },
          },
        });

        invalidateFilterOptionsCache();
        res.json(updatedBook);
        return;
      }

      throw error;
    }
  } catch (error: any) {
    console.error("Update book metadata error:", error);
    if (error?.code === "P2002") {
      res.status(400).json({ error: "That metadata would duplicate an existing book title/author entry" });
      return;
    }
    res.status(500).json({ error: "Failed to update book metadata" });
  }
};

export const listAllDuplicatesHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const books = await prisma.book.findMany({
      include: {
        author: true,
        series: true,
        library: { select: { name: true } },
        audioFiles: { orderBy: { index: "asc" } },
        progress: true,
        _count: { select: { audioFiles: true } },
      },
      orderBy: [{ title: "asc" }, { createdAt: "asc" }],
    });

    const duplicateGroups = findDuplicateGroups(
      books.map((book) => ({
        ...book,
        coverPath: normalizeCoverPath(book.coverPath),
      })),
    );

    res.json(duplicateGroups);
  } catch (error) {
    console.error("List all duplicates error:", error);
    res.status(500).json({ error: "Failed to list all duplicates" });
  }
};

export const resolveDuplicatesHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      primaryBookId,
      secondaryBookIds,
      metadata,
      keepProgressFromBookId,
      audioFileActions,
    } = req.body as {
      primaryBookId: string;
      secondaryBookIds: string[];
      metadata?: any;
      keepProgressFromBookId?: string;
      audioFileActions: Array<{ audioFileId: string; action: "keep" | "delete" | "keep_sub" }>;
    };

    if (!primaryBookId || !secondaryBookIds || !audioFileActions) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const primaryBook = await prisma.book.findUnique({
      where: { id: primaryBookId },
      include: { author: true },
    });

    if (!primaryBook) {
      res.status(404).json({ error: "Primary book not found" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // 1. Update metadata if provided
      if (metadata) {
        await tx.book.update({
          where: { id: primaryBookId },
          data: {
            title: metadata.title,
            subtitle: metadata.subtitle,
            authorId: metadata.authorId,
            seriesId: metadata.seriesId,
            sequence: metadata.sequence,
            narrator: metadata.narrator,
            publisher: metadata.publisher,
            year: metadata.year,
            genres: metadata.genres,
            tags: metadata.tags,
            language: metadata.language,
            isbn: metadata.isbn,
            asin: metadata.asin,
            abridged: metadata.abridged,
          },
        });
      }

      // 2. Handle Progress
      if (keepProgressFromBookId) {
        // Find all progress records for all involved books
        const sourceProgress = await tx.progress.findMany({
          where: { bookId: keepProgressFromBookId },
        });

        // Delete all progress for primary book first to avoid conflict (or we could be more surgical)
        await tx.progress.deleteMany({
          where: { bookId: primaryBookId },
        });

        for (const prog of sourceProgress) {
          await tx.progress.create({
            data: {
              userId: prog.userId,
              bookId: primaryBookId,
              currentTime: prog.currentTime,
              isFinished: prog.isFinished,
              lastUpdate: prog.lastUpdate,
            },
          });
        }
      }

      // 3. Handle Audio Files
      const subFolderName = "merged_duplicates";
      const subFolderPath = path.join(primaryBook.folderPath, subFolderName);

      // Map actions for easy access
      const actionMap = new Map(audioFileActions.map((a) => [a.audioFileId, a.action]));

      // Get all involved audio files
      const allAudioFiles = await tx.audioFile.findMany({
        where: { bookId: { in: [primaryBookId, ...secondaryBookIds] } },
      });

      // Clear primary book's audio file records in DB (we will re-create them for those we keep)
      await tx.audioFile.deleteMany({
        where: { bookId: primaryBookId },
      });

      let nextIndex = 0;

      for (const af of allAudioFiles) {
        const action = actionMap.get(af.id) || "delete";

        if (action === "keep") {
          // If it's already in the primary folder, just keep it. 
          // If it's in a secondary folder, move it to the primary folder.
          const oldPath = af.path;
          const newFilename = path.basename(af.filename);
          const newPath = path.join(primaryBook.folderPath, newFilename);

          if (oldPath !== newPath) {
            if (fs.existsSync(oldPath)) {
              // Ensure we don't overwrite if file exists with same name but different content? 
              // For simplicity, we'll overwrite or rename if exists.
              let finalPath = newPath;
              let finalFilename = newFilename;
              if (fs.existsSync(newPath)) {
                 const ext = path.extname(newFilename);
                 const base = path.basename(newFilename, ext);
                 finalFilename = `${base}_${af.id.split('-')[0]}${ext}`;
                 finalPath = path.join(primaryBook.folderPath, finalFilename);
              }
              fs.renameSync(oldPath, finalPath);
              af.path = finalPath;
              af.filename = finalFilename;
            }
          }

          await tx.audioFile.create({
            data: {
              filename: path.basename(af.path),
              path: af.path,
              duration: af.duration,
              index: nextIndex++,
              title: af.title,
              bookId: primaryBookId,
            },
          });
        } else if (action === "keep_sub") {
          if (!fs.existsSync(subFolderPath)) {
            fs.mkdirSync(subFolderPath, { recursive: true });
          }

          const oldPath = af.path;
          const newFilename = path.basename(af.filename);
          const newPath = path.join(subFolderPath, newFilename);

          if (fs.existsSync(oldPath)) {
            let finalPath = newPath;
            let finalFilenameInSub = newFilename;
            if (fs.existsSync(newPath)) {
               const ext = path.extname(newFilename);
               const base = path.basename(newFilename, ext);
               finalFilenameInSub = `${base}_${af.id.split('-')[0]}${ext}`;
               finalPath = path.join(subFolderPath, finalFilenameInSub);
            }
            fs.renameSync(oldPath, finalPath);
            af.path = finalPath;
            af.filename = path.join(subFolderName, finalFilenameInSub);
          }

          await tx.audioFile.create({
            data: {
              filename: af.filename,
              path: af.path,
              duration: af.duration,
              index: nextIndex++,
              title: af.title,
              bookId: primaryBookId,
            },
          });
        } else {
          // Action is delete
          if (fs.existsSync(af.path)) {
            fs.rmSync(af.path, { force: true });
          }
          // DB record will be deleted when secondary book is deleted
        }
      }

      // 4. Delete secondary books
      for (const sId of secondaryBookIds) {
        const secondaryBook = await tx.book.findUnique({ where: { id: sId } });
        if (secondaryBook) {
          await tx.book.delete({ where: { id: sId } });
          // Try to delete folder if empty
          try {
            if (fs.existsSync(secondaryBook.folderPath) && fs.readdirSync(secondaryBook.folderPath).length === 0) {
              fs.rmdirSync(secondaryBook.folderPath);
            }
          } catch (e) {
            // ignore
          }
        }
      }

      // 5. Update primary book duration
      const totalDuration = await tx.audioFile.aggregate({
        where: { bookId: primaryBookId },
        _sum: { duration: true },
      });

      await tx.book.update({
        where: { id: primaryBookId },
        data: { duration: totalDuration._sum.duration || 0 },
      });
    });

    res.json({ message: "Duplicates resolved successfully" });
  } catch (error) {
    console.error("Resolve duplicates error:", error);
    res.status(500).json({ error: "Failed to resolve duplicates" });
  }
};

export const findBookDuplicatesHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: { author: true },
    });

    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    const candidates = await prisma.book.findMany({
      where: {
        id: { not: bookId },
      },
      include: {
        author: true,
        library: { select: { name: true } },
        _count: { select: { audioFiles: true } },
        audioFiles: { orderBy: { index: "asc" } },
        progress: true,
        series: true,
      },
    });

    const result = candidates
      .filter((candidate) => booksArePotentialDuplicates(book, candidate))
      .map((candidate) => ({
        ...candidate,
        coverPath: normalizeCoverPath(candidate.coverPath),
      }));

    res.json(result);
  } catch (error) {
    console.error("Find duplicates error:", error);
    res.status(500).json({ error: "Failed to find duplicates" });
  }
};

export const mergeBooksHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const primaryId = getSingleParam(req.params.bookId);
    const { secondaryIds } = req.body as { secondaryIds: string[] };

    if (!primaryId || !secondaryIds || !Array.isArray(secondaryIds) || secondaryIds.length === 0) {
      res.status(400).json({ error: "Primary book ID and at least one secondary book ID are required" });
      return;
    }

    const primaryBook = await prisma.book.findUnique({
      where: { id: primaryId },
      include: { audioFiles: true },
    });

    if (!primaryBook) {
      res.status(404).json({ error: "Primary book not found" });
      return;
    }

    const secondaryBooks = await prisma.book.findMany({
      where: { id: { in: secondaryIds } },
      include: { audioFiles: true },
    });

    if (secondaryBooks.length !== secondaryIds.length) {
      res.status(404).json({ error: "One or more secondary books not found" });
      return;
    }

    // Perform merge in a transaction
    await prisma.$transaction(async (tx) => {
      for (const secondary of secondaryBooks) {
        // 1. Move progress records if they don't exist for the primary book
        const secondaryProgress = await tx.progress.findMany({
          where: { bookId: secondary.id },
        });

        for (const prog of secondaryProgress) {
          const existingPrimaryProg = await tx.progress.findUnique({
            where: { userId_bookId: { userId: prog.userId, bookId: primaryId } },
          });

          if (!existingPrimaryProg) {
            await tx.progress.create({
              data: {
                userId: prog.userId,
                bookId: primaryId,
                currentTime: prog.currentTime,
                isFinished: prog.isFinished,
                lastUpdate: prog.lastUpdate,
              },
            });
          } else if (!existingPrimaryProg.isFinished && prog.isFinished) {
            // Update to finished if secondary was finished
            await tx.progress.update({
              where: { id: existingPrimaryProg.id },
              data: {
                isFinished: true,
                currentTime: prog.currentTime,
                lastUpdate: prog.lastUpdate,
              },
            });
          }
        }

        // 2. Move audio files physically and update DB
        // We move files to a subfolder or just move them into the primary folder?
        // Let's create a subfolder if it's multiple files to avoid name collisions
        const destFolder = primaryBook.folderPath;
        const subFolderName = `merged_${secondary.id.split("-")[0]}`;
        const subFolderPath = path.join(destFolder, subFolderName);

        if (secondary.audioFiles.length > 0) {
          if (!fs.existsSync(subFolderPath)) {
            fs.mkdirSync(subFolderPath, { recursive: true });
          }

          let lastIndex = await tx.audioFile.count({ where: { bookId: primaryId } });

          for (const af of secondary.audioFiles) {
            const oldPath = af.path;
            const newPath = path.join(subFolderPath, af.filename);

            if (fs.existsSync(oldPath)) {
              fs.renameSync(oldPath, newPath);
            }

            await tx.audioFile.create({
              data: {
                filename: path.join(subFolderName, af.filename),
                path: newPath,
                duration: af.duration,
                index: lastIndex++,
                title: af.title,
                bookId: primaryId,
              },
            });
          }
        }

        // 3. Delete secondary book (cascade will delete its old audioFile records in DB)
        await tx.book.delete({ where: { id: secondary.id } });

        // 4. Try to delete the empty folder of the secondary book
        try {
          if (fs.existsSync(secondary.folderPath) && fs.readdirSync(secondary.folderPath).length === 0) {
            fs.rmdirSync(secondary.folderPath);
          }
        } catch (e) {
          console.error(`Failed to delete folder ${secondary.folderPath}:`, e);
        }
      }

      // 5. Update primary book duration
      const totalDuration = await tx.audioFile.aggregate({
        where: { bookId: primaryId },
        _sum: { duration: true },
      });

      await tx.book.update({
        where: { id: primaryId },
        data: { duration: totalDuration._sum.duration || 0 },
      });
    });

    adminLogger.info("Books merged", {
      primaryId,
      secondaryIds,
    });

    res.json({ message: "Books merged successfully" });
  } catch (error) {
    console.error("Merge books error:", error);
    res.status(500).json({ error: "Failed to merge books" });
  }
};
