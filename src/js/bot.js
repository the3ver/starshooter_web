import { state, config, arrays, shipModels } from './state.js';
import * as Gleve from './gleve.js';
import * as Viper from './viper.js';
import * as Sniper from './sniper.js';
import * as Hack from './hack.js';
import * as Rock from './rock.js';

// --- Bot-Schwierigkeitsstufen ---
const BOT_DIFFICULTY = {
  easy: { reactionFrames: 8, aimCorridor: 60, dodgeRadius: 60, powerupRange: 120 },
  normal: { reactionFrames: 3, aimCorridor: 30, dodgeRadius: 80, powerupRange: 180 },
  hard: { reactionFrames: 0, aimCorridor: 15, dodgeRadius: 100, powerupRange: 250 },
};

let reactionCounter = 0;
let lastDecision = { moveX: 0, moveY: 0 };

// Abstand zum Spielfeldrand, den der Bot beim Zielen und Ausweichen einhaelt
const EDGE_DISTANCE = 50;

// Gleve-Bot: Mindestabstand zwischen zwei Dashs (Schritte), damit er nicht dauernd dasht
const GLEVE_DASH_PAUSE = 40;
let gleveDashLock = 0;

// --- Hilfsfunktionen ---

function distanceSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function findNearestDanger(p2, diff) {
  const dangers = [];
  const halfSize = config.playerSize / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  const dodgeRadiusSq = diff.dodgeRadius * diff.dodgeRadius;

  // Asteroiden
  for (const ast of arrays.asteroids) {
    const ax = ast.x + (ast.size || 30) / 2;
    const ay = ast.y + (ast.size || 30) / 2;
    const dSq = distanceSq(cx, cy, ax, ay);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: ax, y: ay, dSq, vy: ast.speed || 2 });
    }
  }

  // Feindliche Projektile (Laser + Bomben + Raketen)
  for (const fl of arrays.enemyLaserArray) {
    if (fl.harmless) continue; // von der Gleve weggeschleudert
    const fx = fl.x + 2;
    const fy = fl.y + 5;
    const dSq = distanceSq(cx, cy, fx, fy);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: fx, y: fy, dSq, vy: fl.vy || 4 });
    }
  }
  for (const bl of arrays.bossLaserArray) {
    if (bl.harmless) continue; // von der Gleve weggeschleudert
    const bx = bl.x + 3;
    const by = bl.y + 5;
    const dSq = distanceSq(cx, cy, bx, by);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: bx, y: by, dSq, vy: bl.vy || 4 });
    }
  }
  for (const bb of arrays.bossBombArray) {
    const bx = bb.x + 8;
    const by = bb.y + 8;
    const dSq = distanceSq(cx, cy, bx, by);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: bx, y: by, dSq, vy: bb.vy || 2 });
    }
  }
  for (const br of arrays.bossMissileArray) {
    const bx = br.x + 5;
    const by = br.y + 8;
    const dSq = distanceSq(cx, cy, bx, by);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: bx, y: by, dSq, vy: br.vy || 3 });
    }
  }

  // Feinde direkt
  for (const enemy of arrays.enemies) {
    const half = (enemy.size || 30) / 2;
    const fx = enemy.x + half;
    const fy = enemy.y + half;
    const dSq = distanceSq(cx, cy, fx, fy);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: fx, y: fy, dSq, vy: enemy.speed || 2 });
    }
  }

  if (dangers.length === 0) return null;
  dangers.sort((a, b) => a.dSq - b.dSq);
  return dangers[0];
}

// Schockwelle erst einsammeln, wenn genug im Bild ist (Feinde und Geschosse), oder bevor sie unten verschwindet
export const SHOCKWAVE_MIN_TARGETS = 4;
export function shockwaveWorthIt(p) {
  if (p.y > config.playfieldHeight - 150) return true;
  const inImage = o => o.y > 0 && o.y < config.playfieldHeight;
  const targets = arrays.enemies.filter(inImage).length + arrays.enemyLaserArray.filter(inImage).length;
  return targets >= SHOCKWAVE_MIN_TARGETS;
}

