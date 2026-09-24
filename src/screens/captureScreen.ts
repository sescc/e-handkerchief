// ============================================================
// e-Handkerchief — CaptureScreen
// Default landing view for creating new knots.
// ============================================================

import { geoService } from '../geoService.js';
import { knotStore } from '../knotStore.js';
import { settingsStore } from '../settingsStore.js';
import { toastService } from '../toastService.js';
import { eventBus } from '../eventBus.js';
import { navigate } from '../router.js';
import { formatKnotTimestamp } from '../dateFormat.js';
import { transcriptionService } from '../transcriptionService.js';
import { renderMediaCapture } from '../components/mediaCapture.js';
import type {
  Knot,
  KnotTimestamp,
  KnotLocation,
  MediaItem,
  TextMediaItem,
} from '../types.js';

function makeTimestamp(): KnotTimestamp {
  const now = new Date();
  // Store the true instant as a UTC ISO string (…Z). formatKnotTimestamp()
  // converts this instant into the user's chosen timezone for display.
  const localISO = now.toISOString();
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

export function renderCapture(container: HTMLElement): () => void {
  // ---- State ----
  const timestamp = makeTimestamp();
  let location: KnotLocation | null = null;
  let locationStatus: 'loading' | 'ok' | 'denied' | 'unavailable' = 'loading';
  let isSaving = false;

  // Cleanup registry
  const listenerCleanups: Array<() => void> = [];

  // ---- Build DOM ----
  const root = document.createElement('div');
  root.className = 'capture-screen';

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'capture-header';

  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = 'Tie a Knot';
  header.appendChild(title);

  const metaTimestamp = document.createElement('div');
  metaTimestamp.className = 'capture-meta';
  metaTimestamp.textContent = formatKnotTimestamp(timestamp.localISO);
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
  textarea.placeholder = 'What do you want to remember?';
  textarea.maxLength = MAX_TEXT_LEN;
  textarea.setAttribute('aria-label', 'Knot text');
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

  // --- Shared media capture component (mic/photo/video/library + previews +
  //     live transcript + errors) mounted between the textarea and Save. ---
  const mediaMountEl = document.createElement('div');
  root.appendChild(mediaMountEl);
  const mediaCapture = renderMediaCapture(mediaMountEl);

  // Validation error
  const validationError = document.createElement('div');
  validationError.className = 'validation-error';
  validationError.style.display = 'none';
  root.appendChild(validationError);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary btn-full';
  saveBtn.textContent = 'Tie Knot';
  root.appendChild(saveBtn);

  container.appendChild(root);

  // ---- Helpers ----
  function updateSaveBtnState(): void {
    saveBtn.disabled = isSaving;
    saveBtn.textContent = isSaving ? 'Saving…' : 'Tie Knot';
  }

  // ---- Geo location ----
  geoService.getCurrentPosition().then((loc) => {
    location = loc;
    if (loc) {
      locationStatus = 'ok';
      locSpinner.remove();
      const locText = document.createElement('span');
      locText.className = 'knot-location';
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

  // ---- Save ----
  const onSaveClick = async (): Promise<void> => {
    // If a recording is still in progress, stop it and wait for the audio item
    // to be attached before proceeding, so the user doesn't lose it.
    await mediaCapture.finalizePendingRecording();

    const captured = mediaCapture.getCaptured();

    // Collect text item if textarea has content
    const textValue = textarea.value.trim();
    const allItems: MediaItem[] = [...captured.items];

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

    // Transcription now lives on each AudioMediaItem (set by the media-capture
    // component). New knots leave the legacy knot-level transcription fields
    // undefined and rely on per-item transcript/status.
    const hasAudio = allItems.some((m) => m.type === 'audio');
    const transcriptionEnabled = settingsStore.getCurrent().transcriptionEnabled;

    // Derive the deferred/pending signal from the captured audio items for the
    // post-save toast messaging below.
    const hasPendingAudio = allItems.some(
      (m) => m.type === 'audio' && m.transcriptionStatus === 'pending'
    );

    const knot: Knot = {
      id: crypto.randomUUID(),
      timestamp,
      location,
      mediaItems: allItems,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await knotStore.save(knot);
    } catch (err) {
      isSaving = false;
      updateSaveBtnState();
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Knot save failed:', err);
      toastService.show(`Could not tie knot: ${detail}`, 8000);
      return;
    }

    // Emit saved event so Knots refreshes
    eventBus.emit('knot:saved', knot);

    if (hasAudio && hasPendingAudio) {
      // Craft a message that reflects WHY live transcription didn't produce text.
      let deferredMsg: string;
      if (captured.liveTranscriptionError === 'not-allowed') {
        deferredMsg =
          'Saved. Live transcription was blocked (mic permission). You can transcribe later from the knot.';
      } else if (captured.liveTranscriptionError === 'no-speech') {
        deferredMsg = 'Saved. No speech detected for live transcription.';
      } else if (transcriptionEnabled && !transcriptionService.isSupported) {
        deferredMsg = "Saved. Live transcription isn't supported in this browser.";
      } else if (!navigator.onLine) {
        deferredMsg = 'Saved. Offline — transcribe later from the knot when online.';
      } else if (transcriptionEnabled) {
        // Live was attempted online with no specific error, but produced no text —
        // most likely the mic-sharing platform constraint (e.g. Android Chrome).
        deferredMsg =
          "Saved. Live transcription didn't work on this device — open the knot and tap 'Transcribe voice' to transcribe it via your server.";
      } else {
        deferredMsg =
          'Saved. Voice transcription was unavailable — you can transcribe later from the knot.';
      }
      toastService.show(deferredMsg, 6000);
    }

    // Cloud backup upload is triggered by the app-level knot:saved listener
    // (src/app.ts), which covers every save path (capture, edit, transcribe).

    navigate('#/knots');
  };

  saveBtn.addEventListener('click', () => void onSaveClick());
  listenerCleanups.push(() => saveBtn.removeEventListener('click', () => void onSaveClick()));

  // ---- Cleanup ----
  return () => {
    // Tear down the media capture component (stops recording/recognition,
    // revokes object URLs, removes its listeners).
    mediaCapture.destroy();

    // Remove event listeners
    for (const cleanup of listenerCleanups) cleanup();

    root.remove();
  };
}
