const assert = require('node:assert/strict');

// Uses the real account, lists and service workers in the disposable Baby suite.
async function checkLastUsed(page) {
  const origin = new URL(page.url()).origin;
  const tracker = page.frameLocator('#addonFrame');
  const original = await page.evaluate(() => ({
    addon: activeAddon,
    checklist: state.currentChecklistId,
    personal: state.availableChecklists.find(item => item.isPersonal).id,
    otherBaby: installedAddons.find(addon => addon.id === activeAddon.id).items.find(item => item.ref !== activeAddon.ref).ref,
    tabName: state.data.tabs[0].name
  }));
  const settled = () => page.waitForFunction(() => typeof state !== 'undefined' && !!state.ui.lastSyncedAt && !state.ui.syncInProgress);
  const expectBaby = async ref => {
    await page.waitForFunction(ref => typeof activeAddon !== 'undefined' && activeAddon?.ref === ref, ref);
    await tracker.locator('#addEntry:not(:disabled)').waitFor({ timeout: 45000 });
    assert.equal(await tracker.locator('#listPicker').inputValue(), ref);
  };
  // Installed apps launch at '/', discarding the last window's query string.
  await page.goto(origin);
  await settled();
  await expectBaby(original.addon.ref);
  await page.goto(origin + '/?addon=' + original.addon.id + '&list=' + original.otherBaby);
  await settled();
  await expectBaby(original.otherBaby);
  await page.goto(origin);
  await settled();
  await expectBaby(original.otherBaby);

  // A notification must override the remembered Baby view, even for the same
  // underlying checklist that was already loaded before opening Baby.
  await page.goto(origin + '/?reminder=' + original.checklist + '&tab=' + encodeURIComponent(original.tabName));
  await page.waitForFunction(() => typeof state !== 'undefined' && !!state.ui.lastSyncedAt && !location.search);
  await page.evaluate(() => loadInstalledAddons());
  assert.equal(await page.evaluate(() => activeAddon), null);
  assert.equal(await page.locator('#currentViewTitle').textContent(), original.tabName);

  // Add a fixture tab, select it through navigation, then simulate a second
  // device pulling a different tab. The server's active index must not win.
  await page.evaluate(async () => {
    state.data.tabs.push({ id: 'reopen-test-tab', name: 'Reopen here', items: [] });
    await window.checkyStorage.saveChecklist(state.data);
    await runManualSync('test');
  });
  await page.locator('#navToggle').click();
  const sharedFolder = page.locator('[data-folder="shared"]');
  if (!await sharedFolder.evaluate(el => el.open)) await sharedFolder.locator('summary').click();
  await page.getByRole('button', { name: 'Reopen here', exact: true }).click();
  await page.evaluate(() => runManualSync('test'));
  await page.evaluate(async () => {
    const [collection, id] = state.currentChecklistId.split(':');
    const endpoint = '/api/collections/' + collection + '/records/' + id;
    const record = await (await fetch(endpoint)).json();
    record.data.active = 0;
    const response = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: record.version + 1, data: record.data }) });
    if (!response.ok) throw Error('Could not simulate the second device: ' + await response.text());
    await runManualSync('test');
  });
  assert.equal(await page.locator('#currentViewTitle').textContent(), 'Reopen here');
  await page.goto(origin);
  await settled();
  assert.equal(await page.evaluate(() => state.currentChecklistId), original.checklist);
  assert.equal(await page.locator('#currentViewTitle').textContent(), 'Reopen here');
  assert.equal(await page.evaluate(() => activeAddon), null);
  await page.evaluate(id => useSelectedChecklist(id), original.personal);
  await page.waitForFunction(() => !state.ui.syncInProgress && !pendingManualSync);
  await page.goto(origin);
  await settled();
  assert.equal(await page.evaluate(() => state.currentChecklistId), original.personal, 'Last-used Personal must override the assigned Shared list');
  await page.evaluate(id => useSelectedChecklist(id), original.checklist);
  await page.waitForFunction(() => !state.ui.syncInProgress && !pendingManualSync);
  assert.equal(await page.locator('#currentViewTitle').textContent(), 'Reopen here', 'Each checklist remembers its own tab');
  await page.evaluate(async () => {
    deleteTabAt(state.data.tabs.findIndex(tab => tab.id === 'reopen-test-tab'));
    await runManualSync('test');
  });
  await page.goto(origin);
  await settled();
  assert.equal(await page.locator('#currentViewTitle').textContent(), original.tabName, 'A deleted saved tab falls back to an available tab');

  // The standalone Baby entrypoint also needs to remember a non-default log.
  await page.goto(origin + '/baby/?list=' + original.otherBaby);
  await page.locator('#addEntry:not(:disabled)').waitFor();
  await page.goto(origin + '/baby/');
  await page.locator('#addEntry:not(:disabled)').waitFor();
  assert.equal(await page.locator('#listPicker').inputValue(), original.otherBaby);
  // Return the fixture to its original view for the rest of the suite.
  await page.goto(origin + '/?addon=' + original.addon.id + '&list=' + original.addon.ref);
  await settled();
  await expectBaby(original.addon.ref);
  console.log('PASS fresh opens remember Baby, Personal/Shared and per-list tabs; sync preserves the device tab, reminder/deep links override saved views, deleted tabs fall back, standalone Baby remembers its log');
}

module.exports = { checkLastUsed };
