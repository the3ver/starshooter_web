// Spectre-SR (Model-ID `sniper`): Fadenkreuz-Laser mit Aufladen und Betaeubungsgranate (siehe AGENTS.md, Abschnitt Sniper).
// Stand S4: Fadenkreuz (Grundposition, Auto-Zielen ab Laser-Stufe 4), Sofort-Schuss auf den Trefferkreis, Aufladen
// (Druck startet Laden, Loslassen feuert) und Betaeubungsgranate auf der Raketen-Taste.
// pState ist `state` (P1) oder `state.p2`, pKey 'p1' / 'p2'.
// Zustand pro Spieler: sniperZielX/sniperZielY (Fadenkreuz-Mitte im Spielfeld, null = noch nicht gesetzt),
// sniperCooldown (Schritte bis zum naechsten Schuss), sniperGehalten (Laser-Taste im Schritt davor = Ladevorgang laeuft),
// sniperLadung (Ladeschritte 0-90), sniperVoll (Voll-Ton fuer diesen Ladevorgang schon gespielt).

import { state, config, arrays, shipColors } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Hack from './hack.js';
import * as Network from './network.js';
import { damageTarget, showChargeHud } from './gleve.js';
import * as Display from './display.js';
import { createEffect, removeEffects as removeAllEffects } from './effects.js';

export const CROSSHAIR_DISTANCE = 220; // px ueber der Schiffsoberkante
export const SHOT_ENERGY = 6;
const AUTO_AIM_RANGE = 320;
const BEAM_STEPS = 8;
export const CHARGE_FROM = 10; // Haltedauer in Schritten, ab der aus dem Normalschuss ein Ladeschuss wird
export const CHARGE_FULL = 90; // Schritte bis zur vollen Ladung (1,5 s)
export const CHARGING_ENERGY = 19; // zusaetzliche Energie fuer das Laden von Schritt 10 bis 90 (gleichmaessig)
const CHARGING_COST = CHARGING_ENERGY / (CHARGE_FULL - CHARGE_FROM);
export const MAX_DAMAGE_FACTOR = 4;
export const MAX_RADIUS_FACTOR = 1.5;

// Werte pro Laser-Stufe 1-5
const RADIUS = [6, 14, 22, 22, 30];
const DAMAGE = [30, 35, 40, 45, 50];
const SHOT_DISTANCE = [24, 21, 21, 18, 18];
const AUTO_AIM_SPEED = [0, 0, 0, 6, 10]; // px pro Schritt, 0 = kein Auto-Zielen

// Granate, Werte pro Raketen-Stufe 1-5
export const GRENADE_FLIGHT = 30; // Schritte bis zur Explosion
const GRENADE_ARC = 70; // px Bogenhoehe in der Mitte des Flugs
const PUSH_STEPS = 10; // Wegstossen gleitet ueber so viele Schritte
const WAVE_STEPS = 14; // Wachstum des Druckwellen-Rings
const GRENADE_RADIUS = [70, 80, 90, 100, 110];
const GRENADE_PUSH = [60, 70, 80, 90, 100];
const GRENADE_STUN = [60, 72, 90, 90, 120];
const GRENADE_DAMAGE = [0, 15, 25, 35, 45];
const GRENADE_COOLDOWN = [240, 210, 180, 180, 150];

// Granaten-Taste: Tippen (< HALTEN_AB Schritte) = Granate + EMP, Halten (ab HALTEN_AB) = Haftminen
export const HOLD_FROM = 10;
// EMP (beim Tippen): Ring waechst in EMP_SCHRITTE auf den Radius der Raketen-Stufe, zerstoert feindliche Geschosse und betaeubt Feinde
export const EMP_STEPS = 10;
export const EMP_STUN = 30;
const EMP_RADIUS = [70, 80, 90, 100, 110];

