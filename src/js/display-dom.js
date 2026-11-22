// DOM backend of the display (see display.js): world objects are absolutely positioned elements in
// #spielfeld, the model carries its element in obj.el. Only this module writes position, rotation,
// opacity and state displays (shield, cracks, stun, tow beam ...) of the world objects into the DOM.
import { arrays, dom, state, shipColors } from './state.js';
import { MINE_SIZE, isSniper, hitRadius, radiusFactor, isFull, chargeShare, CHARGE_FROM } from './sniper.js';
import {
  WAVE_SPEED,
  WAVE_STEPS,
  SWEEP_PARRY_COLOR,
  isGleve,
  isDashActive,
  isSweepActive,
  sweepOrigin,
  sweepLength,
} from './gleve.js';
import { isViper, isRollActive, isOverdrive } from './viper.js';
import { HACK_NAMES, HACK_DURATION } from './hack.js';
import { launcherBinding } from './utils.js';
import { CREATOR, EFFECT_STYLE, getShipSvgContent } from './display-dom-objects.js';

function setPosition(o) {
  const x = o.displayX !== undefined ? o.displayX : o.x;
  const y = o.displayY !== undefined ? o.displayY : o.y;
  o.el.style.left = x + 'px';
  o.el.style.top = y + 'px';
}

// Position and, if the model carries a rotation, the rotation
function drawObject(o) {
  setPosition(o);
  if (typeof o.rot === 'number') o.el.style.transform = `rotate(${o.rot}deg)`;
}

function showStun(o) {
  o.el.classList.toggle('betaeubt', o.stunned > 0);
}

// Enemy: shield visible while shieldHp > 0, cling-on flames only after detaching
function drawEnemy(f) {
  drawObject(f);
  showStun(f);
  if (f.open !== undefined) f.el.classList.toggle('offen', !!f.open);
  if (f.shieldEl && !(f.shieldHp > 0)) {
    f.shieldEl.remove();
    f.shieldEl = null;
  }
  if (f.pattern === 'clingOn') {
    const flames = f.phase === 'attached' ? 'none' : 'block';
    if (f.el.dataset.flames !== flames) {
      f.el.dataset.flames = flames;
      f.el.querySelectorAll('.feind-flame').forEach(fl => {
        fl.style.display = flames;
      });
    }
  }
}

// Asteroid: magma class from isIndestructible, cracks become visible with damage (hp/maxHp)
function drawAsteroid(a) {
  drawObject(a);
  a.el.classList.toggle('unzerstoerbar', !!a.isIndestructible);
  if (a.isIndestructible) return;
  if (!a.crackEl) {
    // Cracked magma chunk: cracks without a pattern
    a.crackEl = document.createElement('div');
    a.crackEl.classList.add('riss-layer');
    a.el.appendChild(a.crackEl);
  }
  if (a.maxHp) {
    const basis = a.carriesPowerup ? 0.5 : 0;
    a.crackEl.style.opacity = basis + (1 - basis) * (1 - Math.max(0, a.hp) / a.maxHp);
  }
}

function drawBoss(b) {
  setPosition(b);
  showStun(b);
  b.el.classList.toggle('repulsor-aktiv', !!b.repulsorActive);
  if (b.open !== undefined) b.el.classList.toggle('offen', !!b.open);
}

function removeBeam(p) {
  if (p.beamEl) {
    p.beamEl.remove();
    p.beamEl = null;
  }
}

