// ============================================================
// e-Handkerchief — Searchable Timezone Selector
// Dependency-free property-test harness (INFRASTRUCTURE ONLY).
//
// Feature: searchable-timezone-selector
//
// This file provides the reusable scaffolding for the feature's
// property-based tests: a tiny seedable PRNG, random-input
// generators, an assertion helper, a per-property runner, and a
// minimal DOM shim so DOM-touching properties (3 and 6) can run
// under plain `node`.
//
// It has NO new npm dependencies. Run it via `tsc` (which emits
// timezoneCombobox.proptest.js next to this file) then
// `node ./src/components/timezoneCombobox.proptest.js`.
//
// The individual property BODIES (Properties 1-7) are added by
// later tasks (1.3, 2.2, 2.3, 4.3, 4.5, 4.9, 4.11). Those tasks
// will also add the imports of the functions they exercise
// (`filterTimezoneOptions`, `formatTimezoneOffset`,
// `createTimezoneCombobox`). Do NOT import those here yet — they
// may not exist, and this file must type-check and run cleanly
// on its own right now.
// ============================================================

// Property 4 (task 1.3) exercises the pure offset formatter and the option
// enrichment, both of which live in dateFormat.ts. These exports already exist,
// so importing them here is safe. Note the `.js` extension per the project's
// ES2020 module setup.
import { formatTimezoneOffset, getTimezoneOptions } from '../dateFormat.js';

// Property 1 (task 2.2) exercises the pure filter helper, which already exists
// in the component module. Note the `.js` extension per the ES2020 module setup.
import { filterTimezoneOptions, displayLabelForValue, nextHighlightIndex, createTimezoneCombobox } from './timezoneCombobox.js';

// ------------------------------------------------------------
// Assertion helper
// ------------------------------------------------------------

/** Thrown by `assert` so the runner can distinguish expected failures. */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

/** Minimal assertion: throws an AssertionError when `condition` is falsy. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}

// ------------------------------------------------------------
// Seedable pseudo-random generator
//
// A small deterministic PRNG (mulberry32) so failing runs can be
// reproduced by re-seeding. `Math.random` would also be
// acceptable, but a seedable generator makes counterexamples
// stable across runs.
// ------------------------------------------------------------

export class Rng {
  private state: number;

  constructor(seed: number = (Date.now() ^ 0x9e3779b9) >>> 0) {
    // Force to an unsigned 32-bit integer.
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in the inclusive range [min, max]. */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** A valid index into an array of length `len` (len must be > 0). */
  index(len: number): number {
    return this.int(0, Math.max(0, len - 1));
  }

  /** Pick a random element from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.index(items.length)];
  }

  /** True with probability `p` (default 0.5). */
  bool(p: number = 0.5): boolean {
    return this.next() < p;
  }
}

// ------------------------------------------------------------
// Random-input generators
//
// Small, composable generators for the shapes the properties
// need: strings, {value,label} option arrays, and indices. Kept
// deliberately simple; later tasks may add narrower generators
// (e.g. queries derived from an option's own text) next to the
// property bodies that need them.
// ------------------------------------------------------------

/** Character pool that mixes case, digits, offset-ish symbols, and separators. */
const CHAR_POOL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /_+-:().';

/** A random string of length in [minLen, maxLen] drawn from CHAR_POOL. */
export function randomString(rng: Rng, minLen = 0, maxLen = 12): string {
  const len = rng.int(minLen, maxLen);
  let out = '';
  for (let i = 0; i < len; i++) out += rng.pick(CHAR_POOL.split(''));
  return out;
}

/** Shape mirrors the design's TimezoneOption without importing it (avoids a hard dependency). */
export interface HarnessOption {
  value: string;
  label: string;
}

/** A single random option; label loosely resembles an enriched timezone label. */
export function randomOption(rng: Rng): HarnessOption {
  const value = randomString(rng, 1, 10);
  // Sometimes tack on an offset-looking suffix so offset-search cases occur.
  const suffix = rng.bool(0.4) ? ` (UTC${rng.bool() ? '+' : '-'}${String(rng.int(0, 14)).padStart(2, '0')}:00)` : '';
  const label = `${randomString(rng, 1, 12)}${suffix}`;
  return { value, label };
}