// Haftminen (beim Halten): alle MINE_INTERVALL Schritte ab HALTEN_AB eine Mine, max. MINE_MAX_PRO_HALTEN pro Halten,
// max. MINE_MAX_AKTIV pro Spieler (aelteste weg). Lebensdauer MINE_LEBEN (die letzten MINE_BLINK blinkend); haftet am Ziel
// und explodiert nach MINE_ZUENDUNG Schritten mit Radius MINE_RADIUS.
export const MINE_INTERVAL = 12;
export const MINE_MAX_PRO_HOLD = 5;
export const MINE_MAX_ACTIVE = 8;
export const MINE_LIVES = 360;
export const MINE_BLINK = 60;
export const MINE_IGNITION = 30;
export const MINE_RADIUS = 30;
// Freie Minen driften langsam nach oben, den Gegnern entgegen (px pro Schritt)
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
// Granaten-Ladungen: Raketen-Stufe 1-3 -> 2, 4-5 -> 3. raketenCooldown ist die Ladezeit der naechsten Ladung.
export function grenadeMax(pState) {
  return (pState.missileTier || 1) >= 4 ? 3 : 2;
}

// Ladungen voll, kein laufendes Nachladen (Spielstart, Neustart, Schiffswechsel)
export function setGrenadeChargeFull(pState) {
  if (!pState) return;
  pState.sniperGrenadeCharges = grenadeMax(pState);
  pState.missileCooldown = 0;
}

export function grenadeCharges(pState) {
  return pState.sniperGrenadeCharges === undefined ? grenadeMax(pState) : pState.sniperGrenadeCharges;
}

// Verbraucht eine Ladung; ein Nachladen startet nur, wenn noch keins laeuft
function consumeGrenade(pState) {
  pState.sniperGrenadeCharges = Math.max(0, grenadeCharges(pState) - 1);
  if ((pState.missileCooldown || 0) <= 0) pState.missileCooldown = grenadeCooldown(pState);
}

// Pro Schritt (weapons.js): Nachladen nacheinander (laeuft auf 0 -> +1 Ladung, ggf. weiter laden) und HUD
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
    // z. B. nach Upgrade auf Stufe 4: Nachladen starten
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

// Ladeanteil 0-1 (unter 10 Schritten Haltedauer = Normalschuss, also 0)
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
// Laedt der Spieler gerade (Taste gehalten)? Dann gibt es keine Energie-Regeneration.
export function isCharging(pState) {
  return !!pState && isSniper(pState) && !!pState.sniperHeld;
}

function shipColor(pState) {
  const c = shipColors[pState.selectedShipColor];
  return c ? c.prim : '#ffffff';
}

// Schiffsmitte oben (Strahlursprung)
function shipNose(pState) {
  return { x: pState.x + 15, y: pState.y };
}

// Grundposition des Fadenkreuzes: ueber dem Schiff, am oberen Feldrand begrenzt
export function basePosition(pState) {
  const n = shipNose(pState);
  return { x: n.x, y: Math.max(0, n.y - CROSSHAIR_DISTANCE) };
}

// --- ZIELE ---

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

// Schneidet die Box den Kreis? (naechster Punkt der Box zum Kreismittelpunkt)
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

// Ziele im Trefferkreis (Magma bleibt unversehrt und zaehlt nicht mit)
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

// Naechster Gegner (Feind/Boss, kein Asteroid) oberhalb des Schiffs innerhalb der Reichweite
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
    // Kein Auto-Zielen: Fadenkreuz klebt an der Grundposition (auch beim Wechsel auf eine niedrigere Stufe)
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
// Das Fadenkreuz samt Ladering zeichnet das Anzeige-Backend aus dem Spielerzustand (zeichneFadenkreuz in display-dom.js).

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

// --- SCHUSS ---

