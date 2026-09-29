// ============================================================
// e-Handkerchief — KnotsScreen
// Displays all knots in reverse-chronological order, with per-knot check-off
// (checked-off knots fade, then leave this list at the day cutoff), an
// "edited on two devices" badge, and a select mode for sharing several knots.
// ============================================================

import { knotStore } from '../knotStore.js';
import { eventBus } from '../eventBus.js';
import { navigate } from '../router.js';
import { toastService } from '../toastService.js';
import { googleMapsUrl } from '../mapsLink.js';
import { formatKnotTimestamp } from '../dateFormat.js';
import { cloudSyncService } from '../cloudSyncService.js';
import { settingsStore } from '../settingsStore.js';
import { collectTranscripts } from '../knotSummary.js';
import { shareKnots } from '../shareService.js';
import { toggleCheckOff } from '../checkOffActions.js';
import { isCheckedOff, isCheckedOffVisible, nextCutoffAfter, resolveTimeZone } from '../dayCutoff.js';
import type { Knot, AudioMediaItem, PhotoMediaItem, VideoMediaItem, TextMediaItem } from '../types.js';

/** Longest we wait before re-checking which checked-off knots should now be hidden. */
const MAX_REFRESH_DELAY_MS = 24 * 60 * 60 * 1000;

function formatCoords(lat: number, lng: number): string {
  const latStr = (lat >= 0 ? '+' : '') + lat.toFixed(5);
  const lngStr = (lng >= 0 ? '+' : '') + lng.toFixed(5);
  return `${latStr}, ${lngStr}`;
}

