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
  assert.equal((await current()).reminderSkipToday, true);
  assert.equal((await page.evaluate(async () => (await (window.checkyStorage || window.checkyApi).loadState()).checklist)).tabs[0].items[0].reminderSkipToday, true, 'Choice reaches storage');
  await checkbox.uncheck();
  assert.equal((await current()).reminderSkipToday, false);
  await openPrompt();
  await dialog.getByRole('button', { name: 'Keep reminder', exact: true }).click();
  assert.equal((await current()).done, true);
  assert.equal((await current()).reminderSkipToday, false);
  await checkbox.uncheck();
  for (const cancel of ['Cancel', 'Escape']) {
    await openPrompt();
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: cancel, exact: true }).click();
    assert.equal((await current()).done, false);
    assert.equal(await checkbox.isChecked(), false);
    assert.equal(await checkbox.evaluate(element => document.activeElement === element), true, 'Dismissal restores checkbox keyboard focus');
  }
  await openPrompt();
  await page.evaluate(() => { state.data.tabs[0].items[0].reminderAt = '2030-03-09T15:00:00Z'; });
  await dialog.getByRole('button', { name: 'Skip today’s reminder', exact: true }).click();
  assert.equal((await current()).done, false, 'A delayed answer cannot overwrite a changed schedule');
  await page.evaluate(() => { state.data.tabs[0].items[0].reminderRepeat = 'none'; renderItems(); });
  await checkbox.check();
  assert.equal(await dialog.count(), 0, 'One-time reminders keep normal checkbox behavior');
  await page.evaluate(value => { state.data = value; renderItems(); persistChecklistImmediately(); }, original);
  await page.clock.setSystemTime(new Date());
  console.log('PASS ' + surface + ': early-check popup, skip/keep, cancellation, stored choice, uncheck and stale-answer protection');
}
module.exports = { checkEarlyReminders };
