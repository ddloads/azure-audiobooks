import prisma from "../../lib/prisma";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import { createLogger } from "../../lib/logger";
import {
  emitMergeProgress,
  emitWriteTagsProgress,
} from "../../lib/socket";
import { findCoverInFolder } from "../../utils/covers";
import { embedMetadata, mergeToM4B } from "../../utils/processor";
import { rescanBook } from "../../utils/scanner";
import { setLogTitle } from "../../middleware/loggingMiddleware";
import {
  getSingleParam,
} from "./shared";

const adminLogger = createLogger("admin");

export type WriteTagsJobStatus = "pending" | "running" | "completed" | "failed";

export type WriteTagsJob = {
  id: string;
  bookId: string;
  bookTitle: string | null;
  status: WriteTagsJobStatus;
  totalFiles: number;
  processedFiles: number;
  currentFile: string | null;
  currentFileStartedAt: string | null;
  lastCompletedFile: string | null;
  lastCompletedAt: string | null;
  failures: Array<{ path: string; error: string }>;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  message: string | null;
  stallTimeoutMs: number;
};

export const writeTagsJobs = new Map<string, WriteTagsJob>();

const configuredWriteTagsTimeoutMs = (() => {
  const parsed = Number.parseInt(process.env.TONE_TAG_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
})();

const touchWriteTagsJob = (job: WriteTagsJob) => {
  job.updatedAt = new Date().toISOString();
};

const emitWriteTagsJobProgress = (job: WriteTagsJob) => {
  emitWriteTagsProgress({
    id: job.id,
    bookId: job.bookId,
    bookTitle: job.bookTitle,
    status: job.status,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    currentFile: job.currentFile,
    currentFileStartedAt: job.currentFileStartedAt,
    lastCompletedFile: job.lastCompletedFile,
    lastCompletedAt: job.lastCompletedAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    message: job.message,
    stallTimeoutMs: job.stallTimeoutMs,
  });
};

const getRunningWriteTagsJobForBook = (bookId: string) => {
  for (const job of writeTagsJobs.values()) {
    if (job.bookId === bookId && (job.status === "pending" || job.status === "running")) {
      return job;
    }
  }

  return null;
};

const scheduleWriteTagsJobCleanup = (jobId: string) => {
  setTimeout(() => {
    writeTagsJobs.delete(jobId);
  }, 10 * 60 * 1000).unref?.();
};

const runWriteTagsJob = async (jobId: string, bookId: string) => {
  const job = writeTagsJobs.get(jobId);
  if (!job) return;

  job.status = "running";
  touchWriteTagsJob(job);
  emitWriteTagsJobProgress(job);

  try {
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        author: true,
        series: true,
        audioFiles: { orderBy: { index: "asc" } },
      },
    });

    if (!book) {
      job.status = "failed";
      job.message = "Book not found";
      job.finishedAt = new Date().toISOString();
      touchWriteTagsJob(job);
      emitWriteTagsJobProgress(job);
      scheduleWriteTagsJobCleanup(jobId);
      return;
    }

    job.totalFiles = book.audioFiles.length;
    touchWriteTagsJob(job);
    emitWriteTagsJobProgress(job);

    const metadata = {
      title: book.title,
      author: book.author.name,
      subtitle: book.subtitle,
      narrator: book.narrator,
      series: book.series?.name,
      seriesSequence: book.sequence,
      description: book.description,
      publisher: book.publisher,
      year: book.year,
      genres: book.genres,
      coverPath: findCoverInFolder(book.folderPath),
    };

    for (const audioFile of book.audioFiles) {
      job.currentFile = audioFile.path;
      job.currentFileStartedAt = new Date().toISOString();
      touchWriteTagsJob(job);
      emitWriteTagsJobProgress(job);

      try {
        await embedMetadata(audioFile.path, metadata, {
          timeoutMs: configuredWriteTagsTimeoutMs ?? undefined,
        });
      } catch (err) {
        console.error(`Failed to embed metadata for ${audioFile.path}:`, err);
        job.failures.push({
          path: audioFile.path,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        job.processedFiles += 1;
        job.lastCompletedFile = audioFile.path;
        job.lastCompletedAt = new Date().toISOString();
        job.currentFile = null;
        job.currentFileStartedAt = null;
        touchWriteTagsJob(job);
        emitWriteTagsJobProgress(job);
      }
    }

    job.finishedAt = new Date().toISOString();

    if (job.totalFiles > 0 && job.failures.length === job.totalFiles) {
      job.status = "failed";
      job.message = job.failures[0]?.error || "Failed to write metadata to files";
    } else {
      job.status = "completed";
      job.message =
        job.failures.length > 0
          ? `Metadata written with ${job.failures.length} file failure(s). Refreshing database...`
          : "Metadata written successfully. Refreshing database...";
      touchWriteTagsJob(job);
      emitWriteTagsJobProgress(job);

      // Trigger a rescan to verify tags and update the database
      try {
        await rescanBook(bookId, true);
        if (job.failures.length > 0) {
          job.message = `Metadata written with ${job.failures.length} file failure(s) and verified.`;
        } else {
          job.message = "Metadata written and verified successfully";
        }
      } catch (rescanError) {
        console.error("Rescan after write-tags failed:", rescanError);
        job.message += " (Auto-refresh failed, please rescan manually)";
      }
    }
    touchWriteTagsJob(job);
    emitWriteTagsJobProgress(job);
  } catch (error) {
    console.error("Write metadata to file error:", error);
    job.status = "failed";
    job.currentFile = null;
    job.currentFileStartedAt = null;
    job.finishedAt = new Date().toISOString();
    job.message = "Failed to write metadata to files";
    touchWriteTagsJob(job);
    emitWriteTagsJobProgress(job);
  }

  scheduleWriteTagsJobCleanup(jobId);
};

