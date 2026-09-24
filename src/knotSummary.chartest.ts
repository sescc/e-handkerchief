// ============================================================
// e-Handkerchief — knotSummary
// Characterization test for `knotSummaryText` and `mediaFileName`
// (INFRASTRUCTURE + FIXTURE).
//
// knotSummary.ts is pure (no DOM, no settingsStore/db imports), so it is
// exercised directly under plain `node`. Mirrors the style of
// router.chartest.ts and syncPlan.chartest.ts: a tiny assertion helper,
// PASS/FAIL per scenario, and a non-zero exit code on failure. Run via `tsc`
// (which emits knotSummary.chartest.js next to this file) then
// `node ./src/knotSummary.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { knotSummaryText, mediaFileName } from './knotSummary.js';
import { googleMapsUrl } from './mapsLink.js';
import type { Knot, TextMediaItem, AudioMediaItem, PhotoMediaItem, VideoMediaItem } from './types.js';

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

/** The stub formatter required by the spec: `(iso) => 'TS(' + iso + ')'`. */
const stubFormat = (iso: string): string => 'TS(' + iso + ')';

/** No two consecutive blank lines anywhere in the text. */
function assertNoDoubledBlankLines(text: string, label: string): void {
  assert(!text.includes('\n\n\n'), `${label}: text has a doubled blank line:\n${JSON.stringify(text)}`);
}

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

