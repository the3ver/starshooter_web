import { state, dom, config, arrays } from './state.js';
import * as Cutscene from './cutscene.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import { p1Display, setInterpolationTarget, deriveSpeed, snapshotReceived, applyP1Display } from './client.js';
import { endPause, processPauseEvent } from './pause.js';
import { GAME_VERSION } from './changelog.js';
import { PROTOCOL_VERSION, KEYFRAME_INTERVAL, SnapshotEncoder, SnapshotDecoder, InputSender } from './net-encoding.js';
import * as Gleve from './gleve.js';
import * as Viper from './viper.js';
import * as Sniper from './sniper.js';
import * as Shockwave from './shockwave.js';
import * as Rock from './rock.js';
import * as Display from './display.js';

let room = null;
let sendStateAction = null;
let sendInputAction = null;
let sendEventAction = null;

let onStateCallbacks = [];
let onInputCallbacks = [];
let onEventCallbacks = [];

let trysteroJoinRoom = null;

// Net encoding: the host encodes snapshots as deltas, the client decodes them, the client sends inputs only on change
const encoder = new SnapshotEncoder();
const decoder = new SnapshotDecoder();
const inputSender = new InputSender();
let keyframeWaitCounter = 0;

export const VERSIONS_MESSAGE = 'Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)';
export const HELLO_TIMEOUT_MS = 10000;
let helloTimer = null;

function resetNetEncoding() {
  encoder.reset();
  decoder.reset();
  inputSender.reset();
  keyframeWaitCounter = 0;
}

// Forget the client's held keys on the host (game start, end of connection)
function resetNetworkInputs() {
  if (!state.p2) return;
  state.p2.laserInputRequested = false;
  state.p2.missileHeld = false;
  state.p2.bombHeld = false;
  state.p2.networkFireMissile = false;
  state.p2.networkFireBomb = false;
  state.p2.networkDashRequest = false;
  state.p2.networkLaserRequest = false;
  state.p2.sniperAutoInput = false;
  state.p2.networkDirection = null;
}

// Both peers send their protocol version after connecting. Old versions send no
// 'hallo'; if none arrives in time, that also counts as a different version.
// protocolOk is reset only on room setup and disconnect, in case the peer's hallo arrives before the own join event.
function startHandshake() {
  resetNetEncoding();
  sendNetworkEvent({ type: 'hallo', protocol: PROTOCOL_VERSION, version: GAME_VERSION });
  clearTimeout(helloTimer);
  helloTimer = setTimeout(() => {
    helloTimer = null;
    if (state.network.connected && !state.network.protocolOk) abortOnVersionMismatch();
  }, HELLO_TIMEOUT_MS);
}

function checkHello(data) {
  if (data.protocol === PROTOCOL_VERSION) {
    state.network.protocolOk = true;
    clearTimeout(helloTimer);
    helloTimer = null;
    if (state.network.connected && state.network.connectionPhase === 4) {
      setConnectionPhase(5, 'BEREIT, SPIEL STARTET');
    }
  } else {
    abortOnVersionMismatch();
  }
}

// End the online session cleanly because of a different protocol version
export function abortOnVersionMismatch() {
  clearTimeout(helloTimer);
  helloTimer = null;
  if (!state.network.isOnline) return;
  if (state.network.connected) sendNetworkEvent({ type: 'peer_left' });
  if (state.cutsceneActive) Cutscene.skipCutscene(true);
  disconnectNetwork();
  if (state.gameRunning || state.gameOverActive) Utils.restartGame();
  if (Utils && Utils.setGameMode) Utils.setGameMode('online');
  updateOnlineStatus(VERSIONS_MESSAGE, true);
}

// Dynamic import of modern Trystero (@trystero-p2p/torrent or nostr)
async function loadTrystero() {
  if (trysteroJoinRoom) return trysteroJoinRoom;
  try {
    const trystero = await import('https://cdn.jsdelivr.net/npm/@trystero-p2p/torrent/+esm');
    trysteroJoinRoom = trystero.joinRoom;
    return trysteroJoinRoom;
  } catch (e1) {
    try {
      const trystero = await import('https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr/+esm');
      trysteroJoinRoom = trystero.joinRoom;
      return trysteroJoinRoom;
    } catch (e2) {
      console.warn('Trystero could not be loaded from the CDN (e.g. offline mode):', e2);
      // Fallback / mock for local tests
      trysteroJoinRoom = (config, roomId) => ({
        makeAction: name => [
          data => {}, // send
          cb => {}, // on receive
        ],
        onPeerJoin: cb => {},
        onPeerLeave: cb => {},
        leave: () => {},
      });
      return trysteroJoinRoom;
    }
  }
}

let turnWarningIssued = false;

