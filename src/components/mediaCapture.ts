// ============================================================
// e-Handkerchief — MediaCapture component
// Reusable media-capture UI + logic shared by the new-note capture
// screen and the note edit mode, so both behave identically and future
// changes only need to be made once.
//
// Renders: mic/photo/video/library controls, a recording indicator with
// elapsed timer, a live-transcript box (with an 8s watchdog), a preview
// list with per-item remove buttons, and an inline media-error message.
// Manages: draft items, live-transcription state, object-URL lifecycle.
//
// Does NOT include the text textarea, the timestamp/location header, the
// Save button, or note-saving logic — those remain screen-specific.
// ============================================================

import {
  mediaService,
  MediaUnsupportedError,
  FileSizeError,
  UnsupportedFormatError,
} from '../mediaService.js';
import { settingsStore } from '../settingsStore.js';
import { transcriptionService } from '../transcriptionService.js';
import type {
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

export interface CapturedMedia {
  items: MediaItem[];
  /** Live transcript captured during an audio recording (if any). */
  transcript: string | null;
  /** True if transcription was requested but live capture didn't produce text. */
  transcriptionDeferred: boolean;
  /** Last live-recognition error code, if any. */
  liveTranscriptionError: string | null;
}

export interface MediaCaptureHandle {
  /** Snapshot of all captured items + transcription state. */
  getCaptured(): CapturedMedia;
  /** If a recording is in progress, stop it and wait for the audio to attach. */
  finalizePendingRecording(): Promise<void>;
  /** Whether a recording is currently active. */
  isRecording(): boolean;
  /** Tear down: stop recording/recognition, revoke object URLs, remove listeners. */
  destroy(): void;
}

/**
 * Render the media-capture UI (mic/photo/video/library + live transcript +
 * previews + errors) into `container`. Shared by the capture screen and the
 * note edit mode so both behave identically.
 *
 * @param opts.enableLiveTranscription If true (default), attempt live Web Speech
 *   transcription during audio recording when enabled in settings and online.
 *   The edit mode can pass true as well now (unified behaviour).
 */
export function renderMediaCapture(
  container: HTMLElement,
  opts?: { enableLiveTranscription?: boolean }
): MediaCaptureHandle {
  const enableLiveTranscription = opts?.enableLiveTranscription ?? true;

  // ---- State ----
  const draftItems: DraftMediaItem[] = [];
  let activeRecording: AudioRecordingHandle | null = null;
  let recording = false;
  let recordingElapsed = 0;
  /**
   * Resolves after the recorded AudioMediaItem has been pushed into draftItems.
   * Lets the save path deterministically wait for an in-progress recording to
   * finish and attach its audio before snapshotting the draft items.
   */
  let pendingRecordingPromise: Promise<void> | null = null;
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
  root.className = 'media-capture';

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

  // ---- Recording ----
  const onMicClick = async (): Promise<void> => {
    if (micDisabled) return;
    clearMediaError();

    if (recording && activeRecording) {
      // Stop recording
      activeRecording.stop();
      return;
    }

    try {
      const handle = await mediaService.startAudioRecording();
      activeRecording = handle;
      recording = true;
      recordingElapsed = 0;

      // Reset transcription tracking for this recording.
      recordedTranscript = null;
      transcriptionDeferred = false;
      liveTranscriptionError = null;
      liveProducedText = false;
      clearLiveWatchdog();

      const transcriptionRequested = settingsStore.getCurrent().transcriptionEnabled;
      const canLiveTranscribe =
        enableLiveTranscription &&
        transcriptionRequested &&
        transcriptionService.isSupported &&
        navigator.onLine;
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
      } else if (transcriptionRequested && enableLiveTranscription) {
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
        recording = false;
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
          enableLiveTranscription &&
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
        // Attach per-item transcription state so each recording carries its own
        // transcript + status. The note-level CapturedMedia fields are kept in
        // sync for the capture screen's post-save toast messaging, but this
        // item is now the authoritative source of the transcript.
        if (recordedTranscript) {
          item.transcript = recordedTranscript;
          item.transcriptionStatus = 'live';
        } else if (transcriptionDeferred) {
          item.transcriptionStatus = 'pending';
        } else {
          item.transcriptionStatus = 'none';
        }
        draftItems.push({ item, previewUrl: audioUrl });
        refreshPreviewList();
        pendingRecordingPromise = null;
      });
    } catch (err) {
      recording = false;
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

  const micClickHandler = (): void => void onMicClick();
  micBtn.addEventListener('click', micClickHandler);
  listenerCleanups.push(() => micBtn.removeEventListener('click', micClickHandler));

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

  const photoClickHandler = (): void => void onPhotoClick();
  photoBtn.addEventListener('click', photoClickHandler);
  listenerCleanups.push(() => photoBtn.removeEventListener('click', photoClickHandler));

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

  const videoClickHandler = (): void => void onVideoClick();
  videoBtn.addEventListener('click', videoClickHandler);
  listenerCleanups.push(() => videoBtn.removeEventListener('click', videoClickHandler));

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

  const libraryClickHandler = (): void => void onLibraryClick();
  libraryBtn.addEventListener('click', libraryClickHandler);
  listenerCleanups.push(() =>
    libraryBtn.removeEventListener('click', libraryClickHandler)
  );

  // ---- Public API ----
  function getCaptured(): CapturedMedia {
    return {
      items: draftItems.map((d) => d.item),
      transcript: recordedTranscript,
      transcriptionDeferred,
      liveTranscriptionError,
    };
  }

  async function finalizePendingRecording(): Promise<void> {
    if (recording && activeRecording) {
      activeRecording.stop();
      if (pendingRecordingPromise) await pendingRecordingPromise;
    }
  }

  function isRecording(): boolean {
    return recording;
  }

  function destroy(): void {
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
  }

  return { getCaptured, finalizePendingRecording, isRecording, destroy };
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
