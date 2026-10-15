import { state, dom, config, arrays } from './state.js';
import * as Cutscene from './cutscene.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import { p1Anzeige, setzeInterpolationsZiel, leiteGeschwindigkeitAb, snapshotEmpfangen, uebernehmeP1Anzeige } from './client.js';
import { beendePause, verarbeitePauseEvent } from './pause.js';
import { GAME_VERSION } from './changelog.js';
import { PROTOKOLL_VERSION, KEYFRAME_INTERVALL, SnapshotKodierer, SnapshotDekodierer, EingabeSender } from './netzkodierung.js';
import * as Gleve from './gleve.js';
import * as Viper from './viper.js';
import * as Sniper from './sniper.js';
import * as Anzeige from './anzeige.js';

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
    state.p2.netzLaserAnfrage = false;
    state.p2.sniperAutoInput = false;
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
    if (startText) startText.classList.add('start-text-lang');

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

    Utils.wendeSpielfeldBreiteAn('online');

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
            // I-Frames wie auf dem Host setzen, damit clientSchritt() das Blinken wieder beendet
            if (state.p2) state.p2.invulnerableTimer = Number.isFinite(data.invulnerable) && data.invulnerable > 0 ? data.invulnerable : 45;
            Anzeige.zeichneSpieler();
            Anzeige.blitzeSpielfeld(data.shield ? 'rgba(52, 152, 219, 0.3)' : '#900', 150);
        }
        if (data.type === 'powerup_collected' && data.target === 'p2') {
            Anzeige.blitzeSpielfeld(data.farbe || '#f1c40f', 100);
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
        if (data.type === 'emp_ausgeloest') {
            Sniper.zeigeEmp(data);
        }
        if (data.type === 'granate_detonated') {
            Sniper.zeigeDetonation(data);
        }
        if (data.type === 'mine_explodiert') {
            Sniper.zeigeMinenExplosion(data);
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

// Rollen-Zustand der Viper (Timer, Richtung, Cooldown) fuer Anzeige und Cooldown-Abgleich beim Client
function viperZustand(s) {
    if (!Viper.istViper(s)) return {};
    return {
        viperRolleTimer: s.viperRolleTimer || 0,
        viperRolleRichtung: s.viperRolleRichtung || 0,
        viperRolleCooldown: s.viperRolleCooldown || 0,
        viperOverdriveLeiste: s.viperOverdriveLeiste || 0,
        viperOverdriveTimer: s.viperOverdriveTimer || 0,
        viperKombo: s.viperKombo || 0,
        viperKomboTimer: s.viperKomboTimer || 0
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
            rotate: state.drehung || 0,
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
            ...gleveZustand(state),
            ...viperZustand(state),
            ...Sniper.netzZustand(state)
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
            ...gleveZustand(state.p2),
            ...viperZustand(state.p2),
            ...Sniper.netzZustand(state.p2)
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
            schildHp: f.schildHp || 0,
            ...(f.betaeubt > 0 ? { betaeubt: f.betaeubt } : {})
        })),
        asteroiden: arrays.asteroiden.map((a) => ({
            id: a.id,
            x: a.x,
            y: a.y,
            groesse: a.groesse || 30,
            istMagma: a.istMagma || a.istUnzerstoerbar || false,
            istUnzerstoerbar: a.istUnzerstoerbar || false,
            traegtPowerup: a.traegtPowerup || false,
            farbe: a.farbe,
            farbe2: a.farbe2,
            form: a.form ? Entities.formAlsText(a.form) : null,
            riss: a.riss,
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
            typ: b.bossTyp || b.typ || 1,
            enrage: b.enragePhaseAktiv || false,
            ...(b.betaeubt > 0 ? { betaeubt: b.betaeubt } : {})
        })),
        laser: arrays.laserArray.map((l) => ({
            id: l.id,
            x: l.x,
            y: l.y,
            vx: l.vx || 0,
            vy: l.vy || 15,
            width: l.width || 4,
            height: l.height || 20,
            color: l.farbe || (l.owner === 'p2' ? '#3498db' : '#00ffff'),
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
        // Sniper-Granaten im Flug (ohne Sniper leer, wie gleveWellen)
        sniperGranaten: Sniper.netzGranatenListe(),
        // Sniper-Haftminen (ohne Sniper leer)
        sniperMinen: Sniper.netzMinenListe(),
        gleveWellen: arrays.gleveWellen.map(w => ({
            id: w.id,
            x: w.x,
            y: w.y,
            breite: w.breite,
            owner: w.owner
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
            Anzeige.entferne(obj);
        }
    });
    liste.length = 0;
    neueListe.forEach(obj => liste.push(obj));
}

// Betaeubung (Sniper-Granate) aus dem Snapshot uebernehmen (die Anzeige zeigt betaeubt > 0)
function zeigeBetaeubung(obj, daten) {
    obj.betaeubt = daten.betaeubt > 0 ? daten.betaeubt : 0;
}

// Von der Gleve weggeschleudert: orange einfaerben und in Flugrichtung drehen (einmalig)
function uebernehmeHarmlos(obj, daten) {
    if (!daten.harmlos || obj.harmlos) return;
    obj.harmlos = true;
    Gleve.zeigePariert(obj, daten.vx, daten.vy);
}

// Max-Cooldown fuer den Raketen-HUD-Balken (Gleve: Dash-Cooldown)
function maxRaketenCooldown(s) {
    if (Gleve.istGleve(s)) return Gleve.dashCooldown(s);
    if (Sniper.istSniper(s)) return Sniper.granatenCooldown(s);
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
        Viper.uebernehmeSnapshot(state, snapshot.p1, false);
        Sniper.uebernehmeSnapshot(state, snapshot.p1, 'p1', false);

        setzeInterpolationsZiel(p1Anzeige, state.x, state.y);
        uebernehmeP1Anzeige();
        state.schiffSichtbar = !state.isDead;
        state.drehung = snapshot.p1.rotate || 0;

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
            if (Sniper.istSniper(state) && snapshot.p1.sniperGranatenLadungen !== undefined) {
                state.sniperGranatenLadungen = snapshot.p1.sniperGranatenLadungen;
                Sniper.zeigeGranatenHud('p1', state);
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
        Viper.uebernehmeSnapshot(state.p2, snapshot.p2, true);
        Sniper.uebernehmeSnapshot(state.p2, snapshot.p2, 'p2', true);

        state.p2.schiffSichtbar = !state.p2.isDead;

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
            if (Sniper.istSniper(state.p2) && snapshot.p2.sniperGranatenLadungen !== undefined) {
                state.p2.sniperGranatenLadungen = snapshot.p2.sniperGranatenLadungen;
                Sniper.zeigeGranatenHud('p2', state.p2);
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
                const muster = fData.muster || 'normal';
                existing = Anzeige.erzeuge({
                    id: fData.id,
                    x: fData.x,
                    y: fData.y,
                    hp: fData.hp,
                    maxHp: fData.maxHp,
                    groesse: fData.groesse || 30,
                    typ: fData.typ || 1,
                    muster,
                    hatSchild: fData.hatSchild || false,
                    schildHp: fData.schildHp || 0,
                    farbe: Entities.getFeindColor(muster)
                }, 'feind');
                setzeInterpolationsZiel(existing, fData.x, fData.y);
                arrays.feinde.push(existing);
            } else {
                existing.x = fData.x;
                existing.y = fData.y;
                existing.hp = fData.hp;
                existing.schildHp = fData.schildHp || 0;
                setzeInterpolationsZiel(existing, fData.x, fData.y);
            }
            zeigeBetaeubung(existing, fData);
        });
        for (let i = arrays.feinde.length - 1; i >= 0; i--) {
            if (!currentIds.has(arrays.feinde[i].id)) {
                Anzeige.entferne(arrays.feinde[i]);
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
                // Fehlende Optikdaten (aeltere Snapshots in Tests) mit den Grundfarben auffuellen
                const grund = aData.istMagma ? config.magmaBasisFarben[0] : { a: config.asteroidenBasisFarben[0], b: '#2c3e50' };
                existing = Anzeige.erzeuge({
                    id: aData.id,
                    x: aData.x,
                    y: aData.y,
                    groesse: aData.groesse || 30,
                    istMagma: aData.istMagma,
                    istUnzerstoerbar: aData.istUnzerstoerbar,
                    traegtPowerup: aData.traegtPowerup,
                    farbe: aData.farbe || grund.a,
                    farbe2: aData.farbe2 || grund.b,
                    form: aData.form ? Entities.formAusText(aData.form) : Entities.generiereAsteroidForm(),
                    riss: aData.riss || 0,
                    hp: aData.hp,
                    maxHp: aData.maxHp,
                    rot: aData.rot || 0
                }, 'asteroid');
                setzeInterpolationsZiel(existing, aData.x, aData.y);
                arrays.asteroiden.push(existing);
            } else {
                existing.x = aData.x;
                existing.y = aData.y;
                existing.hp = aData.hp;
                existing.maxHp = aData.maxHp;
                setzeInterpolationsZiel(existing, aData.x, aData.y);
                if (aData.rot) existing.rot = aData.rot;
                existing.istUnzerstoerbar = aData.istUnzerstoerbar;
                existing.traegtPowerup = aData.traegtPowerup;
            }
        });
        for (let i = arrays.asteroiden.length - 1; i >= 0; i--) {
            if (!currentIds.has(arrays.asteroiden[i].id)) {
                Anzeige.entferne(arrays.asteroiden[i]);
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
                existing = Anzeige.erzeuge({
                    id: bData.id,
                    x: bData.x,
                    y: bData.y,
                    hp: bData.hp,
                    maxHp: bData.maxHp,
                    groesse: bData.groesse || 100,
                    typ: bData.typ || 1,
                    bossTyp: bData.typ || 1,
                    leuchtFarbe: Entities.getBossColor(state.level)
                }, 'boss');
                setzeInterpolationsZiel(existing, bData.x, bData.y);
                arrays.bosses.push(existing);
            } else {
                existing.x = bData.x;
                existing.y = bData.y;
                existing.hp = bData.hp;
                setzeInterpolationsZiel(existing, bData.x, bData.y);
            }
            zeigeBetaeubung(existing, bData);
        });
        for (let i = arrays.bosses.length - 1; i >= 0; i--) {
            if (!currentIds.has(arrays.bosses[i].id)) {
                Anzeige.entferne(arrays.bosses[i]);
                arrays.bosses.splice(i, 1);
            }
        }
    }

    // 8. Replicate Lasers
    synchronisiereListe(arrays.laserArray, snapshot.laser, lData => {
        return Anzeige.erzeuge({
            id: lData.id,
            x: lData.x,
            y: lData.y,
            vx: lData.vx || 0,
            vy: lData.vy || 15,
            width: lData.width || 4,
            height: lData.height || 20,
            farbe: lData.color || (lData.owner === 'p2' ? '#3498db' : '#00ffff'),
            rot: lData.vx ? Math.atan2(-15, lData.vx) * 180 / Math.PI + 90 : undefined,
            owner: lData.owner
        }, 'laser');
    }, (obj, lData) => {
        obj.x = lData.x;
        obj.y = lData.y;
        obj.vx = lData.vx || 0;
        obj.vy = lData.vy || 15;
        if (lData.vx && lData.vx !== 0) obj.rot = Math.atan2(-15, lData.vx) * 180 / Math.PI + 90;
    });

    // 9. Replicate Rockets
    synchronisiereListe(arrays.raketenArray, snapshot.raketen, rData => {
        return Anzeige.erzeuge({
            id: rData.id,
            x: rData.x,
            y: rData.y,
            rot: rData.rot || 0,
            owner: rData.owner,
            stufe: rData.stufe || 1,
            homing: rData.homing || false,
            snapX: rData.x,
            snapY: rData.y
        }, 'rakete');
    }, (obj, rData) => {
        leiteGeschwindigkeitAb(obj, rData.x, rData.y);
        obj.x = rData.x;
        obj.y = rData.y;
        obj.rot = rData.rot || 0;
    });

    // 10. Replicate Bombs
    synchronisiereListe(arrays.bombenArray, snapshot.bomben, bData => {
        return Anzeige.erzeuge({
            id: bData.id,
            x: bData.x,
            y: bData.y,
            rot: bData.rot || 0,
            owner: bData.owner,
            stufe: bData.stufe || 1,
            isMini: bData.isMini || false,
            snapX: bData.x,
            snapY: bData.y
        }, 'bombe');
    }, (obj, bData) => {
        leiteGeschwindigkeitAb(obj, bData.x, bData.y);
        obj.x = bData.x;
        obj.y = bData.y;
        obj.rot = bData.rot || 0;
    });

    // Klingenwellen der Gleve (keine Extrapolation, kommen mit jedem Snapshot)
    synchronisiereListe(arrays.gleveWellen, snapshot.gleveWellen, wData => {
        return Anzeige.erzeuge({ id: wData.id, x: wData.x, y: wData.y, startY: wData.y, breite: wData.breite, hoehe: Gleve.WELLE_HOEHE, owner: wData.owner, farbe: Gleve.welleFarbe(wData.owner) }, 'gleveWelle');
    }, (obj, wData) => {
        obj.x = wData.x;
        obj.y = wData.y;
    });

    // Granaten des Sniper-Hosts/-Clients im Flug
    Sniper.synchronisiereGranaten(snapshot.sniperGranaten);
    Sniper.synchronisiereMinen(snapshot.sniperMinen);

    // 11. Replicate Enemy Lasers
    synchronisiereListe(arrays.feindLaserArray, snapshot.feindLaser, flData => {
        const obj = Anzeige.erzeuge({
            id: flData.id,
            x: flData.x,
            y: flData.y,
            vx: flData.vx,
            vy: flData.vy,
            rot: flData.vx ? Math.atan2(flData.vy || 7, flData.vx) * 180 / Math.PI - 90 : undefined
        }, 'feindLaser');
        uebernehmeHarmlos(obj, flData);
        return obj;
    }, (obj, flData) => {
        obj.x = flData.x;
        obj.y = flData.y;
        obj.vx = flData.vx;
        obj.vy = flData.vy;
        if (flData.vx && flData.vx !== 0) obj.rot = Math.atan2(flData.vy || 7, flData.vx) * 180 / Math.PI - 90;
        uebernehmeHarmlos(obj, flData);
    });

    // 11b. Replicate Hack-Projektile
    synchronisiereListe(arrays.hackProjektilArray, snapshot.hackProjektile, hpData => {
        const obj = Anzeige.erzeuge({ id: hpData.id, x: hpData.x, y: hpData.y, vx: 0, vy: 0, width: 12, height: 12, snapX: hpData.x, snapY: hpData.y }, 'hackProjektil');
        uebernehmeHarmlos(obj, hpData);
        return obj;
    }, (obj, hpData) => {
        leiteGeschwindigkeitAb(obj, hpData.x, hpData.y);
        obj.x = hpData.x;
        obj.y = hpData.y;
        uebernehmeHarmlos(obj, hpData);
    });

    // 12. Replicate Boss Lasers
    synchronisiereListe(arrays.bossLaserArray, snapshot.bossLaser, blData => {
        const obj = Anzeige.erzeuge({
            id: blData.id,
            x: blData.x,
            y: blData.y,
            vx: blData.vx,
            vy: blData.vy,
            rot: blData.vx ? Math.atan2(blData.vy || 6, blData.vx) * 180 / Math.PI - 90 : undefined
        }, 'bossLaser');
        uebernehmeHarmlos(obj, blData);
        return obj;
    }, (obj, blData) => {
        obj.x = blData.x;
        obj.y = blData.y;
        obj.vx = blData.vx;
        obj.vy = blData.vy;
        if (blData.vx && blData.vx !== 0) obj.rot = Math.atan2(blData.vy || 6, blData.vx) * 180 / Math.PI - 90;
        uebernehmeHarmlos(obj, blData);
    });

    // 13. Replicate Boss Rockets
    synchronisiereListe(arrays.bossRaketenArray, snapshot.bossRaketen, brData => {
        return Anzeige.erzeuge({
            id: brData.id,
            x: brData.x,
            y: brData.y,
            vx: brData.vx || 0,
            vy: brData.vy || 0,
            rot: brData.rot || 0
        }, 'bossRakete');
    }, (obj, brData) => {
        obj.x = brData.x;
        obj.y = brData.y;
        obj.vx = brData.vx || 0;
        obj.vy = brData.vy || 0;
        obj.rot = brData.rot || 0;
    });

    // 14. Replicate Boss Bombs
    synchronisiereListe(arrays.bossBombenArray, snapshot.bossBomben, bbData => {
        return Anzeige.erzeuge({
            id: bbData.id,
            x: bbData.x,
            y: bbData.y,
            groesse: bbData.groesse || 26,
            snapX: bbData.x,
            snapY: bbData.y
        }, 'bossBombe');
    }, (obj, bbData) => {
        leiteGeschwindigkeitAb(obj, bbData.x, bbData.y);
        obj.x = bbData.x;
        obj.y = bbData.y;
    });

    // 15. Replicate Powerups with full styling & owner badges
    if (snapshot.powerups) {
        const currentIds = new Set();
        snapshot.powerups.forEach(pData => {
            currentIds.add(pData.id);
            let existing = arrays.powerups.find(p => p.id === pData.id);
            if (!existing) {
                existing = Anzeige.erzeuge({
                    id: pData.id,
                    x: pData.x,
                    y: pData.y,
                    groesse: 24,
                    type: pData.type,
                    farbe: Entities.powerupFarbe(pData.type),
                    owner: pData.owner,
                    towedBy: null
                }, 'powerup');
                setzeInterpolationsZiel(existing, pData.x, pData.y);
                arrays.powerups.push(existing);
            } else {
                existing.x = pData.x;
                existing.y = pData.y;
                setzeInterpolationsZiel(existing, pData.x, pData.y);
            }
            // Schlepp-Zustand des Hosts uebernehmen; Strahl-Start setzt clientSchritt, zeichnen tut die Anzeige
            existing.towedBy = pData.towedBy || null;
        });
        for (let i = arrays.powerups.length - 1; i >= 0; i--) {
            if (!currentIds.has(arrays.powerups[i].id)) {
                Anzeige.entferne(arrays.powerups[i]);
                arrays.powerups.splice(i, 1);
            }
        }
    }

    // Uebernommene Positionen sofort zeigen (zwischen den Snapshots zeichnet simulationsSchritt)
    Anzeige.zeichneWelt();
}

