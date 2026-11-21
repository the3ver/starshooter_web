// Viper-X: evasive roll. A double tap on left/right (keys) or a fast sideways swipe on the
// joystick zone starts a roll: for ROLL_FRAMES steps the ship is shifted evenly by ROLL_DISTANCE px
// to the side, the normal controls rest and the ship is invulnerable (Utils.isDashInvulnerable
// also evaluates viperRollTimer). Then ROLL_COOLDOWN steps of pause (from the roll start).
// pState is `state` (P1) or `state.p2`, pKey 'p1' / 'p2'.
// State per player: viperRollTimer (remaining steps incl. the current one), viperRollDirection (+1 right / -1 left),
// viperRollCooldown, detection: viperLeftHeld/viperRightHeld (key edges), viperTapDirection/
// viperTapAge (last tap and steps since), viperJoyRest/viperJoyBeforehand (swipe).

import { state, config, arrays, shipColors, isCoopMode } from './state.js';
import * as Audio from './audio.js';
import * as Hack from './hack.js';
import { createParticles } from './particles.js';

export const ROLL_FRAMES = 12;
export const ROLL_DISTANCE = 70;
export const ROLL_COOLDOWN = 90;
export const DOUBLE_TAP_WINDOW = 15; // Steps between two press edges (250 ms at 60 Hz)
export const SWIPE_WINDOW = 8; // Steps from the rest zone (|x| < 0.2) to |x| > 0.8
const SWIPE_REST = 0.2;
const SWIPE_THRESHOLD = 0.8;

// Near miss + overdrive: an enemy projectile that comes within <= NEAR_MISS_DISTANCE px of the ship without
// hitting and then moves away again charges the strip (0..100) by NEAR_MISS_CHARGE. At 100 the
// overdrive starts for OVERDRIVE_DURATION steps (the strip visibly empties): double fire rate of the projectile laser and
// pierce. Detection only on the host/solo (checkNearMiss, once per step over all projectile lists).
export const NEAR_MISS_DISTANCE = 18;
export const NEAR_MISS_CHARGE = 10;
export const OVERDRIVE_DURATION = 300;

// Kill combo (V3, replaces the upgrade loss): every kill of the player (Utils.destroyTarget) within COMBO_WINDOW
// steps after the last kill raises viperCombo by 1; when the window expires it drops to 0, every hit
// on the ship (also one caught by the shield) sets it to 0. Points from kills x (1 + 0.1 * combo), at most x3;
// projectile laser cooldown from combo 5 -> 5, from combo 10 -> 4 (overdrive = 3 stays the minimum).
export const COMBO_WINDOW = 120;
export const COMBO_STEP = 0.1;
export const COMBO_MAX_FACTOR = 3;
export const COMBO_SOUND_TIERS = [5, 10, 20];

export function isViper(pState) {
  return !!pState && pState.selectedShipModel === 'viper';
}

export function isRollActive(pState) {
  return !!pState && (pState.viperRollTimer || 0) > 0;
}

export function isOverdrive(pState) {
  return !!pState && pState.selectedShipModel === 'viper' && (pState.viperOverdriveTimer || 0) > 0;
}

// Points multiplier for kills of this player (Viper only; 1 + 0.1 * combo, max 3)
export function comboFactor(pState) {
  if (!isViper(pState)) return 1;
  return Math.min(COMBO_MAX_FACTOR, 1 + COMBO_STEP * (pState.viperCombo || 0));
}

// Projectile laser cooldown in steps: normal 6, combo >= 5 -> 5, >= 10 -> 4, overdrive 3 (minimum)
export function shotCooldown(pState) {
  if (isOverdrive(pState)) return 3;
  const combo = isViper(pState) ? pState.viperCombo || 0 : 0;
  return combo >= 10 ? 4 : combo >= 5 ? 5 : 6;
}

// A kill of this player (after awarding points): combo +1, restart the window, sound at 5/10/20
export function registerKill(pState) {
  if (!isViper(pState)) return;
  pState.viperCombo = (pState.viperCombo || 0) + 1;
  pState.viperComboTimer = COMBO_WINDOW;
  const tier = COMBO_SOUND_TIERS.indexOf(pState.viperCombo) + 1;
  if (tier > 0) Audio.playCombo(tier);
}

export function resetCombo(pState) {
  if (!pState) return;
  pState.viperCombo = 0;
  pState.viperComboTimer = 0;
}

// Count the window down (host/solo/bot only; the online client takes the value from the snapshot)
function tickCombo(p) {
  if ((p.viperComboTimer || 0) > 0) {
    p.viperComboTimer--;
    if (p.viperComboTimer <= 0) p.viperCombo = 0;
  }
}

function shipColor(pState) {
  const c = shipColors[pState.selectedShipColor];
  return c ? c.prim : '#ffffff';
}

