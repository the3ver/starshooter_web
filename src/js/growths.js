import { state, config, arrays, isCoopMode } from './state.js';
import * as Audio from './audio.js';
import * as Display from './display.js';
import * as Rock from './rock.js';
import { newId } from './entities.js';
import { nextPlayerMiddle } from './opponents.js';

// Gewaechse an Felswaenden und Inseln (Fels-Level). Sie sind Feinde (arrays.feinde), damit alle Waffen, die
// Schockwelle, Punkte und der Bot sie wie Gegner behandeln, und haengen an einem Felssegment:
// - bluete: Tentakelbluete, abwechselnd zu (gepanzert: istUnzerstoerbar, Laser prallen ab, die Bombe knackt sie)
//   und offen (verwundbar, schiesst SPOREN_JE_OEFFNUNG Sporen quer in den Gang)
// - trichter: Hornroehre, immer verwundbar, schiesst in festem Takt einzelne Sporen
// - kapsel: Eierkapsel, schiesst nicht, laesst beim Abschuss einen Bonus fallen (Schockwelle oder Zufall)
// Sporen sind Feindgeschosse (arrays.feindLaserArray) mit spore = true: langsam, rund, quer zum Gang.

// roehre: Larvenroehre am Insel-Boss (wirft alle takt Schritte eine Larve aus, hoechstens MAX_LARVEN)
// larve: kleiner Verfolger aus der Roehre (kein Gewaechs, haengt an keinem Segment)
export const KINDS = ['bloom', 'funnel', 'capsule', 'tube'];
export const SIZE = { bloom: 34, funnel: 30, capsule: 24, tube: 34, larva: 18 };
export const COLOR = { bloom: '#e0703a', funnel: '#d9822b', capsule: '#b5a36a', tube: '#c0602a', larva: '#e8b04a' };
export const TUBE_CADENCE = 150;
export const TUBE_CADENCE_ENRAGE = 90;
export const MAX_LARVAE = 8;
export const LARVA_SPEED = 1.4;
export const TOO_DURATION = 100;
export const OPEN_DURATION = 80;
export const SPORE_PER_OPENING = 3;
export const FUNNEL_CADENCE = 110;
export const SPORE_SPEED = 2.6;
export const SPORE_SIZE = 10;
const MIN_SPOT = 26; // Wand- oder Inselbreite, an der ein Gewaechs Halt findet

export function isGrowth(f) {
  return KINDS.includes(f.pattern);
}

// Moegliche Plaetze an einem Segment (Profil oben): Wand links/rechts, Insel links/rechts
function spots(segment) {
  const p = segment.top;
  const list = [];
  if (p.l >= MIN_SPOT) list.push('l');
  if (p.r >= MIN_SPOT) list.push('r');
  if (p.ib >= MIN_SPOT) list.push('il', 'ir');
  return list;
}

// Blickrichtung in den Gang: +1 = nach rechts, -1 = nach links
function direction(side) {
  return side === 'l' || side === 'ir' ? 1 : -1;
}

// Position an der Felskante auf Hoehe der Gewaechsmitte; ein Drittel steckt im Fels.
// rot: Grafik-Vorwaerts ist unten, -90 = Blick nach rechts, 90 = nach links
function setAnEdge(f) {
  const g = f.size;
  f.y = f.segment.y + f.offsetY;
  const p = Rock.profileAt(f.y + g / 2) || f.segment.top;
  const b = config.playfieldWidth;
  const edge = { l: p.l, r: b - p.r, il: p.inner - p.ib / 2, ir: p.inner + p.ib / 2 }[f.side];
  f.x = f.direction === 1 ? edge - g * 0.3 : edge - g * 0.7;
  f.rot = f.direction === 1 ? -90 : 90;
}

// Ein Gewaechs an einem Segment anlegen; liefert null, wenn dort kein Platz ist
export function createGrowth(kind, segment, side = null) {
  const possible = spots(segment);
  if (!possible.length) return null;
  const spot = side && possible.includes(side) ? side : possible[Math.floor(Math.random() * possible.length)];
  const hpMult = isCoopMode() ? 1.25 : 1.0;
  const hp = Math.round({ bloom: 40, funnel: 30, capsule: 20, tube: 60 }[kind] * hpMult);
  const f = {
    id: newId('f'),
    x: 0,
    y: 0,
    size: SIZE[kind],
    hp,
    maxHp: hp,
    shieldHp: 0,
    maxShieldHp: 0,
    hasShield: false,
    color: COLOR[kind],
    explosionsColor: COLOR[kind],
    vy: 0,
    vx: 0,
    time: 0,
    shotTimer: 9999,
    burstCount: 0,
    burstTimer: 0,
    isEnemy: true,
    isIndestructible: kind === 'bloom',
    carriesPowerup: kind === 'capsule',
    powerupTyp: kind === 'capsule' ? 'bonus' : undefined,
    pattern: kind,
    phase: kind === 'bloom' ? 'closed' : 'open',
    open: kind !== 'bloom',
    phaseTimer: kind === 'bloom' ? TOO_DURATION : Math.floor(Math.random() * FUNNEL_CADENCE),
    cadence: kind === 'tube' ? TUBE_CADENCE : FUNNEL_CADENCE,
    segment,
    side: spot,
    direction: direction(spot),
    offsetY: (Rock.SEGMENT_HEIGHT - SIZE[kind]) / 2,
  };
  setAnEdge(f);
  arrays.enemies.push(Display.create(f, 'enemy'));
  return f;
}

