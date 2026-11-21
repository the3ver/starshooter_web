// PreToolUse-Hook (Bash, PowerShell): git commit nur bei gruenem npm run check.
// Der Stop-Hook kommt erst am Turn-Ende; ein Commit mitten im Turn lief sonst ungeprueft
// (f1ed7fa wurde rot committet). Gleicher Fingerabdruck wie der Stop-Hook: nach gruenem Commit kostet
// der Stop-Hook nichts, unveraenderter gruener Stand kostet hier 0,2 s.
import { checkStand } from './check-stand.mjs';

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
  // git [-C pfad] commit am Anfang eines Teilbefehls (nicht in Commit-Texten)
  if (!/(^|[\n;&|(]\s*)git\s+(-C\s+\S+\s+)?commit\b/.test(command)) process.exit(0);
  const { green, output } = checkStand();
  if (green) process.exit(0);
  console.error(output);
  console.error('BLOCKIERT: git commit erst, wenn npm run check gruen ist. Fehler beheben, dann erneut committen.');
  process.exit(2);
});
