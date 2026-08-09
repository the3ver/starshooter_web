
import { state, dom, config, arrays } from './state.js';
import { setupInput } from './input.js';
import { gameLoop } from './loop.js';

document.addEventListener('DOMContentLoaded', () => {
    setupInput();
    
    // Initialisiere Sterne
    for (let i = 0; i < 100; i++) {
        let stern = document.createElement('div');
        stern.className = 'stern';
        let x = Math.random() * config.spielfeldBreite;
        let y = Math.random() * config.spielfeldHoehe;
        let groesse = Math.random() * 2 + 1;
        let speed = Math.random() * 3.0 + 1.0;
        
        stern.style.left = x + 'px';
        stern.style.top = y + 'px';
        stern.style.width = groesse + 'px';
        stern.style.height = groesse + 'px';
        stern.style.opacity = Math.random() * 0.5 + 0.3;
        
        dom.spielfeld.appendChild(stern);
        arrays.sterne.push({ el: stern, x, y, speed });
    }

    function resizeGame() {
        let availableHeight = window.innerHeight * 0.95;
        let scale = availableHeight / 600;
        
        let availableWidth = window.innerWidth * 0.95; // Volle Breite nutzen, da Seitenmenü weg ist
        if (400 * scale > availableWidth) {
            scale = availableWidth / 400;
        }
        
        if (scale < 0.5) scale = 0.5;

        dom.spielfeld.style.transform = `scale(${scale})`;
        
        let container = document.getElementById('spielfeld-container');
        if (container) {
            container.style.width = (400 * scale) + 'px';
            container.style.height = (600 * scale) + 'px';
        }

        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const mobileControls = document.getElementById('mobile-controls');
        if (mobileControls) {
            mobileControls.style.display = isTouchDevice ? 'flex' : 'none';
        }
    }
    
    window.addEventListener('resize', resizeGame);
    resizeGame();

    state.spielLaeuft = false;
    // UI initialisieren
    import('./utils.js').then(Utils => {
        Utils.updateMaxEnergieMarker();
    });

    requestAnimationFrame(gameLoop);
});
