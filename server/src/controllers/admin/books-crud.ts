import prisma from "../../lib/prisma";
import path from "path";
import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import { invalidateFilterOptionsCache } from "../libraryController";
import { invalidateRecommendationCache } from "../../lib/recommendationCache";
import { setLogTitle } from "../../middleware/loggingMiddleware";
import { getSingleParam, pathBelongsToRoot } from "./shared";
import { adminLogger, removeBookFolder } from "./books/shared";

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

    // Delete physical files if requested
    if (deleteFiles) {
      const matchingSource = book.library.sources.find((source) =>
        pathBelongsToRoot(book.folderPath, source.path),
      );

      if (!matchingSource) {
        res.status(400).json({ error: "Book folder is outside configured library sources" });
        return;
      }

      try {
        await removeBookFolder(book.folderPath);
      } catch (error) {
        adminLogger.error("Book file deletion failed", error, {
          bookId,
          title: book.title,
          folderPath: book.folderPath,
        });
        res.status(409).json({
          error:
            error instanceof Error
              ? `Could not delete physical files: ${error.message}`
              : "Could not delete physical files",
        });
        return;
      }
    }

    await prisma.book.delete({ where: { id: bookId } });

    adminLogger.info("Book deleted", {
      bookId,
      title: book.title,
      deleteFiles: !!deleteFiles,
    });

    invalidateFilterOptionsCache();
    invalidateRecommendationCache();
    res.status(204).send();
  } catch (error) {
    console.error("Delete book error:", error);
    res.status(500).json({ error: "Failed to delete book" });
  }
};

