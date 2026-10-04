import { state, dom, config, arrays } from './state.js';
import * as Cutscene from './cutscene.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import { p1Anzeige, setzeInterpolationsZiel, leiteGeschwindigkeitAb, snapshotEmpfangen } from './client.js';
import { entferneTraktorstrahl } from './powerups.js';
import { beendePause, verarbeitePauseEvent } from './pause.js';
import { GAME_VERSION } from './changelog.js';
import { PROTOKOLL_VERSION, KEYFRAME_INTERVALL, SnapshotKodierer, SnapshotDekodierer, EingabeSender } from './netzkodierung.js';
import * as Gleve from './gleve.js';

let room = null;
let sendStateAction = null;
let sendInputAction = null;
let sendEventAction = null;

let onStateCallbacks = [];
let onInputCallbacks = [];
let onEventCallbacks = [];

let trysteroJoinRoom = null;

// Netzkodierung: Host kodiert Snapshots als Deltas, Client dekodiert sie, Client sendet Eingaben nur bei Aenderung
const kodierer = new SnapshotKodierer();
const dekodierer = new SnapshotDekodierer();
const eingabeSender = new EingabeSender();
let keyframeWarteZaehler = 0;

export const VERSIONS_MELDUNG = 'Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)';
export const HALLO_TIMEOUT_MS = 10000;
let halloTimer = null;

function setzeNetzkodierungZurueck() {
    kodierer.reset();
    dekodierer.reset();
    eingabeSender.reset();
    keyframeWarteZaehler = 0;
}

// Gehaltene Tasten des Clients auf dem Host vergessen (Spielstart, Verbindungsende)
function setzeNetzEingabenZurueck() {
    if (!state.p2) return;
    state.p2.laserInputRequested = false;
    state.p2.raketeGehalten = false;
    state.p2.bombeGehalten = false;
    state.p2.networkFireRakete = false;
    state.p2.networkFireBombe = false;
    state.p2.netzDashAnfrage = false;
    state.p2.netzRichtung = null;
}

// Beide Peers schicken nach dem Verbinden ihre Protokollversion. Alte Versionen schicken kein
// 'hallo'; kommt keins rechtzeitig, gilt das ebenfalls als unterschiedliche Version.
// protokollOk wird nur beim Raumaufbau und Trennen zurueckgesetzt, falls das hallo des Peers vor dem eigenen Join-Ereignis ankommt.
function starteHandshake() {
    setzeNetzkodierungZurueck();
    sendNetworkEvent({ type: 'hallo', protokoll: PROTOKOLL_VERSION, version: GAME_VERSION });
    clearTimeout(halloTimer);
    halloTimer = setTimeout(() => {
        halloTimer = null;
        if (state.network.connected && !state.network.protokollOk) brecheWegenVersionAb();
    }, HALLO_TIMEOUT_MS);
}

function pruefeHallo(data) {
    if (data.protokoll === PROTOKOLL_VERSION) {
        state.network.protokollOk = true;
        clearTimeout(halloTimer);
        halloTimer = null;
        if (state.network.connected && state.network.verbindungsPhase === 4) {
            setzeVerbindungsPhase(5, 'BEREIT, SPIEL STARTET');
        }
    } else {
        brecheWegenVersionAb();
    }
}

// Online-Sitzung wegen unterschiedlicher Protokollversion sauber beenden
export function brecheWegenVersionAb() {
    clearTimeout(halloTimer);
    halloTimer = null;
    if (!state.network.isOnline) return;
    if (state.network.connected) sendNetworkEvent({ type: 'peer_left' });
    if (state.cutsceneAktiv) Cutscene.skipCutscene(true);
    disconnectNetwork();
    if (state.spielLaeuft || state.gameOverAktiv) Utils.restartGame();
    if (Utils && Utils.setGameMode) Utils.setGameMode('online');
    updateOnlineStatus(VERSIONS_MELDUNG, true);
}

// Dynamischer Import von modernem Trystero (@trystero-p2p/torrent oder nostr)
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
            console.warn('Trystero konnte nicht per CDN geladen werden (z.B. Offline-Modus):', e2);
            // Fallback / Mock für lokale Tests
            trysteroJoinRoom = (config, roomId) => ({
                makeAction: (name) => [
                    (data) => {}, // send
                    (cb) => {}    // on receive
                ],
                onPeerJoin: (cb) => {},
                onPeerLeave: (cb) => {},
                leave: () => {}
            });
            return trysteroJoinRoom;
        }
    }
}

let turnWarnungAusgegeben = false;

