// ============================================================
// e-Handkerchief — App Entry Point
// Boots settings, router, service worker, and background sync.
// ============================================================

import { settingsStore } from './settingsStore.js';
import { initRouter, navigate } from './router.js';
import { toastService } from './toastService.js';
import { emailQueue } from './emailQueue.js';
import { cloudSyncService } from './cloudSyncService.js';
import { notificationService } from './notificationService.js';

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

  // 4. Init the hash-based router into the main content area
  initRouter(main);

  // 5. Register the Service Worker
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
        } else if (data?.type === 'FLUSH_EMAIL') {
          void emailQueue.flush();
        } else if (data?.type === 'FLUSH_CLOUD') {
          void cloudSyncService.uploadPending();
        }
      });
    } catch (err) {
      console.warn('Service Worker registration failed:', err);
    }
  }

  // 6. On reconnect: flush the email queue and any pending uploads
  window.addEventListener('online', () => {
    void emailQueue.flush();
    if (cloudSyncService.getConnectionStatus() === 'connected') {
      void cloudSyncService.uploadPending();
    }
  });

  // 7. Request notification permission when running as an installed PWA
  if (window.matchMedia('(display-mode: standalone)').matches) {
    void notificationService.requestAndRegister();
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
  calendarLink.innerHTML = '<span class="nav-icon">📅</span><span>Calendar</span>';

  const captureBtn = document.createElement('a');
  captureBtn.href = '#/';
  captureBtn.className = 'nav-link capture-btn';
  captureBtn.setAttribute('aria-label', 'New Note');
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
    // '#/journal' is the back-compat alias for the Knots tab.
    if (hash === '#/knots' || hash === '#/journal') {
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