// Fetches TURN credentials from the worker. Returns null on any error (the connection then runs with STUN only).
export async function getTurnConfig(timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(state.turnApiUrl, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const payload = await response.json();
    if (payload && Array.isArray(payload.iceServers) && payload.iceServers.length > 0) {
      return payload.iceServers;
    }
    throw new Error('No iceServers in the response');
  } catch (e) {
    if (!turnWarningIssued) {
      turnWarningIssued = true;
      console.warn('TURN not available, using STUN only:', e && e.message);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function updateOnlineStatus(text, isError = false) {
  const statusEl = document.getElementById('online-status');
  if (!statusEl) return;
  statusEl.style.display = 'block';
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#e74c3c' : '#f1c40f';
  statusEl.style.borderColor = isError ? 'rgba(231, 76, 60, 0.4)' : 'rgba(241, 196, 15, 0.3)';
}

// Connection progress (step 1/5 to 5/5). Only phases the game can really detect are shown:
// tracker signaling, key exchange and ICE are not observable in Trystero.
export const CONNECTION_STEPS = 5;
export const HINT_ROOM_CODE_AFTER_S = 20;
export const HINT_NETWORK_AFTER_S = 45;
export const HINT_ROOM_CODE = 'Raum-Code prüfen, der Host muss den Raum geöffnet haben';
export const HINT_NETWORK = 'Manche Netzwerke blockieren direkte Verbindungen. Ggf. anderes Netz versuchen';
let connectionTimer = null;
let connectionStart = 0; // Start of step 3 (Date.now())
let connectionText = '';

function stopConnectionTimer() {
  clearInterval(connectionTimer);
  connectionTimer = null;
}

function drawConnection() {
  const statusEl = document.getElementById('online-status');
  if (!statusEl) return;
  const net = state.network;
  const number = net.connectionPhase;
  statusEl.style.display = 'block';
  statusEl.style.color = '#f1c40f';
  statusEl.style.borderColor = 'rgba(241, 196, 15, 0.3)';
  statusEl.textContent = '';
  const line = (cls, text) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    statusEl.appendChild(el);
  };
  const code = net.roomCode || '---';
  line('vp-kopf', net.isHost ? `RAUM-CODE: ${code}` : `VERBINDE MIT RAUM ${code}`);
  let step = `${number}/${CONNECTION_STEPS} ${connectionText}`;
  const seconds = number === 3 ? Math.max(0, Math.floor((Date.now() - connectionStart) / 1000)) : -1;
  if (seconds >= 0) step += ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')})`;
  line('vp-schritt', step);
  const bar = document.createElement('div');
  bar.className = 'vp-balken';
  for (let i = 1; i <= CONNECTION_STEPS; i++) {
    const segment = document.createElement('span');
    if (i <= number) segment.className = 'aktiv';
    bar.appendChild(segment);
  }
  statusEl.appendChild(bar);
  if (net.connectionDetail) line('vp-detail', net.connectionDetail);
  if (number === 3) {
    if (!net.isHost && seconds >= HINT_ROOM_CODE_AFTER_S) line('vp-detail', HINT_ROOM_CODE);
    if (seconds >= HINT_NETWORK_AFTER_S) line('vp-detail', HINT_NETWORK);
  }
}

// Sets step number (1-5) with a text; detail (e.g. TURN status) stays visible until the next detail.
export function setConnectionPhase(number, text, detail) {
  const net = state.network;
  if (number === 1) {
    net.connectionHistory = [];
    net.connectionDetail = '';
  }
  if (detail !== undefined) net.connectionDetail = detail;
  net.connectionPhase = number;
  net.connectionHistory.push(number);
  connectionText = text;
  if (number === 3) connectionStart = Date.now();
  if (number === 3 || number === 4) {
    if (!connectionTimer) connectionTimer = setInterval(drawConnection, 1000);
  } else {
    stopConnectionTimer();
  }
  drawConnection();
}

// The connection setup ends (error, abort, disconnect). Returns the suffix for error messages
// if the setup was stuck in step 1-4.
function endConnectionPhase() {
  const number = state.network.connectionPhase;
  stopConnectionTimer();
  state.network.connectionPhase = 0;
  return number >= 1 && number < CONNECTION_STEPS ? ` (BEI SCHRITT ${number}/${CONNECTION_STEPS})` : '';
}

function connectionStillCurrent(code) {
  return state.network.isOnline && state.network.roomCode === code;
}

function markTeammateConnected() {
  if (state.network.protocolOk) setConnectionPhase(5, 'BEREIT, SPIEL STARTET');
  else setConnectionPhase(4, 'MITSPIELER VERBUNDEN, VERSIONEN ABGLEICHEN');
}

export function updateOnlineLobbyUI() {
  const isOnline = state.gameMode === 'online' || (state.network && state.network.isOnline);
  const lobby = document.getElementById('online-lobby-container');
  if (lobby) lobby.style.display = isOnline ? 'block' : 'none';
  if (!isOnline) return;

  const initialActions = document.getElementById('online-lobby-actions');
  const connectedControls = document.getElementById('online-connected-controls');
  const btnStart = document.getElementById('btn-online-start');
  const startText = document.getElementById('start-text');
  if (startText) startText.classList.add('start-text-lang');

  const isConnected = state.network && state.network.connected;
  const isHost = state.network && state.network.isHost;
  const roomCode = state.network && state.network.roomCode;

  if (isConnected) {
    if (initialActions) initialActions.style.display = 'none';
    if (connectedControls) connectedControls.style.display = 'flex';

    const showProgress = state.network.connectionPhase === 4;
    if (showProgress) drawConnection();

    if (isHost) {
      if (btnStart) btnStart.style.display = 'block';
      if (!showProgress) updateOnlineStatus(`MITSPIELER VERBUNDEN! (CODE: ${roomCode || '---'})`);
      if (startText) {
        startText.textContent = 'KLICKE "SPIEL STARTEN" ZUM BEGINN';
        startText.style.color = '#2ecc71';
      }
    } else {
      if (btnStart) btnStart.style.display = 'none';
      if (!showProgress) updateOnlineStatus(`VERBUNDEN MIT HOST! (CODE: ${roomCode || '---'})`);
      if (startText) {
        startText.textContent = 'WARTE AUF SPIELSTART DURCH DEN HOST...';
        startText.style.color = '#3498db';
      }
    }
  } else {
    if (initialActions) initialActions.style.display = 'flex';
    if (connectedControls) connectedControls.style.display = 'none';
    if (btnStart) btnStart.style.display = 'none';
    if (startText) {
      startText.textContent = 'RAUM ERSTELLEN ODER BEITRETEN ZUM START';
      startText.style.color = '#1abc9c';
    }
  }
}

export function hostStartGame() {
  if (!state.network.isHost || !state.network.connected) return;
  sendNetworkEvent({
    type: 'game_start',
    hostShipModel: state.selectedShipModel || 'viper',
    hostShipColor: state.selectedShipColor || 'red',
    clientShipModel: (state.p2 && state.p2.selectedShipModel) || 'phantom',
    clientShipColor: (state.p2 && state.p2.selectedShipColor) || 'blue',
  });
  if (Utils && Utils.updatePlayerShipVisuals) Utils.updatePlayerShipVisuals();
  startOnlineGame();
}

export function leaveOnlineRoom() {
  if (state.network.connected) {
    sendNetworkEvent({ type: 'peer_left' });
  }
  disconnectNetwork();
  updateOnlineStatus('RAUM VERLASSEN');
  updateOnlineLobbyUI();
  if (Utils && Utils.setGameMode) {
    Utils.setGameMode('online');
  }
}

function setupAction(room, name, onMessageCallback) {
  const rawAction = room.makeAction(name);
  let sendFn;

  if (Array.isArray(rawAction)) {
    // Tuple format [send, onReceive]
    const [send, onReceive] = rawAction;
    sendFn = send;
    if (typeof onReceive === 'function') {
      onReceive((data, peerId) => {
        onMessageCallback(data, peerId);
      });
    }
  } else if (rawAction && typeof rawAction === 'object') {
    // Modern object format: { send, onMessage }
    sendFn = data => {
      if (typeof rawAction.send === 'function') {
        rawAction.send(data);
      }
    };
    rawAction.onMessage = (data, meta) => {
      const peerId = meta && meta.peerId ? meta.peerId : meta;
      onMessageCallback(data, peerId);
    };
  } else {
    sendFn = () => {};
  }

  return sendFn;
}

function bindPeerEvents(room, onJoin, onLeave) {
  if (typeof room.onPeerJoin === 'function') {
    try {
      room.onPeerJoin(onJoin);
    } catch (e) {
      room.onPeerJoin = onJoin;
    }
  } else {
    room.onPeerJoin = onJoin;
  }

  if (typeof room.onPeerLeave === 'function') {
    try {
      room.onPeerLeave(onLeave);
    } catch (e) {
      room.onPeerLeave = onLeave;
    }
  } else {
    room.onPeerLeave = onLeave;
  }
}

export async function hostRoom(customCode = null) {
  const code = customCode || generateRoomCode();
  state.network.isOnline = true;
  state.network.isHost = true;
  state.network.isClient = false;
  state.network.roomCode = code;
  state.network.connected = false;
  state.network.protocolOk = false;
  resetNetEncoding();

  setConnectionPhase(1, 'VERBINDUNGSDATEN HOLEN');
  const turnConfig = await getTurnConfig();
  if (!connectionStillCurrent(code)) return;

  setConnectionPhase(2, 'NETZWERK-MODUL LADEN', turnConfig ? 'TURN verfügbar' : 'ohne TURN');
  const joinRoomFn = await loadTrystero();
  if (!joinRoomFn || !connectionStillCurrent(code)) return;

  if (room) {
    try {
      room.leave();
    } catch (e) {}
  }

  room = joinRoomFn({ appId: 'starshooter-p2p', ...(turnConfig ? { turnConfig } : {}) }, 'star_' + code);
  setConnectionPhase(3, `RAUM ${code} GEÖFFNET, WARTE AUF MITSPIELER`);

  sendStateAction = setupAction(room, 'state', (data, peerId) => {
    onStateCallbacks.forEach(cb => cb(data, peerId));
  });

  sendInputAction = setupAction(room, 'input', (data, peerId) => {
    onInputCallbacks.forEach(cb => cb(data, peerId));
  });

  sendEventAction = setupAction(room, 'event', (data, peerId) => {
    handleNetworkEvent(data, peerId);
  });

  bindPeerEvents(
    room,
    peerId => {
      onPeerJoined(peerId);
    },
    peerId => {
      state.network.connected = false;
      endPause();
      resetNetworkInputs();
      state.network.protocolOk = false;
      updateOnlineStatus(`MITSPIELER HAT DAS SPIEL VERLASSEN!${endConnectionPhase()}`, true);
      updateOnlineLobbyUI();
    },
  );

  return code;
}

export function startOnlineGame() {
  let startScreen = document.getElementById('start-screen');
  if (startScreen) startScreen.style.display = 'none';

  Utils.applyPlayfieldWidth('online');

  const uiP2 = dom.uiContainerP2 || document.getElementById('ui-container-p2');
  if (uiP2) uiP2.style.display = 'flex';

  state.invulnerableTimer = 0;
  if (state.p2) state.p2.invulnerableTimer = 0;
  // After a (re)start the host begins with a keyframe, the client with fresh inputs
  encoder.forceKeyframe();
  inputSender.reset();
  if (state.network.isHost) resetNetworkInputs();
  // HUD labels (Gleve: SWEEP/DASH) for both ships, mobile button for the local player
  Utils.updateShipHudLabels();

  Cutscene.startCutscene();
}

export function onPeerJoined(peerId) {
  state.network.connected = true;
  state.network.peerId = peerId;
  markTeammateConnected();
  updateOnlineLobbyUI();
  startHandshake();

  if (state.network.isHost) {
    hostStartGame();
  }
}

export async function joinOnlineRoom(code) {
  const cleanCode = (code || '').trim().toUpperCase();
  if (!cleanCode) {
    updateOnlineStatus('BITTE GÜLTIGEN RAUM-CODE EINGEBEN!', true);
    return false;
  }

  state.network.isOnline = true;
  state.network.isHost = false;
  state.network.isClient = true;
  state.network.roomCode = cleanCode;
  state.network.connected = false;
  state.network.protocolOk = false;
  resetNetEncoding();

  setConnectionPhase(1, 'VERBINDUNGSDATEN HOLEN');
  const turnConfig = await getTurnConfig();
  if (!connectionStillCurrent(cleanCode)) return;

  setConnectionPhase(2, 'NETZWERK-MODUL LADEN', turnConfig ? 'TURN verfügbar' : 'ohne TURN');
  const joinRoomFn = await loadTrystero();
  if (!joinRoomFn || !connectionStillCurrent(cleanCode)) return;

  if (room) {
    try {
      room.leave();
    } catch (e) {}
  }

  room = joinRoomFn({ appId: 'starshooter-p2p', ...(turnConfig ? { turnConfig } : {}) }, 'star_' + cleanCode);
  setConnectionPhase(3, `SUCHE HOST IN RAUM ${cleanCode}`);

  sendStateAction = setupAction(room, 'state', (data, peerId) => {
    onStateCallbacks.forEach(cb => cb(data, peerId));
  });

  sendInputAction = setupAction(room, 'input', (data, peerId) => {
    onInputCallbacks.forEach(cb => cb(data, peerId));
  });

  sendEventAction = setupAction(room, 'event', (data, peerId) => {
    handleNetworkEvent(data, peerId);
  });

  bindPeerEvents(
    room,
    peerId => {
      state.network.connected = true;
      state.network.peerId = peerId;
      markTeammateConnected();
      updateOnlineLobbyUI();
      startHandshake();

      // The client reports the ship chosen in its hangar to the host
      const myModel = state.selectedShipModel || (state.p2 && state.p2.selectedShipModel) || 'phantom';
      const myColor = state.selectedShipColor || (state.p2 && state.p2.selectedShipColor) || 'blue';
      if (state.p2) {
        state.p2.selectedShipModel = myModel;
        state.p2.selectedShipColor = myColor;
      }
      sendNetworkEvent({
        type: 'client_ready',
        clientShipModel: myModel,
        clientShipColor: myColor,
      });
    },
    peerId => {
      state.network.connected = false;
      endPause();
      updateOnlineStatus(`VERBINDUNG ZUM HOST VERLOREN!${endConnectionPhase()}`, true);
      updateOnlineLobbyUI();
    },
  );

  return true;
}

export function handleNetworkEvent(data, peerId = null) {
  if (!data) return;

  if (data.type === 'pause_start' || data.type === 'pause_end') {
    processPauseEvent(data);
    return;
  }

  if (data.type === 'hallo') {
    checkHello(data);
    return;
  }

  if (data.type === 'keyframe_request') {
    if (state.network.isHost) encoder.forceKeyframe();
    return;
  }

  if (state.network.isHost) {
    if (data.type === 'client_ready') {
      if (state.p2) {
        state.p2.selectedShipModel = data.clientShipModel || 'phantom';
        state.p2.selectedShipColor = data.clientShipColor || 'blue';
      }
      if (Utils && Utils.updatePlayerShipVisuals) Utils.updatePlayerShipVisuals();
    }
    if (data.type === 'skip_cutscene') {
      Cutscene.skipCutscene(true);
    }
    if (data.type === 'highscore_name') {
      Utils.receiveOnlineHighscoreName(data.role, data.name);
    }
    if (data.type === 'peer_left') {
      state.network.connected = false;
      endPause();
      resetNetworkInputs();
      state.network.protocolOk = false;
      updateOnlineStatus(`MITSPIELER HAT DEN RAUM VERLASSEN!${endConnectionPhase()}`, true);
      updateOnlineLobbyUI();
    }
  } else {
    // Client Handling
    if (data.type === 'peer_joined') {
      state.network.connected = true;
      state.network.peerId = peerId;
      updateOnlineLobbyUI();

      // The client reports its ship back to the host
      const myModel = state.selectedShipModel || (state.p2 && state.p2.selectedShipModel) || 'phantom';
      const myColor = state.selectedShipColor || (state.p2 && state.p2.selectedShipColor) || 'blue';
      if (state.p2) {
        state.p2.selectedShipModel = myModel;
        state.p2.selectedShipColor = myColor;
      }
      sendNetworkEvent({
        type: 'client_ready',
        clientShipModel: myModel,
        clientShipColor: myColor,
      });
    }
    if (data.type === 'peer_left') {
      state.network.connected = false;
      endPause();
      updateOnlineStatus(`HOST HAT DEN RAUM VERLASSEN!${endConnectionPhase()}`, true);
      updateOnlineLobbyUI();
    }
    if (data.type === 'game_start') {
      // Save the client's own ship and color choice from the hangar before it gets overwritten
      const clientChosenModel =
        state.selectedShipModel || (state.p2 && state.p2.selectedShipModel) || data.clientShipModel || 'viper';
      const clientChosenColor =
        state.selectedShipColor || (state.p2 && state.p2.selectedShipColor) || data.clientShipColor || 'red';

      // The host is P1
      if (data.hostShipModel) state.selectedShipModel = data.hostShipModel;
      if (data.hostShipColor) state.selectedShipColor = data.hostShipColor;

      // The client itself is P2
      if (state.p2) {
        state.p2.selectedShipModel = clientChosenModel;
        state.p2.selectedShipColor = clientChosenColor;
      }
      if (Utils && Utils.updatePlayerShipVisuals) Utils.updatePlayerShipVisuals();
      startOnlineGame();
    }
    if (data.type === 'game_over') {
      Utils.triggerGameOver(data.finalScore);
    }
    if (data.type === 'skip_cutscene') {
      Cutscene.skipCutscene(true);
    }
    if (data.type === 'player_hit' && data.target === 'p2') {
      Audio.playHit('player');
      // Set i-frames as on the host so clientStep() ends the blinking again
      if (state.p2)
        state.p2.invulnerableTimer =
          Number.isFinite(data.invulnerable) && data.invulnerable > 0 ? data.invulnerable : 45;
      Display.drawPlayer();
      Display.flashPlayfield(data.shield ? 'rgba(52, 152, 219, 0.3)' : '#900', 150);
    }
    if (data.type === 'powerup_collected' && data.target === 'p2') {
      Display.flashPlayfield(data.color || '#f1c40f', 100);
    }
    if (data.type === 'highscore_name') {
      Utils.receiveOnlineHighscoreName(data.role, data.name);
    }
    if (data.type === 'highscore_committed') {
      if (state.globalHighscoresCache) {
        state.globalHighscoresCache['online'] = null;
      }
      if (Utils && Utils.fetchGlobalHighscores) {
        Utils.fetchGlobalHighscores('online');
      }
    }
    if (data.type === 'bomb_detonated') {
      Utils.createBombDetonation(data.x, data.y, data.color, data.radius, data.tier, data.isMini);
    }
    if (data.type === 'missile_detonated') {
      Utils.createMissileDetonation(data.x, data.y, data.radius);
    }
    if (data.type === 'emp_triggered') {
      Sniper.showEmp(data);
    }
    if (data.type === 'grenade_detonated') {
      Sniper.showDetonation(data);
    }
    if (data.type === 'mine_exploded') {
      Sniper.showMineExplosion(data);
    }
    if (data.type === 'shockwave') {
      Shockwave.showShockwave(data);
    }
    if (data.type === 'target_destroyed') {
      Utils.createExplosion(data.x, data.y, data.color, data.count);
      if (data.soundType) Audio.playExplosion(data.soundType);
    }
  }

  onEventCallbacks.forEach(cb => cb(data, peerId));
}

// Host: send the full snapshot as a delta packet (worldStep: moving simulation steps, for dead reckoning)
export function sendNetworkState(stateSnapshot, worldStep) {
  if (!state.network.connected) return;
  state.network.snapshotPackets = (state.network.snapshotPackets || 0) + 1;
  const packet = encoder.encode(stateSnapshot, worldStep);
  if (sendStateAction) {
    sendStateAction(packet);
  }
}

// Client: decode and apply the snapshot packet. Without a keyframe (start, gap) it waits
// and requests a keyframe; packets of another protocol version end the session.
export function receiveSnapshotPacket(packet) {
  if (!packet || packet.v !== PROTOCOL_VERSION) {
    abortOnVersionMismatch();
    return;
  }
  const snapshot = decoder.decode(packet);
  if (!snapshot) {
    if (keyframeWaitCounter % KEYFRAME_INTERVAL === 0) sendNetworkEvent({ type: 'keyframe_request' });
    keyframeWaitCounter++;
    return;
  }
  keyframeWaitCounter = 0;
  applyGameStateSnapshot(snapshot);
}

export function sendNetworkInput(inputData) {
  state.network.inputPackets = (state.network.inputPackets || 0) + 1;
  state.network.lastSentInput = inputData;
  if (sendInputAction && state.network.connected) {
    sendInputAction(inputData);
  }
}

// Client: call once per step, sends only on change or as a heartbeat
export function sendInput() {
  const packet = inputSender.next(serializePlayerInput());
  if (packet) sendNetworkInput(packet);
}

// Host: check and apply the client's input packet
export function receiveInputPacket(packet) {
  if (!packet || packet.v !== PROTOCOL_VERSION) {
    abortOnVersionMismatch();
    return;
  }
  applyPlayerInput(packet);
}

export function sendNetworkEvent(eventData) {
  state.network.lastSentEvent = eventData;
  if (sendEventAction && state.network.connected) {
    sendEventAction(eventData);
  }
}

export function onNetworkState(cb) {
  onStateCallbacks.push(cb);
}

export function onNetworkInput(cb) {
  onInputCallbacks.push(cb);
}

export function onNetworkEvent(cb) {
  onEventCallbacks.push(cb);
}

export function disconnectNetwork() {
  if (room) {
    try {
      room.leave();
    } catch (e) {}
    room = null;
  }
  state.network.isOnline = false;
  state.network.isHost = false;
  state.network.isClient = false;
  state.network.roomCode = null;
  state.network.connected = false;
  state.network.protocolOk = false;
  clearTimeout(helloTimer);
  helloTimer = null;
  endConnectionPhase();
  resetNetEncoding();
  resetNetworkInputs();
  endPause();
  state.network.peerId = null;
  const statusEl = document.getElementById('online-status');
  if (statusEl) statusEl.style.display = 'none';
}

// Dash/sweep state of the Gleve for rendering on the client (Gleve ships only)
function gleveStatus(s) {
  if (!Gleve.isGleve(s)) return {};
  return {
    gleveDashCharges: s.gleveDashCharges === undefined ? Gleve.dashMaxCharges(s) : s.gleveDashCharges,
    gleveDashTimer: s.gleveDashTimer || 0,
    gleveBounceTimer: s.gleveBounceTimer || 0,
    gleveInvulnerable: s.gleveInvulnerable || 0,
    gleveSweepTimer: s.gleveSweepTimer || 0,
    gleveSweepAngle: s.gleveSweepAngle || 0,
    gleveSweepDirection: s.gleveSweepDirection || 0,
  };
}

// Roll state of the Viper (timer, direction, cooldown) for display and cooldown sync on the client
function viperStatus(s) {
  if (!Viper.isViper(s)) return {};
  return {
    viperRollTimer: s.viperRollTimer || 0,
    viperRollDirection: s.viperRollDirection || 0,
    viperRollCooldown: s.viperRollCooldown || 0,
    viperOverdriveStrip: s.viperOverdriveStrip || 0,
    viperOverdriveTimer: s.viperOverdriveTimer || 0,
    viperCombo: s.viperCombo || 0,
    viperComboTimer: s.viperComboTimer || 0,
  };
}

// Projectiles flung away by the Gleve (missing = false)
function harmlessFlag(o) {
  return o.harmless ? { harmless: true } : {};
}

export function serializeGameState() {
  return {
    p1: {
      x: state.x,
      y: state.y,
      rotate: state.rotation || 0,
      lives: state.lives,
      energy: state.energy,
      maxEnergy: state.maxEnergy,
      shieldTier: state.shieldTier,
      laserTier: state.laserTier,
      missileTier: state.missileTier,
      bombTier: state.bombTier,
      // Send HUD flags only when active (saves bandwidth, missing = false)
      ...(state.laserPierce ? { laserPierce: true } : {}),
      ...(state.autolaserActive ? { autolaserActive: true } : {}),
      missileCooldown: state.missileCooldown,
      bombCooldown: state.bombCooldown,
      laserShoots: state.laserShoots,
      isDead: state.isDead,
      // Viper splitters and Phantom shield charge for the client's HUD
      splitterRed: state.splitterRed || 0,
      splitterWhite: state.splitterWhite || 0,
      phantomShieldRegenTimer: state.phantomShieldRegenTimer || 0,
      phantomShieldRegenMax: state.phantomShieldRegenMax || 900,
      hacks: state.hacks || [],
      ...gleveStatus(state),
      ...viperStatus(state),
      ...Sniper.networkStatus(state),
    },
    p2: state.p2
      ? {
          x: state.p2.x,
          y: state.p2.y,
          rotate: state.p2.rotate || 0,
          lives: state.p2.lives,
          energy: state.p2.energy,
          maxEnergy: state.p2.maxEnergy,
          shieldTier: state.p2.shieldTier,
          laserTier: state.p2.laserTier,
          missileTier: state.p2.missileTier,
          bombTier: state.p2.bombTier,
          // Send HUD flags only when active (saves bandwidth, missing = false)
          ...(state.p2.laserPierce ? { laserPierce: true } : {}),
          ...(state.p2.autolaserActive ? { autolaserActive: true } : {}),
          missileCooldown: state.p2.missileCooldown,
          bombCooldown: state.p2.bombCooldown,
          laserShoots: state.p2.laserShoots,
          isDead: state.p2.isDead,
          // Viper splitters and Phantom shield charge for the client's HUD
          splitterRed: state.p2.splitterRed || 0,
          splitterWhite: state.p2.splitterWhite || 0,
          phantomShieldRegenTimer: state.p2.phantomShieldRegenTimer || 0,
          phantomShieldRegenMax: state.p2.phantomShieldRegenMax || 900,
          hacks: state.p2.hacks || [],
          ...gleveStatus(state.p2),
          ...viperStatus(state.p2),
          ...Sniper.networkStatus(state.p2),
        }
      : null,
    score: state.score,
    level: state.level,
    bossActive: state.bossActive,
    ...(state.bossWarningActive ? { bossWarningActive: true } : {}),
    enemies: arrays.enemies.map(f => ({
      id: f.id,
      x: f.x,
      y: f.y,
      hp: f.hp,
      maxHp: f.maxHp,
      size: f.size || 30,
      type: f.type || 1,
      pattern: f.pattern || 'normal',
      hasShield: (f.shieldHp || 0) > 0,
      shieldHp: f.shieldHp || 0,
      ...(typeof f.rot === 'number' ? { rot: f.rot } : {}),
      ...(f.open !== undefined ? { open: !!f.open } : {}),
      ...(f.stunned > 0 ? { stunned: f.stunned } : {}),
    })),
    asteroids: arrays.asteroids.map(a => ({
      id: a.id,
      x: a.x,
      y: a.y,
      size: a.size || 30,
      isMagma: a.isMagma || a.isIndestructible || false,
      isIndestructible: a.isIndestructible || false,
      carriesPowerup: a.carriesPowerup || false,
      color: a.color,
      color2: a.color2,
      form: a.form ? Entities.formAsText(a.form) : null,
      crack: a.crack,
      rot: a.rot || 0,
      hp: a.hp,
      maxHp: a.maxHp || a.hp,
    })),
    bosses: arrays.bosses.map(b => ({
      id: b.id,
      x: b.x,
      y: b.y,
      hp: b.hp,
      maxHp: b.maxHp,
      size: b.size || 100,
      type: b.bossType || b.type || 1,
      enrage: b.enragePhaseActive || false,
      ...(b.open !== undefined ? { open: !!b.open } : {}),
      ...(b.stunned > 0 ? { stunned: b.stunned } : {}),
    })),
    laser: arrays.laserArray.map(l => ({
      id: l.id,
      x: l.x,
      y: l.y,
      vx: l.vx || 0,
      vy: l.vy || 15,
      width: l.width || 4,
      height: l.height || 20,
      color: l.color || (l.owner === 'p2' ? '#3498db' : '#00ffff'),
      owner: l.owner || 'p1',
    })),
    missiles: arrays.missileArray.map(r => ({
      id: r.id,
      x: r.x,
      y: r.y,
      rot: r.rot || (r.vy ? (Math.atan2(-r.vy, r.vx || 0.0001) * 180) / Math.PI + 90 : 0),
      owner: r.owner || 'p1',
      homing: r.homing || false,
      tier: (r.owner === 'p2' ? state.p2 && state.p2.missileTier : state.missileTier) || 1,
    })),
    bombs: arrays.bombArray.map(b => ({
      id: b.id,
      x: b.x,
      y: b.y,
      rot: b.rot || 0,
      owner: b.owner || 'p1',
      tier: b.tier || 1,
      isMini: b.isMini || false,
    })),
    // Sniper grenades in flight (empty without a sniper, like gleveWaves)
    sniperGrenades: Sniper.networkGrenadeList(),
    // Sniper sticky mines (empty without a sniper)
    sniperMines: Sniper.networkMineList(),
    // Rock segments (rock levels): height and profile as text
    rock: Rock.networkList(),
    gleveWaves: arrays.gleveWaves.map(w => ({
      id: w.id,
      x: w.x,
      y: w.y,
      width: w.width,
      owner: w.owner,
    })),
    hackProjectiles: arrays.hackProjectileArray.map(hp => ({
      id: hp.id,
      x: hp.x,
      y: hp.y,
      ...harmlessFlag(hp),
    })),
    enemyLaser: arrays.enemyLaserArray.map(fl => ({
      id: fl.id,
      x: fl.x,
      y: fl.y,
      vx: fl.vx || 0,
      vy: fl.vy || 7,
      ...(fl.spore ? { spore: true } : {}),
      ...harmlessFlag(fl),
    })),
    bossLaser: arrays.bossLaserArray.map(bl => ({
      id: bl.id,
      x: bl.x,
      y: bl.y,
      vx: bl.vx || 0,
      vy: bl.vy || 6,
      width: bl.width || 8,
      height: bl.height || 25,
      ...harmlessFlag(bl),
    })),
    bossMissiles: arrays.bossMissileArray.map(br => ({
      id: br.id,
      x: br.x,
      y: br.y,
      vx: br.vx || 0,
      vy: br.vy || 2,
      rot: (Math.atan2(br.vy || 2, br.vx || 0) * 180) / Math.PI + 90,
    })),
    bossBombs: arrays.bossBombArray.map(bb => ({
      id: bb.id,
      x: bb.x,
      y: bb.y,
      size: bb.size || 26,
    })),
    powerups: arrays.powerups.map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      type: p.type || p.type,
      owner: p.owner,
      towedBy: p.towedBy,
    })),
  };
}

