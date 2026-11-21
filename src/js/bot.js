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

// Distance to the playfield edge the bot keeps when aiming and dodging
const EDGE_DISTANCE = 50;

// Gleve bot: minimum gap between two dashes (steps), so it does not dash constantly
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

  // Asteroids
  for (const ast of arrays.asteroids) {
    const ax = ast.x + (ast.size || 30) / 2;
    const ay = ast.y + (ast.size || 30) / 2;
    const dSq = distanceSq(cx, cy, ax, ay);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: ax, y: ay, dSq, vy: ast.speed || 2 });
    }
  }

  // Enemy projectiles (lasers + bombs + missiles)
  for (const fl of arrays.enemyLaserArray) {
    if (fl.harmless) continue; // flung away by the Gleve
    const fx = fl.x + 2;
    const fy = fl.y + 5;
    const dSq = distanceSq(cx, cy, fx, fy);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: fx, y: fy, dSq, vy: fl.vy || 4 });
    }
  }
  for (const bl of arrays.bossLaserArray) {
    if (bl.harmless) continue; // flung away by the Gleve
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

  // Enemies directly
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

// Collect the shockwave only when enough is on screen (enemies and projectiles), or before it vanishes at the bottom
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
    if (p.towedBy) continue; // Already towed
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

// Boss center: bosses are square with edge length size
function bossMiddle(boss) {
  const g = boss.size || 100;
  return { x: boss.x + g / 2, y: boss.y + g / 2 };
}

// Can the bot destroy this asteroid? Magma only with the Gleve dash from missile tier 5 on
function canAsteroidDestroy(p2, ast) {
  if (!ast.isIndestructible) return true;
  return Gleve.isGleve(p2) && Gleve.dashCracksMagma(p2);
}

export function findBestTarget(p2, diff) {
  const halfSize = config.playerSize / 2;
  const cx = p2.x + halfSize;
  let bestTarget = null;
  let bestDSq = Infinity;

  // Bosses and enemy ships: nearest target above the bot
  for (const boss of arrays.bosses) {
    if (boss.hp <= 0 || boss.isIndestructible) continue; // closed eye
    const m = bossMiddle(boss);
    const dSq = distanceSq(cx, p2.y, m.x, m.y);
    if (m.y < p2.y && dSq < bestDSq) {
      // Only targets above the bot
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
    if (enemy.chainT < 0) continue; // Chain link still waiting outside the field
    if (enemy.isIndestructible) continue; // closed bloom: lasers bounce off
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

  // Asteroids only without an enemy ship, and only those the bot can destroy
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

  // Human tactics: base position in the lower quarter (y: 480-520 on a 600px field)
  const baselineY = config.playfieldHeight - 90;

  // Priority 1: dodge dangers
  if (danger) {
    const dx = cx - danger.x;
    const dy = cy - danger.y;
    const dist = Math.sqrt(danger.dSq) || 1;
    // Move away from the danger
    moveX = (dx / dist) * 1.5;
    moveY = (dy / dist) * 1.2;
    const roomLeft = cx;
    const roomRight = config.playfieldWidth - cx;
    // A Gleve with a ready sweep (running or enough energy) parries dangers in the arc instead of flying out of it sideways
    const parried =
      Gleve.isGleve(p2) && (Gleve.isSweepActive(p2) || sweepReady(p2)) && inSweepArc(p2, danger.x, danger.y);
    // Danger almost exactly above the bot: dodge sideways to the freer side instead of only downwards
    if (!parried && Math.abs(dx) < 20 && dy > 0) moveX = (roomRight >= roomLeft ? 1 : -1) * 1.5;
    // Do not dodge into the wall, but towards the center
    if ((moveX < 0 && roomLeft < EDGE_DISTANCE) || (moveX > 0 && roomRight < EDGE_DISTANCE)) moveX = -moveX;
    if (moveY > 0 && cy > config.playfieldHeight - EDGE_DISTANCE) moveY = 0;
    return { moveX, moveY };
  }

  // Priority 2: collect a powerup
  if (powerup) {
    const dx = powerup.x - cx;
    const dy = powerup.y - cy;
    const dist = Math.sqrt(powerup.dSq) || 1;
    moveX = (dx / dist) * 1.0;
    moveY = (dy / dist) * 1.0;
    return { moveX, moveY };
  }

  // Priority 3: align with the target (horizontally) and shoot from a distance (lower quarter)
  if (target) {
    // Do not chase all the way to the edge (otherwise the hunter boss follows the bot into the corner)
    const targetX = Math.max(EDGE_DISTANCE, Math.min(config.playfieldWidth - EDGE_DISTANCE, target.x));
    const dx = targetX - cx;
    if (Math.abs(dx) > diff.aimCorridor / 2) {
      moveX = dx > 0 ? 0.8 : -0.8;
    }
    // Vertical: stay in the lower quarter (baseline) to shoot enemies/bosses from a safe distance.
    // The Gleve (melee) stays just outside dash range below normal enemies.
    let idealY = target.isBoss ? baselineY : Math.max(baselineY, target.y + 250);
    if (Gleve.isGleve(p2) && !target.isBoss) idealY = Math.min(baselineY, target.y + Gleve.dashRange(p2) * 0.8);
    // Against bosses the Gleve goes within sweep range below the boss bottom edge (keeping distance from the body, collision hurts)
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

  // Priority 4: hold formation with P1 (prefer the lower quarter of the playfield)
  const p1x = state.x + halfSize;
  const p1y = state.y + halfSize;
  const formationTargetX = p1x + 50; // Offset to the right
  const formationTargetY = Math.max(baselineY - 40, Math.min(config.playfieldHeight - 60, p1y));
  const fdx = formationTargetX - cx;
  const fdy = formationTargetY - cy;
  if (Math.abs(fdx) > 15) moveX = fdx > 0 ? 0.4 : -0.4;
  if (Math.abs(fdy) > 15) moveY = fdy > 0 ? 0.4 : -0.4;

  return { moveX, moveY };
}

// --- Sniper: bring the crosshair (base position 220 px above the ship) onto the target, tap/charge, grenade ---

const SNIPER_TOLERANCE = 6;
let sniperMode = null; // null (key up) | 'tap' | 'charge'
let sniperHoldTime = 0;
let sniperTapRest = 0; // remaining steps of the grenade/EMP tap (botFireMissile true)
let sniperTapPause = 0; // Pause after the tap so the release is processed before a new tap starts
let sniperMineStop = false; // The missile key is held to place mines
let sniperMineSteps = 0; // hold time so far for the mines
const sniperBeforeDist = new WeakMap(); // last distance of enemies/asteroids to the ship (to detect an approach)

// Stand below the target so the crosshair lies on it (bosses: just above the bottom edge, their box is big)
function sniperMovement(p2, target, cx, cy, targetX) {
  let moveX = 0;
  let moveY = 0;
  const dx = targetX - cx;
  if (Math.abs(dx) > SNIPER_TOLERANCE) moveX = dx > 0 ? 0.8 : -0.8;
  const crossY = target.isBoss ? target.bottom - 0.3 * target.size : target.y;
  const halfSize = config.playerSize / 2;
  // Ship top edge = center - halfSize; the crosshair lies CROSSHAIR_DISTANCE above it (clamped at 0 at the top)
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
  // Tier 5 clears projectiles in the radius: a projectile that reaches the cross after the flight time (30 steps) and aims at the ship
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

// Enemy projectile (esp. boss missile) closer than 80 px to the ship center: the EMP dissolves it
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

// Enemy or asteroid (not magma) closer than 150 px to the ship center and approaching: place mines
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

// Every step: laser key (tap/charge: holding and releasing need the step rate) and grenade/EMP (short tap)
function updateSniperWeapons(p2) {
  p2.botFireMissile = false;
  const offline = Hack.hasHack(p2, 'weaponsOffline');
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
      // Fully charged (or energy used up except for the shot) or boss gone: release
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

  // Missile key: mines (held while an enemy approaches; at least 10 steps so it is not a tap; max. 5 mines)
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
  // Missile key as a short tap (2 steps), then a pause; EMP against near projectiles has priority over grenade aiming
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

// --- Gleve: dash (missile key) at near enemies, sweep (laser key) against projectiles and opponents in the arc ---

function boxFrom(z) {
  const g = z.size || 20;
  return { x: z.x, y: z.y, w: z.width || g, h: z.height || g };
}

// Would the dash from the ship in direction (dx, dy) graze a boss or (below missile tier 5) magma?
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

// Boss within dash range above the ship: dash direction at its bottom edge (the dash bounces off and deals damage)
function findBossDashTarget(p2) {
  const s = config.playerSize;
  const cx = p2.x + s / 2;
  const cy = p2.y + s / 2;
  const range = Gleve.dashRange(p2);
  for (const boss of arrays.bosses) {
    if (boss.hp <= 0 || boss.phase !== 'fight') continue;
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

// Nearest normal enemy within dash range with a free path; returns the dash direction or null
function findDashTarget(p2) {
  const halfSize = config.playerSize / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  const range = Gleve.dashRange(p2);
  let best = null;
  let bestEnemyDSq = Infinity;
  // Enemy ships first, asteroids only without an enemy
  const candidates =
    arrays.enemies.length > 0
      ? arrays.enemies
      : arrays.asteroids.filter(a => !a.carriesPowerup && canAsteroidDestroy(p2, a));
  for (const f of candidates) {
    const b = boxFrom(f);
    const fx = b.x + b.w / 2;
    const fy = b.y + b.h / 2;
    const dSq = distanceSq(cx, cy, fx, fy);
    // The target must be fully reachable (center within range)
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

// Does the point lie in the sweep arc of the current tier (half angle left and right of vertical) up to the sweep length?
function inSweepArc(p2, px, py) {
  const ox = p2.x + config.playerSize / 2;
  const oy = p2.y + 5;
  const dx = px - ox;
  const dy = py - oy;
  const dist = Math.hypot(dx, dy);
  if (dist > Gleve.sweepLength(p2) || dy > 0) return false;
  return Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI) <= Gleve.sweepArc(p2) / 2;
}

// Is there enough energy for the next sweep (superweapon: always)?
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
    // Center or bottom edge (big targets like bosses)
    if (inSweepArc(p2, b.x + b.w / 2, b.y + b.h / 2) || inSweepArc(p2, b.x + b.w / 2, b.y + b.h)) return true;
  }
  return false;
}

function updateGleveWeapons(p2) {
  // Dash (missile key): one step of pressing (edge), only without cooldown, without a weapon hack and not constantly
  p2.botFireMissile = false;
  if (
    gleveDashLock <= 0 &&
    (p2.gleveDashCharges || 0) >= 1 &&
    !Gleve.isDashActive(p2) &&
    !Hack.hasHack(p2, 'weaponsOffline')
  ) {
    let aimTarget = findDashTarget(p2);
    // Bosses: only with at least 2 charges (one stays in reserve)
    if (!aimTarget && arrays.enemies.length === 0 && (p2.gleveDashCharges || 0) >= 2)
      aimTarget = findBossDashTarget(p2);
    if (aimTarget) {
      p2.botDashDirection = aimTarget;
      p2.botFireMissile = true;
      gleveDashLock = GLEVE_DASH_PAUSE;
    }
  }

  // Hold the sweep (laser key) while enemy projectiles or opponents are in the arc (save energy otherwise)
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

  // Bombs: very selective, only with >= 3 visible enemies + cooldown fully expired
  p2.botFireBomb = false;
  if (p2.bombCooldown <= 0) {
    const visibleEnemies = arrays.enemies.length + arrays.bosses.filter(b => b.hp > 0).length;
    if (visibleEnemies >= 3) {
      p2.botFireBomb = true;
    }
  }
}

function updateStandardWeapons(p2, diff, target, cx) {
  // Laser: fire when the target is in the aim corridor
  p2.botFireLaser = false;
  if (target && Math.abs(target.x - cx) <= diff.aimCorridor) {
    p2.botFireLaser = true;
  }

  // Missiles: fire when the target is in the field of fire (bosses always when roughly aligned, enemies up to 350px)
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

// --- Viper: evasive roll when a danger is very close and normal dodging would come too late ---
const ROLL_DANGER_NEAR = 40;

// How free is the side for a roll: room to the edge (at most the roll distance), deduction per obstacle in the roll path
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
  // Only if the danger is almost on the ship and comes from above (not already past)
  if (danger.dSq >= ROLL_DANGER_NEAR * ROLL_DANGER_NEAR) return;
  if (Math.abs(danger.x - cx) > config.playerSize * 0.75 || danger.y > cy + 10) return;
  const left = sidesFreedom(p2, -1, cx, cy);
  const right = sidesFreedom(p2, 1, cx, cy);
  if (left === right) p2.botRollRequest = danger.x > cx ? -1 : 1;
  else p2.botRollRequest = left > right ? -1 : 1;
}

// Rock: keep distance from walls and islands. Also checked a bit above the ship because the rock
// scrolls down. Returns an extra sideways movement (-1..1) towards the middle of the free range.
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
  // The Gleve dash is an edge: the press only lasts until the next step
  if (Gleve.isGleve(p2)) p2.botFireMissile = false;

  // Reaction time: update the decision only every N frames
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

  // Apply smooth movement
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

// Reset on restart
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
