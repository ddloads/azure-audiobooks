const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const distDirectory = fs.existsSync(path.join(__dirname, '..', '.test-dist'))
  ? path.join(__dirname, '..', '.test-dist')
  : path.join(__dirname, '..', 'dist');
const { findUsableInvite, hashInviteToken } = require(path.join(distDirectory, 'utils', 'invites.js'));

test('invite tokens are stored as a stable sha256 hash, never as-is', () => {
  const token = 'abcdefghijklmnopqrstuvwxyz012345';
  const hash = hashInviteToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashInviteToken(token), hash);
  assert.notEqual(hash, token);
  assert.notEqual(hashInviteToken(`${token}x`), hash);
});

test('malformed invite tokens are rejected without a database lookup', async () => {
  assert.equal(await findUsableInvite(undefined), null);
  assert.equal(await findUsableInvite(42), null);
  assert.equal(await findUsableInvite('short'), null);
  assert.equal(await findUsableInvite('x'.repeat(129)), null);
});
