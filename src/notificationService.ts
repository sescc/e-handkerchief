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
   * repeat post replaces rather than stacks). Does nothing unless the
   * Notification API exists, permission is granted, the setting is on, and a
   * service worker is available. Never throws.
   */
  async ensureShown(): Promise<void> {
    if (currentPermission() !== 'granted') return;
    if (settingsStore.getCurrent().quickCaptureNotification === false) return;
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('e-Handkerchief', {
        body: 'Tap to tie a knot',
        tag: NOTIFICATION_TAG,
        silent: true,
        requireInteraction: true,
      });
    } catch {
      // Ignore — showing may be unavailable in this context
    }
  },

  /**
   * Turn the quick-capture notification on. MUST be called from a click
   * handler (the permission prompt needs a user gesture). Asks for permission
   * if it hasn't been asked yet, saves the setting, and shows the
   * notification when permission is granted.
   * @returns The resulting permission state.
   */
  async enable(): Promise<NotificationPermission | 'unsupported'> {
    let permission = currentPermission();
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = currentPermission();
      }
    }
    await settingsStore.save({ quickCaptureNotification: true, notificationPermissionRequested: true });
    if (permission === 'granted') await this.ensureShown();
    return permission;
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
