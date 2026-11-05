const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { buildWeb } = require('../scripts/build-web.cjs');
const { buildAddon } = require('../addons/baby-tracker/build-web.cjs');

test('separate add-on build stamps its assets without changing the core app', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'checky-addon-build-'));
  try {
    for (const name of ['one', 'two']) await fs.cp(path.join(__dirname, '../addons/baby-tracker/web'), path.join(dir, name), { recursive: true });
    const version = await buildAddon(path.join(dir, 'one'));
    assert.equal(await buildAddon(path.join(dir, 'two')), version);
    const html = await fs.readFile(path.join(dir, 'one/index.html'), 'utf8');
    assert.ok(html.includes(version)); assert.ok(!html.includes('__CHECKY_BUILD__'));
    await assert.rejects(buildAddon(path.join(dir, 'one')), /unstamped copy/);
    for (const root of ['../pocketbase', '../../pocketbase']) {
      await assert.rejects(fs.access(path.join(__dirname, root, 'pb_hooks/baby-tracker.pb.js')));
      await assert.rejects(fs.access(path.join(__dirname, root, 'pb_migrations/202611050001_checky_baby_tracker.js')));
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('Docker web versions are deterministic and change with runtime files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'checky-build-'));
  try {
    for (const name of ['one', 'two', 'changed']) await fs.cp(path.join(__dirname, '../web'), path.join(dir, name), { recursive: true, filter: source => path.basename(source) !== 'desktop-updates' });
    await fs.appendFile(path.join(dir, 'changed/renderer.js'), '\n// New runtime behavior\n');
    const one = await buildWeb(path.join(dir, 'one'));
    await assert.rejects(fs.access(path.join(dir, 'one/baby')));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'one/addons.json'), 'utf8')), []);
    assert.match(one, /^[a-f0-9]{24}$/);
    assert.equal(await buildWeb(path.join(dir, 'two')), one);
    assert.notEqual(await buildWeb(path.join(dir, 'changed')), one);
    for (const name of ['index.html', 'service-worker.js', 'pwa.js', 'version.json']) {
      const content = await fs.readFile(path.join(dir, 'one', name), 'utf8');
      assert.ok(content.includes(one)); assert.ok(!content.includes('__CHECKY_BUILD__'));
    }
    await assert.rejects(buildWeb(path.join(dir, 'one')), /unstamped copy/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('worker waits for a complete shell, preserves unrelated caches and never caches APIs or update checks', async () => {
  const handlers = {}, deleted = [], fetched = [];
  let complete = false, skipped = false, fail = false;
  const cache = {
    addAll: async requests => { assert.ok(requests.every(r => r.cache === 'reload')); if (fail) throw Error('download failed'); complete = true; },
    match: async () => new Response('cached shell')
  };
  const self = { location: { origin: 'https://checky.example.com', href: 'https://checky.example.com/service-worker.js' },
    addEventListener: (type, handler) => { handlers[type] = handler; },
    skipWaiting: async () => { assert.ok(complete); skipped = true; }, clients: { claim: async () => {} } };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../web/service-worker.js'), 'utf8'), {
    URL, self, Request: class { constructor(url, options) { this.url = url; this.cache = options.cache; } },
    caches: { open: async () => cache, keys: async () => ['checkys-pwa-v13', 'checkys-pwa-__CHECKY_BUILD__', 'other-app'], delete: async key => { deleted.push(key); } },
    fetch: async request => { fetched.push(request); return new Response('network'); }
  });
  let pending;
  handlers.install({ waitUntil: p => { pending = p; } }); await pending; assert.ok(skipped);
  skipped = false; fail = true;
  handlers.install({ waitUntil: p => { pending = p; } }); await assert.rejects(pending, /download failed/); assert.equal(skipped, false);
  handlers.activate({ waitUntil: p => { pending = p; } }); await pending; assert.deepEqual(deleted, ['checkys-pwa-v13']);
  for (const url of ['/api/checklists', '/version.json', '/service-worker.js', '/addons.json', '/desktop-updates/app.exe', 'https://external.example/']) {
    handlers.fetch({ request: { method: 'GET', url: new URL(url, self.location.origin).href }, respondWith: () => assert.fail('Must bypass the app cache: ' + url) });
  }
  handlers.fetch({ request: { method: 'GET', url: self.location.origin + '/renderer.js?v=__CHECKY_BUILD__' }, respondWith: p => { pending = p; } });
  assert.equal(await (await pending).text(), 'cached shell'); assert.deepEqual(fetched, []);
  handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: self.location.origin + '/baby/' }, respondWith: () => assert.fail('Uninstalled add-on must not fall back to the main app') });
});
