// ============================================================
// e-Handkerchief — KnotsScreen
// Displays all knots in reverse-chronological order.
// ============================================================

import { knotStore } from '../knotStore.js';
import { eventBus } from '../eventBus.js';
import { navigate } from '../router.js';
import { toastService } from '../toastService.js';
import { googleMapsUrl } from '../mapsLink.js';
import { formatKnotTimestamp } from '../dateFormat.js';
import { cloudSyncService } from '../cloudSyncService.js';
import { collectTranscripts } from '../knotSummary.js';
import type { Knot, AudioMediaItem, PhotoMediaItem, VideoMediaItem, TextMediaItem } from '../types.js';

function formatCoords(lat: number, lng: number): string {
  const latStr = (lat >= 0 ? '+' : '') + lat.toFixed(5);
  const lngStr = (lng >= 0 ? '+' : '') + lng.toFixed(5);
  return `${latStr}, ${lngStr}`;
}

export function renderKnots(container: HTMLElement): () => void {
  const objUrls: string[] = [];
  let unsubscribeKnotsSaved: (() => void) | null = null;
  let unsubscribeKnotsDeleted: (() => void) | null = null;
  let unsubscribeKnotsSynced: (() => void) | null = null;

  function trackUrl(url: string): string {
    objUrls.push(url);
    return url;
  }

  const root = document.createElement('div');
  root.className = 'knots-screen';

  const titleEl = document.createElement('h1');
  titleEl.className = 'page-title';
  titleEl.textContent = 'Knots';
  root.appendChild(titleEl);

  const listEl = document.createElement('div');
  listEl.className = 'knot-list';
  root.appendChild(listEl);

  container.appendChild(root);

  function renderKnotEntry(knot: Knot): HTMLElement {
    // The entry is a div (not an anchor) so we can safely nest a
    // location <a> inside it without producing invalid nested-link HTML.
    const entry = document.createElement('div');
    entry.className = 'knot-entry';
    entry.setAttribute('role', 'link');
    entry.tabIndex = 0;

    const goToKnot = () => navigate(`#/knot/${knot.id}`);
    entry.addEventListener('click', goToKnot);
    entry.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        goToKnot();
      }
    });

    // Header row: timestamp + delete quick action
    const headerRow = document.createElement('div');
    headerRow.className = 'knot-entry-header';

    // Timestamp
    const tsEl = document.createElement('div');
    tsEl.className = 'knot-timestamp';
    tsEl.textContent = formatKnotTimestamp(knot.timestamp.localISO);
    headerRow.appendChild(tsEl);

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
    headerRow.appendChild(deleteBtn);

    entry.appendChild(headerRow);

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
      // Tapping the location should open Maps, not navigate to the knot.
      locLink.addEventListener('click', (ev) => ev.stopPropagation());
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

  async function loadAndRender(): Promise<void> {
    listEl.innerHTML = '';

    // Revoke old URLs before re-rendering
    for (const url of objUrls.splice(0)) {
      URL.revokeObjectURL(url);
    }

    const knots = await knotStore.listAll();

    if (knots.length === 0) {
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

    for (const knot of knots) {
      listEl.appendChild(renderKnotEntry(knot));
    }
  }

  void loadAndRender();

  // Subscribe to knot:saved, knot:deleted, and knots:synced to reload
  // without a route change.
  unsubscribeKnotsSaved = eventBus.on('knot:saved', () => {
    void loadAndRender();
  });
  unsubscribeKnotsDeleted = eventBus.on('knot:deleted', () => {
    void loadAndRender();
  });
  unsubscribeKnotsSynced = eventBus.on('knots:synced', () => {
    void loadAndRender();
  });

  // Cleanup
  return () => {
    unsubscribeKnotsSaved?.();
    unsubscribeKnotsDeleted?.();
    unsubscribeKnotsSynced?.();

    for (const url of objUrls) {
      URL.revokeObjectURL(url);
    }

    root.remove();
  };
}
