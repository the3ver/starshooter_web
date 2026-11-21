import { state, dom, config, arrays, shipModels, isCoopMode } from './state.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import * as Bot from './bot.js';
import * as Network from './network.js';
import * as Gleve from './gleve.js';
import * as Sniper from './sniper.js';
import * as Viper from './viper.js';
import * as Display from './anzeige.js';
import * as Chain from './kette.js';
import * as Rock from './fels.js';
import * as Shockwave from './schockwelle.js';
import * as IslandBoss from './inselboss.js';
import * as Level from './level.js';
import { getShipSvgContent } from './anzeige-dom-objekte.js';
// Schiffs-SVG fuer Hangar und Cutszene (gleiche Vorlage wie im Spiel)
export { getShipSvgContent };
import { createParticles } from './partikel.js';
import { createEffect, removeEffects } from './effekte.js';

// faktor: Punkte-Multiplikator (Viper-Kombo), Ergebnis gerundet
export function addScore(points, factor = 1) {
  state.score += Math.round(points * factor);
  dom.scoreDisplay.innerText = state.score.toString().padStart(5, '0');
}
// Setzt HTML und entfernt verlorene Symbole (.pu-anim-lost) nach der Animation
function showWithLossAnimation(container, html, lostHtml) {
  container.innerHTML = html + lostHtml;

  if (lostHtml) {
    setTimeout(() => {
      const elements = container.querySelectorAll('.pu-anim-lost');
      elements.forEach(el => el.remove());
    }, 1000);
  }
}

// Herzen für einen Spieler; stilAttr hängt am span (P2: eigene Farbe)
function drawLives(lives, prevValue, container, styleAttr) {
  // Unveränderte Lebenszahl, Herzen schon im DOM und keine Animationsreste: nichts neu aufbauen
  // (der Online-Client ruft das pro Snapshot auf). Reste (pu-anim-new/-lost) räumt genau ein Neuaufbau weg.
  if (
    lives === prevValue &&
    container.querySelectorAll('.leben-herz').length === lives &&
    !container.querySelector('.pu-anim-new, .pu-anim-lost')
  ) {
    return;
  }

  let html = '';
  let lostHtml = '';

  for (let i = 0; i < lives; i++) {
    let animClass = i >= prevValue ? 'pu-anim-new' : '';
    html += `<span class="leben-herz ${animClass}"${styleAttr}>&hearts;</span>`;
  }

  if (lives < prevValue) {
    let lostCount = prevValue - lives;
    for (let i = 0; i < lostCount; i++) {
      lostHtml += `<span class="leben-herz pu-anim-lost"${styleAttr}>&hearts;</span>`;
    }
  }

  showWithLossAnimation(container, html, lostHtml);
}

let prevLives = null;

