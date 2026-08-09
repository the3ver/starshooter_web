
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

  // UI Updates
}