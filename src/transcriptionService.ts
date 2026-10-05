// ============================================================
// e-Handkerchief — TranscriptionService
// Live Web Speech API wrapper. Recognition runs concurrently with
// microphone recording (the Web Speech API processes live mic input,
// not pre-recorded Blobs), accumulating final results until stopped.
// Interim (partial) results stream to an optional onText listener so
// callers can show live feedback; the last error code is surfaced so
// callers can craft accurate messaging. Final pieces are merged with the
// pure word-level helpers in transcriptMerge.ts: within one recognition instance
// engine revisions of earlier words are absorbed; across auto-restarts the join
// is conservative (never revises) so a new sentence is never lost.
// ============================================================

import { foldSegment, mergeFinalPieces } from './transcriptMerge.js';

export interface LiveTranscriptionHandle {
  /** Resolves with the accumulated FINAL transcript when stopped (or null if none). */
  readonly result: Promise<string | null>;
  /** Register a callback to receive live text (final + interim) as the user speaks. */
  onText(cb: (liveText: string) => void): void;
  /** Register a callback fired when recognition errors (receives the error code). */
  onError(cb: (errorCode: string) => void): void;
  /** Register a callback fired when recognition ends (after final result resolution). */
  onEnd(cb: () => void): void;
  /** The last recognition error code, if any (e.g. 'not-allowed', 'no-speech'). Null if none. */
  getError(): string | null;
  /** Stop live recognition and resolve `result`. */
  stop(): void;
}

export interface TranscriptionServiceAPI {
  readonly isSupported: boolean;
  /**
   * Start live speech recognition. Call stop() when the recording stops.
   * Accumulates final results; resolves with the combined transcript.
   * Streams live (final + interim) text through onText listeners.
   * Returns a null handle on error/unsupported.
   */
  startLive(): LiveTranscriptionHandle;
}

