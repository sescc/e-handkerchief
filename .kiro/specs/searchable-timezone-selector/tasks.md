# Implementation Plan: Searchable Timezone Selector

## Overview

This plan builds the searchable timezone combobox bottom-up: the pure, input-varying helpers
(`formatTimezoneOffset`, `filterTimezoneOptions`, and the highlight-index arithmetic) and their
property tests come first, then the self-contained `timezoneCombobox.ts` component that consumes
them, then the `settingsScreen.ts` integration that replaces the native `<select>`, then CSS, and
finally a static + behavioral verification pass.

Constraints honored throughout:

- Vanilla HTML/CSS/TypeScript compiled by `tsc` alone — no frameworks, bundlers, or new npm deps
  (Req 10). Source imports use `.js` extensions; only `.ts`/CSS/config are committed (compiled `.js`
  is gitignored and rebuilt by CI).
- Both `tsconfig.json` (app) and `tsconfig.sw.json` (SW) must type-check cleanly under `strict`.
- No test runner exists, so pure-function property tests are a dependency-free `.ts` harness run via
  `tsc` + `node` (>=100 iterations per property), each tagged
  `Feature: searchable-timezone-selector, Property N`.

## Tasks

- [x] 1. Add `formatTimezoneOffset` and enrich `getTimezoneOptions()` in `src/dateFormat.ts`
  - [x] 1.1 Implement the `formatTimezoneOffset(timeZone: string, at?: Date): string | null` pure helper
    - Build `Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })`, call
      `formatToParts(at ?? new Date())`, and read the `timeZoneName` part (e.g. `GMT+8`, `GMT+5:30`,
      `GMT`, `UTC`)
    - Normalize the token to canonical `UTC±HH:MM`: strip the `GMT`/`UTC` prefix, treat a bare prefix
      as `+0`, split hours/minutes, zero-pad both to two digits, always emit a sign
    - Wrap in `try/catch`; return `null` on any throw or unparseable token (graceful degradation)
    - Export the function so it can be property-tested in isolation
    - _Requirements: 1.5_
  - [x] 1.2 Enrich `getTimezoneOptions()` labels with the offset
    - For every non-`'auto'` option, set `label` to `` `${tz.replace(/_/g,' ')} (${offsetText})` ``
      when `formatTimezoneOffset(tz)` resolves; otherwise keep the existing name-only label
    - Leave the `'auto'` option label unchanged (never enriched)
    - Preserve the existing return shape `Array<{ value: string; label: string }>` and the existing
      `supportedValuesOf` / curated-fallback control flow
    - _Requirements: 1.3, 1.5_
  - [x]* 1.3 Write property test for the offset formatter (Property 4)
    - **Feature: searchable-timezone-selector, Property 4: Offset text format**
    - For any IANA timezone that resolves, assert the result matches `/^UTC[+-]\d{2}:\d{2}$/`; for an
      unresolvable input assert `null`; assert `'auto'` is never assigned an offset
    - Add to a dependency-free harness `.ts` file (see task 6.1); >=100 iterations drawing from the
      real `getTimezoneOptions()` values plus a few deliberately invalid ids
    - **Validates: Requirements 1.5**

