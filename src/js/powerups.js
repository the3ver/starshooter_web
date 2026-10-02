
import { state, dom, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Network from './network.js';


function wendePowerupAn(p, targetKey = 'p1') {
  const isP1 = targetKey === 'p1';
  const pState = isP1 ? state : state.p2;
  const pDom = isP1 ? dom.spieler : dom.spieler2;
  if (!pState) return;

  Audio.playPowerup(p.type);
  if (p.type === 'leben') {
    pState.leben++;
    if (isCoopMode()) {
      const otherState = isP1 ? state.p2 : state;
      const otherDom = isP1 ? dom.spieler2 : dom.spieler;
      if (otherState && otherState.isDead) {
        otherState.isDead = false;
        otherState.leben = 1;
        otherState.energie = otherState.maxEnergie / 2;
        otherState.invulnerableTimer = 180;
        if (otherDom) {
          otherDom.style.display = 'block';
          otherDom.classList.add('spieler-blink');
        }
        if (isP1) Utils.updateLebenP2UI();
        else Utils.updateLebenUI();
      }
    }
    if (isP1) Utils.updateLebenUI();
    else Utils.updateLebenP2UI();
  } else if (p.type === 'energie') {
    if (pState.maxEnergie >= pState.absMaxEnergie) {
      pState.unbegrenzteEnergie = true;
      const marker = isP1 ? dom.maxEnergieMarker : dom.maxEnergieMarkerP2;
      if (marker) marker.style.display = 'none';
      pState.energie = pState.absMaxEnergie;
    } else {
      pState.maxEnergie = Math.min(pState.absMaxEnergie, pState.maxEnergie + 10);
      pState.energie = pState.maxEnergie;
      if (isP1) Utils.updateMaxEnergieMarker();
      else Utils.updateMaxEnergieMarkerP2();
    }
  } else if (p.type === 'durchschlag') {
    pState.laserDurchschlag = true;
    pState.durchschlagTimer = 600;
    if (isP1) Utils.updateAktivePowerupsUI();
    else Utils.updateAktivePowerupsP2UI();
  } else if (p.type === 'schild') {
    if (pState.schildStufe > 0 && pDom) pDom.classList.remove(`schild-aktiv-${pState.schildStufe}`);
    if (pState.schildStufe < 3) pState.schildStufe++;
    if (pDom) pDom.classList.add(`schild-aktiv-${pState.schildStufe}`);
    if (isP1) Utils.updateAktivePowerupsUI();
    else Utils.updateAktivePowerupsP2UI();
  } else if (p.type === 'laserWaffe') {
    if (pState.laserStufe < 5) {
      pState.laserStufe++;
      if (isP1) Utils.updateAktivePowerupsUI();
      else Utils.updateAktivePowerupsP2UI();
    }
  } else if (p.type === 'raketenWaffe') {
    if (pState.raketenStufe < 5) {
      pState.raketenStufe++;
      if (isP1) Utils.updateAktivePowerupsUI();
      else Utils.updateAktivePowerupsP2UI();
    }
  } else if (p.type === 'bombenWaffe') {
    if (pState.bombenStufe < 5) {
      pState.bombenStufe++;
      if (isP1) Utils.updateAktivePowerupsUI();
      else Utils.updateAktivePowerupsP2UI();
    }
  } else if (p.type === 'superWaffe') {
    if (pState.laserStufe < 5) pState.laserStufe++;
    if (pState.raketenStufe < 5) pState.raketenStufe++;
    if (pState.bombenStufe < 5) pState.bombenStufe++;
    if (isP1) Utils.updateAktivePowerupsUI();
    else Utils.updateAktivePowerupsP2UI();
  } else if (p.type === 'autolaser') {
    pState.autolaserAktiv = true;
    pState.autolaserTimer = 600;
    if (isP1) Utils.updateAktivePowerupsUI();
    else Utils.updateAktivePowerupsP2UI();
  } else if (p.type === 'splitterRot') {
    pState.splitterRot = (pState.splitterRot || 0) + 1;
    if (pState.splitterRot >= 10) {
      pState.splitterRot -= 10;
      pState.leben++;
      if (isCoopMode()) {
        const otherState = isP1 ? state.p2 : state;
        const otherDom = isP1 ? dom.spieler2 : dom.spieler;
        if (otherState && otherState.isDead) {
          otherState.isDead = false;
          otherState.leben = 1;
          otherState.energie = otherState.maxEnergie / 2;
          otherState.invulnerableTimer = 180;
          if (otherDom) {
            otherDom.style.display = 'block';
            otherDom.classList.add('spieler-blink');
          }
          if (isP1) Utils.updateLebenP2UI();
          else Utils.updateLebenUI();
        }
      }
      if (isP1) Utils.updateLebenUI();
      else Utils.updateLebenP2UI();
      Audio.playPowerup('leben');
    }
    if (isP1) Utils.updateSplitterUI();
    else Utils.updateSplitterP2UI();
  } else if (p.type === 'splitterWeiss') {
    pState.splitterWeiss = (pState.splitterWeiss || 0) + 1;
    if (pState.splitterWeiss >= 10) {
      pState.splitterWeiss -= 10;
      if (pState.laserStufe < 5) pState.laserStufe++;
      if (pState.raketenStufe < 5) pState.raketenStufe++;
      if (pState.bombenStufe < 5) pState.bombenStufe++;
      if (isP1) Utils.updateAktivePowerupsUI();
      else Utils.updateAktivePowerupsP2UI();
      Audio.playPowerup('superWaffe');
    }
    if (isP1) Utils.updateSplitterUI();
    else Utils.updateSplitterP2UI();
  }
  Utils.addScore(50);
  const isOnline = state.gameMode === 'online' || (state.network && state.network.isOnline);
  if (!isOnline || isP1) {
    if (dom.spielfeld) {
      dom.spielfeld.style.backgroundColor = p.farbe;
      setTimeout(() => {
        if (dom.spielfeld) dom.spielfeld.style.backgroundColor = '#0b1319';
      }, 100);
    }
  } else if (isOnline && !isP1) {
    Network.sendNetworkEvent({ type: 'powerup_collected', target: 'p2', farbe: p.farbe });
  }
}

function updateTractorBeam(p, sx, sy) {
  zeichneTraktorstrahl(p, sx, sy, p.x + p.groesse / 2, p.y + p.groesse / 2);
}

// Entfernt den Strahl eines Powerups (falls vorhanden)
export function entferneTraktorstrahl(p) {
  if (p.beamEl) {
    p.beamEl.remove();
    p.beamEl = null;
  }
}

// Zeichnet den Traktorstrahl vom Schiff (sx, sy) zum Powerup (px, py), ohne Spiellogik.
// Host und Online-Client nutzen dieselbe Darstellung; die Farbe richtet sich nach p.towedBy.
export function zeichneTraktorstrahl(p, sx, sy, px, py) {
  const spielfeld = dom.spielfeld || document.getElementById('spielfeld');
  if (!spielfeld) return;

  if (!p.beamEl) {
    const beamSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    beamSvg.setAttribute('class', 'tractor-beam-svg');
    beamSvg.style.position = 'absolute';
    beamSvg.style.top = '0';
    beamSvg.style.left = '0';
    beamSvg.style.width = '100%';
    beamSvg.style.height = '100%';
    beamSvg.style.pointerEvents = 'none';
    beamSvg.style.zIndex = '6';

    const lineGlow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    lineGlow.setAttribute('class', 'tractor-beam-glow');
    lineGlow.setAttribute('stroke', p.towedBy === 'p1' ? '#3498db' : '#2ecc71');
    lineGlow.setAttribute('stroke-width', '4');
    lineGlow.setAttribute('opacity', '0.45');

    const lineCore = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    lineCore.setAttribute('class', 'tractor-beam-core');
    lineCore.setAttribute('stroke', '#ffffff');
    lineCore.setAttribute('stroke-width', '1.5');
    lineCore.setAttribute('stroke-dasharray', '3 2');

    beamSvg.appendChild(lineGlow);
    beamSvg.appendChild(lineCore);
    spielfeld.appendChild(beamSvg);
    p.beamEl = beamSvg;
  }

  const lines = p.beamEl.querySelectorAll('line');
  lines.forEach(l => {
    l.setAttribute('x1', sx);
    l.setAttribute('y1', sy);
    l.setAttribute('x2', px);
    l.setAttribute('y2', py);
  });
}

export function aktualisierePowerups() {
  for (let i = arrays.powerups.length - 1; i >= 0; i--) {
    let p = arrays.powerups[i];

    // --- CASE A: Von Spieler 1 geschleppt ---
    if (p.towedBy === 'p1') {
      if (state.isDead) {
        p.towedBy = null;
        if (p.beamEl) { p.beamEl.remove(); p.beamEl = null; }
        p.el.classList.remove('powerup-towed', 'powerup-towed-p1', 'powerup-towed-p2');
        p.vy = 1.0;
      } else {
        const p1Towed = arrays.powerups.filter(pu => pu.towedBy === 'p1');
        const slotIdx = p1Towed.indexOf(p);
        let targetX = state.x + config.spielerGroesse / 2 - p.groesse / 2;
        let targetY = state.y + config.spielerGroesse + 16;
        if (slotIdx === 1) { targetX -= 18; targetY += 16; }
        else if (slotIdx === 2) { targetX += 18; targetY += 16; }

        p.x += (targetX - p.x) * 0.28;
        p.y += (targetY - p.y) * 0.28;
        p.el.style.left = p.x + 'px';
        p.el.style.top = p.y + 'px';

        updateTractorBeam(p, state.x + config.spielerGroesse / 2, state.y + config.spielerGroesse);

        // Übergabe an Spieler 2 prüfen
        if (isCoopMode() && state.p2 && !state.p2.isDead &&
            state.p2.x < p.x + p.groesse && state.p2.x + config.spielerGroesse > p.x &&
            state.p2.y < p.y + p.groesse && state.p2.y + config.spielerGroesse > p.y) {
          if (p.beamEl) { p.beamEl.remove(); p.beamEl = null; }
          wendePowerupAn(p, 'p2');
          p.el.remove();
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
        if (p.beamEl) { p.beamEl.remove(); p.beamEl = null; }
        p.el.classList.remove('powerup-towed', 'powerup-towed-p1', 'powerup-towed-p2');
        p.vy = 1.0;
      } else if (state.p2) {
        const p2Towed = arrays.powerups.filter(pu => pu.towedBy === 'p2');
        const slotIdx = p2Towed.indexOf(p);
        let targetX = state.p2.x + config.spielerGroesse / 2 - p.groesse / 2;
        let targetY = state.p2.y + config.spielerGroesse + 16;
        if (slotIdx === 1) { targetX -= 18; targetY += 16; }
        else if (slotIdx === 2) { targetX += 18; targetY += 16; }

        p.x += (targetX - p.x) * 0.28;
        p.y += (targetY - p.y) * 0.28;
        p.el.style.left = p.x + 'px';
        p.el.style.top = p.y + 'px';

        updateTractorBeam(p, state.p2.x + config.spielerGroesse / 2, state.p2.y + config.spielerGroesse);

        // Übergabe an Spieler 1 prüfen
        if (!state.isDead &&
            state.x < p.x + p.groesse && state.x + config.spielerGroesse > p.x &&
            state.y < p.y + p.groesse && state.y + config.spielerGroesse > p.y) {
          if (p.beamEl) { p.beamEl.remove(); p.beamEl = null; }
          wendePowerupAn(p, 'p1');
          p.el.remove();
          arrays.powerups.splice(i, 1);
          continue;
        }
      }
      continue;
    }

    // --- CASE C: Freies Powerup ---
    p.y += p.vy;
    p.el.style.top = p.y + 'px';
    if (p.y > config.spielfeldHoehe) {
      if (p.beamEl) p.beamEl.remove();
      p.el.remove();
      arrays.powerups.splice(i, 1);
      continue;
    }

    // Prüfe Einsammeln durch Spieler 1
    const p1Col = !state.isDead &&
      state.x < p.x + p.groesse && state.x + config.spielerGroesse > p.x &&
      state.y < p.y + p.groesse && state.y + config.spielerGroesse > p.y;

    // Prüfe Einsammeln durch Spieler 2 (Co-op)
    const p2Col = isCoopMode() && state.p2 && !state.p2.isDead &&
      state.p2.x < p.x + p.groesse && state.p2.x + config.spielerGroesse > p.x &&
      state.p2.y < p.y + p.groesse && state.p2.y + config.spielerGroesse > p.y;

    if (p1Col) {
      if (!p.owner || p.owner === 'p1') {
        wendePowerupAn(p, 'p1');
        p.el.remove();
        arrays.powerups.splice(i, 1);
        continue;
      } else if (isCoopMode() && p.owner === 'p2') {
        const p1TowedCount = arrays.powerups.filter(pu => pu.towedBy === 'p1').length;
        if (p1TowedCount < 3) {
          p.towedBy = 'p1';
          p.el.classList.add('powerup-towed', 'powerup-towed-p1');
          Audio.playPowerup('tether');
          updateTractorBeam(p, state.x + config.spielerGroesse / 2, state.y + config.spielerGroesse);
        }
      }
    } else if (p2Col) {
      if (!p.owner || p.owner === 'p2') {
        wendePowerupAn(p, 'p2');
        p.el.remove();
        arrays.powerups.splice(i, 1);
        continue;
      } else if (isCoopMode() && p.owner === 'p1') {
        const p2TowedCount = arrays.powerups.filter(pu => pu.towedBy === 'p2').length;
        if (p2TowedCount < 3) {
          p.towedBy = 'p2';
          p.el.classList.add('powerup-towed', 'powerup-towed-p2');
          Audio.playPowerup('tether');
          updateTractorBeam(p, state.p2.x + config.spielerGroesse / 2, state.p2.y + config.spielerGroesse);
        }
      }
    }
  }
}