export function renderKnots(container: HTMLElement): () => void {
  const objUrls: string[] = [];
  const unsubscribers: Array<() => void> = [];

  // --- Screen state ---
  /** Every knot on this device, newest first (as returned by the store). */
  let allKnots: Knot[] = [];
  /** Knots currently rendered in the list (after the check-off cutoff filter). */
  let displayedKnots: Knot[] = [];
  let conflictIds = new Set<string>();
  /** Reveal checked-off knots that are past the cutoff. */
  let showCheckedOff = false;
  let selectMode = false;
  /** Selected knot ids; survives re-renders while in select mode. */
  const selected = new Set<string>();
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against overlapping loads painting twice. */
  let loadSeq = 0;

  function trackUrl(url: string): string {
    objUrls.push(url);
    return url;
  }

  const root = document.createElement('div');
  root.className = 'knots-screen';

  // Header row: title + Select button
  const headerRow = document.createElement('div');
  headerRow.className = 'knots-header';

  const titleEl = document.createElement('h1');
  titleEl.className = 'page-title';
  titleEl.textContent = 'Knots';
  headerRow.appendChild(titleEl);

  const selectBtn = document.createElement('button');
  selectBtn.className = 'btn btn-ghost btn-sm knots-select-btn';
  selectBtn.textContent = 'Select';
  selectBtn.addEventListener('click', () => {
    selectMode = true;
    selected.clear();
    renderList();
  });
  headerRow.appendChild(selectBtn);
  root.appendChild(headerRow);

  const listEl = document.createElement('div');
  listEl.className = 'knot-list';
  root.appendChild(listEl);

  // Sticky bar shown only in select mode: Cancel + Share (N)
  const selectBar = document.createElement('div');
  selectBar.className = 'select-bar';
  selectBar.style.display = 'none';

  const cancelSelectBtn = document.createElement('button');
  cancelSelectBtn.className = 'btn btn-ghost';
  cancelSelectBtn.textContent = 'Cancel';
  cancelSelectBtn.addEventListener('click', () => exitSelectMode());
  selectBar.appendChild(cancelSelectBtn);

  const shareSelectedBtn = document.createElement('button');
  shareSelectedBtn.className = 'btn btn-primary';
  shareSelectedBtn.addEventListener('click', () => {
    // Build the list from the in-memory Knot objects and call shareKnots()
    // directly, with NO await before it, so the click's user-gesture window is
    // still open when it reaches its single navigator.share() call.
    const chosen = displayedKnots.filter((k) => selected.has(k.id));
    if (chosen.length === 0) return;
    void shareKnots(chosen);
    exitSelectMode();
  });
  selectBar.appendChild(shareSelectedBtn);
  root.appendChild(selectBar);

  container.appendChild(root);

  function exitSelectMode(): void {
    selectMode = false;
    selected.clear();
    renderList();
  }

  function updateSelectBar(): void {
    shareSelectedBtn.textContent = `Share (${selected.size})`;
    shareSelectedBtn.disabled = selected.size === 0;
  }

  function renderKnotEntry(knot: Knot): HTMLElement {
    // The entry is a div (not an anchor) so we can safely nest a
    // location <a> inside it without producing invalid nested-link HTML.
    const entry = document.createElement('div');
    entry.className = 'knot-entry';
    if (isCheckedOff(knot)) entry.classList.add('knot-entry--checked-off');
    entry.tabIndex = 0;

    let checkbox: HTMLInputElement | null = null;
    let toggleSelection: () => void = () => {};

    function setSelected(on: boolean): void {
      if (on) selected.add(knot.id);
      else selected.delete(knot.id);
      entry.classList.toggle('knot-entry--selected', on);
      if (checkbox) checkbox.checked = on;
      updateSelectBar();
    }

    if (selectMode) {
      if (selected.has(knot.id)) entry.classList.add('knot-entry--selected');
      toggleSelection = () => setSelected(!selected.has(knot.id));
      entry.addEventListener('click', (ev) => {
        // The checkbox handles its own click; avoid toggling twice.
        if (ev.target === checkbox) return;
        toggleSelection();
      });
      entry.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          toggleSelection();
        }
      });
    } else {

      entry.setAttribute('role', 'link');
      const goToKnot = () => navigate(`#/knot/${knot.id}`);
      entry.addEventListener('click', goToKnot);
      entry.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          goToKnot();
        }
      });
    }

    // Header row: [checkbox] timestamp + check-off / delete quick actions
    const entryHeader = document.createElement('div');
    entryHeader.className = 'knot-entry-header';

    if (selectMode) {
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'knot-select-checkbox';
      checkbox.checked = selected.has(knot.id);
      checkbox.setAttribute('aria-label', 'Select knot');
      checkbox.addEventListener('change', () => toggleSelection());

      entryHeader.appendChild(checkbox);
    }

    // Timestamp
    const tsEl = document.createElement('div');
    tsEl.className = 'knot-timestamp';
    tsEl.textContent = formatKnotTimestamp(knot.timestamp.localISO);
    entryHeader.appendChild(tsEl);

    if (!selectMode) {
      const actions = document.createElement('div');
      actions.className = 'knot-entry-actions';

      // Check-off quick action — must not trigger navigation
      const checked = isCheckedOff(knot);
      const checkBtn = document.createElement('button');
      checkBtn.className = 'knot-check-btn';
      checkBtn.textContent = checked ? '↩' : '✓';
      checkBtn.setAttribute('aria-label', checked ? 'Uncheck knot' : 'Check off knot');
      checkBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void toggleCheckOff(knot.id).catch((err) => {
          console.warn('Check-off failed:', err);
          toastService.show('Could not save — please try again');
        });
      });
      actions.appendChild(checkBtn);

      // Delete quick action — must not trigger navigation
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'knot-delete-btn';
      deleteBtn.textContent = '🗑';
      deleteBtn.setAttribute('aria-label', 'Delete knot');
      deleteBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void (async () => {
          if (!confirm(cloudSyncService.localDeleteConfirmText())) return;
          await knotStore.delete(knot.id);
          eventBus.emit('knot:deleted', knot.id);
          toastService.show('Knot deleted');
        })();
      });
      actions.appendChild(deleteBtn);

      entryHeader.appendChild(actions);
    }

    entry.appendChild(entryHeader);

    // Conflict badge — this knot was edited on another device too
    if (!selectMode && conflictIds.has(knot.id)) {
      const badge = document.createElement('button');
      badge.className = 'conflict-badge';
      badge.textContent = '⚠ Also edited on another device';
      badge.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        navigate(`#/conflict/${knot.id}`);
      });
      entry.appendChild(badge);
    }

    // Location — clickable Google Maps link
    if (knot.location) {
      const locLink = document.createElement('a');
      locLink.className = 'knot-location-link';
      locLink.href = googleMapsUrl(knot.location);
      locLink.target = '_blank';
      locLink.rel = 'noopener noreferrer';
      locLink.textContent = knot.location.resolvedAddress
        ? knot.location.resolvedAddress
        : formatCoords(knot.location.latitude, knot.location.longitude);
      // Tapping the location should open Maps, not navigate to the knot. In
      // select mode a tap selects the knot instead (the link is not followed).
      locLink.addEventListener('click', (ev) => {
        if (selectMode) {
          ev.preventDefault();
        } else {
          ev.stopPropagation();
        }
      });
      entry.appendChild(locLink);
    } else if (knot.manualLabel && knot.manualLabel.trim()) {
      // No GPS — render the manual label as plain text (not a link). Clicking
      // it bubbles to the entry and navigates to the knot, which is fine.
      const locPlain = document.createElement('div');
      locPlain.className = 'knot-location-link knot-location-link--plain';
      locPlain.textContent = knot.manualLabel;
      entry.appendChild(locPlain);
    }

    // Media items
    const mediaWrapper = document.createElement('div');
    mediaWrapper.className = 'knot-media';
    // Append the media wrapper up-front so text items inserted via
    // insertBefore(textEl, mediaWrapper) have a valid reference child.
    entry.appendChild(mediaWrapper);

    for (const item of knot.mediaItems) {
      if (item.type === 'text') {
        const textItem = item as TextMediaItem;
        const textEl = document.createElement('div');
        textEl.className = 'knot-text';
        textEl.style.whiteSpace = 'pre-wrap';
        textEl.textContent = textItem.content; // safe — never innerHTML
        entry.insertBefore(textEl, mediaWrapper);
      } else if (item.type === 'audio') {
        const audioItem = item as AudioMediaItem;
        const audioWrapper = document.createElement('div');
        audioWrapper.className = 'audio-item';

        const audio = document.createElement('audio');
        audio.controls = true;
        const audioUrl = trackUrl(URL.createObjectURL(audioItem.blob));
        audio.src = audioUrl;
        // Prevent the media control clicks from bubbling to the entry.
        audioWrapper.addEventListener('click', (ev) => ev.stopPropagation());

        audio.addEventListener('error', () => {
          const placeholder = makeMediaUnavailable();
          audioWrapper.replaceWith(placeholder);
        });

        audioWrapper.appendChild(audio);
        mediaWrapper.appendChild(audioWrapper);
      } else if (item.type === 'photo') {
        const photoItem = item as PhotoMediaItem;
        const photoWrapper = document.createElement('div');
        photoWrapper.className = 'photo-item';

        const img = document.createElement('img');
        const thumbUrl = trackUrl(URL.createObjectURL(photoItem.thumbnailBlob));
        img.src = thumbUrl;
        img.width = 80;
        img.height = 80;
        img.alt = 'Photo';
        img.style.objectFit = 'cover';

        img.addEventListener('error', () => {
          const placeholder = makeMediaUnavailable();
          photoWrapper.replaceWith(placeholder);
        });

        photoWrapper.appendChild(img);
        mediaWrapper.appendChild(photoWrapper);
      } else if (item.type === 'video') {
        const videoItem = item as VideoMediaItem;
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-item';

        const video = document.createElement('video');
        video.controls = true;
        const videoUrl = trackUrl(URL.createObjectURL(videoItem.blob));
        video.src = videoUrl;
        const posterUrl = trackUrl(URL.createObjectURL(videoItem.thumbnailBlob));
        video.poster = posterUrl;
        video.style.width = '80px';
        video.style.height = '80px';
        video.style.objectFit = 'cover';
        // Prevent the media control clicks from bubbling to the entry.
        videoWrapper.addEventListener('click', (ev) => ev.stopPropagation());

        video.addEventListener('error', () => {
          const placeholder = makeMediaUnavailable();
          videoWrapper.replaceWith(placeholder);
        });

        videoWrapper.appendChild(video);
        mediaWrapper.appendChild(videoWrapper);
      }
    }

    // Transcriptions (per-audio-item, with legacy fallback)
    for (const transcript of collectTranscripts(knot)) {
      const transEl = document.createElement('div');
      transEl.className = 'transcription-block';
      transEl.textContent = transcript;
      entry.appendChild(transEl);
    }

    return entry;
  }

  function makeMediaUnavailable(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'media-unavailable';
    div.textContent = 'Media unavailable';
    return div;
  }

  /**
   * Paint the list from the in-memory `allKnots` (synchronous). Applies the
   * check-off cutoff, keeps the selection, and schedules the next automatic
   * re-check for when a currently visible checked-off knot will hide.
   */
  function renderList(): void {
    listEl.innerHTML = '';

    // Revoke old URLs before re-rendering
    for (const url of objUrls.splice(0)) {
      URL.revokeObjectURL(url);
    }
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }

    root.classList.toggle('knots-screen--select', selectMode);
    selectBar.style.display = selectMode ? 'flex' : 'none';

    if (allKnots.length === 0) {
      displayedKnots = [];
      selectMode = false;
      selectBar.style.display = 'none';
      root.classList.remove('knots-screen--select');
      selectBtn.style.display = 'none';

      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';

      const icon = document.createElement('div');
      icon.className = 'empty-state-icon';
      icon.textContent = '🪢';
      emptyState.appendChild(icon);

      const msg = document.createElement('p');
      msg.textContent = 'No knots yet — tap + to tie your first.';
      emptyState.appendChild(msg);

      listEl.appendChild(emptyState);
      return;
    }

    const s = settingsStore.getCurrent();
    const tz = resolveTimeZone(s.timezone);
    const now = Date.now();

    const hiddenCheckedOff: Knot[] = [];
    const visible: Knot[] = [];
    let earliestHide = Infinity;
    for (const k of allKnots) {
      if (isCheckedOffVisible(k.checkedOffAt, now, s.dayCutoff, tz)) {
        visible.push(k);
        if (isCheckedOff(k)) {
          earliestHide = Math.min(earliestHide, nextCutoffAfter(k.checkedOffAt as number, s.dayCutoff, tz));
        }
      } else {
        hiddenCheckedOff.push(k);
      }
    }

    // Re-render when the earliest visible checked-off knot passes its cutoff.
    if (Number.isFinite(earliestHide)) {
      const delay = Math.min(Math.max(earliestHide - now, 0) + 500, MAX_REFRESH_DELAY_MS);
      refreshTimer = setTimeout(() => renderList(), delay);
    }

    displayedKnots = showCheckedOff ? allKnots : visible;

    // Keep only selections that are still on screen.
    for (const id of [...selected]) {
      if (!displayedKnots.some((k) => k.id === id)) selected.delete(id);
    }
    updateSelectBar();
    selectBtn.style.display = selectMode || displayedKnots.length === 0 ? 'none' : '';

    if (displayedKnots.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      const msg = document.createElement('p');
      msg.textContent = 'All your knots are checked off.';
      emptyState.appendChild(msg);
      listEl.appendChild(emptyState);
    }

    for (const knot of displayedKnots) {
      listEl.appendChild(renderKnotEntry(knot));
    }

    // Show / hide toggle for checked-off knots past the cutoff
    if (hiddenCheckedOff.length > 0) {
      const toggle = document.createElement('button');
      toggle.className = 'btn btn-ghost btn-full knots-checked-toggle';
      const n = hiddenCheckedOff.length;
      toggle.textContent = showCheckedOff
        ? 'Hide checked-off knots'
        : `Show ${n} checked-off knot${n === 1 ? '' : 's'}`;
      toggle.addEventListener('click', () => {
        showCheckedOff = !showCheckedOff;
        renderList();
      });
      listEl.appendChild(toggle);
    }
  }

  async function loadAndRender(): Promise<void> {
    const seq = ++loadSeq;
    let knots: Knot[];
    let conflicts: Array<{ knotId: string }> = [];
    try {
      knots = await knotStore.listAll();
    } catch (err) {
      console.warn('Could not load knots:', err);
      return;
    }
    try {
      conflicts = await cloudSyncService.listConflicts();
    } catch {
      /* no conflict info available — render without badges */
    }
    // A newer load started while we were awaiting: let it paint instead.
    if (seq !== loadSeq) return;

    allKnots = knots;
    conflictIds = new Set(conflicts.map((c) => c.knotId));
    renderList();
  }

  void loadAndRender();

  // Reload without a route change on any change to the knots.
  const reload = (): void => {
    void loadAndRender();
  };
  unsubscribers.push(eventBus.on('knot:saved', reload));
  unsubscribers.push(eventBus.on('knot:deleted', reload));
  unsubscribers.push(eventBus.on('knots:synced', reload));
  unsubscribers.push(eventBus.on('knot:checkedOff', reload));
  // 'knots:conflicts' can fire several times per sync: it is current state,
  // so just reload the badges.
  unsubscribers.push(eventBus.on('knots:conflicts', reload));

  // Coming back to the app may be after a cutoff — re-check what to show.
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') void loadAndRender();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Cleanup
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }

    for (const url of objUrls) {
      URL.revokeObjectURL(url);
    }

    root.remove();
  };
}
