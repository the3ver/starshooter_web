
import { state, config, arrays, shipModels } from './state.js';
import * as Gleve from './gleve.js';
import * as Viper from './viper.js';
import * as Sniper from './sniper.js';
import * as Hack from './hack.js';

// --- Bot-Schwierigkeitsstufen ---
const BOT_DIFFICULTY = {
  easy:   { reactionFrames: 8, aimCorridor: 60, dodgeRadius: 60,  powerupRange: 120 },
  normal: { reactionFrames: 3, aimCorridor: 30, dodgeRadius: 80,  powerupRange: 180 },
  hard:   { reactionFrames: 0, aimCorridor: 15, dodgeRadius: 100, powerupRange: 250 }
};

let reactionCounter = 0;
let lastDecision = { moveX: 0, moveY: 0 };

// Abstand zum Spielfeldrand, den der Bot beim Zielen und Ausweichen einhaelt
const RAND_ABSTAND = 50;

// Gleve-Bot: Mindestabstand zwischen zwei Dashs (Schritte), damit er nicht dauernd dasht
const GLEVE_DASH_PAUSE = 40;
let gleveDashSperre = 0;

// --- Hilfsfunktionen ---

function distanceSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function findNearestDanger(p2, diff) {
  const dangers = [];
  const halfSize = config.spielerGroesse / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  const dodgeRadiusSq = diff.dodgeRadius * diff.dodgeRadius;

  // Asteroiden
  for (const ast of arrays.asteroiden) {
    const ax = ast.x + (ast.groesse || 30) / 2;
    const ay = ast.y + (ast.groesse || 30) / 2;
    const dSq = distanceSq(cx, cy, ax, ay);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: ax, y: ay, dSq, vy: ast.geschwindigkeit || 2 });
    }
  }

  // Feindliche Projektile (Laser + Bomben + Raketen)
  for (const fl of arrays.feindLaserArray) {
    if (fl.harmlos) continue; // von der Gleve weggeschleudert
    const fx = fl.x + 2;
    const fy = fl.y + 5;
    const dSq = distanceSq(cx, cy, fx, fy);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: fx, y: fy, dSq, vy: fl.vy || 4 });
    }
  }
  for (const bl of arrays.bossLaserArray) {
    if (bl.harmlos) continue; // von der Gleve weggeschleudert
    const bx = bl.x + 3;
    const by = bl.y + 5;
    const dSq = distanceSq(cx, cy, bx, by);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: bx, y: by, dSq, vy: bl.vy || 4 });
    }
  }
  for (const bb of arrays.bossBombenArray) {
    const bx = bb.x + 8;
    const by = bb.y + 8;
    const dSq = distanceSq(cx, cy, bx, by);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: bx, y: by, dSq, vy: bb.vy || 2 });
    }
  }
  for (const br of arrays.bossRaketenArray) {
    const bx = br.x + 5;
    const by = br.y + 8;
    const dSq = distanceSq(cx, cy, bx, by);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: bx, y: by, dSq, vy: br.vy || 3 });
    }
  }

  // Feinde direkt
  for (const feind of arrays.feinde) {
    const fx = feind.x + 15;
    const fy = feind.y + 15;
    const dSq = distanceSq(cx, cy, fx, fy);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: fx, y: fy, dSq, vy: feind.geschwindigkeit || 2 });
    }
  }

  if (dangers.length === 0) return null;
  dangers.sort((a, b) => a.dSq - b.dSq);
  return dangers[0];
}

function findNearestPowerup(p2, diff) {
  const halfSize = config.spielerGroesse / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  const rangeSq = diff.powerupRange * diff.powerupRange;
  let nearest = null;
  let nearestDSq = Infinity;

  for (const p of arrays.powerups) {
    if (p.towedBy) continue; // Schon gezogen
    const px = p.x + (p.groesse || 16) / 2;
    const py = p.y + (p.groesse || 16) / 2;
    const dSq = distanceSq(cx, cy, px, py);
    if (dSq < rangeSq && dSq < nearestDSq) {
      nearest = { x: px, y: py, dSq };
      nearestDSq = dSq;
    }
  }
  return nearest;
}

