// ============================================================
// e-Handkerchief — CaptureScreen
// Default landing view for creating new notes.
// ============================================================

import { geoService } from '../geoService.js';
import {
  mediaService,
  MediaUnsupportedError,
  FileSizeError,
  UnsupportedFormatError,
} from '../mediaService.js';
import { noteStore } from '../noteStore.js';
import { settingsStore } from '../settingsStore.js';
import { toastService } from '../toastService.js';
import { eventBus } from '../eventBus.js';
import { navigate } from '../router.js';
import { formatNoteTimestamp } from '../dateFormat.js';
import { transcriptionService } from '../transcriptionService.js';
import type {
  Note,
  NoteTimestamp,
  NoteLocation,
  MediaItem,
  AudioMediaItem,
  PhotoMediaItem,
  VideoMediaItem,
  TextMediaItem,
} from '../types.js';
import type { AudioRecordingHandle } from '../mediaService.js';
import type { LiveTranscriptionHandle } from '../transcriptionService.js';

/** A draft item before the note is persisted. Includes a preview URL for cleanup. */
interface DraftMediaItem {
  item: MediaItem;
  previewUrl?: string; // object URL for preview <img>/<audio>
}

function makeTimestamp(): NoteTimestamp {
  const now = new Date();
  const localISO = now.toISOString().replace('Z', getUTCOffset(now));
  const utcOffset = getUTCOffset(now);
  return { localISO, utcOffset };
}

