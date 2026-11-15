import { state, dom, config, arrays, isCoopMode } from './state.js';
import * as Anzeige from './anzeige.js';
import * as Fels from './fels.js';
import * as Gewaechse from './gewaechse.js';
import * as Utils from './utils.js';
import * as Network from './network.js';
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
export const KNOCHEN_FARBE = '#e8dcb8';

// Skelett von unten nach oben, spiegelsymmetrisch zur senkrechten Mittelachse: Wirbelsaeule (Breite in
// Wirbelbreiten) und Armpaare (arme: Reichweite beider Arme als Anteil der Hoechstbreite). Ein Armpaar ist ein
// Profilpunkt, an dem die Insel beidseitig bis zu den Armspitzen reicht; die Nachbarpunkte sind Wirbel, so
// entstehen spitze Knochenfortsaetze. Augen sitzen an der unteren Spitze und an den Spitzen des ersten Armpaars,
// im Coop zusaetzlich am zweiten Armpaar.
// Alle Teile liegen in den unteren sieben Wirbeln: im Kampf steht der Koerper, darueber entstehen keine Segmente.
const SKELETT = [
  { wirbel: 0.6, augen: ['unten'] },
  { wirbel: 1.1, roehren: true },
  { arme: 1, augen: ['links', 'rechts'] },
  { arme: 0.55 },
  { wirbel: 1.25, roehren: true },
  { arme: 0.8, coopAugen: ['links', 'rechts'] },
  { arme: 0.45 },
  { wirbel: 1.1 },
  { wirbel: 1.2 },
  { wirbel: 1.5 },
  { wirbel: 0.8 },
];

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

function wirbelBreite() {
  return Math.max(60, maxBreite() * 0.28);
}

// Profilpunkte des Koerpers mit Markierungen (knochen, bossIndex, augen, roehren); Insel immer mittig
export function koerperProfil() {
  const c = config.spielfeldBreite / 2;
  return SKELETT.map((k, i) => ({
    l: 0,
    r: 0,
    im: c,
    ib: k.arme ? maxBreite() * k.arme : wirbelBreite() * k.wirbel,
    knochen: true,
    bossIndex: i,
    augen: [...(k.augen || []), ...(isCoopMode() ? k.coopAugen || [] : [])],
    roehren: !!k.roehren,
  }));
}

export function augenAnzahl() {
  return koerperProfil().reduce((n, p) => n + p.augen.length, 0);
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
  return Math.round(((400 + (state.level - 1) * 350) * mult * 1.2) / augenAnzahl());
}

// Neue Koerpersegmente mit Augen und Roehren besetzen (jedes Segment einmal)
function besetzeSegmente() {
  for (const s of arrays.fels) {
    const p = s.oben;
    if (p.bossIndex === undefined || s.bossBesetzt) continue;
    s.bossBesetzt = true;
    for (const seite of p.augen || []) {
      erzeugeAuge(s, seite, boss.augenGesamt);
      boss.augenGesamt++;
    }
    if (p.roehren) {
      Gewaechse.erzeugeGewaechs('roehre', s, 'il');
      Gewaechse.erzeugeGewaechs('roehre', s, 'ir');
    }
  }
}

// Augenmitte relativ zum Segment: an einer Armspitze (Profilpunkt oben = Segmentoberkante) oder an der unteren
// Spitze der Wirbelsaeule (Unterkante des untersten Segments). Fest am Skelett, keine eigene Bewegung.
function augenLage(segment, seite) {
  const g = AUGE_GROESSE;
  const p = segment.oben;
  if (seite === 'unten') return { dx: p.im - g / 2, dy: Fels.SEGMENT_HOEHE - g * 0.55 };
  const richtung = seite === 'rechts' ? 1 : -1;
  const spitze = p.im + (richtung * p.ib) / 2;
  return { dx: spitze - g / 2 - richtung * g * 0.15, dy: -g / 2 };
}

function erzeugeAuge(segment, seite, nr) {
  const hp = augenHp();
  const g = AUGE_GROESSE;
  const lage = augenLage(segment, seite);
  const auge = {
    id: neueId('boss'),
    x: lage.dx,
    y: segment.y + lage.dy,
    groesse: g,
    hp,
    maxHp: hp,
    istFeind: false,
    istBoss: true,
    bossId: BOSS_ID,
    bossTyp: 'auge',
    seite,
    leuchtFarbe: '#ffb347',
    istUnzerstoerbar: true,
    offen: false,
    phase: 'zu',
    phaseTimer: AUGE_ZU + nr * 35, // versetzt blinzeln
    schussTimer: AUGE_SCHUSS,
    segment,
    versatzY: lage.dy,
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

// Letztes Auge gefallen (besiegeBoss lief schon): Roehren und Larven platzen, das Skelett zerfaellt in
// Explosionen und gibt den Weg zu den Belohnungen frei
function beende() {
  for (const f of arrays.feinde.slice()) {
    if (f.muster === 'roehre' || f.muster === 'larve') Utils.zerstoereZiel(f);
  }
  for (let i = arrays.fels.length - 1; i >= 0; i--) {
    const s = arrays.fels[i];
    if (!s.oben.knochen) continue;
    if (s.y + Fels.SEGMENT_HOEHE > 0 && s.y < config.spielfeldHoehe) {
      zeigeExplosion(s.oben.im, s.y + Fels.SEGMENT_HOEHE / 2);
    }
    Anzeige.entferne(s);
    arrays.fels.splice(i, 1);
  }
  Fels.setzeZurueck();
  boss = null;
}

function zeigeExplosion(x, y) {
  Utils.erzeugeExplosion(x, y, KNOCHEN_FARBE, 18);
  if (state.gameMode === 'online') {
    Network.sendNetworkEvent({ type: 'target_destroyed', x, y, farbe: KNOCHEN_FARBE, anzahl: 18, soundType: 'small' });
  }
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
