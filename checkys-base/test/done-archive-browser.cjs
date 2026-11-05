// Called by the PWA regression against its disposable backend and built web app.
const assert = require('node:assert/strict');

async function checkDoneArchive(page, browser, origin, password) {
  const readArchive = target => target.evaluate(() => state.data.tabs.find(tab => tab.system === 'done'));
  async function showArchive(target, visible) {
    await target.locator('#navToggle').click();
    await target.locator('#settingsToggle').click();
    await target.locator('#showDoneTab').setChecked(visible);
    await target.waitForFunction(value => JSON.parse(localStorage.getItem('checky.android.settings')).showDoneTab === value, visible);
    await target.locator('#specialViewCloseBtn').click();
  }
  async function readRemoteArchive(target) {
    return target.evaluate(async () => {
      const [collection, id] = state.currentChecklistId.split(':');
      const response = await fetch(`/api/collections/${collection}/records/${id}`, { credentials: 'same-origin' });
      if (!response.ok) throw Error('Could not read synced checklist');
      const record = await response.json();
      return record.data.tabs.find(tab => tab.system === 'done');
    });
  }

  // Hold a real folder response until after the user changes the Done preference.
  await page.waitForFunction(() => !state.ui.availableChecklistsLoading && !state.ui.syncInProgress);
  await page.evaluate(() => {
    const list = window.checkyStorage.listAccessibleChecklists;
    let release;
    const held = new Promise(resolve => { release = resolve; });
    window.checkyTestReleaseList = release;
    window.checkyStorage.listAccessibleChecklists = async () => {
      window.checkyStorage.listAccessibleChecklists = list;
      const result = await list();
      window.checkyTestFolderResultReady = true;
      await held;
      return result;
    };
    void loadAvailableChecklists();
  });
  await page.waitForFunction(() => window.checkyTestFolderResultReady);
  await showArchive(page, true);
  assert.equal(await page.evaluate(() => state.settings.showDoneTab), true);
  await page.evaluate(() => {
    window.checkyTestReleaseList();
    delete window.checkyTestReleaseList;
    delete window.checkyTestFolderResultReady;
  });
  await page.waitForFunction(() => !state.ui.availableChecklistsLoading);
  assert.equal(await page.evaluate(() => state.settings.showDoneTab), true, 'A delayed folder response must not revert the Done preference');
  await page.locator('#addItemBtn').click();
  await page.locator('#list textarea').last().fill('Keep this archived task across devices');
  await page.locator('#list textarea').last().click({ button: 'right' });
  await page.locator('#itemContextMenu').getByRole('button', { name: 'Mark done', exact: true }).click();
  const archive = await readArchive(page);
  assert.equal(archive.items.length, 1, 'Mark done must put the completed item in the enabled archive');
  assert.ok(archive.items[0].completedAt);
  await page.evaluate(() => runManualSync());
  assert.deepEqual(await readArchive(page), archive, 'Sync must preserve the newly archived item');
  assert.deepEqual(await readRemoteArchive(page), archive);

  const freshContext = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  try {
    const fresh = await freshContext.newPage(), errors = [];
    fresh.on('pageerror', error => errors.push(error.message));
    await fresh.goto(origin);
    await fresh.locator('#loginEmailInput').fill('admin@pwa.invalid');
    await fresh.locator('#loginPasswordInput').fill(password);
    await fresh.locator('#loginSubmitBtn').click();
    await fresh.locator('#loginOverlay').waitFor({ state: 'hidden' });
    await fresh.waitForFunction(() => !!state.currentChecklistId && !!state.ui.lastSyncedAt && !state.ui.syncInProgress);
    assert.equal(await fresh.evaluate(() => state.settings.showDoneTab), false);
    assert.deepEqual(await readArchive(fresh), archive, 'A fresh device must retain the archive while hiding it');
    assert.equal(await fresh.evaluate(() => state.data.tabs[state.data.active].system === 'done'), false);

    await fresh.locator('#list textarea').first().fill('Edited on a device with Done hidden');
    await fresh.evaluate(() => runManualSync());
    assert.deepEqual(await readRemoteArchive(fresh), archive, 'An ordinary edit must not sync an archive deletion');
    await fresh.reload();
    await fresh.waitForFunction(() => !!state.currentChecklistId && !!state.ui.lastSyncedAt && !state.ui.syncInProgress);
    assert.deepEqual(await readArchive(fresh), archive, 'Reload must preserve the hidden archive');

    // Keep the existing in-place Mark done behavior when archiving is disabled.
    await fresh.locator('#list textarea').first().click({ button: 'right' });
    await fresh.locator('#itemContextMenu').getByRole('button', { name: 'Mark done', exact: true }).click();
    assert.equal(await fresh.locator('#list input[type="checkbox"]').first().isChecked(), true);
    assert.deepEqual(await readArchive(fresh), archive);
    await fresh.evaluate(() => runManualSync());
    assert.deepEqual(await readRemoteArchive(fresh), archive);
    assert.deepEqual(errors, []);
  } finally {
    await freshContext.close();
  }

  await page.evaluate(() => runManualSync());
  assert.deepEqual(await readArchive(page), archive, 'The original device must receive the complete archive');
  await page.locator('#navToggle').click();
  await page.locator('#doneToggle').click();
  assert.equal(await page.locator('#doneArchiveTools').isVisible(), true);
  assert.equal(await page.locator('#list input[type="checkbox"]').count(), 0, 'Archived items must not use ordinary checkboxes');
  await showArchive(page, false);
  assert.equal(await page.evaluate(() => state.data.tabs[state.data.active].system === 'done'), false);
  assert.equal(await page.evaluate(() => state.ui.doneViewOpen), false);
  assert.deepEqual(await readArchive(page), archive);
  await page.evaluate(() => runManualSync());
  await showArchive(page, true);
  assert.deepEqual(await readArchive(page), archive, 'Re-enabling Done must restore the same archive and item IDs');

  // Imported/reordered tabs must leave a usable ordinary checklist selected.
  const edgeCases = await page.evaluate(() => {
    const previousData = state.data, previousSettings = state.settings, previousUi = { ...state.ui };
    const archive = structuredClone(state.data.tabs.find(tab => tab.system === 'done'));
    try {
      state.settings = { ...state.settings, showDoneTab: false };
      state.data = normalizeData({ active: 2, tabs: [archive, { id: 'first', name: 'First', items: [] }, { id: 'second', name: 'Second', items: [] }] });
      state.ui.lastChecklistTabIndex = 2;
      render();
      const selected = state.data.tabs[state.data.active].id;
      state.data = normalizeData({ active: 0, tabs: [structuredClone(archive)] });
      state.ui.doneViewOpen = true;
      render();
      return { selected, regularTabs: getVisibleTabs().length, activeIsDone: isDoneTab(state.data.tabs[state.data.active]), archive: state.data.tabs.find(tab => tab.system === 'done') };
    } finally {
      state.data = previousData; state.settings = previousSettings; state.ui = previousUi; render();
    }
  });
  assert.equal(edgeCases.selected, 'second');
  assert.equal(edgeCases.regularTabs, 1);
  assert.equal(edgeCases.activeIsDone, false);
  assert.deepEqual(edgeCases.archive, archive);
  console.log('PASS Done archive survives hiding, re-enabling, reloads, fresh-device edits and real sync; hidden archive never becomes the editable checklist');
}

module.exports = { checkDoneArchive };