- [x] 2. Implement the pure `filterTimezoneOptions` helper
  - [x] 2.1 Add `filterTimezoneOptions(options, query)` to `src/components/timezoneCombobox.ts`
    - Create the new file `src/components/timezoneCombobox.ts` and export
      `filterTimezoneOptions(options: TimezoneOption[], query: string): TimezoneOption[]`
    - Trim the query; on empty/whitespace return the full list unchanged (same order)
    - Otherwise return options whose `value + '\u0000' + label` contains the trimmed query as a
      case-insensitive substring, preserving original relative order (offset search like `+08` is
      covered because the offset already lives in `label`)
    - Also export the `TimezoneOption`, `TimezoneComboboxConfig`, and `TimezoneComboboxHandle`
      interfaces from the design so later tasks can consume them
    - _Requirements: 2.1, 2.2, 2.3, 2.5_
  - [x]* 2.2 Write property test for filter correctness (Property 1)
    - **Feature: searchable-timezone-selector, Property 1: Filter correctness**
    - For any option list and any query, every returned option matches the case-insensitive substring
      test, every omitted option does not, and result indices are strictly increasing (subsequence)
    - >=100 iterations with randomized option lists and queries
    - **Validates: Requirements 2.1, 2.3, 2.5**
  - [x]* 2.3 Write property test for empty-query behavior (Property 2)
    - **Feature: searchable-timezone-selector, Property 2: Empty query returns the full list**
    - For any option list, filtering by an empty or whitespace-only query returns every option in the
      original order (membership and order identical)
    - >=100 iterations
    - **Validates: Requirements 2.2**

- [~] 3. Checkpoint — pure layer
  - Ensure both tsconfigs type-check and the property harness (Properties 1, 2, 4) passes. Ask the
    user if questions arise.

- [x] 4. Build the `createTimezoneCombobox` component
  - [x] 4.1 Build DOM structure and `ComboboxState` with a single `render()`
    - In `src/components/timezoneCombobox.ts`, create `createTimezoneCombobox(config)` returning
      `{ root, input, setValue, getValue, destroy }`
    - Build via `document.createElement`: `div.combobox` (position relative) containing
      `input.form-input.combobox-input`, `button.combobox-toggle` (tabindex=-1, type=button), and
      `ul.combobox-list`
    - Hold `ComboboxState { isOpen, committedValue, filtered, highlightedIndex }` plus closure refs
    - Implement one `render()` that reads state and updates DOM (list hidden/shown, rows rebuilt,
      highlight class + scroll, selected marking); every state mutation calls `render()`
    - _Requirements: 1.1, 2.4_
  - [x] 4.2 Implement `setValue`/`getValue` value-to-display mapping
    - `setValue(value)` sets `committedValue` and the input text to the matching option's `label`; when
      `value` is absent from `options`, show the raw `value` string verbatim and mark no row selected;
      `setValue` never fires `onSelect`. `getValue()` returns `committedValue`
    - Initialize displayed text from `config.value` using the same mapping (Req 1.2 / 1.4)
    - _Requirements: 1.2, 1.4_
  - [x]* 4.3 Write property test for value-to-display mapping (Property 3)
    - **Feature: searchable-timezone-selector, Property 3: Value-to-display mapping**
    - For any option list and value, after `setValue(value)` the displayed text equals the option's
      `label` when present, else the raw `value` string
    - Requires a minimal DOM shim or extraction of the mapping into a pure function callable from the
      node harness; >=100 iterations
    - **Validates: Requirements 1.2, 1.4**
  - [x] 4.4 Implement filtering, rendering, and the "no matches" row
    - On input, recompute `filtered = filterTimezoneOptions(options, input.value)` and re-render
    - Render exactly one `li.combobox-option` (role=option) per filtered entry; when `filtered` is
      empty render a single `li.combobox-empty` "No matching timezones" row (not role=option) and set
      `highlightedIndex = -1`
    - _Requirements: 2.1, 2.4, 7.3, 7.4_
  - [x]* 4.5 Write property test for rendered row count (Property 6)
    - **Feature: searchable-timezone-selector, Property 6: Rendered row count equals filtered length**
    - For any filtered list, rendering produces exactly one `role="option"` item per entry; the empty
      row is not role=option and appears only when the list is empty
    - Uses the same DOM shim as 4.3; >=100 iterations
    - **Validates: Requirements 2.4**
  - [x] 4.6 Implement open/close behavior
    - Open on input focus; toggle open/closed on toggle-button activation; close on `pointerdown`
      outside the root; close and restore input text to the committed value's label on Escape
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 4.7 Implement pointer selection
    - On list-item activation (click/tap), set `committedValue` to that option's `value`, set input
      text to its `label`, close the dropdown, and fire `onSelect(value)`
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 4.8 Implement keyboard navigation and commit with a pure highlight-step helper
    - Add a small pure helper computing the next index as `(i ± 1 + n) mod n`; use it for ArrowDown /
      ArrowUp wrap while open, opening the list on ArrowDown while closed, scrolling the highlighted
      row into view, and committing the highlighted option on Enter (set value + label, close, fire
      `onSelect`); Enter with an empty filtered list commits nothing
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 7.4_
  - [x]* 4.9 Write property test for highlight navigation wrap (Property 5)
    - **Feature: searchable-timezone-selector, Property 5: Highlight navigation wrap**
    - For any length `n > 0` and start index, `n` forward steps and `n` backward steps each return to
      start, each step equals `(i ± 1 + n) mod n`, and forward-then-backward is the identity
    - Tests the extracted pure helper; >=100 iterations
    - **Validates: Requirements 5.1, 5.2**
  - [x] 4.10 Implement invalid-value / blur handling and commit-membership guard
    - On blur, if `input.value` does not exactly equal any option `label`, restore it to the committed
      value's label without changing `committedValue` and without firing `onSelect`
    - Ensure every `onSelect` emission is the `value` of an option present in `options`
    - _Requirements: 7.1, 7.2_
  - [x]* 4.11 Write property test for commit membership (Property 7)
    - **Feature: searchable-timezone-selector, Property 7: Commit membership**
    - For any sequence of commit actions, every emitted value is some option's `value`; with an empty
      filtered list the highlight is unset and Enter emits nothing
    - Drive the extracted commit logic over randomized action sequences; >=100 iterations
    - **Validates: Requirements 7.1, 7.4**
  - [x] 4.12 Wire full ARIA and implement `destroy()`
    - Input: `role="combobox"`, `aria-expanded`, `aria-controls` = listbox id, `aria-autocomplete="list"`,
      `aria-activedescendant` = highlighted row id; list: `role="listbox"` with stable id; each option:
      `role="option"`, stable id `${idPrefix}-opt-{index}`, `aria-selected="true"` on the committed row;
      generate a unique `idPrefix` when not supplied
    - `destroy()` removes every listener the component added and detaches `root`; make it idempotent
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 8.3_

