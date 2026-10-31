const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {verifyManifest, readBoundedBody} = require('./lib/desktop-update.cjs');
const {publicKey} = require('./lib/update-public-key.json');
const RELEASE_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const baseDir = path.resolve(__dirname, '..');

async function downloadAsset(url, limit, fetchImpl) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !RELEASE_HOSTS.has(parsed.hostname)) {
      throw new Error('Release downloads must use the approved GitHub HTTPS asset hosts.');
    }
    const response = await fetchImpl(parsed.toString(), {redirect:'manual', signal:AbortSignal.timeout(180000)});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location');
      if (response.body) await response.body.cancel();
      if (!next) throw new Error('Release redirect did not include a destination.');
      url = new URL(next, parsed).toString();
      continue;
    }
    if (!response.ok) throw new Error('Release asset download failed (HTTP ' + response.status + ').');
    return readBoundedBody(response, limit);
  }
  throw new Error('Too many release asset redirects.');
}

async function downloadRelease({config, outputDir, fetchImpl = fetch, key = publicKey}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository || '') ||
      !/^\d+\.\d+\.\d+$/.test(config.version || '') || config.tag !== 'desktop-v' + config.version) {
    throw new Error('Invalid desktop release selection.');
  }
  const root = 'https://github.com/' + config.repository + '/releases/download/' + config.tag + '/';
  const manifestBytes = await downloadAsset(root + 'latest.json', 64 * 1024, fetchImpl);
  const manifest = verifyManifest(JSON.parse(manifestBytes.toString('utf8')), key);
  const fileName = 'checkys-list-' + config.version + '-x64.exe';
  if (manifest.version !== config.version || manifest.fileName !== fileName ||
      manifest.downloadUrl !== '/desktop-updates/' + fileName || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error('Signed manifest does not match the selected desktop release.');
  }
  const installer = await downloadAsset(root + fileName, 500 * 1024 * 1024, fetchImpl);
  if (!installer.length || crypto.createHash('sha256').update(installer).digest('hex') !== manifest.sha256) {
    throw new Error('Installer checksum does not match the signed release manifest.');
  }
  // This staging directory is dedicated to release files and becomes the entire
  // with-app Docker build context. Refuse unrelated files instead of publishing them.
  fs.mkdirSync(outputDir, {recursive:true});
  const existing = fs.readdirSync(outputDir);
  for (const name of existing) {
    if ((name !== 'latest.json' && !/^checkys-list-\d+\.\d+\.\d+-x64\.exe$/.test(name)) ||
        !fs.lstatSync(path.join(outputDir, name)).isFile()) {
      throw new Error('The release staging directory contains unrelated files. Use a dedicated empty directory.');
    }
  }
  fs.writeFileSync(path.join(outputDir, fileName), installer);
  fs.writeFileSync(path.join(outputDir, 'latest.json'), manifestBytes);
  for (const name of existing) {
    if (name !== fileName && name !== 'latest.json') fs.unlinkSync(path.join(outputDir, name));
  }
  return {version:manifest.version, fileName, bytes:installer.length};
}

if (require.main === module) {
  const config = JSON.parse(fs.readFileSync(path.join(baseDir, 'desktop-release.json'), 'utf8'));
  const outputDir = path.resolve(process.argv[2] || path.join(baseDir, '.desktop-release'));
  downloadRelease({config, outputDir}).then(result => {
    console.log('Verified desktop release ' + result.version + ': ' + result.fileName + ' (' + result.bytes + ' bytes)');
    console.log('Release staging directory: ' + outputDir);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = {downloadRelease, downloadAsset};