export function updateLivesUi() {
  if (prevLives === null) {
    prevLives = state.lives;
  }
  drawLives(state.lives, prevLives, dom.livesDisplay, '');
  prevLives = state.lives;
}
export function updateLevelUI() {
  dom.levelDisplay.innerText = 'LEVEL ' + state.level;
}
export function updateMaxEnergyMarker() {
  dom.maxEnergyMarker.style.left = (state.maxEnergy / state.absMaxEnergy) * 100 + '%';
}
// Powerup-Icons eines Spielers (s = state oder state.p2); prev merkt sich den
// letzten Stand für Animationen und wird am Ende aktualisiert
function drawActivePowerups(s, prev, container) {
  let html = '';
  let lostHtml = '';

  function buildIcon(key, currentVal, threshold, textPrefix, isBool, bgRgba, colorFunc) {
    let prevVal = prev[key];
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

  buildIcon('laserTier', s.laserTier, 1, 'L', false, 'rgba(155,89,182,0.2)', val =>
    val === 5 ? '#e056fd' : '#9b59b6',
  );
  buildIcon('missileTier', s.missileTier, 1, 'R', false, 'rgba(230,126,34,0.2)', val =>
    val === 5 ? '#f39c12' : '#e67e22',
  );
  buildIcon('bombTier', s.bombTier, 1, 'B', false, 'rgba(192,57,43,0.2)', val => (val === 5 ? '#e74c3c' : '#c0392b'));
  buildIcon('laserPierce', s.laserPierce, false, '&uarr;', true, 'rgba(0,255,255,0.2)', '#00ffff');
  if (s.shieldTier > 0) {
    buildIcon('shieldTier', s.shieldTier, 0, 'O', false, 'rgba(52,152,219,0.2)', '#3498db');
  } else if (s.selectedShipModel === 'phantom' && (s.phantomShieldRegenTimer || 0) > 0) {
    const maxTimer = s.phantomShieldRegenMax || 900;
    const progress = Math.min(1, Math.max(0, s.phantomShieldRegenTimer / maxTimer));
    const deg = Math.round(progress * 360);
    html += `<div class="active-pu-icon pu-recharging-shield" style="background: conic-gradient(#3498db ${deg}deg, rgba(52,152,219,0.15) 0deg); border:1px solid #3498db; color:#3498db;" title="Schild Stufe 1 lädt auf (${Math.round(progress * 100)}%)">O1</div>`;
  } else {
    buildIcon('shieldTier', s.shieldTier, 0, 'O', false, 'rgba(52,152,219,0.2)', '#3498db');
  }
  buildIcon('autolaserActive', s.autolaserActive, false, 'A', true, 'rgba(230,126,34,0.2)', '#e67e22');

  showWithLossAnimation(container, html, lostHtml);

  prev.laserTier = s.laserTier;
  prev.missileTier = s.missileTier;
  prev.bombTier = s.bombTier;
  prev.laserPierce = s.laserPierce;
  prev.shieldTier = s.shieldTier;
  prev.autolaserActive = s.autolaserActive;
}

let prevPuState = null;

export function updateActivePowerupsUi() {
  if (!prevPuState) {
    prevPuState = { ...state };
  }
  drawActivePowerups(state, prevPuState, dom.activePowerupsContainer);
  updateMissileLauncherVisuals();
}

let prevLivesP2 = null;

export function updateLivesP2Ui() {
  if (!state.p2 || !dom.livesDisplayP2) return;
  if (prevLivesP2 === null) {
    prevLivesP2 = state.p2.lives;
  }
  drawLives(state.p2.lives, prevLivesP2, dom.livesDisplayP2, ' style="color: #3498db;"');
  prevLivesP2 = state.p2.lives;
}

export function updateMaxEnergyMarkerP2() {
  if (dom.maxEnergyMarkerP2 && state.p2) {
    dom.maxEnergyMarkerP2.style.left = (state.p2.maxEnergy / state.p2.absMaxEnergy) * 100 + '%';
  }
}

let prevPuStateP2 = null;

export function updateActivePowerupsP2Ui() {
  if (!state.p2 || !dom.activePowerupsContainerP2) return;
  if (!prevPuStateP2) {
    prevPuStateP2 = { ...state.p2 };
  }
  drawActivePowerups(state.p2, prevPuStateP2, dom.activePowerupsContainerP2);
  updateMissileLauncherVisuals();
  updateSplitterUI();
}

// Splitter-HUD eines Spielers ein-/ausblenden und Zähler setzen
function showSplitter(s, hud, rotEl, whiteEl, visible) {
  if (visible) {
    hud.style.display = 'flex';
    if (rotEl) rotEl.textContent = s.splitterRed || 0;
    if (whiteEl) whiteEl.textContent = s.splitterWhite || 0;
  } else {
    hud.style.display = 'none';
  }
}

export function updateSplitterUI() {
  const hud = dom.splitterHudP1 || document.getElementById('splitter-hud-p1');
  const rotEl = dom.splitterRedCountP1 || document.getElementById('splitter-rot-count');
  const whiteEl = dom.splitterWhiteCountP1 || document.getElementById('splitter-weiss-count');
  if (!hud) return;
  showSplitter(state, hud, rotEl, whiteEl, state.selectedShipModel === 'viper');
}

export function updateSplitterP2UI() {
  const hud = dom.splitterHudP2 || document.getElementById('splitter-hud-p2');
  const rotEl = dom.splitterRedCountP2 || document.getElementById('splitter-rot-count-p2');
  const whiteEl = dom.splitterWhiteCountP2 || document.getElementById('splitter-weiss-count-p2');
  if (!hud || !state.p2) return;
  showSplitter(state.p2, hud, rotEl, whiteEl, isCoopMode() && state.p2.selectedShipModel === 'viper');
}

export function updateP2UI() {
  updateLivesP2Ui();
  updateMaxEnergyMarkerP2();
  updateActivePowerupsP2Ui();
  updateSplitterP2UI();
}
// Mehrteilige Bosse (bossId, z. B. Augen des Insel-Bosses) sind erst mit dem letzten Teil besiegt
function isLastBossPart(target) {
  return !target.bossId || !arrays.bosses.some(b => b !== target && b.bossId === target.bossId);
}

function bossPartDestroyed(target, comboFactor) {
  Audio.playExplosion('medium');
  addScore(300 * state.level, comboFactor);
  const color = target.glowColor || '#f1c40f';
  createExplosion(target.x + target.size / 2, target.y + target.size / 2, color, 35);
  if (state.gameMode === 'online') {
    Network.sendNetworkEvent({
      type: 'target_destroyed',
      x: target.x + target.size / 2,
      y: target.y + target.size / 2,
      color,
      count: 35,
      soundType: 'medium',
    });
  }
}

// Boss besiegt: Explosion, Punkte, Coop-Wiederbelebung, Drops (Viper-Splitter), naechstes Level
function defeatBoss(target, killer, comboFactor) {
  Audio.playExplosion('boss');
  addScore(1000 * state.level, comboFactor);
  createExplosion(target.x + target.size / 2, target.y + target.size / 2, '#f1c40f', 50);
  if (state.gameMode === 'online') {
    Network.sendNetworkEvent({
      type: 'target_destroyed',
      x: target.x + target.size / 2,
      y: target.y + target.size / 2,
      color: '#f1c40f',
      count: 50,
      soundType: 'boss',
    });
  }

  // Co-op Revive bei Boss-Sieg
  if (isCoopMode()) {
    if (state.isDead) {
      state.isDead = false;
      state.lives = 1;
      state.energy = state.maxEnergy / 2;
      state.invulnerableTimer = 180;
      state.shipVisible = true;
      Display.drawPlayer();
      updateLivesUi();
    }
    if (state.p2 && state.p2.isDead) {
      state.p2.isDead = false;
      state.p2.lives = 1;
      state.p2.energy = state.p2.maxEnergy / 2;
      state.p2.invulnerableTimer = 180;
      state.p2.shipVisible = true;
      Display.drawPlayer();
      updateLivesP2Ui();
    }
  }

  // 3 Belohnungen fallen lassen (1 Waffe + 2 zufällige verschiedene)
  const possibleDrops = ['lives', 'energy', 'pierce', 'shield'];
  let drops = ['superWeapon']; // Super-Waffe ist immer garantiert beim Boss
  let randomIndex = Math.floor(Math.random() * possibleDrops.length);
  drops.push(possibleDrops.splice(randomIndex, 1)[0]); // Typ entfernen, damit er nicht doppelt kommt
  randomIndex = Math.floor(Math.random() * possibleDrops.length);
  drops.push(possibleDrops[randomIndex]);

  drops.forEach((d, i) => {
    Entities.createPowerup(target.x + i * 25, target.y, d);
  });

  // 3 garantierte Splitter nur fallen lassen wenn ein Viper-Schiff beteiligt ist
  const killerShipModel = killer === 'p2' ? state.p2 && state.p2.selectedShipModel : state.selectedShipModel;
  const partnerShipModel = killer === 'p2' ? state.selectedShipModel : state.p2 && state.p2.selectedShipModel;
  const shardTarget = isCoopMode()
    ? killerShipModel === 'viper'
      ? killer
      : partnerShipModel === 'viper'
        ? killer === 'p2'
          ? 'p1'
          : 'p2'
        : null
    : state.selectedShipModel === 'viper'
      ? 'solo'
      : null;

  if (shardTarget) {
    const shardOwner = shardTarget === 'solo' ? null : shardTarget;
    for (let s = 0; s < 3; s++) {
      const shardType = Math.random() < 0.5 ? 'splitterRed' : 'splitterWhite';
      Entities.createPowerup(target.x + s * 25 + 12, target.y + 30, shardType, shardOwner);
    }
  }

  state.bossActive = false;
  state.level++;
  updateLevelUI();
  dom.bossHpContainer.style.display = 'none';
  state.frameCounter = 0; // Setzt Level-Timer zurück
}

export function destroyTarget(target, killer = 'p1') {
  let fIndex = arrays.enemies.indexOf(target);
  let aIndex = arrays.asteroids.indexOf(target);
  let bIndex = arrays.bosses.indexOf(target);
  if (fIndex === -1 && aIndex === -1 && bIndex === -1) return;

  // Viper-Kill-Kombo: Punkte dieses Kills zaehlen mit dem Faktor VOR dem Kill, danach waechst die Kombo
  const comboStatus = killer === 'p2' && state.p2 ? state.p2 : state;
  const comboFactor = Viper.comboFactor(comboStatus);

  // Boss besiegt: Belohnungen und naechstes Level
  if (target.isBoss) {
    if (isLastBossPart(target)) defeatBoss(target, killer, comboFactor);
    else bossPartDestroyed(target, comboFactor);
  } else {
    Audio.playExplosion(target.size >= 35 ? 'medium' : 'small');
    addScore(
      target.isEnemy
        ? target.pattern === 'hacker'
          ? 200
          : 100
        : target.carriesPowerup
          ? 50
          : target.size >= 35
            ? 20
            : 10,
      comboFactor,
    );
    if (target.isEnemy) {
      if (Chain.linkShotDown(target)) addScore(Chain.CHAIN_BONUS_POINTS, comboFactor);
      const killerShipModel = killer === 'p2' ? state.p2 && state.p2.selectedShipModel : state.selectedShipModel;
      const currentShip = shipModels && shipModels[killerShipModel || 'viper'];
      const energyGain = (currentShip && currentShip.energyPerKill) || 0;
      if (energyGain > 0) {
        if (killer === 'p2' && state.p2) {
          state.p2.energy = Math.min(state.p2.maxEnergy, state.p2.energy + energyGain);
          if (dom.energyBarP2) dom.energyBarP2.style.width = (state.p2.energy / state.p2.absMaxEnergy) * 100 + '%';
        } else {
          state.energy = Math.min(state.maxEnergy, state.energy + energyGain);
          if (dom.energyBar) dom.energyBar.style.width = (state.energy / state.absMaxEnergy) * 100 + '%';
        }
      }
      if (killerShipModel === 'viper') {
        const killerState = killer === 'p2' && state.p2 ? state.p2 : state;
        killerState.viperKillCount = (killerState.viperKillCount || 0) + 1;
        if (killerState.viperKillCount % 10 === 0) {
          const shardType = Math.random() < 0.5 ? 'splitterRed' : 'splitterWhite';
          const owner = isCoopMode() ? killer : null;
          Entities.createPowerup(target.x + target.size / 2 - 10, target.y + target.size / 2 - 10, shardType, owner);
        }
      }
    }
    let color = target.isEnemy ? target.explosionsColor || '#9b59b6' : target.color || '#ffffff';
    createExplosion(target.x + target.size / 2, target.y + target.size / 2, color, 25);
    if (state.gameMode === 'online') {
      Network.sendNetworkEvent({
        type: 'target_destroyed',
        x: target.x + target.size / 2,
        y: target.y + target.size / 2,
        color: color,
        count: 25,
        soundType: target.size >= 35 ? 'medium' : 'small',
      });
    }
    if (target.carriesPowerup) {
      // Eierkapsel: Bonus (Schockwelle oder Zufall), sonst Zufall
      const typ = target.powerupTyp === 'bonus' ? Shockwave.bonusType() : null;
      Entities.createPowerup(target.x + target.size / 2 - 12, target.y + target.size / 2 - 12, typ);
    } else if (!target.isEnemy && target.size >= 35) {
      let newSize = target.size * 0.6;
      Entities.createAsteroid(target.x, target.y, newSize, -3, target.vy, 15, true);
      Entities.createAsteroid(target.x + target.size - newSize, target.y, newSize, 3, target.vy, 15, true);
      createExplosion(target.x + target.size / 2, target.y + target.size / 2, color, 20); // Extra split particles
    }
  }
  Viper.registerKill(comboStatus);
  Display.remove(target);
  if (fIndex > -1) arrays.enemies.splice(fIndex, 1);
  if (aIndex > -1) arrays.asteroids.splice(aIndex, 1);
  if (bIndex > -1) arrays.bosses.splice(bIndex, 1);
}

// Laufende Sweeps, Dashs und Klingenwellen beenden (die Anzeige leitet die Klinge aus dem Zustand ab).
// Nach dem Game Over laeuft keine Simulation mehr, die sie selbst abraeumen wuerde.
function removeGleveEffects() {
  Sniper.removeEffects();
  removeEffects();
  // Laufende Dashs und Rollen enden mit dem Spiel (die Anzeige leitet die Schiffsklassen daraus ab)
  for (const s of [state, state.p2]) {
    if (!s) continue;
    s.gleveDashTimer = 0;
    s.gleveBounceTimer = 0;
    s.gleveSweepTimer = 0;
    s.viperRollTimer = 0;
    s.viperOverdriveTimer = 0;
  }
  Display.drawPlayer();
  for (const w of arrays.gleveWaves) Display.remove(w);
  arrays.gleveWaves.length = 0;
}

export function triggerGameOver(finalScoreFromHost = null) {
  Audio.playGameOver();
  state.gameOverActive = true;
  removeGleveEffects();
  state.finalScore = finalScoreFromHost !== null ? finalScoreFromHost : state.cheatUsed ? 0 : state.score;

  state.onlineHighscoreNames = { p1: null, p2: null };

  const startScreen = document.getElementById('start-screen');
  if (startScreen) startScreen.style.display = 'none';

  const finalScoreEl = document.getElementById('final-score');
  if (finalScoreEl) finalScoreEl.innerText = String(state.finalScore);
  const gameOverScreen = document.getElementById('game-over-screen');
  if (gameOverScreen) gameOverScreen.style.display = 'flex';

  const isOnline = state.gameMode === 'online' || (state.network && state.network.isOnline);
  const isCoop = state.gameMode === 'coop';
  const currentMode = isOnline ? 'online' : isCoop ? 'coop_bot' : 'single';

  if (isOnline && state.network && state.network.isHost && finalScoreFromHost === null) {
    Network.sendNetworkEvent({
      type: 'game_over',
      finalScore: state.finalScore,
    });
  }

  let hs = getHighscores(currentMode);
  const hsInput = /** @type {HTMLInputElement} */ (document.getElementById('highscore-name'));
  const hsBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-save-score'));
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
      hsInput.placeholder = state.network && state.network.isHost ? 'P1' : 'P2';
      hsInput.maxLength = 3;
    } else if (isCoop) {
      hsInput.placeholder = 'TEAM';
      hsInput.maxLength = 6;
    } else {
      hsInput.placeholder = 'AAA';
      hsInput.maxLength = 3;
    }
  }

  if (hs.length < 10 || state.finalScore > hs[hs.length - 1].score) {
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

// Gleve-Dash (+ Nachlauf/Abprall) und Viper-Rolle: Schiff ist nicht treffbar, Geschosse und Gegner fliegen durch
export function isDashInvulnerable(pState) {
  return !!pState && ((pState.gleveInvulnerable || 0) > 0 || (pState.viperRollTimer || 0) > 0);
}

// Koerperkollision Spieler gegen Asteroid/Feind: Kreis gegen Kreis statt Bounding-Box. Die Box zaehlte leere Ecken
// (spitze Schiffsnase, runde Asteroiden mit 70-100 % Radius) mit, das Schiff wurde mit sichtbarem Abstand getroffen.
export const PLAYER_HIT_RADIUS = 0.36; // Anteil an spielerGroesse (30 px -> 10,8 px)
export const ASTEROID_HIT_RADIUS = 0.42; // Anteil an groesse (Umriss 35-50 %, Mittel ~42 %)
export const ENEMY_HIT_RADIUS = 0.4;
export function bodyHitsPlayer(pState, obj, radiusShare) {
  const s = config.playerSize;
  const dx = pState.x + s / 2 - (obj.x + obj.size / 2);
  const dy = pState.y + s / 2 - (obj.y + obj.size / 2);
  const r = s * PLAYER_HIT_RADIUS + obj.size * radiusShare;
  return dx * dx + dy * dy < r * r;
}

// Treffer am Spieler; das Schiff (Blinken, Schild, Sichtbarkeit) wird sofort neu gezeichnet
export function playerHit(collisionObject, exploded = true, targetPlayer = 'p1') {
  hitAmPlayer(collisionObject, exploded, targetPlayer);
  Display.drawPlayer();
}

function hitAmPlayer(collisionObject, exploded, targetPlayer) {
  if (targetPlayer === 'p1') {
    if (state.godMode || state.invulnerableTimer > 0 || state.isDead || isDashInvulnerable(state)) return;

    Audio.playHit('player');
    Viper.resetCombo(state);
    state.invulnerableTimer = 45;

    if (state.shieldTier > 0) {
      state.shieldTier--;
      if (state.shieldTier === 0 && state.selectedShipModel === 'phantom') {
        state.phantomShieldRegenTimer = 0;
      }
      updateActivePowerupsUi();
      if (exploded && collisionObject) {
        let c = collisionObject.isEnemy ? '#9b59b6' : collisionObject.color || '#7f8c8d';
        createExplosion(
          collisionObject.x + (collisionObject.size || 4) / 2,
          collisionObject.y + (collisionObject.size || 15) / 2,
          c,
          10,
        );
      }
      addScore(10);
      Display.flashPlayfield('rgba(52, 152, 219, 0.3)', 150);
      return;
    }
    state.lives--;
    if (state.selectedShipModel === 'phantom') {
      state.phantomShieldRegenTimer = 0;
      updateActivePowerupsUi();
    }
    const currentShip = shipModels && shipModels[state.selectedShipModel || 'viper'];
    if (!currentShip || currentShip.loseUpgradesOnHit) {
      let possibleDowngrades = [];
      if (state.laserTier > 1) possibleDowngrades.push('laser');
      if (state.missileTier > 1) possibleDowngrades.push('missiles');
      if (state.bombTier > 1) possibleDowngrades.push('bombs');
      if (possibleDowngrades.length > 0) {
        let choice = possibleDowngrades[Math.floor(Math.random() * possibleDowngrades.length)];
        if (choice === 'laser') state.laserTier--;
        else if (choice === 'missiles') state.missileTier--;
        else if (choice === 'bombs') state.bombTier--;
      }
    }
    updateLivesUi();
    updateActivePowerupsUi();
    Display.flashPlayfield('#900', 150);
    if (exploded && collisionObject && !collisionObject.isBoss) {
      let c = collisionObject.isEnemy ? '#9b59b6' : collisionObject.color || '#7f8c8d';
      createExplosion(
        collisionObject.x + (collisionObject.size || 4) / 2,
        collisionObject.y + (collisionObject.size || 15) / 2,
        c,
        10,
      );
    }
    if (state.lives <= 0) {
      state.isDead = true;
      state.shipVisible = false;
      createExplosion(state.x + 15, state.y + 15, '#e74c3c', 40);

      const isOtherAlive = isCoopMode() && state.p2 && !state.p2.isDead && state.p2.lives > 0;
      if (!isOtherAlive) {
        triggerGameOver();
      }
    }
  } else if (targetPlayer === 'p2' && isCoopMode() && state.p2) {
    if (state.godMode || state.p2.invulnerableTimer > 0 || state.p2.isDead || isDashInvulnerable(state.p2)) return;

    Audio.playHit('player');
    Viper.resetCombo(state.p2);
    state.p2.invulnerableTimer = 45;

    const isOnline = state.gameMode === 'online' || (state.network && state.network.isOnline);

    if (state.p2.shieldTier > 0) {
      state.p2.shieldTier--;
      if (state.p2.shieldTier === 0 && state.p2.selectedShipModel === 'phantom') {
        state.p2.phantomShieldRegenTimer = 0;
      }
      updateActivePowerupsP2Ui();
      if (exploded && collisionObject) {
        let c = collisionObject.isEnemy ? '#9b59b6' : collisionObject.color || '#7f8c8d';
        createExplosion(
          collisionObject.x + (collisionObject.size || 4) / 2,
          collisionObject.y + (collisionObject.size || 15) / 2,
          c,
          10,
        );
      }
      addScore(10);
      if (!isOnline) {
        Display.flashPlayfield('rgba(52, 152, 219, 0.3)', 150);
      } else {
        Network.sendNetworkEvent({
          type: 'player_hit',
          target: 'p2',
          shield: true,
          invulnerable: state.p2.invulnerableTimer,
        });
      }
      return;
    }
    state.p2.lives--;
    if (state.p2.selectedShipModel === 'phantom') {
      state.p2.phantomShieldRegenTimer = 0;
      updateActivePowerupsP2Ui();
    }
    const p2Ship = shipModels && shipModels[state.p2.selectedShipModel || 'phantom'];
    if (!p2Ship || p2Ship.loseUpgradesOnHit) {
      let possibleDowngrades = [];
      if (state.p2.laserTier > 1) possibleDowngrades.push('laser');
      if (state.p2.missileTier > 1) possibleDowngrades.push('missiles');
      if (state.p2.bombTier > 1) possibleDowngrades.push('bombs');
      if (possibleDowngrades.length > 0) {
        let choice = possibleDowngrades[Math.floor(Math.random() * possibleDowngrades.length)];
        if (choice === 'laser') state.p2.laserTier--;
        else if (choice === 'missiles') state.p2.missileTier--;
        else if (choice === 'bombs') state.p2.bombTier--;
      }
    }
    updateLivesP2Ui();
    updateActivePowerupsP2Ui();
    if (!isOnline) {
      Display.flashPlayfield('#900', 150);
    } else {
      Network.sendNetworkEvent({
        type: 'player_hit',
        target: 'p2',
        shield: false,
        invulnerable: state.p2.invulnerableTimer,
      });
    }
    if (exploded && collisionObject && !collisionObject.isBoss) {
      let c = collisionObject.isEnemy ? '#9b59b6' : collisionObject.color || '#7f8c8d';
      createExplosion(
        collisionObject.x + (collisionObject.size || 4) / 2,
        collisionObject.y + (collisionObject.size || 15) / 2,
        c,
        10,
      );
    }
    if (state.p2.lives <= 0) {
      state.p2.isDead = true;
      state.p2.shipVisible = false;
      createExplosion(state.p2.x + 15, state.p2.y + 15, '#3498db', 40);

      const isOtherAlive = !state.isDead && state.lives > 0;
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
    if (state.gameRunning && !state.gameOverActive && isTouchDevice) {
      mobileControls.style.display = 'flex';
    } else {
      mobileControls.style.display = 'none';
    }
    if (typeof window.resizeGame === 'function') {
      window.resizeGame();
    }
  }
}

// Gleve-Dash- und Sweep-Zustand eines Spielers zuruecksetzen (Felder siehe gleve.js)
function resetGleveDash(pState) {
  pState.gleveDashTimer = 0;
  pState.gleveDashVx = 0;
  pState.gleveDashVy = 0;
  pState.gleveBounceTimer = 0;
  pState.gleveInvulnerable = 0;
  pState.gleveDashKeyHeld = false;
  pState.gleveDashHit = [];
  Gleve.setDashChargeFull(pState);
  pState.gleveSweepTimer = 0;
  pState.gleveSweepAngle = 0;
  pState.gleveSweepDirection = 0;
  pState.gleveSweepHit = [];
  pState.gleveSweepCadence = 0;
  // Online: Dash-Richtung, Client-Vorhersage und Bot-Dash
  pState.gleveDashDirection = null;
  pState.gleveNetworkBounce = null;
  pState.networkDirection = null;
  pState.networkDashRequest = false;
  pState.botDashDirection = null;
}

export function restartGame() {
  state.gameOverActive = false;
  document.getElementById('game-over-screen').style.display = 'none';
  state.lives = 3;
  state.maxEnergy = 50;
  state.energy = state.maxEnergy;
  state.laserTier = 1;
  state.missileTier = 1;
  state.bombTier = 1;
  state.cheatUsed = false;
  state.godMode = false;
  state.unlimitedEnergy = false;
  dom.maxEnergyMarker.style.display = 'block';
  state.laserPierce = false;
  state.pierceTimer = 0;
  state.phantomShieldRegenTimer = 0;
  const currentShip = shipModels && shipModels[state.selectedShipModel || 'viper'];
  state.shieldTier = (currentShip && currentShip.startShield) || 0;
  state.score = 0;
  addScore(0);
  state.level = 1;
  state.shockwaveLevel = 0;
  state.splitterRed = 0;
  state.splitterWhite = 0;
  state.viperKillCount = 0;
  state.isDead = false;
  state.hacks = [];
  if (state.p2) state.p2.hacks = [];
  resetGleveDash(state);
  if (state.p2) resetGleveDash(state.p2);
  Viper.reset(state);
  if (state.p2) Viper.reset(state.p2);
  Sniper.reset(state);
  if (state.p2) Sniper.reset(state.p2);
  removeGleveEffects();
  Bot.resetBot();
  updateLivesUi();
  updateMaxEnergyMarker();
  updateActivePowerupsUi();
  updateSplitterUI();
  updateLevelUI();
  state.x = 185;
  state.y = 285;
  state.shipVisible = false;
  state.rotation = 0;
  // Interpolierte Anzeigeposition eines frueheren Online-Clients gilt nicht mehr
  delete state.displayX;
  delete state.displayY;

  if (state.p2) {
    state.p2.lives = 3;
    state.p2.maxEnergy = 50;
    state.p2.energy = 50;
    state.p2.splitterRed = 0;
    state.p2.splitterWhite = 0;
    state.p2.viperKillCount = 0;
    state.p2.laserTier = 1;
    state.p2.missileTier = 1;
    state.p2.bombTier = 1;
    state.p2.laserPierce = false;
    state.p2.pierceTimer = 0;
    state.p2.phantomShieldRegenTimer = 0;
    state.p2.autolaserActive = false;
    state.p2.autolaserTimer = 0;
    state.p2.missileCooldown = 0;
    state.p2.bombCooldown = 0;
    state.p2.playerShotCooldown = 0;
    state.p2.invulnerableTimer = 0;
    state.p2.isDead = false;
    const p2Ship = shipModels && shipModels[state.p2.selectedShipModel || 'phantom'];
    state.p2.shieldTier = (p2Ship && p2Ship.startShield) || 0;
    state.p2.x = 370;
    state.p2.y = 285;
    state.p2.shipVisible = false;
    state.p2.rotation = 0;
    updateP2UI();
  }
  Display.drawPlayer();

  const clearArray = arr => {
    if (arr) {
      arr.forEach(Display.remove);
      arr.length = 0;
    }
  };

  clearArray(arrays.asteroids);
  clearArray(arrays.enemies);
  clearArray(arrays.enemyLaserArray);
  clearArray(arrays.hackProjectileArray);
  clearArray(arrays.bosses);
  clearArray(arrays.bossLaserArray);
  clearArray(arrays.bossBombArray);
  clearArray(arrays.bossMissileArray);
  clearArray(arrays.powerups);
  clearArray(arrays.particleArray);
  clearArray(arrays.laserArray);
  clearArray(arrays.missileArray);
  clearArray(arrays.bombArray);
  clearArray(arrays.explosionsArray);
  clearArray(arrays.effects);
  clearArray(arrays.rock);
  Rock.reset();
  IslandBoss.reset();
  Level.resetTheme();
  clearArray(arrays.sniperGrenades);

  // Verwaiste Spiel-Entitäten und Projektile aus dem DOM entfernen
  const orphanSelectors =
    '.boss-rakete, .boss-bombe, .boss-laser, .feind-laser, .laser, .rakete, .bombe, .powerup, .feind, .asteroid, .boss, .partikel, .werfer-abgeworfen, .shockwave, .schockwelle, .cutscene-fireball, .cutscene-shockwave, .cutscene-debris, .tractor-beam-svg';
  if (dom.playfield) {
    dom.playfield.querySelectorAll(orphanSelectors).forEach(el => el.remove());
  }

  state.bossActive = false;
  state.bossWarningActive = false;
  state.bossWarningTimer = 0;
  dom.warningOverlay.style.display = 'none';
  dom.bossHpContainer.style.display = 'none';

  state.paused = false;
  state.pauseFrom = null;
  state.pauseEndTime = 0;
  dom.pauseOverlay.style.display = 'none';

  state.bossFightActive = false;
  state.autolaserActive = false;
  state.autolaserBeam = null;
  state.hitscanBeam = null;

  state.playerShotCooldown = 0;
  state.missileCooldown = 0;
  state.bombCooldown = 0;

  state.frameCounter = 0;
  state.gameRunning = false;
  state.cutsceneActive = false;

  const cutsceneContainer = document.getElementById('cutscene-container');
  if (cutsceneContainer) {
    cutsceneContainer.innerHTML = '';
    cutsceneContainer.style.display = 'none';
  }

  for (let key in state.keysPressed) {
    state.keysPressed[key] = false;
  }

  let startScreen = document.getElementById('start-screen');
  if (startScreen) startScreen.style.display = 'block';
  applyPlayfieldWidth('menu');
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

export function normalizeHighscoreMode(mode = state.gameMode || 'single') {
  if (mode === 'single') return 'single';
  if (mode === 'online') return 'online';
  if (mode === 'coop_bot') return 'coop_bot';
  if (mode === 'coop') return 'coop_bot';
  return 'single';
}

export function getHighscores(mode = state.gameMode || 'single') {
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

export function saveHighscore(
  name,
  scoreValue,
  shipModel = null,
  mode = state.gameMode || 'single',
  shipP2Model = null,
  level = null,
) {
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
    mode: normMode,
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
  // Im Online-Modus übermittelt ausschließlich der Host den Score an die globale Bestenliste
  const isOnline = normMode === 'online' || (state.network && state.network.isOnline);
  const canSubmitGlobal = !isOnline || (state.network && state.network.isHost);

  if (!state.cheatUsed && scoreValue > 0 && canSubmitGlobal) {
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
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode,
        name,
        score,
        level,
        shipP1,
        shipP2,
        timestamp,
        hash,
      }),
    });

    if (response.ok) {
      // Nach erfolgreichem Submit Cache für diesen Modus invalidieren und neu laden
      if (state.globalHighscoresCache) {
        state.globalHighscoresCache[mode] = null;
      }
      if (state.network && state.network.isOnline && state.network.isHost && state.network.connected) {
        Network.sendNetworkEvent({
          type: 'highscore_committed',
        });
      }
      fetchGlobalHighscores(mode);
    }
  } catch (err) {
    console.warn('Global Highscore Submit fehlgeschlagen, offline Fallback aktiv:', err);
  }
}

