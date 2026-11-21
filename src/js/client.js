import { state, config, arrays, shipModels } from './state.js';
import * as Network from './network.js';
import * as Hack from './hack.js';
import { animateParticles } from './particles.js';
import { updateEffects } from './effects.js';
import { moveStars } from './loop.js';
import * as Gleve from './gleve.js';
import * as Viper from './viper.js';
import * as Sniper from './sniper.js';
import * as Rock from './rock.js';
import { checkTheme } from './level.js';

// Steering direction of the client (normalized joystick or keys, hacks applied)
function controlDirection(keys) {
  if (state.joystick && state.joystick.active) {
    const mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
    if (mag <= 0.1) return { dx: 0, dy: 0 };
    return Hack.hackMovement(state.p2, state.joystick.x / mag, state.joystick.y / mag);
  }
  return Hack.hackMovement(
    state.p2,
    (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0),
    (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0),
  );
}

// --- SMOOTHING BETWEEN HOST SNAPSHOTS ---
// The host sends a snapshot only every 2nd simulation step. In between the client moves:
// - projectiles with a known velocity further (extrapolation, the next snapshot corrects)
// - all other remote objects evenly towards the last snapshot position (interpolation)
export const INTERPOLATION_STEPS = 2; // Steps between two host snapshots
export const JUMP_DISTANCE = 100; // from this distance (px) on jump instead of glide (respawn/teleport)
export const MAX_EXTRAPOLATION_STEPS = 4; // do not keep flying forever without a new snapshot

// Displayed position of the host ship (P1) on the client
export const p1Display = {};

let stepsSinceSnapshot = 0;

// Displayed position of the host ship into the model (state.displayX/Y), the display draws P1 there
export function applyP1Display() {
  state.displayX = p1Display.displayX;
  state.displayY = p1Display.displayY;
}

export function snapshotReceived() {
  stepsSinceSnapshot = 0;
}

// Smooth only if clientStep runs too; otherwise show the snapshot position directly
function smoothingActive() {
  return Boolean(state.network && state.network.isClient && state.network.connected && !state.paused);
}

// Remember a new snapshot position (x, y) for a remote object. The object glides from its displayed
// position (displayX/Y) there in INTERPOLATION_STEPS steps.
export function setInterpolationTarget(obj, x, y) {
  const distance = Math.hypot(x - obj.displayX, y - obj.displayY); // NaN the first time
  obj.targetX = x;
  obj.targetY = y;
  if (!smoothingActive() || !(distance <= JUMP_DISTANCE)) {
    obj.displayX = x;
    obj.displayY = y;
    obj.ipSteps = 0;
    return;
  }
  obj.ipDx = (x - obj.displayX) / INTERPOLATION_STEPS;
  obj.ipDy = (y - obj.displayY) / INTERPOLATION_STEPS;
  obj.ipSteps = INTERPOLATION_STEPS;
}

// Moves the display position (displayX/Y) one step further; drawing happens afterwards via the display
function interpolate(obj) {
  if (!obj.ipSteps) return;
  obj.ipSteps--;
  if (obj.ipSteps === 0) {
    obj.displayX = obj.targetX;
    obj.displayY = obj.targetY;
  } else {
    obj.displayX += obj.ipDx;
    obj.displayY += obj.ipDy;
  }
}

// For projectiles without a velocity in the snapshot: derive it from two snapshots
export function deriveSpeed(obj, x, y) {
  if (obj.snapX !== undefined) {
    obj.vx = (x - obj.snapX) / INTERPOLATION_STEPS;
    obj.vy = (y - obj.snapY) / INTERPOLATION_STEPS;
  }
  obj.snapX = x;
  obj.snapY = y;
}

function moveProjectile(o, vx, vy) {
  if (!vx && !vy) return;
  o.x += vx || 0;
  o.y += vy || 0;
}

function extrapolateProjectiles() {
  if (stepsSinceSnapshot >= MAX_EXTRAPOLATION_STEPS) return;
  stepsSinceSnapshot++;
  // Player lasers fly with y -= vy on the host
  arrays.laserArray.forEach(l => moveProjectile(l, l.vx, -(l.vy || 0)));
  [
    arrays.enemyLaserArray,
    arrays.hackProjectileArray,
    arrays.bossLaserArray,
    arrays.bossMissileArray,
    arrays.missileArray,
    arrays.bombArray,
    arrays.bossBombArray,
  ].forEach(list => {
    list.forEach(o => moveProjectile(o, o.vx, o.vy));
  });
}

function interpolateObjects() {
  [arrays.enemies, arrays.asteroids, arrays.bosses, arrays.powerups].forEach(list => {
    list.forEach(o => interpolate(o));
  });
  interpolate(p1Display);
  applyP1Display();
}

