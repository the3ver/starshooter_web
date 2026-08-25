
import { state, dom, config, arrays, shipColors, shipModels, isCoopMode } from './state.js';
import * as Entities from './entities.js';
import * as Input from './input.js';
import * as Loop from './loop.js';
import * as Audio from './audio.js';
import * as Bot from './bot.js';
import * as Network from './network.js';


export function addScore(punkte) {
  state.score += punkte;
  dom.scoreAnzeige.innerText = state.score.toString().padStart(5, '0');
}
let prevLeben = null;

export function updateLebenUI() {
  if (prevLeben === null) {
    prevLeben = state.leben;
  }

  let html = "";
  let lostHtml = "";

  for (let i = 0; i < state.leben; i++) {
    let animClass = (i >= prevLeben) ? 'pu-anim-new' : '';
    html += `<span class="leben-herz ${animClass}">&hearts;</span>`;
  }

  if (state.leben < prevLeben) {
    let lostCount = prevLeben - state.leben;
    for (let i = 0; i < lostCount; i++) {
      lostHtml += `<span class="leben-herz pu-anim-lost">&hearts;</span>`;
    }
  }

  dom.lebenAnzeige.innerHTML = html + lostHtml;

  if (lostHtml) {
    setTimeout(() => {
      const elements = dom.lebenAnzeige.querySelectorAll('.pu-anim-lost');
      elements.forEach(el => el.remove());
    }, 1000);
  }

  prevLeben = state.leben;
}
export function updateLevelUI() {
  dom.levelAnzeige.innerText = 'LEVEL ' + state.level;
}
export function updateMaxEnergieMarker() {
  dom.maxEnergieMarker.style.left = state.maxEnergie / state.absMaxEnergie * 100 + '%';
}
let prevPuState = null;

export function updateAktivePowerupsUI() {
  if (!prevPuState) {
    prevPuState = { ...state };
  }

  let html = '';
  let lostHtml = '';

  function buildIcon(key, currentVal, threshold, textPrefix, isBool, bgRgba, colorFunc) {
    let prevVal = prevPuState[key];
    let animClass = '';
    let isCurrentActive = isBool ? currentVal : currentVal > threshold;
    let isPrevActive = isBool ? prevVal : prevVal > threshold;

    if (isCurrentActive) {
      if (!isPrevActive) animClass = 'pu-anim-new';
      else if (!isBool && currentVal > prevVal) animClass = 'pu-anim-upgrade';
      else if (!isBool && currentVal < prevVal) animClass = 'pu-anim-downgrade';

      let displayVal = isBool ? '' : currentVal;
      let color = typeof colorFunc === 'function' ? colorFunc(currentVal) : colorFunc;
      html += `<div class="active-pu-icon ${animClass}" style="background:${bgRgba}; border:1px solid ${color}; color:${color};">${textPrefix}${displayVal}</div>`;
    } else if (isPrevActive) {
      let displayVal = isBool ? '' : prevVal;
      let color = typeof colorFunc === 'function' ? colorFunc(prevVal) : colorFunc;
      lostHtml += `<div class="active-pu-icon pu-anim-lost" style="background:${bgRgba}; border:1px solid ${color}; color:${color};">${textPrefix}${displayVal}</div>`;
    }
  }

  buildIcon('laserStufe', state.laserStufe, 1, 'L', false, 'rgba(155,89,182,0.2)', val => val === 5 ? '#e056fd' : '#9b59b6');
  buildIcon('raketenStufe', state.raketenStufe, 1, 'R', false, 'rgba(230,126,34,0.2)', val => val === 5 ? '#f39c12' : '#e67e22');
  buildIcon('bombenStufe', state.bombenStufe, 1, 'B', false, 'rgba(192,57,43,0.2)', val => val === 5 ? '#e74c3c' : '#c0392b');
  buildIcon('laserDurchschlag', state.laserDurchschlag, false, '&uarr;', true, 'rgba(0,255,255,0.2)', '#00ffff');
  if (state.schildStufe > 0) {
    buildIcon('schildStufe', state.schildStufe, 0, 'O', false, 'rgba(52,152,219,0.2)', '#3498db');
  } else if (state.selectedShipModel === 'phantom' && (state.phantomSchildRegenTimer || 0) > 0) {
    const maxTimer = state.phantomSchildRegenMax || 900;
    const progress = Math.min(1, Math.max(0, state.phantomSchildRegenTimer / maxTimer));
    const deg = Math.round(progress * 360);
    html += `<div class="active-pu-icon pu-recharging-shield" style="background: conic-gradient(#3498db ${deg}deg, rgba(52,152,219,0.15) 0deg); border:1px solid #3498db; color:#3498db;" title="Schild Stufe 1 lädt auf (${Math.round(progress * 100)}%)">O1</div>`;
  } else {
    buildIcon('schildStufe', state.schildStufe, 0, 'O', false, 'rgba(52,152,219,0.2)', '#3498db');
  }
  buildIcon('autolaserAktiv', state.autolaserAktiv, false, 'A', true, 'rgba(230,126,34,0.2)', '#e67e22');

  dom.aktivePowerupsContainer.innerHTML = html + lostHtml;

  if (lostHtml) {
    setTimeout(() => {
      const elements = dom.aktivePowerupsContainer.querySelectorAll('.pu-anim-lost');
      elements.forEach(el => el.remove());
    }, 1000);
  }

  prevPuState.laserStufe = state.laserStufe;
  prevPuState.raketenStufe = state.raketenStufe;
  prevPuState.bombenStufe = state.bombenStufe;
  prevPuState.laserDurchschlag = state.laserDurchschlag;
  prevPuState.schildStufe = state.schildStufe;
  prevPuState.autolaserAktiv = state.autolaserAktiv;

  updateRaketenWerferVisuals();
}

let prevLebenP2 = null;

export function updateLebenP2UI() {
  if (!state.p2 || !dom.lebenAnzeigeP2) return;
  if (prevLebenP2 === null) {
    prevLebenP2 = state.p2.leben;
  }

  let html = "";
  let lostHtml = "";

  for (let i = 0; i < state.p2.leben; i++) {
    let animClass = (i >= prevLebenP2) ? 'pu-anim-new' : '';
    html += `<span class="leben-herz ${animClass}" style="color: #3498db;">&hearts;</span>`;
  }

  if (state.p2.leben < prevLebenP2) {
    let lostCount = prevLebenP2 - state.p2.leben;
    for (let i = 0; i < lostCount; i++) {
      lostHtml += `<span class="leben-herz pu-anim-lost" style="color: #3498db;">&hearts;</span>`;
    }
  }

  dom.lebenAnzeigeP2.innerHTML = html + lostHtml;

  if (lostHtml) {
    setTimeout(() => {
      const elements = dom.lebenAnzeigeP2.querySelectorAll('.pu-anim-lost');
      elements.forEach(el => el.remove());
    }, 1000);
  }

  prevLebenP2 = state.p2.leben;
}

export function updateMaxEnergieMarkerP2() {
  if (dom.maxEnergieMarkerP2 && state.p2) {
    dom.maxEnergieMarkerP2.style.left = (state.p2.maxEnergie / state.p2.absMaxEnergie * 100) + '%';
  }
}

let prevPuStateP2 = null;

