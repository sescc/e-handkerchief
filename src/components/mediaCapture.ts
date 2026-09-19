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

/**
 * Map a Web Speech recognition error code to a brief, user-facing message.
 * Shared by the dictate and mic live-transcription paths so failures surface
 * consistently instead of leaving the live box stuck on "Listening…".
 */
function speechErrorMessage(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'Microphone permission denied for dictation.';
  } else if (code === 'no-speech') {
    return 'No speech detected — try speaking, then tap Stop.';
  } else if (code === 'network') {
    return 'Speech recognition needs internet (it runs in the cloud on this browser).';
  } else if (code === 'audio-capture') {
    return 'No microphone available for dictation.';
  } else if (code) {
    return `Dictation error: ${code}`;
  }
  return 'Dictation error.';
}

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

  // ---- Dictation state (live Web Speech → text-only item, no audio blob) ----
  /** True while a dictation (live speech → text) session is active. */
  let dictating = false;
  /** Active dictation recognition handle (null when not dictating). */
  let dictateHandle: LiveTranscriptionHandle | null = null;
  /**
   * Resolves after the dictated TextMediaItem has been pushed into draftItems
   * (or after dictation stops with no recognized text). Lets the save path wait
   * for an in-progress dictation to finish and attach its text before snapshot.
   */
  let pendingDictationPromise: Promise<void> | null = null;

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
  /**
   * How many times the mic live-transcription session has been transparently
   * restarted after a transient `network` error (reset per recording).
   */
  let liveRetries = 0;

  /** Placeholder shown in the live-transcript box while waiting for speech results. */
  const LIVE_PLACEHOLDER = 'Listening…';
  /** How long to wait for live text before showing the "not producing text" hint. */
  const LIVE_WATCHDOG_MS = 8000;
  /**
   * Max transparent retries of the mic live-transcription session on transient
   * `network` errors (2 retries = up to 3 attempts total). The desktop Chrome
   * cloud recognizer intermittently throws `network` even while online; retrying
   * silently avoids alarming the user when the audio itself is recording fine.
   */
  const MAX_LIVE_RETRIES = 2;
  /**
   * Calm, reassuring message shown in the live box once live transcription is
   * unavailable. Deliberately avoids implying the recording failed — the audio
   * keeps recording and can be transcribed after saving.
   */
  const LIVE_UNAVAILABLE_MESSAGE =
    'Live transcript unavailable right now — your audio is still recording and can be transcribed after saving.';

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

  const dictateBtn = document.createElement('button');
  dictateBtn.className = 'btn btn-ghost';
  dictateBtn.setAttribute('aria-label', 'Dictate text via speech');
  dictateBtn.textContent = '🗣 Dictate';
  controls.appendChild(dictateBtn);

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

    // Mic and dictation are mutually exclusive — refuse to start recording
    // while a dictation session is active.
    if (dictating) {
      setMediaError('Stop dictation before recording.');
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
      liveRetries = 0;
      clearLiveWatchdog();

      const transcriptionRequested = settingsStore.getCurrent().transcriptionEnabled;
      const canLiveTranscribe =
        enableLiveTranscription &&
        transcriptionRequested &&
        transcriptionService.isSupported &&
        navigator.onLine;
      if (canLiveTranscribe) {
        // Start a live transcription session and wire its handlers. Factored
        // into a closure so a transient `network` error can transparently
        // restart the session (see the retry policy in onError below) without
        // touching the audio recording, which keeps working regardless.
        const startLiveSession = (): void => {
          liveTranscription = transcriptionService.startLive();
          // Show the live transcript box and stream text in real time. On the
          // first attempt we set the placeholder + reveal the box; on retries we
          // keep it non-alarming by resetting to the same calm placeholder.
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
          liveTranscription.onError((code) => {
            // Never clobber a good live transcript that already arrived.
            if (liveProducedText) return;

            if (code === 'network' && liveRetries < MAX_LIVE_RETRIES) {
              // Transient cloud-recognizer hiccup (common on desktop Chrome even
              // while online). Silently tear down and restart the session — do
              // NOT show the alarming network message. Keep the calm placeholder.
              liveRetries += 1;
              const stale = liveTranscription;
              liveTranscription = null;
              if (stale) stale.stop();
              startLiveSession();
              return;
            }

            // Retries exhausted, or a non-network failure with no text yet.
            // Show a calm line that does NOT imply the recording failed. For
            // `network` specifically use the reassuring message; for clearly
            // actionable codes (e.g. not-allowed) keep the specific guidance.
            if (code === 'network') {
              liveTranscriptEl.textContent = LIVE_UNAVAILABLE_MESSAGE;
            } else {
              liveTranscriptEl.textContent = speechErrorMessage(code);
            }
          });
        };

        startLiveSession();

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
            recordedTranscript = transcript.trim();
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

  // ---- Dictation (live Web Speech → text-only item, no audio blob) ----
  /**
   * Stop the active dictation session, gather the recognized transcript, and
   * (if non-empty) push a TextMediaItem into draftItems. Safe to call once per
   * session — guarded by the `dictating` flag so the toggle-stop and finalize
   * paths never double-run.
   */
  async function stopDictation(): Promise<void> {
    if (!dictating || !dictateHandle) return;
    const handle = dictateHandle;
    // Flip the flag up front so a concurrent finalize/toggle can't re-enter.
    dictating = false;

    handle.stop();
    const result = await handle.result;

    // Hide/clear the live box.
    liveTranscriptEl.style.display = 'none';
    liveTranscriptEl.textContent = '';

    const text = (result ?? '').trim();
    if (text) {
      const item: TextMediaItem = {
        id: crypto.randomUUID(),
        type: 'text',
        createdAt: Date.now(),
        content: text.slice(0, 2000),
      };
      draftItems.push({ item });
      refreshPreviewList();
    } else {
      // Nothing recognized — surface a brief hint for known error codes.
      const errCode = handle.getError?.();
      if (errCode === 'not-allowed') {
        setMediaError('Microphone permission is required for dictation.');
      } else if (errCode === 'no-speech') {
        setMediaError('No speech detected.');
      }
    }

    dictateHandle = null;
    dictateBtn.textContent = '🗣 Dictate';
  }

  const onDictateClick = (): void => {
    clearMediaError();

    // Not supported: message on click but keep the button usable.
    if (!transcriptionService.isSupported) {
      setMediaError("Speech recognition isn't supported in this browser.");
      return;
    }

    // Toggle: if already dictating, stop and collect the text.
    if (dictating) {
      pendingDictationPromise = stopDictation();
      void pendingDictationPromise.finally(() => {
        pendingDictationPromise = null;
      });
      return;
    }

    // Mic and dictation are mutually exclusive — refuse to start dictation
    // while an audio recording is in progress.
    if (recording) {
      setMediaError('Stop the voice recording before dictating.');
      return;
    }

    // Start dictation: live speech → text only, no MediaRecorder.
    const handle = transcriptionService.startLive();
    dictateHandle = handle;
    dictating = true;

    liveTranscriptEl.textContent = LIVE_PLACEHOLDER;
    liveTranscriptEl.style.display = 'block';
    handle.onText((txt) => {
      liveTranscriptEl.textContent = txt || LIVE_PLACEHOLDER;
    });
    handle.onError((code) => {
      // Show the reason in the live box so the user isn't stuck on "Listening…".
      // Soften the transient cloud hiccup so it reads as reconnecting, not failure.
      liveTranscriptEl.textContent =
        code === 'network'
          ? 'Reconnecting… (speech recognition runs in the cloud)'
          : speechErrorMessage(code);
    });
    handle.onEnd(() => {
      // If recognition ended on its own (common on some desktop browsers with
      // continuous mode) while still "dictating" and the box is still showing
      // the placeholder, hint the user. Do NOT auto-stop the session state here;
      // the stopDictation() path handles item creation. This only updates UI.
      if (dictating && liveTranscriptEl.textContent === LIVE_PLACEHOLDER) {
        liveTranscriptEl.textContent =
          'Recognition ended without capturing speech. Tap Dictate again and speak, or check mic permissions.';
      }
    });

    dictateBtn.textContent = '⏹ Stop';
  };

  const dictateClickHandler = (): void => onDictateClick();
  dictateBtn.addEventListener('click', dictateClickHandler);
  listenerCleanups.push(() =>
    dictateBtn.removeEventListener('click', dictateClickHandler)
  );

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

    // Also flush any in-progress dictation so its text item is attached before
    // the host snapshots the draft items.
    if (dictating) {
      // Toggle-stop hasn't run yet — stop now and wait for the text to attach.
      await stopDictation();
    } else if (pendingDictationPromise) {
      // A toggle-stop is already in flight — just wait for it to finish.
      await pendingDictationPromise;
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

    // Stop any active dictation session.
    if (dictateHandle) {
      dictateHandle.stop();
      dictateHandle = null;
    }
    dictating = false;
    liveTranscriptEl.style.display = 'none';
    liveTranscriptEl.textContent = '';

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
