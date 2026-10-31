// Run only against the disposable backend created by test-session-origin.ps1.
const assert = require('node:assert/strict');
const base = process.env.CHECKY_TEST_URL;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) {
  throw Error('Session origin tests require a disposable localhost server.');
}
const configured = process.env.CHECKY_TEST_PUBLIC_ORIGIN || '';
const origin = configured ? new URL(configured).origin : base;
const password = 'Origin-Test-Only-20261030';
async function request(path, body, headers = {}, method = 'POST') {
  const response = await fetch(base + path, {
    method, headers: {'Content-Type': 'application/json', Origin: origin, ...headers},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') || ''};
}
function checkCookie(value) {
  assert.match(value, /HttpOnly/i);
  assert.match(value, /SameSite=Lax/i);
  assert.equal(/; Secure(?:;|$)/i.test(value), origin.startsWith('https://'));
}
(async () => {
  if (process.env.CHECKY_TEST_INVALID_ORIGIN === 'true') {
    const result = await request('/api/checkys-base/session/login', {token: 'invalid'});
    assert.equal(result.status, 500, JSON.stringify(result));
    assert.equal(result.cookie, '');
    console.log('PASS invalid public origin fails closed');
    return;
  }
  const wrongOrigins = ['https://elsewhere.example', 'null', origin + '.elsewhere.example',
    origin.replace(/^https?:/, origin.startsWith('https:') ? 'http:' : 'https:'),
    new URL(origin).protocol + '//' + new URL(origin).hostname + ':19999'];
  for (const candidate of wrongOrigins) {
    for (const path of ['/api/checkys-base/first-user', '/api/checkys-base/session/login', '/api/checkys-base/session/logout']) {
      assert.equal((await request(path, {}, {Origin: candidate})).status, 403, path + ' must reject ' + candidate);
    }
  }
  const setup = await request('/api/checkys-base/first-user', {email: 'origin@example.invalid', password, passwordConfirm: password});
  assert.equal(setup.status, 200, JSON.stringify(setup));
  const native = await request('/api/collections/users/auth-with-password', {identity: 'origin@example.invalid', password}, {Origin: ''});
  assert.equal(native.status, 200, JSON.stringify(native));
  const token = native.data.token;
  const login = await request('/api/checkys-base/session/login', {token}, {'X-Forwarded-Proto': 'http'});
  assert.equal(login.status, 200, JSON.stringify(login));
  assert.equal(login.data.authenticated, true);
  checkCookie(login.cookie);
  const cookie = login.cookie.split(';')[0];
  const headers = {Cookie: cookie};
  const user = await request('/api/collections/users/records/' + native.data.record.id, undefined, headers, 'GET');
  const path = '/api/collections/checklists/records/' + user.data.defaultChecklist;
  const data = {active: 0, tabs: [{id: 'tab', name: 'Tasks', items: [{id: 'task', text: 'origin regression', done: false}]}]};
  assert.equal((await request(path, {data, version: 2}, headers, 'PATCH')).status, 200);
  for (const candidate of wrongOrigins) {
    assert.equal((await request(path, {data, version: 3}, {...headers, Origin: candidate}, 'PATCH')).status, 403);
  }
  if (configured) {
    // Neither a rewritten Host nor forged forwarding headers can override the configured origin.
    const forged = {Origin: 'https://elsewhere.example', Host: 'elsewhere.example',
      'X-Forwarded-Host': 'elsewhere.example', 'X-Forwarded-Proto': 'https'};
    assert.equal((await request('/api/checkys-base/session/login', {token}, forged)).status, 403);
    assert.equal((await request(path, {data, version: 3}, {...headers, ...forged}, 'PATCH')).status, 403);
  } else {
    // Reproduces an HTTPS browser behind an untrusted HTTP tunnel before configuration.
    const tunnel = await request('/api/checkys-base/session/login', {token}, {
      Origin: 'https://checky.example.com', Host: 'checky.example.com', 'X-Forwarded-Proto': 'http'
    });
    assert.equal(tunnel.status, 403);
    assert.match(tunnel.data.message, /Cross-origin session request rejected/);
  }
  // Desktop requests use bearer tokens, including an Electron file:// (null) origin.
  assert.equal((await request(path, {data, version: 3}, {Authorization: token, Origin: 'null'}, 'PATCH')).status, 200);
  assert.equal((await request(path, undefined, headers, 'GET')).data.version, 3);
  const rejectedLogout = await request('/api/checkys-base/session/logout', {}, {...headers, Origin: 'https://elsewhere.example'});
  assert.equal(rejectedLogout.status, 403);
  assert.equal((await request('/api/checkys-base/session', undefined, headers, 'GET')).data.authenticated, true);
  const logout = await request('/api/checkys-base/session/logout', {}, headers);
  assert.equal(logout.status, 200);
  checkCookie(logout.cookie);
  assert.equal((await request('/api/checkys-base/session', undefined, headers, 'GET')).data.authenticated, false);
  const noOrigin = await request('/api/checkys-base/session/login', {token}, {Origin: ''});
  assert.equal(noOrigin.status, 200);
  checkCookie(noOrigin.cookie);
  console.log('PASS ' + (configured ? 'fixed public origin' : 'local HTTP default') + ': bootstrap, login, cookie writes, cross-origin rejection, cookie flags, logout and desktop bearer sync');
})().catch(error => {console.error(error); process.exitCode = 1;});
