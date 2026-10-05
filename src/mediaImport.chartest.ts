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
  expectResult('m4a-like name without the extension -> null', '', 'm4a', null);
  expectResult('audio/aac -> null (raw AAC is not a Whisper format)', 'audio/aac', 'x', null);
  expectResult('rec.aac -> null', 'audio/aac', 'rec.aac', null);
  expectResult("'' + rec.aac -> null", '', 'rec.aac', null);
  expectResult('rec.wma -> null', 'audio/x-ms-wma', 'rec.wma', null);
  expectResult('rec.amr -> null', 'audio/amr', 'rec.amr', null);
  expectResult('video/webm + clip.webm -> null', 'video/webm', 'clip.webm', null);

  // Whisper audio formats by extension (extension wins over the reported type).
  const byExt: Array<[string, string]> = [
    ['a.m4a', 'audio/mp4'],
    ['a.mp3', 'audio/mpeg'],
    ['a.mpga', 'audio/mpeg'],
    ['a.mpeg', 'audio/mpeg'],
    ['a.wav', 'audio/wav'],
    ['a.ogg', 'audio/ogg'],
    ['a.oga', 'audio/ogg'],
    ['a.opus', 'audio/ogg'],
    ['a.flac', 'audio/flac'],
    ['a.weba', 'audio/webm'],
  ];
  for (const [name, mime] of byExt) {
    expectResult(`'' + ${name} -> ${mime}`, '', name, 'audio', mime);
    expectResult(`application/octet-stream + ${name} -> ${mime}`, 'application/octet-stream', name, 'audio', mime);
  }
  expectResult('.MP3 uppercase', '', 'SONG.MP3', 'audio', 'audio/mpeg');
  expectResult('video/mp4 + clip.mp3 -> audio', 'video/mp4', 'clip.mp3', 'audio', 'audio/mpeg');
  expectResult('audio/mpeg + song.mp3', 'audio/mpeg', 'song.mp3', 'audio', 'audio/mpeg');

  // Whisper audio formats by MIME alias (no usable extension).
  const byMime: Array<[string, string]> = [
    ['audio/mpeg', 'audio/mpeg'],
    ['audio/mp3', 'audio/mpeg'],
    ['audio/x-mp3', 'audio/mpeg'],
    ['audio/x-mpeg', 'audio/mpeg'],
    ['audio/wav', 'audio/wav'],
    ['audio/x-wav', 'audio/wav'],
    ['audio/wave', 'audio/wav'],
    ['audio/vnd.wave', 'audio/wav'],
    ['audio/ogg', 'audio/ogg'],
    ['audio/opus', 'audio/ogg'],
    ['audio/flac', 'audio/flac'],
    ['audio/x-flac', 'audio/flac'],
    ['audio/webm', 'audio/webm'],
    ['audio/webm;codecs=opus', 'audio/webm'],
  ];
  for (const [type, mime] of byMime) {
    expectResult(`${type} (no ext) -> ${mime}`, type, 'x', 'audio', mime);
  }

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