// Matches a client list by id against the snapshot data: existing elements are
// reused and updated, new ones created, vanished ones removed.
function syncList(list, payloadList, create, update) {
  if (!payloadList) return;
  const present = new Map();
  list.forEach(obj => {
    if (obj.id !== undefined) present.set(obj.id, obj);
  });
  const newList = [];
  payloadList.forEach(payload => {
    const obj = present.get(payload.id);
    if (obj) {
      present.delete(payload.id);
      update(obj, payload);
      newList.push(obj);
    } else {
      newList.push(create(payload));
    }
  });
  list.forEach(obj => {
    if (obj.id === undefined || present.get(obj.id) === obj) {
      Display.remove(obj);
    }
  });
  list.length = 0;
  newList.forEach(obj => list.push(obj));
}

// Apply the stun (sniper grenade) from the snapshot (the display shows stunned > 0)
function showStun(obj, payload) {
  obj.stunned = payload.stunned > 0 ? payload.stunned : 0;
}

// Flung away by the Gleve: tint orange and rotate in the flight direction (once)
function applyHarmless(obj, payload) {
  if (!payload.harmless || obj.harmless) return;
  obj.harmless = true;
  Gleve.showParried(obj, payload.vx, payload.vy);
}

// Max cooldown for the missile HUD bar (Gleve: dash cooldown)
function maxMissileCooldown(s) {
  if (Gleve.isGleve(s)) return Gleve.dashCooldown(s);
  if (Sniper.isSniper(s)) return Sniper.grenadeCooldown(s);
  if (s.missileTier >= 4) return 120;
  if (s.missileTier >= 2) return 150;
  return 180;
}

