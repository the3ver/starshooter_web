import { config, arrays, isCoopMode } from './state.js';
import * as Anzeige from './anzeige.js';
import * as Fels from './fels.js';
import * as Kette from './kette.js';
import * as Gewaechse from './gewaechse.js';
import { neueId, getFeindColor } from './entities.js';
import { naechsterSpielerMitte } from './gegner.js';

// Organische Einzelwesen und Gegnermix der Fels-Level (Biozone). Statt klassischer Jaeger kommen hier Ketten
// (Kopfschuetze, Stachelkette als Hindernis, Kugelkette) und Einzelwesen:
// - krabbe: Stielaugen und Scheren. Gibt es eine Felswand, krabbelt sie zuerst an deren Kante entlang (Blick in
//   den Gang, Phase 'wand') und springt dann in den Gang ('sprung'); sonst fliegt sie von oben an ('anflug').
//   Danach krabbelt sie seitlich im freien Gang hin und her, schiesst gezielte Kugelpaare und zieht nach
//   KRABBE_DAUER nach unten ab
// - tentakler: Quallenschirm mit Tentakeln, schwebt pendelnd herab und stoesst Kugelringe aus
// Kugeln sind Sporen (Feindgeschosse mit spore = true).

export const WESEN = ['krabbe', 'tentakler'];
export const GROESSE = { krabbe: 34, tentakler: 30 };
export const KRABBE_SCHUSS = 100;
export const KRABBE_DAUER = 600;
export const WAND_MIN = 22; // Wandbreite, an der eine Krabbe entlanglaufen kann
export const WAND_TEMPO = 0.8; // Laufen an der Kante, zusaetzlich zum Felstempo
export const SPRUNG_DAUER = 24;
export const TENTAKLER_SCHUSS = 140;
export const TENTAKLER_RING = 6;
export const KUGEL_TEMPO = 2.4;

// Gewichte des Bio-Spawners (Summe 1)
/** @type {Array<[string, number]>} */
export const BIO_MIX = [
  ['kette', 0.2],
  ['stachelkette', 0.2],
  ['kugelkette', 0.2],
  ['krabbe', 0.25],
  ['tentakler', 0.15],
];

export function istWesen(f) {
  return WESEN.includes(f.muster);
}

function grundWerte(muster, x, y, hp) {
  const h = Math.round(hp * (isCoopMode() ? 1.25 : 1));
  return {
    id: neueId('f'),
    x,
    y,
    groesse: GROESSE[muster],
    hp: h,
    maxHp: h,
    schildHp: 0,
    maxSchildHp: 0,
    hatSchild: false,
    farbe: getFeindColor(muster),
    explosionsFarbe: getFeindColor(muster),
    vx: 0,
    vy: 0,
    zeit: 0,
    schussTimer: 9999,
    burstCount: 0,
    burstTimer: 0,
    istFeind: true,
    istUnzerstoerbar: false,
    traegtPowerup: Math.random() < 0.15,
    muster,
  };
}

// Freier Bereich auf Hoehe y (ohne Fels: ganzes Feld)
function freiBei(y, x) {
  return Fels.freierBereich(y, x);
}

function startX(g) {
  const b = config.spielfeldBreite;
  const x = 20 + Math.random() * (b - 40 - g);
  const frei = freiBei(0, x + g / 2);
  return Math.max(frei.links + 4, Math.min(frei.rechts - g - 4, x));
}

// Wand mit Platz an der Oberkante: 'l', 'r' oder null (breitere Seite zuerst)
function wandOben() {
  const p = Fels.profilBei(10);
  if (!p) return null;
  const seiten = [
    ['l', p.l],
    ['r', p.r],
  ].filter(([, w]) => w >= WAND_MIN);
  if (!seiten.length) return null;
  seiten.sort((a, b) => b[1] - a[1]);
  return seiten[0][0];
}

// Lage an der Wandkante auf Hoehe der Krabbenmitte; ein Viertel steckt im Fels, Blick in den Gang
function setzeAnWand(f) {
  const g = f.groesse;
  const p = Fels.profilBei(f.y + g / 2);
  if (!p) return false;
  const kante = f.wand === 'l' ? p.l : config.spielfeldBreite - p.r;
  f.x = f.wand === 'l' ? kante - g * 0.25 : kante - g * 0.75;
  f.rot = f.wand === 'l' ? -90 : 90;
  return true;
}

export function erzeugeKrabbe(x = null) {
  const g = GROESSE.krabbe;
  const wand = x === null ? wandOben() : null;
  const f = {
    ...grundWerte('krabbe', x ?? startX(g), wand ? 0 : -g, 40),
    phase: wand ? 'wand' : 'anflug',
    wand,
    wandZeit: 90 + Math.floor(Math.random() * 120),
    zielY: 60 + Math.random() * 110,
    vx: (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 0.6),
    vy: 1.6,
    schussTakt: KRABBE_SCHUSS,
    lebensZeit: 0,
  };
  if (wand) setzeAnWand(f);
  arrays.feinde.push(Anzeige.erzeuge(f, 'feind'));
  return f;
}

