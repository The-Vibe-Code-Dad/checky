const assert = require('node:assert/strict');

async function checkWeekly(page, openTab, surface, hold, release) {
  const original = await page.evaluate(() => JSON.parse(JSON.stringify(state.data)));
  const rows = page.locator('.week-row');
  const visibleDays = () => rows.locator('label').allTextContents();
  const menu = page.locator('#itemContextMenu');
  const options = day => rows.getByRole('button', { name: 'Options for ' + day, exact: true });
  const markDone = () => menu.getByRole('button', { name: 'Mark done', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Weekly checklist' });
  const choose = day => dialog.getByRole('group', { name: 'Remind me on' }).getByRole('button', { name: day, exact: true }).click();
  const save = async () => {
    await dialog.getByRole('button', { name: 'Save weekly setup' }).click();
    await page.locator('.week-header').waitFor();
    await page.waitForFunction(() => !document.querySelector('.week-dialog') && !state.ui.syncInProgress);
  };
  await page.clock.setFixedTime(new Date('2030-03-09T18:00:00Z')); // Saturday, before US DST.
  await page.evaluate(() => {
    state.data.tabs[0].items = ['Sunday','Monday','Wednesday','Friday','Keep this task'].map((text, i) => ({ id:'day-'+i, text, done: text==='Wednesday' }));
    render();
  });
  await openTab('Alpha');
  await page.getByRole('button', {name:'Set up weekly checklist',exact:true}).click();
  await choose('Sunday');
  await dialog.locator('input[type=time]').fill('08:15');
  await save();
  assert.deepEqual(await visibleDays(), ['Monday','Wednesday','Friday']);
  assert.equal(await rows.getByRole('checkbox', {name:'Wednesday'}).isChecked(), true, 'Adopt checked weekday');
  assert.equal(await page.locator('#list textarea').inputValue(), 'Keep this task');
  assert.equal(await rows.getByText('08:15').count(), 0);
  assert.equal(await rows.getByRole('button', {name: 'Mark done'}).count(), 0);
  const dayField = rows.locator('label').first();
  const ordinaryField = page.locator('#list textarea');
  const background = element => getComputedStyle(element).backgroundColor;
  assert.equal(await dayField.evaluate(background), await ordinaryField.evaluate(background));
  assert.equal((await dayField.boundingBox()).x, (await ordinaryField.boundingBox()).x);
  await hold(dayField); await release();
  assert.equal(await menu.isVisible(), true);
  assert.equal(await rows.getByRole('checkbox', {name: 'Monday'}).isChecked(), false);
  await page.keyboard.press('Escape');
  await options('Friday').tap();
  await markDone();
  assert.deepEqual(await visibleDays(), ['Monday','Wednesday']);
  const record = await page.evaluate(() => state.data.tabs.find(tab => tab.system === 'done').items.find(item => item.weeklySourceId));
  assert.equal(record.completedAt, '2030-03-09T18:00:00.000Z');
  assert.equal(record.weeklySourceId, 'day-3');
  // Simulate a fresh render from the saved checklist before and after midnight.
  await page.evaluate(async () => { const cached = await (window.checkyStorage || window.checkyApi).loadState(); state.data=normalizeData(cached.checklist); render(); });
  assert.deepEqual(await visibleDays(), ['Monday','Wednesday']);
  const zone = await page.evaluate(() => state.data.tabs[0].weeklyChecklist.timeZone);
  assert.equal(zone, 'America/New_York');
  await page.clock.setFixedTime(new Date('2030-03-10T04:59:59Z'));
  await page.evaluate(() => refreshRepeatingCheckboxes());
  assert.deepEqual(await visibleDays(), ['Monday','Wednesday']);
  await page.clock.setFixedTime(new Date('2030-03-10T05:00:00Z'));
  await page.evaluate(() => refreshRepeatingCheckboxes());
  assert.deepEqual(await visibleDays(), ['Monday','Wednesday','Friday']);
  assert.equal(await rows.locator('input:checked').count(), 0);
  await page.getByRole('button', {name:'Edit week',exact:true}).click();
  await dialog.getByRole('group',{name:'Reset checklist on'}).getByRole('button',{name:'Monday'}).click();
  await choose('Wednesday'); await choose('Sunday'); await save();
  assert.deepEqual(await visibleDays(), ['Monday','Friday','Sunday']);
  await rows.getByRole('checkbox',{name:'Friday'}).check();
  await rows.locator('label').filter({hasText: /^Sunday$/}).click({button:'right'});
  await markDone();
  await page.clock.setFixedTime(new Date('2030-03-11T04:00:00Z'));
  await page.evaluate(() => refreshRepeatingCheckboxes());
  assert.deepEqual(await visibleDays(), ['Monday','Friday','Sunday']);
  assert.equal(await rows.locator('input:checked').count(),0);
  const archive = await page.evaluate(() => {
    state.ui.doneViewOpen = true; renderItems();
    return state.data.tabs.find(tab=>tab.system==='done').items.filter(item=>item.weeklySourceId);
  });
  assert.equal(archive.length,2);
  for (const key of ['id','text','weeklySourceId','completedAt','originalTabName']) assert.equal(archive[0][key],record[key]);
  assert.ok((await page.locator('#list textarea').allTextContents()).length >= 2);
  // Undo on a prior week's history cannot clear a check from this week.
  await page.evaluate(() => { state.ui.doneViewOpen=false; renderItems(); });
  await rows.getByRole('checkbox',{name:'Friday'}).click();
  await page.getByRole('dialog', { name: 'Skip this day’s reminder?', exact: true }).getByRole('button', { name: 'Skip this day’s reminder', exact: true }).click();
  await page.locator('dialog.reminder-check-dialog').waitFor({ state: 'detached' });
  await page.evaluate(() => {
    const done = state.data.tabs[getDoneTabIndex()];
    undoDoneItem(done.items.findIndex(item => item.weeklySourceId === 'day-3'));
  });
  assert.equal(await rows.getByRole('checkbox',{name:'Friday'}).isChecked(),true);
  await options('Sunday').press('Enter');
  assert.equal(await menu.getByRole('button', {name:'Mark done'}).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const done = state.data.tabs[getDoneTabIndex()];
    undoDoneItem(done.items.findLastIndex(item => item.weeklySourceId === 'day-0'));
  });
  assert.equal(await rows.getByRole('checkbox',{name:'Sunday'}).isChecked(),false);
  await options('Monday').tap();
  await menu.getByRole('button', {name:'Edit week', exact:true}).click();
  assert.equal(await dialog.locator('input[type=time]').inputValue(), '08:15');
  await dialog.getByRole('button', {name:'Cancel'}).click();
  await page.evaluate(() => { state.settings.showDoneTab = false; render(); });
  await options('Monday').tap();
  await markDone();
  assert.equal(await rows.getByRole('checkbox', {name:'Monday'}).isChecked(), true);
  await page.evaluate(() => { state.settings.showDoneTab = true; });
  // Two independent weekly lists must not reset at Saturday 7 pm (Sunday UTC).
  await page.clock.setFixedTime(new Date('2026-11-21T22:00:00Z'));
  await page.evaluate(value => {
    state.data = value;
    for (const [index, resetDay] of [[0, 0], [1, 1]]) {
      const tab = state.data.tabs[index]; tab.items = [];
      window.checkyWeekly.configure(tab, { resetDay, time: '18:30', timeZone: 'America/New_York', days: [0,1,2,3,4,5,6], followUpMinutes: 25 }, createEntityId, 1000);
      for (const item of tab.items) window.checkyWeekly.setChecked(item, true);
    }
    render(); persistChecklistImmediately();
  }, original);
  for (const [now, counts] of [
    ['2026-11-22T00:00:00Z', [7,7]],
    ['2026-11-22T04:59:59Z', [7,7]],
    ['2026-11-22T05:00:00Z', [0,7]],
    ['2026-11-23T05:00:00Z', [0,0]]
  ]) {
    await page.clock.setFixedTime(new Date(now));
    for (const index of [0,1]) {
      await page.evaluate(index => { state.data.active = index; renderItems(); refreshRepeatingCheckboxes(); }, index);
      assert.equal(await rows.locator('input:checked').count(), counts[index], surface + ' list ' + index + ' at ' + now);
    }
  }
  await page.evaluate(value => { state.ui.doneViewOpen=false; state.data=value; render(); persistChecklistImmediately(); }, original);
  await page.clock.setSystemTime(new Date());
  console.log('PASS ' + surface + ': weekday adoption, filtering, timestamped Done history, Sunday/Monday midnight reset, DST and reopen');
}
module.exports = {checkWeekly};
