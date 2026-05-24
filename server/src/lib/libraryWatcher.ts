import fs from "fs";
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
const WATCHED_EVENTS = new Set(["add", "change", "unlink", "addDir", "unlinkDir"]);

let watchers: LibrarySourceWatcher[] = [];
const pendingScans = new Map<string, NodeJS.Timeout>();
let refreshPromise: Promise<void> | null = null;

const closeWatchers = async () => {
  const activeWatchers = watchers;
  watchers = [];
  for (const timer of pendingScans.values()) {
    clearTimeout(timer);
  }
  pendingScans.clear();
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

    console.info(`[watcher] configuring ${sources.length} watched library source(s)`);

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
        logger.error("Library source watcher failed", error, {
          sourceId: source.id,
          libraryId: source.libraryId,
          path: sourcePath,
        });
      });

      watchers.push(watcher);
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