export function serializePlayerInput() {
    const keys = state.tastenGedrueckt;
    // Sniper: Lade-Knopf (Handy) zaehlt wie die Laser-Taste; der Joystick feuert dagegen Normalschuesse ohne Laden (auto)
    const sniper = state.p2 && Sniper.istSniper(state.p2);
    const isLaser = Boolean(keys.l || keys.b || (sniper && state.sniperLadeKnopf));
    const sniperAuto = Boolean(sniper && state.joystick && state.joystick.feuert && !state.sniperLadeKnopf && !keys.b);
    const isRakete = Boolean(keys.k || keys.v);
    const isBombe = Boolean(keys[' '] || keys.c || keys.enter);
    // Gleve: Steuerrichtung fuer den Dash; waehrend des vorhergesagten Dashs Startposition und Dash-Richtung
    const gleve = state.p2 && Gleve.istGleve(state.p2) ? Gleve.netzEingabe(state.p2, state.p2.clientSteuerRichtung) : null;

    // Viper: im Startschritt der Rolle Startposition und Richtung (ro), der Host rollt von dort aus
    const viper = state.p2 && Viper.istViper(state.p2) ? Viper.netzEingabe(state.p2) : null;
    const start = gleve || viper;

    return {
        x: start ? start.x : (state.p2 ? state.p2.x : state.x),
        y: start ? start.y : (state.p2 ? state.p2.y : state.y),
        ...(gleve ? { rx: gleve.rx, ry: gleve.ry } : {}),
        ...(viper ? { ro: viper.ro } : {}),
        rotate: state.p2 ? (state.p2.rotate || 0) : (state.rotate || 0),
        laser: isLaser,
        rakete: isRakete,
        bombe: isBombe,
        ...(sniperAuto ? { auto: true } : {})
    };
}

