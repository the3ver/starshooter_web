import { state, dom } from './state.js';
import * as Network from './network.js';

// Gemeinsame Pause im Online-Modus: Wer pausiert, ist Besitzer und kann allein fortsetzen.
// Die Pause endet nach spaetestens PAUSE_MAX_MS automatisch. Ausserhalb des Online-Modus
// bleibt die Pause ein einfacher Schalter ohne Zeitlimit und ohne Events.

export const PAUSE_MAX_MS = 60000;
const HINWEIS_MS = 2500;
let hinweisBis = 0;

export function istOnlineModus() {
  return state.gameMode === 'online' || Boolean(state.network && state.network.isOnline);
}

// Host = 'p1', Client = 'p2'
export function meineRolle() {
  return state.network && state.network.isClient ? 'p2' : 'p1';
}

export function istEigenePause() {
  return Boolean(state.pausiert && state.pauseVon && state.pauseVon === meineRolle());
}

export function restzeitSekunden() {
  if (!state.pauseVon) return 0;
  return Math.max(0, Math.ceil((state.pauseEndeZeit - Date.now()) / 1000));
}

function formatiereZeit(sekunden) {
  return Math.floor(sekunden / 60) + ':' + String(sekunden % 60).padStart(2, '0');
}

function spielerName(rolle) {
  return rolle === 'p2' ? 'Spieler 2' : 'Spieler 1';
}

export function aktualisierePauseAnzeige() {
  const overlay = dom.pauseOverlay;
  if (!overlay) return;
  if (!state.pausiert) {
    overlay.style.display = 'none';
    return;
  }
  overlay.style.display = 'block';
  const titel = document.getElementById('pause-titel');
  const info = document.getElementById('pause-info');
  const hinweis = document.getElementById('pause-hinweis');
  if (!state.pauseVon) {
    // Lokale Pause (Single, Coop, Bot) wie bisher
    if (titel) titel.textContent = 'PAUSED';
    if (info) info.textContent = '';
    if (hinweis) hinweis.textContent = '';
    return;
  }
  if (titel) titel.textContent = 'PAUSE - ' + spielerName(state.pauseVon);
  if (info) {
    const fortsetzen = istEigenePause() ? 'Mit P fortsetzen' : 'Nur ' + spielerName(state.pauseVon) + ' kann fortsetzen';
    info.textContent = formatiereZeit(restzeitSekunden()) + ' | ' + fortsetzen;
  }
  if (hinweis) {
    hinweis.textContent = Date.now() < hinweisBis ? 'Nur ' + spielerName(state.pauseVon) + ' kann die Pause beenden' : '';
  }
}

export function startePause(von, dauerMs = PAUSE_MAX_MS) {
  const dauer = Number.isFinite(dauerMs) ? Math.max(0, Math.min(dauerMs, PAUSE_MAX_MS)) : PAUSE_MAX_MS;
  state.pausiert = true;
  state.pauseVon = von === 'p2' ? 'p2' : 'p1';
  state.pauseEndeZeit = Date.now() + dauer;
  hinweisBis = 0;
  aktualisierePauseAnzeige();
}

// Mehrfaches Beenden ist unkritisch
export function beendePause() {
  state.pausiert = false;
  state.pauseVon = null;
  state.pauseEndeZeit = 0;
  hinweisBis = 0;
  if (dom.pauseOverlay) dom.pauseOverlay.style.display = 'none';
}

// Pro Simulationsschritt waehrend der Pause: Anzeige aktualisieren, bei Ablauf beenden.
// Der Host meldet das Ende dem Client, der Client beendet bei Ablauf als Fallback lokal.
export function pruefePause() {
  if (!state.pausiert || !state.pauseVon) return;
  if (Date.now() >= state.pauseEndeZeit) {
    beendePause();
    if (state.network && state.network.isHost) Network.sendNetworkEvent({ type: 'pause_ende' });
    return;
  }
  aktualisierePauseAnzeige();
}

// Taste P bzw. Pause-Button
export function schaltePause(wiederholt = false) {
  if (!state.spielLaeuft || state.gameOverAktiv) return;
  if (!istOnlineModus()) {
    state.pausiert = !state.pausiert;
    state.pauseVon = null;
    aktualisierePauseAnzeige();
    return;
  }
  if (wiederholt) return;
  if (!state.pausiert) {
    const von = meineRolle();
    startePause(von);
    Network.sendNetworkEvent({ type: 'pause_start', von, dauerMs: PAUSE_MAX_MS });
  } else if (istEigenePause()) {
    beendePause();
    Network.sendNetworkEvent({ type: 'pause_ende' });
  } else {
    hinweisBis = Date.now() + HINWEIS_MS;
    aktualisierePauseAnzeige();
  }
}

// Netzwerk-Events beider Seiten
export function verarbeitePauseEvent(data) {
  if (data.type === 'pause_start') {
    if (!state.spielLaeuft || state.gameOverAktiv) return;
    // Pausieren beide gleichzeitig, gewinnt der Host
    if (state.pausiert && state.pauseVon && state.network && state.network.isHost) return;
    startePause(data.von, data.dauerMs);
  } else if (data.type === 'pause_ende') {
    beendePause();
  }
}
