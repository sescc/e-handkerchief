// ============================================================
// e-Handkerchief — NotificationService
// Requests notification permission once and registers a persistent
// capture-shortcut notification (Android PWA).
// ============================================================

import { settingsStore } from './settingsStore.js';

export const notificationService = {
  /**
   * Request notification permission if it hasn't been requested before,
   * then register the persistent capture-shortcut notification.
   * Always marks `notificationPermissionRequested: true` in settings,
   * regardless of the user's decision, so the prompt is never shown again.
   */
  async requestAndRegister(): Promise<void> {
    if (settingsStore.getCurrent().notificationPermissionRequested) return;

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification('e-Handkerchief', {
          body: 'Tap to tie a knot',
          tag: 'capture-shortcut',
          requireInteraction: true,
        });
      }
    } catch {
      // Ignore — permission may not be available in this context
    } finally {
      await settingsStore.save({ notificationPermissionRequested: true });
    }
  },
};