export function updateAktivePowerupsP2UI() {
  if (!state.p2 || !dom.aktivePowerupsContainerP2) return;
  if (!prevPuStateP2) {
    prevPuStateP2 = { ...state.p2 };
  }

  let html = '';
  let lostHtml = '';

  function buildIconP2(key, currentVal, threshold, textPrefix, isBool, bgRgba, colorFunc) {
    let prevVal = prevPuStateP2[key];
    let animClass = '';
    let isCurrentActive = isBool ? currentVal : currentVal > threshold;
    let isPrevActive = isBool ? prevVal : prevVal > threshold;

    if (isCurrentActive) {
      if (!isPrevActive) animClass = 'pu-anim-new';
      else if (!isBool && currentVal > prevVal) animClass = 'pu-anim-upgrade';
      else if (!isBool && currentVal < prevVal) animClass = 'pu-anim-downgrade';

      let displayVal = isBool ? '' : currentVal;
      let color = typeof colorFunc === 'function' ? colorFunc(currentVal) : colorFunc;
      html += `<div class="active-pu-icon ${animClass}" style="background:${bgRgba}; border:1px solid ${color}; color:${color};">${textPrefix}${displayVal}</div>`;
    } else if (isPrevActive) {
      let displayVal = isBool ? '' : prevVal;
      let color = typeof colorFunc === 'function' ? colorFunc(prevVal) : colorFunc;
      lostHtml += `<div class="active-pu-icon pu-anim-lost" style="background:${bgRgba}; border:1px solid ${color}; color:${color};">${textPrefix}${displayVal}</div>`;
    }
  }

  buildIconP2('laserStufe', state.p2.laserStufe, 1, 'L', false, 'rgba(155,89,182,0.2)', val => val === 5 ? '#e056fd' : '#9b59b6');
  buildIconP2('raketenStufe', state.p2.raketenStufe, 1, 'R', false, 'rgba(230,126,34,0.2)', val => val === 5 ? '#f39c12' : '#e67e22');
  buildIconP2('bombenStufe', state.p2.bombenStufe, 1, 'B', false, 'rgba(192,57,43,0.2)', val => val === 5 ? '#e74c3c' : '#c0392b');
  buildIconP2('laserDurchschlag', state.p2.laserDurchschlag, false, '&uarr;', true, 'rgba(0,255,255,0.2)', '#00ffff');
  if (state.p2.schildStufe > 0) {
    buildIconP2('schildStufe', state.p2.schildStufe, 0, 'O', false, 'rgba(52,152,219,0.2)', '#3498db');
  } else if (state.p2.selectedShipModel === 'phantom' && (state.p2.phantomSchildRegenTimer || 0) > 0) {
    const maxTimer = state.p2.phantomSchildRegenMax || 900;
    const progress = Math.min(1, Math.max(0, state.p2.phantomSchildRegenTimer / maxTimer));
    const deg = Math.round(progress * 360);
    html += `<div class="active-pu-icon pu-recharging-shield" style="background: conic-gradient(#3498db ${deg}deg, rgba(52,152,219,0.15) 0deg); border:1px solid #3498db; color:#3498db;" title="Schild Stufe 1 lädt auf (${Math.round(progress * 100)}%)">O1</div>`;
  } else {
    buildIconP2('schildStufe', state.p2.schildStufe, 0, 'O', false, 'rgba(52,152,219,0.2)', '#3498db');
  }
  buildIconP2('autolaserAktiv', state.p2.autolaserAktiv, false, 'A', true, 'rgba(230,126,34,0.2)', '#e67e22');

  dom.aktivePowerupsContainerP2.innerHTML = html + lostHtml;

  if (lostHtml) {
    setTimeout(() => {
      const elements = dom.aktivePowerupsContainerP2.querySelectorAll('.pu-anim-lost');
      elements.forEach(el => el.remove());
    }, 1000);
  }

  prevPuStateP2.laserStufe = state.p2.laserStufe;
  prevPuStateP2.raketenStufe = state.p2.raketenStufe;
  prevPuStateP2.bombenStufe = state.p2.bombenStufe;
  prevPuStateP2.laserDurchschlag = state.p2.laserDurchschlag;
  prevPuStateP2.schildStufe = state.p2.schildStufe;
  prevPuStateP2.autolaserAktiv = state.p2.autolaserAktiv;

  updateRaketenWerferVisuals();
  updateSplitterUI();
}

export function updateSplitterUI() {
  const hud = dom.splitterHudP1 || document.getElementById('splitter-hud-p1');
  const rotEl = dom.splitterRotCountP1 || document.getElementById('splitter-rot-count');
  const weissEl = dom.splitterWeissCountP1 || document.getElementById('splitter-weiss-count');
  if (!hud) return;
  if (state.selectedShipModel === 'viper') {
    hud.style.display = 'flex';
    if (rotEl) rotEl.textContent = state.splitterRot || 0;
    if (weissEl) weissEl.textContent = state.splitterWeiss || 0;
  } else {
    hud.style.display = 'none';
  }
}

export function updateSplitterP2UI() {
  const hud = dom.splitterHudP2 || document.getElementById('splitter-hud-p2');
  const rotEl = dom.splitterRotCountP2 || document.getElementById('splitter-rot-count-p2');
  const weissEl = dom.splitterWeissCountP2 || document.getElementById('splitter-weiss-count-p2');
  if (!hud || !state.p2) return;
  if (isCoopMode() && state.p2.selectedShipModel === 'viper') {
    hud.style.display = 'flex';
    if (rotEl) rotEl.textContent = state.p2.splitterRot || 0;
    if (weissEl) weissEl.textContent = state.p2.splitterWeiss || 0;
  } else {
    hud.style.display = 'none';
  }
}

export function updateP2UI() {
  updateLebenP2UI();
  updateMaxEnergieMarkerP2();
  updateAktivePowerupsP2UI();
  updateSplitterP2UI();
}
export function zerstoereZiel(ziel, killer = 'p1') {
  let fIndex = arrays.feinde.indexOf(ziel);
  let aIndex = arrays.asteroiden.indexOf(ziel);
  let bIndex = arrays.bosses.indexOf(ziel);
  if (fIndex === -1 && aIndex === -1 && bIndex === -1) return;

  // Boss Logik beim Zerstören
  if (ziel.istBoss) {
    Audio.playExplosion('boss');
    addScore(1000 * state.level);
    erzeugeExplosion(ziel.x + ziel.groesse / 2, ziel.y + ziel.groesse / 2, '#f1c40f', 50);
    if (state.gameMode === 'online') {
      Network.sendNetworkEvent({
        type: 'target_destroyed',
        x: ziel.x + ziel.groesse / 2,
        y: ziel.y + ziel.groesse / 2,
        farbe: '#f1c40f',
        anzahl: 50,
        soundType: 'boss'
      });
    }

    // Co-op Revive bei Boss-Sieg
    if (isCoopMode()) {
      if (state.isDead) {
        state.isDead = false;
        state.leben = 1;
        state.energie = state.maxEnergie / 2;
        state.invulnerableTimer = 180;
        if (dom.spieler) {
          dom.spieler.style.display = 'block';
          dom.spieler.classList.add('spieler-blink');
        }
        updateLebenUI();
      }
      if (state.p2 && state.p2.isDead) {
        state.p2.isDead = false;
        state.p2.leben = 1;
        state.p2.energie = state.p2.maxEnergie / 2;
        state.p2.invulnerableTimer = 180;
        if (dom.spieler2) {
          dom.spieler2.style.display = 'block';
          dom.spieler2.classList.add('spieler-blink');
        }
        updateLebenP2UI();
      }
    }

    // 3 Belohnungen fallen lassen (1 Waffe + 2 zufällige verschiedene)
    const moeglicheDrops = ['leben', 'energie', 'durchschlag', 'schild'];
    let drops = ['superWaffe']; // Super-Waffe ist immer garantiert beim Boss
    let randomIndex = Math.floor(Math.random() * moeglicheDrops.length);
    drops.push(moeglicheDrops.splice(randomIndex, 1)[0]); // Typ entfernen, damit er nicht doppelt kommt
    randomIndex = Math.floor(Math.random() * moeglicheDrops.length);
    drops.push(moeglicheDrops[randomIndex]);

    drops.forEach((d, i) => {
      Entities.erzeugePowerup(ziel.x + i * 25, ziel.y, d);
    });

    // 3 garantierte Splitter fallen lassen (Rot oder Weiß)
    for (let s = 0; s < 3; s++) {
      const shardType = Math.random() < 0.5 ? 'splitterRot' : 'splitterWeiss';
      const shardOwner = isCoopMode() ? killer : null;
      Entities.erzeugePowerup(ziel.x + s * 25 + 12, ziel.y + 30, shardType, shardOwner);
    }

    state.bossAktiv = false;
    state.level++;
    updateLevelUI();
    dom.bossHpContainer.style.display = 'none';
    state.frameZaehler = 0; // Setzt Level-Timer zurück
  } else {
    Audio.playExplosion(ziel.groesse >= 35 ? 'medium' : 'small');
    addScore(ziel.istFeind ? 100 : ziel.traegtPowerup ? 50 : ziel.groesse >= 35 ? 20 : 10);
    if (ziel.istFeind) {
      const killerShipModel = killer === 'p2' ? (state.p2 && state.p2.selectedShipModel) : state.selectedShipModel;
      const currentShip = shipModels && shipModels[killerShipModel || 'viper'];
      const energyGain = (currentShip && currentShip.energyPerKill) || 0;
      if (energyGain > 0) {
        if (killer === 'p2' && state.p2) {
          state.p2.energie = Math.min(state.p2.maxEnergie, state.p2.energie + energyGain);
          if (dom.energieBalkenP2) dom.energieBalkenP2.style.width = state.p2.energie / state.p2.absMaxEnergie * 100 + '%';
        } else {
          state.energie = Math.min(state.maxEnergie, state.energie + energyGain);
          if (dom.energieBalken) dom.energieBalken.style.width = state.energie / state.absMaxEnergie * 100 + '%';
        }
      }
      if (killerShipModel === 'viper') {
        const killerState = (killer === 'p2' && state.p2) ? state.p2 : state;
        killerState.viperKillCount = (killerState.viperKillCount || 0) + 1;
        if (killerState.viperKillCount % 10 === 0) {
          const shardType = Math.random() < 0.5 ? 'splitterRot' : 'splitterWeiss';
          const owner = isCoopMode() ? killer : null;
          Entities.erzeugePowerup(ziel.x + ziel.groesse / 2 - 10, ziel.y + ziel.groesse / 2 - 10, shardType, owner);
        }
      }
    }
    let farbe = ziel.istFeind ? '#9b59b6' : ziel.el.dataset.baseColor || ziel.el.style.backgroundColor || '#ffffff';
    erzeugeExplosion(ziel.x + ziel.groesse / 2, ziel.y + ziel.groesse / 2, farbe, 25);
    if (state.gameMode === 'online') {
      Network.sendNetworkEvent({
        type: 'target_destroyed',
        x: ziel.x + ziel.groesse / 2,
        y: ziel.y + ziel.groesse / 2,
        farbe: farbe,
        anzahl: 25,
        soundType: ziel.groesse >= 35 ? 'medium' : 'small'
      });
    }
    if (ziel.traegtPowerup) {
      Entities.erzeugePowerup(ziel.x + ziel.groesse / 2 - 12, ziel.y + ziel.groesse / 2 - 12);
    } else if (!ziel.istFeind && ziel.groesse >= 35) {
      let neueGroesse = ziel.groesse * 0.6;
      Entities.erzeugeAsteroid(ziel.x, ziel.y, neueGroesse, -3, ziel.vy, 15, true);
      Entities.erzeugeAsteroid(ziel.x + ziel.groesse - neueGroesse, ziel.y, neueGroesse, 3, ziel.vy, 15, true);
      erzeugeExplosion(ziel.x + ziel.groesse / 2, ziel.y + ziel.groesse / 2, farbe, 20); // Extra split particles
    }
  }
  ziel.el.remove();
  if (fIndex > -1) arrays.feinde.splice(fIndex, 1);
  if (aIndex > -1) arrays.asteroiden.splice(aIndex, 1);
  if (bIndex > -1) arrays.bosses.splice(bIndex, 1);
}