// Start point of the tractor beams of towed powerups (P1 at its displayed position); the display draws
// the beam from towedBy and beamX/beamY
function setBeamStarts() {
  const ss = config.playerSize;
  arrays.powerups.forEach(p => {
    let sx, sy;
    if (p.towedBy === 'p1') {
      sx = p1Display.displayX !== undefined ? p1Display.displayX : state.x;
      sy = p1Display.displayY !== undefined ? p1Display.displayY : state.y;
    } else if (p.towedBy === 'p2' && state.p2) {
      sx = state.p2.x;
      sy = state.p2.y;
    } else {
      return;
    }
    p.beamX = sx + ss / 2;
    p.beamY = sy + ss;
  });
}

export function clientStep() {
  // Decrement i-frames / blink timers on the client
  if (state.invulnerableTimer > 0) {
    state.invulnerableTimer--;
  }
  if (state.p2 && state.p2.invulnerableTimer > 0) {
    state.p2.invulnerableTimer--;
  }

  moveStars();
  checkTheme();

  if (state.p2 && !state.p2.isDead) {
    let baseFlameScaleP2 = 1.0;
    let targetRotateP2 = 0;
    const p2Speed = (shipModels && shipModels[state.p2.selectedShipModel]?.speed) || config.speed;
    const keys = state.keysPressed;

    // Gleve: steering direction (for dash and input packet) and locally predicted dash (missile key,
    // on mobile the missile button)
    let gleveDash = false;
    if (Gleve.isGleve(state.p2)) {
      const direction = controlDirection(keys);
      state.p2.clientControlDirection = direction;
      gleveDash = Gleve.predictDash(state.p2, keys.k || keys.v, direction);
    }

    // Viper: the own ship's evasive roll is predicted locally (the start position goes to the host in the input packet)
    const viperRoll =
      Viper.isViper(state.p2) &&
      Viper.updateViper(
        state.p2,
        'p2',
        Viper.inputFromKeys(keys.a || keys.arrowleft, keys.d || keys.arrowright, state.joystick),
      );

    if (gleveDash) {
      baseFlameScaleP2 = 2.2;
    } else if (viperRoll) {
      baseFlameScaleP2 = 1.0;
    } else if (state.joystick && state.joystick.active) {
      let mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
      if (mag > 0.1) {
        const b = Hack.hackMovement(state.p2, state.joystick.x / mag, state.joystick.y / mag);
        state.p2.x += b.dx * p2Speed;
        state.p2.y += b.dy * p2Speed;
      }
      if (state.joystick.y < -0.2) baseFlameScaleP2 = 1.8;
      else if (state.joystick.y > 0.2) baseFlameScaleP2 = 0.4;
      if (state.joystick.x < -0.2) targetRotateP2 = -15;
      else if (state.joystick.x > 0.2) targetRotateP2 = 15;
    } else {
      const b = Hack.hackMovement(
        state.p2,
        (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0),
        (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0),
      );
      if (b.dy < 0) {
        state.p2.y -= p2Speed;
        baseFlameScaleP2 = 1.8;
      }
      if (b.dy > 0) {
        state.p2.y += p2Speed;
        baseFlameScaleP2 = 0.4;
      }
      if (b.dx < 0) {
        state.p2.x -= p2Speed;
        targetRotateP2 = -15;
      }
      if (b.dx > 0) {
        state.p2.x += p2Speed;
        targetRotateP2 = 15;
      }
    }

    if (state.p2.x < 0) state.p2.x = 0;
    if (state.p2.y < 0) state.p2.y = 0;
    if (state.p2.x > config.playfieldWidth - config.playerSize) state.p2.x = config.playfieldWidth - config.playerSize;
    if (state.p2.y > config.playfieldHeight - config.playerSize)
      state.p2.y = config.playfieldHeight - config.playerSize;
    // Prediction: push out of the rock like the host (the host reports damage)
    Rock.pushOut(state.p2);

    state.p2.rotate = targetRotateP2;
    state.p2.rotation = targetRotateP2;
    state.p2.flameScale = baseFlameScaleP2;
  }

  // Gleve effects of both ships (dash class, afterimages, sweep blade)
  Gleve.showGleveStatus(state, 'p1');
  if (state.p2) Gleve.showGleveStatus(state.p2, 'p2');
  // Viper roll: class, afterimages and readiness display of both ships
  Viper.showViperStatus(state, 'p1', false);
  if (state.p2) Viper.showViperStatus(state.p2, 'p2', true);

  // Sniper: beams, blast waves and the crosshair of the own ship
  Sniper.clientStep();

  // Keep moving remote objects between snapshots
  extrapolateProjectiles();
  interpolateObjects();
  setBeamStarts();

  // Animate and delete particles on the client
  animateParticles();
  updateEffects();
  Hack.showHackStatus();

  // Send inputs only on change, movement (every 2nd step) or as a heartbeat
  Network.sendInput();
}