// Boss-Mitte: Bosse sind quadratisch mit Kantenlaenge groesse
function bossMitte(boss) {
  const g = boss.groesse || 100;
  return { x: boss.x + g / 2, y: boss.y + g / 2 };
}

// Kann der Bot diesen Asteroiden zerstoeren? Magma nur mit dem Gleve-Dash ab Raketen-Stufe 5
function kannAsteroidZerstoeren(p2, ast) {
  if (!ast.istUnzerstoerbar) return true;
  return Gleve.istGleve(p2) && Gleve.dashKnacktMagma(p2);
}

export function findBestTarget(p2, diff) {
  const halfSize = config.spielerGroesse / 2;
  const cx = p2.x + halfSize;
  let bestTarget = null;
  let bestDSq = Infinity;

  // Bosse und Feindschiffe: naechstes Ziel ueber dem Bot
  for (const boss of arrays.bosses) {
    if (boss.hp <= 0) continue;
    const m = bossMitte(boss);
    const dSq = distanceSq(cx, p2.y, m.x, m.y);
    if (m.y < p2.y && dSq < bestDSq) { // Nur Ziele über dem Bot
      bestTarget = { x: m.x, y: m.y, dSq, isBoss: true, unten: boss.y + (boss.groesse || 100), groesse: boss.groesse || 100 };
      bestDSq = dSq;
    }
  }

  for (const feind of arrays.feinde) {
    const fx = feind.x + 15;
    const fy = feind.y + 15;
    const dSq = distanceSq(cx, p2.y, fx, fy);
    if (fy < p2.y && dSq < bestDSq) {
      bestTarget = { x: fx, y: fy, dSq, isBoss: false };
      bestDSq = dSq;
    }
  }
  if (bestTarget) return bestTarget;

  // Asteroiden nur ohne Gegnerschiff, und nur solche, die der Bot zerstoeren kann
  for (const ast of arrays.asteroiden) {
    if (!kannAsteroidZerstoeren(p2, ast)) continue;
    const ax = ast.x + (ast.groesse || 30) / 2;
    const ay = ast.y + (ast.groesse || 30) / 2;
    const dSq = distanceSq(cx, p2.y, ax, ay);
    if (ay < p2.y && dSq < bestDSq) {
      bestTarget = { x: ax, y: ay, dSq, isBoss: false };
      bestDSq = dSq;
    }
  }

  return bestTarget;
}

