// Effekte mit Lebensdauer (Schockwellen u. a.): reine Modelle in arrays.effekte, kein DOM.
// Die Logik zaehlt rest pro Simulationsschritt herunter, das Backend zeichnet Groesse und Deckkraft
// aus dem Fortschritt (siehe anzeige-dom.js zeichneEffekt). Effekte frieren daher mit der Welt ein.
import { arrays } from './state.js';
import * as Anzeige from './anzeige.js';

// Neuer Effekt: daten = { art, x, y, rest, ... }; rest ist die Lebensdauer in Schritten (wird zu dauer).
// Optional verzoegerung (Schritte, in denen der Effekt noch unsichtbar ist und zur Lebensdauer zaehlt)
// und pKey (Besitzer, fuer entferneEffekte).
export function erzeugeEffekt(daten) {
  const effekt = { ...daten, dauer: daten.rest };
  arrays.effekte.push(Anzeige.erzeuge(effekt, 'effekt'));
  return effekt;
}

export function aktualisiereEffekte() {
  for (let i = arrays.effekte.length - 1; i >= 0; i--) {
    const e = arrays.effekte[i];
    e.rest--;
    if (e.rest <= 0) {
      Anzeige.entferne(e);
      arrays.effekte.splice(i, 1);
    }
  }
}

// Alle Effekte entfernen, mit pKey nur die dieses Spielers
export function entferneEffekte(pKey) {
  for (let i = arrays.effekte.length - 1; i >= 0; i--) {
    const e = arrays.effekte[i];
    if (pKey !== undefined && e.pKey !== pKey) continue;
    Anzeige.entferne(e);
    arrays.effekte.splice(i, 1);
  }
}
