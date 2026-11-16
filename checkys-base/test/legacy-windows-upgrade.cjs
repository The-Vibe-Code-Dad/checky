// Drive the released Electron app on a disposable Windows runner and a loopback HTTPS feed.
const assert = require('node:assert/strict');
const {createHash, X509Certificate} = require('node:crypto');
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const {once} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const {chromium} = require(process.env.CHECKY_PLAYWRIGHT_MODULE);

async function main() {
  const [oldApp, dir] = process.argv.slice(2);
  const profile = path.join(dir, 'old-profile');
  const release = path.join(dir, 'feed');
  const manifest = JSON.parse(await fs.readFile(path.join(release, 'latest.json')));
  const installer = await fs.readFile(path.join(release, manifest.fileName));
  const cert = await fs.readFile(path.join(dir, 'cert.pem'));
  const spki = new X509Certificate(cert).publicKey.export({type:'spki',format:'der'});
  const user = {id:'tester000000001', email:'test@checky.invalid'};
  let scenario = 'normal', downloads = 0;
  const server = https.createServer({cert, key:await fs.readFile(path.join(dir, 'key.pem'))}, (req, res) => {
    const route = new URL(req.url, 'https://localhost').pathname;
    let body;
    if (route === '/desktop-updates/latest.json') {
      body = scenario === 'bad signature' ? {...manifest, releaseNotes:'tampered'} : manifest;
    } else if (route === manifest.downloadUrl) {
      downloads++;
      if (scenario === 'redirect') res.writeHead(302, {location:'/unexpected.exe'});
      if (!res.headersSent) res.setHeader('content-type', 'application/octet-stream');
      res.end(scenario === 'bad checksum' ? Buffer.from('altered') : installer);
      return;
    } else if (route.endsWith('/auth-with-password') || route.endsWith('/auth-refresh')) {
      body = {record:user, token:'disposable-test-token'};
    } else if (route === '/api/collections/users/records/' + user.id) {
      body = user;
    } else {
      res.writeHead(404).end(); return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let old;
  try {
    const data = path.join(profile, 'data');
    await fs.mkdir(data, {recursive:true});
    const checklist = {active:0,tabs:[{name:'My list',items:[{text:'Keep my local checklist',done:false}]}]};
    await fs.writeFile(path.join(data,'checkTabs.json'), JSON.stringify(checklist));
    await fs.writeFile(path.join(data,'settings.json'), JSON.stringify({hotkey:'Ctrl+Shift+F9',advanced:{
      serverUrl:'https://127.0.0.1:' + server.address().port, email:user.email, password:'test-only'
    }}));
    old = spawn(oldApp, ['--user-data-dir=' + profile, '--remote-debugging-port=0',
      '--ignore-certificate-errors-spki-list=' + createHash('sha256').update(spki).digest('base64')], {stdio:'ignore'});
    const exited = once(old, 'exit');
    let port;
    for (let i = 0; i < 120 && !port; i++) {
      if (old.exitCode !== null) throw Error('Old Checky exited before it opened');
      await delay(250);
      port = await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8').then(s => Number(s.split('\n')[0]), () => 0);
    }
    assert.ok(port, 'old desktop debugging port');
    const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    const context = browser.contexts()[0];
    const page = context.pages().find(p => p.url().startsWith('file:')) || context.pages()[0] || await context.waitForEvent('page');
    const offer = page.locator('#updateAvailableBtn');
    await offer.waitFor({timeout:45000});
    assert.match(await offer.getAttribute('title'), new RegExp(manifest.version.replaceAll('.', '\\.')));
    await page.evaluate(() => { window.confirm = message => { window.lastInstallPrompt = message; return false; }; });
    await offer.click();
    assert.match(await page.evaluate(() => window.lastInstallPrompt), /verify it, open the Windows installer, and close this app/i);
    assert.equal(downloads, 0, 'declining must not download an installer');
    const target = path.join(data, 'updates', manifest.fileName);
    for (const problem of ['bad signature', 'bad checksum', 'redirect']) {
      scenario = problem;
      const message = await page.evaluate(() => window.checkyApi.installUpdate().then(() => '', error => error.message));
      assert.ok(message, problem + ' must reject');
      if (problem !== 'redirect') assert.match(message, problem === 'bad signature' ? /signature/i : /checksum/i);
      await assert.rejects(fs.access(target), {code:'ENOENT'});
    }
    console.log('PASS released 1.0.8 shows the upgrade, honors cancel, rejects tampering and redirects');
    scenario = 'normal';
    await page.evaluate(() => { window.confirm = () => true; });
    await offer.click();
    await Promise.race([exited, delay(20000, undefined, {ref:false}).then(() => { throw Error('The old app did not hand off to Windows setup'); })]);
    assert.equal(old.exitCode, 0);
    assert.equal(createHash('sha256').update(await fs.readFile(target)).digest('hex'), manifest.sha256);
    assert.match(await fs.readFile(path.join(data,'checkTabs.json'),'utf8'), /Keep my local checklist/);
    console.log('PASS released 1.0.8 accepted the upgrade and exited with its checklist intact');
  } finally {
    if (old && old.exitCode === null) old.kill();
    server.closeAllConnections(); server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
