// Shared logic for the stop hook and the commit hook: fingerprint of the relevant files, and
// npm run check only if something changed since the last green run.
// CHECK_STATE_FILE and CHECK_COMMAND replace the state file and the check command (only for tests/hooks.spec.js).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const root = join(import.meta.dirname, '..', '..');
const STATE_FILE = process.env.CHECK_STATE_FILE || join(root, '.claude', '.check-state.json');
const PATHS = [
  'src',
  'tests',
  'worker',
  'scripts',
  'types',
  'jsconfig.json',
  'playwright.config.js',
  'webserver.config.js',
  'package.json',
  'package-lock.json',
];

function fingerprint() {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', ...PATHS], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .sort();
  const hash = createHash('sha1');
  for (const file of files) {
    const filePath = join(root, file);
    hash.update(file + '\0');
    if (existsSync(filePath)) hash.update(readFileSync(filePath));
  }
  return hash.digest('hex');
}

// Result: { green, output, attempts } (attempts = red runs with the same state)
export function checkStand() {
  const print = fingerprint();
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    /* erster Lauf */
  }
  if (saved.green === print) return { green: true, output: '', attempts: 0 };

  const command = process.env.CHECK_COMMAND ? ['-c', process.env.CHECK_COMMAND] : ['scripts/check.sh'];
  const run = spawnSync('bash', command, { cwd: root, encoding: 'utf8' });
  const output = ((run.stdout || '') + (run.stderr || '')).trim();
  if (run.status === 0) {
    writeFileSync(STATE_FILE, JSON.stringify({ green: print }));
    return { green: true, output, attempts: 0 };
  }
  const attempts = saved.red === print ? (saved.attempts || 0) + 1 : 1;
  writeFileSync(STATE_FILE, JSON.stringify({ green: saved.green, red: print, attempts }));
  return { green: false, output, attempts };
}
