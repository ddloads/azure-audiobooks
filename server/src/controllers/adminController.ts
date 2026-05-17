import { execFile } from "child_process";
import { promisify } from "util";
import { Response } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const execFileAsync = promisify(execFile);
import prisma from "../lib/prisma";
import {
  emitMergeProgress,
  emitWriteTagsProgress,
  getActiveMergeTasks,
  getActiveScanTask,
} from "../lib/socket";
import { AuthRequest } from "../middleware/authMiddleware";
import { requestLibraryScan } from "../lib/scanJobPool";
import { backupDatabase } from "../utils/backup";
import {
  normalizeSourcePath,
} from "../utils/libraryConfig";
import { searchAudible } from "../utils/audible";
import {
  clearStoredActiveAudibleProfile,
  deleteAudibleCliProfile,
  getAudibleCliStatus,
  getAudibleConfigDir,
  isAudibleCliAvailable,
  listAudibleCliProfiles,
  renameAudibleCliProfile,
  sanitizeAudibleProfileName,
  searchAudibleCli,
  setStoredActiveAudibleProfile,
} from "../utils/audibleCli";
import { searchGoogleBooks } from "../utils/googleBooks";
import { searchGoodreads } from "../utils/goodreads";
import { downloadCover, findCoverInFolder, getCoverUrl, normalizeCoverPath } from "../utils/covers";
import { embedMetadata, mergeToM4B } from "../utils/processor";
import { rescanBook } from "../utils/scanner";
import { invalidateFilterOptionsCache } from "./libraryController";
import { findUserByUsernameInsensitive, sanitizeUsername } from "../utils/usernames";
import { createLogger } from "../lib/logger";
import { booksArePotentialDuplicates, findDuplicateGroups } from "../utils/duplicates";

const backupRoot = path.join(process.cwd(), "data", "backups");
const adminLogger = createLogger("admin");

type WriteTagsJobStatus = "pending" | "running" | "completed" | "failed";

