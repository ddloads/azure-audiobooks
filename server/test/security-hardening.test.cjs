const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const {
  getJwtSecret,
  getAllowedOrigins,
  isOriginAllowed,
} = require('../dist/utils/securityConfig.js');
const {
  resolveUploadTargetDir,
  resolveUploadedFileTarget,
  sanitizeUploadedFilename,
  isAllowedUploadFilename,
} = require('../dist/utils/uploadSafety.js');

test('getJwtSecret rejects missing or weak production secrets', () => {
  assert.throws(() => getJwtSecret({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(
    () => getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'super-secret-key-change-me' }),
    /JWT_SECRET/,
  );
  assert.throws(
    () => getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'development-only-jwt-secret-change-me-before-production' }),
    /JWT_SECRET/,
  );
  assert.throws(
    () => getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'short-secret' }),
    /JWT_SECRET/,
  );
  assert.equal(
    getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32) }),
    'a'.repeat(32),
  );
});

test('origin policy does not add development defaults in production', () => {
  const productionDefaults = getAllowedOrigins({ NODE_ENV: 'production' });
  assert.equal(productionDefaults.has('http://localhost:5173'), false);
  assert.equal(isOriginAllowed('http://localhost:5173', productionDefaults, 'production'), false);
});

test('origin policy allows private LAN origins only outside production', () => {
  const explicit = getAllowedOrigins({ CLIENT_ORIGIN: 'https://books.example.com' });
  assert.equal(isOriginAllowed('https://books.example.com', explicit, 'production'), true);
  assert.equal(isOriginAllowed('http://192.168.1.10:5173', explicit, 'production'), false);
  assert.equal(isOriginAllowed('http://192.168.1.10:5173', explicit, 'development'), true);
});

test('upload target paths cannot escape the library root', () => {
  const root = path.resolve('/library');
  assert.equal(resolveUploadTargetDir(root, 'Incoming'), path.join(root, 'Incoming'));
  assert.throws(() => resolveUploadTargetDir(root, '../outside'), /invalid|outside/i);
  assert.throws(() => resolveUploadTargetDir(root, '/tmp/outside'), /invalid|outside/i);

  const targetDir = resolveUploadTargetDir(root, 'Incoming');
  assert.equal(resolveUploadedFileTarget(root, targetDir, 'book.mp3'), path.join(targetDir, 'book.mp3'));
  assert.throws(() => resolveUploadedFileTarget(root, targetDir, '../evil.mp3'), /invalid|outside/i);
});

test('uploaded filenames are safe and restricted to expected audiobook assets', () => {
  assert.equal(sanitizeUploadedFilename('My Book.m4b'), 'My Book.m4b');
  assert.throws(() => sanitizeUploadedFilename('../evil.mp3'), /invalid/i);
  assert.throws(() => sanitizeUploadedFilename(''), /invalid/i);
  assert.equal(isAllowedUploadFilename('book.mp3'), true);
  assert.equal(isAllowedUploadFilename('cover.jpg'), true);
  assert.equal(isAllowedUploadFilename('shell.php'), false);
});