// Trifft Ziele im Kreis um das Fadenkreuz: Stufe 1-2 nur das naechste (Mitte am naechsten am Fadenkreuz), ab Stufe 3 alle.
// `ladung` (Schritte, 0 = Normalschuss) skaliert Schaden (x1 bis x4) und Radius (x1 bis x1,5); der voll geladene Schuss
// trifft unabhaengig von der Stufe alle Ziele im Kreis und ignoriert Schilde (Schild weg, Schaden auf die HP).
// Gibt die Anzahl der getroffenen Ziele zurueck.
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

// Einen Ladeschritt (Taste gehalten): die ersten 10 Schritte kosten nichts, danach 19/80 Energie pro Schritt.
// Reicht die Energie nicht (es muss immer noch der Schuss mit 6 Energie moeglich bleiben), bleibt die Ladung stehen.
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

// Schuss mit Schussabstand-Sperre und Energiepruefung; false = kein Schuss (Ladung verfaellt)
function attempts(pState, pKey, charge) {
  if ((pState.sniperCooldown || 0) > 0) return false;
  if (!pState.unlimitedEnergy && pState.energy < SHOT_ENERGY) return false;
  if (!pState.unlimitedEnergy) pState.energy -= SHOT_ENERGY;
  pState.sniperCooldown = shotDistance(pState);
  fireShot(pState, pKey, charge);
  return true;
}

// --- GRANATE ---

// Granaten im Flug: arrays.sniperGranaten, { id, pKey, x, y (Mitte), startX, startY, zielX, zielY, rest, rot, werte }
// (Client: nur id, pKey, x, y, rest, rot aus dem Snapshot)
let grenadeId = 0;
const pushes = []; // { z, vx, vy, rest, pKey } laufendes Wegstossen

