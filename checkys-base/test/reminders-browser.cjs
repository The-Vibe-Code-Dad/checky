// Use the disposable backend initialized by security-integration.cjs.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.CHECKY_PLAYWRIGHT_MODULE || 'playwright');
const backend = process.env.CHECKY_TEST_URL;
if (!backend || !['localhost', '127.0.0.1'].includes(new URL(backend).hostname)) throw Error('A disposable localhost backend is required.');
async function api(url, method, body, token) {
  const response = await fetch(backend + url, { method, headers: { 'Content-Type': 'application/json', Authorization: token || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
}
async function main() {
  const root = path.resolve(__dirname, '../web');
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      const upstream = http.request(new URL(req.url, backend), { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const filename = path.join(root, pathname === '/' ? 'index.html' : pathname);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
    try {
      let content = await fs.readFile(filename);
      if (pathname === '/service-worker.js') {
        // Capture the actual registered push handler for provider-free browser testing.
        content = Buffer.concat([Buffer.from("const originalAddListener = self.addEventListener.bind(self); self.addEventListener = (name, handler, options) => { if (name === 'push') self.checkyTestPushHandler = handler; originalAddListener(name, handler, options); };\n"), content]);
      }
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(filename)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }); res.end(content);
    } catch (_) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    const password = 'Test-Only-20261030-password';
    const admin = await api('/api/collections/_superusers/auth-with-password', 'POST', { identity: 'admin@security.invalid', password });
    const email = 'browser-' + Date.now() + '@security.invalid';
    const user = await api('/api/collections/users/records', 'POST', { email, password, passwordConfirm: password }, admin.token);
    browser = await chromium.launch({ executablePath: process.env.CHECKY_CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, hasTouch: true, timezoneId: 'America/New_York', permissions: ['notifications'] });
    const page = await context.newPage(); const errors = [];
    const touch = await context.newCDPSession(page);
    async function openReminder(hold = false, useTouch = false) {
      const item = page.locator('#list textarea').first();
      if (useTouch) {
        const bounds = await item.boundingBox();
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 30, y: bounds.y + 20 }] });
        await page.locator('#itemContextMenu').waitFor({ state: 'visible' });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else if (hold) {
        const bounds = await item.boundingBox();
        await page.mouse.move(bounds.x + 20, bounds.y + 20);
        await page.mouse.down();
        await page.locator('#itemContextMenu').waitFor({ state: 'visible' });
        await page.mouse.up();
      } else await item.click({ button: 'right' });
      const button = page.locator('#itemContextMenu').getByRole('button', { name: 'Remind', exact: true });
      if (useTouch) {
        const bounds = await button.boundingBox();
        const handle = await button.elementHandle();
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 30, y: bounds.y + 15 }] });
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        assert.equal(await handle.evaluate(element => element.isConnected), true, 'A viewport resize must keep the button receiving the tap');
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else await button.click();
      await page.locator('.reminder-dialog').waitFor({ state: 'visible' });
    }
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.locator('#loginEmailInput').fill(email);
    await page.locator('#loginPasswordInput').fill(password);
    await page.locator('#loginSubmitBtn').click();
    await page.locator('#loginOverlay').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !!state.currentChecklistId && !state.ui.syncInProgress);
    await page.locator('#addItemBtn').click();
    await page.locator('#list textarea').fill('Project meeting');
    assert.equal(await page.locator('.reminder-button').count(), 0);
    await openReminder(true);
    await page.locator('#reminderDateTime').fill('2030-03-10T10:30');
    assert.equal(await page.locator('#reminderRepeat').inputValue(), 'none');
    assert.deepEqual(await page.locator('#reminderRepeat option').allTextContents(), ['Does not repeat', 'Every day', 'Every week', 'Every month', 'Every year']);
    await page.locator('#reminderRepeat').selectOption('weekly');
    assert.equal(await page.getByRole('checkbox', { name: 'Sunday', exact: true }).isChecked(), true);
    await page.getByRole('checkbox', { name: 'Sunday', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Save and sync', exact: true }).click();
    assert.match(await page.locator('.reminder-dialog [role="alert"]').textContent(), /at least one day/);
    for (const day of ['Monday', 'Wednesday', 'Friday']) await page.getByRole('checkbox', { name: day, exact: true }).check();
    if (process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, 'reminder-desktop.png') });
    await page.getByRole('button', { name: 'Save and sync', exact: true }).click();
    await page.waitForFunction(() => !state.ui.syncInProgress);
    const record = await api('/api/collections/checklists/records/' + user.defaultChecklist, 'GET', undefined, admin.token);
    assert.equal(record.data.tabs[0].items[0].reminderAt, '2030-03-10T14:30:00.000Z');
    assert.equal(record.data.tabs[0].items[0].reminderRepeat, 'weekly');
    assert.equal(record.data.tabs[0].items[0].reminderTimeZone, 'America/New_York');
    assert.deepEqual(record.data.tabs[0].items[0].reminderDays, [1, 3, 5]);
    // Simulate an installed PWA with an older cached reminder module. New HTML
    // must request versioned assets, never combine that stale module with new code.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const cache = await caches.open('checkys-pwa-v12');
      await cache.put('./reminders.js', new Response('window.checkyReminders = undefined;', { headers: { 'Content-Type': 'text/javascript' } }));
    });
    await page.reload();
    await page.waitForFunction(() => !!state.currentChecklistId && !state.ui.syncInProgress);
    await openReminder();
    assert.equal(await page.locator('#reminderDateTime').inputValue(), '2030-03-10T10:30');
    assert.equal(await page.locator('#reminderRepeat').inputValue(), 'weekly');
    for (const day of ['Monday', 'Wednesday', 'Friday']) assert.equal(await page.getByRole('checkbox', { name: day, exact: true }).isChecked(), true);
    assert.equal(await page.getByRole('checkbox', { name: 'Sunday', exact: true }).isChecked(), false);
    await page.locator('#reminderDateTime').fill('2020-01-01T12:00');
    await page.getByRole('button', { name: 'Save and sync', exact: true }).click();
    assert.match(await page.locator('.reminder-dialog [role="alert"]').textContent(), /future/);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await openReminder(true, true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'reminderDialogTitle');
    await page.locator('#reminderDateTime').fill('2030-03-10T10:30');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, 'reminder-phone.png') });
    await page.locator('#reminderRepeat').selectOption('monthly');
    assert.equal(await page.locator('.reminder-days').isVisible(), false);
    await page.getByRole('button', { name: 'Remove reminder', exact: true }).click();
    await page.waitForFunction(() => !state.ui.syncInProgress);
    const removed = await api('/api/collections/checklists/records/' + user.defaultChecklist, 'GET', undefined, admin.token);
    assert.equal(removed.data.tabs[0].items[0].reminderAt, null);
    assert.equal(removed.data.tabs[0].items[0].reminderRepeat, 'none');
    assert.equal(removed.data.tabs[0].items[0].reminderTimeZone, null);
    assert.equal(removed.data.tabs[0].items[0].reminderDays, null);
    await page.locator('#list input[type="checkbox"]').check();
    await page.locator('#list textarea').click({ button: 'right' });
    assert.equal(await page.locator('#itemContextMenu').getByRole('button', { name: 'Remind', exact: true }).isDisabled(), true);
    await page.locator('.title').click();
    await page.locator('#navToggle').click();
    await page.locator('#settingsToggle').click();
    await page.evaluate(() => { Notification.requestPermission = async () => 'denied'; });
    await page.locator('#notificationsToggle').click();
    await page.waitForFunction(() => document.getElementById('notificationsStatus').textContent.includes('not allowed'));
    const config = await page.evaluate(async () => (await fetch('/api/checkys-base/push')).json());
    assert.equal(typeof config.publicKey, 'string'); assert.ok(config.publicKey.length > 80);
    assert.deepEqual(errors, []);
    console.log('PASS mouse/touch hold menu, resize during tap, selected weekdays, sync/reload, stale PWA cache, timezone, validation, removal, phone layout and permission feedback');
    // Exercise the registered push handler against the real notification API after
    // unloading Checky; network push-provider delivery is intentionally simulated.
    await context.grantPermissions(['notifications'], { origin });
    await page.evaluate(() => navigator.serviceWorker.ready);
    const worker = context.serviceWorkers()[0];
    assert.ok(worker);
    await page.goto('about:blank');
    if (await worker.evaluate(() => Notification.permission) !== 'granted') {
      console.log('SKIP native closed-app notification: this headless browser does not grant notification permission to an unloaded origin. The service-worker unit test covers the push handler.');
      return;
    }
    const notifications = await worker.evaluate(async () => {
      let pending;
      self.checkyTestPushHandler({
        data: { json: () => ({ body: 'Closed app reminder', tag: 'closed-app-test', url: '/' }) },
        waitUntil: promise => { pending = promise; }
      });
      await pending;
      return (await self.registration.getNotifications()).map(notice => ({ title: notice.title, body: notice.body }));
    });
    assert.ok(notifications.some(item => item.body === 'Closed app reminder'));
    console.log('PASS real service worker notification API with Checky unloaded (push-provider event simulated)');
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
