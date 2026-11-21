// Spectre-SR (model id `sniper`): crosshair laser with charging and a stun grenade (see AGENTS.md, section Sniper).
// State S4: crosshair (base position, auto aim from laser tier 4), instant shot on the hit circle, charging
// (press starts charging, release fires) and the stun grenade on the missile key.
// pState is `state` (P1) or `state.p2`, pKey 'p1' / 'p2'.
// State per player: sniperTargetX/sniperTargetY (crosshair center on the playfield, null = not set yet),
// sniperCooldown (steps until the next shot), sniperHeld (laser key in the previous step = charging in progress),
// sniperCharge (charge steps 0-90), sniperFull (full tone already played for this charge).

import { state, config, arrays, shipColors } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Hack from './hack.js';
import * as Network from './network.js';
import { damageTarget, showChargeHud } from './gleve.js';
import * as Display from './display.js';
import { createEffect, removeEffects as removeAllEffects } from './effects.js';

export const CROSSHAIR_DISTANCE = 220; // px above the ship top edge
export const SHOT_ENERGY = 6;
const AUTO_AIM_RANGE = 320;
const BEAM_STEPS = 8;
export const CHARGE_FROM = 10; // Hold time in steps from which a normal shot becomes a charged shot
export const CHARGE_FULL = 90; // Steps until the full charge (1.5 s)
export const CHARGING_ENERGY = 19; // extra energy for charging from step 10 to 90 (evenly)
const CHARGING_COST = CHARGING_ENERGY / (CHARGE_FULL - CHARGE_FROM);
export const MAX_DAMAGE_FACTOR = 4;
export const MAX_RADIUS_FACTOR = 1.5;

// Values per laser tier 1-5
const RADIUS = [6, 14, 22, 22, 30];
const DAMAGE = [30, 35, 40, 45, 50];
const SHOT_DISTANCE = [24, 21, 21, 18, 18];
const AUTO_AIM_SPEED = [0, 0, 0, 6, 10]; // px per step, 0 = no auto aim

// Grenade, values per missile tier 1-5
export const GRENADE_FLIGHT = 30; // Steps until the explosion
const GRENADE_ARC = 70; // px arc height in the middle of the flight
const PUSH_STEPS = 10; // The push glides over this many steps
const WAVE_STEPS = 14; // Wachstum des Druckwellen-Rings
const GRENADE_RADIUS = [70, 80, 90, 100, 110];
const GRENADE_PUSH = [60, 70, 80, 90, 100];
const GRENADE_STUN = [60, 72, 90, 90, 120];
const GRENADE_DAMAGE = [0, 15, 25, 35, 45];
const GRENADE_COOLDOWN = [240, 210, 180, 180, 150];

// Grenade key: tap (< HOLD_FROM steps) = grenade + EMP, hold (from HOLD_FROM) = sticky mines
export const HOLD_FROM = 10;
// EMP (on tap): the ring grows in EMP_STEPS to the radius of the missile tier, destroys enemy projectiles and stuns enemies
export const EMP_STEPS = 10;
export const EMP_STUN = 30;
const EMP_RADIUS = [70, 80, 90, 100, 110];

// Sticky mines (on hold): one mine every MINE_INTERVAL steps from HOLD_FROM on, max. MINE_MAX_PER_HOLD per hold,
// max. MINE_MAX_ACTIVE per player (oldest gone). Lifetime MINE_LIVES (the last MINE_BLINK blinking); sticks to the target
// and explodes after MINE_IGNITION steps with radius MINE_RADIUS.
export const MINE_INTERVAL = 12;
export const MINE_MAX_PER_HOLD = 5;
export const MINE_MAX_ACTIVE = 8;
export const MINE_LIVES = 360;
export const MINE_BLINK = 60;
export const MINE_IGNITION = 30;
export const MINE_RADIUS = 30;
// Free mines drift slowly upwards towards the opponents (px per step)
export const MINE_DRIFT = 0.6;
export const MINE_SIZE = 12;
const MINE_DAMAGE = [20, 25, 30, 35, 40];

function tierIndex(pState) {
  return Math.max(1, Math.min(5, pState.laserTier || 1)) - 1;
}

function missileIndex(pState) {
  return Math.max(1, Math.min(5, pState.missileTier || 1)) - 1;
}

export function isSniper(pState) {
  return !!pState && pState.selectedShipModel === 'sniper';
}

export function hitRadius(pState) {
  return RADIUS[tierIndex(pState)];
}
export function shotDamage(pState) {
  return DAMAGE[tierIndex(pState)];
}
export function shotDistance(pState) {
  return SHOT_DISTANCE[tierIndex(pState)];
}
export function autoTargetSpeed(pState) {
  return AUTO_AIM_SPEED[tierIndex(pState)];
}
export function grenadeCooldown(pState) {
  return GRENADE_COOLDOWN[missileIndex(pState)];
}
// Grenade charges: missile tier 1-3 -> 2, 4-5 -> 3. missileCooldown is the charge time of the next charge.
export function grenadeMax(pState) {
  return (pState.missileTier || 1) >= 4 ? 3 : 2;
}

// Charges full, no recharge running (game start, restart, ship change)
export function setGrenadeChargeFull(pState) {
  if (!pState) return;
  pState.sniperGrenadeCharges = grenadeMax(pState);
  pState.missileCooldown = 0;
}