// Wurf zum Fadenkreuz (Position beim Wurf), Flug in GRANATE_FLUG Schritten im Bogen; die Werte der Stufe gelten ab dem Wurf.
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
  // Online-Host: der Client zeigt die Druckwelle ueber ein Ereignis (Granate verschwindet im Snapshot)
  if (state.gameMode === 'online' && state.network && state.network.isHost) {
    Network.sendNetworkEvent({
      type: 'granate_detonated',
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
    // Vom Schaden zerstoert: nichts mehr zu tun
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

// --- GRANATEN-TASTE (Tippen / Halten) und EMP ---

// Mittelpunkt des Schiffs (EMP-Ursprung)
function shipMiddle(pState) {
  return { x: pState.x + config.playerSize / 2, y: pState.y + config.playerSize / 2 };
}

function createEmpRing(cx, cy, radius, pKey) {
  createEffect({ kind: 'sniperEmp', x: cx, y: cy, radius, pKey, rest: EMP_STEPS });
}

// Feindliche Geschosse im Radius entfernen (mit kleinem Funken); Bomben ohne Detonation
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

// EMP ums eigene Schiff: Geschosse zerstoeren, Feinde (keine Bosse, keine Asteroiden) 30 Schritte betaeuben, kein Schaden.
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
      type: 'emp_ausgeloest',
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

// Ziele fuer Kontakt und Explosion: Feinde, Asteroiden (ausser Magma) und Bosse
function mineTargets() {
  return [...arrays.enemies, ...arrays.asteroids, ...arrays.bosses].filter(
    z => !z.isIndestructible && (z.hp === undefined || z.hp > 0),
  );
}

let mineId = 0;

// Darstellungsfelder haftet/blinkt aus dem Zustand ableiten (Host); der Client uebernimmt sie aus dem Snapshot
function setMineDisplay(m) {
  m.sticks = !!m.target;
  m.blinks = !m.target && m.rest <= MINE_BLINK;
}

function removeMine(m) {
  Display.remove(m);
  const i = arrays.sniperMines.indexOf(m);
  if (i >= 0) arrays.sniperMines.splice(i, 1);
}

// Mine unter der Schiffsmitte legen; ueber dem Limit pro Spieler faellt die aelteste weg
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

// Explosion an der aktuellen Position: jedes Ziel im Radius genau einmal (Schild zuerst)
function explodeMine(m) {
  removeMine(m);
  createMineExplosion(m.x, m.y, m.pKey);
  if (state.gameMode === 'online' && state.network && state.network.isHost) {
    Network.sendNetworkEvent({
      type: 'mine_explodiert',
      x: Math.round(m.x * 10) / 10,
      y: Math.round(m.y * 10) / 10,
      radius: MINE_RADIUS,
      owner: m.pKey,
    });
  }
  for (const z of mineTargets().filter(t => boxIntersectsCircle(targetBox(t), m.x, m.y, MINE_RADIUS))) {
    damageTarget(z, m.damage, m.pKey);
  }
  // Boss-Raketen und -Bomben im Radius werden zerstoert (wie beim EMP)
  destroyProjectiles(arrays.bossMissileArray, m.x, m.y, MINE_RADIUS);
  destroyProjectiles(arrays.bossBombArray, m.x, m.y, MINE_RADIUS);
}

// Beruehrt eine Boss-Rakete oder -Bombe die Mine?
function bossProjectileAnMine(m) {
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
      } // Ziel vorher gestorben: Explosion an der letzten Position
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
      // Boss-Raketen und -Bomben loesen die Mine sofort aus (kein Haften an Geschossen)
      if (bossProjectileAnMine(m)) {
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

// Halten der Granaten-Taste (aus aktualisiereGranatenTaste, ab HALTEN_AB): alle MINE_INTERVALL Schritte eine Mine, bei freiem Cooldown.
// `schritte` = bisherige Haltedauer.
export function holdStep(pState, pKey, steps) {
  if (Hack.hasHack(pState, 'weaponOffline')) return;
  if ((pState.grenadeMines || 0) >= MINE_MAX_PRO_HOLD) return;
  if ((steps - HOLD_FROM) % MINE_INTERVAL !== 0) return;
  // Die erste Mine eines Haltens kostet eine Ladung (ohne Ladung keine Minen), weitere nichts
  if ((pState.grenadeMines || 0) === 0) {
    if (grenadeCharges(pState) < 1) return;
    consumeGrenade(pState);
  }
  putMine(pState, pKey);
  pState.grenadeMines = (pState.grenadeMines || 0) + 1;
}

// Tippen: Granate ins Fadenkreuz und EMP, danach startet der Cooldown
function tapGrenade(pState, pKey) {
  consumeGrenade(pState);
  throwGrenade(pState, pKey);
  triggerEmp(pState, pKey);
}

// Pro Schritt aus weapons.js (statt der Raketen): `gehalten` ist die Raketen-Taste. Druck startet die Zaehlung, Loslassen
// entscheidet: unter HALTEN_AB Schritten (und freiem Cooldown) = Tippen; nach dem Halten startet der Cooldown, wenn Minen lagen.
export function updateGrenadeKey(pState, pKey, held) {
  if (!isSniper(pState)) return;
  const lock = Hack.hasHack(pState, 'weaponOffline') || pState.isDead || !state.gameRunning;
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

// Wegstossen: pro Schritt ein Stueck, am Feld begrenzt (seitlich und oben; unten darf ein Ziel das Feld verlassen)
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

// Pro Schritt aus player.js (Energie-Phase, nach der Bewegung): Fadenkreuz pflegen und Schuss ausloesen.
// `gehalten` ist die Laser-Taste (Bot/Online liefern sie ebenfalls). Auswahl des Modells:
// - normal: Druck startet das Laden, Loslassen feuert (Haltedauer unter 10 Schritten = Normalschuss, sonst Ladeschuss).
//   Wird in der Schussabstand-Sperre losgelassen, faellt der Schuss (samt Ladung) automatisch, sobald die Sperre abläuft.
// - `auto` (Joystick-Autofeuer am Handy): Dauerfeuer aus Normalschuessen im Schussabstand, kein Laden.
// Gibt zurueck, ob in diesem Schritt geschossen wurde.
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
  const canShoot = !Hack.hasHack(pState, 'weaponOffline');
  // In der Sperre losgelassener Schuss: faellt, sobald die Sperre abgelaufen ist
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
      if (!pState.sniperHeld) resetCharge(pState); // Druck
      charging(pState);
    } else if (pState.sniperHeld && canShoot) {
      // Loslassen: sofort feuern oder bis zum Ende der Sperre vormerken
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

// Host: Sniper-Zustand eines Spielers fuer den Snapshot (leer bei anderen Schiffen)
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

// Host: fliegende Granaten fuer den Snapshot (id, Position, Besitzer, Restschritte des Flugs)
export function networkGrenadeList() {
  return arrays.sniperGrenades.map(g => ({ id: g.id, x: g.x, y: g.y, owner: g.pKey, rest: g.rest }));
}

// Host: aktive Minen fuer den Snapshot (id, Position, Besitzer, haftet, Restzuendzeit, Restlebensdauer, blinkt)
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

// Client: Zustand eines Spielers aus dem Snapshot uebernehmen und darstellen. Der Schuss wird am Sprung des
// Schussabstands erkannt (Strahl mit der zuletzt bekannten Ladung), Sounds nur fuer das eigene Schiff.
export function applySnapshot(pState, payload, pKey, ownOne) {
  if (!pState) return;
  if (!isSniper(pState) || !payload || payload.sniperTargetX === undefined || payload.isDead) {
    // Kein Sniper-Zustand im Snapshot: Fadenkreuz ausblenden (die Anzeige zeichnet es nur bei gesetztem Ziel)
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

// Client: Granaten des Hosts abgleichen (Modell pro Id in arrays.sniperGranaten, Position und Drehung aus dem Snapshot;
// auf dem Client laeuft aktualisiereGranaten nicht, die Liste gehoert allein dem Snapshot)
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

// Client: Minen des Hosts abgleichen (Modell pro Id in arrays.sniperMinen; aktualisiereMinen laeuft dort nicht, die
// Liste gehoert allein dem Snapshot). Legen-, Haft- und Piep-Ton bleiben hier.
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

// Client: Minen-Explosion (Ereignis 'mine_explodiert')
export function showMineExplosion(payload) {
  if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
  createMineExplosion(payload.x, payload.y, payload.owner === 'p2' ? 'p2' : 'p1');
}

// Client: Explosion einer Granate (Ereignis 'granate_detonated')
export function showDetonation(payload) {
  if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y) || !(payload.radius > 0)) return;
  Audio.playGrenade();
  Utils.createExplosion(payload.x, payload.y, '#ffffff', 10);
  Utils.createExplosion(payload.x, payload.y, '#ffeb3b', 10);
  createBlastWave(payload.x, payload.y, payload.radius, payload.owner === 'p2' ? 'p2' : 'p1');
}

// Client: EMP-Ring (Ereignis 'emp_ausgeloest')
export function showEmp(payload) {
  if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y) || !(payload.radius > 0)) return;
  Audio.playEmp();
  createEmpRing(payload.x, payload.y, payload.radius, payload.owner === 'p2' ? 'p2' : 'p1');
}

// Client, jeden Schritt: das eigene Fadenkreuz folgt dem vorhergesagten Schiff
// (ohne Auto-Zielen liegt es auf der Grundposition, mit Auto-Zielen gilt der Host-Wert)
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

// Fadenkreuz, Strahlen und Schusszustand eines Spielers zuruecksetzen (restartGame, Game Over, Schiffswechsel)
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

// Alle Sniper-Darstellungen entfernen (Game Over: danach laeuft keine Simulation mehr, die sie abraeumen wuerde)
export function removeEffects() {
  for (const s of [state, state.p2]) {
    if (!s) continue;
    s.sniperTargetX = null;
    s.sniperTargetY = null;
  }
  removeGrenadeEffects();
}
