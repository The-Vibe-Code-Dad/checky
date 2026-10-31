const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {downloadRelease, downloadAsset} = require('../scripts/download-desktop-release.cjs');
const {signManifest} = require('../scripts/lib/desktop-update.cjs');
const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
const config = {repository:'example/checky', tag:'desktop-v1.2.3', version:'1.2.3'};
const bytes = Buffer.from('MZ-test-installer');
const manifest = signManifest({schemaVersion:2, version:'1.2.3', publishedAt:'2026-10-31T00:00:00Z',
  fileName:'checkys-list-1.2.3-x64.exe', downloadUrl:'/desktop-updates/checkys-list-1.2.3-x64.exe',
  sha256:crypto.createHash('sha256').update(bytes).digest('hex'), releaseNotes:'Test release'}, privateKey);
const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'checky-release-test-'));
function cleanup(dir) {
  for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
  fs.rmdirSync(dir);
}
const assets = (metadata=manifest, installer=bytes) => async url => new Response(url.endsWith('latest.json') ? JSON.stringify(metadata) : installer);

test('verified downloads stage only the selected installer and signed manifest', async () => {
  const outputDir = directory();
  try {
    fs.writeFileSync(path.join(outputDir, 'checkys-list-1.0.0-x64.exe'), 'old');
    const result = await downloadRelease({config, outputDir, fetchImpl:assets(), key:publicKey});
    assert.equal(result.version, config.version);
    assert.deepEqual(fs.readdirSync(outputDir).sort(), [manifest.fileName, 'latest.json']);
    assert.deepEqual(fs.readFileSync(path.join(outputDir, manifest.fileName)), bytes);
  } finally { cleanup(outputDir); }
});

test('tampering, mismatched versions, and unrelated staging files stop publication', async () => {
  const outputDir = directory();
  try {
    await assert.rejects(downloadRelease({config, outputDir, fetchImpl:assets({...manifest, sha256:'0'.repeat(64)}), key:publicKey}), /signature/);
    await assert.rejects(downloadRelease({config, outputDir, fetchImpl:assets(manifest, Buffer.from('modified')), key:publicKey}), /checksum/);
    const wrongVersion = signManifest({...manifest, version:'1.2.2'}, privateKey);
    await assert.rejects(downloadRelease({config, outputDir, fetchImpl:assets(wrongVersion), key:publicKey}), /selected desktop release/);
    assert.deepEqual(fs.readdirSync(outputDir), []);
    fs.writeFileSync(path.join(outputDir, 'private.key'), 'do not publish');
    await assert.rejects(downloadRelease({config, outputDir, fetchImpl:assets(), key:publicKey}), /unrelated files/);
    assert.deepEqual(fs.readdirSync(outputDir), ['private.key']);
  } finally { cleanup(outputDir); }
});

test('asset redirects stay on GitHub HTTPS hosts and downloads remain bounded', async () => {
  const first = 'https://github.com/example/checky/releases/download/desktop-v1.2.3/latest.json';
  const allowed = async url => url === first ? new Response(null, {status:302, headers:{location:'https://release-assets.githubusercontent.com/example/file'}}) : new Response('ok');
  assert.equal((await downloadAsset(first, 16, allowed)).toString(), 'ok');
  for (const location of ['http://release-assets.githubusercontent.com/file','https://example.com/file','https://user:secret@github.com/file']) {
    await assert.rejects(downloadAsset(first, 16, async () => new Response(null, {status:302, headers:{location}})), /approved GitHub HTTPS/);
  }
  await assert.rejects(downloadAsset(first, 4, async () => new Response('too large')), /size limit/);
});
