import { state, dom, config, arrays } from './state.js';
import { setupInput } from './input.js';
import { gameLoop } from './loop.js';
import * as Audio from './audio.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Changelog from './changelog.js';
import * as Network from './network.js';
import * as Cutscene from './cutscene.js';

export { state, dom, config, arrays, Utils, Entities, Audio, Network, Cutscene };

// Expose for test access
window.__game = { state, dom, config, arrays, Utils, Entities, Audio, Network, Cutscene, Loop: { gameLoop } };

document.addEventListener('DOMContentLoaded', () => {
    Audio.initSoundState();
    const btnSoundToggle = document.getElementById('btn-sound-toggle');
    if (btnSoundToggle) {
        btnSoundToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            Audio.initAudio();
            Audio.toggleMute();
        });
    }

    setupInput();

    Network.onNetworkState((snapshot) => {
        if (state.network.isClient) {
            Network.applyGameStateSnapshot(snapshot);
        }
    });

    Network.onNetworkInput((input) => {
        if (state.network.isHost) {
            Network.applyPlayerInput(input);
        }
    });
    
    // Initialisiere Sterne
    for (let i = 0; i < 60; i++) {
        let stern = document.createElement('div');
        stern.className = 'stern';
        let x = Math.random() * config.spielfeldBreite;
        let y = Math.random() * config.spielfeldHoehe;
        let size = Math.random() * 2 + 1;
        let speed = Math.random() * 2 + 0.5;
        
        stern.style.left = x + 'px';
        stern.style.top = y + 'px';
        stern.style.width = size + 'px';
        stern.style.height = size + 'px';
        
        dom.spielfeld.appendChild(stern);
        arrays.sterne.push({
            el: stern,
            x: x,
            y: y,
            speed: speed
        });
    }

    // Start Game Loop
    requestAnimationFrame(gameLoop);

    // Responsive Skalierung
    function resizeGame() {
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const mobileControls = document.getElementById('mobile-controls');
        const controlsVisible = mobileControls && mobileControls.style.display !== 'none';
        let controlsHeight = (isTouch && controlsVisible) ? 80 : 0;
        let availableHeight = (window.innerHeight * 0.95) - controlsHeight;
        let scale = availableHeight / 600;
        
        let width = config.spielfeldBreite || 400;
        let availableWidth = window.innerWidth * 0.95;
        if (width * scale > availableWidth) {
            scale = availableWidth / width;
        }
        
        if (scale < 0.5) scale = 0.5;

        if (dom.spielfeld) {
            dom.spielfeld.style.transform = `scale(${scale})`;
            dom.spielfeld.style.width = width + 'px';
        }
        
        let container = document.getElementById('spielfeld-container');
        if (container) {
            container.style.width = (width * scale) + 'px';
            container.style.height = (600 * scale) + 'px';
        }

        if (mobileControls && container) {
            mobileControls.style.width = (width * scale) + 'px';
        }
    }

    window.addEventListener('resize', resizeGame);
    window.resizeGame = resizeGame;
    resizeGame();

    state.spielLaeuft = false;
    if (dom.spieler) dom.spieler.style.display = 'none';
    if (dom.spieler2) dom.spieler2.style.display = 'none';

    // UI & Hangar initialisieren
    Utils.updateMaxEnergieMarker();
    Utils.updateLebenUI();
    Utils.updateAktivePowerupsUI();
    Utils.updatePlayerShipVisuals();
    if (!state.spielLaeuft && dom.spieler) {
        dom.spieler.style.display = 'none';
    }
    if (!state.spielLaeuft && dom.spieler2) {
        dom.spieler2.style.display = 'none';
    }

    // Gamemode Selection Event Listeners
    const btnSingle = document.getElementById('gamemode-btn-single');
    if (btnSingle) {
        btnSingle.addEventListener('click', (e) => {
            e.stopPropagation();
            Utils.setGameMode('single');
        });
    }

    const btnCoop = document.getElementById('gamemode-btn-coop');
    if (btnCoop) {
        btnCoop.addEventListener('click', (e) => {
            e.stopPropagation();
            Utils.setGameMode('coop');
        });
    }

    const btnOnline = document.getElementById('gamemode-btn-online');
    if (btnOnline) {
        btnOnline.addEventListener('click', (e) => {
            e.stopPropagation();
            Utils.setGameMode('online');
        });
    }

    const btnOnlineHost = document.getElementById('btn-online-host');
    if (btnOnlineHost) {
        btnOnlineHost.addEventListener('click', (e) => {
            e.stopPropagation();
            Network.hostRoom();
        });
    }

    const btnOnlineJoin = document.getElementById('btn-online-join');
    if (btnOnlineJoin) {
        btnOnlineJoin.addEventListener('click', (e) => {
            e.stopPropagation();
            const input = document.getElementById('online-room-input');
            const code = input ? input.value : '';
            Network.joinOnlineRoom(code);
        });
    }

    const btnOnlineStart = document.getElementById('btn-online-start');
    if (btnOnlineStart) {
        btnOnlineStart.addEventListener('click', (e) => {
            e.stopPropagation();
            Network.hostStartGame();
        });
    }

    const btnOnlineLeave = document.getElementById('btn-online-leave');
    if (btnOnlineLeave) {
        btnOnlineLeave.addEventListener('click', (e) => {
            e.stopPropagation();
            Network.leaveOnlineRoom();
        });
    }

    // Hangar Player Tab Listeners (P1 vs P2)
    document.querySelectorAll('.hangar-player-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            state.activeHangarPlayer = tab.getAttribute('data-player') || 'p1';
            Utils.updatePlayerShipVisuals();
        });
    });

    // Hangar Event Listeners (Model & Color)
    document.querySelectorAll('.hangar-model-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const model = btn.getAttribute('data-model');
            if (state.gameMode === 'coop' && state.activeHangarPlayer === 'p2') {
                if (state.p2) state.p2.selectedShipModel = model;
            } else {
                state.selectedShipModel = model;
                if (state.p2 && state.gameMode === 'online' && state.network.isClient) {
                    state.p2.selectedShipModel = model;
                }
            }
            Utils.updatePlayerShipVisuals();
            if (state.network && state.network.isOnline && state.network.isClient && state.network.connected) {
                Network.sendNetworkEvent({
                    type: 'client_ready',
                    clientShipModel: model,
                    clientShipColor: state.selectedShipColor || (state.p2 && state.p2.selectedShipColor) || 'blue'
                });
            }
        });
    });

    document.querySelectorAll('.hangar-color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const colorId = btn.getAttribute('data-color');
            if (state.gameMode === 'coop' && state.activeHangarPlayer === 'p2') {
                if (state.p2) state.p2.selectedShipColor = colorId;
            } else {
                state.selectedShipColor = colorId;
                if (state.p2 && state.gameMode === 'online' && state.network.isClient) {
                    state.p2.selectedShipColor = colorId;
                }
            }
            Utils.updatePlayerShipVisuals();
            if (state.network && state.network.isOnline && state.network.isClient && state.network.connected) {
                Network.sendNetworkEvent({
                    type: 'client_ready',
                    clientShipModel: state.selectedShipModel || (state.p2 && state.p2.selectedShipModel) || 'viper',
                    clientShipColor: colorId
                });
            }
        });
    });

    // Bot-Partner Controls
    const btnBotToggle = document.getElementById('btn-p2-bot-toggle');
    if (btnBotToggle) {
        btnBotToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            state.p2IsBot = !state.p2IsBot;
            const diffPanel = document.getElementById('bot-difficulty-panel');
            if (diffPanel) diffPanel.style.display = state.p2IsBot ? 'flex' : 'none';
            btnBotToggle.classList.toggle('active', state.p2IsBot);
            btnBotToggle.textContent = state.p2IsBot ? '🤖 BOT AKTIV' : '🤖 BOT';
        });
    }
    document.querySelectorAll('.bot-diff-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.p2BotDifficulty = btn.getAttribute('data-diff');
            document.querySelectorAll('.bot-diff-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Was gibt's Neues Changelog
    Changelog.checkAndShowWhatsNew();

    const btnClose = document.getElementById('btn-close-whats-new');
    if (btnClose) {
        btnClose.addEventListener('click', () => {
            Changelog.closeWhatsNewModal();
        });
    }

    const btnOpenWhatsNew = document.getElementById('btn-open-whats-new');
    if (btnOpenWhatsNew) {
        btnOpenWhatsNew.addEventListener('click', (e) => {
            e.stopPropagation();
            Changelog.showWhatsNewModal();
        });
    }

    const startText = document.getElementById('start-text');
    if (startText) {
        startText.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state.gameMode === 'online') {
                if (state.network && state.network.isHost && state.network.connected) {
                    Network.hostStartGame();
                }
                return;
            }
            if (!state.spielLaeuft && !state.cutsceneAktiv && !state.gameOverAktiv) {
                const startScreen = document.getElementById('start-screen');
                if (startScreen) startScreen.style.display = 'none';
                Cutscene.startCutscene();
            }
        });
    }
});
