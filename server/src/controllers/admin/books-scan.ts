import prisma from "../../lib/prisma";
import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import { requestLibraryScan, requestLibraryFolderScan } from "../../lib/scanJobPool";
import { autoChapterizeBook, rescanBook } from "../../utils/scanner";
import { invalidateFilterOptionsCache } from "../libraryController";
import { invalidateRecommendationCache } from "../../lib/recommendationCache";
import { getSingleParam } from "./shared";
import { adminLogger } from "./books/shared";

export const rescanSingleBookHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    await rescanBook(bookId);
    invalidateFilterOptionsCache();
    invalidateRecommendationCache();
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

// Folder-scoped rescan — for external callers (e.g. BookSync after a
// download) that know which folder changed and don't need the whole library
// re-walked. Accepts either an absolute path (matches Azure's mount) or a
// relativePath that's resolved against the library's first enabled source.
export const rescanLibraryFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const folderPathInput = typeof req.body?.folderPath === "string" ? req.body.folderPath.trim() : "";
    const relativePathInput = typeof req.body?.relativePath === "string" ? req.body.relativePath.trim() : "";
    if (!folderPathInput && !relativePathInput) {
      res.status(400).json({ error: "folderPath or relativePath is required" });
      return;
    }

    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      select: {
        id: true,
        name: true,
        sources: {
          where: { isEnabled: true },
          select: { path: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!library) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    let folderPath = folderPathInput;
    if (!folderPath) {
      const sourceRoot = library.sources[0]?.path;
      if (!sourceRoot) {
        res.status(409).json({ error: "Library has no enabled source to resolve relativePath against" });
        return;
      }
      const cleanedRel = relativePathInput.replace(/^[\\/]+/, "").replace(/\\/g, "/");
      folderPath = `${sourceRoot.replace(/[\\/]+$/, "")}/${cleanedRel}`;
    }

    const trigger = typeof req.body?.trigger === "string" && req.body.trigger.trim()
      ? req.body.trigger.trim()
      : "external";

    const scanRequest = await requestLibraryFolderScan(libraryId, folderPath, trigger, { dedupe: true });
    adminLogger.info("Folder rescan requested", {
      libraryId: library.id,
      name: library.name,
      folderPath,
      trigger,
      status: scanRequest.status,
    });
    res.status(202).json({
      message: scanRequest.message,
      status: scanRequest.status,
      jobId: scanRequest.jobId,
    });
  } catch (error) {
    console.error("Rescan folder error:", error);
    res.status(500).json({ error: "Failed to queue folder rescan" });
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