// From which energy level the primary weapon is ready (Gleve: sweep cost), for the bar color
function fuseThreshold(s) {
  return Gleve.isGleve(s) ? Gleve.sweepCost(s) : s.minFuseEnergy || 15;
}

// Apply a player's weapon tiers and HUD flags from the snapshot (missing tiers stay)
function applyWeaponTiers(target, payload) {
  if (payload.laserTier !== undefined) target.laserTier = payload.laserTier;
  if (payload.missileTier !== undefined) target.missileTier = payload.missileTier;
  if (payload.bombTier !== undefined) target.bombTier = payload.bombTier;
  target.laserPierce = Boolean(payload.laserPierce);
  target.autolaserActive = Boolean(payload.autolaserActive);
  // Viper splitters and Phantom shield charge (missing values stay)
  if (payload.splitterRed !== undefined) target.splitterRed = payload.splitterRed;
  if (payload.splitterWhite !== undefined) target.splitterWhite = payload.splitterWhite;
  if (payload.phantomShieldRegenTimer !== undefined) target.phantomShieldRegenTimer = payload.phantomShieldRegenTimer;
  if (payload.phantomShieldRegenMax !== undefined) target.phantomShieldRegenMax = payload.phantomShieldRegenMax;
}

// Everything the powerup HUD shows; redraw only on change.
// The host redraws the Phantom shield charge every 6 steps, the client just as coarsely.
function hudSignature(s) {
  const charge = Math.floor((s.phantomShieldRegenTimer || 0) / 6);
  return [s.laserTier, s.missileTier, s.bombTier, s.laserPierce, s.shieldTier, s.autolaserActive, charge].join('|');
}
function splitterSignature(s) {
  return [s.splitterRed || 0, s.splitterWhite || 0, s.selectedShipModel].join('|');
}
let lastHudSignatureP1 = null;
let lastHudSignatureP2 = null;
let lastSplitterSignatureP1 = null;
let lastSplitterSignatureP2 = null;

