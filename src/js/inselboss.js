import { state, dom, config, arrays, isCoopMode } from './state.js';
import * as Anzeige from './anzeige.js';
import * as Fels from './fels.js';
import * as Gewaechse from './gewaechse.js';
import * as Utils from './utils.js';
import { neueId } from './entities.js';
import { naechsterSpielerMitte } from './gegner.js';

// Insel-Boss (Fels-Level): Der Koerper ist eine grosse Felsinsel aus Segmenten (fels.js: Kollision, Rueckstoss,
// Zeichnen, Online-Sync). Sie scrollt herein und bleibt stehen. Trefferzonen sind die Augen (arrays.bosses,
// bossTyp 'auge', gemeinsame bossId): sie blinzeln, sind nur offen verwundbar und schiessen gezielt Sporen.
// Roehren an den Inselflanken (Gewaechs 'roehre') werfen Larven aus. Faellt das vorletzte Auge, rueckt der
// Koerper langsam vor (Enrage). Der Boss ist besiegt, wenn das letzte Auge faellt (zerstoereZiel -> besiegeBoss).

export const BOSS_ID = 'insel';
export const EINZUG_TEMPO = 1.8;
export const ENRAGE_TEMPO = 0.12;
export const AUGE_GROESSE = 36;
export const AUGE_OFFEN = 110;
export const AUGE_ZU = 70;
export const AUGE_SCHUSS = 45;
export const SPOREN_TEMPO = 3;

// Inselbreite je Profilpunkt (von unten nach oben) als Anteil der Hoechstbreite
const FORM = [0.2, 0.5, 0.75, 0.92, 1, 1, 1, 0.95, 0.8, 0.6, 0.4, 0.15];
// Augen: [Profilpunkt, x-Versatz als Anteil der halben Inselbreite]; im Coop ein viertes
const AUGEN = [
  [2, -0.45],
  [4, 0.45],
  [6, 0],
];
const AUGE_COOP = [3, 0.05];
const ROEHREN = [3, 7]; // Profilpunkte mit Roehren an beiden Flanken

let boss = null; // { phase: 'einzug' | 'kampf' | 'enrage' | 'abzug', augenGesamt }

export function setzeZurueck() {
  boss = null;
}

export function istAktiv() {
  return !!boss;
}

export function phase() {
  return boss ? boss.phase : null;
}

function maxBreite() {
  const b = config.spielfeldBreite;
  return Math.min(b * 0.7, b - 2 * Fels.MIN_DURCHGANG);
}

// Profilpunkte des Koerpers mit Markierungen fuer Augen und Roehren
export function koerperProfil() {
  const b = config.spielfeldBreite;
  const augen = isCoopMode() ? [...AUGEN, AUGE_COOP] : AUGEN;
  return FORM.map((anteil, i) => ({
    l: 0,
    r: 0,
    im: b / 2,
    ib: maxBreite() * anteil,
    bossIndex: i,
    augen: augen.filter(([p]) => p === i).map(([, dx]) => dx),
    roehren: ROEHREN.includes(i),
  }));
}

// Nach der Boss-Warnung (Level.starteBoss)
export function erzeuge() {
  boss = { phase: 'einzug', augenGesamt: 0 };
  state.bossAktiv = true;
  dom.bossHpContainer.style.display = 'block';
  dom.bossHpBalken.style.width = '100%';
  dom.bossHpBalken.style.backgroundColor = '#e67e22';
  Fels.setzeTempo(EINZUG_TEMPO);
  Fels.reiheEin(koerperProfil());
}

function augenHp() {
  const mult = isCoopMode() ? 1.4 : 1.0;
  const augen = isCoopMode() ? AUGEN.length + 1 : AUGEN.length;
  return Math.round(((400 + (state.level - 1) * 350) * mult * 1.2) / augen);
}

// Neue Koerpersegmente mit Augen und Roehren besetzen (jedes Segment einmal)
function besetzeSegmente() {
  for (const s of arrays.fels) {
    const p = s.oben;
    if (p.bossIndex === undefined || s.bossBesetzt) continue;
    s.bossBesetzt = true;
    p.augen.forEach((dx, k) => erzeugeAuge(s, dx, boss.augenGesamt + k));
    boss.augenGesamt += p.augen.length;
    if (p.roehren) {
      Gewaechse.erzeugeGewaechs('roehre', s, 'il');
      Gewaechse.erzeugeGewaechs('roehre', s, 'ir');
    }
  }
}

