
import { state, dom, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Input from './input.js';
import * as Loop from './loop.js';
import * as Audio from './audio.js';
import * as Anzeige from './anzeige.js';


// Stabile Objekt-IDs, damit der Online-Client DOM-Elemente zwischen Snapshots wiederverwenden kann
let idZaehler = 0;
export function neueId(praefix) {
  return `${praefix}_${++idZaehler}`;
}

// Zufaelliger Asteroiden-Umriss: Eckpunkte [x, y] in Prozent der Groesse (eine Nachkommastelle)
export function generiereAsteroidForm() {
  let punkte = [];
  let anzahlEcken = Math.floor(Math.random() * 4) + 6;
  for (let i = 0; i < anzahlEcken; i++) {
    let winkel = i / anzahlEcken * Math.PI * 2;
    let radius = 0.7 + Math.random() * 0.3;
    let px = 50 + Math.cos(winkel) * 50 * radius;
    let py = 50 + Math.sin(winkel) * 50 * radius;
    punkte.push([Math.round(px * 10) / 10, Math.round(py * 10) / 10]);
  }
  return punkte;
}

// Umriss fuer das Netz: "x y,x y,..." und zurueck
export function formAlsText(form) {
  return form.map(([px, py]) => `${px} ${py}`).join(',');
}
export function formAusText(text) {
  return text.split(',').map(paar => paar.split(' ').map(Number));
}

// Leuchtfarbe eines Powerups (Rahmen, Bildschirm-Blitz beim Einsammeln)
const POWERUP_FARBEN = {
  leben: '#e74c3c', energie: '#f1c40f', durchschlag: '#00ffff', schild: '#3498db',
  laserWaffe: '#9b59b6', laser: '#9b59b6', raketenWaffe: '#e67e22', rakete: '#e67e22',
  bombenWaffe: '#c0392b', bombe: '#c0392b', autolaser: '#f39c12', superWaffe: '#ffffff',
  splitterRot: '#e74c3c', splitterWeiss: '#ffffff'
};
export function powerupFarbe(type) {
  return POWERUP_FARBEN[type] || '#f1c40f';
}

let nextCoopLootOwner = 'p1';

export function erzeugePowerup(px, py, forceType = null, forceOwner = null) {
  const puTypes = ['leben', 'energie', 'durchschlag', 'schild', 'laserWaffe', 'raketenWaffe', 'bombenWaffe'];
  if (state.laserStufe >= 5) puTypes.push('autolaser');
  let rawType = forceType ? forceType : puTypes[Math.floor(Math.random() * puTypes.length)];
  
  // Normalisiere Kurzbezeichnungen
  let type = rawType;
  if (rawType === 'laser') type = 'laserWaffe';
  else if (rawType === 'rakete') type = 'raketenWaffe';
  else if (rawType === 'bombe') type = 'bombenWaffe';

  let owner = null;
  if (isCoopMode()) {
    if (forceOwner) {
      owner = forceOwner;
    } else if (state.isDead && state.p2 && !state.p2.isDead) {
      owner = 'p2';
    } else if (state.p2 && state.p2.isDead && !state.isDead) {
      owner = 'p1';
    } else {
      owner = nextCoopLootOwner;
      nextCoopLootOwner = nextCoopLootOwner === 'p1' ? 'p2' : 'p1';
    }
  }

  arrays.powerups.push(Anzeige.erzeuge({
    id: neueId('pu'),
    x: px,
    y: py,
    groesse: 24,
    vy: 2,
    type: type,
    farbe: powerupFarbe(type),
    owner: owner
  }, 'powerup'));
}
export function erzeugeAsteroid(startX, startY, startGroesse, startVx, startVy, immunFrames = 0, forceDestructible = false) {
  const groesse = startGroesse !== undefined ? startGroesse : Math.random() * 30 + 15;
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
  // Farbverlauf (farbe -> farbe2), Umriss und Rissmuster sind Modelldaten; die Anzeige zeichnet daraus
  let farbe, farbe2;
  if (istMagma) {
    let c = config.magmaBasisFarben[Math.floor(Math.random() * config.magmaBasisFarben.length)];
    farbe = c.a;
    farbe2 = c.b;
  } else {
    farbe = config.asteroidenBasisFarben[Math.floor(Math.random() * config.asteroidenBasisFarben.length)];
    farbe2 = '#2c3e50';
  }
  const form = generiereAsteroidForm();
  const finalX = startX !== undefined ? startX : Math.random() * (config.spielfeldBreite - groesse);
  const finalY = startY !== undefined ? startY : -groesse;
  const riss = istUnzerstoerbar ? null : Math.floor(Math.random() * config.rissMuster.length);
  let startHp = groesse * 1.2;
  if (traegtPowerup) startHp *= 3;
  let berechnetVx = startVx !== undefined ? startVx : (Math.random() - 0.5) * 4;
  // LANGSAMERE SKALIERUNG: Asteroiden fallen in höheren Leveln nur dezent schneller
  let berechnetVy = startVy !== undefined ? startVy : Math.random() * 1.5 + 1.0 + state.level * 0.1;
  if (traegtPowerup && startVx === undefined) berechnetVx = Math.random() - 0.5;
  let startRot = Math.random() * 360;
  let vRot = (Math.random() - 0.5) * 3;
  arrays.asteroiden.push(Anzeige.erzeuge({
    id: neueId('a'),
    x: finalX,
    y: finalY,
    groesse: groesse,
    vx: berechnetVx,
    vy: berechnetVy,
    immune: immunFrames,
    hp: startHp,
    maxHp: startHp,
    istMagma: istMagma,
    istUnzerstoerbar: istUnzerstoerbar,
    traegtPowerup: traegtPowerup,
    farbe, farbe2, form, riss,
    istFeind: false,
    rot: startRot,
    vRot: vRot
  }, 'asteroid'));
}
export function getFeindColor(muster = 'normal') {
  if (muster === 'stopAndGo') return '#e67e22';
  if (muster === 'crossfire') return '#1abc9c';
  if (muster === 'swoop') return '#2ecc71';
  if (muster === 'hacker') return '#39ff14';
  return '#9b59b6';
}


export function erzeugeFeind(sX, sY, forceMuster = null, forceVx = 0, forceShield = null) {
  let muster = forceMuster !== null ? forceMuster : 'normal';
  let stopY = 0;
  if (forceMuster === null && state.level >= 1 && Math.random() < Math.min(0.6, state.level * 0.2)) {
    muster = 'stopAndGo';
  }
  if (muster === 'stopAndGo') {
    stopY = 80 + Math.random() * 120;
  } else if (muster === 'hacker') {
    stopY = 100 + Math.random() * 100;
  }

  let hatSchild = false;
  if (muster === 'hacker') {
    hatSchild = false;
  } else if (forceShield !== null) {
    hatSchild = forceShield;
  } else if (state.level >= 3 && Math.random() < Math.min(0.5, (state.level - 2) * 0.15)) {
    hatSchild = true;
  }

  const startX = sX !== undefined ? sX : Math.random() * (config.spielfeldBreite - 30);
  const startY = sY !== undefined ? sY : -30;
  let schussBasis = Math.max(25, 60 - (state.level - 1) * 8);
  const feindHpMult = isCoopMode() ? 1.25 : 1.0;
  const feindHp = Math.round(20 * feindHpMult);
  const feindSchildHp = hatSchild ? Math.round(20 * feindHpMult) : 0;
  arrays.feinde.push(Anzeige.erzeuge({
    id: neueId('f'),
    x: startX,
    y: startY,
    groesse: 30,
    hp: feindHp,
    maxHp: feindHp,
    schildHp: feindSchildHp,
    maxSchildHp: feindSchildHp,
    hatSchild: hatSchild,
    farbe: getFeindColor(muster),
    vy: 1.2,
    vx: forceVx,
    basisX: startX,
    zeit: 0,
    schussTimer: Math.random() * schussBasis + schussBasis,
    burstCount: 0,
    burstTimer: 0,
    istFeind: true,
    istUnzerstoerbar: false,
    traegtPowerup: Math.random() < (muster === 'hacker' ? 0.4 : 0.2),
    muster: muster,
    phase: 'anflug',
    stopTimer: 0,
    stopY: stopY,
    lauerTimer: 0,
    hackTimer: 0,
    hackSchuesse: 0,
    hackGelandet: false
  }, 'feind'));
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
}
export function erzeugeHackProjektil(fx, fy, zielX, zielY, quelle = null) {
  const speed = 3;
  let dx = zielX - fx;
  let dy = zielY - fy;
  let dist = Math.hypot(dx, dy) || 1;
  arrays.hackProjektilArray.push(Anzeige.erzeuge({
    id: neueId('hp'),
    x: fx,
    y: fy,
    vx: dx / dist * speed,
    vy: dy / dist * speed,
    width: 12,
    height: 12,
    quelle: quelle,
    lenkZeit: 90 // 1,5 s Zielsuche, danach geradeaus
  }, 'hackProjektil'));
}

export function erzeugeFeindLaser(fx, fy, zielX = null, zielY = null) {
  Audio.playEnemyLaser();
  let vx = 0;
  let vy = 7;
  let rot;
  if (zielX !== null && zielY !== null) {
    let dx = zielX - fx;
    let dy = zielY - fy;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      vx = dx / dist * 7;
      vy = dy / dist * 7;
    }
    rot = Math.atan2(dy, dx) * 180 / Math.PI - 90;
  }
  arrays.feindLaserArray.push(Anzeige.erzeuge({
    id: neueId('fl'),
    x: fx,
    y: fy,
    vx: vx,
    vy: vy,
    width: 4,
    height: 15,
    rot
  }, 'feindLaser'));
}

