// Starts its own disposable PocketBase; never targets an existing installation.
// npm ci --prefix checkys-base/pocketbase/push
// CHECKY_POCKETBASE_BINARY=/path/to/pocketbase node checkys-base/test/reminders-integration.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { validateSubscription } = require('../pocketbase/push/server.cjs');
const password = 'Disposable-Only-Checky-20261104!';
async function main() {
  const binary = process.env.CHECKY_POCKETBASE_BINARY;
  if (!binary) throw Error('Set CHECKY_POCKETBASE_BINARY to the PocketBase executable.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'checky-reminders-'));
  const sent = [];
  let outcome = { ok: true };
  let child, logs = '';
  const transport = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-only-token');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    let code = 200, result;
    try {
      if (req.url === '/status') result = { publicKey: 'test-only' };
      else if (req.url === '/validate') result = { subscription: validateSubscription(body.subscription) };
      else { sent.push(body); result = outcome; }
    } catch (_) { code = 400; result = { error: 'Invalid subscription' }; }
    res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
  });
  await new Promise(resolve => transport.listen(0, '127.0.0.1', resolve));
  const reserve = http.createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  async function req(url, method = 'GET', body, headers = {}) {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: (response.headers.get('set-cookie') || '').split(';')[0], setCookie: response.headers.get('set-cookie') || '' };
  }
  try {
    await fs.cp(path.join(__dirname, '../pocketbase/pb_hooks'), path.join(dir, 'hooks'), { recursive: true });
    await fs.writeFile(path.join(dir, 'hooks/test-reminders.pb.js'), `
routerAdd('POST', '/api/checky-test/reminders/run', (e) => { require(__hooks + '/lib/reminders.js').deliver(e.app); return e.json(200, {ok:true}) }, $apis.requireSuperuserAuth())
routerAdd('POST', '/api/checky-test/reminders/calendar', (e) => {
  const results = e.requestInfo().body.cases.map(test => require(__hooks + '/lib/reminders.js').dueItems(
    {tabs:[{name:'Events',items:[test.item]}]}, Date.parse(test.now), Date.parse(test.enabledAt || '2000-01-01T00:00:00Z')).map(item => item.at))
  return e.json(200, {results})
}, $apis.requireSuperuserAuth())
routerAdd('POST', '/api/checky-test/reminders/next', (e) => e.json(200, {results:e.requestInfo().body.cases.map(test => {
  const at = require(__hooks + '/lib/reminder-schedule.js').nextOccurrence(test.item, Date.parse(test.after))
  return Number.isFinite(at) ? new Date(at).toISOString() : null
})}), $apis.requireSuperuserAuth())`);
    child = spawn(binary, ['serve', '--automigrate=false', '--http=127.0.0.1:' + port, '--dir=' + path.join(dir, 'data'), '--hooksDir=' + path.join(dir, 'hooks'), '--migrationsDir=' + path.join(__dirname, '../pocketbase/pb_migrations')], {
      env: { ...process.env, CHECKY_PUSH_TOKEN: 'test-only-token', CHECKY_PUSH_PORT: String(transport.address().port), CHECKY_PUBLIC_ORIGIN: '', CHECKY_CONFIG_FILE: '' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
    for (let i = 0; i < 100; i++) {
      try { if ((await req('/api/health')).status === 200) break; } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const configFile = path.join(dir, 'data/checky-config.json');
    const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
    assert.equal(config.publicOrigin, '');
    await req('/api/checkys-base/first-user', 'POST', { email: 'admin@reminders.invalid', password, passwordConfirm: password });
    const admin = await req('/api/collections/_superusers/auth-with-password', 'POST', { identity: 'admin@reminders.invalid', password });
    assert.ok(admin.data.token); const ah = { Authorization: admin.data.token };
    const calendarCase = (repeat, first, now, expected, extra = {}) => ({
      item: { id: 'calendar', reminderAt: first, reminderRepeat: repeat, reminderTimeZone: 'America/New_York', ...extra }, now,
      expected: expected ? [new Date(expected).toISOString()] : []
    });
    const calendarCases = [
      calendarCase('daily', '2030-03-09T14:00:00Z', '2030-03-10T13:05:00Z', '2030-03-10T13:00:00Z'),
      calendarCase('weekly', '2030-03-03T14:00:00Z', '2030-03-10T13:05:00Z', '2030-03-10T13:00:00Z'),
      calendarCase('monthly', '2030-01-31T14:00:00Z', '2030-02-28T14:05:00Z', '2030-02-28T14:00:00Z'),
      calendarCase('monthly', '2030-01-31T14:00:00Z', '2030-03-31T13:05:00Z', '2030-03-31T13:00:00Z'),
      calendarCase('yearly', '2028-02-29T14:00:00Z', '2029-02-28T14:05:00Z', '2029-02-28T14:00:00Z'),
      calendarCase('yearly', '2028-02-29T14:00:00Z', '2032-02-29T14:05:00Z', '2032-02-29T14:00:00Z'),
      calendarCase('daily', '2030-03-09T07:30:00Z', '2030-03-10T08:00:00Z', null),
      calendarCase('daily', '2030-03-09T07:30:00Z', '2030-03-11T06:35:00Z', '2030-03-11T06:30:00Z'),
      calendarCase('daily', '2026-10-31T05:30:00Z', '2026-11-01T05:45:00Z', '2026-11-01T05:30:00Z'),
      calendarCase('daily', '2026-10-31T05:30:00Z', '2026-11-01T06:45:00Z', '2026-11-01T05:30:00Z'),
      calendarCase('daily', '2028-01-01T14:00:00Z', '2030-03-10T13:05:00Z', '2030-03-10T13:00:00Z'),
      calendarCase('daily', '2030-03-09T14:00:00Z', '2030-03-10T13:05:00Z', null, { done: true }),
      calendarCase('daily', '2030-03-09T14:00:00Z', '2030-03-10T13:05:00Z', null, { reminderAt: null }),
      calendarCase('daily', '2030-03-09T14:00:00Z', '2030-03-10T13:05:00Z', null, { reminderTimeZone: 'Invalid/Zone' }),
      calendarCase('weekly', '2030-03-10T13:00:00Z', '2030-03-12T13:05:00Z', null),
      calendarCase('daily', '2030-03-11T13:00:00Z', '2030-03-10T13:05:00Z', null),
      calendarCase('weekly', '2030-03-09T14:00:00Z', '2030-03-09T14:05:00Z', null, { reminderDays: [1, 3, 5] }),
      calendarCase('weekly', '2030-03-09T14:00:00Z', '2030-03-11T13:05:00Z', '2030-03-11T13:00:00Z', { reminderDays: [1, 3, 5] }),
      calendarCase('weekly', '2030-03-09T14:00:00Z', '2030-03-13T13:05:00Z', '2030-03-13T13:00:00Z', { reminderDays: [1, 3, 5] }),
      calendarCase('weekly', '2030-03-09T14:00:00Z', '2030-03-12T13:05:00Z', null, { reminderDays: [1, 3, 5] }),
      calendarCase('weekly', '2030-03-09T14:00:00Z', '2030-03-16T13:05:00Z', '2030-03-16T13:00:00Z', { reminderDays: [6] }),
      calendarCase('weekly', '2030-03-03T14:00:00Z', '2030-03-10T13:05:00Z', '2030-03-10T13:00:00Z', { reminderDays: [0] }),
      calendarCase('weekly', '2030-03-09T07:30:00Z', '2030-03-10T08:00:00Z', null, { reminderDays: [0] }),
      calendarCase('weekly', '2030-03-09T07:30:00Z', '2030-03-11T06:35:00Z', '2030-03-11T06:30:00Z', { reminderDays: [0, 1] }),
      calendarCase('weekly', '2026-10-31T05:30:00Z', '2026-11-01T06:45:00Z', '2026-11-01T05:30:00Z', { reminderDays: [0] }),
      calendarCase('weekly', '2026-11-01T06:30:00Z', '2026-11-01T06:45:00Z', '2026-11-01T06:30:00Z', { reminderDays: [0] }),
      calendarCase('weekly', '2030-03-09T19:00:00Z', '2030-03-10T19:05:00Z', '2030-03-10T19:00:00Z', { reminderDays: [1], reminderTimeZone: 'Pacific/Kiritimati' }),
      calendarCase('weekly', '2030-03-09T14:00:00Z', '2030-03-11T13:05:00Z', null, { reminderDays: [] }),
      calendarCase('weekly', '2030-03-09T14:00:00Z', '2030-03-11T13:05:00Z', null, { reminderDays: [8] }),
      calendarCase('weekly', '2030-03-09T14:00:00Z', '2030-03-11T13:05:00Z', null, { reminderDays: ['1'] }),
      calendarCase('weekly', '2030-03-09T14:00:00Z', '2030-03-11T13:05:00Z', null, { reminderDays: 'Monday' })
    ];
    const calendar = await req('/api/checky-test/reminders/calendar', 'POST', { cases: calendarCases }, ah);
    assert.equal(calendar.status, 200, JSON.stringify(calendar.data));
    calendarCases.forEach((test, i) => assert.deepEqual(calendar.data.results[i], test.expected, JSON.stringify(test)));
    console.log('PASS calendar repeats, DST gaps/folds, month ends, leap years, no backlog and cancelled/invalid schedules');
    const nextCases = [
      ['daily', '2030-03-09T14:00:00Z', '2030-03-09T15:00:00Z', '2030-03-10T13:00:00Z'],
      ['daily', '2030-03-09T07:30:00Z', '2030-03-09T08:00:00Z', '2030-03-11T06:30:00Z'],
      ['weekly', '2030-03-03T07:30:00Z', '2030-03-03T08:00:00Z', '2030-03-17T06:30:00Z'],
      ['weekly', '2030-03-09T14:00:00Z', '2030-03-11T13:30:00Z', '2030-03-13T13:00:00Z', {reminderDays:[1,3,5]}],
      ['weekly', '2030-03-09T14:00:00Z', '2030-03-08T13:30:00Z', '2030-03-11T13:00:00Z', {reminderDays:[1]}],
      ['monthly', '2030-01-31T14:00:00Z', '2030-01-31T15:00:00Z', '2030-02-28T14:00:00Z'],
      ['monthly', '2030-01-31T14:00:00Z', '2030-02-28T15:00:00Z', '2030-03-31T13:00:00Z'],
      ['yearly', '2028-02-29T14:00:00Z', '2028-03-01T15:00:00Z', '2029-02-28T14:00:00Z'],
      ['daily', '2026-10-31T05:30:00Z', '2026-11-01T05:45:00Z', '2026-11-02T06:30:00Z'],
      ['daily', '2026-11-01T06:30:00Z', '2026-11-01T06:00:00Z', '2026-11-01T06:30:00Z'],
      ['weekly', '2030-03-09T14:00:00Z', '2030-03-11T13:30:00Z', null, {reminderDays:[]}]
    ].map(([repeat, first, after, expected, extra]) => ({ item: calendarCase(repeat, first, after, null, extra).item, after, expected:expected ? new Date(expected).toISOString() : null }));
    const next = await req('/api/checky-test/reminders/next', 'POST', {cases:nextCases}, ah);
    assert.equal(next.status, 200, JSON.stringify(next.data));
    nextCases.forEach((test,i) => assert.equal(next.data.results[i], test.expected, JSON.stringify(test)));
    const checkedCases = [
      calendarCase('daily', '2030-03-09T14:00:00Z', '2030-03-09T15:05:00Z', null, {done:true, reminderCheckedAt:'2030-03-09T15:00:00Z'}),
      calendarCase('daily', '2030-03-09T14:00:00Z', '2030-03-10T13:05:00Z', '2030-03-10T13:00:00Z', {done:true, reminderCheckedAt:'2030-03-09T15:00:00Z'}),
      calendarCase('daily', '2030-03-09T14:00:00Z', '2030-03-10T13:05:00Z', null, {done:true, reminderCheckedAt:null})
    ];
    const checked = await req('/api/checky-test/reminders/calendar', 'POST', {cases:checkedCases}, ah);
    checkedCases.forEach((test,i) => assert.deepEqual(checked.data.results[i], test.expected));
    console.log('PASS next occurrence after checking, selected weekdays, DST gaps/folds, month/year boundaries and permanent completion');
    const create = async name => {
      const result = await req('/api/collections/users/records', 'POST', { email: name + '@reminders.invalid', password, passwordConfirm: password }, ah);
      assert.equal(result.status, 200); return { ...result.data, email: name + '@reminders.invalid' };
    };
    const alice = await create('alice'), bob = await create('bob');
    const login = await req('/api/collections/users/auth-with-password', 'POST', { identity: alice.email, password });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const session = await req('/api/checkys-base/session/login', 'POST', { token: login.data.token });
    assert.equal(session.status, 200, JSON.stringify(session.data));
    const ch = { Cookie: session.cookie };
    const pair = crypto.createECDH('prime256v1'); pair.generateKeys();
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/disposable-test', keys: { p256dh: pair.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
    assert.equal((await req('/api/checkys-base/push')).status, 401);
    assert.equal((await req('/api/checkys-base/push', 'POST', { subscription }, { ...ch, Origin: 'https://evil.example' })).status, 403);
    assert.equal((await req('/api/checkys-base/push', 'POST', { subscription: { ...subscription, endpoint: 'https://127.0.0.1/' } }, ch)).status, 400);
    assert.equal((await req('/api/checkys-base/push', 'POST', { subscription }, ch)).status, 200);
    assert.equal((await req('/api/checkys-base/push', 'POST', { subscription }, ch)).status, 200);
    const subscriptions = await req('/api/collections/checky_push_subscriptions/records', 'GET', undefined, ah);
    assert.equal(subscriptions.data.totalItems, 1);
    assert.notEqual((await req('/api/collections/checky_push_subscriptions/records', 'GET', undefined, ch)).status, 200);
    const subId = subscriptions.data.items[0].id;
    await req('/api/collections/checky_push_subscriptions/records/' + subId, 'PATCH', { enabledAt: new Date(Date.now() - 60000).toISOString() }, ah);
    const dueAt = new Date(Date.now() - 1000).toISOString();
    const data = items => ({ tabs: [{ name: 'Events', items: items.map(item => ({ text: item.id, reminderAt: dueAt, ...item })) }] });
    const update = (user, items, version = 2) => req('/api/collections/checklists/records/' + user.defaultChecklist, 'PATCH', { data: data(items), version }, ah);
    const recurringAnchor = new Date(Date.parse(dueAt) - 86400000 * 5).toISOString();
    const checkedAt = new Date(Date.parse(dueAt) - 86400000 + 10000).toISOString();
    const savedRepeat = await update(alice, [{ id: 'due', done:true, reminderCheckedAt:checkedAt, reminderResetAt:'2099-01-01T00:00:00Z', reminderAt: recurringAnchor, reminderRepeat: 'weekly', reminderTimeZone: 'UTC', reminderDays: [0, 1, 2, 3, 4, 5, 6] }, { id: 'done', done: true }, { id: 'future', reminderAt: new Date(Date.now() + 60000).toISOString() }]);
    assert.equal(savedRepeat.status, 200, JSON.stringify(savedRepeat.data));
    assert.equal(savedRepeat.data.data.tabs[0].items[0].reminderResetAt, dueAt, 'Server computes the reset time');
    await update(bob, [{ id: 'private-bob' }]);
    const run = async () => { const result = await req('/api/checky-test/reminders/run', 'POST', {}, ah); assert.equal(result.status, 200, JSON.stringify(result.data)); };
    config.remindersEnabled = false;
    await fs.writeFile(configFile, JSON.stringify(config));
    await run(); assert.equal(sent.length, 0);
    config.remindersEnabled = true;
    await fs.writeFile(configFile, JSON.stringify(config));
    await run(); assert.equal(sent.length, 1); assert.equal(sent[0].payload.body, 'due');
    await run(); assert.equal(sent.length, 1);
    console.log('PASS authenticated subscriptions, CSRF/SSRF rejection, private isolation, due delivery and duplicate prevention');
    const afterDelivery = await req('/api/collections/checklists/records/' + alice.defaultChecklist, 'GET', undefined, ah);
    assert.equal(afterDelivery.data.version, 2, 'Repeats must not create background sync conflicts');
    const legacy = data([{ id: 'due', done:true }]); delete legacy.tabs[0].items[0].reminderAt;
    const legacySave = await req('/api/collections/checklists/records/' + alice.defaultChecklist, 'PATCH', { data: legacy, version: 3 }, ah);
    assert.equal(legacySave.data.data.tabs[0].items[0].reminderAt, recurringAnchor);
    assert.equal(legacySave.data.data.tabs[0].items[0].reminderRepeat, 'weekly');
    assert.equal(legacySave.data.data.tabs[0].items[0].reminderTimeZone, 'UTC');
    assert.deepEqual(legacySave.data.data.tabs[0].items[0].reminderDays, [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(legacySave.data.data.tabs[0].items[0].reminderCheckedAt, checkedAt);
    assert.equal(legacySave.data.data.tabs[0].items[0].reminderResetAt, dueAt);
    const cleared = data([{ id: 'due', reminderAt: null }]);
    const clearSave = await req('/api/collections/checklists/records/' + alice.defaultChecklist, 'PATCH', { data: cleared, version: 4 }, ah);
    assert.equal(clearSave.data.data.tabs[0].items[0].reminderAt, null);
    assert.equal(clearSave.data.data.tabs[0].items[0].reminderDays, null);
    console.log('PASS older clients retain omitted reminder dates; explicit null removes them');
    const shared = await req('/api/collections/shared_checklists/records', 'POST', { owner: bob.id, sharedWith: [alice.id], shareKey: 'reminder-shared', name: 'Shared', data: data([{ id: 'shared' }]), version: 1 }, ah);
    assert.equal(shared.status, 200, JSON.stringify(shared.data));
    await run(); assert.equal(sent.length, 2);
    await req('/api/collections/shared_checklists/records/' + shared.data.id, 'PATCH', { sharedWith: [], data: data([{ id: 'revoked' }]), version: 2 }, ah);
    await update(alice, [{ id: 'done', done: true }], 5);
    await run(); assert.equal(sent.length, 2);
    console.log('PASS shared recipients, revoked sharing, completion and removal');
    outcome = { ok: false };
    await update(alice, [{ id: 'retry' }], 6);
    await run(); assert.equal(sent.length, 3);
    await run(); assert.equal(sent.length, 3);
    const deliveries = await req('/api/collections/checky_push_deliveries/records', 'GET', undefined, ah);
    const retry = deliveries.data.items.find(item => !item.sent);
    assert.ok(retry);
    await req('/api/collections/checky_push_deliveries/records/' + retry.id, 'PATCH', { retryAt: dueAt }, ah);
    outcome = { ok: true };
    await run(); assert.equal(sent.length, 4);
    await run(); assert.equal(sent.length, 4);
    outcome = { ok: false, gone: true };
    await update(alice, [{ id: 'expired' }], 7);
    await run();
    assert.equal((await req('/api/collections/checky_push_subscriptions/records', 'GET', undefined, ah)).data.totalItems, 0);
    console.log('PASS transient failures back off and retry; expired browser subscriptions are removed');
    await req('/api/checkys-base/push', 'POST', { subscription }, ch);
    await req('/api/checkys-base/session/logout', 'POST', {}, ch);
    assert.equal((await req('/api/collections/checky_push_subscriptions/records', 'GET', undefined, ah)).data.totalItems, 0);
    console.log('PASS sign-out removes this session’s notification subscriptions');
    const secondSession = await req('/api/checkys-base/session/login', 'POST', { token: login.data.token });
    await req('/api/checkys-base/push', 'POST', { subscription }, { Cookie: secondSession.cookie });
    await req('/api/collections/users/records/' + alice.id, 'PATCH', { password: password + '-new', passwordConfirm: password + '-new' }, ah);
    await run();
    assert.equal((await req('/api/collections/checky_push_subscriptions/records', 'GET', undefined, ah)).data.totalItems, 0);
    login.data.token = (await req('/api/collections/users/auth-with-password', 'POST', { identity: alice.email, password: password + '-new' })).data.token;
    assert.ok(login.data.token);
    console.log('PASS password reset revokes push subscriptions; the server-wide pause stops delivery');
    config.publicOrigin = 'https://checky.example.com';
    await fs.writeFile(configFile, JSON.stringify(config));
    assert.equal((await req('/api/checkys-base/session/login', 'POST', { token: login.data.token }, { Origin: base })).status, 403);
    const httpsLogin = await req('/api/checkys-base/session/login', 'POST', { token: login.data.token }, { Origin: config.publicOrigin });
    assert.equal(httpsLogin.status, 200); assert.match(httpsLogin.setCookie, /Secure/i);
    await fs.writeFile(configFile, '{invalid');
    assert.equal((await req('/api/checkys-base/session/login', 'POST', { token: login.data.token }, { Origin: base })).status, 500);
    console.log('PASS persistent config changes apply without recreation, pin HTTPS origin and fail closed on invalid JSON');
  } catch (error) { console.error(logs); throw error; }
  finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await new Promise(resolve => transport.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
