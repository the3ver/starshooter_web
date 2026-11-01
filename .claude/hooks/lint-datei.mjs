// PostToolUse-Hook (Edit, Write): ESLint mit --fix auf die geaenderte JS-Datei.
// Verbleibende Fehler gehen per Exit 2 an Claude; andere Dateien werden uebersprungen.
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const wurzel = join(import.meta.dirname, '..', '..');
let eingabe = '';
process.stdin.on('data', d => { eingabe += d; });
process.stdin.on('end', () => {
  let datei = '';
  try { datei = JSON.parse(eingabe).tool_input?.file_path || ''; } catch { process.exit(0); }
  const rel = relative(wurzel, datei);
  if (!/\.m?js$/.test(datei) || rel.startsWith('..')) process.exit(0);
  const lauf = spawnSync(process.execPath, [join(wurzel, 'node_modules', 'eslint', 'bin', 'eslint.js'), '--fix', '--no-warn-ignored', rel], { cwd: wurzel, encoding: 'utf8' });
  if (lauf.status === 0) process.exit(0);
  console.error((lauf.stdout + lauf.stderr).trim());
  process.exit(2);
});
