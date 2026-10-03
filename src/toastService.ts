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
    // Tap/click dismisses immediately; clear the timer so it can't fire later.
    const dismiss = () => {
      clearTimeout(timer);
      el.remove();
    };
    const timer = setTimeout(dismiss, durationMs);
    el.addEventListener('click', dismiss);
    getContainer().appendChild(el);
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

  /**
   * Show an auto-dismissing toast with one action button (e.g. "Undo").
   * Clicking the button runs `onAction` once and removes the toast.
   * @param message Text to display (set via textContent).
   * @param actionLabel Label of the action button (set via textContent).
   * @param onAction Callback fired when the button is clicked (at most once).
   * @param durationMs Milliseconds before auto-removal (default: 5000).
   * @returns A dismiss function — removes the toast without running `onAction`.
   */
  showAction(
    message: string,
    actionLabel: string,
    onAction: () => void,
    durationMs = 5000
  ): () => void {
    const el = document.createElement('div');
    el.className = 'toast toast--action';

    const text = document.createElement('span');
    text.className = 'toast-action-text';
    text.textContent = message; // never innerHTML

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action-btn';
    btn.textContent = actionLabel; // never innerHTML

    let done = false;
    const timer = setTimeout(() => dismiss(), durationMs);
    const dismiss = () => {
      clearTimeout(timer);
      el.remove();
    };
    btn.addEventListener('click', () => {
      if (done) return;
      done = true;
      dismiss();
      onAction();
    });

    el.append(text, btn);
    getContainer().appendChild(el);
    return dismiss;
  },
};
