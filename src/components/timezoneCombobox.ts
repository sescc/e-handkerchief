// ============================================================
// e-Handkerchief — Timezone Combobox component
// A self-contained, searchable combobox that replaces the native
// timezone <select> in the Settings screen's Date & Time section.
//
// This file currently exposes the component's public interfaces and the
// pure `filterTimezoneOptions` helper. The DOM-building factory
// (`createTimezoneCombobox`) and its interaction logic are added by later
// tasks; the interfaces are declared here so those tasks can consume them.
// ============================================================

/** A single selectable timezone entry (already offset-enriched via getTimezoneOptions()). */
export interface TimezoneOption {
  value: string;
  label: string;
}

/** Configuration passed to `createTimezoneCombobox`. */
export interface TimezoneComboboxConfig {
  /** Full, ordered option list (already offset-enriched) from getTimezoneOptions(). */
  options: TimezoneOption[];
  /** Initial committed value (an IANA id or 'auto'). */
  value: string;
  /** Called only when a value in `options` is committed by pointer or Enter. */
  onSelect: (value: string) => void;
  /** Optional id prefix for ARIA wiring; defaults to a module-generated unique prefix. */
  idPrefix?: string;
}

/** Handle returned by `createTimezoneCombobox`, mirroring the existing builder shape. */
export interface TimezoneComboboxHandle {
  /** Root element to insert into the DOM (mirrors buildSelect's `wrapper`). */
  root: HTMLElement;
  /** The search <input> — exposed so the screen can associate the existing label and check focus. */
  input: HTMLInputElement;
  /**
   * Set the committed value programmatically and update the displayed text to that option's label.
   * Does NOT fire onSelect. Used by the external settingsStore.onChange re-sync.
   * If `value` is not in `options`, the raw value string is shown as-is (Req 1.4).
   */
  setValue(value: string): void;
  /** Current committed value. */
  getValue(): string;
  /** Remove all listeners this component added and detach its root. Idempotent. */
  destroy(): void;
}

/**
 * Case-insensitive, order-preserving substring filter over `value` + `label`.
 *
 * An empty or whitespace-only query returns the full list unchanged (Req 2.2).
 * Otherwise every option whose combined searchable text — `value + '\u0000' + label`
 * (a NUL separator prevents matches spanning the value/label boundary) — lowercased
 * contains the trimmed, lowercased query is returned, preserving the original relative
 * order (Req 2.1, 2.3). Offset queries like `+08` match through the label, since the
 * offset text already lives there (Req 2.5).
 */
export function filterTimezoneOptions(
  options: TimezoneOption[],
  query: string,
): TimezoneOption[] {
  const trimmed = query.trim();
  if (trimmed === '') {
    return options.slice();
  }
  const needle = trimmed.toLowerCase();
  return options.filter((option) =>
    (option.value + '\u0000' + option.label).toLowerCase().includes(needle),
  );
}

/**
 * Pure value→display mapping (design "extraction of the mapping into a pure function").
 *
 * Returns the `label` of the option whose `value` equals `value` when one is present in
 * `options` (Req 1.2), or the raw `value` string verbatim when no option matches (Req 1.4).
 * DOM-free so Property 3 (value-to-display mapping) can validate it under `node`.
 */
export function displayLabelForValue(
  options: TimezoneOption[],
  value: string,
): string {
  const match = options.find((option) => option.value === value);
  return match ? match.label : value;
}

/**
 * Pure highlight-index arithmetic for keyboard navigation (design Property 5).
 *
 * Given the `current` highlighted index, the Filtered_List `length`, and a step
 * `direction` (`1` for ArrowDown, `-1` for ArrowUp), return the next index:
 *
 * - When `length <= 0` there is nothing to highlight, so return `-1`.
 * - When the highlight is unset (`current < 0`), ArrowDown lands on the first row
 *   (index `0`) and ArrowUp lands on the last row (index `length - 1`). This is
 *   achieved by seeding the base at `-1` for ArrowDown (`-1 + 1 = 0`) and at `0`
 *   for ArrowUp (`0 - 1 = -1 → length - 1` after wrap).
 * - Otherwise step from `current` and wrap with a modulo, so the result is always
 *   in `[0, length - 1]`. Adding `length` before the modulo keeps it non-negative.
 *
 * Because every in-range step is `(i ± 1 + n) mod n`, `n` forward steps and `n`
 * backward steps each return to the starting index, and forward-then-backward is the
 * identity — exactly Property 5's wrap guarantee. DOM-free so task 4.9 can test it
 * directly under `node`.
 */
