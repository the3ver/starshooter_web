// Display interface: the only place through which the game logic addresses the rendering of the world.
// The logic only changes model fields (x, y, rot, ...); the backend in use draws from them.
// The default is the DOM backend (display-dom.js). Another engine (Canvas, WebGL, PixiJS ...)
// implements the same functions and is plugged in via setBackend().
//
// Model fields a backend evaluates (units as on the playfield, px and degrees):
// - x, y            position of the top left corner
// - displayX/Y      optional display position (online client: interpolation between snapshots), otherwise x/y
// - rot             optional rotation in degrees (missing = do not write a rotation)
// - particles: lives (0..1) for opacity and scaling
// - effects (arrays.effects, kind + fields): bombWave (x/y center, radius, color), bombWave2, missileWave,
//   bossWave (x/y center, radius); shared rest/duration (steps; t = 1 - rest/duration) and optional delay
//   (steps during which the effect is still invisible; they count towards the lifetime)
//   Sniper: sniperBeam (x/y nose, length, angle, width, glow, color), sniperBlastWave, sniperMineExplosion, sniperEmp (x/y center, radius); all with pKey
// - star (arrays.stars): x/y, size (px, square), speed
// - sniperGrenade (arrays.sniperGrenades): x/y center (14 px), rot (degrees), rest (flight steps)
// - sniperMine (arrays.sniperMines): x/y center (12 px), pKey, sticks, blinks (booleans)
// - state: shieldHp (shield visible > 0), hp/maxHp/carriesPowerup (cracks), isIndestructible (magma),
//   stunned (> 0), phase (cling-on flames), repulsorActive (boss), towedBy + beamX/beamY (tow beam),
//   harmless (parried projectile), color (laser), progress (bomb pulse, 1 -> 0)
import * as DomDisplay from './display-dom.js';

let backend = DomDisplay;

// Swap the backend. Required functions: create(obj, kind), drawWorld(), drawPlayer(), remove(obj),
// flash(obj, strength), flashPlayfield(color, ms).
export function setBackend(newBackend) {
  for (const name of ['create', 'drawWorld', 'drawPlayer', 'remove', 'flash', 'flashPlayfield']) {
    if (typeof newBackend?.[name] !== 'function') throw new Error(`display backend without ${name}()`);
  }
  backend = newBackend;
}

// Visual theme of the playfield (background, mood): 'standard' or 'biozone'. Optional for backends.
export function setTheme(name) {
  if (typeof backend.setTheme === 'function') backend.setTheme(name);
}

export function getBackend() {
  return backend;
}

// Creates the rendering of a new world object and shows it at its position. kind determines the
// look: enemy, asteroid, boss, powerup, laser, missile, bomb, enemyLaser, bossLaser, bossMissile,
// bossBomb, hackProjectile, gleveWave, particles, effect, star, sniperGrenade, sniperMine. The required model fields per kind are in AGENTS.md (display layer).
export function create(obj, kind) {
  backend.create(obj, kind);
  return obj;
}

// Draws all world objects (lists in arrays) from their model fields. Runs once at the end of every
// simulation step (host, solo, online client) and after an applied snapshot.
export function drawWorld() {
  backend.drawWorld();
}

// Draws only the two player ships from state / state.p2 (drawWorld does that as well). For places
// outside the simulation step that show or hide a ship immediately (menu, cutscene, restart).
// Fields: x, y, displayX/Y (online client: P1 interpolated), rotation, flameScale, shipVisible,
// invulnerableTimer (blinking), shieldTier (shield ring)
export function drawPlayer() {
  backend.drawPlayer();
}

// Removes the rendering of a world object. The caller removes the model (entry in arrays).
export function remove(obj) {
  if (obj) backend.remove(obj);
}

// Hit event: brighten the object briefly (strength ~2-3). Display only, changes no model field.
export function flash(obj, strength) {
  if (obj) backend.flash(obj, strength);
}

// Screen flash: playfield background briefly in color (CSS color), back to the base color after ms milliseconds.
export function flashPlayfield(color, ms) {
  backend.flashPlayfield(color, ms);
}