// --- BOSS SKALIERUNG & OPTIK ---
export function getBossColor(level = 1) {
  return config.bossFarben[(level - 1) % config.bossFarben.length];
}

export function erzeugeBoss() {
  state.bossAktiv = true;
  dom.bossHpContainer.style.display = 'block';
  dom.bossHpBalken.style.width = '100%';
  dom.bossHpBalken.style.backgroundColor = '#e74c3c';

  // Bestimme Boss Typ basierend auf Level
  let bTyp = state.level % 4;
  if (bTyp === 0) bTyp = 4; // 1, 2, 3, 4, 1, 2, ...

  let bossGroesse = 100 + (state.level - 1) * 10;
  bossGroesse = Math.min(bossGroesse, 160); // Maximale Größe deckeln
  let startX = config.spielfeldBreite / 2 - bossGroesse / 2;

  // SKALIERUNG: HP wachsen im Co-op Modus moderat (+40%), im Solomodus Standard
  const bossHpMult = isCoopMode() ? 1.4 : 1.0;
  let bossHp = Math.round((400 + (state.level - 1) * 350) * bossHpMult);
  let bossVx = 2 + (state.level - 1) * 0.2;
  let schussRhythmus = Math.max(45, 90 - (state.level - 1) * 10);
  arrays.bosses.push(Anzeige.erzeuge({
    id: neueId('boss'),
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
    leuchtFarbe: getBossColor(state.level),
    enragePhaseAktiv: false,
    hackTimer: 180 // erster Hack-Orb nach 3 s Kampf (ab Level 5)
  }, 'boss'));
}
export function erzeugeBossLaser(fx, fy, vx = 0, vy = 6) {
  Audio.playBossLaser();
  arrays.bossLaserArray.push(Anzeige.erzeuge({
    id: neueId('bl'),
    rot: vx !== 0 ? Math.atan2(vy, vx) * 180 / Math.PI - 90 : undefined,
    x: fx,
    y: fy,
    vx: vx,
    vy: vy,
    width: 8,
    height: 25
  }, 'bossLaser'));
}

export function erzeugeBossBombe(bx, by) {
  Audio.playBossBombLaunch();

  let bHp = 20 + state.level * 5;
  arrays.bossBombenArray.push(Anzeige.erzeuge({
    id: neueId('bb'),
    x: bx,
    y: by,
    groesse: 26,
    hp: bHp,
    maxHp: bHp,
    vx: (Math.random() - 0.5) * 0.8,
    vy: 1.3,
    timer: 180, // 3 Sekunden bis Detonation
    maxTimer: 180,
    beepTimer: 999,
    radius: 90,
    istBossBombe: true,
    istUnzerstoerbar: false,
    immune: 0
  }, 'bossBombe'));
}

export function erzeugeBossRakete(bx, by, sideDirection = 1) {
  Audio.playBossRocketLaunch();
  let initVx = sideDirection * (3.0 + Math.random() * 1.0);
  let initVy = 0.8 + Math.random() * 0.4;
  let rHp = 15;
  arrays.bossRaketenArray.push(Anzeige.erzeuge({
    id: neueId('br'),
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
  }, 'bossRakete'));
}
// ------------------------------