// Tractor beam from the ship (beamX/beamY) to the powerup center, color by tug
function drawBeam(p) {
  if (!p.towedBy || p.beamX === undefined) {
    removeBeam(p);
    return;
  }
  if (p.beamEl && p.beamEl.dataset.fromEntry !== p.towedBy) removeBeam(p);
  if (!p.beamEl) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'tractor-beam-svg');
    svg.dataset.fromEntry = p.towedBy;
    Object.assign(svg.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '6',
    });
    const glow = document.createElementNS(ns, 'line');
    glow.setAttribute('class', 'tractor-beam-glow');
    glow.setAttribute('stroke', p.towedBy === 'p1' ? '#3498db' : '#2ecc71');
    glow.setAttribute('stroke-width', '4');
    glow.setAttribute('opacity', '0.45');
    const core = document.createElementNS(ns, 'line');
    core.setAttribute('class', 'tractor-beam-core');
    core.setAttribute('stroke', '#ffffff');
    core.setAttribute('stroke-width', '1.5');
    core.setAttribute('stroke-dasharray', '3 2');
    svg.appendChild(glow);
    svg.appendChild(core);
    dom.playfield.appendChild(svg);
    p.beamEl = svg;
  }
  const g = p.size || 24;
  const px = (p.displayX !== undefined ? p.displayX : p.x) + g / 2;
  const py = (p.displayY !== undefined ? p.displayY : p.y) + g / 2;
  p.beamEl.querySelectorAll('line').forEach(l => {
    l.setAttribute('x1', p.beamX);
    l.setAttribute('y1', p.beamY);
    l.setAttribute('x2', px);
    l.setAttribute('y2', py);
  });
}

function drawPowerup(p) {
  setPosition(p);
  const tug = p.towedBy || '';
  if (p.el.dataset.towedBy !== tug) {
    p.el.dataset.towedBy = tug;
    p.el.classList.remove('powerup-towed', 'powerup-towed-p1', 'powerup-towed-p2');
    if (tug) p.el.classList.add('powerup-towed', `powerup-towed-${tug}`);
  }
  drawBeam(p);
}

function setColor(o, color) {
  if (o.el.dataset.color === color) return;
  o.el.dataset.color = color;
  o.el.style.backgroundColor = color;
  o.el.style.boxShadow = `0 0 10px ${color}`;
}

// Player laser: the color can change (bouncer on magma)
function drawLaser(l) {
  drawObject(l);
  if (l.color) setColor(l, l.color);
}

// Enemy projectiles: parried by the Gleve (harmless) orange
function drawProjectile(o) {
  drawObject(o);
  if (o.harmless && !o.el.classList.contains('gleve-pariert')) {
    o.el.classList.add('gleve-pariert');
    setColor(o, SWEEP_PARRY_COLOR);
  }
}

// Player bomb: lights and aura pulse faster the closer the target (progress 1 -> 0)
function drawBomb(b) {
  drawObject(b);
  if (b.progress === undefined) return;
  const blink = Math.max(0.08, b.progress) + 's';
  const aura = Math.max(0.06, b.progress * 0.8) + 's';
  b.el.querySelectorAll('.bombe-licht').forEach(l => {
    l.style.animationDuration = blink;
  });
  const auraEl = b.el.querySelector('.bombe-aura');
  if (auraEl) auraEl.style.animationDuration = aura;
}

function drawParticles(p) {
  setPosition(p);
  p.el.style.opacity = p.lives;
  p.el.style.transform = p.vRot ? `scale(${p.lives}) rotate(${p.rot || 0}deg)` : `scale(${p.lives})`;
}

// Gleve blade wave: fades with the distance traveled
function drawWave(w) {
  setPosition(w);
  const travel = Math.max(0, (w.startY === undefined ? w.y : w.startY) - w.y);
  w.el.style.opacity = String(Math.max(0.2, 1 - (0.8 * travel) / (WAVE_SPEED * WAVE_STEPS)));
}

// Sniper effects, each kind with its own calculation from t = 1 - rest / duration. Rings grow from the center (x/y) to the diameter d,
// the beam stays in place and only fades out.
function drawSniperRing(e, d, opacity) {
  e.el.style.width = d + 'px';
  e.el.style.height = d + 'px';
  e.el.style.left = e.x - d / 2 + 'px';
  e.el.style.top = e.y - d / 2 + 'px';
  e.el.style.opacity = opacity;
}