export function triggerGameOver(finalScoreFromHost = null) {
  Audio.playGameOver();
  state.gameOverAktiv = true;
  state.finalerScore = finalScoreFromHost !== null ? finalScoreFromHost : (state.cheatUsed ? 0 : state.score);
  
  state.onlineHighscoreNames = { p1: null, p2: null };

  const startScreen = document.getElementById('start-screen');
  if (startScreen) startScreen.style.display = 'none';

  const finalScoreEl = document.getElementById('final-score');
  if (finalScoreEl) finalScoreEl.innerText = state.finalerScore;
  const gameOverScreen = document.getElementById('game-over-screen');
  if (gameOverScreen) gameOverScreen.style.display = 'flex';
  
  const isOnline = state.gameMode === 'online' || (state.network && state.network.isOnline);
  const isCoop = state.gameMode === 'coop';
  const currentMode = isOnline ? 'online' : (isCoop ? 'coop_bot' : 'single');

  if (isOnline && state.network && state.network.isHost && finalScoreFromHost === null) {
    Network.sendNetworkEvent({
      type: 'game_over',
      finalScore: state.finalerScore
    });
  }

  let hs = getHighscores(currentMode);
  const hsInput = document.getElementById('highscore-name');
  const hsBtn = document.getElementById('btn-save-score');
  const waitingMsg = document.getElementById('highscore-waiting-msg');
  if (waitingMsg) {
    waitingMsg.style.display = 'none';
    waitingMsg.textContent = '';
  }
  if (hsBtn) {
    hsBtn.disabled = false;
    hsBtn.textContent = 'SPEICHERN';
  }

  if (hsInput) {
    hsInput.disabled = false;
    if (isOnline) {
      hsInput.placeholder = (state.network && state.network.isHost) ? 'P1' : 'P2';
      hsInput.maxLength = 3;
    } else if (isCoop) {
      hsInput.placeholder = 'TEAM';
      hsInput.maxLength = 6;
    } else {
      hsInput.placeholder = 'AAA';
      hsInput.maxLength = 3;
    }
  }

  if (hs.length < 10 || state.finalerScore > hs[hs.length - 1].score) {
    const hsForm = document.getElementById('highscore-form');
    if (hsForm) hsForm.style.display = 'block';
    if (hsInput) {
      hsInput.value = '';
      setTimeout(() => {
        hsInput.focus();
      }, 50);
    }
  } else {
    const hsForm = document.getElementById('highscore-form');
    if (hsForm) hsForm.style.display = 'none';
  }
  renderHighscores(currentMode);
  updateMobileControlsVisibility();
}

