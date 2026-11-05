// Stamp a COPY of web/ with a deterministic version of all runtime source files.
// Docker supplies an isolated output directory; no dependencies or network needed.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
async function buildWeb(directory) {
  const files = [];
  async function walk(relative = '') {
    for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (name === 'desktop-updates') continue;
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) files.push(name);
      else throw new Error('Web source must not include symlinks: ' + name);
    }
  }
  await walk(); files.sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file + '\0').update(await fs.readFile(path.join(directory, file))).update('\0');
  const version = hash.digest('hex').slice(0, 24);
  for (const file of ['index.html', 'pwa.js', 'service-worker.js', 'version.json']) {
    const target = path.join(directory, file), source = await fs.readFile(target, 'utf8');
    if (!source.includes('__CHECKY_BUILD__')) throw new Error('Build an unstamped copy of web/: ' + file);
    await fs.writeFile(target, source.replaceAll('__CHECKY_BUILD__', version));
  }
  return version;
}
module.exports = { buildWeb };
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Supply the copied web output directory.');
  buildWeb(path.resolve(process.argv[2])).then(version => console.log('Checky web build: ' + version)).catch(error => { console.error(error); process.exitCode = 1; });
}