const SNIPER_EFFECT_DRAWER = {
  // Powerup shockwave: grows linearly up to radius (farthest field corner), fades only partly
  shockwave: e => {
    const t = 1 - e.rest / e.duration;
    drawSniperRing(e, e.radius * 2 * t, 1 - t * 0.6);
  },
  sniperBeam: e => {
    e.el.style.opacity = e.rest / e.duration;
  },
  // fast at the start, tapering off towards the end
  sniperBlastWave: e => {
    const t = 1 - e.rest / e.duration;
    drawSniperRing(e, e.radius * 2 * Math.sqrt(t), 1 - t * 0.85);
  },
  sniperMineExplosion: e => {
    const t = 1 - e.rest / e.duration;
    drawSniperRing(e, e.radius * 2 * Math.sqrt(t), 1 - t * 0.85);
  },
  sniperEmp: e => {
    const t = 1 - e.rest / e.duration;
    drawSniperRing(e, e.radius * 2 * t, 1 - t * 0.8);
  },
};

// Effect with a lifetime: progress t from rest/duration (invisible during a delay), center x/y,
// size grows up to scale and opacity drops to 0
function drawEffect(e) {
  const sniper = SNIPER_EFFECT_DRAWER[e.kind];
  if (sniper) {
    sniper(e);
    return;
  }
  const style = EFFECT_STYLE[e.kind];
  const dir = e.delay || 0;
  const elapsed = e.duration - e.rest;
  const visible = elapsed >= dir;
  const t = visible ? (elapsed - dir) / (e.duration - dir) : 0;
  e.el.style.left = e.x - e.radius + 'px';
  e.el.style.top = e.y - e.radius + 'px';
  e.el.style.opacity = visible ? String(1 - t) : '0';
  e.el.style.transform = `scale(${1 + (style.scale - 1) * t})`;
}

// Sniper grenade in flight: x/y = center, 14 px, rotation from rot
function drawSniperGrenade(g) {
  g.el.style.left = g.x - 7 + 'px';
  g.el.style.top = g.y - 7 + 'px';
  g.el.style.transform = `rotate(${g.rot}deg)`;
}

// Sticky mine: x/y = center, 12 px (MINE_SIZE), classes haftet/blinkt from the model
function drawSniperMine(m) {
  m.el.style.left = m.x - MINE_SIZE / 2 + 'px';
  m.el.style.top = m.y - MINE_SIZE / 2 + 'px';
  m.el.classList.toggle('haftet', !!m.sticks);
  m.el.classList.toggle('blinkt', !!m.blinks);
}

// Drawer per object kind (on creation) and per list (every step).
const DRAWER_PER_KIND = {
  star: setPosition,
  enemy: drawEnemy,
  asteroid: drawAsteroid,
  boss: drawBoss,
  powerup: drawPowerup,
  laser: drawLaser,
  missile: drawObject,
  bomb: drawBomb,
  enemyLaser: drawProjectile,
  bossLaser: drawProjectile,
  bossMissile: drawObject,
  bossBomb: drawObject,
  hackProjectile: drawProjectile,
  gleveWave: drawWave,
  particles: drawParticles,
  effect: drawEffect,
  sniperGrenade: drawSniperGrenade,
  sniperMine: drawSniperMine,
  rock: setPosition,
};

const DRAWER = {
  stars: setPosition,
  asteroids: drawAsteroid,
  enemies: drawEnemy,
  bosses: drawBoss,
  powerups: drawPowerup,
  laserArray: drawLaser,
  missileArray: drawObject,
  bombArray: drawBomb,
  enemyLaserArray: drawProjectile,
  bossLaserArray: drawProjectile,
  bossMissileArray: drawObject,
  bossBombArray: drawObject,
  hackProjectileArray: drawProjectile,
  particleArray: drawParticles,
  gleveWaves: drawWave,
  effects: drawEffect,
  sniperGrenades: drawSniperGrenade,
  sniperMines: drawSniperMine,
  rock: setPosition,
};