export function nextHighlightIndex(
  current: number,
  length: number,
  direction: 1 | -1,
): number {
  if (length <= 0) {
    return -1;
  }
  // Seed an unset highlight so ArrowDown→0 and ArrowUp→(length-1) after the step.
  const base = current < 0 ? (direction === 1 ? -1 : 0) : current;
  return (base + direction + length) % length;
}
// ============================================================
// Component factory — skeleton (Task 4.1)
//
// This section establishes the DOM structure, the internal `ComboboxState`,
// and a single `render()` loop that all state mutations flow through. Later
// subtasks extend this skeleton at the clearly-marked extension points:
//   - 4.2  refines setValue/getValue value→display mapping
//   - 4.4  adds filtering + the "no matches" (.combobox-empty) row
//   - 4.6  open/close handlers (focus, toggle, outside pointerdown, Escape)
//   - 4.7  pointer selection (click/tap a row commits)
//   - 4.8  keyboard nav (ArrowUp/Down wrap, Enter commit) + highlight-step helper
//   - 4.10 blur handling + commit-membership guard
//   - 4.12 full ARIA (roles, ids, aria-*: combobox/listbox/option, aria-expanded,
//          aria-activedescendant, aria-selected) + destroy() listener-removal audit
// ============================================================

/** Internal component state (see design Data Models). */
interface ComboboxState {
  /** Whether the dropdown is displayed. */
  isOpen: boolean;
  /** The last value reported via onSelect / set via setValue. */
  committedValue: string;
  /** Current Filtered_List (order preserved from options). */
  filtered: TimezoneOption[];
  /** Index into `filtered`, or -1 when unset. */
  highlightedIndex: number;
}

/** Module-level counter used to generate unique id prefixes when none is supplied. */
let comboboxCounter = 0;

/**
 * Build a searchable timezone combobox.
 *
 * Task 4.1 establishes the skeleton: DOM, `ComboboxState`, and the single
 * `render()`. Interaction (open/close, keyboard, pointer, blur), filtering, and
 * full ARIA are layered on by later subtasks at the marked extension points.
 */