function computeMovement(p2, target, danger, powerup, diff) {
  const halfSize = config.spielerGroesse / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  let moveX = 0;
  let moveY = 0;

  // Menschliche Taktik: Basis-Position im unteren Viertel (y: 480-520 auf 600px Feld)
  const baselineY = config.spielfeldHoehe - 90;

  // Priorität 1: Gefahren ausweichen
  if (danger) {
    const dx = cx - danger.x;
    const dy = cy - danger.y;
    const dist = Math.sqrt(danger.dSq) || 1;
    // Weg von der Gefahr bewegen
    moveX = (dx / dist) * 1.5;
    moveY = (dy / dist) * 1.2;
    const raumLinks = cx;
    const raumRechts = config.spielfeldBreite - cx;
    // Gleve mit bereitem Sweep (laeuft oder genug Energie) pariert Gefahren im Bogen, statt seitlich aus ihm herauszufliegen
    const pariert = Gleve.istGleve(p2) && (Gleve.istSweepAktiv(p2) || sweepBereit(p2)) && imSweepBogen(p2, danger.x, danger.y);
    // Gefahr fast genau ueber dem Bot: seitlich zur freieren Seite ausweichen statt nur nach unten
    if (!pariert && Math.abs(dx) < 20 && dy > 0) moveX = (raumRechts >= raumLinks ? 1 : -1) * 1.5;
    // Nicht in die Wand ausweichen, sondern zur Mitte hin
    if ((moveX < 0 && raumLinks < RAND_ABSTAND) || (moveX > 0 && raumRechts < RAND_ABSTAND)) moveX = -moveX;
    if (moveY > 0 && cy > config.spielfeldHoehe - RAND_ABSTAND) moveY = 0;
    return { moveX, moveY };
  }

  // Priorität 2: Powerup einsammeln
  if (powerup) {
    const dx = powerup.x - cx;
    const dy = powerup.y - cy;
    const dist = Math.sqrt(powerup.dSq) || 1;
    moveX = (dx / dist) * 1.0;
    moveY = (dy / dist) * 1.0;
    return { moveX, moveY };
  }

  // Priorität 3: Auf Ziel ausrichten (horizontal) und aus der Distanz (unteres Viertel) beschießen
  if (target) {
    // Nicht bis an den Rand jagen (der Jaeger-Boss folgt dem Bot sonst bis in die Ecke)
    const zielX = Math.max(RAND_ABSTAND, Math.min(config.spielfeldBreite - RAND_ABSTAND, target.x));
    const dx = zielX - cx;
    if (Math.abs(dx) > diff.aimCorridor / 2) {
      moveX = dx > 0 ? 0.8 : -0.8;
    }
    // Vertikal: Bleibe im unteren Viertel (Grundlinie), um Feinde/Bosse aus sicherer Distanz zu beschießen.
    // Die Gleve (Nahkampf) haelt sich knapp ausserhalb der Dash-Reichweite unter normalen Feinden.
    let idealY = target.isBoss ? baselineY : Math.max(baselineY, target.y + 250);
    if (Gleve.istGleve(p2) && !target.isBoss) idealY = Math.min(baselineY, target.y + Gleve.dashReichweite(p2) * 0.8);
    // Gegen Bosse geht die Gleve in Sweep-Reichweite unter die Boss-Unterkante (mit Abstand zum Koerper, Kollision schadet)
    if (Gleve.istGleve(p2) && target.isBoss) {
      const bossUnten = target.unten;
      idealY = Math.min(baselineY, bossUnten + 0.6 * Gleve.sweepLaenge(p2));
    }
    if (Sniper.istSniper(p2)) return sniperBewegung(p2, target, cx, cy, zielX);
    const dy = idealY - cy;
    if (Math.abs(dy) > 15) {
      moveY = dy > 0 ? 0.5 : -0.5;
    }
    return { moveX, moveY };
  }

  // Priorität 4: Formation mit P1 halten (bevorzuge unteres Spielfeldviertel)
  const p1x = state.x + halfSize;
  const p1y = state.y + halfSize;
  const formationTargetX = p1x + 50; // Rechts versetzt
  const formationTargetY = Math.max(baselineY - 40, Math.min(config.spielfeldHoehe - 60, p1y));
  const fdx = formationTargetX - cx;
  const fdy = formationTargetY - cy;
  if (Math.abs(fdx) > 15) moveX = fdx > 0 ? 0.4 : -0.4;
  if (Math.abs(fdy) > 15) moveY = fdy > 0 ? 0.4 : -0.4;

  return { moveX, moveY };
}

// --- Sniper: Fadenkreuz (Grundposition 220 px ueber dem Schiff) auf das Ziel bringen, tippen/laden, Granate ---

const SNIPER_TOLERANZ = 6;
let sniperModus = null; // null (Taste oben) | 'tipp' | 'laden'
let sniperHaltedauer = 0;
let sniperTippRest = 0; // verbleibende Schritte des Granaten-/EMP-Tippens (botFireRakete true)
let sniperTippPause = 0; // Pause nach dem Tippen, damit das Loslassen verarbeitet wird, bevor ein neuer Tipp beginnt
let sniperMinenHalt = false; // Raketen-Taste wird zum Minenlegen gehalten
let sniperMinenSchritte = 0; // bisherige Haltedauer fuer die Minen
const sniperVorDist = new WeakMap(); // letzter Abstand von Feinden/Asteroiden zum Schiff (Annaeherung erkennen)

