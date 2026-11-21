import { state, dom, config, arrays, isCoopMode } from './state.js';
import * as Display from './anzeige.js';
import * as Rock from './fels.js';
import * as Growths from './gewaechse.js';
import * as Utils from './utils.js';
import * as Network from './network.js';
import { newId } from './entities.js';
import { nextPlayerMiddle } from './gegner.js';

// Insel-Boss (Fels-Level): Der Koerper ist eine grosse Felsinsel aus Segmenten (fels.js: Kollision, Rueckstoss,
// Zeichnen, Online-Sync). Sie scrollt herein und bleibt stehen. Trefferzonen sind die Augen (arrays.bosses,
// bossTyp 'auge', gemeinsame bossId): sie blinzeln, sind nur offen verwundbar und schiessen gezielt Sporen.
// Roehren an den Inselflanken (Gewaechs 'roehre') werfen Larven aus. Faellt das vorletzte Auge, rueckt der
// Koerper langsam vor (Enrage). Der Boss ist besiegt, wenn das letzte Auge faellt (zerstoereZiel -> besiegeBoss).

export const BOSS_ID = 'island';
export const ENTRY_SPEED = 1.8;
export const ENRAGE_SPEED = 0.12;
export const EYE_SIZE = 36;
export const EYE_OPEN = 110;
export const EYE_CLOSED = 70;
export const EYE_SHOT = 45;
export const SPORE_SPEED = 3;
export const BONE_COLOR = '#e8dcb8';

// Skelett von unten nach oben, spiegelsymmetrisch zur senkrechten Mittelachse: Wirbelsaeule (Breite in
// Wirbelbreiten) und Armpaare (arme: Reichweite beider Arme als Anteil der Hoechstbreite). Ein Armpaar ist ein
// Profilpunkt, an dem die Insel beidseitig bis zu den Armspitzen reicht; die Nachbarpunkte sind Wirbel, so
// entstehen spitze Knochenfortsaetze. Augen sitzen an der unteren Spitze und an den Spitzen des ersten Armpaars,
// im Coop zusaetzlich am zweiten Armpaar.
// Alle Teile liegen in den unteren sieben Wirbeln: im Kampf steht der Koerper, darueber entstehen keine Segmente.
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

let boss = null; // { phase: 'einzug' | 'kampf' | 'enrage' | 'abzug', augenGesamt }

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

// Profilpunkte des Koerpers mit Markierungen (knochen, bossIndex, augen, roehren); Insel immer mittig
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

// Nach der Boss-Warnung (Level.starteBoss)
export function create() {
  boss = { phase: 'einzug', eyeTotal: 0 };
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

// Neue Koerpersegmente mit Augen und Roehren besetzen (jedes Segment einmal)
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

// Augenmitte relativ zum Segment: an einer Armspitze (Profilpunkt oben = Segmentoberkante) oder an der unteren
// Spitze der Wirbelsaeule (Unterkante des untersten Segments). Fest am Skelett, keine eigene Bewegung.
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
    bossTyp: 'eye',
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

// Einmal je Schritt aus aktualisiereBosse
export function update() {
  if (!boss) return;
  Rock.createSupply(Rock.hasQueue());
  occupySegments();
  const edge = bottomEdge();
  const h = config.playfieldHeight;

  if (boss.phase === 'einzug' && edge !== null && edge >= h * 0.45) {
    boss.phase = 'kampf';
    Rock.setSpeed(0);
  }
  const alive = eyes();
  if (boss.phase === 'kampf' && boss.eyeTotal > 1 && alive.length === 1) {
    boss.phase = 'enrage';
    alive[0].enragePhaseActive = true;
    Rock.setSpeed(ENRAGE_SPEED);
    arrays.enemies.filter(f => f.pattern === 'tube').forEach(r => (r.cadence = Growths.TUBE_CADENCE_ENRAGE));
    dom.bossHpBar.style.backgroundColor = '#8e44ad';
  }
  if (boss.phase === 'enrage' && edge !== null && edge >= h * 0.72) Rock.setSpeed(0);

  // HP-Balken: Summe aller Augen
  const all = alive.reduce((s, b) => s + b.hp, 0);
  const max = alive.reduce((s, b) => s + b.maxHp, 0) + (boss.eyeTotal - alive.length) * eyeHp();
  if (max > 0) dom.bossHpBar.style.width = Math.max(0, (all / max) * 100) + '%';

  if (boss.phase !== 'einzug' && boss.eyeTotal > 0 && alive.length === 0) end();
}

// Letztes Auge gefallen (besiegeBoss lief schon): Roehren und Larven platzen, das Skelett zerfaellt in
// Explosionen und gibt den Weg zu den Belohnungen frei
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

// Auge je Schritt (aus aktualisiereBosse statt der Standard-Bossbewegung)
export function updateEye(a, stunned) {
  a.y = a.segment.y + a.offsetY;
  if (!boss || boss.phase === 'einzug') {
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