// Double tap (two press edges in the same direction within DOUBLE_TAP_WINDOW steps) or a swipe flick of the
// joystick. Returns the physical direction (+1 right, -1 left, 0 none). Runs every step, also during
// roll and cooldown, so the edges are never lost.
function detectDirection(p, e) {
  let direction = 0;
  p.viperTapAge = Math.min((p.viperTapAge || 0) + 1, 999);
  const flankL = Boolean(e.left) && !p.viperLeftHeld;
  const flankR = Boolean(e.right) && !p.viperRightHeld;
  p.viperLeftHeld = Boolean(e.left);
  p.viperRightHeld = Boolean(e.right);
  const flank = flankL === flankR ? 0 : flankR ? 1 : -1;
  if (flank) {
    if (flank === p.viperTapDirection && p.viperTapAge <= DOUBLE_TAP_WINDOW) {
      direction = flank;
      p.viperTapDirection = 0;
    } else {
      p.viperTapDirection = flank;
    }
    p.viperTapAge = 0;
  }

  // Mobile: joystick x jumps from rest over the threshold within SWIPE_WINDOW steps. A finger movement
  // from the center to the edge is thus a swipe, slowly pulling in or holding at the edge triggers nothing.
  if (e.joyX !== undefined) {
    const amount = Math.abs(e.joyX);
    p.viperJoyRest = amount < SWIPE_REST ? 0 : Math.min((p.viperJoyRest || 0) + 1, 99);
    if (amount > SWIPE_THRESHOLD && (p.viperJoyBeforehand || 0) <= SWIPE_THRESHOLD && p.viperJoyRest <= SWIPE_WINDOW) {
      direction = e.joyX > 0 ? 1 : -1;
    }
    p.viperJoyBeforehand = amount;
  }
  return direction;
}

// Control hacks redirect the roll like a normal sideways movement (0 = not sideways, no roll)
export function directionAfterHack(pState, direction) {
  if (!direction) return 0;
  return Math.sign(Hack.hackMovement(pState, direction, 0).dx);
}

function canRoll(p) {
  return !p.isDead && !isRollActive(p) && (p.viperRollCooldown || 0) <= 0;
}

function startRoll(p, direction) {
  p.viperRollTimer = ROLL_FRAMES;
  p.viperRollDirection = direction;
  p.viperRollCooldown = ROLL_COOLDOWN;
  // Online client: start position and direction go to the host in the input packet (see networkInput)
  p.viperNetworkStart = { x: p.x, y: p.y, ro: direction };
  Audio.playRoll();
}

function rollStep(p) {
  p.x = Math.max(
    0,
    Math.min(config.playfieldWidth - config.playerSize, p.x + (p.viperRollDirection * ROLL_DISTANCE) / ROLL_FRAMES),
  );
  createAfterimage(p);
}

// One step for a Viper ship, before the normal controls. input: { left, right, joyX } (physical keys
// or joystick, this function applies hacks) or null; request: ready direction from the bot or online host
// (hacks already applied). Returns true if the roll takes over the movement in this step.
export function updateViper(pState, pKey, input, request = 0) {
  if ((pState.viperRollTimer || 0) > 0) pState.viperRollTimer--;
  if ((pState.viperRollCooldown || 0) > 0) pState.viperRollCooldown--;
  pState.viperNetworkStart = null;
  tickOverdrive(pState);
  if (!(state.network && state.network.isOnline && !state.network.isHost)) tickCombo(pState);

  if (pState.isDead) {
    pState.viperRollTimer = 0;
    pState.viperOverdriveTimer = 0;
    pState.viperOverdriveStrip = 0;
    resetCombo(pState);
    return false;
  }

  let wish = request || 0;
  if (input) wish = directionAfterHack(pState, detectDirection(pState, input)) || wish;
  if (wish && canRoll(pState)) startRoll(pState, wish);

  const rolls = isRollActive(pState);
  if (rolls) rollStep(pState);
  return rolls;
}

// Count down the remaining overdrive time, the strip follows (integer, 100 -> 0 over the duration)
function tickOverdrive(p) {
  if ((p.viperOverdriveTimer || 0) > 0) {
    p.viperOverdriveTimer--;
    p.viperOverdriveStrip = Math.ceil((p.viperOverdriveTimer * 100) / OVERDRIVE_DURATION);
  }
}

// Distance between two rectangles (0 on overlap): gaps in x and y as Euclid
function rectDistance(ax, ay, aw, ah, bx, by, bw, bh) {
  const dx = Math.max(bx - (ax + aw), ax - (bx + bw), 0);
  const dy = Math.max(by - (ay + ah), ay - (by + bh), 0);
  return Math.hypot(dx, dy);
}

