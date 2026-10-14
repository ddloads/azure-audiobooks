// Integration tests for Continue Listening hiding and per-day listening stats.
// They need a real PostgreSQL database with migrations applied, so they skip
// unless DATABASE_URL is set, e.g.:
//   DATABASE_URL=postgresql://... DIRECT_URL=postgresql://... npm test
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';

const distDirectory = fs.existsSync(path.join(__dirname, '..', '.test-dist'))
  ? path.join(__dirname, '..', '.test-dist')
  : path.join(__dirname, '..', 'dist');
const fromDist = (relativePath) => require(path.join(distDirectory, relativePath));

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = () => res;
  return res;
}

async function call(handler, { userId, params = {}, body = {}, query = {} }) {
  const res = mockRes();
  await handler({ user: { userId }, params, body, query, headers: {} }, res);
  return res;
}

test('progress hiding and listening stats', { skip }, async (t) => {
  const prisma = fromDist('lib/prisma.js').default;
  const progress = fromDist('controllers/progressController.js');
  const sessions = fromDist('controllers/sessionController.js');
  const suffix = randomUUID().slice(0, 8);

  const user = await prisma.user.create({ data: { username: `test-${suffix}`, password: 'x' } });
  const library = await prisma.library.create({ data: { name: `lib-${suffix}` } });
  const author = await prisma.author.create({ data: { name: `author-${suffix}` } });
  const book = await prisma.book.create({
    data: { title: 'Book', libraryId: library.id, authorId: author.id, folderPath: `/tmp/${suffix}`, duration: 3600 },
  });

  t.after(async () => {
    await prisma.library.delete({ where: { id: library.id } }).catch(() => {});
    await prisma.author.delete({ where: { id: author.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  });

  const inProgressIds = async () => (await call(progress.getAllUserProgress, { userId: user.id })).body.map(r => r.bookId);

  await t.test('hiding keeps the position but leaves Continue Listening', async () => {
    await call(progress.updateProgress, { userId: user.id, params: { bookId: book.id }, body: { currentTime: 600, isFinished: false } });
    assert.deepEqual(await inProgressIds(), [book.id]);

    const hidden = await call(progress.hideProgress, { userId: user.id, params: { bookId: book.id } });
    assert.equal(hidden.statusCode, 204);
    assert.deepEqual(await inProgressIds(), []);

    const saved = await call(progress.getProgress, { userId: user.id, params: { bookId: book.id } });
    assert.equal(saved.body.currentTime, 600);
  });

  await t.test('a save at the same position stays hidden', async () => {
    await call(progress.updateProgress, { userId: user.id, params: { bookId: book.id }, body: { currentTime: 602, isFinished: false } });
    assert.deepEqual(await inProgressIds(), []);
  });

  await t.test('listening again brings it back', async () => {
    await call(progress.updateProgress, { userId: user.id, params: { bookId: book.id }, body: { currentTime: 660, isFinished: false } });
    assert.deepEqual(await inProgressIds(), [book.id]);
  });

  await t.test('stats report per-day history, days listened and finished count', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    await prisma.listeningSession.createMany({
      data: [
        { userId: user.id, bookId: book.id, startedAt: now, secondsListened: 120 },
        { userId: user.id, bookId: book.id, startedAt: now, secondsListened: 60 },
        { userId: user.id, bookId: book.id, startedAt: yesterday, secondsListened: 300 },
        { userId: user.id, bookId: book.id, startedAt: yesterday, secondsListened: 0 },
      ],
    });
    await call(progress.updateProgress, { userId: user.id, params: { bookId: book.id }, body: { currentTime: 3600, isFinished: true } });

    const res = await call(sessions.getUserStats, { userId: user.id, query: { tzOffset: '0' } });
    assert.equal(res.statusCode, 200);
    const { dailySeconds, daysListened, itemsFinished, allTimeSeconds } = res.body;
    assert.equal(dailySeconds.length, 30);
    assert.equal(dailySeconds.at(-1).date, now.toISOString().slice(0, 10));
    assert.equal(dailySeconds.at(-1).seconds, 180);
    assert.equal(dailySeconds.at(-2).seconds, 300);
    assert.equal(daysListened, 2);
    assert.equal(itemsFinished, 1);
    assert.equal(allTimeSeconds, 480);
  });
});