function findNearestPowerup(p2, diff) {
  const halfSize = config.playerSize / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  const rangeSq = diff.powerupRange * diff.powerupRange;
  let nearest = null;
  let nearestDSq = Infinity;

  for (const p of arrays.powerups) {
    if (p.towedBy) continue; // Schon gezogen
    if (p.type === 'shockwave' && !shockwaveWorthIt(p)) continue;
    const px = p.x + (p.size || 16) / 2;
    const py = p.y + (p.size || 16) / 2;
    const dSq = distanceSq(cx, cy, px, py);
    if (dSq < rangeSq && dSq < nearestDSq) {
      nearest = { x: px, y: py, dSq };
      nearestDSq = dSq;
    }
  }
  return nearest;
}

// Boss-Mitte: Bosse sind quadratisch mit Kantenlaenge groesse
function bossMiddle(boss) {
  const g = boss.size || 100;
  return { x: boss.x + g / 2, y: boss.y + g / 2 };
}

// Kann der Bot diesen Asteroiden zerstoeren? Magma nur mit dem Gleve-Dash ab Raketen-Stufe 5
function canAsteroidDestroy(p2, ast) {
  if (!ast.isIndestructible) return true;
  return Gleve.isGleve(p2) && Gleve.dashCracksMagma(p2);
}

export function findBestTarget(p2, diff) {
  const halfSize = config.playerSize / 2;
  const cx = p2.x + halfSize;
  let bestTarget = null;
  let bestDSq = Infinity;

  // Bosse und Feindschiffe: naechstes Ziel ueber dem Bot
  for (const boss of arrays.bosses) {
    if (boss.hp <= 0 || boss.isIndestructible) continue; // geschlossenes Auge
    const m = bossMiddle(boss);
    const dSq = distanceSq(cx, p2.y, m.x, m.y);
    if (m.y < p2.y && dSq < bestDSq) {
      // Nur Ziele über dem Bot
      bestTarget = {
        x: m.x,
        y: m.y,
        dSq,
        isBoss: true,
        bottom: boss.y + (boss.size || 100),
        size: boss.size || 100,
      };
      bestDSq = dSq;
    }
  }

  for (const enemy of arrays.enemies) {
    if (enemy.chainT < 0) continue; // Kettenglied wartet noch ausserhalb des Felds
    if (enemy.isIndestructible) continue; // geschlossene Bluete: Laser prallen ab
    const half = (enemy.size || 30) / 2;
    const fx = enemy.x + half;
    const fy = enemy.y + half;
    const dSq = distanceSq(cx, p2.y, fx, fy);
    if (fy < p2.y && dSq < bestDSq) {
      bestTarget = { x: fx, y: fy, dSq, isBoss: false };
      bestDSq = dSq;
    }
  }
  if (bestTarget) return bestTarget;

  // Asteroiden nur ohne Gegnerschiff, und nur solche, die der Bot zerstoeren kann
  for (const ast of arrays.asteroids) {
    if (!canAsteroidDestroy(p2, ast)) continue;
    const ax = ast.x + (ast.size || 30) / 2;
    const ay = ast.y + (ast.size || 30) / 2;
    const dSq = distanceSq(cx, p2.y, ax, ay);
    if (ay < p2.y && dSq < bestDSq) {
      bestTarget = { x: ax, y: ay, dSq, isBoss: false };
      bestDSq = dSq;
    }
  }

  return bestTarget;
}