// ---------------------------------------------------------------------------
// Minimal Web Speech API typings — not present in this TypeScript DOM lib.
// ---------------------------------------------------------------------------
interface SpeechRecognitionResultLike {
  readonly transcript: string;
}
interface SpeechRecognitionResultEntry {
  readonly [index: number]: SpeechRecognitionResultLike;
  readonly isFinal: boolean;
}
interface SpeechRecognitionResultList {
  readonly [index: number]: SpeechRecognitionResultEntry;
  readonly length: number;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** After stop(), force-finish if the engine never fires onend (it would otherwise hang the save). */
const STOP_SAFETY_MS = 3000;

// Detect SpeechRecognition availability (standard + webkit-prefixed)
const SpeechRecognitionCtor: (new () => SpeechRecognitionLike) | undefined =
  (
    window as Window &
      typeof globalThis & {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }
  ).SpeechRecognition ??
  (
    window as Window &
      typeof globalThis & {
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }
  ).webkitSpeechRecognition;

/**
 * A no-op handle used when recognition is unsupported or fails to start.
 * @param errorCode surfaced via getError() so callers can craft messaging.
 */
function nullHandle(errorCode: string): LiveTranscriptionHandle {
  return {
    result: Promise.resolve(null),
    onText(): void {
      /* no-op */
    },
    onError(cb: (errorCode: string) => void): void {
      // Fire on the next microtask so late-registered listeners still receive it.
      queueMicrotask(() => cb(errorCode));
    },
    onEnd(cb: () => void): void {
      queueMicrotask(cb);
    },
    getError(): string | null {
      return errorCode;
    },
    stop(): void {
      /* no-op */
    },
  };
}

export const transcriptionService: TranscriptionServiceAPI = {
  get isSupported(): boolean {
    return !!SpeechRecognitionCtor;
  },

  startLive(): LiveTranscriptionHandle {
    if (!SpeechRecognitionCtor) return nullHandle('unsupported');

    // Session state that survives auto-restarts.
    // `committed` holds FINALIZED text accumulated across ALL recognition
    // instances (each restart folds its final text in here). Each individual
    // recognition instance tracks its own final/interim, rebuilt from the full
    // results list on every event (never appended) so re-delivered/re-finalized
    // results on mobile Chrome overwrite rather than duplicate.
    let stopped = false;
    let committed = '';
    let instanceFinal = '';
    let instanceInterim = '';
    let currentRecognition: SpeechRecognitionLike | null = null;
    let lastError: string | null = null;
    let resolved = false;
    let stopSafetyTimer: ReturnType<typeof setTimeout> | null = null;
    let resolveResult!: (value: string | null) => void;
    const textListeners: Array<(liveText: string) => void> = [];
    const errorListeners: Array<(code: string) => void> = [];
    const endListeners: Array<() => void> = [];
    const result = new Promise<string | null>((resolve) => {
      resolveResult = resolve;
    });

    // Resolve `result` exactly once with committed + any not-yet-folded
    // finalized text from the current instance. Fires end listeners.
    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      if (stopSafetyTimer !== null) {
        clearTimeout(stopSafetyTimer);
        stopSafetyTimer = null;
      }
      // Same conservative cross-instance merge as folding, so the SAVED text has no
      // duplication when committed already holds (part of) the current
      // instance's finalized text.
      const text = foldSegment(committed, instanceFinal).trim();
      resolveResult(text.length > 0 ? text : null);
      for (const cb of endListeners) cb();
    };

    // Fold the current instance's finalized text into the committed buffer,
    // then reset per-instance state for the next recognition instance.
    // Only instanceFinal is ever folded (interim must never leak into
    // committed). foldSegment absorbs re-delivered / partly overlapping /
    // revised tails so committed doesn't get duplicated words.
    const foldInstanceIntoCommitted = (): void => {
      committed = foldSegment(committed, instanceFinal);
      instanceFinal = '';
      instanceInterim = '';
    };

    // Create a fresh SpeechRecognition, wire handlers, and start it.
    // Returns false (and finishes the session) if start() throws.
    const startInstance = (): boolean => {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';

      recognition.onresult = (event: SpeechRecognitionEventLike): void => {
        // FIX Bug 2 — rebuild the instance transcript FULLY each event (never
        // append across events) so re-delivered results overwrite rather than
        // duplicate. This must be robust to two engine behaviours:
        //  (a) well-behaved/positional engines: each results entry is a
        //      distinct, non-overlapping segment.
        //  (b) this device's cumulative/growing entries: interim (and
        //      sometimes final) entries each hold the full running partial,
        //      e.g. entry0="1", entry1="1 2", entry2="1 2 3". Concatenating
        //      those yields the "1 1 2 1 2 3 ..." duplication we are fixing.

        // Collect every FINAL piece once, in index order (trimmed, non-empty).
        const finalPieces: string[] = [];
        // Track the SINGLE last (highest-index) non-final entry — on cumulative
        // engines that entry already holds the full running partial; on
        // positional engines the last interim is still the correct current
        // partial. We deliberately do NOT accumulate all interim entries.
        let lastInterim = '';
        for (let i = 0; i < event.results.length; i++) {
          const entry = event.results[i];
          if (!entry) continue;
          const piece = (entry[0]?.transcript ?? '').trim();
          if (!piece) continue;
          if (entry.isFinal) {
            finalPieces.push(piece);
          } else {
            lastInterim = piece;
          }
        }

        // Merge finalized pieces: cumulative growth collapses to the longest,
        // revised earlier words replace the old wording, distinct segments join.
        instanceFinal = mergeFinalPieces(finalPieces);
        // Interim is ONLY the latest partial (replaces, never accumulates).
        instanceInterim = lastInterim;

        const liveText = [foldSegment(committed, instanceFinal), instanceInterim]
          .filter(Boolean)
          .join(' ')
          .trim();
        for (const cb of textListeners) cb(liveText);
      };

      // Store the error reason and notify listeners; do NOT finish here.
      // Permission errors are unrecoverable → set stopped so the ensuing
      // onend finishes rather than auto-restarts. Other errors leave
      // stopped as-is so onend's auto-restart continues the session.
      recognition.onerror = (event: SpeechRecognitionErrorEventLike): void => {
        // Late events after the session finished (e.g. 'aborted' dispatched
        // after the stop safety cap's abort()) are ignored.
        if (resolved) return;
        lastError = event.error;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          stopped = true;
        }
        for (const cb of errorListeners) cb(event.error);
      };

      recognition.onend = (): void => {
        if (stopped) {
          // Terminal end: user stopped or unrecoverable error.
          finish();
          return;
        }
        // FIX Bug 3 — auto-restart: mobile Chrome ends after ~1s silence.
        // Fold this instance's final text into committed, then start anew.
        foldInstanceIntoCommitted();
        startInstance();
      };

      currentRecognition = recognition;
      try {
        recognition.start();
      } catch {
        // Guard against tight restart loops: if starting throws, surface it
        // via the error path and finish rather than spinning.
        lastError = lastError ?? 'start-failed';
        stopped = true;
        finish();
        return false;
      }
      return true;
    };

    if (!startInstance()) {
      // First-instance start failed synchronously → null handle (as today).
      return nullHandle('start-failed');
    }

    return {
      result,
      onText(cb: (liveText: string) => void): void {
        textListeners.push(cb);
      },
      onError(cb: (errorCode: string) => void): void {
        errorListeners.push(cb);
      },
      onEnd(cb: () => void): void {
        endListeners.push(cb);
      },
      getError(): string | null {
        return lastError;
      },
      stop(): void {
        stopped = true;
        try {
          currentRecognition?.stop();
        } catch {
          finish();
          return;
        }
        // Some engines never fire onend after stop(), which would leave
        // `result` pending forever and block saving the recording. Force-finish
        // with whatever text was collected. `stopped` is already true, so no
        // restart can happen; finish() is idempotent against a late onend.
        if (!resolved && stopSafetyTimer === null) {
          stopSafetyTimer = setTimeout(() => {
            stopSafetyTimer = null;
            if (resolved) return;
            try {
              currentRecognition?.abort();
            } catch {
              /* already stopped */
            }
            finish();
          }, STOP_SAFETY_MS);
        }
      },
    };
  },
};
