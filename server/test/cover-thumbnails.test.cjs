const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const distDirectory = fsSync.existsSync(path.join(__dirname, '..', '.test-dist'))
  ? path.join(__dirname, '..', '.test-dist')
  : path.join(__dirname, '..', 'dist');
const { createCoverThumbnailStore } = require(path.join(distDirectory, 'utils/coverThumbnails.js'));

const HOUR = 60 * 60 * 1000;

// A fake library share: counts how often it's asked, and can be changed,
// emptied or made unreachable.
function setup() {
  const share = {
    calls: 0,
    renders: 0,
    unreachable: false,
    source: { path: '/library/Book/cover.jpg', size: 1000, mtimeMs: 1 },
  };
  let clock = Date.UTC(2026, 10, 13);
  return fs.mkdtemp(path.join(os.tmpdir(), 'azure-covers-')).then((cacheDir) => ({
    cacheDir,
    share,
    advance: (ms) => { clock += ms; },
    store: createCoverThumbnailStore({
      cacheDir,
      now: () => clock,
      findSource: async () => {
        share.calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (share.unreachable) throw new Error('share unreachable');
        return share.source ? { ...share.source } : null;
      },
      render: async (sourcePath, width) => {
        share.renders += 1;
        return Buffer.from(`${sourcePath}@${width}#${share.source?.mtimeMs}`);
      },
    }),
  }));
}

const read = (result) => fs.readFile(result.path, 'utf8');

test('a cached thumbnail is served without touching the library share', async () => {
  const t = await setup();
  try {
    const first = await t.store.get('book-1', '/library/Book', 640);
    assert.equal(first.kind, 'thumbnail');
    assert.equal(first.cached, false);
    assert.equal(t.share.calls, 1);

    // Even with the share gone, the cached copy is sent and nothing waits on it.
    t.share.unreachable = true;
    const second = await t.store.get('book-1', '/library/Book', 640);
    assert.equal(second.cached, true);
    assert.equal(t.share.calls, 1);
    assert.equal(await read(second), '/library/Book/cover.jpg@640#1');
  } finally {
    await fs.rm(t.cacheDir, { recursive: true, force: true });
  }
});

test('simultaneous requests for a new cover render it once', async () => {
  const t = await setup();
  try {
    const results = await Promise.all([1, 2, 3, 4].map(() => t.store.get('book-1', '/library/Book', 240)));
    assert.ok(results.every((r) => r.kind === 'thumbnail'));
    assert.equal(t.share.renders, 1);
    assert.equal(t.share.calls, 1);
  } finally {
    await fs.rm(t.cacheDir, { recursive: true, force: true });
  }
});

test('after an hour the original is re-checked in the background', async () => {
  const t = await setup();
  try {
    await t.store.get('book-1', '/library/Book', 640);

    // Unchanged: no new render, and no further check for another hour.
    t.advance(HOUR + 1);
    await t.store.get('book-1', '/library/Book', 640);
    await t.store.settle();
    assert.equal(t.share.calls, 2);
    assert.equal(t.share.renders, 1);
    await t.store.get('book-1', '/library/Book', 640);
    await t.store.settle();
    assert.equal(t.share.calls, 2);

    // Replaced on the share: the stale copy is sent once more, then rebuilt.
    t.share.source = { ...t.share.source, size: 2000, mtimeMs: 2 };
    t.advance(HOUR + 1);
    const stale = await t.store.get('book-1', '/library/Book', 640);
    assert.equal(await read(stale), '/library/Book/cover.jpg@640#1');
    await t.store.settle();
    const fresh = await t.store.get('book-1', '/library/Book', 640);
    assert.equal(await read(fresh), '/library/Book/cover.jpg@640#2');
  } finally {
    await fs.rm(t.cacheDir, { recursive: true, force: true });
  }
});

test('a re-check while the share is down keeps the cached cover', async () => {
  const t = await setup();
  try {
    await t.store.get('book-1', '/library/Book', 640);
    t.share.unreachable = true;
    t.advance(HOUR + 1);
    await t.store.get('book-1', '/library/Book', 640);
    await t.store.settle();
    const again = await t.store.get('book-1', '/library/Book', 640);
    assert.equal(again.kind, 'thumbnail');
  } finally {
    await fs.rm(t.cacheDir, { recursive: true, force: true });
  }
});

test('a removed cover is dropped and "no cover" is remembered for a while', async () => {
  const t = await setup();
  try {
    await t.store.get('book-1', '/library/Book', 640);
    t.share.source = null;
    t.advance(HOUR + 1);
    await t.store.get('book-1', '/library/Book', 640);
    await t.store.settle();

    const calls = t.share.calls;
    assert.deepEqual(await t.store.get('book-1', '/library/Book', 640), { kind: 'missing' });
    assert.deepEqual(await t.store.get('book-1', '/library/Book', 240), { kind: 'missing' });
    assert.equal(t.share.calls, calls, 'no trip to the share while remembered');

    t.advance(11 * 60 * 1000);
    t.share.source = { path: '/library/Book/cover.png', size: 5, mtimeMs: 9 };
    const back = await t.store.get('book-1', '/library/Book', 640);
    assert.equal(back.kind, 'thumbnail');
  } finally {
    await fs.rm(t.cacheDir, { recursive: true, force: true });
  }
});

test('an unreachable share on first request is an error, not "no cover"', async () => {
  const t = await setup();
  try {
    t.share.unreachable = true;
    await assert.rejects(t.store.get('book-1', '/library/Book', 640), /unreachable/);
    t.share.unreachable = false;
    assert.equal((await t.store.get('book-1', '/library/Book', 640)).kind, 'thumbnail');
  } finally {
    await fs.rm(t.cacheDir, { recursive: true, force: true });
  }
});

test('invalidate drops every size of one book only', async () => {
  const t = await setup();
  try {
    await t.store.get('book-1', '/library/Book', 640);
    await t.store.get('book-1', '/library/Book', 240);
    await t.store.get('book-2', '/library/Other', 640);
    await t.store.invalidate('book-1');
    const files = await fs.readdir(t.cacheDir);
    assert.equal(files.length, 2, 'only book-2 (thumbnail + record) is left');

    const renders = t.share.renders;
    const rebuilt = await t.store.get('book-1', '/library/Book', 640);
    assert.equal(rebuilt.cached, false);
    assert.equal(t.share.renders, renders + 1);
  } finally {
    await fs.rm(t.cacheDir, { recursive: true, force: true });
  }
});
