import { Request, Response } from "express";
import path from "path";
import fs from "fs";
import prisma from "../lib/prisma";
import { requestLibraryScan, stopScanning } from "../lib/scanJobPool";
import { normalizeCoverPath, findCoverInFolder } from "../utils/covers";
import { AuthRequest } from "../middleware/authMiddleware";
import { findDuplicateGroups } from "../utils/duplicates";
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

const hasAvailableCover = (coverPath?: string | null) => !!coverPath;

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
    const listeningStatus = getQueryString(req.query.listeningStatus);
    const matchStatus = getQueryString(req.query.matchStatus);
    const duplicatesOnly = getQueryBoolean(req.query.duplicatesOnly);
    const search = getQueryString(req.query.search);
    const sortBy = getQueryString(req.query.sortBy) || "newest";
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

      const duplicateBookIds = new Set(
        findDuplicateGroups(duplicateCandidates)
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
    if (tag) where.tags = { contains: tag, mode: "insensitive" };
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
    if (fileType) {
      where.audioFiles = {
        some: {
          filename: {
            endsWith: fileType,
            mode: "insensitive",
          },
        },
      };
    }
    if (listeningStatus === "in_progress" && userId) {
      where.progress = { some: { userId, currentTime: { gt: 30 }, isFinished: false } };
    }
    if (listeningStatus === "finished" && userId) {
      where.progress = { some: { userId, isFinished: true } };
    }
    if (listeningStatus === "not_started" && userId) {
      where.AND.push({
        OR: [
          { progress: { none: { userId } } },
          { progress: { some: { userId, currentTime: { lte: 30 }, isFinished: false } } },
        ],
      });
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

    const books = await prisma.book.findMany({
      where,
      select: {
        id: true,
        title: true,
        subtitle: true,
        asin: true,
        duration: true,
        coverPath: true,
        folderPath: true,
        series: {
          select: {
            id: true,
            name: true,
          },
        },
        sequence: true,
        narrator: true,
        publisher: true,
        genres: true,
        tags: true,
        library: {
          select: {
            id: true,
            name: true,
          },
        },
        author: {
          select: {
            name: true,
          },
        },
      },
      orderBy,
    });
    const searchFilteredBooks = search
      ? books.filter((book) =>
          [
            book.title,
            book.subtitle,
            book.author.name,
            book.series?.name,
            book.narrator,
            book.publisher,
            book.genres,
            book.tags,
          ].some((value) => matchesNormalizedSearch(value, search)),
        )
      : books;
    const normalizedBooks = searchFilteredBooks
      .map(normalizeLibraryBook)
      .filter((book) => appearanceSettings.showReviewBooks || !isReviewBook(book.tags));
    const matchFilteredBooks =
      matchStatus === "matched"
        ? normalizedBooks.filter((book) => hasTag(book.tags, "matched"))
        : matchStatus === "unmatched"
          ? normalizedBooks.filter((book) => !hasTag(book.tags, "matched"))
          : matchStatus === "quick-matched"
            ? normalizedBooks.filter((book) => hasTag(book.tags, "quick-matched"))
          : normalizedBooks;
    const filteredBooks =
      cover === "with"
        ? matchFilteredBooks.filter((book) => hasAvailableCover(book.coverPath))
        : cover === "missing"
          ? matchFilteredBooks.filter((book) => !hasAvailableCover(book.coverPath))
          : matchFilteredBooks;

    res.json(filteredBooks);
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

      const scanRequest = requestLibraryScan(libraryId);
      res.status(202).json({
        message:
          scanRequest.status === "queued" ? `${library.name} scan queued` : `${library.name} scan started`,
        status: scanRequest.status,
      });
      return;
    }

    const scanRequest = requestLibraryScan();
    res.status(202).json({ message: scanRequest.message, status: scanRequest.status });
  } catch (error) {
    res.status(500).json({ error: "Scan failed" });
  }
};

export const stopScan = async (_req: Request, res: Response) => {
  try {
    stopScanning();
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

  // New format: bookId → serve cover from the book's folder
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { folderPath: true },
  });

  if (book) {
    const coverFile = findCoverInFolder(book.folderPath);
    if (coverFile) {
      res.sendFile(coverFile);
      return;
    }
  }

  // Fallback: old format (filename with extension) stored in data/covers
  const legacyPath = path.join(process.cwd(), "data", "covers", bookId);
  if (fs.existsSync(legacyPath)) {
    res.sendFile(legacyPath);
    return;
  }

  res.status(404).send("Not found");
};
