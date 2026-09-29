// ============================================================
// e-Handkerchief — ConflictScreen
// Reviews a knot that was edited on two devices since they last synced. Shows
// a diff between this device's version and the latest cloud version and lets
// the user keep either one, or both. Nothing is ever resolved silently.
// Route: #/conflict/{knotId}
// ============================================================

import { knotStore } from '../knotStore.js';
import { navigate } from '../router.js';
import { toastService } from '../toastService.js';
import { formatKnotTimestamp } from '../dateFormat.js';
import { cloudSyncService } from '../cloudSyncService.js';
import { diffKnots, diffLines, type KnotDiff, type LineDiffOp } from '../knotDiff.js';
import type {
  Knot,
  KnotLocation,
  AudioMediaItem,
  PhotoMediaItem,
  TextMediaItem,
  VideoMediaItem,
} from '../types.js';

type Choice = 'local' | 'remote' | 'both';

/** "12 Sep 2026 14:02" in the user's date/time/timezone settings, from Unix ms. */
function formatMs(ms: number): string {
  return formatKnotTimestamp(new Date(ms).toISOString());
}

/** One-line description of a location for the diff. */
function describeLocation(loc: KnotLocation | null): string {
  if (!loc) return '(none)';
  const coords = `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
  return loc.resolvedAddress ? `${loc.resolvedAddress} (${coords})` : coords;
}

/** Line diff that doesn't show a phantom blank line for an empty side. */
function safeLineDiff(local: string, remote: string): LineDiffOp[] {
  const ops = diffLines(local, remote);
  if (local === '') return ops.filter((o) => o.op !== 'del');
  if (remote === '') return ops.filter((o) => o.op !== 'add');
  return ops;
}

export function renderConflict(container: HTMLElement, params: Record<string, string>): () => void {
  const knotId = params['id'];
  const objUrls: string[] = [];
  let disposed = false;

  function trackUrl(url: string): string {
    objUrls.push(url);
    return url;
  }
  function clearUrls(): void {
    for (const url of objUrls.splice(0)) URL.revokeObjectURL(url);
  }

  const root = document.createElement('div');
  root.className = 'conflict-screen';

  const headerEl = document.createElement('div');
  headerEl.className = 'knot-detail-header';
  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.textContent = '← Back to Knots';
  backBtn.addEventListener('click', () => navigate('#/knots'));
  headerEl.appendChild(backBtn);
  root.appendChild(headerEl);

  const titleEl = document.createElement('h1');
  titleEl.className = 'page-title';
  titleEl.textContent = 'Review changes';
  root.appendChild(titleEl);

  const contentEl = document.createElement('div');
  root.appendChild(contentEl);

  container.appendChild(root);

  // ---------- small DOM helpers ----------

  function showMessage(text: string): void {
    clearUrls();
    contentEl.textContent = '';
    const msg = document.createElement('p');
    msg.className = 'text-muted';
    msg.textContent = text;
    contentEl.appendChild(msg);
  }

  function makeSection(title: string, modifier?: 'add' | 'del'): HTMLElement {
    const section = document.createElement('div');
    section.className = 'diff-section' + (modifier ? ` diff-section--${modifier}` : '');
    const h = document.createElement('h2');
    h.className = 'diff-section-title';
    h.textContent = title;
    section.appendChild(h);
    return section;
  }

  function renderLines(ops: LineDiffOp[]): HTMLElement {
    const box = document.createElement('div');
    box.className = 'diff-lines';
    for (const op of ops) {
      const line = document.createElement('div');
      line.className = `diff-line diff-line--${op.op}`;
      const marker = document.createElement('span');
      marker.className = 'diff-marker';
      marker.textContent = op.op === 'add' ? '+' : op.op === 'del' ? '−' : ' ';
      const text = document.createElement('span');
      text.className = 'diff-text';
      text.textContent = op.text === '' ? ' ' : op.text;
      line.appendChild(marker);
      line.appendChild(text);
      box.appendChild(line);
    }
    return box;
  }

  /** A one-sided block (text or media) tagged with a +/− marker. */
  function makeSideBlock(side: 'add' | 'del'): HTMLElement {
    const block = document.createElement('div');
    block.className = `diff-block diff-line--${side}`;
    const marker = document.createElement('span');
    marker.className = 'diff-marker';
    marker.textContent = side === 'add' ? '+' : '−';
    block.appendChild(marker);
    return block;
  }

  function mediaThumb(item: PhotoMediaItem | VideoMediaItem): HTMLElement {
    const img = document.createElement('img');
    img.className = 'diff-thumb';
    img.src = trackUrl(URL.createObjectURL(item.thumbnailBlob));
    img.alt = item.type === 'photo' ? 'Photo' : 'Video';
    img.width = 80;
    img.height = 80;
    return img;
  }

  /** Everything that exists on only one side, rendered as one section. */
  function renderOneSided(
    title: string,
    side: 'add' | 'del',
    texts: TextMediaItem[],
    photos: PhotoMediaItem[],
    videos: VideoMediaItem[],
    audios: AudioMediaItem[]
  ): HTMLElement | null {
    if (texts.length + photos.length + videos.length + audios.length === 0) return null;
    const section = makeSection(title, side);

    for (const t of texts) {
      const block = makeSideBlock(side);
      const text = document.createElement('span');
      text.className = 'diff-text';
      text.textContent = t.content;
      block.appendChild(text);
      section.appendChild(block);
    }
    if (photos.length + videos.length > 0) {
      const block = makeSideBlock(side);
      const thumbs = document.createElement('div');
      thumbs.className = 'diff-thumbs';
      for (const p of photos) thumbs.appendChild(mediaThumb(p));
      for (const v of videos) thumbs.appendChild(mediaThumb(v));
      block.appendChild(thumbs);
      section.appendChild(block);
    }
    for (const a of audios) {
      const block = makeSideBlock(side);
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = trackUrl(URL.createObjectURL(a.blob));
      block.appendChild(audio);
      section.appendChild(block);
    }
    return section;
  }

  function renderDiff(diff: KnotDiff): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'diff';

    if (diff.identical) {
      const same = document.createElement('p');
      same.className = 'text-muted';
      same.textContent = 'The content is the same; only the edit times differ.';
      wrap.appendChild(same);
      return wrap;
    }

    // Changed text (line diff)
    if (diff.text.changed.length > 0) {
      const section = makeSection('Changed text');
      const legend = document.createElement('div');
      legend.className = 'settings-row-desc';
      legend.textContent =
        '− marks lines only on this device. + marks lines only in the cloud version.';
      section.appendChild(legend);
      for (const change of diff.text.changed) {
        section.appendChild(renderLines(change.lines));
      }
      wrap.appendChild(section);
    }

    // Items that exist on only one side
    const onlyHere = renderOneSided(
      'Only on this device',
      'del',
      diff.text.onlyOnThisDevice,
      diff.photos.onlyOnThisDevice,
      diff.videos.onlyOnThisDevice,
      diff.audios.onlyOnThisDevice
    );
    if (onlyHere) wrap.appendChild(onlyHere);
    const onlyCloud = renderOneSided(
      'Only in the cloud',
      'add',
      diff.text.onlyInCloud,
      diff.photos.onlyInCloud,
      diff.videos.onlyInCloud,
      diff.audios.onlyInCloud
    );
    if (onlyCloud) wrap.appendChild(onlyCloud);

    // Transcripts
    if (diff.transcripts.length > 0) {
      const section = makeSection('Transcripts');
      for (const t of diff.transcripts) {
        section.appendChild(renderLines(safeLineDiff(t.local, t.remote)));
      }
      wrap.appendChild(section);
    }

    // Location
    if (diff.location) {
      const section = makeSection('Location');
      section.appendChild(
        renderLines([
          { op: 'del', text: describeLocation(diff.location.local) },
          { op: 'add', text: describeLocation(diff.location.remote) },
        ])
      );
      wrap.appendChild(section);
    }

    // Manual label
    if (diff.manualLabel) {
      const section = makeSection('Location label');
      section.appendChild(
        renderLines([
          { op: 'del', text: diff.manualLabel.local || '(none)' },
          { op: 'add', text: diff.manualLabel.remote || '(none)' },
        ])
      );
      wrap.appendChild(section);
    }

    return wrap;
  }

  // ---------- load + render ----------

  function renderReview(local: Knot, remote: { knot: Knot; updatedAt: number; editedOn: string | null }): void {
    clearUrls();
    contentEl.textContent = '';

    // Which version is which, and when each was last edited.
    const meta = document.createElement('div');
    meta.className = 'conflict-meta';
    const localLine = document.createElement('div');
    localLine.textContent = `On this device · ${formatMs(local.updatedAt)}`;
    const remoteLine = document.createElement('div');
    remoteLine.textContent = `Latest in the cloud · Edited on ${remote.editedOn ?? 'another device'} · ${formatMs(remote.updatedAt)}`;
    meta.appendChild(localLine);
    meta.appendChild(remoteLine);
    contentEl.appendChild(meta);

    contentEl.appendChild(renderDiff(diffKnots(local, remote.knot)));

    // Resolution buttons
    const actions = document.createElement('div');
    actions.className = 'conflict-actions';

    const buttons: HTMLButtonElement[] = [];
    function addButton(label: string, choice: Choice, cls: string): void {
      const btn = document.createElement('button');
      btn.className = `btn ${cls} btn-full`;
      btn.textContent = label;
      btn.addEventListener('click', () => void resolve(choice));
      buttons.push(btn);
      actions.appendChild(btn);
    }
    addButton("Keep this device's version", 'local', 'btn-primary');
    addButton('Keep the cloud version', 'remote', 'btn-ghost');
    addButton('Keep both', 'both', 'btn-ghost');
    contentEl.appendChild(actions);

    const hint = document.createElement('div');
    hint.className = 'settings-row-desc mt-sm';
    hint.textContent = 'Keep both keeps this version and saves the cloud version as a new knot.';
    contentEl.appendChild(hint);

    function setBusy(busy: boolean): void {
      for (const b of buttons) b.disabled = busy;
    }

    async function resolve(choice: Choice): Promise<void> {
      setBusy(true);
      try {
        const result = await cloudSyncService.resolveConflict(local.id, choice, remote.updatedAt);
        if (disposed) return;
        if (result.ok) {
          toastService.show(
            choice === 'local'
              ? "Kept this device's version"
              : choice === 'remote'
              ? 'Kept the cloud version'
              : 'Kept both versions'
          );
          navigate(choice === 'both' ? '#/knots' : `#/knot/${local.id}`);
        } else {
          toastService.show('This knot changed again on another device — please review the latest version');
          await load();
        }
      } catch (err) {
        console.warn('Resolving the conflict failed:', err);
        toastService.show("Couldn't finish — please try again. Nothing was deleted.");
        if (!disposed) setBusy(false);
      }
    }
  }

  async function load(): Promise<void> {
    if (!knotId) {
      navigate('#/knots');
      return;
    }

    const loading = document.createElement('div');
    loading.className = 'loading-state';
    const spinner = document.createElement('div');
    spinner.className = 'spinner spinner--lg';
    loading.appendChild(spinner);
    contentEl.textContent = '';
    contentEl.appendChild(loading);

    let local: Knot | undefined;
    let hasConflict = false;
    try {
      local = await knotStore.get(knotId);
      if (local) {
        const conflicts = await cloudSyncService.listConflicts();
        hasConflict = conflicts.some((c) => c.knotId === knotId);
      }
    } catch (err) {
      console.warn('Could not load the knot for review:', err);
    }
    if (disposed) return;
    if (!local || !hasConflict) {
      navigate('#/knots');
      return;
    }

    try {
      const remote = await cloudSyncService.fetchRemoteKnot(knotId);
      if (disposed) return;
      renderReview(local, remote);
    } catch (err) {
      console.warn('Could not fetch the cloud version:', err);
      if (disposed) return;
      showMessage('Connect to the internet to review this knot');
    }
  }

  void load();

  return () => {
    disposed = true;
    clearUrls();
    root.remove();
  };
}