// Unter dem Ziel stehen, sodass das Fadenkreuz auf dem Ziel liegt (Bosse: knapp ueber der Unterkante, ihre Box ist gross)
function sniperBewegung(p2, target, cx, cy, zielX) {
  let moveX = 0;
  let moveY = 0;
  const dx = zielX - cx;
  if (Math.abs(dx) > SNIPER_TOLERANZ) moveX = dx > 0 ? 0.8 : -0.8;
  const kreuzY = target.isBoss ? target.unten - 0.3 * target.groesse : target.y;
  const halfSize = config.spielerGroesse / 2;
  // Schiffsoberkante = Mitte - halfSize; Fadenkreuz liegt FADENKREUZ_ABSTAND darueber (oben bei 0 begrenzt)
  const idealCy = Math.max(Sniper.FADENKREUZ_ABSTAND + halfSize, Math.min(config.spielfeldHoehe - halfSize, kreuzY + Sniper.FADENKREUZ_ABSTAND + halfSize));
  const dy = idealCy - cy;
  if (Math.abs(dy) > SNIPER_TOLERANZ) moveY = dy > 0 ? 0.8 : -0.8;
  return { moveX, moveY };
}

function sniperKreuz(p2) {
  if (p2.sniperZielX != null && p2.sniperZielY != null) return { x: p2.sniperZielX, y: p2.sniperZielY };
  return Sniper.grundPosition(p2);
}

function sniperGranateLohnt(p2, kreuz, imKreis) {
  if (arrays.bosses.some(b => b.hp > 0 && imKreis.includes(b))) return true;
  const r = Sniper.granatenRadius(p2);
  let feinde = 0;
  for (const f of arrays.feinde) {
    if (f.hp <= 0) continue;
    const g = f.groesse || 30;
    if (Math.hypot(f.x + g / 2 - kreuz.x, f.y + g / 2 - kreuz.y) <= r) feinde++;
  }
  if (feinde >= 2) return true;
  // Stufe 5 loescht Geschosse im Radius: Geschoss, das nach der Flugzeit (30 Schritte) am Kreuz ankommt und aufs Schiff zielt
  if ((p2.raketenStufe || 1) >= 5) {
    const cx = p2.x + config.spielerGroesse / 2;
    for (const g of [...arrays.feindLaserArray, ...arrays.bossLaserArray, ...arrays.hackProjektilArray, ...arrays.bossRaketenArray]) {
      if (g.harmlos || Math.abs(g.x - cx) > 50 || g.y > p2.y) continue;
      const py = g.y + (g.vy || 4) * Sniper.GRANATE_FLUG;
      if (Math.hypot(g.x - kreuz.x, py - kreuz.y) <= r * 0.8) return true;
    }
  }
  return false;
}

// Feindliches Geschoss (v. a. Boss-Rakete) naeher als 80 px am Schiffsmittelpunkt: das EMP loest es auf
function sniperEmpLohnt(p2) {
  const cx = p2.x + config.spielerGroesse / 2;
  const cy = p2.y + config.spielerGroesse / 2;
  const r = Math.min(80, Sniper.empRadius(p2));
  for (const g of [...arrays.feindLaserArray, ...arrays.bossLaserArray, ...arrays.hackProjektilArray, ...arrays.bossRaketenArray]) {
    if (g.harmlos) continue;
    const w = g.width || g.groesse || 4;
    const h = g.height || g.groesse || 4;
    const nx = Math.max(g.x, Math.min(cx, g.x + w));
    const ny = Math.max(g.y, Math.min(cy, g.y + h));
    if (Math.hypot(nx - cx, ny - cy) < r) return true;
  }
  return false;
}

// Feind oder Asteroid (nicht Magma) naeher als 150 px am Schiffsmittelpunkt und im Annaehern: Minen legen
function sniperMinenLohnt(p2) {
  const cx = p2.x + config.spielerGroesse / 2;
  const cy = p2.y + config.spielerGroesse / 2;
  let lohnt = false;
  for (const z of [...arrays.feinde, ...arrays.asteroiden]) {
    if (z.istUnzerstoerbar || (z.hp !== undefined && z.hp <= 0)) continue;
    const g = z.groesse || 30;
    const dist = Math.hypot(z.x + g / 2 - cx, z.y + g / 2 - cy);
    const vorher = sniperVorDist.get(z);
    sniperVorDist.set(z, dist);
    if (dist < 150 && vorher !== undefined && dist < vorher - 0.01) lohnt = true;
  }
  return lohnt;
}

