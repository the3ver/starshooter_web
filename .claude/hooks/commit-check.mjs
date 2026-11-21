// PreToolUse-Hook (Bash, PowerShell): git commit nur bei gruenem npm run check.
// Der Stop-Hook kommt erst am Turn-Ende; ein Commit mitten im Turn lief sonst ungeprueft
// (f1ed7fa wurde rot committet). Gleicher Fingerabdruck wie der Stop-Hook: nach gruenem Commit kostet
// der Stop-Hook nichts, unveraenderter gruener Stand kostet hier 0,2 s.
import { pruefeStand } from './check-stand.mjs';

let eingabe = '';
process.stdin.on('data', d => {
  eingabe += d;
});
process.stdin.on('end', () => {
  let befehl = '';
  try {
    befehl = JSON.parse(eingabe).tool_input?.command || '';
  } catch {
    process.exit(0);
  }
  // git [-C pfad] commit am Anfang eines Teilbefehls (nicht in Commit-Texten)
  if (!/(^|[\n;&|(]\s*)git\s+(-C\s+\S+\s+)?commit\b/.test(befehl)) process.exit(0);
  const { gruen, ausgabe } = pruefeStand();
  if (gruen) process.exit(0);
  console.error(ausgabe);
  console.error('BLOCKIERT: git commit erst, wenn npm run check gruen ist. Fehler beheben, dann erneut committen.');
  process.exit(2);
});
