import { state, config, arrays, isCoopMode } from './state.js';
import * as Audio from './audio.js';
import * as Anzeige from './anzeige.js';
import * as Fels from './fels.js';
import { neueId } from './entities.js';
import { naechsterSpielerMitte } from './gegner.js';

// Gewaechse an Felswaenden und Inseln (Fels-Level). Sie sind Feinde (arrays.feinde), damit alle Waffen, die
// Schockwelle, Punkte und der Bot sie wie Gegner behandeln, und haengen an einem Felssegment:
// - bluete: Tentakelbluete, abwechselnd zu (gepanzert: istUnzerstoerbar, Laser prallen ab, die Bombe knackt sie)
//   und offen (verwundbar, schiesst SPOREN_JE_OEFFNUNG Sporen quer in den Gang)
// - trichter: Hornroehre, immer verwundbar, schiesst in festem Takt einzelne Sporen
// - kapsel: Eierkapsel, schiesst nicht, laesst beim Abschuss einen Bonus fallen (Schockwelle oder Zufall)
// Sporen sind Feindgeschosse (arrays.feindLaserArray) mit spore = true: langsam, rund, quer zum Gang.

// roehre: Larvenroehre am Insel-Boss (wirft alle takt Schritte eine Larve aus, hoechstens MAX_LARVEN)
// larve: kleiner Verfolger aus der Roehre (kein Gewaechs, haengt an keinem Segment)
export const ARTEN = ['bluete', 'trichter', 'kapsel', 'roehre'];
export const GROESSE = { bluete: 34, trichter: 30, kapsel: 24, roehre: 34, larve: 18 };
export const FARBE = { bluete: '#e0703a', trichter: '#d9822b', kapsel: '#b5a36a', roehre: '#c0602a', larve: '#e8b04a' };
export const ROEHRE_TAKT = 150;
export const ROEHRE_TAKT_ENRAGE = 90;
export const MAX_LARVEN = 8;
export const LARVEN_TEMPO = 1.4;
export const ZU_DAUER = 100;
export const OFFEN_DAUER = 80;
export const SPOREN_JE_OEFFNUNG = 3;
export const TRICHTER_TAKT = 110;
export const SPOREN_TEMPO = 2.6;
export const SPORE_GROESSE = 10;
const MIN_PLATZ = 26; // Wand- oder Inselbreite, an der ein Gewaechs Halt findet

export function istGewaechs(f) {
  return ARTEN.includes(f.muster);
}

// Moegliche Plaetze an einem Segment (Profil oben): Wand links/rechts, Insel links/rechts
function plaetze(segment) {
  const p = segment.oben;
  const liste = [];
  if (p.l >= MIN_PLATZ) liste.push('l');
  if (p.r >= MIN_PLATZ) liste.push('r');
  if (p.ib >= MIN_PLATZ) liste.push('il', 'ir');
  return liste;
}

// Blickrichtung in den Gang: +1 = nach rechts, -1 = nach links
function richtung(seite) {
  return seite === 'l' || seite === 'ir' ? 1 : -1;
}

// Position an der Felskante auf Hoehe der Gewaechsmitte; ein Drittel steckt im Fels.
// rot: Grafik-Vorwaerts ist unten, -90 = Blick nach rechts, 90 = nach links
function setzeAnKante(f) {
  const g = f.groesse;
  f.y = f.segment.y + f.versatzY;
  const p = Fels.profilBei(f.y + g / 2) || f.segment.oben;
  const b = config.spielfeldBreite;
  const kante = { l: p.l, r: b - p.r, il: p.im - p.ib / 2, ir: p.im + p.ib / 2 }[f.seite];
  f.x = f.richtung === 1 ? kante - g * 0.3 : kante - g * 0.7;
  f.rot = f.richtung === 1 ? -90 : 90;
}

// Ein Gewaechs an einem Segment anlegen; liefert null, wenn dort kein Platz ist
export function erzeugeGewaechs(art, segment, seite = null) {
  const moeglich = plaetze(segment);
  if (!moeglich.length) return null;
  const platz = seite && moeglich.includes(seite) ? seite : moeglich[Math.floor(Math.random() * moeglich.length)];
  const hpMult = isCoopMode() ? 1.25 : 1.0;
  const hp = Math.round({ bluete: 40, trichter: 30, kapsel: 20, roehre: 60 }[art] * hpMult);
  const f = {
    id: neueId('f'),
    x: 0,
    y: 0,
    groesse: GROESSE[art],
    hp,
    maxHp: hp,
    schildHp: 0,
    maxSchildHp: 0,
    hatSchild: false,
    farbe: FARBE[art],
    explosionsFarbe: FARBE[art],
    vy: 0,
    vx: 0,
    zeit: 0,
    schussTimer: 9999,
    burstCount: 0,
    burstTimer: 0,
    istFeind: true,
    istUnzerstoerbar: art === 'bluete',
    traegtPowerup: art === 'kapsel',
    powerupTyp: art === 'kapsel' ? 'bonus' : undefined,
    muster: art,
    phase: art === 'bluete' ? 'zu' : 'offen',
    offen: art !== 'bluete',
    phaseTimer: art === 'bluete' ? ZU_DAUER : Math.floor(Math.random() * TRICHTER_TAKT),
    takt: art === 'roehre' ? ROEHRE_TAKT : TRICHTER_TAKT,
    segment,
    seite: platz,
    richtung: richtung(platz),
    versatzY: (Fels.SEGMENT_HOEHE - GROESSE[art]) / 2,
  };
  setzeAnKante(f);
  arrays.feinde.push(Anzeige.erzeuge(f, 'feind'));
  return f;
}

