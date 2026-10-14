// Anzeige-Schnittstelle: einzige Stelle, ueber die die Spiellogik die Darstellung der Welt anspricht.
// Die Logik aendert nur Modellfelder (x, y, rot, ...); das eingesetzte Backend zeichnet daraus.
// Standard ist das DOM-Backend (anzeige-dom.js). Eine andere Engine (Canvas, WebGL, PixiJS ...)
// implementiert dieselben Funktionen und wird per setzeBackend() eingesetzt.
//
// Modellfelder, die ein Backend auswertet (Einheiten wie im Spielfeld, px und Grad):
// - x, y            Position der linken oberen Ecke
// - anzeigeX/Y      optionale Anzeigeposition (Online-Client: Interpolation zwischen Snapshots), sonst x/y
// - rot             optionale Drehung in Grad (fehlt = keine Drehung schreiben)
// - Partikel: leben (0..1) fuer Deckkraft und Skalierung
import * as DomAnzeige from './anzeige-dom.js';

let backend = DomAnzeige;

// Backend tauschen. Pflichtfunktionen: zeichneWelt(), entferne(obj).
export function setzeBackend(neuesBackend) {
  for (const name of ['zeichneWelt', 'entferne']) {
    if (typeof neuesBackend?.[name] !== 'function') throw new Error(`Anzeige-Backend ohne ${name}()`);
  }
  backend = neuesBackend;
}

export function holeBackend() {
  return backend;
}

// Zeichnet alle Weltobjekte (Listen in arrays) aus ihren Modellfeldern. Laeuft einmal am Ende jedes
// Simulationsschritts (Host, Solo, Online-Client) und nach einem uebernommenen Snapshot.
export function zeichneWelt() {
  backend.zeichneWelt();
}

// Entfernt die Darstellung eines Weltobjekts. Das Modell (Eintrag in arrays) entfernt der Aufrufer.
export function entferne(obj) {
  if (obj) backend.entferne(obj);
}
