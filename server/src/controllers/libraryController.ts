import { Request, Response } from "express";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import sharp from "sharp";
import prisma from "../lib/prisma";
import { requestLibraryScan, stopScanning } from "../lib/scanJobPool";
import { normalizeCoverPath, findCoverInFolder, findCoverInFolderAsync } from "../utils/covers";
import { AuthRequest } from "../middleware/authMiddleware";
import { setLogTitle } from "../middleware/loggingMiddleware";
import {
  buildIgnoredDuplicatePairKeySet,
  filterIgnoredDuplicateGroups,
  findDuplicateGroups,
} from "../utils/duplicates";
import { cleanupBookTitle } from "../utils/titleCleanup";
import { getAppearanceSettings } from "../utils/appSettings";

const getSingleParam = (value: string | string[] | undefined): string | null =>
  typeof value === "string" ? value : null;

const normalizeBookCover = <T extends { coverPath?: string | null }>(book: T) => ({
  ...book,
  coverPath: normalizeCoverPath(book.coverPath),
});

const normalizeLibraryBook = <
  T extends {
    title: string;
    folderPath?: string | null;
    coverPath?: string | null;
  },
>(book: T) => ({
  ...normalizeBookCover(book),
  title: cleanupBookTitle(book.title, { folderNameOrPath: book.folderPath ?? undefined }),
});

const getQueryString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const getQueryNumber = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getQueryBoolean = (value: unknown) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
};

const stripDiacritics = (value: string) =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

const normalizeSearchText = (value: string | null | undefined) =>
  stripDiacritics(value ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const compactSearchText = (value: string | null | undefined) =>
  normalizeSearchText(value).replace(/\s+/g, "");

const tokenizeSearchText = (value: string | null | undefined) =>
  normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length >= 3);

const matchesNormalizedSearch = (value: string | null | undefined, query: string) => {
  if (!query) return true;

  const normalizedValue = normalizeSearchText(value);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  if (normalizedValue.includes(normalizedQuery)) {
    return true;
  }

  const compactValue = compactSearchText(value);
  const compactQuery = compactSearchText(query);
  if (compactQuery && compactValue.includes(compactQuery)) {
    return true;
  }

  const queryTokens = tokenizeSearchText(query);
  return queryTokens.length > 0 && queryTokens.every((token) => normalizedValue.includes(token));
};

