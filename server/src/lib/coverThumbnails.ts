import fsp from "fs/promises";
import path from "path";
import sharp from "sharp";
import { createLogger } from "./logger";
import { findCoverInFolderAsync } from "../utils/covers";
import { createCoverThumbnailStore, type CoverSource } from "../utils/coverThumbnails";
import { scheduleCoverThumbnailCacheCleanup } from "../utils/coverThumbnailCache";

export const COVER_THUMB_CACHE_DIR = path.join(process.cwd(), "data", "cache", "covers");

const coverLogger = createLogger("covers");

// The book's folder (on the library share) couldn't be read.
export class CoverLibraryUnavailableError extends Error {
  constructor(public readonly folderPath: string, public readonly cause: unknown) {
    super(`Library folder unavailable: ${folderPath}`);
  }
}

const findSource = async (folderPath: string): Promise<CoverSource | null> => {
  const file = await findCoverInFolderAsync(folderPath);
  if (!file) {
    // No cover, or no folder: only the second is an error.
    try {
      await fsp.access(folderPath);
    } catch (error) {
      throw new CoverLibraryUnavailableError(folderPath, error);
    }
    return null;
  }
  const stat = await fsp.stat(file);
  return { path: file, size: stat.size, mtimeMs: stat.mtimeMs };
};

const render = async (sourcePath: string, width: number) => {
  const buffer = await sharp(sourcePath)
    .rotate()
    .resize({ width, withoutEnlargement: true, fit: "inside" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  scheduleCoverThumbnailCacheCleanup(COVER_THUMB_CACHE_DIR);
  return buffer;
};

export const coverThumbnails = createCoverThumbnailStore({
  cacheDir: COVER_THUMB_CACHE_DIR,
  findSource,
  render,
  onBackgroundError: (error) => coverLogger.warn("Cover re-check failed", { error: String(error) }),
});

// Call after a book's cover file is replaced so every size is rebuilt.
export const invalidateCoverThumbnails = (bookId: string) => coverThumbnails.invalidate(bookId);
