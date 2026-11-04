// Private loopback Web Push transport and PocketBase process supervisor.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const webpush = require('web-push');

function validateSubscription(subscription) {
  const url = new URL(subscription?.endpoint);
  // Browser-owned endpoints only: never turn an authenticated subscription into
  // a request to a LAN host, metadata service, arbitrary port, or redirect.
  const host = url.hostname;
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
    host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
  if (url.protocol !== 'https:' || !allowed || url.port || url.username || url.password || url.hash ||
      subscription.endpoint.length > 2048) throw new Error('Unsupported push service.');
  const keys = subscription.keys;
  if (!keys || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys.auth) ||
      Buffer.from(keys.p256dh, 'base64url').length !== 65 || Buffer.from(keys.auth, 'base64url').length !== 16) {
    throw new Error('Invalid push subscription keys.');
  }
  crypto.ECDH.convertKey(Buffer.from(keys.p256dh, 'base64url'), 'prime256v1');
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
function subject(config, env = process.env) {
  const value = env.CHECKY_PUSH_SUBJECT || config.pushSubject || env.CHECKY_PUBLIC_ORIGIN || config.publicOrigin || '';
  const url = new URL(value);
  if (url.protocol === 'mailto:' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url.pathname)) return value;
  if (url.protocol === 'https:' && url.hostname && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password) return value;
  throw new Error('Set publicOrigin to your HTTPS site or pushSubject to a mailto: contact in checky-config.json.');
}
async function main() {
  const command = process.argv.slice(2);
  if (!command.length) throw new Error('PocketBase command is required.');
  // Non-server commands (migrate, superuser, version) retain normal CLI behavior.
  if (!command.includes('serve')) {
    const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
    child.on('exit', code => process.exit(code ?? 1));
    child.on('error', error => { console.error(error.message); process.exit(1); });
    return;
  }
  const dirIndex = command.indexOf('--dir');
  const dataDir = command.find(arg => arg.startsWith('--dir='))?.slice(6) ||
    (dirIndex >= 0 ? command[dirIndex + 1] : path.join(path.dirname(command[0]), 'pb_data'));
  fs.mkdirSync(dataDir, { recursive: true });
  const keyFile = path.join(dataDir, 'checky-push-keys.json');
  let keys;
  try { keys = JSON.parse(fs.readFileSync(keyFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(keyFile, JSON.stringify(keys) + '\n', { flag: 'wx', mode: 0o600 });
  }
  // Validate existing keys; never silently rotate them and strand subscriptions.
  webpush.setVapidDetails('mailto:validation@example.com', keys.publicKey, keys.privateKey);
  const token = crypto.randomBytes(32).toString('hex');
  const configFile = process.env.CHECKY_CONFIG_FILE || path.join(dataDir, 'checky-config.json');
  function config() {
    const value = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        (value.remindersEnabled !== undefined && typeof value.remindersEnabled !== 'boolean')) throw new Error('Invalid deployment config.');
    return value;
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== 'Bearer ' + token) return reply(403, { error: 'Forbidden' });
    try {
      const settings = config();
      if (settings.remindersEnabled === false) return reply(503, { error: 'Reminders are disabled on this server.' });
      const vapidSubject = subject(settings);
      if (req.method === 'GET' && req.url === '/status') return reply(200, { publicKey: keys.publicKey });
      if (req.method !== 'POST' || !['/validate', '/send'].includes(req.url)) return reply(404, {});
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 16384) return reply(413, {});
      }
      const body = JSON.parse(raw);
      let subscription;
      try { subscription = validateSubscription(body.subscription); } catch (_) { return reply(400, { error: 'Unsupported or invalid browser push subscription.' }); }
      if (req.url === '/validate') return reply(200, { subscription });
      try {
        await webpush.sendNotification(subscription, JSON.stringify(body.payload), {
          vapidDetails: { subject: vapidSubject, ...keys }, TTL: 3600, urgency: 'normal', timeout: 8000
        });
        reply(200, { ok: true });
      } catch (error) {
        reply(200, { ok: false, gone: [404, 410].includes(error.statusCode) });
      }
    } catch (_) { reply(503, { error: 'Configure publicOrigin or pushSubject in checky-config.json to enable reminders.' }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(process.env.CHECKY_PUSH_PORT || 8091), '127.0.0.1', resolve);
  });
  const child = spawn(command[0], command.slice(1), {
    stdio: 'inherit', env: { ...process.env, CHECKY_PUSH_TOKEN: token, CHECKY_PUSH_PORT: String(server.address().port) }
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); server.close(); process.exit(1); });
  child.on('exit', (code, signal) => { server.close(); process.exit(code ?? (signal === 'SIGTERM' ? 0 : 1)); });
}
module.exports = { validateSubscription, subject };
if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
