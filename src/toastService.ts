// ============================================================
// e-Handkerchief — ToastService
// DOM-based global notification toasts.
// ============================================================

let _container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (!_container) {
    _container = document.createElement('div');
    _container.id = 'toast-container';
    _container.className = 'toast-container';
    document.body.appendChild(_container);
  }
  return _container;
}

export const toastService = {
  /**
   * Show an auto-dismissing toast.
   * @param message Text to display (set via textContent — safe against XSS).
   * @param durationMs Milliseconds before auto-removal (default: 5000).
   */
  show(message: string, durationMs = 5000): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message; // never innerHTML
    getContainer().appendChild(el);
    setTimeout(() => el.remove(), durationMs);
  },

  /**
   * Show a persistent toast that stays until dismissed.
   * @param message Text to display.
   * @param onDismiss Optional callback fired when the toast is dismissed.
   * @returns A dismiss function — call it to programmatically remove the toast.
   */
  showPersistent(message: string, onDismiss?: () => void): () => void {
    const el = document.createElement('div');
    el.className = 'toast toast--persistent';
    el.textContent = message; // never innerHTML
    const dismiss = () => {
      el.remove();
      onDismiss?.();
    };
    el.addEventListener('click', dismiss);
    getContainer().appendChild(el);
    return dismiss;
  },
};
