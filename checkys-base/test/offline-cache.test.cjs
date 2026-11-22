const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function client() {
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const context = vm.createContext({ localStorage, URL, navigator: { onLine: false }, clearTimeout,
    window: { checkyReminderState: require('../web/reminder-state.js'), location: { protocol: 'https:', origin: 'https://example.domain' } } });
  for (const file of ['offline-cache.js', 'mobile-storage.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../web', file), 'utf8'), context);
  return { context, values, localStorage, cache: context.window.checkyOfflineCache, storage: context.window.checkyStorage };
}
const checklist = text => ({ active: 0, tabs: [{ id: 'tab', name: 'Tasks', items: [{ id: 'item', text, done: false }] }] });
function seed(client) {
  const { values, cache } = client;
  cache.session({ authenticated: true, user: { id: 'one' } });
  const meta = { userId: 'one', recordId: 'checklists:personal', version: 2, baseChecklist: checklist('Personal'), dirty: true };
  values.set('checky.android.syncMeta', JSON.stringify(meta));
  values.set('checky.android.checklist', JSON.stringify(checklist('Personal draft')));
  cache.write('one', 'checklists', { items: [{ id: meta.recordId, isPersonal: true }, { id: 'shared_checklists:shared', isPersonal: false }], assignedChecklistId: meta.recordId });
  cache.write('one', 'checklist:shared_checklists:shared', { checklist: checklist('Shared'), meta: { ...meta, recordId: 'shared_checklists:shared', dirty: false, baseChecklist: checklist('Shared') } });
}

test('offline snapshots are gated by the last confirmed account and sign-out', async () => {
  const c = client(); seed(c);
  assert.equal((await c.storage.getHostedViewSession()).offline, true);
  assert.equal((await c.storage.loadState()).currentChecklistId, 'checklists:personal');
  c.cache.session({ authenticated: true, user: { id: 'two' } });
  assert.equal(c.cache.read('one', 'checklists'), null);
  assert.equal((await c.storage.getHostedViewSession()).offline, undefined);
  assert.equal((await c.storage.loadState()).currentChecklistId, '');
  c.cache.session({ authenticated: true, user: { id: 'one' } });
  c.cache.session({ authenticated: false });
  assert.equal(c.cache.read('one', 'checklists'), null);
  assert.equal((await c.storage.getHostedViewSession()).offline, undefined);
});

test('switching offline saves each draft with its own server version and baseline', async () => {
  const c = client(); seed(c);
  const first = await c.storage.useAccessibleChecklist('shared_checklists:shared', checklist('Personal draft'));
  assert.equal(first.ok, true);
  assert.equal(first.checklist.tabs[0].items[0].text, 'Shared');
  await c.storage.saveChecklist(checklist('Shared draft'));
  const second = await c.storage.useAccessibleChecklist('checklists:personal', checklist('Shared draft'));
  assert.equal(second.ok, true);
  assert.equal(second.checklist.tabs[0].items[0].text, 'Personal draft');
  const shared = c.cache.read('one', 'checklist:shared_checklists:shared');
  assert.equal(shared.checklist.tabs[0].items[0].text, 'Shared draft');
  assert.equal(shared.meta.baseChecklist.tabs[0].items[0].text, 'Shared');
  assert.equal(shared.meta.dirty, true);
  assert.equal(shared.meta.version, 2);
});

test('a full cache refuses list switching and preserves the active draft', async () => {
  const c = client(); seed(c);
  const original = c.localStorage.setItem;
  c.localStorage.setItem = (key, value) => { if (key.includes('offline:')) throw Error('Storage full'); original(key, value); };
  const result = await c.storage.useAccessibleChecklist('shared_checklists:shared', checklist('Personal draft'));
  assert.equal(result.ok, false);
  assert.equal(result.checklist.tabs[0].items[0].text, 'Personal draft');
  assert.equal(JSON.parse(c.values.get('checky.android.syncMeta')).recordId, 'checklists:personal');
});

test('a confirmed removal cannot reopen the previously active list offline', async () => {
  const c = client(); seed(c);
  c.cache.write('one', 'checklists', { items: [] });
  assert.equal((await c.storage.getHostedViewSession()).offline, undefined);
  const result = await c.storage.useAccessibleChecklist('shared_checklists:shared', checklist('Personal draft'));
  assert.equal(result.ok, false);
});

test('a connection that drops after response headers preserves saved navigation', async () => {
  const c = client(); seed(c);
  c.context.navigator.onLine = true;
  c.context.fetch = async () => ({ ok: true, status: 200, text: async () => { throw TypeError('Connection dropped during response'); } });
  const result = await c.storage.listAccessibleChecklists();
  assert.equal(result.ok, true);
  assert.equal(result.offline, true);
  assert.equal(result.checklists.length, 2);
  assert.equal(result.currentChecklistId, 'checklists:personal');
});