function computeMovement(p2, target, danger, powerup, diff) {
  const halfSize = config.playerSize / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  let moveX = 0;
  let moveY = 0;

  // Menschliche Taktik: Basis-Position im unteren Viertel (y: 480-520 auf 600px Feld)
  const baselineY = config.playfieldHeight - 90;

  // Priorität 1: Gefahren ausweichen
  if (danger) {
    const dx = cx - danger.x;
    const dy = cy - danger.y;
    const dist = Math.sqrt(danger.dSq) || 1;
    // Weg von der Gefahr bewegen
    moveX = (dx / dist) * 1.5;
    moveY = (dy / dist) * 1.2;
    const roomLeft = cx;
    const roomRight = config.playfieldWidth - cx;
    // Gleve mit bereitem Sweep (laeuft oder genug Energie) pariert Gefahren im Bogen, statt seitlich aus ihm herauszufliegen
    const parried =
      Gleve.isGleve(p2) && (Gleve.isSweepActive(p2) || sweepReady(p2)) && inSweepArc(p2, danger.x, danger.y);
    // Gefahr fast genau ueber dem Bot: seitlich zur freieren Seite ausweichen statt nur nach unten
    if (!parried && Math.abs(dx) < 20 && dy > 0) moveX = (roomRight >= roomLeft ? 1 : -1) * 1.5;
    // Nicht in die Wand ausweichen, sondern zur Mitte hin
    if ((moveX < 0 && roomLeft < EDGE_DISTANCE) || (moveX > 0 && roomRight < EDGE_DISTANCE)) moveX = -moveX;
    if (moveY > 0 && cy > config.playfieldHeight - EDGE_DISTANCE) moveY = 0;
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
    const targetX = Math.max(EDGE_DISTANCE, Math.min(config.playfieldWidth - EDGE_DISTANCE, target.x));
    const dx = targetX - cx;
    if (Math.abs(dx) > diff.aimCorridor / 2) {
      moveX = dx > 0 ? 0.8 : -0.8;
    }
    // Vertikal: Bleibe im unteren Viertel (Grundlinie), um Feinde/Bosse aus sicherer Distanz zu beschießen.
    // Die Gleve (Nahkampf) haelt sich knapp ausserhalb der Dash-Reichweite unter normalen Feinden.
    let idealY = target.isBoss ? baselineY : Math.max(baselineY, target.y + 250);
    if (Gleve.isGleve(p2) && !target.isBoss) idealY = Math.min(baselineY, target.y + Gleve.dashRange(p2) * 0.8);
    // Gegen Bosse geht die Gleve in Sweep-Reichweite unter die Boss-Unterkante (mit Abstand zum Koerper, Kollision schadet)
    if (Gleve.isGleve(p2) && target.isBoss) {
      const bossBottom = target.bottom;
      idealY = Math.min(baselineY, bossBottom + 0.6 * Gleve.sweepLength(p2));
    }
    if (Sniper.isSniper(p2)) return sniperMovement(p2, target, cx, cy, targetX);
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
  const formationTargetY = Math.max(baselineY - 40, Math.min(config.playfieldHeight - 60, p1y));
  const fdx = formationTargetX - cx;
  const fdy = formationTargetY - cy;
  if (Math.abs(fdx) > 15) moveX = fdx > 0 ? 0.4 : -0.4;
  if (Math.abs(fdy) > 15) moveY = fdy > 0 ? 0.4 : -0.4;

  return { moveX, moveY };
}

// --- Sniper: Fadenkreuz (Grundposition 220 px ueber dem Schiff) auf das Ziel bringen, tippen/laden, Granate ---

const SNIPER_TOLERANCE = 6;
let sniperMode = null; // null (Taste oben) | 'tipp' | 'laden'
let sniperHoldTime = 0;
let sniperTapRest = 0; // verbleibende Schritte des Granaten-/EMP-Tippens (botFireRakete true)
let sniperTapPause = 0; // Pause nach dem Tippen, damit das Loslassen verarbeitet wird, bevor ein neuer Tipp beginnt
let sniperMineStop = false; // Raketen-Taste wird zum Minenlegen gehalten
let sniperMineSteps = 0; // bisherige Haltedauer fuer die Minen
const sniperBeforeDist = new WeakMap(); // letzter Abstand von Feinden/Asteroiden zum Schiff (Annaeherung erkennen)

// Unter dem Ziel stehen, sodass das Fadenkreuz auf dem Ziel liegt (Bosse: knapp ueber der Unterkante, ihre Box ist gross)
function sniperMovement(p2, target, cx, cy, targetX) {
  let moveX = 0;
  let moveY = 0;
  const dx = targetX - cx;
  if (Math.abs(dx) > SNIPER_TOLERANCE) moveX = dx > 0 ? 0.8 : -0.8;
  const crossY = target.isBoss ? target.bottom - 0.3 * target.size : target.y;
  const halfSize = config.playerSize / 2;
  // Schiffsoberkante = Mitte - halfSize; Fadenkreuz liegt FADENKREUZ_ABSTAND darueber (oben bei 0 begrenzt)
  const idealCy = Math.max(
    Sniper.CROSSHAIR_DISTANCE + halfSize,
    Math.min(config.playfieldHeight - halfSize, crossY + Sniper.CROSSHAIR_DISTANCE + halfSize),
  );
  const dy = idealCy - cy;
  if (Math.abs(dy) > SNIPER_TOLERANCE) moveY = dy > 0 ? 0.8 : -0.8;
  return { moveX, moveY };
}

function sniperCross(p2) {
  if (p2.sniperTargetX != null && p2.sniperTargetY != null) return { x: p2.sniperTargetX, y: p2.sniperTargetY };
  return Sniper.basePosition(p2);
}

function sniperGrenadePaysOff(p2, cross, inCircle) {
  if (arrays.bosses.some(b => b.hp > 0 && inCircle.includes(b))) return true;
  const r = Sniper.grenadeRadius(p2);
  let enemies = 0;
  for (const f of arrays.enemies) {
    if (f.hp <= 0) continue;
    const g = f.size || 30;
    if (Math.hypot(f.x + g / 2 - cross.x, f.y + g / 2 - cross.y) <= r) enemies++;
  }
  if (enemies >= 2) return true;
  // Stufe 5 loescht Geschosse im Radius: Geschoss, das nach der Flugzeit (30 Schritte) am Kreuz ankommt und aufs Schiff zielt
  if ((p2.missileTier || 1) >= 5) {
    const cx = p2.x + config.playerSize / 2;
    for (const g of [
      ...arrays.enemyLaserArray,
      ...arrays.bossLaserArray,
      ...arrays.hackProjectileArray,
      ...arrays.bossMissileArray,
    ]) {
      if (g.harmless || Math.abs(g.x - cx) > 50 || g.y > p2.y) continue;
      const py = g.y + (g.vy || 4) * Sniper.GRENADE_FLIGHT;
      if (Math.hypot(g.x - cross.x, py - cross.y) <= r * 0.8) return true;
    }
  }
  return false;
}

// Feindliches Geschoss (v. a. Boss-Rakete) naeher als 80 px am Schiffsmittelpunkt: das EMP loest es auf
function sniperEmpPaysOff(p2) {
  const cx = p2.x + config.playerSize / 2;
  const cy = p2.y + config.playerSize / 2;
  const r = Math.min(80, Sniper.empRadius(p2));
  for (const g of [
    ...arrays.enemyLaserArray,
    ...arrays.bossLaserArray,
    ...arrays.hackProjectileArray,
    ...arrays.bossMissileArray,
  ]) {
    if (g.harmless) continue;
    const w = g.width || g.size || 4;
    const h = g.height || g.size || 4;
    const nx = Math.max(g.x, Math.min(cx, g.x + w));
    const ny = Math.max(g.y, Math.min(cy, g.y + h));
    if (Math.hypot(nx - cx, ny - cy) < r) return true;
  }
  return false;
}

// Feind oder Asteroid (nicht Magma) naeher als 150 px am Schiffsmittelpunkt und im Annaehern: Minen legen
function sniperMinePaysOff(p2) {
  const cx = p2.x + config.playerSize / 2;
  const cy = p2.y + config.playerSize / 2;
  let paysOff = false;
  for (const z of [...arrays.enemies, ...arrays.asteroids]) {
    if (z.isIndestructible || (z.hp !== undefined && z.hp <= 0)) continue;
    const g = z.size || 30;
    const dist = Math.hypot(z.x + g / 2 - cx, z.y + g / 2 - cy);
    const beforehand = sniperBeforeDist.get(z);
    sniperBeforeDist.set(z, dist);
    if (dist < 150 && beforehand !== undefined && dist < beforehand - 0.01) paysOff = true;
  }
  return paysOff;
}

// Jeden Schritt: Laser-Taste (Tippen/Laden: Halten und Loslassen brauchen den Schrittakt) und Granate/EMP (kurzer Tipp)
function updateSniperWeapons(p2) {
  p2.botFireMissile = false;
  const offline = Hack.hasHack(p2, 'weaponOffline');
  const cross = sniperCross(p2);
  const radius = Sniper.hitRadius(p2);
  const inCircle = Sniper.targetInCircle(cross.x, cross.y, radius);
  const bossInCircle = inCircle.some(z => arrays.bosses.includes(z));
  const normalInCircle = inCircle.some(z => !arrays.bosses.includes(z));
  const energy = p2.unlimitedEnergy ? 999 : p2.energy;
  const chargingEnergy = Math.min(Sniper.SHOT_ENERGY + Sniper.CHARGING_ENERGY + 1, p2.maxEnergy || 50);

  if (sniperMode) {
    sniperHoldTime++;
    let release = offline || sniperMode === 'tap';
    if (sniperMode === 'charge') {
      const bossNear =
        bossInCircle ||
        Sniper.targetInCircle(cross.x, cross.y, radius * Sniper.MAX_RADIUS_FACTOR).some(z => arrays.bosses.includes(z));
      // Voll geladen (oder Energie bis auf den Schuss aufgebraucht) oder Boss weg: loslassen
      if (
        p2.sniperFull ||
        (p2.sniperCharge || 0) >= Sniper.CHARGE_FULL ||
        !bossNear ||
        sniperHoldTime > Sniper.CHARGE_FULL + 15 ||
        energy < Sniper.SHOT_ENERGY + 1
      )
        release = true;
    }
    if (release) {
      p2.botFireLaser = false;
      sniperMode = null;
      sniperHoldTime = 0;
    } else p2.botFireLaser = true;
  } else {
    p2.botFireLaser = false;
    if (!offline && p2.sniperCooldown <= 0) {
      if (bossInCircle) {
        if (energy >= chargingEnergy) {
          sniperMode = 'charge';
          sniperHoldTime = 0;
          p2.botFireLaser = true;
        }
      } else if (normalInCircle && energy >= 8) {
        sniperMode = 'tap';
        sniperHoldTime = 0;
        p2.botFireLaser = true;
      }
    }
  }

  // Raketen-Taste: Minen (gehalten, solange ein Feind heranfliegt; mindestens 10 Schritte, damit es kein Tipp wird; max. 5 Minen)
  const minePaysOff = sniperMinePaysOff(p2);
  if (sniperMineStop) {
    sniperMineSteps++;
    const done =
      (p2.grenadeMines || 0) >= 5 ||
      !minePaysOff ||
      offline ||
      ((p2.grenadeMines || 0) === 0 && (p2.sniperGrenadeCharges || 0) < 1);
    if (done && (sniperMineSteps > 10 || offline)) {
      sniperMineStop = false;
      sniperMineSteps = 0;
      sniperTapPause = 3;
    } else {
      p2.botFireMissile = true;
    }
    return;
  }
  // Raketen-Taste als kurzer Tipp (2 Schritte), danach Pause; EMP gegen nahe Geschosse hat Vorrang vor dem Granaten-Zielen
  if (sniperTapRest > 0) {
    p2.botFireMissile = true;
    sniperTapRest--;
    if (sniperTapRest === 0) sniperTapPause = 3;
  } else if (sniperTapPause > 0) {
    sniperTapPause--;
  } else if (
    !offline &&
    (p2.sniperGrenadeCharges || 0) >= 1 &&
    (sniperEmpPaysOff(p2) || sniperGrenadePaysOff(p2, cross, inCircle))
  ) {
    sniperTapRest = 1;
    p2.botFireMissile = true;
  } else if (!offline && (p2.sniperGrenadeCharges || 0) >= 1 && minePaysOff) {
    sniperMineStop = true;
    sniperMineSteps = 1;
    p2.botFireMissile = true;
  }
}

// --- Gleve: Dash (Raketen-Taste) auf nahe Feinde, Sweep (Laser-Taste) gegen Geschosse und Gegner im Bogen ---

function boxFrom(z) {
  const g = z.size || 20;
  return { x: z.x, y: z.y, w: z.width || g, h: z.height || g };
}

// Wuerde der Dash vom Schiff aus in Richtung (dx, dy) einen Boss oder (unter Raketen-Stufe 5) Magma streifen?
function dashGoneBlocked(p2, dx, dy) {
  const s = config.playerSize;
  const range = Gleve.dashRange(p2);
  const obstacles = [...arrays.bosses];
  if (!Gleve.dashCracksMagma(p2)) obstacles.push(...arrays.asteroids.filter(a => a.isIndestructible));
  for (let i = 1; i <= Gleve.DASH_FRAMES; i++) {
    const x = p2.x + (dx * range * i) / Gleve.DASH_FRAMES;
    const y = p2.y + (dy * range * i) / Gleve.DASH_FRAMES;
    for (const h of obstacles) {
      const b = boxFrom(h);
      if (x < b.x + b.w && x + s > b.x && y < b.y + b.h && y + s > b.y) return true;
    }
  }
  return false;
}

// Boss in Dash-Reichweite oberhalb des Schiffs: Dash-Richtung auf seine Unterkante (der Dash prallt ab und macht Schaden)
function findBossDashTarget(p2) {
  const s = config.playerSize;
  const cx = p2.x + s / 2;
  const cy = p2.y + s / 2;
  const range = Gleve.dashRange(p2);
  for (const boss of arrays.bosses) {
    if (boss.hp <= 0 || boss.phase !== 'kampf') continue;
    const b = boxFrom(boss);
    const pad = b.w * 0.15;
    const zx = Math.max(b.x + pad, Math.min(b.x + b.w - pad, cx));
    const zy = b.y + b.h - pad;
    if (zy >= cy) continue;
    const d = Math.hypot(zx - cx, zy - cy);
    if (d > range || d < 1) continue;
    return { dx: (zx - cx) / d, dy: (zy - cy) / d };
  }
  return null;
}

// Naechster normaler Feind in Dash-Reichweite mit freiem Weg; liefert die Dash-Richtung oder null
function findDashTarget(p2) {
  const halfSize = config.playerSize / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  const range = Gleve.dashRange(p2);
  let best = null;
  let bestEnemyDSq = Infinity;
  // Feindschiffe zuerst, Asteroiden nur ohne Feind
  const candidates =
    arrays.enemies.length > 0
      ? arrays.enemies
      : arrays.asteroids.filter(a => !a.carriesPowerup && canAsteroidDestroy(p2, a));
  for (const f of candidates) {
    const b = boxFrom(f);
    const fx = b.x + b.w / 2;
    const fy = b.y + b.h / 2;
    const dSq = distanceSq(cx, cy, fx, fy);
    // Ziel muss vollstaendig erreichbar sein (Mitte innerhalb der Reichweite)
    if (dSq > range * range || dSq >= bestEnemyDSq || dSq < 1) continue;
    const d = Math.sqrt(dSq);
    const dx = (fx - cx) / d;
    const dy = (fy - cy) / d;
    if (dashGoneBlocked(p2, dx, dy)) continue;
    best = { dx, dy };
    bestEnemyDSq = dSq;
  }
  return best;
}

// Liegt der Punkt im Sweep-Bogen der aktuellen Stufe (halber Winkel links und rechts der Senkrechten) bis zur Sweep-Laenge?
function inSweepArc(p2, px, py) {
  const ox = p2.x + config.playerSize / 2;
  const oy = p2.y + 5;
  const dx = px - ox;
  const dy = py - oy;
  const dist = Math.hypot(dx, dy);
  if (dist > Gleve.sweepLength(p2) || dy > 0) return false;
  return Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI) <= Gleve.sweepArc(p2) / 2;
}