// Mark on the projectile: undefined = never near, number = smallest distance so far (close), true = already counted
function nearMissFor(p, markKey, projectiles) {
  const g = config.playerSize;
  for (const list of projectiles) {
    for (const s of list) {
      if (s.harmless || s[markKey] === true) continue;
      const distance = rectDistance(p.x, p.y, g, g, s.x, s.y, s.width, s.height);
      if (distance <= NEAR_MISS_DISTANCE) {
        if (typeof s[markKey] !== 'number' || distance < s[markKey]) s[markKey] = distance;
        else if (distance > s[markKey]) {
          s[markKey] = true;
          tallyNearMiss(p);
        } // moves away again
      } else if (typeof s[markKey] === 'number') {
        s[markKey] = true; // was close and is now farther away
        tallyNearMiss(p);
      }
    }
  }
}

function tallyNearMiss(p) {
  if ((p.viperOverdriveTimer || 0) > 0) return; // nothing recharges during the overdrive
  p.viperOverdriveStrip = Math.min(100, (p.viperOverdriveStrip || 0) + NEAR_MISS_CHARGE);
  if (p.viperOverdriveStrip >= 100) {
    p.viperOverdriveTimer = OVERDRIVE_DURATION;
    Audio.playOverdrive();
  } else {
    Audio.playNearMiss();
  }
  showNearMissPlus(p);
}

// Once per simulation step (loop.js, after all projectile movements and hits); host or solo only.
// Central instead of in opponents.js/boss.js: one place for all four lists, hits have already removed the projectile.
export function checkNearMiss() {
  const listen = [arrays.enemyLaserArray, arrays.bossLaserArray, arrays.hackProjectileArray, arrays.bossMissileArray];
  if (isViper(state) && !state.isDead) nearMissFor(state, 'nearMissP1', listen);
  if (isCoopMode() && state.p2 && isViper(state.p2) && !state.p2.isDead) nearMissFor(state.p2, 'nearMissP2', listen);
}

// Small plus at the ship (sparse: one character, rises briefly)
function showNearMissPlus(p) {
  createParticles({
    sort: 'nearMissPlus',
    x: p.x + config.playerSize / 2 - 4,
    y: p.y - 6,
    vx: 0,
    vy: -1.5,
    lives: 0.8,
    decay: 0.06,
  });
}

// Key state of a player for updateViper (joystick only while it is active)
export function inputFromKeys(left, right, joystick) {
  return { left, right, joyX: joystick && joystick.active ? joystick.x : 0 };
}

// --- ONLINE ---
// The client predicts its own roll with the same function (updateViper). In the start step the
// input packet carries start position and direction (ro); the host starts the same roll from there, ignores
// client positions meanwhile and is authoritative for hits. The snapshot brings timer/direction/cooldown for the display
// (the host's P1) and raises the client's cooldown to match.

export function networkInput(pState) {
  return pState.viperNetworkStart || null;
}

export function applySnapshot(pState, payload, ownOne) {
  if (!payload || payload.viperRollTimer === undefined) return;
  // Combo: the host is authoritative; sound for the own ship when reaching 5/10/20
  const combo = payload.viperCombo || 0;
  if (ownOne) {
    const tier = COMBO_SOUND_TIERS.filter(s => combo >= s).length;
    const old = COMBO_SOUND_TIERS.filter(s => (pState.viperCombo || 0) >= s).length;
    if (tier > old) Audio.playCombo(tier);
  }
  pState.viperCombo = combo;
  pState.viperComboTimer = payload.viperComboTimer || 0;
  // Overdrive: the host is authoritative; sounds only for the own ship, on change
  const strip = payload.viperOverdriveStrip || 0;
  const odTimer = payload.viperOverdriveTimer || 0;
  if (ownOne) {
    if (odTimer > 0 && !((pState.viperOverdriveTimer || 0) > 0)) Audio.playOverdrive();
    else if (strip > (pState.viperOverdriveStrip || 0) && odTimer <= 0) Audio.playNearMiss();
  }
  pState.viperOverdriveStrip = strip;
  pState.viperOverdriveTimer = odTimer;
  const cooldown = payload.viperRollCooldown || 0;
  if (ownOne) {
    // The roll runs predicted locally; the host's cooldown applies if it is longer
    if (cooldown > (pState.viperRollCooldown || 0)) pState.viperRollCooldown = cooldown;
    return;
  }
  const timer = payload.viperRollTimer || 0;
  if (timer > 0 && !isRollActive(pState)) Audio.playRoll();
  pState.viperRollTimer = timer;
  pState.viperRollDirection = payload.viperRollDirection || 0;
  pState.viperRollCooldown = cooldown;
}

