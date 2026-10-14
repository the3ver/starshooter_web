// DOM-Backend: Aufbau der Elemente je Objektart (aus den Modellfeldern, Host und Online-Client gleich).
// Jeder Erzeuger liefert das Element; anzeige-dom.js haengt es ins Spielfeld und zeichnet es.
import { config } from './state.js';

function getFeindSVGHtml(muster = 'normal', hatSchild = false) {
  let schildHtml = hatSchild ? '<div class="feind-schild"></div>' : '';

  if (muster === 'normal' || muster === 'clingOn') {
    return `
      <svg viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; z-index: 2;">
          <path d="M15 28 L2 10 L5 5 L15 8 L25 5 L28 10 Z" fill="#71368a"/>
          <path d="M15 30 L9 10 L15 3 L21 10 Z" fill="#9b59b6"/>
          <path d="M15 22 L12 14 L15 11 L18 14 Z" fill="#f1c40f"/>
          <rect x="13" y="0" width="4" height="4" fill="#7f8c8d"/>
      </svg>
      <div class="feind-flame" style="left: 13px;"></div>
      ${schildHtml}
    `;
  } else if (muster === 'stopAndGo') {
    return `
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
  } else if (muster === 'crossfire') {
    return `
      <svg viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; z-index: 2;">
          <polygon points="15,30 0,10 10,10 15,0 20,10 30,10" fill="#1abc9c"/>
          <polygon points="15,22 8,12 22,12" fill="#16a085"/>
          <polygon points="15,18 12,12 18,12" fill="#f1c40f"/>
      </svg>
      <div class="feind-flame" style="left: 13px;"></div>
      ${schildHtml}
    `;
  } else if (muster === 'swoop') {
    return `
      <svg viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; z-index: 2;">
          <path d="M15 30 L0 5 L15 15 L30 5 Z" fill="#2ecc71"/>
          <path d="M15 25 L8 10 L22 10 Z" fill="#27ae60"/>
          <circle cx="15" cy="14" r="3" fill="#f1c40f"/>
          <rect x="13" y="0" width="4" height="6" fill="#7f8c8d"/>
      </svg>
      <div class="feind-flame" style="left: 13px;"></div>
      ${schildHtml}
    `;
  } else if (muster === 'hacker') {
    return `
      <svg viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; z-index: 2;">
          <polygon points="15,30 3,18 6,6 24,6 27,18" fill="#1e272e"/>
          <polygon points="15,26 7,17 9,9 21,9 23,17" fill="#39ff14" opacity="0.85"/>
          <circle cx="15" cy="15" r="4" fill="#1e272e"/>
          <circle cx="15" cy="15" r="2" fill="#39ff14"/>
          <line x1="8" y1="6" x2="5" y2="0" stroke="#7f8c8d" stroke-width="2"/>
          <line x1="22" y1="6" x2="25" y2="0" stroke="#7f8c8d" stroke-width="2"/>
      </svg>
      <div class="feind-flame" style="left: 13px;"></div>
    `;
  }
  return '';
}

function getBossSVGHtml(bTyp, bossFarbe) {
  let defs = `<defs>
    <radialGradient id='gMet' cx='50%' cy='30%' r='60%'><stop offset='0%' stop-color='#ffffff'/><stop offset='20%' stop-color='${bossFarbe}'/><stop offset='100%' stop-color='#222222'/></radialGradient>
    <radialGradient id='gSha' cx='50%' cy='20%' r='80%'><stop offset='0%' stop-color='${bossFarbe}'/><stop offset='70%' stop-color='#000000'/><stop offset='100%' stop-color='#000000'/></radialGradient>
    <filter id='glow' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='3' result='coloredBlur'/><feMerge><feMergeNode in='coloredBlur'/><feMergeNode in='SourceGraphic'/></feMerge></filter>
  </defs>`;

  if (bTyp === 1) {
    return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='position:absolute; width:100%; height:100%; z-index:2;'>${defs}
      <path d='M20 20 L80 20 L90 50 L70 90 L50 100 L30 90 L10 50 Z' fill='url(#gMet)' stroke='#f1c40f' stroke-width='2' stroke-linejoin='round'/>
      <path d='M22 22 L78 22 L87 49 L68 87 L50 96 L32 87 L13 49 Z' fill='none' stroke='rgba(255,255,255,0.6)' stroke-width='2'/>
      <path d='M30 30 L70 30 L75 50 L50 80 L25 50 Z' fill='#2c3e50' stroke='#34495e' stroke-width='2'/>
      <circle cx='50' cy='60' r='10' fill='#00ffff' filter='url(#glow)'/>
      <circle cx='50' cy='60' r='5' fill='#ffffff'/>
      <rect x='25' y='5' width='10' height='15' fill='#7f8c8d'/><rect x='65' y='5' width='10' height='15' fill='#7f8c8d'/>
    </svg><div class='boss-flame' style='left: 25%; top: -15%; width: 10%;'></div><div class='boss-flame' style='left: 65%; top: -15%; width: 10%;'></div>`;
  } else if (bTyp === 2) {
    return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='position:absolute; width:100%; height:100%; z-index:2;'>${defs}
      <path d='M10 30 L50 90 L90 30 L70 20 L50 35 L30 20 Z' fill='url(#gSha)' stroke='#3498db' stroke-width='2' stroke-linejoin='round'/>
      <path d='M14 32 L50 85 L86 32 L69 24 L50 39 L31 24 Z' fill='none' stroke='rgba(0,0,0,0.8)' stroke-width='3'/>
      <path d='M40 40 L50 80 L60 40 Z' fill='#1a252f'/>
      <circle cx='50' cy='65' r='8' fill='#e74c3c' filter='url(#glow)'/>
      <circle cx='50' cy='65' r='3' fill='#ffffff'/>
      <rect x='30' y='5' width='10' height='15' fill='#7f8c8d'/><rect x='60' y='5' width='10' height='15' fill='#7f8c8d'/>
    </svg><div class='boss-flame' style='left: 31%; top: -15%; width: 8%;'></div><div class='boss-flame' style='left: 61%; top: -15%; width: 8%;'></div>`;
  } else if (bTyp === 3) {
    return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='position:absolute; width:100%; height:100%; z-index:2;'>${defs}
      <polygon points='50,10 90,30 90,70 50,95 10,70 10,30' fill='url(#gMet)' stroke='#9b59b6' stroke-width='2' stroke-linejoin='round'/>
      <polygon points='50,14 86,32 86,68 50,91 14,68 14,32' fill='none' stroke='rgba(255,255,255,0.6)' stroke-width='2'/>
      <rect x='40' y='30' width='20' height='50' fill='#2c3e50' stroke='#34495e'/>
      <circle cx='30' cy='50' r='6' fill='#e74c3c' filter='url(#glow)'/>
      <circle cx='70' cy='50' r='6' fill='#e74c3c' filter='url(#glow)'/>
      <circle cx='50' cy='50' r='15' fill='#00ffff' opacity='0.3'/>
      <rect x='35' y='2' width='30' height='10' fill='#7f8c8d'/>
    </svg><div class='boss-flame' style='left: 37%; top: -15%; width: 26%;'></div>`;
  } else if (bTyp === 4) {
    return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' style='position:absolute; width:100%; height:100%; z-index:2;'>${defs}
      <rect x='10' y='20' width='80' height='60' rx='5' fill='url(#gSha)' stroke='#e67e22' stroke-width='3'/>
      <rect x='13' y='23' width='74' height='54' rx='3' fill='none' stroke='rgba(0,0,0,0.8)' stroke-width='3'/>
      <path d='M20 80 L50 95 L80 80 Z' fill='url(#gSha)' stroke='#e67e22' stroke-width='3'/>
      <rect x='20' y='30' width='60' height='40' fill='#1a252f'/>
      <circle cx='50' cy='50' r='15' fill='#e74c3c' filter='url(#glow)'/>
      <circle cx='50' cy='50' r='5' fill='#ffffff'/>
      <rect x='15' y='5' width='20' height='15' fill='#7f8c8d'/><rect x='65' y='5' width='20' height='15' fill='#7f8c8d'/>
    </svg><div class='boss-flame' style='left: 17%; top: -15%; width: 16%;'></div><div class='boss-flame' style='left: 67%; top: -15%; width: 16%;'></div>`;
  }
  return '';
}

// Powerup: Rahmen und Leuchten in p.farbe (Spieldaten), Symbol je Typ, Splitter als Kristall
const POWERUP_SYMBOL = {
  leben: '&hearts;', energie: 'E', durchschlag: '&uarr;', schild: 'O',
  laserWaffe: 'L', laser: 'L', raketenWaffe: 'R', rakete: 'R', bombenWaffe: 'B', bombe: 'B',
  autolaser: 'A', superWaffe: 'S'
};

function setupPowerupVisuals(el, type, owner, farbe) {
  el.className = 'powerup';
  if (owner) {
    el.classList.add(`pu-owner-${owner}`);
  }
  const istSplitter = (type === 'splitterRot' || type === 'splitterWeiss');
  if (type === 'superWaffe') el.style.animation = 'superWaffePulse 0.3s infinite alternate';
  if (istSplitter) el.classList.add('powerup-splitter', type === 'splitterRot' ? 'splitter-rot' : 'splitter-weiss');

  if (!istSplitter) {
    el.style.border = `2px solid ${farbe}`;
    el.style.color = farbe;
    el.style.boxShadow = `0 0 10px ${farbe}, inset 0 0 5px ${farbe}`;
  } else {
    el.style.border = 'none';
    el.style.boxShadow = 'none';
  }

  let innerHtml = '';
  if (istSplitter) {
    const isRot = type === 'splitterRot';
    const fillFarbe = isRot ? '#ff4757' : '#ffffff';
    const strokeFarbe = isRot ? '#ffa502' : '#70a1ff';
    const facetFarbe = isRot ? 'rgba(255, 255, 255, 0.45)' : 'rgba(112, 161, 255, 0.5)';
    innerHtml = `
      <svg viewBox="0 0 20 26" class="splitter-shard-svg">
        <polygon points="2,22 17,2 8,25" fill="${fillFarbe}" stroke="${strokeFarbe}" stroke-width="1.2" stroke-linejoin="round"/>
        <polygon points="17,2 8,25 6,14" fill="${facetFarbe}"/>
      </svg>
    `;
  } else {
    innerHtml = POWERUP_SYMBOL[type] || (type || 'P').substring(0, 1).toUpperCase();
  }
  if (owner) {
    innerHtml += `<span class="pu-owner-tag tag-${owner}">${owner.toUpperCase()}</span>`;
  }
  el.innerHTML = innerHtml;
}

function feindElement(f) {
  const el = document.createElement('div');
  el.classList.add('feind-schiff');
  el.style.width = f.groesse + 'px';
  el.style.height = f.groesse + 'px';
  el.innerHTML = getFeindSVGHtml(f.muster, f.hatSchild);
  el.dataset.baseColor = f.farbe;
  // Bis die Zustandsanzeige im Backend liegt, entfernt die Logik das Schild-Element ueber schildEl
  f.schildEl = f.hatSchild ? el.querySelector('.feind-schild') : null;
  return el;
}

// Asteroid: Verlauf aus farbe/farbe2, Umriss aus form (Punkte in Prozent), Risse ausser bei Magma-Brocken
function asteroidElement(a) {
  const el = document.createElement('div');
  el.classList.add('asteroid');
  if (a.istUnzerstoerbar) el.classList.add('unzerstoerbar');
  el.style.width = a.groesse + 'px';
  el.style.height = a.groesse + 'px';
  el.style.background = `radial-gradient(circle at 30% 30%, ${a.farbe}, ${a.farbe2})`;
  el.dataset.baseColor = a.farbe;
  el.style.clipPath = `polygon(${a.form.map(([px, py]) => `${px.toFixed(1)}% ${py.toFixed(1)}%`).join(', ')})`;
  a.rissEl = null;
  if (!a.istUnzerstoerbar) {
    const riss = document.createElement('div');
    riss.classList.add('riss-layer');
    riss.style.backgroundImage = `url("${config.rissMuster[a.riss || 0]}")`;
    if (a.traegtPowerup) riss.style.opacity = '0.5';
    el.appendChild(riss);
    a.rissEl = riss;
  }
  return el;
}

function bossElement(b) {
  const el = document.createElement('div');
  el.classList.add('boss-schiff');
  el.innerHTML = getBossSVGHtml(b.bossTyp, b.leuchtFarbe);
  el.style.filter = `drop-shadow(0 10px 20px rgba(0,0,0,0.9)) drop-shadow(0 0 15px ${b.leuchtFarbe})`;
  el.style.width = b.groesse + 'px';
  el.style.height = b.groesse + 'px';
  return el;
}

function powerupElement(p) {
  const el = document.createElement('div');
  setupPowerupVisuals(el, p.type, p.owner, p.farbe);
  return el;
}

function laserElement(l) {
  const el = document.createElement('div');
  el.classList.add('laser-projektil');
  if (l.owner === 'p2') el.classList.add('laser-p2');
  if (l.reflektiert) el.classList.add('gleve-reflektiert');
  el.style.backgroundColor = l.farbe;
  el.style.boxShadow = `0 0 10px ${l.farbe}`;
  el.style.width = l.width + 'px';
  el.style.height = l.height + 'px';
  return el;
}

function raketeElement(r) {
  const el = document.createElement('div');
  el.classList.add('raketen-projektil');
  if (r.stufe >= 2) el.classList.add('rakete-lvl-2');
  if (r.homing) el.classList.add('rakete-homing');
  if (r.owner === 'p2') el.classList.add('rakete-p2');
  el.innerHTML = `
    <div class="rakete-sensor"></div>
    <div class="rakete-canards"></div>
    <div class="rakete-rumpf"></div>
    <div class="rakete-fluegel"></div>
    <div class="rakete-feuer"></div>
  `;
  return el;
}

// Spielerbombe; Mini-Bomben (Jericho, Stufe 5) mit enger stehenden Lichtern
function bombeElement(b) {
  const el = document.createElement('div');
  el.classList.add('bomben-projektil', `bombe-lvl-${b.stufe}`);
  if (b.isMini) el.classList.add('bombe-mini');
  if (b.owner === 'p2') el.classList.add('bombe-p2');
  const lichter = b.isMini ? [3, 8, 13] : [4, 13, 22];
  el.innerHTML = `
    <div class="bombe-aura"></div>
    <div class="bombe-body"></div>
    ${lichter.map(top => `<div class="bombe-licht" style="top: ${top}px;"></div>`).join('')}
  `;
  const takt = b.isMini ? '0.4s' : '1s';
  el.querySelectorAll('.bombe-licht').forEach(l => { l.style.animation = `bombeBlink ${takt} infinite alternate`; });
  return el;
}

function klassenElement(klasse, html = '') {
  return () => {
    const el = document.createElement('div');
    el.classList.add(klasse);
    el.innerHTML = html;
    return el;
  };
}

const BOSS_RAKETE_HTML = `
  <svg viewBox="0 0 14 24" style="width: 100%; height: 100%;">
    <path d="M7 0 L12 8 L11 20 L3 20 L2 8 Z" fill="#c0392b" stroke="#e74c3c" stroke-width="1"/>
    <polygon points="7,1 11,8 3,8" fill="#e67e22"/>
    <polygon points="2,14 0,22 3,20" fill="#d35400"/>
    <polygon points="12,14 14,22 11,20" fill="#d35400"/>
    <circle cx="7" cy="11" r="1.5" fill="#f1c40f"/>
  </svg>
  <div class="boss-rakete-flame"></div>
`;

const BOSS_BOMBE_HTML = `
  <div class="boss-bombe-aura"></div>
  <div class="boss-bombe-body"></div>
  <div class="boss-bombe-core"></div>
`;

// Gleve-Klingenwelle: weisse Sichel mit Glow in Schiffsfarbe
function welleElement(w) {
  const el = document.createElement('div');
  el.classList.add('gleve-welle');
  el.style.width = w.breite + 'px';
  el.style.height = w.hoehe + 'px';
  el.style.boxShadow = `0 -2px 6px #ffffff, 0 -3px 12px ${w.farbe}`;
  el.style.borderTopColor = '#ffffff';
  el.style.filter = `drop-shadow(0 0 4px ${w.farbe})`;
  return el;
}

const PARTIKEL_KLASSE = {
  funke: 'partikel',
  gleveBlitz: 'gleve-blitz',
  gleveNachbild: 'gleve-nachbild',
  viperNachbild: 'viper-nachbild',
  nearMissPlus: 'viper-nearmiss-plus'
};

// Abgeworfener Raketenwerfer (dreht sich weg)
function werferElement() {
  const el = document.createElement('div');
  el.classList.add('werfer-pod', 'werfer-abgeworfen');
  el.style.position = 'absolute';
  el.style.width = '7px';
  el.style.height = '16px';
  el.style.zIndex = '6';
  el.innerHTML = `
    <div class="werfer-body" style="border-color: #e67e22; box-shadow: 0 0 8px #e67e22;">
      <div class="werfer-nozzle" style="background:#333;"></div>
      <div class="werfer-core" style="background:#e74c3c;"></div>
    </div>
  `;
  return el;
}

// Gleve: Kreissektor ueber dem Sweep-Ursprung (laenge = Radius, bogen in Grad)
function faecherElement(p) {
  const el = document.createElement('div');
  el.classList.add('gleve-faecher');
  el.style.width = (p.laenge * 2) + 'px';
  el.style.height = p.laenge + 'px';
  el.style.borderRadius = `${p.laenge}px ${p.laenge}px 0 0`;
  el.style.background = `conic-gradient(from ${-p.bogen / 2}deg at 50% 100%, ${p.farbe}99 0deg, rgba(255, 255, 255, 0.6) ${p.bogen / 2}deg, ${p.farbe}99 ${p.bogen}deg, transparent ${p.bogen}deg)`;
  return el;
}

function partikelElement(p) {
  if (p.sorte === 'werfer') return werferElement();
  if (p.sorte === 'gleveFaecher') return faecherElement(p);
  const el = document.createElement('div');
  el.classList.add(PARTIKEL_KLASSE[p.sorte || 'funke']);
  if (p.farbe) el.style.backgroundColor = p.farbe;
  if (p.groesse) {
    el.style.width = p.groesse + 'px';
    el.style.height = p.groesse + 'px';
  }
  if (p.glow) el.style.boxShadow = `0 0 5px ${p.farbe}`;
  if (p.sorte === 'nearMissPlus') el.textContent = '+';
  return el;
}

export const ERZEUGER = {
  partikel: partikelElement,
  feind: feindElement,
  asteroid: asteroidElement,
  boss: bossElement,
  powerup: powerupElement,
  laser: laserElement,
  rakete: raketeElement,
  bombe: bombeElement,
  feindLaser: klassenElement('feind-laser'),
  bossLaser: klassenElement('boss-laser'),
  bossRakete: klassenElement('boss-rakete', BOSS_RAKETE_HTML),
  bossBombe: klassenElement('boss-bombe', BOSS_BOMBE_HTML),
  hackProjektil: klassenElement('hack-projektil'),
  gleveWelle: welleElement
};
