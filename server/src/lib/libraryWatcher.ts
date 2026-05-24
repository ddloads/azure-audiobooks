import fs from "fs";
import path from "path";
import prisma from "./prisma";
import { createLogger } from "./logger";
import { requestLibraryScan } from "./scanJobPool";
import { normalizeSourcePath } from "../utils/libraryConfig";

const logger = createLogger("watcher");

type LibrarySourceWatcher = {
  close: () => Promise<void> | void;
  on: (eventName: string, listener: (...args: unknown[]) => void) => LibrarySourceWatcher;
};

const WATCH_DEBOUNCE_MS = Number.parseInt(process.env.WATCH_FOLDER_DEBOUNCE_MS || "", 10) || 15000;
const WATCH_FOLDERS_ENABLED = process.env.WATCH_FOLDERS_ENABLED !== "false";
const WATCH_FOLDER_USE_POLLING = process.env.WATCH_FOLDER_USE_POLLING !== "false";
const WATCH_FOLDER_POLL_INTERVAL_MS =
  Number.parseInt(process.env.WATCH_FOLDER_POLL_INTERVAL_MS || "", 10) || 5000;
const WATCHED_EVENTS = new Set(["add", "change", "unlink", "addDir", "unlinkDir"]);
const WATCH_FOLDER_RECONCILE_MS =
  Number.parseInt(process.env.WATCH_FOLDER_RECONCILE_MS || "", 10) || 30000;

let watchers: LibrarySourceWatcher[] = [];
const reconcileTimers = new Map<string, NodeJS.Timeout>();
const lastSourceSignatures = new Map<string, string>();
const pendingScans = new Map<string, NodeJS.Timeout>();
let refreshPromise: Promise<void> | null = null;

const getSourceSignature = (sourcePath: string) => {
  if (!fs.existsSync(sourcePath)) {
    return "missing";
  }

  const stack = [sourcePath];
  let fileCount = 0;
  let dirCount = 0;
  let totalBytes = 0;
  let maxMtime = 0;

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir || !fs.existsSync(currentDir)) {
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(currentDir);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) {
      fileCount++;
      totalBytes += stat.size;
      maxMtime = Math.max(maxMtime, stat.mtimeMs);
      continue;
    }

    dirCount++;
    maxMtime = Math.max(maxMtime, stat.mtimeMs);

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = `${currentDir}${path.sep}${entry.name}`;
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        fileCount++;
        try {
          const entryStat = fs.statSync(entryPath);
          totalBytes += entryStat.size;
          maxMtime = Math.max(maxMtime, entryStat.mtimeMs);
        } catch {
          continue;
        }
      }
    }
  }

  return `${dirCount}:${fileCount}:${totalBytes}:${maxMtime}`;
};

const startSourceReconcile = (sourceId: string, libraryId: string, sourcePath: string) => {
  const existingTimer = reconcileTimers.get(sourceId);
  if (existingTimer) {
    clearInterval(existingTimer);
  }

  try {
    lastSourceSignatures.set(sourceId, getSourceSignature(sourcePath));
  } catch {
    lastSourceSignatures.delete(sourceId);
  }

  const timer = setInterval(() => {
    try {
      const signature = getSourceSignature(sourcePath);
      const lastSeen = lastSourceSignatures.get(sourceId);
      if (signature !== lastSeen) {
        lastSourceSignatures.set(sourceId, signature);
        console.info(`[watcher] reconcile detected source change: ${sourcePath}`);
        scheduleLibraryScan(libraryId, "reconcile", sourcePath);
      }
    } catch (error) {
      console.warn(`[watcher] reconcile skipped unavailable source path: ${sourcePath}`);
      logger.warn("Watched source became unavailable", {
        sourceId,
        libraryId,
        path: sourcePath,
      });
    }
  }, WATCH_FOLDER_RECONCILE_MS);

  reconcileTimers.set(sourceId, timer);
};

