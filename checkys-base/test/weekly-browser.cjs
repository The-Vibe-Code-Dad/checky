const assert = require('node:assert/strict');

async function checkWeekly(page, openTab, surface) {
  const original = await page.evaluate(() => JSON.parse(JSON.stringify(state.data)));
  const rows = page.locator('.week-row');
  const visibleDays = () => rows.locator('label').allTextContents();
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
  await page.getByRole('button', {name:'Mark Friday done',exact:true}).click();
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
  await page.getByRole('button',{name:'Mark Sunday done'}).click();
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
  await rows.getByRole('checkbox',{name:'Friday'}).check();
  await page.evaluate(() => {
    const done = state.data.tabs[getDoneTabIndex()];
    undoDoneItem(done.items.findIndex(item => item.weeklySourceId === 'day-3'));
  });
  assert.equal(await rows.getByRole('checkbox',{name:'Friday'}).isChecked(),true);
  await page.getByRole('button',{name:'Mark Sunday done'}).click();
  await page.evaluate(() => {
    const done = state.data.tabs[getDoneTabIndex()];
    undoDoneItem(done.items.findLastIndex(item => item.weeklySourceId === 'day-0'));
  });
  assert.equal(await rows.getByRole('checkbox',{name:'Sunday'}).isChecked(),false);
  await page.evaluate(value => { state.ui.doneViewOpen=false; state.data=value; render(); persistChecklistImmediately(); }, original);
  await page.clock.setSystemTime(new Date());
  console.log('PASS ' + surface + ': weekday adoption, filtering, timestamped Done history, Sunday/Monday midnight reset, DST and reopen');
}
module.exports = {checkWeekly};