export function grenadeCharges(pState) {
  return pState.sniperGrenadeCharges === undefined ? grenadeMax(pState) : pState.sniperGrenadeCharges;
}

// Uses up one charge; a recharge starts only if none is running yet
function consumeGrenade(pState) {
  pState.sniperGrenadeCharges = Math.max(0, grenadeCharges(pState) - 1);
  if ((pState.missileCooldown || 0) <= 0) pState.missileCooldown = grenadeCooldown(pState);
}

// Per step (weapons.js): recharge one after another (runs to 0 -> +1 charge, keep charging if needed) and HUD
export function updateGrenadeCharges(pKey, pState) {
  const max = grenadeMax(pState);
  if (pState.sniperGrenadeCharges === undefined) pState.sniperGrenadeCharges = max;
  if (pState.sniperGrenadeCharges > max) pState.sniperGrenadeCharges = max;
  if (pState.missileCooldown > 0) {
    pState.missileCooldown--;
    if (pState.missileCooldown <= 0) {
      pState.sniperGrenadeCharges = Math.min(max, pState.sniperGrenadeCharges + 1);
      pState.missileCooldown = pState.sniperGrenadeCharges < max ? grenadeCooldown(pState) : 0;
    }
  } else if (pState.sniperGrenadeCharges < max) {
    // e.g. after an upgrade to tier 4: start recharging
    pState.missileCooldown = grenadeCooldown(pState);
  }
  showGrenadeHud(pKey, pState);
}

export function showGrenadeHud(pKey, pState) {
  if (!pState || !isSniper(pState)) return;
  showChargeHud(pKey, pState, grenadeCharges(pState), grenadeMax(pState), grenadeCooldown(pState));
}
export function grenadeRadius(pState) {
  return GRENADE_RADIUS[missileIndex(pState)];
}
export function grenadePush(pState) {
  return GRENADE_PUSH[missileIndex(pState)];
}
export function grenadeStun(pState) {
  return GRENADE_STUN[missileIndex(pState)];
}
export function grenadeDamage(pState) {
  return GRENADE_DAMAGE[missileIndex(pState)];
}
export function empRadius(pState) {
  return EMP_RADIUS[missileIndex(pState)];
}
export function mineDamage(pState) {
  return MINE_DAMAGE[missileIndex(pState)];
}

// Charge share 0-1 (under 10 steps of hold time = normal shot, so 0)
export function chargeShare(charge) {
  return charge < CHARGE_FROM ? 0 : Math.min(1, charge / CHARGE_FULL);
}
export function damageFactor(charge) {
  return 1 + (MAX_DAMAGE_FACTOR - 1) * chargeShare(charge);
}
export function radiusFactor(charge) {
  return 1 + (MAX_RADIUS_FACTOR - 1) * chargeShare(charge);
}
export function isFull(charge) {
  return charge >= CHARGE_FULL;
}
// Is the player charging right now (key held)? Then there is no energy regeneration.
export function isCharging(pState) {
  return !!pState && isSniper(pState) && !!pState.sniperHeld;
}

function shipColor(pState) {
  const c = shipColors[pState.selectedShipColor];
  return c ? c.prim : '#ffffff';
}

// Ship center top (beam origin)
function shipNose(pState) {
  return { x: pState.x + 15, y: pState.y };
}

// Base position of the crosshair: above the ship, clamped at the top field edge
export function basePosition(pState) {
  const n = shipNose(pState);
  return { x: n.x, y: Math.max(0, n.y - CROSSHAIR_DISTANCE) };
}

// --- TARGETS ---

function targetBox(z) {
  const g = z.size || 20;
  const w = z.width || g;
  const h = z.height || g;
  const pad = z.isBoss ? g * 0.15 : 0;
  return { x1: z.x + pad, y1: z.y + pad, x2: z.x + w - pad, y2: z.y + h - pad };
}

function targetMiddle(z) {
  const b = targetBox(z);
  return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
}

// Does the box intersect the circle? (nearest point of the box to the circle center)
function boxIntersectsCircle(b, cx, cy, r) {
  const nx = Math.max(b.x1, Math.min(cx, b.x2));
  const ny = Math.max(b.y1, Math.min(cy, b.y2));
  return Math.hypot(nx - cx, ny - cy) <= r;
}

function allTargets() {
  return [
    ...arrays.enemies,
    ...arrays.asteroids,
    ...arrays.bosses,
    ...arrays.bossMissileArray,
    ...arrays.bossBombArray,
  ];
}

// Targets in the hit circle (magma stays intact and does not count)
export function targetInCircle(cx, cy, r) {
  return allTargets().filter(
    z =>
      !z.isIndestructible &&
      (z.hp === undefined || z.hp > 0) &&
      (z.immune || 0) <= 0 &&
      boxIntersectsCircle(targetBox(z), cx, cy, r),
  );
}

// --- AUTO-ZIELEN ---