export function create(obj, kind) {
  const build = CREATOR[kind];
  if (!build) throw new Error(`unknown object kind for the display: ${kind}`);
  obj.el = build(obj);
  dom.playfield.appendChild(obj.el);
  DRAWER_PER_KIND[kind](obj);
}

// Player ships: fixed elements #spieler / #spieler-2 with engine flames
const SHIPS = [
  { pKey: 'p1', el: () => dom.player, status: () => state, flames: ['flame-left', 'flame-right'] },
  { pKey: 'p2', el: () => dom.player2, status: () => state.p2, flames: ['flame-left-p2', 'flame-right-p2'] },
];

// SVG by model and color; the Gleve has only a center engine (flames centered via class)
function drawLook(s, el) {
  const model = s.selectedShipModel || 'viper';
  const color = s.selectedShipColor || 'red';
  const key = model + '|' + color;
  if (el.dataset.look === key) return;
  el.dataset.look = key;
  const svg = el.querySelector('svg');
  // eslint-disable-next-line no-unsanitized/property -- ship SVG via the shipColors lookup
  if (svg) svg.innerHTML = getShipSvgContent(model, color);
  el.classList.toggle('schiff-gleve', model === 'gleve');
}

// Missile launcher pods by model and missile tier
function drawLauncher(s, el) {
  const binding = launcherBinding(s);
  const tier = Math.min(5, Math.max(1, s.missileTier || 1));
  const key = [binding.left, binding.right, binding.middle, tier].join('|');
  if (el.dataset.launcher === key) return;
  el.dataset.launcher = key;
  const pods = [
    ['.werfer-links', binding.left],
    ['.werfer-rechts', binding.right],
    ['.werfer-center', binding.middle],
  ];
  for (const [selector, visible] of pods) {
    const pod = el.querySelector(selector);
    if (!pod) continue;
    pod.style.display = visible ? 'block' : 'none';
    pod.classList.remove('werfer-lvl-1', 'werfer-lvl-2', 'werfer-lvl-3', 'werfer-lvl-4', 'werfer-lvl-5');
    pod.classList.add(`werfer-lvl-${tier}`);
  }
}

// Running hacks: label with name and remaining time above the ship
function drawHackLabel(s, pKey, active) {
  let label = document.getElementById('hack-label-' + pKey);
  if (!active) {
    if (label) label.style.display = 'none';
    return;
  }
  if (!label) {
    label = document.createElement('div');
    label.id = 'hack-label-' + pKey;
    label.classList.add('hack-label');
    label.innerHTML =
      '<div class="hack-text"></div><div class="hack-restzeit-rahmen"><div class="hack-restzeit"></div></div>';
    dom.playfield.appendChild(label);
  }
  const text = s.hacks.map(h => HACK_NAMES[h.type]).join(' + ');
  const textEl = label.querySelector('.hack-text');
  if (textEl.textContent !== text) textEl.textContent = text;
  const restMax = Math.max(...s.hacks.map(h => h.timer));
  /** @type {HTMLElement} */ (label.querySelector('.hack-restzeit')).style.width =
    (restMax / HACK_DURATION) * 100 + '%';
  label.style.display = 'block';
  label.style.left = s.x + 15 + 'px';
  label.style.top = s.y - 22 + 'px';
}

