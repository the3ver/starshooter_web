import { state, config, arrays, isCoopMode } from './state.js';
import * as Entities from './entities.js';
import * as Anzeige from './anzeige.js';

// Kettengegner: Kopf und Glieder folgen derselben Bahn, Glied i mit i * gliedAbstand(...) Schritten Rueckstand.
// Die Bahn ist eine reine Funktion der Zeit (bahnPunkt), die Glieder brauchen keinen Positionsspeicher.
// Wer alle Glieder einer Kette abschiesst, bekommt ein Powerup (Kettenbonus).

export const KETTEN_BAHNEN = ['schlange', 'sKurve', 'schleife', 'spirale'];
export const GLIED_ABSTAND_PX = 17; // mittlerer Abstand zweier Gliedmitten: Glieder liegen aneinander
export const KOPF_GROESSE = 28;
export const GLIED_GROESSE = 22;
export const KETTEN_BONUS_PUNKTE = 500;

// Mittelpunkt auf der Bahn zur Zeit t >= 0. seite = 1 oder -1 spiegelt die Bahn an der Feldmitte.
function bahnRoh(bahn, t, seite, breite) {
  const mitte = breite / 2;
  if (bahn === 'schlange') {
    return { x: mitte + seite * breite * 0.3 * Math.sin(t * 0.04), y: -40 + 1.6 * t };
  }
  if (bahn === 'sKurve') {
    // von der Seite herein, flach nach unten, mit Welle
    const x = -40 + 2.2 * t;
    return { x: seite === 1 ? x : breite - x, y: 60 + 0.35 * t + 70 * Math.sin(t * 0.03) };
  }
  if (bahn === 'schleife') {
    // y laeuft zwischendurch kurz zurueck: Schleifen
    return { x: mitte + seite * breite * 0.3 * Math.sin(t * 0.025), y: -40 + 1.4 * t + 50 * Math.sin(t * 0.045) };
  }
  // spirale: Kreis um einen Mittelpunkt, der langsam nach unten wandert
  const r = Math.min(breite * 0.3, 90);
  const a = t * 0.05 * seite;
  return { x: mitte + r * Math.sin(a), y: -40 + t + r * (1 - Math.cos(a)) };
}

// Vor dem Start (t < 0) liegt der Punkt auf der Verlaengerung der Anfangsrichtung, also ausserhalb des Felds.
export function bahnPunkt(bahn, t, seite = 1, breite = config.spielfeldBreite) {
  if (t >= 0) return bahnRoh(bahn, t, seite, breite);
  const p0 = bahnRoh(bahn, 0, seite, breite);
  const p1 = bahnRoh(bahn, 1, seite, breite);
  return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
}

// Position aus der Bahn, Drehung aus der Flugrichtung (Vorwaerts der Grafik = unten)
// Schritte zwischen zwei Gliedern: GLIED_ABSTAND_PX geteilt durch das mittlere Tempo der Bahn (erste 300 Schritte)
export function gliedAbstand(bahn, seite = 1, breite = config.spielfeldBreite) {
  let weg = 0;
  let vor = bahnRoh(bahn, 0, seite, breite);
  for (let t = 1; t <= 300; t++) {
    const p = bahnRoh(bahn, t, seite, breite);
    weg += Math.hypot(p.x - vor.x, p.y - vor.y);
    vor = p;
  }
  return Math.max(3, Math.round(GLIED_ABSTAND_PX / (weg / 300)));
}

function setzeAufBahn(f) {
  const p = bahnPunkt(f.kettenBahn, f.kettenT, f.kettenSeite);
  const vor = bahnPunkt(f.kettenBahn, f.kettenT - 1, f.kettenSeite);
  f.x = p.x - f.groesse / 2;
  f.y = p.y - f.groesse / 2;
  f.rot = (Math.atan2(p.y - vor.y, p.x - vor.x) * 180) / Math.PI - 90;
}

// Erzeugt eine Kette mit anzahl Gliedern (Index 0 = Kopf). Nur der Kopf schiesst.
export function erzeugeKette(bahn = 'schlange', anzahl = 8, seite = 1) {
  const kette = { gesamt: anzahl, abgeschossen: 0 };
  const hpMult = isCoopMode() ? 1.25 : 1.0;
  const schussBasis = Math.max(25, 60 - (state.level - 1) * 8);
  const abstand = gliedAbstand(bahn, seite);
  for (let i = 0; i < anzahl; i++) {
    const kopf = i === 0;
    const groesse = kopf ? KOPF_GROESSE : GLIED_GROESSE;
    const hp = Math.round((kopf ? 32 : 16) * hpMult);
    const f = {
      id: Entities.neueId('f'),
      x: 0,
      y: 0,
      groesse,
      hp,
      maxHp: hp,
      schildHp: 0,
      maxSchildHp: 0,
      hatSchild: false,
      farbe: Entities.getFeindColor('kette'),
      vy: 0,
      vx: 0,
      zeit: 0,
      schussTimer: kopf ? schussBasis * 2 : 9999,
      burstCount: 0,
      burstTimer: 0,
      istFeind: true,
      istUnzerstoerbar: false,
      traegtPowerup: false,
      muster: 'kette',
      phase: 'flug',
      kette,
      kettenIndex: i,
      kettenBahn: bahn,
      kettenSeite: seite,
      kettenT: -i * abstand,
    };
    setzeAufBahn(f);
    arrays.feinde.push(Anzeige.erzeuge(f, 'feind'));
  }
  return kette;
}

export function bewegeGlied(f) {
  f.kettenT++;
  setzeAufBahn(f);
}

// Glieder, die noch auf ihren Start warten, liegen ausserhalb des Felds und bleiben erhalten.
export function wartetAufStart(f) {
  return f.muster === 'kette' && f.kettenT < 0;
}

// Aus zerstoereZiel: zaehlt Abschuesse; das letzte Glied einer vollstaendig abgeschossenen Kette
// laesst ein Powerup fallen und gibt Bonuspunkte. Liefert true beim Kettenbonus.
export function gliedAbgeschossen(f) {
  if (!f.kette) return false;
  f.kette.abgeschossen++;
  if (f.kette.abgeschossen < f.kette.gesamt) return false;
  Entities.erzeugePowerup(f.x + f.groesse / 2 - 12, f.y + f.groesse / 2 - 12, bonusTyp());
  return true;
}

// Kettenbonus: mit SCHOCKWELLE_CHANCE eine Schockwelle, hoechstens eine pro Level und nie im Bosskampf;
// sonst ein zufaelliges Powerup (null)
export const SCHOCKWELLE_CHANCE = 0.35;
function bonusTyp() {
  if (state.bossAktiv || state.schockwelleLevel === state.level) return null;
  if (Math.random() >= SCHOCKWELLE_CHANCE) return null;
  state.schockwelleLevel = state.level;
  return 'schockwelle';
}

// Zufaellige Kette fuer verwalteFeindSpawns: Bahn, Laenge (6-10) und Seite aus Math.random
export function erzeugeZufallsKette() {
  const bahn = KETTEN_BAHNEN[Math.floor(Math.random() * KETTEN_BAHNEN.length)];
  const anzahl = 6 + Math.floor(Math.random() * 5);
  const seite = Math.random() < 0.5 ? 1 : -1;
  return erzeugeKette(bahn, anzahl, seite);
}