export function spielerGetroffen(kollisionsObjekt, explodiert = true, targetPlayer = 'p1') {
  if (targetPlayer === 'p1') {
    if (state.godMode || state.invulnerableTimer > 0 || state.isDead) return;
    
    Audio.playHit('player');
    state.invulnerableTimer = 45;
    if (dom.spieler) dom.spieler.classList.add('spieler-blink');

    if (state.schildStufe > 0) {
      if (dom.spieler) dom.spieler.classList.remove(`schild-aktiv-${state.schildStufe}`);
      state.schildStufe--;
      if (state.schildStufe > 0 && dom.spieler) dom.spieler.classList.add(`schild-aktiv-${state.schildStufe}`);
      if (state.schildStufe === 0 && state.selectedShipModel === 'phantom') {
        state.phantomSchildRegenTimer = 0;
      }
      updateAktivePowerupsUI();
      if (explodiert && kollisionsObjekt) {
        let c = kollisionsObjekt.istFeind ? '#9b59b6' : (kollisionsObjekt.el?.dataset?.baseColor || kollisionsObjekt.el?.style?.backgroundColor || '#7f8c8d');
        erzeugeExplosion(kollisionsObjekt.x + (kollisionsObjekt.groesse || 4) / 2, kollisionsObjekt.y + (kollisionsObjekt.groesse || 15) / 2, c, 10);
      }
      addScore(10);
      dom.spielfeld.style.backgroundColor = 'rgba(52, 152, 219, 0.3)';
      setTimeout(() => {
        dom.spielfeld.style.backgroundColor = '#0b1319';
      }, 150);
      return;
    }
    state.leben--;
    if (state.selectedShipModel === 'phantom') {
      state.phantomSchildRegenTimer = 0;
      updateAktivePowerupsUI();
    }
    const currentShip = shipModels && shipModels[state.selectedShipModel || 'viper'];
    if (!currentShip || currentShip.loseUpgradesOnHit) {
      let moeglicheDowngrades = [];
      if (state.laserStufe > 1) moeglicheDowngrades.push('laser');
      if (state.raketenStufe > 1) moeglicheDowngrades.push('raketen');
      if (state.bombenStufe > 1) moeglicheDowngrades.push('bomben');
      if (moeglicheDowngrades.length > 0) {
        let wahl = moeglicheDowngrades[Math.floor(Math.random() * moeglicheDowngrades.length)];
        if (wahl === 'laser') state.laserStufe--;
        else if (wahl === 'raketen') state.raketenStufe--;
        else if (wahl === 'bomben') state.bombenStufe--;
      }
    }
    updateLebenUI();
    updateAktivePowerupsUI();
    dom.spielfeld.style.backgroundColor = '#900';
    setTimeout(() => {
      dom.spielfeld.style.backgroundColor = '#0b1319';
    }, 150);
    if (explodiert && kollisionsObjekt && !kollisionsObjekt.istBoss) {
      let c = kollisionsObjekt.istFeind ? '#9b59b6' : (kollisionsObjekt.el?.dataset?.baseColor || kollisionsObjekt.el?.style?.backgroundColor || '#7f8c8d');
      erzeugeExplosion(kollisionsObjekt.x + (kollisionsObjekt.groesse || 4) / 2, kollisionsObjekt.y + (kollisionsObjekt.groesse || 15) / 2, c, 10);
    }
    if (state.leben <= 0) {
      state.isDead = true;
      if (dom.spieler) dom.spieler.style.display = 'none';
      erzeugeExplosion(state.x + 15, state.y + 15, '#e74c3c', 40);

      const isOtherAlive = isCoopMode() && state.p2 && !state.p2.isDead && state.p2.leben > 0;
      if (!isOtherAlive) {
        triggerGameOver();
      }
    }
  } else if (targetPlayer === 'p2' && isCoopMode() && state.p2) {
    if (state.godMode || state.p2.invulnerableTimer > 0 || state.p2.isDead) return;
    
    Audio.playHit('player');
    state.p2.invulnerableTimer = 45;
    if (dom.spieler2) dom.spieler2.classList.add('spieler-blink');

    const isOnline = state.gameMode === 'online' || (state.network && state.network.isOnline);

    if (state.p2.schildStufe > 0) {
      if (dom.spieler2) dom.spieler2.classList.remove(`schild-aktiv-${state.p2.schildStufe}`);
      state.p2.schildStufe--;
      if (state.p2.schildStufe > 0 && dom.spieler2) dom.spieler2.classList.add(`schild-aktiv-${state.p2.schildStufe}`);
      if (state.p2.schildStufe === 0 && state.p2.selectedShipModel === 'phantom') {
        state.p2.phantomSchildRegenTimer = 0;
      }
      updateAktivePowerupsP2UI();
      if (explodiert && kollisionsObjekt) {
        let c = kollisionsObjekt.istFeind ? '#9b59b6' : (kollisionsObjekt.el?.dataset?.baseColor || kollisionsObjekt.el?.style?.backgroundColor || '#7f8c8d');
        erzeugeExplosion(kollisionsObjekt.x + (kollisionsObjekt.groesse || 4) / 2, kollisionsObjekt.y + (kollisionsObjekt.groesse || 15) / 2, c, 10);
      }
      addScore(10);
      if (!isOnline) {
        dom.spielfeld.style.backgroundColor = 'rgba(52, 152, 219, 0.3)';
        setTimeout(() => {
          dom.spielfeld.style.backgroundColor = '#0b1319';
        }, 150);
      } else {
        Network.sendNetworkEvent({ type: 'player_hit', target: 'p2', shield: true });
      }
      return;
    }
    state.p2.leben--;
    if (state.p2.selectedShipModel === 'phantom') {
      state.p2.phantomSchildRegenTimer = 0;
      updateAktivePowerupsP2UI();
    }
    const p2Ship = shipModels && shipModels[state.p2.selectedShipModel || 'phantom'];
    if (!p2Ship || p2Ship.loseUpgradesOnHit) {
      let moeglicheDowngrades = [];
      if (state.p2.laserStufe > 1) moeglicheDowngrades.push('laser');
      if (state.p2.raketenStufe > 1) moeglicheDowngrades.push('raketen');
      if (state.p2.bombenStufe > 1) moeglicheDowngrades.push('bomben');
      if (moeglicheDowngrades.length > 0) {
        let wahl = moeglicheDowngrades[Math.floor(Math.random() * moeglicheDowngrades.length)];
        if (wahl === 'laser') state.p2.laserStufe--;
        else if (wahl === 'raketen') state.p2.raketenStufe--;
        else if (wahl === 'bomben') state.p2.bombenStufe--;
      }
    }
    updateLebenP2UI();
    updateAktivePowerupsP2UI();
    if (!isOnline) {
      dom.spielfeld.style.backgroundColor = '#900';
      setTimeout(() => {
        dom.spielfeld.style.backgroundColor = '#0b1319';
      }, 150);
    } else {
      Network.sendNetworkEvent({ type: 'player_hit', target: 'p2', shield: false });
    }
    if (explodiert && kollisionsObjekt && !kollisionsObjekt.istBoss) {
      let c = kollisionsObjekt.istFeind ? '#9b59b6' : (kollisionsObjekt.el?.dataset?.baseColor || kollisionsObjekt.el?.style?.backgroundColor || '#7f8c8d');
      erzeugeExplosion(kollisionsObjekt.x + (kollisionsObjekt.groesse || 4) / 2, kollisionsObjekt.y + (kollisionsObjekt.groesse || 15) / 2, c, 10);
    }
    if (state.p2.leben <= 0) {
      state.p2.isDead = true;
      if (dom.spieler2) dom.spieler2.style.display = 'none';
      erzeugeExplosion(state.p2.x + 15, state.p2.y + 15, '#3498db', 40);

      const isOtherAlive = !state.isDead && state.leben > 0;
      if (!isOtherAlive) {
        triggerGameOver();
      }
    }
  }
}
export function updateMobileControlsVisibility() {
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const mobileControls = document.getElementById('mobile-controls');
  if (mobileControls) {
    if (state.spielLaeuft && !state.gameOverAktiv && isTouchDevice) {
      mobileControls.style.display = 'flex';
    } else {
      mobileControls.style.display = 'none';
    }
    if (typeof window.resizeGame === 'function') {
      window.resizeGame();
    }
  }
}

export function restartGame() {
  state.gameOverAktiv = false;
  document.getElementById('game-over-screen').style.display = 'none';
  state.leben = 3;
  state.maxEnergie = 50;
  state.energie = state.maxEnergie;
  state.laserStufe = 1;
  state.raketenStufe = 1;
  state.bombenStufe = 1;
  state.cheatUsed = false;
  state.godMode = false;
  state.unbegrenzteEnergie = false;
  dom.maxEnergieMarker.style.display = 'block';
  state.laserDurchschlag = false;
  state.durchschlagTimer = 0;
  state.phantomSchildRegenTimer = 0;
  const currentShip = shipModels && shipModels[state.selectedShipModel || 'viper'];
  state.schildStufe = (currentShip && currentShip.startShield) || 0;
  dom.spieler.classList.remove('schild-aktiv-1', 'schild-aktiv-2', 'schild-aktiv-3');
  if (state.schildStufe > 0) {
    dom.spieler.classList.add(`schild-aktiv-${state.schildStufe}`);
  }
  state.score = 0;
  addScore(0);
  state.level = 1;
  state.splitterRot = 0;
  state.splitterWeiss = 0;
  state.viperKillCount = 0;
  state.isDead = false;
  Bot.resetBot();
  updateLebenUI();
  updateMaxEnergieMarker();
  updateAktivePowerupsUI();
  updateSplitterUI();
  updateLevelUI();
  state.x = 185;
  state.y = 285;
  dom.spieler.style.left = state.x + 'px';
  dom.spieler.style.top = state.y + 'px';
  dom.spieler.style.display = 'none';
  dom.spieler.setAttribute('data-rotate', '0');
  dom.spieler.style.transform = 'rotate(0deg)';

  if (state.p2) {
    state.p2.leben = 3;
    state.p2.maxEnergie = 50;
    state.p2.energie = 50;
    state.p2.splitterRot = 0;
    state.p2.splitterWeiss = 0;
    state.p2.viperKillCount = 0;
    state.p2.laserStufe = 1;
    state.p2.raketenStufe = 1;
    state.p2.bombenStufe = 1;
    state.p2.laserDurchschlag = false;
    state.p2.durchschlagTimer = 0;
    state.p2.phantomSchildRegenTimer = 0;
    state.p2.autolaserAktiv = false;
    state.p2.autolaserTimer = 0;
    state.p2.raketenCooldown = 0;
    state.p2.bombenCooldown = 0;
    state.p2.spielerSchussCooldown = 0;
    state.p2.invulnerableTimer = 0;
    state.p2.isDead = false;
    const p2Ship = shipModels && shipModels[state.p2.selectedShipModel || 'phantom'];
    state.p2.schildStufe = (p2Ship && p2Ship.startShield) || 0;
    if (dom.spieler2) {
      dom.spieler2.classList.remove('schild-aktiv-1', 'schild-aktiv-2', 'schild-aktiv-3');
      if (state.p2.schildStufe > 0) dom.spieler2.classList.add(`schild-aktiv-${state.p2.schildStufe}`);
      state.p2.x = 370;
      state.p2.y = 285;
      dom.spieler2.style.left = state.p2.x + 'px';
      dom.spieler2.style.top = state.p2.y + 'px';
      dom.spieler2.style.display = 'none';
      dom.spieler2.setAttribute('data-rotate', '0');
      dom.spieler2.style.transform = 'rotate(0deg)';
    }
    updateP2UI();
  }
  
  const clearArray = (arr) => {
    if (arr) {
      arr.forEach(item => { if (item && item.el) item.el.remove(); });
      arr.length = 0;
    }
  };
  
  clearArray(arrays.asteroiden);
  clearArray(arrays.feinde);
  clearArray(arrays.feindLaserArray);
  clearArray(arrays.bosses);
  clearArray(arrays.bossLaserArray);
  clearArray(arrays.bossBombenArray);
  clearArray(arrays.bossRaketenArray);
  clearArray(arrays.powerups);
  clearArray(arrays.partikelArray);
  clearArray(arrays.laserArray);
  clearArray(arrays.raketenArray);
  clearArray(arrays.bombenArray);
  clearArray(arrays.explosionenArray);

  // Verwaiste Spiel-Entitäten und Projektile aus dem DOM entfernen
  const orphanSelectors = '.boss-rakete, .boss-bombe, .boss-laser, .feind-laser, .laser, .rakete, .bombe, .powerup, .feind, .asteroid, .boss, .partikel, .werfer-abgeworfen, .shockwave, .schockwelle, .cutscene-fireball, .cutscene-shockwave, .cutscene-debris, .tractor-beam-svg';
  if (dom.spielfeld) {
    dom.spielfeld.querySelectorAll(orphanSelectors).forEach(el => el.remove());
  }

  state.bossAktiv = false;
  state.bossWarningAktiv = false;
  state.bossWarningTimer = 0;
  dom.warningOverlay.style.display = 'none';
  dom.bossHpContainer.style.display = 'none';
  
  state.pausiert = false;
  dom.pauseOverlay.style.display = 'none';
  
  state.bossKampfAktiv = false;
  state.autolaserAktiv = false;
  dom.autolaserEl.style.display = 'none';
  
  state.spielerSchussCooldown = 0;
  state.raketenCooldown = 0;
  state.bombenCooldown = 0;
  
  state.frameZaehler = 0;
  state.spielLaeuft = false;
  state.cutsceneAktiv = false;

  const cutsceneContainer = document.getElementById('cutscene-container');
  if (cutsceneContainer) {
    cutsceneContainer.innerHTML = '';
    cutsceneContainer.style.display = 'none';
  }
  
  for (let key in state.tastenGedrueckt) {
    state.tastenGedrueckt[key] = false;
  }
  
  let startScreen = document.getElementById('start-screen');
  if (startScreen) startScreen.style.display = 'block';
  updatePlayerShipVisuals();
  updateMobileControlsVisibility();
  if (state.gameMode === 'online') {
    Network.updateOnlineLobbyUI();
  }
}
// --- HIGHSCORE LOGIK ---
const SECRET_SALT = 'st4r-sh00t3r-s3cr3t-k3y-2026';

