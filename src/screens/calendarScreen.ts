// ============================================================
// e-Handkerchief — CalendarScreen
// Scrollable monthly view (reverse-chronological) with per-day
// knot-count dots. Tapping a day with knots opens an inline
// day-detail panel listing that day's knots.
// ============================================================

import { knotStore } from '../knotStore.js';
import { eventBus } from '../eventBus.js';
import { navigate } from '../router.js';
import { settingsStore } from '../settingsStore.js';
import { formatKnotTime } from '../dateFormat.js';
import { isCheckedOff } from '../dayCutoff.js';
import { summarizeMedia, describeMediaSummary } from '../mediaSummary.js';
import type { MediaSummaryEntry } from '../mediaSummary.js';
import { searchState } from '../searchState.js';
import { queryTokens, searchKnots, matchRanges, matchSnippet } from '../knotSearch.js';
import { createSearchRow } from '../components/searchRow.js';
import { appendHighlightedText } from '../components/searchHighlight.js';
import type { Knot } from '../types.js';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Resolve the configured timezone, or undefined for the device default. */
function resolveTimeZone(): string | undefined {
  const tz = settingsStore.getCurrent().timezone;
  return tz && tz !== 'auto' ? tz : undefined;
}

/**
 * Format a Date into a YYYY-MM-DD string in the given timezone using the
 * en-CA locale (which renders ISO-style YYYY-MM-DD).
 */
function localDayKey(date: Date, tz: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  let y = '1970';
  let m = '01';
  let d = '01';
  for (const p of parts) {
    if (p.type === 'year') y = p.value;
    else if (p.type === 'month') m = p.value;
    else if (p.type === 'day') d = p.value;
  }
  return `${y}-${m}-${d}`;
}

