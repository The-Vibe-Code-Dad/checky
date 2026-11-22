const BUILD = '__CHECKY_BUILD__';
const CACHE = 'checkys-baby-' + BUILD;
const ENTRY = './index.html?v=' + BUILD;
const ASSETS = [ENTRY, './baby.js?v=' + BUILD, './baby.css?v=' + BUILD, './amounts.js?v=' + BUILD,
  '../offline-cache.js?v=' + BUILD, '../auth-client.js?v=' + BUILD, '../auth-code-dialog.js?v=' + BUILD];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
  if (!(await (await cache.match(ENTRY)).text()).includes('./baby.js?v=' + BUILD + '"')) throw Error('Incomplete Baby app update');
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('checkys-baby-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate' && ['/baby/', '/baby/index.html'].includes(url.pathname)) {
    event.respondWith((async () => {
      // Honor a confirmed uninstall; only connection/server failures use a copy.
      try {
        const response = await fetch(event.request, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
        if (response.status < 500) return response;
      } catch (_) {}
      return (await (await caches.open(CACHE)).match(ENTRY)) || Response.error();
    })());
  } else if (ASSETS.some(asset => new URL(asset, self.location.href).href === url.href)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
  }
});