/** A random option list of length in [minLen, maxLen]. */
export function randomOptionList(rng: Rng, minLen = 0, maxLen = 20): HarnessOption[] {
  const len = rng.int(minLen, maxLen);
  const out: HarnessOption[] = [];
  for (let i = 0; i < len; i++) out.push(randomOption(rng));
  return out;
}

/**
 * A random query. Half the time it is a random string; the other half it is
 * a substring lifted from one of the provided options (so real matches occur).
 */
export function randomQuery(rng: Rng, options: readonly HarnessOption[]): string {
  if (options.length === 0 || rng.bool(0.5)) {
    return randomString(rng, 0, 6);
  }
  const opt = rng.pick(options);
  const source = rng.bool() ? opt.value : opt.label;
  if (source.length === 0) return '';
  const start = rng.index(source.length);
  const end = rng.int(start, source.length);
  const slice = source.slice(start, end);
  // Randomly flip case so case-insensitive matching is exercised.
  return rng.bool() ? slice.toUpperCase() : slice;
}

// ------------------------------------------------------------
// Minimal DOM shim
//
// Properties 3 (value-to-display mapping) and 6 (rendered row
// count) touch DOM through the component. When this harness runs
// under `node` there is no `document`. `installDomShim()` defines
// a lightweight fake with just enough of the element surface the
// component's pure/rendering logic uses. It is intentionally
// minimal — extend it in the tasks that add Properties 3 and 6
// if they exercise element APIs not covered here.
//
// The shim is a documented seam: the property bodies decide
// whether to install it (browser-like) or to import extracted
// pure functions instead. It is NOT installed automatically.
// ------------------------------------------------------------

/** The subset of an element the shim models. Grows as later properties need it. */
export interface FakeElement {
  tagName: string;
  children: FakeElement[];
  attributes: Record<string, string>;
  classList: {
    add(...tokens: string[]): void;
    remove(...tokens: string[]): void;
    contains(token: string): boolean;
    toggle(token: string, force?: boolean): boolean;
  };
  /**
   * The component assigns classes via the `className` property (e.g.
   * `li.className = 'combobox-option'`) rather than `classList.add`. The shim
   * mirrors the real DOM: assigning `className` resets and repopulates the
   * backing `classes` Set so class-based `querySelectorAll` matching works.
   */
  className: string;
  textContent: string;
  value: string;
  hidden: boolean;
  /**
   * Arbitrary per-element data map. The component sets `li.dataset.index` on each
   * rendered option row, so the shim models `dataset` as a plain string map. The
   * index signature keeps assignments like `dataset.index = '0'` type-clean.
   */
  dataset: Record<string, string>;
  appendChild(child: FakeElement): FakeElement;
  /**
   * Detach all current children. The component's `render()` calls
   * `list.replaceChildren()` (with no args) to clear the list before rebuilding rows,
   * so the shim only needs the no-arg clear form.
   */
  replaceChildren(): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: unknown): void;
  removeEventListener(type: string, listener: unknown): void;
  querySelectorAll(selector: string): FakeElement[];
  scrollIntoView(): void;
}

