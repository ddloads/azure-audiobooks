const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('APK publication is monotonic, atomic, idempotent, and never cached', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'azure-apk-'));
  const original = process.cwd();
  process.chdir(root);
  const controller = require(path.join(__dirname, '../.test-dist/controllers/mobileAppController.js'));
  const response = () => ({ code: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(n) {this.code=n; return this;}, json(v) {this.body=v;}, download(...args) {this.downloadArgs=args;} });
  const publish = async (code, bytes, version='1.0.12', extra={}) => {
    const temp = path.join(root, crypto.randomUUID());
    await fs.writeFile(temp, bytes);
    const res = response();
    await controller.publishMobileApp({file:{path:temp,originalname:'untrusted.apk'},body:{version,versionCode:code,...extra}},res);
    await assert.rejects(fs.access(temp));
    return res;
  };
  const latest = async () => {const res=response(); await controller.getLatestMobileApp({},res); return res;};
  try {
    assert.equal((await publish('14garbage','bad')).code,400);
    assert.equal((await publish('14','bad','1.0.12',{sha256:'wrong'})).code,400);
    const first=await publish('14','first');
    assert.equal(first.code,200);
    assert.equal(first.body.sha256,crypto.createHash('sha256').update('first').digest('hex'));
    assert.equal((await publish('13','older')).code,409);
    assert.equal((await publish('15','older version','1.0.11')).code,409);
    assert.equal((await publish('14','different')).code,409);
    assert.equal((await publish('14','first')).code,200);
    const old=response(); await controller.downloadLatestMobileApp({query:{build:'14'}},old);
    assert.equal((await publish('15','second')).code,200);
    assert.equal(await fs.readFile(old.downloadArgs[0],'utf8'),'first');
    const mismatch=response(); await controller.downloadLatestMobileApp({query:{build:'14'}},mismatch);
    assert.equal(mismatch.code,409);
    const current=response(); await controller.downloadLatestMobileApp({query:{build:['15','15']}},current);
    assert.equal(await fs.readFile(current.downloadArgs[0],'utf8'),'second');
    assert.match(current.headers['Cache-Control'],/no-store/);
    assert.equal(current.downloadArgs[2].cacheControl,false);
    const manifest=await latest();
    assert.equal(manifest.body.versionCode,15);
    assert.match(manifest.headers['Cache-Control'],/no-store/);
    assert.equal(manifest.body.storageFile,undefined);
    assert.match(manifest.body.downloadUrl,/build=15/);
    const simultaneous=await Promise.all([publish('16','third'),publish('17','fourth')]);
    assert.ok(simultaneous.some(r=>r.code===200));
    assert.ok(simultaneous.every(r=>r.code===200 || r.code===409));
    const after=await latest();
    const download=response(); await controller.downloadLatestMobileApp({query:{}},download);
    const hash=crypto.createHash('sha256').update(await fs.readFile(download.downloadArgs[0])).digest('hex');
    assert.equal(after.body.sha256,hash);
    // A corrupt manifest fails closed, preserving all published bytes.
    await fs.writeFile(path.join(root,'data/mobile/azure-player-latest.json'),'{broken');
    assert.equal((await publish('18','bad')).code,500);
  } finally { process.chdir(original); await fs.rm(root,{recursive:true,force:true}); }
});