// Sniper crosshair (circle with four strokes) with charge ring from sniperTargetX/Y, laser tier, sniperCharge and sniperHeld.
// Visible only for living snipers in a running game with a target set.
function drawCrosshair(s, pKey) {
  const id = 'fadenkreuz-' + pKey;
  let el = document.getElementById(id);
  const visible = isSniper(s) && !s.isDead && state.gameRunning && s.sniperTargetX != null;
  if (!visible) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.classList.add('sniper-fadenkreuz', 'sniper-fadenkreuz-' + pKey);
    for (const side of ['o', 'u', 'l', 'r']) {
      const stroke = document.createElement('i');
      stroke.classList.add('sniper-strich', 'sniper-strich-' + side);
      el.appendChild(stroke);
    }
    dom.playfield.appendChild(el);
  }
  const r = hitRadius(s);
  const c = shipColors[s.selectedShipColor];
  const color = c ? c.prim : '#ffffff';
  drawChargeRing(el, s);
  el.style.width = r * 2 + 'px';
  el.style.height = r * 2 + 'px';
  el.style.left = s.sniperTargetX - r + 'px';
  el.style.top = s.sniperTargetY - r + 'px';
  el.style.color = color;
  el.style.borderColor = color;
  el.style.boxShadow = `0 0 6px ${color}, inset 0 0 4px ${color}`;
}

// Charge ring in the crosshair: shows the current hit circle, grows with the charge, class voll at full charge
function drawChargeRing(el, s) {
  let ring = el.querySelector('.sniper-ladering');
  if (!ring) {
    ring = document.createElement('div');
    ring.classList.add('sniper-ladering');
    el.appendChild(ring);
  }
  const charge = s.sniperCharge || 0;
  const visible = !!s.sniperHeld && charge >= CHARGE_FROM;
  ring.style.display = visible ? 'block' : 'none';
  ring.classList.toggle('voll', visible && isFull(charge));
  if (!visible) return;
  const d = hitRadius(s) * 2 * radiusFactor(charge);
  const share = chargeShare(charge);
  ring.style.width = d + 'px';
  ring.style.height = d + 'px';
  ring.style.opacity = 0.45 + 0.55 * share;
  ring.style.borderWidth = 1.5 + 2.5 * share + 'px';
}

// Gleve sweep blade from gleveSweepTimer, angle and direction; visible only for living Gleves with a running sweep.
// Origin and length come from the game logic (sweepOrigin, sweepLength), the color from the ship color.
function drawBlade(s, pKey) {
  const id = 'gleve-klinge-' + pKey;
  let el = document.getElementById(id);
  if (!(isGleve(s) && !s.isDead && isSweepActive(s))) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.classList.add('gleve-klinge');
    dom.playfield.appendChild(el);
  }
  const o = sweepOrigin(s);
  const length = sweepLength(s);
  const c = shipColors[s.selectedShipColor];
  const color = c ? c.prim : '#ffffff';
  el.style.height = length + 'px';
  el.style.left = o.x - 2 + 'px';
  el.style.top = o.y - length + 'px';
  el.style.boxShadow = `0 0 4px #ffffff, 0 0 8px ${color}, 0 0 14px ${color}`;
  el.style.borderColor = color;
  // Slightly curved: tilted against the direction of travel
  el.style.borderRadius = (s.gleveSweepDirection || 1) > 0 ? '0 100% 0 0 / 0 100% 0 0' : '100% 0 0 0 / 100% 0 0 0';
  el.style.transform = `rotate(${s.gleveSweepAngle}deg)`;
}

