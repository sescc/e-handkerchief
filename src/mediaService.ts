// ============================================================
// e-Handkerchief — MediaService
// Wraps MediaRecorder and HTML Media Capture APIs.
// ============================================================

/** Thrown when the browser does not support MediaRecorder. */
export class MediaUnsupportedError extends Error {
  constructor(msg = 'Media recording is not supported in this browser') {
    super(msg);
    this.name = 'MediaUnsupportedError';
  }
}

/** Thrown when a file exceeds the 100 MB size limit. */
export class FileSizeError extends Error {
  constructor() {
    super('File exceeds the 100 MB size limit');
    this.name = 'FileSizeError';
  }
}

/** Thrown when a file's MIME type is not in the accepted set. */
export class UnsupportedFormatError extends Error {
  constructor(type: string) {
    super(`Unsupported file format: ${type || '(unknown)'}`);
    this.name = 'UnsupportedFormatError';
  }
}

const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
] as const;

const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Validate a Blob before attaching it to a note.
 * Throws FileSizeError or UnsupportedFormatError; otherwise returns void.
 */
export function validateMedia(blob: Blob): void {
  if (blob.size > MAX_SIZE_BYTES) throw new FileSizeError();
  if (!(ALLOWED_MIME as readonly string[]).includes(blob.type)) {
    throw new UnsupportedFormatError(blob.type);
  }
}

export interface AudioRecordingHandle {
  /** Resolves with the recorded audio Blob when recording stops. */
  readonly result: Promise<Blob>;
  /**
   * Register a callback that receives the elapsed recording time (in seconds).
   * Called at most every 1 second.
   */
  onElapsed(cb: (seconds: number) => void): void;
  /** Stop the recording. Safe to call more than once. */
  stop(): void;
}

export interface MediaServiceAPI {
  startAudioRecording(): Promise<AudioRecordingHandle>;
  capturePhoto(): Promise<Blob>;
  captureVideo(): Promise<Blob>;
  pickFromLibrary(): Promise<Blob>;
  generateThumbnail(source: Blob): Promise<Blob>;
}

export const mediaService: MediaServiceAPI = {
  async startAudioRecording(): Promise<AudioRecordingHandle> {
    if (typeof MediaRecorder === 'undefined') {
      throw new MediaUnsupportedError();
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    let elapsedCb: ((s: number) => void) | null = null;
    let elapsed = 0;
    let stopped = false;

    const result = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        clearInterval(interval);
        stream.getTracks().forEach((t) => t.stop());
        const mimeType = chunks[0]?.type || 'audio/webm';
        resolve(new Blob(chunks, { type: mimeType }));
      };
    });

    // eslint-disable-next-line prefer-const
    let interval: ReturnType<typeof setInterval>;

    interval = setInterval(() => {
      elapsed++;
      if (elapsedCb) elapsedCb(elapsed);
      // Auto-stop at 600 seconds (10 minutes)
      if (elapsed >= 600 && !stopped) {
        handle.stop();
      }
    }, 1000);

    recorder.start();

    const handle: AudioRecordingHandle = {
      result,
      onElapsed(cb: (seconds: number) => void): void {
        elapsedCb = cb;
      },
      stop(): void {
        if (!stopped) {
          stopped = true;
          clearInterval(interval);
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        }
      },
    };

    return handle;
  },

  capturePhoto(): Promise<Blob> {
    return pickFile('image/*', 'environment');
  },

  captureVideo(): Promise<Blob> {
    return pickFile('video/*', 'environment');
  },

  pickFromLibrary(): Promise<Blob> {
    return pickFile(
      'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime'
    );
  },

  generateThumbnail(source: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(source);
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Could not get canvas 2D context'));
        return;
      }

      const cleanup = () => URL.revokeObjectURL(url);
      const exportBlob = () => {
        canvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error('canvas.toBlob() returned null'));
          },
          'image/jpeg',
          0.8
        );
      };

      if (source.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.muted = true;
        video.src = url;
        video.onloadeddata = () => {
          video.currentTime = 0;
        };
        video.onseeked = () => {
          ctx.drawImage(video, 0, 0, 80, 80);
          cleanup();
          exportBlob();
        };
        video.onerror = () => {
          cleanup();
          reject(new Error('Failed to load video for thumbnail'));
        };
      } else {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, 80, 80);
          cleanup();
          exportBlob();
        };
        img.onerror = () => {
          cleanup();
          reject(new Error('Failed to load image for thumbnail'));
        };
        img.src = url;
      }
    });
  },
};

// ---------------------------------------------------------------------------
// Internal helper: open a file picker <input> and resolve with the File.
// ---------------------------------------------------------------------------
function pickFile(accept: string, capture?: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    input.style.display = 'none';

    const cleanup = () => {
      input.remove();
    };

    input.onchange = () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      try {
        validateMedia(file);
        resolve(file);
      } catch (e) {
        reject(e);
      }
    };

    // Some browsers fire 'cancel' instead of a change with empty files
    input.addEventListener('cancel', () => {
      cleanup();
      reject(new Error('File selection cancelled'));
    });

    document.body.appendChild(input);
    input.click();
  });
}