// Spore mit Mittelpunkt (mx, my) und Geschwindigkeit (vx, vy)
export function createSporeClosed(mx, my, vx, vy) {
  Audio.playSpore();
  arrays.enemyLaserArray.push(
    Display.create(
      {
        id: newId('fl'),
        x: mx - SPORE_SIZE / 2,
        y: my - SPORE_SIZE / 2,
        vx,
        vy,
        width: SPORE_SIZE,
        height: SPORE_SIZE,
        spore: true,
      },
      'enemyLaser',
    ),
  );
}

// Spore quer aus dem Schlund eines Gewaechses in den Gang
export function createSpore(f) {
  const g = f.size;
  createSporeClosed(f.x + g / 2 + f.direction * (g / 2), f.y + g / 2, f.direction * SPORE_SPEED, Rock.getSpeed() * 0.5);
}

function createLarva(f) {
  const g = SIZE.larva;
  const hp = Math.round(10 * (isCoopMode() ? 1.25 : 1));
  arrays.enemies.push(
    Display.create(
      {
        id: newId('f'),
        x: f.x + f.size / 2 + f.direction * f.size * 0.5 - g / 2,
        y: f.y + f.size / 2 - g / 2,
        size: g,
        hp,
        maxHp: hp,
        shieldHp: 0,
        maxShieldHp: 0,
        hasShield: false,
        color: COLOR.larva,
        explosionsColor: COLOR.larva,
        vx: 0,
        vy: 0,
        time: 0,
        shotTimer: 9999,
        burstCount: 0,
        burstTimer: 0,
        isEnemy: true,
        isIndestructible: false,
        carriesPowerup: false,
        pattern: 'larva',
        phase: 'flight',
      },
      'enemy',
    ),
  );
}

// Larve: kriecht auf den naechsten Spieler zu und wackelt dabei
export function moveLarva(f) {
  f.shotTimer = 9999;
  f.time += 0.15;
  const target = nextPlayerMiddle(f);
  const dx = target.x - (f.x + f.size / 2);
  const dy = target.y - (f.y + f.size / 2);
  const d = Math.hypot(dx, dy) || 1;
  f.x += (dx / d) * LARVA_SPEED + Math.sin(f.time) * 0.6;
  f.y += (dy / d) * LARVA_SPEED;
  f.rot = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
}

// Jeder Schritt aus aktualisiereFeinde: an der Kante halten, Phasen und Sporen
export function update(f) {
  setAnEdge(f);
  f.shotTimer = 9999; // kein Standard-Schuss nach unten
  if (f.pattern === 'capsule') return;
  if (f.y + f.size < 0) return; // noch ueber dem Feld
  f.phaseTimer--;
  if (f.pattern === 'funnel') {
    if (f.phaseTimer <= 0) {
      createSpore(f);
      f.phaseTimer = f.cadence;
    }
    return;
  }
  if (f.pattern === 'tube') {
    if (f.phaseTimer <= 0) {
      if (arrays.enemies.filter(l => l.pattern === 'larva').length < MAX_LARVAE) createLarva(f);
      f.phaseTimer = f.cadence;
    }
    return;
  }
  // bluete
  if (f.phase === 'open') {
    const distance = Math.floor(OPEN_DURATION / (SPORE_PER_OPENING + 1));
    if (f.phaseTimer > 0 && f.phaseTimer % distance === 0 && f.phaseTimer < OPEN_DURATION) createSpore(f);
  }
  if (f.phaseTimer <= 0) {
    f.phase = f.phase === 'closed' ? 'open' : 'closed';
    f.phaseTimer = f.phase === 'closed' ? TOO_DURATION : OPEN_DURATION;
  }
  f.open = f.phase === 'open';
  f.isIndestructible = !f.open;
}

// Aus levelSchritt (Fels-Level, waehrend Nachschub): alle GEWAECHS_TAKT Schritte ein Gewaechs am obersten
// Segment, Art nach Gewicht (Bluete 50 %, Trichter 30 %, Kapsel 20 %)
export const GROWTH_CADENCE = 150;
export function regrow(frame) {
  const cadence = Math.max(80, GROWTH_CADENCE - (state.level - 4) * 10);
  if (frame % cadence !== 0 || !arrays.rock.length) return null;
  const topmost = arrays.rock.reduce((a, s) => (s.y < a.y ? s : a));
  const r = Math.random();
  const kind = r < 0.5 ? 'bloom' : r < 0.8 ? 'funnel' : 'capsule';
  return createGrowth(kind, topmost);
}