// Holt TURN-Zugangsdaten vom Worker. Gibt bei jedem Fehler null zurueck (Verbindung laeuft dann nur mit STUN).
export async function holeTurnConfig(timeoutMs = 3000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const antwort = await fetch(state.turnApiUrl, { signal: controller.signal, cache: 'no-store' });
        if (!antwort.ok) throw new Error('HTTP ' + antwort.status);
        const daten = await antwort.json();
        if (daten && Array.isArray(daten.iceServers) && daten.iceServers.length > 0) {
            return daten.iceServers;
        }
        throw new Error('Keine iceServers in der Antwort');
    } catch (e) {
        if (!turnWarnungAusgegeben) {
            turnWarnungAusgegeben = true;
            console.warn('TURN nicht verfuegbar, nutze nur STUN:', e && e.message);
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

// Verbindungsfortschritt (Schritt 1/5 bis 5/5). Angezeigt werden nur Phasen, die das Spiel wirklich erkennt:
// Tracker-Signalisierung, Schluesseltausch und ICE sind in Trystero nicht beobachtbar.
export const VERBINDUNGS_SCHRITTE = 5;
export const HINWEIS_RAUMCODE_NACH_S = 20;
export const HINWEIS_NETZ_NACH_S = 45;
export const HINWEIS_RAUMCODE = 'Raum-Code prüfen, der Host muss den Raum geöffnet haben';
export const HINWEIS_NETZ = 'Manche Netzwerke blockieren direkte Verbindungen. Ggf. anderes Netz versuchen';
let verbindungsTimer = null;
let verbindungsStart = 0; // Beginn von Schritt 3 (Date.now())
let verbindungsText = '';

function stoppeVerbindungsTimer() {
    clearInterval(verbindungsTimer);
    verbindungsTimer = null;
}

function zeichneVerbindung() {
    const statusEl = document.getElementById('online-status');
    if (!statusEl) return;
    const net = state.network;
    const nummer = net.verbindungsPhase;
    statusEl.style.display = 'block';
    statusEl.style.color = '#f1c40f';
    statusEl.style.borderColor = 'rgba(241, 196, 15, 0.3)';
    statusEl.textContent = '';
    const zeile = (klasse, text) => {
        const el = document.createElement('div');
        el.className = klasse;
        el.textContent = text;
        statusEl.appendChild(el);
    };
    const code = net.roomCode || '---';
    zeile('vp-kopf', net.isHost ? `RAUM-CODE: ${code}` : `VERBINDE MIT RAUM ${code}`);
    let schritt = `${nummer}/${VERBINDUNGS_SCHRITTE} ${verbindungsText}`;
    const sekunden = nummer === 3 ? Math.max(0, Math.floor((Date.now() - verbindungsStart) / 1000)) : -1;
    if (sekunden >= 0) schritt += ` (${Math.floor(sekunden / 60)}:${String(sekunden % 60).padStart(2, '0')})`;
    zeile('vp-schritt', schritt);
    const balken = document.createElement('div');
    balken.className = 'vp-balken';
    for (let i = 1; i <= VERBINDUNGS_SCHRITTE; i++) {
        const segment = document.createElement('span');
        if (i <= nummer) segment.className = 'aktiv';
        balken.appendChild(segment);
    }
    statusEl.appendChild(balken);
    if (net.verbindungsDetail) zeile('vp-detail', net.verbindungsDetail);
    if (nummer === 3) {
        if (!net.isHost && sekunden >= HINWEIS_RAUMCODE_NACH_S) zeile('vp-detail', HINWEIS_RAUMCODE);
        if (sekunden >= HINWEIS_NETZ_NACH_S) zeile('vp-detail', HINWEIS_NETZ);
    }
}

// Setzt Schritt nummer (1-5) mit Text; detail (z. B. TURN-Status) bleibt bis zum naechsten Detail sichtbar.
export function setzeVerbindungsPhase(nummer, text, detail) {
    const net = state.network;
    if (nummer === 1) {
        net.verbindungsVerlauf = [];
        net.verbindungsDetail = '';
    }
    if (detail !== undefined) net.verbindungsDetail = detail;
    net.verbindungsPhase = nummer;
    net.verbindungsVerlauf.push(nummer);
    verbindungsText = text;
    if (nummer === 3) verbindungsStart = Date.now();
    if (nummer === 3 || nummer === 4) {
        if (!verbindungsTimer) verbindungsTimer = setInterval(zeichneVerbindung, 1000);
    } else {
        stoppeVerbindungsTimer();
    }
    zeichneVerbindung();
}

// Verbindungsaufbau endet (Fehler, Abbruch, Trennen). Liefert den Zusatz fuer Fehlermeldungen,
// falls der Aufbau in Schritt 1-4 steckte.
function beendeVerbindungsPhase() {
    const nummer = state.network.verbindungsPhase;
    stoppeVerbindungsTimer();
    state.network.verbindungsPhase = 0;
    return nummer >= 1 && nummer < VERBINDUNGS_SCHRITTE ? ` (BEI SCHRITT ${nummer}/${VERBINDUNGS_SCHRITTE})` : '';
}

function verbindungNochAktuell(code) {
    return state.network.isOnline && state.network.roomCode === code;
}

function markiereMitspielerVerbunden() {
    if (state.network.protokollOk) setzeVerbindungsPhase(5, 'BEREIT, SPIEL STARTET');
    else setzeVerbindungsPhase(4, 'MITSPIELER VERBUNDEN, VERSIONEN ABGLEICHEN');
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

    const isConnected = state.network && state.network.connected;
    const isHost = state.network && state.network.isHost;
    const roomCode = state.network && state.network.roomCode;

    if (isConnected) {
        if (initialActions) initialActions.style.display = 'none';
        if (connectedControls) connectedControls.style.display = 'flex';

        const zeigeFortschritt = state.network.verbindungsPhase === 4;
        if (zeigeFortschritt) zeichneVerbindung();

        if (isHost) {
            if (btnStart) btnStart.style.display = 'block';
            if (!zeigeFortschritt) updateOnlineStatus(`MITSPIELER VERBUNDEN! (CODE: ${roomCode || '---'})`);
            if (startText) {
                startText.textContent = 'KLICKE "SPIEL STARTEN" ZUM BEGINN';
                startText.style.color = '#2ecc71';
            }
        } else {
            if (btnStart) btnStart.style.display = 'none';
            if (!zeigeFortschritt) updateOnlineStatus(`VERBUNDEN MIT HOST! (CODE: ${roomCode || '---'})`);
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
        clientShipColor: (state.p2 && state.p2.selectedShipColor) || 'blue'
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
        sendFn = (data) => {
            if (typeof rawAction.send === 'function') {
                rawAction.send(data);
            }
        };
        rawAction.onMessage = (data, meta) => {
            const peerId = (meta && meta.peerId) ? meta.peerId : meta;
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
    state.network.protokollOk = false;
    setzeNetzkodierungZurueck();

    setzeVerbindungsPhase(1, 'VERBINDUNGSDATEN HOLEN');
    const turnConfig = await holeTurnConfig();
    if (!verbindungNochAktuell(code)) return;

    setzeVerbindungsPhase(2, 'NETZWERK-MODUL LADEN', turnConfig ? 'TURN verfügbar' : 'ohne TURN');
    const joinRoomFn = await loadTrystero();
    if (!joinRoomFn || !verbindungNochAktuell(code)) return;

    if (room) {
        try { room.leave(); } catch (e) {}
    }

    room = joinRoomFn({ appId: 'starshooter-p2p', ...(turnConfig ? { turnConfig } : {}) }, 'star_' + code);
    setzeVerbindungsPhase(3, `RAUM ${code} GEÖFFNET, WARTE AUF MITSPIELER`);

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
        (peerId) => {
            onPeerJoined(peerId);
        },
        (peerId) => {
            state.network.connected = false;
            beendePause();
            setzeNetzEingabenZurueck();
            state.network.protokollOk = false;
            updateOnlineStatus(`MITSPIELER HAT DAS SPIEL VERLASSEN!${beendeVerbindungsPhase()}`, true);
            updateOnlineLobbyUI();
        }
    );

    return code;
}

export function startOnlineGame() {
    let startScreen = document.getElementById('start-screen');
    if (startScreen) startScreen.style.display = 'none';

    config.spielfeldBreite = 600;
    const spielfeld = dom.spielfeld || document.getElementById('spielfeld');
    if (spielfeld) {
        spielfeld.classList.add('mode-coop');
        spielfeld.style.width = '600px';
    }

    const uiP2 = dom.uiContainerP2 || document.getElementById('ui-container-p2');
    if (uiP2) uiP2.style.display = 'flex';

    state.invulnerableTimer = 0;
    if (state.p2) state.p2.invulnerableTimer = 0;
    // Nach (Neu-)Start beginnt der Host mit einem Keyframe, der Client mit frischen Eingaben
    kodierer.erzwingeKeyframe();
    eingabeSender.reset();
    if (state.network.isHost) setzeNetzEingabenZurueck();
    // HUD-Beschriftungen (Gleve: SWEEP/DASH) fuer beide Schiffe, Mobile-Button fuer den lokalen Spieler
    Utils.updateSchiffHudLabels();
    if (dom.spieler) dom.spieler.classList.remove('spieler-blink');
    if (dom.spieler2) dom.spieler2.classList.remove('spieler-blink');

    Cutscene.startCutscene();
}

export function onPeerJoined(peerId) {
    state.network.connected = true;
    state.network.peerId = peerId;
    markiereMitspielerVerbunden();
    updateOnlineLobbyUI();
    starteHandshake();

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
    state.network.protokollOk = false;
    setzeNetzkodierungZurueck();

    setzeVerbindungsPhase(1, 'VERBINDUNGSDATEN HOLEN');
    const turnConfig = await holeTurnConfig();
    if (!verbindungNochAktuell(cleanCode)) return;

    setzeVerbindungsPhase(2, 'NETZWERK-MODUL LADEN', turnConfig ? 'TURN verfügbar' : 'ohne TURN');
    const joinRoomFn = await loadTrystero();
    if (!joinRoomFn || !verbindungNochAktuell(cleanCode)) return;

    if (room) {
        try { room.leave(); } catch (e) {}
    }

    room = joinRoomFn({ appId: 'starshooter-p2p', ...(turnConfig ? { turnConfig } : {}) }, 'star_' + cleanCode);
    setzeVerbindungsPhase(3, `SUCHE HOST IN RAUM ${cleanCode}`);

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
        (peerId) => {
            state.network.connected = true;
            state.network.peerId = peerId;
            markiereMitspielerVerbunden();
            updateOnlineLobbyUI();
            starteHandshake();
            
            // Client meldet sein im Hangar gewähltes Schiff an den Host
            const myModel = state.selectedShipModel || (state.p2 && state.p2.selectedShipModel) || 'phantom';
            const myColor = state.selectedShipColor || (state.p2 && state.p2.selectedShipColor) || 'blue';
            if (state.p2) {
                state.p2.selectedShipModel = myModel;
                state.p2.selectedShipColor = myColor;
            }
            sendNetworkEvent({
                type: 'client_ready',
                clientShipModel: myModel,
                clientShipColor: myColor
            });
        },
        (peerId) => {
            state.network.connected = false;
            beendePause();
            updateOnlineStatus(`VERBINDUNG ZUM HOST VERLOREN!${beendeVerbindungsPhase()}`, true);
            updateOnlineLobbyUI();
        }
    );

    return true;
}

export function handleNetworkEvent(data, peerId = null) {
    if (!data) return;

    if (data.type === 'pause_start' || data.type === 'pause_ende') {
        verarbeitePauseEvent(data);
        return;
    }

    if (data.type === 'hallo') {
        pruefeHallo(data);
        return;
    }

    if (data.type === 'keyframe_anfordern') {
        if (state.network.isHost) kodierer.erzwingeKeyframe();
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
            beendePause();
            setzeNetzEingabenZurueck();
            state.network.protokollOk = false;
            updateOnlineStatus(`MITSPIELER HAT DEN RAUM VERLASSEN!${beendeVerbindungsPhase()}`, true);
            updateOnlineLobbyUI();
        }
    } else {
        // Client Handling
        if (data.type === 'peer_joined') {
            state.network.connected = true;
            state.network.peerId = peerId;
            updateOnlineLobbyUI();
            
            // Client meldet sein Schiff an den Host zurück
            const myModel = state.selectedShipModel || (state.p2 && state.p2.selectedShipModel) || 'phantom';
            const myColor = state.selectedShipColor || (state.p2 && state.p2.selectedShipColor) || 'blue';
            if (state.p2) {
                state.p2.selectedShipModel = myModel;
                state.p2.selectedShipColor = myColor;
            }
            sendNetworkEvent({
                type: 'client_ready',
                clientShipModel: myModel,
                clientShipColor: myColor
            });
        }
        if (data.type === 'peer_left') {
            state.network.connected = false;
            beendePause();
            updateOnlineStatus(`HOST HAT DEN RAUM VERLASSEN!${beendeVerbindungsPhase()}`, true);
            updateOnlineLobbyUI();
        }
        if (data.type === 'game_start') {
            // Eigene Schiffs- und Farbwahl des Clients aus dem Hangar vor dem Überschreiben sichern
            const clientChosenModel = state.selectedShipModel || (state.p2 && state.p2.selectedShipModel) || data.clientShipModel || 'viper';
            const clientChosenColor = state.selectedShipColor || (state.p2 && state.p2.selectedShipColor) || data.clientShipColor || 'red';

            // Host ist P1
            if (data.hostShipModel) state.selectedShipModel = data.hostShipModel;
            if (data.hostShipColor) state.selectedShipColor = data.hostShipColor;
            
            // Client selbst ist P2
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
            if (dom.spieler2) dom.spieler2.classList.add('spieler-blink');
            // I-Frames wie auf dem Host setzen, damit clientSchritt() das Blinken wieder beendet
            if (state.p2) state.p2.invulnerableTimer = Number.isFinite(data.invulnerable) && data.invulnerable > 0 ? data.invulnerable : 45;
            const spielfeld = dom.spielfeld || document.getElementById('spielfeld');
            if (spielfeld) {
                spielfeld.style.backgroundColor = data.shield ? 'rgba(52, 152, 219, 0.3)' : '#900';
                setTimeout(() => {
                    if (spielfeld) spielfeld.style.backgroundColor = '#0b1319';
                }, 150);
            }
        }
        if (data.type === 'powerup_collected' && data.target === 'p2') {
            const spielfeld = dom.spielfeld || document.getElementById('spielfeld');
            if (spielfeld) {
                spielfeld.style.backgroundColor = data.farbe || '#f1c40f';
                setTimeout(() => {
                    if (spielfeld) spielfeld.style.backgroundColor = '#0b1319';
                }, 100);
            }
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
            Utils.erzeugeBombenDetonation(data.x, data.y, data.color, data.radius, data.stufe, data.isMini);
        }
        if (data.type === 'missile_detonated') {
            Utils.erzeugeRaketenDetonation(data.x, data.y, data.radius);
        }
        if (data.type === 'target_destroyed') {
            Utils.erzeugeExplosion(data.x, data.y, data.farbe, data.anzahl);
            if (data.soundType) Audio.playExplosion(data.soundType);
        }
    }

    onEventCallbacks.forEach(cb => cb(data, peerId));
}

// Host: vollen Snapshot als Delta-Paket senden (weltSchritt: bewegte Simulationsschritte, fuer Dead Reckoning)
export function sendNetworkState(stateSnapshot, weltSchritt) {
    if (!state.network.connected) return;
    state.network.snapshotPakete = (state.network.snapshotPakete || 0) + 1;
    const paket = kodierer.kodiere(stateSnapshot, weltSchritt);
    if (sendStateAction) {
        sendStateAction(paket);
    }
}

// Client: Snapshot-Paket dekodieren und anwenden. Ohne Keyframe (Start, Luecke) wird gewartet
// und ein Keyframe angefordert; Pakete einer anderen Protokollversion beenden die Sitzung.
export function empfangeSnapshotPaket(paket) {
    if (!paket || paket.v !== PROTOKOLL_VERSION) {
        brecheWegenVersionAb();
        return;
    }
    const snapshot = dekodierer.dekodiere(paket);
    if (!snapshot) {
        if (keyframeWarteZaehler % KEYFRAME_INTERVALL === 0) sendNetworkEvent({ type: 'keyframe_anfordern' });
        keyframeWarteZaehler++;
        return;
    }
    keyframeWarteZaehler = 0;
    applyGameStateSnapshot(snapshot);
}

export function sendNetworkInput(inputData) {
    state.network.eingabePakete = (state.network.eingabePakete || 0) + 1;
    state.network.lastSentInput = inputData;
    if (sendInputAction && state.network.connected) {
        sendInputAction(inputData);
    }
}

// Client: einmal pro Schritt aufrufen, sendet nur bei Aenderung oder als Heartbeat
export function sendeEingabe() {
    const paket = eingabeSender.naechstes(serializePlayerInput());
    if (paket) sendNetworkInput(paket);
}

// Host: Eingabe-Paket des Clients pruefen und anwenden
export function empfangeEingabePaket(paket) {
    if (!paket || paket.v !== PROTOKOLL_VERSION) {
        brecheWegenVersionAb();
        return;
    }
    applyPlayerInput(paket);
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
        try { room.leave(); } catch (e) {}
        room = null;
    }
    state.network.isOnline = false;
    state.network.isHost = false;
    state.network.isClient = false;
    state.network.roomCode = null;
    state.network.connected = false;
    state.network.protokollOk = false;
    clearTimeout(halloTimer);
    halloTimer = null;
    beendeVerbindungsPhase();
    setzeNetzkodierungZurueck();
    setzeNetzEingabenZurueck();
    beendePause();
    state.network.peerId = null;
    const statusEl = document.getElementById('online-status');
    if (statusEl) statusEl.style.display = 'none';
}

// Dash-/Sweep-Zustand der Gleve fuer die Darstellung beim Client (nur fuer Gleve-Schiffe)
function gleveZustand(s) {
    if (!Gleve.istGleve(s)) return {};
    return {
        gleveDashLadungen: s.gleveDashLadungen === undefined ? Gleve.dashMaxLadungen(s) : s.gleveDashLadungen,
        gleveDashTimer: s.gleveDashTimer || 0,
        gleveAbprallTimer: s.gleveAbprallTimer || 0,
        gleveUnverwundbar: s.gleveUnverwundbar || 0,
        gleveSweepTimer: s.gleveSweepTimer || 0,
        gleveSweepWinkel: s.gleveSweepWinkel || 0,
        gleveSweepRichtung: s.gleveSweepRichtung || 0
    };
}

// Von der Gleve weggeschleuderte Geschosse (fehlend = false)
function harmlosFlag(o) {
    return o.harmlos ? { harmlos: true } : {};
}

export function serializeGameState() {
    return {
        p1: {
            x: state.x,
            y: state.y,
            rotate: state.rotate || 0,
            leben: state.leben,
            energie: state.energie,
            maxEnergie: state.maxEnergie,
            schildStufe: state.schildStufe,
            laserStufe: state.laserStufe,
            raketenStufe: state.raketenStufe,
            bombenStufe: state.bombenStufe,
            // HUD-Flags nur senden, wenn aktiv (spart Bandbreite, fehlend = false)
            ...(state.laserDurchschlag ? { laserDurchschlag: true } : {}),
            ...(state.autolaserAktiv ? { autolaserAktiv: true } : {}),
            raketenCooldown: state.raketenCooldown,
            bombenCooldown: state.bombenCooldown,
            laserSchiesst: state.laserSchiesst,
            isDead: state.isDead,
            // Viper-Splitter und Phantom-Schildladung fuer das HUD des Clients
            splitterRot: state.splitterRot || 0,
            splitterWeiss: state.splitterWeiss || 0,
            phantomSchildRegenTimer: state.phantomSchildRegenTimer || 0,
            phantomSchildRegenMax: state.phantomSchildRegenMax || 900,
            hacks: state.hacks || [],
            ...gleveZustand(state)
        },
        p2: state.p2 ? {
            x: state.p2.x,
            y: state.p2.y,
            rotate: state.p2.rotate || 0,
            leben: state.p2.leben,
            energie: state.p2.energie,
            maxEnergie: state.p2.maxEnergie,
            schildStufe: state.p2.schildStufe,
            laserStufe: state.p2.laserStufe,
            raketenStufe: state.p2.raketenStufe,
            bombenStufe: state.p2.bombenStufe,
            // HUD-Flags nur senden, wenn aktiv (spart Bandbreite, fehlend = false)
            ...(state.p2.laserDurchschlag ? { laserDurchschlag: true } : {}),
            ...(state.p2.autolaserAktiv ? { autolaserAktiv: true } : {}),
            raketenCooldown: state.p2.raketenCooldown,
            bombenCooldown: state.p2.bombenCooldown,
            laserSchiesst: state.p2.laserSchiesst,
            isDead: state.p2.isDead,
            // Viper-Splitter und Phantom-Schildladung fuer das HUD des Clients
            splitterRot: state.p2.splitterRot || 0,
            splitterWeiss: state.p2.splitterWeiss || 0,
            phantomSchildRegenTimer: state.p2.phantomSchildRegenTimer || 0,
            phantomSchildRegenMax: state.p2.phantomSchildRegenMax || 900,
            hacks: state.p2.hacks || [],
            ...gleveZustand(state.p2)
        } : null,
        score: state.score,
        level: state.level,
        bossAktiv: state.bossAktiv,
        ...(state.bossWarningAktiv ? { bossWarningAktiv: true } : {}),
        feinde: arrays.feinde.map((f) => ({
            id: f.id,
            x: f.x,
            y: f.y,
            hp: f.hp,
            maxHp: f.maxHp,
            groesse: f.groesse || 30,
            typ: f.typ || 1,
            muster: f.muster || 'normal',
            hatSchild: (f.schildHp || 0) > 0,
            schildHp: f.schildHp || 0
        })),
        asteroiden: arrays.asteroiden.map((a) => ({
            id: a.id,
            x: a.x,
            y: a.y,
            groesse: a.groesse || 30,
            istMagma: a.istMagma || (a.istUnzerstoerbar || (a.el && a.el.classList.contains('unzerstoerbar')) ? true : false),
            istUnzerstoerbar: a.istUnzerstoerbar || false,
            traegtPowerup: a.traegtPowerup || false,
            background: a.el ? a.el.style.background : null,
            baseColor: a.el ? (a.el.dataset.baseColor || null) : null,
            clipPath: a.clipPath || (a.el ? a.el.style.clipPath : null),
            rot: a.rot || 0,
            hp: a.hp,
            maxHp: a.maxHp || a.hp
        })),
        bosses: arrays.bosses.map((b) => ({
            id: b.id,
            x: b.x,
            y: b.y,
            hp: b.hp,
            maxHp: b.maxHp,
            groesse: b.groesse || 100,
            typ: b.typ || 1,
            enrage: b.enragePhaseAktiv || false
        })),
        laser: arrays.laserArray.map((l) => ({
            id: l.id,
            x: l.x,
            y: l.y,
            vx: l.vx || 0,
            vy: l.vy || 15,
            width: l.width || 4,
            height: l.height || 20,
            color: l.el ? l.el.style.backgroundColor : (l.owner === 'p2' ? '#3498db' : '#00ffff'),
            owner: l.owner || 'p1'
        })),
        raketen: arrays.raketenArray.map((r) => ({
            id: r.id,
            x: r.x,
            y: r.y,
            rot: r.rot || (r.vy ? (Math.atan2(-r.vy, r.vx || 0.0001) * 180 / Math.PI + 90) : 0),
            owner: r.owner || 'p1',
            homing: r.homing || false,
            stufe: (r.owner === 'p2' ? (state.p2 && state.p2.raketenStufe) : state.raketenStufe) || 1
        })),
        bomben: arrays.bombenArray.map((b) => ({
            id: b.id,
            x: b.x,
            y: b.y,
            rot: b.rot || 0,
            owner: b.owner || 'p1',
            stufe: b.stufe || 1,
            isMini: b.isMini || false
        })),
        hackProjektile: arrays.hackProjektilArray.map(hp => ({
            id: hp.id,
            x: hp.x,
            y: hp.y,
            ...harmlosFlag(hp)
        })),
        feindLaser: arrays.feindLaserArray.map((fl) => ({
            id: fl.id,
            x: fl.x,
            y: fl.y,
            vx: fl.vx || 0,
            vy: fl.vy || 7,
            ...harmlosFlag(fl)
        })),
        bossLaser: arrays.bossLaserArray.map((bl) => ({
            id: bl.id,
            x: bl.x,
            y: bl.y,
            vx: bl.vx || 0,
            vy: bl.vy || 6,
            width: bl.width || 8,
            height: bl.height || 25,
            ...harmlosFlag(bl)
        })),
        bossRaketen: arrays.bossRaketenArray.map((br) => ({
            id: br.id,
            x: br.x,
            y: br.y,
            vx: br.vx || 0,
            vy: br.vy || 2,
            rot: Math.atan2(br.vy || 2, br.vx || 0) * 180 / Math.PI + 90
        })),
        bossBomben: arrays.bossBombenArray.map((bb) => ({
            id: bb.id,
            x: bb.x,
            y: bb.y,
            groesse: bb.groesse || 26
        })),
        powerups: arrays.powerups.map((p) => ({
            id: p.id,
            x: p.x,
            y: p.y,
            type: p.type || p.typ,
            owner: p.owner,
            towedBy: p.towedBy
        }))
    };
}

// Gleicht eine Client-Liste per id mit den Snapshot-Daten ab: bestehende Elemente werden
// wiederverwendet und aktualisiert, neue erzeugt, verschwundene entfernt.
function synchronisiereListe(liste, datenListe, erzeuge, aktualisiere) {
    if (!datenListe) return;
    const vorhanden = new Map();
    liste.forEach(obj => { if (obj.id !== undefined) vorhanden.set(obj.id, obj); });
    const neueListe = [];
    datenListe.forEach(daten => {
        const obj = vorhanden.get(daten.id);
        if (obj) {
            vorhanden.delete(daten.id);
            aktualisiere(obj, daten);
            neueListe.push(obj);
        } else {
            neueListe.push(erzeuge(daten));
        }
    });
    liste.forEach(obj => {
        if (obj.id === undefined || vorhanden.get(obj.id) === obj) {
            if (obj.el) obj.el.remove();
        }
    });
    liste.length = 0;
    neueListe.forEach(obj => liste.push(obj));
}

// Von der Gleve weggeschleudert: orange einfaerben und in Flugrichtung drehen (einmalig)
function uebernehmeHarmlos(obj, daten) {
    if (!daten.harmlos || obj.harmlos) return;
    obj.harmlos = true;
    Gleve.zeigePariert(obj.el, daten.vx, daten.vy);
}

// Max-Cooldown fuer den Raketen-HUD-Balken (Gleve: Dash-Cooldown)
function maxRaketenCooldown(s) {
    if (Gleve.istGleve(s)) return Gleve.dashCooldown(s);
    if (s.raketenStufe >= 4) return 120;
    if (s.raketenStufe >= 2) return 150;
    return 180;
}

// Ab welcher Energie die Primaerwaffe bereit ist (Gleve: Sweep-Kosten), fuer die Balkenfarbe
function zuendSchwelle(s) {
    return Gleve.istGleve(s) ? Gleve.sweepKosten(s) : (s.minZuendEnergie || 15);
}

// Waffenstufen und HUD-Flags eines Spielers aus dem Snapshot uebernehmen (fehlende Stufen bleiben)
function uebernehmeWaffenStufen(ziel, daten) {
    if (daten.laserStufe !== undefined) ziel.laserStufe = daten.laserStufe;
    if (daten.raketenStufe !== undefined) ziel.raketenStufe = daten.raketenStufe;
    if (daten.bombenStufe !== undefined) ziel.bombenStufe = daten.bombenStufe;
    ziel.laserDurchschlag = Boolean(daten.laserDurchschlag);
    ziel.autolaserAktiv = Boolean(daten.autolaserAktiv);
    // Viper-Splitter und Phantom-Schildladung (fehlende Werte bleiben)
    if (daten.splitterRot !== undefined) ziel.splitterRot = daten.splitterRot;
    if (daten.splitterWeiss !== undefined) ziel.splitterWeiss = daten.splitterWeiss;
    if (daten.phantomSchildRegenTimer !== undefined) ziel.phantomSchildRegenTimer = daten.phantomSchildRegenTimer;
    if (daten.phantomSchildRegenMax !== undefined) ziel.phantomSchildRegenMax = daten.phantomSchildRegenMax;
}

// Alles, was das Powerup-HUD anzeigt; nur bei Aenderung neu zeichnen.
// Die Phantom-Schildladung zeichnet der Host alle 6 Schritte neu, der Client ebenso grob.
function hudSignatur(s) {
    const ladung = Math.floor((s.phantomSchildRegenTimer || 0) / 6);
    return [s.laserStufe, s.raketenStufe, s.bombenStufe, s.laserDurchschlag, s.schildStufe, s.autolaserAktiv, ladung].join('|');
}
function splitterSignatur(s) {
    return [s.splitterRot || 0, s.splitterWeiss || 0, s.selectedShipModel].join('|');
}
let letzteHudSignaturP1 = null;
let letzteHudSignaturP2 = null;
let letzteSplitterSignaturP1 = null;
let letzteSplitterSignaturP2 = null;

export function applyGameStateSnapshot(snapshot) {
    if (!snapshot) return;

    const spielfeld = dom.spielfeld || document.getElementById('spielfeld');
    if (!spielfeld) return;

    snapshotEmpfangen();

    // 0. Boss-Warnung des Hosts anzeigen (Alarm nur beim Einblenden)
    if (dom.warningOverlay) {
        const warnungAngezeigt = dom.warningOverlay.style.display === 'flex';
        if (snapshot.bossWarningAktiv && !warnungAngezeigt) {
            dom.warningOverlay.style.display = 'flex';
            Audio.playBossAlert();
        } else if (!snapshot.bossWarningAktiv && warnungAngezeigt) {
            dom.warningOverlay.style.display = 'none';
        }
    }

    // 1. Sync P1 state & visuals on client
    if (snapshot.p1) {
        state.x = snapshot.p1.x;
        state.y = snapshot.p1.y;
        state.leben = snapshot.p1.leben;
        state.energie = snapshot.p1.energie;
        state.maxEnergie = snapshot.p1.maxEnergie || state.maxEnergie;
        state.schildStufe = snapshot.p1.schildStufe || 0;
        uebernehmeWaffenStufen(state, snapshot.p1);
        state.isDead = snapshot.p1.isDead || false;
        state.hacks = snapshot.p1.hacks || [];
        // Gleve des Hosts: Dash/Abprall/Sweep nur darstellen (clientSchritt zeichnet)
        Gleve.uebernehmeSnapshot(state, snapshot.p1, false);

        if (dom.spieler) {
            setzeInterpolationsZiel(p1Anzeige, dom.spieler, state.x, state.y);
            dom.spieler.style.display = state.isDead ? 'none' : 'block';
            dom.spieler.style.transform = `rotate(${snapshot.p1.rotate || 0}deg)`;
            
            // Schild-Visuals
            dom.spieler.classList.remove('schild-aktiv-1', 'schild-aktiv-2', 'schild-aktiv-3');
            if (state.schildStufe > 0) {
                dom.spieler.classList.add(`schild-aktiv-${state.schildStufe}`);
            }
        }

        if (dom.energieBalken) {
            dom.energieBalken.style.width = (state.energie / (state.absMaxEnergie || 100)) * 100 + '%';
            if (state.unbegrenzteEnergie) {
                dom.energieBalken.style.backgroundColor = '#f1c40f';
            } else {
                dom.energieBalken.style.backgroundColor = state.energie < zuendSchwelle(state) && !state.laserSchiesst ? '#e67e22' : '#1abc9c';
            }
        }
        if (snapshot.p1.raketenCooldown !== undefined) {
            state.raketenCooldown = snapshot.p1.raketenCooldown;
            const raketenCdBalken = document.getElementById('raketen-cd-balken');
            if (raketenCdBalken) {
                const maxRaketenCd = maxRaketenCooldown(state);
                let pctR = Math.max(0, 100 - state.raketenCooldown / maxRaketenCd * 100);
                raketenCdBalken.style.width = pctR + '%';
                raketenCdBalken.style.backgroundColor = state.raketenCooldown <= 0 ? '#2ecc71' : '#e74c3c';
            }
            if (Gleve.istGleve(state) && snapshot.p1.gleveDashLadungen !== undefined) {
                state.gleveDashLadungen = snapshot.p1.gleveDashLadungen;
                Gleve.zeigeDashHud('p1', state);
            }
        }
        if (snapshot.p1.bombenCooldown !== undefined) {
            state.bombenCooldown = snapshot.p1.bombenCooldown;
            const bombenCdBalken = document.getElementById('bomben-cd-balken');
            if (bombenCdBalken) {
                let maxBombenCd = 2400 - (state.bombenStufe || 1) * 240;
                let pctB = Math.max(0, 100 - state.bombenCooldown / maxBombenCd * 100);
                bombenCdBalken.style.width = pctB + '%';
                bombenCdBalken.style.backgroundColor = state.bombenCooldown <= 0 ? '#2ecc71' : '#f39c12';
            }
        }
        const sigP1 = hudSignatur(state);
        if (sigP1 !== letzteHudSignaturP1) {
            letzteHudSignaturP1 = sigP1;
            Utils.updateAktivePowerupsUI();
        }
        const splitterP1 = splitterSignatur(state);
        if (splitterP1 !== letzteSplitterSignaturP1) {
            letzteSplitterSignaturP1 = splitterP1;
            Utils.updateSplitterUI();
        }
    }

    // 2. Sync P2 stats
    if (snapshot.p2 && state.p2) {
        state.p2.leben = snapshot.p2.leben;
        state.p2.hacks = snapshot.p2.hacks || [];
        state.p2.energie = snapshot.p2.energie;
        state.p2.maxEnergie = snapshot.p2.maxEnergie || state.p2.maxEnergie;
        state.p2.schildStufe = snapshot.p2.schildStufe || 0;
        uebernehmeWaffenStufen(state.p2, snapshot.p2);
        state.p2.isDead = snapshot.p2.isDead || false;
        // Eigene Gleve: Dash sagt client.js voraus, Abprall und Sweep kommen vom Host
        Gleve.uebernehmeSnapshot(state.p2, snapshot.p2, true);

        if (dom.spieler2) {
            dom.spieler2.classList.remove('schild-aktiv-1', 'schild-aktiv-2', 'schild-aktiv-3');
            if (state.p2.schildStufe > 0) {
                dom.spieler2.classList.add(`schild-aktiv-${state.p2.schildStufe}`);
            }
            dom.spieler2.style.display = state.p2.isDead ? 'none' : 'block';
        }

        if (dom.energieBalkenP2) {
            dom.energieBalkenP2.style.width = (state.p2.energie / (state.p2.absMaxEnergie || 100)) * 100 + '%';
            dom.energieBalkenP2.style.backgroundColor = state.p2.energie < zuendSchwelle(state.p2) && !state.p2.laserSchiesst ? '#e67e22' : '#3498db';
        }
        if (snapshot.p2.raketenCooldown !== undefined) {
            state.p2.raketenCooldown = snapshot.p2.raketenCooldown;
            const raketenCdBalkenP2 = document.getElementById('raketen-cd-balken-p2');
            if (raketenCdBalkenP2) {
                const maxRaketenCd = maxRaketenCooldown(state.p2);
                let pctR = Math.max(0, 100 - state.p2.raketenCooldown / maxRaketenCd * 100);
                raketenCdBalkenP2.style.width = pctR + '%';
                raketenCdBalkenP2.style.backgroundColor = state.p2.raketenCooldown <= 0 ? '#2ecc71' : '#e74c3c';
            }
            if (Gleve.istGleve(state.p2) && snapshot.p2.gleveDashLadungen !== undefined) {
                state.p2.gleveDashLadungen = snapshot.p2.gleveDashLadungen;
                Gleve.zeigeDashHud('p2', state.p2);
            }
        }
        if (snapshot.p2.bombenCooldown !== undefined) {
            state.p2.bombenCooldown = snapshot.p2.bombenCooldown;
            const bombenCdBalkenP2 = document.getElementById('bomben-cd-balken-p2');
            if (bombenCdBalkenP2) {
                let maxBombenCd = 2400 - (state.p2.bombenStufe || 1) * 240;
                let pctB = Math.max(0, 100 - state.p2.bombenCooldown / maxBombenCd * 100);
                bombenCdBalkenP2.style.width = pctB + '%';
                bombenCdBalkenP2.style.backgroundColor = state.p2.bombenCooldown <= 0 ? '#2ecc71' : '#f39c12';
            }
        }
        Utils.updateLebenP2UI();
        Utils.updateMaxEnergieMarkerP2();
        const sigP2 = hudSignatur(state.p2);
        if (sigP2 !== letzteHudSignaturP2) {
            letzteHudSignaturP2 = sigP2;
            Utils.updateAktivePowerupsP2UI();
        }
        const splitterP2 = splitterSignatur(state.p2);
        if (splitterP2 !== letzteSplitterSignaturP2) {
            letzteSplitterSignaturP2 = splitterP2;
            Utils.updateSplitterP2UI();
        }
    }

    // 3. HUD (Score, Level, Boss-HP)
    if (snapshot.score !== undefined) {
        state.score = snapshot.score;
        if (dom.scoreAnzeige) {
            dom.scoreAnzeige.textContent = String(state.score).padStart(5, '0');
        }
    }

    if (snapshot.level !== undefined && snapshot.level !== state.level) {
        state.level = snapshot.level;
        Utils.updateLevelUI();
    }

    Utils.updateLebenUI();
    Utils.updateMaxEnergieMarker();

    // 4. Boss HP
    if (snapshot.bosses && snapshot.bosses.length > 0) {
        state.bossAktiv = true;
        const b = snapshot.bosses[0];
        if (dom.bossHpContainer) dom.bossHpContainer.style.display = 'block';
        if (dom.bossHpBalken) {
            const pct = Math.max(0, Math.min(100, (b.hp / (b.maxHp || 400)) * 100));
            dom.bossHpBalken.style.width = pct + '%';
            dom.bossHpBalken.style.backgroundColor = b.enrage ? '#e74c3c' : '#e67e22';
        }
    } else {
        state.bossAktiv = false;
        if (dom.bossHpContainer) dom.bossHpContainer.style.display = 'none';
    }

    // 5. Replicate Enemies with full SVGs
    if (snapshot.feinde) {
        const currentIds = new Set();
        snapshot.feinde.forEach(fData => {
            currentIds.add(fData.id);
            let existing = arrays.feinde.find(f => f.id === fData.id);
            if (!existing) {
                const el = document.createElement('div');
                el.className = 'feind-schiff';
                el.style.width = (fData.groesse || 30) + 'px';
                el.style.height = (fData.groesse || 30) + 'px';
                el.style.left = fData.x + 'px';
                el.style.top = fData.y + 'px';
                el.innerHTML = Entities.getFeindSVGHtml(fData.muster || 'normal', fData.hatSchild || false);
                el.dataset.baseColor = Entities.getFeindColor(fData.muster || 'normal');
                spielfeld.appendChild(el);
                existing = {
                    id: fData.id,
                    el: el,
                    x: fData.x,
                    y: fData.y,
                    hp: fData.hp,
                    maxHp: fData.maxHp,
                    groesse: fData.groesse || 30,
                    typ: fData.typ || 1,
                    muster: fData.muster || 'normal'
                };
                setzeInterpolationsZiel(existing, el, fData.x, fData.y);
                arrays.feinde.push(existing);
            } else {
                existing.x = fData.x;
                existing.y = fData.y;
                existing.hp = fData.hp;
                setzeInterpolationsZiel(existing, existing.el, fData.x, fData.y);
            }
        });
        for (let i = arrays.feinde.length - 1; i >= 0; i--) {
            if (!currentIds.has(arrays.feinde[i].id)) {
                if (arrays.feinde[i].el) arrays.feinde[i].el.remove();
                arrays.feinde.splice(i, 1);
            }
        }
    }

    // 6. Replicate Asteroids with clipPath & styles
    if (snapshot.asteroiden) {
        const currentIds = new Set();
        snapshot.asteroiden.forEach(aData => {
            currentIds.add(aData.id);
            let existing = arrays.asteroiden.find(a => a.id === aData.id);
            if (!existing) {
                const el = document.createElement('div');
                el.className = 'asteroid';
                if (aData.istMagma) {
                    if (aData.istUnzerstoerbar) {
                        el.classList.add('unzerstoerbar');
                    }
                    if (aData.background) {
                        el.style.background = aData.background;
                    } else {
                        let c = config.magmaBasisFarben[0];
                        el.style.background = `radial-gradient(circle at 30% 30%, ${c.a}, ${c.b})`;
                    }
                } else {
                    if (aData.background) {
                        el.style.background = aData.background;
                    } else {
                        let c = config.asteroidenBasisFarben[0];
                        el.style.background = `radial-gradient(circle at 30% 30%, ${c}, #2c3e50)`;
                    }
                }
                if (aData.baseColor) el.dataset.baseColor = aData.baseColor;
                if (aData.clipPath) {
                    el.style.clipPath = aData.clipPath;
                } else {
                    el.style.clipPath = Entities.generiereAsteroidPolygon();
                }
                el.style.width = (aData.groesse || 30) + 'px';
                el.style.height = (aData.groesse || 30) + 'px';
                el.style.left = aData.x + 'px';
                el.style.top = aData.y + 'px';

                let rissEl = null;
                if (!aData.istUnzerstoerbar) {
                    rissEl = document.createElement('div');
                    rissEl.classList.add('riss-layer');
                    rissEl.style.backgroundImage = `url("${config.rissMuster[0]}")`;
                    if (aData.traegtPowerup) rissEl.style.opacity = '0.5';
                    el.appendChild(rissEl);
                }

                spielfeld.appendChild(el);
                existing = {
                    id: aData.id,
                    el: el,
                    x: aData.x,
                    y: aData.y,
                    groesse: aData.groesse || 30,
                    istMagma: aData.istMagma,
                    istUnzerstoerbar: aData.istUnzerstoerbar,
                    traegtPowerup: aData.traegtPowerup,
                    rissEl: rissEl,
                    rot: aData.rot || 0
                };
                setzeInterpolationsZiel(existing, el, aData.x, aData.y);
                arrays.asteroiden.push(existing);
            } else {
                existing.x = aData.x;
                existing.y = aData.y;
                setzeInterpolationsZiel(existing, existing.el, aData.x, aData.y);
                if (aData.rot) {
                    existing.el.style.transform = `rotate(${aData.rot}deg)`;
                }
                if (existing.rissEl && aData.maxHp) {
                    let basisRiss = aData.traegtPowerup ? 0.5 : 0;
                    let schadenProzent = basisRiss + (1 - basisRiss) * (1 - Math.max(0, aData.hp) / aData.maxHp);
                    existing.rissEl.style.opacity = schadenProzent;
                }
            }
        });
        for (let i = arrays.asteroiden.length - 1; i >= 0; i--) {
            if (!currentIds.has(arrays.asteroiden[i].id)) {
                if (arrays.asteroiden[i].el) arrays.asteroiden[i].el.remove();
                arrays.asteroiden.splice(i, 1);
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
                const el = document.createElement('div');
                el.className = 'boss-schiff';
                el.style.width = (bData.groesse || 100) + 'px';
                el.style.height = (bData.groesse || 100) + 'px';
                el.style.left = bData.x + 'px';
                el.style.top = bData.y + 'px';
                const bossFarbe = Entities.getBossColor(state.level);
                el.innerHTML = Entities.getBossSVGHtml(bData.typ || 1, state.level);
                el.style.filter = `drop-shadow(0 10px 20px rgba(0,0,0,0.9)) drop-shadow(0 0 15px ${bossFarbe})`;
                spielfeld.appendChild(el);
                existing = {
                    id: bData.id,
                    el: el,
                    x: bData.x,
                    y: bData.y,
                    hp: bData.hp,
                    maxHp: bData.maxHp,
                    groesse: bData.groesse || 100,
                    typ: bData.typ || 1
                };
                setzeInterpolationsZiel(existing, el, bData.x, bData.y);
                arrays.bosses.push(existing);
            } else {
                existing.x = bData.x;
                existing.y = bData.y;
                existing.hp = bData.hp;
                setzeInterpolationsZiel(existing, existing.el, bData.x, bData.y);
            }
        });
        for (let i = arrays.bosses.length - 1; i >= 0; i--) {
            if (!currentIds.has(arrays.bosses[i].id)) {
                if (arrays.bosses[i].el) arrays.bosses[i].el.remove();
                arrays.bosses.splice(i, 1);
            }
        }
    }

    // 8. Replicate Lasers
    synchronisiereListe(arrays.laserArray, snapshot.laser, lData => {
        const el = document.createElement('div');
        el.classList.add('laser-projektil');
        if (lData.owner === 'p2') el.classList.add('laser-p2');
        el.style.backgroundColor = lData.color || (lData.owner === 'p2' ? '#3498db' : '#00ffff');
        el.style.boxShadow = `0 0 10px ${lData.color || '#00ffff'}`;
        el.style.width = (lData.width || 4) + 'px';
        el.style.height = (lData.height || 20) + 'px';
        el.style.left = lData.x + 'px';
        el.style.top = lData.y + 'px';
        if (lData.vx && lData.vx !== 0) {
            let winkel = Math.atan2(-15, lData.vx) * 180 / Math.PI;
            el.style.transform = `rotate(${winkel + 90}deg)`;
        }
        spielfeld.appendChild(el);
        return {
            id: lData.id,
            el: el,
            x: lData.x,
            y: lData.y,
            vx: lData.vx || 0,
            vy: lData.vy || 15,
            owner: lData.owner
        };
    }, (obj, lData) => {
        obj.x = lData.x;
        obj.y = lData.y;
        obj.vx = lData.vx || 0;
        obj.vy = lData.vy || 15;
        obj.el.style.left = lData.x + 'px';
        obj.el.style.top = lData.y + 'px';
        if (lData.vx && lData.vx !== 0) {
            let winkel = Math.atan2(-15, lData.vx) * 180 / Math.PI;
            obj.el.style.transform = `rotate(${winkel + 90}deg)`;
        }
    });

    // 9. Replicate Rockets
    synchronisiereListe(arrays.raketenArray, snapshot.raketen, rData => {
        const el = document.createElement('div');
        el.classList.add('raketen-projektil');
        if (rData.stufe >= 2) el.classList.add('rakete-lvl-2');
        if (rData.homing) el.classList.add('rakete-homing');
        if (rData.owner === 'p2') el.classList.add('rakete-p2');
        el.innerHTML = `
            <div class="rakete-sensor"></div>
            <div class="rakete-canards"></div>
            <div class="rakete-rumpf"></div>
            <div class="rakete-fluegel"></div>
            <div class="rakete-feuer"></div>
        `;
        el.style.left = rData.x + 'px';
        el.style.top = rData.y + 'px';
        el.style.transform = `rotate(${rData.rot || 0}deg)`;
        spielfeld.appendChild(el);
        return {
            id: rData.id,
            el: el,
            x: rData.x,
            y: rData.y,
            rot: rData.rot || 0,
            owner: rData.owner,
            snapX: rData.x,
            snapY: rData.y
        };
    }, (obj, rData) => {
        leiteGeschwindigkeitAb(obj, rData.x, rData.y);
        obj.x = rData.x;
        obj.y = rData.y;
        obj.rot = rData.rot || 0;
        obj.el.style.left = rData.x + 'px';
        obj.el.style.top = rData.y + 'px';
        obj.el.style.transform = `rotate(${obj.rot}deg)`;
    });

    // 10. Replicate Bombs
    synchronisiereListe(arrays.bombenArray, snapshot.bomben, bData => {
        const el = document.createElement('div');
        el.classList.add('bomben-projektil', `bombe-lvl-${bData.stufe || 1}`);
        if (bData.isMini) el.classList.add('bombe-mini');
        if (bData.owner === 'p2') el.classList.add('bombe-p2');
        el.innerHTML = `
            <div class="bombe-aura"></div>
            <div class="bombe-body"></div>
            <div class="bombe-licht" style="top: 4px;"></div>
            <div class="bombe-licht" style="top: 13px;"></div>
            <div class="bombe-licht" style="top: 22px;"></div>
        `;
        el.style.left = bData.x + 'px';
        el.style.top = bData.y + 'px';
        el.style.transform = `rotate(${bData.rot || 0}deg)`;
        spielfeld.appendChild(el);
        return {
            id: bData.id,
            el: el,
            x: bData.x,
            y: bData.y,
            rot: bData.rot || 0,
            owner: bData.owner,
            snapX: bData.x,
            snapY: bData.y
        };
    }, (obj, bData) => {
        leiteGeschwindigkeitAb(obj, bData.x, bData.y);
        obj.x = bData.x;
        obj.y = bData.y;
        obj.rot = bData.rot || 0;
        obj.el.style.left = bData.x + 'px';
        obj.el.style.top = bData.y + 'px';
        obj.el.style.transform = `rotate(${obj.rot}deg)`;
    });

    // 11. Replicate Enemy Lasers
    synchronisiereListe(arrays.feindLaserArray, snapshot.feindLaser, flData => {
        const el = document.createElement('div');
        el.classList.add('feind-laser');
        el.style.left = flData.x + 'px';
        el.style.top = flData.y + 'px';
        if (flData.vx && flData.vx !== 0) {
            let winkel = Math.atan2(flData.vy || 7, flData.vx) * 180 / Math.PI;
            el.style.transform = `rotate(${winkel - 90}deg)`;
        }
        spielfeld.appendChild(el);
        const obj = {
            id: flData.id,
            el: el,
            x: flData.x,
            y: flData.y,
            vx: flData.vx,
            vy: flData.vy
        };
        uebernehmeHarmlos(obj, flData);
        return obj;
    }, (obj, flData) => {
        obj.x = flData.x;
        obj.y = flData.y;
        obj.vx = flData.vx;
        obj.vy = flData.vy;
        obj.el.style.left = flData.x + 'px';
        obj.el.style.top = flData.y + 'px';
        if (flData.vx && flData.vx !== 0) {
            let winkel = Math.atan2(flData.vy || 7, flData.vx) * 180 / Math.PI;
            obj.el.style.transform = `rotate(${winkel - 90}deg)`;
        }
        uebernehmeHarmlos(obj, flData);
    });

    // 11b. Replicate Hack-Projektile
    synchronisiereListe(arrays.hackProjektilArray, snapshot.hackProjektile, hpData => {
        const el = document.createElement('div');
        el.classList.add('hack-projektil');
        el.style.left = hpData.x + 'px';
        el.style.top = hpData.y + 'px';
        spielfeld.appendChild(el);
        const obj = { id: hpData.id, el: el, x: hpData.x, y: hpData.y, vx: 0, vy: 0, width: 12, height: 12, snapX: hpData.x, snapY: hpData.y };
        uebernehmeHarmlos(obj, hpData);
        return obj;
    }, (obj, hpData) => {
        leiteGeschwindigkeitAb(obj, hpData.x, hpData.y);
        obj.x = hpData.x;
        obj.y = hpData.y;
        obj.el.style.left = hpData.x + 'px';
        obj.el.style.top = hpData.y + 'px';
        uebernehmeHarmlos(obj, hpData);
    });

    // 12. Replicate Boss Lasers
    synchronisiereListe(arrays.bossLaserArray, snapshot.bossLaser, blData => {
        const el = document.createElement('div');
        el.classList.add('boss-laser');
        el.style.left = blData.x + 'px';
        el.style.top = blData.y + 'px';
        if (blData.vx && blData.vx !== 0) {
            let winkel = Math.atan2(blData.vy || 6, blData.vx) * 180 / Math.PI;
            el.style.transform = `rotate(${winkel - 90}deg)`;
        }
        spielfeld.appendChild(el);
        const obj = {
            id: blData.id,
            el: el,
            x: blData.x,
            y: blData.y,
            vx: blData.vx,
            vy: blData.vy
        };
        uebernehmeHarmlos(obj, blData);
        return obj;
    }, (obj, blData) => {
        obj.x = blData.x;
        obj.y = blData.y;
        obj.vx = blData.vx;
        obj.vy = blData.vy;
        obj.el.style.left = blData.x + 'px';
        obj.el.style.top = blData.y + 'px';
        if (blData.vx && blData.vx !== 0) {
            let winkel = Math.atan2(blData.vy || 6, blData.vx) * 180 / Math.PI;
            obj.el.style.transform = `rotate(${winkel - 90}deg)`;
        }
        uebernehmeHarmlos(obj, blData);
    });

    // 13. Replicate Boss Rockets
    synchronisiereListe(arrays.bossRaketenArray, snapshot.bossRaketen, brData => {
        const el = document.createElement('div');
        el.classList.add('boss-rakete');
        el.innerHTML = `
            <svg viewBox="0 0 14 24" style="width: 100%; height: 100%;">
                <path d="M7 0 L12 8 L11 20 L3 20 L2 8 Z" fill="#c0392b" stroke="#e74c3c" stroke-width="1"/>
                <polygon points="7,1 11,8 3,8" fill="#e67e22"/>
                <polygon points="2,14 0,22 3,20" fill="#d35400"/>
                <polygon points="12,14 14,22 11,20" fill="#d35400"/>
                <circle cx="7" cy="11" r="1.5" fill="#f1c40f"/>
            </svg>
            <div class="boss-rakete-flame"></div>
        `;
        el.style.left = brData.x + 'px';
        el.style.top = brData.y + 'px';
        el.style.transform = `rotate(${brData.rot || 0}deg)`;
        spielfeld.appendChild(el);
        return {
            id: brData.id,
            el: el,
            x: brData.x,
            y: brData.y,
            vx: brData.vx || 0,
            vy: brData.vy || 0,
            rot: brData.rot || 0
        };
    }, (obj, brData) => {
        obj.x = brData.x;
        obj.y = brData.y;
        obj.vx = brData.vx || 0;
        obj.vy = brData.vy || 0;
        obj.rot = brData.rot || 0;
        obj.el.style.left = brData.x + 'px';
        obj.el.style.top = brData.y + 'px';
        obj.el.style.transform = `rotate(${obj.rot}deg)`;
    });

    // 14. Replicate Boss Bombs
    synchronisiereListe(arrays.bossBombenArray, snapshot.bossBomben, bbData => {
        const el = document.createElement('div');
        el.classList.add('boss-bombe');
        el.innerHTML = `
            <div class="boss-bombe-aura"></div>
            <div class="boss-bombe-body"></div>
            <div class="boss-bombe-core"></div>
        `;
        el.style.left = bbData.x + 'px';
        el.style.top = bbData.y + 'px';
        spielfeld.appendChild(el);
        return {
            id: bbData.id,
            el: el,
            x: bbData.x,
            y: bbData.y,
            groesse: bbData.groesse || 26,
            snapX: bbData.x,
            snapY: bbData.y
        };
    }, (obj, bbData) => {
        leiteGeschwindigkeitAb(obj, bbData.x, bbData.y);
        obj.x = bbData.x;
        obj.y = bbData.y;
        obj.el.style.left = bbData.x + 'px';
        obj.el.style.top = bbData.y + 'px';
    });

    // 15. Replicate Powerups with full styling & owner badges
    if (snapshot.powerups) {
        const currentIds = new Set();
        snapshot.powerups.forEach(pData => {
            currentIds.add(pData.id);
            let existing = arrays.powerups.find(p => p.id === pData.id);
            if (!existing) {
                const el = document.createElement('div');
                Entities.setupPowerupVisuals(el, pData.type, pData.owner);
                el.style.left = pData.x + 'px';
                el.style.top = pData.y + 'px';
                spielfeld.appendChild(el);
                existing = {
                    id: pData.id,
                    el: el,
                    x: pData.x,
                    y: pData.y,
                    groesse: 24,
                    type: pData.type,
                    owner: pData.owner,
                    towedBy: null
                };
                setzeInterpolationsZiel(existing, el, pData.x, pData.y);
                arrays.powerups.push(existing);
            } else {
                existing.x = pData.x;
                existing.y = pData.y;
                setzeInterpolationsZiel(existing, existing.el, pData.x, pData.y);
            }
            // Schlepp-Zustand des Hosts uebernehmen; den Strahl zeichnet clientSchritt
            const towedBy = pData.towedBy || null;
            if (existing.towedBy !== towedBy) {
                entferneTraktorstrahl(existing);
                existing.towedBy = towedBy;
                existing.el.classList.remove('powerup-towed', 'powerup-towed-p1', 'powerup-towed-p2');
                if (towedBy) existing.el.classList.add('powerup-towed', `powerup-towed-${towedBy}`);
            }
        });
        for (let i = arrays.powerups.length - 1; i >= 0; i--) {
            if (!currentIds.has(arrays.powerups[i].id)) {
                entferneTraktorstrahl(arrays.powerups[i]);
                if (arrays.powerups[i].el) arrays.powerups[i].el.remove();
                arrays.powerups.splice(i, 1);
            }
        }
    }
}

