// ============================================================
// e-Handkerchief — NotificationService
// Manages the quick-capture notification ("Tap to tie a knot") in the
// notification drawer. A web app cannot make an undismissable notification, so
// the app re-posts it on every launch (`ensureShown`) and the service worker
// re-posts it after each tap.
//
// The permission prompt needs a user gesture, so it is requested from the
// Settings toggle's click handler via `enable()` — never at startup.
// ============================================================

import { settingsStore } from './settingsStore.js';

const NOTIFICATION_TAG = 'capture-shortcut';

/** How long to wait for the service worker to become ready before giving up. */
const SW_READY_TIMEOUT_MS = 5000;

/**
 * Outcome of `ensureShown`.
 * - 'shown':   the notification was posted (and, where checkable, is listed).
 * - 'skipped': nothing to do (permission not granted, setting off, or no service worker API).
 * - 'failed':  posting did not work; `reason` is a short human-readable cause.
 */
export type ShowResult =
  | { status: 'shown' }
  | { status: 'skipped' }
  | { status: 'failed'; reason: string };

/** Result of turning the notification on: the permission, plus the post outcome when granted. */
export interface EnableResult {
  permission: NotificationPermission | 'unsupported';
  show?: ShowResult;
}

/** `name: message` for an Error, otherwise String(err). */
function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** The current Notification permission, or 'unsupported' when the API is missing. */
function currentPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export const notificationService = {
  /** Current permission state: 'granted' | 'denied' | 'default' | 'unsupported'. */
  permission(): NotificationPermission | 'unsupported' {
    return currentPermission();
  },

  /**
   * Post the quick-capture notification (same `capture-shortcut` tag, so a
   * repeat post replaces rather than stacks). Skips (without error) unless the
   * Notification API exists, permission is granted, the setting is on, and a
   * service worker is available. Never throws: failures are returned (and
   * logged) so the Settings screen can show why nothing appeared. After
   * posting it confirms the notification is actually listed, because Android
   * can accept the call and still not display anything.
   */
  async ensureShown(): Promise<ShowResult> {
    if (currentPermission() !== 'granted') return { status: 'skipped' };
    if (settingsStore.getCurrent().quickCaptureNotification === false) return { status: 'skipped' };
    if (!('serviceWorker' in navigator)) return { status: 'skipped' };

    // Bound the wait: `ready` never settles if no service worker is registered.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reg: ServiceWorkerRegistration | null;
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS);
      });
      reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
    } catch (err) {
      console.error('Notification: service worker not available', err);
      return { status: 'failed', reason: describeError(err) };
    } finally {
      clearTimeout(timer);
    }
    if (!reg) return { status: 'failed', reason: 'service worker not ready' };

    try {
      await reg.showNotification('e-Handkerchief', {
        body: 'Tap to tie a knot',
        tag: NOTIFICATION_TAG,
        silent: true,
        requireInteraction: true,
      });
    } catch (err) {
      console.error('Notification: showNotification failed', err);
      return { status: 'failed', reason: describeError(err) };
    }

    try {
      const listed = await reg.getNotifications({ tag: NOTIFICATION_TAG });
      if (listed.length === 0) return { status: 'failed', reason: 'not listed after showing' };
    } catch (err) {
      // Best effort: showNotification succeeded, so treat it as shown.
      console.warn('Notification: could not verify the notification is listed', err);
    }
    return { status: 'shown' };
  },

  /**
   * Turn the quick-capture notification on. MUST be called from a click
   * handler (the permission prompt needs a user gesture). Asks for permission
   * if it hasn't been asked yet, saves the setting, and shows the
   * notification when permission is granted.
   * @returns The resulting permission state, plus `show` (the outcome of
   *   posting the notification) when permission is granted.
   */
  async enable(): Promise<EnableResult> {
    let permission = currentPermission();
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = currentPermission();
      }
    }
    await settingsStore.save({ quickCaptureNotification: true, notificationPermissionRequested: true });
    if (permission === 'granted') return { permission, show: await this.ensureShown() };
    return { permission };
  },

  /** Turn the notification off: save the setting and close any shown one. */
  async disable(): Promise<void> {
    await settingsStore.save({ quickCaptureNotification: false });
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const shown = await reg.getNotifications({ tag: NOTIFICATION_TAG });
      for (const n of shown) n.close();
    } catch {
      // Ignore — nothing to close
    }
  },

};
