import fs from "fs";
import path from "path";
import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import prisma from "../../lib/prisma";
import type { AudibleMatchCandidate } from "../../utils/audible";
import { GoogleBooksSearchError } from "../../utils/googleBooks";
import { GoodreadsSearchError } from "../../utils/goodreads";
import { downloadCover, findCoverInFolder, getCoverUrl } from "../../utils/covers";
import { invalidateFilterOptionsCache } from "../libraryController";
import { invalidateRecommendationCache } from "../../lib/recommendationCache";
import { setLogTitle } from "../../middleware/loggingMiddleware";
import { METADATA_VERSION } from "../../utils/scanner/shared";
import { getSingleParam, getOptionalBodyValue, toNullableString, toNullableNumber } from "./shared";
import {
  REVIEW_TAG,
  MATCHED_TAG,
  QUICK_MATCHED_TAG,
  type MetadataProvider,
  parseAsinValue,
  parseMetadataProvider,
  normalizeTagList,
  serializeTagList,
  mergeManagedTags,
  hasManagedTag,
  findBookMatchCandidates,
  buildFieldsFromMatchCandidate,
  defaultQuickMatchSelectedFields,
  chooseQuickMatchCandidate,
  applyMatchedFieldsToBook,
} from "./books/shared";

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
    const searchResult = await findBookMatchCandidates(book, provider, query, author, language);

    res.json({
      provider,
      query: searchResult.query,
      author,
      language,
      candidates: searchResult.candidates,
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
      needsReview: Array<{ bookId: string; title: string; reason: string; candidates: AudibleMatchCandidate[] }>;
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
      invalidateRecommendationCache();
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

    updateData.metadataVersion = METADATA_VERSION;

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
      invalidateRecommendationCache();
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
        invalidateRecommendationCache();
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
      invalidateRecommendationCache();
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
        invalidateRecommendationCache();
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
