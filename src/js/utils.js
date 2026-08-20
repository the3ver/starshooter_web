
import { state, dom, config, arrays, shipColors, shipModels } from './state.js';
import * as Entities from './entities.js';
import * as Input from './input.js';
import * as Loop from './loop.js';


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
export function zerstoereZiel(ziel) {
  let fIndex = arrays.feinde.indexOf(ziel);
  let aIndex = arrays.asteroiden.indexOf(ziel);
  let bIndex = arrays.bosses.indexOf(ziel);
  if (fIndex === -1 && aIndex === -1 && bIndex === -1) return;

  // Boss Logik beim Zerstören
  if (ziel.istBoss) {
    addScore(1000 * state.level);
    erzeugeExplosion(ziel.x + ziel.groesse / 2, ziel.y + ziel.groesse / 2, '#f1c40f', 50);

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

    state.bossAktiv = false;
    state.level++;
    updateLevelUI();
    dom.bossHpContainer.style.display = 'none';
    state.frameZaehler = 0; // Setzt Level-Timer zurück
  } else {
    addScore(ziel.istFeind ? 100 : ziel.traegtPowerup ? 50 : ziel.groesse >= 35 ? 20 : 10);
    if (ziel.istFeind) {
      const currentShip = shipModels && shipModels[state.selectedShipModel || 'viper'];
      const energyGain = (currentShip && currentShip.energyPerKill) || 0;
      if (energyGain > 0) {
        state.energie = Math.min(state.maxEnergie, state.energie + energyGain);
        if (dom.energieBalken) dom.energieBalken.style.width = state.energie / state.absMaxEnergie * 100 + '%';
      }
    }
    let farbe = ziel.istFeind ? '#9b59b6' : ziel.el.dataset.baseColor || ziel.el.style.backgroundColor || '#ffffff';
    erzeugeExplosion(ziel.x + ziel.groesse / 2, ziel.y + ziel.groesse / 2, farbe, 25);
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
export function spielerGetroffen(kollisionsObjekt, explodiert = true) {
  if (state.godMode || state.invulnerableTimer > 0) return;
  
  state.invulnerableTimer = 90;
  dom.spieler.classList.add('spieler-blink');

  if (state.schildStufe > 0) {
    dom.spieler.classList.remove(`schild-aktiv-${state.schildStufe}`);
    state.schildStufe--;
    if (state.schildStufe > 0) dom.spieler.classList.add(`schild-aktiv-${state.schildStufe}`);
    if (state.schildStufe === 0 && state.selectedShipModel === 'phantom') {
      state.phantomSchildRegenTimer = 0;
    }
    updateAktivePowerupsUI();
    if (explodiert) {
      let c = kollisionsObjekt.istFeind ? '#9b59b6' : kollisionsObjekt.el.dataset.baseColor || kollisionsObjekt.el.style.backgroundColor || '#7f8c8d';
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
  if (explodiert && !kollisionsObjekt.istBoss) {
    let c = kollisionsObjekt.istFeind ? '#9b59b6' : kollisionsObjekt.el.dataset.baseColor || kollisionsObjekt.el.style.backgroundColor || '#7f8c8d';
    erzeugeExplosion(kollisionsObjekt.x + (kollisionsObjekt.groesse || 4) / 2, kollisionsObjekt.y + (kollisionsObjekt.groesse || 15) / 2, c, 10);
  }
  if (state.leben <= 0) {
    state.gameOverAktiv = true;
    state.finalerScore = state.cheatUsed ? 0 : state.score;
    document.getElementById('final-score').innerText = state.finalerScore;
    document.getElementById('game-over-screen').style.display = 'flex';
    let hs = getHighscores();
    if (hs.length < 10 || state.finalerScore > hs[hs.length - 1].score) {
      document.getElementById('highscore-form').style.display = 'block';
      const hsInput = document.getElementById('highscore-name');
      if (hsInput) {
        hsInput.value = '';
        setTimeout(() => {
          hsInput.focus();
        }, 50);
      }
    } else {
      document.getElementById('highscore-form').style.display = 'none';
    }
    renderHighscores();
    updateMobileControlsVisibility();
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
  updateLebenUI();
  updateMaxEnergieMarker();
  updateAktivePowerupsUI();
  updateLevelUI();
  state.x = 185;
  state.y = 285;
  dom.spieler.style.left = state.x + 'px';
  dom.spieler.style.top = state.y + 'px';
  dom.spieler.setAttribute('data-rotate', '0');
  dom.spieler.style.transform = 'rotate(0deg)';
  
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
  clearArray(arrays.powerups);
  clearArray(arrays.partikelArray);
  clearArray(arrays.laserArray);
  clearArray(arrays.raketenArray);
  clearArray(arrays.bombenArray);
  clearArray(arrays.explosionenArray);

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
  
  for (let key in state.tastenGedrueckt) {
    state.tastenGedrueckt[key] = false;
  }
  
  let startScreen = document.getElementById('start-screen');
  if (startScreen) startScreen.style.display = 'block';
  updatePlayerShipVisuals();
  updateMobileControlsVisibility();
}
export
// --- HIGHSCORE LOGIK ---
function getHighscores() {
  let hs = localStorage.getItem('spaceShooterHighscores');
  return hs ? JSON.parse(hs) : [];
}
export function saveHighscore(name, scoreValue) {
  let hs = getHighscores();
  hs.push({
    name: name.toUpperCase(),
    score: scoreValue
  });
  hs.sort((a, b) => b.score - a.score);
  localStorage.setItem('spaceShooterHighscores', JSON.stringify(hs.slice(0, 10)));
}
export function renderHighscores() {
  let hs = getHighscores();
  const tbody = document.getElementById('highscore-body');
  tbody.innerHTML = '';
  if (hs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2">- Keine Einträge -</td></tr>';
  } else {
    hs.forEach(entry => {
      tbody.innerHTML += `<tr><td>${entry.name}</td><td>${entry.score}</td></tr>`;
    });
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

export function updatePlayerShipVisuals() {
  const model = state.selectedShipModel || 'viper';
  const colorId = state.selectedShipColor || 'red';
  const svgContent = getShipSVGContent(model, colorId);

  // In-Game Schiff SVG aktualisieren
  const spielerSvg = dom.spieler ? dom.spieler.querySelector('svg') : document.querySelector('#spieler svg');
  if (spielerSvg) {
    spielerSvg.innerHTML = svgContent;
  }

  // Hangar Preview im Startscreen aktualisieren
  const previewSvg = document.getElementById('hangar-preview-svg');
  if (previewSvg) {
    previewSvg.innerHTML = svgContent;
  }
  const previewName = document.getElementById('hangar-ship-name');
  const shipData = shipModels && shipModels[model];
  if (previewName) {
    previewName.textContent = (shipData && shipData.name) || (model === 'phantom' ? 'PHANTOM-NX STRIKER' : 'VIPER-X INTERCEPTOR');
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

  // Active Klassen auf Hangar Buttons aktualisieren
  document.querySelectorAll('.hangar-model-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-model') === model);
  });
  document.querySelectorAll('.hangar-color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-color') === colorId);
  });

  updateRaketenWerferVisuals();
}

let prevWerferStates = null;

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

export function updateRaketenWerferVisuals() {
  const model = state.selectedShipModel || 'viper';
  const lvl = state.raketenStufe || 1;

  const spielerEl = dom.spieler || document.getElementById('spieler');
  if (!spielerEl) return;

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

  // Prüfen, ob Werfer durch Downgrade verloren gingen
  if (prevWerferStates) {
    if (prevWerferStates.left && !showLeft) {
      erzeugeAbgeworfenenWerfer(state.x - 8, state.y + 7, -3 - Math.random() * 2, 2 + Math.random() * 2, -10);
    }
    if (prevWerferStates.right && !showRight) {
      erzeugeAbgeworfenenWerfer(state.x + 31, state.y + 7, 3 + Math.random() * 2, 2 + Math.random() * 2, 10);
    }
    if (prevWerferStates.center && !showCenter) {
      erzeugeAbgeworfenenWerfer(state.x + 11.5, state.y + 18, (Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 12);
    }
  }

  prevWerferStates = {
    left: showLeft,
    right: showRight,
    center: showCenter
  };

  werferLinks.style.display = showLeft ? 'block' : 'none';
  werferRechts.style.display = showRight ? 'block' : 'none';
  werferCenter.style.display = showCenter ? 'block' : 'none';

  // Stufen-Klassen für Visuals aktualisieren
  [werferLinks, werferRechts, werferCenter].forEach(w => {
    w.classList.remove('werfer-lvl-1', 'werfer-lvl-2', 'werfer-lvl-3', 'werfer-lvl-4', 'werfer-lvl-5');
    w.classList.add(`werfer-lvl-${Math.min(5, Math.max(1, lvl))}`);
  });
}