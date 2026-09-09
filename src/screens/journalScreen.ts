// ============================================================
// e-Handkerchief — JournalScreen
// Displays all notes in reverse-chronological order.
// ============================================================

import { noteStore } from '../noteStore.js';
import { eventBus } from '../eventBus.js';
import type { Note, AudioMediaItem, PhotoMediaItem, VideoMediaItem, TextMediaItem } from '../types.js';

function formatTimestamp(localISO: string): string {
  try {
    const d = new Date(localISO);
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return localISO;
  }
}

function formatCoords(lat: number, lng: number): string {
  const latStr = (lat >= 0 ? '+' : '') + lat.toFixed(5);
  const lngStr = (lng >= 0 ? '+' : '') + lng.toFixed(5);
  return `${latStr}, ${lngStr}`;
}

export function renderJournal(container: HTMLElement): () => void {
  const objUrls: string[] = [];
  let unsubscribeNotesSaved: (() => void) | null = null;

  function trackUrl(url: string): string {
    objUrls.push(url);
    return url;
  }

  const root = document.createElement('div');
  root.className = 'journal-screen';

  const titleEl = document.createElement('h1');
  titleEl.className = 'page-title';
  titleEl.textContent = 'Journal';
  root.appendChild(titleEl);

  const listEl = document.createElement('div');
  listEl.className = 'note-list';
  root.appendChild(listEl);

  container.appendChild(root);

  function renderNoteEntry(note: Note): HTMLElement {
    // Outer link wrapping the whole entry
    const link = document.createElement('a');
    link.href = `#/note/${note.id}`;
    link.className = 'note-entry';

    // Timestamp
    const tsEl = document.createElement('div');
    tsEl.className = 'note-timestamp';
    tsEl.textContent = formatTimestamp(note.timestamp.localISO);
    link.appendChild(tsEl);

    // Location
    if (note.location) {
      const locEl = document.createElement('div');
      locEl.className = 'note-location';
      locEl.textContent = note.location.resolvedAddress
        ? note.location.resolvedAddress
        : formatCoords(note.location.latitude, note.location.longitude);
      link.appendChild(locEl);
    }

    // Media items
    const mediaWrapper = document.createElement('div');
    mediaWrapper.className = 'note-media';

    for (const item of note.mediaItems) {
      if (item.type === 'text') {
        const textItem = item as TextMediaItem;
        const textEl = document.createElement('div');
        textEl.className = 'note-text';
        textEl.style.whiteSpace = 'pre-wrap';
        textEl.textContent = textItem.content; // safe — never innerHTML
        link.insertBefore(textEl, mediaWrapper);
      } else if (item.type === 'audio') {
        const audioItem = item as AudioMediaItem;
        const audioWrapper = document.createElement('div');
        audioWrapper.className = 'audio-item';

        const audio = document.createElement('audio');
        audio.controls = true;
        const audioUrl = trackUrl(URL.createObjectURL(audioItem.blob));
        audio.src = audioUrl;

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

        video.addEventListener('error', () => {
          const placeholder = makeMediaUnavailable();
          videoWrapper.replaceWith(placeholder);
        });

        videoWrapper.appendChild(video);
        mediaWrapper.appendChild(videoWrapper);
      }
    }

    link.appendChild(mediaWrapper);

    // Transcription (if present)
    if (note.transcription) {
      const transEl = document.createElement('div');
      transEl.className = 'transcription-block';
      transEl.textContent = note.transcription;
      link.appendChild(transEl);
    }

    return link;
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
      icon.textContent = '📓';
      emptyState.appendChild(icon);

      const msg = document.createElement('p');
      msg.textContent = 'No notes yet — tap + to capture your first.';
      emptyState.appendChild(msg);

      listEl.appendChild(emptyState);
      return;
    }

    for (const note of notes) {
      listEl.appendChild(renderNoteEntry(note));
    }
  }

  void loadAndRender();

  // Subscribe to note:saved to reload without a route change
  unsubscribeNotesSaved = eventBus.on('note:saved', () => {
    void loadAndRender();
  });

  // Cleanup
  return () => {
    unsubscribeNotesSaved?.();

    for (const url of objUrls) {
      URL.revokeObjectURL(url);
    }

    root.remove();
  };
}