type WriteTagsJob = {
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

const writeTagsJobs = new Map<string, WriteTagsJob>();
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
          ? `Metadata written with ${job.failures.length} file failure(s)`
          : "Metadata written to files successfully";
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

const getBackupEntries = () => {
  if (!fs.existsSync(backupRoot)) {
    return [];
  }

  return fs
    .readdirSync(backupRoot)
    .map((name) => {
      const filePath = path.join(backupRoot, name);
      const stat = fs.statSync(filePath);
      return {
        name,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

const getSingleParam = (value: string | string[] | undefined): string | null =>
  typeof value === "string" ? value : null;

const getSingleBodyValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const getOptionalBodyValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value.trim() : undefined;

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const parseAsinValue = (value: string | null | undefined) =>
  value?.match(/\bASIN[:\s-]*([A-Z0-9]{10})\b/i)?.[1]?.toUpperCase() ?? null;

const parseMetadataProvider = (value: unknown) => {
  if (value === "google") return "google";
  if (value === "goodreads") return "goodreads";
  if (value === "combined") return "combined";
  return "audible";
};

type MetadataProvider = ReturnType<typeof parseMetadataProvider>;

const toNullableString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toNullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

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

const pathBelongsToRoot = (folderPath: string, rootPath: string) => {
  const normalizedFolder = normalizeSourcePath(folderPath);
  const normalizedRoot = normalizeSourcePath(rootPath);
  const relative = path.relative(normalizedRoot, normalizedFolder);

  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const validateLibrarySourcePath = (inputPath: string) => {
  const resolvedPath = normalizeSourcePath(inputPath);

  if (!fs.existsSync(resolvedPath)) {
    return { error: "Assigned path does not exist", resolvedPath };
  }

  if (!fs.statSync(resolvedPath).isDirectory()) {
    return { error: "Assigned path must be a folder", resolvedPath };
  }

  return { error: null, resolvedPath };
};

const getAvailableRoots = () => {
  if (process.platform === "win32") {
    return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
      .filter((rootPath) => {
        try {
          return fs.existsSync(rootPath) && fs.statSync(rootPath).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.localeCompare(b));
  }

  return [path.parse(process.cwd()).root];
};

const getParentFolder = (folderPath: string) => {
  const normalizedPath = normalizeSourcePath(folderPath);
  const parentPath = path.dirname(normalizedPath);
  return parentPath === normalizedPath ? null : parentPath;
};

export const browseLibraryFolders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawPath = typeof req.query.path === "string" ? req.query.path : null;
    const requestedPath = rawPath?.trim() || null;
    const roots = getAvailableRoots();

    if (!requestedPath) {
      res.json({
        roots,
        currentPath: null,
        parentPath: null,
        directories: [],
      });
      return;
    }

    const normalizedPath = normalizeSourcePath(requestedPath);
    if (!fs.existsSync(normalizedPath)) {
      res.status(400).json({ error: "Folder does not exist" });
      return;
    }

    if (!fs.statSync(normalizedPath).isDirectory()) {
      res.status(400).json({ error: "Selected path is not a folder" });
      return;
    }

    const directories = fs
      .readdirSync(normalizedPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(normalizedPath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      roots,
      currentPath: normalizedPath,
      parentPath: getParentFolder(normalizedPath),
      directories,
    });
  } catch (error) {
    console.error("Browse library folders error:", error);
    res.status(500).json({ error: "Failed to browse folders" });
  }
};

export const getAdminDashboard = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [
      userCount,
      adminCount,
      libraryCount,
      sourceCount,
      bookCount,
      authorCount,
      seriesCount,
      audioFileCount,
      totalDurationResult,
      recentUsers,
      recentBooks,
      libraries,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "ADMIN" } }),
      prisma.library.count(),
      prisma.librarySource.count(),
      prisma.book.count(),
      prisma.author.count(),
      prisma.series.count(),
      prisma.audioFile.count(),
      prisma.book.aggregate({ _sum: { duration: true } }),
      prisma.user.findMany({
        select: { id: true, username: true, role: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.book.findMany({
        select: {
          id: true,
          title: true,
          duration: true,
          createdAt: true,
          author: { select: { name: true } },
          library: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.library.findMany({
        select: {
          id: true,
          name: true,
          _count: {
            select: {
              books: true,
              sources: true,
            },
          },
        },
        orderBy: { name: "asc" },
      }),
    ]);

    res.json({
      stats: {
        users: userCount,
        admins: adminCount,
        libraries: libraryCount,
        sources: sourceCount,
        books: bookCount,
        authors: authorCount,
        series: seriesCount,
        audioFiles: audioFileCount,
        totalDuration: totalDurationResult._sum.duration ?? 0,
      },
      library: {
        coversRoot: "in-book-folder",
        libraries,
      },
      backups: getBackupEntries(),
      recentUsers,
      recentBooks,
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    res.status(500).json({ error: "Failed to load admin dashboard" });
  }
};

export const listUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { progress: true } },
      },
      orderBy: [{ role: "asc" }, { username: "asc" }],
    });

    res.json(users);
  } catch (error) {
    console.error("List users error:", error);
    res.status(500).json({ error: "Failed to load users" });
  }
};

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { password, role } = req.body as {
      password?: string;
      role?: string;
    };
    const username = sanitizeUsername(req.body?.username);

    if (!username || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const normalizedRole = role === "ADMIN" ? "ADMIN" : "USER";
    const existingUser = await findUserByUsernameInsensitive(username);
    if (existingUser) {
      res.status(400).json({ error: "Username already exists" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: normalizedRole,
      },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json(user);
    adminLogger.info("User created", {
      targetUserId: user.id,
      username: user.username,
      role: user.role,
    });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
};

export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getSingleParam(req.params.userId);
    if (!userId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const { role, password } = req.body as { role?: string; password?: string };
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const data: { role?: string; password?: string } = {};

    if (role) {
      const normalizedRole = role === "ADMIN" ? "ADMIN" : "USER";
      if (user.role === "ADMIN" && normalizedRole !== "ADMIN") {
        const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
        if (adminCount <= 1) {
          res.status(400).json({ error: "At least one admin account is required" });
          return;
        }
      }

      data.role = normalizedRole;
    }

    if (password) {
      data.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(updatedUser);
    adminLogger.info("User updated", {
      targetUserId: updatedUser.id,
      username: updatedUser.username,
      role: updatedUser.role,
      passwordChanged: Boolean(password),
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = getSingleParam(req.params.userId);
    if (!userId) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    if (req.user?.userId === userId) {
      res.status(400).json({ error: "You cannot delete your own account" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (user.role === "ADMIN") {
      const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        res.status(400).json({ error: "At least one admin account is required" });
        return;
      }
    }

    await prisma.user.delete({ where: { id: userId } });
    adminLogger.warn("User deleted", {
      targetUserId: user.id,
      username: user.username,
      role: user.role,
    });
    res.status(204).send();
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
};

export const listLibraries = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraries = await prisma.library.findMany({
      include: {
        sources: {
          orderBy: [{ isWritable: "desc" }, { createdAt: "asc" }],
        },
        _count: {
          select: {
            books: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    res.json(libraries);
  } catch (error) {
    console.error("List libraries error:", error);
    res.status(500).json({ error: "Failed to load libraries" });
  }
};

export const createLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const name = getSingleBodyValue(req.body.name);
    const description = getSingleBodyValue(req.body.description);

    if (!name) {
      res.status(400).json({ error: "Library name is required" });
      return;
    }

    const existingLibrary = await prisma.library.findUnique({ where: { name } });
    if (existingLibrary) {
      res.status(400).json({ error: "Library name already exists" });
      return;
    }

    const library = await prisma.library.create({
      data: {
        name,
        description: description || null,
      },
      include: {
        sources: true,
        _count: {
          select: {
            books: true,
          },
        },
      },
    });

    res.status(201).json(library);
    adminLogger.info("Library created", {
      libraryId: library.id,
      name: library.name,
    });
  } catch (error) {
    console.error("Create library error:", error);
    res.status(500).json({ error: "Failed to create library" });
  }
};

export const updateLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const existingLibrary = await prisma.library.findUnique({ where: { id: libraryId } });
    if (!existingLibrary) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    const name = getSingleBodyValue(req.body.name);
    const description =
      typeof req.body.description === "string" ? req.body.description.trim() : undefined;
    const isActive = isBoolean(req.body.isActive) ? req.body.isActive : undefined;
    const folderPatternRaw =
      typeof req.body.folderPattern === "string" ? req.body.folderPattern.trim() : undefined;

    if (name && name !== existingLibrary.name) {
      const duplicate = await prisma.library.findUnique({ where: { name } });
      if (duplicate) {
        res.status(400).json({ error: "Library name already exists" });
        return;
      }
    }

    const library = await prisma.library.update({
      where: { id: libraryId },
      data: {
        name: name || undefined,
        description: description === undefined ? undefined : description || null,
        isActive,
        folderPattern: folderPatternRaw === undefined ? undefined : folderPatternRaw || null,
      },
      include: {
        sources: true,
        _count: {
          select: {
            books: true,
          },
        },
      },
    });

    res.json(library);
    adminLogger.info("Library updated", {
      libraryId: library.id,
      name: library.name,
      isActive: library.isActive,
    });
  } catch (error) {
    console.error("Update library error:", error);
    res.status(500).json({ error: "Failed to update library" });
  }
};

export const deleteLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            books: true,
          },
        },
      },
    });

    if (!library) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    if (library._count.books > 0) {
      res.status(400).json({ error: "Delete or move this library's books before removing it" });
      return;
    }

    await prisma.library.delete({ where: { id: libraryId } });
    adminLogger.warn("Library deleted", {
      libraryId: library.id,
      name: library.name,
    });
    res.status(204).send();
  } catch (error) {
    console.error("Delete library error:", error);
    res.status(500).json({ error: "Failed to delete library" });
  }
};

export const purgeLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            books: true,
            sources: true,
          },
        },
      },
    });

    if (!library) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    const purgeResult = await prisma.book.deleteMany({
      where: { libraryId },
    });

    adminLogger.warn("Library purged", {
      libraryId: library.id,
      name: library.name,
      deletedBooks: purgeResult.count,
      retainedSources: library._count.sources,
    });

    res.json({
      message: `Purged ${purgeResult.count} books from ${library.name}`,
      deletedBooks: purgeResult.count,
      library: {
        id: library.id,
        name: library.name,
      },
    });
  } catch (error) {
    console.error("Purge library error:", error);
    res.status(500).json({ error: "Failed to purge library" });
  }
};

