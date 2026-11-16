const BUILD = "__CHECKY_BUILD__";
const CACHE_NAME = "checkys-pwa-" + BUILD;
const APP_ENTRY = "./index.html?v=" + BUILD;
const APP_SHELL = [
  APP_ENTRY,
  "./style.css?v=__CHECKY_BUILD__",
  "./checkys-base.css?v=__CHECKY_BUILD__",
  "./auth-client.js?v=__CHECKY_BUILD__",
  "./auth-code-dialog.js?v=__CHECKY_BUILD__",
  "./checkys-base.js?v=__CHECKY_BUILD__",
  "./mobile-storage.js?v=__CHECKY_BUILD__",
  "./reminder-editor.js?v=__CHECKY_BUILD__",
  "./reminder-state.js?v=__CHECKY_BUILD__",
  "./reminder-check.js?v=__CHECKY_BUILD__",
  "./weekly-checklist.js?v=__CHECKY_BUILD__",
  "./context-menu.js?v=__CHECKY_BUILD__",
  "./desktop.js?v=__CHECKY_BUILD__",
  "./renderer.js?v=__CHECKY_BUILD__",
  "./reminders.js?v=__CHECKY_BUILD__",
  "./pwa.js?v=__CHECKY_BUILD__",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./reminder-badge.png",
  "./icon-512.png",
  "./logo.png"
];

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch (_) {}
  event.waitUntil((async () => {
    if (payload.followUp && payload.deliveryId && self.registration.getNotifications) {
      const shown = await self.registration.getNotifications({ tag: payload.tag });
      if (shown.some(notice => notice.data?.deliveryId === payload.deliveryId)) return;
    }
    await self.registration.showNotification("Checky's List reminder", {
      body: typeof payload.body === 'string' ? payload.body.slice(0, 200) : 'An event reminder is due.',
      icon: './icon-192.png', badge: './reminder-badge.png',
      // The OS plays the notification channel's sound, including with no windows open.
      silent: false, renotify: payload.followUp === true,
      tag: typeof payload.tag === 'string' ? payload.tag : 'checky-reminder',
      data: { url: typeof payload.url === 'string' ? payload.url : '/', deliveryId: payload.deliveryId }
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(client => client.url === url.href);
    if (client) return client.focus();
    // Opening a separate window preserves unsaved work in an existing checklist.
    return self.clients.openWindow(url.href);
  }));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'CHECKY_VERSION') event.ports[0]?.postMessage({ version: BUILD });
});

self.addEventListener('install', event => {
  // Publish the new worker only after the entire new shell is available offline.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' })));
    const entry = await cache.match(APP_ENTRY);
    if (!(await entry.text()).includes('./pwa.js?v=' + BUILD + '"')) {
      throw new Error('The downloaded app page belongs to a different build.');
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('checkys-pwa-') && key !== CACHE_NAME).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') ||
      ['/version.json', '/service-worker.js', '/addons.json'].includes(url.pathname)) return;

  if (event.request.mode === 'navigate') {
    // Independently installed add-ons manage their own assets. Never substitute
    // the main app for a missing/uninstalled add-on or cache its pages here.
    if (!['/', '/index.html'].includes(url.pathname)) return;
    // Reload into the shell this worker actually downloaded, even if a proxy
    // still serves an older start page. The requested URL keeps its reminder parameters.
    event.respondWith(caches.open(CACHE_NAME).then(async cache =>
      (await cache.match(APP_ENTRY)) || fetch(event.request, { cache: 'no-store' })));
    return;
  }

  // Versioned assets are an immutable snapshot. Revalidating an old version's
  // URL against a new deployment could mix incompatible scripts in its cache.
  if (!APP_SHELL.some(asset => new URL(asset, self.location.href).href === url.href)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache =>
    (await cache.match(event.request)) || fetch(event.request)));
});
