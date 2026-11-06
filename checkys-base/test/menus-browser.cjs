// Real renderer/DOM/pointer events; isolated storage adapters, no user data or backend.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.CHECKY_PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.endsWith('/addons.json')) { res.setHeader('Content-Type', 'application/json'); res.end('[]'); return; }
    const desktop = url.pathname.startsWith('/desktop/');
    const directory = path.join(root, desktop ? 'checkys-app/renderer' : 'checkys-base/web');
    const relative = url.pathname.replace(/^\/(base|desktop)\//, '') || 'index.html';
    const filename = path.resolve(directory, relative);
    if (!filename.startsWith(directory + path.sep)) { res.writeHead(404); res.end(); return; }
    try {
      let data = await fs.readFile(filename);
      if (relative === 'index.html' && !desktop) data = Buffer.from(data.toString()
        .replace('<html lang="en">', '<html lang="en" class="checkys-base-shell-ready">')
        .replace(/<script src="\.\/(?:checkys-base|mobile-storage|pwa)\.js[^\"]*"><\/script>/g, ''));
      res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(filename)] || 'application/octet-stream');
      res.end(data);
    } catch (_) { res.writeHead(404); res.end(); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.CHECKY_CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox'] });
    for (const surface of ['base', 'desktop']) {
      const context = await browser.newContext({ viewport: { width: surface === 'base' ? 390 : 1100, height: 844 }, hasTouch: true });
      await context.addInitScript(() => {
        let checklist = { active: 0, tabs: [
          { id: 'alpha', name: 'Alpha', items: Array.from({ length: 12 }, (_, i) => ({ id: 'item-' + i, text: 'Task ' + i, done: false })) },
          { id: 'beta', name: 'Beta', items: [] }, { id: 'gamma', name: 'Gamma', items: [] },
          { id: 'archive', name: 'Done', system: 'done', items: [{ id: 'archived', text: 'Keep archived task', done: true, completedAt: '2026-11-05T12:00:00Z' }] }
        ] };
        let settings = { showDoneTab: true, advanced: { serverUrl: '', email: '', password: '' } };
        const clone = value => JSON.parse(JSON.stringify(value));
        const result = () => ({ ok: true, checklist: clone(checklist), settings: clone(settings), dataLocation: 'Test memory',
          hostedSession: { authenticated: true, user: { id: '', email: '' } } });
        const api = {
          loadState: async () => result(),
          saveChecklist: async data => { checklist = clone(data); return clone(checklist); },
          saveSettings: async data => { settings = clone(data); return { ok: true, settings: clone(settings) }; },
          syncNow: async data => { window.checkyTestSyncStarted = true; if (data) checklist = clone(data); return result(); },
          listAccessibleChecklists: async () => ({ ok: true, checklists: [], currentChecklistId: '', settings: clone(settings) }),
          listBackups: async () => [], checkForUpdates: async () => ({ available: false }),
          onWindowSyncRequested() {}, onVerificationCodeRequested() {}, onReminderResetTimes() {}
        };
        window.checkyStorage = api; window.checkyApi = api;
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${surface}/`);
      // Base schedules startup sync after first render. A merely idle renderer can
      // still rebuild the tabs during the first hold, so wait for that sync to finish.
      await page.waitForFunction(() => window.checkyTestSyncStarted && typeof state !== 'undefined' && state.data.tabs[0]?.id === 'alpha' && !state.ui.syncInProgress);
      const touch = await context.newCDPSession(page);
      const menu = page.locator('#itemContextMenu');
      async function hold(locator) {
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
        await menu.waitFor({ state: 'visible' });
      }
      async function release() {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      async function openTab(name, longPress = false) {
        if (surface === 'base' && !await page.locator('#navDrawer').isVisible()) await page.locator('#navToggle').click();
        const label = page.locator('.tab-label').filter({ hasText: new RegExp('^' + name + '$') });
        if (longPress) { await hold(label); await release(); }
        else await label.click({ button: 'right' });
      }

      await openTab('Alpha', true);
      assert.deepEqual(await menu.locator('button').allTextContents(), ['Rename', 'Move up', 'Move down', 'Always show', 'Delete']);
      assert.equal(await menu.getByRole('button', { name: 'Move up', exact: true }).isDisabled(), true);
      assert.equal(await page.evaluate(() => state.data.tabs.length), 4, 'Releasing the hold must not delete/select a menu action');
      if (process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, `tab-menu-${surface}.png`) });
      await menu.getByRole('button', { name: 'Rename', exact: true }).click();
      await page.locator('.tab-name-input').fill('Renamed'); await page.locator('.tab-name-input').press('Enter');
      await openTab('Renamed'); await menu.getByRole('button', { name: 'Move down', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => state.data.tabs.map(tab => tab.id)), ['beta', 'alpha', 'gamma', 'archive']);
      assert.equal(await page.evaluate(() => state.data.tabs[state.data.active].id), 'alpha');
      await openTab('Renamed'); await menu.getByRole('button', { name: 'Always show', exact: true }).click();
      assert.equal(await page.locator('#alwaysVisibleTabs .tab-label').textContent(), 'Renamed');
      await openTab('Renamed'); await menu.getByRole('button', { name: 'Remove shortcut', exact: true }).click();
      await openTab('Gamma'); assert.equal(await menu.getByRole('button', { name: 'Move down', exact: true }).isDisabled(), true);
      await menu.getByRole('button', { name: 'Delete', exact: true }).click();
      assert.equal(await page.evaluate(() => state.data.tabs.length), 4);
      await menu.getByRole('button', { name: 'Cancel', exact: true }).click();
      if (surface === 'base') {
        // The dedicated handle must still drag rather than open a menu.
        const handle = page.locator('.tab').filter({ has: page.locator('.tab-label', { hasText: 'Renamed' }) }).locator('.drag-handle');
        const box = await handle.boundingBox();
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
        await page.waitForFunction(() => state.ui.draggedTabIndex !== null);
        assert.equal(await menu.isVisible(), false);
        await release();
        await page.locator('#navCloseBtn').click();
      }

      if (surface === 'base') {
        for (const size of [{ width: 390, height: 844 }, { width: 390, height: 420 }, { width: 320, height: 480 }]) {
          await page.setViewportSize(size);
          const before = await page.evaluate(() => JSON.stringify(state.data));
          const last = page.locator('#list textarea').last();
          await hold(last);
          const button = await menu.getByRole('button', { name: 'Remind', exact: true }).elementHandle();
          // Native contextmenu and viewport changes must not replace a button mid-gesture.
          await last.evaluate((el, y) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: y })), size.height - 20);
          await page.evaluate(() => { window.dispatchEvent(new Event('resize')); visualViewport.dispatchEvent(new Event('resize')); });
          assert.equal(await button.evaluate(el => el.isConnected), true);
          await release();
          assert.equal(await menu.isVisible(), true);
          assert.equal(await page.evaluate(() => JSON.stringify(state.data)), before);
          const bounds = await menu.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width && bounds.y + bounds.height <= size.height, JSON.stringify(bounds));
          if (process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, `last-item-${size.width}-${size.height}.png`) });
          assert.equal(await menu.getByRole('button', { name: 'Move down', exact: true }).isDisabled(), true);
          await menu.getByRole('button', { name: 'Remind', exact: true }).click();
          await page.locator('.reminder-dialog').waitFor({ state: 'visible' });
          await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        }
        await hold(page.locator('#list textarea').last()); await release();
        await menu.getByRole('button', { name: 'Move up', exact: true }).click();
        assert.equal(await page.evaluate(() => state.data.tabs[state.data.active].items.at(-2).id), 'item-11');
        await hold(page.locator('#list textarea').last()); await release();
        await menu.getByRole('button', { name: 'Delete', exact: true }).click();
        assert.equal(await page.locator('#list textarea').count(), 12, 'Delete requires explicit confirmation');
        await page.locator('#list').getByRole('button', { name: 'No', exact: true }).click();
        // A cancelled/scrolling gesture must not open a menu after the finger leaves.
        const last = page.locator('#list textarea').last();
        await last.scrollIntoViewIfNeeded();
        const box = await last.boundingBox();
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 30, y: box.y + 30 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 60, y: box.y + 30 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await page.waitForTimeout(400);
        assert.equal(await menu.isVisible(), false);
      }

      // Deleting the last ordinary tab must not delete the separate Done archive.
      await page.evaluate(() => {
        state.data.tabs = state.data.tabs.filter(tab => tab.id === 'alpha' || tab.system === 'done');
        state.data.active = 0; render();
      });
      await openTab('Renamed'); await menu.getByRole('button', { name: 'Delete', exact: true }).click();
      await menu.getByRole('button', { name: 'Delete tab', exact: true }).click();
      assert.equal(await page.evaluate(() => state.data.tabs.find(tab => tab.system === 'done').items[0].id), 'archived');
      assert.equal(await page.evaluate(() => state.data.tabs.filter(tab => tab.system !== 'done').length), 1);
      assert.deepEqual(errors, []);
      console.log('PASS ' + surface + ': tab hold/right-click actions, explicit deletion, archive preservation' + (surface === 'base' ? ', last-item touch menus at three phone sizes and stable buttons on resize/native contextmenu' : ''));
      await context.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