// One ship from its state: visibility (shipVisible), position (displayX/Y or x/y), tilt
// (rotation), flames (flameScale), blinking during invulnerability, shield ring per shieldTier
function drawShip(s, el, flameIds, pKey) {
  drawLook(s, el);
  drawLauncher(s, el);
  const alive = !s.isDead;
  el.classList.toggle('gleve-dash', alive && isGleve(s) && isDashActive(s));
  el.classList.toggle('viper-rolle', alive && isViper(s) && isRollActive(s));
  el.classList.toggle('viper-overdrive', alive && isViper(s) && isOverdrive(s));
  const hacked = alive && (s.hacks || []).length > 0;
  el.classList.toggle('spieler-gehackt', hacked);
  drawHackLabel(s, pKey, hacked);
  drawCrosshair(s, pKey);
  drawBlade(s, pKey);
  if (typeof s.shipVisible === 'boolean') el.style.display = s.shipVisible ? 'block' : 'none';
  setPosition({ el, x: s.x, y: s.y, displayX: s.displayX, displayY: s.displayY });
  if (typeof s.rotation === 'number') el.style.transform = `rotate(${s.rotation}deg)`;
  if (typeof s.flameScale === 'number') {
    for (const id of flameIds) {
      const flame = document.getElementById(id);
      if (flame) flame.style.transform = `scaleY(${s.flameScale})`;
    }
  }
  el.classList.toggle('spieler-blink', s.invulnerableTimer > 0);
  for (let tier = 1; tier <= 3; tier++) el.classList.toggle(`schild-aktiv-${tier}`, s.shieldTier === tier);
}

export function drawPlayer() {
  for (const ship of SHIPS) {
    const el = ship.el();
    const s = ship.status();
    if (el && s) drawShip(s, el, ship.flames, ship.pKey);
  }
  drawBeams();
}

// Autolaser (rotated beam to the target) and hitscan laser (vertical) of player 1
function drawBeams() {
  const auto = state.autolaserBeam;
  if (dom.autolaserEl) {
    dom.autolaserEl.style.display = auto ? 'block' : 'none';
    if (auto) {
      dom.autolaserEl.style.height = auto.length + 'px';
      dom.autolaserEl.style.top = auto.y - auto.length + 'px';
      dom.autolaserEl.style.left = auto.x - 2 + 'px';
      dom.autolaserEl.style.transform = `rotate(${auto.angle}deg)`;
    }
  }
  const hitscan = state.hitscanBeam;
  const hitscanEl = document.getElementById('hitscan-laser');
  if (hitscanEl) {
    hitscanEl.style.display = hitscan ? 'block' : 'none';
    if (hitscan) {
      hitscanEl.style.height = hitscan.length + 'px';
      hitscanEl.style.top = hitscan.y - hitscan.length + 'px';
      hitscanEl.style.left = hitscan.x - 3 + 'px';
    }
  }
}

export function drawWorld() {
  // The game HUD shows only in a running game and on the game over screen; the start menu and the intro
  // cutscene hide it (issues #28, #27, #24). Derived from the state every step, so every way back to the
  // menu is covered.
  const hudHidden = (!state.gameRunning && !state.gameOverActive) || state.cutsceneActive;
  dom.playfield.classList.toggle('hud-verborgen', hudHidden);
  drawPlayer();
  for (const name in DRAWER) {
    const draw = DRAWER[name];
    for (const o of arrays[name]) {
      if (o.el) draw(o);
    }
  }
}

export function remove(obj) {
  removeBeam(obj);
  if (obj.el) obj.el.remove();
}

// Brief brightening on a hit (strength = brightness factor), independent of the simulation rate
export function flash(obj, strength) {
  const el = obj.el;
  if (!el) return;
  el.style.filter = `brightness(${strength})`;
  setTimeout(() => {
    el.style.filter = '';
  }, 50);
}

// Screen flash: color the playfield background briefly, back to the base color after ms. Every flash sets its
// own timer (as before in the logic): a second flash within the first sets the base color when the first expires.
export function flashPlayfield(color, ms) {
  const el = dom.playfield || document.getElementById('spielfeld');
  if (!el) return;
  el.style.backgroundColor = color;
  setTimeout(() => {
    // back to the color from the stylesheet (theme class)
    el.style.backgroundColor = '';
  }, ms);
}

// Theme as class thema-<name> on the playfield; 'standard' = no class
export function setTheme(name) {
  const el = dom.playfield || document.getElementById('spielfeld');
  if (!el) return;
  [...el.classList].filter(k => k.startsWith('thema-')).forEach(k => el.classList.remove(k));
  if (name && name !== 'standard') el.classList.add('thema-' + name);
}
