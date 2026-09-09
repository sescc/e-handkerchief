// ============================================================
// e-Handkerchief — EmailQueue
// Persists outbound email jobs in IndexedDB and delivers them
// via a relay endpoint (if configured) or a mailto: fallback.
// Retries up to 3 times before marking the job "failed".
// ============================================================

import { openDB, dbPut, dbDelete, dbGetAllByIndex } from './db.js';
import { toastService } from './toastService.js';
import type { Note, EmailJob, TextMediaItem } from './types.js';

const RELAY_ENDPOINT =
  (window as Window & typeof globalThis & { __EMAIL_RELAY__?: string }).__EMAIL_RELAY__ ?? '';

export interface EmailQueueAPI {
  enqueue(note: Note, recipient: string): Promise<void>;
  flush(): Promise<void>;
}

export const emailQueue: EmailQueueAPI = {
  async enqueue(note: Note, recipient: string): Promise<void> {
    const db = await openDB();

    const textContent = note.mediaItems
      .filter((m): m is TextMediaItem => m.type === 'text')
      .map((m) => m.content)
      .join('\n\n');

    const ts = new Date(note.timestamp.localISO);
    const subject = `e-Handkerchief note — ${ts.toLocaleString()}`;

    const location = note.location
      ? (note.location.resolvedAddress ??
          `${note.location.latitude.toFixed(5)}, ${note.location.longitude.toFixed(5)}`)
      : 'Location unavailable';

    const bodyParts: string[] = [
      `Time: ${ts.toLocaleString()}`,
      `Location: ${location}`,
      '',
    ];
    if (textContent) bodyParts.push(textContent);
    if (note.transcription) bodyParts.push('', `Transcription:`, note.transcription);
    const bodyText = bodyParts.join('\n');

    const job: EmailJob = {
      id: crypto.randomUUID(),
      noteId: note.id,
      recipient,
      subject,
      bodyText,
      attachmentRefs: note.mediaItems.map((m) => m.id),
      createdAt: Date.now(),
      attempts: 0,
      lastAttemptAt: null,
      status: 'pending',
    };

    await dbPut(db, 'emailJobs', job);
  },

  async flush(): Promise<void> {
    const db = await openDB();
    const pending = await dbGetAllByIndex<EmailJob>(
      db,
      'emailJobs',
      'status',
      IDBKeyRange.only('pending')
    );

    if (pending.length === 0) return;

    for (const job of pending) {
      const inFlight: EmailJob = {
        ...job,
        status: 'in-flight',
        attempts: job.attempts + 1,
        lastAttemptAt: Date.now(),
      };
      await dbPut(db, 'emailJobs', inFlight);

      let delivered = false;

      if (RELAY_ENDPOINT) {
        try {
          const res = await fetch(RELAY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: job.recipient,
              subject: job.subject,
              text: job.bodyText,
            }),
          });
          delivered = res.ok;
        } catch {
          // network error — fall through to retry logic
        }
      } else {
        // No relay configured — use mailto: fallback (opens device mail client)
        const mailto =
          `mailto:${encodeURIComponent(job.recipient)}` +
          `?subject=${encodeURIComponent(job.subject)}` +
          `&body=${encodeURIComponent(job.bodyText)}`;
        window.location.href = mailto;
        delivered = true; // assume user sent it via the mail client
      }

      if (delivered) {
        await dbDelete(db, 'emailJobs', job.id);
      } else {
        if (inFlight.attempts >= 3) {
          const failed: EmailJob = { ...inFlight, status: 'failed' };
          await dbPut(db, 'emailJobs', failed);
          toastService.showPersistent('Email could not be sent — tap to retry');
        } else {
          // Back to pending for the next flush attempt
          const retry: EmailJob = { ...inFlight, status: 'pending' };
          await dbPut(db, 'emailJobs', retry);
        }
      }
    }
  },
};
