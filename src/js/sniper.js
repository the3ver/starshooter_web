// Spectre-SR (Model-ID `sniper`): Fadenkreuz-Laser mit Aufladen und Betaeubungsgranate (siehe AGENTS.md, Abschnitt Sniper).
// Stand S1 (Grundlage): nur Schiffserkennung und leerer Rahmen. Bis die Waffen folgen, nutzt der Sniper die
// normalen Laser und Raketen. pState ist `state` (P1) oder `state.p2`, pKey 'p1' / 'p2'.

export function istSniper(pState) {
  return !!pState && pState.selectedShipModel === 'sniper';
}

// Spaeter: Fadenkreuz, Laden, Schuss und Granate pro Schritt (Aufruf aus spieler.js / waffen.js). Bisher ohne Wirkung.
export function aktualisiereSniper(pState, pKey) {
  if (!istSniper(pState)) return false;
  return false;
}

// Spaeter: Fadenkreuz-/Lade-/Granaten-Zustand zuruecksetzen (restartGame). Bisher ohne Wirkung.
export function setzeZurueck(pState) {
  return !!pState;
}
