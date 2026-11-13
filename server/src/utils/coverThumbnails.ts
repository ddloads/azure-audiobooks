import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";

// Resized covers, kept on the server's own disk so they can be served without
// touching the library share.
//
// The library lives on a NAS mounted over the network, often on disks that
// spin down. Before this store, every cover request looked the original up on
// that share (and read its size and date) just to work out which cached
// thumbnail to send, so even a cached cover waited on the NAS. Now a cached
// thumbnail is sent straight away, and the original is re-checked in the
// background at most once per `revalidateAfterMs`.
//
// Files per book and width, in `cacheDir`:
//   <key>.jpg   the thumbnail
//   <key>.json  where it came from: { path, size, mtimeMs, validatedAt }
// where <key> is a hash of the book id plus the width.

export type CoverSource = { path: string; size: number; mtimeMs: number };

type ThumbnailMeta = CoverSource & { validatedAt: number };

export type CoverThumbnailResult =
  | { kind: "thumbnail"; path: string; cached: boolean }
  | { kind: "missing" };

export type CoverThumbnailStoreOptions = {
  cacheDir: string;
  // Finds the book's cover on the library share. Resolves null when the book
  // has no cover; rejects when the share can't be reached.
  findSource: (folderPath: string) => Promise<CoverSource | null>;
  render: (sourcePath: string, width: number) => Promise<Buffer>;
  revalidateAfterMs?: number;
  // How long "this book has no cover" is remembered.
  missingTtlMs?: number;
  now?: () => number;
  onBackgroundError?: (error: unknown) => void;
};

export const DEFAULT_REVALIDATE_AFTER_MS = 60 * 60 * 1000;
export const DEFAULT_MISSING_TTL_MS = 10 * 60 * 1000;

const bookHash = (bookId: string) =>
  crypto.createHash("sha1").update(bookId).digest("hex").slice(0, 24);

const sameSource = (a: CoverSource, b: CoverSource) =>
  a.path === b.path && a.size === b.size && a.mtimeMs === b.mtimeMs;

// Writes beside the target, then renames over it, so a reader never sees a
// half-written file.
const writeAtomic = async (filePath: string, data: Buffer | string) => {
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temp, data);
    await fsp.rename(temp, filePath);
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const createCoverThumbnailStore = ({
  cacheDir,
  findSource,
  render,
  revalidateAfterMs = DEFAULT_REVALIDATE_AFTER_MS,
  missingTtlMs = DEFAULT_MISSING_TTL_MS,
  now = Date.now,
  onBackgroundError = () => undefined,
}: CoverThumbnailStoreOptions) => {
  const builds = new Map<string, Promise<CoverThumbnailResult>>();
  const revalidations = new Map<string, Promise<void>>();
  const missingUntil = new Map<string, number>();

  const keyFor = (bookId: string, width: number) => `${bookHash(bookId)}-${width}`;
  const thumbPath = (key: string) => path.join(cacheDir, `${key}.jpg`);
  const metaPath = (key: string) => path.join(cacheDir, `${key}.json`);

  const readCached = async (key: string): Promise<ThumbnailMeta | null> => {
    try {
      const [meta] = await Promise.all([
        fsp.readFile(metaPath(key), "utf8").then((raw) => JSON.parse(raw) as ThumbnailMeta),
        fsp.access(thumbPath(key)),
      ]);
      return typeof meta?.path === "string" && Number.isFinite(meta.validatedAt) ? meta : null;
    } catch {
      return null;
    }
  };

  const markMissing = (bookId: string) => {
    if (missingUntil.size > 10_000) missingUntil.clear();
    missingUntil.set(bookId, now() + missingTtlMs);
  };

  const isKnownMissing = (bookId: string) => {
    const until = missingUntil.get(bookId);
    if (until === undefined) return false;
    if (until > now()) return true;
    missingUntil.delete(bookId);
    return false;
  };

  const remove = async (key: string) => {
    await Promise.all([
      fsp.rm(thumbPath(key), { force: true }),
      fsp.rm(metaPath(key), { force: true }),
    ]);
  };

  const renderAndStore = async (key: string, source: CoverSource, width: number) => {
    const buffer = await render(source.path, width);
    await fsp.mkdir(cacheDir, { recursive: true });
    await writeAtomic(thumbPath(key), buffer);
    const meta: ThumbnailMeta = { ...source, validatedAt: now() };
    await writeAtomic(metaPath(key), JSON.stringify(meta));
  };

  const build = (bookId: string, folderPath: string, width: number, key: string) => {
    const existing = builds.get(key);
    if (existing) return existing;
    const job = (async (): Promise<CoverThumbnailResult> => {
      const source = await findSource(folderPath);
      if (!source) {
        markMissing(bookId);
        return { kind: "missing" };
      }
      await renderAndStore(key, source, width);
      return { kind: "thumbnail", path: thumbPath(key), cached: false };
    })().finally(() => builds.delete(key));
    builds.set(key, job);
    return job;
  };

  // Checks the original on the share and refreshes the thumbnail when the
  // cover was replaced or removed. Runs after the cached copy has been sent.
  const revalidate = (bookId: string, folderPath: string, width: number, key: string, meta: ThumbnailMeta) => {
    if (revalidations.has(key)) return revalidations.get(key)!;
    const job = (async () => {
      let source: CoverSource | null;
      try {
        source = await findSource(folderPath);
      } catch {
        // Share unreachable: keep serving what we have and try again later.
        return;
      }
      if (!source) {
        await remove(key);
        markMissing(bookId);
        return;
      }
      if (sameSource(source, meta)) {
        await writeAtomic(metaPath(key), JSON.stringify({ ...meta, validatedAt: now() }));
        // Keeps covers that are still in use from aging out of the cache.
        const stamp = new Date(now());
        await fsp.utimes(thumbPath(key), stamp, stamp).catch(() => undefined);
        return;
      }
      await renderAndStore(key, source, width);
    })()
      .catch(onBackgroundError)
      .finally(() => revalidations.delete(key));
    revalidations.set(key, job);
    return job;
  };

  return {
    // The thumbnail for a book at a width: the cached one when there is one
    // (re-checked in the background when due), otherwise rendered now.
    async get(bookId: string, folderPath: string, width: number): Promise<CoverThumbnailResult> {
      const key = keyFor(bookId, width);
      const cached = await readCached(key);
      if (cached) {
        if (now() - cached.validatedAt >= revalidateAfterMs) {
          void revalidate(bookId, folderPath, width, key, cached);
        }
        return { kind: "thumbnail", path: thumbPath(key), cached: true };
      }
      if (isKnownMissing(bookId)) return { kind: "missing" };
      return build(bookId, folderPath, width, key);
    },

    // Drops every cached size of a book's cover, e.g. after it was replaced.
    async invalidate(bookId: string) {
      missingUntil.delete(bookId);
      const prefix = `${bookHash(bookId)}-`;
      let files: string[];
      try {
        files = await fsp.readdir(cacheDir);
      } catch {
        return;
      }
      await Promise.all(
        files
          .filter((file) => file.startsWith(prefix))
          .map((file) => fsp.rm(path.join(cacheDir, file), { force: true }).catch(() => undefined)),
      );
    },

    // For tests: waits for background re-checks to finish.
    async settle() {
      await Promise.all([...revalidations.values(), ...builds.values()].map((job) => job.catch(() => undefined)));
    },
  };
};

export type CoverThumbnailStore = ReturnType<typeof createCoverThumbnailStore>;