// Per client step: afterimages and readiness display (the display derives the classes viper-rolle/-overdrive).
// Other ships (the host's P1) count the timer down themselves between snapshots, the own ship does
// aktualisiereViper.
export function showViperStatus(pState, pKey, ownOne) {
  const viper = isViper(pState) && !pState.isDead;
  const rolls = viper && isRollActive(pState);
  // Other ship (the host's P1): count the overdrive time down between snapshots yourself
  if (!ownOne && viper) tickOverdrive(pState);
  if (rolls && !ownOne) {
    createAfterimage(pState);
    pState.viperRollTimer--;
    if ((pState.viperRollCooldown || 0) > 0) pState.viperRollCooldown--;
  }
  showRollHud(pKey, pState);
}

// --- HUD ---

const hudStatus = { p1: '', p2: '' };

// Small readiness bar next to the energy bar, Viper only (P2 only if P2 plays)
export function showRollHud(pKey, pState, visible = true) {
  const el = document.getElementById(pKey === 'p2' ? 'viper-rolle-hud-p2' : 'viper-rolle-hud');
  if (!el) return;
  const show = visible && isViper(pState);
  const cd = pState ? pState.viperRollCooldown || 0 : 0;
  const ready = show && cd <= 0 && !isRollActive(pState);
  const fill = show ? Math.round((1 - cd / ROLL_COOLDOWN) * 100) : 0;
  showOverdriveHud(pKey, pState, show);
  showComboHud(pKey, pState, show);
  const signature = `${show}|${ready}|${fill}`;
  if (hudStatus[pKey] === signature) return;
  hudStatus[pKey] = signature;
  el.style.display = show ? 'block' : 'none';
  el.classList.toggle('bereit', ready);
  const bar = /** @type {HTMLElement} */ (el.firstElementChild);
  if (bar) bar.style.width = Math.max(0, Math.min(100, fill)) + '%';
}

const comboHudValue = { p1: 0, p2: 0 };

// Combo display below the score ("KOMBO 7 · x1.7"), hidden at 0; short pulse on increase
function showComboHud(pKey, pState, show) {
  const el = document.getElementById(pKey === 'p2' ? 'viper-kombo-hud-p2' : 'viper-kombo-hud');
  if (!el) return;
  const combo = show && pState ? Math.max(0, Math.round(pState.viperCombo || 0)) : 0;
  if (combo === comboHudValue[pKey]) return;
  const rose = combo > comboHudValue[pKey];
  comboHudValue[pKey] = combo;
  el.style.display = combo > 0 ? 'block' : 'none';
  if (combo > 0)
    el.textContent = 'KOMBO ' + combo + ' · x' + Math.min(COMBO_MAX_FACTOR, 1 + COMBO_STEP * combo).toFixed(1);
  el.classList.remove('puls');
  if (rose) {
    void el.offsetWidth; // Restart the animation
    el.classList.add('puls');
  }
}

const odHudStatus = { p1: '', p2: '' };

// Overdrive strip next to the roll bar (yellow during the overdrive)
function showOverdriveHud(pKey, pState, show) {
  const el = document.getElementById(pKey === 'p2' ? 'viper-overdrive-hud-p2' : 'viper-overdrive-hud');
  if (!el) return;
  const strip = show && pState ? Math.max(0, Math.min(100, Math.round(pState.viperOverdriveStrip || 0))) : 0;
  const active = show && isOverdrive(pState);
  const signature = `${show}|${active}|${strip}`;
  if (odHudStatus[pKey] === signature) return;
  odHudStatus[pKey] = signature;
  el.style.display = show ? 'block' : 'none';
  el.classList.toggle('aktiv', active);
  const bar = /** @type {HTMLElement} */ (el.firstElementChild);
  if (bar) bar.style.width = strip + '%';
}

export function reset(pState) {
  pState.viperOverdriveStrip = 0;
  pState.viperOverdriveTimer = 0;
  resetCombo(pState);
  pState.viperRollTimer = 0;
  pState.viperRollDirection = 0;
  pState.viperRollCooldown = 0;
  pState.viperLeftHeld = false;
  pState.viperRightHeld = false;
  pState.viperTapDirection = 0;
  pState.viperTapAge = 999;
  pState.viperJoyRest = 0;
  pState.viperJoyBeforehand = 0;
  pState.viperNetworkStart = null;
  // Bot and online host: remembered roll requests
  pState.botRollRequest = 0;
  pState.networkRollRequest = 0;
}

// Afterimage in the ship color plus one spark particle at the ship
function createAfterimage(pState) {
  const color = shipColor(pState);
  createParticles({ sort: 'viperAfterimage', color, x: pState.x, y: pState.y, vx: 0, vy: 0, lives: 0.6, decay: 0.08 });

  createParticles({
    color: '#ffffff',
    x: pState.x + 15 + (Math.random() * 12 - 6),
    y: pState.y + 15 + (Math.random() * 12 - 6),
    vx: -(pState.viperRollDirection || 0) * 1.2,
    vy: 0,
    lives: 1.0,
    decay: 0.07,
  });
}