export const writeBookMetadataToFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId },
      select: { id: true, title: true, audioFiles: { select: { id: true } } },
    });

    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    setLogTitle(book.title);

    const existingJob = getRunningWriteTagsJobForBook(bookId);
    if (existingJob) {
      res.status(202).json(existingJob);
      return;
    }

    const job: WriteTagsJob = {
      id: crypto.randomUUID(),
      bookId,
      bookTitle: book.title,
      status: "pending",
      totalFiles: book.audioFiles.length,
      processedFiles: 0,
      currentFile: null,
      currentFileStartedAt: null,
      lastCompletedFile: null,
      lastCompletedAt: null,
      failures: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
      message: null,
      stallTimeoutMs: configuredWriteTagsTimeoutMs ?? 0,
    };

    writeTagsJobs.set(job.id, job);
    emitWriteTagsJobProgress(job);
    void runWriteTagsJob(job.id, bookId);

    res.status(202).json(job);
  } catch (error) {
    console.error("Write metadata to file error:", error);
    res.status(500).json({ error: "Failed to write metadata to files" });
  }
};

export const listWriteTagsJobs = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const jobs = Array.from(writeTagsJobs.values())
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((job) => ({ ...job }));

    res.json({
      active: jobs.filter((job) => job.status === "pending" || job.status === "running"),
      recent: jobs,
    });
  } catch (error) {
    console.error("List write-tags jobs error:", error);
    res.status(500).json({ error: "Failed to load write-tags jobs" });
  }
};

export const getWriteTagsJobStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    const jobId = getSingleParam(req.params.jobId);

    if (!bookId || !jobId) {
      res.status(400).json({ error: "Invalid write-tags job id" });
      return;
    }

    const job = writeTagsJobs.get(jobId);
    if (!job || job.bookId !== bookId) {
      res.status(404).json({ error: "Write-tags job not found" });
      return;
    }

    res.json(job);
  } catch (error) {
    console.error("Get write-tags job status error:", error);
    res.status(500).json({ error: "Failed to load write-tags job status" });
  }
};

