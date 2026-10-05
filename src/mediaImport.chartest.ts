// ============================================================
// e-Handkerchief — mediaImport
// Characterization/behaviour test for `classifyImport` (pure, runs under plain
// node). Compile with tsc, then `node ./src/mediaImport.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { classifyImport } from './mediaImport.js';

let failureCount = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failureCount++;
    console.error(`FAIL  ${label}${detail ? `  -> ${detail}` : ''}`);
  }
}

function expectResult(
  label: string,
  type: string,
  name: string,
  kind: 'photo' | 'video' | 'audio' | null,
  mimeType?: string,
): void {
  const r = classifyImport(type, name);
  const ok = kind === null
    ? r === null
    : r !== null && r.kind === kind && r.mimeType === mimeType;
  check(label, ok, `got ${JSON.stringify(r)}`);
}

function main(): void {
  console.log('Characterization test: mediaImport.classifyImport');

  // Images and videos keep their own type.
  for (const t of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
    expectResult(`${t} -> photo`, t, 'x', 'photo', t);
  }
  for (const t of ['video/mp4', 'video/quicktime']) {
    expectResult(`${t} -> video`, t, 'x', 'video', t);
  }

  // m4a by MIME type.
  for (const t of ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/mp4a-latm']) {
    expectResult(`${t} -> audio/mp4`, t, 'x', 'audio', 'audio/mp4');
  }

  // m4a by file name wins over the reported type.
  expectResult('.M4A uppercase extension', 'audio/mp4', 'REC.M4A', 'audio', 'audio/mp4');
  expectResult('audio/mp4a-latm + clip.m4a', 'audio/mp4a-latm', 'clip.m4a', 'audio', 'audio/mp4');
  expectResult('video/mp4 + clip.m4a -> audio', 'video/mp4', 'clip.m4a', 'audio', 'audio/mp4');
  expectResult('video/mp4 + clip.mp4 -> video', 'video/mp4', 'clip.mp4', 'video', 'video/mp4');
  expectResult("'' + clip.m4a -> audio", '', 'clip.m4a', 'audio', 'audio/mp4');
  expectResult('application/octet-stream + rec.m4a -> audio', 'application/octet-stream', 'rec.m4a', 'audio', 'audio/mp4');
  expectResult('audio/aac + rec.m4a -> audio', 'audio/aac', 'rec.m4a', 'audio', 'audio/mp4');

  // Unsupported.
  expectResult("'' + notes.txt -> null", '', 'notes.txt', null);
  expectResult('audio/mpeg + song.mp3 -> null', 'audio/mpeg', 'song.mp3', null);
  expectResult('m4a-like name without the extension -> null', '', 'm4a', null);

  // Parameters and case in the MIME type.
  expectResult('audio/mp4;codecs=mp4a.40.2 -> audio', 'audio/mp4;codecs=mp4a.40.2', 'x', 'audio', 'audio/mp4');
  expectResult('video/mp4; codecs="avc1" -> video/mp4', 'video/mp4; codecs="avc1"', 'x', 'video', 'video/mp4');
  expectResult('IMAGE/JPEG uppercase -> photo/image/jpeg', 'IMAGE/JPEG', 'x', 'photo', 'image/jpeg');

  if (failureCount > 0) {
    console.error(`\n${failureCount} case(s) failed.`);
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll cases passed.');
  }
}

main();
