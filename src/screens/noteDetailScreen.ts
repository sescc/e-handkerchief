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
  backBtn.textContent = '← Back to Knots';
  backBtn.addEventListener('click', () => navigate('#/knots'));
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
    if (note.location) {
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
    // No GPS coordinates — render the manual label as plain text (no map link).
    if (note.manualLabel && note.manualLabel.trim().length > 0) {
      const locPlain = document.createElement('div');
      locPlain.className = `note-location-link note-location-link--plain ${className}`;
      locPlain.textContent = note.manualLabel;
      return locPlain;
    }
    return null;
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
        navigate('#/knots');
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

    note.mediaItems.forEach((item, index) => {
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

        // Per-audio transcription sub-panel beneath THIS player.
        mediaEl.appendChild(renderAudioTranscribePanel(note, audioItem, index));
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
    });

    // Legacy edge case: an old note carrying a note-level transcription but no
    // audio item at all. Show it read-only so nothing is lost. (When audio
    // exists, the legacy transcript is surfaced via the first audio item's
    // per-item panel instead — see renderAudioTranscribePanel.)
    const hasAudio = note.mediaItems.some((m) => m.type === 'audio');
    if (note.transcription && !hasAudio) {
      const transEl = document.createElement('div');
      transEl.className = 'transcription-block';
      transEl.textContent = note.transcription;
      contentEl.appendChild(transEl);
    }
  }

  /**
   * Build the per-audio-item transcription sub-panel shown beneath a specific
   * audio player. Each audio item carries its own transcript + status and can
   * be transcribed, re-transcribed, or hand-edited independently.
   *
   * Backward compat: if this item has no per-item transcript but the note has a
   * legacy note-level `transcription` AND this is the first audio item, that
   * legacy text is used as the initial editable value. It's promoted to the
   * per-item transcript the moment the user saves an edit or (re-)transcribes.
   */
  function renderAudioTranscribePanel(
    note: Note,
    audioItem: AudioMediaItem,
    index: number
  ): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'transcribe-item-panel';

    // Determine whether an earlier audio item precedes this one, so the legacy
    // note-level transcript only backfills the FIRST audio item.
    const isFirstAudio =
      note.mediaItems.findIndex((m) => m.type === 'audio') === index;

    // Effective transcript for display: prefer the per-item transcript; else
    // fall back to the legacy note-level transcript for the first audio item.
    const legacyFallback =
      !audioItem.transcript && isFirstAudio && note.transcription
        ? note.transcription
        : '';
    const effectiveTranscript = audioItem.transcript ?? legacyFallback;

    /** Shared remote-transcribe action for both Transcribe and Re-transcribe. */
    function runTranscribe(btn: HTMLButtonElement, isRetry: boolean): void {
      void (async () => {
        if (!settingsStore.getCurrent().transcriptionServerUrl.trim()) {
          toastService.show('Set a transcription server URL in Settings first.');
          return;
        }
        if (!navigator.onLine) {
          toastService.show('No internet connection — try again later.');
          return;
        }

        btn.disabled = true;
        btn.textContent = 'Transcribing…';

        const result = await remoteTranscribe(audioItem.blob);
        if (result.ok && result.text !== undefined) {
          audioItem.transcript = (result.text ?? '').trim();
          audioItem.transcriptionStatus = 'done';
          note.updatedAt = Date.now();
          await noteStore.save(note);
          eventBus.emit('note:saved', note);
          toastService.show(isRetry ? 'Re-transcribed' : 'Transcription added');
          renderNote(note);
        } else {
          audioItem.transcriptionStatus = 'failed';
          note.updatedAt = Date.now();
          await noteStore.save(note);
          eventBus.emit('note:saved', note);
          toastService.show(result.error ?? 'Transcription failed');
          btn.disabled = false;
          btn.textContent = isRetry ? '🎧 Re-transcribe' : '🎧 Transcribe voice';
        }
      })();
    }

    if (effectiveTranscript) {
      // Editable transcript + Save transcript + Re-transcribe.
      const textarea = document.createElement('textarea');
      textarea.className = 'transcript-edit';
      textarea.maxLength = 5000;
      textarea.value = effectiveTranscript;
      panel.appendChild(textarea);

      const actions = document.createElement('div');
      actions.className = 'transcribe-actions';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-ghost btn-sm';
      saveBtn.textContent = 'Save transcript';
      saveBtn.addEventListener('click', () => {
        void (async () => {
          audioItem.transcript = textarea.value.trim();
          audioItem.transcriptionStatus = 'done';
          note.updatedAt = Date.now();
          await noteStore.save(note);
          eventBus.emit('note:saved', note);
          toastService.show('Transcript saved');
          renderNote(note);
        })();
      });
      actions.appendChild(saveBtn);

      const retranscribeBtn = document.createElement('button');
      retranscribeBtn.className = 'btn btn-ghost btn-sm';
      retranscribeBtn.textContent = '🎧 Re-transcribe';
      retranscribeBtn.addEventListener('click', () =>
        runTranscribe(retranscribeBtn, true)
      );
      actions.appendChild(retranscribeBtn);

      panel.appendChild(actions);
    } else {
      // No transcript yet — status line + Transcribe button.
      const statusLine = document.createElement('div');
      statusLine.className = 'transcribe-status settings-row-desc';
      statusLine.textContent =
        audioItem.transcriptionStatus === 'failed'
          ? 'Last transcription attempt failed.'
          : 'Voice not yet transcribed.';
      panel.appendChild(statusLine);

      const actions = document.createElement('div');
      actions.className = 'transcribe-actions';

      const transcribeBtn = document.createElement('button');
      transcribeBtn.className = 'btn btn-ghost btn-sm';
      transcribeBtn.textContent = '🎧 Transcribe voice';
      transcribeBtn.addEventListener('click', () =>
        runTranscribe(transcribeBtn, false)
      );
      actions.appendChild(transcribeBtn);

      panel.appendChild(actions);
    }

    return panel;
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

    // Location label — editable display text. Only shown when the note has
    // coordinates. Editing the label never touches lat/lng, so the view-mode
    // Google Maps link still points to the original GPS coordinates.
    let locationInput: HTMLInputElement | undefined;
    {
      const locGroup = document.createElement('div');
      locGroup.className = 'form-group';

      const locLabel = document.createElement('label');
      locLabel.className = 'form-label';
      locLabel.textContent = 'Location label';
      locGroup.appendChild(locLabel);

      locationInput = document.createElement('input');
      locationInput.type = 'text';
      locationInput.className = 'form-input';
      locationInput.maxLength = 120;

      const locHelp = document.createElement('div');
      locHelp.className = 'settings-row-desc';

      if (note.location) {
        const lat = note.location.latitude;
        const lng = note.location.longitude;
        locationInput.value =
          note.location.resolvedAddress ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        locHelp.textContent = `Shown on the knot. The map link still points to the original GPS coordinates. Map pin: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      } else {
        locationInput.value = note.manualLabel ?? '';
        locationInput.placeholder = "e.g. Grandma's house";
        locHelp.textContent =
          'No GPS coordinates detected for this knot. Label location manually.';
      }

      locGroup.appendChild(locationInput);
      locGroup.appendChild(locHelp);

      contentEl.appendChild(locGroup);
    }

    // Text content — one editable textarea PER existing text item so that
    // notes with multiple dictations/text blocks are all preserved on save.
    // Collect ALL text items in their original order.
    const textItems = note.mediaItems.filter(
      (m): m is TextMediaItem => m.type === 'text'
    );

    // Parallel array pairing each textarea with its source item (undefined for
    // the trailing "add new text" box). Rebuilt on save in this same order.
    const textEditors: { textarea: HTMLTextAreaElement; source?: TextMediaItem }[] =
      [];

    if (textItems.length > 0) {
      // Render each existing text item as its own labeled textarea.
      textItems.forEach((item, i) => {
        const group = document.createElement('div');
        group.className = 'form-group';

        if (textItems.length > 1) {
          const caption = document.createElement('div');
          caption.className = 'settings-row-desc';
          caption.textContent = `Text ${i + 1}`;
          group.appendChild(caption);
        }

        const textarea = document.createElement('textarea');
        textarea.className = 'form-textarea';
        textarea.maxLength = 2000;
        textarea.value = item.content;
        group.appendChild(textarea);

        contentEl.appendChild(group);
        textEditors.push({ textarea, source: item });
      });
    } else {
      // No existing text — render ONE empty box so the user can add text,
      // matching the previous single-textarea behavior for the no-text case.
      const textarea = document.createElement('textarea');
      textarea.className = 'form-textarea';
      textarea.maxLength = 2000;
      textarea.placeholder = 'Add text to this note…';
      contentEl.appendChild(textarea);
      textEditors.push({ textarea });
    }

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
        // Stop any in-progress recording so its audio is captured before we
        // snapshot the captured items.
        await mediaCapture.finalizePendingRecording();
        const captured = mediaCapture.getCaptured();

        // Rebuild media items: keep non-removed existing non-text items, then
        // append the newly captured items from this edit session.
        const keptMedia: MediaItem[] = nonTextItems.filter(
          (m) => !removedIds.has(m.id)
        );

        // Rebuild the TEXT items from every editable box, in order. Each box
        // tied to an existing item updates that item in place (preserving id +
        // createdAt); an emptied box drops that item. Boxes with no source that
        // now have content become brand-new text items.
        const textMediaItems: TextMediaItem[] = [];
        for (const { textarea, source } of textEditors) {
          const value = textarea.value.trim();
          if (value.length === 0) continue; // empty box → dropped
          if (source) {
            // Update existing text item, preserving its id and createdAt.
            textMediaItems.push({ ...source, content: value });
          } else {
            // Fresh text item from the "add text" box.
            textMediaItems.push({
              id: crypto.randomUUID(),
              type: 'text',
              createdAt: Date.now(),
              content: value,
            });
          }
        }

        // Text first (preserving original relative order), then kept media and
        // newly captured items — matching the previous text-first placement.
        const newMediaItems: MediaItem[] = [
          ...textMediaItems,
          ...keptMedia,
          ...captured.items,
        ];

        // Validate: must still have at least one media item.
        if (newMediaItems.length === 0) {
          errorEl.textContent =
            'A note must have at least one item. Add some text or keep a media item.';
          errorEl.style.display = '';
          return;
        }

        // Transcription now lives on each AudioMediaItem. Kept items retain
        // their own transcript/status (they're the same objects), and newly
        // captured audio items already carry their per-item transcript/status
        // from the media-capture component. We do NOT copy the legacy
        // note-level transcript onto any item here.
        const updatedNote: Note = {
          ...note,
          mediaItems: newMediaItems,
          updatedAt: Date.now(),
        };

        // Apply the edited location label (display text only). Coordinates and
        // accuracy are preserved, so the Maps link target never changes. An
        // empty field falls back to showing coordinates (resolvedAddress unset).
        if (locationInput) {
          const label = locationInput.value.trim();
          if (note.location) {
            // GPS present: edit the address label; coords/link unchanged.
            updatedNote.location = {
              ...note.location,
              resolvedAddress: label.length > 0 ? label : undefined,
            };
          } else {
            // No GPS: store as a plain manual label (no map link).
            updatedNote.manualLabel = label.length > 0 ? label : undefined;
          }
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
    goBtn.textContent = 'Go to Knots';
    goBtn.addEventListener('click', () => navigate('#/knots'));
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
