const CACHE_NAME = "checkys-pwa-v13";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=13",
  "./checkys-base.css?v=13",
  "./auth-client.js?v=13",
  "./auth-code-dialog.js?v=13",
  "./checkys-base.js?v=13",
  "./mobile-storage.js?v=13",
  "./renderer.js?v=13",
  "./reminders.js?v=13",
  "./pwa.js?v=13",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./logo.png"
];

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification("Checky's List reminder", {
    body: typeof payload.body === 'string' ? payload.body.slice(0, 200) : 'An event reminder is due.',
    icon: './icon-192.png', badge: './icon-192.png',
    tag: typeof payload.tag === 'string' ? payload.tag : 'checky-reminder',
    data: { url: typeof payload.url === 'string' ? payload.url : '/' }
  }));
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

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