export function getCountryFlagEmoji(countryCode) {
  if (!countryCode || typeof countryCode !== 'string' || countryCode.length !== 2) return '';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export async function generateScoreHash(name, score, level, mode, timestamp) {
  const payload = `${name}:${score}:${level}:${mode}:${timestamp}:${SECRET_SALT}`;
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return '';
}

export function normalizeHighscoreMode(mode = (state.gameMode || 'single')) {
  if (mode === 'single') return 'single';
  if (mode === 'online') return 'online';
  if (mode === 'coop_bot') return 'coop_bot';
  if (mode === 'coop') return 'coop_bot';
  return 'single';
}

export function getHighscores(mode = (state.gameMode || 'single')) {
  const normMode = normalizeHighscoreMode(mode);
  let key = 'spaceShooterHighscores';
  if (normMode === 'coop_bot') key = 'spaceShooterHighscores_bot';
  else if (normMode === 'online') key = 'spaceShooterHighscores_online';

  let hs = localStorage.getItem(key);
  if (!hs && normMode === 'coop_bot') {
    hs = localStorage.getItem('spaceShooterHighscores_coop');
  }
  return hs ? JSON.parse(hs) : [];
}

export function saveHighscore(name, scoreValue, shipModel = null, mode = (state.gameMode || 'single'), shipP2Model = null, level = null) {
  const normMode = normalizeHighscoreMode(mode);
  let hs = getHighscores(normMode);
  let modelP1 = shipModel || state.selectedShipModel || 'viper';
  let modelP2 = shipP2Model || (state.p2 && state.p2.selectedShipModel) || 'phantom';
  let currentLevel = level || state.level || 1;

  const isMulti = normMode === 'coop_bot' || normMode === 'online';

  const entry = {
    name: name.toUpperCase(),
    score: scoreValue,
    level: currentLevel,
    mode: normMode
  };

  if (isMulti) {
    entry.shipP1 = modelP1;
    entry.shipP2 = modelP2;
    entry.ship = `${modelP1}+${modelP2}`;
  } else {
    entry.ship = modelP1;
    entry.shipP1 = modelP1;
  }

  hs.push(entry);
  hs.sort((a, b) => b.score - a.score);

  let key = 'spaceShooterHighscores';
  if (normMode === 'coop_bot') key = 'spaceShooterHighscores_bot';
  else if (normMode === 'online') key = 'spaceShooterHighscores_online';

  localStorage.setItem(key, JSON.stringify(hs.slice(0, 10)));
  if (isMulti) {
    localStorage.setItem('spaceShooterHighscores_coop', JSON.stringify(hs.slice(0, 10)));
  }

  // Parallele asynchrone Übermittlung an die globale Cloudflare-API (sofern kein Cheat aktiv war)
  if (!state.cheatUsed && scoreValue > 0) {
    submitGlobalScore(normMode, name.toUpperCase(), scoreValue, currentLevel, modelP1, isMulti ? modelP2 : null);
  }
}

async function submitGlobalScore(mode, name, score, level, shipP1, shipP2) {
  try {
    const timestamp = Date.now();
    const hash = await generateScoreHash(name, score, level, mode, timestamp);
    const apiUrl = state.highscoreApiUrl || '/api/highscores';

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mode,
        name,
        score,
        level,
        shipP1,
        shipP2,
        timestamp,
        hash
      })
    });

    if (response.ok) {
      // Nach erfolgreichem Submit Cache für diesen Modus invalidieren und neu laden
      if (state.globalHighscoresCache) {
        state.globalHighscoresCache[mode] = null;
      }
      fetchGlobalHighscores(mode);
    }
  } catch (err) {
    console.warn('Global Highscore Submit fehlgeschlagen, offline Fallback aktiv:', err);
  }
}

export function renderHighscoresTable(currentMode, hsList) {
  const tbody = document.getElementById('highscore-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!hsList || hsList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">- Keine Einträge -</td></tr>';
    return;
  }

  hsList.forEach((entry, idx) => {
    const rank = idx + 1;
    let rankClass = '';
    if (rank === 1) rankClass = 'hs-rank-1';
    else if (rank === 2) rankClass = 'hs-rank-2';
    else if (rank === 3) rankClass = 'hs-rank-3';

    const rankBadge = `<span class="hs-rank ${rankClass}">#${rank}</span>`;

    // Flaggen-Emoji und Stadt
    let locDisplay = '';
    if (entry.country) {
      const flag = getCountryFlagEmoji(entry.country);
      const title = entry.city ? `${entry.city}, ${entry.country}` : entry.country;
      locDisplay = `<span class="hs-location" title="${title}">${flag}</span>`;
    }

    const isMulti = currentMode === 'coop_bot' || currentMode === 'online';

    if (isMulti) {
      const p1Phantom = entry.shipP1 === 'phantom';
      const p2Phantom = entry.shipP2 === 'phantom';
      const p1Badge = `<span class="hs-ship-badge hs-badge-mini ${p1Phantom ? 'hs-ship-phantom' : 'hs-ship-viper'}" title="P1: ${p1Phantom ? 'Phantom-NX' : 'Viper-X'}">P1:${p1Phantom ? 'P' : 'V'}</span>`;
      const p2Badge = `<span class="hs-ship-badge hs-badge-mini ${p2Phantom ? 'hs-ship-phantom' : 'hs-ship-viper'}" title="P2: ${p2Phantom ? 'Phantom-NX' : 'Viper-X'}">P2:${p2Phantom ? 'P' : 'V'}</span>`;
      tbody.innerHTML += `<tr><td>${rankBadge}</td><td>${entry.name}${locDisplay}</td><td>${entry.score}</td><td><div class="hs-coop-badges">${p1Badge} ${p2Badge}</div></td></tr>`;
    } else {
      const isPhantom = entry.ship === 'phantom' || entry.shipP1 === 'phantom';
      const shipLabel = isPhantom ? 'Phantom-NX' : 'Viper-X';
      const badgeClass = isPhantom ? 'hs-ship-phantom' : 'hs-ship-viper';
      tbody.innerHTML += `<tr><td>${rankBadge}</td><td>${entry.name}${locDisplay}</td><td>${entry.score}</td><td><span class="hs-ship-badge ${badgeClass}">${shipLabel}</span></td></tr>`;
    }
  });
}