- [~] 5. Checkpoint — component
  - Ensure both tsconfigs type-check and the property harness (Properties 3, 5, 6, 7) passes. Ask the
    user if questions arise.

- [x] 6. Set up the property-test harness
  - [x] 6.1 Create a dependency-free property-test harness `.ts` file
    - Add a plain TypeScript file (e.g. `src/components/timezoneCombobox.proptest.ts`) that defines a
      tiny random-input generator and an assertion loop (>=100 iterations per property), runnable via
      `tsc` then `node` with no new dependencies
    - Include a minimal DOM element shim (or import the extracted pure functions) so Property 3 and 6
      can run under `node`
    - House Properties 1–7 here (tasks 1.3, 2.2, 2.3, 4.3, 4.5, 4.9, 4.11 add their bodies), each
      tagged `Feature: searchable-timezone-selector, Property N`
    - _Requirements: 10.1, 10.2_

- [x] 7. Integrate the combobox into `src/screens/settingsScreen.ts`
  - [x] 7.1 Replace the timezone `buildSelect` block with `createTimezoneCombobox`
    - Import `createTimezoneCombobox`; in the Date & Time section build `tzControl` via the combobox
      using `getTimezoneOptions()` and `current.timezone`; append `tzControl.root` under `tzGroup`
    - Associate the existing "Timezone" `<label>` with the combobox input via `for`/`id`
    - _Requirements: 1.1, 1.2, 1.3, 9.4_
  - [x] 7.2 Wire `onSelect` to the save / preview / revert+toast / no-op-skip flow
    - Pass an `onSelect(next)` that skips `save` when `next === settingsStore.getCurrent().timezone`;
      otherwise calls `settingsStore.save({ timezone: next })`, then `updateDateTimePreview()` on
      success, and on failure calls `tzControl.setValue(prev)` and `toastService.show('Could not save
      setting')`
    - Remove the obsolete `onTimezoneChange` / `tzControl.select` change listener and its cleanup
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 7.3 Update external re-sync and cleanup wiring
    - In the `settingsStore.onChange` handler, replace `tzControl.select.value = settings.timezone`
      with `tzControl.setValue(settings.timezone)` guarded by
      `document.activeElement !== tzControl.input` (leave text unchanged while focused)
    - Push `tzControl.destroy` onto `listenerCleanups` so navigation-away removes the component's
      listeners; keep the existing `unsubscribeSettings` unsubscribe
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 8. Add combobox CSS to `app.css`
  - [x] 8.1 Add `.combobox*` classes aligned with existing form styling
    - Style `.combobox` (position relative), `.combobox-input` (reuse `.form-input` look),
      `.combobox-toggle`, `.combobox-list` (absolute-positioned, scrollable with max-height, z-index
      above adjacent controls, hidden when `hidden`), `.combobox-option`, `.combobox-option.is-highlighted`,
      `.combobox-option[aria-selected="true"]`, and `.combobox-empty`
    - Ensure option rows meet mobile touch-target sizing (Chrome on Android)
    - _Requirements: 1.1, 3.1, 5.5, 10.1_

