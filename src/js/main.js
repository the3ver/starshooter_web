import { state, dom, config, arrays } from './state.js';
import { setupInput } from './input.js';
import { gameLoop } from './loop.js';
import * as Audio from './audio.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Changelog from './changelog.js';

export { state, dom, config, arrays, Utils, Entities, Audio };

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
            }
            Utils.updatePlayerShipVisuals();
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
            }
            Utils.updatePlayerShipVisuals();
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
});