const closeWatchers = async () => {
  const activeWatchers = watchers;
  watchers = [];
  for (const timer of pendingScans.values()) {
    clearTimeout(timer);
  }
  pendingScans.clear();
  for (const timer of reconcileTimers.values()) {
    clearInterval(timer);
  }
  reconcileTimers.clear();
  lastSourceSignatures.clear();
  await Promise.allSettled(activeWatchers.map((watcher) => watcher.close()));
  if (activeWatchers.length > 0) {
    console.info(`[watcher] stopped ${activeWatchers.length} library source watcher(s)`);
  }
};

const scheduleLibraryScan = (libraryId: string, eventName: string, changedPath: string) => {
  const existingTimer = pendingScans.get(libraryId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  pendingScans.set(libraryId, setTimeout(() => {
    pendingScans.delete(libraryId);
    console.info(`[watcher] queueing scan for library ${libraryId} after ${eventName}: ${changedPath}`);
    requestLibraryScan(libraryId, "watch", { dedupe: true })
      .then((result) => {
        console.info(`[watcher] scan ${result.status} for library ${libraryId}`);
        logger.info("Watch-triggered library scan handled", {
          libraryId,
          eventName,
          path: changedPath,
          status: result.status,
          jobId: result.jobId,
        });
      })
      .catch((error) => {
        logger.error("Failed to queue watch-triggered library scan", error, {
          libraryId,
          eventName,
          path: changedPath,
        });
      });
  }, WATCH_DEBOUNCE_MS));
};

export const refreshLibraryWatchers = async () => {
  if (!WATCH_FOLDERS_ENABLED) {
    await closeWatchers();
    console.info("[watcher] library folder watching disabled by WATCH_FOLDERS_ENABLED=false");
    logger.info("Library folder watching disabled");
    return;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    await closeWatchers();

    const sources = await prisma.librarySource.findMany({
      where: {
        isEnabled: true,
        isWatched: true,
        library: { isActive: true },
      },
      select: {
        id: true,
        libraryId: true,
        path: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (sources.length === 0) {
      console.info("[watcher] no watched library sources configured");
      logger.info("No watched library sources configured");
      return;
    }

    console.info(
      `[watcher] configuring ${sources.length} watched library source(s) ` +
      `(polling=${WATCH_FOLDER_USE_POLLING}, interval=${WATCH_FOLDER_POLL_INTERVAL_MS}ms, ` +
      `reconcile=${WATCH_FOLDER_RECONCILE_MS}ms)`,
    );

    const { watch } = await import("chokidar");

    for (const source of sources) {
      const sourcePath = normalizeSourcePath(source.path);
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
        console.warn(`[watcher] skipping unavailable source path: ${sourcePath}`);
        logger.warn("Skipping watched source because path is unavailable", {
          sourceId: source.id,
          libraryId: source.libraryId,
          path: sourcePath,
        });
        continue;
      }

      const watcher = watch(sourcePath, {
        ignoreInitial: true,
        persistent: true,
        usePolling: WATCH_FOLDER_USE_POLLING,
        interval: WATCH_FOLDER_POLL_INTERVAL_MS,
        binaryInterval: WATCH_FOLDER_POLL_INTERVAL_MS,
        awaitWriteFinish: {
          stabilityThreshold: 3000,
          pollInterval: 500,
        },
        ignored: /(^|[/\\])\../,
      });

      watcher.on("all", (eventName, changedPath) => {
        if (typeof eventName !== "string" || typeof changedPath !== "string" || !WATCHED_EVENTS.has(eventName)) {
          return;
        }

        scheduleLibraryScan(source.libraryId, eventName, changedPath);
      });

      watcher.on("error", (error) => {
        console.error(`[watcher] source watcher failed for ${sourcePath}:`, error);
        logger.error("Library source watcher failed", error, {
          sourceId: source.id,
          libraryId: source.libraryId,
          path: sourcePath,
        });
      });

      watcher.on("ready", () => {
        console.info(`[watcher] ready for source path: ${sourcePath}`);
      });

      watchers.push(watcher);
      startSourceReconcile(source.id, source.libraryId, sourcePath);
      console.info(`[watcher] watching source path: ${sourcePath}`);
      logger.info("Watching library source", {
        sourceId: source.id,
        libraryId: source.libraryId,
        path: sourcePath,
      });
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
};

export const startLibraryWatchers = () => {
  void refreshLibraryWatchers();
};