function getUTCOffset(date: Date): string {
  const off = -date.getTimezoneOffset(); // minutes
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

const MAX_TEXT_LEN = 2000;
const MAX_RECORD_SEC = 600;

export function renderCapture(container: HTMLElement): () => void {
  // ---- State ----
  const timestamp = makeTimestamp();
  let location: NoteLocation | null = null;
  let locationStatus: 'loading' | 'ok' | 'denied' | 'unavailable' = 'loading';
  const draftItems: DraftMediaItem[] = [];
  let activeRecording: AudioRecordingHandle | null = null;
  let isRecording = false;
  let recordingElapsed = 0;
  /**
   * Resolves after the recorded AudioMediaItem has been pushed into draftItems.
   * Lets the save path deterministically wait for an in-progress recording to
   * finish and attach its audio before snapshotting the draft items.
   */
  let pendingRecordingPromise: Promise<void> | null = null;
  let isSaving = false;
  let micDisabled = false;

  // ---- Live transcription tracking (for the single audio recording) ----
  let liveTranscription: LiveTranscriptionHandle | null = null;
  /** Text captured live via Web Speech during recording (if any). */
  let recordedTranscript: string | null = null;
  /** True when transcription was requested but live capture was unavailable/offline. */
  let transcriptionDeferred = false;
  /** Last live-recognition error code (e.g. 'not-allowed', 'no-speech'), for messaging. */
  let liveTranscriptionError: string | null = null;
  /** True once live transcription has produced real (non-placeholder) text. */
  let liveProducedText = false;
  /** Watchdog: if live transcription produces nothing within a window, show an inline hint. */
  let liveWatchdog: ReturnType<typeof setTimeout> | null = null;

  /** Placeholder shown in the live-transcript box while waiting for speech results. */
  const LIVE_PLACEHOLDER = 'Listening…';
  /** How long to wait for live text before showing the "not producing text" hint. */
  const LIVE_WATCHDOG_MS = 8000;

  function clearLiveWatchdog(): void {
    if (liveWatchdog !== null) {
      clearTimeout(liveWatchdog);
      liveWatchdog = null;
    }
  }

  // Cleanup registry
  const objUrls: string[] = [];
  const listenerCleanups: Array<() => void> = [];

  function trackUrl(url: string): string {
    objUrls.push(url);
    return url;
  }

  // ---- Build DOM ----
  const root = document.createElement('div');
  root.className = 'capture-screen';

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'capture-header';

  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = 'New Note';
  header.appendChild(title);

  const metaTimestamp = document.createElement('div');
  metaTimestamp.className = 'capture-meta';
  metaTimestamp.textContent = formatNoteTimestamp(timestamp.localISO);
  header.appendChild(metaTimestamp);

  const metaLocation = document.createElement('div');
  metaLocation.className = 'capture-meta';
  const locSpinner = document.createElement('span');
  locSpinner.className = 'location-loading';
  locSpinner.innerHTML = '<span class="spinner spinner--sm"></span> Getting location…';
  metaLocation.appendChild(locSpinner);
  header.appendChild(metaLocation);

  root.appendChild(header);

  // --- Text area ---
  const textGroup = document.createElement('div');
  textGroup.className = 'form-group';

  const textarea = document.createElement('textarea');
  textarea.className = 'form-textarea';
  textarea.placeholder = 'Type a note…';
  textarea.maxLength = MAX_TEXT_LEN;
  textarea.setAttribute('aria-label', 'Note text');
  textGroup.appendChild(textarea);

  const charCounter = document.createElement('div');
  charCounter.className = 'char-counter';
  charCounter.textContent = `${MAX_TEXT_LEN} remaining`;
  textGroup.appendChild(charCounter);

  root.appendChild(textGroup);

  function updateCharCounter(): void {
    const remaining = MAX_TEXT_LEN - textarea.value.length;
    charCounter.textContent = `${remaining} remaining`;
    charCounter.className =
      remaining === 0
        ? 'char-counter at-limit'
        : remaining <= 100
        ? 'char-counter near-limit'
        : 'char-counter';
  }

  const onTextInput = (): void => updateCharCounter();
  textarea.addEventListener('input', onTextInput);
  listenerCleanups.push(() => textarea.removeEventListener('input', onTextInput));

  // --- Capture buttons ---
  const controls = document.createElement('div');
  controls.className = 'media-controls';

  const micBtn = document.createElement('button');
  micBtn.className = 'btn btn-ghost';
  micBtn.setAttribute('aria-label', 'Record voice note');
  micBtn.textContent = '🎤 Mic';
  controls.appendChild(micBtn);

  const photoBtn = document.createElement('button');
  photoBtn.className = 'btn btn-ghost';
  photoBtn.setAttribute('aria-label', 'Capture photo');
  photoBtn.textContent = '📷 Photo';
  controls.appendChild(photoBtn);

  const videoBtn = document.createElement('button');
  videoBtn.className = 'btn btn-ghost';
  videoBtn.setAttribute('aria-label', 'Capture video');
  videoBtn.textContent = '🎬 Video';
  controls.appendChild(videoBtn);

  const libraryBtn = document.createElement('button');
  libraryBtn.className = 'btn btn-ghost';
  libraryBtn.setAttribute('aria-label', 'Pick from library');
  libraryBtn.textContent = '🖼️ Library';
  controls.appendChild(libraryBtn);

  root.appendChild(controls);

  // Recording indicator (hidden by default)
  const recordingIndicator = document.createElement('div');
  recordingIndicator.className = 'recording-indicator';
  recordingIndicator.style.display = 'none';
  recordingIndicator.innerHTML =
    '<span class="recording-dot"></span><span class="elapsed-counter">0:00</span>';
  root.appendChild(recordingIndicator);

  // Live transcript display (hidden by default; shown while live transcription runs)
  const liveTranscriptEl = document.createElement('div');
  liveTranscriptEl.className = 'live-transcript';
  liveTranscriptEl.style.display = 'none';
  root.appendChild(liveTranscriptEl);

  // Media preview list
  const previewList = document.createElement('div');
  previewList.className = 'media-preview-list';
  root.appendChild(previewList);

  // Media error message
  const mediaErrorEl = document.createElement('div');
  mediaErrorEl.className = 'error-message';
  mediaErrorEl.style.display = 'none';
  root.appendChild(mediaErrorEl);

  // Validation error
  const validationError = document.createElement('div');
  validationError.className = 'validation-error';
  validationError.style.display = 'none';
  root.appendChild(validationError);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary btn-full';
  saveBtn.textContent = 'Save Note';
  root.appendChild(saveBtn);

  container.appendChild(root);

  // ---- Helpers ----
  function setMediaError(msg: string): void {
    mediaErrorEl.textContent = msg;
    mediaErrorEl.style.display = 'flex';
  }

  function clearMediaError(): void {
    mediaErrorEl.style.display = 'none';
  }

  function formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function updateSaveBtnState(): void {
    saveBtn.disabled = isSaving;
    saveBtn.textContent = isSaving ? 'Saving…' : 'Save Note';
  }

  function renderPreview(draft: DraftMediaItem, index: number): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-item';

    let inner: HTMLElement;

    if (draft.item.type === 'audio') {
      const audio = document.createElement('audio');
      audio.controls = true;
      if (draft.previewUrl) audio.src = draft.previewUrl;
      audio.className = 'audio-item';
      inner = audio;
    } else if (draft.item.type === 'photo' || draft.item.type === 'video') {
      const img = document.createElement('img');
      img.src = draft.previewUrl ?? '';
      img.width = 80;
      img.height = 80;
      img.alt = draft.item.type === 'photo' ? 'Photo preview' : 'Video thumbnail';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '4px';
      inner = img;
    } else {
      // text
      const txt = document.createElement('div');
      txt.className = 'card';
      txt.style.fontSize = '12px';
      txt.style.maxWidth = '200px';
      txt.style.overflow = 'hidden';
      txt.style.whiteSpace = 'pre-wrap';
      const textItem = draft.item as TextMediaItem;
      txt.textContent = textItem.content.slice(0, 60) + (textItem.content.length > 60 ? '…' : '');
      inner = txt;
    }

    wrapper.appendChild(inner);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.setAttribute('aria-label', 'Remove item');
    removeBtn.textContent = '×';
    const capturedIndex = index;
    const onRemove = (): void => {
      const d = draftItems[capturedIndex];
      if (d?.previewUrl) URL.revokeObjectURL(d.previewUrl);
      draftItems.splice(capturedIndex, 1);
      refreshPreviewList();
    };
    removeBtn.addEventListener('click', onRemove);
    wrapper.appendChild(removeBtn);

    previewList.appendChild(wrapper);
  }

  function refreshPreviewList(): void {
    previewList.innerHTML = '';
    draftItems.forEach((d, i) => renderPreview(d, i));
  }

  // ---- Geo location ----
  geoService.getCurrentPosition().then((loc) => {
    location = loc;
    if (loc) {
      locationStatus = 'ok';
      locSpinner.remove();
      const locText = document.createElement('span');
      locText.className = 'note-location';
      if (loc.resolvedAddress) {
        locText.textContent = loc.resolvedAddress;
      } else {
        locText.textContent = `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
      }
      metaLocation.appendChild(locText);

      // Attempt reverse geocoding in the background
      geoService.reverseGeocode(loc.latitude, loc.longitude).then((addr) => {
        if (addr && location) {
          location = { ...location, resolvedAddress: addr };
          locText.textContent = addr;
        }
      });
    } else {
      locationStatus = 'unavailable';
      locSpinner.remove();
      const locMsg = document.createElement('span');
      locMsg.className = 'text-muted';
      locMsg.style.fontSize = '12px';
      locMsg.textContent = 'Location unavailable — enable in device settings';
      metaLocation.appendChild(locMsg);
    }
  });

  // ---- Recording ----
  const onMicClick = async (): Promise<void> => {
    if (micDisabled) return;
    clearMediaError();

    if (isRecording && activeRecording) {
      // Stop recording
      activeRecording.stop();
      return;
    }

    try {
      const handle = await mediaService.startAudioRecording();
      activeRecording = handle;
      isRecording = true;
      recordingElapsed = 0;

      // Reset transcription tracking for this recording.
      recordedTranscript = null;
      transcriptionDeferred = false;
      liveTranscriptionError = null;
      liveProducedText = false;
      clearLiveWatchdog();

      const transcriptionRequested = settingsStore.getCurrent().transcriptionEnabled;
      const canLiveTranscribe =
        transcriptionRequested && transcriptionService.isSupported && navigator.onLine;
      if (canLiveTranscribe) {
        liveTranscription = transcriptionService.startLive();
        // Show the live transcript box and stream text in real time.
        liveTranscriptEl.textContent = LIVE_PLACEHOLDER;
        liveTranscriptEl.style.display = 'block';
        liveTranscription.onText((txt) => {
          const trimmed = (txt || '').trim();
          if (trimmed && trimmed !== LIVE_PLACEHOLDER) {
            // Real live text arrived — mark it and stand down the watchdog.
            liveProducedText = true;
            clearLiveWatchdog();
          }
          liveTranscriptEl.textContent = txt || LIVE_PLACEHOLDER;
        });

        // Watchdog: on devices where MediaRecorder holds the mic (e.g. Android
        // Chrome), SpeechRecognition often yields no results and no error, so the
        // box would stay stuck on "Listening…". Replace it with an honest hint.
        clearLiveWatchdog();
        liveWatchdog = setTimeout(() => {
          liveWatchdog = null;
          if (!liveProducedText) {
            liveTranscriptEl.textContent =
              "Live transcription isn't producing text on this device. Your audio is being recorded and can be transcribed after saving.";
          }
        }, LIVE_WATCHDOG_MS);
      } else if (transcriptionRequested) {
        // Transcription wanted but live capture is unavailable (offline / unsupported).
        transcriptionDeferred = true;
      }

      micBtn.textContent = '⏹ Stop';
      recordingIndicator.style.display = 'flex';
      const elapsedEl = recordingIndicator.querySelector<HTMLElement>('.elapsed-counter');

      handle.onElapsed((sec) => {
        recordingElapsed = sec;
        if (elapsedEl) elapsedEl.textContent = formatElapsed(sec);
      });

      pendingRecordingPromise = handle.result.then(async (blob) => {
        isRecording = false;
        activeRecording = null;
        micBtn.textContent = '🎤 Mic';
        recordingIndicator.style.display = 'none';

        // Stop live recognition (if running) and gather the transcript.
        if (liveTranscription) {
          clearLiveWatchdog();
          liveTranscription.stop();
          const transcript = await liveTranscription.result;
          const errCode = liveTranscription.getError();
          liveTranscription = null;

          // Hide and clear the live transcript box.
          liveTranscriptEl.style.display = 'none';
          liveTranscriptEl.textContent = '';

          if (transcript) {
            recordedTranscript = transcript;
            liveProducedText = true;
            transcriptionDeferred = false;
          } else if (settingsStore.getCurrent().transcriptionEnabled) {
            // Live recognition produced nothing — allow deferred transcription so
            // the note can be transcribed later via the Worker.
            transcriptionDeferred = true;
            // Capture the error reason (if any) for accurate messaging.
            if (errCode) liveTranscriptionError = errCode;
          }
        }

        // Robustness: if live was attempted but never produced text (and there was
        // no explicit transcript above), keep transcription deferred so status
        // becomes 'pending' and the audio can be transcribed later.
        if (
          !liveProducedText &&
          !recordedTranscript &&
          settingsStore.getCurrent().transcriptionEnabled
        ) {
          transcriptionDeferred = true;
        }

        const audioUrl = trackUrl(URL.createObjectURL(blob));
        const item: AudioMediaItem = {
          id: crypto.randomUUID(),
          type: 'audio',
          createdAt: Date.now(),
          blob,
          durationSeconds: recordingElapsed,
        };
        draftItems.push({ item, previewUrl: audioUrl });
        refreshPreviewList();
        pendingRecordingPromise = null;
      });
    } catch (err) {
      isRecording = false;
      activeRecording = null;
      micBtn.textContent = '🎤 Mic';
      recordingIndicator.style.display = 'none';

      clearLiveWatchdog();
      if (liveTranscription) {
        liveTranscription.stop();
        liveTranscription = null;
      }
      liveTranscriptEl.style.display = 'none';
      liveTranscriptEl.textContent = '';

      if (err instanceof MediaUnsupportedError) {
        micDisabled = true;
        micBtn.disabled = true;
        setMediaError('Voice recording is not supported in this browser.');
      } else {
        setMediaError('Microphone access required. Please allow microphone permissions.');
      }
    }
  };

  micBtn.addEventListener('click', () => void onMicClick());
  listenerCleanups.push(() => micBtn.removeEventListener('click', () => void onMicClick()));

  // ---- Photo ----
  const onPhotoClick = async (): Promise<void> => {
    clearMediaError();
    try {
      const blob = await mediaService.capturePhoto();
      const thumbBlob = await mediaService.generateThumbnail(blob);
      // Get image dimensions via offscreen image
      const url = trackUrl(URL.createObjectURL(thumbBlob));
      const imgDims = await getImageDimensions(blob);
      const item: PhotoMediaItem = {
        id: crypto.randomUUID(),
        type: 'photo',
        createdAt: Date.now(),
        blob,
        widthPx: imgDims.width,
        heightPx: imgDims.height,
        thumbnailBlob: thumbBlob,
      };
      draftItems.push({ item, previewUrl: url });
      refreshPreviewList();
    } catch (err) {
      handleMediaError(err);
    }
  };

  photoBtn.addEventListener('click', () => void onPhotoClick());
  listenerCleanups.push(() => photoBtn.removeEventListener('click', () => void onPhotoClick()));

  // ---- Video ----
  const onVideoClick = async (): Promise<void> => {
    clearMediaError();
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
      draftItems.push({ item, previewUrl: thumbUrl });
      refreshPreviewList();
    } catch (err) {
      handleMediaError(err);
    }
  };

  videoBtn.addEventListener('click', () => void onVideoClick());
  listenerCleanups.push(() => videoBtn.removeEventListener('click', () => void onVideoClick()));

  // ---- Library ----
  const onLibraryClick = async (): Promise<void> => {
    clearMediaError();
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
        draftItems.push({ item, previewUrl: thumbUrl });
      } else {
        const item: VideoMediaItem = {
          id: crypto.randomUUID(),
          type: 'video',
          createdAt: Date.now(),
          blob,
          durationSeconds: 0,
          thumbnailBlob: thumbBlob,
        };
        draftItems.push({ item, previewUrl: thumbUrl });
      }
      refreshPreviewList();
    } catch (err) {
      handleMediaError(err);
    }
  };

  libraryBtn.addEventListener('click', () => void onLibraryClick());
  listenerCleanups.push(() =>
    libraryBtn.removeEventListener('click', () => void onLibraryClick())
  );

  function handleMediaError(err: unknown): void {
    if (err instanceof FileSizeError) {
      setMediaError('File exceeds the 100 MB size limit. Please choose a smaller file.');
    } else if (err instanceof UnsupportedFormatError) {
      setMediaError(
        'Unsupported file format. Please use JPEG, PNG, GIF, WEBP, MP4, or MOV.'
      );
    } else if (err instanceof MediaUnsupportedError) {
      setMediaError('Media capture is not supported in this browser.');
    } else if (err instanceof Error && err.message !== 'File selection cancelled') {
      setMediaError(`Could not capture media: ${err.message}`);
    }
    // Cancelled by user — no error message
  }

  // ---- Save ----
  const onSaveClick = async (): Promise<void> => {
    // If a recording is still in progress, stop it and wait for the audio item
    // to be pushed to draftItems before proceeding, so the user doesn't lose it.
    if (isRecording && activeRecording) {
      activeRecording.stop();
      if (pendingRecordingPromise) await pendingRecordingPromise;
    }

    // Collect text item if textarea has content
    const textValue = textarea.value.trim();
    const allItems: MediaItem[] = draftItems.map((d) => d.item);

    if (textValue) {
      const textItem: TextMediaItem = {
        id: crypto.randomUUID(),
        type: 'text',
        createdAt: Date.now(),
        content: textValue.slice(0, MAX_TEXT_LEN),
      };
      allItems.push(textItem);
    }

    if (allItems.length === 0) {
      validationError.textContent = 'Please add at least one item before saving.';
      validationError.style.display = 'block';
      return;
    }

    validationError.style.display = 'none';
    isSaving = true;
    updateSaveBtnState();

    // Determine transcription status — only meaningful when the note has audio.
    const hasAudio = allItems.some((m) => m.type === 'audio');
    const transcriptionEnabled = settingsStore.getCurrent().transcriptionEnabled;

    let transcriptionStatus: Note['transcriptionStatus'] = 'none';
    if (hasAudio) {
      if (recordedTranscript) {
        transcriptionStatus = 'live';
      } else if (transcriptionEnabled && transcriptionDeferred) {
        transcriptionStatus = 'pending';
      }
    }

    const note: Note = {
      id: crypto.randomUUID(),
      timestamp,
      location,
      mediaItems: allItems,
      transcription: (hasAudio && recordedTranscript) ? recordedTranscript : undefined,
      transcriptionStatus,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await noteStore.save(note);
    } catch (err) {
      isSaving = false;
      updateSaveBtnState();
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Note save failed:', err);
      toastService.show(`Could not save note: ${detail}`, 8000);
      return;
    }

    // Emit saved event so Journal refreshes
    eventBus.emit('note:saved', note);

    // Optional side-effects (fire-and-forget)
    const settings = settingsStore.getCurrent();

    if (note.transcriptionStatus === 'pending') {
      // Craft a message that reflects WHY live transcription didn't produce text.
      let deferredMsg: string;
      if (liveTranscriptionError === 'not-allowed') {
        deferredMsg =
          'Saved. Live transcription was blocked (mic permission). You can transcribe later from the note.';
      } else if (liveTranscriptionError === 'no-speech') {
        deferredMsg = 'Saved. No speech detected for live transcription.';
      } else if (transcriptionEnabled && !transcriptionService.isSupported) {
        deferredMsg = "Saved. Live transcription isn't supported in this browser.";
      } else if (!navigator.onLine) {
        deferredMsg = 'Saved. Offline — transcribe later from the note when online.';
      } else if (transcriptionEnabled && !liveProducedText) {
        // Live was attempted online with no specific error, but produced no text —
        // most likely the mic-sharing platform constraint (e.g. Android Chrome).
        deferredMsg =
          "Saved. Live transcription didn't work on this device — open the note and tap 'Transcribe voice' to transcribe it via your server.";
      } else {
        deferredMsg =
          'Saved. Voice transcription was unavailable — you can transcribe later from the note.';
      }
      toastService.show(deferredMsg, 6000);
    }

    if (settings.emailSummaryEnabled && settings.emailSummaryRecipient) {
      import('../emailQueue.js')
        .then(({ emailQueue }) => emailQueue.enqueue(note, settings.emailSummaryRecipient!))
        .catch(() => {/* silently ignore queue errors */});
    }

    if (settings.cloudBackupProvider) {
      import('../cloudSyncService.js')
        .then(({ cloudSyncService }) => cloudSyncService.uploadNote(note))
        .catch(() => {/* queued internally */});
    }

    navigate('#/journal');
  };

  saveBtn.addEventListener('click', () => void onSaveClick());
  listenerCleanups.push(() => saveBtn.removeEventListener('click', () => void onSaveClick()));

  // ---- Cleanup ----
  return () => {
    // Stop any active recording
    if (activeRecording) {
      activeRecording.stop();
      activeRecording = null;
    }
    clearLiveWatchdog();
    if (liveTranscription) {
      liveTranscription.stop();
      liveTranscription = null;
    }

    // Revoke all object URLs
    for (const url of objUrls) {
      URL.revokeObjectURL(url);
    }

    // Remove event listeners
    for (const cleanup of listenerCleanups) cleanup();

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
