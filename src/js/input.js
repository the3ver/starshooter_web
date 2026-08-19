
import { state, dom, config, arrays } from './state.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Loop from './loop.js';


export function setupInput() {
  window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
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
    if (e.target && e.target.tagName === 'INPUT') return;
    if (state.tastenGedrueckt.hasOwnProperty(e.key.toLowerCase())) state.tastenGedrueckt[e.key.toLowerCase()] = false;
  });
  const hsInput = document.getElementById('highscore-name');
  if (hsInput) {
    hsInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        document.getElementById('btn-save-score').click();
      }
    });
  }
  document.getElementById('btn-save-score').addEventListener('click', () => {
    let nameInput = document.getElementById('highscore-name').value;
    if (!nameInput || nameInput.trim() === '') nameInput = 'AAA';
    Utils.saveHighscore(nameInput, state.finalerScore);
    document.getElementById('highscore-form').style.display = 'none';
    Utils.renderHighscores();
  });
  document.getElementById('btn-restart').addEventListener('click', Utils.restartGame);

  // --- MOBILE TOUCH CONTROLS (VIRTUAL JOYSTICK & TAP) ---
  const spielfeldContainer = document.getElementById('game-wrapper');
  const joystickZone = document.getElementById('joystick-zone');
  const joystickBase = document.getElementById('joystick-base');
  const joystickStick = document.getElementById('joystick-stick');
  
  let jCenterX = 0;
  let jCenterY = 0;
  const maxJoystickRadius = 50;

  // 1. Tap to Pause on Spielfeld
  spielfeldContainer.addEventListener('touchstart', e => {
    if (e.target.closest('#whats-new-overlay') || e.target.closest('#btn-open-whats-new')) return;
    const whatsNew = document.getElementById('whats-new-overlay');
    if (whatsNew && whatsNew.style.display !== 'none') return;

    if (!state.spielLaeuft && !state.gameOverAktiv) {
      state.spielLaeuft = true;
      let startScreen = document.getElementById('start-screen');
      if (startScreen) startScreen.style.display = 'none';
      Utils.updateMobileControlsVisibility();
      return;
    }
    
    if (!state.spielLaeuft || state.gameOverAktiv) return;
    
    // Ignore if clicking mobile controls
    if (e.target.closest('#mobile-controls')) return; 

    // If tap is in the upper 30% of the screen, pause
    if (e.touches.length > 0) {
      let touchY = e.touches[0].clientY;
      if (touchY < window.innerHeight * 0.3) {
        state.pausiert = !state.pausiert;
        dom.pauseOverlay.style.display = state.pausiert ? 'block' : 'none';
      }
    }
  }, { passive: false });

  // 2. Joystick Logic
  if (joystickZone) {
    joystickZone.addEventListener('touchstart', e => {
      e.preventDefault();
      if (!state.spielLaeuft || state.gameOverAktiv || state.pausiert) return;
      
      let touchX = e.touches[0].clientX;
      let touchY = e.touches[0].clientY;
      
      jCenterX = touchX;
      jCenterY = touchY;
      
      joystickBase.style.left = touchX + 'px';
      joystickBase.style.top = touchY + 'px';
      joystickBase.style.display = 'block';
      joystickStick.style.transform = `translate(-50%, -50%)`;
      
      state.joystick.active = true;
      state.tastenGedrueckt.l = true; // Auto-fire laser
    }, { passive: false });

    joystickZone.addEventListener('touchmove', e => {
      e.preventDefault();
      if (!state.joystick.active || state.pausiert) return;
      
      let touchX = e.touches[0].clientX;
      let touchY = e.touches[0].clientY;
      
      let dx = touchX - jCenterX;
      let dy = touchY - jCenterY;
      let distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > maxJoystickRadius) {
        dx = (dx / distance) * maxJoystickRadius;
        dy = (dy / distance) * maxJoystickRadius;
      }
      
      joystickStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      
      // Normalize between -1 and 1
      state.joystick.x = dx / maxJoystickRadius;
      state.joystick.y = dy / maxJoystickRadius;
    }, { passive: false });

    joystickZone.addEventListener('touchend', e => {
      e.preventDefault();
      joystickBase.style.display = 'none';
      state.joystick.active = false;
      state.joystick.x = 0;
      state.joystick.y = 0;
      state.tastenGedrueckt.l = false; // Stop auto-fire
    });
  }

  // 3. Mobile Buttons
  const btnRakete = document.getElementById('btn-rakete');
  if (btnRakete) {
    btnRakete.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (state.spielLaeuft && !state.gameOverAktiv && !state.pausiert) {
        state.tastenGedrueckt.k = true;
        setTimeout(() => state.tastenGedrueckt.k = false, 100);
      }
    });
  }
  
  const btnBombe = document.getElementById('btn-bombe');
  if (btnBombe) {
    btnBombe.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (state.spielLaeuft && !state.gameOverAktiv && !state.pausiert) {
        state.tastenGedrueckt[' '] = true;
        setTimeout(() => state.tastenGedrueckt[' '] = false, 100);
      }
    });
  }

  // UI Updates
}