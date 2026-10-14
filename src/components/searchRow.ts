// ============================================================
// e-Handkerchief — searchRow
// The 🔍 toggle button and the full-width search field row shared by the Knots
// and Calendar screens. Both are bound to the one in-memory query in
// searchState, so typing on one screen is still there on the other.
//
// The row is returned separately from the button so a screen can place it
// OUTSIDE the part of the page it re-renders (re-rendering a field that has
// focus would drop the keyboard).
// ============================================================

import { searchState } from '../searchState.js';
import { queryTokens } from '../knotSearch.js';

export interface SearchRow {
  /** The 🔍 icon button. Place it in the screen header. */
  button: HTMLButtonElement;
  /** The field row (input + clear button). Place it under the header; it starts closed. */
  row: HTMLElement;
  /** Detach listeners and timers. Call from the screen's cleanup. */
  destroy(): void;
}

/** Typing is applied after this pause, so a long list is not rebuilt on every keystroke. */
const TYPING_DEBOUNCE_MS = 120;

export function createSearchRow(opts: { buttonClass: string }): SearchRow {
  let open = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn btn-ghost btn-sm search-toggle-btn ${opts.buttonClass}`;
  button.textContent = '🔍';
  button.setAttribute('aria-label', 'Search knots');
  button.setAttribute('aria-expanded', 'false');

  const row = document.createElement('div');
  row.className = 'search-row';
  row.setAttribute('role', 'search');
  row.hidden = true;

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'form-input search-input';
  input.placeholder = 'Search knots';
  input.setAttribute('aria-label', 'Search knots');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'search';
  row.appendChild(input);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn btn-ghost search-clear-btn';
  clearBtn.textContent = '✕';
  clearBtn.setAttribute('aria-label', 'Clear search');
  row.appendChild(clearBtn);

  function cancelDebounce(): void {
    if (debounce !== null) {
      clearTimeout(debounce);
      debounce = null;
    }
  }

  /** Bring the row, the icon and the field in line with `open` and the shared query. */
  function sync(): void {
    const q = searchState.get();
    const active = queryTokens(q).length > 0;
    // A query set from elsewhere (the other screen) keeps the row open.
    if (active) open = true;
    row.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('search-toggle-btn--active', active);
    // Only write the field when it differs and no typing is still waiting to be
    // applied, so the caret never jumps mid-typing.
    if (input.value !== q && debounce === null) input.value = q;
  }

  function closeAndClear(): void {
    cancelDebounce();
    open = false;
    input.value = '';
    searchState.set('');
    sync();
  }

  button.addEventListener('click', () => {
    if (open && queryTokens(searchState.get()).length === 0) {
      // Open and empty: the icon closes it again.
      closeAndClear();
      return;
    }
    open = true;
    row.hidden = false; // visible BEFORE focus()
    button.setAttribute('aria-expanded', 'true');
    // Same click handler, no await / rAF: this is what makes the phone keyboard open.
    input.focus();
  });

  input.addEventListener('input', () => {
    cancelDebounce();
    debounce = setTimeout(() => {
      debounce = null;
      searchState.set(input.value);
    }, TYPING_DEBOUNCE_MS);
  });

  // The native "search" event fires on Enter (and on the browser's own clear): apply at once.
  input.addEventListener('search', () => {
    cancelDebounce();
    searchState.set(input.value);
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      // preventDefault: Chrome's own Escape on type=search would clear the field first.
      ev.preventDefault();
      closeAndClear();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      cancelDebounce();
      searchState.set(input.value);
      input.blur(); // dismiss the keyboard so the results are visible
    }
  });

  clearBtn.addEventListener('click', () => closeAndClear());

  const unsubscribe = searchState.subscribe(() => sync());
  sync();

  return {
    button,
    row,
    destroy(): void {
      cancelDebounce();
      unsubscribe();
    },
  };
}