export const createLibrarySource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const library = await prisma.library.findUnique({ where: { id: libraryId } });
    if (!library) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    const inputPath = getSingleBodyValue(req.body.path);
    const label = getSingleBodyValue(req.body.label);
    const kind = getSingleBodyValue(req.body.kind) || "LOCAL";
    const isWritable = isBoolean(req.body.isWritable) ? req.body.isWritable : false;
    const isEnabled = isBoolean(req.body.isEnabled) ? req.body.isEnabled : true;

    if (!inputPath) {
      res.status(400).json({ error: "Source path is required" });
      return;
    }

    const validation = validateLibrarySourcePath(inputPath);
    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const source = await prisma.librarySource.create({
      data: {
        libraryId,
        label: label || null,
        path: validation.resolvedPath,
        kind,
        isWritable,
        isEnabled,
      },
    });

    res.status(201).json(source);
    adminLogger.info("Library source created", {
      sourceId: source.id,
      libraryId: source.libraryId,
      path: source.path,
      kind: source.kind,
      isWritable: source.isWritable,
      isEnabled: source.isEnabled,
    });
  } catch (error) {
    console.error("Create library source error:", error);
    res.status(500).json({ error: "Failed to create source path" });
  }
};

export const updateLibrarySource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sourceId = getSingleParam(req.params.sourceId);
    if (!sourceId) {
      res.status(400).json({ error: "Invalid source id" });
      return;
    }

    const source = await prisma.librarySource.findUnique({ where: { id: sourceId } });
    if (!source) {
      res.status(404).json({ error: "Source path not found" });
      return;
    }

    const inputPath = getSingleBodyValue(req.body.path);
    const label =
      typeof req.body.label === "string" ? req.body.label.trim() : undefined;
    const kind = getSingleBodyValue(req.body.kind);
    const isWritable = isBoolean(req.body.isWritable) ? req.body.isWritable : undefined;
    const isEnabled = isBoolean(req.body.isEnabled) ? req.body.isEnabled : undefined;

    let normalizedPath: string | undefined;
    if (inputPath) {
      const validation = validateLibrarySourcePath(inputPath);
      if (validation.error) {
        res.status(400).json({ error: validation.error });
        return;
      }

      normalizedPath = validation.resolvedPath;
    }

    const updatedSource = await prisma.librarySource.update({
      where: { id: sourceId },
      data: {
        label: label === undefined ? undefined : label || null,
        path: normalizedPath,
        kind: kind || undefined,
        isWritable,
        isEnabled,
      },
    });

    res.json(updatedSource);
    adminLogger.info("Library source updated", {
      sourceId: updatedSource.id,
      libraryId: updatedSource.libraryId,
      path: updatedSource.path,
      kind: updatedSource.kind,
      isWritable: updatedSource.isWritable,
      isEnabled: updatedSource.isEnabled,
    });
  } catch (error) {
    console.error("Update library source error:", error);
    res.status(500).json({ error: "Failed to update source path" });
  }
};