// Maskiert HTML-Sonderzeichen für Strings aus der API (Name, Stadt, Land)
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Badge-Daten je Schiffsmodell für die Bestenliste (unbekannt/fehlend = Viper-X)
const HS_SHIPS = {
  viper: { cls: 'hs-ship-viper', label: 'Viper-X', short: 'V' },
  phantom: { cls: 'hs-ship-phantom', label: 'Phantom-NX', short: 'P' },
  gleve: { cls: 'hs-ship-gleve', label: 'Gleve-MR', short: 'G' },
  sniper: { cls: 'hs-ship-sniper', label: 'Spectre-SR', short: 'S' },
};

function hsShipInfo(model) {
  return HS_SHIPS[model] || HS_SHIPS.viper;
}

export function renderHighscoresTable(currentMode, hsList) {
  const tbody = document.getElementById('highscore-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!hsList || hsList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">- Keine Einträge -</td></tr>';
    return;
  }

  let lineHtml = '';
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
      locDisplay = `<span class="hs-location" title="${escapeHtml(title)}">${escapeHtml(flag)}</span>`;
    }

    const isMulti = currentMode === 'coop_bot' || currentMode === 'online';

    if (isMulti) {
      const p1Info = hsShipInfo(entry.shipP1);
      const p2Info = hsShipInfo(entry.shipP2);
      const p1Badge = `<span class="hs-ship-badge hs-badge-mini ${p1Info.cls}" title="P1: ${p1Info.label}">P1:${p1Info.short}</span>`;
      const p2Badge = `<span class="hs-ship-badge hs-badge-mini ${p2Info.cls}" title="P2: ${p2Info.label}">P2:${p2Info.short}</span>`;
      lineHtml += `<tr><td>${rankBadge}</td><td>${escapeHtml(entry.name)}${locDisplay}</td><td>${escapeHtml(entry.score)}</td><td><div class="hs-coop-badges">${p1Badge} ${p2Badge}</div></td></tr>`;
    } else {
      const info = hsShipInfo(entry.shipP1 || entry.ship);
      lineHtml += `<tr><td>${rankBadge}</td><td>${escapeHtml(entry.name)}${locDisplay}</td><td>${escapeHtml(entry.score)}</td><td><span class="hs-ship-badge ${info.cls}">${info.label}</span></td></tr>`;
    }
  });
  tbody.innerHTML = lineHtml;
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
      if (!state.globalHighscoresCache) state.globalHighscoresCache = /** @type {any} */ ({});
      state.globalHighscoresCache[normMode] = data.highscores;
      state.highscoreError = false;

      if (statusText) statusText.innerText = '🌐 GLOBALE BESTENLISTE';
      if (spinner) spinner.style.display = 'none';

      // Wenn global noch keine Einträge existieren, aber lokal welche vorhanden sind, zeige diese an
      const localHs = getHighscores(normMode);
      const scoresToRender = data.highscores.length === 0 && localHs.length > 0 ? localHs : data.highscores;

      // Nur rendern, wenn der Tab noch der aktuelle ist
      if (state.currentHighscoreTab === normMode) {
        renderHighscoresTable(normMode, scoresToRender);
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
    colHeaderShip.innerText = normMode === 'single' ? 'SCHIFF' : 'SHIPS';
  }

  // Zuerst gecachte globale Scores oder lokale Scores sofort anzeigen
  if (
    state.globalHighscoresCache &&
    state.globalHighscoresCache[normMode] &&
    state.globalHighscoresCache[normMode].length > 0
  ) {
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
  const hsInput = /** @type {HTMLInputElement} */ (document.getElementById('highscore-name'));
  const hsBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-save-score'));
  let rawName = (hsInput ? hsInput.value : '').trim().toUpperCase();

  if (!isOnline) {
    let nameInput = rawName;
    const isCoop = state.gameMode === 'coop';
    if (!nameInput || nameInput === '') nameInput = isCoop ? 'TEAM' : 'AAA';
    const mode = isCoop ? 'coop_bot' : 'single';
    saveHighscore(
      nameInput,
      state.finalScore,
      state.selectedShipModel,
      mode,
      state.p2 ? state.p2.selectedShipModel : null,
      state.level || 1,
    );
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
    name: myName,
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

  const hsInput = /** @type {HTMLInputElement} */ (document.getElementById('highscore-name'));
  const hsBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-save-score'));
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

    // State sofort zurücksetzen, um doppelte Ausführung zu verhindern
    state.onlineHighscoreNames = { p1: null, p2: null };

    saveHighscore(combinedName, state.finalScore, modelP1, 'online', modelP2, state.level || 1);

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
export function createExplosion(x, y, color, count = 15) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 4 + 2;
    createParticles({
      color,
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      lives: 1.0,
      decay: Math.random() * 0.03 + 0.02,
    });
  }
}