// Nearest opponent (enemy/boss, not an asteroid) above the ship within range
function autoTarget(pState) {
  const n = shipNose(pState);
  let best = null;
  let bestDist = Infinity;
  for (const z of [...arrays.enemies, ...arrays.bosses]) {
    if (z.isIndestructible || (z.hp !== undefined && z.hp <= 0)) continue;
    const m = targetMiddle(z);
    if (m.y >= n.y) continue;
    const dist = Math.hypot(m.x - n.x, m.y - n.y);
    if (dist <= AUTO_AIM_RANGE && dist < bestDist) {
      bestDist = dist;
      best = m;
    }
  }
  return best;
}

function glideTo(pState, zx, zy, speed) {
  const dx = zx - pState.sniperTargetX;
  const dy = zy - pState.sniperTargetY;
  const dist = Math.hypot(dx, dy);
  if (dist <= speed) {
    pState.sniperTargetX = zx;
    pState.sniperTargetY = zy;
  } else {
    pState.sniperTargetX += (dx / dist) * speed;
    pState.sniperTargetY += (dy / dist) * speed;
  }
}

function updateCrosshair(pState) {
  const reason = basePosition(pState);
  const speed = autoTargetSpeed(pState);
  if (pState.sniperTargetX == null || speed === 0) {
    // No auto aim: the crosshair sticks to the base position (also when switching to a lower tier)
    pState.sniperTargetX = reason.x;
    pState.sniperTargetY = reason.y;
    return;
  }
  const target = autoTarget(pState);
  const shouldX = target ? target.x : reason.x;
  const shouldY = target ? target.y : reason.y;
  glideTo(pState, shouldX, shouldY, speed);
  pState.sniperTargetX = Math.max(0, Math.min(config.playfieldWidth, pState.sniperTargetX));
  pState.sniperTargetY = Math.max(0, Math.min(config.playfieldHeight, pState.sniperTargetY));
}

// --- DARSTELLUNG ---
// The display backend draws the crosshair with its charge ring from the player state (drawCrosshair in display-dom.js).

function createBeam(pState, share = 0) {
  const n = shipNose(pState);
  const dx = pState.sniperTargetX - n.x;
  const dy = pState.sniperTargetY - n.y;
  createEffect({
    kind: 'sniperBeam',
    x: n.x,
    y: n.y,
    length: Math.hypot(dx, dy),
    angle: (Math.atan2(dx, -dy) * 180) / Math.PI,
    width: 3 + 9 * share,
    glow: share,
    color: shipColor(pState),
    pKey: pState === state ? 'p1' : 'p2',
    rest: BEAM_STEPS,
  });
}

function createImpact(pState, cx, cy, share = 0) {
  Utils.createExplosion(cx, cy, '#ffffff', 6 + Math.round(8 * share));
  Utils.createExplosion(cx, cy, shipColor(pState), 4 + Math.round(6 * share));
}

// --- SHOT ---

// Hits targets in the circle around the crosshair: tier 1-2 only the nearest (center nearest to the crosshair), from tier 3 all.
// `charge` (steps, 0 = normal shot) scales damage (x1 to x4) and radius (x1 to x1.5); the fully charged shot
// hits all targets in the circle regardless of the tier and ignores shields (shield gone, damage to the HP).
// Returns the number of targets hit.
export function fireShot(pState, pKey, charge = 0) {
  const cx = pState.sniperTargetX;
  const cy = pState.sniperTargetY;
  const full = isFull(charge);
  const share = chargeShare(charge);
  let targets = targetInCircle(cx, cy, hitRadius(pState) * radiusFactor(charge));
  if (!full && (pState.laserTier || 1) < 3 && targets.length > 1) {
    let best = targets[0];
    let bestDist = Infinity;
    for (const z of targets) {
      const m = targetMiddle(z);
      const d = Math.hypot(m.x - cx, m.y - cy);
      if (d < bestDist) {
        bestDist = d;
        best = z;
      }
    }
    targets = [best];
  }
  const damage = shotDamage(pState) * damageFactor(charge);
  for (const z of targets) {
    const m = targetMiddle(z);
    createImpact(pState, m.x, m.y, share);
    if (full && (z.shieldHp || 0) > 0) {
      z.shieldHp = 0;
    }
    damageTarget(z, damage, pKey);
  }
  if (!targets.length) createImpact(pState, cx, cy, share);
  createBeam(pState, share);
  Audio.playSniperShot(pState.laserTier || 1, share);
  return targets.length;
}

function resetCharge(pState) {
  pState.sniperCharge = 0;
  pState.sniperFull = false;
}

// One charge step (key held): the first 10 steps cost nothing, after that 19/80 energy per step.
// If the energy is not enough (the shot with 6 energy must always remain possible), the charge stops.
function charging(pState) {
  if ((pState.sniperCharge || 0) >= CHARGE_FULL) return;
  if (pState.sniperCharge >= CHARGE_FROM && !pState.unlimitedEnergy) {
    if (pState.energy - CHARGING_COST < SHOT_ENERGY) return;
    pState.energy -= CHARGING_COST;
  }
  pState.sniperCharge++;
  if (isFull(pState.sniperCharge) && !pState.sniperFull) {
    pState.sniperFull = true;
    Audio.playSniperFull();
  }
}

// Shot with the shot interval lock and an energy check; false = no shot (the charge expires)
function attempts(pState, pKey, charge) {
  if ((pState.sniperCooldown || 0) > 0) return false;
  if (!pState.unlimitedEnergy && pState.energy < SHOT_ENERGY) return false;
  if (!pState.unlimitedEnergy) pState.energy -= SHOT_ENERGY;
  pState.sniperCooldown = shotDistance(pState);
  fireShot(pState, pKey, charge);
  return true;
}

