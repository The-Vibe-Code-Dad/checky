const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {signManifest, verifyManifest, requireHttps, readBoundedBody} = require('../lib/desktop-update.cjs');
const auth = require('../renderer/auth-client.js');
const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
const manifest = {schemaVersion: 2, version: '1.0.7', publishedAt: '2026-10-30T00:00:00Z', fileName: 'checkys-list-1.0.7-x64.exe',
  downloadUrl: '/desktop-updates/checkys-list-1.0.7-x64.exe', sha256: 'a'.repeat(64), releaseNotes: 'Security update'};
test('signed update accepts the release key and rejects every tampered field', () => {
  const signed = signManifest(manifest, privateKey);
  assert.equal(verifyManifest(signed, publicKey).version, manifest.version);
  for (const key of Object.keys(manifest)) assert.throws(() => verifyManifest({...signed, [key]: key === 'schemaVersion' ? 1 : signed[key] + 'x'}, publicKey));
  assert.throws(() => verifyManifest(signed, crypto.generateKeyPairSync('ed25519').publicKey));
  assert.throws(() => verifyManifest(manifest, publicKey));
});
test('updates reject HTTP, credentials, and another origin', () => {
  assert.equal(requireHttps('https://base.example/update.exe', 'https://base.example').protocol, 'https:');
  for (const url of ['http://base.example/update.exe','https://other.example/update.exe','https://user:pass@base.example/update.exe']) assert.throws(() => requireHttps(url,'https://base.example'));
});
test('download limit stops a chunked response before buffering the whole installer', async () => {
  let cancelled = false;
  const body = new ReadableStream({start(c) { c.enqueue(new Uint8Array(20)); },cancel() {cancelled=true;}});
  await assert.rejects(readBoundedBody(new Response(body),10),/size limit/);
  assert.equal(cancelled,true);
  assert.equal((await readBoundedBody(new Response('ok'),10)).toString(),'ok');
});
test('shared authentication completes native MFA and never treats a challenge as a token', async () => {
  const calls = [];
  const result = await auth.authenticate(async (url, body) => {
    calls.push({url,body});
    if (url.endsWith('auth-with-password')) throw Object.assign(new Error('MFA'),{payload:{mfaId:'challenge'}});
    if (url.endsWith('request-otp')) return {otpId:'otp'};
    assert.deepEqual(body,{otpId:'otp',password:'12345678',mfaId:'challenge'});
    return {token:'complete',record:{id:'user'}};
  },'person@example.com','secret',async ()=>'12345678');
  assert.equal(result.token,'complete'); assert.equal(calls.length,3);
  await assert.rejects(auth.authenticate(async()=>{throw new Error('Account blocked');},'u','p',async()=>{throw new Error('should not run');}),/Account blocked/);
});
test('Base and desktop use identical auth and signing protocols', () => {
  for (const [base,desktop] of [['web/auth-client.js','renderer/auth-client.js'],['scripts/lib/desktop-update.cjs','lib/desktop-update.cjs'],['scripts/lib/update-public-key.json','lib/update-public-key.json']]) {
    assert.equal(fs.readFileSync(path.join(__dirname,'../../checkys-base',base),'utf8'),fs.readFileSync(path.join(__dirname,'..',desktop),'utf8'));
  }
});
