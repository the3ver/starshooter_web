import { state, dom, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Network from './network.js';
import * as Display from './anzeige.js';
import * as Shockwave from './schockwelle.js';
import * as Rock from './fels.js';

function applyPowerup(p, targetKey = 'p1') {
  const isP1 = targetKey === 'p1';
  const pState = isP1 ? state : state.p2;
  const pDom = isP1 ? dom.player : dom.player2;
  if (!pState) return;

  Audio.playPowerup(p.type);
  if (p.type === 'lives') {
    pState.lives++;
    if (isCoopMode()) {
      const otherState = isP1 ? state.p2 : state;
      if (otherState && otherState.isDead) {
        otherState.isDead = false;
        otherState.lives = 1;
        otherState.energy = otherState.maxEnergy / 2;
        otherState.invulnerableTimer = 180;
        otherState.shipVisible = true;
        Display.drawPlayer();
        if (isP1) Utils.updateLivesP2Ui();
        else Utils.updateLivesUi();
      }
    }
    if (isP1) Utils.updateLivesUi();
    else Utils.updateLivesP2Ui();
  } else if (p.type === 'energy') {
    if (pState.maxEnergy >= pState.absMaxEnergy) {
      pState.unlimitedEnergy = true;
      const marker = isP1 ? dom.maxEnergyMarker : dom.maxEnergyMarkerP2;
      if (marker) marker.style.display = 'none';
      pState.energy = pState.absMaxEnergy;
    } else {
      pState.maxEnergy = Math.min(pState.absMaxEnergy, pState.maxEnergy + 10);
      pState.energy = pState.maxEnergy;
      if (isP1) Utils.updateMaxEnergyMarker();
      else Utils.updateMaxEnergyMarkerP2();
    }
  } else if (p.type === 'pierce') {
    pState.laserPierce = true;
    pState.pierceTimer = 600;
    if (isP1) Utils.updateActivePowerupsUi();
    else Utils.updateActivePowerupsP2Ui();
  } else if (p.type === 'shield') {
    if (pState.shieldTier > 0 && pDom) pDom.classList.remove(`schild-aktiv-${pState.shieldTier}`);
    if (pState.shieldTier < 3) pState.shieldTier++;
    if (pDom) pDom.classList.add(`schild-aktiv-${pState.shieldTier}`);
    if (isP1) Utils.updateActivePowerupsUi();
    else Utils.updateActivePowerupsP2Ui();
  } else if (p.type === 'laserWeapon') {
    if (pState.laserTier < 5) {
      pState.laserTier++;
      if (isP1) Utils.updateActivePowerupsUi();
      else Utils.updateActivePowerupsP2Ui();
    }
  } else if (p.type === 'missileWeapon') {
    if (pState.missileTier < 5) {
      pState.missileTier++;
      if (isP1) Utils.updateActivePowerupsUi();
      else Utils.updateActivePowerupsP2Ui();
    }
  } else if (p.type === 'bombWeapon') {
    if (pState.bombTier < 5) {
      pState.bombTier++;
      if (isP1) Utils.updateActivePowerupsUi();
      else Utils.updateActivePowerupsP2Ui();
    }
  } else if (p.type === 'superWeapon') {
    if (pState.laserTier < 5) pState.laserTier++;
    if (pState.missileTier < 5) pState.missileTier++;
    if (pState.bombTier < 5) pState.bombTier++;
    if (isP1) Utils.updateActivePowerupsUi();
    else Utils.updateActivePowerupsP2Ui();
  } else if (p.type === 'autolaser') {
    pState.autolaserActive = true;
    pState.autolaserTimer = 600;
    if (isP1) Utils.updateActivePowerupsUi();
    else Utils.updateActivePowerupsP2Ui();
  } else if (p.type === 'shockwave') {
    Shockwave.trigger(p.x + (p.size || 24) / 2, p.y + (p.size || 24) / 2, targetKey);
  } else if (p.type === 'splitterRed') {
    pState.splitterRed = (pState.splitterRed || 0) + 1;
    if (pState.splitterRed >= 10) {
      pState.splitterRed -= 10;
      pState.lives++;
      if (isCoopMode()) {
        const otherState = isP1 ? state.p2 : state;
        if (otherState && otherState.isDead) {
          otherState.isDead = false;
          otherState.lives = 1;
          otherState.energy = otherState.maxEnergy / 2;
          otherState.invulnerableTimer = 180;
          otherState.shipVisible = true;
          Display.drawPlayer();
          if (isP1) Utils.updateLivesP2Ui();
          else Utils.updateLivesUi();
        }
      }
      if (isP1) Utils.updateLivesUi();
      else Utils.updateLivesP2Ui();
      Audio.playPowerup('lives');
    }
    if (isP1) Utils.updateSplitterUI();
    else Utils.updateSplitterP2UI();
  } else if (p.type === 'splitterWhite') {
    pState.splitterWhite = (pState.splitterWhite || 0) + 1;
    if (pState.splitterWhite >= 10) {
      pState.splitterWhite -= 10;
      if (pState.laserTier < 5) pState.laserTier++;
      if (pState.missileTier < 5) pState.missileTier++;
      if (pState.bombTier < 5) pState.bombTier++;
      if (isP1) Utils.updateActivePowerupsUi();
      else Utils.updateActivePowerupsP2Ui();
      Audio.playPowerup('superWeapon');
    }
    if (isP1) Utils.updateSplitterUI();
    else Utils.updateSplitterP2UI();
  }
  Utils.addScore(50);
  const isOnline = state.gameMode === 'online' || (state.network && state.network.isOnline);
  if (!isOnline || isP1) {
    Display.flashPlayfield(p.color, 100);
  } else if (isOnline && !isP1) {
    Network.sendNetworkEvent({ type: 'powerup_collected', target: 'p2', color: p.color });
  }
}

// Startpunkt des Traktorstrahls (Unterkante Schiffsmitte); die Anzeige zeichnet den Strahl, solange towedBy gesetzt ist
function updateTractorBeam(p, sx, sy) {
  p.beamX = sx;
  p.beamY = sy;
}

export function updatePowerups() {
  for (let i = arrays.powerups.length - 1; i >= 0; i--) {
    let p = arrays.powerups[i];

    // --- CASE A: Von Spieler 1 geschleppt ---
    if (p.towedBy === 'p1') {
      if (state.isDead) {
        p.towedBy = null;
        p.vy = 1.0;
      } else {
        const p1Towed = arrays.powerups.filter(pu => pu.towedBy === 'p1');
        const slotIdx = p1Towed.indexOf(p);
        let targetX = state.x + config.playerSize / 2 - p.size / 2;
        let targetY = state.y + config.playerSize + 16;
        if (slotIdx === 1) {
          targetX -= 18;
          targetY += 16;
        } else if (slotIdx === 2) {
          targetX += 18;
          targetY += 16;
        }

        p.x += (targetX - p.x) * 0.28;
        p.y += (targetY - p.y) * 0.28;

        updateTractorBeam(p, state.x + config.playerSize / 2, state.y + config.playerSize);

        // Übergabe an Spieler 2 prüfen
        if (
          isCoopMode() &&
          state.p2 &&
          !state.p2.isDead &&
          state.p2.x < p.x + p.size &&
          state.p2.x + config.playerSize > p.x &&
          state.p2.y < p.y + p.size &&
          state.p2.y + config.playerSize > p.y
        ) {
          applyPowerup(p, 'p2');
          Display.remove(p);
          arrays.powerups.splice(i, 1);
          continue;
        }
      }
      continue;
    }

    // --- CASE B: Von Spieler 2 geschleppt ---
    if (p.towedBy === 'p2') {
      if (state.p2 && state.p2.isDead) {
        p.towedBy = null;
        p.vy = 1.0;
      } else if (state.p2) {
        const p2Towed = arrays.powerups.filter(pu => pu.towedBy === 'p2');
        const slotIdx = p2Towed.indexOf(p);
        let targetX = state.p2.x + config.playerSize / 2 - p.size / 2;
        let targetY = state.p2.y + config.playerSize + 16;
        if (slotIdx === 1) {
          targetX -= 18;
          targetY += 16;
        } else if (slotIdx === 2) {
          targetX += 18;
          targetY += 16;
        }

        p.x += (targetX - p.x) * 0.28;
        p.y += (targetY - p.y) * 0.28;

        updateTractorBeam(p, state.p2.x + config.playerSize / 2, state.p2.y + config.playerSize);

        // Übergabe an Spieler 1 prüfen
        if (
          !state.isDead &&
          state.x < p.x + p.size &&
          state.x + config.playerSize > p.x &&
          state.y < p.y + p.size &&
          state.y + config.playerSize > p.y
        ) {
          applyPowerup(p, 'p1');
          Display.remove(p);
          arrays.powerups.splice(i, 1);
          continue;
        }
      }
      continue;
    }

    // --- CASE C: Freies Powerup (im Fels-Level gleitet es in den freien Gang) ---
    p.y += p.vy;
    if (arrays.rock.length) Rock.hoverInCorridor(p, p.size || 24);
    if (p.y > config.playfieldHeight) {
      Display.remove(p);
      arrays.powerups.splice(i, 1);
      continue;
    }

    // Prüfe Einsammeln durch Spieler 1
    const p1Col =
      !state.isDead &&
      state.x < p.x + p.size &&
      state.x + config.playerSize > p.x &&
      state.y < p.y + p.size &&
      state.y + config.playerSize > p.y;

    // Prüfe Einsammeln durch Spieler 2 (Co-op)
    const p2Col =
      isCoopMode() &&
      state.p2 &&
      !state.p2.isDead &&
      state.p2.x < p.x + p.size &&
      state.p2.x + config.playerSize > p.x &&
      state.p2.y < p.y + p.size &&
      state.p2.y + config.playerSize > p.y;

    if (p1Col) {
      if (!p.owner || p.owner === 'p1') {
        applyPowerup(p, 'p1');
        Display.remove(p);
        arrays.powerups.splice(i, 1);
        continue;
      } else if (isCoopMode() && p.owner === 'p2') {
        const p1TowedCount = arrays.powerups.filter(pu => pu.towedBy === 'p1').length;
        if (p1TowedCount < 3) {
          p.towedBy = 'p1';
          Audio.playPowerup('tether');
          updateTractorBeam(p, state.x + config.playerSize / 2, state.y + config.playerSize);
        }
      }
    } else if (p2Col) {
      if (!p.owner || p.owner === 'p2') {
        applyPowerup(p, 'p2');
        Display.remove(p);
        arrays.powerups.splice(i, 1);
        continue;
      } else if (isCoopMode() && p.owner === 'p1') {
        const p2TowedCount = arrays.powerups.filter(pu => pu.towedBy === 'p2').length;
        if (p2TowedCount < 3) {
          p.towedBy = 'p2';
          Audio.playPowerup('tether');
          updateTractorBeam(p, state.p2.x + config.playerSize / 2, state.p2.y + config.playerSize);
        }
      }
    }
  }
}
