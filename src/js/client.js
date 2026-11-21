import { state, config, arrays, shipModels } from './state.js';
import * as Network from './network.js';
import * as Hack from './hack.js';
import { animateParticles } from './partikel.js';
import { updateEffects } from './effekte.js';
import { moveStars } from './loop.js';
import * as Gleve from './gleve.js';
import * as Viper from './viper.js';
import * as Sniper from './sniper.js';
import * as Rock from './fels.js';
import { checkTheme } from './level.js';

// Steuerrichtung des Clients (Joystick normalisiert oder Tasten, Hacks angewendet)
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

// --- GLAETTUNG ZWISCHEN HOST-SNAPSHOTS ---
// Der Host sendet nur jeden 2. Simulationsschritt einen Snapshot. Dazwischen bewegt der Client:
// - Projektile mit bekannter Geschwindigkeit weiter (Extrapolation, der naechste Snapshot korrigiert)
// - alle anderen entfernten Objekte gleichmaessig zur letzten Snapshot-Position (Interpolation)
export const INTERPOLATION_STEPS = 2; // Schritte zwischen zwei Host-Snapshots
export const JUMP_DISTANCE = 100; // ab dieser Distanz (px) springen statt gleiten (Respawn/Teleport)
export const MAX_EXTRAPOLATION_STEPS = 4; // ohne neuen Snapshot nicht endlos weiterfliegen

// Angezeigte Position des Host-Schiffs (P1) auf dem Client
export const p1Display = {};

let stepsSinceSnapshot = 0;

// Angezeigte Position des Host-Schiffs ins Modell (state.anzeigeX/Y), die Anzeige zeichnet P1 dort
export function applyP1Display() {
  state.displayX = p1Display.displayX;
  state.displayY = p1Display.displayY;
}

export function snapshotReceived() {
  stepsSinceSnapshot = 0;
}

// Glaetten nur, wenn clientSchritt auch laeuft; sonst Snapshot-Position direkt zeigen
function smoothingActive() {
  return Boolean(state.network && state.network.isClient && state.network.connected && !state.paused);
}

// Neue Snapshot-Position (x, y) fuer ein entferntes Objekt merken. Das Objekt gleitet in
// INTERPOLATION_SCHRITTE Schritten von seiner angezeigten Position (anzeigeX/Y) dorthin.
export function setInterpolationTarget(obj, x, y) {
  const distance = Math.hypot(x - obj.displayX, y - obj.displayY); // NaN beim ersten Mal
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

// Schiebt die Anzeigeposition (anzeigeX/Y) einen Schritt weiter; gezeichnet wird danach ueber die Anzeige
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

// Fuer Projektile ohne Geschwindigkeit im Snapshot: aus zwei Snapshots ableiten
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
  // Spielerlaser fliegen auf dem Host mit y -= vy
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

// Startpunkt der Traktorstrahlen geschleppter Powerups (P1 an seiner angezeigten Position); den Strahl
// zeichnet die Anzeige aus towedBy und strahlX/strahlY
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
  // I-Frames / Blink-Timer auf Client dekrementieren
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

    // Gleve: Steuerrichtung (fuer Dash und Eingabe-Paket) und lokal vorhergesagter Dash (Raketen-Taste,
    // mobil der Raketen-Button)
    let gleveDash = false;
    if (Gleve.isGleve(state.p2)) {
      const direction = controlDirection(keys);
      state.p2.clientControlDirection = direction;
      gleveDash = Gleve.predictDash(state.p2, keys.k || keys.v, direction);
    }

    // Viper: Ausweichrolle des eigenen Schiffs lokal vorhergesagt (Startposition geht im Eingabe-Paket zum Host)
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
    // Vorhersage: aus dem Fels schieben wie der Host (Schaden meldet der Host)
    Rock.pushOut(state.p2);

    state.p2.rotate = targetRotateP2;
    state.p2.rotation = targetRotateP2;
    state.p2.flameScale = baseFlameScaleP2;
  }

  // Gleve-Effekte beider Schiffe (Dash-Klasse, Nachbilder, Sweep-Klinge)
  Gleve.showGleveStatus(state, 'p1');
  if (state.p2) Gleve.showGleveStatus(state.p2, 'p2');
  // Viper-Rolle: Klasse, Nachbilder und Bereitschaftsanzeige beider Schiffe
  Viper.showViperStatus(state, 'p1', false);
  if (state.p2) Viper.showViperStatus(state.p2, 'p2', true);

  // Sniper: Strahlen, Druckwellen und das Fadenkreuz des eigenen Schiffs
  Sniper.clientStep();

  // Entfernte Objekte zwischen den Snapshots weiterbewegen
  extrapolateProjectiles();
  interpolateObjects();
  setBeamStarts();

  // Partikel auf dem Client animieren und löschen
  animateParticles();
  updateEffects();
  Hack.showHackStatus();

  // Eingaben nur bei Aenderung, Bewegung (jeden 2. Schritt) oder als Heartbeat senden
  Network.sendInput();
}
