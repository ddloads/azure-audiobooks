import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import prisma from "./prisma";
import { createLogger } from "./logger";
import { requestLibraryFolderScan, requestLibraryScan } from "./scanJobPool";
import { normalizeSourcePath } from "../utils/libraryConfig";

const logger = createLogger("watcher");

type LibrarySourceWatcher = {
  close: () => Promise<void> | void;
  on: (eventName: string, listener: (...args: unknown[]) => void) => LibrarySourceWatcher;
};

const WATCH_DEBOUNCE_MS = Number.parseInt(process.env.WATCH_FOLDER_DEBOUNCE_MS || "", 10) || 15000;
const WATCH_FOLDERS_ENABLED = process.env.WATCH_FOLDERS_ENABLED !== "false";
const WATCH_FOLDER_USE_POLLING = process.env.WATCH_FOLDER_USE_POLLING !== "false";
// Polling and reconcile both run stat() calls against every watched file. On a
// network share with thousands of audiobooks, the old 5s / 30s defaults
// saturated the NAS and starved active playback streams. Default to 60s
// polling and 5 minute reconcile; users with tiny local libraries can opt back
// to faster cadences via env vars.
const WATCH_FOLDER_POLL_INTERVAL_MS =
  Number.parseInt(process.env.WATCH_FOLDER_POLL_INTERVAL_MS || "", 10) || 60000;
const WATCHED_EVENTS = new Set(["add", "change", "unlink", "addDir", "unlinkDir"]);
const WATCH_FOLDER_RECONCILE_MS =
  Number.parseInt(process.env.WATCH_FOLDER_RECONCILE_MS || "", 10) || 300000;

let watchers: LibrarySourceWatcher[] = [];
const reconcileTimers = new Map<string, NodeJS.Timeout>();
const lastSourceSignatures = new Map<string, string>();
const lastSourceActivityAt = new Map<string, number>();
const pendingScans = new Map<string, NodeJS.Timeout>();
let refreshPromise: Promise<void> | null = null;

const getFolderPathForEvent = (eventName: string, changedPath: string) => {
  const normalizedPath = normalizeSourcePath(changedPath);
  if (eventName === "addDir" || eventName === "unlinkDir") {
    return normalizedPath;
  }

  return path.dirname(normalizedPath);
};

const getSourceSignature = async (sourcePath: string): Promise<string> => {
  try {
    await fsp.access(sourcePath);
  } catch {
    return "missing";
  }

  const stack = [sourcePath];
  let fileCount = 0;
  let dirCount = 0;
  let totalBytes = 0;
  let maxMtime = 0;
  // Yield to the event loop periodically so the reconcile walk doesn't stall
  // unrelated requests on slow network mounts.
  let iterations = 0;
  const YIELD_EVERY = 64;

  while (stack.length > 0) {
    if (++iterations % YIELD_EVERY === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const currentDir = stack.pop();
    if (!currentDir) continue;

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(currentDir);
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
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
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
          const entryStat = await fsp.stat(entryPath);
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

  // Prime the baseline signature in the background so the first reconcile tick
  // has something to compare against without blocking startup.
  void getSourceSignature(sourcePath)
    .then((signature) => lastSourceSignatures.set(sourceId, signature))
    .catch(() => lastSourceSignatures.delete(sourceId));

  // Track whether a reconcile pass is already running for this source so we
  // never queue overlapping walks of a slow network mount.
  let reconcileInFlight = false;

  const runReconcile = async () => {
    if (reconcileInFlight) return;
    reconcileInFlight = true;
    try {
      const signature = await getSourceSignature(sourcePath);
      const lastSeen = lastSourceSignatures.get(sourceId);
      if (signature !== lastSeen) {
        lastSourceSignatures.set(sourceId, signature);
        const lastActivity = lastSourceActivityAt.get(sourceId) ?? 0;
        const activityAgeMs = Date.now() - lastActivity;

        console.info(`[watcher] reconcile detected source change: ${sourcePath}`);
        if (activityAgeMs < WATCH_FOLDER_RECONCILE_MS) {
          console.info(
            `[watcher] reconcile suppressed for active source: ${sourcePath} ` +
            `(last event ${Math.round(activityAgeMs / 1000)}s ago)`,
          );
          return;
        }

        scheduleFullLibraryScan(libraryId, "reconcile", sourcePath);
      }
    } catch (error) {
      console.warn(`[watcher] reconcile skipped unavailable source path: ${sourcePath}`);
      logger.warn("Watched source became unavailable", {
        sourceId,
        libraryId,
        path: sourcePath,
      });
    } finally {
      reconcileInFlight = false;
    }
  };

  const timer = setInterval(() => {
    void runReconcile();
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

const scheduleFolderScan = (
  sourceId: string,
  libraryId: string,
  folderPath: string,
  eventName: string,
  changedPath: string,
) => {
  const key = `${libraryId}::folder::${folderPath.toLowerCase()}`;
  lastSourceActivityAt.set(sourceId, Date.now());
  const existingTimer = pendingScans.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  pendingScans.set(key, setTimeout(() => {
    pendingScans.delete(key);
    console.info(
      `[watcher] queueing folder scan for library ${libraryId} after ${eventName}: ${folderPath} ` +
      `(source event: ${changedPath})`,
    );
    requestLibraryFolderScan(libraryId, folderPath, "watch-folder", { dedupe: true })
      .then((result) => {
        console.info(`[watcher] folder scan ${result.status} for library ${libraryId}`);
        logger.info("Watch-triggered folder scan handled", {
          libraryId,
          eventName,
          path: changedPath,
          folderPath,
          status: result.status,
          jobId: result.jobId,
        });
      })
      .catch((error) => {
        logger.error("Failed to queue watch-triggered folder scan", error, {
          libraryId,
          eventName,
          path: changedPath,
          folderPath,
        });
      });
  }, WATCH_DEBOUNCE_MS));
};

const scheduleFullLibraryScan = (libraryId: string, eventName: string, changedPath: string) => {
  const key = `${libraryId}::library`;
  const existingTimer = pendingScans.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  pendingScans.set(key, setTimeout(() => {
    pendingScans.delete(key);
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
      let sourceStat: fs.Stats | null = null;
      try {
        sourceStat = await fsp.stat(sourcePath);
      } catch {
        sourceStat = null;
      }
      if (!sourceStat || !sourceStat.isDirectory()) {
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

        const folderPath = getFolderPathForEvent(eventName, changedPath);
        scheduleFolderScan(source.id, source.libraryId, folderPath, eventName, changedPath);
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
