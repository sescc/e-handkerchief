// ============================================================
// e-Handkerchief — Service Worker (hand-written, no Workbox)
// Compiled with tsconfig.sw.json to /sw.js at the project root.
// ============================================================

/// <reference lib="webworker" />
export {};

// The WebWorker lib types `self` as WorkerGlobalScope, which lacks the
// ServiceWorker-specific members. Alias a correctly-typed reference.
const sw = self as unknown as ServiceWorkerGlobalScope;

// __BUILD_VERSION__ is replaced at deploy time by the CI pipeline with a unique
// value (git SHA + timestamp). During local dev it stays literal, which is fine.
const BUILD_VERSION = '__BUILD_VERSION__';
const CACHE_NAME = `e-hk-${BUILD_VERSION}`;

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
  'config.js',
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
  'src/remoteTranscribe.js',
  'src/dateFormat.js',
  'src/mapsLink.js',
  'src/types.js',
  'src/components/mediaCapture.js',
  'src/screens/captureScreen.js',
  'src/screens/knotsScreen.js',
  'src/screens/calendarScreen.js',
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
const NOMINATIM_CACHE = `e-hk-nominatim-${BUILD_VERSION}`;

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
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nominatim — network-first with timeout + LRU cache
  if (url.hostname === NOMINATIM_HOST) {
    event.respondWith(handleNominatim(req));
    return;
  }

  // Only handle same-origin requests beyond this point
  if (url.origin !== sw.location.origin) return;

  const path = url.pathname;
  const isAppCode =
    req.mode === 'navigate' ||
    path === BASE ||
    path === INDEX_URL ||
    /\.(?:js|css|html|webmanifest)$/.test(path);

  if (isAppCode) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Everything else (icons, images) — cache-first
  event.respondWith(cacheFirst(req));
});

async function networkFirst(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    // For navigations, fall back to the cached index (SPA shell)
    if (req.mode === 'navigate') {
      const indexCached = await cache.match(INDEX_URL) ?? await cache.match(BASE);
      if (indexCached) return indexCached;
    }
    return new Response('Offline – resource unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function cacheFirst(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    return new Response('Offline – resource unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

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