const splitFacetValues = (values: Array<string | null>) =>
  Array.from(
    new Set(
      values
        .flatMap((value) => value?.split(",") ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

const hasTag = (value: string | null | undefined, tagName: string) =>
  (value ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .includes(tagName.toLowerCase());

const isReviewBook = (value: string | null | undefined) => hasTag(value, "review");

const FILTER_OPTIONS_CACHE_TTL_MS = 30_000;
let filterOptionsCache:
  | {
      createdAt: number;
      value: {
        libraries: Array<{
          id: string;
          name: string;
          description: string | null;
          _count: { books: number; sources: number };
        }>;
        authors: Array<{ id: string; name: string; _count: { books: number } }>;
        series: Array<{ id: string; name: string; _count: { books: number } }>;
        narrators: string[];
        publishers: string[];
        languages: string[];
        years: string[];
        genres: string[];
        tags: string[];
        fileTypes: string[];
      };
    }
  | null = null;

export const invalidateFilterOptionsCache = () => {
  filterOptionsCache = null;
};

export const getBooks = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const libraryId = getQueryString(req.query.libraryId);
    const authorId = getQueryString(req.query.authorId);
    const seriesId = getQueryString(req.query.seriesId);
    const narrator = getQueryString(req.query.narrator);
    const author = getQueryString(req.query.author);
    const series = getQueryString(req.query.series);
    const publisher = getQueryString(req.query.publisher);
    const language = getQueryString(req.query.language);
    const genre = getQueryString(req.query.genre);
    const tag = getQueryString(req.query.tag);
    const yearFrom = getQueryString(req.query.yearFrom);
    const yearTo = getQueryString(req.query.yearTo);
    const durationMin = getQueryNumber(req.query.durationMin);
    const durationMax = getQueryNumber(req.query.durationMax);
    const abridged = getQueryBoolean(req.query.abridged);
    const cover = getQueryString(req.query.cover);
    const hasAsin = getQueryBoolean(req.query.hasAsin);
    const hasIsbn = getQueryBoolean(req.query.hasIsbn);
    const fileType = getQueryString(req.query.fileType);
    const audioStatus = getQueryString(req.query.audioStatus);
    const listeningStatus = getQueryString(req.query.listeningStatus);
    const matchStatus = getQueryString(req.query.matchStatus);
    const duplicatesOnly = getQueryBoolean(req.query.duplicatesOnly);
    const search = getQueryString(req.query.search);
    const sortBy = getQueryString(req.query.sortBy) || "newest";
    const page = getQueryNumber(req.query.page);
    const limit = getQueryNumber(req.query.limit);
    const appearanceSettings = await getAppearanceSettings();

    const where: any = { AND: [] };

    if (duplicatesOnly) {
      const duplicateCandidates = await prisma.book.findMany({
        select: {
          id: true,
          title: true,
          asin: true,
          isbn: true,
          authorId: true,
          author: {
            select: {
              name: true,
            },
          },
        },
      });
      const ignoredPairs = await prisma.ignoredDuplicatePair.findMany({
        select: { bookAId: true, bookBId: true },
      });

      const duplicateBookIds = new Set(
        filterIgnoredDuplicateGroups(
          findDuplicateGroups(duplicateCandidates),
          buildIgnoredDuplicatePairKeySet(ignoredPairs),
        )
          .flatMap((group) => group.books.map((book) => book.id)),
      );

      where.AND.push({
        id: {
          in: Array.from(duplicateBookIds),
        },
      });
    }

    if (libraryId) where.libraryId = libraryId;
    if (authorId) where.authorId = authorId;
    if (seriesId) where.seriesId = seriesId;
    if (narrator) where.narrator = narrator;
    if (author) where.author = { name: { contains: author, mode: "insensitive" } };
    if (series) where.series = { name: { contains: series, mode: "insensitive" } };
    if (publisher) where.publisher = { contains: publisher, mode: "insensitive" };
    if (language) where.language = { equals: language, mode: "insensitive" };
    if (genre) where.genres = { contains: genre, mode: "insensitive" };
    if (abridged !== undefined) where.abridged = abridged;
    if (yearFrom || yearTo) where.year = { ...(yearFrom ? { gte: yearFrom } : {}), ...(yearTo ? { lte: yearTo } : {}) };
    if (durationMin !== undefined || durationMax !== undefined) {
      where.duration = {
        ...(durationMin !== undefined ? { gte: durationMin } : {}),
        ...(durationMax !== undefined ? { lte: durationMax } : {}),
      };
    }
    if (hasAsin === true) where.asin = { not: null };
    if (hasAsin === false) where.asin = null;
    if (hasIsbn === true) where.isbn = { not: null };
    if (hasIsbn === false) where.isbn = null;

    // Push everything that can use a single field via AND so multiple
    // filters on the same column (tags, audioFiles, progress) compose
    // instead of overwriting each other.
    if (tag) where.AND.push({ tags: { contains: tag, mode: "insensitive" } });
    if (fileType) {
      where.AND.push({
        audioFiles: { some: { filename: { endsWith: fileType, mode: "insensitive" } } },
      });
    }
    if (audioStatus === "silent") {
      where.AND.push({ audioFiles: { some: { isSilent: true } } });
    } else if (audioStatus === "clean") {
      where.AND.push({
        audioFiles: { some: {} },
        NOT: { audioFiles: { some: { isSilent: true } } },
      });
    }
    if (listeningStatus === "in_progress" && userId) {
      where.AND.push({ progress: { some: { userId, currentTime: { gt: 30 }, isFinished: false } } });
    } else if (listeningStatus === "finished" && userId) {
      where.AND.push({ progress: { some: { userId, isFinished: true } } });
    } else if (listeningStatus === "not_started" && userId) {
      where.AND.push({
        OR: [
          { progress: { none: { userId } } },
          { progress: { some: { userId, currentTime: { lte: 30 }, isFinished: false } } },
        ],
      });
    }

    // Filters that previously ran in-memory after a full fetch — now pushed
    // to the DB so pagination/count don't have to load every book.
    if (cover === "with") where.AND.push({ coverPath: { not: null } });
    else if (cover === "missing") where.AND.push({ coverPath: null });

    if (matchStatus === "matched") {
      where.AND.push({ tags: { contains: "matched", mode: "insensitive" } });
    } else if (matchStatus === "unmatched") {
      where.AND.push({
        OR: [
          { tags: null },
          { NOT: { tags: { contains: "matched", mode: "insensitive" } } },
        ],
      });
    } else if (matchStatus === "quick-matched") {
      where.AND.push({ tags: { contains: "quick-matched", mode: "insensitive" } });
    }

    if (!appearanceSettings.showReviewBooks) {
      where.AND.push({
        OR: [
          { tags: null },
          { NOT: { tags: { contains: "review", mode: "insensitive" } } },
        ],
      });
    }

    // Token-AND search across the user-visible fields. Diacritic stripping
    // is lost vs. the old in-memory match, but that's a rare path for an
    // English audiobook library and the speedup is worth it.
    if (search) {
      const tokens = search
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2);
      for (const token of tokens) {
        where.AND.push({
          OR: [
            { title: { contains: token, mode: "insensitive" } },
            { subtitle: { contains: token, mode: "insensitive" } },
            { author: { name: { contains: token, mode: "insensitive" } } },
            { series: { name: { contains: token, mode: "insensitive" } } },
            { narrator: { contains: token, mode: "insensitive" } },
            { publisher: { contains: token, mode: "insensitive" } },
            { genres: { contains: token, mode: "insensitive" } },
            { tags: { contains: token, mode: "insensitive" } },
          ],
        });
      }
    }

    if (where.AND.length === 0) delete where.AND;

    let orderBy: any = { createdAt: "desc" };
    if (sortBy === "title_asc") orderBy = { title: "asc" };
    if (sortBy === "title_desc") orderBy = { title: "desc" };
    if (sortBy === "author_asc") orderBy = { author: { name: "asc" } };
    if (sortBy === "author_desc") orderBy = { author: { name: "desc" } };
    if (sortBy === "duration_asc") orderBy = { duration: "asc" };
    if (sortBy === "duration_desc") orderBy = { duration: "desc" };
    if (sortBy === "year_asc") orderBy = { year: "asc" };
    if (sortBy === "year_desc") orderBy = { year: "desc" };
    if (sortBy === "newest") orderBy = { createdAt: "desc" };
    if (sortBy === "oldest") orderBy = { createdAt: "asc" };

    const isPaginated = page !== undefined || limit !== undefined;
    const safeLimit = isPaginated
      ? Math.min(Math.max(Math.floor(limit ?? 50), 1), 100)
      : undefined;
    const safePage = isPaginated ? Math.max(Math.floor(page ?? 0), 0) : 0;

    const selectShape = {
      id: true,
      title: true,
      subtitle: true,
      asin: true,
      duration: true,
      coverPath: true,
      folderPath: true,
      series: { select: { id: true, name: true } },
      sequence: true,
      narrator: true,
      publisher: true,
      genres: true,
      tags: true,
      library: { select: { id: true, name: true } },
      author: { select: { name: true } },
    } as const;

    if (isPaginated) {
      const [books, total] = await Promise.all([
        prisma.book.findMany({
          where,
          select: selectShape,
          orderBy,
          take: safeLimit,
          skip: safePage * (safeLimit ?? 0),
        }),
        prisma.book.count({ where }),
      ]);
      res.json({
        results: books.map(normalizeLibraryBook),
        total,
        page: safePage,
        limit: safeLimit,
      });
      return;
    }

    const books = await prisma.book.findMany({ where, select: selectShape, orderBy });
    res.json(books.map(normalizeLibraryBook));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch books" });
  }
};

export const getFilterOptions = async (_req: AuthRequest, res: Response) => {
  try {
    const appearanceSettings = await getAppearanceSettings();
    const now = Date.now();
    if (filterOptionsCache && now - filterOptionsCache.createdAt < FILTER_OPTIONS_CACHE_TTL_MS) {
      res.json(filterOptionsCache.value);
      return;
    }

    const [libraries, authors, series, narratorRows, metadataRows, audioFileRows] = await Promise.all([
      prisma.library.findMany({
        where: { isActive: true },
        select: { id: true, name: true, description: true, _count: { select: { books: true, sources: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.author.findMany({
        select: { id: true, name: true, _count: { select: { books: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.series.findMany({
        select: { id: true, name: true, _count: { select: { books: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.book.findMany({
        where: { narrator: { not: null } },
        select: { narrator: true },
        distinct: ["narrator"],
        orderBy: { narrator: "asc" },
      }),
      prisma.book.findMany({
        select: {
          publisher: true,
          language: true,
          year: true,
          genres: true,
          tags: true,
        },
      }),
      prisma.audioFile.findMany({
        select: { filename: true },
      }),
    ]);

    const fileTypes = Array.from(
      new Set(
        audioFileRows
          .map((row) => path.extname(row.filename).toLowerCase())
          .filter(Boolean),
      ),
    ).sort();

    const visibleMetadataRows = appearanceSettings.showReviewBooks
      ? metadataRows
      : metadataRows.filter((row) => !isReviewBook(row.tags));

    const response = {
      libraries,
      authors,
      series,
      narrators: narratorRows.map((row) => row.narrator).filter((value): value is string => Boolean(value)),
      publishers: Array.from(
        new Set(visibleMetadataRows.map((row) => row.publisher).filter((value): value is string => Boolean(value))),
      ).sort(),
      languages: Array.from(
        new Set(visibleMetadataRows.map((row) => row.language).filter((value): value is string => Boolean(value))),
      ).sort(),
      years: Array.from(
        new Set(visibleMetadataRows.map((row) => row.year).filter((value): value is string => Boolean(value))),
      ).sort(),
      genres: splitFacetValues(visibleMetadataRows.map((row) => row.genres)),
      tags: splitFacetValues(visibleMetadataRows.map((row) => row.tags)),
      fileTypes,
    };

    filterOptionsCache = {
      createdAt: now,
      value: response,
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch filter options" });
  }
};

export const getBookDetails = async (req: Request, res: Response) => {
  try {
    const id = getSingleParam(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    const book = await prisma.book.findUnique({
      where: { id },
      include: {
        library: true,
        author: true,
        series: true,
        audioFiles: { orderBy: { index: "asc" } },
        chapters: { orderBy: { start: "asc" } },
      },
    });

    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    setLogTitle(book.title);

    res.json(normalizeLibraryBook(book));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch book details" });
  }
};

export const getSearchSuggestions = async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.json({ books: [], authors: [], series: [], narrators: [] });
      return;
    }

    const [appearanceSettings, books, authors, seriesResults, narratorRows] = await Promise.all([
      getAppearanceSettings(),
      prisma.book.findMany({
        select: {
          id: true,
          title: true,
          subtitle: true,
          coverPath: true,
          folderPath: true,
          tags: true,
          author: { select: { name: true } },
        },
        orderBy: { title: "asc" },
      }),
      prisma.author.findMany({
        select: { id: true, name: true, _count: { select: { books: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.series.findMany({
        select: { id: true, name: true, _count: { select: { books: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.book.findMany({
        select: { narrator: true },
        distinct: ["narrator"],
      }),
    ]);

    const visibleBooks = appearanceSettings.showReviewBooks
      ? books
      : books.filter((book) => !isReviewBook(book.tags));

    res.json({
      books: visibleBooks
        .filter((book) => [book.title, book.subtitle, book.author.name].some((value) => matchesNormalizedSearch(value, q)))
        .slice(0, 5)
        .map(normalizeLibraryBook),
      authors: authors
        .filter((author) => matchesNormalizedSearch(author.name, q))
        .slice(0, 3),
      series: seriesResults
        .filter((series) => matchesNormalizedSearch(series.name, q))
        .slice(0, 3),
      narrators: narratorRows
        .map((b) => b.narrator)
        .filter((n): n is string => n !== null)
        .filter((narrator) => matchesNormalizedSearch(narrator, q))
        .slice(0, 3),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
};

export const getLibraries = async (_req: Request, res: Response) => {
  try {
    const libraries = await prisma.library.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        _count: {
          select: {
            books: true,
            sources: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    res.json(libraries);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch libraries" });
  }
};

export const triggerScan = async (req: Request, res: Response) => {
  try {
    const libraryId =
      typeof req.body?.libraryId === "string" && req.body.libraryId.trim()
        ? req.body.libraryId.trim()
        : undefined;

    if (libraryId) {
      const library = await prisma.library.findUnique({
        where: { id: libraryId },
        select: { id: true, name: true },
      });

      if (!library) {
        res.status(404).json({ error: "Library not found" });
        return;
      }

      const scanRequest = await requestLibraryScan(libraryId);
      res.status(202).json({
        message:
          scanRequest.status === "queued" ? `${library.name} scan queued` : `${library.name} scan started`,
        status: scanRequest.status,
        jobId: scanRequest.jobId,
      });
      return;
    }

    const scanRequest = await requestLibraryScan();
    res.status(202).json({ message: scanRequest.message, status: scanRequest.status, jobId: scanRequest.jobId });
  } catch (error) {
    res.status(500).json({ error: "Scan failed" });
  }
};

export const stopScan = async (_req: Request, res: Response) => {
  try {
    await stopScanning();
    res.json({ message: "Scan stop requested" });
  } catch (error) {
    res.status(500).json({ error: "Failed to stop scan" });
  }
};

export const getCover = async (req: Request, res: Response) => {
  const param = getSingleParam(req.params.name);
  if (!param) {
    res.status(400).send("Invalid cover id");
    return;
  }

  const bookId = decodeURIComponent(param);
  const widthParam = getQueryNumber(req.query.w);
  const requestedWidth =
    widthParam !== undefined
      ? Math.min(Math.max(Math.floor(widthParam), 32), 1200)
      : null;

  let filePath: string | null = null;

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { folderPath: true },
  });
  if (book) {
    const coverFile = await findCoverInFolderAsync(book.folderPath);
    if (coverFile) filePath = coverFile;
  }

  if (!filePath) {
    const legacyPath = path.join(process.cwd(), "data", "covers", bookId);
    try {
      await fsp.access(legacyPath);
      filePath = legacyPath;
    } catch {
      // No legacy cover available; fall through to 404 below.
    }
  }

  if (!filePath) {
    res.status(404).send("Not found");
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=86400");

  if (requestedWidth) {
    try {
      const buffer = await sharp(filePath)
        .rotate()
        .resize({ width: requestedWidth, withoutEnlargement: true, fit: "inside" })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      res.setHeader("Content-Type", "image/jpeg");
      res.end(buffer);
      return;
    } catch {
      // Fall back to the original file on any resize error.
    }
  }

  res.sendFile(filePath);
};
