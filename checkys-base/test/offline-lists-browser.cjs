const assert = require('node:assert/strict');

// Run inside the disposable Baby/PocketBase suite with real service workers.
async function checkOfflineLists(page, context) {
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/baby/');
    return registration?.active && registration.scope.endsWith('/baby/');
  });
  await page.evaluate(() => loadAvailableChecklists());
  const lists = await page.evaluate(() => state.availableChecklists);
  const personal = lists.find(item => item.isPersonal).id;
  const shared = lists.find(item => !item.isPersonal).id;
  const tracker = page.frameLocator('#addonFrame');
  const entryCount = await tracker.locator('.entry').count();
  assert.ok(entryCount > 0);
  await context.setOffline(true);
  await page.goto(new URL(page.url()).origin);
  await page.locator('#loginOverlay').waitFor({ state: 'hidden' });
  await tracker.getByText('Offline. Showing saved entries.', { exact: false }).waitFor();
  assert.equal(await tracker.locator('.entry').count(), entryCount);
  assert.equal(await tracker.locator('#addEntry').isDisabled(), true);
  await page.locator('#navToggle').click();
  assert.equal(await page.locator('[data-folder="shared"]').isVisible(), true);
  assert.equal(await page.locator('[data-folder="personal"]').isVisible(), true);
  assert.equal(await page.locator('[data-addon-id="baby-tracker"]').isVisible(), true);
  await page.evaluate(id => useSelectedChecklist(id), personal);
  await page.evaluate(id => useSelectedChecklist(id), shared);
  const original = await page.locator('#list textarea').first().inputValue();
  await page.locator('#navCloseBtn').click();
  await page.locator('#list textarea').first().fill('Shared edit while offline');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('checky.android.checklist')).tabs[0].items[0].text === 'Shared edit while offline');
  await page.evaluate(id => useSelectedChecklist(id), personal);
  await page.reload();
  await page.locator('#loginOverlay').waitFor({ state: 'hidden' });
  await page.evaluate(id => useSelectedChecklist(id), shared);
  assert.equal(await page.locator('#list textarea').first().inputValue(), 'Shared edit while offline');
  // A failed Shared-only API must not erase its navigation or saved draft.
  await context.setOffline(false);
  await page.waitForFunction(() => state.hostedSession.authenticated && !state.ui.syncInProgress);
  await page.evaluate(() => runManualSync('test'));
  assert.equal(await page.evaluate(async ref => {
    const [collection, id] = ref.split(':');
    return (await (await fetch('/api/collections/' + collection + '/records/' + id)).json()).data.tabs[0].items[0].text;
  }, shared), 'Shared edit while offline');
  await page.route('**/api/collections/shared_checklists/records?*', route => route.fulfill({ status: 503, body: '{}' }));
  await page.evaluate(() => loadAvailableChecklists());
  assert.ok(await page.evaluate(id => state.availableChecklists.some(item => item.id === id), shared));
  await page.unroute('**/api/collections/shared_checklists/records?*');
  await page.route('**/api/checkys-base/baby/lists', route => route.fulfill({ status: 503, body: '{}' }));
  await page.evaluate(() => loadInstalledAddons());
  assert.ok(await page.evaluate(() => installedAddons.some(addon => addon.id === 'baby-tracker' && addon.items.length)));
  await page.unroute('**/api/checkys-base/baby/lists');
  await page.locator('#list textarea').first().fill(original);
  await page.evaluate(() => runManualSync('test'));
  await page.locator('#navToggle').click();
  await page.locator('#alwaysVisibleTabs .addon-link').first().click();
  await tracker.locator('#addEntry:not(:disabled)').waitFor({ timeout: 45000 });
  console.log('PASS Baby shell/log and Personal/Shared navigation survive offline reload; switching preserves drafts and reconnect syncs them; a partial API outage preserves Shared');
}
module.exports = { checkOfflineLists };
