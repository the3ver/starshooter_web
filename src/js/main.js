
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

    state.spielLaeuft = false;
    requestAnimationFrame(gameLoop);
});
