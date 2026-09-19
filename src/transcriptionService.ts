// ============================================================
// e-Handkerchief — TranscriptionService
// Live Web Speech API wrapper. Recognition runs concurrently with
// microphone recording (the Web Speech API processes live mic input,
// not pre-recorded Blobs), accumulating final results until stopped.
// Interim (partial) results stream to an optional onText listener so
// callers can show live feedback; the last error code is surfaced so
// callers can craft accurate messaging.
// ============================================================

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
      const text = [committed, instanceFinal].filter(Boolean).join(' ').trim();
      resolveResult(text.length > 0 ? text : null);
      for (const cb of endListeners) cb();
    };

    // Fold the current instance's finalized text into the committed buffer,
    // then reset per-instance state for the next recognition instance.
    const foldInstanceIntoCommitted = (): void => {
      if (instanceFinal) {
        committed = [committed, instanceFinal].filter(Boolean).join(' ');
      }
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
        // FIX Bug 2 — rebuild (do NOT append). Scan the ENTIRE results list
        // from index 0 each event; a re-delivered final segment overwrites.
        let finalText = '';
        let interimText = '';
        for (let i = 0; i < event.results.length; i++) {
          const entry = event.results[i];
          if (!entry) continue;
          const piece = entry[0]?.transcript ?? '';
          if (!piece) continue;
          if (entry.isFinal) {
            finalText += (finalText ? ' ' : '') + piece.trim();
          } else {
            interimText += piece;
          }
        }
        instanceFinal = finalText;
        instanceInterim = interimText;
        const liveText = [committed, instanceFinal, instanceInterim]
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
        }
      },
    };
  },
};
