// DOM-Backend: Aufbau der Elemente je Objektart (aus den Modellfeldern, Host und Online-Client gleich).
// Jeder Erzeuger liefert das Element; anzeige-dom.js haengt es ins Spielfeld und zeichnet es.
import { config, shipColors } from './state.js';

// Kettenglied (Vorwaerts = unten, wie bei den Jaegern): Panzerring mit Auge und seitlichen Stacheln;
// der Kopf (groesser) laeuft vorne spitz zu
function getKettenSVGHtml(istKopf) {
  const stacheln = `<path d="M1 15 L-3 13 L1 11 Z M29 15 L33 13 L29 11 Z M2 21 L-2 21 L3 18 Z M28 21 L32 21 L27 18 Z" fill="#c9ced6"/>`;
  if (istKopf) {
    return `
      <svg class="ketten-koerper" viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
          ${stacheln}
          <path d="M3 8 Q15 0 27 8 L24 22 L15 31 L6 22 Z" fill="#8c4416"/>
          <path d="M6 9 Q15 3 24 9 L21 20 L15 27 L9 20 Z" fill="#d9822b"/>
          <path d="M11 20 L15 31 L19 20 Z" fill="#c9ced6"/>
          <circle cx="15" cy="13" r="4.5" fill="#2b0f05"/>
          <circle cx="16.3" cy="11.8" r="1.4" fill="#ffd27a"/>
      </svg>
    `;
  }
  return `
    <svg class="ketten-koerper" viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
        ${stacheln}
        <rect x="2" y="4" width="26" height="22" rx="9" fill="#7d8591"/>
        <rect x="4" y="6" width="22" height="18" rx="8" fill="#d9822b"/>
        <path d="M4 10 H26 M4 20 H26" stroke="#8c4416" stroke-width="2"/>
        <circle cx="15" cy="15" r="4" fill="#2b0f05"/>
        <circle cx="16.2" cy="14" r="1.2" fill="#ffd27a"/>
    </svg>
  `;
}

// Gewaechse (Vorwaerts = unten, Ansatz am Fels = oben): Tentakelbluete mit Kappe (zu) und leuchtendem Schlund
// (Klasse offen), Hornroehre, Eierkapsel
const GEWAECHS_SVG = {
  bluete: () => {
    let tentakel = '';
    for (let i = 0; i < 12; i++) {
      const w = (i * Math.PI * 2) / 12;
      const x = (15 + Math.cos(w) * 12).toFixed(1);
      const y = (16 + Math.sin(w) * 12).toFixed(1);
      tentakel += `<circle cx="${x}" cy="${y}" r="2.6" fill="#f1c40f" stroke="#8a5a00" stroke-width="0.8"/>`;
    }
    return `
      <svg class="gewaechs" viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
        <path d="M10 0 Q15 8 20 0 Z" fill="#5a3a2a"/>
        ${tentakel}
        <circle cx="15" cy="16" r="10.5" fill="#a0391b"/>
        <circle class="bluete-mund" cx="15" cy="16" r="6" fill="#ffb347"/>
        <g class="bluete-kappe">
          <path d="M15 16 L5 9 Q8 5 13 6 Z M15 16 L25 9 Q22 5 17 6 Z M15 16 L5 23 Q8 27 13 26 Z M15 16 L25 23 Q22 27 17 26 Z" fill="#6e2410" stroke="#3a1206" stroke-width="0.8"/>
        </g>
      </svg>
    `;
  },
  trichter: () => `
    <svg class="gewaechs" viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
      <path d="M11 0 L19 0 L25 21 Q15 30 5 21 Z" fill="#d9822b" stroke="#7a3b12" stroke-width="1"/>
      <path d="M8 9 Q15 12 22 9 M7 14 Q15 17 23 14 M6 19 Q15 22 24 19" stroke="#7a3b12" stroke-width="1.4" fill="none"/>
      <ellipse class="trichter-mund" cx="15" cy="23" rx="9" ry="4.5" fill="#3a1a08" stroke="#f0b36a" stroke-width="1"/>
    </svg>
  `,
  roehre: () => `
    <svg class="gewaechs" viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
      <path d="M9 0 L21 0 L26 20 Q15 31 4 20 Z" fill="#c0602a" stroke="#5a2410" stroke-width="1.2"/>
      <path d="M7 7 H23 M6 12 H24 M5 17 H25" stroke="#5a2410" stroke-width="1.6"/>
      <ellipse cx="15" cy="22" rx="10" ry="5" fill="#200a02" stroke="#f0b36a" stroke-width="1.2"/>
    </svg>
  `,
  larve: () => `
    <svg class="gewaechs" viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
      <ellipse cx="15" cy="15" rx="9" ry="13" fill="#e8b04a" stroke="#7a4a10" stroke-width="1.2"/>
      <path d="M7 9 H23 M6 14 H24 M7 19 H23" stroke="#7a4a10" stroke-width="1.2"/>
      <circle cx="12" cy="25" r="1.6" fill="#200a02"/><circle cx="18" cy="25" r="1.6" fill="#200a02"/>
    </svg>
  `,
  kapsel: () => `
    <svg class="gewaechs" viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
      <ellipse cx="15" cy="16" rx="11" ry="13" fill="#b5a36a" stroke="#5e5230" stroke-width="1.4"/>
      <path d="M15 4 Q12 12 15 16 Q18 21 15 29" stroke="#5e5230" stroke-width="1" fill="none"/>
      <circle cx="10" cy="12" r="2" fill="#7d7040"/><circle cx="20" cy="19" r="2.4" fill="#7d7040"/>
      <ellipse cx="11" cy="9" rx="3" ry="1.6" fill="#efe3b0" opacity="0.7"/>
    </svg>
  `,
};