export function createBombDetonation(bcx, bcy, color = '#f39c12', radius = 150, tier = 1, isMini = false) {
  const playfield = dom.playfield || document.getElementById('spielfeld');
  if (!playfield) return;

  // 1. Partikel
  createExplosion(bcx, bcy, color || '#f39c12', isMini ? 35 : 60);

  // 2. Sound
  if (Audio && Audio.playExplosion) {
    Audio.playExplosion(isMini ? 'medium' : 'large');
  }

  // 3. Schockwelle (Effekt im Simulationstakt; Stufe 3 Vortex: zweite, leicht verzoegert und violett)
  createEffect({ kind: 'bombWave', x: bcx, y: bcy, radius, color: color || '#f39c12', rest: 30 });
  if (tier === 3 && !isMini) {
    createEffect({ kind: 'bombWave2', x: bcx, y: bcy, radius: radius * 0.75, rest: 24 + 9, delay: 9 });
  }
}

export function createMissileDetonation(rcx, rcy, radius = 70) {
  const playfield = dom.playfield || document.getElementById('spielfeld');
  if (!playfield) return;

  if (Audio && Audio.playMissileExplosion) {
    Audio.playMissileExplosion();
  }
  createExplosion(rcx, rcy, '#e67e22', 25);
  createExplosion(rcx, rcy, '#f1c40f', 15);

  createEffect({ kind: 'missileWave', x: rcx, y: rcy, radius, rest: 18 });
}
export function createSmokeSparks(x, y, size) {
  // Rauch
  if (Math.random() < 0.5) {
    createParticles({
      color: '#555',
      size: 6,
      x: x + Math.random() * size,
      y: y + Math.random() * size,
      vx: (Math.random() - 0.5) * 2,
      vy: -Math.random() * 2 - 1,
      lives: 1.0,
      decay: 0.02,
    });
  }
  // Funken
  if (Math.random() < 0.3) {
    createParticles({
      color: '#f1c40f',
      glow: true,
      x: x + Math.random() * size,
      y: y + Math.random() * size,
      vx: (Math.random() - 0.5) * 4,
      vy: -Math.random() * 4,
      lives: 1.0,
      decay: 0.05,
    });
  }
}
export function createDriveSmoke(x, y, vy = -1.5) {
  if (Math.random() < 0.6) {
    const color = Math.random() < 0.3 ? '#e74c3c' : '#7f8c8d';
    createParticles({
      color,
      size: 4,
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 1,
      vy: vy + (Math.random() - 0.5) * 0.5,
      lives: 1.0,
      decay: 0.05,
    });
  }
}