// Reicht die Energie fuer den naechsten Sweep (Superwaffe: immer)?
function sweepReady(p2) {
  return p2.unlimitedEnergy || p2.energy >= Gleve.sweepCost(p2);
}

function sweepPaysOffSelf(p2) {
  const projectiles = [...arrays.enemyLaserArray, ...arrays.hackProjectileArray, ...arrays.bossLaserArray];
  for (const p of projectiles) {
    if (p.harmless) continue;
    const b = boxFrom(p);
    if (inSweepArc(p2, b.x + b.w / 2, b.y + b.h / 2)) return true;
  }
  const targets = [
    ...arrays.enemies,
    ...arrays.asteroids.filter(a => !a.isIndestructible),
    ...arrays.bosses,
    ...arrays.bossMissileArray,
  ];
  for (const z of targets) {
    const b = boxFrom(z);
    // Mitte oder untere Kante (grosse Ziele wie Bosse)
    if (inSweepArc(p2, b.x + b.w / 2, b.y + b.h / 2) || inSweepArc(p2, b.x + b.w / 2, b.y + b.h)) return true;
  }
  return false;
}

function updateGleveWeapons(p2) {
  // Dash (Raketen-Taste): ein Schritt Druck (Flanke), nur ohne Cooldown, ohne Waffen-Hack und nicht dauernd
  p2.botFireMissile = false;
  if (
    gleveDashLock <= 0 &&
    (p2.gleveDashCharges || 0) >= 1 &&
    !Gleve.isDashActive(p2) &&
    !Hack.hasHack(p2, 'weaponOffline')
  ) {
    let aimTarget = findDashTarget(p2);
    // Bosse: nur mit mindestens 2 Ladungen (eine bleibt als Reserve)
    if (!aimTarget && arrays.enemies.length === 0 && (p2.gleveDashCharges || 0) >= 2)
      aimTarget = findBossDashTarget(p2);
    if (aimTarget) {
      p2.botDashDirection = aimTarget;
      p2.botFireMissile = true;
      gleveDashLock = GLEVE_DASH_PAUSE;
    }
  }

  // Sweep (Laser-Taste) halten, solange Feindgeschosse oder Gegner im Bogen sind (sonst Energie sparen)
  p2.botFireLaser = sweepPaysOffSelf(p2);
}