export async function fetchGlobalHighscores(mode) {
  const normMode = normalizeHighscoreMode(mode);
  const statusText = document.getElementById('highscore-status-text');
  const spinner = document.getElementById('highscore-spinner');

  if (spinner) spinner.style.display = 'inline-block';
  if (statusText) statusText.innerText = '🌐 BESTENLISTE WIRD GELADEN...';

  try {
    const apiUrl = state.highscoreApiUrl || '/api/highscores';
    const res = await fetch(`${apiUrl}?mode=${normMode}&limit=10`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data && data.success && Array.isArray(data.highscores)) {
      if (!state.globalHighscoresCache) state.globalHighscoresCache = {};
      state.globalHighscoresCache[normMode] = data.highscores;
      state.highscoreError = false;

      if (statusText) statusText.innerText = '🌐 GLOBALE BESTENLISTE';
      if (spinner) spinner.style.display = 'none';

      // Nur rendern, wenn der Tab noch der aktuelle ist
      if (state.currentHighscoreTab === normMode) {
        renderHighscoresTable(normMode, data.highscores);
      }
      return data.highscores;
    } else {
      throw new Error(data ? data.error : 'Fehler beim Laden');
    }
  } catch (err) {
    state.highscoreError = true;
    if (statusText) statusText.innerText = '💾 LOKALE BESTENLISTE (Offline)';
    if (spinner) spinner.style.display = 'none';

    const localHs = getHighscores(normMode);
    if (state.currentHighscoreTab === normMode) {
      renderHighscoresTable(normMode, localHs);
    }
    return localHs;
  }
}

export function renderHighscores(targetMode = null) {
  const normMode = normalizeHighscoreMode(targetMode || state.currentHighscoreTab || state.gameMode || 'single');
  state.currentHighscoreTab = normMode;

  // Highscore-Tabs aktualisieren
  const tabSingle = document.getElementById('hs-tab-single');
  const tabBot = document.getElementById('hs-tab-bot');
  const tabOnline = document.getElementById('hs-tab-online');

  if (tabSingle) tabSingle.classList.toggle('active', normMode === 'single');
  if (tabBot) tabBot.classList.toggle('active', normMode === 'coop_bot');
  if (tabOnline) tabOnline.classList.toggle('active', normMode === 'online');

  // Header-Spalte anpassen (SCHIFF vs SCHIFFE)
  const colHeaderShip = document.getElementById('hs-col-ship');
  if (colHeaderShip) {
    colHeaderShip.innerText = (normMode === 'single') ? 'SCHIFF' : 'SCHIFFE';
  }

  // Zuerst gecachte globale Scores oder lokale Scores sofort anzeigen
  if (state.globalHighscoresCache && state.globalHighscoresCache[normMode]) {
    const statusText = document.getElementById('highscore-status-text');
    const spinner = document.getElementById('highscore-spinner');
    if (statusText) statusText.innerText = '🌐 GLOBALE BESTENLISTE';
    if (spinner) spinner.style.display = 'none';
    renderHighscoresTable(normMode, state.globalHighscoresCache[normMode]);
  } else {
    // Lokale Scores sofort anzeigen und asynchron laden
    const localHs = getHighscores(normMode);
    renderHighscoresTable(normMode, localHs);
    fetchGlobalHighscores(normMode);
  }
}

export function submitHighscore() {
  const isOnline = state.gameMode === 'online' || (state.network && state.network.isOnline);
  const hsInput = document.getElementById('highscore-name');
  const hsBtn = document.getElementById('btn-save-score');
  let rawName = (hsInput ? hsInput.value : '').trim().toUpperCase();

  if (!isOnline) {
    let nameInput = rawName;
    const isCoop = state.gameMode === 'coop';
    if (!nameInput || nameInput === '') nameInput = (isCoop ? 'TEAM' : 'AAA');
    const mode = isCoop ? 'coop_bot' : 'single';
    saveHighscore(nameInput, state.finalerScore, state.selectedShipModel, mode, state.p2 ? state.p2.selectedShipModel : null, state.level || 1);
    const hsForm = document.getElementById('highscore-form');
    if (hsForm) hsForm.style.display = 'none';
    renderHighscores(mode);
    return;
  }

  const isHost = state.network && state.network.isHost;
  const myRole = isHost ? 'p1' : 'p2';
  const defaultName = isHost ? 'AAA' : 'BBB';
  const myName = (rawName.length > 0 ? rawName : defaultName).slice(0, 3);

  if (!state.onlineHighscoreNames) state.onlineHighscoreNames = { p1: null, p2: null };
  state.onlineHighscoreNames[myRole] = myName;

  Network.sendNetworkEvent({
    type: 'highscore_name',
    role: myRole,
    name: myName
  });

  if (hsInput) hsInput.disabled = true;
  if (hsBtn) {
    hsBtn.disabled = true;
    hsBtn.textContent = 'GESENDET';
  }

  checkAndCommitOnlineHighscore();
}

export function receiveOnlineHighscoreName(role, name) {
  if (!state.onlineHighscoreNames) state.onlineHighscoreNames = { p1: null, p2: null };
  state.onlineHighscoreNames[role] = (name || '').slice(0, 3).toUpperCase();
  checkAndCommitOnlineHighscore();
}

export function checkAndCommitOnlineHighscore() {
  const isOnline = state.gameMode === 'online' || (state.network && state.network.isOnline);
  if (!isOnline) return;

  if (!state.onlineHighscoreNames) state.onlineHighscoreNames = { p1: null, p2: null };
  const p1 = state.onlineHighscoreNames.p1;
  const p2 = state.onlineHighscoreNames.p2;

  const isHost = state.network && state.network.isHost;
  const myRole = isHost ? 'p1' : 'p2';
  const otherRole = isHost ? 'p2' : 'p1';

  const hsInput = document.getElementById('highscore-name');
  const hsBtn = document.getElementById('btn-save-score');
  const waitingMsg = document.getElementById('highscore-waiting-msg');

  if (state.onlineHighscoreNames[myRole] && !state.onlineHighscoreNames[otherRole]) {
    if (waitingMsg) {
      waitingMsg.style.display = 'block';
      waitingMsg.textContent = `Warte auf Eingabe von Spieler ${isHost ? '2' : '1'}...`;
    }
    return;
  }

  if (p1 && p2) {
    const combinedName = `${p1}+${p2}`;
    const modelP1 = state.selectedShipModel || 'viper';
    const modelP2 = (state.p2 && state.p2.selectedShipModel) || 'phantom';

    saveHighscore(combinedName, state.finalerScore, modelP1, 'online', modelP2, state.level || 1);

    const hsForm = document.getElementById('highscore-form');
    if (hsForm) hsForm.style.display = 'none';
    if (hsInput) hsInput.disabled = false;
    if (hsBtn) {
      hsBtn.disabled = false;
      hsBtn.textContent = 'SPEICHERN';
    }
    if (waitingMsg) waitingMsg.style.display = 'none';

    renderHighscores('online');
  }
}
export function erzeugeExplosion(x, y, farbe, anzahl = 15) {
  for (let i = 0; i < anzahl; i++) {
    const el = document.createElement('div');
    el.classList.add('partikel');
    el.style.backgroundColor = farbe;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    dom.spielfeld.appendChild(el);
    const winkel = Math.random() * Math.PI * 2;
    const tempo = Math.random() * 4 + 2;
    arrays.partikelArray.push({
      el: el,
      x: x,
      y: y,
      vx: Math.cos(winkel) * tempo,
      vy: Math.sin(winkel) * tempo,
      leben: 1.0,
      zerfall: Math.random() * 0.03 + 0.02
    });
  }
}
export const erzeugePartikel = erzeugeExplosion;

