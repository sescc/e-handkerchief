// ============================================================
// e-Handkerchief — KnotsScreen
// Displays all knots (notes) in reverse-chronological order.
// ============================================================

import { noteStore } from '../noteStore.js';
import { eventBus } from '../eventBus.js';
import { navigate } from '../router.js';
import { toastService } from '../toastService.js';
import { googleMapsUrl } from '../mapsLink.js';
import { formatNoteTimestamp } from '../dateFormat.js';
import type { Note, AudioMediaItem, PhotoMediaItem, VideoMediaItem, TextMediaItem } from '../types.js';

function formatCoords(lat: number, lng: number): string {
  const latStr = (lat >= 0 ? '+' : '') + lat.toFixed(5);
  const lngStr = (lng >= 0 ? '+' : '') + lng.toFixed(5);
  return `${latStr}, ${lngStr}`;
}

/**
 * Gather all transcripts to display for a note.
 * Prefers per-audio-item transcripts (in media order); falls back to the
 * legacy note-level transcription for back-compat with old notes.
 */
function collectTranscripts(note: Note): string[] {
  const perItem = note.mediaItems
    .filter((m): m is AudioMediaItem => m.type === 'audio' && !!m.transcript && m.transcript.trim().length > 0)
    .map((m) => m.transcript!.trim());
  if (perItem.length > 0) return perItem;
  if (note.transcription && note.transcription.trim().length > 0) return [note.transcription.trim()];
  return [];
}

export function renderKnots(container: HTMLElement): () => void {
  const objUrls: string[] = [];
  let unsubscribeNotesSaved: (() => void) | null = null;
  let unsubscribeNotesDeleted: (() => void) | null = null;

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
  listEl.className = 'note-list';
  root.appendChild(listEl);

  container.appendChild(root);

  function renderNoteEntry(note: Note): HTMLElement {
    // The entry is a div (not an anchor) so we can safely nest a
    // location <a> inside it without producing invalid nested-link HTML.
    const entry = document.createElement('div');
    entry.className = 'note-entry';
    entry.setAttribute('role', 'link');
    entry.tabIndex = 0;

    const goToNote = () => navigate(`#/knot/${note.id}`);
    entry.addEventListener('click', goToNote);
    entry.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        goToNote();
      }
    });

    // Header row: timestamp + delete quick action
    const headerRow = document.createElement('div');
    headerRow.className = 'note-entry-header';

    // Timestamp
    const tsEl = document.createElement('div');
    tsEl.className = 'note-timestamp';
    tsEl.textContent = formatNoteTimestamp(note.timestamp.localISO);
    headerRow.appendChild(tsEl);

    // Delete quick action — must not trigger navigation
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'note-delete-btn';
    deleteBtn.textContent = '🗑';
    deleteBtn.setAttribute('aria-label', 'Delete note');
    deleteBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void (async () => {
        if (!confirm('Delete this note permanently? This cannot be undone.')) return;
        await noteStore.delete(note.id);
        eventBus.emit('note:deleted', note.id);
        toastService.show('Note deleted');
      })();
    });
    headerRow.appendChild(deleteBtn);

    entry.appendChild(headerRow);

    // Location — clickable Google Maps link
    if (note.location) {
      const locLink = document.createElement('a');
      locLink.className = 'note-location-link';
      locLink.href = googleMapsUrl(note.location);
      locLink.target = '_blank';
      locLink.rel = 'noopener noreferrer';
      locLink.textContent = note.location.resolvedAddress
        ? note.location.resolvedAddress
        : formatCoords(note.location.latitude, note.location.longitude);
      // Tapping the location should open Maps, not navigate to the note.
      locLink.addEventListener('click', (ev) => ev.stopPropagation());
      entry.appendChild(locLink);
    }

    // Media items
    const mediaWrapper = document.createElement('div');
    mediaWrapper.className = 'note-media';
    // Append the media wrapper up-front so text items inserted via
    // insertBefore(textEl, mediaWrapper) have a valid reference child.
    entry.appendChild(mediaWrapper);

    for (const item of note.mediaItems) {
      if (item.type === 'text') {
        const textItem = item as TextMediaItem;
        const textEl = document.createElement('div');
        textEl.className = 'note-text';
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
    for (const transcript of collectTranscripts(note)) {
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

    const notes = await noteStore.listAll();

    if (notes.length === 0) {
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

    for (const note of notes) {
      listEl.appendChild(renderNoteEntry(note));
    }
  }

  void loadAndRender();

  // Subscribe to note:saved and note:deleted to reload without a route change
  unsubscribeNotesSaved = eventBus.on('note:saved', () => {
    void loadAndRender();
  });
  unsubscribeNotesDeleted = eventBus.on('note:deleted', () => {
    void loadAndRender();
  });

  // Cleanup
  return () => {
    unsubscribeNotesSaved?.();
    unsubscribeNotesDeleted?.();

    for (const url of objUrls) {
      URL.revokeObjectURL(url);
    }

    root.remove();
  };
}