// --- SCHIFFS-AUSWAHL & VISUALS ---

// Menuebreite (Einzelspieler-Feld), gilt solange der Startbildschirm sichtbar ist
export const MENU_WIDTH = 400;
export const MULTIPLAYER_WIDTH = 600;

// Setzt die Spielfeldbreite: 'single' = 400 px, 'coop'/'online' = 600 px, 'menue' = Menuebreite.
// Ohne Argument gilt state.gameMode. Wird beim Spielstart (Cutscene) bzw. beim Rueckweg ins Menue gerufen.
export function applyPlayfieldWidth(mode = state.gameMode) {
  const wide = mode === 'coop' || mode === 'online';
  config.playfieldWidth = wide ? MULTIPLAYER_WIDTH : MENU_WIDTH;
  const playfield = dom.playfield || document.getElementById('spielfeld');
  if (playfield) {
    playfield.classList.toggle('mode-coop', wide);
    playfield.style.width = config.playfieldWidth + 'px';
  }
  if (typeof window.resizeGame === 'function') window.resizeGame();
}

export function setGameMode(mode) {
  state.gameMode = mode;
  const isCoop = mode === 'coop';
  const isOnline = mode === 'online';
  const isMultiplayer = isCoop || isOnline;

  const btnSingle = document.getElementById('gamemode-btn-single');
  const btnCoop = document.getElementById('gamemode-btn-coop');
  const btnOnline = document.getElementById('gamemode-btn-online');
  if (btnSingle) btnSingle.classList.toggle('active', mode === 'single');
  if (btnCoop) btnCoop.classList.toggle('active', isCoop);
  if (btnOnline) btnOnline.classList.toggle('active', isOnline);

  // Die Spielfeldbreite aendert sich NICHT hier: Das Menue bleibt in allen Modi gleich breit,
  // die Modusbreite gilt erst ab Spielstart (wendeSpielfeldBreiteAn in startCutscene/startOnlineGame).
  const hintSingle = document.getElementById('modus-optionen-single');
  if (hintSingle) hintSingle.style.display = mode === 'single' ? 'block' : 'none';
  const optionsCoop = document.getElementById('modus-optionen-coop');
  if (optionsCoop) optionsCoop.style.display = isCoop ? 'block' : 'none';

  const onlineLobby = document.getElementById('online-lobby-container');
  if (onlineLobby) onlineLobby.style.display = isOnline ? 'block' : 'none';

  const hangarTabs = document.getElementById('hangar-player-tabs');
  if (hangarTabs) hangarTabs.style.display = isCoop ? 'flex' : 'none';

  const infoSingle = document.getElementById('steuerung-info-single');
  const infoCoop = document.getElementById('steuerung-info-coop');
  const infoOnline = document.getElementById('steuerung-info-online');
  if (infoSingle) infoSingle.style.display = mode === 'single' ? 'block' : 'none';
  if (infoCoop) infoCoop.style.display = isCoop ? 'block' : 'none';
  if (infoOnline) infoOnline.style.display = isOnline ? 'block' : 'none';

  updateControlsInfo();

  const uiP2 = dom.uiContainerP2 || document.getElementById('ui-container-p2');
  if (uiP2) uiP2.style.display = isMultiplayer && state.gameRunning ? 'flex' : 'none';

  const tagP1 = /** @type {HTMLElement} */ (document.querySelector('.tag-p1'));
  if (tagP1) tagP1.style.display = isMultiplayer ? 'block' : 'none';

  const startText = document.getElementById('start-text');
  if (startText) {
    if (isOnline) {
      startText.textContent = 'RAUM ERSTELLEN ODER BEITRETEN ZUM START';
      startText.style.color = '#1abc9c';
      startText.classList.add('start-text-lang');
    } else {
      startText.textContent = 'TAP OR PRESS ANY KEY TO START';
      startText.style.color = '#f1c40f';
      startText.classList.remove('start-text-lang');
    }
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

export function updateControlsInfo() {
  const short = document.getElementById('steuerung-kurz');
  if (short) {
    if (state.gameMode === 'coop') {
      short.textContent = state.p2IsBot
        ? 'WASD bewegen · L/B Laser · K/V Raketen · LEER/C Bombe · P Pause'
        : 'P1: WASD · B/V/C   P2: Pfeile · Ä/Ö/L';
    } else {
      short.textContent = 'WASD bewegen · L Laser · K Raketen · LEER Bombe · P Pause';
    }
  }
  const infoCoop = document.getElementById('steuerung-info-coop');
  if (infoCoop) {
    if (state.p2IsBot) {
      infoCoop.innerHTML = `
        <div class="steuerung-titel">Steuerung (Co-op mit Bot)</div>
        <b>W A S D</b> &nbsp;&rarr; Bewegen &nbsp;|&nbsp; <b>L / B</b> &rarr; Laser<br>
        <b>K / V</b> &rarr; Raketen &nbsp;|&nbsp; <b>LEER / C</b> &rarr; Bomben &nbsp;|&nbsp; <b>P</b> &rarr; Pause
      `;
    } else {
      infoCoop.innerHTML = `
        <div class="steuerung-titel">Steuerung 2-Spieler (PC)</div>
        <div class="steuerung-coop-grid">
            <div class="steuerung-col">
                <strong style="color: #e74c3c;">SPIELER 1</strong>
                <div class="steuerung-zeile"><b>W A S D</b><span>&rarr; Bewegen</span></div>
                <div class="steuerung-zeile"><b>B</b><span>&rarr; Laser</span></div>
                <div class="steuerung-zeile"><b>V</b><span>&rarr; Raketen</span></div>
                <div class="steuerung-zeile"><b>C</b><span>&rarr; Bombe</span></div>
            </div>
            <div class="steuerung-col">
                <strong style="color: #3498db;">SPIELER 2</strong>
                <div class="steuerung-zeile"><b>&uarr; &larr; &darr; &rarr;</b><span>&rarr; Bewegen</span></div>
                <div class="steuerung-zeile"><b>Ä</b><span>&rarr; Laser</span></div>
                <div class="steuerung-zeile"><b>Ö</b><span>&rarr; Raketen</span></div>
                <div class="steuerung-zeile"><b>L</b><span>&rarr; Bombe</span></div>
            </div>
        </div>
      `;
    }
  }
}

// Beschreibungszeile unter den Perk-Chips (feste Hoehe, Index -1 = Hinweistext)
export function showPerkDetail(index) {
  const detail = document.getElementById('hangar-perk-detail');
  const container = document.getElementById('hangar-ship-perks');
  if (!detail || !container) return;
  const model = container.dataset.model;
  const perk = shipModels && shipModels[model] && shipModels[model].perks[index];
  container.querySelectorAll('.hangar-perk-chip').forEach((chip, i) => chip.classList.toggle('aktiv', i === index));
  detail.classList.toggle('hinweis', !perk);
  detail.textContent = perk ? perk.label + ': ' + perk.desc : 'Perk antippen für Details';
}

export function updatePlayerShipVisuals() {
  const isP2Hangar = state.gameMode === 'coop' && state.activeHangarPlayer === 'p2';
  const modelP1 = state.selectedShipModel || 'viper';
  const colorIdP1 = state.selectedShipColor || 'red';
  const modelP2 = (state.p2 && state.p2.selectedShipModel) || 'phantom';
  const colorIdP2 = (state.p2 && state.p2.selectedShipColor) || 'blue';

  const activeHangarModel = isP2Hangar ? modelP2 : modelP1;
  const activeHangarColor = isP2Hangar ? colorIdP2 : colorIdP1;

  // Schiffe im Spiel (SVG nach Modell/Farbe, Werfer-Pods) zeichnet die Anzeige aus dem Zustand
  Display.drawPlayer();

  // Hangar Preview im Startscreen aktualisieren
  const previewSvg = document.getElementById('hangar-preview-svg');
  if (previewSvg) {
    previewSvg.innerHTML = getShipSvgContent(activeHangarModel, activeHangarColor);
    if (previewSvg.parentElement)
      previewSvg.parentElement.classList.toggle('schiff-gleve', activeHangarModel === 'gleve');
  }
  const previewName = document.getElementById('hangar-ship-name');
  const shipData = shipModels && shipModels[activeHangarModel];
  if (previewName) {
    previewName.textContent = (shipData && shipData.name) || 'VIPER-X INTERCEPTOR';
  }

  // Hangar Perks rendern
  const perksContainer = document.getElementById('hangar-ship-perks');
  if (perksContainer && shipData && shipData.perks && perksContainer.dataset.model !== activeHangarModel) {
    perksContainer.dataset.model = activeHangarModel;
    perksContainer.innerHTML = shipData.perks
      .map(
        (p, i) =>
          `<button type="button" class="hangar-perk-chip ${p.type === 'nerf' ? 'perk-nerf' : 'perk-buff'}" data-perk="${i}" title="${p.label}: ${p.desc}">${p.icon}</button>`,
      )
      .join('');
    showPerkDetail(-1);
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
    botControls.style.display = state.gameMode === 'coop' && isP2Hangar ? 'block' : 'none';
  }

  updateMissileLauncherVisuals();
  updateShipHudLabels();
}

// HUD-Beschriftungen je Schiff: Gleve nutzt den Energiebalken für den Laser-Sweep
// und den Raketen-Cooldown für den Dash. Sonst Originaltexte (E / R).
const HUD_LABELS = {
  standard: { energy: 'E', missile: 'R', mobileMissile: 'R' },
  gleve: { energy: 'SWEEP', missile: 'DASH', mobileMissile: 'D', lang: true },
  sniper: { energy: 'E', missile: 'GRANATE', mobileMissile: 'G', lang: true },
};

function setHudLabel(el, text, lang) {
  if (!el) return;
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle('cooldown-letter-lang', lang);
}

export function updateShipHudLabels() {
  const modelP1 = state.selectedShipModel || 'viper';
  const modelP2 = (state.p2 && state.p2.selectedShipModel) || 'phantom';
  Viper.showRollHud('p1', state);
  if (state.p2) Viper.showRollHud('p2', state.p2, isCoopMode());
  const labelsP1 = HUD_LABELS[modelP1] || HUD_LABELS.standard;
  const labelsP2 = HUD_LABELS[modelP2] || HUD_LABELS.standard;

  setHudLabel(document.querySelector('#energie-cd-container .cooldown-letter'), labelsP1.energy, modelP1 === 'gleve');
  setHudLabel(document.querySelector('#raketen-cd-container .cooldown-letter'), labelsP1.missile, !!labelsP1.lang);
  setHudLabel(
    document.querySelector('#energie-cd-container-p2 .cooldown-letter'),
    labelsP2.energy,
    modelP2 === 'gleve',
  );
  setHudLabel(document.querySelector('#raketen-cd-container-p2 .cooldown-letter'), labelsP2.missile, !!labelsP2.lang);

  // Ladungspunkte nur bei Gleve (Dash) und Sniper (Granaten); Inhalt pflegt Gleve.zeigeLadungenHud
  for (const [id, model] of [
    ['dash-ladungen', modelP1],
    ['dash-ladungen-p2', modelP2],
  ]) {
    const el = document.getElementById(id);
    if (!el) continue;
    const withCharges = model === 'gleve' || model === 'sniper';
    el.style.display = withCharges ? 'flex' : 'none';
    if (!withCharges) el.replaceChildren();
  }
  const chargeEl = document.getElementById('btn-rakete-ladungen');
  if (chargeEl) {
    const mobileGleve = localShipModel() === 'gleve' || localShipModel() === 'sniper';
    chargeEl.style.display = mobileGleve ? '' : 'none';
    if (!mobileGleve) chargeEl.textContent = '';
  }

  // Mobil-Knopf zum Aufladen nur beim Sniper (lokales Schiff)
  const chargeBtn = document.getElementById('btn-laden');
  if (chargeBtn) {
    const show = localShipModel() === 'sniper';
    chargeBtn.style.display = show ? 'flex' : 'none';
    if (!show) state.sniperChargingButton = false;
  }

  // Mobile-Raketen-Button gehört dem lokalen Spieler (Online-Client = P2)
  const mobileLabels = HUD_LABELS[localShipModel()] || HUD_LABELS.standard;
  const mobileSpan = document.querySelector('#btn-rakete span');
  if (mobileSpan && mobileSpan.textContent !== mobileLabels.mobileMissile)
    mobileSpan.textContent = mobileLabels.mobileMissile;
}

// Schiff des Spielers an diesem Gerät: Online-Client steuert P2, sonst P1
export function localShipModel() {
  const isClient = state.gameMode === 'online' && state.network && state.network.isClient;
  if (isClient) return (state.p2 && state.p2.selectedShipModel) || 'phantom';
  return state.selectedShipModel || 'viper';
}

export function createDroppedLauncher(x, y, vx, vy, vRot) {
  // Kleine Funken/Rauchwolke am Abreißpunkt
  for (let i = 0; i < 3; i++) {
    createSmokeSparks(x, y, 8);
  }

  createParticles({
    sort: 'launcher',
    x: x,
    y: y,
    vx: vx,
    vy: vy,
    rot: 0,
    vRot: vRot || (vx > 0 ? 8 : -8),
    lives: 1.0,
    decay: 0.02,
  });
}

let prevLauncherStatesP1 = null;
let prevLauncherStatesP2 = null;

// Sichtbare Raketenwerfer-Pods eines Schiffs nach Modell und Raketen-Stufe (die Anzeige zeichnet sie)
export function launcherBinding(pState) {
  const model = pState.selectedShipModel || 'viper';
  const lvl = pState.missileTier || 1;
  if (model === 'gleve' || Sniper.isSniper(pState)) {
    // Gleve (Dash) und Sniper (Granate) haben keine Raketenwerfer
    return { left: false, right: false, middle: false };
  }
  if (lvl <= 2) return { left: model !== 'phantom', right: model === 'phantom', middle: false };
  if (lvl <= 4) return { left: true, right: true, middle: false };
  return { left: true, right: true, middle: true };
}

// Abwurf-Effekt, wenn ein Pod durch ein Downgrade wegfaellt (Gleve/Sniper haben keine Pods)
function checkLauncherDrop(pState, prevKey) {
  if (!pState) return;
  const now = launcherBinding(pState);
  const beforehand = prevKey === 'p1' ? prevLauncherStatesP1 : prevLauncherStatesP2;
  if (beforehand && state.gameRunning && !pState.isDead) {
    if (beforehand.left && !now.left) {
      createDroppedLauncher(pState.x - 8, pState.y + 7, -3 - Math.random() * 2, 2 + Math.random() * 2, -10);
    }
    if (beforehand.right && !now.right) {
      createDroppedLauncher(pState.x + 31, pState.y + 7, 3 + Math.random() * 2, 2 + Math.random() * 2, 10);
    }
    if (beforehand.middle && !now.middle) {
      createDroppedLauncher(
        pState.x + 11.5,
        pState.y + 18,
        (Math.random() - 0.5) * 2,
        3 + Math.random() * 2,
        (Math.random() - 0.5) * 12,
      );
    }
  }
  if (prevKey === 'p1') prevLauncherStatesP1 = now;
  else prevLauncherStatesP2 = now;
}

export function updateMissileLauncherVisuals() {
  checkLauncherDrop(state, 'p1');
  if (state.p2) checkLauncherDrop(state.p2, 'p2');
  Display.drawPlayer();
}
