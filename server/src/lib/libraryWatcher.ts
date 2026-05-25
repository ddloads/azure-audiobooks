import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import prisma from "./prisma";
import { createLogger } from "./logger";
import { requestLibraryFolderScan } from "./scanJobPool";
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

type FolderSig = {
  files: number;
  dirs: number;
  bytes: number;
  mtime: number;
};

let watchers: LibrarySourceWatcher[] = [];
const reconcileTimers = new Map<string, NodeJS.Timeout>();
const lastSourceFolderSigs = new Map<string, Map<string, FolderSig>>();
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

// Walks the source and returns a per-folder signature. Each entry captures
// only the folder's DIRECT contents (file count / subdir count / byte total /
// max mtime) so a change deep in the tree shows up at the deepest folder, not
// every ancestor — letting reconcile dispatch a tightly-scoped folder scan
// instead of a whole-library rescan. Returns null if the source path itself
// is unreadable (don't update baseline in that case).
const buildFolderSignatures = async (
  sourcePath: string,
): Promise<Map<string, FolderSig> | null> => {
  try {
    await fsp.access(sourcePath);
  } catch {
    return null;
  }

  const result = new Map<string, FolderSig>();
  const stack: string[] = [sourcePath];
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

    let dirStat: fs.Stats;
    try {
      dirStat = await fsp.stat(currentDir);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    let files = 0;
    let dirs = 0;
    let bytes = 0;
    let mtime = dirStat.mtimeMs;

    for (const entry of entries) {
      const entryPath = `${currentDir}${path.sep}${entry.name}`;
      if (entry.isDirectory()) {
        dirs++;
        stack.push(entryPath);
        try {
          const entryStat = await fsp.stat(entryPath);
          mtime = Math.max(mtime, entryStat.mtimeMs);
        } catch {
          /* ignore */
        }
      } else if (entry.isFile()) {
        files++;
        try {
          const entryStat = await fsp.stat(entryPath);
          bytes += entryStat.size;
          mtime = Math.max(mtime, entryStat.mtimeMs);
        } catch {
          /* ignore */
        }
      }
    }

    result.set(currentDir, { files, dirs, bytes, mtime });
  }

  return result;
};

const sigEq = (a: FolderSig, b: FolderSig) =>
  a.files === b.files && a.dirs === b.dirs && a.bytes === b.bytes && a.mtime === b.mtime;

// Returns folders that need a fresh scan: ones whose direct contents changed,
// brand-new folders, and the parents of removed folders so the scanner notices
// deletions.
const diffFolderSignatures = (
  prev: Map<string, FolderSig>,
  next: Map<string, FolderSig>,
): Set<string> => {
  const targets = new Set<string>();

  for (const [folder, sig] of next) {
    const prevSig = prev.get(folder);
    if (!prevSig || !sigEq(prevSig, sig)) {
      targets.add(folder);
    }
  }

  for (const folder of prev.keys()) {
    if (!next.has(folder)) {
      targets.add(path.dirname(folder));
    }
  }

  return targets;
};

const startSourceReconcile = (sourceId: string, libraryId: string, sourcePath: string) => {
  const existingTimer = reconcileTimers.get(sourceId);
  if (existingTimer) {
    clearInterval(existingTimer);
  }

  // Prime the baseline in the background so the first reconcile tick has
  // something to compare against without blocking startup.
  void buildFolderSignatures(sourcePath)
    .then((sigs) => {
      if (sigs) lastSourceFolderSigs.set(sourceId, sigs);
    })
    .catch(() => lastSourceFolderSigs.delete(sourceId));

  // Track whether a reconcile pass is already running for this source so we
  // never queue overlapping walks of a slow network mount.
  let reconcileInFlight = false;

  const runReconcile = async () => {
    if (reconcileInFlight) return;
    reconcileInFlight = true;
    try {
      const nextSigs = await buildFolderSignatures(sourcePath);
      if (!nextSigs) {
        console.warn(`[watcher] reconcile skipped unavailable source path: ${sourcePath}`);
        logger.warn("Watched source became unavailable", {
          sourceId,
          libraryId,
          path: sourcePath,
        });
        return;
      }

      const prevSigs = lastSourceFolderSigs.get(sourceId);
      // Always update the baseline so a suppressed reconcile doesn't re-detect
      // the same diff on the next tick.
      lastSourceFolderSigs.set(sourceId, nextSigs);

      // First reconcile after restart — no baseline to diff against. The
      // chokidar watcher is already running, so we trust it for new changes.
      if (!prevSigs) return;

      const targets = diffFolderSignatures(prevSigs, nextSigs);
      if (targets.size === 0) return;

      const lastActivity = lastSourceActivityAt.get(sourceId) ?? 0;
      const activityAgeMs = Date.now() - lastActivity;
      if (activityAgeMs < WATCH_FOLDER_RECONCILE_MS) {
        console.info(
          `[watcher] reconcile suppressed for active source: ${sourcePath} ` +
          `(last event ${Math.round(activityAgeMs / 1000)}s ago, ${targets.size} folder diff(s) deferred to chokidar)`,
        );
        return;
      }

      console.info(
        `[watcher] reconcile detected ${targets.size} changed folder(s) under ${sourcePath}`,
      );
      for (const folder of targets) {
        scheduleFolderScan(sourceId, libraryId, folder, "reconcile", folder);
      }
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
  lastSourceFolderSigs.clear();
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
