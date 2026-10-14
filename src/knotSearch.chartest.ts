// ============================================================
// e-Handkerchief — knotSearch
// Characterization/behaviour test for the pure search module (runs under plain
// node). Compile with tsc, then `node ./src/knotSearch.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import {
  normalizeForSearch,
  queryTokens,
  knotMatches,
  searchKnots,
  matchRanges,
  matchSnippet,
  knotSearchFields,
} from './knotSearch.js';
import type { Knot, MediaItem } from './types.js';

let failureCount = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failureCount++;
    console.error(`FAIL  ${label}${detail ? `  -> ${detail}` : ''}`);
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function text(content: string): MediaItem {
  return { id: 't', type: 'text', createdAt: 0, content };
}
function audio(transcript?: string): MediaItem {
  return {
    id: 'a',
    type: 'audio',
    createdAt: 0,
    blob: null as unknown as Blob,
    durationSeconds: 1,
    transcript,
  };
}
function photo(): MediaItem {
  return {
    id: 'p',
    type: 'photo',
    createdAt: 0,
    blob: null as unknown as Blob,
    widthPx: 1,
    heightPx: 1,
    thumbnailBlob: null as unknown as Blob,
  };
}
function knot(opts: {
  id?: string;
  items?: MediaItem[];
  address?: string;
  label?: string;
  legacy?: string;
}): Knot {
  return {
    id: opts.id ?? 'k',
    timestamp: { localISO: '2026-01-01T00:00:00+00:00', utcOffset: '+00:00' },
    location: opts.address
      ? { latitude: 0, longitude: 0, accuracyMeters: null, resolvedAddress: opts.address }
      : null,
    manualLabel: opts.label,
    mediaItems: opts.items ?? [],
    transcription: opts.legacy,
    createdAt: 0,
    updatedAt: 0,
  };
}

const match = (k: Knot, q: string): boolean => knotMatches(k, queryTokens(q));

