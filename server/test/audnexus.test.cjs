const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const distDirectory = fs.existsSync(path.join(__dirname, '..', '.test-dist'))
  ? path.join(__dirname, '..', '.test-dist')
  : path.join(__dirname, '..', 'dist');
const { audnexusToChapters, isAsin, runtimeMatches } = require(path.join(distDirectory, 'utils', 'audnexus.js'));
const { looksGenerated } = require(path.join(distDirectory, 'utils', 'audibleChapterBackfill.js'));

const sample = {
  runtimeLengthMs: 3_600_000,
  chapters: [
    { title: 'Opening Credits', startOffsetMs: 0, lengthMs: 30_000 },
    { title: 'Chapter 1', startOffsetMs: 30_000, lengthMs: 1_770_000 },
    { title: '', startOffsetMs: 1_800_000, lengthMs: 1_800_000 },
  ],
};

test('Audnexus chapters become seconds, with titles and the last chapter reaching the end', () => {
  const result = audnexusToChapters(sample, 3_620);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.chapters, [
    { title: 'Opening Credits', start: 0, end: 30 },
    { title: 'Chapter 1', start: 30, end: 1_800 },
    { title: 'Chapter 3', start: 1_800, end: 3_620 },
  ]);
});

test('a different edition (runtime too far off) is rejected', () => {
  assert.equal(audnexusToChapters(sample, 3_600 + 600).status, 'mismatch');
  assert.equal(runtimeMatches(36_000, 36_000 + 500), true); // within 1.5%
  assert.equal(runtimeMatches(36_000, 36_000 + 600), false);
  assert.equal(runtimeMatches(100, 150), true); // short books get a 60 s floor
  assert.equal(runtimeMatches(100, 0), false);
});

test('empty chapter lists count as not found', () => {
  assert.equal(audnexusToChapters({ runtimeLengthMs: 1000, chapters: [] }, 1).status, 'not-found');
});

test('ASINs are 10 letters or digits', () => {
  assert.equal(isAsin('B002V0QK4C'), true);
  assert.equal(isAsin('b002v0qk4c'), true);
  assert.equal(isAsin('B002V0QK4'), false);
  assert.equal(isAsin('B002V0QK4C/../x'), false);
  assert.equal(isAsin(null), false);
});

test('only generated or generic "Chapter N" chapters are replaced by the backfill', () => {
  assert.equal(looksGenerated({ chaptersSource: 'generated', chapters: [{ title: 'Prologue' }] }), true);
  assert.equal(looksGenerated({ chaptersSource: null, chapters: [{ title: 'Chapter 1' }, { title: 'chapter 2 ' }] }), true);
  assert.equal(looksGenerated({ chaptersSource: null, chapters: [{ title: 'Chapter 1' }, { title: 'The Storm' }] }), false);
  assert.equal(looksGenerated({ chaptersSource: 'embedded', chapters: [{ title: 'Chapter 1' }] }), false);
  assert.equal(looksGenerated({ chaptersSource: 'audible', chapters: [] }), false);
});