export function applyGameStateSnapshot(snapshot) {
  if (!snapshot) return;

  const playfield = dom.playfield || document.getElementById('spielfeld');
  if (!playfield) return;

  snapshotReceived();

  // 0. Show the host's boss warning (alarm only when it appears)
  if (dom.warningOverlay) {
    const warningShown = dom.warningOverlay.style.display === 'flex';
    if (snapshot.bossWarningActive && !warningShown) {
      dom.warningOverlay.style.display = 'flex';
      Audio.playBossAlert();
    } else if (!snapshot.bossWarningActive && warningShown) {
      dom.warningOverlay.style.display = 'none';
    }
  }

  // 1. Sync P1 state & visuals on client
  if (snapshot.p1) {
    state.x = snapshot.p1.x;
    state.y = snapshot.p1.y;
    state.lives = snapshot.p1.lives;
    state.energy = snapshot.p1.energy;
    state.maxEnergy = snapshot.p1.maxEnergy || state.maxEnergy;
    state.shieldTier = snapshot.p1.shieldTier || 0;
    applyWeaponTiers(state, snapshot.p1);
    state.isDead = snapshot.p1.isDead || false;
    state.hacks = snapshot.p1.hacks || [];
    // The host's Gleve: only render dash/bounce/sweep (clientStep draws)
    Gleve.applySnapshot(state, snapshot.p1, false);
    Viper.applySnapshot(state, snapshot.p1, false);
    Sniper.applySnapshot(state, snapshot.p1, 'p1', false);

    setInterpolationTarget(p1Display, state.x, state.y);
    applyP1Display();
    state.shipVisible = !state.isDead;
    state.rotation = snapshot.p1.rotate || 0;

    if (dom.energyBar) {
      dom.energyBar.style.width = (state.energy / (state.absMaxEnergy || 100)) * 100 + '%';
      if (state.unlimitedEnergy) {
        dom.energyBar.style.backgroundColor = '#f1c40f';
      } else {
        dom.energyBar.style.backgroundColor =
          state.energy < fuseThreshold(state) && !state.laserShoots ? '#e67e22' : '#1abc9c';
      }
    }
    if (snapshot.p1.missileCooldown !== undefined) {
      state.missileCooldown = snapshot.p1.missileCooldown;
      const missileCdBar = document.getElementById('raketen-cd-balken');
      if (missileCdBar) {
        const maxMissileCd = maxMissileCooldown(state);
        let pctR = Math.max(0, 100 - (state.missileCooldown / maxMissileCd) * 100);
        missileCdBar.style.width = pctR + '%';
        missileCdBar.style.backgroundColor = state.missileCooldown <= 0 ? '#2ecc71' : '#e74c3c';
      }
      if (Gleve.isGleve(state) && snapshot.p1.gleveDashCharges !== undefined) {
        state.gleveDashCharges = snapshot.p1.gleveDashCharges;
        Gleve.showDashHud('p1', state);
      }
      if (Sniper.isSniper(state) && snapshot.p1.sniperGrenadeCharges !== undefined) {
        state.sniperGrenadeCharges = snapshot.p1.sniperGrenadeCharges;
        Sniper.showGrenadeHud('p1', state);
      }
    }
    if (snapshot.p1.bombCooldown !== undefined) {
      state.bombCooldown = snapshot.p1.bombCooldown;
      const bombCdBar = document.getElementById('bomben-cd-balken');
      if (bombCdBar) {
        let maxBombCd = 2400 - (state.bombTier || 1) * 240;
        let pctB = Math.max(0, 100 - (state.bombCooldown / maxBombCd) * 100);
        bombCdBar.style.width = pctB + '%';
        bombCdBar.style.backgroundColor = state.bombCooldown <= 0 ? '#2ecc71' : '#f39c12';
      }
    }
    const sigP1 = hudSignature(state);
    if (sigP1 !== lastHudSignatureP1) {
      lastHudSignatureP1 = sigP1;
      Utils.updateActivePowerupsUi();
    }
    const splitterP1 = splitterSignature(state);
    if (splitterP1 !== lastSplitterSignatureP1) {
      lastSplitterSignatureP1 = splitterP1;
      Utils.updateSplitterUI();
    }
  }

  // 2. Sync P2 stats
  if (snapshot.p2 && state.p2) {
    state.p2.lives = snapshot.p2.lives;
    state.p2.hacks = snapshot.p2.hacks || [];
    state.p2.energy = snapshot.p2.energy;
    state.p2.maxEnergy = snapshot.p2.maxEnergy || state.p2.maxEnergy;
    state.p2.shieldTier = snapshot.p2.shieldTier || 0;
    applyWeaponTiers(state.p2, snapshot.p2);
    state.p2.isDead = snapshot.p2.isDead || false;
    // Own Gleve: client.js predicts the dash, bounce and sweep come from the host
    Gleve.applySnapshot(state.p2, snapshot.p2, true);
    Viper.applySnapshot(state.p2, snapshot.p2, true);
    Sniper.applySnapshot(state.p2, snapshot.p2, 'p2', true);

    state.p2.shipVisible = !state.p2.isDead;

    if (dom.energyBarP2) {
      dom.energyBarP2.style.width = (state.p2.energy / (state.p2.absMaxEnergy || 100)) * 100 + '%';
      dom.energyBarP2.style.backgroundColor =
        state.p2.energy < fuseThreshold(state.p2) && !state.p2.laserShoots ? '#e67e22' : '#3498db';
    }
    if (snapshot.p2.missileCooldown !== undefined) {
      state.p2.missileCooldown = snapshot.p2.missileCooldown;
      const missileCdBarP2 = document.getElementById('raketen-cd-balken-p2');
      if (missileCdBarP2) {
        const maxMissileCd = maxMissileCooldown(state.p2);
        let pctR = Math.max(0, 100 - (state.p2.missileCooldown / maxMissileCd) * 100);
        missileCdBarP2.style.width = pctR + '%';
        missileCdBarP2.style.backgroundColor = state.p2.missileCooldown <= 0 ? '#2ecc71' : '#e74c3c';
      }
      if (Gleve.isGleve(state.p2) && snapshot.p2.gleveDashCharges !== undefined) {
        state.p2.gleveDashCharges = snapshot.p2.gleveDashCharges;
        Gleve.showDashHud('p2', state.p2);
      }
      if (Sniper.isSniper(state.p2) && snapshot.p2.sniperGrenadeCharges !== undefined) {
        state.p2.sniperGrenadeCharges = snapshot.p2.sniperGrenadeCharges;
        Sniper.showGrenadeHud('p2', state.p2);
      }
    }
    if (snapshot.p2.bombCooldown !== undefined) {
      state.p2.bombCooldown = snapshot.p2.bombCooldown;
      const bombCdBarP2 = document.getElementById('bomben-cd-balken-p2');
      if (bombCdBarP2) {
        let maxBombCd = 2400 - (state.p2.bombTier || 1) * 240;
        let pctB = Math.max(0, 100 - (state.p2.bombCooldown / maxBombCd) * 100);
        bombCdBarP2.style.width = pctB + '%';
        bombCdBarP2.style.backgroundColor = state.p2.bombCooldown <= 0 ? '#2ecc71' : '#f39c12';
      }
    }
    Utils.updateLivesP2Ui();
    Utils.updateMaxEnergyMarkerP2();
    const sigP2 = hudSignature(state.p2);
    if (sigP2 !== lastHudSignatureP2) {
      lastHudSignatureP2 = sigP2;
      Utils.updateActivePowerupsP2Ui();
    }
    const splitterP2 = splitterSignature(state.p2);
    if (splitterP2 !== lastSplitterSignatureP2) {
      lastSplitterSignatureP2 = splitterP2;
      Utils.updateSplitterP2UI();
    }
  }

  // 3. HUD (Score, Level, Boss-HP)
  if (snapshot.score !== undefined) {
    state.score = snapshot.score;
    if (dom.scoreDisplay) {
      dom.scoreDisplay.textContent = String(state.score).padStart(5, '0');
    }
  }

  if (snapshot.level !== undefined && snapshot.level !== state.level) {
    state.level = snapshot.level;
    Utils.updateLevelUI();
  }

  Utils.updateLivesUi();
  Utils.updateMaxEnergyMarker();

  // 4. Boss HP
  if (snapshot.bosses && snapshot.bosses.length > 0) {
    state.bossActive = true;
    // Sum over all boss parts (one boss: its HP)
    const b = snapshot.bosses[0];
    const hp = snapshot.bosses.reduce((s, t) => s + t.hp, 0);
    const maxHp = snapshot.bosses.reduce((s, t) => s + (t.maxHp || 400), 0);
    if (dom.bossHpContainer) dom.bossHpContainer.style.display = 'block';
    if (dom.bossHpBar) {
      const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
      dom.bossHpBar.style.width = pct + '%';
      dom.bossHpBar.style.backgroundColor = b.enrage ? '#e74c3c' : '#e67e22';
    }
  } else {
    state.bossActive = false;
    if (dom.bossHpContainer) dom.bossHpContainer.style.display = 'none';
  }

  // 5. Replicate Enemies with full SVGs
  if (snapshot.enemies) {
    const currentIds = new Set();
    snapshot.enemies.forEach(fData => {
      currentIds.add(fData.id);
      let existing = arrays.enemies.find(f => f.id === fData.id);
      if (!existing) {
        const pattern = fData.pattern || 'normal';
        existing = Display.create(
          {
            id: fData.id,
            x: fData.x,
            y: fData.y,
            hp: fData.hp,
            maxHp: fData.maxHp,
            size: fData.size || 30,
            type: fData.type || 1,
            pattern,
            hasShield: fData.hasShield || false,
            shieldHp: fData.shieldHp || 0,
            color: Entities.getEnemyColor(pattern),
            ...(typeof fData.rot === 'number' ? { rot: fData.rot } : {}),
            ...(fData.open !== undefined ? { open: !!fData.open } : {}),
          },
          'enemy',
        );
        setInterpolationTarget(existing, fData.x, fData.y);
        arrays.enemies.push(existing);
      } else {
        existing.x = fData.x;
        existing.y = fData.y;
        existing.hp = fData.hp;
        existing.shieldHp = fData.shieldHp || 0;
        if (typeof fData.rot === 'number') existing.rot = fData.rot;
        if (fData.open !== undefined) existing.open = !!fData.open;
        setInterpolationTarget(existing, fData.x, fData.y);
      }
      showStun(existing, fData);
    });
    for (let i = arrays.enemies.length - 1; i >= 0; i--) {
      if (!currentIds.has(arrays.enemies[i].id)) {
        Display.remove(arrays.enemies[i]);
        arrays.enemies.splice(i, 1);
      }
    }
  }

  // 6. Replicate Asteroids with clipPath & styles
  if (snapshot.asteroids) {
    const currentIds = new Set();
    snapshot.asteroids.forEach(aData => {
      currentIds.add(aData.id);
      let existing = arrays.asteroids.find(a => a.id === aData.id);
      if (!existing) {
        // Fill missing look data (older snapshots in tests) with the base colors
        const reason = aData.isMagma ? config.magmaBasisColors[0] : { a: config.asteroidsBasisColors[0], b: '#2c3e50' };
        existing = Display.create(
          {
            id: aData.id,
            x: aData.x,
            y: aData.y,
            size: aData.size || 30,
            isMagma: aData.isMagma,
            isIndestructible: aData.isIndestructible,
            carriesPowerup: aData.carriesPowerup,
            color: aData.color || reason.a,
            color2: aData.color2 || reason.b,
            form: aData.form ? Entities.formFromText(aData.form) : Entities.generateAsteroidForm(),
            crack: aData.crack || 0,
            hp: aData.hp,
            maxHp: aData.maxHp,
            rot: aData.rot || 0,
          },
          'asteroid',
        );
        setInterpolationTarget(existing, aData.x, aData.y);
        arrays.asteroids.push(existing);
      } else {
        existing.x = aData.x;
        existing.y = aData.y;
        existing.hp = aData.hp;
        existing.maxHp = aData.maxHp;
        setInterpolationTarget(existing, aData.x, aData.y);
        if (aData.rot) existing.rot = aData.rot;
        existing.isIndestructible = aData.isIndestructible;
        existing.carriesPowerup = aData.carriesPowerup;
      }
    });
    for (let i = arrays.asteroids.length - 1; i >= 0; i--) {
      if (!currentIds.has(arrays.asteroids[i].id)) {
        Display.remove(arrays.asteroids[i]);
        arrays.asteroids.splice(i, 1);
      }
    }
  }

  // 7. Replicate Bosses
  if (snapshot.bosses) {
    const currentIds = new Set();
    snapshot.bosses.forEach(bData => {
      currentIds.add(bData.id);
      let existing = arrays.bosses.find(b => b.id === bData.id);
      if (!existing) {
        existing = Display.create(
          {
            id: bData.id,
            x: bData.x,
            y: bData.y,
            hp: bData.hp,
            maxHp: bData.maxHp,
            size: bData.size || 100,
            type: bData.type || 1,
            bossType: bData.type || 1,
            glowColor: Entities.getBossColor(state.level),
            ...(bData.open !== undefined ? { open: !!bData.open } : {}),
          },
          'boss',
        );
        setInterpolationTarget(existing, bData.x, bData.y);
        arrays.bosses.push(existing);
      } else {
        existing.x = bData.x;
        existing.y = bData.y;
        existing.hp = bData.hp;
        if (bData.open !== undefined) existing.open = !!bData.open;
        setInterpolationTarget(existing, bData.x, bData.y);
      }
      showStun(existing, bData);
    });
    for (let i = arrays.bosses.length - 1; i >= 0; i--) {
      if (!currentIds.has(arrays.bosses[i].id)) {
        Display.remove(arrays.bosses[i]);
        arrays.bosses.splice(i, 1);
      }
    }
  }

  // 8. Replicate Lasers
  syncList(
    arrays.laserArray,
    snapshot.laser,
    lData => {
      return Display.create(
        {
          id: lData.id,
          x: lData.x,
          y: lData.y,
          vx: lData.vx || 0,
          vy: lData.vy || 15,
          width: lData.width || 4,
          height: lData.height || 20,
          color: lData.color || (lData.owner === 'p2' ? '#3498db' : '#00ffff'),
          rot: lData.vx ? (Math.atan2(-15, lData.vx) * 180) / Math.PI + 90 : undefined,
          owner: lData.owner,
        },
        'laser',
      );
    },
    (obj, lData) => {
      obj.x = lData.x;
      obj.y = lData.y;
      obj.vx = lData.vx || 0;
      obj.vy = lData.vy || 15;
      if (lData.vx && lData.vx !== 0) obj.rot = (Math.atan2(-15, lData.vx) * 180) / Math.PI + 90;
    },
  );

  // 9. Replicate Rockets
  syncList(
    arrays.missileArray,
    snapshot.missiles,
    rData => {
      return Display.create(
        {
          id: rData.id,
          x: rData.x,
          y: rData.y,
          rot: rData.rot || 0,
          owner: rData.owner,
          tier: rData.tier || 1,
          homing: rData.homing || false,
          snapX: rData.x,
          snapY: rData.y,
        },
        'missile',
      );
    },
    (obj, rData) => {
      deriveSpeed(obj, rData.x, rData.y);
      obj.x = rData.x;
      obj.y = rData.y;
      obj.rot = rData.rot || 0;
    },
  );

  // 10. Replicate Bombs
  syncList(
    arrays.bombArray,
    snapshot.bombs,
    bData => {
      return Display.create(
        {
          id: bData.id,
          x: bData.x,
          y: bData.y,
          rot: bData.rot || 0,
          owner: bData.owner,
          tier: bData.tier || 1,
          isMini: bData.isMini || false,
          snapX: bData.x,
          snapY: bData.y,
        },
        'bomb',
      );
    },
    (obj, bData) => {
      deriveSpeed(obj, bData.x, bData.y);
      obj.x = bData.x;
      obj.y = bData.y;
      obj.rot = bData.rot || 0;
    },
  );

  // Blade waves of the Gleve (no extrapolation, they come with every snapshot)
  syncList(
    arrays.gleveWaves,
    snapshot.gleveWaves,
    wData => {
      return Display.create(
        {
          id: wData.id,
          x: wData.x,
          y: wData.y,
          startY: wData.y,
          width: wData.width,
          height: Gleve.WAVE_HEIGHT,
          owner: wData.owner,
          color: Gleve.waveColor(wData.owner),
        },
        'gleveWave',
      );
    },
    (obj, wData) => {
      obj.x = wData.x;
      obj.y = wData.y;
    },
  );

  // Grenades of the sniper host/client in flight
  Sniper.syncGrenades(snapshot.sniperGrenades);
  Sniper.syncMines(snapshot.sniperMines);
  Rock.sync(snapshot.rock);

  // 11. Replicate Enemy Lasers
  syncList(
    arrays.enemyLaserArray,
    snapshot.enemyLaser,
    flData => {
      const obj = Display.create(
        {
          id: flData.id,
          x: flData.x,
          y: flData.y,
          vx: flData.vx,
          vy: flData.vy,
          rot: flData.vx ? (Math.atan2(flData.vy || 7, flData.vx) * 180) / Math.PI - 90 : undefined,
          ...(flData.spore ? { spore: true, width: 10, height: 10 } : {}),
        },
        'enemyLaser',
      );
      applyHarmless(obj, flData);
      return obj;
    },
    (obj, flData) => {
      obj.x = flData.x;
      obj.y = flData.y;
      obj.vx = flData.vx;
      obj.vy = flData.vy;
      if (flData.vx && flData.vx !== 0) obj.rot = (Math.atan2(flData.vy || 7, flData.vx) * 180) / Math.PI - 90;
      applyHarmless(obj, flData);
    },
  );

  // 11b. Replicate hack projectiles
  syncList(
    arrays.hackProjectileArray,
    snapshot.hackProjectiles,
    hpData => {
      const obj = Display.create(
        {
          id: hpData.id,
          x: hpData.x,
          y: hpData.y,
          vx: 0,
          vy: 0,
          width: 12,
          height: 12,
          snapX: hpData.x,
          snapY: hpData.y,
        },
        'hackProjectile',
      );
      applyHarmless(obj, hpData);
      return obj;
    },
    (obj, hpData) => {
      deriveSpeed(obj, hpData.x, hpData.y);
      obj.x = hpData.x;
      obj.y = hpData.y;
      applyHarmless(obj, hpData);
    },
  );

  // 12. Replicate Boss Lasers
  syncList(
    arrays.bossLaserArray,
    snapshot.bossLaser,
    blData => {
      const obj = Display.create(
        {
          id: blData.id,
          x: blData.x,
          y: blData.y,
          vx: blData.vx,
          vy: blData.vy,
          rot: blData.vx ? (Math.atan2(blData.vy || 6, blData.vx) * 180) / Math.PI - 90 : undefined,
        },
        'bossLaser',
      );
      applyHarmless(obj, blData);
      return obj;
    },
    (obj, blData) => {
      obj.x = blData.x;
      obj.y = blData.y;
      obj.vx = blData.vx;
      obj.vy = blData.vy;
      if (blData.vx && blData.vx !== 0) obj.rot = (Math.atan2(blData.vy || 6, blData.vx) * 180) / Math.PI - 90;
      applyHarmless(obj, blData);
    },
  );

  // 13. Replicate Boss Rockets
  syncList(
    arrays.bossMissileArray,
    snapshot.bossMissiles,
    brData => {
      return Display.create(
        {
          id: brData.id,
          x: brData.x,
          y: brData.y,
          vx: brData.vx || 0,
          vy: brData.vy || 0,
          rot: brData.rot || 0,
        },
        'bossMissile',
      );
    },
    (obj, brData) => {
      obj.x = brData.x;
      obj.y = brData.y;
      obj.vx = brData.vx || 0;
      obj.vy = brData.vy || 0;
      obj.rot = brData.rot || 0;
    },
  );

  // 14. Replicate Boss Bombs
  syncList(
    arrays.bossBombArray,
    snapshot.bossBombs,
    bbData => {
      return Display.create(
        {
          id: bbData.id,
          x: bbData.x,
          y: bbData.y,
          size: bbData.size || 26,
          snapX: bbData.x,
          snapY: bbData.y,
        },
        'bossBomb',
      );
    },
    (obj, bbData) => {
      deriveSpeed(obj, bbData.x, bbData.y);
      obj.x = bbData.x;
      obj.y = bbData.y;
    },
  );

  // 15. Replicate Powerups with full styling & owner badges
  if (snapshot.powerups) {
    const currentIds = new Set();
    snapshot.powerups.forEach(pData => {
      currentIds.add(pData.id);
      let existing = arrays.powerups.find(p => p.id === pData.id);
      if (!existing) {
        existing = Display.create(
          {
            id: pData.id,
            x: pData.x,
            y: pData.y,
            size: 24,
            type: pData.type,
            color: Entities.powerupColor(pData.type),
            owner: pData.owner,
            towedBy: null,
          },
          'powerup',
        );
        setInterpolationTarget(existing, pData.x, pData.y);
        arrays.powerups.push(existing);
      } else {
        existing.x = pData.x;
        existing.y = pData.y;
        setInterpolationTarget(existing, pData.x, pData.y);
      }
      // Apply the host's tow state; clientStep sets the beam start, the display draws
      existing.towedBy = pData.towedBy || null;
    });
    for (let i = arrays.powerups.length - 1; i >= 0; i--) {
      if (!currentIds.has(arrays.powerups[i].id)) {
        Display.remove(arrays.powerups[i]);
        arrays.powerups.splice(i, 1);
      }
    }
  }

  // Show applied positions immediately (between snapshots simulationStep draws)
  Display.drawWorld();
}