export const deleteLibrarySource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sourceId = getSingleParam(req.params.sourceId);
    if (!sourceId) {
      res.status(400).json({ error: "Invalid source id" });
      return;
    }

    const source = await prisma.librarySource.findUnique({ where: { id: sourceId } });
    if (!source) {
      res.status(404).json({ error: "Source path not found" });
      return;
    }

    const librarySourceCount = await prisma.librarySource.count({
      where: { libraryId: source.libraryId },
    });

    if (librarySourceCount <= 1) {
      res.status(400).json({ error: "Each library must keep at least one source path" });
      return;
    }

    await prisma.librarySource.delete({ where: { id: sourceId } });
    adminLogger.warn("Library source deleted", {
      sourceId: source.id,
      libraryId: source.libraryId,
      path: source.path,
    });
    res.status(204).send();
  } catch (error) {
    console.error("Delete library source error:", error);
    res.status(500).json({ error: "Failed to delete source path" });
  }
};

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

    // Trigger a rescan of just this book's folder to restore DB state correctly
    // Since we don't have a built-in 'rescan folder' that works efficiently for one book easily,
    // we'll just tell the user to rescan or we could try to re-run the scanner logic here.
    // For now, let's just return success and advise a rescan.
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
        const allBooks = [primaryBookId, ...secondaryBookIds];
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
    const provider = parseMetadataProvider(req.body?.provider);

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
        searchGoogleBooks(query, author),
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
      candidates = await searchGoogleBooks(query, author);
    } else {
      candidates = await searchGoodreads(query, author);
    }

    res.json({
      provider,
      query,
      author,
      candidates,
    });
  } catch (error) {
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
  duration: number | null;
  author: { name: string };
};

