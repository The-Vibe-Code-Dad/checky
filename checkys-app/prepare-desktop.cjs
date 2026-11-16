// Package the canonical web source. Release files and private backups are never inputs.
const fs = require('node:fs/promises');
const path = require('node:path');
const { buildWeb } = require('../checkys-base/scripts/build-web.cjs');
async function prepare() {
  const web = path.join(__dirname, '../checkys-base/web');
  const out = path.join(__dirname, 'native-web');
  const icons = path.join(__dirname, 'src-tauri/icons');
  await fs.rm(out, {recursive:true, force:true});
  await fs.mkdir(out, {recursive:true});
  for (const entry of await fs.readdir(web, {withFileTypes:true})) {
    if (entry.isFile() && /\.(?:js|css|html|json|webmanifest|wav|png)$/.test(entry.name)) {
      await fs.copyFile(path.join(web, entry.name), path.join(out, entry.name));
    }
  }
  await buildWeb(out);
  await fs.cp(path.join(__dirname, 'native-ui'), out, {recursive:true});
  await fs.mkdir(icons, {recursive:true});
  await fs.copyFile(path.join(__dirname, 'build/icon.ico'), path.join(icons, 'icon.ico'));
  const png = await fs.readFile(path.join(web, 'icon-512.png'));
  await fs.writeFile(path.join(icons,'icon.png'), png);
  // Apple ICNS container with its standard 512px PNG representation.
  const header = Buffer.alloc(16);
  header.write('icns'); header.writeUInt32BE(16 + png.length, 4);
  header.write('ic09', 8); header.writeUInt32BE(8 + png.length, 12);
  await fs.writeFile(path.join(icons,'icon.icns'), Buffer.concat([header, png]));
}
prepare().catch(error => { console.error(error); process.exitCode = 1; });