export function serializePlayerInput() {
  const keys = state.keysPressed;
  // Sniper: the charge button (phone) counts like the laser key; the joystick fires normal shots without charging instead (auto)
  const sniper = state.p2 && Sniper.isSniper(state.p2);
  const isLaser = Boolean(keys.l || keys.b || (sniper && state.sniperChargingButton));
  const sniperAuto = Boolean(
    sniper && state.joystick && state.joystick.fires && !state.sniperChargingButton && !keys.b,
  );
  const isMissile = Boolean(keys.k || keys.v);
  const isBomb = Boolean(keys[' '] || keys.c || keys.enter);
  // Gleve: steering direction for the dash; during the predicted dash start position and dash direction
  const gleve =
    state.p2 && Gleve.isGleve(state.p2) ? Gleve.networkInput(state.p2, state.p2.clientControlDirection) : null;

  // Viper: in the roll's start step start position and direction (ro), the host rolls from there
  const viper = state.p2 && Viper.isViper(state.p2) ? Viper.networkInput(state.p2) : null;
  const start = gleve || viper;

  return {
    x: start ? start.x : state.p2 ? state.p2.x : state.x,
    y: start ? start.y : state.p2 ? state.p2.y : state.y,
    ...(gleve ? { rx: gleve.rx, ry: gleve.ry } : {}),
    ...(viper ? { ro: viper.ro } : {}),
    rotate: state.p2 ? state.p2.rotate || 0 : state.rotate || 0,
    laser: isLaser,
    missile: isMissile,
    bomb: isBomb,
    ...(sniperAuto ? { auto: true } : {}),
  };
}

