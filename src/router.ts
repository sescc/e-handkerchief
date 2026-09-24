// ============================================================
// e-Handkerchief — Router
// Hash-based single-page routing.
// ============================================================

export type Route = 'capture' | 'knots' | 'calendar' | 'knot' | 'settings';

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
  if (path === '/knots') {
    return { route: 'knots', params: {} };
  }
  if (path === '/calendar') {
    return { route: 'calendar', params: {} };
  }
  if (path === '/settings') {
    return { route: 'settings', params: {} };
  }

  // '/knot/{id}' is the only form for knot detail routes.
  const knotMatch = path.match(/^\/knot\/(.+)$/);
  if (knotMatch) {
    return { route: 'knot', params: { id: knotMatch[1] } };
  }

  // Unknown route → capture (fallback)
  return { route: 'capture', params: {} };
}

/**
 * Navigate to a hash-based path.
 * e.g. navigate('#/knots') or navigate('#/knot/some-uuid')
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
      case 'knots': {
        const { renderKnots } = await import('./screens/knotsScreen.js');
        _currentCleanup = renderKnots(container);
        break;
      }
      case 'calendar': {
        const { renderCalendar } = await import('./screens/calendarScreen.js');
        _currentCleanup = renderCalendar(container);
        break;
      }
      case 'knot': {
        const { renderKnotDetail } = await import('./screens/knotDetailScreen.js');
        _currentCleanup = renderKnotDetail(container, match.params);
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
