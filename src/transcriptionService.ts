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

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    let accumulated = '';
    let lastError: string | null = null;
    let resolved = false;
    let resolveResult!: (value: string | null) => void;
    const textListeners: Array<(liveText: string) => void> = [];
    const result = new Promise<string | null>((resolve) => {
      resolveResult = resolve;
    });

    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      const text = accumulated.trim();
      resolveResult(text.length > 0 ? text : null);
    };

    recognition.onresult = (event: SpeechRecognitionEventLike): void => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const entry = event.results[i];
        if (!entry) continue;
        const piece = entry[0]?.transcript ?? '';
        if (entry.isFinal) {
          if (piece) accumulated += (accumulated ? ' ' : '') + piece.trim();
        } else {
          interimText += piece;
        }
      }
      const liveText = `${accumulated} ${interimText}`.trim();
      for (const cb of textListeners) cb(liveText);
    };

    // Store the error reason but do NOT finish immediately — some errors
    // (e.g. 'no-speech') can be followed by more speech. onend will fire
    // for terminating errors and resolve the promise there.
    recognition.onerror = (event: SpeechRecognitionErrorEventLike): void => {
      lastError = event.error;
    };

    recognition.onend = (): void => {
      finish();
    };

    try {
      recognition.start();
    } catch {
      return nullHandle('start-failed');
    }

    return {
      result,
      onText(cb: (liveText: string) => void): void {
        textListeners.push(cb);
      },
      getError(): string | null {
        return lastError;
      },
      stop(): void {
        try {
          recognition.stop();
        } catch {
          finish();
        }
      },
    };
  },
};