export function erzeugeTentakler(x = null) {
  const g = GROESSE.tentakler;
  const sx = x ?? startX(g);
  const f = {
    ...grundWerte('tentakler', sx, -g, 30),
    basisX: sx,
    vy: 0.9,
    zeit: Math.random() * Math.PI * 2,
    schussTakt: 60 + Math.floor(Math.random() * TENTAKLER_SCHUSS),
  };
  arrays.feinde.push(Anzeige.erzeuge(f, 'feind'));
  return f;
}

function mitte(f) {
  return { x: f.x + f.groesse / 2, y: f.y + f.groesse / 2 };
}

function schiesseGezielt(f, streuung) {
  const m = mitte(f);
  const ziel = naechsterSpielerMitte(f);
  const w = Math.atan2(ziel.y - m.y, ziel.x - m.x);
  for (const d of streuung) {
    Gewaechse.erzeugeSporeZu(m.x, m.y + f.groesse / 2, Math.cos(w + d) * KUGEL_TEMPO, Math.sin(w + d) * KUGEL_TEMPO);
  }
}

function aktualisiereKrabbe(f) {
  f.lebensZeit++;
  if (f.phase === 'wand') {
    f.y += Fels.holeTempo() + WAND_TEMPO;
    f.wandZeit--;
    // Ende der Wand oder Zeit um: abspringen in den Gang
    if (f.wandZeit <= 0 || !setzeAnWand(f) || !wandAufHoehe(f)) {
      f.phase = 'sprung';
      f.sprungZeit = SPRUNG_DAUER;
      f.vx = (f.wand === 'l' ? 1 : -1) * (1.2 + Math.random() * 0.6);
    }
    return;
  }
  if (f.phase === 'sprung') {
    // Satz in den Gang: schnell zur Seite, Drehung zurueck in Blickrichtung unten
    f.x += f.vx * 2.2;
    f.y += Fels.holeTempo() * 0.5;
    f.sprungZeit--;
    f.rot = (f.rot || 0) * (f.sprungZeit / SPRUNG_DAUER);
    if (f.sprungZeit <= 0) {
      f.rot = 0;
      f.phase = 'krabbeln';
    }
    return;
  }
  if (f.phase === 'anflug') {
    f.y += f.vy;
    if (f.y >= f.zielY) f.phase = 'krabbeln';
    return;
  }
  if (f.phase === 'krabbeln') {
    f.y += Fels.holeTempo() * 0.5; // bleibt ungefaehr auf Hoehe, waehrend der Fels vorbeizieht
    const frei = freiBei(f.y + f.groesse / 2, f.x + f.groesse / 2);
    f.x += f.vx;
    if (f.x < frei.links + 4) {
      f.x = frei.links + 4;
      f.vx = Math.abs(f.vx);
    } else if (f.x + f.groesse > frei.rechts - 4) {
      f.x = frei.rechts - 4 - f.groesse;
      f.vx = -Math.abs(f.vx);
    }
    f.schussTakt--;
    if (f.schussTakt <= 0) {
      schiesseGezielt(f, [-0.15, 0.15]);
      f.schussTakt = KRABBE_SCHUSS;
    }
    if (f.lebensZeit > KRABBE_DAUER) f.phase = 'abzug';
    return;
  }
  f.y += 2; // abzug
}

function wandAufHoehe(f) {
  const p = Fels.profilBei(f.y + f.groesse / 2);
  return !!p && (f.wand === 'l' ? p.l : p.r) >= WAND_MIN;
}

function aktualisiereTentakler(f) {
  f.zeit += 0.04;
  f.y += f.vy;
  f.x = f.basisX + Math.sin(f.zeit) * 35;
  if (f.y < 20) return;
  f.schussTakt--;
  if (f.schussTakt <= 0) {
    const m = mitte(f);
    for (let i = 0; i < TENTAKLER_RING; i++) {
      const w = (i / TENTAKLER_RING) * Math.PI * 2 + f.zeit;
      Gewaechse.erzeugeSporeZu(m.x, m.y, Math.cos(w) * KUGEL_TEMPO * 0.8, Math.sin(w) * KUGEL_TEMPO * 0.8);
    }
    f.schussTakt = TENTAKLER_SCHUSS;
  }
}

// Jeder Schritt aus aktualisiereFeinde
export function aktualisiere(f) {
  f.schussTimer = 9999; // kein Standard-Schuss nach unten
  if (f.muster === 'krabbe') aktualisiereKrabbe(f);
  else aktualisiereTentakler(f);
}

// Gegner-Spawner der Fels-Level (levelPlan.spawner = 'bio')
export function verwalteBioSpawns() {
  let r = Math.random();
  let wahl = BIO_MIX[BIO_MIX.length - 1][0];
  for (const [art, anteil] of BIO_MIX) {
    if (r < anteil) {
      wahl = art;
      break;
    }
    r -= anteil;
  }
  if (wahl === 'krabbe') return erzeugeKrabbe();
  if (wahl === 'tentakler') return erzeugeTentakler();
  const bahn = Kette.KETTEN_BAHNEN[Math.floor(Math.random() * Kette.KETTEN_BAHNEN.length)];
  const anzahl = 6 + Math.floor(Math.random() * 7);
  return Kette.erzeugeKette(bahn, anzahl, Math.random() < 0.5 ? 1 : -1, wahl);
}
