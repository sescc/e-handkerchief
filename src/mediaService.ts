// ============================================================
// e-Handkerchief — MediaService
// Wraps MediaRecorder and HTML Media Capture APIs.
// ============================================================

import { classifyImport } from './mediaImport.js';
import type { ImportClassification, ImportKind } from './mediaImport.js';

/** Kinds the Photo/Video capture buttons accept (as before, either may yield a photo or video). */
const PHOTO_VIDEO: readonly ImportKind[] = ['photo', 'video'];

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

/** Thrown when a picked file's bytes cannot be read (e.g. a cloud-backed file still downloading). */
export class FileReadError extends Error {
  constructor() {
    super('Could not read the selected file');
    this.name = 'FileReadError';
  }
}

const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Validate a Blob/File before attaching it to a knot. The file name is needed
 * because external recorders' .m4a files are often reported with a wrong or
 * empty MIME type (see classifyImport).
 * Throws FileSizeError or UnsupportedFormatError; otherwise returns the
 * classification (kind + the MIME type the item should be stored with).
 */
export function validateMedia(blob: Blob | File): ImportClassification {
  if (blob.size > MAX_SIZE_BYTES) throw new FileSizeError();
  const name = (blob as File).name ?? '';
  const classified = classifyImport(blob.type, name);
  if (!classified) throw new UnsupportedFormatError(blob.type);
  return classified;
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
  /** Library picker limited to photos and videos. */
  pickPhotoOrVideo(): Promise<Blob>;
  /** File picker limited to audio files Whisper can transcribe. */
  pickAudioFile(): Promise<Blob>;
  generateThumbnail(source: Blob): Promise<Blob>;
}

export const mediaService: MediaServiceAPI = {
  async startAudioRecording(): Promise<AudioRecordingHandle> {
    if (typeof MediaRecorder === 'undefined') {
      throw new MediaUnsupportedError();
    }

    // Call-style processing (echo cancellation, noise suppression, AGC) is
    // switched off: it is tuned for two-way calls, gates/pumps the signal into
    // audible glitches, and on Android echoCancellation also routes capture
    // through the voice-call mic path. To revert (e.g. if some phones record
    // too quietly without AGC), change the constraints below to `{ audio: true }`.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      // Permission problems propagate unchanged (callers show the mic message).
      if (name === 'NotAllowedError' || name === 'SecurityError') throw err;
      // Any other failure (e.g. unsupported constraints): retry once plainly.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    // Prefer Opus-in-WebM, then MP4; 128 kbps keeps speech clean.
    const supported =
      typeof MediaRecorder.isTypeSupported === 'function'
        ? (['audio/webm;codecs=opus', 'audio/mp4'] as const).find((t) =>
            MediaRecorder.isTypeSupported(t)
          )
        : undefined;
    let recorder: MediaRecorder;
    try {
      recorder = supported
        ? new MediaRecorder(stream, { mimeType: supported, audioBitsPerSecond: 128000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 128000 });
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        throw err;
      }
    }
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
        const mimeType = chunks[0]?.type || recorder.mimeType || 'audio/webm';
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
    return pickFile('image/*', PHOTO_VIDEO, 'environment');
  },

  captureVideo(): Promise<Blob> {
    return pickFile('video/*', PHOTO_VIDEO, 'environment');
  },

  pickPhotoOrVideo(): Promise<Blob> {
    // Photo/video types only, so Android opens its photo picker.
    return pickFile(
      'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime',
      PHOTO_VIDEO
    );
  },

  pickAudioFile(): Promise<Blob> {
    // A single `audio/*` filter: Android maps audio extensions inconsistently,
    // so a narrower list could grey out real files. classifyImport (via
    // validateMedia) rejects the unsupported ones after picking.
    return pickFile('audio/*', ['audio']);
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
      // Centre-crop ("cover") into the 80x80 canvas rather than stretching;
      // falls back to the old stretch if the natural size is unknown (0).
      const drawCover = (src: CanvasImageSource, w: number, h: number) => {
        if (w > 0 && h > 0) {
          const side = Math.min(w, h);
          ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 80, 80);
        } else {
          ctx.drawImage(src, 0, 0, 80, 80);
        }
      };
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
          drawCover(video, video.videoWidth, video.videoHeight);
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
          drawCover(img, img.naturalWidth, img.naturalHeight);
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
function pickFile(
  accept: string,
  allowedKinds: readonly ImportKind[],
  capture?: string
): Promise<Blob> {
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
      let mimeType: string;
      try {
        const classified = validateMedia(file);
        // e.g. an .m4a picked through the Photo/Video button must not become a
        // photo/video item.
        if (!allowedKinds.includes(classified.kind)) throw new UnsupportedFormatError(file.type);
        mimeType = classified.mimeType;
      } catch (e) {
        reject(e);
        return;
      }
      // Read the bytes into memory now (the size cap above bounds this).
      // Files from Android's picker / cloud providers (e.g. Google Photos) are
      // lazy references: IndexedDB would otherwise read them at save time and
      // fail with InvalidBlob if the provider can't deliver them then. The
      // fresh Blob is always memory-backed, and carries the normalised type
      // (e.g. for an .m4a reported as '' or audio/x-m4a).
      file.arrayBuffer().then(
        (buf) => resolve(new Blob([buf], { type: mimeType })),
        () => reject(new FileReadError())
      );
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