const findBookMatchCandidates = async (
  book: MatchSearchBook,
  provider: MetadataProvider,
  queryOverride?: string | null,
  authorOverride?: string | null,
) => {
  const query = queryOverride || book.asin || parseAsinValue(book.description) || book.title;
  const author = authorOverride || book.author.name;
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
      searchGoogleBooks(query, author),
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

    return { provider, query, author, candidates };
  }

  const candidates = provider === "audible"
    ? await loadAudibleCandidates()
    : provider === "google"
      ? await searchGoogleBooks(query, author)
      : await searchGoodreads(query, author);

  return { provider, query, author, candidates };
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
  book: { id: string; folderPath: string; tags: string | null },
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

  return prisma.book.update({
    where: { id: book.id },
    data: updateData,
    include: {
      author: true,
      series: true,
      library: true,
      audioFiles: { orderBy: { index: "asc" } },
    },
  });
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
        const searchResult = await findBookMatchCandidates(book, provider);
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
    console.error("Update book metadata error:", error);
    if (error?.code === "P2002") {
      res.status(400).json({ error: "That metadata would duplicate an existing book title/author entry" });
      return;
    }
    res.status(500).json({ error: "Failed to update book metadata" });
    }
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

export const listAdminTasks = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const writeTagTasks = Array.from(writeTagsJobs.values())
      .filter((job) => job.status === "pending" || job.status === "running")
      .map((job) => ({
        id: job.id,
        type: "write-tags" as const,
        status: job.status,
        title: job.bookTitle || "Untitled book",
        progress: job.totalFiles > 0 ? Math.round((job.processedFiles / job.totalFiles) * 100) : 0,
        detail:
          job.currentFile?.split(/[/\\]/).pop() ||
          job.message ||
          `${job.processedFiles}/${job.totalFiles} files`,
        startedAt: job.startedAt,
        updatedAt: job.updatedAt,
      }));

    const scanTask = getActiveScanTask();
    const scanTasks = scanTask
      ? [
          {
            id: `scan-${scanTask.libraryId || "all"}`,
            type: "scan" as const,
            status: scanTask.status,
            title: scanTask.libraryId ? "Library scan" : "Full library scan",
            progress: scanTask.progress,
            detail:
              scanTask.currentFolder ||
              (scanTask.totalFolders
                ? `${scanTask.scannedFolders || 0}/${scanTask.totalFolders} folders`
                : "Preparing scan"),
            startedAt: scanTask.startedAt,
            updatedAt: scanTask.updatedAt,
          },
        ]
      : [];

    const mergeTasks = getActiveMergeTasks().map((task) => ({
      id: `merge-${task.bookId}`,
      type: "merge" as const,
      status: task.status,
      title: "Merge to M4B",
      progress: task.progress,
      detail: task.detail || task.stage,
      stage: task.stage,
      startedAt: task.startedAt,
      updatedAt: task.updatedAt,
      bookId: task.bookId,
    }));

    res.json({
      active: [...scanTasks, ...mergeTasks, ...writeTagTasks].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    });
  } catch (error) {
    console.error("List admin tasks error:", error);
    res.status(500).json({ error: "Failed to load active tasks" });
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

export const getAudibleCliStatusHandler = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = await getAudibleCliStatus();
    res.json(status);
  } catch (error) {
    console.error("Get audible-cli status error:", error);
    res.status(500).json({ error: "Failed to check audible-cli status" });
  }
};

