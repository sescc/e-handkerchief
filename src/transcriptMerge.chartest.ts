// ============================================================
// e-Handkerchief — transcriptMerge
// Characterization/behaviour test for `appendSegment` / `mergeFinalPieces`
// (pure, runs under plain node). Compile with tsc, then
// `node ./src/transcriptMerge.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { appendSegment, foldSegment, mergeFinalPieces } from './transcriptMerge.js';

let failureCount = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failureCount++;
    console.error(`FAIL  ${label}${detail ? `  -> ${detail}` : ''}`);
  }
}

function eq(label: string, actual: string, expected: string): void {
  check(label, actual === expected, `expected "${expected}", got "${actual}"`);
}

function main(): void {
  console.log('Characterization test: transcriptMerge');

  // --- mergeFinalPieces ---------------------------------------------------
  eq('strict cumulative', mergeFinalPieces(['1', '1 2', '1 2 3']), '1 2 3');
  eq('positional distinct segments', mergeFinalPieces(['Hello', 'world']), 'Hello world');
  eq(
    'positional multi-word segments',
    mergeFinalPieces(['turn on the light', 'please']),
    'turn on the light please',
  );
  eq(
    'revised word mid-sentence (cumulative revision)',
    mergeFinalPieces(['I wanna go', 'I want to go to the shop']),
    'I want to go to the shop',
  );
  eq(
    'revision at the end',
    mergeFinalPieces(['see you at the park', 'see you at the parking lot']),
    'see you at the parking lot',
  );
  eq(
    'multiple revisions in one sequence',
    mergeFinalPieces([
      'I wanna go',
      'I want to go to the shop',
      'I want to go to the shop and buy bred',
      'I want to go to the shop and buy bread today',
    ]),
    'I want to go to the shop and buy bread today',
  );
  eq('empty pieces dropped', mergeFinalPieces(['', '  ', 'hi', '', 'hi there']), 'hi there');
  eq('no pieces', mergeFinalPieces([]), '');
  eq('repeats inside one piece unchanged', mergeFinalPieces(['very very good']), 'very very good');

  // --- appendSegment ------------------------------------------------------
  eq('empty acc', appendSegment('', 'hello'), 'hello');
  eq('empty next', appendSegment('hello', '  '), 'hello');
  eq('both empty', appendSegment('', ''), '');

  // Restart re-delivery.
  eq('restart re-delivery exact', appendSegment('buy milk and eggs', 'milk and eggs'), 'buy milk and eggs');
  eq('restart re-delivery of whole acc', appendSegment('buy milk', 'buy milk'), 'buy milk');
  eq(
    'restart partial overlap',
    appendSegment('buy milk and eggs', 'and eggs then bread'),
    'buy milk and eggs then bread',
  );

  // Deliberate repeats are kept.
  eq('single-word repeat across boundary kept', appendSegment('I said no', 'no thanks'), 'I said no no thanks');
  eq('repeated single word then new text', appendSegment('I said very much', 'very good'), 'I said very much very good');

  // Case / punctuation differences.
  eq(
    'case and punctuation ignored when comparing, next text emitted',
    appendSegment('Hello, world.', 'hello world how are you'),
    'hello world how are you',
  );
  eq(
    'case and punctuation: stale shorter next keeps acc text',
    appendSegment('Hello, world. How are you', 'hello world'),
    'Hello, world. How are you',
  );
  eq('apostrophes kept inside words', appendSegment("I don't know", "don't know why"), "I don't know why");

  // Unrelated / tail-revision on a long acc.
  eq(
    'long acc with a short unrelated next',
    appendSegment('I went to the store and bought apples', 'see you later'),
    'I went to the store and bought apples see you later',
  );
  // l=1 of m=2 is below ceil(0.6*m)=2, so a short tail with most words changed
  // is appended rather than revised (losing text is worse than a repeat).
  eq(
    'short tail mostly changed is appended, not revised',
    appendSegment('I went to the store and bought apples', 'bought oranges and pears'),
    'I went to the store and bought apples bought oranges and pears',
  );
  eq(
    'short next revises only the tail of a long acc (enough overlap)',
    appendSegment('I went to the store and bought red apples', 'bought red oranges and pears'),
    'I went to the store and bought red oranges and pears',
  );
  eq(
    'equal-length new sentence sharing 60% is appended',
    appendSegment('I need to buy milk', 'I need to call mom'),
    'I need to buy milk I need to call mom',
  );
  eq('equal-length near-identical re-say revises', appendSegment('I went to the stor', 'I went to the store'), 'I went to the store');
  eq(
    'known edge: equal-length 80% overlap revises',
    appendSegment('I went to the store', 'I went to the park'),
    'I went to the park',
  );
  eq('shorter next never revises', appendSegment('I went to the store', 'I went to'), 'I went to the store');

  // --- foldSegment (across recognition instances: never revises) ----------
  eq('fold: new sentence with same start keeps both', foldSegment('I need to buy milk', 'I need to call mom'), 'I need to buy milk I need to call mom');
  eq('fold: exact re-delivery adds nothing', foldSegment('buy milk and eggs', 'milk and eggs'), 'buy milk and eggs');
  eq('fold: whole re-delivery adds nothing', foldSegment('buy milk', 'buy milk'), 'buy milk');
  eq('fold: cumulative growth takes next', foldSegment('buy milk', 'buy milk and eggs'), 'buy milk and eggs');
  eq('fold: 2-word overlap merges', foldSegment('buy milk and eggs', 'and eggs then bread'), 'buy milk and eggs then bread');
  eq('fold: 1-word overlap kept', foldSegment('I said no', 'no thanks'), 'I said no no thanks');
  eq('fold: does not revise a changed tail', foldSegment('I went to the store and bought apples', 'bought oranges and pears'), 'I went to the store and bought apples bought oranges and pears');
  eq('fold: empty acc', foldSegment('', 'hello there'), 'hello there');
  eq('fold: empty next', foldSegment('hello there', ''), 'hello there');
  eq(
    'prefers the shorter tail among equal scores',
    appendSegment('the dog the dog', 'the dog barked'),
    'the dog the dog barked',
  );
  eq(
    'prefers the best-scoring tail (whole sentence revised)',
    appendSegment('the cat sat on the mat', 'the cat sat on a mat today'),
    'the cat sat on a mat today',
  );
  eq(
    'best-scoring tail when an earlier anchor matches weakly',
    appendSegment('yesterday I went home and I went to bed', 'I went to bed early'),
    'yesterday I went home and I went to bed early',
  );

  // Known limitation (documented): a deliberate 2+ word repeat collapses.
  eq('known limitation: "thank you" + "thank you" collapses', appendSegment('thank you', 'thank you'), 'thank you');

  if (failureCount > 0) {
    console.error(`\n${failureCount} case(s) failed.`);
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll cases passed.');
  }
}

main();