function main(): void {
  console.log('Characterization test: knotSearch');

  // --- normalizeForSearch ---
  check('normalize: lowercases', normalizeForSearch('HeLLo') === 'hello');
  check('normalize: strips accents', normalizeForSearch('Café Crème') === 'cafe creme');
  check('normalize: pre-decomposed input', normalizeForSearch('Café') === 'cafe');
  check('normalize: empty', normalizeForSearch('') === '');
  check('normalize: keeps CJK and digits', normalizeForSearch('東京 42') === '東京 42');

  // --- queryTokens ---
  check('tokens: empty -> []', same(queryTokens(''), []));
  check('tokens: whitespace only -> []', same(queryTokens('  \t\n '), []));
  check('tokens: splits on any whitespace, trims', same(queryTokens('  Buy   MILK\tnow '), ['buy', 'milk', 'now']));
  check('tokens: folds accents', same(queryTokens('Café'), ['cafe']));
  check('tokens: de-duplicates', same(queryTokens('milk Milk MILK'), ['milk']));

  // --- accents ---
  const cafe = knot({ items: [text('Met at the Café on Monday')] });
  check("'cafe' finds 'Café'", match(cafe, 'cafe'));
  check("'CAFÉ' finds 'Café'", match(cafe, 'CAFÉ'));
  check("'café' finds a knot written without accent", match(knot({ items: [text('a cafe')] }), 'café'));
  check('a non-matching word does not match', !match(cafe, 'tea'));

  // --- multi-word, any order, AND ---
  const shop = knot({ items: [text('Buy milk and eggs')] });
  check('multi-word in order', match(shop, 'buy milk'));
  check('multi-word reversed order', match(shop, 'eggs buy'));
  check('every word must match (one missing -> no match)', !match(shop, 'milk bread'));
  check('substring of a word matches (not whole-word only)', match(shop, 'mil'));
  check('no fuzzy matching (typo does not match)', !match(shop, 'mlik'));
  check('words may be spread over different fields', match(knot({ items: [text('Buy milk')], label: 'Supermarket' }), 'supermarket milk'));
  check('a token cannot span two fields', !match(knot({ items: [text('abc')], label: 'def' }), 'abcdef'));

  // --- transcripts ---
  const voice = knot({ items: [audio('Remember to call the dentist'), photo()] });
  check('per-audio transcript is searched', match(voice, 'dentist'));
  const legacy = knot({ legacy: 'old transcription about plumbing' });
  check('legacy knot-level transcript is searched', match(legacy, 'plumbing'));
  const both = knot({ items: [audio('new words')], legacy: 'legacy words' });
  check('legacy transcript is searched even when per-audio ones exist', match(both, 'legacy') && match(both, 'new'));
  check('audio without a transcript does not break search', !match(knot({ items: [audio(undefined)] }), 'x'));
  check('photo-only knot never matches a word', !match(knot({ items: [photo()] }), 'photo'));

  // --- address vs label ---
  const addr = knot({ address: '1 Example Street, Springfield' });
  const lab = knot({ label: 'Home office' });
  check('resolved address is searched', match(addr, 'springfield'));
  check('manual label is searched', match(lab, 'office'));
  check('address does not match label text', !match(addr, 'office'));
  check('label does not match address text', !match(lab, 'springfield'));
  check('knot with neither address nor label and no text matches nothing', !match(knot({}), 'a'));

  // --- empty / whitespace query ---
  const ks = [cafe, shop, voice];
  check('searchKnots: empty query -> null (no filtering)', searchKnots(ks, '') === null);
  check('searchKnots: whitespace-only query -> null', searchKnots(ks, '   \n') === null);
  check('knotMatches with no tokens is vacuously true', knotMatches(cafe, []));

  // --- searchKnots ---
  {
    const a = knot({ id: 'a', items: [text('milk run')] });
    const b = knot({ id: 'b', items: [text('bread')] });
    const c = knot({ id: 'c', items: [audio('more MILK please')] });
    const res = searchKnots([a, b, c], 'milk');
    check('searchKnots keeps original order and drops non-matches', res !== null && same(res.map((k) => k.id), ['a', 'c']));
    const none = searchKnots([a, b, c], 'zzz');
    check('searchKnots: no matches -> empty array (not null)', Array.isArray(none) && none.length === 0);
  }

  // --- knotSearchFields ---
  {
    const k = knot({ items: [text('t1'), audio('tr'), photo(), text('t2')], address: 'addr', label: 'lab', legacy: 'leg' });
    check('knotSearchFields order', same(knotSearchFields(k), ['t1', 'tr', 't2', 'leg', 'addr', 'lab']));
  }

  // --- matchRanges ---
  check('ranges: no tokens -> []', same(matchRanges('hello', []), []));
  check('ranges: empty text -> []', same(matchRanges('', ['a']), []));
  check('ranges: simple', same(matchRanges('Hello world', ['world']), [[6, 11]]));
  check('ranges: case-insensitive, all occurrences', same(matchRanges('Milk and MILK', ['milk']), [[0, 4], [9, 13]]));
  check('ranges: indices refer to the ORIGINAL text with accents', same(matchRanges('Café crème', ['creme']), [[5, 10]]));
  check('ranges: accented char matched by unaccented token', same(matchRanges('Café', ['cafe']), [[0, 4]]));
  {
    // Pre-decomposed "e" + U+0301: the range must cover the combining mark too.
    const t = 'Café ok';
    const r = matchRanges(t, ['cafe']);
    check('ranges: pre-decomposed accent stays inside the highlight', same(r, [[0, 5]]), JSON.stringify(r));
    check('ranges: pre-decomposed text slices to the whole word', r.length === 1 && t.slice(r[0][0], r[0][1]) === 'Café');
  }
  check('ranges: two tokens, sorted', same(matchRanges('buy milk now', ['now', 'buy']), [[0, 3], [9, 12]]));
  check('ranges: overlapping tokens merge ("caf" + "cafe")', same(matchRanges('Café au lait', ['caf', 'cafe']), [[0, 4]]));
  check('ranges: adjacent ranges merge', same(matchRanges('abcdef', ['abc', 'def']), [[0, 6]]));
  check('ranges: overlapping occurrences of one token merge', same(matchRanges('aaa', ['aa']), [[0, 3]]));
  check('ranges: no match -> []', same(matchRanges('hello', ['xyz']), []));
  check('ranges: astral characters keep UTF-16 indices', same(matchRanges('😀 milk', ['milk']), [[3, 7]]));
  {
    const t = 'Strasse and İstanbul';
    const r = matchRanges(t, ['istanbul']);
    check('ranges: dotted capital I folds to i', r.length === 1 && t.slice(r[0][0], r[0][1]) === 'İstanbul');
  }
  {
    // Whole-string lowercasing of Greek capital sigma at word end gives a final
    // sigma; the per-code-point fold must make search and highlight agree.
    const k = knot({ items: [text('ΟΔΟΣ')] });
    const tokens = queryTokens('οδοσ');
    check('greek: search and highlight agree', knotMatches(k, tokens) === (matchRanges('ΟΔΟΣ', tokens).length > 0));
  }

  // --- matchSnippet ---
  {
    const short = knot({ items: [text('Buy milk')] });
    check('snippet: short field returned whole', matchSnippet(short, ['milk']) === 'Buy milk');
    check('snippet: no match -> null', matchSnippet(short, ['zzz']) === null);
    const long = knot({ items: [text('x'.repeat(200) + ' needle ' + 'y'.repeat(200))] });
    const s = matchSnippet(long, ['needle'], 80);
    check('snippet: long field is cut around the match', s !== null && s.includes('needle') && s.length <= 82 && s.startsWith('…') && s.endsWith('…'));
    check('snippet: ranges can be computed on the snippet itself', s !== null && matchRanges(s, ['needle']).length === 1);
    const multi = knot({ items: [text('nothing here\n\n  but   spaces')] , label: 'Supermarket' });
    check('snippet: picks the first field with a match and collapses whitespace', matchSnippet(multi, ['spaces']) === 'nothing here but spaces');
    check('snippet: falls through to a later field', matchSnippet(multi, ['market']) === 'Supermarket');
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
