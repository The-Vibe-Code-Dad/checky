// Local release preparation only. The private signing key never belongs in web/ or an image.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {signManifest, verifyManifest} = require('./lib/desktop-update.cjs');
const publicKey = require('./lib/update-public-key.json').publicKey;
const [installer, version, notes = '', keyPath = process.env.CHECKY_UPDATE_SIGNING_KEY] = process.argv.slice(2);
if (!installer || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version || '') || !keyPath) {
  throw new Error('Usage: node scripts/publish-desktop-update.cjs INSTALLER VERSION [NOTES] [PRIVATE_KEY_PATH]; or set CHECKY_UPDATE_SIGNING_KEY.');
}
const extension = path.extname(installer).toLowerCase();
if (!['.exe', '.msi'].includes(extension)) throw new Error('Choose an EXE or MSI installer.');
const fileName = `checkys-list-${version}-x64${extension}`;
const bytes = fs.readFileSync(installer);
if (!bytes.length || bytes.length > 500 * 1024 * 1024) throw new Error('Installer must be between 1 byte and 500 MB.');
const manifest = signManifest({schemaVersion: 2, version, publishedAt: new Date().toISOString(), fileName,
  downloadUrl: '/desktop-updates/' + fileName, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), releaseNotes: notes}, fs.readFileSync(keyPath));
verifyManifest(manifest, publicKey); // Reject the wrong key before copying any release files.
const dir = path.resolve(__dirname, '../web/desktop-updates');
fs.mkdirSync(dir, {recursive: true});
fs.writeFileSync(path.join(dir, fileName), bytes);
fs.writeFileSync(path.join(dir, 'latest.json.tmp'), JSON.stringify(manifest, null, 2) + '\n');
fs.renameSync(path.join(dir, 'latest.json.tmp'), path.join(dir, 'latest.json'));
console.log(`Published signed desktop update ${version}: ${fileName}`);
