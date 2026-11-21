import { config, arrays, isCoopMode } from './state.js';
import * as Display from './anzeige.js';
import * as Rock from './fels.js';
import * as Chain from './kette.js';
import * as Growths from './gewaechse.js';
import { newId, getEnemyColor } from './entities.js';
import { nextPlayerMiddle } from './gegner.js';

// Organische Einzelwesen und Gegnermix der Fels-Level (Biozone). Statt klassischer Jaeger kommen hier Ketten
// (Kopfschuetze, Stachelkette als Hindernis, Kugelkette) und Einzelwesen:
// - krabbe: Stielaugen und Scheren. Gibt es eine Felswand, krabbelt sie zuerst an deren Kante entlang (Blick in
//   den Gang, Phase 'wand') und springt dann in den Gang ('sprung'); sonst fliegt sie von oben an ('anflug').
//   Danach krabbelt sie seitlich im freien Gang hin und her, schiesst gezielte Kugelpaare und zieht nach
//   KRABBE_DAUER nach unten ab
// - tentakler: Quallenschirm mit Tentakeln, schwebt pendelnd herab und stoesst Kugelringe aus
// Kugeln sind Sporen (Feindgeschosse mit spore = true).

export const CREATURE = ['crab', 'tentacler'];
export const SIZE = { crab: 34, tentacler: 30 };
export const CRAB_SHOT = 100;
export const CRAB_DURATION = 600;
export const WALL_MIN = 22; // Wandbreite, an der eine Krabbe entlanglaufen kann
export const WALL_SPEED = 0.8; // Laufen an der Kante, zusaetzlich zum Felstempo
export const JUMP_DURATION = 24;
export const TENTACLER_SHOT = 140;
export const TENTACLER_RING = 6;
export const BALL_SPEED = 2.4;

// Gewichte des Bio-Spawners (Summe 1)
/** @type {Array<[string, number]>} */
export const BIO_MIX = [
  ['chain', 0.2],
  ['spikeChain', 0.2],
  ['ballChain', 0.2],
  ['crab', 0.25],
  ['tentacler', 0.15],
];

export function isCreature(f) {
  return CREATURE.includes(f.pattern);
}

function baseValues(pattern, x, y, hp) {
  const h = Math.round(hp * (isCoopMode() ? 1.25 : 1));
  return {
    id: newId('f'),
    x,
    y,
    size: SIZE[pattern],
    hp: h,
    maxHp: h,
    shieldHp: 0,
    maxShieldHp: 0,
    hasShield: false,
    color: getEnemyColor(pattern),
    explosionsColor: getEnemyColor(pattern),
    vx: 0,
    vy: 0,
    time: 0,
    shotTimer: 9999,
    burstCount: 0,
    burstTimer: 0,
    isEnemy: true,
    isIndestructible: false,
    carriesPowerup: Math.random() < 0.15,
    pattern,
  };
}

// Freier Bereich auf Hoehe y (ohne Fels: ganzes Feld)
function freeAt(y, x) {
  return Rock.freeRange(y, x);
}

function startX(g) {
  const b = config.playfieldWidth;
  const x = 20 + Math.random() * (b - 40 - g);
  const free = freeAt(0, x + g / 2);
  return Math.max(free.left + 4, Math.min(free.right - g - 4, x));
}

// Wand mit Platz an der Oberkante: 'l', 'r' oder null (breitere Seite zuerst)
function wallTop() {
  const p = Rock.profileAt(10);
  if (!p) return null;
  const sides = [
    ['l', p.l],
    ['r', p.r],
  ].filter(([, w]) => w >= WALL_MIN);
  if (!sides.length) return null;
  sides.sort((a, b) => b[1] - a[1]);
  return sides[0][0];
}

// Lage an der Wandkante auf Hoehe der Krabbenmitte; ein Viertel steckt im Fels, Blick in den Gang
function setAnWall(f) {
  const g = f.size;
  const p = Rock.profileAt(f.y + g / 2);
  if (!p) return false;
  const edge = f.wall === 'l' ? p.l : config.playfieldWidth - p.r;
  f.x = f.wall === 'l' ? edge - g * 0.25 : edge - g * 0.75;
  f.rot = f.wall === 'l' ? -90 : 90;
  return true;
}

export function createCrab(x = null) {
  const g = SIZE.crab;
  const wall = x === null ? wallTop() : null;
  const f = {
    ...baseValues('crab', x ?? startX(g), wall ? 0 : -g, 40),
    phase: wall ? 'wall' : 'anflug',
    wall,
    wallTime: 90 + Math.floor(Math.random() * 120),
    targetY: 60 + Math.random() * 110,
    vx: (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 0.6),
    vy: 1.6,
    shotCadence: CRAB_SHOT,
    lifeTime: 0,
  };
  if (wall) setAnWall(f);
  arrays.enemies.push(Display.create(f, 'enemy'));
  return f;
}

