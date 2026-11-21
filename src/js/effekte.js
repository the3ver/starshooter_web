// Effekte mit Lebensdauer (Schockwellen u. a.): reine Modelle in arrays.effekte, kein DOM.
// Die Logik zaehlt rest pro Simulationsschritt herunter, das Backend zeichnet Groesse und Deckkraft
// aus dem Fortschritt (siehe anzeige-dom.js zeichneEffekt). Effekte frieren daher mit der Welt ein.
import { arrays } from './state.js';
import * as Display from './anzeige.js';

// Neuer Effekt: daten = { art, x, y, rest, ... }; rest ist die Lebensdauer in Schritten (wird zu dauer).
// Optional verzoegerung (Schritte, in denen der Effekt noch unsichtbar ist und zur Lebensdauer zaehlt)
// und pKey (Besitzer, fuer entferneEffekte).
export function createEffect(payload) {
  const effect = { ...payload, duration: payload.rest };
  arrays.effects.push(Display.create(effect, 'effect'));
  return effect;
}

export function updateEffects() {
  for (let i = arrays.effects.length - 1; i >= 0; i--) {
    const e = arrays.effects[i];
    e.rest--;
    if (e.rest <= 0) {
      Display.remove(e);
      arrays.effects.splice(i, 1);
    }
  }
}

// Alle Effekte entfernen, mit pKey nur die dieses Spielers
export function removeEffects(pKey) {
  for (let i = arrays.effects.length - 1; i >= 0; i--) {
    const e = arrays.effects[i];
    if (pKey !== undefined && e.pKey !== pKey) continue;
    Display.remove(e);
    arrays.effects.splice(i, 1);
  }
}
