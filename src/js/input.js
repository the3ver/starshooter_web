import { state, dom, arrays } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Cutscene from './cutscene.js';
import * as Network from './network.js';
import * as Sniper from './sniper.js';
import { togglePause, handleEscape, initPauseMenu } from './pause.js';
import * as Display from './display.js';

export function setupInput() {
  initPauseMenu();
  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    Audio.initAudio();

    if (e.key === 'Escape' || e.key === 'Esc') {
      const controls = document.getElementById('steuerung-overlay');
      if (controls && controls.style.display !== 'none') {
        controls.style.display = 'none';
        e.preventDefault();
        return;
      }
      if (state.cutsceneActive) {
        Cutscene.skipCutscene();
        return;
      }
      if (handleEscape()) {
        e.preventDefault();
        return;
      }
    }

    const k = e.key ? e.key.toLowerCase() : '';
    if (Object.hasOwn(state.keysPressed, k)) {
      state.keysPressed[k] = true;
      if (e.key === ' ') e.preventDefault();
    }
    if (e.code === 'Quote') state.keysPressed['ä'] = true;
    if (e.code === 'Semicolon') state.keysPressed['ö'] = true;
    if (e.key && e.key.length === 1) {
      if (k === 'm') {
        Audio.toggleMute();
      }
      if (k === 'p') {
        togglePause(e.repeat);
      }

      const isOnline = state.gameMode === 'online' || (state.network && state.network.isOnline);
      if (!isOnline) {
        state.typedCheatKeys += k;
        if (state.typedCheatKeys.length > 10) state.typedCheatKeys = state.typedCheatKeys.slice(-10);
        function resetAllCooldowns() {
          state.bombCooldown = 0;
          state.missileCooldown = 0;
          state.playerShotCooldown = 0;
          state.energy = state.maxEnergy;
        }

        const idkflMatch = state.typedCheatKeys.match(/idkfl([1-9])$/);
        if (idkflMatch) {
          const lvl = parseInt(idkflMatch[1], 10);
          state.cheatUsed = true;
          state.level = lvl;
          Utils.updateLevelUI();
          if (dom.bossHpContainer) dom.bossHpContainer.style.display = 'none';
          state.frameCounter = 0;
          if (arrays.bosses) {
            arrays.bosses.forEach(Display.remove);
            arrays.bosses.length = 0;
          }
          if (arrays.bossLaserArray) {
            arrays.bossLaserArray.forEach(Display.remove);
            arrays.bossLaserArray.length = 0;
          }
          if (arrays.bossBombArray) {
            arrays.bossBombArray.forEach(Display.remove);
            arrays.bossBombArray.length = 0;
          }
          if (arrays.bossMissileArray) {
            arrays.bossMissileArray.forEach(Display.remove);
            arrays.bossMissileArray.length = 0;
          }
          resetAllCooldowns();
          let overlay = document.getElementById('warning-overlay');
          // eslint-disable-next-line no-unsanitized/property -- cheat overlay with a level number
          overlay.innerHTML = `IDKFL${lvl}<br>Warping to Level ${lvl}!`;
          overlay.style.display = 'block';
          overlay.style.color = '#f1c40f';
          setTimeout(() => {
            overlay.style.display = 'none';
            overlay.style.color = '#e74c3c';
            overlay.innerHTML = 'WARNING<br>BOSS APPROACHING';
          }, 2000);
        }

        const idkfMatch = state.typedCheatKeys.match(/idkf([1-5])$/);
        if (idkfMatch) {
          const lvl = parseInt(idkfMatch[1], 10);
          state.cheatUsed = true;
          state.laserTier = lvl;
          state.missileTier = lvl;
          state.bombTier = lvl;
          resetAllCooldowns();
          Utils.updateActivePowerupsUi();
          let overlay = document.getElementById('warning-overlay');
          // eslint-disable-next-line no-unsanitized/property -- cheat overlay with a level number
          overlay.innerHTML = `IDKF${lvl}<br>Weapons Level ${lvl}!`;
          overlay.style.display = 'block';
          overlay.style.color = '#f1c40f';
          setTimeout(() => {
            overlay.style.display = 'none';
            overlay.style.color = '#e74c3c';
            overlay.innerHTML = 'WARNING<br>BOSS APPROACHING';
          }, 2000);
        }
        if (state.typedCheatKeys.endsWith('idkfa')) {
          state.cheatUsed = true;
          state.laserTier = 5;
          state.missileTier = 5;
          state.bombTier = 5;
          state.laserPierce = true;
          state.pierceTimer = 999999;
          state.shieldTier = 3;
          state.unlimitedEnergy = true;
          resetAllCooldowns();
          Utils.updateActivePowerupsUi();
          let overlay = document.getElementById('warning-overlay');
          overlay.innerHTML = 'IDKFA<br>Full Weapons & Ammo!';
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
          resetAllCooldowns();
          let overlay = document.getElementById('warning-overlay');
          // eslint-disable-next-line no-unsanitized/property -- constant cheat overlay text
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
    }
  });
  window.addEventListener('keyup', e => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key ? e.key.toLowerCase() : '';
    if (Object.hasOwn(state.keysPressed, k)) state.keysPressed[k] = false;
    if (e.code === 'Quote') state.keysPressed['ä'] = false;
    if (e.code === 'Semicolon') state.keysPressed['ö'] = false;
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
    Utils.submitHighscore();
  });

  const hsTabSingle = document.getElementById('hs-tab-single');
  const hsTabBot = document.getElementById('hs-tab-bot');
  const hsTabOnline = document.getElementById('hs-tab-online');
  if (hsTabSingle) {
    hsTabSingle.addEventListener('click', () => {
      Utils.renderHighscores('single');
    });
  }
  if (hsTabBot) {
    hsTabBot.addEventListener('click', () => {
      Utils.renderHighscores('coop_bot');
    });
  }
  if (hsTabOnline) {
    hsTabOnline.addEventListener('click', () => {
      Utils.renderHighscores('online');
    });
  }

  document.getElementById('btn-restart').addEventListener('click', Utils.restartGame);

  // --- MOBILE TOUCH CONTROLS (VIRTUAL JOYSTICK & TAP) ---
  const playfieldContainer = document.getElementById('game-wrapper');
  const joystickZone = document.getElementById('joystick-zone');
  const joystickBase = document.getElementById('joystick-base');
  const joystickStick = document.getElementById('joystick-stick');

  let jCenterX = 0;
  let jCenterY = 0;
  const maxJoystickRadius = 50;

  // 1. Tap to pause on the playfield & tap to start on the start screen
  playfieldContainer.addEventListener(
    'touchstart',
    e => {
      Audio.initAudio();

      // While the start screen is active:
      const startScreen = document.getElementById('start-screen');
      const isStartScreenVisible = startScreen && startScreen.style.display !== 'none';

      if (isStartScreenVisible) {
        // If the tap hits an element on the start screen (buttons, hangar, info, selectors),
        // the game must NOT start under any circumstances, except for a direct tap on the start text!
        if (/** @type {Element} */ (e.target).closest('#start-screen')) {
          if (/** @type {Element} */ (e.target).closest('#start-text')) {
            if (state.gameMode === 'online') {
              if (state.network && state.network.isHost && state.network.connected) {
                Network.hostStartGame();
              }
              return;
            }
            startScreen.style.display = 'none';
            Cutscene.startCutscene();
          }
          return;
        }

        // Tap outside the start screen on the playfield:
        if (state.gameMode === 'online') return;
        startScreen.style.display = 'none';
        Cutscene.startCutscene();
        return;
      }

      // Ignore clicks on all UI elements / overlays
      if (
        /** @type {Element} */ (e.target).closest(
          'button, input, select, textarea, a, .gamemode-selector, #online-lobby-container, #hangar-container, #whats-new-overlay, #steuerung-overlay, #btn-open-steuerung, #btn-open-whats-new, #btn-sound-toggle, #game-over-screen, .highscore-tab, .credits',
        )
      )
        return;
      const whatsNew = document.getElementById('whats-new-overlay');
      if (whatsNew && whatsNew.style.display !== 'none') return;
      const controlsOv = document.getElementById('steuerung-overlay');
      if (controlsOv && controlsOv.style.display !== 'none') return;

      if (!state.gameRunning || state.gameOverActive) return;

      // Ignore if clicking mobile controls
      if (/** @type {Element} */ (e.target).closest('#mobile-controls')) return;

      // If tap is in the upper 30% of the screen, pause
      if (e.touches.length > 0) {
        let touchY = e.touches[0].clientY;
        if (touchY < window.innerHeight * 0.3) {
          togglePause();
        }
      }
    },
    { passive: false },
  );

  // 2. Joystick Logic
  if (joystickZone) {
    joystickZone.addEventListener(
      'touchstart',
      e => {
        e.preventDefault();
        if (!state.gameRunning || state.gameOverActive || state.paused) return;

        let touchX = e.touches[0].clientX;
        let touchY = e.touches[0].clientY;

        jCenterX = touchX;
        jCenterY = touchY;

        joystickBase.style.left = touchX + 'px';
        joystickBase.style.top = touchY + 'px';
        joystickBase.style.display = 'block';
        joystickStick.style.transform = `translate(-50%, -50%)`;

        state.joystick.active = true;
        state.keysPressed.l = true; // Auto-fire laser (Gleve: continuous sweep)
        state.joystick.fires = true; // Auto-fire, not the real key (Sniper: normal shots instead of charging)
      },
      { passive: false },
    );

    joystickZone.addEventListener(
      'touchmove',
      e => {
        e.preventDefault();
        if (!state.joystick.active || state.paused) return;

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
      },
      { passive: false },
    );

    joystickZone.addEventListener('touchend', e => {
      e.preventDefault();
      joystickBase.style.display = 'none';
      state.joystick.active = false;
      state.joystick.x = 0;
      state.joystick.y = 0;
      state.keysPressed.l = false; // Stop auto-fire
      state.joystick.fires = false;
    });
  }

  // 3. Mobile Buttons
  const btnMissile = document.getElementById('btn-rakete');
  if (btnMissile) {
    btnMissile.addEventListener('touchstart', e => {
      e.preventDefault();
      if (state.gameRunning && !state.gameOverActive && !state.paused) {
        state.keysPressed.k = true;
        // Sniper: holding counts (tap = grenade + EMP, hold = mines), so keep it pressed until release
        if (!Sniper.isSniper(state)) setTimeout(() => (state.keysPressed.k = false), 100);
      }
    });
    const missileEnd = e => {
      e.preventDefault();
      if (Sniper.isSniper(state)) state.keysPressed.k = false;
    };
    btnMissile.addEventListener('touchend', missileEnd);
    btnMissile.addEventListener('touchcancel', missileEnd);
  }

  // Sniper: holding charges, releasing fires (like the laser key; the joystick fires normal shots instead)
  const btnCharge = document.getElementById('btn-laden');
  if (btnCharge) {
    btnCharge.addEventListener('touchstart', e => {
      e.preventDefault();
      if (state.gameRunning && !state.gameOverActive && !state.paused) state.sniperChargingButton = true;
    });
    const chargeEnd = e => {
      e.preventDefault();
      state.sniperChargingButton = false;
    };
    btnCharge.addEventListener('touchend', chargeEnd);
    btnCharge.addEventListener('touchcancel', chargeEnd);
  }

  const btnBomb = document.getElementById('btn-bombe');
  if (btnBomb) {
    btnBomb.addEventListener('touchstart', e => {
      e.preventDefault();
      if (state.gameRunning && !state.gameOverActive && !state.paused) {
        state.keysPressed[' '] = true;
        setTimeout(() => (state.keysPressed[' '] = false), 100);
      }
    });
  }

  // UI Updates
}