export function createTentacler(x = null) {
  const g = SIZE.tentacler;
  const sx = x ?? startX(g);
  const f = {
    ...baseValues('tentacler', sx, -g, 30),
    basisX: sx,
    vy: 0.9,
    time: Math.random() * Math.PI * 2,
    shotCadence: 60 + Math.floor(Math.random() * TENTACLER_SHOT),
  };
  arrays.enemies.push(Display.create(f, 'enemy'));
  return f;
}

function middle(f) {
  return { x: f.x + f.size / 2, y: f.y + f.size / 2 };
}

function shootAimed(f, spread) {
  const m = middle(f);
  const target = nextPlayerMiddle(f);
  const w = Math.atan2(target.y - m.y, target.x - m.x);
  for (const d of spread) {
    Growths.createSporeClosed(m.x, m.y + f.size / 2, Math.cos(w + d) * BALL_SPEED, Math.sin(w + d) * BALL_SPEED);
  }
}

function updateCrab(f) {
  f.lifeTime++;
  if (f.phase === 'wall') {
    f.y += Rock.getSpeed() + WALL_SPEED;
    f.wallTime--;
    // Ende der Wand oder Zeit um: abspringen in den Gang
    if (f.wallTime <= 0 || !setAnWall(f) || !wallOnHeight(f)) {
      f.phase = 'jump';
      f.jumpTime = JUMP_DURATION;
      f.vx = (f.wall === 'l' ? 1 : -1) * (1.2 + Math.random() * 0.6);
    }
    return;
  }
  if (f.phase === 'jump') {
    // Satz in den Gang: schnell zur Seite, Drehung zurueck in Blickrichtung unten
    f.x += f.vx * 2.2;
    f.y += Rock.getSpeed() * 0.5;
    f.jumpTime--;
    f.rot = (f.rot || 0) * (f.jumpTime / JUMP_DURATION);
    if (f.jumpTime <= 0) {
      f.rot = 0;
      f.phase = 'krabbeln';
    }
    return;
  }
  if (f.phase === 'anflug') {
    f.y += f.vy;
    if (f.y >= f.targetY) f.phase = 'krabbeln';
    return;
  }
  if (f.phase === 'krabbeln') {
    f.y += Rock.getSpeed() * 0.5; // bleibt ungefaehr auf Hoehe, waehrend der Fels vorbeizieht
    const free = freeAt(f.y + f.size / 2, f.x + f.size / 2);
    f.x += f.vx;
    if (f.x < free.left + 4) {
      f.x = free.left + 4;
      f.vx = Math.abs(f.vx);
    } else if (f.x + f.size > free.right - 4) {
      f.x = free.right - 4 - f.size;
      f.vx = -Math.abs(f.vx);
    }
    f.shotCadence--;
    if (f.shotCadence <= 0) {
      shootAimed(f, [-0.15, 0.15]);
      f.shotCadence = CRAB_SHOT;
    }
    if (f.lifeTime > CRAB_DURATION) f.phase = 'abzug';
    return;
  }
  f.y += 2; // abzug
}

function wallOnHeight(f) {
  const p = Rock.profileAt(f.y + f.size / 2);
  return !!p && (f.wall === 'l' ? p.l : p.r) >= WALL_MIN;
}

function updateTentacler(f) {
  f.time += 0.04;
  f.y += f.vy;
  f.x = f.basisX + Math.sin(f.time) * 35;
  if (f.y < 20) return;
  f.shotCadence--;
  if (f.shotCadence <= 0) {
    const m = middle(f);
    for (let i = 0; i < TENTACLER_RING; i++) {
      const w = (i / TENTACLER_RING) * Math.PI * 2 + f.time;
      Growths.createSporeClosed(m.x, m.y, Math.cos(w) * BALL_SPEED * 0.8, Math.sin(w) * BALL_SPEED * 0.8);
    }
    f.shotCadence = TENTACLER_SHOT;
  }
}

// Jeder Schritt aus aktualisiereFeinde
export function update(f) {
  f.shotTimer = 9999; // kein Standard-Schuss nach unten
  if (f.pattern === 'crab') updateCrab(f);
  else updateTentacler(f);
}

// Gegner-Spawner der Fels-Level (levelPlan.spawner = 'bio')
export function manageBioSpawns() {
  let r = Math.random();
  let choice = BIO_MIX[BIO_MIX.length - 1][0];
  for (const [kind, share] of BIO_MIX) {
    if (r < share) {
      choice = kind;
      break;
    }
    r -= share;
  }
  if (choice === 'crab') return createCrab();
  if (choice === 'tentacler') return createTentacler();
  const lane = Chain.CHAIN_LANES[Math.floor(Math.random() * Chain.CHAIN_LANES.length)];
  const count = 6 + Math.floor(Math.random() * 7);
  return Chain.createChain(lane, count, Math.random() < 0.5 ? 1 : -1, choice);
}