export function serializePlayerInput() {
    const keys = state.tastenGedrueckt;
    const isLaser = Boolean(keys.l || keys.b);
    const isRakete = Boolean(keys.k || keys.v);
    const isBombe = Boolean(keys[' '] || keys.c || keys.enter);
    // Gleve: Steuerrichtung fuer den Dash; waehrend des vorhergesagten Dashs Startposition und Dash-Richtung
    const gleve = state.p2 && Gleve.istGleve(state.p2) ? Gleve.netzEingabe(state.p2, state.p2.clientSteuerRichtung) : null;

    return {
        x: gleve ? gleve.x : (state.p2 ? state.p2.x : state.x),
        y: gleve ? gleve.y : (state.p2 ? state.p2.y : state.y),
        ...(gleve ? { rx: gleve.rx, ry: gleve.ry } : {}),
        rotate: state.p2 ? (state.p2.rotate || 0) : (state.rotate || 0),
        laser: isLaser,
        rakete: isRakete,
        bombe: isBombe
    };
}

export function applyPlayerInput(input) {
    if (!input || !state.p2) return;

    // Client-Werte nicht vertrauen: nur endliche Zahlen, begrenzt auf das Spielfeld.
    // Waehrend Gleve-Dash/-Abprall bewegt der Host das Schiff selbst (Treffer und Abprall sind Host-Sache).
    const dashAktiv = Gleve.istGleve(state.p2) && Gleve.istDashAktiv(state.p2);
    if (Number.isFinite(input.x) && !dashAktiv) {
        state.p2.x = Math.min(Math.max(input.x, 0), config.spielfeldBreite - config.spielerGroesse);
    }
    if (Number.isFinite(input.y) && !dashAktiv) {
        state.p2.y = Math.min(Math.max(input.y, 0), config.spielfeldHoehe - config.spielerGroesse);
    }
    state.p2.rotate = input.rotate || 0;

    // Gleve: Dash-Richtung des Clients (Betrag hoechstens 1)
    if (Number.isFinite(input.rx) && Number.isFinite(input.ry)) {
        const laenge = Math.hypot(input.rx, input.ry);
        const f = laenge > 1 ? 1 / laenge : 1;
        state.p2.netzRichtung = { dx: input.rx * f, dy: input.ry * f };
    }

    if (input.laser !== undefined) state.p2.laserInputRequested = Boolean(input.laser);

    // Gehaltene Tasten gelten bis zum naechsten Paket (waffen.js feuert damit wie bei
    // einem true in jedem Schritt); ein kurzer Druck bleibt wie bisher bis zum Schuss gemerkt
    if (input.rakete !== undefined) {
        // Neuer Druck bleibt fuer den Gleve-Dash gemerkt, auch wenn das Loslassen im selben Host-Schritt ankommt
        if (input.rakete && !state.p2.raketeGehalten) state.p2.netzDashAnfrage = true;
        state.p2.raketeGehalten = Boolean(input.rakete);
    }
    if (input.bombe !== undefined) state.p2.bombeGehalten = Boolean(input.bombe);

    if (input.rakete) {
        state.p2.networkFireRakete = true;
    }

    if (input.bombe) {
        state.p2.networkFireBombe = true;
    }

    if (dom.spieler2) {
        dom.spieler2.style.left = state.p2.x + 'px';
        dom.spieler2.style.top = state.p2.y + 'px';
        dom.spieler2.style.transform = `rotate(${state.p2.rotate}deg)`;
        dom.spieler2.setAttribute('data-rotate', state.p2.rotate);
    }
}

