// Stop-Hook: fuehrt npm run check aus, wenn sich relevante Dateien seit dem letzten gruenen Lauf geaendert haben.
// Rot = Exit 2, die Fehlerausgabe geht an Claude und der Turn laeuft weiter. Nach 3 roten Laeufen
// mit demselben Stand gibt der Hook auf (keine Endlosschleife), meldet den Fehler aber weiter.
import { pruefeStand } from './check-stand.mjs';

const { gruen, ausgabe, versuche } = pruefeStand();
if (gruen) process.exit(0);
console.error(ausgabe);
if (versuche > 3) {
  console.error('Stop-Hook: dreimal rot mit demselben Stand, Turn endet trotzdem. Fehler dem Nutzer melden.');
  process.exit(0);
}
process.exit(2);