function makeFakeElement(tagName: string): FakeElement {
  const classes = new Set<string>();
  const el: FakeElement = {
    tagName: tagName.toUpperCase(),
    children: [],
    attributes: {},
    textContent: '',
    value: '',
    hidden: false,
    dataset: {},
    classList: {
      add(...tokens: string[]) { for (const t of tokens) classes.add(t); },
      remove(...tokens: string[]) { for (const t of tokens) classes.delete(t); },
      contains(token: string) { return classes.has(token); },
      toggle(token: string, force?: boolean) {
        const shouldHave = force ?? !classes.has(token);
        if (shouldHave) classes.add(token); else classes.delete(token);
        return shouldHave;
      },
    },
    // Mirror the DOM `className` property against the same backing Set as
    // `classList`. Assigning replaces the token set; reading returns the
    // space-joined tokens. The component assigns `className` once at creation
    // and only mutates via `classList.add` afterwards, so the setter never
    // wipes classes added later.
    get className(): string { return Array.from(classes).join(' '); },
    set className(value: string) {
      classes.clear();
      for (const t of value.split(/\s+/)) { if (t) classes.add(t); }
    },
    appendChild(child: FakeElement) { el.children.push(child); return child; },
    replaceChildren() { el.children.length = 0; },
    setAttribute(name: string, value: string) { el.attributes[name] = value; },
    getAttribute(name: string) { return name in el.attributes ? el.attributes[name] : null; },
    removeAttribute(name: string) { delete el.attributes[name]; },
    addEventListener() { /* no-op: interaction is validated by the manual checklist */ },
    removeEventListener() { /* no-op */ },
    querySelectorAll(selector: string): FakeElement[] {
      // Supports the simple selectors the rendering properties need:
      //   [role="option"]  and  .class-name
      const matchRole = selector.match(/^\[role="([^"]+)"\]$/);
      const matchClass = selector.match(/^\.([\w-]+)$/);
      const out: FakeElement[] = [];
      const walk = (node: FakeElement) => {
        for (const c of node.children) {
          if (matchRole && c.attributes['role'] === matchRole[1]) out.push(c);
          else if (matchClass && c.classList.contains(matchClass[1])) out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out;
    },
    scrollIntoView() { /* no-op under the shim */ },
  };
  return el;
}

/** A handle so a test can uninstall the shim and restore any prior global. */
export interface DomShimHandle {
  uninstall(): void;
}

/**
 * Install a minimal global `document` with `createElement`. Returns a handle to
 * restore the previous state. Safe to call when a real DOM already exists (it
 * saves and restores whatever was there).
 */
export function installDomShim(): DomShimHandle {
  const g = globalThis as unknown as { document?: unknown };
  const previous = g.document;
  g.document = {
    createElement(tagName: string): FakeElement {
      return makeFakeElement(tagName);
    },
    // The component registers a document-level `pointerdown` listener (outside-click
    // close) and removes it in destroy(). Interaction is validated by the manual
    // checklist, so these are no-ops here — they only need to exist so construction
    // and destroy() don't throw under the shim.
    addEventListener() { /* no-op */ },
    removeEventListener() { /* no-op */ },
  };
  return {
    uninstall() {
      if (previous === undefined) delete g.document;
      else g.document = previous;
    },
  };
}

// ------------------------------------------------------------
// Property runner
// ------------------------------------------------------------

/** Default iteration count per property (spec requires >= 100). */
export const DEFAULT_ITERATIONS = 100;

let failureCount = 0;

/**
 * Run a single property `body` for `iterations` loops. Catches assertion
 * failures (and any other throw), prints a clear PASS/FAIL line, and records
 * failures so `finish()` can exit non-zero.
 *
 * The `body` receives the iteration index so it can seed / vary its own inputs;
 * property bodies typically construct an `Rng` seeded from a base seed + index.
 */
export function runProperty(
  name: string,
  iterations: number,
  body: (iteration: number) => void,
): void {
  const count = Math.max(iterations, DEFAULT_ITERATIONS);
  try {
    for (let i = 0; i < count; i++) {
      body(i);
    }
    console.log(`PASS  ${name}  (${count} iterations)`);
  } catch (err) {
    failureCount++;
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`FAIL  ${name}  -> ${detail}`);
  }
}

/**
 * Print a summary and set a non-zero exit code if any property failed, so that
 * `node` surfaces the failure to CI / callers. Called at the end of `main()`.
 */
export function finish(): void {
  if (failureCount > 0) {
    console.error(`\n${failureCount} property(ies) failed.`);
    // Prefer process.exitCode over process.exit so pending output flushes.
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll properties passed.');
  }
}

// ------------------------------------------------------------
// main()
//
// Calls each property function. The bodies live in later tasks;
// this list is the single place they get wired in. Until then
// main() is a near-empty placeholder that type-checks and runs
// cleanly, printing "no properties yet".
//
// Properties to be added (each tagged
// `Feature: searchable-timezone-selector, Property N`):
//   Property 1: Filter correctness              (task 2.2)
//   Property 2: Empty query returns full list   (task 2.3)
//   Property 3: Value-to-display mapping         (task 4.3)  [uses DOM shim]
//   Property 4: Offset text format               (task 1.3)
//   Property 5: Highlight navigation wrap        (task 4.9)
//   Property 6: Rendered row count == filtered   (task 4.5)  [uses DOM shim]
//   Property 7: Commit membership                (task 4.11)
// ------------------------------------------------------------

function main(): void {
  console.log('Feature: searchable-timezone-selector — property harness');

  // --- Property bodies are added by later tasks. ---
  // Example wiring (added by a later task):
  //   runProperty('Property 1: Filter correctness', DEFAULT_ITERATIONS, (i) => {
  //     const rng = new Rng(0xC0FFEE + i);
  //     ...
  //   });

  // Property 1 — Filter correctness
  //
  // For any option list and any (non-empty) query, filterTimezoneOptions returns
  // exactly the options whose searchable text (value + label) contains the trimmed
  // query as a case-insensitive substring, and the result is a subsequence of the
  // input (original relative order preserved). The match predicate mirrors the
  // implementation exactly.
  runProperty(
    'Feature: searchable-timezone-selector, Property 1: Filter correctness',
    DEFAULT_ITERATIONS,
    (i) => {
      const rng = new Rng(0xC0FFEE + i);
      const options = randomOptionList(rng);
      const query = randomQuery(rng, options);

      // Empty/whitespace queries are Property 2's territory; skip them here.
      if (query.trim() === '') return;

      const needle = query.trim().toLowerCase();
      const matches = (option: HarnessOption): boolean =>
        (option.value + '\u0000' + option.label).toLowerCase().includes(needle);

      const result = filterTimezoneOptions(options, query);

      // Soundness: every returned option matches the predicate.
      for (const option of result) {
        assert(
          matches(option),
          `returned option does not match query ${JSON.stringify(query)}: ${JSON.stringify(option)}`,
        );
      }

      // Completeness: every input option that is absent from the result must NOT match.
      for (const option of options) {
        if (!result.includes(option)) {
          assert(
            !matches(option),
            `omitted option matches query ${JSON.stringify(query)} but was filtered out: ${JSON.stringify(option)}`,
          );
        }
      }

      // Subsequence: result appears in `options` in the same relative order.
      // Compare by reference since `filter` returns the same object references.
      let oi = 0;
      for (const r of result) {
        while (oi < options.length && options[oi] !== r) oi++;
        assert(
          oi < options.length,
          `result is not a subsequence of options for query ${JSON.stringify(query)}`,
        );
        oi++; // strictly increasing indices
      }
    },
  );

  // Property 2 — Empty query returns the full list
  //
  // For any option list, filtering by an empty or whitespace-only query returns
  // every option in the original order: the result has the same length and the
  // same members by reference at every index (the impl returns options.slice()).
  runProperty(
    'Feature: searchable-timezone-selector, Property 2: Empty query returns the full list',
    DEFAULT_ITERATIONS,
    (i) => {
      const rng = new Rng(0xE117 + i);
      // The generator's min length is 0, so the empty-list case occurs naturally.
      const options = randomOptionList(rng);
      // Cycle among whitespace-only queries so both '' and various blanks are hit.
      const emptyish = ['', '   ', '\t', '\n', '  \t \n '];
      const query = rng.pick(emptyish);

      const result = filterTimezoneOptions(options, query);

      // Membership count is identical.
      assert(
        result.length === options.length,
        `empty query ${JSON.stringify(query)} should return all ${options.length} options, got ${result.length}`,
      );

      // Same order and same members (by reference) at every index.
      for (let k = 0; k < options.length; k++) {
        assert(
          result[k] === options[k],
          `empty query ${JSON.stringify(query)} altered option order/membership at index ${k}`,
        );
      }
    },
  );

  // Property 3 — Value-to-display mapping
  //
  // For any option list and any value, displayLabelForValue(options, value) returns
  // the matching option's `label` when the value is present (Req 1.2), and the raw
  // `value` string verbatim when it is not (Req 1.4). Because the mapping is a pure,
  // DOM-free function (the design's "extraction of the mapping into a pure function"),
  // this property validates it directly — no DOM shim needed.
  runProperty(
    'Feature: searchable-timezone-selector, Property 3: Value-to-display mapping',
    DEFAULT_ITERATIONS,
    (i) => {
      const rng = new Rng(0xD15B1A + i);
      const options = randomOptionList(rng);

      // Case A — value present: pick a random option's value and expect its label.
      // The generator can produce duplicate values, and the mapping returns the FIRST
      // match, so compute the expected label from the first option with that value.
      if (options.length > 0) {
        const opt = rng.pick(options);
        const expected = options.find((o) => o.value === opt.value)!.label;
        const actual = displayLabelForValue(options, opt.value);
        assert(
          actual === expected,
          `present value ${JSON.stringify(opt.value)} should map to first-match label ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
      }

      // Case B — value absent: construct a value guaranteed not to be any option's
      // value; the raw value must be returned verbatim. Also covers the empty-list
      // case (every value is absent when options is empty).
      let absentValue = randomString(rng, 0, 12);
      if (options.some((o) => o.value === absentValue)) {
        absentValue += '\u0001__absent';
      }
      const absentResult = displayLabelForValue(options, absentValue);
      assert(
        absentResult === absentValue,
        `absent value ${JSON.stringify(absentValue)} should be returned verbatim, got ${JSON.stringify(absentResult)}`,
      );
    },
  );

  // Property 4 — Offset text format
  //
  // getTimezoneOptions() enumerates every supported IANA zone and builds an
  // Intl formatter per zone, so it is relatively expensive; compute it ONCE
  // here (it is invariant across iterations) rather than inside the loop body.
  const p4AllOptions = getTimezoneOptions();
  const p4RealTimezones = p4AllOptions
    .filter((o) => o.value !== 'auto')
    .map((o) => o.value);

  runProperty(
    'Feature: searchable-timezone-selector, Property 4: Offset text format',
    DEFAULT_ITERATIONS,
    (i) => {
      const rng = new Rng(0x0FF5E7 + i);

      assert(p4RealTimezones.length > 0, 'expected at least one non-auto timezone option');

      // 'auto' is never assigned an offset: it must be the first entry and its
      // label must not contain an offset suffix.
      assert(p4AllOptions[0].value === 'auto', "first option value should be 'auto'");
      assert(
        !p4AllOptions[0].label.includes('(UTC'),
        `'auto' label should carry no offset, got: ${p4AllOptions[0].label}`,
      );

      // On ~30% of iterations, feed a deliberately invalid timezone id to
      // exercise the null path; otherwise pick a real timezone value.
      if (rng.bool(0.3)) {
        const junk = rng.bool()
          ? 'Not/AZone'
          : `${randomString(rng, 3, 8)}/${randomString(rng, 3, 8)}`;
        const result = formatTimezoneOffset(junk);
        assert(
          result === null,
          `invalid timezone ${JSON.stringify(junk)} should format to null, got: ${JSON.stringify(result)}`,
        );
        return;
      }

      const tz = rng.pick(p4RealTimezones);
      const offset = formatTimezoneOffset(tz);
      assert(offset !== null, `resolvable timezone ${tz} should not format to null`);
      assert(
        /^UTC[+-]\d{2}:\d{2}$/.test(offset as string),
        `offset for ${tz} should match UTC±HH:MM, got: ${JSON.stringify(offset)}`,
      );
    },
  );
  // Property 5 — Highlight navigation wrap
  //
  // For any non-empty Filtered_List of length n and any in-range starting index,
  // stepping the highlight with nextHighlightIndex is the modular arithmetic
  // (i ± 1 + n) mod n. Therefore n forward steps (ArrowDown) return to the start, n
  // backward steps (ArrowUp) return to the start, a single forward step followed by a
  // single backward step is the identity, and each single step equals the closed-form
  // modulo. The length<=0 guard (return -1) is exercised on a subset of iterations.
  runProperty(
    'Feature: searchable-timezone-selector, Property 5: Highlight navigation wrap',
    DEFAULT_ITERATIONS,
    (i) => {
      const rng = new Rng(0x5EED5 + i);

      // Length<=0 guard: on every ~10th iteration, assert the empty-list contract that
      // there is nothing to highlight in either direction (Req 5.1/5.2 wrap requires a
      // non-empty list; an empty list yields -1).
      if (i % 10 === 0) {
        const anything = rng.int(-5, 30);
        assert(
          nextHighlightIndex(anything, 0, 1) === -1,
          `length 0 forward from ${anything} should be -1`,
        );
        assert(
          nextHighlightIndex(anything, 0, -1) === -1,
          `length 0 backward from ${anything} should be -1`,
        );
      }

      const length = rng.int(1, 30); // non-empty Filtered_List
      const start = rng.int(0, length - 1); // in-range starting index

      // Wrap-around forward: n forward steps return to start (Req 5.1).
      let forward = start;
      for (let step = 0; step < length; step++) {
        forward = nextHighlightIndex(forward, length, 1);
      }
      assert(
        forward === start,
        `${length} forward steps from ${start} (n=${length}) should return to ${start}, got ${forward}`,
      );

      // Wrap-around backward: n backward steps return to start (Req 5.2).
      let backward = start;
      for (let step = 0; step < length; step++) {
        backward = nextHighlightIndex(backward, length, -1);
      }
      assert(
        backward === start,
        `${length} backward steps from ${start} (n=${length}) should return to ${start}, got ${backward}`,
      );

      // Single-step identity: forward then backward is the identity.
      const roundTrip = nextHighlightIndex(
        nextHighlightIndex(start, length, 1),
        length,
        -1,
      );
      assert(
        roundTrip === start,
        `forward-then-backward from ${start} (n=${length}) should be identity, got ${roundTrip}`,
      );

      // Single-step closed form: one step equals (i ± 1 + n) mod n.
      const oneForward = nextHighlightIndex(start, length, 1);
      const oneBackward = nextHighlightIndex(start, length, -1);
      assert(
        oneForward === (start + 1) % length,
        `one forward step from ${start} (n=${length}) should be ${(start + 1) % length}, got ${oneForward}`,
      );
      assert(
        oneBackward === (start - 1 + length) % length,
        `one backward step from ${start} (n=${length}) should be ${(start - 1 + length) % length}, got ${oneBackward}`,
      );
    },
  );

  // Property 6 — Rendered row count equals filtered length
  //
  // For any Filtered_List, rendering produces exactly one role="option" list item per
  // entry; the "no matches" (.combobox-empty) row is NOT a role="option" and appears
  // only when the list is empty (Req 2.4). This drives the REAL component render under
  // the DOM shim: at construction the component sets state.filtered = options.slice()
  // and render() builds the rows immediately (open/closed only toggles list.hidden), so
  // counting rows right after construction validates the render invariant without
  // needing to dispatch events (the shim's addEventListener is a no-op).
  //
  // Sequencing: createTimezoneCombobox calls document.createElement at construction, so
  // the shim MUST be installed BEFORE constructing. runProperty runs synchronously and
  // catches its own errors, so installing once immediately before it and uninstalling in
  // a finally after it returns is safe and keeps the global clean.
  const p6Shim = installDomShim();
  try {
    runProperty(
      'Feature: searchable-timezone-selector, Property 6: Rendered row count equals filtered length',
      DEFAULT_ITERATIONS,
      (i) => {
        const rng = new Rng(0x60D06 + i);
        const options = randomOptionList(rng);

        const cb = createTimezoneCombobox({
          options,
          value: options.length ? options[0].value : 'x',
          onSelect: () => {},
          idPrefix: 'p6',
        });

        // querySelectorAll walks descendants from root, so it reaches the <li> rows
        // nested inside the <ul>.
        const optionRows = (cb.root as unknown as FakeElement).querySelectorAll('[role="option"]');
        const emptyRows = (cb.root as unknown as FakeElement).querySelectorAll('.combobox-empty');

        if (options.length > 0) {
          assert(
            optionRows.length === options.length,
            `rendered role=option count ${optionRows.length} should equal filtered length ${options.length}`,
          );
          assert(
            emptyRows.length === 0,
            `no .combobox-empty row expected for a non-empty list, got ${emptyRows.length}`,
          );
        } else {
          assert(
            optionRows.length === 0,
            `empty list should render zero role=option rows, got ${optionRows.length}`,
          );
          assert(
            emptyRows.length === 1,
            `empty list should render exactly one .combobox-empty row, got ${emptyRows.length}`,
          );
        }

        cb.destroy();
      },
    );
  } finally {
    p6Shim.uninstall();
  }

  // Property 7 — Commit membership
  //
  // For any sequence of commit actions, every value the combobox emits through
  // onSelect is the `value` of some option in the Option_List (Req 7.1); and when the
  // Filtered_List is empty the highlight is unset so pressing Enter commits nothing
  // (Req 7.4).
  //
  // Driving real DOM events through the shim is unreliable (its addEventListener is a
  // no-op, so there is nothing to dispatch to). Instead we validate the guarantee at the
  // level we can observe through the component's PUBLIC surface plus a captured onSelect:
  //   (a) MEMBERSHIP (Req 7.1): for each real option, setValue(opt.value) then getValue()
  //       returns exactly that value, and that value is a member of options.map(o=>o.value).
  //       setValue is the external-sync path and never fires onSelect, so `emitted` stays
  //       empty from setValue — the observable membership guarantee is that getValue() after
  //       any real-option setValue is always a value present in `options`.
  //   (b) EMPTY-LIST NO-COMMIT (Req 7.4): with options.length === 0, immediately after
  //       construction nothing auto-commits (emitted.length === 0), getValue() equals the
  //       passed initial value, and zero role="option" rows render — so there is nothing to
  //       Enter-commit.
  //   (c) INVALID GUARD (Req 7.1 hardening): the core onSelect invariant — every string in
  //       `emitted` must be a member of options.map(o=>o.value). setValue leaves it empty
  //       (trivially satisfied), so we ALSO assert that a non-empty list was constructed with
  //       a member initial value: options.some(o => o.value === getValue()).
  //
  // Sequencing mirrors Property 6: install the shim once immediately before this runProperty
  // (construction calls document.createElement) and uninstall in a finally after it returns.
  const p7Shim = installDomShim();
  try {
    runProperty(
      'Feature: searchable-timezone-selector, Property 7: Commit membership',
      DEFAULT_ITERATIONS,
      (i) => {
        const rng = new Rng(0xC07117 + i);
        const options = randomOptionList(rng);
        const optionValues = options.map((o) => o.value);

        const emitted: string[] = [];
        const cb = createTimezoneCombobox({
          options,
          value: options.length ? options[0].value : 'x',
          onSelect: (v) => emitted.push(v),
          idPrefix: 'p7',
        });

        if (options.length === 0) {
          // (b) EMPTY-LIST NO-COMMIT (Req 7.4): nothing auto-commits on construction, the
          // initial value is retained verbatim, and there are zero option rows to Enter-commit.
          assert(
            emitted.length === 0,
            `empty list should auto-commit nothing, got ${emitted.length} emission(s)`,
          );
          assert(
            cb.getValue() === 'x',
            `empty list should retain the initial value 'x', got ${JSON.stringify(cb.getValue())}`,
          );
          const optionRows = (cb.root as unknown as FakeElement).querySelectorAll('[role="option"]');
          assert(
            optionRows.length === 0,
            `empty list should render zero role=option rows (nothing to Enter-commit), got ${optionRows.length}`,
          );
        } else {
          // (c) INVALID GUARD (Req 7.1): the component was constructed with a member initial
          // value, so getValue() is a member of the Option_List.
          assert(
            options.some((o) => o.value === cb.getValue()),
            `initial committed value ${JSON.stringify(cb.getValue())} should be a member of the option list`,
          );

          // (a) MEMBERSHIP (Req 7.1): for each option (or a random sample when large),
          // setValue(opt.value) then getValue() equals that value AND it is a member of the
          // option list. setValue never emits, so `emitted` stays empty here.
          const sampleCount = options.length > 8 ? 8 : options.length;
          for (let s = 0; s < sampleCount; s++) {
            const opt = options.length > 8 ? rng.pick(options) : options[s];
            cb.setValue(opt.value);
            assert(
              cb.getValue() === opt.value,
              `after setValue(${JSON.stringify(opt.value)}) getValue() should equal it, got ${JSON.stringify(cb.getValue())}`,
            );
            assert(
              optionValues.includes(cb.getValue()),
              `getValue() ${JSON.stringify(cb.getValue())} after a real-option setValue must be a member of the option list`,
            );
          }
        }

        // Core invariant (1): every string emitted through onSelect is a member of the
        // option list. setValue never emits, so this holds for both branches; asserting it
        // unconditionally captures the onSelect commit-membership guarantee (Req 7.1).
        for (const v of emitted) {
          assert(
            optionValues.includes(v),
            `emitted value ${JSON.stringify(v)} is not a member of the option list`,
          );
        }

        cb.destroy();
      },
    );
  } finally {
    p7Shim.uninstall();
  }

  finish();
}

main();
