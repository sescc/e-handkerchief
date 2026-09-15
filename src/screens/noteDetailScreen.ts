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
import { remoteTranscribe } from '../remoteTranscribe.js';
import { settingsStore } from '../settingsStore.js';
import { renderMediaCapture } from '../components/mediaCapture.js';
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
    // Append up-front so text items inserted via insertBefore(textEl, mediaEl)
    // have a valid reference child.
    contentEl.appendChild(mediaEl);

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

    // Transcription
    if (note.transcription) {
      const transEl = document.createElement('div');
      transEl.className = 'transcription-block';
      transEl.textContent = note.transcription;
      contentEl.appendChild(transEl);
    }

    // Transcribe affordance — only when there's audio and no transcript yet
    // (or the note is explicitly pending/failed).
    const audioItem = note.mediaItems.find(
      (m): m is AudioMediaItem => m.type === 'audio'
    );
    const needsTranscribe =
      !!audioItem &&
      (note.transcriptionStatus === 'pending' ||
        note.transcriptionStatus === 'failed' ||
        !note.transcription);
    if (audioItem && needsTranscribe) {
      const panel = document.createElement('div');
      panel.className = 'transcribe-panel';

      const statusLine = document.createElement('div');
      statusLine.className = 'transcribe-status settings-row-desc';
      statusLine.textContent =
        note.transcriptionStatus === 'failed'
          ? 'Last transcription attempt failed.'
          : 'Voice not yet transcribed.';
      panel.appendChild(statusLine);

      const transcribeBtn = document.createElement('button');
      transcribeBtn.className = 'btn btn-ghost';
      transcribeBtn.textContent = '🎧 Transcribe voice';
      transcribeBtn.addEventListener('click', () => {
        void (async () => {
          if (!settingsStore.getCurrent().transcriptionServerUrl.trim()) {
            toastService.show('Set a transcription server URL in Settings first.');
            return;
          }
          if (!navigator.onLine) {
            toastService.show('No internet connection — try again later.');
            return;
          }

          transcribeBtn.disabled = true;
          transcribeBtn.textContent = 'Transcribing…';

          const result = await remoteTranscribe(audioItem.blob);
          if (result.ok && result.text !== undefined) {
            note.transcription = result.text;
            note.transcriptionStatus = 'done';
            note.updatedAt = Date.now();
            await noteStore.save(note);
            eventBus.emit('note:saved', note);
            toastService.show('Transcription added');
            renderNote(note);
          } else {
            note.transcriptionStatus = 'failed';
            note.updatedAt = Date.now();
            await noteStore.save(note);
            eventBus.emit('note:saved', note);
            toastService.show(result.error ?? 'Transcription failed');
            transcribeBtn.disabled = false;
            transcribeBtn.textContent = '🎧 Transcribe voice';
          }
        })();
      });
      panel.appendChild(transcribeBtn);

      contentEl.appendChild(panel);
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

    // Existing (non-text) media items — each with a Remove button. This shows
    // the note's EXISTING media and is edit-specific.
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

    // ---- Add-new-media UI via the shared component (mic/photo/video/library +
    //      previews + live transcript + errors). Behaves identically to the
    //      new-note capture screen. ----
    const addMountEl = document.createElement('div');
    contentEl.appendChild(addMountEl);
    const mediaCapture = renderMediaCapture(addMountEl);

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
      void (async () => {
        const text = textarea.value.trim();

        // Stop any in-progress recording so its audio is captured before we
        // snapshot the captured items.
        await mediaCapture.finalizePendingRecording();
        const captured = mediaCapture.getCaptured();

        // Rebuild media items: keep non-removed existing non-text items, then
        // append the newly captured items from this edit session.
        const keptMedia: MediaItem[] = nonTextItems.filter(
          (m) => !removedIds.has(m.id)
        );

        const newMediaItems: MediaItem[] = [...keptMedia, ...captured.items];

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

        // If live transcription produced text for a newly captured recording and
        // the note has no transcription yet, attach it as a live transcript.
        const addedAudio = captured.items.some((m) => m.type === 'audio');
        if (captured.transcript && !updatedNote.transcription) {
          updatedNote.transcription = captured.transcript;
          updatedNote.transcriptionStatus = 'live';
        } else if (addedAudio && !updatedNote.transcription) {
          // A newly added audio item exists but there's no transcript yet —
          // mark it pending so the Transcribe affordance shows.
          updatedNote.transcriptionStatus = 'pending';
        }

        mediaCapture.destroy();

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
    cancelBtn.addEventListener('click', () => {
      // Tear down the media capture component (stops recording/recognition,
      // revokes object URLs) before leaving edit mode.
      mediaCapture.destroy();
      renderNote(note);
    });
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