// Jeden Schritt: Laser-Taste (Tippen/Laden: Halten und Loslassen brauchen den Schrittakt) und Granate/EMP (kurzer Tipp)
function updateSniperWaffen(p2) {
  p2.botFireRakete = false;
  const offline = Hack.hatHack(p2, 'waffenOffline');
  const kreuz = sniperKreuz(p2);
  const radius = Sniper.trefferRadius(p2);
  const imKreis = Sniper.zieleImKreis(kreuz.x, kreuz.y, radius);
  const bossImKreis = imKreis.some(z => arrays.bosses.includes(z));
  const normalImKreis = imKreis.some(z => !arrays.bosses.includes(z));
  const energie = p2.unbegrenzteEnergie ? 999 : p2.energie;
  const ladeEnergie = Math.min(Sniper.SCHUSS_ENERGIE + Sniper.LADE_ENERGIE + 1, p2.maxEnergie || 50);

  if (sniperModus) {
    sniperHaltedauer++;
    let loslassen = offline || sniperModus === 'tipp';
    if (sniperModus === 'laden') {
      const bossNah = bossImKreis || Sniper.zieleImKreis(kreuz.x, kreuz.y, radius * Sniper.MAX_RADIUSFAKTOR).some(z => arrays.bosses.includes(z));
      // Voll geladen (oder Energie bis auf den Schuss aufgebraucht) oder Boss weg: loslassen
      if (p2.sniperVoll || (p2.sniperLadung || 0) >= Sniper.LADUNG_VOLL || !bossNah || sniperHaltedauer > Sniper.LADUNG_VOLL + 15 || energie < Sniper.SCHUSS_ENERGIE + 1) loslassen = true;
    }
    if (loslassen) { p2.botFireLaser = false; sniperModus = null; sniperHaltedauer = 0; }
    else p2.botFireLaser = true;
  } else {
    p2.botFireLaser = false;
    if (!offline && p2.sniperCooldown <= 0) {
      if (bossImKreis) {
        if (energie >= ladeEnergie) { sniperModus = 'laden'; sniperHaltedauer = 0; p2.botFireLaser = true; }
      } else if (normalImKreis && energie >= 8) {
        sniperModus = 'tipp'; sniperHaltedauer = 0; p2.botFireLaser = true;
      }
    }
  }

  // Raketen-Taste: Minen (gehalten, solange ein Feind heranfliegt; mindestens 10 Schritte, damit es kein Tipp wird; max. 5 Minen)
  const minenLohnt = sniperMinenLohnt(p2);
  if (sniperMinenHalt) {
    sniperMinenSchritte++;
    const fertig = (p2.granateMinen || 0) >= 5 || !minenLohnt || offline || p2.raketenCooldown > 0;
    if (fertig && (sniperMinenSchritte > 10 || offline)) {
      sniperMinenHalt = false;
      sniperMinenSchritte = 0;
      sniperTippPause = 3;
    } else {
      p2.botFireRakete = true;
    }
    return;
  }
  // Raketen-Taste als kurzer Tipp (2 Schritte), danach Pause; EMP gegen nahe Geschosse hat Vorrang vor dem Granaten-Zielen
  if (sniperTippRest > 0) {
    p2.botFireRakete = true;
    sniperTippRest--;
    if (sniperTippRest === 0) sniperTippPause = 3;
  } else if (sniperTippPause > 0) {
    sniperTippPause--;
  } else if (!offline && p2.raketenCooldown <= 0 && (sniperEmpLohnt(p2) || sniperGranateLohnt(p2, kreuz, imKreis))) {
    sniperTippRest = 1;
    p2.botFireRakete = true;
  } else if (!offline && p2.raketenCooldown <= 0 && minenLohnt) {
    sniperMinenHalt = true;
    sniperMinenSchritte = 1;
    p2.botFireRakete = true;
  }
}

// --- Gleve: Dash (Raketen-Taste) auf nahe Feinde, Sweep (Laser-Taste) gegen Geschosse und Gegner im Bogen ---

function boxVon(z) {
  const g = z.groesse || 20;
  return { x: z.x, y: z.y, w: z.width || g, h: z.height || g };
}

