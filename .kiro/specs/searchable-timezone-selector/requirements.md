# Requirements Document

## Introduction

The e-Handkerchief Settings screen currently lets the user pick a timezone from a native HTML `<select>` dropdown. That dropdown is built from `getTimezoneOptions()`, which — on engines that support `Intl.supportedValuesOf('timeZone')` — returns the full, unfiltered list of hundreds of IANA timezones. Scrolling this list to find one entry is slow and error-prone on both desktop and mobile.

This feature replaces the native timezone `<select>` in the **Date & Time** section with a **searchable combobox**: a text input paired with a filtered dropdown list. As the user types, the dropdown narrows to matching timezones, which the user selects by mouse/touch or by keyboard (arrow keys + Enter). Only a value that exists in the option list can be committed. All existing save behavior is preserved: the selection persists through `settingsStore.save({ timezone })`, the live date/time preview updates, a failed save reverts the control and shows a toast, and the control stays in sync with external `settingsStore.onChange` updates when it is not focused.

Each Timezone_Option's displayed label and searchable text is enriched with the timezone's current UTC offset, computed via `Intl` at render time, so that the label reads like `Asia/Singapore (UTC+08:00)` and the user can search by offset (for example, typing `+08`). The `'auto'` option is exempt from offset enrichment because it has no fixed offset.

The feature is intentionally scoped to the single timezone control. The date-format and time-format selectors, and the rest of the settings screen, are out of scope. The combobox SHOULD be authored as a self-contained, reusable component so it *could* later be applied elsewhere, but this spec does not require reusing it.

## Glossary

- **Timezone_Combobox**: The new UI component that replaces the native timezone `<select>`. It comprises a text input (the search field), a toggle/dropdown affordance, and a filtered list of timezone options.
- **Settings_Screen**: The module `src/screens/settingsScreen.ts` that renders and wires the Settings UI, including the Date & Time section.
- **Timezone_Option**: A single selectable entry of shape `{ value: string; label: string }`, as returned by `getTimezoneOptions()`. The first option is always `{ value: 'auto', label: 'Automatic (follow device)' }`. For every option other than `'auto'`, the `label` includes the timezone's current UTC offset (its Offset_Text), for example `Asia/Singapore (UTC+08:00)`.
- **Offset_Text**: The human-readable current UTC offset of a Timezone_Option, computed via `Intl` at render time and formatted as `UTC±HH:MM` (for example, `UTC+08:00`). The `'auto'` option has no Offset_Text.
- **Option_List**: The complete, ordered array of Timezone_Options returned by `getTimezoneOptions()` in `src/dateFormat.ts`.
- **Searchable_Text**: The text of a Timezone_Option used for matching a Query, comprising the option's `value`, its `label`, and (for options other than `'auto'`) its Offset_Text.
- **Filtered_List**: The subset of the Option_List whose Searchable_Text matches the current search text, preserving the original Option_List order.
- **Query**: The trimmed text currently entered in the Timezone_Combobox search field, used to compute the Filtered_List.
- **Settings_Store**: The `settingsStore` module exposing `getCurrent()`, `save(partial)`, and `onChange(listener)`.
- **Selected_Value**: The timezone `value` (an IANA identifier or `'auto'`) currently committed to Settings_Store as `settings.timezone`.
- **Highlighted_Option**: The option in the open Filtered_List that keyboard navigation currently targets (visually indicated and exposed via `aria-activedescendant`); pressing Enter commits it.
- **Preview_Line**: The live "Preview: …" text in the Date & Time section produced by `formatNoteTimestamp(new Date().toISOString())`.
- **Toast_Service**: The `toastService` module whose `show(message)` displays a transient message.

## Requirements

### Requirement 1: Replace the native timezone select with a combobox

**User Story:** As a user configuring my date/time preferences, I want the timezone control to be a searchable input instead of a long native dropdown, so that I can find my timezone quickly.

#### Acceptance Criteria

