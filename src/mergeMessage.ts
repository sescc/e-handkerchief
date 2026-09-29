// ============================================================
// e-Handkerchief — mergeMessage
// Pure wording for the toast shown after "Merge with Cloud". No DOM and
// no imports, so it runs under plain node in its chartest.
// ============================================================

/**
 * Build the toast text for a finished merge.
 *
 * - Nothing to report: "Already up to date — nothing to merge".
 * - Otherwise "Merged — " followed by the non-zero parts joined by ", ":
 *   "N knot(s) brought in", "N backed up", "N need(s) review".
 *
 * @param pulled Knots brought in from Drive.
 * @param pushed Knots backed up to Drive.
 * @param conflicts Knots currently awaiting conflict review.
 */
export function mergeResultMessage(pulled: number, pushed: number, conflicts: number): string {
  if (pulled === 0 && pushed === 0 && conflicts === 0) {
    return 'Already up to date — nothing to merge';
  }
  const parts: string[] = [];
  if (pulled > 0) parts.push(`${pulled} ${pulled === 1 ? 'knot' : 'knots'} brought in`);
  if (pushed > 0) parts.push(`${pushed} backed up`);
  if (conflicts > 0) parts.push(`${conflicts} ${conflicts === 1 ? 'needs' : 'need'} review`);
  return `Merged — ${parts.join(', ')}`;
}
