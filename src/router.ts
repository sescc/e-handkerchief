// ============================================================
// e-Handkerchief — Router
// Hash-based single-page routing.
// ============================================================

export type Route = 'capture' | 'journal' | 'note' | 'settings';

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

/**
 * Parse window.location.hash into a RouteMatch.
 * Unknown hashes fall back to the capture screen.
 */
export function parseHash(hash: string): RouteMatch {
  // Strip leading '#' to get the path
  const path = hash.startsWith('#') ? hash.slice(1) : hash;

  if (path === '' || path === '/') {
    return { route: 'capture', params: {} };
  }
  if (path === '/journal') {
    return { route: 'journal', params: {} };
  }
  if (path === '/settings') {
    return { route: 'settings', params: {} };
  }

  const noteMatch = path.match(/^\/note\/(.+)$/);
  if (noteMatch) {
    return { route: 'note', params: { id: noteMatch[1] } };
  }

  // Unknown route → capture (fallback)
  return { route: 'capture', params: {} };
}

/**
 * Navigate to a hash-based path.
 * e.g. navigate('#/journal') or navigate('#/note/some-uuid')
 */
export function navigate(path: string): void {
  window.location.hash = path;
}

type CleanupFn = () => void;
let _currentCleanup: CleanupFn | null = null;

/**
 * Initialise the router.
 * Responds to hashchange events and handles the initial page load.
 * Screen modules are imported lazily to avoid circular dependencies.
 */
export function initRouter(container: HTMLElement): void {
  async function handleRoute(): Promise<void> {
    // Run previous screen's cleanup
    if (_currentCleanup) {
      try { _currentCleanup(); } catch { /* ignore cleanup errors */ }
      _currentCleanup = null;
    }

    // Clear the container
    container.innerHTML = '';

    const match = parseHash(window.location.hash);

    switch (match.route) {
      case 'capture': {
        const { renderCapture } = await import('./screens/captureScreen.js');
        _currentCleanup = renderCapture(container);
        break;
      }
      case 'journal': {
        const { renderJournal } = await import('./screens/journalScreen.js');
        _currentCleanup = renderJournal(container);
        break;
      }
      case 'note': {
        const { renderNoteDetail } = await import('./screens/noteDetailScreen.js');
        _currentCleanup = renderNoteDetail(container, match.params);
        break;
      }
      case 'settings': {
        const { renderSettings } = await import('./screens/settingsScreen.js');
        _currentCleanup = renderSettings(container);
        break;
      }
    }
  }

  window.addEventListener('hashchange', () => { void handleRoute(); });
  void handleRoute();
}
