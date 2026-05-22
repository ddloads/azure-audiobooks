import prisma from "../../lib/prisma";
import fs from "fs";
import path from "path";
import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import { createLogger } from "../../lib/logger";
import { backupDatabase } from "../../utils/backup";
import {
  getActiveMergeTasks,
  getActiveScanTask,
} from "../../lib/socket";
import { writeTagsJobs } from "./adminFileController";

const backupRoot = path.join(process.cwd(), "data", "backups");
const adminLogger = createLogger("admin");

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
        select: { id: true, username: true, email: true, role: true, createdAt: true },
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
