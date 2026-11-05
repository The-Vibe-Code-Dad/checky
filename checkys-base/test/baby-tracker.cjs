// Real disposable PocketBase + Chromium. No existing installation or data used.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require(process.env.CHECKY_PLAYWRIGHT_MODULE || 'playwright');
const { buildWeb } = require('../scripts/build-web.cjs');
const { buildAddon } = require('../addons/baby-tracker/build-web.cjs');
const addon = path.join(__dirname, '../addons/baby-tracker');
const amounts = require('../addons/baby-tracker/web/amounts.js');
const password = 'Disposable-Baby-Tracker-20261105!';
const seed = { occurredAt: '2026-11-05T12:30:00.000Z', breastMilkMl: 60, formulaMl: null, feedingNotes: 'After waking', pee: true, peeNotes: 'Wet diaper', poop: false, poopNotes: '' };
async function main() {
  if (!process.env.CHECKY_POCKETBASE_BINARY) throw Error('Set CHECKY_POCKETBASE_BINARY to the test binary.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'checky-baby-'));
  let child, server, browser, log = '';
  const reserve = http.createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  let ip = 1;
  async function req(route, method = 'GET', body, token, expected = 200, headers = {}) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', 'X-Checky-Client-IP': '198.51.100.' + (ip++ % 240 + 1), ...(token ? { Authorization: token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    assert.equal(response.status, expected, method + ' ' + route + ': ' + JSON.stringify(result)); return result;
  }
  async function startBackend(installed) {
    child = spawn(process.env.CHECKY_POCKETBASE_BINARY, ['serve', '--automigrate=false', '--http=127.0.0.1:' + port, '--dir=' + path.join(dir, 'data'),
      '--hooksDir=' + (installed ? path.join(dir, 'backend/pb_hooks') : path.join(__dirname, '../pocketbase/pb_hooks')), '--migrationsDir=' + (installed ? path.join(dir, 'backend/pb_migrations') : path.join(__dirname, '../pocketbase/pb_migrations'))],
    { env: { ...process.env, CHECKY_TRUST_PROXY: 'true', CHECKY_PUBLIC_ORIGIN: '', CHECKY_CONFIG_FILE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    let ready = false;
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null) throw Error('Backend stopped: ' + log);
      try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, log);
  }
  async function stopBackend() {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  }
  try {
    for (const folder of ['pb_hooks', 'pb_migrations']) {
      await fs.cp(path.join(__dirname, '../pocketbase', folder), path.join(dir, 'backend', folder), { recursive: true });
      await fs.cp(path.join(addon, 'pocketbase', folder), path.join(dir, 'backend', folder), { recursive: true });
    }
    await startBackend(false);
    await req('/api/checkys-base/first-user', 'POST', { email: 'admin@baby.invalid', password, passwordConfirm: password });
    const admin = await req('/api/collections/_superusers/auth-with-password', 'POST', { identity: 'admin@baby.invalid', password });
    await req('/api/checkys-base/baby/status', 'GET', undefined, admin.token, 404);
    await req('/api/collections/checky_baby_entries/records', 'GET', undefined, admin.token, 404);
    console.log('PASS standard backend has no Baby tracker routes or collection');
    await stopBackend(); await startBackend(true);
    const users = [], tokens = [];
    for (let i = 0; i < 3; i++) {
      const user = await req('/api/collections/users/records', 'POST', { email: 'caregiver' + i + '@baby.invalid', password, passwordConfirm: password }, admin.token);
      users.push(user);
      tokens.push((await req('/api/collections/users/auth-with-password', 'POST', { identity: user.email, password })).token);
    }
    const shared = await req('/api/collections/shared_checklists/records', 'POST', { owner: users[0].id, sharedWith: [users[1].id], shareKey: 'baby-shared', name: 'Baby log', version: 1, data: { active: 0, tabs: [{ name: 'Shopping', items: [{ text: 'Keep regular tasks', done: false }] }] } }, admin.token);
    for (const user of users.slice(0, 2)) await req('/api/collections/users/records/' + user.id, 'PATCH', { assignedSharedChecklist: shared.id }, admin.token);
    const ref = 'shared_checklists:' + shared.id, endpoint = '/api/checkys-base/baby/entries';
    await req('/api/checkys-base/baby/lists', 'GET', undefined, undefined, 401);
    const available = await req('/api/checkys-base/baby/lists', 'GET', undefined, tokens[1]);
    assert.ok(available.items.some(item => item.ref === ref && item.writable));
    assert.equal(available.preferred, ref);
    const created = await req(endpoint, 'POST', { list: ref, requestId: 'unique-create-request-0001', entry: seed }, tokens[0]);
    const retried = await req(endpoint, 'POST', { list: ref, requestId: 'unique-create-request-0001', entry: seed }, tokens[0]);
    assert.equal(retried.id, created.id, 'Retry after a lost response must not duplicate an entry');
    assert.deepEqual(created.entry, seed);
    const read = await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1]);
    assert.equal(read.items[0].id, created.id);
    const edited = await req(endpoint + '/' + created.id, 'PATCH', { version: 1, entry: { ...seed, formulaMl: 30 } }, tokens[1]);
    assert.equal(edited.version, 2);
    await req(endpoint + '/' + created.id, 'PATCH', { version: 1, entry: seed }, tokens[0], 409);
    await req(endpoint + '/' + created.id, 'DELETE', { version: 1 }, tokens[0], 409);
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const route = method === 'GET' ? endpoint + '?list=' + ref : ['PATCH', 'DELETE'].includes(method) ? endpoint + '/' + created.id : endpoint;
      const body = method === 'GET' ? undefined : { list: ref, requestId: 'unauthorized-request-0001', entry: seed, version: 2 };
      await req(route, method, body, tokens[2], 404);
    }
    await req('/api/collections/checky_baby_entries/records', 'POST', { requestId: 'direct-bypass-attempt' }, tokens[0], 403);
    await req('/api/collections/checky_baby_entries/records/' + created.id, 'PATCH', { version: 3 }, tokens[0], 403);
    for (const entry of [{ ...seed, breastMilkMl: -1 }, { ...seed, occurredAt: 'invalid' }, { ...seed, formulaMl: '2' }, { ...seed, peeNotes: 'x'.repeat(2001) }, { ...seed, pee: 'true' }]) {
      await req(endpoint, 'POST', { list: ref, requestId: crypto.randomUUID(), entry }, tokens[0], 400);
    }
    await req(endpoint, 'POST', { list: ref, requestId: crypto.randomUUID(), entry: seed }, tokens[0], 403, { Origin: 'https://forged.invalid' });
    const personal = 'checklists:' + users[0].defaultChecklist;
    const privateEntry = await req(endpoint, 'POST', { list: personal, requestId: crypto.randomUUID(), entry: seed }, tokens[0]);
    await req(endpoint + '?list=' + personal, 'GET', undefined, tokens[1], 404);
    // Same timestamps still paginate without gaps or duplicates.
    for (let i = 0; i < 51; i++) await req(endpoint, 'POST', { list: personal, requestId: crypto.randomUUID(), entry: seed }, tokens[0]);
    const first = await req(endpoint + '?list=' + personal, 'GET', undefined, tokens[0]);
    const second = await req(endpoint + '?list=' + personal + '&before=' + first.items.at(-1).id, 'GET', undefined, tokens[0]);
    assert.equal(first.items.length, 50); assert.equal(first.more, true); assert.equal(second.items.length, 2); assert.equal(second.more, false);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 52);
    await req(endpoint + '?list=' + ref + '&before=' + privateEntry.id, 'GET', undefined, tokens[1], 400);
    const parent = await req('/api/collections/shared_checklists/records/' + shared.id, 'GET', undefined, admin.token);
    assert.equal(parent.data.tabs[0].items[0].text, 'Keep regular tasks'); assert.equal(parent.version, 1);
    console.log('PASS shared/personal access, validation, idempotent saves, conflict protection, stable pagination and unchanged checklist JSON');

    const root = path.join(dir, 'web');
    await fs.cp(path.join(__dirname, '../web'), root, { recursive: true, filter: source => path.basename(source) !== 'desktop-updates' });
    await buildWeb(root);
    server = http.createServer(async (req, res) => {
      if (req.url.startsWith('/api/')) {
        const upstream = http.request(new URL(req.url, base), { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
        upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
      }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const filename = path.join(root, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
      if (!filename.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
      try {
        const data = await fs.readFile(filename);
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }[path.extname(filename)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(data);
      } catch (_) { res.writeHead(404); res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ executablePath: process.env.CHECKY_CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox'], downloadsPath: path.join(dir, 'downloads') });
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, timezoneId: 'America/New_York' });
    await context.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.locator('#loginEmailInput').fill(users[0].email); await page.locator('#loginPasswordInput').fill(password); await page.locator('#loginSubmitBtn').click();
    await page.locator('#loginOverlay').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => typeof state !== 'undefined' && !!state.currentChecklistId && !state.ui.syncInProgress);
    await page.locator('#navToggle').click();
    assert.equal(await page.locator('[data-addon-id="baby-tracker"]').count(), 0, 'Standard web installation has no Baby tracker');
    assert.equal(await page.locator('#enableBabyTracker').count(), 0, 'Installing is not a built-in Settings toggle');
    assert.equal((await fetch(origin + '/baby/')).status, 404);
    await fs.cp(path.join(addon, 'web'), path.join(root, 'baby'), { recursive: true });
    await buildAddon(path.join(root, 'baby'));
    await fs.copyFile(path.join(addon, 'addons.json'), path.join(root, 'addons.json'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.locator('[data-addon-id="baby-tracker"]').click();
    await page.waitForURL('**/baby/**'); await page.locator('.entry').first().waitFor();
    assert.equal(await page.locator('#listPicker').inputValue(), ref);
    await page.locator('#addEntry').click();
    assert.equal(await page.locator('#occurredAt').inputValue().then(value => value.length), 16);
    await page.locator('#saveEntry').click(); assert.match(await page.locator('#editorError').textContent(), /Add a feeding/);
    await page.locator('#occurredAt').fill('2026-11-05T10:15');
    await page.locator('#breastMilk').fill('60'); await page.locator('#formula').fill('30');
    await page.locator('#entryUnits').selectOption('oz');
    assert.equal(await page.locator('#breastMilk').inputValue(), amounts.fromMl(60, 'oz'));
    for (let i = 0; i < 3; i++) { await page.locator('#entryUnits').selectOption('ml'); await page.locator('#entryUnits').selectOption('oz'); }
    await page.locator('#feedingNotes').fill('Fed after nap\nSettled well <script>bad()</script>');
    await page.locator('#pee').check(); await page.locator('#peeNotes').fill('Wet'); await page.locator('#poopNotes').fill('No poop yet');
    if (process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, 'baby-desktop-editor.png') });
    await page.locator('#saveEntry').click(); await page.locator('#editor').waitFor({ state: 'hidden' });
    let saved = (await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1])).items.find(item => item.entry.feedingNotes.startsWith('Fed after nap'));
    assert.ok(saved); assert.equal(saved.entry.occurredAt, '2026-11-05T15:15:00.000Z'); assert.equal(saved.entry.breastMilkMl, 60); assert.equal(saved.entry.formulaMl, 30);
    await page.reload(); await page.locator('.entry').first().waitFor();
    assert.match(await page.locator('#entries').textContent(), /Settled well <script>bad\(\)<\/script>/);
    await page.locator('#units').selectOption('oz');
    await page.locator('.entry').first().getByRole('button', { name: /Edit entry/ }).click();
    await page.locator('#formula').fill('2'); await page.locator('#poop').check(); await page.locator('#poopNotes').fill('Changed diaper');
    await page.locator('#occurredAt').fill('2026-11-05T10:20');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#editor').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    if (process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, 'baby-phone-editor.png') });
    await page.locator('#saveEntry').click(); await page.locator('#editor').waitFor({ state: 'hidden' });
    saved = (await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1])).items.find(item => item.id === saved.id);
    assert.equal(saved.entry.formulaMl, amounts.toMl(2, 'oz')); assert.equal(saved.entry.poop, true); assert.equal(saved.entry.occurredAt, '2026-11-05T15:20:00.000Z');
    if (process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, 'baby-phone-list.png') });
    // Concurrent edit is rejected while the original user's draft stays open.
    await page.locator('.entry').first().getByRole('button', { name: /Edit entry/ }).click();
    await page.locator('#feedingNotes').fill('My unsaved draft');
    await req(endpoint + '/' + saved.id, 'PATCH', { version: saved.version, entry: { ...saved.entry, feedingNotes: 'Other caregiver edit' } }, tokens[1]);
    await page.locator('#saveEntry').click(); await page.getByText('Another caregiver changed this entry.', { exact: false }).waitFor();
    assert.equal(await page.locator('#feedingNotes').inputValue(), 'My unsaved draft');
    page.once('dialog', dialog => dialog.accept()); await page.locator('#cancel').click();
    await page.locator('#refresh').click(); await page.getByText('Other caregiver edit', { exact: true }).waitFor();
    // Offline save leaves the form intact and never reports success.
    await page.locator('#addEntry').click(); await page.locator('#pee').check();
    await context.setOffline(true); await page.locator('#saveEntry').click();
    await page.getByText('Cannot reach Checky Base.', { exact: false }).waitFor();
    assert.equal(await page.locator('#pee').isChecked(), true);
    await context.setOffline(false); page.once('dialog', dialog => dialog.accept()); await page.locator('#cancel').click();
    // Delete is explicit and persists after reloading.
    await page.locator('.entry').first().getByRole('button', { name: /Edit entry/ }).click();
    await page.locator('#deleteEntry').click(); await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await page.locator('#editor').waitFor({ state: 'hidden' });
    assert.ok(!(await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1])).items.some(item => item.id === saved.id));
    await page.getByRole('link', { name: 'Back to lists' }).click(); await page.waitForURL(origin + '/');
    await page.waitForFunction(() => typeof state !== 'undefined' && !!state.currentChecklistId && !state.ui.syncInProgress);
    assert.equal((await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1])).items.length, 1);
    // Existing sharing revocation takes effect immediately for every add-on route.
    await req('/api/collections/shared_checklists/records/' + shared.id, 'PATCH', { sharedWith: [] }, admin.token);
    await req('/api/collections/users/records/' + users[1].id, 'PATCH', { assignedSharedChecklist: '' }, admin.token);
    await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1], 404);
    await req(endpoint + '/' + created.id, 'PATCH', { version: 2, entry: seed }, tokens[1], 404);
    // Uninstall only the add-on code; keep the same database and existing users.
    await stopBackend(); await startBackend(false);
    await req('/api/checkys-base/baby/status', 'GET', undefined, tokens[0], 404);
    const retained = await req('/api/collections/checky_baby_entries/records/' + created.id, 'GET', undefined, admin.token);
    assert.equal(retained.data.formulaMl, 30);
    await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!state.currentChecklistId && !state.ui.syncInProgress);
    await page.locator('#navToggle').click();
    assert.equal(await page.locator('[data-addon-id="baby-tracker"]').count(), 0, 'Mismatched web-only add-on must not appear');
    await fs.rename(path.join(root, 'baby'), path.join(dir, 'removed-addon-web'));
    await fs.writeFile(path.join(root, 'addons.json'), '[]');
    assert.equal((await fetch(origin + '/baby/')).status, 404);
    await stopBackend(); await startBackend(true);
    await fs.rename(path.join(dir, 'removed-addon-web'), path.join(root, 'baby'));
    await fs.copyFile(path.join(addon, 'addons.json'), path.join(root, 'addons.json'));
    await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!state.currentChecklistId && !state.ui.syncInProgress);
    await page.locator('#navToggle').click(); await page.locator('[data-addon-id="baby-tracker"]').waitFor({state:'visible'});
    assert.equal((await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[0])).items[0].id, created.id);
    console.log('PASS separate install, removal and reinstall retain the same database, users, lists and baby entries');
    assert.deepEqual(errors, []);
    console.log('PASS installed add-on navigation, timestamp edits, precise ml/oz, notes/checkboxes, reload, phone layout, XSS-safe text, offline draft, concurrent edits, deletion and access revocation');
  } catch (error) { console.error(log.slice(-7000)); throw error; }
  finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await fs.rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
