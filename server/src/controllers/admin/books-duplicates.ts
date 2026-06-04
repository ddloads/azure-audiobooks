import prisma from "../../lib/prisma";
import fs from "fs";
import path from "path";
import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import { invalidateFilterOptionsCache } from "../libraryController";
import { invalidateRecommendationCache } from "../../lib/recommendationCache";
import { normalizeCoverPath } from "../../utils/covers";
import {
  booksArePotentialDuplicates,
  buildDuplicatePairKey,
  buildDuplicatePairKeys,
  buildIgnoredDuplicatePairKeySet,
  filterIgnoredDuplicateGroups,
  findDuplicateGroups,
} from "../../utils/duplicates";
import { getSingleParam } from "./shared";
import { type DuplicateFileAction, duplicateFileActions, adminLogger } from "./books/shared";

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

    const ignoredPairs = await prisma.ignoredDuplicatePair.findMany({
      select: { bookAId: true, bookBId: true },
    });

    const duplicateGroups = filterIgnoredDuplicateGroups(
      findDuplicateGroups(
      books.map((book) => ({
        ...book,
        coverPath: normalizeCoverPath(book.coverPath),
      })),
      ),
      buildIgnoredDuplicatePairKeySet(ignoredPairs),
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
      audioFileActions: Array<{ audioFileId: string; action: DuplicateFileAction }>;
    };

    if (
      !primaryBookId ||
      !Array.isArray(secondaryBookIds) ||
      secondaryBookIds.length === 0 ||
      !Array.isArray(audioFileActions)
    ) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const uniqueSecondaryIds = Array.from(new Set(secondaryBookIds));
    if (uniqueSecondaryIds.length !== secondaryBookIds.length || uniqueSecondaryIds.includes(primaryBookId)) {
      res.status(400).json({ error: "Secondary books must be unique and cannot include the primary book" });
      return;
    }

    if (audioFileActions.some((item) => !item.audioFileId || !duplicateFileActions.has(item.action))) {
      res.status(400).json({ error: "Invalid audio file action" });
      return;
    }

    const uniqueActionFileIds = new Set(audioFileActions.map((item) => item.audioFileId));
    if (uniqueActionFileIds.size !== audioFileActions.length) {
      res.status(400).json({ error: "Audio file actions must be unique" });
      return;
    }

    const involvedBookIds = [primaryBookId, ...uniqueSecondaryIds];
    const involvedBooks = await prisma.book.findMany({
      where: { id: { in: involvedBookIds } },
      include: { audioFiles: { orderBy: { index: "asc" } } },
    });

    if (involvedBooks.length !== involvedBookIds.length) {
      res.status(404).json({ error: "One or more duplicate books were not found" });
      return;
    }

    const primaryBook = involvedBooks.find((book) => book.id === primaryBookId);
    if (!primaryBook) {
      res.status(404).json({ error: "Primary book not found" });
      return;
    }

    if (keepProgressFromBookId && !involvedBookIds.includes(keepProgressFromBookId)) {
      res.status(400).json({ error: "Progress source must be one of the duplicate books" });
      return;
    }

    const involvedAudioFileIds = new Set(involvedBooks.flatMap((book) => book.audioFiles.map((file) => file.id)));
    if (audioFileActions.some((item) => !involvedAudioFileIds.has(item.audioFileId))) {
      res.status(400).json({ error: "Audio file actions can only target files in this duplicate group" });
      return;
    }

    const actionMap = new Map(audioFileActions.map((item) => [item.audioFileId, item.action]));
    const keptFileCount = involvedBooks
      .flatMap((book) => book.audioFiles)
      .filter((file) => {
        const action = actionMap.get(file.id) ?? "delete";
        return action === "keep" || action === "keep_sub";
      }).length;

    if (keptFileCount === 0) {
      res.status(400).json({ error: "At least one audio file must be kept when resolving duplicates" });
      return;
    }

    if (metadata?.title && metadata?.authorId) {
      const existingBook = await prisma.book.findFirst({
        where: {
          libraryId: primaryBook.libraryId,
          title: metadata.title,
          authorId: metadata.authorId,
          id: { notIn: involvedBookIds },
        },
        select: { id: true },
      });

      if (existingBook) {
        res.status(400).json({ error: "The selected metadata would duplicate another existing book" });
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      // 1. Handle Progress
      if (keepProgressFromBookId) {
        const sourceProgress = await tx.progress.findMany({
          where: { bookId: keepProgressFromBookId },
        });

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

      // 2. Handle Audio Files
      const subFolderName = "merged_duplicates";
      const subFolderPath = path.join(primaryBook.folderPath, subFolderName);

      const allAudioFiles = await tx.audioFile.findMany({
        where: { bookId: { in: involvedBookIds } },
        orderBy: { index: "asc" },
      });

      await tx.audioFile.deleteMany({
        where: { bookId: primaryBookId },
      });

      let nextIndex = 0;

      for (const af of allAudioFiles) {
        const action = actionMap.get(af.id) || "delete";

        if (action === "keep") {
          const oldPath = af.path;
          const newFilename = path.basename(af.filename);
          const newPath = path.join(primaryBook.folderPath, newFilename);
          let finalPath = af.path;
          let finalFilename = path.basename(af.filename);

          if (oldPath !== newPath) {
            if (fs.existsSync(oldPath)) {
              finalPath = newPath;
              if (fs.existsSync(newPath)) {
                 const ext = path.extname(newFilename);
                 const base = path.basename(newFilename, ext);
                 finalFilename = `${base}_${af.id.split('-')[0]}${ext}`;
                 finalPath = path.join(primaryBook.folderPath, finalFilename);
              }
              fs.renameSync(oldPath, finalPath);
            }
          }

          await tx.audioFile.create({
            data: {
              filename: finalFilename,
              path: finalPath,
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
          let finalPath = af.path;
          let finalFilename = path.join(subFolderName, newFilename);

          if (fs.existsSync(oldPath)) {
            finalPath = newPath;
            let finalFilenameInSub = newFilename;
            if (fs.existsSync(newPath)) {
               const ext = path.extname(newFilename);
               const base = path.basename(newFilename, ext);
               finalFilenameInSub = `${base}_${af.id.split('-')[0]}${ext}`;
               finalPath = path.join(subFolderPath, finalFilenameInSub);
            }
            fs.renameSync(oldPath, finalPath);
            finalFilename = path.join(subFolderName, finalFilenameInSub);
          }

          await tx.audioFile.create({
            data: {
              filename: finalFilename,
              path: finalPath,
              duration: af.duration,
              index: nextIndex++,
              title: af.title,
              bookId: primaryBookId,
            },
          });
        } else {
          if (fs.existsSync(af.path)) {
            fs.rmSync(af.path, { force: true });
          }
        }
      }

      // 3. Delete secondary books
      for (const sId of uniqueSecondaryIds) {
        const secondaryBook = await tx.book.findUnique({ where: { id: sId } });
        if (secondaryBook) {
          await tx.book.delete({ where: { id: sId } });
          try {
            if (fs.existsSync(secondaryBook.folderPath) && fs.readdirSync(secondaryBook.folderPath).length === 0) {
              fs.rmdirSync(secondaryBook.folderPath);
            }
          } catch (e) {
            // ignore
          }
        }
      }

      // 4. Apply metadata after secondary rows are gone to avoid unique collisions inside the group.
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

    invalidateFilterOptionsCache();
    invalidateRecommendationCache();
    res.json({ message: "Duplicates resolved successfully" });
  } catch (error: any) {
    console.error("Resolve duplicates error:", error);
    if (error?.code === "P2002") {
      res.status(400).json({ error: "The selected metadata would duplicate another existing book" });
      return;
    }
    res.status(500).json({ error: "Failed to resolve duplicates" });
  }
};

export const dismissDuplicateGroupHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { bookIds, reason } = req.body as { bookIds?: string[]; reason?: string };

    if (!Array.isArray(bookIds) || bookIds.length < 2) {
      res.status(400).json({ error: "At least two book IDs are required" });
      return;
    }

    const uniqueBookIds = Array.from(new Set(bookIds.filter((id) => typeof id === "string" && id.trim())));
    if (uniqueBookIds.length < 2) {
      res.status(400).json({ error: "At least two unique book IDs are required" });
      return;
    }

    const existingBooks = await prisma.book.findMany({
      where: { id: { in: uniqueBookIds } },
      select: { id: true },
    });

    if (existingBooks.length !== uniqueBookIds.length) {
      res.status(404).json({ error: "One or more books were not found" });
      return;
    }

    const pairKeys = buildDuplicatePairKeys(uniqueBookIds);
    await prisma.$transaction(
      pairKeys.map((pairKey) => {
        const [bookAId, bookBId] = pairKey.split("|");
        return prisma.ignoredDuplicatePair.upsert({
          where: { bookAId_bookBId: { bookAId, bookBId } },
          update: { reason: reason ?? null },
          create: { bookAId, bookBId, reason: reason ?? null },
        });
      }),
    );

    res.json({ message: "Duplicate group dismissed", ignoredPairs: pairKeys.length });
  } catch (error) {
    console.error("Dismiss duplicate group error:", error);
    res.status(500).json({ error: "Failed to dismiss duplicate group" });
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

    const ignoredPairs = await prisma.ignoredDuplicatePair.findMany({
      where: {
        OR: [{ bookAId: bookId }, { bookBId: bookId }],
      },
      select: { bookAId: true, bookBId: true },
    });
    const ignoredPairKeys = buildIgnoredDuplicatePairKeySet(ignoredPairs);

    const result = candidates
      .filter((candidate) =>
        booksArePotentialDuplicates(book, candidate) &&
        !ignoredPairKeys.has(buildDuplicatePairKey(book.id, candidate.id))
      )
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

    const uniqueSecondaryIds = Array.from(new Set(secondaryIds));
    if (uniqueSecondaryIds.length !== secondaryIds.length || uniqueSecondaryIds.includes(primaryId)) {
      res.status(400).json({ error: "Secondary books must be unique and cannot include the primary book" });
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
      where: { id: { in: uniqueSecondaryIds } },
      include: { audioFiles: true },
    });

    if (secondaryBooks.length !== uniqueSecondaryIds.length) {
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
      secondaryIds: uniqueSecondaryIds,
    });

    invalidateFilterOptionsCache();
    invalidateRecommendationCache();
    res.json({ message: "Books merged successfully" });
  } catch (error) {
    console.error("Merge books error:", error);
    res.status(500).json({ error: "Failed to merge books" });
  }
};