export const mergeBookFiles = async (req: AuthRequest, res: Response): Promise<void> => {
  let mergeBookId: string | null = null;
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }
    mergeBookId = bookId;

    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        audioFiles: { orderBy: { index: "asc" } },
        author: true,
        series: true,
      },
    });

    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    setLogTitle(book.title);

    if (book.audioFiles.length === 0) {
      res.status(400).json({ error: "Book has no audio files" });
      return;
    }

    const isSingleFileConversion =
      book.audioFiles.length === 1 &&
      !book.audioFiles[0].filename.toLowerCase().endsWith(".m4b");

    if (book.audioFiles.length === 1 && !isSingleFileConversion) {
      res.status(400).json({ error: "Book is already a single M4B file" });
      return;
    }

    const audioPaths = book.audioFiles.map((af) => af.path);
    const outputFileName = `${book.title.replace(/[/\\?%*:|"<>]/g, "-")}.m4b`;
    const operationLabel = isSingleFileConversion ? "conversion" : "merge";
    const emitStage = (status: "starting" | "running" | "completed" | "failed", progress: number, stage: string, detail?: string) =>
      emitMergeProgress({
        bookId: book.id,
        status,
        progress,
        stage,
        detail,
      });

    emitStage(
      "starting",
      5,
      isSingleFileConversion ? "Preparing conversion" : "Preparing merge",
      `${audioPaths.length} file${audioPaths.length === 1 ? "" : "s"} queued`,
    );

    // Perform merge
    emitStage(
      "running",
      20,
      isSingleFileConversion ? "Preparing conversion workspace" : "Preparing merge workspace",
      "Checking codecs and deciding the fastest M4B strategy",
    );
    const outputPath = await mergeToM4B(audioPaths, book.folderPath, outputFileName, {
      onStage: (stage, detail) => {
        if (stage === "staging") {
          emitStage(
            "running",
            30,
            isSingleFileConversion ? "Staging source file locally" : "Staging source files locally",
            detail,
          );
          return;
        }

        if (stage === "merging") {
          emitStage(
            "running",
            55,
            isSingleFileConversion ? "Converting audio file" : "Merging audio files",
            detail,
          );
          return;
        }

        emitStage(
          "running",
          68,
          isSingleFileConversion ? "Writing converted file back to library" : "Writing merged file back to library",
          detail,
        );
      },
    });

    // Embed metadata into the new file
    emitStage("running", 70, "Embedding metadata", "Applying title, author, and cover information");
    try {
      await embedMetadata(outputPath, {
        title: book.title,
        author: book.author.name,
        subtitle: book.subtitle,
        series: book.series?.name,
        seriesSequence: book.sequence || undefined,
        description: book.description,
        publisher: book.publisher || undefined,
        year: book.year || undefined,
        genres: book.genres || undefined,
        coverPath: findCoverInFolder(book.folderPath) ?? undefined,
      });
    } catch (embedError) {
      console.error("Failed to embed metadata after merge:", embedError);
      // Continue anyway, the merge succeeded
    }

    // Move old files to backup folder
    emitStage(
      "running",
      85,
      "Archiving original files",
      `Moving source file${book.audioFiles.length === 1 ? "" : "s"} into .merged-backup`,
    );
    const backupDir = path.join(book.folderPath, ".merged-backup");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    for (const af of book.audioFiles) {
      const oldPath = af.path;
      const newPath = path.join(backupDir, path.basename(oldPath));
      if (fs.existsSync(oldPath)) {
        try {
          fs.renameSync(oldPath, newPath);
        } catch (renameError) {
          console.error(`Failed to move ${oldPath} to backup:`, renameError);
        }
      }
    }

    // Update DB
    emitStage("running", 95, "Updating library records", "Switching the book to the merged file");
    await prisma.audioFile.deleteMany({ where: { bookId: book.id } });

    await prisma.audioFile.create({
      data: {
        filename: outputFileName,
        path: outputPath,
        duration: book.duration,
        index: 0,
        bookId: book.id,
      },
    });

    adminLogger.info("Book files merged into M4B", {
      bookId: book.id,
      title: book.title,
      fileCount: audioPaths.length,
      outputPath,
      operation: operationLabel,
    });

    emitStage(
      "completed",
      100,
      isSingleFileConversion ? "Conversion complete" : "Merge complete",
      path.basename(outputPath),
    );
    res.json({
      message: isSingleFileConversion ? "Conversion successful" : "Merge successful",
      path: outputPath,
      operation: operationLabel,
    });
  } catch (error) {
    console.error("Merge book files error:", error);
    if (mergeBookId) {
      emitMergeProgress({
        bookId: mergeBookId,
        status: "failed",
        progress: 100,
        stage: "Merge failed",
        detail: error instanceof Error ? error.message : "Failed to merge files",
      });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to merge files" });
  }
};

export const undoMergeBookFiles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: { audioFiles: true },
    });

    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    const backupDir = path.join(book.folderPath, ".merged-backup");
    if (!fs.existsSync(backupDir)) {
      res.status(400).json({ error: "No backup found for this book" });
      return;
    }

    // Restore files
    const backupFiles = fs.readdirSync(backupDir);
    if (backupFiles.length === 0) {
      res.status(400).json({ error: "Backup folder is empty" });
      return;
    }

    for (const filename of backupFiles) {
      const oldPath = path.join(backupDir, filename);
      const newPath = path.join(book.folderPath, filename);
      try {
        fs.renameSync(oldPath, newPath);
      } catch (renameError) {
        console.error(`Failed to restore ${filename}:`, renameError);
      }
    }

    // Delete the merged file(s) that were there
    for (const af of book.audioFiles) {
      if (fs.existsSync(af.path) && !af.path.includes(".merged-backup")) {
        try {
          fs.rmSync(af.path, { force: true });
        } catch (rmError) {
          console.error(`Failed to remove merged file ${af.path}:`, rmError);
        }
      }
    }

    // Clean up backup dir
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (rmDirError) {
      console.error("Failed to remove backup directory:", rmDirError);
    }

    adminLogger.info("Book merge undone", {
      bookId: book.id,
      title: book.title,
      restoredFileCount: backupFiles.length,
    });

    res.json({ message: "Merge undone. Please rescan your library to update metadata." });
  } catch (error) {
    console.error("Undo merge error:", error);
    res.status(500).json({ error: "Failed to undo merge" });
  }
};

export const getBookHasBackup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId },
      select: { folderPath: true },
    });

    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    const backupDir = path.join(book.folderPath, ".merged-backup");
    res.json({ hasBackup: fs.existsSync(backupDir) });
  } catch (error) {
    console.error("Check backup failed:", error);
    res.status(500).json({ error: "Check backup failed" });
  }
};

export const cleanupMergedBackupsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bookId = getSingleParam(req.params.bookId);
    if (!bookId) {
      res.status(400).json({ error: "Invalid book id" });
      return;
    }

    const book = await prisma.book.findUnique({
      where: { id: bookId },
      select: { folderPath: true },
    });

    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    const backupDir = path.join(book.folderPath, ".merged-backup");
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
      res.json({ message: "Backup folder deleted successfully" });
    } else {
      res.status(404).json({ error: "No backup folder found" });
    }
  } catch (error) {
    console.error("Cleanup backup error:", error);
    res.status(500).json({ error: "Failed to cleanup backup folder" });
  }
};
