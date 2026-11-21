// scripts/failure-block.sh: a red check shows the cause (first failure block or load error)
const { test, expect } = require('@playwright/test');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function block(log) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-log-')), 'log.txt');
  fs.writeFileSync(file, log);
  return spawnSync('bash', [path.join(__dirname, '..', 'scripts', 'failure-block.sh'), file], { encoding: 'utf8' })
    .stdout;
}

test('shows the first failure block of a red test', () => {
  const out = block(
    ['[1/2] a', '  1) [chromium] › a.spec.js:1:1 › a', '    Error: kaputt', '  2) [chromium] › b'].join('\n'),
  );
  expect(out).toContain('Error: kaputt');
  expect(out).not.toContain('2) [chromium]');
});

test('shows the cause when a test file fails to load (no block "1)")', () => {
  const log = [
    "Error: Cannot find module './helfer'",
    'Require stack:',
    '   at turn.spec.js:2',
    '',
    'Error: No tests found',
  ].join('\n');
  expect(block(log)).toContain("Cannot find module './helfer'");
});
