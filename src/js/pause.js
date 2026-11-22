import { state, dom } from './state.js';
import * as Network from './network.js';
import * as Utils from './utils.js';
import * as Cutscene from './cutscene.js';

// Shared pause in online mode: whoever pauses owns it and alone can resume.
// The pause ends automatically after PAUSE_MAX_MS at the latest. Outside online mode
// the pause stays a simple toggle without a time limit and without events.

export const PAUSE_MAX_MS = 60000;
const HINT_MS = 2500;
let hintUntil = 0;
// Confirmation shown in the local pause menu: null, 'menu' (end the game) or 'restart' (new round)
let pendingQuery = null;

function showEl(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? (id === 'pause-knoepfe' || id === 'pause-abfrage' ? 'flex' : 'block') : 'none';
}

// Buttons only for a local pause (single, co-op, bot); online it stays with the text
function updateMenu() {
  const local = state.paused && !state.pauseFrom && !isOnlineMode();
  if (!local) pendingQuery = null;
  showEl('pause-menue', local);
  showEl('pause-knoepfe', local && !pendingQuery);
  showEl('pause-abfrage', local && Boolean(pendingQuery));
  showEl('pause-abfrage-text', local && Boolean(pendingQuery));
}

export function isQueryOpen() {
  return Boolean(pendingQuery);
}

const QUERY_TEXT = { menu: 'Laufendes Spiel beenden?', restart: 'Laufendes Spiel neu starten?' };

export function openQuery(action = 'menu') {
  if (!state.paused || state.pauseFrom || isOnlineMode()) return;
  pendingQuery = action === 'restart' ? 'restart' : 'menu';
  const text = document.getElementById('pause-abfrage-text');
  if (text) text.textContent = QUERY_TEXT[pendingQuery];
  updateMenu();
}

// YES in the query: end the game to the menu or start a new round (issue #30)
function confirmQuery() {
  if (pendingQuery === 'restart') restartFromPause();
  else endGameToMainMenu();
}

// Discard the running game and start the next round in the same mode with the same ship
export function restartFromPause() {
  if (!state.paused || state.pauseFrom || isOnlineMode()) return;
  pendingQuery = null;
  startNextRound();
  updateMenu();
}

export function closeQuery() {
  pendingQuery = null;
  updateMenu();
}

// End the pause (RESUME button or key P)
export function resume() {
  togglePause();
}

// Discard the running game and return to the start screen (no highscore, no game over)
export function endGameToMainMenu() {
  if (!state.paused || state.pauseFrom || isOnlineMode()) return;
  pendingQuery = null;
  Utils.restartGame();
  updateMenu();
}

// Next round in the same mode with the same ship (game over screen)
export function startNextRound() {
  Utils.restartGame();
  const startScreen = document.getElementById('start-screen');
  if (startScreen) startScreen.style.display = 'none';
  Cutscene.startCutscene();
}

// ESC: in a running game it pauses like P (issue #30); during a local pause it opens or cancels the
// query. true = key consumed.
export function handleEscape(repeated = false) {
  if (!state.paused) {
    if (!state.gameRunning || state.gameOverActive) return false;
    if (!repeated) togglePause();
    return true;
  }
  // A held ESC must not flip the query open and shut with every auto-repeat
  if (repeated) return !state.pauseFrom && !isOnlineMode();
  if (state.pauseFrom || isOnlineMode()) return false;
  if (pendingQuery) closeQuery();
  else openQuery();
  return true;
}

export function initPauseMenu() {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  bind('btn-pause-weiter', resume);
  bind('btn-pause-neustart', () => openQuery('restart'));
  bind('btn-pause-hauptmenue', () => openQuery('menu'));
  bind('btn-pause-ja', confirmQuery);
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
    // Local pause (single, co-op, bot) as before
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

// Ending more than once is harmless
export function endPause() {
  state.paused = false;
  state.pauseFrom = null;
  state.pauseEndTime = 0;
  hintUntil = 0;
  pendingQuery = null;
  if (dom.pauseOverlay) dom.pauseOverlay.style.display = 'none';
  updateMenu();
}

// Per simulation step during the pause: update the display, end on expiry.
// The host reports the end to the client, the client ends locally on expiry as a fallback.
export function checkPause() {
  if (!state.paused || !state.pauseFrom) return;
  if (Date.now() >= state.pauseEndTime) {
    endPause();
    if (state.network && state.network.isHost) Network.sendNetworkEvent({ type: 'pause_end' });
    return;
  }
  updatePauseDisplay();
}

// Key P or pause button
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
    Network.sendNetworkEvent({ type: 'pause_end' });
  } else {
    hintUntil = Date.now() + HINT_MS;
    updatePauseDisplay();
  }
}

// Network events of both sides
export function processPauseEvent(data) {
  if (data.type === 'pause_start') {
    if (!state.gameRunning || state.gameOverActive) return;
    // If both pause at the same time, the host wins
    if (state.paused && state.pauseFrom && state.network && state.network.isHost) return;
    startPause(data.fromEntry, data.durationMs);
  } else if (data.type === 'pause_end') {
    endPause();
  }
}