export function erzeugeBombenDetonation(bcx, bcy, farbe = '#f39c12', radius = 150, stufe = 1, isMini = false) {
  const spielfeld = dom.spielfeld || document.getElementById('spielfeld');
  if (!spielfeld) return;

  // 1. Partikel
  erzeugeExplosion(bcx, bcy, farbe || '#f39c12', isMini ? 35 : 60);

  // 2. Sound
  if (Audio && Audio.playExplosion) {
    Audio.playExplosion(isMini ? 'medium' : 'large');
  }

  // 3. Schockwelle
  const shockwave = document.createElement('div');
  shockwave.style.position = 'absolute';
  shockwave.style.width = (radius * 2) + 'px';
  shockwave.style.height = (radius * 2) + 'px';
  shockwave.style.left = (bcx - radius) + 'px';
  shockwave.style.top = (bcy - radius) + 'px';
  shockwave.style.borderRadius = '50%';
  shockwave.style.backgroundColor = farbe === '#00ffff' ? 'rgba(0, 255, 255, 0.4)' : (farbe === '#9b59b6' ? 'rgba(155, 89, 182, 0.4)' : (farbe === '#f1c40f' ? 'rgba(241, 196, 15, 0.45)' : 'rgba(231, 76, 60, 0.4)'));
  shockwave.style.boxShadow = `0 0 45px ${farbe || '#f39c12'}`;
  shockwave.style.zIndex = '9';
  shockwave.style.pointerEvents = 'none';
  shockwave.style.transition = 'all 0.5s ease-out';
  spielfeld.appendChild(shockwave);

  setTimeout(() => {
    shockwave.style.opacity = '0';
    shockwave.style.transform = 'scale(1.2)';
  }, 10);
  setTimeout(() => {
    shockwave.remove();
  }, 500);

  // 4. Stufe 3 Vortex: Zweite Schockwelle leicht verzögert
  if (stufe === 3 && !isMini) {
    setTimeout(() => {
      const sw2 = document.createElement('div');
      sw2.style.position = 'absolute';
      sw2.style.width = (radius * 1.5) + 'px';
      sw2.style.height = (radius * 1.5) + 'px';
      sw2.style.left = (bcx - (radius * 0.75)) + 'px';
      sw2.style.top = (bcy - (radius * 0.75)) + 'px';
      sw2.style.borderRadius = '50%';
      sw2.style.backgroundColor = 'rgba(155, 89, 182, 0.3)';
      sw2.style.boxShadow = '0 0 30px #9b59b6';
      sw2.style.zIndex = '9';
      sw2.style.pointerEvents = 'none';
      sw2.style.transition = 'all 0.4s ease-out';
      spielfeld.appendChild(sw2);
      setTimeout(() => {
        sw2.style.opacity = '0';
        sw2.style.transform = 'scale(1.3)';
      }, 10);
      setTimeout(() => sw2.remove(), 400);
    }, 150);
  }
}

export function erzeugeRaketenDetonation(rcx, rcy, radius = 70) {
  const spielfeld = dom.spielfeld || document.getElementById('spielfeld');
  if (!spielfeld) return;

  if (Audio && Audio.playMissileExplosion) {
    Audio.playMissileExplosion();
  }
  erzeugeExplosion(rcx, rcy, '#e67e22', 25);
  erzeugeExplosion(rcx, rcy, '#f1c40f', 15);

  const shockwave = document.createElement('div');
  shockwave.classList.add('schockwelle');
  shockwave.style.width = (radius * 2) + 'px';
  shockwave.style.height = (radius * 2) + 'px';
  shockwave.style.left = (rcx - radius) + 'px';
  shockwave.style.top = (rcy - radius) + 'px';
  shockwave.style.borderRadius = '50%';
  shockwave.style.backgroundColor = 'rgba(231, 76, 60, 0.4)';
  shockwave.style.boxShadow = '0 0 20px #e74c3c';
  shockwave.style.zIndex = '9';
  shockwave.style.pointerEvents = 'none';
  shockwave.style.transition = 'all 0.3s ease-out';
  spielfeld.appendChild(shockwave);

  setTimeout(() => {
    shockwave.style.opacity = '0';
    shockwave.style.transform = 'scale(1.2)';
  }, 10);
  setTimeout(() => shockwave.remove(), 300);
}
export function erzeugeRauchFunken(x, y, groesse) {
  // Rauch
  if (Math.random() < 0.5) {
    const el = document.createElement('div');
    el.classList.add('partikel');
    el.style.backgroundColor = '#555';
    el.style.width = '6px';
    el.style.height = '6px';
    el.style.left = x + Math.random() * groesse + 'px';
    el.style.top = y + Math.random() * groesse + 'px';
    dom.spielfeld.appendChild(el);
    arrays.partikelArray.push({
      el: el,
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      vx: (Math.random() - 0.5) * 2,
      vy: -Math.random() * 2 - 1,
      leben: 1.0,
      zerfall: 0.02
    });
  }
  // Funken
  if (Math.random() < 0.3) {
    const el = document.createElement('div');
    el.classList.add('partikel');
    el.style.backgroundColor = '#f1c40f';
    el.style.boxShadow = '0 0 5px #f1c40f';
    el.style.left = x + Math.random() * groesse + 'px';
    el.style.top = y + Math.random() * groesse + 'px';
    dom.spielfeld.appendChild(el);
    arrays.partikelArray.push({
      el: el,
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      vx: (Math.random() - 0.5) * 4,
      vy: -Math.random() * 4,
      leben: 1.0,
      zerfall: 0.05
    });
  }
}
export function erzeugeAntriebsRauch(x, y, vy = -1.5) {
  if (Math.random() < 0.6) {
    const el = document.createElement('div');
    el.classList.add('partikel');
    el.style.backgroundColor = Math.random() < 0.3 ? '#e74c3c' : '#7f8c8d';
    el.style.width = '4px';
    el.style.height = '4px';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    dom.spielfeld.appendChild(el);
    arrays.partikelArray.push({
      el: el,
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 1,
      vy: vy + (Math.random() - 0.5) * 0.5,
      leben: 1.0,
      zerfall: 0.05
    });
  }
}

// --- SCHIFFS-AUSWAHL & VISUALS ---
export function getShipSVGContent(model, colorId) {
  const c = shipColors[colorId] || shipColors.red;
  if (model === 'phantom') {
    return `
      <!-- Phantom-NX: Forward-Swept Outer Wings -->
      <path d="M15 8 L2 2 L0 18 L6 26 L10 22 L15 25 L20 22 L24 26 L30 18 L28 2 Z" fill="${c.sec}"/>
      <!-- Twin-Nose & Armored Fuselage -->
      <path d="M10 2 L10 18 L15 27 L20 18 L20 2 L17 12 L15 6 L13 12 Z" fill="${c.prim}"/>
      <!-- Twin Cockpit Visors -->
      <polygon points="11,6 13,11 11,14 9,10" fill="#87CEEB"/>
      <polygon points="19,6 17,11 19,14 21,10" fill="#87CEEB"/>
      <!-- Energy Core -->
      <polygon points="15,13 17,17 15,21 13,17" fill="${c.accent}"/>
      <!-- Thruster Nozzles -->
      <rect x="5" y="24" width="4" height="4" fill="#7f8c8d"/>
      <rect x="21" y="24" width="4" height="4" fill="#7f8c8d"/>
    `;
  }
  // Default: Viper-X Interceptor
  return `
    <!-- Viper-X: Delta Wings -->
    <path d="M15 2 L2 20 L5 25 L15 22 L25 25 L28 20 Z" fill="${c.sec}"/>
    <!-- Main Fuselage -->
    <path d="M15 0 L9 20 L15 27 L21 20 Z" fill="${c.prim}"/>
    <!-- Cockpit -->
    <path d="M15 8 L12 16 L15 19 L18 16 Z" fill="#87CEEB"/>
    <!-- Engine Nozzles -->
    <rect x="7" y="23" width="4" height="4" fill="#7f8c8d"/>
    <rect x="19" y="23" width="4" height="4" fill="#7f8c8d"/>
  `;
}

export function setGameMode(mode) {
  state.gameMode = mode;
  const isCoop = mode === 'coop';
  const isOnline = mode === 'online';
  const isMultiplayer = isCoop || isOnline;
  config.spielfeldBreite = isMultiplayer ? 600 : 400;

  const btnSingle = document.getElementById('gamemode-btn-single');
  const btnCoop = document.getElementById('gamemode-btn-coop');
  const btnOnline = document.getElementById('gamemode-btn-online');
  if (btnSingle) btnSingle.classList.toggle('active', mode === 'single');
  if (btnCoop) btnCoop.classList.toggle('active', isCoop);
  if (btnOnline) btnOnline.classList.toggle('active', isOnline);

  const spielfeld = dom.spielfeld || document.getElementById('spielfeld');
  if (spielfeld) {
    spielfeld.classList.toggle('mode-coop', isMultiplayer);
    spielfeld.style.width = config.spielfeldBreite + 'px';
  }

  const onlineLobby = document.getElementById('online-lobby-container');
  if (onlineLobby) onlineLobby.style.display = isOnline ? 'block' : 'none';

  const hangarTabs = document.getElementById('hangar-player-tabs');
  if (hangarTabs) hangarTabs.style.display = isCoop ? 'flex' : 'none';

  const infoSingle = document.getElementById('steuerung-info-single');
  const infoCoop = document.getElementById('steuerung-info-coop');
  const infoOnline = document.getElementById('steuerung-info-online');
  if (infoSingle) infoSingle.style.display = (mode === 'single') ? 'block' : 'none';
  if (infoCoop) infoCoop.style.display = isCoop ? 'block' : 'none';
  if (infoOnline) infoOnline.style.display = isOnline ? 'block' : 'none';

  const uiP2 = dom.uiContainerP2 || document.getElementById('ui-container-p2');
  if (uiP2) uiP2.style.display = (isMultiplayer && state.spielLaeuft) ? 'flex' : 'none';

  const tagP1 = document.querySelector('.tag-p1');
  if (tagP1) tagP1.style.display = isMultiplayer ? 'block' : 'none';

  const startText = document.getElementById('start-text');
  if (startText) {
    if (isOnline) {
      startText.textContent = 'RAUM ERSTELLEN ODER BEITRETEN ZUM START';
      startText.style.color = '#1abc9c';
    } else {
      startText.textContent = 'TAP OR PRESS ANY KEY TO START';
      startText.style.color = '#f1c40f';
    }
  }

  if (typeof window.resizeGame === 'function') {
    window.resizeGame();
  }

  updatePlayerShipVisuals();
  Network.updateOnlineLobbyUI();

  // Bot-State zurücksetzen wenn nicht lokaler Co-op
  if (!isCoop) {
    state.p2IsBot = false;
    const botControls = document.getElementById('p2-bot-controls');
    if (botControls) botControls.style.display = 'none';
    const btnBotToggle = document.getElementById('btn-p2-bot-toggle');
    if (btnBotToggle) {
      btnBotToggle.classList.remove('active');
      btnBotToggle.textContent = '🤖 BOT';
    }
    const diffPanel = document.getElementById('bot-difficulty-panel');
    if (diffPanel) diffPanel.style.display = 'none';
  }
}

