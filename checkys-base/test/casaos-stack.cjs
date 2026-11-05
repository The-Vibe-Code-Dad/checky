// Uses the actual CasaOS topology, local CI images, random loopback ports, and
// an empty tmpfs database. Never starts or changes the installed Checky stack.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const project = 'checky-casaos-test-' + randomUUID().slice(0, 8);
const base = path.resolve(__dirname, '..');
const docker = args => execFileSync('docker', args, {encoding:'utf8', timeout:120000});
const config = JSON.parse(docker(['compose', '-p', project, '-f', path.join(base, 'docker-compose.casaos.yml'), 'config', '--format', 'json']));
assert.deepEqual(Object.keys(config.services).sort(), ['pocketbase', 'web']);
for (const network of Object.values(config.networks)) {
  assert.ok(!network.external && network.name.startsWith(project + '_'), 'tests require isolated project networks');
}
for (const service of Object.values(config.services)) {
  assert.equal(service.container_name, undefined, 'tests require isolated project container names');
}
// CasaOS must have an explicit custom network to import, with a stable backend
// alias even if an installer changes the container or service display names.
const sharedNetwork = Object.keys(config.services.web.networks).find(name =>
  name !== 'default' && config.services.pocketbase.networks[name]?.aliases?.includes('pocketbase') &&
  config.networks[name]?.driver === 'bridge');
assert.ok(sharedNetwork, 'CasaOS requires an explicit shared bridge network and pocketbase alias');
const pb = config.services.pocketbase;
const web = config.services.web;
pb.image = 'checky-security-regression:local';
web.image = process.env.CHECKY_TEST_WEB_IMAGE || 'checky-web-regression:latest';
pb.ports = [];
pb.volumes = [];
pb.tmpfs = ['/pb/pb_data:rw,size=268435456'];
web.ports = [{target:80, host_ip:'127.0.0.1', protocol:'tcp'}];
for (const service of [pb, web]) {
  service.restart = 'no';
  service.healthcheck.interval = '1s';
  service.healthcheck.start_period = '0s';
  service.healthcheck.retries = 2;
}
pb.healthcheck.retries = 10;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), project + '-'));
const file = path.join(directory, 'compose.json');
fs.writeFileSync(file, JSON.stringify(config));
const compose = args => docker(['compose', '-p', project, '-f', file, ...args]);

(async () => {
  try {
    compose(['up', '-d', '--wait', '--wait-timeout', '60', '--pull', 'never']);
    const url = 'http://' + compose(['port', 'web', '80']).trim();
    const request = (route, options={}) => fetch(url + route, {signal:AbortSignal.timeout(10000), ...options});
    const post = (route, body) => request(route, {method:'POST', headers:{'Content-Type':'application/json', Origin:url}, body:JSON.stringify(body)});
    assert.equal((await request('/')).status, 200);
    const buildResponse = await request('/version.json');
    assert.match(buildResponse.headers.get('cache-control'), /no-cache/);
    const build = (await buildResponse.json()).version;
    assert.match(build, /^[a-f0-9]{24}$/);
    for (const asset of ['/', '/service-worker.js', '/pwa.js']) {
      const source = await (await request(asset)).text();
      assert.ok(source.includes(build) && !source.includes('__CHECKY_BUILD__'), 'The image must serve one complete stamped web build');
    }
    assert.equal((await request('/api/health')).status, 200);
    const updateResponse = await request('/desktop-updates/latest.json');
    if (process.env.CHECKY_TEST_WITH_APP === 'true') {
      assert.equal(updateResponse.status, 200);
      const update = await updateResponse.json();
      const {verifyManifest} = require('../scripts/lib/desktop-update.cjs');
      verifyManifest(update, require('../scripts/lib/update-public-key.json').publicKey);
      assert.equal(update.version, require('../desktop-release.json').version);
      const installer = await request(update.downloadUrl, {signal:AbortSignal.timeout(30000)});
      assert.equal(installer.status, 200);
      const digest = require('node:crypto').createHash('sha256').update(Buffer.from(await installer.arrayBuffer())).digest('hex');
      assert.equal(digest, update.sha256);
      console.log('PASS bundled installer and signed manifest served correctly through Base');
    } else {
      assert.equal(updateResponse.status, 404, 'Base-only image must not contain a desktop update payload');
    }
    let session = await (await request('/api/checkys-base/session')).json();
    assert.equal(session.setupRequired, true, 'fresh database must offer first-user creation through Caddy');
    assert.equal(session.authenticated, false);
    const email = 'admin@casaos-test.invalid';
    const password = randomUUID() + '-test-only';
    assert.equal((await post('/api/checkys-base/first-user', {email, password, passwordConfirm:password})).status, 200);
    const auth = await post('/api/collections/users/auth-with-password', {identity:email, password});
    assert.equal(auth.status, 200);
    const {token} = await auth.json();
    const login = await post('/api/checkys-base/session/login', {token});
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    session = await (await request('/api/checkys-base/session', {headers:{Cookie:cookie}})).json();
    assert.equal(session.setupRequired, false);
    assert.equal(session.authenticated, true);
    assert.equal(session.user.isAdmin, true);
    assert.equal((await post('/api/collections/_superusers/auth-with-password', {identity:email, password})).status, 200);
    assert.equal((await post('/api/checkys-base/first-user', {email, password, passwordConfirm:password})).status, 403);
    console.log('PASS CasaOS network discovery, first-user creation, and native/cookie authentication through the web entrypoint');

    const backend = compose(['ps', '-q', 'pocketbase']).trim();
    const frontend = compose(['ps', '-q', 'web']).trim();
    docker(['network', 'disconnect', config.networks[sharedNetwork].name, backend]);
    assert.equal((await request('/')).status, 200);
    // DNS retries can outlast the client timeout on some Docker hosts.
    const unavailable = await request('/api/health', {signal:AbortSignal.timeout(2500)})
      .then(response => response.status, error => {
        if (error.name === 'TimeoutError') return 0;
        throw error;
      });
    assert.ok([0, 502, 504].includes(unavailable), 'disconnected backend must not respond successfully');
    let health;
    for (let i = 0; i < 15; i++) {
      health = docker(['inspect', '--format', '{{.State.Health.Status}}', frontend]).trim();
      if (health === 'unhealthy') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(health, 'unhealthy', 'web health must detect loss of its backend connection');
    console.log('PASS disconnected backend makes web container unhealthy instead of reporting a working stack');
  } finally {
    try { compose(['down', '--volumes', '--remove-orphans']); }
    finally { fs.unlinkSync(file); fs.rmdirSync(directory); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