1. WHEN the Settings_Screen renders the Date & Time section, THE Settings_Screen SHALL render the Timezone_Combobox in place of the native timezone `<select>` control.
2. WHEN the Timezone_Combobox is first rendered, THE Timezone_Combobox SHALL display the label of the Timezone_Option whose `value` equals the current `settings.timezone` from Settings_Store.
3. THE Timezone_Combobox SHALL build its Option_List from `getTimezoneOptions()` in `src/dateFormat.ts`.
4. WHERE the current `settings.timezone` does not correspond to any Timezone_Option in the Option_List, THE Timezone_Combobox SHALL display the raw `settings.timezone` string as its initial input text.
5. WHERE a Timezone_Option is not the `'auto'` option, THE Timezone_Combobox SHALL display that option's current UTC offset (its Offset_Text) as part of the option's label text.

### Requirement 2: Filter options by typed text

**User Story:** As a user, I want to type part of a timezone name and see only matching entries, so that I do not have to scroll a long list.

#### Acceptance Criteria

1. WHEN the user changes the search field text, THE Timezone_Combobox SHALL recompute the Filtered_List so that it contains every Timezone_Option whose Searchable_Text contains the Query as a case-insensitive substring.
2. WHEN the search field text is empty, THE Timezone_Combobox SHALL set the Filtered_List to the complete Option_List.
3. WHEN the Filtered_List is computed, THE Timezone_Combobox SHALL preserve the relative order of matching options as they appear in the Option_List.
4. WHEN the Filtered_List changes, THE Timezone_Combobox SHALL render one selectable list item per Timezone_Option in the Filtered_List.
5. WHEN the Query matches a Timezone_Option's Offset_Text as a case-insensitive substring, THE Timezone_Combobox SHALL include that Timezone_Option in the Filtered_List.

### Requirement 3: Open and close the dropdown

**User Story:** As a user, I want the option list to appear when I am interacting with the field and close when I am done, so that the screen stays uncluttered.

#### Acceptance Criteria

1. WHEN the search field receives focus, THE Timezone_Combobox SHALL open the dropdown and display the Filtered_List.
2. WHEN the user activates the dropdown toggle affordance WHILE the dropdown is closed, THE Timezone_Combobox SHALL open the dropdown.
3. WHEN the user activates the dropdown toggle affordance WHILE the dropdown is open, THE Timezone_Combobox SHALL close the dropdown.
4. WHEN a pointer interaction occurs outside the Timezone_Combobox WHILE the dropdown is open, THE Timezone_Combobox SHALL close the dropdown.
5. WHEN the user presses the Escape key WHILE the dropdown is open, THE Timezone_Combobox SHALL close the dropdown and restore the search field text to the label of the Selected_Value.

### Requirement 4: Select an option by pointer

**User Story:** As a user on mobile or desktop, I want to tap or click an entry to choose it, so that selection is direct and obvious.

#### Acceptance Criteria

1. WHEN the user activates a list item WHILE the dropdown is open, THE Timezone_Combobox SHALL set the Selected_Value to that item's Timezone_Option `value`.
2. WHEN the user activates a list item, THE Timezone_Combobox SHALL set the search field text to that item's Timezone_Option `label`.
3. WHEN the user activates a list item, THE Timezone_Combobox SHALL close the dropdown.

### Requirement 5: Keyboard navigation and selection

**User Story:** As a keyboard user, I want to move through matches and select with the keyboard, so that I can operate the control without a pointer.

#### Acceptance Criteria

1. WHEN the user presses the ArrowDown key WHILE the dropdown is open AND the Filtered_List is non-empty, THE Timezone_Combobox SHALL move the Highlighted_Option to the next option, wrapping from the last option to the first.
2. WHEN the user presses the ArrowUp key WHILE the dropdown is open AND the Filtered_List is non-empty, THE Timezone_Combobox SHALL move the Highlighted_Option to the previous option, wrapping from the first option to the last.
3. WHEN the user presses the ArrowDown key WHILE the dropdown is closed, THE Timezone_Combobox SHALL open the dropdown.
4. WHEN the user presses the Enter key WHILE the dropdown is open AND a Highlighted_Option exists, THE Timezone_Combobox SHALL set the Selected_Value to the Highlighted_Option's `value`, set the search field text to the Highlighted_Option's `label`, and close the dropdown.
5. WHEN the Highlighted_Option changes, THE Timezone_Combobox SHALL scroll the Highlighted_Option into the visible area of the dropdown.

