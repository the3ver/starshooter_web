
import { state, dom, config, arrays } from './state.js';
import * as Utils from './utils.js';
import * as Input from './input.js';
import * as Loop from './loop.js';


export function generiereAsteroidPolygon() {
  let punkte = [];
  let anzahlEcken = Math.floor(Math.random() * 4) + 6;
  for (let i = 0; i < anzahlEcken; i++) {
    let winkel = i / anzahlEcken * Math.PI * 2;
    let radius = 0.7 + Math.random() * 0.3;
    let px = 50 + Math.cos(winkel) * 50 * radius;
    let py = 50 + Math.sin(winkel) * 50 * radius;
    punkte.push(`${px.toFixed(1)}% ${py.toFixed(1)}%`);
  }
  return `polygon(${punkte.join(', ')})`;
}
export function erzeugePowerup(px, py, forceType = null) {
  const puTypes = ['leben', 'energie', 'durchschlag', 'schild', 'laserWaffe', 'raketenWaffe', 'bombenWaffe'];
  if (state.laserStufe >= 5) puTypes.push('autolaser');
  const type = forceType ? forceType : puTypes[Math.floor(Math.random() * puTypes.length)];
  const el = document.createElement('div');
  el.classList.add('powerup');
  let farbe, symbol;
  if (type === 'leben') {
    farbe = '#e74c3c';
    symbol = '&hearts;';
  } else if (type === 'energie') {
    farbe = '#f1c40f';
    symbol = 'E';
  } else if (type === 'durchschlag') {
    farbe = '#00ffff';
    symbol = '&uarr;';
  } else if (type === 'schild') {
    farbe = '#3498db';
    symbol = 'O';
  } else if (type === 'laserWaffe') {
    farbe = '#9b59b6';
    symbol = 'L';
  } else if (type === 'raketenWaffe') {
    farbe = '#e67e22';
    symbol = 'R';
  } else if (type === 'bombenWaffe') {
    farbe = '#c0392b';
    symbol = 'B';
  } else if (type === 'autolaser') {
    farbe = '#f39c12';
    symbol = 'A';
  } else if (type === 'superWaffe') {
    farbe = '#ffffff';
    symbol = 'S';
    el.style.animation = 'superWaffePulse 0.3s infinite alternate';
  }
  el.style.border = `2px solid ${farbe}`;
  el.style.color = farbe;
  el.style.boxShadow = `0 0 10px ${farbe}, inset 0 0 5px ${farbe}`;
  el.innerHTML = symbol;
  el.style.left = px + 'px';
  el.style.top = py + 'px';
  dom.spielfeld.appendChild(el);
  arrays.powerups.push({
    el: el,
    x: px,
    y: py,
    groesse: 24,
    vy: 2,
    type: type,
    farbe: farbe
  });
}
export function erzeugeAsteroid(startX, startY, startGroesse, startVx, startVy, immunFrames = 0, forceDestructible = false) {
  const el = document.createElement('div');
  el.classList.add('asteroid');
  const groesse = startGroesse !== undefined ? startGroesse : Math.random() * 30 + 15;
  el.style.width = groesse + 'px';
  el.style.height = groesse + 'px';
  let istMagma = false;
  let istUnzerstoerbar = false;
  let traegtPowerup = false;
  if (!forceDestructible && Math.random() < 0.2) {
    istMagma = true;
    if (Math.random() < 0.3) {
      traegtPowerup = true;
      istUnzerstoerbar = false;
    } else {
      istUnzerstoerbar = true;
    }
  }
  if (istMagma) {
    let c = config.magmaBasisFarben[Math.floor(Math.random() * config.magmaBasisFarben.length)];
    el.style.background = `radial-gradient(circle at 30% 30%, ${c.a}, ${c.b})`;
    el.dataset.baseColor = c.a;
    el.classList.add('unzerstoerbar');
  } else {
    let c = config.asteroidenBasisFarben[Math.floor(Math.random() * config.asteroidenBasisFarben.length)];
    el.style.background = `radial-gradient(circle at 30% 30%, ${c}, #2c3e50)`;
    el.dataset.baseColor = c;
  }
  el.style.clipPath = generiereAsteroidPolygon();
  const finalX = startX !== undefined ? startX : Math.random() * (config.spielfeldBreite - groesse);
  const finalY = startY !== undefined ? startY : -groesse;
  el.style.left = finalX + 'px';
  el.style.top = finalY + 'px';
  let rissEl = null;
  if (!istUnzerstoerbar) {
    rissEl = document.createElement('div');
    rissEl.classList.add('riss-layer');
    rissEl.style.backgroundImage = `url("${config.rissMuster[Math.floor(Math.random() * config.rissMuster.length)]}")`;
    if (traegtPowerup) rissEl.style.opacity = '0.5';
    el.appendChild(rissEl);
  }
  dom.spielfeld.appendChild(el);
  let startHp = groesse * 1.2;
  if (traegtPowerup) startHp *= 3;
  let berechnetVx = startVx !== undefined ? startVx : (Math.random() - 0.5) * 4;
  // LANGSAMERE SKALIERUNG: Asteroiden fallen in höheren Leveln nur dezent schneller
  let berechnetVy = startVy !== undefined ? startVy : Math.random() * 1.5 + 1.0 + state.level * 0.1;
  if (traegtPowerup && startVx === undefined) berechnetVx = Math.random() - 0.5;
  let startRot = Math.random() * 360;
  let vRot = (Math.random() - 0.5) * 3;
  arrays.asteroiden.push({
    el: el,
    x: finalX,
    y: finalY,
    groesse: groesse,
    vx: berechnetVx,
    vy: berechnetVy,
    immune: immunFrames,
    hp: startHp,
    maxHp: startHp,
    istUnzerstoerbar: istUnzerstoerbar,
    traegtPowerup: traegtPowerup,
    rissEl: rissEl,
    istFeind: false,
    rot: startRot,
    vRot: vRot
  });
}
export function erzeugeFeind(sX, sY, forceMuster = null, forceVx = 0, forceShield = null) {
  const el = document.createElement('div');
  el.classList.add('feind-schiff');
  
  let muster = forceMuster !== null ? forceMuster : 'normal';
  let stopY = 0;
  if (forceMuster === null && state.level >= 1 && Math.random() < Math.min(0.6, state.level * 0.2)) {
    muster = 'stopAndGo';
  }
  if (muster === 'stopAndGo') {
    stopY = 80 + Math.random() * 120;
  }

  let hatSchild = false;
  if (forceShield !== null) {
    hatSchild = forceShield;
  } else if (state.level >= 3 && Math.random() < Math.min(0.5, (state.level - 2) * 0.15)) {
    hatSchild = true;
  }

  let schildHtml = hatSchild ? '<div class="feind-schild"></div>' : '';

  let svgHtml = '';
  let color = '#9b59b6';

  if (muster === 'normal' || muster === 'clingOn') {
    svgHtml = `
      <svg viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; z-index: 2;">
          <path d="M15 28 L2 10 L5 5 L15 8 L25 5 L28 10 Z" fill="#71368a"/>
          <path d="M15 30 L9 10 L15 3 L21 10 Z" fill="#9b59b6"/>
          <path d="M15 22 L12 14 L15 11 L18 14 Z" fill="#f1c40f"/>
          <rect x="13" y="0" width="4" height="4" fill="#7f8c8d"/>
      </svg>
      <div class="feind-flame" style="left: 13px;"></div>
      ${schildHtml}
    `;
    color = '#9b59b6';
  } else if (muster === 'stopAndGo') {
    svgHtml = `
      <svg viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; z-index: 2;">
          <rect x="5" y="8" width="20" height="15" fill="#d35400"/>
          <polygon points="5,23 25,23 15,30" fill="#e67e22"/>
          <polygon points="15,20 10,12 20,12" fill="#f1c40f"/>
          <rect x="10" y="0" width="4" height="8" fill="#7f8c8d"/>
          <rect x="16" y="0" width="4" height="8" fill="#7f8c8d"/>
      </svg>
      <div class="feind-flame" style="left: 10px; width: 4px;"></div>
      <div class="feind-flame" style="left: 16px; width: 4px;"></div>
      ${schildHtml}
    `;
    color = '#e67e22';
  } else if (muster === 'crossfire') {
    svgHtml = `
      <svg viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; z-index: 2;">
          <polygon points="15,30 0,10 10,10 15,0 20,10 30,10" fill="#1abc9c"/>
          <polygon points="15,22 8,12 22,12" fill="#16a085"/>
          <polygon points="15,18 12,12 18,12" fill="#f1c40f"/>
      </svg>
      <div class="feind-flame" style="left: 13px;"></div>
      ${schildHtml}
    `;
    color = '#1abc9c';
  } else if (muster === 'swoop') {
    svgHtml = `
      <svg viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; z-index: 2;">
          <path d="M15 30 L0 5 L15 15 L30 5 Z" fill="#2ecc71"/>
          <path d="M15 25 L8 10 L22 10 Z" fill="#27ae60"/>
          <circle cx="15" cy="14" r="3" fill="#f1c40f"/>
          <rect x="13" y="0" width="4" height="6" fill="#7f8c8d"/>
      </svg>
      <div class="feind-flame" style="left: 13px;"></div>
      ${schildHtml}
    `;
    color = '#2ecc71';
  }

  el.innerHTML = svgHtml;
  el.dataset.baseColor = color;
  
  const startX = sX !== undefined ? sX : Math.random() * (config.spielfeldBreite - 30);
  const startY = sY !== undefined ? sY : -30;
  el.style.left = startX + 'px';
  el.style.top = startY + 'px';
  dom.spielfeld.appendChild(el);

  let schussBasis = Math.max(25, 60 - (state.level - 1) * 8);
  arrays.feinde.push({
    el: el,
    x: startX,
    y: startY,
    groesse: 30,
    hp: 20,
    maxHp: 20,
    schildHp: hatSchild ? 20 : 0,
    maxSchildHp: hatSchild ? 20 : 0,
    schildEl: hatSchild ? el.querySelector('.feind-schild') : null,
    vy: 1.2,
    vx: forceVx,
    basisX: startX,
    zeit: 0,
    schussTimer: Math.random() * schussBasis + schussBasis,
    burstCount: 0,
    burstTimer: 0,
    istFeind: true,
    istUnzerstoerbar: false,
    traegtPowerup: Math.random() < 0.2,
    muster: muster,
    phase: 'anflug',
    stopTimer: 0,
    stopY: stopY
  });
}

