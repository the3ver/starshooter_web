// scripts/failure-block.sh: zeigt beim roten Check die Ursache (erster Fehlerblock oder Ladefehler)
const { test, expect } = require('@playwright/test');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function block(log) {
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-log-')), 'log.txt');
  fs.writeFileSync(datei, log);
  return spawnSync('bash', [path.join(__dirname, '..', 'scripts', 'failure-block.sh'), datei], { encoding: 'utf8' })
    .stdout;
}

test('zeigt den ersten Fehlerblock eines roten Tests', () => {
  const out = block(
    ['[1/2] a', '  1) [chromium] › a.spec.js:1:1 › a', '    Error: kaputt', '  2) [chromium] › b'].join('\n'),
  );
  expect(out).toContain('Error: kaputt');
  expect(out).not.toContain('2) [chromium]');
});

test('zeigt die Ursache, wenn eine Testdatei nicht laedt (kein Block "1)")', () => {
  const log = [
    "Error: Cannot find module './helfer'",
    'Require stack:',
    '   at turn.spec.js:2',
    '',
    'Error: No tests found',
  ].join('\n');
  expect(block(log)).toContain("Cannot find module './helfer'");
});