const AUDIBLE_AUTH_STATE_DIR = path.join(process.cwd(), "data", "temp", "audible-auth");
const SCRIPTS_DIR = path.join(process.cwd(), "scripts");

const VALID_MARKETPLACES = new Set(["us", "uk", "de", "fr", "ca", "it", "au", "in", "jp", "es"]);
const AUDIBLE_AUTH_TOKEN_PATTERN = /^[a-f0-9-]{36}$/i;

const getAudibleAuthStateFile = (authToken: string) =>
  path.join(AUDIBLE_AUTH_STATE_DIR, `${authToken}.json`);

const getAudibleProfileName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const sanitized = sanitizeAudibleProfileName(value);
  return sanitized || null;
};

const resolvePythonExe = async (): Promise<string> => {
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      await execFileAsync(cmd, ["--version"], { timeout: 5_000, windowsHide: true });
      return cmd;
    } catch {
      // try next
    }
  }
  return candidates[0];
};

const runPythonScript = async (script: string, args: string[]): Promise<Record<string, unknown>> => {
  const python = await resolvePythonExe();
  try {
    const { stdout } = await execFileAsync(python, [script, ...args], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch (err: any) {
    if (err.stdout) {
      try {
        return JSON.parse((err.stdout as string).trim()) as Record<string, unknown>;
      } catch {
        // stdout wasn't JSON — fall through to re-throw
      }
    }
    throw err;
  }
};

export const startAudibleCliAuth = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const marketplace = getSingleBodyValue(req.body?.marketplace) ?? "us";
    const profileName = getAudibleProfileName(req.body?.profileName);
    if (!VALID_MARKETPLACES.has(marketplace)) {
      res.status(400).json({ error: "Invalid marketplace code" });
      return;
    }
    if (!profileName) {
      res.status(400).json({ error: "Profile name is required" });
      return;
    }

    const scriptPath = path.join(SCRIPTS_DIR, "audible_auth_get_url.py");
    if (!fs.existsSync(scriptPath)) {
      res.status(500).json({ error: "Auth script not found on server" });
      return;
    }

    if (!fs.existsSync(AUDIBLE_AUTH_STATE_DIR)) {
      fs.mkdirSync(AUDIBLE_AUTH_STATE_DIR, { recursive: true });
    }
    const authToken = crypto.randomUUID();
    const stateFile = getAudibleAuthStateFile(authToken);

    const result = await runPythonScript(scriptPath, [stateFile, marketplace, profileName]);

    if (!result.ok) {
      res.status(500).json({ error: result.error ?? "Failed to generate login URL" });
      return;
    }

    res.json({ url: result.url, marketplace, profileName, authToken });
  } catch (error) {
    console.error("Start audible-cli auth error:", error);
    res.status(500).json({ error: "Failed to start authentication" });
  }
};

