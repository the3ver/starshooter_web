// PreToolUse hook (Bash, PowerShell): git commit only with a green npm run check.
// The stop hook only runs at the end of the turn; a commit in the middle of the turn went unchecked
// (f1ed7fa was committed red). Same fingerprint as the stop hook: after a green commit the stop hook
// costs nothing, an unchanged green state costs 0.2 s here.
import { checkStand } from './check-state.mjs';

let input = '';
process.stdin.on('data', d => {
  input += d;
});
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(input).tool_input?.command || '';
  } catch {
    process.exit(0);
  }
  // git [-C path] commit at the start of a sub-command (not inside commit messages)
  if (!/(^|[\n;&|(]\s*)git\s+(-C\s+\S+\s+)?commit\b/.test(command)) process.exit(0);
  const { green, output } = checkStand();
  if (green) process.exit(0);
  console.error(output);
  console.error('BLOCKED: git commit only once npm run check is green. Fix the errors, then commit again.');
  process.exit(2);
});