// --- GRENADE ---

// Grenades in flight: arrays.sniperGrenades, { id, pKey, x, y (center), startX, startY, targetX, targetY, rest, rot, values }
// (client: only id, pKey, x, y, rest, rot from the snapshot)
let grenadeId = 0;
const pushes = []; // { z, vx, vy, rest, pKey } laufendes Wegstossen

// Throw to the crosshair (position at the throw), flight in GRENADE_FLIGHT steps in an arc; the tier values apply from the throw.
export function throwGrenade(pState, pKey) {
  const n = shipNose(pState);
  const reason = basePosition(pState);
  const zx = pState.sniperTargetX != null ? pState.sniperTargetX : reason.x;
  const zy = pState.sniperTargetY != null ? pState.sniperTargetY : reason.y;
  arrays.sniperGrenades.push(
    Display.create(
      {
        id: 'sg_' + ++grenadeId,
        pKey,
        x: n.x,
        y: n.y,
        startX: n.x,
        startY: n.y,
        targetX: zx,
        targetY: zy,
        rest: GRENADE_FLIGHT,
        rot: 0,
        values: {
          radius: grenadeRadius(pState),
          push: grenadePush(pState),
          stun: grenadeStun(pState),
          damage: grenadeDamage(pState),
          deletes: (pState.missileTier || 1) >= 5,
        },
      },
      'sniperGrenade',
    ),
  );
}

function updateGrenades(pKey) {
  for (let i = arrays.sniperGrenades.length - 1; i >= 0; i--) {
    const g = arrays.sniperGrenades[i];
    if (g.pKey !== pKey) continue;
    g.rest--;
    if (g.rest <= 0) {
      Display.remove(g);
      arrays.sniperGrenades.splice(i, 1);
      explodeGrenade(g);
      continue;
    }
    const t = 1 - g.rest / GRENADE_FLIGHT;
    const x = g.startX + (g.targetX - g.startX) * t;
    const y = g.startY + (g.targetY - g.startY) * t - Math.sin(Math.PI * t) * GRENADE_ARC;
    g.rot += 24;
    g.x = x;
    g.y = y;
  }
}

function createBlastWave(cx, cy, radius, pKey, kind = 'sniperBlastWave') {
  createEffect({ kind, x: cx, y: cy, radius, pKey, rest: WAVE_STEPS });
}

function pushAwayTargets() {
  return [...arrays.enemies, ...arrays.asteroids, ...arrays.bosses];
}