// Wuerde der Dash vom Schiff aus in Richtung (dx, dy) einen Boss oder (unter Raketen-Stufe 5) Magma streifen?
function dashWegBlockiert(p2, dx, dy) {
  const s = config.spielerGroesse;
  const reichweite = Gleve.dashReichweite(p2);
  const hindernisse = [...arrays.bosses];
  if (!Gleve.dashKnacktMagma(p2)) hindernisse.push(...arrays.asteroiden.filter(a => a.istUnzerstoerbar));
  for (let i = 1; i <= Gleve.DASH_FRAMES; i++) {
    const x = p2.x + dx * reichweite * i / Gleve.DASH_FRAMES;
    const y = p2.y + dy * reichweite * i / Gleve.DASH_FRAMES;
    for (const h of hindernisse) {
      const b = boxVon(h);
      if (x < b.x + b.w && x + s > b.x && y < b.y + b.h && y + s > b.y) return true;
    }
  }
  return false;
}

// Boss in Dash-Reichweite oberhalb des Schiffs: Dash-Richtung auf seine Unterkante (der Dash prallt ab und macht Schaden)
function findeBossDashZiel(p2) {
  const s = config.spielerGroesse;
  const cx = p2.x + s / 2;
  const cy = p2.y + s / 2;
  const reichweite = Gleve.dashReichweite(p2);
  for (const boss of arrays.bosses) {
    if (boss.hp <= 0 || boss.phase !== 'kampf') continue;
    const b = boxVon(boss);
    const pad = b.w * 0.15;
    const zx = Math.max(b.x + pad, Math.min(b.x + b.w - pad, cx));
    const zy = b.y + b.h - pad;
    if (zy >= cy) continue;
    const d = Math.hypot(zx - cx, zy - cy);
    if (d > reichweite || d < 1) continue;
    return { dx: (zx - cx) / d, dy: (zy - cy) / d };
  }
  return null;
}

// Naechster normaler Feind in Dash-Reichweite mit freiem Weg; liefert die Dash-Richtung oder null
function findeDashZiel(p2) {
  const halfSize = config.spielerGroesse / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  const reichweite = Gleve.dashReichweite(p2);
  let beste = null;
  let besteDSq = Infinity;
  // Feindschiffe zuerst, Asteroiden nur ohne Feind
  const kandidaten = arrays.feinde.length > 0 ? arrays.feinde
    : arrays.asteroiden.filter(a => !a.traegtPowerup && kannAsteroidZerstoeren(p2, a));
  for (const f of kandidaten) {
    const b = boxVon(f);
    const fx = b.x + b.w / 2;
    const fy = b.y + b.h / 2;
    const dSq = distanceSq(cx, cy, fx, fy);
    // Ziel muss vollstaendig erreichbar sein (Mitte innerhalb der Reichweite)
    if (dSq > reichweite * reichweite || dSq >= besteDSq || dSq < 1) continue;
    const d = Math.sqrt(dSq);
    const dx = (fx - cx) / d;
    const dy = (fy - cy) / d;
    if (dashWegBlockiert(p2, dx, dy)) continue;
    beste = { dx, dy };
    besteDSq = dSq;
  }
  return beste;
}

// Liegt der Punkt im Sweep-Bogen der aktuellen Stufe (halber Winkel links und rechts der Senkrechten) bis zur Sweep-Laenge?
function imSweepBogen(p2, px, py) {
  const ox = p2.x + config.spielerGroesse / 2;
  const oy = p2.y + 5;
  const dx = px - ox;
  const dy = py - oy;
  const dist = Math.hypot(dx, dy);
  if (dist > Gleve.sweepLaenge(p2) || dy > 0) return false;
  return Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI) <= Gleve.sweepBogen(p2) / 2;
}

// Reicht die Energie fuer den naechsten Sweep (Superwaffe: immer)?
function sweepBereit(p2) {
  return p2.unbegrenzteEnergie || p2.energie >= Gleve.sweepKosten(p2);
}

