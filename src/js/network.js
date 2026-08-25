import { state, dom, config, arrays } from './state.js';
import * as Cutscene from './cutscene.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';

let room = null;
let sendStateAction = null;
let sendInputAction = null;
let sendEventAction = null;

let onStateCallbacks = [];
let onInputCallbacks = [];
let onEventCallbacks = [];

let trysteroJoinRoom = null;

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

        if (isHost) {
            if (btnStart) btnStart.style.display = 'block';
            updateOnlineStatus(`MITSPIELER VERBUNDEN! (CODE: ${roomCode || '---'})`);
            if (startText) {
                startText.textContent = 'KLICKE "SPIEL STARTEN" ZUM BEGINN';
                startText.style.color = '#2ecc71';
            }
        } else {
            if (btnStart) btnStart.style.display = 'none';
            updateOnlineStatus(`VERBUNDEN MIT HOST! (CODE: ${roomCode || '---'})`);
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

    updateOnlineStatus(`RAUM-CODE: ${code} | WARTE AUF MITSPIELER...`);

    const joinRoomFn = await loadTrystero();
    if (!joinRoomFn) return;

    if (room) {
        try { room.leave(); } catch (e) {}
    }

    room = joinRoomFn({ appId: 'starshooter-p2p' }, 'star_' + code);

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
            updateOnlineStatus(`MITSPIELER HAT DAS SPIEL VERLASSEN!`, true);
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
    if (dom.spieler) dom.spieler.classList.remove('spieler-blink');
    if (dom.spieler2) dom.spieler2.classList.remove('spieler-blink');

    Cutscene.startCutscene();
}

export function onPeerJoined(peerId) {
    state.network.connected = true;
    state.network.peerId = peerId;
    updateOnlineLobbyUI();

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

    updateOnlineStatus(`VERBINDE MIT RAUM ${cleanCode}...`);

    const joinRoomFn = await loadTrystero();
    if (!joinRoomFn) return;

    if (room) {
        try { room.leave(); } catch (e) {}
    }

    room = joinRoomFn({ appId: 'starshooter-p2p' }, 'star_' + cleanCode);

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
            updateOnlineLobbyUI();
            
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
            updateOnlineStatus(`VERBINDUNG ZUM HOST VERLOREN!`, true);
            updateOnlineLobbyUI();
        }
    );

    return true;
}

