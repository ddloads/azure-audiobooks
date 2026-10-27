const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const distDirectory = fs.existsSync(path.join(__dirname, '..', '.test-dist'))
  ? path.join(__dirname, '..', '.test-dist')
  : path.join(__dirname, '..', 'dist');
const { isFolderUnchanged, mapWithConcurrency, readPositiveInt } = require(
  path.join(distDirectory, 'utils', 'scanner', 'scan-helpers.js'),
);

const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.m4b'];
const folderPath = path.join(path.sep, 'library', 'Author - Book');

const makeBook = (overrides = {}) => ({
  id: 'book-1',
  folderPath,
  coverPath: '/api/library/cover/book-1',
  metadataVersion: 4,
  audioFiles: [
    { filename: '01.mp3', path: path.join(folderPath, '01.mp3') },
    { filename: '02.mp3', path: path.join(folderPath, '02.mp3') },
  ],
  _count: { chapters: 3 },
  ...overrides,
});

const options = { metadataVersion: 4, audioExtensions: AUDIO_EXTENSIONS, coverUrl: '/api/library/cover/book-1' };
const folder = (files) => ({ folderPath, files });

test('an unchanged folder is skipped', () => {
  assert.equal(isFolderUnchanged(folder(['02.mp3', 'cover.jpg', '01.mp3', 'notes.txt']), makeBook(), options), true);
});

test('changed or incomplete folders go through the full upsert', () => {
  const files = ['01.mp3', '02.mp3', 'cover.jpg'];
  assert.equal(isFolderUnchanged(folder([...files, '03.mp3']), makeBook(), options), false, 'new audio file');
  assert.equal(isFolderUnchanged(folder(['01.mp3', '02b.mp3', 'cover.jpg']), makeBook(), options), false, 'renamed file');
  assert.equal(isFolderUnchanged(folder(['01.mp3', '02.mp3']), makeBook(), options), false, 'cover missing');
  assert.equal(isFolderUnchanged(folder(files), makeBook({ coverPath: '' }), options), false, 'cover not linked');
  assert.equal(isFolderUnchanged(folder(files), makeBook({ metadataVersion: 3 }), options), false, 'old metadata version');
  assert.equal(isFolderUnchanged(folder(files), makeBook({ _count: { chapters: 0 } }), options), false, 'no chapters');
  assert.equal(
    isFolderUnchanged(folder(files), makeBook({ folderPath: path.join(path.sep, 'old', 'Author - Book') }), options),
    false,
    'moved folder',
  );
});

test('mapWithConcurrency keeps order and respects the limit', async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([5, 1, 4, 2, 3, 0], 2, async (delay, index) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, delay * 5));
    active--;
    return index * 10;
  });
  assert.deepEqual(results, [0, 10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
});

test('readPositiveInt falls back on bad values', () => {
  assert.equal(readPositiveInt('8', 4), 8);
  assert.equal(readPositiveInt('0', 4), 4);
  assert.equal(readPositiveInt('abc', 4), 4);
  assert.equal(readPositiveInt(undefined, 4), 4);
});