export function updatePlayerShipVisuals() {
  const isP2Hangar = state.gameMode === 'coop' && state.activeHangarPlayer === 'p2';
  const modelP1 = state.selectedShipModel || 'viper';
  const colorIdP1 = state.selectedShipColor || 'red';
  const modelP2 = (state.p2 && state.p2.selectedShipModel) || 'phantom';
  const colorIdP2 = (state.p2 && state.p2.selectedShipColor) || 'blue';

  const activeHangarModel = isP2Hangar ? modelP2 : modelP1;
  const activeHangarColor = isP2Hangar ? colorIdP2 : colorIdP1;

  // In-Game Schiff 1 SVG aktualisieren
  const spielerSvg = dom.spieler ? dom.spieler.querySelector('svg') : document.querySelector('#spieler svg');
  if (spielerSvg) {
    spielerSvg.innerHTML = getShipSVGContent(modelP1, colorIdP1);
  }

  // In-Game Schiff 2 SVG aktualisieren
  const spieler2Svg = dom.spieler2 ? dom.spieler2.querySelector('svg') : document.querySelector('#spieler-2 svg');
  if (spieler2Svg) {
    spieler2Svg.innerHTML = getShipSVGContent(modelP2, colorIdP2);
  }

  // Hangar Preview im Startscreen aktualisieren
  const previewSvg = document.getElementById('hangar-preview-svg');
  if (previewSvg) {
    previewSvg.innerHTML = getShipSVGContent(activeHangarModel, activeHangarColor);
  }
  const previewName = document.getElementById('hangar-ship-name');
  const shipData = shipModels && shipModels[activeHangarModel];
  if (previewName) {
    previewName.textContent = (shipData && shipData.name) || (activeHangarModel === 'phantom' ? 'PHANTOM-NX STRIKER' : 'VIPER-X INTERCEPTOR');
  }

  // Hangar Perks rendern
  const perksContainer = document.getElementById('hangar-ship-perks');
  if (perksContainer && shipData && shipData.perks) {
    perksContainer.innerHTML = shipData.perks.map(p => `
      <div class="hangar-perk-badge ${p.type === 'nerf' ? 'perk-nerf' : 'perk-buff'}" title="${p.desc}">
        <span class="perk-icon">${p.icon}</span>
        <span class="perk-label">${p.label}</span>
      </div>
    `).join('');
  }

  // Active Klassen auf Hangar Tabs aktualisieren
  document.querySelectorAll('.hangar-player-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-player') === (state.activeHangarPlayer || 'p1'));
  });

  // Active Klassen auf Hangar Buttons aktualisieren
  document.querySelectorAll('.hangar-model-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-model') === activeHangarModel);
  });
  document.querySelectorAll('.hangar-color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-color') === activeHangarColor);
  });

  // Bot-Controls Sichtbarkeit
  const botControls = document.getElementById('p2-bot-controls');
  if (botControls) {
    botControls.style.display = (state.gameMode === 'coop' && isP2Hangar) ? 'block' : 'none';
  }

  updateRaketenWerferVisuals();
}

export function erzeugeAbgeworfenenWerfer(x, y, vx, vy, vRot) {
  const el = document.createElement('div');
  el.classList.add('werfer-pod', 'werfer-abgeworfen');
  el.style.position = 'absolute';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.width = '7px';
  el.style.height = '16px';
  el.style.zIndex = '6';
  el.innerHTML = `
    <div class="werfer-body" style="border-color: #e67e22; box-shadow: 0 0 8px #e67e22;">
      <div class="werfer-nozzle" style="background:#333;"></div>
      <div class="werfer-core" style="background:#e74c3c;"></div>
    </div>
  `;
  (dom.spielfeld || document.getElementById('spielfeld')).appendChild(el);

  // Kleine Funken/Rauchwolke am Abreißpunkt
  for (let i = 0; i < 3; i++) {
    erzeugeRauchFunken(x, y, 8);
  }

  arrays.partikelArray.push({
    el: el,
    x: x,
    y: y,
    vx: vx,
    vy: vy,
    rot: 0,
    vRot: vRot || (vx > 0 ? 8 : -8),
    leben: 1.0,
    zerfall: 0.02
  });
}

let prevWerferStatesP1 = null;
let prevWerferStatesP2 = null;

function updateWerferForShip(spielerEl, pState, prevKey) {
  if (!spielerEl || !pState) return;

  const model = pState.selectedShipModel || 'viper';
  const lvl = pState.raketenStufe || 1;

  const werferLinks = spielerEl.querySelector('.werfer-links');
  const werferRechts = spielerEl.querySelector('.werfer-rechts');
  const werferCenter = spielerEl.querySelector('.werfer-center');

  if (!werferLinks || !werferRechts || !werferCenter) return;

  let showLeft = false;
  let showRight = false;
  let showCenter = false;

  if (lvl <= 2) {
    if (model === 'phantom') {
      showRight = true;
    } else {
      showLeft = true;
    }
  } else if (lvl <= 4) {
    showLeft = true;
    showRight = true;
  } else {
    // lvl >= 5
    showLeft = true;
    showRight = true;
    showCenter = true;
  }

  const prevStates = (prevKey === 'p1') ? prevWerferStatesP1 : prevWerferStatesP2;

  // Prüfen, ob Werfer durch Downgrade verloren gingen
  if (prevStates && state.spielLaeuft && !pState.isDead) {
    if (prevStates.left && !showLeft) {
      erzeugeAbgeworfenenWerfer(pState.x - 8, pState.y + 7, -3 - Math.random() * 2, 2 + Math.random() * 2, -10);
    }
    if (prevStates.right && !showRight) {
      erzeugeAbgeworfenenWerfer(pState.x + 31, pState.y + 7, 3 + Math.random() * 2, 2 + Math.random() * 2, 10);
    }
    if (prevStates.center && !showCenter) {
      erzeugeAbgeworfenenWerfer(pState.x + 11.5, pState.y + 18, (Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 12);
    }
  }

  const currentStates = {
    left: showLeft,
    right: showRight,
    center: showCenter
  };

  if (prevKey === 'p1') {
    prevWerferStatesP1 = currentStates;
  } else {
    prevWerferStatesP2 = currentStates;
  }

  werferLinks.style.display = showLeft ? 'block' : 'none';
  werferRechts.style.display = showRight ? 'block' : 'none';
  werferCenter.style.display = showCenter ? 'block' : 'none';

  // Stufen-Klassen für Visuals aktualisieren
  [werferLinks, werferRechts, werferCenter].forEach(w => {
    w.classList.remove('werfer-lvl-1', 'werfer-lvl-2', 'werfer-lvl-3', 'werfer-lvl-4', 'werfer-lvl-5');
    w.classList.add(`werfer-lvl-${Math.min(5, Math.max(1, lvl))}`);
  });
}

export function updateRaketenWerferVisuals() {
  updateWerferForShip(dom.spieler || document.getElementById('spieler'), state, 'p1');
  if (state.p2) {
    updateWerferForShip(dom.spieler2 || document.getElementById('spieler-2'), state.p2, 'p2');
  }
}