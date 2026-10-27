import path from "path";

// Kept free of Prisma/ffmpeg imports so the helpers can be unit tested.

export const readPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// How many book folders a scan processes at once. Most of a folder's time is
// spent waiting on the network share and the database, so a few in parallel
// hide that latency without flooding the NAS.
export const SCAN_FOLDER_CONCURRENCY = readPositiveInt(process.env.SCAN_FOLDER_CONCURRENCY, 4);

// How many ffprobe processes one book may run at once.
export const SCAN_PROBE_CONCURRENCY = readPositiveInt(process.env.SCAN_PROBE_CONCURRENCY, 4);

/** Like Promise.all over `items`, but with at most `limit` calls in flight. Results keep input order. */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

// Matches the names findCoverInFolder looks for.
const COVER_FILE_NAMES = ["cover.jpg", "cover.jpeg", "cover.png", "cover.webp"];

export type KnownBook = {
  id: string;
  folderPath: string;
  coverPath: string | null;
  metadataVersion: number;
  audioFiles: { filename: string; path: string }[]; // ordered by index
  _count: { chapters: number };
};

/**
 * True when a full upsert of this folder would change nothing: same audio
 * files, current metadata version, chapters present and the cover already in
 * place. Uses only the directory listing from discovery, so skipping a book
 * costs no file reads, no ffprobe and no database writes.
 */
export const isFolderUnchanged = (
  folder: { folderPath: string; files: string[] },
  book: KnownBook,
  options: { metadataVersion: number; audioExtensions: readonly string[]; coverUrl: string },
) => {
  if (book.folderPath !== folder.folderPath) return false;
  if (book.metadataVersion < options.metadataVersion) return false;
  if (book._count.chapters === 0) return false;
  if (book.coverPath !== options.coverUrl) return false;
  if (!folder.files.some((file) => COVER_FILE_NAMES.includes(file))) return false;

  const audioFiles = folder.files
    .filter((file) => options.audioExtensions.includes(path.extname(file).toLowerCase()))
    .sort();
  if (audioFiles.length !== book.audioFiles.length) return false;
  return book.audioFiles.every(
    (audioFile, index) =>
      audioFile.filename === audioFiles[index] &&
      audioFile.path === path.join(folder.folderPath, audioFile.filename),
  );
};
