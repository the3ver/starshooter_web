import { state, config, arrays, isCoopMode } from './state.js';
import * as Entities from './entities.js';
import * as Display from './display.js';
import * as Shockwave from './shockwave.js';
import * as Growths from './growths.js';
import { nextPlayerMiddle } from './opponents.js';

// Kettengegner: Kopf und Glieder folgen derselben Bahn, Glied i mit i * gliedAbstand(...) Schritten Rueckstand.
// Die Bahn ist eine reine Funktion der Zeit (bahnPunkt), die Glieder brauchen keinen Positionsspeicher.
// Wer alle Glieder einer Kette abschiesst, bekommt ein Powerup (Kettenbonus).

export const CHAIN_LANES = ['snake', 'sCurve', 'loop', 'spiral'];
export const LINK_DISTANCE_PX = 17; // mittlerer Abstand zweier Gliedmitten: Glieder liegen aneinander
export const HEAD_SIZE = 28;
export const LINK_SIZE = 22;
export const CHAIN_BONUS_POINTS = 500;

// Mittelpunkt auf der Bahn zur Zeit t >= 0. seite = 1 oder -1 spiegelt die Bahn an der Feldmitte.
function laneRaw(lane, t, side, width) {
  const middle = width / 2;
  if (lane === 'snake') {
    return { x: middle + side * width * 0.3 * Math.sin(t * 0.04), y: -40 + 1.6 * t };
  }
  if (lane === 'sCurve') {
    // von der Seite herein, flach nach unten, mit Welle
    const x = -40 + 2.2 * t;
    return { x: side === 1 ? x : width - x, y: 60 + 0.35 * t + 70 * Math.sin(t * 0.03) };
  }
  if (lane === 'loop') {
    // y laeuft zwischendurch kurz zurueck: Schleifen
    return { x: middle + side * width * 0.3 * Math.sin(t * 0.025), y: -40 + 1.4 * t + 50 * Math.sin(t * 0.045) };
  }
  // spirale: Kreis um einen Mittelpunkt, der langsam nach unten wandert
  const r = Math.min(width * 0.3, 90);
  const a = t * 0.05 * side;
  return { x: middle + r * Math.sin(a), y: -40 + t + r * (1 - Math.cos(a)) };
}

// Vor dem Start (t < 0) liegt der Punkt auf der Verlaengerung der Anfangsrichtung, also ausserhalb des Felds.
export function lanePoint(lane, t, side = 1, width = config.playfieldWidth) {
  if (t >= 0) return laneRaw(lane, t, side, width);
  const p0 = laneRaw(lane, 0, side, width);
  const p1 = laneRaw(lane, 1, side, width);
  return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
}

// Position aus der Bahn, Drehung aus der Flugrichtung (Vorwaerts der Grafik = unten)
// Schritte zwischen zwei Gliedern: GLIED_ABSTAND_PX geteilt durch das mittlere Tempo der Bahn (erste 300 Schritte)
export function linkDistance(lane, side = 1, width = config.playfieldWidth) {
  let gone = 0;
  let beforeEntry = laneRaw(lane, 0, side, width);
  for (let t = 1; t <= 300; t++) {
    const p = laneRaw(lane, t, side, width);
    gone += Math.hypot(p.x - beforeEntry.x, p.y - beforeEntry.y);
    beforeEntry = p;
  }
  return Math.max(3, Math.round(LINK_DISTANCE_PX / (gone / 300)));
}

function setOnLane(f) {
  const p = lanePoint(f.chainLane, f.chainT, f.chainSide);
  const beforeEntry = lanePoint(f.chainLane, f.chainT - 1, f.chainSide);
  f.x = p.x - f.size / 2;
  f.y = p.y - f.size / 2;
  f.rot = (Math.atan2(p.y - beforeEntry.y, p.x - beforeEntry.x) * 180) / Math.PI - 90;
}

