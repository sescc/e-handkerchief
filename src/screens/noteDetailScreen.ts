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
import {
  mediaService,
  MediaUnsupportedError,
  FileSizeError,
  UnsupportedFormatError,
} from '../mediaService.js';
import type { AudioRecordingHandle } from '../mediaService.js';
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

    // ---- Newly added media items for this edit session ----
    const addedItems: MediaItem[] = [];
    // Object URLs for added-item previews; revoked at teardown via trackUrl and
    // on individual remove.
    let editRecording: AudioRecordingHandle | null = null;
    let isEditRecording = false;
    let editRecordElapsed = 0;

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

    // ---- Add-media controls (mic / photo / video / library) ----
    const addControls = document.createElement('div');
    addControls.className = 'media-controls';

    const micBtn = document.createElement('button');
    micBtn.className = 'btn btn-ghost';
    micBtn.setAttribute('aria-label', 'Record voice note');
    micBtn.textContent = '🎤 Mic';
    addControls.appendChild(micBtn);

    const photoBtn = document.createElement('button');
    photoBtn.className = 'btn btn-ghost';
    photoBtn.setAttribute('aria-label', 'Capture photo');
    photoBtn.textContent = '📷 Photo';
    addControls.appendChild(photoBtn);

    const videoBtn = document.createElement('button');
    videoBtn.className = 'btn btn-ghost';
    videoBtn.setAttribute('aria-label', 'Capture video');
    videoBtn.textContent = '🎬 Video';
    addControls.appendChild(videoBtn);

    const libraryBtn = document.createElement('button');
    libraryBtn.className = 'btn btn-ghost';
    libraryBtn.setAttribute('aria-label', 'Pick from library');
    libraryBtn.textContent = '🖼️ Library';
    addControls.appendChild(libraryBtn);

    contentEl.appendChild(addControls);

    // Recording indicator for edit-mode mic capture (hidden by default)
    const recIndicator = document.createElement('div');
    recIndicator.className = 'recording-indicator';
    recIndicator.style.display = 'none';
    recIndicator.innerHTML =
      '<span class="recording-dot"></span><span class="elapsed-counter">0:00</span>';
    contentEl.appendChild(recIndicator);
    const recElapsedEl = recIndicator.querySelector<HTMLElement>('.elapsed-counter');

    // Preview list for newly added items
    const addedPreviewList = document.createElement('div');
    addedPreviewList.className = 'media-preview-list';
    contentEl.appendChild(addedPreviewList);

    // Inline media-capture error message
    const mediaErrorEl = document.createElement('div');
    mediaErrorEl.className = 'error-message';
    mediaErrorEl.style.display = 'none';
    contentEl.appendChild(mediaErrorEl);

    function setEditMediaError(msg: string): void {
      mediaErrorEl.textContent = msg;
      mediaErrorEl.style.display = 'flex';
    }
    function clearEditMediaError(): void {
      mediaErrorEl.style.display = 'none';
    }

    function handleEditMediaError(err: unknown): void {
      if (err instanceof FileSizeError) {
        setEditMediaError('File exceeds the 100 MB size limit. Please choose a smaller file.');
      } else if (err instanceof UnsupportedFormatError) {
        setEditMediaError('Unsupported file format. Please use JPEG, PNG, GIF, WEBP, MP4, or MOV.');
      } else if (err instanceof MediaUnsupportedError) {
        setEditMediaError('Media capture is not supported in this browser.');
      } else if (err instanceof Error && err.message !== 'File selection cancelled') {
        setEditMediaError(`Could not capture media: ${err.message}`);
      }
      // Cancelled by user — no error message
    }

    function formatElapsed(sec: number): string {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    }

    // Renders a preview tile for a newly added item with a remove (×) button.
    function renderAddedItem(item: MediaItem, previewUrl?: string): void {
      const wrapper = document.createElement('div');
      wrapper.className = 'preview-item';

      let inner: HTMLElement;
      if (item.type === 'audio') {
        const audio = document.createElement('audio');
        audio.controls = true;
        if (previewUrl) audio.src = previewUrl;
        audio.className = 'audio-item';
        inner = audio;
      } else if (item.type === 'photo' || item.type === 'video') {
        const img = document.createElement('img');
        img.src = previewUrl ?? '';
        img.width = 80;
        img.height = 80;
        img.alt = item.type === 'photo' ? 'Photo preview' : 'Video thumbnail';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '4px';
        inner = img;
      } else {
        const txt = document.createElement('div');
        txt.textContent = 'Item';
        inner = txt;
      }
      wrapper.appendChild(inner);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.setAttribute('aria-label', 'Remove item');
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        const idx = addedItems.indexOf(item);
        if (idx !== -1) addedItems.splice(idx, 1);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        wrapper.remove();
      });
      wrapper.appendChild(removeBtn);

      addedPreviewList.appendChild(wrapper);
    }

    // ---- Mic (audio) — start/stop toggle, no live transcription here. ----
    const onEditMicClick = async (): Promise<void> => {
      clearEditMediaError();

      if (isEditRecording && editRecording) {
        editRecording.stop();
        return;
      }

      try {
        const handle = await mediaService.startAudioRecording();
        editRecording = handle;
        isEditRecording = true;
        editRecordElapsed = 0;
        micBtn.textContent = '⏹ Stop';
        recIndicator.style.display = 'flex';
        if (recElapsedEl) recElapsedEl.textContent = '0:00';

        handle.onElapsed((sec) => {
          editRecordElapsed = sec;
          if (recElapsedEl) recElapsedEl.textContent = formatElapsed(sec);
        });

        void handle.result.then((blob) => {
          isEditRecording = false;
          editRecording = null;
          micBtn.textContent = '🎤 Mic';
          recIndicator.style.display = 'none';

          const audioUrl = trackUrl(URL.createObjectURL(blob));
          const item: AudioMediaItem = {
            id: crypto.randomUUID(),
            type: 'audio',
            createdAt: Date.now(),
            blob,
            durationSeconds: editRecordElapsed,
          };
          addedItems.push(item);
          renderAddedItem(item, audioUrl);
        });
      } catch (err) {
        isEditRecording = false;
        editRecording = null;
        micBtn.textContent = '🎤 Mic';
        recIndicator.style.display = 'none';
        if (err instanceof MediaUnsupportedError) {
          setEditMediaError('Voice recording is not supported in this browser.');
        } else {
          setEditMediaError('Microphone access required. Please allow microphone permissions.');
        }
      }
    };
    micBtn.addEventListener('click', () => void onEditMicClick());

    // ---- Photo ----
    const onEditPhotoClick = async (): Promise<void> => {
      clearEditMediaError();
      try {
        const blob = await mediaService.capturePhoto();
        const thumbBlob = await mediaService.generateThumbnail(blob);
        const url = trackUrl(URL.createObjectURL(thumbBlob));
        const dims = await getImageDimensions(blob);
        const item: PhotoMediaItem = {
          id: crypto.randomUUID(),
          type: 'photo',
          createdAt: Date.now(),
          blob,
          widthPx: dims.width,
          heightPx: dims.height,
          thumbnailBlob: thumbBlob,
        };
        addedItems.push(item);
        renderAddedItem(item, url);
      } catch (err) {
        handleEditMediaError(err);
      }
    };
    photoBtn.addEventListener('click', () => void onEditPhotoClick());

    // ---- Video ----
    const onEditVideoClick = async (): Promise<void> => {
      clearEditMediaError();
      try {
        const blob = await mediaService.captureVideo();
        const thumbBlob = await mediaService.generateThumbnail(blob);
        const thumbUrl = trackUrl(URL.createObjectURL(thumbBlob));
        const item: VideoMediaItem = {
          id: crypto.randomUUID(),
          type: 'video',
          createdAt: Date.now(),
          blob,
          durationSeconds: 0,
          thumbnailBlob: thumbBlob,
        };
        addedItems.push(item);
        renderAddedItem(item, thumbUrl);
      } catch (err) {
        handleEditMediaError(err);
      }
    };
    videoBtn.addEventListener('click', () => void onEditVideoClick());

    // ---- Library ----
    const onEditLibraryClick = async (): Promise<void> => {
      clearEditMediaError();
      try {
        const blob = await mediaService.pickFromLibrary();
        const thumbBlob = await mediaService.generateThumbnail(blob);
        const thumbUrl = trackUrl(URL.createObjectURL(thumbBlob));

        if (blob.type.startsWith('image/')) {
          const dims = await getImageDimensions(blob);
          const item: PhotoMediaItem = {
            id: crypto.randomUUID(),
            type: 'photo',
            createdAt: Date.now(),
            blob,
            widthPx: dims.width,
            heightPx: dims.height,
            thumbnailBlob: thumbBlob,
          };
          addedItems.push(item);
          renderAddedItem(item, thumbUrl);
        } else {
          const item: VideoMediaItem = {
            id: crypto.randomUUID(),
            type: 'video',
            createdAt: Date.now(),
            blob,
            durationSeconds: 0,
            thumbnailBlob: thumbBlob,
          };
          addedItems.push(item);
          renderAddedItem(item, thumbUrl);
        }
      } catch (err) {
        handleEditMediaError(err);
      }
    };
    libraryBtn.addEventListener('click', () => void onEditLibraryClick());

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

      // Stop any in-progress edit-mode recording so its audio is captured.
      if (isEditRecording && editRecording) {
        editRecording.stop();
      }

      // Rebuild media items: keep non-removed non-text items, then append
      // the newly added items from this edit session.
      const keptMedia: MediaItem[] = nonTextItems.filter(
        (m) => !removedIds.has(m.id)
      );

      const newMediaItems: MediaItem[] = [...keptMedia, ...addedItems];

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

      // If a newly added audio item was attached and the note has no
      // transcription yet, mark it pending so the Transcribe affordance shows.
      const addedAudio = addedItems.some((m) => m.type === 'audio');
      if (addedAudio && !updatedNote.transcription) {
        updatedNote.transcriptionStatus = 'pending';
      }

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
    cancelBtn.addEventListener('click', () => {
      // Stop any in-progress edit-mode recording before leaving edit mode.
      if (isEditRecording && editRecording) {
        editRecording.stop();
        editRecording = null;
        isEditRecording = false;
      }
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

/** Resolve the pixel dimensions of an image Blob. */
function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}
