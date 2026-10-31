const crypto = require('node:crypto');
const FIELDS = ['schemaVersion', 'version', 'publishedAt', 'fileName', 'downloadUrl', 'sha256', 'releaseNotes'];
function signedBytes(manifest) {
  if (!manifest || manifest.schemaVersion !== 2) throw new Error('A signed desktop update manifest is required.');
  const canonical = {};
  for (const name of FIELDS) {
    if (name !== 'schemaVersion' && typeof manifest[name] !== 'string') throw new Error('Invalid update manifest field: ' + name);
    canonical[name] = manifest[name];
  }
  return Buffer.from(JSON.stringify(canonical), 'utf8');
}
function verifyManifest(manifest, publicKey) {
  const bytes = signedBytes(manifest);
  if (typeof manifest.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(manifest.signature) ||
      !crypto.verify(null, bytes, publicKey, Buffer.from(manifest.signature, 'base64'))) {
    throw new Error('The desktop update signature is invalid. The installer was not opened.');
  }
  return manifest;
}
function signManifest(manifest, privateKey) {
  return { ...manifest, signature: crypto.sign(null, signedBytes(manifest), privateKey).toString('base64') };
}
function requireHttps(url, origin) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (origin && parsed.origin !== origin)) {
    throw new Error('Desktop updates require HTTPS on the connected Checky Base server.');
  }
  return parsed;
}
async function readBoundedBody(response, maxBytes) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new Error('The update download exceeds the size limit.');
  if (!response.body) throw new Error('The update response is empty.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('The update download exceeds the size limit.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
module.exports = { verifyManifest, signManifest, requireHttps, readBoundedBody };