/** Build a YYYY-MM-DD key from numeric year/month(1-12)/day. */
function dayKeyFromYMD(year: number, month1: number, day: number): string {
  const m = String(month1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/**
 * Short one-line preview for a knot in the day-detail list. `content` is true
 * when the text is the knot's own text (searchable/highlightable) rather than
 * a "🎤 Voice" style placeholder.
 */
function knotPreview(knot: Knot): { text: string; content: boolean } {
  const firstText = knot.mediaItems.find((m) => m.type === 'text');
  if (firstText && firstText.type === 'text') {
    const content = firstText.content.trim();
    if (content) {
      return { text: content.length > 60 ? content.slice(0, 60) + '…' : content, content: true };
    }
  }
  const hasAudio = knot.mediaItems.some((m) => m.type === 'audio');
  if (hasAudio) return { text: '🎤 Voice', content: false };
  const hasPhoto = knot.mediaItems.some((m) => m.type === 'photo');
  if (hasPhoto) return { text: '📷 Photo', content: false };
  const hasVideo = knot.mediaItems.some((m) => m.type === 'video');
  if (hasVideo) return { text: '🎬 Video', content: false };
  return { text: '(empty)', content: false };
}

/** The day key of a knot in the configured zone, or null for an unreadable timestamp. */
function knotDayKey(knot: Knot, tz: string | undefined): string | null {
  const d = new Date(knot.timestamp.localISO);
  return isNaN(d.getTime()) ? null : localDayKey(d, tz);
}

export function renderCalendar(container: HTMLElement): () => void {
  let unsubscribeSaved: (() => void) | null = null;
  let unsubscribeDeleted: (() => void) | null = null;
  let unsubscribeSynced: (() => void) | null = null;
  let unsubscribeCheckedOff: (() => void) | null = null;

  const root = document.createElement('div');
  root.className = 'calendar-screen';

  // Header: title on the left, 🔍 on the right; the field row sits under it.
  const headerRow = document.createElement('div');
  headerRow.className = 'calendar-header';

  const titleEl = document.createElement('h1');
  titleEl.className = 'page-title';
  titleEl.textContent = 'Calendar';
  headerRow.appendChild(titleEl);

  const search = createSearchRow({ buttonClass: 'calendar-search-btn' });
  headerRow.appendChild(search.button);
  root.appendChild(headerRow);
  root.appendChild(search.row);

  // "N matches on M days" with ‹ › to step through the matching days. Shown
  // only while a search is active; sticky so the buttons stay reachable.
  const infoRow = document.createElement('div');
  infoRow.className = 'calendar-search-info';
  infoRow.hidden = true;

  const infoText = document.createElement('span');
  infoText.className = 'calendar-search-info-text';
  infoText.setAttribute('role', 'status');
  infoRow.appendChild(infoText);

  const prevMatchBtn = document.createElement('button');
  prevMatchBtn.type = 'button';
  prevMatchBtn.className = 'btn btn-ghost btn-sm calendar-match-nav';
  prevMatchBtn.textContent = '‹';
  prevMatchBtn.setAttribute('aria-label', 'Previous match');
  infoRow.appendChild(prevMatchBtn);

  const nextMatchBtn = document.createElement('button');
  nextMatchBtn.type = 'button';
  nextMatchBtn.className = 'btn btn-ghost btn-sm calendar-match-nav';
  nextMatchBtn.textContent = '›';
  nextMatchBtn.setAttribute('aria-label', 'Next match');
  infoRow.appendChild(nextMatchBtn);

  root.appendChild(infoRow);

  const monthsEl = document.createElement('div');
  monthsEl.className = 'calendar-months';
  root.appendChild(monthsEl);

  // Inline day-detail panel (created/replaced on day tap).
  const detailEl = document.createElement('div');
  detailEl.className = 'calendar-day-detail-container';
  root.appendChild(detailEl);

  container.appendChild(root);

  // Track the currently open day so re-tapping the same day toggles it closed.
  let openDayKey: string | null = null;
  let allKnots: Knot[] = [];

  // --- Search state (recomputed by paint() from allKnots + the shared query) ---
  /** Words of the active search (empty = no search). */
  let searchWords: string[] = [];
  /** Ids of the knots that match the active search. */
  let matchIds = new Set<string>();
  /** Matching knots per day key. */
  let matchesByDay = new Map<string, Knot[]>();
  /** Days with a match, newest first (the order the months are laid out in). */
  let matchDayKeys: string[] = [];
  /** The day the ‹ › buttons last jumped to; null until the first jump. */
  let currentMatchDay: string | null = null;

  // Object URLs created for the open day panel's thumbnails; all are revoked
  // whenever the panel is re-rendered, cleared, or the screen is torn down.
  let panelUrls: string[] = [];

  function clearPanelUrls(): void {
    for (const u of panelUrls) URL.revokeObjectURL(u);
    panelUrls = [];
  }

  /** Neutral tile with an emoji, used when a thumbnail image fails to load. */
  function fillFallback(tile: HTMLElement, emoji: string): void {
    tile.textContent = '';
    tile.classList.add('calendar-thumb--fallback');
    const glyph = document.createElement('span');
    glyph.className = 'calendar-thumb-glyph';
    glyph.textContent = emoji;
    tile.appendChild(glyph);
  }

  function buildThumbImage(tile: HTMLElement, blob: Blob, emoji: string): void {
    const url = URL.createObjectURL(blob);
    panelUrls.push(url);
    const img = document.createElement('img');
    img.className = 'calendar-thumb-img';
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => fillFallback(tile, emoji));
    img.src = url;
    tile.appendChild(img);
  }

  /** One 40x40 tile for a media type (photo / video / audio). */
  function buildThumbTile(entry: MediaSummaryEntry): HTMLElement {
    const tile = document.createElement('span');
    tile.className = `calendar-thumb calendar-thumb--${entry.type}`;

    const first = entry.first;
    if (entry.type === 'photo' && first.type === 'photo') {
      // Full photo blob: the stored 80x80 thumbnails may be squashed.
      buildThumbImage(tile, first.blob, '📷');
    } else if (entry.type === 'video' && first.type === 'video') {
      buildThumbImage(tile, first.thumbnailBlob, '🎬');
      const play = document.createElement('span');
      play.className = 'calendar-thumb-play';
      play.textContent = '▶';
      tile.appendChild(play);
    } else {
      const play = document.createElement('span');
      play.className = 'calendar-thumb-play calendar-thumb-play--plain';
      play.textContent = '▶';
      tile.appendChild(play);
    }

    if (entry.count > 1) {
      const badge = document.createElement('span');
      badge.className = 'calendar-thumb-count';
      badge.textContent = String(entry.count);
      tile.appendChild(badge);
    }
    return tile;
  }

  function renderDayDetail(dayKey: string, tz: string | undefined): void {
    clearPanelUrls();
    detailEl.innerHTML = '';

    // Knots on this day, newest first (listAll already returns newest first).
    let dayKnots = allKnots.filter((n) => knotDayKey(n, tz) === dayKey);
    if (dayKnots.length === 0) return;
    // A day with matches lists only its matching knots; any other day lists all.
    if (searchWords.length > 0 && matchesByDay.has(dayKey)) {
      dayKnots = dayKnots.filter((n) => matchIds.has(n.id));
    }

    const panel = document.createElement('div');
    panel.className = 'calendar-day-detail';

    const header = document.createElement('div');
    header.className = 'calendar-day-detail-header';
    // Use the first knot's formatted timestamp to derive a friendly date label
    // is imprecise; build a readable label from the day key instead.
    header.textContent = `Knots on ${friendlyDayLabel(dayKey)}`;
    panel.appendChild(header);

    for (const knot of dayKnots) {
      const row = document.createElement('div');
      row.className = 'calendar-day-detail-row';
      // Checked-off knots stay in the Calendar (never hidden), just faded.
      if (isCheckedOff(knot)) row.classList.add('calendar-day-detail-row--checked-off');
      row.setAttribute('role', 'link');
      row.tabIndex = 0;

      const textCol = document.createElement('div');
      textCol.className = 'calendar-day-detail-text';

      // Time only, inline before the preview: the date is in the panel header.
      const previewEl = document.createElement('div');
      previewEl.className = 'calendar-day-detail-preview';
      const timeEl = document.createElement('span');
      timeEl.className = 'calendar-day-detail-time';
      timeEl.textContent = `${formatKnotTime(knot.timestamp.localISO)} ·`;
      previewEl.appendChild(timeEl);
      // Highlight only knots that match the search, and only the text actually
      // shown (ranges are computed on the exact preview string). Text nodes +
      // <mark> via DOM APIs — never innerHTML.
      const words = matchIds.has(knot.id) ? searchWords : [];
      const preview = knotPreview(knot);
      appendHighlightedText(previewEl, preview.text, preview.content ? words : []);
      textCol.appendChild(previewEl);

      // The match may be in a later text item, a transcript or the place:
      // when the preview shows no highlight, add a short excerpt that does.
      if (words.length > 0 && !(preview.content && matchRanges(preview.text, words).length > 0)) {
        const snippet = matchSnippet(knot, words);
        if (snippet) {
          const snippetEl = document.createElement('div');
          snippetEl.className = 'calendar-day-detail-snippet';
          appendHighlightedText(snippetEl, snippet, words);
          textCol.appendChild(snippetEl);
        }
      }

      row.appendChild(textCol);

      const mediaEntries = summarizeMedia(knot.mediaItems);
      if (mediaEntries.length > 0) {
        const sr = document.createElement('span');
        sr.className = 'sr-only';
        sr.textContent = describeMediaSummary(mediaEntries);
        textCol.appendChild(sr);

        const thumbs = document.createElement('div');
        thumbs.className = 'calendar-day-detail-thumbs';
        thumbs.setAttribute('aria-hidden', 'true');
        for (const entry of mediaEntries) thumbs.appendChild(buildThumbTile(entry));
        row.appendChild(thumbs);
      }

      const go = () => navigate(`#/knot/${knot.id}`);
      row.addEventListener('click', go);
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          go();
        }
      });

      panel.appendChild(row);
    }

    detailEl.appendChild(panel);
  }

  /** Build a human-friendly label like "09 Sep 2026" from a YYYY-MM-DD key. */
  function friendlyDayLabel(dayKey: string): string {
    const [y, m, d] = dayKey.split('-').map((v) => parseInt(v, 10));
    const monthsShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mmm = monthsShort[(m - 1)] ?? '';
    return `${String(d).padStart(2, '0')} ${mmm} ${y}`;
  }

  function renderMonth(
    year: number,
    month0: number, // 0-11
    counts: Map<string, number>,
    todayKey: string,
    tz: string | undefined
  ): HTMLElement {
    const block = document.createElement('div');
    block.className = 'calendar-month';

    const headerEl = document.createElement('div');
    headerEl.className = 'calendar-month-header';
    headerEl.textContent = new Intl.DateTimeFormat(undefined, {
      month: 'long',
      year: 'numeric',
    }).format(new Date(year, month0, 1));
    block.appendChild(headerEl);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    // Weekday header row (Sunday-first).
    for (const label of WEEKDAY_LABELS) {
      const wd = document.createElement('div');
      wd.className = 'calendar-weekday';
      wd.textContent = label;
      grid.appendChild(wd);
    }

    // Leading blanks for the offset of the 1st (0=Sun..6=Sat).
    const firstDow = new Date(year, month0, 1).getDay();
    for (let i = 0; i < firstDow; i++) {
      const blank = document.createElement('div');
      blank.className = 'calendar-day calendar-day--empty';
      grid.appendChild(blank);
    }

    const daysInMonth = new Date(year, month0 + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const key = dayKeyFromYMD(year, month0 + 1, day);
      const count = counts.get(key) ?? 0;

      const cell = document.createElement('div');
      cell.className = 'calendar-day';
      if (key === todayKey) cell.classList.add('calendar-day--today');

      const num = document.createElement('div');
      num.className = 'calendar-day-num';
      num.textContent = String(day);
      cell.appendChild(num);

      if (count > 0) {
        cell.classList.add('calendar-day--has-knots');
        cell.dataset.dayKey = key;
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        let label = `${friendlyDayLabel(key)} — ${count} knot${count === 1 ? '' : 's'}`;
        if (searchWords.length > 0) {
          const matched = matchesByDay.get(key)?.length ?? 0;
          if (matched > 0) {
            cell.classList.add('calendar-day--match');
            if (key === currentMatchDay) cell.classList.add('calendar-day--current');
            label += `, ${matched} match${matched === 1 ? '' : 'es'}`;
          } else {
            cell.classList.add('calendar-day--dim');
          }
        }
        cell.setAttribute('aria-label', label);

        if (count <= 4) {
          const dots = document.createElement('div');
          dots.className = 'calendar-dots';
          for (let i = 0; i < count; i++) {
            const dot = document.createElement('span');
            dot.className = 'calendar-dot';
            dots.appendChild(dot);
          }
          cell.appendChild(dots);
        } else {
          const badge = document.createElement('div');
          badge.className = 'calendar-count-badge';
          badge.textContent = String(count);
          cell.appendChild(badge);
        }

        const onTap = () => {
          if (openDayKey === key) {
            // Toggle closed.
            openDayKey = null;
            clearPanelUrls();
            detailEl.innerHTML = '';
          } else {
            openDayKey = key;
            renderDayDetail(key, tz);
            detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
          // Keep the ‹ › cursor on the day the user last looked at.
          if (openDayKey === key && matchesByDay.has(key)) markCurrentCell(key);
        };
        cell.addEventListener('click', onTap);
        cell.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            onTap();
          }
        });
      }

      grid.appendChild(cell);
    }

    block.appendChild(grid);
    return block;
  }

  /** Move the "current match" outline to `dayKey` (null = none) without re-rendering the months. */
  function markCurrentCell(dayKey: string | null): void {
    currentMatchDay = dayKey;
    for (const el of monthsEl.querySelectorAll<HTMLElement>('.calendar-day--current')) {
      el.classList.remove('calendar-day--current');
    }
    if (dayKey === null) return;
    for (const el of monthsEl.querySelectorAll<HTMLElement>('.calendar-day--match')) {
      if (el.dataset.dayKey === dayKey) el.classList.add('calendar-day--current');
    }
  }

  /**
   * ‹ (-1) and › (+1): step through the matching days in page order (the
   * months are laid out newest first, so › goes down the page to an older
   * day). Wraps around. Always OPENS the day (a tap would toggle it closed),
   * marks its cell, and scrolls to the day's panel, which sits below the months.
   */
  function jumpToMatch(dir: 1 | -1): void {
    const n = matchDayKeys.length;
    if (n === 0) return;
    let idx = currentMatchDay === null ? -1 : matchDayKeys.indexOf(currentMatchDay);
    idx = idx === -1 ? (dir === 1 ? 0 : n - 1) : (idx + dir + n) % n;
    const key = matchDayKeys[idx];
    openDayKey = key;
    markCurrentCell(key);
    renderDayDetail(key, resolveTimeZone());
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  prevMatchBtn.addEventListener('click', () => jumpToMatch(-1));
  nextMatchBtn.addEventListener('click', () => jumpToMatch(1));

  /** Fetch the knots, then paint. */
  async function loadAndRender(): Promise<void> {
    allKnots = await knotStore.listAll();
    paint();
  }

  /** Paint months, search state and the open day from the in-memory `allKnots` (synchronous). */
  function paint(): void {
    const tz = resolveTimeZone();

    // --- Search: which knots/days match the shared query ---
    const query = searchState.get();
    const results = searchKnots(allKnots, query);
    searchWords = results ? queryTokens(query) : [];
    matchIds = new Set((results ?? []).map((k) => k.id));
    matchesByDay = new Map();
    for (const k of results ?? []) {
      const dk = knotDayKey(k, tz);
      if (dk === null) continue;
      const list = matchesByDay.get(dk);
      if (list) list.push(k);
      else matchesByDay.set(dk, [k]);
    }
    matchDayKeys = [...matchesByDay.keys()].sort().reverse();
    if (currentMatchDay !== null && !matchesByDay.has(currentMatchDay)) currentMatchDay = null;

    infoRow.hidden = results === null;
    if (results !== null) {
      const n = results.length;
      const d = matchDayKeys.length;
      infoText.textContent =
        n === 0 ? 'No matches' : `${n} match${n === 1 ? '' : 'es'} on ${d} day${d === 1 ? '' : 's'}`;
      prevMatchBtn.disabled = d === 0;
      nextMatchBtn.disabled = d === 0;
    }

    // Build per-day counts keyed by YYYY-MM-DD in the configured timezone.
    const counts = new Map<string, number>();
    let earliest: Date | null = null;
    for (const knot of allKnots) {
      const d = new Date(knot.timestamp.localISO);
      if (isNaN(d.getTime())) continue;
      const key = localDayKey(d, tz);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!earliest || d.getTime() < earliest.getTime()) earliest = d;
    }

    const now = new Date();
    const todayKey = localDayKey(now, tz);

    // Determine the month range: earliest knot's month → current month.
    // Months rendered most-recent-first (reverse chronological).
    const currentYear = now.getFullYear();
    const currentMonth0 = now.getMonth();

    let startYear = currentYear;
    let startMonth0 = currentMonth0;
    if (earliest) {
      startYear = earliest.getFullYear();
      startMonth0 = earliest.getMonth();
    }

    // Collect months from start → current (chronological), then reverse.
    const months: Array<{ year: number; month0: number }> = [];
    let y = startYear;
    let m = startMonth0;
    // Guard against pathological ranges.
    let safety = 0;
    while ((y < currentYear || (y === currentYear && m <= currentMonth0)) && safety < 1200) {
      months.push({ year: y, month0: m });
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      safety += 1;
    }
    if (months.length === 0) {
      months.push({ year: currentYear, month0: currentMonth0 });
    }
    months.reverse();

    monthsEl.innerHTML = '';
    for (const { year, month0 } of months) {
      monthsEl.appendChild(renderMonth(year, month0, counts, todayKey, tz));
    }

    // Refresh the open day-detail panel (if any) against new data.
    if (openDayKey) {
      renderDayDetail(openDayKey, tz); // revokes the previous panel's URLs
    } else {
      clearPanelUrls();
    }
  }

  void loadAndRender();

  unsubscribeSaved = eventBus.on('knot:saved', () => {
    void loadAndRender();
  });
  unsubscribeDeleted = eventBus.on('knot:deleted', () => {
    void loadAndRender();
  });
  unsubscribeSynced = eventBus.on('knots:synced', () => {
    void loadAndRender();
  });
  unsubscribeCheckedOff = eventBus.on('knot:checkedOff', () => {
    void loadAndRender();
  });
  // The shared query changed (here or on the Knots screen): restart the ‹ ›
  // cursor and repaint from memory (no reload from the store).
  const unsubscribeSearch = searchState.subscribe(() => {
    currentMatchDay = null;
    paint();
  });

  // Cleanup
  return () => {
    unsubscribeSearch();
    search.destroy();
    unsubscribeSaved?.();
    unsubscribeDeleted?.();
    unsubscribeSynced?.();
    unsubscribeCheckedOff?.();
    clearPanelUrls();
    root.remove();
    container.innerHTML = '';
  };
}
