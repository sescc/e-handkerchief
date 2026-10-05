// ============================================================
// e-Handkerchief — Service Worker (hand-written, no Workbox)
// Compiled with tsconfig.sw.json to /sw.js at the project root.
// ============================================================

/// <reference lib="webworker" />
// sw.js must stay a classic script (app.ts registers it without `type: 'module'`),
// so this file must contain no ES module syntax at all.

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
  'src/knotStore.js',
  'src/settingsStore.js',
  'src/eventBus.js',
  'src/toastService.js',
  'src/geoService.js',
  'src/locateFailure.js',
  'src/mediaService.js',
  'src/mediaImport.js',
  'src/transcriptionService.js',
  'src/transcriptMerge.js',
  'src/notificationService.js',
  'src/cloudSyncService.js',
  'src/syncPlan.js',
  'src/knotSummary.js',
  'src/randomKnot.js',
  'src/knotDiff.js',
  'src/checkOffActions.js',
  'src/dayCutoff.js',
  'src/mergeMessage.js',
  'src/deviceLabel.js',
  'src/shareService.js',
  'src/remoteTranscribe.js',
  'src/dateFormat.js',
  'src/mapsLink.js',
  'src/types.js',
  'src/components/mediaCapture.js',
  'src/components/timezoneCombobox.js',
  'src/screens/captureScreen.js',
  'src/screens/knotsScreen.js',
  'src/screens/calendarScreen.js',
  'src/screens/knotDetailScreen.js',
  'src/screens/settingsScreen.js',
  'src/screens/conflictScreen.js',
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
    // Skip URLs with a query string: the OAuth return (`/?code=…`, `?error=…`)
    // carries a single-use auth code that must not sit in Cache Storage, and
    // one-off query URLs would only fill the cache.
    if (fresh && fresh.ok && new URL(req.url).search === '') {
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
  if (event.tag === 'cloud-sync') {
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
const CAPTURE_NOTIFICATION_TAG = 'capture-shortcut';

/** (Re-)post the quick-capture notification: same title/body/tag as the app's own `ensureShown`. */
function showCaptureNotification(): Promise<void> {
  return sw.registration.showNotification('e-Handkerchief', {
    body: 'Tap to tie a knot',
    tag: CAPTURE_NOTIFICATION_TAG,
    silent: true,
    requireInteraction: true,
  });
}

sw.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const tag = event.notification.tag;
  if (tag === CAPTURE_NOTIFICATION_TAG || !tag) {
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
          // Resolve against the SW scope so this works on a GitHub Pages
          // subpath too (a bare '/#/' would open the origin root).
          return sw.clients.openWindow(new URL('./#/', sw.registration.scope).href);
        })
        // A tap removes the notification; put it back so it stays available.
        .then(() => (tag === CAPTURE_NOTIFICATION_TAG ? showCaptureNotification() : undefined))
        .catch(() => undefined)
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
  // Only an update over a running version is "new version available". On the
  // very first install there is no active worker, and the page must not show
  // the reload banner for what is just the initial install.
  if (sw.registration.active) {
    void messageClients({ type: 'SW_WAITING' });
  }
});
