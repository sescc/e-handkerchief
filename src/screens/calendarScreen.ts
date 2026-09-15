// ============================================================
// e-Handkerchief — CalendarScreen
// Scrollable monthly view (reverse-chronological) with per-day
// knot-count dots. Tapping a day with knots opens an inline
// day-detail panel listing that day's knots.
// ============================================================

import { noteStore } from '../noteStore.js';
import { eventBus } from '../eventBus.js';
import { navigate } from '../router.js';
import { settingsStore } from '../settingsStore.js';
import { formatNoteTimestamp } from '../dateFormat.js';
import type { Note } from '../types.js';

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

/** Short one-line preview for a note in the day-detail list. */
function notePreview(note: Note): string {
  const firstText = note.mediaItems.find((m) => m.type === 'text');
  if (firstText && firstText.type === 'text') {
    const content = firstText.content.trim();
    if (content) {
      return content.length > 60 ? content.slice(0, 60) + '…' : content;
    }
  }
  const hasAudio = note.mediaItems.some((m) => m.type === 'audio');
  if (hasAudio) return '🎤 Voice';
  const hasPhoto = note.mediaItems.some((m) => m.type === 'photo');
  if (hasPhoto) return '📷 Photo';
  const hasVideo = note.mediaItems.some((m) => m.type === 'video');
  if (hasVideo) return '🎬 Video';
  return '(empty)';
}

export function renderCalendar(container: HTMLElement): () => void {
  let unsubscribeSaved: (() => void) | null = null;
  let unsubscribeDeleted: (() => void) | null = null;

  const root = document.createElement('div');
  root.className = 'calendar-screen';

  const titleEl = document.createElement('h1');
  titleEl.className = 'page-title';
  titleEl.textContent = 'Calendar';
  root.appendChild(titleEl);

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
  let allNotes: Note[] = [];

  function renderDayDetail(dayKey: string, tz: string | undefined): void {
    detailEl.innerHTML = '';

    // Notes on this day, newest first (listAll already returns newest first).
    const dayNotes = allNotes.filter(
      (n) => localDayKey(new Date(n.timestamp.localISO), tz) === dayKey
    );
    if (dayNotes.length === 0) return;

    const panel = document.createElement('div');
    panel.className = 'calendar-day-detail';

    const header = document.createElement('div');
    header.className = 'calendar-day-detail-header';
    // Use the first note's formatted timestamp to derive a friendly date label
    // is imprecise; build a readable label from the day key instead.
    header.textContent = `Knots on ${friendlyDayLabel(dayKey)}`;
    panel.appendChild(header);

    for (const note of dayNotes) {
      const row = document.createElement('div');
      row.className = 'calendar-day-detail-row';
      row.setAttribute('role', 'link');
      row.tabIndex = 0;

      const timeEl = document.createElement('div');
      timeEl.className = 'calendar-day-detail-time';
      timeEl.textContent = formatNoteTimestamp(note.timestamp.localISO);
      row.appendChild(timeEl);

      const previewEl = document.createElement('div');
      previewEl.className = 'calendar-day-detail-preview';
      previewEl.textContent = notePreview(note);
      row.appendChild(previewEl);

      const go = () => navigate(`#/note/${note.id}`);
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
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        cell.setAttribute(
          'aria-label',
          `${friendlyDayLabel(key)} — ${count} knot${count === 1 ? '' : 's'}`
        );

        const dots = document.createElement('div');
        dots.className = 'calendar-dots';
        const dotCount = Math.min(count, 3);
        for (let i = 0; i < dotCount; i++) {
          const dot = document.createElement('span');
          dot.className = 'calendar-dot';
          dots.appendChild(dot);
        }
        cell.appendChild(dots);

        const onTap = () => {
          if (openDayKey === key) {
            // Toggle closed.
            openDayKey = null;
            detailEl.innerHTML = '';
          } else {
            openDayKey = key;
            renderDayDetail(key, tz);
            detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
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

  async function loadAndRender(): Promise<void> {
    const tz = resolveTimeZone();
    allNotes = await noteStore.listAll();

    // Build per-day counts keyed by YYYY-MM-DD in the configured timezone.
    const counts = new Map<string, number>();
    let earliest: Date | null = null;
    for (const note of allNotes) {
      const d = new Date(note.timestamp.localISO);
      if (isNaN(d.getTime())) continue;
      const key = localDayKey(d, tz);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!earliest || d.getTime() < earliest.getTime()) earliest = d;
    }

    const now = new Date();
    const todayKey = localDayKey(now, tz);

    // Determine the month range: earliest note's month → current month.
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
      renderDayDetail(openDayKey, tz);
    }
  }

  void loadAndRender();

  unsubscribeSaved = eventBus.on('note:saved', () => {
    void loadAndRender();
  });
  unsubscribeDeleted = eventBus.on('note:deleted', () => {
    void loadAndRender();
  });

  // Cleanup
  return () => {
    unsubscribeSaved?.();
    unsubscribeDeleted?.();
    root.remove();
    container.innerHTML = '';
  };
}
