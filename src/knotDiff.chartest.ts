// ============================================================
// e-Handkerchief — knotDiff
// Characterization test for `diffKnots` / `diffLines`.
//
// knotDiff.ts is pure (no DOM, no db/settingsStore imports), so it is
// exercised directly under plain `node`. Mirrors the style of
// knotSummary.chartest.ts: a tiny assertion helper, PASS/FAIL per scenario,
// and a non-zero exit code on failure. Run via `tsc` then
// `node ./src/knotDiff.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { diffKnots, diffLines } from './knotDiff.js';
import type { Knot, TextMediaItem, AudioMediaItem, PhotoMediaItem } from './types.js';

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
// Fixtures
// ------------------------------------------------------------

function baseKnot(overrides: Partial<Knot> = {}): Knot {
  return {
    id: 'k1',
    timestamp: { localISO: '2026-09-24T12:00:00.000Z', utcOffset: '+00:00' },
    location: null,
    mediaItems: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function textItem(id: string, content: string): TextMediaItem {
  return { id, type: 'text', createdAt: 1000, content };
}

function audioItem(id: string, transcript?: string): AudioMediaItem {
  const item: AudioMediaItem = {
    id,
    type: 'audio',
    createdAt: 1000,
    blob: new Blob(['x'], { type: 'audio/webm' }),
    durationSeconds: 5,
  };
  if (transcript !== undefined) item.transcript = transcript;
  return item;
}

function photoItem(id: string): PhotoMediaItem {
  return {
    id,
    type: 'photo',
    createdAt: 1000,
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    widthPx: 100,
    heightPx: 100,
    thumbnailBlob: new Blob(['x'], { type: 'image/jpeg' }),
  };
}

// ------------------------------------------------------------
// Scenario table
// ------------------------------------------------------------

interface Scenario {
  label: string;
  run: () => void;
}

const SCENARIOS: Scenario[] = [
  {
    label: 'identical knots: identical = true and nothing reported',
    run: () => {
      const a = baseKnot({ mediaItems: [textItem('t1', 'hello'), photoItem('p1'), audioItem('a1', 'hi')], manualLabel: 'Home' });
      const b = baseKnot({ mediaItems: [textItem('t1', 'hello'), photoItem('p1'), audioItem('a1', 'hi')], manualLabel: 'Home' });
      const d = diffKnots(a, b);
      assert(d.identical, 'should be identical');
      assert(d.text.changed.length === 0 && d.transcripts.length === 0, 'nothing changed');
      assert(d.location === null && d.manualLabel === null, 'no location/label change');
    },
  },
  {
    label: 'changed text: reported with a line diff (local -> remote)',
    run: () => {
      const a = baseKnot({ mediaItems: [textItem('t1', 'one\ntwo\nthree')] });
      const b = baseKnot({ mediaItems: [textItem('t1', 'one\nTWO\nthree\nfour')] });
      const d = diffKnots(a, b);
      assert(!d.identical, 'should differ');
      assert(d.text.changed.length === 1, 'one changed text item');
      const c = d.text.changed[0];
      assert(c.id === 't1' && c.local === 'one\ntwo\nthree' && c.remote === 'one\nTWO\nthree\nfour', 'local/remote text carried');
      assert(
        JSON.stringify(c.lines) ===
          JSON.stringify([
            { op: 'same', text: 'one' },
            { op: 'del', text: 'two' },
            { op: 'add', text: 'TWO' },
            { op: 'same', text: 'three' },
            { op: 'add', text: 'four' },
          ]),
        `unexpected line diff: ${JSON.stringify(c.lines)}`
      );
    },
  },
  {
    label: 'diffLines: pure additions, deletions and identical input',
    run: () => {
      assert(JSON.stringify(diffLines('a', 'a')) === JSON.stringify([{ op: 'same', text: 'a' }]), 'identical -> all same');
      assert(
        JSON.stringify(diffLines('a\nb', 'a')) === JSON.stringify([{ op: 'same', text: 'a' }, { op: 'del', text: 'b' }]),
        'trailing line deleted'
      );
      assert(
        JSON.stringify(diffLines('a', 'a\r\nb')) === JSON.stringify([{ op: 'same', text: 'a' }, { op: 'add', text: 'b' }]),
        'CRLF normalised, trailing line added'
      );
    },
  },
  {
    label: 'text added and removed: onlyOnThisDevice / onlyInCloud by media id',
    run: () => {
      const a = baseKnot({ mediaItems: [textItem('t1', 'both'), textItem('t2', 'only here')] });
      const b = baseKnot({ mediaItems: [textItem('t1', 'both'), textItem('t3', 'only cloud')] });
      const d = diffKnots(a, b);
      assert(!d.identical, 'should differ');
      assert(d.text.onlyOnThisDevice.length === 1 && d.text.onlyOnThisDevice[0].id === 't2', 't2 only on this device');
      assert(d.text.onlyInCloud.length === 1 && d.text.onlyInCloud[0].id === 't3', 't3 only in cloud');
      assert(d.text.changed.length === 0, 't1 is unchanged');
    },
  },
  {
    label: 'a photo present on one side only',
    run: () => {
      const a = baseKnot({ mediaItems: [photoItem('p1'), photoItem('p2')] });
      const b = baseKnot({ mediaItems: [photoItem('p1')] });
      const d = diffKnots(a, b);
      assert(!d.identical, 'should differ');
      assert(d.photos.onlyOnThisDevice.length === 1 && d.photos.onlyOnThisDevice[0].id === 'p2', 'p2 only on this device');
      assert(d.photos.onlyInCloud.length === 0, 'nothing only in cloud');

      const flipped = diffKnots(b, a);
      assert(flipped.photos.onlyInCloud.length === 1 && flipped.photos.onlyInCloud[0].id === 'p2', 'direction flips');
    },
  },
  {
    label: 'per-audio transcript changed (and legacy knot-level transcription)',
    run: () => {
      const a = baseKnot({ mediaItems: [audioItem('a1', 'hello')] });
      const b = baseKnot({ mediaItems: [audioItem('a1', 'hello world')] });
      const d = diffKnots(a, b);
      assert(!d.identical, 'should differ');
      assert(
        d.transcripts.length === 1 && d.transcripts[0].mediaId === 'a1' &&
          d.transcripts[0].local === 'hello' && d.transcripts[0].remote === 'hello world',
        `unexpected transcripts: ${JSON.stringify(d.transcripts)}`
      );

      const legacyA = baseKnot({ transcription: 'old' });
      const legacyB = baseKnot({ transcription: 'older' });
      const dl = diffKnots(legacyA, legacyB);
      assert(dl.transcripts.length === 1 && dl.transcripts[0].mediaId === null, 'legacy transcript change has mediaId null');
    },
  },
  {
    label: 'location changed (address or coordinates); accuracy alone is ignored',
    run: () => {
      const loc = { latitude: 1, longitude: 2, accuracyMeters: 5, resolvedAddress: 'Here' };
      const moved = { latitude: 1, longitude: 3, accuracyMeters: 5, resolvedAddress: 'Here' };
      const readdressed = { ...loc, resolvedAddress: 'There' };
      const lessAccurate = { ...loc, accuracyMeters: 500 };

      assert(diffKnots(baseKnot({ location: loc }), baseKnot({ location: moved })).location !== null, 'coordinate change');
      assert(diffKnots(baseKnot({ location: loc }), baseKnot({ location: readdressed })).location !== null, 'address change');
      assert(diffKnots(baseKnot({ location: loc }), baseKnot({ location: null })).location !== null, 'location removed');
      const same = diffKnots(baseKnot({ location: loc }), baseKnot({ location: lessAccurate }));
      assert(same.location === null && same.identical, 'accuracy alone is not a change');
    },
  },
  {
    label: 'manualLabel changed',
    run: () => {
      const d = diffKnots(baseKnot({ manualLabel: 'Home' }), baseKnot({ manualLabel: 'Office' }));
      assert(!d.identical, 'should differ');
      assert(d.manualLabel !== null && d.manualLabel.local === 'Home' && d.manualLabel.remote === 'Office', 'label carried');

      const cleared = diffKnots(baseKnot({ manualLabel: 'Home' }), baseKnot());
      assert(cleared.manualLabel !== null && cleared.manualLabel.remote === '', 'cleared label reported as empty string');
    },
  },
  {
    label: 'check-off / updatedAt / createdAt differences only -> identical',
    run: () => {
      const a = baseKnot({ mediaItems: [textItem('t1', 'same')], checkedOffAt: 5000, checkOffChangedAt: 5000, updatedAt: 1000, createdAt: 1 });
      const b = baseKnot({ mediaItems: [textItem('t1', 'same')], checkedOffAt: null, checkOffChangedAt: 9000, updatedAt: 9999, createdAt: 2 });
      const d = diffKnots(a, b);
      assert(d.identical, 'check-off and bookkeeping timestamps must not count as a difference');
    },
  },
];

// ------------------------------------------------------------
// Runner
// ------------------------------------------------------------

let failureCount = 0;

function runScenario(s: Scenario): void {
  try {
    s.run();
    console.log(`PASS  ${s.label}`);
  } catch (err) {
    failureCount++;
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`FAIL  ${s.label}  -> ${detail}`);
  }
}

function finish(): void {
  if (failureCount > 0) {
    console.error(`\n${failureCount} scenario(s) failed.`);
    // Prefer process.exitCode over process.exit so pending output flushes.
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll scenarios passed.');
  }
}

function main(): void {
  console.log('Characterization test: knotDiff.diffKnots / diffLines');
  for (const s of SCENARIOS) {
    runScenario(s);
  }
  finish();
}

main();
