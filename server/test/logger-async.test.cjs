const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('application logger does not use blocking appendFileSync writes on log calls', async () => {
  const originalAppendFileSync = fs.appendFileSync;
  const originalCwd = process.cwd();
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'azure-logger-'));
  const loggerModulePath = require.resolve('../dist/lib/logger.js');
  delete require.cache[loggerModulePath];

  fs.appendFileSync = () => {
    throw new Error('appendFileSync should not be called by logger writes');
  };

  try {
    process.chdir(tempCwd);
    const { createLogger } = require('../dist/lib/logger.js');
    assert.doesNotThrow(() => {
      createLogger('test').info('async logger smoke test', { token: 'secret-token' });
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.appendFileSync = originalAppendFileSync;
    process.chdir(originalCwd);
    delete require.cache[loggerModulePath];
    fs.rmSync(tempCwd, { recursive: true, force: true });
  }
});

test('listLogs reads log files without blocking fs sync APIs', async () => {
  const originalReaddirSync = fs.readdirSync;
  const originalReadFileSync = fs.readFileSync;
  const originalCwd = process.cwd();
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'azure-log-list-'));
  const loggerModulePath = require.resolve('../dist/lib/logger.js');
  delete require.cache[loggerModulePath];

  try {
    process.chdir(tempCwd);
    const logDir = path.join(tempCwd, 'data', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, 'app-2026-01-01.log'),
      JSON.stringify({
        level: 'info',
        timestamp: '2026-01-01T00:00:00.000Z',
        context: 'test',
        message: 'async list smoke',
      }) + '\n',
    );

    const { listLogs } = require('../dist/lib/logger.js');

    fs.readdirSync = () => {
      throw new Error('readdirSync should not be called by listLogs');
    };
    fs.readFileSync = () => {
      throw new Error('readFileSync should not be called by listLogs');
    };

    const result = await listLogs({ search: 'async list smoke' });
    assert.strictEqual(result.totalMatching, 1);
    assert.strictEqual(result.entries[0].message, 'async list smoke');
  } finally {
    fs.readdirSync = originalReaddirSync;
    fs.readFileSync = originalReadFileSync;
    process.chdir(originalCwd);
    delete require.cache[loggerModulePath];
    fs.rmSync(tempCwd, { recursive: true, force: true });
  }
});