// Organische Gegner (Vorwaerts = unten): Stachelkette (gepanzert, Stacheln), Kugelkette (Blasenglieder, Glieder
// mit Leuchtblase), Krabbe (Panzer, Scheren, Stielaugen, krabbelnde Beine), Tentakler (Schirm, wehende Tentakel)
const STACHELN = Array.from({ length: 8 }, (_, i) => {
  const w = (i * Math.PI) / 4;
  const p = (r, d) => `${(15 + Math.cos(w + d) * r).toFixed(1)},${(15 + Math.sin(w + d) * r).toFixed(1)}`;
  return `<polygon points="${p(10, -0.28)} ${p(16.5, 0)} ${p(10, 0.28)}" fill="#c8cfa6" stroke="#3c4628" stroke-width="0.8"/>`;
}).join('');
const BIO_SVG = {
  stachelkette: istKopf => `
    <svg class="ketten-koerper" viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
      ${STACHELN}
      <circle cx="15" cy="15" r="11" fill="#55633c" stroke="#2b3420" stroke-width="1.5"/>
      <path d="M6 12 Q15 7 24 12 M6 18 Q15 13 24 18" stroke="#8a9a64" stroke-width="2" fill="none"/>
      ${istKopf ? '<path d="M9 22 L12 29 L14 22 Z M21 22 L18 29 L16 22 Z" fill="#e8e2c0"/><circle cx="11" cy="17" r="2.2" fill="#ffcf3a"/><circle cx="19" cy="17" r="2.2" fill="#ffcf3a"/>' : ''}
    </svg>`,
  kugelkette: (istKopf, istPod) => `
    <svg class="ketten-koerper" viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
      <ellipse cx="15" cy="15" rx="13" ry="12" fill="#5e3a86" stroke="#2a1640" stroke-width="1.5"/>
      <ellipse cx="15" cy="13" rx="9" ry="6" fill="#8d62c0" opacity="0.8"/>
      ${istPod ? '<circle class="kugel-blase" cx="15" cy="16" r="6.5" fill="#f4d8ff"/>' : ''}
      ${istKopf ? '<path d="M8 22 Q15 32 22 22" fill="#2a1640"/><circle cx="10" cy="12" r="2.4" fill="#ffe680"/><circle cx="20" cy="12" r="2.4" fill="#ffe680"/>' : ''}
    </svg>`,
  krabbe: () => `
    <svg viewBox="0 0 34 34" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
      <g class="krabbe-beine" stroke="#7a2a10" stroke-width="2.2" stroke-linecap="round" fill="none">
        <path d="M8 12 L1 8 L-2 12 M7 17 L0 17 L-3 21 M8 22 L2 26 L0 31"/>
        <path d="M26 12 L33 8 L36 12 M27 17 L34 17 L37 21 M26 22 L32 26 L34 31"/>
      </g>
      <path d="M9 24 Q4 31 8 34 Q11 30 13 28 M25 24 Q30 31 26 34 Q23 30 21 28" fill="#e0683a" stroke="#7a2a10" stroke-width="1.2"/>
      <ellipse cx="17" cy="16" rx="11" ry="9" fill="#d0532a" stroke="#7a2a10" stroke-width="1.5"/>
      <circle cx="13" cy="13" r="1.8" fill="#f0a070"/><circle cx="21" cy="14" r="1.4" fill="#f0a070"/><circle cx="17" cy="10" r="1.2" fill="#f0a070"/>
      <path class="stielauge" d="M13 23 L11 29" stroke="#7a2a10" stroke-width="1.6"/>
      <path class="stielauge" d="M21 23 L23 29" stroke="#7a2a10" stroke-width="1.6"/>
      <circle cx="11" cy="30" r="2.6" fill="#fff6d8" stroke="#3a1206" stroke-width="0.8"/><circle cx="11" cy="30.6" r="1.2" fill="#1a0802"/>
      <circle cx="23" cy="30" r="2.6" fill="#fff6d8" stroke="#3a1206" stroke-width="0.8"/><circle cx="23" cy="30.6" r="1.2" fill="#1a0802"/>
    </svg>`,
  tentakler: () => `
    <svg viewBox="0 0 30 30" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
      <g class="tentakel" stroke="#c48ae0" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.9">
        <path d="M7 14 Q5 22 8 30 Q6 36 9 40"/><path d="M11 15 Q10 24 12 32"/><path d="M15 15 Q16 25 14 36"/>
        <path d="M19 15 Q20 24 18 32"/><path d="M23 14 Q25 22 22 30 Q24 36 21 40"/>
      </g>
      <path class="schirm" d="M2 15 Q2 1 15 1 Q28 1 28 15 Q22 12 15 15 Q8 12 2 15 Z" fill="#9a4ec4" stroke="#4a1a66" stroke-width="1.2" opacity="0.92"/>
      <path d="M7 7 Q15 2 23 7" stroke="#e4c4f4" stroke-width="1.6" fill="none"/>
      <circle cx="11" cy="10" r="1.8" fill="#fff2a0"/><circle cx="19" cy="10" r="1.8" fill="#fff2a0"/>
    </svg>`,
};