export const completeAudibleCliAuth = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const redirectUrl = getSingleBodyValue(req.body?.redirectUrl);
    const authToken = getSingleBodyValue(req.body?.authToken);
    const profileName = getAudibleProfileName(req.body?.profileName);
    if (!redirectUrl) {
      res.status(400).json({ error: "Redirect URL is required" });
      return;
    }
    if (!authToken || !AUDIBLE_AUTH_TOKEN_PATTERN.test(authToken)) {
      res.status(400).json({ error: "Auth session token is required" });
      return;
    }
    if (!profileName) {
      res.status(400).json({ error: "Profile name is required" });
      return;
    }

    const stateFile = getAudibleAuthStateFile(authToken);
    if (!fs.existsSync(stateFile)) {
      res.status(400).json({ error: "No pending authentication session found. Please start over." });
      return;
    }

    const scriptPath = path.join(SCRIPTS_DIR, "audible_auth_complete.py");
    if (!fs.existsSync(scriptPath)) {
      res.status(500).json({ error: "Auth script not found on server" });
      return;
    }

    const configDir = getAudibleConfigDir();
    const outputFile = path.join(configDir, `${profileName}.json`);

    const result = await runPythonScript(scriptPath, [stateFile, redirectUrl, outputFile]);

    if (!result.ok) {
      res.status(400).json({ error: result.error ?? "Failed to complete authentication" });
      return;
    }

    setStoredActiveAudibleProfile(profileName);
    res.json({ ok: true, file: result.file, profileName });
  } catch (error) {
    console.error("Complete audible-cli auth error:", error);
    res.status(500).json({ error: "Failed to complete authentication" });
  }
};

export const setActiveAudibleCliProfileHandler = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const profileName = getAudibleProfileName(req.body?.profileName);
    if (!profileName) {
      clearStoredActiveAudibleProfile();
      res.json({ ok: true, activeProfile: null });
      return;
    }

    const exists = listAudibleCliProfiles().some((profile) => profile.name === profileName);
    if (!exists) {
      res.status(404).json({ error: "Audible profile not found" });
      return;
    }

    setStoredActiveAudibleProfile(profileName);
    res.json({ ok: true, activeProfile: profileName });
  } catch (error) {
    console.error("Set active audible-cli profile error:", error);
    res.status(500).json({ error: "Failed to set active profile" });
  }
};

export const deleteAudibleCliProfileHandler = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const profileName = getAudibleProfileName(req.params.profileName);
    if (!profileName) {
      res.status(400).json({ error: "Invalid profile name" });
      return;
    }

    const deleted = deleteAudibleCliProfile(profileName);
    if (!deleted) {
      res.status(404).json({ error: "Audible profile not found" });
      return;
    }

    const status = await getAudibleCliStatus();
    res.json({ ok: true, ...status });
  } catch (error) {
    console.error("Delete audible-cli profile error:", error);
    res.status(500).json({ error: "Failed to delete Audible profile" });
  }
};

export const renameAudibleCliProfileHandler = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const profileName = getAudibleProfileName(req.params.profileName);
    const nextProfileName = getAudibleProfileName(req.body?.profileName);

    if (!profileName || !nextProfileName) {
      res.status(400).json({ error: "Current and new profile names are required" });
      return;
    }

    const result = renameAudibleCliProfile(profileName, nextProfileName);
    if (!result.ok) {
      res.status(result.error === "Audible profile not found" ? 404 : 400).json({
        error: result.error ?? "Failed to rename Audible profile",
      });
      return;
    }

    const status = await getAudibleCliStatus();
    res.json({ ok: true, ...status });
  } catch (error) {
    console.error("Rename audible-cli profile error:", error);
    res.status(500).json({ error: "Failed to rename Audible profile" });
  }
};