export function applyPlayerInput(input) {
    if (!input || !state.p2) return;

    // Client-Werte nicht vertrauen: nur endliche Zahlen, begrenzt auf das Spielfeld.
    // Waehrend Gleve-Dash/-Abprall bewegt der Host das Schiff selbst (Treffer und Abprall sind Host-Sache).
    // Dasselbe gilt fuer die Viper-Rolle (laeuft oder ist angefragt, aber noch nicht gestartet).
    const dashAktiv = (Gleve.istGleve(state.p2) && Gleve.istDashAktiv(state.p2)) ||
        (Viper.istViper(state.p2) && (Viper.istRolleAktiv(state.p2) || Boolean(state.p2.netzRolleAnfrage)));
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

    // Viper: Client meldet den Start seiner Rolle (Richtung -1/+1); der Host prueft den Cooldown selbst
    if ((input.ro === 1 || input.ro === -1) && Viper.istViper(state.p2)) state.p2.netzRolleAnfrage = input.ro;

    if (input.laser !== undefined) {
        // Sniper: neuer Druck bleibt gemerkt, auch wenn das Loslassen im selben Host-Schritt ankommt (kurzer Tipp = ein Schuss)
        if (input.laser && !state.p2.laserInputRequested && Sniper.istSniper(state.p2)) state.p2.netzLaserAnfrage = true;
        state.p2.laserInputRequested = Boolean(input.laser);
    }
    state.p2.sniperAutoInput = Boolean(input.auto);

    // Gehaltene Tasten gelten bis zum naechsten Paket (waffen.js feuert damit wie bei
    // einem true in jedem Schritt); ein kurzer Druck bleibt wie bisher bis zum Schuss gemerkt
    if (input.rakete !== undefined) {
        // Neuer Druck bleibt fuer den Gleve-Dash gemerkt, auch wenn das Loslassen im selben Host-Schritt ankommt
        if (input.rakete && !state.p2.raketeGehalten) {
            state.p2.netzDashAnfrage = true;
            state.p2.netzGranatenAnfrage = true; // Sniper: kurzer Tipp geht nicht verloren
        }
        state.p2.raketeGehalten = Boolean(input.rakete);
    }
    if (input.bombe !== undefined) state.p2.bombeGehalten = Boolean(input.bombe);

    if (input.rakete && !Sniper.istSniper(state.p2)) {
        state.p2.networkFireRakete = true;
    }

    if (input.bombe) {
        state.p2.networkFireBombe = true;
    }

    state.p2.drehung = state.p2.rotate;
}