let _idCounter = 0;
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}${_idCounter}`;
}

function baseKnot(overrides: Partial<Knot> = {}): Knot {
  return {
    id: nextId('knot'),
    timestamp: { localISO: '2026-09-24T12:00:00.000Z', utcOffset: '+00:00' },
    location: null,
    mediaItems: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function textItem(content: string): TextMediaItem {
  return { id: nextId('text'), type: 'text', createdAt: 1000, content };
}

function audioItem(opts: { transcript?: string; blobType?: string } = {}): AudioMediaItem {
  const item: AudioMediaItem = {
    id: nextId('audio'),
    type: 'audio',
    createdAt: 1000,
    blob: new Blob(['x'], { type: opts.blobType ?? 'audio/webm' }),
    durationSeconds: 5,
  };
  if (opts.transcript !== undefined) item.transcript = opts.transcript;
  return item;
}

function photoItem(opts: { blobType?: string } = {}): PhotoMediaItem {
  return {
    id: nextId('photo'),
    type: 'photo',
    createdAt: 1000,
    blob: new Blob(['x'], { type: opts.blobType ?? 'image/jpeg' }),
    widthPx: 100,
    heightPx: 100,
    thumbnailBlob: new Blob(['x'], { type: 'image/jpeg' }),
  };
}

function videoItem(opts: { blobType?: string } = {}): VideoMediaItem {
  return {
    id: nextId('video'),
    type: 'video',
    createdAt: 1000,
    blob: new Blob(['x'], { type: opts.blobType ?? 'video/mp4' }),
    durationSeconds: 10,
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
    label: 'text only, with a GPS location + resolvedAddress: address and Maps URL lines',
    run: () => {
      const location = { latitude: 1.234567, longitude: 103.456789, accuracyMeters: 5, resolvedAddress: '123 Main St' };
      const knot = baseKnot({ location, mediaItems: [textItem('Hello world')] });
      const text = knotSummaryText(knot, stubFormat);
      const lines = text.split('\n');

      assert(lines[0] === 'TS(2026-09-24T12:00:00.000Z)', `line 0 should be the formatted timestamp, got ${JSON.stringify(lines[0])}`);
      assert(lines[1] === '📍 123 Main St', `line 1 should be the resolved address, got ${JSON.stringify(lines[1])}`);
      assert(lines[2] === googleMapsUrl(location), `line 2 should be the Maps URL, got ${JSON.stringify(lines[2])}`);
      assert(text.includes('Hello world'), 'text item content should appear');
      assertNoDoubledBlankLines(text, 'GPS + resolvedAddress');
    },
  },
  {
    label: 'text with no location but a manualLabel',
    run: () => {
      const knot = baseKnot({ location: null, manualLabel: "Grandma's house", mediaItems: [textItem('note')] });
      const text = knotSummaryText(knot, stubFormat);
      const lines = text.split('\n');

      assert(lines[0] === 'TS(2026-09-24T12:00:00.000Z)', 'line 0 should be the timestamp');
      assert(lines[1] === "📍 Grandma's house", `line 1 should be the manual label, got ${JSON.stringify(lines[1])}`);
      assert(!text.includes('maps.google') && !text.includes('google.com/maps'), 'no Maps URL should be present for a manual label');
      assertNoDoubledBlankLines(text, 'manualLabel only');
    },
  },
  {
    label: 'no location and no label: no pin line at all',
    run: () => {
      const knot = baseKnot({ location: null, mediaItems: [textItem('just text')] });
      const text = knotSummaryText(knot, stubFormat);
      assert(!text.includes('📍'), 'no 📍 line should be present');
      assertNoDoubledBlankLines(text, 'no location, no label');
    },
  },
  {
    label: 'audio with a per-item transcript: 🎙 line and "1 voice recording"',
    run: () => {
      const knot = baseKnot({ mediaItems: [audioItem({ transcript: 'hello there' })] });
      const text = knotSummaryText(knot, stubFormat);
      assert(text.includes('🎙 hello there'), 'transcript line should be prefixed with 🎙');
      assert(text.includes('1 voice recording attached in e-Handkerchief'), `expected singular "1 voice recording", got:\n${text}`);
      assert(!text.includes('voice recordings'), 'singular count should not say "recordings"');
      assertNoDoubledBlankLines(text, 'audio with transcript');
    },
  },
  {
    label: 'legacy knot-level transcription with no per-item transcript falls back to it',
    run: () => {
      const knot = baseKnot({
        mediaItems: [audioItem()], // no per-item transcript
        transcription: 'legacy transcript text',
      });
      const text = knotSummaryText(knot, stubFormat);
      assert(text.includes('🎙 legacy transcript text'), `expected the legacy transcript to be used, got:\n${text}`);
      assertNoDoubledBlankLines(text, 'legacy transcription fallback');
    },
  },
  {
    label: 'two photos and one video: "2 photos, 1 video"',
    run: () => {
      const knot = baseKnot({ mediaItems: [photoItem(), photoItem(), videoItem()] });
      const text = knotSummaryText(knot, stubFormat);
      assert(
        text.includes('(2 photos, 1 video attached in e-Handkerchief)'),
        `expected the pluralised counts line, got:\n${text}`
      );
      assertNoDoubledBlankLines(text, 'two photos + one video');
    },
  },
  {
    label: 'no doubled blank lines: a knot with everything (text, transcript, photo, video, audio)',
    run: () => {
      const knot = baseKnot({
        location: { latitude: 1, longitude: 2, accuracyMeters: null, resolvedAddress: 'Somewhere' },
        mediaItems: [
          textItem('first paragraph'),
          textItem('second paragraph'),
          photoItem(),
          videoItem(),
          audioItem({ transcript: 'spoken words' }),
        ],
      });
      const text = knotSummaryText(knot, stubFormat);
      assertNoDoubledBlankLines(text, 'everything at once');
      assert(text === text.trimEnd(), 'trailing whitespace should be trimmed');
    },
  },
  {
    label: 'mediaFileName: known MIME types map to the expected extensions',
    run: () => {
      const cases: Array<{ blobType: string; expectedExt: string }> = [
        { blobType: 'image/jpeg', expectedExt: 'jpg' },
        { blobType: 'image/png', expectedExt: 'png' },
        { blobType: 'image/gif', expectedExt: 'gif' },
        { blobType: 'image/webp', expectedExt: 'webp' },
        { blobType: 'video/mp4', expectedExt: 'mp4' },
        { blobType: 'video/quicktime', expectedExt: 'mov' },
        { blobType: 'video/webm', expectedExt: 'webm' },
        { blobType: 'audio/webm', expectedExt: 'webm' },
        { blobType: 'audio/mp4', expectedExt: 'm4a' },
        { blobType: 'audio/mpeg', expectedExt: 'mp3' },
        { blobType: 'audio/ogg', expectedExt: 'ogg' },
      ];
      for (const { blobType, expectedExt } of cases) {
        const item = photoItem({ blobType });
        const name = mediaFileName(item, 1);
        assert(
          name === `knot-photo-1.${expectedExt}`,
          `${blobType} should map to .${expectedExt}, got ${JSON.stringify(name)}`
        );
      }
    },
  },
  {
    label: 'mediaFileName: strips ;codecs=… before lookup, and falls back to .bin for unknown types',
    run: () => {
      const withCodecs = audioItem({ blobType: 'audio/webm;codecs=opus' });
      const codecsName = mediaFileName(withCodecs, 2);
      assert(codecsName === 'knot-audio-2.webm', `expected codecs param to be stripped, got ${JSON.stringify(codecsName)}`);

      const unknown = videoItem({ blobType: 'application/octet-stream' });
      const unknownName = mediaFileName(unknown, 3);
      assert(unknownName === 'knot-video-3.bin', `expected unknown type to fall back to .bin, got ${JSON.stringify(unknownName)}`);
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
  console.log('Characterization test: knotSummary.knotSummaryText / mediaFileName');
  for (const s of SCENARIOS) {
    runScenario(s);
  }
  finish();
}

main();
