#!/usr/bin/env node
/**
 * run-tests.js
 * Runs every compiled characterization/property test under src/ with node.
 * Tests are src/**\/*.chartest.js and src/**\/*.proptest.js, emitted by `tsc`
 * beside their .ts sources. There is no test framework: each file prints its
 * own PASS/FAIL lines and exits non-zero on failure.
 *
 * Run: node scripts/run-tests.js   (or `npm test`, which compiles first)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');

/** Recursively collect compiled test files that still have a matching .ts source. */
function findTests(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findTests(full));
    } else if (/\.(chartest|proptest)\.js$/.test(entry.name)) {
      // Compiled output is git-ignored, so stale .js files can outlive their .ts.
      if (fs.existsSync(full.replace(/\.js$/, '.ts'))) found.push(full);
    }
  }
  return found;
}

const tests = findTests(srcDir).sort();
if (tests.length === 0) {
  console.error('No compiled tests found under src/. Run `tsc` first.');
  process.exit(1);
}

const failed = [];
for (const file of tests) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  console.log(`\n=== ${rel} ===`);
  // The compiled tests are ES modules in a package without "type": "module"; node reparses them
  // and prints a harmless MODULE_TYPELESS_PACKAGE_JSON warning, which is silenced here.
  const result = spawnSync(process.execPath, [file], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  if (result.status !== 0) failed.push(rel);
}

console.log(`\n${tests.length - failed.length}/${tests.length} test files passed.`);
if (failed.length > 0) {
  console.error('Failed:\n  ' + failed.join('\n  '));
  process.exit(1);
}
