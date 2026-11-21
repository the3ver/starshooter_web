import { state, dom, config, arrays, isCoopMode } from './state.js';
import * as Display from './display.js';
import * as Rock from './rock.js';
import * as Growths from './growths.js';
import * as Utils from './utils.js';
import * as Network from './network.js';
import { newId } from './entities.js';
import { nextPlayerMiddle } from './opponents.js';

// Island boss (rock levels): the body is a large rock island made of segments (rock.js: collision, knockback,
// drawing, online sync). It scrolls in and stops. Hit zones are the eyes (arrays.bosses,
// bossType 'eye', shared bossId): they blink, are vulnerable only while open and shoot aimed spores.
// Tubes on the island flanks (growth 'tube') eject larvae. When the second to last eye falls, the
// body slowly advances (enrage). The boss is defeated when the last eye falls (destroyTarget -> defeatBoss).

export const BOSS_ID = 'island';
export const ENTRY_SPEED = 1.8;
export const ENRAGE_SPEED = 0.12;
export const EYE_SIZE = 36;
export const EYE_OPEN = 110;
export const EYE_CLOSED = 70;
export const EYE_SHOT = 45;
export const SPORE_SPEED = 3;
export const BONE_COLOR = '#e8dcb8';

// Skeleton from bottom to top, mirror-symmetric to the vertical center axis: spine (width in
// vertebra widths) and arm pairs (arms: reach of both arms as a share of the maximum width). An arm pair is a
// profile point where the island reaches out to the arm tips on both sides; the neighboring points are vertebrae, so
// pointed bone spurs appear. Eyes sit at the bottom tip and at the tips of the first arm pair,
// im Coop zusaetzlich am zweiten Armpaar.
// All parts lie in the lower seven vertebrae: in the fight the body stands still, no segments appear above it.
const SKELETON = [
  { vortex: 0.6, eyes: ['bottom'] },
  { vortex: 1.1, tubes: true },
  { arms: 1, eyes: ['left', 'right'] },
  { arms: 0.55 },
  { vortex: 1.25, tubes: true },
  { arms: 0.8, coopEyes: ['left', 'right'] },
  { arms: 0.45 },
  { vortex: 1.1 },
  { vortex: 1.2 },
  { vortex: 1.5 },
  { vortex: 0.8 },
];

let boss = null; // { phase: 'entry' | 'fight' | 'enrage' | 'retreat', eyesTotal }

export function reset() {
  boss = null;
}

export function isActive() {
  return !!boss;
}

export function phase() {
  return boss ? boss.phase : null;
}

function maxWidth() {
  const b = config.playfieldWidth;
  return Math.min(b * 0.7, b - 2 * Rock.MIN_PASSAGE);
}

function vortexWidth() {
  return Math.max(60, maxWidth() * 0.28);
}

// Profile points of the body with markers (bone, bossIndex, eyes, tubes); the island is always centered
export function bodyProfile() {
  const c = config.playfieldWidth / 2;
  return SKELETON.map((k, i) => ({
    l: 0,
    r: 0,
    inner: c,
    ib: k.arms ? maxWidth() * k.arms : vortexWidth() * k.vortex,
    bone: true,
    bossIndex: i,
    eyes: [...(k.eyes || []), ...(isCoopMode() ? k.coopEyes || [] : [])],
    tubes: !!k.tubes,
  }));
}

export function eyeCount() {
  return bodyProfile().reduce((n, p) => n + p.eyes.length, 0);
}

// After the boss warning (Level.startBoss)
export function create() {
  boss = { phase: 'entry', eyeTotal: 0 };
  state.bossActive = true;
  dom.bossHpContainer.style.display = 'block';
  dom.bossHpBar.style.width = '100%';
  dom.bossHpBar.style.backgroundColor = '#e67e22';
  Rock.setSpeed(ENTRY_SPEED);
  Rock.enqueue(bodyProfile());
}

function eyeHp() {
  const mult = isCoopMode() ? 1.4 : 1.0;
  return Math.round(((400 + (state.level - 1) * 350) * mult * 1.2) / eyeCount());
}

// Occupy new body segments with eyes and tubes (each segment once)
function occupySegments() {
  for (const s of arrays.rock) {
    const p = s.top;
    if (p.bossIndex === undefined || s.bossOccupied) continue;
    s.bossOccupied = true;
    for (const side of p.eyes || []) {
      createEye(s, side, boss.eyeTotal);
      boss.eyeTotal++;
    }
    if (p.tubes) {
      Growths.createGrowth('tube', s, 'il');
      Growths.createGrowth('tube', s, 'ir');
    }
  }
}

// Eye center relative to the segment: at an arm tip (profile point top = segment top edge) or at the bottom
// tip of the spine (bottom edge of the lowest segment). Fixed to the skeleton, no movement of its own.
function eyePosition(segment, side) {
  const g = EYE_SIZE;
  const p = segment.top;
  if (side === 'bottom') return { dx: p.inner - g / 2, dy: Rock.SEGMENT_HEIGHT - g * 0.55 };
  const direction = side === 'right' ? 1 : -1;
  const tip = p.inner + (direction * p.ib) / 2;
  return { dx: tip - g / 2 - direction * g * 0.15, dy: -g / 2 };
}

