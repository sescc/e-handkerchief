// ============================================================
// e-Handkerchief — TranscriptionService
// Live Web Speech API wrapper. Recognition runs concurrently with
// microphone recording (the Web Speech API processes live mic input,
// not pre-recorded Blobs), accumulating final results until stopped.
// ============================================================

export interface LiveTranscriptionHandle {
  /** Resolves with the accumulated final transcript when stop() is called (or null). */
  readonly result: Promise<string | null>;
  /** Stop live recognition and resolve `result`. */
  stop(): void;
}

export interface TranscriptionServiceAPI {
  readonly isSupported: boolean;
  /**
   * Start live speech recognition. Call stop() when the recording stops.
   * Accumulates final results; resolves with the combined transcript.
   * Returns null result on error/unsupported.
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
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
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

/** A no-op handle used when recognition is unsupported or fails to start. */
function nullHandle(): LiveTranscriptionHandle {
  return {
    result: Promise.resolve(null),
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
    if (!SpeechRecognitionCtor) return nullHandle();

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';

    let accumulated = '';
    let resolved = false;
    let resolveResult!: (value: string | null) => void;
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
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const entry = event.results[i];
        if (entry && entry.isFinal) {
          const piece = entry[0]?.transcript ?? '';
          if (piece) accumulated += (accumulated ? ' ' : '') + piece.trim();
        }
      }
    };

    recognition.onerror = (): void => {
      finish();
    };

    recognition.onend = (): void => {
      finish();
    };

    try {
      recognition.start();
    } catch {
      return nullHandle();
    }

    return {
      result,
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
