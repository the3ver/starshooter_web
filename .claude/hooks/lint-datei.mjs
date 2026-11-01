// PostToolUse-Hook (Edit, Write): ESLint mit --fix auf die geaenderte JS-Datei, danach Prettier
// auf jede Datei, die Prettier kennt (.prettierignore gilt). Verbleibende ESLint-Fehler gehen
// per Exit 2 an Claude; Dateien ausserhalb des Repos werden uebersprungen.
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const wurzel = join(import.meta.dirname, '..', '..');
const starte = (werkzeug, argumente) =>
  spawnSync(process.execPath, [join(wurzel, 'node_modules', ...werkzeug), ...argumente], {
    cwd: wurzel,
    encoding: 'utf8',
  });
let eingabe = '';
process.stdin.on('data', d => {
  eingabe += d;
});
process.stdin.on('end', () => {
  let datei = '';
  try {
    datei = JSON.parse(eingabe).tool_input?.file_path || '';
  } catch {
    process.exit(0);
  }
  const rel = relative(wurzel, datei);
  if (!datei || rel.startsWith('..')) process.exit(0);
  let lauf = null;
  if (/\.m?js$/.test(datei)) lauf = starte(['eslint', 'bin', 'eslint.js'], ['--fix', '--no-warn-ignored', rel]);
  starte(['prettier', 'bin', 'prettier.cjs'], ['--write', '--ignore-unknown', '--log-level', 'silent', rel]);
  if (!lauf || lauf.status === 0) process.exit(0);
  console.error((lauf.stdout + lauf.stderr).trim());
  process.exit(2);
});
