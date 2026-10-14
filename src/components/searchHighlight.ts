// ============================================================
// e-Handkerchief — searchHighlight
// Renders text with the search matches wrapped in <mark>. Knot text is user
// content (and arrives through sync), so this builds Text nodes and <mark>
// elements with DOM APIs only — never innerHTML.
// ============================================================

import { matchRanges } from '../knotSearch.js';

/**
 * Replace the contents of `el` with `text`, wrapping every part that matches a
 * token (from `queryTokens`) in a <mark>. With no tokens it is plain text.
 */
export function setHighlightedText(el: HTMLElement, text: string, tokens: string[]): void {
  el.textContent = '';
  appendHighlightedText(el, text, tokens);
}

/** Like `setHighlightedText` but appends to whatever `parent` already holds. */
export function appendHighlightedText(parent: HTMLElement, text: string, tokens: string[]): void {
  const ranges = tokens.length > 0 ? matchRanges(text, tokens) : [];
  if (ranges.length === 0) {
    parent.appendChild(document.createTextNode(text));
    return;
  }
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start > pos) parent.appendChild(document.createTextNode(text.slice(pos, start)));
    const mark = document.createElement('mark');
    mark.className = 'search-mark';
    mark.textContent = text.slice(start, end);
    parent.appendChild(mark);
    pos = end;
  }
  if (pos < text.length) parent.appendChild(document.createTextNode(text.slice(pos)));
}