- [x] 9. Final verification
  - [x] 9.1 Run static + property verification
    - Run `npx tsc --noEmit -p tsconfig.json` and `npx tsc --noEmit -p tsconfig.sw.json`; both must be
      error-free under `strict`
    - Compile and run the property harness via `node`; confirm all of Properties 1–7 pass at >=100
      iterations each
    - _Requirements: 10.1, 10.2_
  - [ ]* 9.2 Manual behavioral / ARIA checklist (not codeable — perform by hand)
    - Walk the design Testing Strategy behavioral list items 1–14: focus-opens, `sing` filter, `+08`
      offset search, arrow wrap + scroll-into-view, ArrowDown-opens, Enter-commits, pointer select on
      touch + desktop, outside-pointerdown/Escape close + restore, blur reverts junk text, empty-list
      "no matches" + Enter no-op, save-failure revert+toast, no-op-skip, external-change-when-unfocused,
      destroy-on-navigate, and DOM inspection of all ARIA roles/states and label association
    - _Requirements: 3.1, 3.4, 3.5, 4.1, 4.2, 4.3, 5.3, 5.4, 5.5, 6.3, 6.4, 7.2, 7.3, 8.1, 8.2, 9.1, 9.2, 9.3, 9.4, 9.5_

## Notes

- Tasks marked with `*` are optional (property tests and the manual checklist) and can be skipped for
  a faster MVP, though they carry the correctness guarantees.
- Each task references specific requirement clauses and/or design property numbers for traceability.
- Checkpoints (tasks 3 and 5) enforce incremental validation of the pure layer and the component
  before integration.
- Property tests live in one dependency-free `.ts` harness (task 6.1) and validate the input-varying
  pure logic; interaction/ARIA behavior is validated by the manual checklist (task 9.2) since it is
  not amenable to property-based testing.
- Task 9.2 is a purely manual verification step — it cannot be completed by a coding agent.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.4", "4.6"] },
    { "id": 4, "tasks": ["4.3", "4.5", "4.7", "4.8", "4.10", "4.12"] },
    { "id": 5, "tasks": ["4.9", "4.11", "8.1"] },
    { "id": 6, "tasks": ["7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3"] },
    { "id": 8, "tasks": ["9.1", "9.2"] }
  ]
}
```
