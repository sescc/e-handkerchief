// ============================================================
// e-Handkerchief — NoteDetailScreen
// Displays the full content of a single note by UUID.
// Fully offline — loads from local IndexedDB only.
// ============================================================

import { noteStore } from '../noteStore.js';
import { navigate } from '../router.js';
import { eventBus } from '../eventBus.js';
import { toastService } from '../toastService.js';
import { googleMapsUrl } from '../mapsLink.js';
import { formatNoteTimestamp } from '../dateFormat.js';
import type {
  Note,
  MediaItem,
  AudioMediaItem,
  PhotoMediaItem,
  VideoMediaItem,
  TextMediaItem,
} from '../types.js';

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

  // --- Header with back button (+ action buttons added once note is loaded) ---
  const headerEl = document.createElement('div');
  headerEl.className = 'note-detail-header';

  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.textContent = '← Back to Journal';
  backBtn.addEventListener('click', () => navigate('#/journal'));
  headerEl.appendChild(backBtn);

  // Container for Delete / Edit actions (shown only when a note is loaded)
  const actionsEl = document.createElement('div');
  actionsEl.className = 'note-detail-actions';
  headerEl.appendChild(actionsEl);

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

  function clearContentUrls(): void {
    for (const url of objUrls.splice(0)) {
      URL.revokeObjectURL(url);
    }
  }

  function renderLocation(note: Note, className: string): HTMLElement | null {
    if (!note.location) return null;
    const locLink = document.createElement('a');
    locLink.className = `note-location-link ${className}`;
    locLink.href = googleMapsUrl(note.location);
    locLink.target = '_blank';
    locLink.rel = 'noopener noreferrer';
    locLink.textContent = note.location.resolvedAddress
      ? note.location.resolvedAddress
      : formatCoords(note.location.latitude, note.location.longitude);
    return locLink;
  }

  function renderActions(note: Note): void {
    actionsEl.innerHTML = '';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-ghost';
    editBtn.textContent = '✏️ Edit';
    editBtn.addEventListener('click', () => renderEditMode(note));
    actionsEl.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = '🗑 Delete';
    deleteBtn.addEventListener('click', () => {
      void (async () => {
        if (!confirm('Delete this note permanently? This cannot be undone.')) return;
        await noteStore.delete(note.id);
        eventBus.emit('note:deleted', note.id);
        toastService.show('Note deleted');
        navigate('#/journal');
      })();
    });
    actionsEl.appendChild(deleteBtn);
  }

  function renderNote(note: Note): void {
    clearContentUrls();
    contentEl.innerHTML = '';
    renderActions(note);

    // Timestamp
    const tsEl = document.createElement('div');
    tsEl.className = 'note-detail-timestamp';
    tsEl.textContent = formatNoteTimestamp(note.timestamp.localISO);
    contentEl.appendChild(tsEl);

    // Location — clickable Google Maps link
    const locLink = renderLocation(note, 'note-detail-location');
    if (locLink) {
      contentEl.appendChild(locLink);
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

  function renderEditMode(note: Note): void {
    clearContentUrls();
    contentEl.innerHTML = '';
    actionsEl.innerHTML = ''; // hide view-mode actions while editing

    // Timestamp (read-only)
    const tsEl = document.createElement('div');
    tsEl.className = 'note-detail-timestamp';
    tsEl.textContent = formatNoteTimestamp(note.timestamp.localISO);
    contentEl.appendChild(tsEl);

    // Location (read-only link)
    const locLink = renderLocation(note, 'note-detail-location');
    if (locLink) {
      contentEl.appendChild(locLink);
    }

    // Text content — single editable textarea.
    // Find the existing text item (if any).
    const textItem = note.mediaItems.find(
      (m): m is TextMediaItem => m.type === 'text'
    );

    const textarea = document.createElement('textarea');
    textarea.className = 'form-textarea';
    textarea.maxLength = 2000;
    textarea.placeholder = 'Add text to this note…';
    textarea.value = textItem ? textItem.content : '';
    contentEl.appendChild(textarea);

    // Non-text media items — each with a Remove button.
    const nonTextItems = note.mediaItems.filter((m) => m.type !== 'text');
    // Track which media item ids the user has removed.
    const removedIds = new Set<string>();

    const mediaEl = document.createElement('div');
    mediaEl.className = 'note-detail-media';

    for (const item of nonTextItems) {
      const wrapper = document.createElement('div');
      wrapper.className = 'edit-media-item';

      if (item.type === 'audio') {
        const audioItem = item as AudioMediaItem;
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = trackUrl(URL.createObjectURL(audioItem.blob));
        audio.addEventListener('error', () => {
          audio.replaceWith(makeMediaUnavailable());
        });
        wrapper.appendChild(audio);
      } else if (item.type === 'photo') {
        const photoItem = item as PhotoMediaItem;
        const img = document.createElement('img');
        img.src = trackUrl(URL.createObjectURL(photoItem.blob));
        img.alt = 'Photo';
        img.style.width = '100%';
        img.style.borderRadius = '8px';
        img.addEventListener('error', () => {
          img.replaceWith(makeMediaUnavailable());
        });
        wrapper.appendChild(img);
      } else if (item.type === 'video') {
        const videoItem = item as VideoMediaItem;
        const video = document.createElement('video');
        video.controls = true;
        video.src = trackUrl(URL.createObjectURL(videoItem.blob));
        video.poster = trackUrl(URL.createObjectURL(videoItem.thumbnailBlob));
        video.style.width = '100%';
        video.style.borderRadius = '8px';
        video.addEventListener('error', () => {
          video.replaceWith(makeMediaUnavailable());
        });
        wrapper.appendChild(video);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-danger btn-sm';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        removedIds.add(item.id);
        wrapper.remove();
      });
      wrapper.appendChild(removeBtn);

      mediaEl.appendChild(wrapper);
    }

    contentEl.appendChild(mediaEl);

    // Inline error placeholder
    const errorEl = document.createElement('div');
    errorEl.className = 'validation-error';
    errorEl.style.display = 'none';
    contentEl.appendChild(errorEl);

    // Save / Cancel buttons
    const editActions = document.createElement('div');
    editActions.className = 'edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Save Changes';
    saveBtn.addEventListener('click', () => {
      const text = textarea.value.trim();

      // Rebuild media items: keep non-removed non-text items.
      const keptMedia: MediaItem[] = nonTextItems.filter(
        (m) => !removedIds.has(m.id)
      );

      const newMediaItems: MediaItem[] = [...keptMedia];

      if (text.length > 0) {
        if (textItem) {
          // Update the existing text item, preserving its id and createdAt.
          newMediaItems.unshift({
            ...textItem,
            content: text,
          });
        } else {
          // Add a fresh text item.
          const newText: TextMediaItem = {
            id: crypto.randomUUID(),
            type: 'text',
            createdAt: Date.now(),
            content: text,
          };
          newMediaItems.unshift(newText);
        }
      }
      // If text is empty, the text item is simply dropped (not re-added).

      // Validate: must still have at least one media item.
      if (newMediaItems.length === 0) {
        errorEl.textContent =
          'A note must have at least one item. Add some text or keep a media item.';
        errorEl.style.display = '';
        return;
      }

      const updatedNote: Note = {
        ...note,
        mediaItems: newMediaItems,
        updatedAt: Date.now(),
      };

      void (async () => {
        await noteStore.save(updatedNote);
        eventBus.emit('note:saved', updatedNote);
        toastService.show('Note updated');
        renderNote(updatedNote);
      })();
    });
    editActions.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => renderNote(note));
    editActions.appendChild(cancelBtn);

    contentEl.appendChild(editActions);
  }

  function renderNotFound(): void {
    clearContentUrls();
    contentEl.innerHTML = '';
    actionsEl.innerHTML = '';

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