function updateBotWeapons(p2, diff, target) {
  const halfSize = config.playerSize / 2;
  const cx = p2.x + halfSize;

  if (Gleve.isGleve(p2)) {
    updateGleveWeapons(p2);
  } else if (Sniper.isSniper(p2)) {
    // Laser/Granate laufen jeden Schritt in updateBot (updateSniperWaffen)
  } else {
    updateStandardWeapons(p2, diff, target, cx);
  }

  // Bomben: Sehr selektiv — nur wenn ≥3 Feinde sichtbar + Cooldown voll abgelaufen
  p2.botFireBomb = false;
  if (p2.bombCooldown <= 0) {
    const visibleEnemies = arrays.enemies.length + arrays.bosses.filter(b => b.hp > 0).length;
    if (visibleEnemies >= 3) {
      p2.botFireBomb = true;
    }
  }
}

function updateStandardWeapons(p2, diff, target, cx) {
  // Laser: Feuern wenn Ziel im Aim-Korridor
  p2.botFireLaser = false;
  if (target && Math.abs(target.x - cx) <= diff.aimCorridor) {
    p2.botFireLaser = true;
  }

  // Raketen: Feuern wenn Ziel im Schussfeld (bei Bossen immer wenn grob ausgerichtet, bei Feinden bis 350px)
  p2.botFireMissile = false;
  if (target && p2.missileCooldown <= 0) {
    const isAligned = Math.abs(target.x - cx) <= diff.aimCorridor * 1.5;
    if (target.isBoss && isAligned) {
      p2.botFireMissile = true;
    } else if (isAligned && target.dSq < 350 * 350) {
      p2.botFireMissile = true;
    }
  }
}

