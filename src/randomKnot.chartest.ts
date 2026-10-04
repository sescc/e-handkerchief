// ============================================================
// e-Handkerchief — randomKnot
// Characterization/behaviour test for `pickRandomKnot` (pure, runs under plain
// node). Compile with tsc, then `node ./src/randomKnot.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { pickRandomKnot } from './randomKnot.js';
import type { Knot } from './types.js';

/** Minimal Knot stand-in; pickRandomKnot only reads `id` and `checkedOffAt`. */
function knot(id: string, checkedOffAt?: number | null): Knot {
  return { id, checkedOffAt } as unknown as Knot;
}

let failureCount = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failureCount++;
    console.error(`FAIL  ${label}${detail ? `  -> ${detail}` : ''}`);
  }
}

const idOf = (k: Knot | null): string | null => (k ? k.id : null);

function main(): void {
  console.log('Characterization test: randomKnot.pickRandomKnot');

  check('empty list -> null', pickRandomKnot([], null, () => 0) === null);

  check(
    'all checked off -> null',
    pickRandomKnot([knot('a', 1), knot('b', 2)], null, () => 0) === null,
  );

  check(
    'exclusion removes the only candidate -> null',
    pickRandomKnot([knot('a')], 'a', () => 0) === null,
  );

  check(
    'exclusion leaves only checked-off knots -> null',
    pickRandomKnot([knot('a'), knot('b', 5)], 'a', () => 0) === null,
  );

  check(
    'single candidate is returned',
    idOf(pickRandomKnot([knot('a')], null, () => 0.7)) === 'a',
  );

  // Excluded id is never returned, whatever rand says.
  {
    const knots = [knot('a'), knot('b'), knot('c')];
    let leaked = false;
    for (let i = 0; i <= 100; i++) {
      const r = i / 100; // includes 1
      if (idOf(pickRandomKnot(knots, 'b', () => r)) === 'b') leaked = true;
    }
    check('excluded id is never returned (rand 0..1 sweep)', !leaked);
  }

  // Checked-off knots are never returned (checkedOffAt: 0 is still a number).
  {
    const knots = [knot('a', 0), knot('b'), knot('c', 99), knot('d', null)];
    let leaked = false;
    const seen = new Set<string>();
    for (let i = 0; i <= 100; i++) {
      const picked = idOf(pickRandomKnot(knots, null, () => i / 100));
      if (picked === 'a' || picked === 'c') leaked = true;
      if (picked) seen.add(picked);
    }
    check('checked-off knots are never returned', !leaked);
    check('null/undefined checkedOffAt knots are candidates', seen.has('b') && seen.has('d'));
  }

  // Deterministic picks over 4 candidates: indices floor(rand * 4), clamped.
  {
    const knots = [knot('a'), knot('b'), knot('c'), knot('d')];
    const cases: Array<[number, string]> = [
      [0, 'a'],
      [0.24, 'a'],
      [0.25, 'b'],
      [0.5, 'c'],
      [0.999999, 'd'],
      [1, 'd'], // clamped to the last candidate
    ];
    for (const [r, expected] of cases) {
      const actual = idOf(pickRandomKnot(knots, null, () => r));
      check(`rand=${r} picks '${expected}'`, actual === expected, `got ${actual}`);
    }
  }

  // Index is taken over the filtered candidates, not the original list.
  {
    const knots = [knot('a', 1), knot('b'), knot('c'), knot('d', 2), knot('e')];
    const actual = idOf(pickRandomKnot(knots, 'c', () => 0.5)); // candidates: b, e
    check("rand=0.5 over filtered candidates [b, e] picks 'e'", actual === 'e', `got ${actual}`);
  }

  // Default rand works and returns a candidate.
  {
    const picked = pickRandomKnot([knot('a'), knot('b')], null);
    check('default Math.random returns a candidate', picked !== null && (picked.id === 'a' || picked.id === 'b'));
  }

  if (failureCount > 0) {
    console.error(`\n${failureCount} case(s) failed.`);
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll cases passed.');
  }
}

main();