function getFeindSVGHtml(muster = 'normal', hatSchild = false, groesse = 30) {
  let schildHtml = hatSchild ? '<div class="feind-schild"></div>' : '';
  if (muster === 'kette') return getKettenSVGHtml(groesse >= 26);
  if (muster === 'stachelkette') return BIO_SVG.stachelkette(groesse >= 26);
  if (muster === 'kugelkette') return BIO_SVG.kugelkette(groesse >= 26, groesse === 24);
  if (muster === 'krabbe' || muster === 'tentakler') return BIO_SVG[muster]();
  if (GEWAECHS_SVG[muster]) return GEWAECHS_SVG[muster]();

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

// Auge des Insel-Bosses: Lid (zu) ueber Iris und Pupille, Klasse offen zieht das Lid weg
const AUGE_SVG = `
  <svg viewBox="0 0 36 36" style="position: absolute; width: 100%; height: 100%; overflow: visible;">
    <ellipse cx="18" cy="18" rx="17" ry="14" fill="#5a2a12" stroke="#2b0f05" stroke-width="1.5"/>
    <ellipse cx="18" cy="18" rx="13" ry="10" fill="#f3e6c8"/>
    <circle class="auge-iris" cx="18" cy="19" r="7" fill="#d9822b"/>
    <circle cx="18" cy="19" r="3.5" fill="#1a0802"/>
    <circle cx="20" cy="16.5" r="1.5" fill="#fff"/>
    <path class="auge-lid" d="M1 18 Q18 0 35 18 Q18 34 1 18 Z" fill="#7a3b12" stroke="#2b0f05" stroke-width="1.2"/>
  </svg>
`;

function getBossSVGHtml(bTyp, bossFarbe) {
  if (bTyp === 'auge') return AUGE_SVG;
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
  leben: '&hearts;',
  energie: 'E',
  durchschlag: '&uarr;',
  schild: 'O',
  laserWaffe: 'L',
  laser: 'L',
  raketenWaffe: 'R',
  rakete: 'R',
  bombenWaffe: 'B',
  bombe: 'B',
  autolaser: 'A',
  superWaffe: 'S',
  schockwelle: 'Z',
};

function setupPowerupVisuals(el, type, owner, farbe) {
  el.className = 'powerup';
  if (owner) {
    el.classList.add(`pu-owner-${owner}`);
  }
  const istSplitter = type === 'splitterRot' || type === 'splitterWeiss';
  if (type === 'superWaffe') el.style.animation = 'superWaffePulse 0.3s infinite alternate';
  if (type === 'schockwelle') el.classList.add('powerup-schockwelle');
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
  el.innerHTML = getFeindSVGHtml(f.muster, f.hatSchild, f.groesse);
  if (['kette', 'stachelkette', 'kugelkette'].includes(f.muster)) {
    // Puls-Phase aus der Id: aufeinanderfolgende Glieder pulsieren versetzt (Welle), Host und Client gleich
    const nr = parseInt(String(f.id).replace(/\D/g, ''), 10) || 0;
    el.style.setProperty('--puls-verzug', `${-(nr % 8) * 0.09}s`);
  }
  el.dataset.baseColor = f.farbe;
  // Bis die Zustandsanzeige im Backend liegt, entfernt die Logik das Schild-Element ueber schildEl
  f.schildEl = f.hatSchild ? el.querySelector('.feind-schild') : null;
  return el;
}

// Asteroid: Verlauf aus farbe/farbe2, Umriss aus form (Punkte in Prozent), Risse ausser bei Magma-Brocken
// Oberflaeche aus der Id (Host und Client gleich): Krater mit Lichtkante und Koernung, bei Magma gluehende Adern
function asteroidTextur(a) {
  const zufall = felsZufall(a.id);
  let inhalt = '';
  if (a.istUnzerstoerbar || a.istMagma) {
    const adern = 2 + Math.floor(zufall() * 3);
    for (let i = 0; i < adern; i++) {
      let x = 25 + zufall() * 50;
      let y = 25 + zufall() * 50;
      let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
      const winkel = zufall() * Math.PI * 2;
      for (let k = 0; k < 4; k++) {
        const w = winkel + (zufall() - 0.5) * 1.6;
        x += Math.cos(w) * 9;
        y += Math.sin(w) * 9;
        d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      inhalt += `<path d="${d}" class="magma-ader"/>`;
    }
  } else {
    const krater = 2 + Math.floor(zufall() * 4);
    for (let i = 0; i < krater; i++) {
      const r = 5 + zufall() * 11;
      const cx = 22 + zufall() * 56;
      const cy = 22 + zufall() * 56;
      inhalt +=
        `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.85).toFixed(1)}" fill="rgba(0,0,0,0.3)"/>` +
        `<ellipse cx="${(cx + r * 0.18).toFixed(1)}" cy="${(cy + r * 0.2).toFixed(1)}" rx="${(r * 0.72).toFixed(1)}" ry="${(r * 0.6).toFixed(1)}" fill="rgba(0,0,0,0.25)"/>` +
        `<path d="M${(cx + r * 0.75).toFixed(1)} ${(cy + r * 0.3).toFixed(1)} A${r.toFixed(1)} ${(r * 0.85).toFixed(1)} 0 0 1 ${(cx - r * 0.3).toFixed(1)} ${(cy + r * 0.8).toFixed(1)}" stroke="rgba(255,255,255,0.22)" stroke-width="1.6" fill="none"/>`;
    }
    const koerner = 6 + Math.floor(zufall() * 8);
    for (let i = 0; i < koerner; i++) {
      const hell = zufall() < 0.5;
      inhalt += `<circle cx="${(10 + zufall() * 80).toFixed(1)}" cy="${(10 + zufall() * 80).toFixed(1)}" r="${(0.8 + zufall() * 1.4).toFixed(1)}" fill="${hell ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.3)'}"/>`;
    }
  }
  return `<svg class="asteroid-textur" viewBox="0 0 100 100" preserveAspectRatio="none">${inhalt}</svg>`;
}

function asteroidElement(a) {
  const el = document.createElement('div');
  el.classList.add('asteroid');
  if (a.istUnzerstoerbar) el.classList.add('unzerstoerbar');
  el.style.width = a.groesse + 'px';
  el.style.height = a.groesse + 'px';
  // Licht oben links, Schattenseite unten rechts ueber dem Grundverlauf
  el.style.background =
    `radial-gradient(circle at 72% 78%, rgba(0, 0, 0, 0.42), transparent 58%), ` +
    `radial-gradient(circle at 30% 28%, ${a.farbe}, ${a.farbe2})`;
  el.dataset.baseColor = a.farbe;
  el.style.clipPath = `polygon(${a.form.map(([px, py]) => `${px.toFixed(1)}% ${py.toFixed(1)}%`).join(', ')})`;
  el.insertAdjacentHTML('beforeend', asteroidTextur(a));
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
  // Augen des Insel-Bosses sitzen fest am Skelett (keine Schwebe-Animation)
  if (b.bossTyp === 'auge') el.classList.add('boss-auge');
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
  /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('.bombe-licht')).forEach(l => {
    l.style.animation = `bombeBlink ${takt} infinite alternate`;
  });
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
  nearMissPlus: 'viper-nearmiss-plus',
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
  el.style.width = p.laenge * 2 + 'px';
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

// Effekte mit Lebensdauer (arrays.effekte): Kreis um die Mitte, waechst bis skala und blendet aus
const BOMBEN_WELLE_FARBE = {
  '#00ffff': 'rgba(0, 255, 255, 0.4)',
  '#9b59b6': 'rgba(155, 89, 182, 0.4)',
  '#f1c40f': 'rgba(241, 196, 15, 0.45)',
};

export const EFFEKT_STIL = {
  bombenWelle: {
    hintergrund: e => BOMBEN_WELLE_FARBE[e.farbe] || 'rgba(231, 76, 60, 0.4)',
    schatten: e => `0 0 45px ${e.farbe}`,
    skala: 1.2,
  },
  bombenWelle2: { hintergrund: () => 'rgba(155, 89, 182, 0.3)', schatten: () => '0 0 30px #9b59b6', skala: 1.3 },
  raketenWelle: {
    klasse: 'schockwelle',
    hintergrund: () => 'rgba(231, 76, 60, 0.4)',
    schatten: () => '0 0 20px #e74c3c',
    skala: 1.2,
  },
  bossWelle: {
    klasse: 'boss-shockwave',
    hintergrund: () => 'rgba(231, 76, 60, 0.45)',
    schatten: () => '0 0 30px #e74c3c',
    skala: 1.25,
  },
};

// Sniper-Effekte: Klasse (Aussehen in style.css), Groesse und Deckkraft rechnet zeichneEffekt je Art
const SNIPER_EFFEKT_KLASSE = {
  sniperStrahl: 'sniper-strahl',
  sniperDruckwelle: 'sniper-druckwelle',
  sniperMinenExplosion: 'sniper-mine-explosion',
  sniperEmp: 'sniper-emp',
  schockwelle: 'schockwelle-ring',
};

// Strahl: Hoehe = Laenge, Spitze an der Schiffsnase (x/y), Drehung um den Startpunkt, dreifacher Schein aus glow (0..1)
function sniperStrahlElement(e) {
  const el = document.createElement('div');
  el.classList.add('sniper-strahl');
  el.style.height = e.laenge + 'px';
  el.style.top = e.y - e.laenge + 'px';
  el.style.width = e.breite + 'px';
  el.style.left = e.x - e.breite / 2 + 'px';
  el.style.transform = `rotate(${e.winkel}deg)`;
  el.style.boxShadow = `0 0 ${4 + 6 * e.glow}px #ffffff, 0 0 ${8 + 10 * e.glow}px ${e.farbe}, 0 0 ${14 + 18 * e.glow}px ${e.farbe}`;
  return el;
}

function effektElement(e) {
  if (e.art === 'sniperStrahl') return sniperStrahlElement(e);
  if (SNIPER_EFFEKT_KLASSE[e.art]) {
    const ring = document.createElement('div');
    ring.classList.add(SNIPER_EFFEKT_KLASSE[e.art]);
    ring.style.left = e.x + 'px';
    ring.style.top = e.y + 'px';
    ring.style.width = '0px';
    ring.style.height = '0px';
    return ring;
  }
  const stil = EFFEKT_STIL[e.art];
  if (!stil) throw new Error(`Unbekannte Effektart fuer die Anzeige: ${e.art}`);
  const el = document.createElement('div');
  if (stil.klasse) el.classList.add(stil.klasse);
  Object.assign(el.style, {
    position: 'absolute',
    width: e.radius * 2 + 'px',
    height: e.radius * 2 + 'px',
    borderRadius: '50%',
    backgroundColor: stil.hintergrund(e),
    boxShadow: stil.schatten(e),
    zIndex: '9',
    pointerEvents: 'none',
  });
  return el;
}

// Felsoptik nach Xenon-Vorbild: flache, gestapelte Steinplatten in Lavendelgrau, Kanten aus vorstehenden
// Plattenenden, dazu Wurmloecher (rund gerandete Roehrenoeffnungen) und eingewachsene Kugeln.
// Das Plattenmuster liegt einmal unsichtbar im Dokument (#fels-defs, fill: url(#fels-steine)); Musterhoehe 40 =
// SEGMENT_HOEHE, damit die Reihen ueber Segmentgrenzen fortlaufen. Alles Zufaellige (Kantenstufen, Loecher) kommt
// aus der Segment-Id, damit Host und Online-Client dasselbe Bild zeichnen.
const FELS_MUSTER_BREITE = 96;
const FELS_REIHE = 20; // Plattenhoehe inklusive Fuge (zwei Reihen je Segment)
// Platten je Reihe: [Start, Breite]; Reihen gegeneinander versetzt, Ueberlaeufe werden am Musterrand gespiegelt
const FELS_REIHEN = [
  [
    [0, 41],
    [42, 31],
    [74, 22],
  ],
  [
    [-14, 36],
    [23, 45],
    [69, 41],
  ],
];

// Wulstige Platte: dunkler Sockel, Koerper, helle Oberseite mit Glanzstrich, Schatten an der Unterseite
function felsPlatte(x, y, w) {
  const h = FELS_REIHE - 1.5;
  return (
    `<rect x="${x}" y="${y + 1}" width="${w}" height="${h}" rx="8" fill="#45426a"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h - 2}" rx="8" fill="#7b78a2"/>` +
    `<rect x="${x + 3}" y="${y + 1.5}" width="${w - 6}" height="6" rx="3" fill="#a6a4ca"/>` +
    `<rect x="${x + 7}" y="${y + 2.5}" width="${Math.max(4, w * 0.35)}" height="2" rx="1" fill="#d4d2ee"/>` +
    `<rect x="${x + 3}" y="${y + h - 6.5}" width="${w - 6}" height="4" rx="2" fill="#5b5882"/>`
  );
}

function sichereFelsDefs() {
  if (document.getElementById('fels-defs')) return;
  let platten = '';
  FELS_REIHEN.forEach((reihe, k) => {
    for (const [x, w] of reihe) {
      for (const verschub of [0, -FELS_MUSTER_BREITE, FELS_MUSTER_BREITE]) {
        const xs = x + verschub;
        if (xs + w > 0 && xs < FELS_MUSTER_BREITE) platten += felsPlatte(xs, k * FELS_REIHE, w);
      }
    }
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'fels-defs';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.innerHTML = `<defs>
    <pattern id="fels-steine" width="${FELS_MUSTER_BREITE}" height="40" patternUnits="userSpaceOnUse">
      <rect width="${FELS_MUSTER_BREITE}" height="40" fill="#2a2740"/>${platten}
    </pattern>
    <radialGradient id="fels-ei" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#f0a860"/><stop offset="55%" stop-color="#b8602a"/><stop offset="100%" stop-color="#5a2208"/>
    </radialGradient>
  </defs>`;
  document.body.appendChild(svg);
}

// Deterministische Zufallszahlen aus der Segment-Id (mulberry32 auf einem einfachen Text-Hash)
function felsZufall(id) {
  let a = 0;
  for (const c of String(id)) a = (Math.imul(a, 31) + c.charCodeAt(0)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gestufte Kante: je Plattenreihe ein senkrechtes Stueck, um bis zu 6 px vor- oder zurueckversetzt (Plattenenden).
// x0/x1 = Kante oben/unten, richtung = +1 wenn der Fels rechts der Kante liegt (Versatz zeigt dann nach links).
function stufenKante(x0, x1, h, zufall, richtung) {
  const punkte = [];
  const reihen = 2;
  for (let k = 0; k < reihen; k++) {
    const yo = (k * h) / reihen;
    const yu = ((k + 1) * h) / reihen;
    const t = (k + 0.5) / reihen;
    const x = x0 + (x1 - x0) * t - richtung * (zufall() - 0.5) * 12;
    punkte.push([+x.toFixed(1), +yo.toFixed(1)], [+x.toFixed(1), +yu.toFixed(1)]);
  }
  return punkte;
}

// Wurmloecher und Kugeln in einer Felsflaeche: links/rechts begrenzen den Bereich (ohne Kantenzone)
function wurmloecher(links, rechts, h, zufall) {
  const breite = rechts - links;
  if (breite < 30) return '';
  let svg = '';
  const anzahl = Math.floor(zufall() * (breite > 90 ? 3 : 2));
  for (let i = 0; i < anzahl; i++) {
    const r = 5 + zufall() * 3.5;
    const cx = links + r + 2 + zufall() * (breite - 2 * r - 4);
    const cy = 8 + zufall() * (h - 16);
    if (zufall() < 0.65) {
      // Roehrenoeffnung: dunkler Rand, oranger Wulst, schwarzes Loch mit Lichtkante
      svg +=
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r + 1.5).toFixed(1)}" fill="#3a1a08"/>` +
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="#c0682a" class="wurmloch"/>` +
        `<circle cx="${(cx + 0.6).toFixed(1)}" cy="${(cy + 0.8).toFixed(1)}" r="${(r * 0.55).toFixed(1)}" fill="#160602"/>` +
        `<path d="M${(cx - r * 0.7).toFixed(1)} ${(cy - r * 0.35).toFixed(1)} A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${(cx + r * 0.4).toFixed(1)} ${(cy - r * 0.8).toFixed(1)}" stroke="#f0b070" stroke-width="1.4" fill="none"/>`;
    } else {
      // eingewachsene Kugel (Ei) mit Schattenrand
      svg +=
        `<circle cx="${(cx + 1).toFixed(1)}" cy="${(cy + 1.5).toFixed(1)}" r="${r.toFixed(1)}" fill="#1e1a30"/>` +
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#fels-ei)" class="fels-kugel"/>`;
    }
  }
  return svg;
}

// Felssegment: volle Feldbreite, Hoehe 41 px (1 px Ueberlappung gegen Naehte); Wand links/rechts und Insel
// als Flaechen zwischen Profil oben (y = 0) und unten (y = 40). Fels mit gestufter Kante und Wurmloechern,
// Knochen (Insel-Boss) glatt mit Rippe, Markstrang und Knotenkante.
function felsElement(s) {
  sichereFelsDefs();
  const b = config.spielfeldBreite;
  const h = 41;
  const { oben: o, unten: u } = s;
  const zufall = felsZufall(s.id);
  const pkt = punkte => punkte.map(p => p.join(',')).join(' ');
  const knochen = !!(o.knochen || u.knochen);
  const flaeche = punkte => `<polygon class="${knochen ? 'fels-knochen' : 'fels-wand'}" points="${pkt(punkte)}"/>`;
  const kante = punkte =>
    `<polyline class="fels-kante" points="${pkt(punkte)}"/>` +
    (knochen ? `<polyline class="fels-knoten" points="${pkt(punkte)}"/>` : '');
  // Kante von oben (x0) nach unten (x1): bei Fels gestuft, bei Knochen gerade
  const kantenPunkte = (x0, x1, richtung) =>
    knochen
      ? [
          [x0, 0],
          [x1, h],
        ]
      : stufenKante(x0, x1, h, zufall, richtung);
  let svg = '';
  let deko = '';
  if (o.l > 0 || u.l > 0) {
    const k = kantenPunkte(o.l, u.l, -1);
    svg += flaeche([[0, 0], ...k, [0, h]]) + kante(k);
    if (!knochen) deko += wurmloecher(4, Math.min(o.l, u.l) - 10, h, zufall);
  }
  if (o.r > 0 || u.r > 0) {
    const k = kantenPunkte(b - o.r, b - u.r, 1);
    svg += flaeche([[b, 0], ...k, [b, h]]) + kante(k);
    if (!knochen) deko += wurmloecher(b - Math.min(o.r, u.r) + 10, b - 4, h, zufall);
  }
  if (o.ib > 0 || u.ib > 0) {
    const links = kantenPunkte(o.im - o.ib / 2, u.im - u.ib / 2, 1);
    const rechts = kantenPunkte(o.im + o.ib / 2, u.im + u.ib / 2, -1);
    svg += flaeche([...links, ...rechts.slice().reverse()]) + kante(links) + kante(rechts);
    if (knochen) {
      const m = h / 2;
      const ml = (links[0][0] + links.at(-1)[0]) / 2;
      const mr = (rechts[0][0] + rechts.at(-1)[0]) / 2;
      svg += `<path class="knochen-rippe" d="M${ml + 4} ${m} Q${(ml + mr) / 2} ${m + 7} ${mr - 4} ${m}"/>`;
      // Markstrang in der Mitte der Wirbelsaeule (der Insel-Boss steht immer mittig), nicht in der Inselmitte
      svg += `<line class="knochen-mark" x1="${b / 2}" y1="0" x2="${b / 2}" y2="${h}"/>`;
    } else {
      const innen = Math.max(o.im - o.ib / 2, u.im - u.ib / 2) + 10;
      const aussen = Math.min(o.im + o.ib / 2, u.im + u.ib / 2) - 10;
      deko += wurmloecher(innen, aussen, h, zufall);
    }
  }
  const el = document.createElement('div');
  el.className = 'fels-segment';
  el.style.width = b + 'px';
  el.style.height = h + 'px';
  el.innerHTML = `<svg width="${b}" height="${h}" viewBox="0 0 ${b} ${h}">${svg}${deko}</svg>`;
  return el;
}

export const ERZEUGER = {
  fels: felsElement,
  partikel: partikelElement,
  stern: s => {
    const el = document.createElement('div');
    el.className = 'stern';
    el.style.width = s.groesse + 'px';
    el.style.height = s.groesse + 'px';
    return el;
  },
  feind: feindElement,
  asteroid: asteroidElement,
  boss: bossElement,
  powerup: powerupElement,
  laser: laserElement,
  rakete: raketeElement,
  bombe: bombeElement,
  // Spore (Gewaechs): runde, leuchtende Kugel statt Laserstrich
  feindLaser: l => {
    const el = document.createElement('div');
    el.classList.add(l.spore ? 'spore' : 'feind-laser');
    return el;
  },
  bossLaser: klassenElement('boss-laser'),
  bossRakete: klassenElement('boss-rakete', BOSS_RAKETE_HTML),
  bossBombe: klassenElement('boss-bombe', BOSS_BOMBE_HTML),
  hackProjektil: klassenElement('hack-projektil'),
  gleveWelle: welleElement,
  effekt: effektElement,
  sniperGranate: klassenElement('sniper-granate'),
  sniperMine: m => {
    const el = document.createElement('div');
    el.classList.add('sniper-mine', 'sniper-mine-' + m.pKey);
    return el;
  },
};

// Schiffs-SVG nach Modell und Farbe (Spiel, Hangar-Vorschau, Cutszene)
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
  if (model === 'gleve') {
    return `
      <!-- Gleve-MR: Manta-Fluegel -->
      <path d="M15 6 Q5 6 1 18 Q8 16 11 22 L15 26 L19 22 Q22 16 29 18 Q25 6 15 6 Z" fill="${c.sec}"/>
      <!-- Kopfflossen -->
      <path d="M10 7 L8 1 L12 6 Z" fill="${c.accent}"/>
      <path d="M20 7 L22 1 L18 6 Z" fill="${c.accent}"/>
      <!-- Rumpf -->
      <path d="M15 6 L12 13 L15 24 L18 13 Z" fill="${c.prim}"/>
      <!-- Cockpit -->
      <path d="M15 10 L13.6 13 L15 15 L16.4 13 Z" fill="#87CEEB"/>
      <!-- Triebwerk -->
      <rect x="13" y="24" width="4" height="4" fill="#7f8c8d"/>
    `;
  }
  if (model === 'sniper') {
    return `
      <!-- Spectre-SR: Railgun -->
      <rect x="11" y="0" width="2" height="15" fill="#7f8c8d"/>
      <rect x="17" y="0" width="2" height="15" fill="#7f8c8d"/>
      <rect x="12.5" y="1" width="5" height="1.5" fill="${c.accent}"/>
      <rect x="12.5" y="5" width="5" height="1.5" fill="${c.accent}" opacity="0.7"/>
      <path d="M15 10 L9 14 L1 20 L3 24 L10 21 L15 27 L20 21 L27 24 L29 20 L21 14 Z" fill="${c.sec}"/>
      <path d="M15 12 L12 17 L15 25 L18 17 Z" fill="${c.prim}"/>
      <path d="M15 15 L13.8 18 L15 20 L16.2 18 Z" fill="#87CEEB"/>
      <rect x="9" y="22" width="3" height="4" fill="#7f8c8d"/>
      <rect x="18" y="22" width="3" height="4" fill="#7f8c8d"/>
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