function sweepLohntSich(p2) {
  const geschosse = [...arrays.feindLaserArray, ...arrays.hackProjektilArray, ...arrays.bossLaserArray];
  for (const p of geschosse) {
    if (p.harmlos) continue;
    const b = boxVon(p);
    if (imSweepBogen(p2, b.x + b.w / 2, b.y + b.h / 2)) return true;
  }
  const ziele = [...arrays.feinde, ...arrays.asteroiden.filter(a => !a.istUnzerstoerbar), ...arrays.bosses, ...arrays.bossRaketenArray];
  for (const z of ziele) {
    const b = boxVon(z);
    // Mitte oder untere Kante (grosse Ziele wie Bosse)
    if (imSweepBogen(p2, b.x + b.w / 2, b.y + b.h / 2) || imSweepBogen(p2, b.x + b.w / 2, b.y + b.h)) return true;
  }
  return false;
}

function updateGleveWaffen(p2) {
  // Dash (Raketen-Taste): ein Schritt Druck (Flanke), nur ohne Cooldown, ohne Waffen-Hack und nicht dauernd
  p2.botFireRakete = false;
  if (gleveDashSperre <= 0 && (p2.gleveDashLadungen || 0) >= 1 && !Gleve.istDashAktiv(p2) && !Hack.hatHack(p2, 'waffenOffline')) {
    let ziel = findeDashZiel(p2);
    // Bosse: nur mit mindestens 2 Ladungen (eine bleibt als Reserve)
    if (!ziel && arrays.feinde.length === 0 && (p2.gleveDashLadungen || 0) >= 2) ziel = findeBossDashZiel(p2);
    if (ziel) {
      p2.botDashRichtung = ziel;
      p2.botFireRakete = true;
      gleveDashSperre = GLEVE_DASH_PAUSE;
    }
  }

  // Sweep (Laser-Taste) halten, solange Feindgeschosse oder Gegner im Bogen sind (sonst Energie sparen)
  p2.botFireLaser = sweepLohntSich(p2);
}

function updateBotWeapons(p2, diff, target) {
  const halfSize = config.spielerGroesse / 2;
  const cx = p2.x + halfSize;

  if (Gleve.istGleve(p2)) {
    updateGleveWaffen(p2);
  } else if (Sniper.istSniper(p2)) {
    // Laser/Granate laufen jeden Schritt in updateBot (updateSniperWaffen)
  } else {
    updateStandardWaffen(p2, diff, target, cx);
  }

  // Bomben: Sehr selektiv — nur wenn ≥3 Feinde sichtbar + Cooldown voll abgelaufen
  p2.botFireBombe = false;
  if (p2.bombenCooldown <= 0) {
    const sichtbareFeinde = arrays.feinde.length + arrays.bosses.filter(b => b.hp > 0).length;
    if (sichtbareFeinde >= 3) {
      p2.botFireBombe = true;
    }
  }
}

function updateStandardWaffen(p2, diff, target, cx) {
  // Laser: Feuern wenn Ziel im Aim-Korridor
  p2.botFireLaser = false;
  if (target && Math.abs(target.x - cx) <= diff.aimCorridor) {
    p2.botFireLaser = true;
  }

  // Raketen: Feuern wenn Ziel im Schussfeld (bei Bossen immer wenn grob ausgerichtet, bei Feinden bis 350px)
  p2.botFireRakete = false;
  if (target && p2.raketenCooldown <= 0) {
    const isAligned = Math.abs(target.x - cx) <= (diff.aimCorridor * 1.5);
    if (target.isBoss && isAligned) {
      p2.botFireRakete = true;
    } else if (isAligned && target.dSq < 350 * 350) {
      p2.botFireRakete = true;
    }
  }
}

// --- Viper: Ausweichrolle, wenn eine Gefahr sehr nah ist und normales Ausweichen zu spaet kaeme ---
const ROLLE_GEFAHR_NAH = 40;