// --- Viper: Ausweichrolle, wenn eine Gefahr sehr nah ist und normales Ausweichen zu spaet kaeme ---
const ROLL_DANGER_NEAR = 40;

// Wie frei ist die Seite fuer eine Rolle: Platz bis zum Rand (hoechstens Rollweite), Abzug je Hindernis im Rollweg
function sidesFreedom(p2, direction, cx, cy) {
  const spot = direction > 0 ? config.playfieldWidth - config.playerSize - p2.x : p2.x;
  let value = Math.min(spot, Viper.ROLL_DISTANCE);
  const x1 = cx + direction * (Viper.ROLL_DISTANCE + 15);
  const lo = Math.min(cx, x1) - 8;
  const hi = Math.max(cx, x1) + 8;
  const obstacles = [
    ...arrays.asteroids,
    ...arrays.enemies,
    ...arrays.enemyLaserArray,
    ...arrays.bossLaserArray,
    ...arrays.hackProjectileArray,
    ...arrays.bossBombArray,
    ...arrays.bossMissileArray,
  ];
  for (const h of obstacles) {
    if (h.harmless) continue;
    const hx = h.x + (h.size || h.width || 4) / 2;
    const hy = h.y + (h.size || h.height || 10) / 2;
    if (hx > lo && hx < hi && Math.abs(hy - cy) < 45) value -= 100;
  }
  return value;
}

