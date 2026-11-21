// PostToolUse-Hook (Edit, Write): ESLint mit --fix auf die geaenderte JS-Datei, danach Prettier
// auf jede Datei, die Prettier kennt (.prettierignore gilt). Verbleibende ESLint-Fehler gehen
// per Exit 2 an Claude; Dateien ausserhalb des Repos werden uebersprungen.
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const start = (tool, args) =>
  spawnSync(process.execPath, [join(root, 'node_modules', ...tool), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
let input = '';
process.stdin.on('data', d => {
  input += d;
});
process.stdin.on('end', () => {
  let file = '';
  try {
    file = JSON.parse(input).tool_input?.file_path || '';
  } catch {
    process.exit(0);
  }
  const rel = relative(root, file);
  if (!file || rel.startsWith('..')) process.exit(0);
  let run = null;
  if (/\.m?js$/.test(file)) run = start(['eslint', 'bin', 'eslint.js'], ['--fix', '--no-warn-ignored', rel]);
  start(['prettier', 'bin', 'prettier.cjs'], ['--write', '--ignore-unknown', '--log-level', 'silent', rel]);
  if (!run || run.status === 0) process.exit(0);
  console.error((run.stdout + run.stderr).trim());
  process.exit(2);
});
