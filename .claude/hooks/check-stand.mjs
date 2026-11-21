// Gemeinsame Logik fuer Stop-Hook und Commit-Hook: Fingerabdruck der relevanten Dateien und
// npm run check nur, wenn sich seit dem letzten gruenen Lauf etwas geaendert hat.
// CHECK_STAND_DATEI und CHECK_BEFEHL ersetzen Zustandsdatei und Pruefbefehl (nur fuer tests/hooks.spec.js).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const wurzel = join(import.meta.dirname, '..', '..');
const STAND = process.env.CHECK_STAND_DATEI || join(wurzel, '.claude', '.check-stand.json');
const PFADE = [
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

function fingerabdruck() {
  const dateien = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', ...PFADE], {
    cwd: wurzel,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .sort();
  const hash = createHash('sha1');
  for (const datei of dateien) {
    const pfad = join(wurzel, datei);
    hash.update(datei + '\0');
    if (existsSync(pfad)) hash.update(readFileSync(pfad));
  }
  return hash.digest('hex');
}

// Ergebnis: { gruen, ausgabe, versuche } (versuche = rote Laeufe mit demselben Stand)
export function pruefeStand() {
  const abdruck = fingerabdruck();
  let stand = {};
  try {
    stand = JSON.parse(readFileSync(STAND, 'utf8'));
  } catch {
    /* erster Lauf */
  }
  if (stand.gruen === abdruck) return { gruen: true, ausgabe: '', versuche: 0 };

  const befehl = process.env.CHECK_BEFEHL ? ['-c', process.env.CHECK_BEFEHL] : ['scripts/check.sh'];
  const lauf = spawnSync('bash', befehl, { cwd: wurzel, encoding: 'utf8' });
  const ausgabe = ((lauf.stdout || '') + (lauf.stderr || '')).trim();
  if (lauf.status === 0) {
    writeFileSync(STAND, JSON.stringify({ gruen: abdruck }));
    return { gruen: true, ausgabe, versuche: 0 };
  }
  const versuche = stand.rot === abdruck ? (stand.versuche || 0) + 1 : 1;
  writeFileSync(STAND, JSON.stringify({ gruen: stand.gruen, rot: abdruck, versuche }));
  return { gruen: false, ausgabe, versuche };
}
