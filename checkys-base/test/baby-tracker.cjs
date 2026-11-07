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
    await fs.rm(path.join(dir, 'backend/pb_migrations/202611050002_checky_baby_lists.js'));
    await fs.rm(path.join(dir, 'backend/pb_migrations/202611050003_checky_baby_pocketbase_admin.js'));
    await startBackend(false);
    await req('/api/checkys-base/first-user', 'POST', { email: 'admin@baby.invalid', password, passwordConfirm: password });
    const admin = await req('/api/collections/_superusers/auth-with-password', 'POST', { identity: 'admin@baby.invalid', password });
    await req('/api/checkys-base/baby/status', 'GET', undefined, admin.token, 404);
    await req('/api/collections/checky_baby_lists/records', 'GET', undefined, admin.token, 404);
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
    const adminUser = await req('/api/collections/users/auth-with-password', 'POST', { identity: 'admin@baby.invalid', password });
    // Simulate a previously installed tracker. Upgrading preserves entry IDs,
    // versions and data but does not inherit access from ordinary checklists.
    const legacy = await req('/api/collections/checky_baby_entries/records', 'POST', {
      sharedChecklist: shared.id, createdBy: users[0].id, requestId: 'legacy-request-00000001', occurredAt: seed.occurredAt, data: seed, version: 7
    }, admin.token);
    const legacyPersonal = await req('/api/collections/checky_baby_entries/records', 'POST', {
      personalChecklist: users[0].defaultChecklist, createdBy: users[0].id, requestId: 'legacy-request-00000002', occurredAt: seed.occurredAt, data: seed, version: 3
    }, admin.token);
    await stopBackend();
    await fs.copyFile(path.join(addon, 'pocketbase/pb_migrations/202611050002_checky_baby_lists.js'), path.join(dir, 'backend/pb_migrations/202611050002_checky_baby_lists.js'));
    await startBackend(true);
    const endpoint = '/api/checkys-base/baby/entries', listEndpoint = '/api/checkys-base/baby/lists';
    await req(listEndpoint, 'GET', undefined, undefined, 401);
    assert.deepEqual((await req(listEndpoint, 'GET', undefined, tokens[0])).items, []);
    const listRecords = '/api/collections/checky_baby_lists/records';
    const migratedLists = await req(listRecords, 'GET', undefined, admin.token);
    assert.equal(migratedLists.items.length, 2);
    const babyList = migratedLists.items.find(item => item.name === 'Baby · Baby log');
    assert.deepEqual(babyList.members, []);
    const ref = 'checky_baby_lists:' + babyList.id;
    const migrated = await req('/api/collections/checky_baby_entries/records/' + legacy.id, 'GET', undefined, admin.token);
    assert.equal(migrated.version, 7); assert.deepEqual(migrated.data, seed); assert.equal(migrated.babyList,babyList.id);
    await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1], 404);
    await req(endpoint + '?list=' + ref, 'GET', undefined, adminUser.token, 404);
    assert.deepEqual((await req(listEndpoint,'GET',undefined,adminUser.token)).items, []);
    // Assign before the new migration to verify earlier explicit membership is kept.
    await req(listRecords + '/' + babyList.id, 'PATCH', {version:2,name:'Family baby log',members:[users[0].id,users[1].id]}, admin.token);
    await stopBackend();
    await fs.copyFile(path.join(addon, 'pocketbase/pb_migrations/202611050003_checky_baby_pocketbase_admin.js'), path.join(dir, 'backend/pb_migrations/202611050003_checky_baby_pocketbase_admin.js'));
    await startBackend(true);
    const upgradedList = await req(listRecords + '/' + babyList.id, 'GET', undefined, admin.token);
    assert.equal(upgradedList.version,undefined);
    assert.deepEqual([...upgradedList.members].sort(),[users[0].id,users[1].id].sort());
    for (const token of [...tokens,adminUser.token]) {
      await req(listRecords, 'POST', {name:'Bypass',members:[users[0].id]}, token, 403);
      await req(listRecords + '/' + babyList.id, 'PATCH', {members:[users[0].id]}, token, 403);
      await req(listRecords + '/' + babyList.id, 'DELETE', undefined, token, 403);
      await req(listRecords, 'GET', undefined, token, 403);
      await req('/api/checkys-base/baby/admin/users', 'GET', undefined, token, 404);
      await req(listEndpoint + '/' + babyList.id, 'PATCH', {members:[users[0].id]}, token, 404);
    }
    await req(listRecords, 'POST', {name:'Invalid member',members:['not-a-user']}, admin.token, 400);
    assert.equal((await req(listEndpoint,'GET',undefined,tokens[1])).items[0].ref,ref);
    assert.equal((await req(listEndpoint,'GET',undefined,tokens[1])).items[0].members,undefined);
    await req(endpoint + '/' + legacy.id, 'DELETE', {version:7}, tokens[0]);
    const personalMigrated = await req('/api/collections/checky_baby_entries/records/' + legacyPersonal.id, 'GET', undefined, admin.token);
    assert.ok(personalMigrated.babyList); assert.equal(personalMigrated.personalChecklist, undefined);
    assert.equal(personalMigrated.version,3); assert.deepEqual(personalMigrated.data,seed);
    console.log('PASS PocketBase-superuser-only list management, preserved upgrade data/membership, no first-user bypass and locked app APIs');
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
    const personal = 'checky_baby_lists:' + (await req(listRecords, 'POST', {name:'Separate baby list',members:[users[0].id]}, admin.token)).id;
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
    console.log('PASS independent list access, validation, idempotent saves, conflict protection, stable pagination and unchanged checklist JSON');
    const yesterday = await req(endpoint, 'POST', { list: ref, requestId: crypto.randomUUID(),
      entry: { ...seed, occurredAt: '2026-11-05T04:45:00.000Z', feedingNotes: 'Before local midnight' } }, tokens[0]);

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
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, hasTouch: true, timezoneId: 'America/New_York', locale: 'en-US' });
    await context.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-11-05T17:00:00Z'));
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
    const babyFolder = page.locator('[data-addon-id="baby-tracker"]');
    const babyListButton = babyFolder.getByRole('button', {name:'Family baby log',exact:true});
    await babyListButton.waitFor();
    const touch = await context.newCDPSession(page), box = await babyListButton.boundingBox();
    await touch.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
    await page.locator('#itemContextMenu').waitFor({state:'visible'});
    await touch.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    assert.equal(await page.evaluate(() => activeAddon), null, 'Releasing a Baby-list hold must not open the list');
    assert.deepEqual(await page.locator('#itemContextMenu button').allTextContents(), ['Always show']);
    await page.locator('#itemContextMenu').getByRole('button',{name:'Always show',exact:true}).click();
    const babyPin = page.locator('#alwaysVisibleTabs .addon-link').filter({hasText:'Family baby log'});
    await babyFolder.locator('summary').click();
    assert.equal(await babyListButton.isVisible(), false);
    assert.equal(await babyPin.isVisible(), true, 'Pinned Baby lists stay visible above collapsed folders');
    await babyPin.click();
    const tracker = page.frameLocator('#addonFrame');
    await tracker.locator('.entry').first().waitFor();
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && !!state.currentChecklistId && !state.ui.syncInProgress);
    await tracker.locator('.entry').first().waitFor();
    await page.locator('#navToggle').click();
    await babyPin.waitFor({state:'visible'});
    await babyPin.click({button:'right'});
    await page.locator('#itemContextMenu').getByRole('button',{name:'Remove shortcut',exact:true}).click();
    assert.equal(await babyPin.count(), 0);
    await babyListButton.click({button:'right'});
    await page.locator('#itemContextMenu').getByRole('button',{name:'Always show',exact:true}).click();
    await page.locator('#navCloseBtn').click();
    console.log('PASS Baby list hold menu, pin/unpin, collapsed-folder visibility, opening and reload persistence');
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await tracker.getByRole('link', {name:'Back to lists'}).count(), 0);
    assert.equal(await tracker.locator('#listPicker').inputValue(), ref);
    assert.equal(await tracker.locator('#manageLists').isVisible(), false);
    if (process.env.CHECKY_SCREENSHOT_DIR) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, 'baby-day-folders-phone.png') });
      await page.setViewportSize({ width: 1100, height: 900 });
    }
    await tracker.locator('#addEntry').click();
    assert.equal(await tracker.locator('#occurredAt').inputValue().then(value => value.length), 16);
    await tracker.locator('#saveEntry').click(); assert.match(await tracker.locator('#editorError').textContent(), /Add a feeding/);
    assert.match(await page.evaluate(() => window.checkyPrepareForUpdate().then(() => 'unexpected', error => error.message)), /Finish the open list edit/);
    await tracker.locator('#occurredAt').fill('2026-11-05T10:15');
    await tracker.locator('#breastMilk').fill('60'); await tracker.locator('#formula').fill('30');
    await tracker.locator('#entryUnits').selectOption('oz');
    assert.equal(await tracker.locator('#breastMilk').inputValue(), amounts.fromMl(60, 'oz'));
    for (let i = 0; i < 3; i++) { await tracker.locator('#entryUnits').selectOption('ml'); await tracker.locator('#entryUnits').selectOption('oz'); }
    await tracker.locator('#feedingNotes').fill('Fed after nap\nSettled well <script>bad()</script>');
    await tracker.locator('#pee').check(); await tracker.locator('#peeNotes').fill('Wet'); await tracker.locator('#poopNotes').fill('No poop yet');
    if (process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, 'baby-desktop-editor.png') });
    await tracker.locator('#saveEntry').click(); await tracker.locator('#editor').waitFor({ state: 'hidden' });
    let saved = (await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1])).items.find(item => item.entry.feedingNotes.startsWith('Fed after nap'));
    assert.ok(saved); assert.equal(saved.entry.occurredAt, '2026-11-05T15:15:00.000Z'); assert.equal(saved.entry.breastMilkMl, 60); assert.equal(saved.entry.formulaMl, 30);
    await page.reload(); await tracker.locator('.entry').first().waitFor();
    assert.match(await tracker.locator('#entries').textContent(), /Settled well <script>bad\(\)<\/script>/);
    assert.match(await tracker.locator('.today-heading').innerText(), /Today\s+Thursday, November 5/);
    assert.equal(await tracker.locator('.today .entry:visible').count(), 2);
    assert.equal(await tracker.locator('#status').isVisible(), false);
    assert.equal(await tracker.getByRole('button', {name:'Refresh', exact:true}).count(), 0);
    const historicalEntry = tracker.getByText('Before local midnight', {exact:true});
    const olderDay = tracker.locator('summary', {hasText:'Wednesday, November 4'});
    assert.equal(await historicalEntry.isVisible(), false);
    await olderDay.tap(); await historicalEntry.waitFor();
    await olderDay.focus(); await olderDay.press('Enter');
    await historicalEntry.waitFor({state:'hidden'});
    await olderDay.tap(); await historicalEntry.waitFor();
    await tracker.locator('#units').selectOption('oz');
    assert.equal(await historicalEntry.isVisible(), true);
    await tracker.locator('.entry').first().getByRole('button', { name: /Edit entry/ }).click();
    await tracker.locator('#formula').fill('2'); await tracker.locator('#poop').check(); await tracker.locator('#poopNotes').fill('Changed diaper');
    await tracker.locator('#occurredAt').fill('2026-11-05T10:20');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await tracker.locator('#editor').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    if (process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, 'baby-phone-editor.png') });
    await tracker.locator('#saveEntry').click(); await tracker.locator('#editor').waitFor({ state: 'hidden' });
    saved = (await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1])).items.find(item => item.id === saved.id);
    assert.equal(saved.entry.formulaMl, amounts.toMl(2, 'oz')); assert.equal(saved.entry.poop, true); assert.equal(saved.entry.occurredAt, '2026-11-05T15:20:00.000Z');
    if (process.env.CHECKY_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, 'baby-phone-list.png') });
      await page.locator('#navToggle').click();
      await page.waitForFunction(() => !state.ui.availableChecklistsLoading);
      await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, 'baby-navigation-phone.png') });
      await page.locator('#navCloseBtn').click();
    }
    // Concurrent edit is rejected while the original user's draft stays open.
    await tracker.locator('.entry').first().getByRole('button', { name: /Edit entry/ }).click();
    await tracker.locator('#feedingNotes').fill('My unsaved draft');
    await req(endpoint + '/' + saved.id, 'PATCH', { version: saved.version, entry: { ...saved.entry, feedingNotes: 'Other caregiver edit' } }, tokens[1]);
    await tracker.locator('#saveEntry').click(); await tracker.getByText('Another caregiver changed this entry.', { exact: false }).waitFor();
    assert.equal(await tracker.locator('#feedingNotes').inputValue(), 'My unsaved draft');
    page.once('dialog', dialog => dialog.accept()); await tracker.locator('#cancel').click();
    // Real finger gestures in the embedded phone view. A short pull cancels;
    // releasing a full pull fetches the edit without closing yesterday.
    await tracker.locator('h1').evaluate(el => el.ownerDocument.defaultView.scrollTo(0, 0));
    const title = await tracker.locator('h1').boundingBox();
    async function pullLog(distance, expectedHint) {
      const point = {x:title.x + 16, y:title.y + 8};
      await touch.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[point]});
      await touch.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{...point, y:point.y + distance}]});
      await tracker.getByText(expectedHint, {exact:true}).waitFor();
      await touch.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    }
    await pullLog(38, 'Pull down to refresh');
    assert.equal(await tracker.getByText('Other caregiver edit', {exact:true}).count(), 0);
    await pullLog(110, 'Release to refresh');
    await tracker.getByText('Other caregiver edit', { exact: true }).waitFor();
    assert.equal(await historicalEntry.isVisible(), true);
    assert.equal(await tracker.locator('.today .entry:visible').count(), 2);
    await req(endpoint + '/' + yesterday.id, 'DELETE', {version:yesterday.version}, tokens[0]);
    console.log('PASS local-day folders, touch/keyboard toggles, short-pull cancellation and pull-to-refresh with history open');
    // Offline save leaves the form intact and never reports success.
    await tracker.locator('#addEntry').click(); await tracker.locator('#pee').check();
    await context.setOffline(true); await tracker.locator('#saveEntry').click();
    await tracker.getByText('Cannot reach Checky Base.', { exact: false }).waitFor();
    assert.equal(await tracker.locator('#pee').isChecked(), true);
    await context.setOffline(false); page.once('dialog', dialog => dialog.accept()); await tracker.locator('#cancel').click();
    // Delete is explicit and persists after reloading.
    await tracker.locator('.entry').first().getByRole('button', { name: /Edit entry/ }).click();
    await tracker.locator('#deleteEntry').click(); await tracker.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await tracker.locator('#editor').waitFor({ state: 'hidden' });
    assert.ok(!(await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1])).items.some(item => item.id === saved.id));
    // The same navigation switches between Baby and ordinary lists, preserving
    // drafts when a caregiver declines to leave an unfinished entry.
    await tracker.locator('#addEntry').click(); await tracker.locator('#pee').check();
    await page.locator('#navToggle').click();
    page.once('dialog', dialog => dialog.dismiss());
    await babyPin.click();
    assert.equal(await tracker.locator('#editor').isVisible(), true, 'Pinned Baby navigation must preserve the unfinished-entry guard');
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#tabs .tab-label').first().click();
    assert.equal(await tracker.locator('#editor').isVisible(), true);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#tabs .tab-label').first().click();
    await page.locator('#addonView').waitFor({state:'hidden'});
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(new URL(page.url()).searchParams.has('addon'), false);
    await page.waitForFunction(() => typeof state !== 'undefined' && !!state.currentChecklistId && !state.ui.syncInProgress);
    assert.equal((await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1])).items.length, 1);
    // A day can span two server pages. After midnight it should become a
    // closed folder, and refreshing it must include edits beyond page one.
    const historyPage = await context.newPage();
    await historyPage.clock.setFixedTime(new Date('2026-11-05T17:00:00Z'));
    await historyPage.goto(origin + '/baby/?list=' + encodeURIComponent(personal));
    await historyPage.locator('.today .entry').first().waitFor();
    assert.equal(await historyPage.locator('.today .entry').count(), 50);
    await historyPage.locator('#loadMore').click();
    await historyPage.locator('#loadMore').waitFor({state:'hidden'});
    assert.equal(await historyPage.locator('.today .entry').count(), 52);
    await historyPage.clock.setFixedTime(new Date('2026-11-06T05:01:00Z'));
    await historyPage.evaluate(() => window.dispatchEvent(new Event('online')));
    await historyPage.getByText('No entries today.').waitFor();
    assert.equal(await historyPage.locator('details[open]').count(), 0);
    await historyPage.getByText('Thursday, November 5', {exact:true}).click();
    assert.equal(await historyPage.locator('details[open] .entry').count(), 52);
    const tail = second.items.at(-1);
    await req(endpoint + '/' + tail.id, 'PATCH', {version:tail.version, entry:{...tail.entry, feedingNotes:'Updated older feeding'}}, tokens[0]);
    await historyPage.evaluate(() => window.dispatchEvent(new Event('online')));
    await historyPage.getByText('Updated older feeding', {exact:true}).waitFor();
    await historyPage.locator('#listPicker').selectOption(ref);
    await historyPage.getByText('Thursday, November 5', {exact:true}).waitFor();
    assert.equal(await historyPage.locator('details[open]').count(), 0, 'Folders start closed when switching lists');
    await historyPage.close();
    console.log('PASS midnight rollover, cross-page day folders and refresh of earlier pages');
    // PocketBase superusers use the native collection API behind their dashboard.
    // A Checky first-user/admin account has the same assignment rules as everyone.
    const adminContext = await browser.newContext({viewport:{width:1100,height:900}});
    const adminPage = await adminContext.newPage();
    adminPage.on('pageerror', error => errors.push(error.message));
    await adminPage.goto(origin);
    await adminPage.locator('#loginEmailInput').fill('admin@baby.invalid');
    await adminPage.locator('#loginPasswordInput').fill(password); await adminPage.locator('#loginSubmitBtn').click();
    await adminPage.locator('#loginOverlay').waitFor({state:'hidden'});
    await adminPage.waitForFunction(() => typeof state !== 'undefined' && !!state.currentChecklistId && !state.ui.syncInProgress);
    await adminPage.locator('#navToggle').click();
    const adminFolder = adminPage.locator('[data-addon-id="baby-tracker"]');
    await adminPage.evaluate(() => loadInstalledAddons());
    assert.equal(await adminFolder.count(),0, 'Hide Baby when no baby lists are assigned');
    assert.equal(await adminPage.locator('#alwaysVisibleTabs .addon-link').count(),0, 'Another account must not inherit Baby shortcuts');
    await req('/api/collections/_superusers/records','POST',{email:'second-admin@baby.invalid',password,passwordConfirm:password},admin.token);
    const secondAdmin = await req('/api/collections/_superusers/auth-with-password','POST',{identity:'second-admin@baby.invalid',password});
    const independent = await req(listRecords,'POST',{name:'PocketBase assigned baby list',members:[adminUser.record.id,users[2].id]},secondAdmin.token);
    const independentRef = 'checky_baby_lists:' + independent.id;
    assert.equal((await req(listEndpoint,'GET',undefined,tokens[2])).items[0].ref,independentRef);
    await adminPage.locator('#refreshChecklistsBtn').click();
    await adminFolder.getByRole('button',{name:independent.name,exact:true}).click();
    const assigned = adminPage.frameLocator('#addonFrame');
    await assigned.getByRole('heading',{name:independent.name,exact:true}).waitFor();
    assert.equal(await assigned.locator('#manageLists').count(),0);
    assert.equal(await assigned.locator('#listManager').count(),0);
    assert.equal(await assigned.locator('#addEntry').isEnabled(),true);
    assert.equal(new URL(adminPage.url()).pathname,'/');
    await adminPage.locator('#navToggle').click();
    await adminFolder.getByRole('button',{name:independent.name,exact:true}).click({button:'right'});
    await adminPage.locator('#itemContextMenu').getByRole('button',{name:'Always show',exact:true}).click();
    const adminPin = adminPage.locator('#alwaysVisibleTabs .addon-link');
    assert.equal(await adminPin.textContent(),independent.name);
    await req(listRecords + '/' + independent.id,'PATCH',{name:'Renamed in PocketBase'},secondAdmin.token);
    await adminPage.evaluate(() => loadInstalledAddons());
    assert.equal(await adminPin.textContent(),'Renamed in PocketBase', 'Pinned labels follow the current list name');
    await adminPage.locator('#navCloseBtn').click();
    await req(listRecords + '/' + independent.id,'PATCH',{name:'Renamed in PocketBase',members:[users[2].id]},secondAdmin.token);
    await assigned.locator('body').evaluate(el => el.ownerDocument.dispatchEvent(new Event('visibilitychange')));
    await assigned.locator('#tracker').waitFor({state:'hidden'});
    await assigned.getByText('This baby list is unavailable.',{exact:false}).waitFor();
    await adminPage.locator('#navToggle').click();
    await adminFolder.waitFor({state:'detached'});
    assert.equal(await adminPin.count(),0, 'Revoking list access also removes its visible shortcut');
    assert.equal((await req(listEndpoint,'GET',undefined,tokens[2])).items[0].name,'Renamed in PocketBase');
    await req(listRecords + '/' + independent.id,'PATCH',{members:[]},admin.token);
    await req(endpoint + '?list=' + independentRef,'GET',undefined,tokens[2],404);
    await adminContext.close();
    console.log('PASS PocketBase admin create/rename/assign/revoke flow, multiple superusers and integrated member-only navigation');
    // Ordinary Shared membership is independent. Only the baby-list admin assignment controls baby access.
    await req('/api/collections/shared_checklists/records/' + shared.id, 'PATCH', { sharedWith: [] }, admin.token);
    await req('/api/collections/users/records/' + users[1].id, 'PATCH', { assignedSharedChecklist: '' }, admin.token);
    await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[1]);
    await req(listRecords + '/' + babyList.id, 'PATCH', {members:[users[0].id]}, admin.token);
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
    assert.equal(await page.locator('#alwaysVisibleTabs .addon-link').count(),0, 'Uninstalled add-ons must not leave active shortcuts');
    await fs.rename(path.join(root, 'baby'), path.join(dir, 'removed-addon-web'));
    await fs.writeFile(path.join(root, 'addons.json'), '[]');
    assert.equal((await fetch(origin + '/baby/')).status, 404);
    await stopBackend(); await startBackend(true);
    await fs.rename(path.join(dir, 'removed-addon-web'), path.join(root, 'baby'));
    await fs.copyFile(path.join(addon, 'addons.json'), path.join(root, 'addons.json'));
    await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && !!state.currentChecklistId && !state.ui.syncInProgress);
    await page.locator('#navToggle').click(); await page.locator('[data-addon-id="baby-tracker"]').waitFor({state:'visible'});
    assert.equal(await babyPin.isVisible(),true, 'Reinstalling an assigned add-on restores the saved shortcut');
    assert.equal((await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[0])).items[0].id, created.id);
    await req('/api/collections/shared_checklists/records/' + shared.id, 'DELETE', undefined, admin.token, 204);
    assert.equal((await req(endpoint + '?list=' + ref, 'GET', undefined, tokens[0])).items[0].id, created.id, 'Deleting an ordinary checklist must not delete an independent baby log');
    console.log('PASS separate install, removal and reinstall retain the same database, users, lists and baby entries');
    assert.deepEqual(errors, []);
    console.log('PASS installed add-on navigation, timestamp edits, precise ml/oz, notes/checkboxes, reload, phone layout, XSS-safe text, offline draft, concurrent edits, integrated navigation, unsaved-entry guard, deletion and independent access revocation');
  } catch (error) { console.error(log.slice(-7000)); throw error; }
  finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await fs.rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
