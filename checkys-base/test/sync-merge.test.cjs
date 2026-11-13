const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const webSource = fs.readFileSync(path.join(__dirname, '../web/mobile-storage.js'), 'utf8');
const desktopSource = fs.readFileSync(path.join(__dirname, '../../checkys-app/main.js'), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(webSource.replace('window.checkyStorage = {', 'window.merge = buildSafeItemMerge; window.checkyStorage = {'), context);
const clone = value => JSON.parse(JSON.stringify(value));
const merge = (base, local, remote) => clone(context.window.merge(base, local, remote));
const seed = () => ({ active: 0, tabs: [
  { id: 'meds', name: 'Meds', items: [{ id: 'sun', text: 'Sunday', done: false }, { id: 'mon', text: 'Monday', done: false }] },
  { id: 'other', name: 'Other', items: [] }
] });
const first = data => data.tabs[0].items[0];

test('Base and desktop use the same conservative reconciliation rules', () => {
  const helper = source => source.slice(source.indexOf('function buildSafeItemMerge('), source.indexOf('function buildNewItemMerge(')).replace(/normalizeChecklistData/g, 'normalizeChecklist').replace(/\s+/g, '');
  assert.equal(helper(webSource), helper(desktopSource));
});

test('different task edits merge, preserving server additions, deletion and ordering', () => {
  const base = seed(), local = clone(base), remote = clone(base);
  first(local).done = true;
  remote.tabs[0].items[1].text = 'Monday updated elsewhere';
  remote.tabs[0].items.push({ id: 'tue', text: 'Tuesday', done: false });
  remote.tabs.reverse();
  const snapshots = [base, local, remote].map(clone);
  const result = merge(base, local, remote);
  assert.equal(result.active, 1, 'Keep this device on its selected tab');
  assert.deepEqual(result.tabs[1].items.map(item => [item.text, item.done]), [['Sunday', true], ['Monday updated elsewhere', false], ['Tuesday', false]]);
  assert.deepEqual([base, local, remote], snapshots, 'Inputs remain unchanged');
  remote.tabs[1].items.splice(1, 1);
  assert.deepEqual(merge(base, local, remote).tabs[1].items.map(item => item.id), ['sun', 'tue']);
});

test('check and uncheck changes both survive unrelated remote changes', () => {
  for (const done of [false, true]) {
    const base = seed(); first(base).done = done;
    const local = clone(base), remote = clone(base);
    first(local).done = !done;
    remote.tabs[1].name = 'Renamed remotely';
    assert.equal(first(merge(base, local, remote)).done, !done);
  }
});

test('navigation-only changes and already-accepted saves recover without restoring stale data', () => {
  const base = seed(), local = clone(base), remote = clone(base);
  local.active = 1;
  first(remote).done = true;
  assert.equal(first(merge(base, local, remote)).done, true);
  assert.equal(merge(base, local, remote).active, 1);
  first(local).done = true;
  assert.equal(first(merge(base, local, remote)).done, true);
});

test('different changes to the same task, remote deletion and archive moves require review', () => {
  const base = seed(), local = clone(base), remote = clone(base);
  first(local).done = true;
  first(remote).text = 'A different task description';
  assert.equal(merge(base, local, remote), null);
  remote.tabs[0].items.shift();
  assert.equal(merge(base, local, remote), null);
  remote.tabs[1].items.push(clone(first(base)));
  assert.equal(merge(base, local, remote), null);
});

test('reminder schedule, completion time and skip-today remain one atomic task edit', () => {
  const base = seed();
  Object.assign(first(base), { reminderAt: '2030-01-01T15:00:00Z', reminderRepeat: 'daily', reminderTimeZone: 'UTC' });
  const local = clone(base), remote = clone(base);
  Object.assign(first(local), { done: true, reminderCheckedAt: '2030-01-01T10:00:00Z', reminderSkipToday: true });
  remote.tabs[0].items[1].done = true;
  const item = first(merge(base, local, remote));
  assert.equal(item.reminderSkipToday, true);
  assert.equal(item.reminderCheckedAt, '2030-01-01T10:00:00.000Z');
  first(remote).reminderAt = '2030-01-01T16:00:00Z';
  assert.equal(merge(base, local, remote), null, 'Never apply completion to a different schedule');
  Object.assign(first(remote), first(local), { reminderCheckedAt: '2030-01-02T10:00:00Z' });
  assert.equal(merge(base, local, remote), null, 'Different occurrences need review');
});

test('derived reset timestamps do not turn an unchanged task into a conflict', () => {
  const base = seed(), local = clone(base), remote = clone(base);
  first(local).done = true;
  first(remote).reminderResetAt = '2030-01-02T15:00:00Z';
  assert.equal(first(merge(base, local, remote)).done, true);
});

test('local structural edits, missing baselines and duplicate IDs never auto-merge partially', () => {
  const base = seed(), remote = clone(base);
  first(remote).text = 'Remote text';
  for (const edit of [data => data.tabs[0].items.pop(), data => data.tabs.reverse(), data => { data.tabs[0].name = 'Local rename'; }, data => data.tabs[0].items.push({ id: 'new', text: 'New task' })]) {
    const local = clone(base); edit(local);
    assert.equal(merge(base, local, remote), null);
  }
  assert.equal(merge(null, base, remote), null);
  remote.tabs[1].items.push(clone(first(remote)));
  assert.equal(merge(base, base, remote), null);
});
