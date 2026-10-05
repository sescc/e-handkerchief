// ============================================================
// e-Handkerchief — transcriptMerge
// Pure text-merging helpers for live speech recognition (no DOM/window, so
// they run under plain node). Android Chrome delivers cumulative finals and,
// when the user speaks fast, REVISES earlier words inside them
// (["I wanna go", "I want to go to the shop"]); after an auto-restart a new
// recognition instance may also re-deliver all or part of the previous tail.
// Joining such pieces naively duplicates words, so every join goes through
// `appendSegment`, which compares on normalised WORDS but emits original text.
// ============================================================

interface Word {
  /** The word as delivered (used for output). */
  raw: string;
  /** Lowercased, punctuation stripped (apostrophes inside words kept) — comparison only. */
  norm: string;
}

/** Split into words; tokens that are pure punctuation are dropped. */
function tokenize(s: string): Word[] {
  const out: Word[] = [];
  for (const raw of s.trim().split(/\s+/)) {
    if (!raw) continue;
    const norm = raw
      .toLowerCase()
      .replace(/’/g, "'")
      .replace(/[^\p{L}\p{N}']/gu, '')
      .replace(/^'+|'+$/g, '');
    if (norm) out.push({ raw, norm });
  }
  return out;
}

const render = (words: Word[]): string => words.map((w) => w.raw).join(' ');

/** Does `a` start with all of `b` (normalised word comparison)? */
function startsWithWords(a: Word[], b: Word[]): boolean {
  if (b.length > a.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i]!.norm !== b[i]!.norm) return false;
  return true;
}

/** Does `a` end with all of `b` (normalised word comparison)? */
function endsWithWords(a: Word[], b: Word[]): boolean {
  if (b.length > a.length) return false;
  const off = a.length - b.length;
  for (let i = 0; i < b.length; i++) if (a[off + i]!.norm !== b[i]!.norm) return false;
  return true;
}

/** Length of the longest common subsequence (in-order word overlap) of two word lists. */
function lcsLength(a: Word[], b: Word[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] =
        a[i - 1]!.norm === b[j - 1]!.norm
          ? prev[j - 1]! + 1
          : Math.max(prev[j]!, cur[j - 1]!);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Rules shared by both merges: empty side, cumulative growth, stale /
 * re-delivered. Returns the result, or null when none of them applies.
 */
function trivialMerge(a: Word[], n: Word[]): string | null {
  // Empty side -> the other.
  if (a.length === 0) return render(n);
  if (n.length === 0) return render(a);
  // `next` starts with all of `acc` -> `next` (cumulative growth).
  if (startsWithWords(n, a)) return render(n);
  // `acc` starts or ends with all of `next` -> `acc` (stale / re-delivered).
  if (startsWithWords(a, n) || endsWithWords(a, n)) return render(a);
  return null;
}

/** Largest k >= 2 where acc's last k words equal next's first k words, else 0. */
function exactOverlap(a: Word[], n: Word[]): number {
  for (let k = Math.min(a.length, n.length); k >= 2; k--) {
    if (endsWithWords(a, n.slice(0, k))) return k;
  }
  return 0;
}

/**
 * Conservative join for text from DIFFERENT recognition instances (a fresh
 * session after a silence restart): never revises, so a new sentence that
 * merely starts like the previous one ("I need to buy milk" then "I need to
 * call mom") is never lost. Rules: empty side / cumulative growth / stale or
 * re-delivered (as `appendSegment`); an exact word-level suffix/prefix overlap
 * of k >= 2 words is merged ("buy milk and eggs" + "and eggs then bread");
 * otherwise a plain append. A 1-word overlap is kept ("no" + "no thanks").
 * Known limitation: a deliberate 2+ word repeat across the boundary collapses.
 */
export function foldSegment(acc: string, next: string): string {
  const a = tokenize(acc);
  const n = tokenize(next);
  const trivial = trivialMerge(a, n);
  if (trivial !== null) return trivial;
  const k = exactOverlap(a, n);
  if (k >= 2) return render([...a, ...n.slice(k)]);
  return render([...a, ...n]);
}

/**
 * Join text from the SAME recognition instance (its cumulative finals), where
 * the engine may revise earlier words. Compares normalised words; output uses
 * the original text, single-spaced.
 *
 * Rules, in order:
 *  1. Empty side -> the other.
 *  2. `next` starts with all of `acc` -> `next` (cumulative growth).
 *  3. `acc` starts or ends with all of `next` -> `acc` (stale / re-delivered).
 *  4. Revision: `next` re-says the TAIL of `acc` with some words changed.
 *     Candidate tails are acc[s..] where acc[s] equals next's first word and
 *     the tail has m >= 2 words (a 1-word tail never merges, so "no" +
 *     "no thanks" survives). With l = LCS(tail, first min(len(next), m+2)
 *     words of next), a candidate is valid only if l >= ceil(0.6*m) AND
 *       - next is strictly longer than the tail (growth plus revision), or
 *       - next is the same length and l >= 0.8*m (a near-identical re-say);
 *     a shorter next never revises. If l == 1 (only the anchor matched) next
 *     must also be longer than the tail (redundant at m >= 2, kept as a guard).
 *     The valid candidate with the best score (2*l - m) wins, ties going to
 *     the SHORTER tail (least deletion); the tail is replaced by `next`.
 *     Exact suffix/prefix overlaps ("buy milk and eggs" + "and eggs then
 *     bread") are the exact-match case of this rule.
 *  5. Otherwise -> acc + ' ' + next.
 *
 * Known limitations: a deliberate 2+ word repeat across a boundary
 * ("thank you" + "thank you") collapses; an equal-length next that re-says
 * 80%+ of the tail is treated as a revision ("I went to the store" then
 * "I went to the park" keeps only the second); a revision that changes the
 * FIRST word of the revised tail ("wanna go" -> "I want to go") is not
 * detected unless the tail starts at a matching word; a short next that
 * changes most of a short tail ("bought apples" -> "bought oranges and
 * pears", l=1 of m=2) is appended, not revised.
 * Use `foldSegment` across recognition instances instead of this.
 */
export function appendSegment(acc: string, next: string): string {
  const a = tokenize(acc);
  const n = tokenize(next);
  const trivial = trivialMerge(a, n);
  if (trivial !== null) return trivial;

  // Rule 4
  let bestStart = -1;
  let bestScore = -Infinity;
  for (let s = 0; s <= a.length - 2; s++) {
    if (a[s]!.norm !== n[0]!.norm) continue;
    const tail = a.slice(s);
    const m = tail.length;
    const l = lcsLength(tail, n.slice(0, Math.min(n.length, m + 2)));
    if (l < Math.ceil(0.6 * m)) continue;
    const longer = n.length > m;
    if (!longer && !(n.length === m && l >= 0.8 * m)) continue;
    if (l === 1 && !longer) continue;
    const score = 2 * l - m;
    // Ascending s: '>=' lets a later (shorter) tail win ties.
    if (score >= bestScore) {
      bestScore = score;
      bestStart = s;
    }
  }
  if (bestStart >= 0) return render([...a.slice(0, bestStart), ...n]);

  // Rule 5
  return render([...a, ...n]);
}
/**
 * Merge the FINAL pieces of one recognition instance (index order) into one
 * transcript: trims pieces, drops empties, folds left with `appendSegment`.
 * ["1","1 2","1 2 3"] -> "1 2 3"; ["Hello","world"] -> "Hello world".
 */
export function mergeFinalPieces(pieces: string[]): string {
  let acc = '';
  for (const piece of pieces) {
    const p = piece.trim();
    if (!p) continue;
    acc = appendSegment(acc, p);
  }
  return acc;
}
