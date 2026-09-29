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

// ---- Conflict toast -------------------------------------------------------
// ONE persistent toast reflects how many knots currently await conflict
// review. 'knots:conflicts' can fire several times per sync and carries
// current state, so we only (re)show the toast when the COUNT changes.
let conflictToast: { dismiss: () => void; cancelled: boolean } | null = null;
let conflictToastCount = 0;

function clearConflictToast(): void {
  if (conflictToast) {
    conflictToast.cancelled = true; // a programmatic dismiss must not count as a tap
    conflictToast.dismiss();
    conflictToast = null;
  }
}

/** Take the user to the review screen, or to the list when several knots need review. */
function openConflictReview(): void {
  void cloudSyncService
    .listConflicts()
    .then((list) => navigate(list.length === 1 ? `#/conflict/${list[0].knotId}` : '#/knots'))
    .catch(() => navigate('#/knots'));
}

function syncConflictToast(count: number): void {
  if (count === conflictToastCount) return;
  clearConflictToast();
  conflictToastCount = count;
  if (count <= 0) return;

  const state = { dismiss: () => {}, cancelled: false };
  const message =
    count === 1
      ? '1 knot also has edits from another device — tap to review'
      : `${count} knots also have edits from another device — tap to review`;
  state.dismiss = toastService.showPersistent(message, () => {
    if (state.cancelled) return;
    // Dismissed by tapping: clear the handle (the count stays, so the same
    // count doesn't pop the toast up again).
    if (conflictToast === state) conflictToast = null;
    openConflictReview();
  });
  conflictToast = state;
}

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

  // Sync a check-off / uncheck to Drive as a metadata-only update. Fire and
  // forget: a failure is harmless (the next full sync reconciles it). Also
  // registered before initRouter so nothing is missed.
  eventBus.on('knot:checkedOff', (k) => {
    void cloudSyncService.pushCheckOff(k).catch((err) => {
      console.warn('Check-off sync failed (the next full sync will retry):', err);
    });
  });

  // Keep the conflict toast in step with the recorded conflicts.
  eventBus.on('knots:conflicts', ({ count }) => syncConflictToast(count));
  void cloudSyncService
    .listConflicts()
    .then((list) => syncConflictToast(list.length))
    .catch(() => {
      /* no conflict state yet — nothing to show */
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

  // 8. Re-post the quick-capture notification on every launch (only when the
  // setting is on and permission is already granted — the permission prompt
  // itself lives behind the Settings toggle, which needs a user gesture).
  void notificationService.ensureShown();

  // 9. Run a full sync on startup when already connected and online.
  if (cloudSyncService.getConnectionStatus() === 'connected' && navigator.onLine) {
    void cloudSyncService.syncAll().catch(() => {});
  }

  // 10. Backfill the connected account's email for connections made before
  // this feature existed.
  if (
    cloudSyncService.getConnectionStatus() === 'connected' &&
    navigator.onLine &&
    settingsStore.getCurrent().cloudAccountEmail === null
  ) {
    void cloudSyncService.refreshAccountInfo().catch(() => {});
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