function erzeugeAuge(segment, dx, nr) {
  const hp = augenHp();
  const g = AUGE_GROESSE;
  const auge = {
    id: neueId('boss'),
    x: segment.oben.im + (dx * segment.oben.ib) / 2 - g / 2,
    y: segment.y + (Fels.SEGMENT_HOEHE - g) / 2,
    groesse: g,
    hp,
    maxHp: hp,
    istFeind: false,
    istBoss: true,
    bossId: BOSS_ID,
    bossTyp: 'auge',
    leuchtFarbe: '#ffb347',
    istUnzerstoerbar: true,
    offen: false,
    phase: 'zu',
    phaseTimer: AUGE_ZU + nr * 35, // versetzt blinzeln
    schussTimer: AUGE_SCHUSS,
    segment,
    versatzY: (Fels.SEGMENT_HOEHE - g) / 2,
    enragePhaseAktiv: false,
  };
  arrays.bosses.push(Anzeige.erzeuge(auge, 'boss'));
}

function augen() {
  return arrays.bosses.filter(b => b.bossId === BOSS_ID);
}

function unterkante() {
  const unten = arrays.fels.find(s => s.oben.bossIndex === 0);
  return unten ? unten.y + Fels.SEGMENT_HOEHE : null;
}

// Einmal je Schritt aus aktualisiereBosse
export function aktualisiere() {
  if (!boss) return;
  Fels.erzeugeNachschub(Fels.hatWarteschlange());
  besetzeSegmente();
  const kante = unterkante();
  const h = config.spielfeldHoehe;

  if (boss.phase === 'einzug' && kante !== null && kante >= h * 0.45) {
    boss.phase = 'kampf';
    Fels.setzeTempo(0);
  }
  const lebend = augen();
  if (boss.phase === 'kampf' && boss.augenGesamt > 1 && lebend.length === 1) {
    boss.phase = 'enrage';
    lebend[0].enragePhaseAktiv = true;
    Fels.setzeTempo(ENRAGE_TEMPO);
    arrays.feinde.filter(f => f.muster === 'roehre').forEach(r => (r.takt = Gewaechse.ROEHRE_TAKT_ENRAGE));
    dom.bossHpBalken.style.backgroundColor = '#8e44ad';
  }
  if (boss.phase === 'enrage' && kante !== null && kante >= h * 0.72) Fels.setzeTempo(0);

  // HP-Balken: Summe aller Augen
  const alle = lebend.reduce((s, b) => s + b.hp, 0);
  const max = lebend.reduce((s, b) => s + b.maxHp, 0) + (boss.augenGesamt - lebend.length) * augenHp();
  if (max > 0) dom.bossHpBalken.style.width = Math.max(0, (alle / max) * 100) + '%';

  if (boss.phase !== 'einzug' && boss.augenGesamt > 0 && lebend.length === 0) beende();
}

// Letztes Auge gefallen (besiegeBoss lief schon): Roehren und Larven platzen, der Koerper scrollt hinaus
function beende() {
  for (const f of arrays.feinde.slice()) {
    if (f.muster === 'roehre' || f.muster === 'larve') Utils.zerstoereZiel(f);
  }
  Fels.setzeTempo(Fels.FELS_TEMPO);
  boss = null;
}

// Auge je Schritt (aus aktualisiereBosse statt der Standard-Bossbewegung)
export function aktualisiereAuge(a, betaeubt) {
  a.y = a.segment.y + a.versatzY;
  if (!boss || boss.phase === 'einzug') {
    a.offen = false;
    a.istUnzerstoerbar = true;
    return;
  }
  if (betaeubt) return;
  const enrage = a.enragePhaseAktiv;
  a.phaseTimer--;
  if (a.phaseTimer <= 0) {
    a.phase = a.phase === 'zu' ? 'offen' : 'zu';
    a.phaseTimer = a.phase === 'offen' ? (enrage ? 140 : AUGE_OFFEN) : enrage ? 40 : AUGE_ZU;
  }
  a.offen = a.phase === 'offen';
  a.istUnzerstoerbar = !a.offen;
  if (!a.offen) return;
  a.schussTimer--;
  if (a.schussTimer <= 0) {
    a.schussTimer = enrage ? 30 : AUGE_SCHUSS;
    const ziel = naechsterSpielerMitte(a);
    const mx = a.x + a.groesse / 2;
    const my = a.y + a.groesse;
    const w = Math.atan2(ziel.y - my, ziel.x - mx);
    for (const d of enrage ? [-0.2, 0, 0.2] : [-0.1, 0.1]) {
      Gewaechse.erzeugeSporeZu(mx, my, Math.cos(w + d) * SPOREN_TEMPO, Math.sin(w + d) * SPOREN_TEMPO);
    }
  }
}