// Wie frei ist die Seite fuer eine Rolle: Platz bis zum Rand (hoechstens Rollweite), Abzug je Hindernis im Rollweg
function seitenFreiheit(p2, richtung, cx, cy) {
  const platz = richtung > 0 ? config.spielfeldBreite - config.spielerGroesse - p2.x : p2.x;
  let wert = Math.min(platz, Viper.ROLLE_DISTANZ);
  const x1 = cx + richtung * (Viper.ROLLE_DISTANZ + 15);
  const lo = Math.min(cx, x1) - 8;
  const hi = Math.max(cx, x1) + 8;
  const hindernisse = [...arrays.asteroiden, ...arrays.feinde, ...arrays.feindLaserArray, ...arrays.bossLaserArray,
    ...arrays.hackProjektilArray, ...arrays.bossBombenArray, ...arrays.bossRaketenArray];
  for (const h of hindernisse) {
    if (h.harmlos) continue;
    const hx = h.x + (h.groesse || h.width || 4) / 2;
    const hy = h.y + (h.groesse || h.height || 10) / 2;
    if (hx > lo && hx < hi && Math.abs(hy - cy) < 45) wert -= 100;
  }
  return wert;
}

function pruefeViperRolle(p2, danger) {
  p2.botRolleAnfrage = 0;
  if (!Viper.istViper(p2) || !danger || Viper.istRolleAktiv(p2) || (p2.viperRolleCooldown || 0) > 0) return;
  const cx = p2.x + config.spielerGroesse / 2;
  const cy = p2.y + config.spielerGroesse / 2;
  // Nur wenn die Gefahr fast auf dem Schiff liegt und von oben kommt (nicht schon vorbei)
  if (danger.dSq >= ROLLE_GEFAHR_NAH * ROLLE_GEFAHR_NAH) return;
  if (Math.abs(danger.x - cx) > config.spielerGroesse * 0.75 || danger.y > cy + 10) return;
  const links = seitenFreiheit(p2, -1, cx, cy);
  const rechts = seitenFreiheit(p2, 1, cx, cy);
  if (links === rechts) p2.botRolleAnfrage = danger.x > cx ? -1 : 1;
  else p2.botRolleAnfrage = links > rechts ? -1 : 1;
}

// --- Haupt-Update-Funktion (1x pro Frame) ---
export function updateBot() {
  const p2 = state.p2;
  if (!p2 || p2.isDead) return;

  const diff = BOT_DIFFICULTY[state.p2BotDifficulty || 'normal'];
  if (gleveDashSperre > 0) gleveDashSperre--;
  // Gleve-Dash ist eine Flanke: der Druck gilt nur bis zum naechsten Schritt
  if (Gleve.istGleve(p2)) p2.botFireRakete = false;

  // Reaktionszeit: Entscheidung nur alle N Frames aktualisieren
  reactionCounter++;
  if (reactionCounter >= diff.reactionFrames) {
    reactionCounter = 0;

    const danger = findNearestDanger(p2, diff);
    const powerup = findNearestPowerup(p2, diff);
    const target = findBestTarget(p2, diff);

    lastDecision = computeMovement(p2, target, danger, powerup, diff);
    pruefeViperRolle(p2, danger);
    updateBotWeapons(p2, diff, target);
  }

  if (Sniper.istSniper(p2)) updateSniperWaffen(p2);

  // Smooth Bewegung anwenden
  const p2Ship = shipModels && shipModels[p2.selectedShipModel || 'phantom'];
  const speed = (p2Ship?.speed || config.geschwindigkeit);

  p2.x += lastDecision.moveX * speed;
  p2.y += lastDecision.moveY * speed;

  // Bounds-Clamping
  if (p2.x < 0) p2.x = 0;
  if (p2.y < 0) p2.y = 0;
  if (p2.x > config.spielfeldBreite - config.spielerGroesse) p2.x = config.spielfeldBreite - config.spielerGroesse;
  if (p2.y > config.spielfeldHoehe - config.spielerGroesse) p2.y = config.spielfeldHoehe - config.spielerGroesse;
}

// Reset bei Neustart
export function resetBot() {
  reactionCounter = 0;
  lastDecision = { moveX: 0, moveY: 0 };
  gleveDashSperre = 0;
  sniperModus = null;
  sniperTippRest = 0;
  sniperTippPause = 0;
  sniperMinenHalt = false;
  sniperMinenSchritte = 0;
  sniperHaltedauer = 0;
}