// Muster, die als Kettenglieder auf einer gemeinsamen Bahn laufen
// kette: Kopf schiesst; stachelkette: Hindernis (zaeh, langsam, schiesst nicht); kugelkette: jedes dritte
// Glied traegt eine Blase (groesse POD_GROESSE) und schiesst gezielte Kugeln
export const CHAIN_PATTERN = ['chain', 'spikeChain', 'ballChain'];
export const POD_SIZE = 24;
export const BALL_CADENCE = 150;
const CHAIN_KIND = {
  chain: { speed: 1, headHp: 32, linkHp: 16 },
  spikeChain: { speed: 0.7, headHp: 40, linkHp: 30 },
  ballChain: { speed: 0.9, headHp: 32, linkHp: 16 },
};

export function isChainLink(f) {
  return CHAIN_PATTERN.includes(f.pattern);
}

// Erzeugt eine Kette mit anzahl Gliedern (Index 0 = Kopf). Nur der Kopf schiesst.
export function createChain(lane = 'snake', count = 8, side = 1, pattern = 'chain') {
  const chain = { total: count, shotDown: 0 };
  const hpMult = isCoopMode() ? 1.25 : 1.0;
  const shotBasis = Math.max(25, 60 - (state.level - 1) * 8);
  const distance = linkDistance(lane, side);
  const kind = CHAIN_KIND[pattern];
  for (let i = 0; i < count; i++) {
    const head = i === 0;
    const pod = pattern === 'ballChain' && i % 3 === 2;
    const size = head ? HEAD_SIZE : pod ? POD_SIZE : LINK_SIZE;
    const hp = Math.round((head ? kind.headHp : kind.linkHp) * hpMult);
    const f = {
      id: Entities.newId('f'),
      x: 0,
      y: 0,
      size,
      hp,
      maxHp: hp,
      shieldHp: 0,
      maxShieldHp: 0,
      hasShield: false,
      color: Entities.getEnemyColor(pattern),
      explosionsColor: Entities.getEnemyColor(pattern),
      vy: 0,
      vx: 0,
      time: 0,
      shotTimer: head && pattern === 'chain' ? shotBasis * 2 : 9999,
      burstCount: 0,
      burstTimer: 0,
      isEnemy: true,
      isIndestructible: false,
      carriesPowerup: false,
      pattern,
      phase: 'flight',
      chain,
      chainIndex: i,
      chainLane: lane,
      chainSide: side,
      chainT: -i * distance,
      chainSpeed: kind.speed,
      ...(pod ? { ballTimer: 60 + i * 15 } : {}),
    };
    setOnLane(f);
    arrays.enemies.push(Display.create(f, 'enemy'));
  }
  return chain;
}

export function moveLink(f) {
  f.chainT += f.chainSpeed ?? 1;
  setOnLane(f);
  if (f.ballTimer === undefined || f.chainT <= 0 || f.y < 0) return;
  f.ballTimer--;
  if (f.ballTimer > 0) return;
  f.ballTimer = BALL_CADENCE;
  const mx = f.x + f.size / 2;
  const my = f.y + f.size / 2;
  const target = nextPlayerMiddle(f);
  const w = Math.atan2(target.y - my, target.x - mx);
  Growths.createSporeClosed(mx, my, Math.cos(w) * 2.4, Math.sin(w) * 2.4);
}

// Glieder, die noch auf ihren Start warten, liegen ausserhalb des Felds und bleiben erhalten.
export function waitsForStart(f) {
  return isChainLink(f) && f.chainT < 0;
}

// Aus zerstoereZiel: zaehlt Abschuesse; das letzte Glied einer vollstaendig abgeschossenen Kette
// laesst ein Powerup fallen und gibt Bonuspunkte. Liefert true beim Kettenbonus.
export function linkShotDown(f) {
  if (!f.chain) return false;
  f.chain.shotDown++;
  if (f.chain.shotDown < f.chain.total) return false;
  Entities.createPowerup(f.x + f.size / 2 - 12, f.y + f.size / 2 - 12, Shockwave.bonusType());
  return true;
}

// Zufaellige Kette fuer verwalteFeindSpawns: Bahn, Laenge (6-10) und Seite aus Math.random
export function createRandomChain() {
  const lane = CHAIN_LANES[Math.floor(Math.random() * CHAIN_LANES.length)];
  const count = 6 + Math.floor(Math.random() * 5);
  const side = Math.random() < 0.5 ? 1 : -1;
  return createChain(lane, count, side);
}
