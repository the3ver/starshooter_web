import { state, dom } from './state.js';
import * as Network from './network.js';
import * as Utils from './utils.js';

// Gemeinsame Pause im Online-Modus: Wer pausiert, ist Besitzer und kann allein fortsetzen.
// Die Pause endet nach spaetestens PAUSE_MAX_MS automatisch. Ausserhalb des Online-Modus
// bleibt die Pause ein einfacher Schalter ohne Zeitlimit und ohne Events.

export const PAUSE_MAX_MS = 60000;
const HINT_MS = 2500;
let hintUntil = 0;
let queryOpen = false;

function showEl(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? (id === 'pause-knoepfe' || id === 'pause-abfrage' ? 'flex' : 'block') : 'none';
}

// Knoepfe nur bei lokaler Pause (Single, Coop, Bot); online bleibt es beim Text
function updateMenu() {
  const local = state.paused && !state.pauseFrom && !isOnlineMode();
  if (!local) queryOpen = false;
  showEl('pause-menue', local);
  showEl('pause-knoepfe', local && !queryOpen);
  showEl('pause-abfrage', local && queryOpen);
  showEl('pause-abfrage-text', local && queryOpen);
}

export function isQueryOpen() {
  return queryOpen;
}

export function openQuery() {
  if (!state.paused || state.pauseFrom || isOnlineMode()) return;
  queryOpen = true;
  updateMenu();
}

export function closeQuery() {
  queryOpen = false;
  updateMenu();
}

// Pause beenden (WEITER bzw. Taste P)
export function resume() {
  togglePause();
}

// Laufendes Spiel verwerfen und zurueck zum Startbildschirm (kein Highscore, kein Game-Over)
export function endGameToMainMenu() {
  if (!state.paused || state.pauseFrom || isOnlineMode()) return;
  queryOpen = false;
  Utils.restartGame();
  updateMenu();
}

// ESC waehrend der Pause: Abfrage oeffnen bzw. abbrechen. true = Taste verbraucht.
export function handleEscape() {
  if (!state.paused || state.pauseFrom || isOnlineMode()) return false;
  if (queryOpen) closeQuery();
  else openQuery();
  return true;
}

export function initPauseMenu() {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  bind('btn-pause-weiter', resume);
  bind('btn-pause-hauptmenue', openQuery);
  bind('btn-pause-ja', endGameToMainMenu);
  bind('btn-pause-abbrechen', closeQuery);
}

export function isOnlineMode() {
  return state.gameMode === 'online' || Boolean(state.network && state.network.isOnline);
}

// Host = 'p1', Client = 'p2'
export function myRole() {
  return state.network && state.network.isClient ? 'p2' : 'p1';
}

export function isOwnPause() {
  return Boolean(state.paused && state.pauseFrom && state.pauseFrom === myRole());
}

export function remainingTimeSeconds() {
  if (!state.pauseFrom) return 0;
  return Math.max(0, Math.ceil((state.pauseEndTime - Date.now()) / 1000));
}

function formatTime(seconds) {
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function playerName(roll) {
  return roll === 'p2' ? 'Spieler 2' : 'Spieler 1';
}

export function updatePauseDisplay() {
  const overlay = dom.pauseOverlay;
  if (!overlay) return;
  if (!state.paused) {
    overlay.style.display = 'none';
    updateMenu();
    return;
  }
  overlay.style.display = 'block';
  updateMenu();
  const title = document.getElementById('pause-titel');
  const info = document.getElementById('pause-info');
  const hint = document.getElementById('pause-hinweis');
  if (!state.pauseFrom) {
    // Lokale Pause (Single, Coop, Bot) wie bisher
    if (title) title.textContent = 'PAUSED';
    if (info) info.textContent = '';
    if (hint) hint.textContent = '';
    return;
  }
  if (title) title.textContent = 'PAUSE - ' + playerName(state.pauseFrom);
  if (info) {
    const resumeHint = isOwnPause() ? 'Mit P fortsetzen' : 'Nur ' + playerName(state.pauseFrom) + ' kann fortsetzen';
    info.textContent = formatTime(remainingTimeSeconds()) + ' | ' + resumeHint;
  }
  if (hint) {
    hint.textContent = Date.now() < hintUntil ? 'Nur ' + playerName(state.pauseFrom) + ' kann die Pause beenden' : '';
  }
}

export function startPause(fromEntry, durationMs = PAUSE_MAX_MS) {
  const duration = Number.isFinite(durationMs) ? Math.max(0, Math.min(durationMs, PAUSE_MAX_MS)) : PAUSE_MAX_MS;
  state.paused = true;
  state.pauseFrom = fromEntry === 'p2' ? 'p2' : 'p1';
  state.pauseEndTime = Date.now() + duration;
  hintUntil = 0;
  updatePauseDisplay();
}

// Mehrfaches Beenden ist unkritisch
export function endPause() {
  state.paused = false;
  state.pauseFrom = null;
  state.pauseEndTime = 0;
  hintUntil = 0;
  queryOpen = false;
  if (dom.pauseOverlay) dom.pauseOverlay.style.display = 'none';
  updateMenu();
}

// Pro Simulationsschritt waehrend der Pause: Anzeige aktualisieren, bei Ablauf beenden.
// Der Host meldet das Ende dem Client, der Client beendet bei Ablauf als Fallback lokal.
export function checkPause() {
  if (!state.paused || !state.pauseFrom) return;
  if (Date.now() >= state.pauseEndTime) {
    endPause();
    if (state.network && state.network.isHost) Network.sendNetworkEvent({ type: 'pauseEnd' });
    return;
  }
  updatePauseDisplay();
}

// Taste P bzw. Pause-Button
export function togglePause(repeated = false) {
  if (!state.gameRunning || state.gameOverActive) return;
  if (!isOnlineMode()) {
    state.paused = !state.paused;
    state.pauseFrom = null;
    updatePauseDisplay();
    return;
  }
  if (repeated) return;
  if (!state.paused) {
    const fromEntry = myRole();
    startPause(fromEntry);
    Network.sendNetworkEvent({ type: 'pause_start', fromEntry, durationMs: PAUSE_MAX_MS });
  } else if (isOwnPause()) {
    endPause();
    Network.sendNetworkEvent({ type: 'pauseEnd' });
  } else {
    hintUntil = Date.now() + HINT_MS;
    updatePauseDisplay();
  }
}

// Netzwerk-Events beider Seiten
export function processPauseEvent(data) {
  if (data.type === 'pause_start') {
    if (!state.gameRunning || state.gameOverActive) return;
    // Pausieren beide gleichzeitig, gewinnt der Host
    if (state.paused && state.pauseFrom && state.network && state.network.isHost) return;
    startPause(data.fromEntry, data.durationMs);
  } else if (data.type === 'pauseEnd') {
    endPause();
  }
}
