// ============================================================
// e-Handkerchief — Service Worker (hand-written, no Workbox)
// Compiled with tsconfig.sw.json to /sw.js at the project root.
// ============================================================

/// <reference lib="webworker" />
export {};

// The WebWorker lib types `self` as WorkerGlobalScope, which lacks the
// ServiceWorker-specific members. Alias a correctly-typed reference.
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = 'e-hk-v1';

// sw.js lives at <base>/sw.js — derive <base> (with trailing slash) so the
// same code works whether the app is hosted at the origin root ("/") or on a
// GitHub Pages subpath ("/e-handkerchief/").
const BASE = sw.location.pathname.replace(/sw\.js$/, '');

// Asset paths RELATIVE to the app base. '' is the base directory itself (index).
const ASSETS: string[] = [
  '',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'src/app.js',
  'src/router.js',
  'src/db.js',
  'src/noteStore.js',
  'src/settingsStore.js',
  'src/eventBus.js',
  'src/toastService.js',
  'src/geoService.js',
  'src/mediaService.js',
  'src/transcriptionService.js',
  'src/emailQueue.js',
  'src/notificationService.js',
  'src/cloudSyncService.js',
  'src/screens/captureScreen.js',
  'src/screens/journalScreen.js',
  'src/screens/noteDetailScreen.js',
  'src/screens/settingsScreen.js',
  // icons
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/shortcut-capture.png',
];

// Full pathnames (including BASE) of every precached asset.
const PRECACHE_URLS: string[] = ASSETS.map((a) => BASE + a);

// The base itself and the SPA entry document, used for navigation fallback.
const INDEX_URL = BASE + 'index.html';

const NOMINATIM_HOST = 'nominatim.openstreetmap.org';
const NOMINATIM_MAX_ENTRIES = 50;
const NOMINATIM_CACHE = 'e-hk-nominatim-v1';

// ------------------------------------------------------------
// Install — precache all static assets, then activate immediately
// ------------------------------------------------------------
sw.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => sw.skipWaiting())
  );
});

// ------------------------------------------------------------
// Activate — delete old caches and take control of clients
// ------------------------------------------------------------
sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME && k !== NOMINATIM_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => sw.clients.claim())
  );
});

// ------------------------------------------------------------
// Fetch
// ------------------------------------------------------------
sw.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Nominatim reverse geocoding — network-first with 5s timeout + LRU cache
  if (url.hostname === NOMINATIM_HOST) {
    event.respondWith(handleNominatim(event.request));
    return;
  }

  // Precached assets — cache-first
  const isPrecached =
    url.origin === sw.location.origin &&
    (PRECACHE_URLS.includes(url.pathname) || url.pathname === BASE);

  if (isPrecached) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached ?? fetch(event.request))
    );
    return;
  }

  // Navigation requests (deep links like <base>#/note/xyz) — network-first,
  // fall back to the cached index document so the SPA can boot offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached =
          (await caches.match(event.request)) ??
          (await caches.match(INDEX_URL)) ??
          (await caches.match(BASE));
        if (cached) return cached;
        return new Response('Offline – resource unavailable', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      })
    );
    return;
  }

  // Everything else — network-first, fall back to cache, then 503
  event.respondWith(
    fetch(event.request)
      .then((res) => res)
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response('Offline – resource unavailable', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      })
  );
});

async function handleNominatim(request: Request): Promise<Response> {
  const cache = await caches.open(NOMINATIM_CACHE);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      await cache.put(request, res.clone());
      await evictLRU(cache, NOMINATIM_MAX_ENTRIES);
    }
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('Offline – geocoding unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/** Simple FIFO eviction to keep the cache under `max` entries. */
async function evictLRU(cache: Cache, max: number): Promise<void> {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  const excess = keys.length - max;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}

// ------------------------------------------------------------
// Background Sync — notify the active client to flush queues
// ------------------------------------------------------------
interface SyncEvt extends ExtendableEvent {
  tag: string;
}

sw.addEventListener('sync', ((event: SyncEvt) => {
  if (event.tag === 'email-sync') {
    event.waitUntil(messageClients({ type: 'FLUSH_EMAIL' }));
  } else if (event.tag === 'cloud-sync') {
    event.waitUntil(messageClients({ type: 'FLUSH_CLOUD' }));
  }
}) as EventListener);

async function messageClients(message: unknown): Promise<void> {
  const clientList = await sw.clients.matchAll({ includeUncontrolled: true });
  for (const client of clientList) {
    client.postMessage(message);
  }
}

// ------------------------------------------------------------
// Notification click — open the capture screen
// ------------------------------------------------------------
sw.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  if (event.notification.tag === 'capture-shortcut' || !event.notification.tag) {
    event.waitUntil(
      sw.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            if ('focus' in client) {
              void (client as WindowClient).focus();
              client.postMessage({ type: 'NAVIGATE', to: '#/' });
              return;
            }
          }
          return sw.clients.openWindow('/#/');
        })
    );
  }
});

// ------------------------------------------------------------
// Messages from client — SKIP_WAITING handshake
// ------------------------------------------------------------
sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string } | undefined;
  if (data?.type === 'SKIP_WAITING') {
    void sw.skipWaiting();
  }
});

// ------------------------------------------------------------
// Notify clients when a new SW is waiting (update-available banner)
// ------------------------------------------------------------
sw.addEventListener('install', () => {
  // After install, if there is already an active worker, this SW is "waiting".
  void messageClients({ type: 'SW_WAITING' });
});