function checkViperRoll(p2, danger) {
  p2.botRollRequest = 0;
  if (!Viper.isViper(p2) || !danger || Viper.isRollActive(p2) || (p2.viperRollCooldown || 0) > 0) return;
  const cx = p2.x + config.playerSize / 2;
  const cy = p2.y + config.playerSize / 2;
  // Nur wenn die Gefahr fast auf dem Schiff liegt und von oben kommt (nicht schon vorbei)
  if (danger.dSq >= ROLL_DANGER_NEAR * ROLL_DANGER_NEAR) return;
  if (Math.abs(danger.x - cx) > config.playerSize * 0.75 || danger.y > cy + 10) return;
  const left = sidesFreedom(p2, -1, cx, cy);
  const right = sidesFreedom(p2, 1, cx, cy);
  if (left === right) p2.botRollRequest = danger.x > cx ? -1 : 1;
  else p2.botRollRequest = left > right ? -1 : 1;
}

// Fels: Abstand zu Waenden und Inseln halten. Geprueft wird auch etwas oberhalb des Schiffs, weil der Fels
// nach unten scrollt. Liefert eine zusaetzliche Seitwaertsbewegung (-1..1) Richtung Mitte des freien Bereichs.
export const ROCK_DISTANCE = 25;
export function dodgeRock(p2) {
  if (!arrays.rock.length) return 0;
  const g = config.playerSize;
  const cx = p2.x + g / 2;
  let left = 0;
  let right = config.playfieldWidth;
  for (const y of [p2.y - 40, p2.y, p2.y + g]) {
    const f = Rock.freeRange(y, cx);
    left = Math.max(left, f.left);
    right = Math.min(right, f.right);
  }
  if (p2.x - left < ROCK_DISTANCE && right - (p2.x + g) < ROCK_DISTANCE) return 0;
  if (p2.x - left < ROCK_DISTANCE) return 1;
  if (right - (p2.x + g) < ROCK_DISTANCE) return -1;
  return 0;
}

