
import { state, dom, config, arrays } from './state.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Loop from './loop.js';


export function setupInput() {
  window.addEventListener('keydown', e => {
    if (state.tastenGedrueckt.hasOwnProperty(e.key.toLowerCase())) {
      state.tastenGedrueckt[e.key.toLowerCase()] = true;
      if (e.key === ' ') e.preventDefault();
    }
    if (e.key.length === 1) {
      if (e.key.toLowerCase() === 'p' && state.spielLaeuft && !state.gameOverAktiv) {
        state.pausiert = !state.pausiert;
        dom.pauseOverlay.style.display = state.pausiert ? 'block' : 'none';
      }
      
      state.typedCheatKeys += e.key.toLowerCase();
      if (state.typedCheatKeys.length > 10) state.typedCheatKeys = state.typedCheatKeys.slice(-10);
      if (state.typedCheatKeys.endsWith('idkfa')) {
        state.cheatUsed = true;
        state.laserStufe = 5;
        state.raketenStufe = 5;
        state.bombenStufe = 5;
        state.schildStufe = 3;
        dom.spieler.classList.remove('schild-aktiv-1', 'schild-aktiv-2');
        dom.spieler.classList.add('schild-aktiv-3');
        state.maxEnergie = state.absMaxEnergie;
        state.energie = state.maxEnergie;
        state.laserDurchschlag = true;
        state.durchschlagTimer = 600;
        state.autolaserAktiv = true;
        state.autolaserTimer = 600;
        Utils.updateAktivePowerupsUI();
        Utils.updateLebenUI();
        Utils.updateMaxEnergieMarker();
        let overlay = document.getElementById('warning-overlay');
        overlay.innerHTML = 'IDKFA<br>Very Happy Ammo!';
        overlay.style.display = 'block';
        overlay.style.color = '#f1c40f';
        setTimeout(() => {
          overlay.style.display = 'none';
          overlay.style.color = '#e74c3c';
          overlay.innerHTML = 'WARNING<br>BOSS APPROACHING';
        }, 2000);
      }
      if (state.typedCheatKeys.endsWith('idgod')) {
        state.cheatUsed = true;
        state.godMode = !state.godMode;
        let overlay = document.getElementById('warning-overlay');
        overlay.innerHTML = state.godMode ? 'IDGOD<br>Degreelessness Mode On' : 'IDGOD<br>Degreelessness Mode Off';
        overlay.style.display = 'block';
        overlay.style.color = '#f1c40f';
        setTimeout(() => {
          overlay.style.display = 'none';
          overlay.style.color = '#e74c3c';
          overlay.innerHTML = 'WARNING<br>BOSS APPROACHING';
        }, 2000);
      }
    }
  });
  window.addEventListener('keyup', e => {
    if (state.tastenGedrueckt.hasOwnProperty(e.key.toLowerCase())) state.tastenGedrueckt[e.key.toLowerCase()] = false;
  });
  document.getElementById('btn-save-score').addEventListener('click', () => {
    let nameInput = document.getElementById('highscore-name').value;
    if (!nameInput || nameInput.trim() === '') nameInput = 'AAA';
    Utils.saveHighscore(nameInput, state.finalerScore);
    document.getElementById('highscore-form').style.display = 'none';
    Utils.renderHighscores();
  });
  document.getElementById('btn-restart').addEventListener('click', Utils.restartGame);

  // --- MOBILE TOUCH CONTROLS ---
  let touchStartX = 0;
  let touchStartY = 0;
  let shipStartX = 0;
  let shipStartY = 0;
  let isDragging = false;

  const spielfeldContainer = document.getElementById('game-wrapper');

  spielfeldContainer.addEventListener('touchstart', e => {
    if (!state.spielLaeuft && !state.gameOverAktiv) {
      state.spielLaeuft = true;
      let startScreen = document.getElementById('start-screen');
      if (startScreen) startScreen.style.display = 'none';
      return;
    }
    
    if (!state.spielLaeuft) return;
    if (e.target.closest('#mobile-controls')) return; // Ignore if clicking buttons
    
    if (e.touches.length === 1 && !state.gameOverAktiv && !state.pausiert) {
      isDragging = true;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      shipStartX = state.x;
      shipStartY = state.y;
      state.tastenGedrueckt.l = true; // Auto-fire laser
    }
  }, { passive: false });

  spielfeldContainer.addEventListener('touchmove', e => {
    if (isDragging && state.spielLaeuft && !state.gameOverAktiv && !state.pausiert) {
      e.preventDefault();
      let touchX = e.touches[0].clientX;
      let touchY = e.touches[0].clientY;
      
      let transformStr = dom.spielfeld.style.transform;
      let scale = 1;
      if (transformStr && transformStr.includes('scale')) {
          let match = transformStr.match(/scale\(([^)]+)\)/);
          if (match) scale = parseFloat(match[1]);
      }
      if (scale === 0 || isNaN(scale)) scale = 1;
      
      let deltaX = (touchX - touchStartX) / scale;
      let deltaY = (touchY - touchStartY) / scale;
      
      let newX = shipStartX + deltaX;
      let newY = shipStartY + deltaY;
      
      if (newX < 0) newX = 0;
      if (newX > config.spielfeldBreite - config.spielerGroesse) newX = config.spielfeldBreite - config.spielerGroesse;
      if (newY < 0) newY = 0;
      if (newY > config.spielfeldHoehe - config.spielerGroesse) newY = config.spielfeldHoehe - config.spielerGroesse;
      
      state.x = newX;
      state.y = newY;
    }
  }, { passive: false });

  spielfeldContainer.addEventListener('touchend', e => {
    if (e.touches.length === 0) {
      isDragging = false;
      state.tastenGedrueckt.l = false; // Stop auto-fire
    }
  });

  document.getElementById('btn-rakete').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state.spielLaeuft && !state.gameOverAktiv && !state.pausiert) {
      state.tastenGedrueckt.k = true;
      setTimeout(() => state.tastenGedrueckt.k = false, 100);
    }
  });
  
  document.getElementById('btn-bombe').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state.spielLaeuft && !state.gameOverAktiv && !state.pausiert) {
      state.tastenGedrueckt[' '] = true;
      setTimeout(() => state.tastenGedrueckt[' '] = false, 100);
    }
  });

  document.getElementById('btn-pause').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state.spielLaeuft && !state.gameOverAktiv) {
      state.pausiert = !state.pausiert;
      dom.pauseOverlay.style.display = state.pausiert ? 'block' : 'none';
    }
  });

  // UI Updates
}