### Requirement 6: Persist the selection with optimistic revert

**User Story:** As a user, I want my chosen timezone to be saved reliably and my preview to update, so that timestamps reflect my preference.

#### Acceptance Criteria

1. WHEN the Selected_Value changes to a value different from the current `settings.timezone`, THE Settings_Screen SHALL call `Settings_Store.save({ timezone: Selected_Value })`.
2. WHEN a timezone save succeeds, THE Settings_Screen SHALL update the Preview_Line using `formatNoteTimestamp(new Date().toISOString())`.
3. IF a timezone save fails, THEN THE Settings_Screen SHALL restore the Timezone_Combobox to display the label of the previous `settings.timezone` and SHALL call `Toast_Service.show` with a save-failure message.
4. WHEN the Selected_Value resolves to a value equal to the current `settings.timezone`, THE Settings_Screen SHALL skip the save call.

### Requirement 7: Reject invalid values

**User Story:** As a user, I want the control to prevent me from committing a timezone that is not real, so that my timestamps never break.

#### Acceptance Criteria

1. THE Timezone_Combobox SHALL commit a Selected_Value only when that value equals the `value` of a Timezone_Option present in the Option_List.
2. WHEN the search field loses focus WHILE its text does not exactly match the label of any Timezone_Option in the Option_List, THE Timezone_Combobox SHALL restore the search field text to the label of the current Selected_Value without changing the Selected_Value.
3. WHEN the Filtered_List is empty for the current Query, THE Timezone_Combobox SHALL display a "no matches" indicator within the dropdown.
4. WHEN the Filtered_List is empty, THE Timezone_Combobox SHALL leave the Highlighted_Option unset so that pressing Enter commits no value.

### Requirement 8: Stay in sync with external settings changes

**User Story:** As a user, I want the timezone control to reflect changes made elsewhere (for example, a cloud restore), so that the UI is always accurate.

#### Acceptance Criteria

1. WHEN `Settings_Store.onChange` fires WHILE the Timezone_Combobox search field is not the active element, THE Settings_Screen SHALL update the Timezone_Combobox to display the label of the incoming `settings.timezone`.
2. WHILE the Timezone_Combobox search field is the active element, THE Settings_Screen SHALL leave the search field text unchanged when `Settings_Store.onChange` fires.
3. WHEN the Settings_Screen cleanup function runs, THE Settings_Screen SHALL remove all event listeners added by the Timezone_Combobox and SHALL unsubscribe from `Settings_Store.onChange`.

### Requirement 9: Accessibility

**User Story:** As a user relying on assistive technology, I want the combobox to expose correct roles and states, so that my screen reader announces the control and its options correctly.

#### Acceptance Criteria

1. THE Timezone_Combobox search field SHALL expose `role="combobox"` with `aria-expanded` reflecting whether the dropdown is open.
2. THE Timezone_Combobox dropdown container SHALL expose `role="listbox"` and each list item SHALL expose `role="option"`.
3. WHILE a Highlighted_Option exists, THE Timezone_Combobox SHALL set `aria-activedescendant` on the search field to the identifier of the Highlighted_Option.
4. THE Timezone_Combobox search field SHALL be associated with the existing "Timezone" label so that the label names the control.
5. WHILE a list item corresponds to the Selected_Value, THE Timezone_Combobox SHALL set `aria-selected="true"` on that list item.

### Requirement 10: No new build dependencies

**User Story:** As a maintainer, I want this feature to require no new tooling, so that the project still compiles with `tsc` alone and runs without `npm install`.

#### Acceptance Criteria

1. THE Timezone_Combobox SHALL be implemented using only vanilla HTML, CSS, and TypeScript already available in the project.
2. THE Timezone_Combobox SHALL NOT introduce any new npm dependency, framework, or bundler.
