import fsp from "fs/promises";
import path from "path";

const THUMBNAIL_EXTENSION = ".jpg";
// Each thumbnail may have a `<name>.json` record beside it (see
// coverThumbnails.ts); it goes when its thumbnail goes.
const META_EXTENSION = ".json";
const TEMP_EXTENSION = ".tmp";
const TEMP_MAX_AGE_MS = 60 * 60 * 1000;

export const DEFAULT_COVER_THUMB_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_COVER_THUMB_CACHE_MAX_FILES = 5_000;
export const DEFAULT_COVER_THUMB_CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export type CoverThumbnailCacheCleanupOptions = {
  cacheDir: string;
  maxAgeMs?: number;
  maxFiles?: number;
  now?: number;
};

export type CoverThumbnailCacheCleanupResult = {
  scanned: number;
  deleted: number;
};

type ThumbnailCacheEntry = {
  path: string;
  mtimeMs: number;
};

const isThumbnailCacheFile = (filename: string) =>
  path.extname(filename).toLowerCase() === THUMBNAIL_EXTENSION;

const metaPathFor = (thumbnailPath: string) =>
  `${thumbnailPath.slice(0, -THUMBNAIL_EXTENSION.length)}${META_EXTENSION}`;

const removeCacheFiles = async (entries: ThumbnailCacheEntry[]) => {
  let deleted = 0;
  await Promise.all(
    entries.map(async (entry) => {
      try {
        await fsp.unlink(entry.path);
        deleted += 1;
      } catch {
        // Another request or process may have already removed it. Cleanup is best-effort.
      }
      await fsp.rm(metaPathFor(entry.path), { force: true }).catch(() => undefined);
    }),
  );
  return deleted;
};

// Records whose thumbnail is gone, and temp files left by an interrupted write.
const removeLeftovers = async (cacheDir: string, files: string[], now: number) => {
  const names = new Set(files);
  await Promise.all(files.map(async (filename) => {
    const filePath = path.join(cacheDir, filename);
    if (filename.endsWith(META_EXTENSION)) {
      const thumbnail = `${filename.slice(0, -META_EXTENSION.length)}${THUMBNAIL_EXTENSION}`;
      if (!names.has(thumbnail)) await fsp.rm(filePath, { force: true }).catch(() => undefined);
      return;
    }
    if (filename.endsWith(TEMP_EXTENSION)) {
      const stat = await fsp.stat(filePath).catch(() => null);
      if (stat && now - stat.mtimeMs > TEMP_MAX_AGE_MS) await fsp.rm(filePath, { force: true }).catch(() => undefined);
    }
  }));
};

export const cleanupCoverThumbnailCache = async ({
  cacheDir,
  maxAgeMs = DEFAULT_COVER_THUMB_CACHE_MAX_AGE_MS,
  maxFiles = DEFAULT_COVER_THUMB_CACHE_MAX_FILES,
  now = Date.now(),
}: CoverThumbnailCacheCleanupOptions): Promise<CoverThumbnailCacheCleanupResult> => {
  let files: string[];
  try {
    files = await fsp.readdir(cacheDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { scanned: 0, deleted: 0 };
    throw error;
  }

  const entries = await Promise.all(
    files.filter(isThumbnailCacheFile).map(async (filename) => {
      const filePath = path.join(cacheDir, filename);
      try {
        const stat = await fsp.stat(filePath);
        if (!stat.isFile()) return null;
        return { path: filePath, mtimeMs: stat.mtimeMs } satisfies ThumbnailCacheEntry;
      } catch {
        return null;
      }
    }),
  );

  const thumbnails = entries.filter((entry): entry is ThumbnailCacheEntry => entry !== null);
  const cutoff = now - maxAgeMs;
  const stale = thumbnails.filter((entry) => entry.mtimeMs < cutoff);
  const stalePaths = new Set(stale.map((entry) => entry.path));
  const remaining = thumbnails
    .filter((entry) => !stalePaths.has(entry.path))
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  const overflow = maxFiles >= 0 && remaining.length > maxFiles ? remaining.slice(0, remaining.length - maxFiles) : [];
  const deleted = await removeCacheFiles([...stale, ...overflow]);
  await removeLeftovers(cacheDir, files, now);

  return { scanned: thumbnails.length, deleted };
};

let lastCleanupAt = 0;
let cleanupInFlight: Promise<void> | null = null;

export const scheduleCoverThumbnailCacheCleanup = (
  cacheDir: string,
  intervalMs = DEFAULT_COVER_THUMB_CACHE_CLEANUP_INTERVAL_MS,
) => {
  const now = Date.now();
  if (cleanupInFlight || now - lastCleanupAt < intervalMs) return;

  lastCleanupAt = now;
  cleanupInFlight = cleanupCoverThumbnailCache({ cacheDir })
    .then(({ deleted }) => {
      if (deleted > 0) {
        console.info(`Cleaned up ${deleted} cached cover thumbnail${deleted === 1 ? "" : "s"}`);
      }
    })
    .catch((error) => {
      console.warn("Failed to clean up cached cover thumbnails", error);
    })
    .finally(() => {
      cleanupInFlight = null;
    });
};
