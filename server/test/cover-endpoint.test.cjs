const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unit-tests-only-1234567890';
// Never reached: these requests are refused before any database lookup.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@127.0.0.1:1/none';

const distDirectory = fs.existsSync(path.join(__dirname, '..', '.test-dist'))
  ? path.join(__dirname, '..', '.test-dist')
  : path.join(__dirname, '..', 'dist');
const app = require(path.join(distDirectory, 'app.js')).default;

test('the public cover endpoint refuses ids that point outside the covers folder', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    for (const id of [
      '..%2Faudible-cli%2Fprofile.json',
      '..%2F..%2Fpackage.json',
      '..%252Fbackups',
      '%2Fetc%2Fpasswd',
      'a%2F..%2F..%2Fdata',
    ]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/library/cover/${id}?w=640`);
      assert.equal(res.status, 400, `${id} -> ${res.status}`);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

// Loading the app starts timers (e.g. pairing-code cleanup) that would keep
// this test process alive.
test.after(() => setTimeout(() => process.exit(), 50));
