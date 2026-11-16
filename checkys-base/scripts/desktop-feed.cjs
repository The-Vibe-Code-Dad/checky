// Prepare the small, signed feed for web images without a bundled installer.
const fs = require('node:fs/promises');
const path = require('node:path');
const {readRelease} = require('./download-desktop-release.cjs');

async function main() {
  const [directory, caddyFile] = process.argv.slice(2);
  const config = require('../desktop-release.json');
  const {fileName, manifestBytes} = await readRelease(config);
  await fs.mkdir(directory, {recursive:true});
  await fs.writeFile(path.join(directory, 'latest.json'), manifestBytes);
  await fs.writeFile(caddyFile, `import desktop_release ${config.repository} ${config.tag} ${fileName}\n`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