export function erzeugeClingOnFeind() {
  let groesse = Math.random() * 20 + 30; // 30-50
  // Erzeuge garantiert zerstörbaren (grauen) Asteroiden
  erzeugeAsteroid(undefined, undefined, groesse, undefined, undefined, 0, true);
  let ast = arrays.asteroiden[arrays.asteroiden.length - 1]; // Zuletzt erstellter Asteroid

  // Erzeuge den Feind auf der Position des Asteroiden
  erzeugeFeind(ast.x, ast.y, 'clingOn', 0);
  let f = arrays.feinde[arrays.feinde.length - 1];
  f.attachedAsteroid = ast;
  f.phase = 'attached';
  f.schussTimer = 9999; // Schießt nicht, während er haftet
  
  // Flamme anfänglich verstecken
  let flames = f.el.querySelectorAll('.feind-flame');
  flames.forEach(fl => fl.style.display = 'none');
}
export function erzeugeFeindLaser(fx, fy, zielX = null, zielY = null) {
  const el = document.createElement('div');
  el.classList.add('feind-laser');
  el.style.left = fx + 'px';
  el.style.top = fy + 'px';
  dom.spielfeld.appendChild(el);
  let vx = 0;
  let vy = 7;
  if (zielX !== null && zielY !== null) {
    let dx = zielX - fx;
    let dy = zielY - fy;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      vx = dx / dist * 7;
      vy = dy / dist * 7;
    }
    el.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI - 90}deg)`;
  }
  arrays.feindLaserArray.push({
    el: el,
    x: fx,
    y: fy,
    vx: vx,
    vy: vy,
    width: 4,
    height: 15
  });
}

// --- BOSS SKALIERUNG & OPTIK ---
export function erzeugeBoss() {
  state.bossAktiv = true;
  dom.bossHpContainer.style.display = 'block';
  dom.bossHpBalken.style.width = '100%';
  dom.bossHpBalken.style.backgroundColor = '#e74c3c';
  const el = document.createElement('div');
  el.classList.add('boss-schiff');

  // Bestimme Boss Typ basierend auf Level
  let bTyp = state.level % 4;
  if (bTyp === 0) bTyp = 4; // 1, 2, 3, 4, 1, 2, ...

  let bossFarbe = config.bossFarben[(state.level - 1) % config.bossFarben.length];
  let rawSvg = '';
  let defs = `<defs>
    <radialGradient id='gMet' cx='50%' cy='30%' r='60%'><stop offset='0%' stop-color='#ffffff'/><stop offset='20%' stop-color='${bossFarbe}'/><stop offset='100%' stop-color='#222222'/></radialGradient>
    <radialGradient id='gSha' cx='50%' cy='20%' r='80%'><stop offset='0%' stop-color='${bossFarbe}'/><stop offset='70%' stop-color='#000000'/><stop offset='100%' stop-color='#000000'/></radialGradient>
    <filter id='glow' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='3' result='coloredBlur'/><feMerge><feMergeNode in='coloredBlur'/><feMergeNode in='SourceGraphic'/></feMerge></filter>
  </defs>`;
  let flamesHtml = '';
  if (bTyp === 1) {
    // Kreuzer (Metallic)
    rawSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='position:absolute; width:100%; height:100%; z-index:2;'>${defs}
      <path d='M20 20 L80 20 L90 50 L70 90 L50 100 L30 90 L10 50 Z' fill='url(#gMet)' stroke='#f1c40f' stroke-width='2' stroke-linejoin='round'/>
      <path d='M22 22 L78 22 L87 49 L68 87 L50 96 L32 87 L13 49 Z' fill='none' stroke='rgba(255,255,255,0.6)' stroke-width='2'/>
      <path d='M30 30 L70 30 L75 50 L50 80 L25 50 Z' fill='#2c3e50' stroke='#34495e' stroke-width='2'/>
      <circle cx='50' cy='60' r='10' fill='#00ffff' filter='url(#glow)'/>
      <circle cx='50' cy='60' r='5' fill='#ffffff'/>
      <rect x='25' y='5' width='10' height='15' fill='#7f8c8d'/><rect x='65' y='5' width='10' height='15' fill='#7f8c8d'/>
    </svg>`;
    flamesHtml = `<div class='boss-flame' style='left: 25%; top: -15%; width: 10%;'></div><div class='boss-flame' style='left: 65%; top: -15%; width: 10%;'></div>`;
  } else if (bTyp === 2) {
    // Jäger (Deep Shadow)
    rawSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='position:absolute; width:100%; height:100%; z-index:2;'>${defs}
      <path d='M10 30 L50 90 L90 30 L70 20 L50 35 L30 20 Z' fill='url(#gSha)' stroke='#3498db' stroke-width='2' stroke-linejoin='round'/>
      <path d='M14 32 L50 85 L86 32 L69 24 L50 39 L31 24 Z' fill='none' stroke='rgba(0,0,0,0.8)' stroke-width='3'/>
      <path d='M40 40 L50 80 L60 40 Z' fill='#1a252f'/>
      <circle cx='50' cy='65' r='8' fill='#e74c3c' filter='url(#glow)'/>
      <circle cx='50' cy='65' r='3' fill='#ffffff'/>
      <rect x='30' y='5' width='10' height='15' fill='#7f8c8d'/><rect x='60' y='5' width='10' height='15' fill='#7f8c8d'/>
    </svg>`;
    flamesHtml = `<div class='boss-flame' style='left: 31%; top: -15%; width: 8%;'></div><div class='boss-flame' style='left: 61%; top: -15%; width: 8%;'></div>`;
  } else if (bTyp === 3) {
    // Träger (Metallic)
    rawSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='position:absolute; width:100%; height:100%; z-index:2;'>${defs}
      <polygon points='50,10 90,30 90,70 50,95 10,70 10,30' fill='url(#gMet)' stroke='#9b59b6' stroke-width='2' stroke-linejoin='round'/>
      <polygon points='50,14 86,32 86,68 50,91 14,68 14,32' fill='none' stroke='rgba(255,255,255,0.6)' stroke-width='2'/>
      <rect x='40' y='30' width='20' height='50' fill='#2c3e50' stroke='#34495e'/>
      <circle cx='30' cy='50' r='6' fill='#e74c3c' filter='url(#glow)'/>
      <circle cx='70' cy='50' r='6' fill='#e74c3c' filter='url(#glow)'/>
      <circle cx='50' cy='50' r='15' fill='#00ffff' opacity='0.3'/>
      <rect x='35' y='2' width='30' height='10' fill='#7f8c8d'/>
    </svg>`;
    flamesHtml = `<div class='boss-flame' style='left: 37%; top: -15%; width: 26%;'></div>`;
  } else if (bTyp === 4) {
    // Festung (Deep Shadow)
    rawSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='position:absolute; width:100%; height:100%; z-index:2;'>${defs}
      <rect x='10' y='20' width='80' height='60' rx='5' fill='url(#gSha)' stroke='#e67e22' stroke-width='3'/>
      <rect x='13' y='23' width='74' height='54' rx='3' fill='none' stroke='rgba(0,0,0,0.8)' stroke-width='3'/>
      <path d='M20 80 L50 95 L80 80 Z' fill='url(#gSha)' stroke='#e67e22' stroke-width='3'/>
      <rect x='20' y='30' width='60' height='40' fill='#1a252f'/>
      <circle cx='50' cy='50' r='15' fill='#e74c3c' filter='url(#glow)'/>
      <circle cx='50' cy='50' r='5' fill='#ffffff'/>
      <rect x='15' y='5' width='20' height='15' fill='#7f8c8d'/><rect x='65' y='5' width='20' height='15' fill='#7f8c8d'/>
    </svg>`;
    flamesHtml = `<div class='boss-flame' style='left: 17%; top: -15%; width: 16%;'></div><div class='boss-flame' style='left: 67%; top: -15%; width: 16%;'></div>`;
  }
  el.innerHTML = rawSvg + flamesHtml;
  el.style.filter = `drop-shadow(0 10px 20px rgba(0,0,0,0.9)) drop-shadow(0 0 15px ${bossFarbe})`;
  let bossGroesse = 100 + (state.level - 1) * 10;
  bossGroesse = Math.min(bossGroesse, 160); // Maximale Größe deckeln
  el.style.width = bossGroesse + 'px';
  el.style.height = bossGroesse + 'px';
  let startX = config.spielfeldBreite / 2 - bossGroesse / 2;
  el.style.left = startX + 'px';
  el.style.top = '-150px';
  dom.spielfeld.appendChild(el);

  // SKALIERUNG: HP wachsen nun deutlich stärker, um mit höheren Waffenstufen mitzuhalten
  let bossHp = 400 + (state.level - 1) * 350;
  let bossVx = 2 + (state.level - 1) * 0.2;
  let schussRhythmus = Math.max(45, 90 - (state.level - 1) * 10);
  arrays.bosses.push({
    el: el,
    x: startX,
    y: -150,
    groesse: bossGroesse,
    hp: bossHp,
    maxHp: bossHp,
    vx: bossVx,
    vy: 1,
    phase: 'einzug',
    schussTimer: 60,
    baseSchussRate: schussRhythmus,
    istFeind: false,
    istBoss: true,
    istUnzerstoerbar: false,
    bossTyp: bTyp,
    enragePhaseAktiv: false
  });
}
export function erzeugeBossLaser(fx, fy, vx = 0, vy = 6) {
  const el = document.createElement('div');
  el.classList.add('boss-laser');
  el.style.left = fx + 'px';
  el.style.top = fy + 'px';
  if (vx !== 0) {
    let winkel = Math.atan2(vy, vx) * 180 / Math.PI;
    el.style.transform = `rotate(${winkel - 90}deg)`;
  }
  dom.spielfeld.appendChild(el);
  arrays.bossLaserArray.push({
    el: el,
    x: fx,
    y: fy,
    vx: vx,
    vy: vy,
    width: 8,
    height: 25
  });
}

export function erzeugeBossBombe(bx, by) {
  const el = document.createElement('div');
  el.classList.add('boss-bombe');
  el.innerHTML = `
    <div class="boss-bombe-aura"></div>
    <div class="boss-bombe-body"></div>
    <div class="boss-bombe-core"></div>
  `;
  el.style.left = bx + 'px';
  el.style.top = by + 'px';
  dom.spielfeld.appendChild(el);

  let bHp = 20 + state.level * 5;
  arrays.bossBombenArray.push({
    el: el,
    x: bx,
    y: by,
    groesse: 26,
    hp: bHp,
    maxHp: bHp,
    vx: (Math.random() - 0.5) * 0.8,
    vy: 1.3,
    timer: 180, // 3 Sekunden bis Detonation
    radius: 90,
    istBossBombe: true,
    istUnzerstoerbar: false,
    immune: 0
  });
}

export function erzeugeBossRakete(bx, by, sideDirection = 1) {
  const el = document.createElement('div');
  el.classList.add('boss-rakete');
  el.innerHTML = `
    <svg viewBox="0 0 14 24" style="width: 100%; height: 100%;">
      <path d="M7 0 L12 8 L11 20 L3 20 L2 8 Z" fill="#c0392b" stroke="#e74c3c" stroke-width="1"/>
      <polygon points="7,1 11,8 3,8" fill="#e67e22"/>
      <polygon points="2,14 0,22 3,20" fill="#d35400"/>
      <polygon points="12,14 14,22 11,20" fill="#d35400"/>
      <circle cx="7" cy="11" r="1.5" fill="#f1c40f"/>
    </svg>
    <div class="boss-rakete-flame"></div>
  `;
  el.style.left = bx + 'px';
  el.style.top = by + 'px';
  dom.spielfeld.appendChild(el);

  let initVx = sideDirection * (3.0 + Math.random() * 1.0);
  let initVy = 0.8 + Math.random() * 0.4;
  let rHp = 15;
  arrays.bossRaketenArray.push({
    el: el,
    x: bx,
    y: by,
    groesse: 18,
    width: 14,
    height: 24,
    hp: rHp,
    maxHp: rHp,
    vx: initVx,
    vy: initVy,
    turnRate: 0.045,
    speed: 2.3,
    age: 0,
    istBossRakete: true,
    istUnzerstoerbar: false,
    immune: 0
  });
}
// ------------------------------