function createEye(segment, side, nr) {
  const hp = eyeHp();
  const g = EYE_SIZE;
  const position = eyePosition(segment, side);
  const eye = {
    id: newId('boss'),
    x: position.dx,
    y: segment.y + position.dy,
    size: g,
    hp,
    maxHp: hp,
    isEnemy: false,
    isBoss: true,
    bossId: BOSS_ID,
    bossType: 'eye',
    side,
    glowColor: '#ffb347',
    isIndestructible: true,
    open: false,
    phase: 'closed',
    phaseTimer: EYE_CLOSED + nr * 35, // versetzt blinzeln
    shotTimer: EYE_SHOT,
    segment,
    offsetY: position.dy,
    enragePhaseActive: false,
  };
  arrays.bosses.push(Display.create(eye, 'boss'));
}

function eyes() {
  return arrays.bosses.filter(b => b.bossId === BOSS_ID);
}

function bottomEdge() {
  const bottom = arrays.rock.find(s => s.top.bossIndex === 0);
  return bottom ? bottom.y + Rock.SEGMENT_HEIGHT : null;
}

// Once per step from updateBosses
export function update() {
  if (!boss) return;
  Rock.createSupply(Rock.hasQueue());
  occupySegments();
  const edge = bottomEdge();
  const h = config.playfieldHeight;

  if (boss.phase === 'entry' && edge !== null && edge >= h * 0.45) {
    boss.phase = 'fight';
    Rock.setSpeed(0);
  }
  const alive = eyes();
  if (boss.phase === 'fight' && boss.eyeTotal > 1 && alive.length === 1) {
    boss.phase = 'enrage';
    alive[0].enragePhaseActive = true;
    Rock.setSpeed(ENRAGE_SPEED);
    arrays.enemies.filter(f => f.pattern === 'tube').forEach(r => (r.cadence = Growths.TUBE_CADENCE_ENRAGE));
    dom.bossHpBar.style.backgroundColor = '#8e44ad';
  }
  if (boss.phase === 'enrage' && edge !== null && edge >= h * 0.72) Rock.setSpeed(0);

  // HP bar: sum of all eyes
  const all = alive.reduce((s, b) => s + b.hp, 0);
  const max = alive.reduce((s, b) => s + b.maxHp, 0) + (boss.eyeTotal - alive.length) * eyeHp();
  if (max > 0) dom.bossHpBar.style.width = Math.max(0, (all / max) * 100) + '%';

  if (boss.phase !== 'entry' && boss.eyeTotal > 0 && alive.length === 0) end();
}

// Last eye fallen (defeatBoss already ran): tubes and larvae burst, the skeleton decays into
// explosions and clears the way to the rewards
function end() {
  for (const f of arrays.enemies.slice()) {
    if (f.pattern === 'tube' || f.pattern === 'larva') Utils.destroyTarget(f);
  }
  for (let i = arrays.rock.length - 1; i >= 0; i--) {
    const s = arrays.rock[i];
    if (!s.top.bone) continue;
    if (s.y + Rock.SEGMENT_HEIGHT > 0 && s.y < config.playfieldHeight) {
      showExplosion(s.top.inner, s.y + Rock.SEGMENT_HEIGHT / 2);
    }
    Display.remove(s);
    arrays.rock.splice(i, 1);
  }
  Rock.reset();
  boss = null;
}

function showExplosion(x, y) {
  Utils.createExplosion(x, y, BONE_COLOR, 18);
  if (state.gameMode === 'online') {
    Network.sendNetworkEvent({ type: 'target_destroyed', x, y, color: BONE_COLOR, count: 18, soundType: 'small' });
  }
}

// Eye per step (from updateBosses instead of the standard boss movement)
export function updateEye(a, stunned) {
  a.y = a.segment.y + a.offsetY;
  if (!boss || boss.phase === 'entry') {
    a.open = false;
    a.isIndestructible = true;
    return;
  }
  if (stunned) return;
  const enrage = a.enragePhaseActive;
  a.phaseTimer--;
  if (a.phaseTimer <= 0) {
    a.phase = a.phase === 'closed' ? 'open' : 'closed';
    a.phaseTimer = a.phase === 'open' ? (enrage ? 140 : EYE_OPEN) : enrage ? 40 : EYE_CLOSED;
  }
  a.open = a.phase === 'open';
  a.isIndestructible = !a.open;
  if (!a.open) return;
  a.shotTimer--;
  if (a.shotTimer <= 0) {
    a.shotTimer = enrage ? 30 : EYE_SHOT;
    const target = nextPlayerMiddle(a);
    const mx = a.x + a.size / 2;
    const my = a.y + a.size;
    const w = Math.atan2(target.y - my, target.x - mx);
    for (const d of enrage ? [-0.2, 0, 0.2] : [-0.1, 0.1]) {
      Growths.createSporeClosed(mx, my, Math.cos(w + d) * SPORE_SPEED, Math.sin(w + d) * SPORE_SPEED);
    }
  }
}
