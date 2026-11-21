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
// - Effekte (arrays.effekte, Art + Felder): bombenWelle (x/y Mitte, radius, farbe), bombenWelle2, raketenWelle,
//   bossWelle (x/y Mitte, radius); gemeinsam rest/dauer (Schritte; t = 1 - rest/dauer) und optional verzoegerung
//   (Schritte, in denen der Effekt noch unsichtbar ist und zur Lebensdauer zaehlt)
//   Sniper: sniperStrahl (x/y Nase, laenge, winkel, breite, glow, farbe), sniperDruckwelle, sniperMinenExplosion, sniperEmp (x/y Mitte, radius); alle mit pKey
// - stern (arrays.sterne): x/y, groesse (px, quadratisch), speed
// - sniperGranate (arrays.sniperGranaten): x/y Mitte (14 px gross), rot (Grad), rest (Flugschritte)
// - sniperMine (arrays.sniperMinen): x/y Mitte (12 px gross), pKey, haftet, blinkt (Booleans)
// - Zustand: schildHp (Schild sichtbar > 0), hp/maxHp/traegtPowerup (Risse), istUnzerstoerbar (Magma),
//   betaeubt (> 0), phase (Cling-on-Flammen), repulsorAktiv (Boss), towedBy + strahlX/strahlY (Schlepp-Strahl),
//   harmlos (pariertes Geschoss), farbe (Laser), fortschritt (Bombenpuls, 1 -> 0)
import * as DomDisplay from './anzeige-dom.js';

let backend = DomDisplay;

// Backend tauschen. Pflichtfunktionen: erzeuge(obj, art), zeichneWelt(), zeichneSpieler(), entferne(obj),
// blitze(obj, staerke), blitzeSpielfeld(farbe, ms).
export function setBackend(newBackend) {
  for (const name of ['create', 'drawWorld', 'drawPlayer', 'remove', 'flash', 'flashPlayfield']) {
    if (typeof newBackend?.[name] !== 'function') throw new Error(`Anzeige-Backend ohne ${name}()`);
  }
  backend = newBackend;
}

// Optisches Thema des Spielfelds (Hintergrund, Stimmung): 'standard' oder 'biozone'. Optional fuer Backends.
export function setTheme(name) {
  if (typeof backend.setTheme === 'function') backend.setTheme(name);
}

export function getBackend() {
  return backend;
}

// Legt die Darstellung eines neuen Weltobjekts an und zeigt es an seiner Position. art bestimmt das
// Aussehen: feind, asteroid, boss, powerup, laser, rakete, bombe, feindLaser, bossLaser, bossRakete,
// bossBombe, hackProjektil, gleveWelle, partikel, effekt, stern, sniperGranate, sniperMine. Die noetigen Modellfelder je Art stehen in AGENTS.md (Anzeige-Schicht).
export function create(obj, kind) {
  backend.create(obj, kind);
  return obj;
}

// Zeichnet alle Weltobjekte (Listen in arrays) aus ihren Modellfeldern. Laeuft einmal am Ende jedes
// Simulationsschritts (Host, Solo, Online-Client) und nach einem uebernommenen Snapshot.
export function drawWorld() {
  backend.drawWorld();
}

// Zeichnet nur die beiden Spielerschiffe aus state / state.p2 (zeichneWelt tut das ebenfalls). Fuer Stellen
// ausserhalb des Simulationsschritts, die ein Schiff sofort zeigen oder verstecken (Menue, Cutszene, Neustart).
// Felder: x, y, anzeigeX/Y (Online-Client: P1 interpoliert), drehung, flammenSkala, schiffSichtbar,
// invulnerableTimer (Blinken), schildStufe (Schild-Ring)
export function drawPlayer() {
  backend.drawPlayer();
}

// Entfernt die Darstellung eines Weltobjekts. Das Modell (Eintrag in arrays) entfernt der Aufrufer.
export function remove(obj) {
  if (obj) backend.remove(obj);
}

// Treffer-Ereignis: Objekt kurz aufhellen (staerke ~2-3). Reine Anzeige, aendert kein Modellfeld.
export function flash(obj, strength) {
  if (obj) backend.flash(obj, strength);
}

// Bildschirm-Blitz: Spielfeldhintergrund kurz in farbe (CSS-Farbe), nach ms Millisekunden zurueck zur Grundfarbe.
export function flashPlayfield(color, ms) {
  backend.flashPlayfield(color, ms);
}
