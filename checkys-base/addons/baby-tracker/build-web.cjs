// Stamp an isolated copy of this add-on, independently of the Base app build.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
async function buildAddon(directory) {
  const files = (await fs.readdir(directory)).sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file + '\0').update(await fs.readFile(path.join(directory, file))).update('\0');
  const html = path.join(directory, 'index.html');
  const source = await fs.readFile(html, 'utf8');
  if (!source.includes('__CHECKY_BUILD__')) throw Error('Build an unstamped copy of the add-on web directory.');
  const version = hash.digest('hex').slice(0, 24);
  await fs.writeFile(html, source.replaceAll('__CHECKY_BUILD__', version));
  return version;
}
module.exports = { buildAddon };
if (require.main === module) {
  if (!process.argv[2]) throw Error('Supply the copied add-on web directory.');
  buildAddon(path.resolve(process.argv[2])).then(version => console.log('Baby tracker build: ' + version)).catch(error => { console.error(error); process.exitCode = 1; });
}