export function handleNetworkEvent(data, peerId = null) {
    if (!data) return;

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
            updateOnlineStatus('MITSPIELER HAT DEN RAUM VERLASSEN!', true);
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
            updateOnlineStatus('HOST HAT DEN RAUM VERLASSEN!', true);
            updateOnlineLobbyUI();
        }
        if (data.type === 'game_start') {
            // Vor dem Überschreiben der Host-Daten merken wir uns die eigene Schiffswahl des Clients
            const clientChosenModel = data.clientShipModel || state.selectedShipModel || (state.p2 && state.p2.selectedShipModel) || 'viper';
            const clientChosenColor = data.clientShipColor || state.selectedShipColor || (state.p2 && state.p2.selectedShipColor) || 'red';

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

export function sendNetworkState(stateSnapshot) {
    if (sendStateAction && state.network.connected) {
        sendStateAction(stateSnapshot);
    }
}

export function sendNetworkInput(inputData) {
    if (sendInputAction && state.network.connected) {
        sendInputAction(inputData);
    }
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
    state.network.peerId = null;
    const statusEl = document.getElementById('online-status');
    if (statusEl) statusEl.style.display = 'none';
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
            raketenCooldown: state.raketenCooldown,
            bombenCooldown: state.bombenCooldown,
            laserSchiesst: state.laserSchiesst,
            isDead: state.isDead
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
            raketenCooldown: state.p2.raketenCooldown,
            bombenCooldown: state.p2.bombenCooldown,
            laserSchiesst: state.p2.laserSchiesst,
            isDead: state.p2.isDead
        } : null,
        score: state.score,
        level: state.level,
        bossAktiv: state.bossAktiv,
        feinde: arrays.feinde.map((f, idx) => ({
            id: f.id || `f_${idx}_${Math.round(f.x)}_${Math.round(f.y)}`,
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
        asteroiden: arrays.asteroiden.map((a, idx) => ({
            id: a.id || `a_${idx}_${Math.round(a.x)}_${Math.round(a.y)}`,
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
        bosses: arrays.bosses.map((b, idx) => ({
            id: b.id || `boss_${idx}_${b.typ}`,
            x: b.x,
            y: b.y,
            hp: b.hp,
            maxHp: b.maxHp,
            groesse: b.groesse || 100,
            typ: b.typ || 1,
            enrage: b.enragePhaseAktiv || false
        })),
        laser: arrays.laserArray.map((l, idx) => ({
            id: `l_${idx}_${Math.round(l.x)}_${Math.round(l.y)}`,
            x: l.x,
            y: l.y,
            vx: l.vx || 0,
            vy: l.vy || 15,
            width: l.width || 4,
            height: l.height || 20,
            color: l.el ? l.el.style.backgroundColor : (l.owner === 'p2' ? '#3498db' : '#00ffff'),
            owner: l.owner || 'p1'
        })),
        raketen: arrays.raketenArray.map((r, idx) => ({
            id: `r_${idx}_${Math.round(r.x)}_${Math.round(r.y)}`,
            x: r.x,
            y: r.y,
            rot: r.rot || (r.vy ? (Math.atan2(-r.vy, r.vx || 0.0001) * 180 / Math.PI + 90) : 0),
            owner: r.owner || 'p1',
            homing: r.homing || false,
            stufe: (r.owner === 'p2' ? (state.p2 && state.p2.raketenStufe) : state.raketenStufe) || 1
        })),
        bomben: arrays.bombenArray.map((b, idx) => ({
            id: `b_${idx}_${Math.round(b.x)}_${Math.round(b.y)}`,
            x: b.x,
            y: b.y,
            rot: b.rot || 0,
            owner: b.owner || 'p1',
            stufe: b.stufe || 1,
            isMini: b.isMini || false
        })),
        feindLaser: arrays.feindLaserArray.map((fl, idx) => ({
            id: `fl_${idx}_${Math.round(fl.x)}_${Math.round(fl.y)}`,
            x: fl.x,
            y: fl.y,
            vx: fl.vx || 0,
            vy: fl.vy || 7
        })),
        bossLaser: arrays.bossLaserArray.map((bl, idx) => ({
            id: `bl_${idx}_${Math.round(bl.x)}_${Math.round(bl.y)}`,
            x: bl.x,
            y: bl.y,
            vx: bl.vx || 0,
            vy: bl.vy || 6,
            width: bl.width || 8,
            height: bl.height || 25
        })),
        bossRaketen: arrays.bossRaketenArray.map((br, idx) => ({
            id: `br_${idx}_${Math.round(br.x)}_${Math.round(br.y)}`,
            x: br.x,
            y: br.y,
            vx: br.vx || 0,
            vy: br.vy || 2,
            rot: Math.atan2(br.vy || 2, br.vx || 0) * 180 / Math.PI + 90
        })),
        bossBomben: arrays.bossBombenArray.map((bb, idx) => ({
            id: `bb_${idx}_${Math.round(bb.x)}_${Math.round(bb.y)}`,
            x: bb.x,
            y: bb.y,
            groesse: bb.groesse || 26
        })),
        powerups: arrays.powerups.map((p, idx) => ({
            id: p.id || `pu_${idx}_${Math.round(p.x)}_${Math.round(p.y)}`,
            x: p.x,
            y: p.y,
            type: p.type || p.typ,
            owner: p.owner,
            towedBy: p.towedBy
        }))
    };
}

export function applyGameStateSnapshot(snapshot) {
    if (!snapshot) return;

    const spielfeld = dom.spielfeld || document.getElementById('spielfeld');
    if (!spielfeld) return;

    // 1. Sync P1 state & visuals on client
    if (snapshot.p1) {
        state.x = snapshot.p1.x;
        state.y = snapshot.p1.y;
        state.leben = snapshot.p1.leben;
        state.energie = snapshot.p1.energie;
        state.maxEnergie = snapshot.p1.maxEnergie || state.maxEnergie;
        state.schildStufe = snapshot.p1.schildStufe || 0;
        state.isDead = snapshot.p1.isDead || false;

        if (dom.spieler) {
            dom.spieler.style.left = state.x + 'px';
            dom.spieler.style.top = state.y + 'px';
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
                dom.energieBalken.style.backgroundColor = state.energie < (state.minZuendEnergie || 15) && !state.laserSchiesst ? '#e67e22' : '#1abc9c';
            }
        }
        if (snapshot.p1.raketenCooldown !== undefined) {
            state.raketenCooldown = snapshot.p1.raketenCooldown;
            const raketenCdBalken = document.getElementById('raketen-cd-balken');
            if (raketenCdBalken) {
                let maxRaketenCd = 180;
                if (state.raketenStufe >= 2 && state.raketenStufe <= 3) maxRaketenCd = 150;
                if (state.raketenStufe >= 4) maxRaketenCd = 120;
                let pctR = Math.max(0, 100 - state.raketenCooldown / maxRaketenCd * 100);
                raketenCdBalken.style.width = pctR + '%';
                raketenCdBalken.style.backgroundColor = state.raketenCooldown <= 0 ? '#2ecc71' : '#e74c3c';
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
    }

    // 2. Sync P2 stats
    if (snapshot.p2 && state.p2) {
        state.p2.leben = snapshot.p2.leben;
        state.p2.energie = snapshot.p2.energie;
        state.p2.maxEnergie = snapshot.p2.maxEnergie || state.p2.maxEnergie;
        state.p2.schildStufe = snapshot.p2.schildStufe || 0;
        state.p2.isDead = snapshot.p2.isDead || false;

        if (dom.spieler2) {
            dom.spieler2.classList.remove('schild-aktiv-1', 'schild-aktiv-2', 'schild-aktiv-3');
            if (state.p2.schildStufe > 0) {
                dom.spieler2.classList.add(`schild-aktiv-${state.p2.schildStufe}`);
            }
            dom.spieler2.style.display = state.p2.isDead ? 'none' : 'block';
        }

        if (dom.energieBalkenP2) {
            dom.energieBalkenP2.style.width = (state.p2.energie / (state.p2.absMaxEnergie || 100)) * 100 + '%';
            dom.energieBalkenP2.style.backgroundColor = state.p2.energie < (state.p2.minZuendEnergie || 15) && !state.p2.laserSchiesst ? '#e67e22' : '#3498db';
        }
        if (snapshot.p2.raketenCooldown !== undefined) {
            state.p2.raketenCooldown = snapshot.p2.raketenCooldown;
            const raketenCdBalkenP2 = document.getElementById('raketen-cd-balken-p2');
            if (raketenCdBalkenP2) {
                let maxRaketenCd = 180;
                if (state.p2.raketenStufe >= 2 && state.p2.raketenStufe <= 3) maxRaketenCd = 150;
                if (state.p2.raketenStufe >= 4) maxRaketenCd = 120;
                let pctR = Math.max(0, 100 - state.p2.raketenCooldown / maxRaketenCd * 100);
                raketenCdBalkenP2.style.width = pctR + '%';
                raketenCdBalkenP2.style.backgroundColor = state.p2.raketenCooldown <= 0 ? '#2ecc71' : '#e74c3c';
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
                arrays.feinde.push(existing);
            } else {
                existing.x = fData.x;
                existing.y = fData.y;
                existing.hp = fData.hp;
                existing.el.style.left = fData.x + 'px';
                existing.el.style.top = fData.y + 'px';
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
                arrays.asteroiden.push(existing);
            } else {
                existing.x = aData.x;
                existing.y = aData.y;
                existing.el.style.left = aData.x + 'px';
                existing.el.style.top = aData.y + 'px';
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
                arrays.bosses.push(existing);
            } else {
                existing.x = bData.x;
                existing.y = bData.y;
                existing.hp = bData.hp;
                existing.el.style.left = bData.x + 'px';
                existing.el.style.top = bData.y + 'px';
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
    if (snapshot.laser) {
        arrays.laserArray.forEach(l => { if (l.el) l.el.remove(); });
        arrays.laserArray.length = 0;
        snapshot.laser.forEach(lData => {
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
            arrays.laserArray.push({
                el: el,
                x: lData.x,
                y: lData.y,
                vx: lData.vx || 0,
                vy: lData.vy || 15,
                owner: lData.owner
            });
        });
    }

    // 9. Replicate Rockets
    if (snapshot.raketen) {
        arrays.raketenArray.forEach(r => { if (r.el) r.el.remove(); });
        arrays.raketenArray.length = 0;
        snapshot.raketen.forEach(rData => {
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
            arrays.raketenArray.push({
                el: el,
                x: rData.x,
                y: rData.y,
                rot: rData.rot || 0,
                owner: rData.owner
            });
        });
    }

    // 10. Replicate Bombs
    if (snapshot.bomben) {
        arrays.bombenArray.forEach(b => { if (b.el) b.el.remove(); });
        arrays.bombenArray.length = 0;
        snapshot.bomben.forEach(bData => {
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
            arrays.bombenArray.push({
                el: el,
                x: bData.x,
                y: bData.y,
                rot: bData.rot || 0,
                owner: bData.owner
            });
        });
    }

    // 11. Replicate Enemy Lasers
    if (snapshot.feindLaser) {
        arrays.feindLaserArray.forEach(fl => { if (fl.el) fl.el.remove(); });
        arrays.feindLaserArray.length = 0;
        snapshot.feindLaser.forEach(flData => {
            const el = document.createElement('div');
            el.classList.add('feind-laser');
            el.style.left = flData.x + 'px';
            el.style.top = flData.y + 'px';
            if (flData.vx && flData.vx !== 0) {
                let winkel = Math.atan2(flData.vy || 7, flData.vx) * 180 / Math.PI;
                el.style.transform = `rotate(${winkel - 90}deg)`;
            }
            spielfeld.appendChild(el);
            arrays.feindLaserArray.push({
                el: el,
                x: flData.x,
                y: flData.y,
                vx: flData.vx,
                vy: flData.vy
            });
        });
    }

    // 12. Replicate Boss Lasers
    if (snapshot.bossLaser) {
        arrays.bossLaserArray.forEach(bl => { if (bl.el) bl.el.remove(); });
        arrays.bossLaserArray.length = 0;
        snapshot.bossLaser.forEach(blData => {
            const el = document.createElement('div');
            el.classList.add('boss-laser');
            el.style.left = blData.x + 'px';
            el.style.top = blData.y + 'px';
            if (blData.vx && blData.vx !== 0) {
                let winkel = Math.atan2(blData.vy || 6, blData.vx) * 180 / Math.PI;
                el.style.transform = `rotate(${winkel - 90}deg)`;
            }
            spielfeld.appendChild(el);
            arrays.bossLaserArray.push({
                el: el,
                x: blData.x,
                y: blData.y,
                vx: blData.vx,
                vy: blData.vy
            });
        });
    }

    // 13. Replicate Boss Rockets
    if (snapshot.bossRaketen) {
        arrays.bossRaketenArray.forEach(br => { if (br.el) br.el.remove(); });
        arrays.bossRaketenArray.length = 0;
        snapshot.bossRaketen.forEach(brData => {
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
            arrays.bossRaketenArray.push({
                el: el,
                x: brData.x,
                y: brData.y,
                rot: brData.rot || 0
            });
        });
    }

    // 14. Replicate Boss Bombs
    if (snapshot.bossBomben) {
        arrays.bossBombenArray.forEach(bb => { if (bb.el) bb.el.remove(); });
        arrays.bossBombenArray.length = 0;
        snapshot.bossBomben.forEach(bbData => {
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
            arrays.bossBombenArray.push({
                el: el,
                x: bbData.x,
                y: bbData.y,
                groesse: bbData.groesse || 26
            });
        });
    }

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
                    type: pData.type,
                    owner: pData.owner
                };
                arrays.powerups.push(existing);
            } else {
                existing.x = pData.x;
                existing.y = pData.y;
                existing.el.style.left = pData.x + 'px';
                existing.el.style.top = pData.y + 'px';
            }
        });
        for (let i = arrays.powerups.length - 1; i >= 0; i--) {
            if (!currentIds.has(arrays.powerups[i].id)) {
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

    return {
        x: state.p2 ? state.p2.x : state.x,
        y: state.p2 ? state.p2.y : state.y,
        rotate: state.p2 ? (state.p2.rotate || 0) : (state.rotate || 0),
        laser: isLaser,
        rakete: isRakete,
        bombe: isBombe
    };
}

export function applyPlayerInput(input) {
    if (!input || !state.p2) return;

    state.p2.x = input.x;
    state.p2.y = input.y;
    state.p2.rotate = input.rotate || 0;

    if (input.laser !== undefined) {
        state.p2.laserInputRequested = Boolean(input.laser);
    }

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