function deleteProjectiles(array, cx, cy, r) {
  for (let i = array.length - 1; i >= 0; i--) {
    const p = array[i];
    const b = { x1: p.x, y1: p.y, x2: p.x + (p.width || p.size || 4), y2: p.y + (p.height || p.size || 4) };
    if (boxIntersectsCircle(b, cx, cy, r)) {
      Utils.createExplosion((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, '#ffffff', 3);
      Display.remove(p);
      array.splice(i, 1);
    }
  }
}

function explodeGrenade(g) {
  const cx = g.targetX;
  const cy = g.targetY;
  const w = g.values;
  Audio.playGrenade();
  Utils.createExplosion(cx, cy, '#ffffff', 10);
  Utils.createExplosion(cx, cy, '#ffeb3b', 10);
  createBlastWave(cx, cy, w.radius, g.pKey);
  // Online host: the client shows the blast wave via an event (the grenade disappears in the snapshot)
  if (state.gameMode === 'online' && state.network && state.network.isHost) {
    Network.sendNetworkEvent({
      type: 'grenade_detonated',
      x: Math.round(cx * 10) / 10,
      y: Math.round(cy * 10) / 10,
      radius: w.radius,
      owner: g.pKey,
    });
  }

  for (const z of pushAwayTargets().filter(
    t => (t.hp === undefined || t.hp > 0) && boxIntersectsCircle(targetBox(t), cx, cy, w.radius),
  )) {
    const m = targetMiddle(z);
    let dx = m.x - cx;
    let dy = m.y - cy;
    let dist = Math.hypot(dx, dy);
    if (dist < 0.001) {
      dx = 0;
      dy = -1;
      dist = 1;
    }
    if (w.damage > 0 && !z.isIndestructible) damageTarget(z, w.damage, g.pKey);
    // Destroyed by the damage: nothing left to do
    if (!pushAwayTargets().includes(z)) continue;
    if (!z.isBoss) {
      pushes.push({
        z,
        vx: ((dx / dist) * w.push) / PUSH_STEPS,
        vy: ((dy / dist) * w.push) / PUSH_STEPS,
        rest: PUSH_STEPS,
        pKey: g.pKey,
      });
    }
    if (z.isEnemy || z.isBoss) {
      const duration = z.isBoss ? Math.round(w.stun / 2) : w.stun;
      z.stunned = Math.max(z.stunned || 0, duration);
    }
  }

  if (w.deletes) {
    deleteProjectiles(arrays.enemyLaserArray, cx, cy, w.radius);
    deleteProjectiles(arrays.bossLaserArray, cx, cy, w.radius);
    deleteProjectiles(arrays.hackProjectileArray, cx, cy, w.radius);
  }
}

// --- GRENADE KEY (tap / hold) and EMP ---

// Center of the ship (EMP origin)
function shipMiddle(pState) {
  return { x: pState.x + config.playerSize / 2, y: pState.y + config.playerSize / 2 };
}

function createEmpRing(cx, cy, radius, pKey) {
  createEffect({ kind: 'sniperEmp', x: cx, y: cy, radius, pKey, rest: EMP_STEPS });
}

// Remove enemy projectiles in the radius (with a small spark); bombs without detonation
function destroyProjectiles(array, cx, cy, r) {
  for (let i = array.length - 1; i >= 0; i--) {
    const p = array[i];
    const b = { x1: p.x, y1: p.y, x2: p.x + (p.width || p.size || 4), y2: p.y + (p.height || p.size || 4) };
    if (boxIntersectsCircle(b, cx, cy, r)) {
      Utils.createExplosion((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, '#4fc3f7', 4);
      Display.remove(p);
      array.splice(i, 1);
    }
  }
}

// EMP around the own ship: destroy projectiles, stun enemies (no bosses, no asteroids) for 30 steps, no damage.
export function triggerEmp(pState, pKey) {
  const m = shipMiddle(pState);
  const r = empRadius(pState);
  Audio.playEmp();
  createEmpRing(m.x, m.y, r, pKey);
  for (const list of [
    arrays.enemyLaserArray,
    arrays.bossLaserArray,
    arrays.hackProjectileArray,
    arrays.bossMissileArray,
    arrays.bossBombArray,
  ]) {
    destroyProjectiles(list, m.x, m.y, r);
  }
  for (const f of arrays.enemies) {
    if (f.hp !== undefined && f.hp <= 0) continue;
    if (!boxIntersectsCircle(targetBox(f), m.x, m.y, r)) continue;
    f.stunned = Math.max(f.stunned || 0, EMP_STUN);
  }
  if (state.gameMode === 'online' && state.network && state.network.isHost) {
    Network.sendNetworkEvent({
      type: 'emp_triggered',
      x: Math.round(m.x * 10) / 10,
      y: Math.round(m.y * 10) / 10,
      radius: r,
      owner: pKey,
    });
  }
}

// --- HAFTMINEN ---

function overlap(a, b) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}

function mineBox(m) {
  const h = MINE_SIZE / 2;
  return { x1: m.x - h, y1: m.y - h, x2: m.x + h, y2: m.y + h };
}

// Targets for contact and explosion: enemies, asteroids (except magma) and bosses
function mineTargets() {
  return [...arrays.enemies, ...arrays.asteroids, ...arrays.bosses].filter(
    z => !z.isIndestructible && (z.hp === undefined || z.hp > 0),
  );
}

let mineId = 0;

// Derive the display fields sticks/blinks from the state (host); the client takes them from the snapshot
function setMineDisplay(m) {
  m.sticks = !!m.target;
  m.blinks = !m.target && m.rest <= MINE_BLINK;
}

function removeMine(m) {
  Display.remove(m);
  const i = arrays.sniperMines.indexOf(m);
  if (i >= 0) arrays.sniperMines.splice(i, 1);
}

// Place a mine below the ship center; above the limit per player the oldest drops out
function putMine(pState, pKey) {
  const own = arrays.sniperMines.filter(m => m.pKey === pKey);
  while (own.length >= MINE_MAX_ACTIVE) removeMine(own.shift());
  const m = {
    id: 'sm_' + ++mineId,
    pKey,
    x: pState.x + config.playerSize / 2,
    y: pState.y + config.playerSize,
    rest: MINE_LIVES,
    target: null,
    offX: 0,
    offY: 0,
    fuse: -1,
    damage: mineDamage(pState),
    sticks: false,
    blinks: false,
  };
  arrays.sniperMines.push(Display.create(m, 'sniperMine'));
  Audio.playMinePut();
}

function createMineExplosion(cx, cy, pKey) {
  Audio.playMineExplosion();
  Utils.createExplosion(cx, cy, '#ffffff', 6);
  Utils.createExplosion(cx, cy, '#ff9800', 8);
  createBlastWave(cx, cy, MINE_RADIUS, pKey, 'sniperMineExplosion');
}

// Explosion at the current position: every target in the radius exactly once (shield first)
function explodeMine(m) {
  removeMine(m);
  createMineExplosion(m.x, m.y, m.pKey);
  if (state.gameMode === 'online' && state.network && state.network.isHost) {
    Network.sendNetworkEvent({
      type: 'mine_exploded',
      x: Math.round(m.x * 10) / 10,
      y: Math.round(m.y * 10) / 10,
      radius: MINE_RADIUS,
      owner: m.pKey,
    });
  }
  for (const z of mineTargets().filter(t => boxIntersectsCircle(targetBox(t), m.x, m.y, MINE_RADIUS))) {
    damageTarget(z, m.damage, m.pKey);
  }
  // Boss missiles and bombs in the radius are destroyed (as with the EMP)
  destroyProjectiles(arrays.bossMissileArray, m.x, m.y, MINE_RADIUS);
  destroyProjectiles(arrays.bossBombArray, m.x, m.y, MINE_RADIUS);
}

// Does a boss missile or bomb touch the mine?
function bossProjectileOnMine(m) {
  const box = mineBox(m);
  return [...arrays.bossMissileArray, ...arrays.bossBombArray].some(g => overlap(box, targetBox(g)));
}

function targetAlive(z) {
  return (
    (arrays.enemies.includes(z) || arrays.asteroids.includes(z) || arrays.bosses.includes(z)) &&
    (z.hp === undefined || z.hp > 0)
  );
}

function updateMines(pKey) {
  for (let i = arrays.sniperMines.length - 1; i >= 0; i--) {
    const m = arrays.sniperMines[i];
    if (!m || m.pKey !== pKey) continue;
    if (m.target) {
      if (!targetAlive(m.target)) {
        explodeMine(m);
        continue;
      } // Target died before: explosion at the last position
      const c = targetMiddle(m.target);
      m.x = c.x + m.offX;
      m.y = c.y + m.offY;
      m.fuse--;
      if (m.fuse <= 0) {
        explodeMine(m);
        continue;
      }
      if (m.fuse % 10 === 0) Audio.playMineBeep();
    } else {
      m.rest--;
      m.y -= MINE_DRIFT;
      if (m.rest <= 0 || m.y < -MINE_SIZE) {
        removeMine(m);
        continue;
      }
      // Boss missiles and bombs trigger the mine immediately (no sticking to projectiles)
      if (bossProjectileOnMine(m)) {
        explodeMine(m);
        continue;
      }
      const box = mineBox(m);
      const z = mineTargets().find(t => overlap(box, targetBox(t)));
      if (z) {
        const c = targetMiddle(z);
        m.target = z;
        m.offX = m.x - c.x;
        m.offY = m.y - c.y;
        m.fuse = MINE_IGNITION;
        Audio.playMineBeep();
      }
    }
    setMineDisplay(m);
  }
}

// Holding the grenade key (from updateGrenadeKey, from HOLD_FROM on): one mine every MINE_INTERVAL steps, with a free cooldown.
// `steps` = hold time so far.
export function holdStep(pState, pKey, steps) {
  if (Hack.hasHack(pState, 'weaponsOffline')) return;
  if ((pState.grenadeMines || 0) >= MINE_MAX_PER_HOLD) return;
  if ((steps - HOLD_FROM) % MINE_INTERVAL !== 0) return;
  // The first mine of a hold costs a charge (no mines without a charge), further ones nothing
  if ((pState.grenadeMines || 0) === 0) {
    if (grenadeCharges(pState) < 1) return;
    consumeGrenade(pState);
  }
  putMine(pState, pKey);
  pState.grenadeMines = (pState.grenadeMines || 0) + 1;
}

// Tap: grenade into the crosshair and EMP, then the cooldown starts
function tapGrenade(pState, pKey) {
  consumeGrenade(pState);
  throwGrenade(pState, pKey);
  triggerEmp(pState, pKey);
}

// Per step from weapons.js (instead of the missiles): `held` is the missile key. A press starts the count, the release
// decides: under HOLD_FROM steps (and a free cooldown) = tap; after holding the cooldown starts if mines were placed.
export function updateGrenadeKey(pState, pKey, held) {
  if (!isSniper(pState)) return;
  const lock = Hack.hasHack(pState, 'weaponsOffline') || pState.isDead || !state.gameRunning;
  if (held && !lock) {
    if (!pState.grenadeHeld) {
      pState.grenadeSteps = 0;
      pState.grenadeMines = 0;
    }
    pState.grenadeHeld = true;
    pState.grenadeSteps = (pState.grenadeSteps || 0) + 1;
    if (pState.grenadeSteps >= HOLD_FROM) holdStep(pState, pKey, pState.grenadeSteps);
  } else if (pState.grenadeHeld) {
    const steps = pState.grenadeSteps || 0;
    pState.grenadeHeld = false;
    pState.grenadeSteps = 0;
    pState.grenadeMines = 0;
    if (!lock && steps < HOLD_FROM && grenadeCharges(pState) >= 1) tapGrenade(pState, pKey);
  }
}

// Push: a bit per step, clamped to the field (sides and top; at the bottom a target may leave the field)
function updatePushes(pKey) {
  for (let i = pushes.length - 1; i >= 0; i--) {
    const s = pushes[i];
    if (s.pKey !== pKey) continue;
    const z = s.z;
    s.rest--;
    if (s.rest < 0 || !pushAwayTargets().includes(z)) {
      pushes.splice(i, 1);
      continue;
    }
    const g = z.size || 30;
    const nx = Math.max(0, Math.min(config.playfieldWidth - g, z.x + s.vx));
    let ny = z.y + s.vy;
    if (ny < 0 && z.y >= 0) ny = 0;
    const ddx = nx - z.x;
    const ddy = ny - z.y;
    z.x = nx;
    z.y = ny;
    if (z.basisX !== undefined) z.basisX += ddx;
    if (z.fixedX !== undefined) z.fixedX += ddx;
    if (z.fixedY !== undefined) z.fixedY += ddy;
    if (s.rest === 0) pushes.splice(i, 1);
  }
}

function removeGrenadeEffects(pKey) {
  removeAllEffects(pKey);
  for (let i = arrays.sniperMines.length - 1; i >= 0; i--) {
    if (!pKey || arrays.sniperMines[i].pKey === pKey) removeMine(arrays.sniperMines[i]);
  }
  for (let i = arrays.sniperGrenades.length - 1; i >= 0; i--) {
    if (pKey && arrays.sniperGrenades[i].pKey !== pKey) continue;
    Display.remove(arrays.sniperGrenades[i]);
    arrays.sniperGrenades.splice(i, 1);
  }
  for (let i = pushes.length - 1; i >= 0; i--) {
    if (pKey && pushes[i].pKey !== pKey) continue;
    pushes.splice(i, 1);
  }
}

// Per step from player.js (energy phase, after the movement): maintain the crosshair and trigger the shot.
// `held` is the laser key (bot/online deliver it as well). Choice of the model:
// - normal: a press starts charging, the release fires (hold time under 10 steps = normal shot, otherwise a charged shot).
//   If released during the shot interval lock, the shot (with its charge) fires automatically as soon as the lock expires.
// - `auto` (joystick auto-fire on the phone): continuous fire of normal shots at the shot interval, no charging.
// Returns whether a shot was fired in this step.
export function updateSniper(pState, pKey, held, auto = false) {
  if (!isSniper(pState)) return false;
  updateGrenades(pKey);
  updateMines(pKey);
  updatePushes(pKey);
  if (pState.isDead || !state.gameRunning) {
    pState.sniperHeld = false;
    pState.sniperBuffered = null;
    resetCharge(pState);
    return false;
  }
  updateCrosshair(pState);

  if (pState.sniperCooldown > 0) pState.sniperCooldown--;
  let shot = false;
  const canShoot = !Hack.hasHack(pState, 'weaponsOffline');
  // Shot released during the lock: fires as soon as the lock has expired
  if (pState.sniperBuffered != null && pState.sniperCooldown <= 0) {
    if (canShoot) shot = attempts(pState, pKey, pState.sniperBuffered);
    pState.sniperBuffered = null;
  }
  if (auto) {
    resetCharge(pState);
    pState.sniperHeld = false;
    if (held && canShoot) shot = attempts(pState, pKey, 0);
  } else {
    const holds = !!held && canShoot;
    if (holds) {
      if (!pState.sniperHeld) resetCharge(pState); // Press
      charging(pState);
    } else if (pState.sniperHeld && canShoot) {
      // Release: fire immediately or queue until the end of the lock
      if (pState.sniperCooldown > 0) pState.sniperBuffered = pState.sniperCharge || 0;
      else shot = attempts(pState, pKey, pState.sniperCharge || 0);
      resetCharge(pState);
    } else {
      resetCharge(pState);
    }
    pState.sniperHeld = holds;
  }
  return shot;
}

// --- ONLINE ---

// Host: sniper state of a player for the snapshot (empty for other ships)
export function networkStatus(pState) {
  if (!isSniper(pState)) return {};
  const reason = basePosition(pState);
  return {
    sniperTargetX: pState.sniperTargetX != null ? pState.sniperTargetX : reason.x,
    sniperTargetY: pState.sniperTargetY != null ? pState.sniperTargetY : reason.y,
    sniperCharge: pState.sniperCharge || 0,
    sniperFull: isFull(pState.sniperCharge || 0),
    sniperCooldown: pState.sniperCooldown || 0,
    sniperGrenadeCharges: grenadeCharges(pState),
  };
}

// Host: flying grenades for the snapshot (id, position, owner, remaining flight steps)
export function networkGrenadeList() {
  return arrays.sniperGrenades.map(g => ({ id: g.id, x: g.x, y: g.y, owner: g.pKey, rest: g.rest }));
}

// Host: active mines for the snapshot (id, position, owner, sticks, remaining ignition time, remaining lifetime, blinks)
export function networkMineList() {
  return arrays.sniperMines.map(m => ({
    id: m.id,
    x: m.x,
    y: m.y,
    owner: m.pKey,
    sticks: !!m.target,
    fuse: m.target ? m.fuse : 0,
    rest: m.rest,
    blinks: !m.target && m.rest <= MINE_BLINK,
  }));
}

// Client: apply and render a player's state from the snapshot. The shot is detected by the jump of the
// shot interval (beam with the last known charge), sounds only for the own ship.
export function applySnapshot(pState, payload, pKey, ownOne) {
  if (!pState) return;
  if (!isSniper(pState) || !payload || payload.sniperTargetX === undefined || payload.isDead) {
    // No sniper state in the snapshot: hide the crosshair (the display draws it only with a target set)
    pState.sniperTargetX = null;
    pState.sniperTargetY = null;
    pState.sniperHeld = false;
    pState.sniperCharge = 0;
    pState.sniperCooldown = 0;
    pState.sniperFull = false;
    return;
  }
  const oldCharge = pState.sniperCharge || 0;
  const alterCooldown = pState.sniperCooldown || 0;
  const wasFull = !!pState.sniperFull;
  pState.sniperTargetX = payload.sniperTargetX;
  pState.sniperTargetY = payload.sniperTargetY;
  pState.sniperCharge = payload.sniperCharge || 0;
  pState.sniperFull = !!payload.sniperFull;
  pState.sniperCooldown = payload.sniperCooldown || 0;
  pState.sniperHeld = pState.sniperCharge > 0;
  if (payload.sniperGrenadeCharges !== undefined) {
    pState.sniperGrenadeCharges = payload.sniperGrenadeCharges;
    showGrenadeHud(pKey, pState);
  }
  if (pState.sniperCooldown > alterCooldown) {
    const share = chargeShare(oldCharge);
    createBeam(pState, share);
    createImpact(pState, pState.sniperTargetX, pState.sniperTargetY, share);
    if (ownOne) Audio.playSniperShot(pState.laserTier || 1, share);
  }
  if (ownOne && pState.sniperFull && !wasFull) Audio.playSniperFull();
}

// Client: match the host's grenades (model per id in arrays.sniperGrenades, position and rotation from the snapshot;
// updateGrenades does not run on the client, the list belongs to the snapshot alone)
export function syncGrenades(list) {
  const payload = list || [];
  const ids = new Set(payload.map(d => d.id));
  const gran = arrays.sniperGrenades;
  for (let i = gran.length - 1; i >= 0; i--) {
    if (!ids.has(gran[i].id)) {
      Display.remove(gran[i]);
      gran.splice(i, 1);
    }
  }
  for (const d of payload) {
    let g = gran.find(n => n.id === d.id);
    if (!g) {
      g = Display.create(
        { id: d.id, pKey: d.owner, x: d.x, y: d.y, rest: d.rest || 0, rot: (GRENADE_FLIGHT - (d.rest || 0)) * 24 },
        'sniperGrenade',
      );
      gran.push(g);
    }
    g.x = d.x;
    g.y = d.y;
    g.rest = d.rest || 0;
    g.rot = (GRENADE_FLIGHT - g.rest) * 24;
  }
}

// Client: match the host's mines (model per id in arrays.sniperMines; updateMines does not run there, the
// list belongs to the snapshot alone). The place, stick and beep sounds stay here.
export function syncMines(list) {
  const payload = list || [];
  const ids = new Set(payload.map(d => d.id));
  const mines = arrays.sniperMines;
  for (let i = mines.length - 1; i >= 0; i--) {
    if (!ids.has(mines[i].id)) {
      Display.remove(mines[i]);
      mines.splice(i, 1);
    }
  }
  for (const d of payload) {
    let m = mines.find(n => n.id === d.id);
    if (!m) {
      m = Display.create(
        {
          id: d.id,
          pKey: d.owner === 'p2' ? 'p2' : 'p1',
          x: d.x,
          y: d.y,
          rest: d.rest || 0,
          sticks: !!d.sticks,
          blinks: !d.sticks && !!d.blinks,
        },
        'sniperMine',
      );
      mines.push(m);
      Audio.playMinePut();
    }
    if (d.sticks && !m.sticks) Audio.playMineBeep();
    m.x = d.x;
    m.y = d.y;
    m.rest = d.rest || 0;
    m.sticks = !!d.sticks;
    m.blinks = !m.sticks && !!d.blinks;
  }
}

// Client: mine explosion (event 'mine_exploded')
export function showMineExplosion(payload) {
  if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
  createMineExplosion(payload.x, payload.y, payload.owner === 'p2' ? 'p2' : 'p1');
}

// Client: explosion of a grenade (event 'grenade_detonated')
export function showDetonation(payload) {
  if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y) || !(payload.radius > 0)) return;
  Audio.playGrenade();
  Utils.createExplosion(payload.x, payload.y, '#ffffff', 10);
  Utils.createExplosion(payload.x, payload.y, '#ffeb3b', 10);
  createBlastWave(payload.x, payload.y, payload.radius, payload.owner === 'p2' ? 'p2' : 'p1');
}

