// ============================================================
// e-Handkerchief — deviceLabel
// Characterization test for `deviceLabelFromUserAgent` (pure, runs under
// plain node). Compile with tsc, then `node ./src/deviceLabel.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { deviceLabelFromUserAgent } from './deviceLabel.js';

const CASES: Array<{ label: string; ua: string; expected: string }> = [
  {
    label: 'Android Chrome (contains "Linux" but is Android)',
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36',
    expected: 'Android',
  },
  {
    label: 'iPhone Safari (contains "like Mac OS X" but is iPhone)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    expected: 'iPhone',
  },
  {
    label: 'iPad Safari (old UA)',
    ua: 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
    expected: 'iPad',
  },
  {
    label: 'Windows Chrome',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    expected: 'Windows',
  },
  {
    label: 'Mac Safari',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    expected: 'Mac',
  },
  {
    label: 'Linux desktop Firefox',
    ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
    expected: 'Linux',
  },
  { label: 'unrecognised UA', ua: 'SomeBot/1.0', expected: 'another device' },
  { label: 'empty UA', ua: '', expected: 'another device' },
];

let failureCount = 0;

function main(): void {
  console.log('Characterization test: deviceLabel.deviceLabelFromUserAgent');
  for (const c of CASES) {
    const actual = deviceLabelFromUserAgent(c.ua);
    if (actual === c.expected) {
      console.log(`PASS  ${c.label}`);
    } else {
      failureCount++;
      console.error(`FAIL  ${c.label}  -> expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (failureCount > 0) {
    console.error(`\n${failureCount} scenario(s) failed.`);
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll scenarios passed.');
  }
}

main();
