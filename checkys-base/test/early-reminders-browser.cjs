const assert = require('node:assert/strict');
const path = require('node:path');

async function checkEarlyReminders(page, surface) {
  const original = await page.evaluate(() => JSON.parse(JSON.stringify(state.data)));
  await page.clock.setFixedTime(new Date('2030-03-10T10:00:00Z'));
  await page.evaluate(() => {
    const item = state.data.tabs[0].items[0];
    Object.assign(item, { done: false, reminderAt: '2030-03-09T14:00:00Z', reminderRepeat: 'daily', reminderTimeZone: 'America/New_York', reminderDays: null, reminderCheckedAt: null, reminderSkipToday: false });
    renderItems();
  });
  const checkbox = page.locator('#list input[type="checkbox"]').first();
  const dialog = page.getByRole('dialog', { name: 'Skip today’s reminder?', exact: true });
  const current = () => page.evaluate(() => state.data.tabs[0].items[0]);
  // Opening a confirmation does not commit the checkbox state yet; the
  // refresh timer may clear its visual check while Playwright is waiting.
  const openPrompt = async () => {
    await checkbox.click();
    await dialog.waitFor({ state: 'visible' });
  };
  await openPrompt();
  assert.equal((await current()).done, false, 'Do not save completion until the question is answered');
  const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
  if (process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, `early-reminder-${surface}.png`) });
  await dialog.getByRole('button', { name: 'Skip today’s reminder', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await current()).reminderSkipToday, true);
  assert.equal((await page.evaluate(async () => (await (window.checkyStorage || window.checkyApi).loadState()).checklist)).tabs[0].items[0].reminderSkipToday, true, 'Choice reaches storage');
  await checkbox.uncheck();
  assert.equal((await current()).reminderSkipToday, false);
  await openPrompt();
  await dialog.getByRole('button', { name: 'Keep reminder', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await current()).done, true);
  assert.equal((await current()).reminderSkipToday, false);
  await checkbox.uncheck();
  for (const cancel of ['Cancel', 'Escape']) {
    await openPrompt();
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: cancel, exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal((await current()).done, false);
    assert.equal(await checkbox.isChecked(), false);
    assert.equal(await checkbox.evaluate(element => document.activeElement === element), true, 'Dismissal restores checkbox keyboard focus');
  }
  await openPrompt();
  await page.evaluate(() => { state.data.tabs[0].items[0].reminderAt = '2030-03-09T15:00:00Z'; });
  await dialog.getByRole('button', { name: 'Skip today’s reminder', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await current()).done, false, 'A delayed answer cannot overwrite a changed schedule');
  await page.evaluate(() => { state.data.tabs[0].items[0].reminderRepeat = 'none'; renderItems(); });
  await checkbox.check();
  assert.equal(await dialog.count(), 0, 'One-time reminders keep normal checkbox behavior');
  await checkWeeklyEarlyReminders(page, surface);
  await page.evaluate(value => { state.data = value; renderItems(); persistChecklistImmediately(); }, original);
  await page.clock.setSystemTime(new Date());
  console.log('PASS ' + surface + ': early-check popup, skip/keep, cancellation, stored choice, uncheck and stale-answer protection');
}

async function checkWeeklyEarlyReminders(page, surface) {
  await page.clock.setFixedTime(new Date('2030-03-10T10:00:00Z')); // Sunday morning, before the reminder.
  await page.evaluate(() => {
    for (const tab of state.data.tabs.slice(0, 2)) {
      tab.items = [];
      window.checkyWeekly.configure(tab, { resetDay: 0, time: '09:00', timeZone: 'America/New_York',
        days: [0, 1, 2, 3, 4, 5, 6], followUpMinutes: 25 }, createEntityId, 1000);
    }
    renderItems(); persistChecklistImmediately();
  });
  const untouched = await page.evaluate(() => JSON.stringify(state.data.tabs[1]));
  const checkbox = page.getByRole('checkbox', { name: 'Sunday', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Skip today’s reminder?', exact: true });
  const current = () => page.evaluate(() => {
    const tab = state.data.tabs[0];
    return tab.items.find(item => item.id === tab.weeklyChecklist.itemIds[0]);
  });
  const open = async () => {
    await checkbox.tap();
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal((await current()).done, false, 'A weekly check waits for the reminder choice');
    assert.equal(await dialog.getByRole('button', { name: 'Keep reminder', exact: true }).count(), 0,
      'A completed weekly day always stops its reminders until the weekly reset');
  };
  for (const action of ['Cancel', 'Escape']) {
    await open();
    if (action === 'Cancel' && process.env.CHECKY_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CHECKY_SCREENSHOT_DIR, `weekly-early-reminder-${surface}.png`) });
    if (action === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await dialog.waitFor({ state: 'detached' });
    assert.equal((await current()).done, false);
    assert.equal(await checkbox.isChecked(), false);
    assert.equal(await checkbox.evaluate(element => document.activeElement === element), true);
    assert.equal((await page.evaluate(async () => (await (window.checkyStorage || window.checkyApi).loadState()).checklist)).tabs[0].items[0].done, false,
      'Cancelling must not persist the pending check');
  }
  await open();
  await dialog.getByRole('button', { name: 'Skip today’s reminder', exact: true }).press('Enter');
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await current()).done, true);
  assert.equal((await current()).reminderSkipToday, true);
  const saved = await page.evaluate(async () => (await (window.checkyStorage || window.checkyApi).loadState()).checklist);
  assert.equal(saved.tabs[0].items.find(item => item.id === saved.tabs[0].weeklyChecklist.itemIds[0]).reminderSkipToday, true);
  const slots = await page.evaluate(() => {
    const tab = state.data.tabs[0], item = tab.items.find(item => item.id === tab.weeklyChecklist.itemIds[0]);
    return ['2030-03-10T13:00:00Z', '2030-03-10T13:25:00Z', '2030-03-17T13:00:00Z']
      .map(now => Number.isFinite(window.checkyWeekly.notificationSlot(item, tab, Date.parse(now), 0)));
  });
  assert.deepEqual(slots, [false, false, true], 'Skip stops this day and follow-ups; the next week can remind again');
  await checkbox.uncheck();
  assert.equal((await current()).reminderSkipToday, false);
  await open();
  await page.evaluate(() => { state.data.tabs[0].weeklyChecklist.resetDay = 1; });
  await dialog.getByRole('button', { name: 'Skip today’s reminder', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await current()).done, false, 'A delayed answer cannot overwrite a changed weekly setup');
  await open();
  await page.clock.setFixedTime(new Date('2030-03-18T10:00:00Z'));
  await dialog.getByRole('button', { name: 'Skip today’s reminder', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await current()).done, false, 'A delayed answer cannot complete a day in a different week');
  await page.clock.setFixedTime(new Date('2030-03-10T10:00:00Z'));
  await page.evaluate(() => refreshRepeatingCheckboxes());
  await page.getByRole('checkbox', { name: 'Monday', exact: true }).check();
  assert.equal(await dialog.count(), 0, 'Other weekdays keep normal weekly check behavior');
  assert.equal(await page.evaluate(() => JSON.stringify(state.data.tabs[1])), untouched, 'The other weekly list is unchanged');
  console.log('PASS ' + surface + ': weekly early-check popup, Cancel/Escape, skip persistence, follow-ups, next week and stale setup');
}
module.exports = { checkEarlyReminders };
