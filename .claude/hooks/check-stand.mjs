// Gemeinsame Logik fuer Stop-Hook und Commit-Hook: Fingerabdruck der relevanten Dateien und
// npm run check nur, wenn sich seit dem letzten gruenen Lauf etwas geaendert hat.
// CHECK_STAND_DATEI und CHECK_BEFEHL ersetzen Zustandsdatei und Pruefbefehl (nur fuer tests/hooks.spec.js).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const root = join(import.meta.dirname, '..', '..');
const STAND = process.env.CHECK_STAND_FILE || join(root, '.claude', '.check-stand.json');
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

// Ergebnis: { gruen, ausgabe, versuche } (versuche = rote Laeufe mit demselben Stand)
export function checkStand() {
  const print = fingerprint();
  let stand = {};
  try {
    stand = JSON.parse(readFileSync(STAND, 'utf8'));
  } catch {
    /* erster Lauf */
  }
  if (stand.green === print) return { green: true, output: '', attempts: 0 };

  const command = process.env.CHECK_COMMAND ? ['-c', process.env.CHECK_COMMAND] : ['scripts/check.sh'];
  const run = spawnSync('bash', command, { cwd: root, encoding: 'utf8' });
  const output = ((run.stdout || '') + (run.stderr || '')).trim();
  if (run.status === 0) {
    writeFileSync(STAND, JSON.stringify({ green: print }));
    return { green: true, output, attempts: 0 };
  }
  const attempts = stand.rot === print ? (stand.attempts || 0) + 1 : 1;
  writeFileSync(STAND, JSON.stringify({ green: stand.green, rot: print, attempts }));
  return { green: false, output, attempts };
}