// Client: EMP ring (event 'emp_triggered')
export function showEmp(payload) {
  if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y) || !(payload.radius > 0)) return;
  Audio.playEmp();
  createEmpRing(payload.x, payload.y, payload.radius, payload.owner === 'p2' ? 'p2' : 'p1');
}

// Client, every step: the own crosshair follows the predicted ship
// (without auto aim it lies on the base position, with auto aim the host value applies)
export function clientStep() {
  const p = state.p2;
  if (p && isSniper(p) && !p.isDead && p.sniperTargetX != null) {
    if (autoTargetSpeed(p) === 0) {
      const reason = basePosition(p);
      p.sniperTargetX = reason.x;
      p.sniperTargetY = reason.y;
    }
  }
}

// Reset the crosshair, beams and shot state of a player (restartGame, game over, ship change)
export function reset(pState) {
  if (!pState) return false;
  pState.sniperTargetX = null;
  pState.sniperTargetY = null;
  pState.sniperCooldown = 0;
  pState.sniperHeld = false;
  pState.sniperBuffered = null;
  pState.sniperCharge = 0;
  pState.sniperFull = false;
  setGrenadeChargeFull(pState);
  pState.grenadeHeld = false;
  pState.grenadeSteps = 0;
  pState.grenadeMines = 0;
  removeGrenadeEffects(pState === state ? 'p1' : 'p2');
  return true;
}

// Remove all sniper renderings (game over: no simulation runs afterwards that would clear them)
export function removeEffects() {
  for (const s of [state, state.p2]) {
    if (!s) continue;
    s.sniperTargetX = null;
    s.sniperTargetY = null;
  }
  removeGrenadeEffects();
}