// --- Haupt-Update-Funktion (1x pro Frame) ---
export function updateBot() {
  const p2 = state.p2;
  if (!p2 || p2.isDead) return;

  const diff = BOT_DIFFICULTY[state.p2BotDifficulty || 'normal'];
  if (gleveDashLock > 0) gleveDashLock--;
  // Gleve-Dash ist eine Flanke: der Druck gilt nur bis zum naechsten Schritt
  if (Gleve.isGleve(p2)) p2.botFireMissile = false;

  // Reaktionszeit: Entscheidung nur alle N Frames aktualisieren
  reactionCounter++;
  if (reactionCounter >= diff.reactionFrames) {
    reactionCounter = 0;

    const danger = findNearestDanger(p2, diff);
    const powerup = findNearestPowerup(p2, diff);
    const target = findBestTarget(p2, diff);

    lastDecision = computeMovement(p2, target, danger, powerup, diff);
    checkViperRoll(p2, danger);
    updateBotWeapons(p2, diff, target);
  }

  if (Sniper.isSniper(p2)) updateSniperWeapons(p2);

  // Smooth Bewegung anwenden
  const p2Ship = shipModels && shipModels[p2.selectedShipModel || 'phantom'];
  const speed = p2Ship?.speed || config.speed;

  p2.x += (lastDecision.moveX + dodgeRock(p2)) * speed;
  p2.y += lastDecision.moveY * speed;

  // Bounds-Clamping
  if (p2.x < 0) p2.x = 0;
  if (p2.y < 0) p2.y = 0;
  if (p2.x > config.playfieldWidth - config.playerSize) p2.x = config.playfieldWidth - config.playerSize;
  if (p2.y > config.playfieldHeight - config.playerSize) p2.y = config.playfieldHeight - config.playerSize;
}

// Reset bei Neustart
export function resetBot() {
  reactionCounter = 0;
  lastDecision = { moveX: 0, moveY: 0 };
  gleveDashLock = 0;
  sniperMode = null;
  sniperTapRest = 0;
  sniperTapPause = 0;
  sniperMineStop = false;
  sniperMineSteps = 0;
  sniperHoldTime = 0;
}
