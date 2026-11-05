// Real service workers across multiple deployments; disposable local PocketBase only.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { buildWeb } = require('../scripts/build-web.cjs');
const { chromium } = require(process.env.CHECKY_PLAYWRIGHT_MODULE || 'playwright');
const password = 'Disposable-PWA-Only-20261104!';
async function main() {
  if (!process.env.CHECKY_POCKETBASE_BINARY) throw Error('Set CHECKY_POCKETBASE_BINARY to a disposable test binary.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checky-pwa-'));
  let child, browser, server, log = '', activeBuild = 0, failAsset = false;
  const builds = [], versions = [];
  try {
    for (let i = 0; i < 3; i++) {
      const build = path.join(directory, 'build-' + i); builds.push(build);
      await fs.cp(path.join(__dirname, '../web'), build, { recursive: true, filter: source => path.basename(source) !== 'desktop-updates' });
      await fs.appendFile(path.join(build, 'renderer.js'), '\n// Deployment ' + i + '\n');
      versions.push(await buildWeb(build));
    }
    const reserve = http.createServer();
    await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
    const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
    const backend = 'http://127.0.0.1:' + port;
    child = spawn(process.env.CHECKY_POCKETBASE_BINARY, ['serve', '--automigrate=false', '--hooksWatch=false', '--http=127.0.0.1:' + port,
      '--dir=' + path.join(directory, 'data'), '--hooksDir=' + path.join(__dirname, '../pocketbase/pb_hooks'), '--migrationsDir=' + path.join(__dirname, '../pocketbase/pb_migrations')],
      { env: { ...process.env, CHECKY_PUBLIC_ORIGIN: '', CHECKY_CONFIG_FILE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    let healthy = false;
    for (let i = 0; i < 300; i++) {
      if (child.exitCode !== null) throw Error('Disposable PocketBase stopped: ' + log);
      try { if ((await fetch(backend + '/api/health')).ok) { healthy = true; break; } } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(healthy, 'Disposable PocketBase must start before the browser test');
    const setup = await fetch(backend + '/api/checkys-base/first-user', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pwa.invalid', password, passwordConfirm: password }) });
    assert.equal(setup.status, 200, await setup.text());
    server = http.createServer(async (req, res) => {
      if (req.url.startsWith('/api/')) {
        const upstream = http.request(new URL(req.url, backend), { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
        upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
      }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (failAsset && pathname === '/style.css') { res.writeHead(503); res.end(); return; }
      const root = builds[activeBuild], filename = path.join(root, pathname === '/' ? 'index.html' : pathname);
      if (!filename.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
      try {
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(filename)] || 'application/octet-stream';
        const contents = await fs.readFile(filename);
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(contents);
      } catch (_) { res.writeHead(404); res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ executablePath: process.env.CHECKY_CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    // Headless Chromium can reset its notification permission on navigation.
    // Keep permission granted here to test opt-in persistence, not push providers.
    await context.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'granted' }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.locator('#loginEmailInput').fill('admin@pwa.invalid');
    await page.locator('#loginPasswordInput').fill(password);
    await page.locator('#loginSubmitBtn').click();
    await page.locator('#loginOverlay').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !!state.currentChecklistId && !state.ui.syncInProgress);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(async () => {
      await caches.open('unrelated-test-cache');
      localStorage.setItem('checky-test-preference', 'keep');
      localStorage.setItem('checky-notifications-' + state.hostedSession.user.id, 'on');
    });
    await page.locator('#addItemBtn').click();
    await page.locator('#list textarea').fill('Keep this checklist');
    await page.evaluate(() => {
      const item = state.data.tabs[state.data.active].items[0];
      Object.assign(item, {reminderAt:new Date(Date.now()+4000).toISOString(), reminderRepeat:'daily', reminderTimeZone:'UTC', reminderDays:null});
      renderItems();
    });
    await page.locator('#list input[type="checkbox"]').check();
    await page.waitForFunction(() => !!state.data.tabs[state.data.active].items[0].reminderResetAt);
    await page.waitForFunction(() => !document.querySelector('#list input[type="checkbox"]').checked);
    assert.equal(await page.evaluate(() => state.data.tabs[state.data.active].items[0].done), true, 'Visual reset must not create a background write');
    await page.locator('#list textarea').click({ button: 'right' });
    await page.locator('#itemContextMenu').getByRole('button', {name:'Mark done', exact:true}).click();
    assert.equal(await page.locator('#list input[type="checkbox"]').isChecked(), true);
    assert.equal(await page.evaluate(() => state.data.tabs[state.data.active].items[0].reminderCheckedAt), null);
    await page.locator('#list input[type="checkbox"]').uncheck();
    console.log('PASS repeating checkbox acknowledgement, live automatic reset and permanent Mark done without an archive');
    const other = await context.newPage(); await other.goto(origin);
    await other.waitForFunction(() => !!state.currentChecklistId && !state.ui.syncInProgress);
    await other.locator('#list textarea').evaluate(el => { el.value = 'Other window draft'; });
    await page.bringToFront();
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    activeBuild = 1;
    // Resume the same installed-app document after a minute, without navigation.
    await page.evaluate(() => { const now = Date.now; Date.now = () => now() + 61000; document.dispatchEvent(new Event('visibilitychange')); });
    await page.locator('#appUpdateBanner').waitFor({ state: 'visible' });
    assert.equal(navigations, 0);
    assert.equal(await other.locator('#list textarea').inputValue(), 'Other window draft');
    assert.ok(await page.evaluate(() => caches.has('unrelated-test-cache')));
    if (process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, 'app-update-phone.png') });
    // The renderer blocks reload during an unfinished reminder dialog or sync.
    await page.locator('#list textarea').click({ button: 'right' });
    await page.locator('#itemContextMenu').getByRole('button', { name: 'Remind', exact: true }).click();
    assert.match(await page.evaluate(() => window.checkyPrepareForUpdate().then(() => 'unexpected', error => error.message)), /Finish the open/);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => { state.ui.syncInProgress = true; });
    await page.locator('#appUpdateApply').click();
    await page.waitForFunction(() => document.getElementById('appUpdateNotice').textContent.includes('current sync'));
    await page.evaluate(() => { state.ui.syncInProgress = false; window.testSaveChecklist = window.checkyStorage.saveChecklist; window.checkyStorage.saveChecklist = async () => { throw Error('Storage full'); }; });
    await page.locator('#appUpdateApply').click();
    await page.waitForFunction(() => document.getElementById('appUpdateNotice').textContent.includes('Could not save'));
    assert.equal(navigations, 0); assert.equal(await page.locator('#app').evaluate(el => el.inert), false);
    await page.evaluate(() => { window.checkyStorage.saveChecklist = window.testSaveChecklist; document.querySelector('#list textarea').value = 'Last edit before updating'; });
    await page.locator('#appUpdateApply').click();
    await page.waitForFunction(version => document.querySelector('script[src*="pwa.js"]')?.src.includes(version), versions[1]);
    await page.waitForFunction(() => !!state.currentChecklistId && !state.ui.syncInProgress);
    assert.equal(await page.locator('#list textarea').inputValue(), 'Last edit before updating');
    assert.equal(await page.locator('#loginOverlay').isVisible(), false);
    assert.equal(await page.locator('#appUpdateBanner').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('checky-test-preference')), 'keep');
    assert.equal(await page.evaluate(() => localStorage.getItem('checky-notifications-' + state.hostedSession.user.id)), 'on');
    assert.equal(await other.locator('#list textarea').inputValue(), 'Other window draft');
    assert.equal(navigations, 1);
    console.log('PASS foreground update detection, complete precache, explicit reload, save failure/sync/dialog guards, last edit, session/preferences and other open windows');
    await other.close();
    await page.locator('#navToggle').click(); await page.locator('#settingsToggle').click();
    await page.locator('#appUpdateCheck').click();
    await page.waitForFunction(() => document.getElementById('appUpdateStatus').textContent.includes('up to date'));
    activeBuild = 2; failAsset = true;
    await page.locator('#appUpdateCheck').click();
    await page.waitForFunction(() => document.getElementById('appUpdateStatus').textContent.includes('could not download'));
    assert.equal(await page.locator('#appUpdateBanner').isVisible(), false);
    await context.setOffline(true);
    await page.reload();
    assert.ok((await page.locator('script[src*="pwa.js"]').getAttribute('src')).includes(versions[1]));
    await page.evaluate(() => document.getElementById('appUpdateCheck').click());
    await page.waitForFunction(() => /offline|connection|connected/.test(document.getElementById('appUpdateStatus').textContent));
    assert.equal(await page.evaluate(() => localStorage.getItem('checky-test-preference')), 'keep');
    console.log('PASS failed shell download leaves the previous complete offline build usable; offline check gives feedback');
    // Return online on the existing build, then recover the failed deployment.
    activeBuild = 1; failAsset = false; await context.setOffline(false); await page.goto(origin);
    await page.waitForFunction(() => !!state.currentChecklistId && !state.ui.syncInProgress);
    activeBuild = 2;
    await page.locator('#navToggle').click(); await page.locator('#settingsToggle').click();
    await page.locator('#appUpdateCheck').click();
    await page.locator('#appUpdateBanner').waitFor({ state: 'visible' });
    await page.locator('#appUpdateApply').click();
    await page.waitForFunction(version => document.querySelector('script[src*="pwa.js"]')?.src.includes(version), versions[2]);
    await page.waitForFunction(() => !!state.currentChecklistId && !state.ui.syncInProgress);
    assert.equal(await page.locator('#appUpdateBanner').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS manual update check, recovery after failed deployment, and no repeat reload prompt');
  } catch (error) { console.error(log); throw error; }
  finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await fs.rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
