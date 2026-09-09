// ============================================================
// e-Handkerchief — NoteDetailScreen
// Displays the full content of a single note by UUID.
// Fully offline — loads from local IndexedDB only.
// ============================================================

import { noteStore } from '../noteStore.js';
import { navigate } from '../router.js';
import type {
  Note,
  AudioMediaItem,
  PhotoMediaItem,
  VideoMediaItem,
  TextMediaItem,
} from '../types.js';

function formatTimestamp(localISO: string): string {
  try {
    const d = new Date(localISO);
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
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

function makeMediaUnavailable(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'media-unavailable';
  div.style.width = '100%';
  div.style.minHeight = '80px';
  div.textContent = 'Media unavailable';
  return div;
}

export function renderNoteDetail(
  container: HTMLElement,
  params: Record<string, string>
): () => void {
  const objUrls: string[] = [];

  function trackUrl(url: string): string {
    objUrls.push(url);
    return url;
  }

  const root = document.createElement('div');
  root.className = 'note-detail-screen';
  container.appendChild(root);

  // --- Header with back button ---
  const headerEl = document.createElement('div');
  headerEl.className = 'note-detail-header';

  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.textContent = '← Back to Journal';
  backBtn.addEventListener('click', () => navigate('#/journal'));
  headerEl.appendChild(backBtn);

  root.appendChild(headerEl);

  // --- Content area (filled after load) ---
  const contentEl = document.createElement('div');
  root.appendChild(contentEl);

  // --- Loading indicator ---
  const loadingEl = document.createElement('div');
  loadingEl.className = 'loading-state';
  loadingEl.innerHTML = '<div class="spinner spinner--lg"></div><p>Loading note…</p>';
  contentEl.appendChild(loadingEl);

  const noteId = params['id'];

  function renderNote(note: Note): void {
    contentEl.innerHTML = '';

    // Timestamp
    const tsEl = document.createElement('div');
    tsEl.className = 'note-detail-timestamp';
    tsEl.textContent = formatTimestamp(note.timestamp.localISO);
    contentEl.appendChild(tsEl);

    // Location
    if (note.location) {
      const locEl = document.createElement('div');
      locEl.className = 'note-detail-location';
      locEl.textContent = note.location.resolvedAddress
        ? note.location.resolvedAddress
        : formatCoords(note.location.latitude, note.location.longitude);
      contentEl.appendChild(locEl);
    }

    // Media items
    const mediaEl = document.createElement('div');
    mediaEl.className = 'note-detail-media';

    for (const item of note.mediaItems) {
      if (item.type === 'text') {
        const textItem = item as TextMediaItem;
        const textEl = document.createElement('div');
        textEl.className = 'note-detail-text';
        textEl.style.whiteSpace = 'pre-wrap';
        textEl.textContent = textItem.content;
        contentEl.insertBefore(textEl, mediaEl);
      } else if (item.type === 'audio') {
        const audioItem = item as AudioMediaItem;
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = trackUrl(URL.createObjectURL(audioItem.blob));

        audio.addEventListener('error', () => {
          audio.replaceWith(makeMediaUnavailable());
        });

        mediaEl.appendChild(audio);
      } else if (item.type === 'photo') {
        const photoItem = item as PhotoMediaItem;
        const img = document.createElement('img');
        img.src = trackUrl(URL.createObjectURL(photoItem.blob)); // full resolution
        img.alt = 'Photo';
        img.style.width = '100%';
        img.style.borderRadius = '8px';
        img.style.marginBottom = '8px';

        img.addEventListener('error', () => {
          img.replaceWith(makeMediaUnavailable());
        });

        mediaEl.appendChild(img);
      } else if (item.type === 'video') {
        const videoItem = item as VideoMediaItem;
        const video = document.createElement('video');
        video.controls = true;
        video.src = trackUrl(URL.createObjectURL(videoItem.blob));
        video.poster = trackUrl(URL.createObjectURL(videoItem.thumbnailBlob));
        video.style.width = '100%';
        video.style.borderRadius = '8px';
        video.style.marginBottom = '8px';

        video.addEventListener('error', () => {
          video.replaceWith(makeMediaUnavailable());
        });

        mediaEl.appendChild(video);
      }
    }

    contentEl.appendChild(mediaEl);

    // Transcription
    if (note.transcription) {
      const transEl = document.createElement('div');
      transEl.className = 'transcription-block';
      transEl.textContent = note.transcription;
      contentEl.appendChild(transEl);
    }
  }

  function renderNotFound(): void {
    contentEl.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Note not found';
    heading.className = 'page-title';
    contentEl.appendChild(heading);

    const msg = document.createElement('p');
    msg.className = 'text-muted';
    msg.textContent = 'The requested note could not be found in local storage.';
    contentEl.appendChild(msg);

    const goBtn = document.createElement('button');
    goBtn.className = 'btn btn-primary mt-md';
    goBtn.textContent = 'Go to Journal';
    goBtn.addEventListener('click', () => navigate('#/journal'));
    contentEl.appendChild(goBtn);
  }

  if (!noteId) {
    renderNotFound();
  } else {
    noteStore.get(noteId).then((note) => {
      if (note) {
        renderNote(note);
      } else {
        renderNotFound();
      }
    }).catch(() => {
      renderNotFound();
    });
  }

  // Cleanup
  return () => {
    for (const url of objUrls) {
      URL.revokeObjectURL(url);
    }
    root.remove();
  };
}
