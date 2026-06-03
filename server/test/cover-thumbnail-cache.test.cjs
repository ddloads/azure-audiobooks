const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { cleanupCoverThumbnailCache } = require('../dist/utils/coverThumbnailCache.js');

const createTempCacheDir = async () => fs.mkdtemp(path.join(os.tmpdir(), 'azure-cover-cache-'));

const writeThumbnail = async (dir, name, mtimeMs) => {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, 'thumb');
  const mtime = new Date(mtimeMs);
  await fs.utimes(filePath, mtime, mtime);
  return filePath;
};

test('cover thumbnail cleanup deletes stale jpg thumbnails only', async () => {
  const dir = await createTempCacheDir();
  try {
    const now = Date.UTC(2026, 0, 31);
    const stale = await writeThumbnail(dir, 'stale.jpg', now - 31 * 24 * 60 * 60 * 1000);
    const fresh = await writeThumbnail(dir, 'fresh.jpg', now - 2 * 24 * 60 * 60 * 1000);
    const nonThumbnail = await writeThumbnail(dir, 'keep.png', now - 90 * 24 * 60 * 60 * 1000);

    const result = await cleanupCoverThumbnailCache({
      cacheDir: dir,
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      now,
    });

    assert.deepEqual(result, { scanned: 2, deleted: 1 });
    await assert.rejects(() => fs.access(stale));
    await fs.access(fresh);
    await fs.access(nonThumbnail);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('cover thumbnail cleanup prunes oldest overflow after stale cleanup', async () => {
  const dir = await createTempCacheDir();
  try {
    const now = Date.UTC(2026, 0, 31);
    const oldest = await writeThumbnail(dir, 'oldest.jpg', now - 10_000);
    const middle = await writeThumbnail(dir, 'middle.jpg', now - 5_000);
    const newest = await writeThumbnail(dir, 'newest.jpg', now - 1_000);

    const result = await cleanupCoverThumbnailCache({
      cacheDir: dir,
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      maxFiles: 2,
      now,
    });

    assert.deepEqual(result, { scanned: 3, deleted: 1 });
    await assert.rejects(() => fs.access(oldest));
    await fs.access(middle);
    await fs.access(newest);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('cover thumbnail cleanup treats a missing cache directory as empty', async () => {
  const dir = path.join(os.tmpdir(), `missing-cover-cache-${Date.now()}`);
  const result = await cleanupCoverThumbnailCache({ cacheDir: dir });
  assert.deepEqual(result, { scanned: 0, deleted: 0 });
});