// Spore mit Mittelpunkt (mx, my) und Geschwindigkeit (vx, vy)
export function erzeugeSporeZu(mx, my, vx, vy) {
  Audio.playSpore();
  arrays.feindLaserArray.push(
    Anzeige.erzeuge(
      {
        id: neueId('fl'),
        x: mx - SPORE_GROESSE / 2,
        y: my - SPORE_GROESSE / 2,
        vx,
        vy,
        width: SPORE_GROESSE,
        height: SPORE_GROESSE,
        spore: true,
      },
      'feindLaser',
    ),
  );
}

// Spore quer aus dem Schlund eines Gewaechses in den Gang
export function erzeugeSpore(f) {
  const g = f.groesse;
  erzeugeSporeZu(f.x + g / 2 + f.richtung * (g / 2), f.y + g / 2, f.richtung * SPOREN_TEMPO, Fels.holeTempo() * 0.5);
}

function erzeugeLarve(f) {
  const g = GROESSE.larve;
  const hp = Math.round(10 * (isCoopMode() ? 1.25 : 1));
  arrays.feinde.push(
    Anzeige.erzeuge(
      {
        id: neueId('f'),
        x: f.x + f.groesse / 2 + f.richtung * f.groesse * 0.5 - g / 2,
        y: f.y + f.groesse / 2 - g / 2,
        groesse: g,
        hp,
        maxHp: hp,
        schildHp: 0,
        maxSchildHp: 0,
        hatSchild: false,
        farbe: FARBE.larve,
        explosionsFarbe: FARBE.larve,
        vx: 0,
        vy: 0,
        zeit: 0,
        schussTimer: 9999,
        burstCount: 0,
        burstTimer: 0,
        istFeind: true,
        istUnzerstoerbar: false,
        traegtPowerup: false,
        muster: 'larve',
        phase: 'flug',
      },
      'feind',
    ),
  );
}

// Larve: kriecht auf den naechsten Spieler zu und wackelt dabei
export function bewegeLarve(f) {
  f.schussTimer = 9999;
  f.zeit += 0.15;
  const ziel = naechsterSpielerMitte(f);
  const dx = ziel.x - (f.x + f.groesse / 2);
  const dy = ziel.y - (f.y + f.groesse / 2);
  const d = Math.hypot(dx, dy) || 1;
  f.x += (dx / d) * LARVEN_TEMPO + Math.sin(f.zeit) * 0.6;
  f.y += (dy / d) * LARVEN_TEMPO;
  f.rot = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
}

// Jeder Schritt aus aktualisiereFeinde: an der Kante halten, Phasen und Sporen
export function aktualisiere(f) {
  setzeAnKante(f);
  f.schussTimer = 9999; // kein Standard-Schuss nach unten
  if (f.muster === 'kapsel') return;
  if (f.y + f.groesse < 0) return; // noch ueber dem Feld
  f.phaseTimer--;
  if (f.muster === 'trichter') {
    if (f.phaseTimer <= 0) {
      erzeugeSpore(f);
      f.phaseTimer = f.takt;
    }
    return;
  }
  if (f.muster === 'roehre') {
    if (f.phaseTimer <= 0) {
      if (arrays.feinde.filter(l => l.muster === 'larve').length < MAX_LARVEN) erzeugeLarve(f);
      f.phaseTimer = f.takt;
    }
    return;
  }
  // bluete
  if (f.phase === 'offen') {
    const abstand = Math.floor(OFFEN_DAUER / (SPOREN_JE_OEFFNUNG + 1));
    if (f.phaseTimer > 0 && f.phaseTimer % abstand === 0 && f.phaseTimer < OFFEN_DAUER) erzeugeSpore(f);
  }
  if (f.phaseTimer <= 0) {
    f.phase = f.phase === 'zu' ? 'offen' : 'zu';
    f.phaseTimer = f.phase === 'zu' ? ZU_DAUER : OFFEN_DAUER;
  }
  f.offen = f.phase === 'offen';
  f.istUnzerstoerbar = !f.offen;
}

// Aus levelSchritt (Fels-Level, waehrend Nachschub): alle GEWAECHS_TAKT Schritte ein Gewaechs am obersten
// Segment, Art nach Gewicht (Bluete 50 %, Trichter 30 %, Kapsel 20 %)
export const GEWAECHS_TAKT = 150;
export function wachseNach(frame) {
  const takt = Math.max(80, GEWAECHS_TAKT - (state.level - 4) * 10);
  if (frame % takt !== 0 || !arrays.fels.length) return null;
  const oberstes = arrays.fels.reduce((a, s) => (s.y < a.y ? s : a));
  const r = Math.random();
  const art = r < 0.5 ? 'bluete' : r < 0.8 ? 'trichter' : 'kapsel';
  return erzeugeGewaechs(art, oberstes);
}
