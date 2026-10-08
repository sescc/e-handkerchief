// ============================================================
// e-Handkerchief — saveError
// Characterization/behaviour test for `isMediaWriteError` and
// `saveErrorMessage` (pure, run under plain node). Compile with tsc, then
// `node ./src/saveError.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { isMediaWriteError, saveErrorMessage } from './saveError.js';

let failureCount = 0;
let passCount = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    passCount++;
    console.log(`PASS  ${label}`);
  } else {
    failureCount++;
    console.error(`FAIL  ${label}  -> expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const CAPTURE = 'Could not tie knot';
const EDIT = 'Could not save changes';
const MEDIA_SUFFIX = " — a photo, video or audio file couldn't be saved. Remove it and pick it again.";

function main(): void {
  console.log('Characterization test: saveError');

  const chromeInvalidBlob = { name: 'UnknownError', message: 'Failed to write blobs (InvalidBlob)' };
  check('Chrome InvalidBlob is a media write error', isMediaWriteError(chromeInvalidBlob), true);
  check(
    'Chrome InvalidBlob -> capture message',
    saveErrorMessage(CAPTURE, chromeInvalidBlob),
    CAPTURE + MEDIA_SUFFIX,
  );
  check(
    'Chrome InvalidBlob -> edit message',
    saveErrorMessage(EDIT, chromeInvalidBlob),
    EDIT + MEDIA_SUFFIX,
  );

  const lower = new Error('transaction failed: invalidblob');
  check('lowercase "invalidblob" is a media write error', isMediaWriteError(lower), true);
  check('lowercase "invalidblob" -> media message', saveErrorMessage(EDIT, lower), EDIT + MEDIA_SUFFIX);

  const notReadable = { name: 'NotReadableError', message: 'The requested file could not be read' };
  check('NotReadableError name is a media write error', isMediaWriteError(notReadable), true);
  check('NotReadableError -> media message', saveErrorMessage(CAPTURE, notReadable), CAPTURE + MEDIA_SUFFIX);

  const quotaPlain = new Error('Quota exceeded');
  check('plain Error is not a media write error', isMediaWriteError(quotaPlain), false);
  check('plain Error keeps detail (capture)', saveErrorMessage(CAPTURE, quotaPlain), `${CAPTURE}: Quota exceeded`);
  check('plain Error keeps detail (edit)', saveErrorMessage(EDIT, quotaPlain), `${EDIT}: Quota exceeded`);

  const quotaLike = { name: 'QuotaExceededError', message: 'The quota has been exceeded.' };
  check('QuotaExceededError-like is not a media write error', isMediaWriteError(quotaLike), false);
  check(
    'QuotaExceededError-like keeps detail',
    saveErrorMessage(EDIT, quotaLike),
    `${EDIT}: The quota has been exceeded.`,
  );

  check('thrown string without "blob" is not a media write error', isMediaWriteError('disk full'), false);
  check('thrown string -> String(err)', saveErrorMessage(CAPTURE, 'disk full'), `${CAPTURE}: disk full`);
  check('thrown string mentioning blob is not matched (no message prop)', isMediaWriteError('InvalidBlob'), false);

  check('undefined is not a media write error', isMediaWriteError(undefined), false);
  check('null is not a media write error', isMediaWriteError(null), false);
  check('undefined -> "undefined" detail', saveErrorMessage(CAPTURE, undefined), `${CAPTURE}: undefined`);
  check('null -> "null" detail', saveErrorMessage(EDIT, null), `${EDIT}: null`);

  check('object with non-string message is not matched', isMediaWriteError({ message: 42 }), false);

  if (failureCount > 0) {
    console.error(`\n${failureCount} check(s) failed, ${passCount} passed.`);
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
    return;
  }
  console.log(`\nAll ${passCount} checks passed.`);
}

main();
