// Stop-Hook: fuehrt npm run check aus, wenn sich relevante Dateien seit dem letzten gruenen Lauf geaendert haben.
// Rot = Exit 2, die Fehlerausgabe geht an Claude und der Turn laeuft weiter. Nach 3 roten Laeufen
// mit demselben Stand gibt der Hook auf (keine Endlosschleife), meldet den Fehler aber weiter.
import { checkStand } from './check-state.mjs';

const { green, output, attempts } = checkStand();
if (green) process.exit(0);
console.error(output);
if (attempts > 3) {
  console.error('Stop-Hook: dreimal rot mit demselben Stand, Turn endet trotzdem. Fehler dem Nutzer melden.');
  process.exit(0);
}
process.exit(2);
