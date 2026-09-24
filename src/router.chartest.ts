// ============================================================
// e-Handkerchief — Router
// Characterization test for `parseHash` (INFRASTRUCTURE + FIXTURE).
//
// Each case is a labelled table entry so future route changes are easy to
// find and edit.
//
// parseHash is pure (no `window` access at import time), so it can be
// exercised directly under plain `node`. Mirrors the style of
// src/components/timezoneCombobox.proptest.ts: a tiny assertion helper,
// PASS/FAIL per case, and a non-zero exit code on failure. Run via `tsc`
// (which emits router.chartest.js next to this file) then
// `node ./src/router.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { parseHash, type RouteMatch } from './router.js';

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

/** Structural deep-equality check for plain JSON-like values (RouteMatch shape). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

// ------------------------------------------------------------
// Case table
//
// Each entry: a label, the input hash, and the exact expected RouteMatch.
// ------------------------------------------------------------

interface Case {
  label: string;
  hash: string;
  expected: RouteMatch;
}

const CASES: Case[] = [
  // --- capture (root / empty) ---
  { label: "'#/' -> capture", hash: '#/', expected: { route: 'capture', params: {} } },
  { label: "'' -> capture", hash: '', expected: { route: 'capture', params: {} } },

  // --- knots ---
  { label: "'#/knots' -> knots", hash: '#/knots', expected: { route: 'knots', params: {} } },

  // --- calendar ---
  { label: "'#/calendar' -> calendar", hash: '#/calendar', expected: { route: 'calendar', params: {} } },

  // --- settings ---
  { label: "'#/settings' -> settings", hash: '#/settings', expected: { route: 'settings', params: {} } },

  // --- knot detail ---
  { label: "'#/knot/abc' -> knot, params.id='abc'", hash: '#/knot/abc', expected: { route: 'knot', params: { id: 'abc' } } },

  // --- unknown -> capture fallback ---
  { label: "'#/unknown' -> capture (fallback)", hash: '#/unknown', expected: { route: 'capture', params: {} } },
  { label: "'#/knots/extra' -> capture (fallback)", hash: '#/knots/extra', expected: { route: 'capture', params: {} } },
];

// ------------------------------------------------------------
// Runner
// ------------------------------------------------------------

let failureCount = 0;

function runCase(c: Case): void {
  try {
    const actual = parseHash(c.hash);
    assert(
      deepEqual(actual, c.expected),
      `expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(actual)}`,
    );
    console.log(`PASS  ${c.label}`);
  } catch (err) {
    failureCount++;
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`FAIL  ${c.label}  -> ${detail}`);
  }
}

function finish(): void {
  if (failureCount > 0) {
    console.error(`\n${failureCount} case(s) failed.`);
    // Prefer process.exitCode over process.exit so pending output flushes.
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll cases passed.');
  }
}

function main(): void {
  console.log('Characterization test: router.parseHash');
  for (const c of CASES) {
    runCase(c);
  }
  finish();
}

main();
