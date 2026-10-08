// ============================================================
// e-Handkerchief — mediaSummary
// Characterization/behaviour test for `summarizeMedia` and
// `describeMediaSummary` (pure, runs under plain node). Compile with tsc, then
// `node ./src/mediaSummary.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { summarizeMedia, describeMediaSummary } from './mediaSummary.js';
import type { MediaItem, TextMediaItem, AudioMediaItem, PhotoMediaItem, VideoMediaItem } from './types.js';

let failureCount = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failureCount++;
    console.error(`FAIL  ${label}${detail ? '  -> ' + detail : ''}`);
  }
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `expected ${e}, got ${a}`);
}

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

function text(id: string): TextMediaItem {
  return { id, type: 'text', createdAt: 0, content: 'hello' };
}
function audio(id: string): AudioMediaItem {
  return { id, type: 'audio', createdAt: 0, blob: new Blob(['x'], { type: 'audio/webm' }), durationSeconds: 1 };
}
function photo(id: string): PhotoMediaItem {
  return {
    id, type: 'photo', createdAt: 0,
    blob: new Blob(['x'], { type: 'image/jpeg' }), widthPx: 10, heightPx: 10,
    thumbnailBlob: new Blob(['x'], { type: 'image/jpeg' }),
  };
}
function video(id: string): VideoMediaItem {
  return {
    id, type: 'video', createdAt: 0,
    blob: new Blob(['x'], { type: 'video/mp4' }), durationSeconds: 1,
    thumbnailBlob: new Blob(['x'], { type: 'image/jpeg' }),
  };
}

function summary(items: MediaItem[]): Array<{ type: string; count: number; firstId: string }> {
  return summarizeMedia(items).map((e) => ({ type: e.type, count: e.count, firstId: e.first.id }));
}

function main(): void {
  console.log('Characterization test: mediaSummary');

  eq('empty -> []', summary([]), []);
  eq('text-only -> []', summary([text('t1'), text('t2')]), []);

  eq(
    'order is photo, video, audio regardless of input order',
    summary([audio('a1'), video('v1'), photo('p1')]).map((e) => e.type),
    ['photo', 'video', 'audio']
  );
  eq(
    'order with mixed text and repeats',
    summary([text('t'), audio('a1'), photo('p1'), audio('a2'), video('v1'), photo('p2')]).map((e) => e.type),
    ['photo', 'video', 'audio']
  );
  eq('absent types are omitted', summary([audio('a1'), text('t')]).map((e) => e.type), ['audio']);
  eq('photo + audio only', summary([audio('a1'), photo('p1')]).map((e) => e.type), ['photo', 'audio']);

  eq(
    'counts per type',
    summary([photo('p1'), photo('p2'), photo('p3'), video('v1'), audio('a1'), audio('a2')]).map((e) => e.count),
    [3, 1, 2]
  );
  eq(
    'first is the first of its type in array order',
    summary([audio('a1'), photo('p1'), video('v1'), photo('p2'), audio('a2'), video('v2')]).map((e) => e.firstId),
    ['p1', 'v1', 'a1']
  );

  const p = photo('p9');
  const entries = summarizeMedia([text('t'), p]);
  check('first is the same object reference', entries.length === 1 && entries[0].first === p);

  eq('describe empty -> empty string', describeMediaSummary([]), '');
  eq('describe singular photo', describeMediaSummary(summarizeMedia([photo('p1')])), '1 photo');
  eq('describe singular video', describeMediaSummary(summarizeMedia([video('v1')])), '1 video');
  eq('describe singular voice recording', describeMediaSummary(summarizeMedia([audio('a1')])), '1 voice recording');
  eq(
    'describe plural',
    describeMediaSummary(summarizeMedia([photo('p1'), photo('p2'), video('v1'), video('v2'), audio('a1'), audio('a2')])),
    '2 photos, 2 videos, 2 voice recordings'
  );
  eq(
    'describe mixed singular/plural',
    describeMediaSummary(summarizeMedia([audio('a1'), photo('p1'), photo('p2'), photo('p3'), video('v1')])),
    '3 photos, 1 video, 1 voice recording'
  );
  eq('describe text-only -> empty string', describeMediaSummary(summarizeMedia([text('t')])), '');

  if (failureCount > 0) {
    console.error(`\n${failureCount} check(s) failed.`);
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll checks passed.');
  }
}

main();
