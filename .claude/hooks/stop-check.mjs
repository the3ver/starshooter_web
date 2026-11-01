// Stop-Hook: fuehrt npm run check aus, wenn sich relevante Dateien seit dem letzten gruenen Lauf geaendert haben.
// Rot = Exit 2, die Fehlerausgabe geht an Claude und der Turn laeuft weiter. Nach 3 roten Laeufen
// mit demselben Stand gibt der Hook auf (keine Endlosschleife), meldet den Fehler aber weiter.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const wurzel = join(import.meta.dirname, '..', '..');
const STAND = join(wurzel, '.claude', '.check-stand.json');
const PFADE = [
  'src',
  'tests',
  'worker',
  'scripts',
  'types',
  'jsconfig.json',
  'playwright.config.js',
  'package.json',
  'package-lock.json',
];

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
const fingerabdruck = hash.digest('hex');

let stand = {};
try {
  stand = JSON.parse(readFileSync(STAND, 'utf8'));
} catch {
  /* erster Lauf */
}
if (stand.gruen === fingerabdruck) process.exit(0);

const lauf = spawnSync('bash', ['scripts/check.sh'], { cwd: wurzel, encoding: 'utf8' });
const ausgabe = (lauf.stdout || '') + (lauf.stderr || '');
if (lauf.status === 0) {
  writeFileSync(STAND, JSON.stringify({ gruen: fingerabdruck }));
  process.exit(0);
}

const versuche = stand.rot === fingerabdruck ? (stand.versuche || 0) + 1 : 1;
writeFileSync(STAND, JSON.stringify({ gruen: stand.gruen, rot: fingerabdruck, versuche }));
console.error(ausgabe.trim());
if (versuche > 3) {
  console.error('Stop-Hook: dreimal rot mit demselben Stand, Turn endet trotzdem. Fehler dem Nutzer melden.');
  process.exit(0);
}
process.exit(2);