export function createTimezoneCombobox(
  config: TimezoneComboboxConfig,
): TimezoneComboboxHandle {
  // ---- Closure references (derived/reference data per design Data Models) ----
  const options: TimezoneOption[] = config.options; // immutable reference
  const idPrefix = config.idPrefix ?? `tzcb-${comboboxCounter++}`;

  // ---- Listener cleanup registry ----
  // Every listener this component adds pushes its teardown here so `destroy()`
  // can run them all. Tasks 4.6–4.12 extend this same array; `destroy()` stays
  // idempotent (draining the array means a second call is a no-op).
  const cleanups: Array<() => void> = [];

  // ---- DOM construction (design "DOM structure built by the component") ----
  const root = document.createElement('div');
  root.className = 'combobox'; // position: relative via CSS

  const input = document.createElement('input') as HTMLInputElement;
  input.type = 'text';
  input.autocomplete = 'off';
  input.className = 'form-input combobox-input';
  // Blank-on-focus UX: the field shows this placeholder once focus clears the text
  // (see onFocus) so users can type immediately instead of deleting the committed label.
  input.placeholder = 'Search timezone…';
  // Static ARIA (Req 9.1): the input is the combobox and controls the listbox.
  // `aria-expanded` starts "false" and is kept in sync inside render(). The stable
  // `id` lets task 7.1 associate the existing "Timezone" label via `for` (Req 9.4).
  input.id = `${idPrefix}-input`;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-controls', `${idPrefix}-listbox`);
  input.setAttribute('aria-expanded', 'false');

  const toggle = document.createElement('button') as HTMLButtonElement;
  toggle.type = 'button';
  toggle.tabIndex = -1;
  toggle.className = 'combobox-toggle';
  // Static ARIA: the toggle is an interactive affordance (NOT aria-hidden). It keeps
  // its pointer-only focusability (tabIndex -1) and names/points at the listbox.
  toggle.setAttribute('aria-label', 'Toggle timezone list');
  toggle.setAttribute('aria-controls', `${idPrefix}-listbox`);
  // NOTE: 4.6 wires the toggle's click handler.

  const list = document.createElement('ul') as HTMLUListElement;
  list.className = 'combobox-list';
  // Static ARIA (Req 9.2): the list is the listbox container that the input controls.
  list.id = `${idPrefix}-listbox`;
  list.setAttribute('role', 'listbox');

  // Append in order: input, toggle, list.
  root.appendChild(input);
  root.appendChild(toggle);
  root.appendChild(list);

  // ---- Internal state (design Data Models initialization) ----
  const state: ComboboxState = {
    isOpen: false,
    committedValue: config.value,
    filtered: options.slice(),
    highlightedIndex: -1,
  };

  /**
   * Resolve the display label for a committed value via the shared pure mapping:
   * the matching option's label when present (Req 1.2), else the raw value (Req 1.4).
   * Delegates to the exported `displayLabelForValue` so init, setValue, and the
   * property test (task 4.3) all rely on one deterministic mapping.
   */
  function labelForValue(value: string): string {
    return displayLabelForValue(options, value);
  }

  /**
   * Single source of DOM truth: read `state`, update the DOM per the design's
   * state-to-DOM mapping table. Every state mutation calls this.
   */
  function render(): void {
    // isOpen → list visibility + input aria-expanded (Req 9.1).
    list.hidden = !state.isOpen;
    input.setAttribute('aria-expanded', String(state.isOpen));

    // filtered → rebuild <li> rows with full ARIA (Req 9.2, 9.5).
    list.replaceChildren();
    if (state.filtered.length === 0) {
      // Empty Filtered_List → a single non-selectable "no matches" row (Req 7.3).
      // This row is intentionally NOT a role="option" and carries no option id or
      // aria-selected — it is never selectable/committable (Req 9.2 scopes role=option
      // to real entries). With no options rendered, highlightedIndex stays -1 (set by
      // the filter update below), so Enter commits nothing (Req 7.4).
      const empty = document.createElement('li') as HTMLLIElement;
      empty.className = 'combobox-empty';
      empty.textContent = 'No matching timezones';
      list.appendChild(empty);
    } else {
      // Track the first row whose value equals committedValue so exactly one option
      // is marked aria-selected="true" (Req 9.5); all others get "false".
      let selectedMarked = false;
      state.filtered.forEach((option, index) => {
        const li = document.createElement('li') as HTMLLIElement;
        li.className = 'combobox-option';
        li.textContent = option.label;
        li.dataset.index = String(index);
        // Per-option ARIA (Req 9.2): role="option" + stable id per rendered index so
        // aria-activedescendant can point at the highlighted row.
        li.setAttribute('role', 'option');
        li.id = `${idPrefix}-opt-${index}`;
        // Selected row (Req 9.5): first row matching committedValue is aria-selected.
        if (!selectedMarked && option.value === state.committedValue) {
          li.setAttribute('aria-selected', 'true');
          selectedMarked = true;
        } else {
          li.setAttribute('aria-selected', 'false');
        }
        // highlightedIndex → visual highlight class (Req 5.5).
        if (index === state.highlightedIndex) {
          li.classList.add('is-highlighted');
        }
        list.appendChild(li);
      });

      // Scroll the highlighted row into view so keyboard navigation stays visible
      // (Req 5.5). Only when a real highlight exists; the "no matches" branch above
      // keeps highlightedIndex at -1 so nothing scrolls there.
      if (state.highlightedIndex >= 0) {
        const rows = list.querySelectorAll('.combobox-option');
        const highlighted = rows[state.highlightedIndex] as
          | HTMLElement
          | undefined;
        if (highlighted) {
          highlighted.scrollIntoView({ block: 'nearest' });
        }
      }
    }

    // Highlighted row → input aria-activedescendant (Req 9.3). When a highlight exists
    // (only possible with a non-empty Filtered_List, since the empty branch keeps the
    // index at -1), point the input at that row's stable id; otherwise remove it.
    if (state.highlightedIndex >= 0) {
      input.setAttribute(
        'aria-activedescendant',
        `${idPrefix}-opt-${state.highlightedIndex}`,
      );
    } else {
      input.removeAttribute('aria-activedescendant');
    }

    // Event listeners (focus, toggle click, outside pointerdown, Escape, row
    // pointerdown/click, keydown, blur) are attached once in the factory body, not
    // per-render, and each pushes its teardown onto `cleanups` for destroy() (Req 8.3).
  }

  /** Update the displayed input text from the current committed value. */
  function syncInputText(): void {
    input.value = labelForValue(state.committedValue);
  }

  // ---- Live filtering (Req 2.1, 2.4, 7.3, 7.4) ----

  /**
   * Recompute the Filtered_List from the current input text and re-render.
   * Uses the captured `input` element's `.value` directly. The highlight is reset
   * to -1 on every filter recompute — keyboard navigation (task 4.8) re-establishes
   * it; on an empty list it stays -1 so Enter commits nothing (Req 7.4).
   */
  function onInput(): void {
    state.filtered = filterTimezoneOptions(options, input.value);
    state.highlightedIndex = -1;
    render();
  }

  input.addEventListener('input', onInput);
  cleanups.push(() => input.removeEventListener('input', onInput));

  // ---- Open/close behavior (Req 3.1–3.5) ----

  /**
   * Open the dropdown (Req 3.1/3.2). Sets `isOpen` and re-renders so the current
   * Filtered_List becomes visible. The filter is intentionally left untouched — a
   * fresh focus with an empty input shows the full list, and reopening keeps any
   * text the user had typed.
   */
  function open(): void {
    state.isOpen = true;
    render();
  }

  /**
   * Close the dropdown (Req 3.3/3.4/3.5). Sets `isOpen` and re-renders so the list
   * hides. Does not touch `committedValue`, the filter, or the input text — callers
   * (e.g. Escape handling) restore text explicitly when needed.
   */
  function close(): void {
    state.isOpen = false;
    render();
  }

  // ---- Shared commit path (Req 4.1–4.3; also used by 4.8 Enter, guarded by 4.10) ----

  /**
   * The single commit path for the component: record `option.value` as the committed
   * value, reflect the option's `label` in the input (Req 4.2), close the dropdown
   * (Req 4.3), and report the choice through `config.onSelect` (Req 4.1).
   *
   * Only ever called with an option drawn from the Option_List / Filtered_List, so the
   * value it emits is always a member of the Option_List (Req 7.1). Task 4.8 (Enter) and
   * task 4.10's membership guard route through here so there is exactly one place that
   * mutates `committedValue` and fires `onSelect`.
   *
   * `input.value = option.label` is set directly to match Req 4.2 exactly. `close()`
   * flips `isOpen` and re-renders; we avoid a redundant second `render()` since `close()`
   * already repaints after the state is settled.
   */
  function commitOption(option: TimezoneOption): void {
    // Commit-membership guard (Req 7.1, Property 7): the single commit path must
    // only ever emit a value that belongs to the Option_List. The happy paths
    // (pointer selection in `onListClick`, Enter in `onKeyDown`) already draw the
    // option from `state.filtered` — a subset of `options` — so membership holds.
    // This defensive early return hardens that invariant: if a caller ever passes
    // an option that is neither the same reference held in `options` nor shares a
    // `value` with any option in `options`, do NOT mutate `committedValue` and do
    // NOT fire `config.onSelect`. Valid options are unaffected, so the happy path
    // is unchanged.
    const isMember =
      options.includes(option) || options.some((o) => o.value === option.value);
    if (!isMember) {
      return;
    }
    state.committedValue = option.value;
    input.value = option.label;
    close(); // sets state.isOpen = false and re-renders
    config.onSelect(option.value);
  }

  // Focus opens the dropdown (Req 3.1). Before opening, blank the input so the
  // placeholder shows and the user can type immediately without deleting the
  // committed label, and reset the Filtered_List to the full option list so the
  // whole dropdown is ready to filter. Setting `input.value = ''` directly does NOT
  // dispatch an `input` event, so `onInput`/`onSelect` are not triggered — we update
  // `state.filtered` and the highlight ourselves here. If the user leaves without
  // picking anything, `onBlur` restores the committed label (empty text matches no
  // option label, so `syncInputText()` runs).
  function onFocus(_event: FocusEvent): void {
    input.value = '';
    state.filtered = filterTimezoneOptions(options, '');
    state.highlightedIndex = -1;
    open();
  }
  input.addEventListener('focus', onFocus);
  cleanups.push(() => input.removeEventListener('focus', onFocus));

  // Toggle affordance opens when closed / closes when open (Req 3.2, 3.3). When
  // opening via the toggle we also focus the input so keyboard users land in the
  // field. The toggle lives inside `root`, so the outside-pointerdown handler below
  // does not treat this click as an "outside" interaction and won't re-close it.
  function onToggleClick(_event: MouseEvent): void {
    if (state.isOpen) {
      close();
    } else {
      open();
      input.focus();
    }
  }
  toggle.addEventListener('click', onToggleClick);
  cleanups.push(() => toggle.removeEventListener('click', onToggleClick));

  // Pointer interaction outside the combobox closes it (Req 3.4). Registered on the
  // document so it catches taps/clicks anywhere; the teardown removes it in destroy().
  function onDocumentPointerDown(event: PointerEvent): void {
    if (state.isOpen && !root.contains(event.target as Node)) {
      close();
    }
  }
  document.addEventListener('pointerdown', onDocumentPointerDown);
  cleanups.push(() =>
    document.removeEventListener('pointerdown', onDocumentPointerDown),
  );

  // ---- Pointer selection (Req 4.1–4.3), via event delegation on the list ----
  //
  // The <li> rows are rebuilt on every render(), so per-row listeners would be
  // fragile and leak. Instead ONE pointerdown + ONE click listener live on the
  // stable `list` (ul) element and resolve the target row from the event.

  /**
   * Keep focus on the input while a row is being selected. A pointerdown inside the
   * list would otherwise blur the input first (firing task 4.10's blur revert / the
   * document pointerdown close in 4.6) before the click's commit runs. Calling
   * `preventDefault()` here suppresses that focus shift so the subsequent `click`
   * commits cleanly — a standard combobox pattern.
   */
  function onListPointerDown(event: PointerEvent): void {
    event.preventDefault();
  }
  list.addEventListener('pointerdown', onListPointerDown);
  cleanups.push(() => list.removeEventListener('pointerdown', onListPointerDown));

  /**
   * Commit the option for the clicked row (Req 4.1–4.3). Walk up from the event target
   * to the nearest `.combobox-option` row; clicks on the `.combobox-empty` row or empty
   * space resolve to no row and are ignored. The row's `data-index` maps back into
   * `state.filtered`; NaN / out-of-range indices are guarded so only a real option can
   * be committed. All DOM changes flow through `commitOption` → `close()` → `render()`.
   */
  function onListClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const row = target.closest('.combobox-option') as HTMLElement | null;
    if (row === null || !list.contains(row)) {
      return;
    }
    const rawIndex: string | undefined = row.dataset.index;
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= state.filtered.length) {
      return;
    }
    commitOption(state.filtered[index]);
  }
  list.addEventListener('click', onListClick);
  cleanups.push(() => list.removeEventListener('click', onListClick));

  /**
   * Keydown handling on the input. THIS task (4.6) handles ONLY Escape: close the
   * dropdown and restore the input text to the committed value's label (Req 3.5),
   * without changing `committedValue` or firing `onSelect`. `preventDefault()` stops
   * Escape from triggering unrelated side effects (e.g. clearing the field).
   *
   * EXTENSION POINT: task 4.8 extends this same handler with ArrowUp/ArrowDown
   * highlight navigation (with wrap) and Enter commit. Only Escape is handled here;
   * all other keys pass through untouched so 4.8 can add them without conflict.
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && state.isOpen) {
      event.preventDefault();
      close();
      syncInputText();
      return;
    }

    // ArrowDown: open when closed (Req 5.3); otherwise advance the highlight with
    // wrap (Req 5.1). Always preventDefault so the caret doesn't jump in the input.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!state.isOpen) {
        open();
        return;
      }
      if (state.filtered.length > 0) {
        state.highlightedIndex = nextHighlightIndex(
          state.highlightedIndex,
          state.filtered.length,
          1,
        );
        render();
      }
      return;
    }

    // ArrowUp: retreat the highlight with wrap (Req 5.2). When closed, open the list
    // (the requirement only mandates ArrowDown opens; opening on ArrowUp too is a
    // small, consistent nicety and keeps the branch minimal).
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!state.isOpen) {
        open();
        return;
      }
      if (state.filtered.length > 0) {
        state.highlightedIndex = nextHighlightIndex(
          state.highlightedIndex,
          state.filtered.length,
          -1,
        );
        render();
      }
      return;
    }

    // Enter: commit the Highlighted_Option when one exists (Req 5.4) through the single
    // commit path. With an empty Filtered_List the highlight is unset (-1) so nothing is
    // committed (Req 7.4); we leave the default behavior alone in that case.
    if (event.key === 'Enter') {
      if (
        state.isOpen &&
        state.highlightedIndex >= 0 &&
        state.highlightedIndex < state.filtered.length
      ) {
        event.preventDefault();
        commitOption(state.filtered[state.highlightedIndex]);
      }
      return;
    }
    // NOTE: task 4.10 adds blur handling separately (not in this keydown handler).
  }
  input.addEventListener('keydown', onKeyDown);
  cleanups.push(() => input.removeEventListener('keydown', onKeyDown));

  // ---- Blur handling (Req 7.2) ----
  //
  /**
   * Revert stray text when the field loses focus (Req 7.2). If `input.value` does
   * NOT exactly equal the `label` of any option in the Option_List, restore the text
   * to the committed value's label via `syncInputText()` — WITHOUT changing
   * `state.committedValue` and WITHOUT firing `config.onSelect`. If it DOES exactly
   * match some option's label, the text is left as-is: blur never commits here; the
   * only commit path is `commitOption` (pointer/Enter).
   *
   * Timing invariant: a genuine row click does NOT blur the input first, because
   * `onListPointerDown` calls `preventDefault()` on the list's pointerdown to keep
   * focus during the row click. So this revert can never clobber a pending pointer
   * commit — the click's `commitOption` runs while focus is retained, and any blur
   * that follows sees text that already exactly matches the committed option's label.
   *
   * Blur also closes the dropdown if still open, consistent with the field losing
   * focus (the field is no longer being interacted with).
   */
  function onBlur(_event: FocusEvent): void {
    const matchesOption = options.some((o) => o.label === input.value);
    if (!matchesOption) {
      syncInputText(); // restore committed value's label; no commit, no onSelect
    }
    if (state.isOpen) {
      close();
    }
  }
  input.addEventListener('blur', onBlur);
  cleanups.push(() => input.removeEventListener('blur', onBlur));

  // ---- Handle methods ----

  /**
   * Set the committed value programmatically and reflect it in the input text.
   *
   * The displayed text is derived through the shared `labelForValue` mapping: the
   * matching option's `label` when `value` is present in `options` (Req 1.2), or the
   * raw `value` string verbatim when it is not (Req 1.4). This never fires
   * `config.onSelect` — it is used by the external settingsStore.onChange re-sync.
   * The subsequent `render()` marks the matching rendered row `aria-selected="true"`
   * (Req 9.5).
   */
  function setValue(value: string): void {
    state.committedValue = value;
    syncInputText();
    render();
  }

  /** Current committed value. */
  function getValue(): string {
    return state.committedValue;
  }

  /**
   * Remove all listeners this component registered and detach the root. Idempotent:
   * draining the `cleanups` array means a second call runs nothing and detaching an
   * already-removed root is a no-op. Tasks 4.6–4.12 register their listeners onto the
   * same `cleanups` array, so they are torn down here automatically.
   */
  function destroy(): void {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) {
        cleanup();
      }
    }
    if (root.parentNode) {
      root.parentNode.removeChild(root);
    }
  }

  // ---- Initial paint ----
  syncInputText(); // initial input.value from config.value (matching label or raw value)
  render();

  return { root, input, setValue, getValue, destroy };
}
