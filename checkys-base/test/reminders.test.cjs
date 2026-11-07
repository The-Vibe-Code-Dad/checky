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
