// ============================================================
// e-Handkerchief — App Entry Point
// Boots settings, router, service worker, and background sync.
// ============================================================

import { settingsStore } from './settingsStore.js';
import { initRouter, navigate } from './router.js';
import { toastService } from './toastService.js';
import { cloudSyncService } from './cloudSyncService.js';
import { notificationService } from './notificationService.js';
import { eventBus } from './eventBus.js';

async function init(): Promise<void> {
  // 1. Load settings before any screen renders (Requirement 12.10)
  await settingsStore.load();

  // 2. Handle Google Drive OAuth callback (?code=...) if present
  const urlParams = new URLSearchParams(location.search);
  const code = urlParams.get('code');
  if (code) {
    await cloudSyncService.handleOAuthCallback(code);
  }

  // 3. Build the app shell: main content area + fixed bottom nav bar
  const appEl = document.getElementById('app');
  if (!appEl) throw new Error('#app element not found');

  const main = document.createElement('main');
  appEl.appendChild(main);

  const navBar = buildNavBar();
  appEl.appendChild(navBar);

  // 4. Upload a knot right after it's saved locally (capture, edit,
  // transcribe). Registered BEFORE initRouter (and the awaited SW
  // registration below) so a save made while either is still in flight is
  // never missed.
  eventBus.on('knot:saved', (k) => {
    if (cloudSyncService.getConnectionStatus() === 'connected') {
      void cloudSyncService.uploadKnot(k).catch(() => {
        /* queued internally by uploadKnot */
      });
    }
  });

  // 5. Init the hash-based router into the main content area
  initRouter(main);

  // 6. Register the Service Worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });

      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { type?: string; to?: string } | undefined;
        if (data?.type === 'SW_WAITING') {
          toastService.showPersistent('New version available — tap to reload', () => {
            navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
            location.reload();
          });
        } else if (data?.type === 'NAVIGATE' && data.to) {
          navigate(data.to);
        } else if (data?.type === 'FLUSH_CLOUD') {
          void cloudSyncService.syncAll().catch(() => {});
        }
      });
    } catch (err) {
      console.warn('Service Worker registration failed:', err);
    }
  }

  // 7. On reconnect: run a full cloud sync
  window.addEventListener('online', () => {
    if (cloudSyncService.getConnectionStatus() === 'connected') {
      void cloudSyncService.syncAll().catch(() => {});
    }
  });

  // 8. Request notification permission when running as an installed PWA
  if (window.matchMedia('(display-mode: standalone)').matches) {
    void notificationService.requestAndRegister();
  }

  // 9. Run a full sync on startup when already connected and online.
  if (cloudSyncService.getConnectionStatus() === 'connected' && navigator.onLine) {
    void cloudSyncService.syncAll().catch(() => {});
  }
}

function buildNavBar(): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'nav-bar';

  const knotsLink = document.createElement('a');
  knotsLink.href = '#/knots';
  knotsLink.className = 'nav-link';
  knotsLink.innerHTML = '<span class="nav-icon">🪢</span><span>Knots</span>';

  const calendarLink = document.createElement('a');
  calendarLink.href = '#/calendar';
  calendarLink.className = 'nav-link';
  const calIcon = document.createElement('span');
  calIcon.className = 'nav-icon cal-icon';
  const calDay = document.createElement('span');
  calDay.className = 'cal-icon-day';
  calDay.textContent = String(new Date().getDate());
  calIcon.appendChild(calDay);
  const calLabel = document.createElement('span');
  calLabel.textContent = 'Calendar';
  calendarLink.appendChild(calIcon);
  calendarLink.appendChild(calLabel);

  const captureBtn = document.createElement('a');
  captureBtn.href = '#/';
  captureBtn.className = 'nav-link capture-btn';
  captureBtn.setAttribute('aria-label', 'Tie a new knot');
  captureBtn.innerHTML = '<span class="nav-icon">＋</span>';

  const settingsLink = document.createElement('a');
  settingsLink.href = '#/settings';
  settingsLink.className = 'nav-link';
  settingsLink.innerHTML = '<span class="nav-icon">⚙️</span><span>Settings</span>';

  function updateActive(): void {
    const hash = window.location.hash;
    knotsLink.removeAttribute('aria-current');
    calendarLink.removeAttribute('aria-current');
    captureBtn.removeAttribute('aria-current');
    settingsLink.removeAttribute('aria-current');
    if (hash === '#/knots') {
      knotsLink.setAttribute('aria-current', 'page');
    } else if (hash === '#/calendar') {
      calendarLink.setAttribute('aria-current', 'page');
    } else if (hash === '#/settings') {
      settingsLink.setAttribute('aria-current', 'page');
    } else {
      captureBtn.setAttribute('aria-current', 'page');
    }
  }
  window.addEventListener('hashchange', updateActive);
  updateActive();

  // Order left→right: Knots, Calendar, + (capture), Settings
  nav.appendChild(knotsLink);
  nav.appendChild(calendarLink);
  nav.appendChild(captureBtn);
  nav.appendChild(settingsLink);
  return nav;
}

void init();