export function applyPlayerInput(input) {
  if (!input || !state.p2) return;

  // Do not trust client values: only finite numbers, clamped to the playfield.
  // During a Gleve dash/bounce the host moves the ship itself (hits and bounce are the host's business).
  // The same applies to the Viper roll (running, or requested but not started yet).
  const dashActive =
    (Gleve.isGleve(state.p2) && Gleve.isDashActive(state.p2)) ||
    (Viper.isViper(state.p2) && (Viper.isRollActive(state.p2) || Boolean(state.p2.networkRollRequest)));
  if (Number.isFinite(input.x) && !dashActive) {
    state.p2.x = Math.min(Math.max(input.x, 0), config.playfieldWidth - config.playerSize);
  }
  if (Number.isFinite(input.y) && !dashActive) {
    state.p2.y = Math.min(Math.max(input.y, 0), config.playfieldHeight - config.playerSize);
  }
  state.p2.rotate = input.rotate || 0;

  // Gleve: the client's dash direction (magnitude at most 1)
  if (Number.isFinite(input.rx) && Number.isFinite(input.ry)) {
    const length = Math.hypot(input.rx, input.ry);
    const f = length > 1 ? 1 / length : 1;
    state.p2.networkDirection = { dx: input.rx * f, dy: input.ry * f };
  }

  // Viper: the client reports the start of its roll (direction -1/+1); the host checks the cooldown itself
  if ((input.ro === 1 || input.ro === -1) && Viper.isViper(state.p2)) state.p2.networkRollRequest = input.ro;

  if (input.laser !== undefined) {
    // Sniper: a new press stays remembered even if the release arrives in the same host step (short tap = one shot)
    if (input.laser && !state.p2.laserInputRequested && Sniper.isSniper(state.p2)) state.p2.networkLaserRequest = true;
    state.p2.laserInputRequested = Boolean(input.laser);
  }
  state.p2.sniperAutoInput = Boolean(input.auto);

  // Held keys apply until the next packet (weapons.js fires with them as with
  // a true in every step); a short press stays remembered until the shot as before
  if (input.missile !== undefined) {
    // A new press stays remembered for the Gleve dash even if the release arrives in the same host step
    if (input.missile && !state.p2.missileHeld) {
      state.p2.networkDashRequest = true;
      state.p2.networkGrenadeRequest = true; // Sniper: a short tap is not lost
    }
    state.p2.missileHeld = Boolean(input.missile);
  }
  if (input.bomb !== undefined) state.p2.bombHeld = Boolean(input.bomb);

  if (input.missile && !Sniper.isSniper(state.p2)) {
    state.p2.networkFireMissile = true;
  }

  if (input.bomb) {
    state.p2.networkFireBomb = true;
  }

  state.p2.rotation = state.p2.rotate;
}
