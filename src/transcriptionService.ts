// ============================================================
// e-Handkerchief — TranscriptionService
// Web Speech API wrapper with 30-second timeout guard.
//
// Note: The Web Speech API processes live microphone input, not
// pre-recorded Blobs. The audioBlob parameter is accepted for API
// consistency but is not directly fed to SpeechRecognition —
// recognition runs on live audio captured by the browser.
// ============================================================

export interface TranscriptionServiceAPI {
  /**
   * Attempt to transcribe audio. Resolves with the transcript string
   * or null on timeout, error, or unsupported browser.
   * Never rejects.
   */
  transcribe(audioBlob: Blob): Promise<string | null>;

  /** True if the Web Speech API is available in this browser. */
  readonly isSupported: boolean;
}

// ---------------------------------------------------------------------------
// Minimal Web Speech API typings — not present in this TypeScript DOM lib.
// ---------------------------------------------------------------------------
interface SpeechRecognitionResultLike {
  readonly transcript: string;
}
interface SpeechRecognitionResultEntry {
  readonly [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionResultList {
  readonly [index: number]: SpeechRecognitionResultEntry;
  readonly length: number;
}
interface SpeechRecognitionEventLike {
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

export const transcriptionService: TranscriptionServiceAPI = {
  get isSupported(): boolean {
    return !!SpeechRecognitionCtor;
  },

  transcribe(_audioBlob: Blob): Promise<string | null> {
    if (!SpeechRecognitionCtor) return Promise.resolve(null);

    return new Promise((resolve) => {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = navigator.language || 'en-US';

      let resolved = false;
      const finish = (value: string | null): void => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      const timeout = setTimeout(() => finish(null), 30_000);

      recognition.onresult = (event: SpeechRecognitionEventLike): void => {
        clearTimeout(timeout);
        const transcript = event.results[0]?.[0]?.transcript ?? null;
        finish(transcript);
      };

      recognition.onerror = (): void => {
        clearTimeout(timeout);
        finish(null);
      };

      recognition.onend = (): void => {
        clearTimeout(timeout);
        finish(null);
      };

      try {
        recognition.start();
      } catch {
        clearTimeout(timeout);
        finish(null);
      }
    });
  },
};
