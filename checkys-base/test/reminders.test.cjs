const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { validateSubscription, subject } = require('../pocketbase/push/server.cjs');
function subscription(endpoint = 'https://fcm.googleapis.com/fcm/send/test-only') {
  const key = crypto.createECDH('prime256v1'); key.generateKeys();
  return { endpoint, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
}
test('push transport accepts browser endpoints and rejects SSRF, credentials and invalid keys', () => {
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://wns2.notify.windows.com/x']) {
    assert.equal(validateSubscription(subscription(endpoint)).endpoint, endpoint);
  }
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/api', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com.evil.test/x', 'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://example.com/x']) {
    assert.throws(() => validateSubscription(subscription(endpoint)));
  }
  assert.throws(() => validateSubscription({ ...subscription(), keys: { p256dh: 'bad', auth: 'bad' } }));
});
test('push contact uses the deployment config, with environment overrides', () => {
  assert.equal(subject({ publicOrigin: 'https://checky.example.com' }, {}), 'https://checky.example.com');
  assert.equal(subject({ pushSubject: 'mailto:owner@example.com' }, {}), 'mailto:owner@example.com');
  assert.equal(subject({}, { CHECKY_PUBLIC_ORIGIN: 'https://override.example.com' }), 'https://override.example.com');
  assert.throws(() => subject({ publicOrigin: 'http://192.168.1.5' }, {}));
  assert.throws(() => subject({}, {}));
});
test('scheduler selects due active items and excludes future, completed, stale and pre-subscription dates', () => {
  const { dueItems } = require('../pocketbase/pb_hooks/lib/reminders.js');
  const now = Date.now();
  const item = (id, offset, done = false) => ({ id, reminderAt: new Date(now + offset).toISOString(), done });
  const data = { tabs: [{ name: 'Events', items: [item('due', -1000), item('future', 1000), item('done', -1000, true), item('old', -90000000)] },
    { name: 'Done', system: 'done', items: [item('archived', -1000)] }] };
  assert.deepEqual(dueItems(data, now, now - 2000).map(item => item.id), ['due']);
  assert.deepEqual(dueItems(data, now, now).map(item => item.id), []);
});
test('service worker displays push after all app windows close and restricts notification links to this origin', async () => {
  const handlers = {}, shown = [], opened = [];
  const context = { URL, self: { location: { origin: 'https://checky.example.com' }, addEventListener: (name, handler) => { handlers[name] = handler; },
    registration: { showNotification: async (...args) => shown.push(args) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/service-worker.js'), 'utf8'), context);
  let pending;
  handlers.push({ data: { json: () => ({ body: 'Meeting', tag: 'event', url: '/?reminder=checklists:123' }) }, waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(shown[0][1].body, 'Meeting');
  const notice = shown[0][1];
  assert.equal(notice.silent, false);
  assert.equal(notice.renotify, false, 'A retry with the same event tag should not ring twice');
  assert.equal(notice.tag, 'event');
  assert.notEqual(notice.icon, notice.badge, 'Masking the opaque app icon would give Android a solid square');
  for (const asset of [notice.icon, notice.badge]) assert.ok(fs.existsSync(path.join(__dirname, '../web', asset)));
  handlers.notificationclick({ notification: { close() {}, data: shown[0][1].data }, waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(opened[0], 'https://checky.example.com/?reminder=checklists:123');
  handlers.notificationclick({ notification: { close() {}, data: { url: 'https://evil.example/' } }, waitUntil() { throw Error('External link must be rejected'); } });
});
module.exports = { subscription };

test('early-check prompt follows today in the reminder timezone, selected days and calendar boundaries', () => {
  const { hasReminderLaterToday } = require('../web/reminder-state.js');
  const item = { reminderAt: '2030-03-09T14:00:00Z', reminderRepeat: 'daily', reminderTimeZone: 'America/New_York' };
  const check = (now, expected, extra = {}) => assert.equal(hasReminderLaterToday({ ...item, ...extra }, Date.parse(now)), expected, JSON.stringify({ now, extra }));
  check('2030-03-10T10:00:00Z', true);
  check('2030-03-10T13:00:00Z', false);
  check('2030-03-10T14:00:00Z', false);
  check('2030-03-08T10:00:00Z', false, { reminderAt: '2030-03-09T14:00:00Z' });
  check('2030-03-09T10:00:00Z', true);
  check('2030-03-10T10:00:00Z', true, { reminderRepeat: 'weekly', reminderDays: [0, 3] });
  check('2030-03-10T10:00:00Z', false, { reminderRepeat: 'weekly', reminderDays: [1, 3] });
  check('2030-03-10T10:00:00Z', false, { reminderRepeat: 'weekly' });
  check('2030-03-10T10:00:00Z', false, { reminderRepeat: 'none' });
  check('2030-03-10T10:00:00Z', false, { reminderTimeZone: 'Invalid/Zone' });
  check('2030-02-28T10:00:00Z', true, { reminderAt: '2030-01-31T14:00:00Z', reminderRepeat: 'monthly' });
  check('2030-03-30T10:00:00Z', false, { reminderAt: '2030-01-31T14:00:00Z', reminderRepeat: 'monthly' });
  check('2029-02-28T10:00:00Z', true, { reminderAt: '2028-02-29T14:00:00Z', reminderRepeat: 'yearly' });
  check('2029-03-29T10:00:00Z', false, { reminderAt: '2028-02-29T14:00:00Z', reminderRepeat: 'yearly' });
  check('2030-03-10T05:00:00Z', false, { reminderAt: '2030-03-09T07:30:00Z' }); // DST gap
  check('2026-11-01T04:00:00Z', true, { reminderAt: '2026-10-31T05:30:00Z' });
  check('2026-11-01T06:00:00Z', false, { reminderAt: '2026-10-31T05:30:00Z' }); // no second fall-back reminder
  check('2030-01-02T22:00:00Z', true, { reminderAt: '2030-01-01T00:30:00Z', reminderTimeZone: 'Asia/Tokyo' }); // local Jan 3
});

test('skip today is cleared by unchecking and protects reset metadata from stale sync replies', () => {
  const { setChecked, mergeResetTimes } = require('../web/reminder-state.js');
  const item = { id: 'early', reminderAt: '2030-01-01T09:00:00Z', reminderRepeat: 'daily', reminderTimeZone: 'UTC' };
  const now = Date.parse('2030-01-02T06:00:00Z');
  setChecked(item, true, now, true);
  assert.equal(item.reminderSkipToday, true);
  const checklist = value => ({ tabs: [{ id: 'tab', items: [value] }] });
  assert.equal(mergeResetTimes(checklist(item), checklist({ ...item, reminderSkipToday: false, reminderResetAt: '2030-01-02T09:00:00Z' })), false);
  assert.equal(item.reminderResetAt, null);
  setChecked(item, false, now);
  assert.equal(item.reminderSkipToday, false);
  assert.equal(item.reminderCheckedAt, null);
  setChecked(item, true, now);
  assert.equal(item.reminderSkipToday, false);
});

test('a repeating check expires for the next occurrence; Mark done and one-off checks stay completed', () => {
  const { isChecked, setChecked, mergeResetTimes } = require('../web/reminder-state.js');
  const item = { id: 'item', reminderAt: '2030-01-01T09:00:00.000Z', reminderRepeat: 'daily', reminderTimeZone: 'UTC', reminderDays: null };
  setChecked(item, true, Date.parse('2030-01-01T10:00:00Z'));
  assert.equal(isChecked(item, Date.parse('2030-01-03T10:00:00Z')), true, 'Stay checked until the schedule is synced');
  item.reminderResetAt = '2030-01-02T09:00:00.000Z';
  assert.equal(isChecked(item, Date.parse('2030-01-02T08:59:59Z')), true);
  assert.equal(isChecked(item, Date.parse('2030-01-02T09:00:00Z')), false);
  assert.equal(item.done, true, 'The reset must not mutate stored completion or create a sync edit');
  const old = { tabs: [{ id: 'tab', items: [{ ...item }] }] };
  setChecked(item, true, Date.parse('2030-01-02T10:00:00Z'));
  const current = { tabs: [{ id: 'tab', items: [item] }] };
  assert.equal(mergeResetTimes(current, old), false, 'A late response must not replace a newer completion');
  item.reminderCheckedAt = null; item.reminderResetAt = null;
  assert.equal(isChecked(item, Date.parse('2031-01-01')), true, 'Explicit Mark done stops the series');
  item.reminderRepeat = 'none'; setChecked(item, true);
  assert.equal(item.reminderCheckedAt, null);
  assert.equal(isChecked(item), true);
  setChecked(item, false); assert.equal(isChecked(item), false);
});