export const rescanLibrary = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scanRequest = requestLibraryScan();
    adminLogger.info("Full library rescan requested", {
      status: scanRequest.status,
    });
    res.status(202).json({ message: scanRequest.message, status: scanRequest.status });
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

    const scanRequest = requestLibraryScan(libraryId);
    adminLogger.info("Single library rescan requested", {
      libraryId: library.id,
      name: library.name,
      status: scanRequest.status,
    });
    res.status(202).json({
      message:
        scanRequest.status === "queued" ? `${library.name} scan queued` : `${library.name} scan started`,
      status: scanRequest.status,
    });
  } catch (error) {
    console.error("Rescan single library error:", error);
    res.status(500).json({ error: "Failed to rescan library" });
  }
};

export const listBackups = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json(getBackupEntries());
  } catch (error) {
    console.error("List backups error:", error);
    res.status(500).json({ error: "Failed to load backups" });
  }
};

export const createBackup = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const backupPath = backupDatabase();
    if (!backupPath) {
      res.status(500).json({ error: "Database backup failed" });
      return;
    }

    adminLogger.info("Backup created", {
      file: path.basename(backupPath),
    });

    res.status(201).json({
      message: "Backup created",
      file: path.basename(backupPath),
      backups: getBackupEntries(),
    });
  } catch (error) {
    console.error("Create backup error:", error);
    res.status(500).json({ error: "Failed to create backup" });
  }
};

// ── Library structure check ──────────────────────────────────────────────────

const checkSegmentMatch = (actual: string, patternSeg: string): boolean => {
  const literals = patternSeg.split(/\{[^}]+\}/).filter((s) => s.length > 0);
  if (literals.length === 0) return true;
  let pos = 0;
  for (const literal of literals) {
    const idx = actual.toLowerCase().indexOf(literal.toLowerCase(), pos);
    if (idx === -1) return false;
    pos = idx + literal.length;
  }
  return true;
};

const matchesPattern = (
  folderPath: string,
  sourceRoots: string[],
  pattern: string,
): boolean => {
  const normFolder = folderPath.replace(/\\/g, "/");
  const normFolderLower = normFolder.toLowerCase();

  let relPath: string | null = null;
  for (const root of sourceRoots) {
    const normRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
    const normRootLower = normRoot.toLowerCase();
    if (normFolderLower.startsWith(normRootLower + "/")) {
      relPath = normFolder.slice(normRoot.length + 1);
      break;
    } else if (normFolderLower === normRootLower) {
      relPath = "";
      break;
    }
  }

  if (relPath === null) return false;

  const relSegs = relPath.split("/").filter(Boolean);
  const patSegs = pattern.replace(/\\/g, "/").split("/");

  if (relSegs.length !== patSegs.length) return false;

  return relSegs.every((seg, i) => checkSegmentMatch(seg, patSegs[i]));
};

export const checkLibraryStructure = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      include: { sources: { select: { path: true } } },
    });

    if (!library) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    if (!library.folderPattern) {
      res.status(400).json({ error: "No folder pattern configured for this library" });
      return;
    }

    const books = await prisma.book.findMany({
      where: { libraryId },
      select: {
        id: true,
        title: true,
        folderPath: true,
        author: { select: { name: true } },
      },
      orderBy: { title: "asc" },
    });

    const sourceRoots = library.sources.map((s) => s.path);
    const { folderPattern } = library;

    const nonConforming = books
      .filter((book) => !matchesPattern(book.folderPath, sourceRoots, folderPattern))
      .map((book) => ({
        id: book.id,
        title: book.title,
        author: book.author.name,
        folderPath: book.folderPath,
      }));

    res.json({
      pattern: folderPattern,
      total: books.length,
      conforming: books.length - nonConforming.length,
      nonConforming,
    });
  } catch (error) {
    console.error("Check library structure error:", error);
    res.status(500).json({ error: "Failed to check library structure" });
  }
};
