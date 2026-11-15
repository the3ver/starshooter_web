import { state, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Anzeige from './anzeige.js';
import { neueId } from './entities.js';

// Fels-Level: Raender und Inseln, die mit FELS_TEMPO nach unten scrollen und nicht beruehrt werden duerfen.
// Das Profil besteht aus Punkten { l, r, im, ib }: linke/rechte Wandbreite, Inselmitte und -breite (0 = keine).
// Ein Segment (arrays.fels) spannt SEGMENT_HOEHE zwischen zwei Punkten (oben, unten); dazwischen wird linear
// interpoliert. Beruehrung: Schaden ueber spielerGetroffen (I-Frames, Schild, Dash wie sonst) und Rueckstoss
// in den freien Gang.

export const SEGMENT_HOEHE = 40;
export const FELS_TEMPO = 1.5;
export const RUECKSTOSS = 14;
export const MIN_DURCHGANG = 75; // engster Spalt neben einer Insel (2,5 Schiffsbreiten)
export const ENG_GANG = 100; // Durchlass einer Engstelle (gut 3 Schiffsbreiten)

const LEER = { l: 0, r: 0, im: 0, ib: 0 };
let letzter = null; // oberster erzeugter Profilpunkt
let warteschlange = []; // naechste Profilpunkte (ein Abschnitt)
let tempo = FELS_TEMPO; // Scrolltempo (Insel-Boss haelt den Fels an)

export function setzeZurueck() {
  letzter = null;
  warteschlange = [];
  tempo = FELS_TEMPO;
}

export function setzeTempo(t) {
  tempo = t;
}

export function holeTempo() {
  return tempo;
}

// Feste Profilpunkte als naechste einreihen (Insel-Boss); Markierungen der Punkte bleiben am Segment
export function reiheEin(punkte) {
  warteschlange = punkte.slice();
}

export function hatWarteschlange() {
  return warteschlange.length > 0;
}

function minGang() {
  return Math.round(config.spielfeldBreite * 0.4);
}

function maxWand() {
  return Math.floor((config.spielfeldBreite - minGang()) / 2);
}

const zitter = () => (Math.random() - 0.5) * 6;

// Abschnitte: Folgen von Profilpunkten (von unten nach oben). Alle halten den Mindestgang ein.
const ABSCHNITTE = {
  weit(n = 6) {
    return Array.from({ length: n }, () => ({ l: 18 + zitter(), r: 18 + zitter(), im: 0, ib: 0 }));
  },
  einengung(n = 14) {
    const w = maxWand();
    return Array.from({ length: n }, (_, i) => {
      const s = Math.sin((Math.PI * (i + 1)) / (n + 1));
      return { l: 18 + (w - 18) * s + zitter(), r: 18 + (w - 18) * s + zitter(), im: 0, ib: 0 };
    });
  },
  zickzack(n = 16) {
    const basis = 40;
    const ausschlag = Math.max(0, maxWand() - basis - 6);
    return Array.from({ length: n }, (_, i) => {
      const versatz = ausschlag * Math.sin(i * 0.5);
      return { l: basis + versatz + zitter(), r: basis - versatz + zitter(), im: 0, ib: 0 };
    });
  },
  saeule(n = 12) {
    const b = config.spielfeldBreite;
    const maxInsel = Math.min(b * 0.25, b - 2 * 18 - 2 * MIN_DURCHGANG);
    return Array.from({ length: n }, (_, i) => {
      const s = Math.sin((Math.PI * (i + 1)) / (n + 1));
      return { l: 18 + zitter(), r: 18 + zitter(), im: b / 2 + zitter(), ib: Math.max(0, maxInsel * s) };
    });
  },
  // Engstelle: beide Waende schieben sich weit herein und lassen einen Durchlass von ENG_GANG; der Durchlass
  // liegt zufaellig versetzt, die Felsnasen links und rechts sind um einen Punkt gegeneinander verschoben
  engstelle(n = 10) {
    const b = config.spielfeldBreite;
    const mitte = b / 2 + (Math.random() - 0.5) * b * 0.3;
    const engL = mitte - ENG_GANG / 2;
    const engR = b - (mitte + ENG_GANG / 2);
    // Anteil der vollen Einengung je Punkt, links einen Punkt frueher als rechts
    const verlauf = [0.15, 0.45, 0.8, 1, 1, 1, 0.8, 0.45, 0.15, 0];
    return Array.from({ length: n }, (_, i) => {
      const sl = verlauf[i] ?? 0;
      const sr = verlauf[i - 1] ?? 0;
      return {
        l: 25 + (engL - 25) * sl + zitter(),
        r: 25 + (engR - 25) * sr + zitter(),
        im: 0,
        ib: 0,
        eng: sl > 0.9 || sr > 0.9,
      };
    });
  },
};
export const ABSCHNITT_NAMEN = Object.keys(ABSCHNITTE);
export { ABSCHNITTE };

// Wandbreiten auf den erlaubten Bereich begrenzen: nie negativ, Gang nie enger als minGang (in einer
// Engstelle, Punkt mit eng, nie enger als ENG_GANG). Ohne Insel liegt ihre Mitte in der Feldmitte, damit eine
// Insel zur Mitte hin aus- und einlaeuft
export function mindestGang(p) {
  return p.eng ? ENG_GANG : minGang();
}

function begrenze(p) {
  const b = config.spielfeldBreite;
  let l = Math.max(0, p.l);
  let r = Math.max(0, p.r);
  if (p.eng) {
    const zuViel = ENG_GANG - (b - l - r);
    if (zuViel > 0) {
      l = Math.max(0, l - zuViel / 2);
      r = Math.max(0, b - ENG_GANG - l);
    }
  } else {
    const w = maxWand();
    l = Math.min(w, l);
    r = Math.min(w, r);
  }
  return { ...p, l, r, im: p.ib > 0 ? p.im : b / 2, ib: p.ib };
}

function naechsterPunkt(aktiv) {
  if (!aktiv) {
    // Auslauf: Waende und Insel schrumpfen bis null
    return {
      l: Math.max(0, letzter.l - 8),
      r: Math.max(0, letzter.r - 8),
      im: letzter.im,
      ib: Math.max(0, letzter.ib - 12),
    };
  }
  if (!warteschlange.length) {
    const name = ABSCHNITT_NAMEN[Math.floor(Math.random() * ABSCHNITT_NAMEN.length)];
    warteschlange = ABSCHNITTE[name]();
  }
  return begrenze(warteschlange.shift());
}

function istLeer(p) {
  return p.l <= 0 && p.r <= 0 && p.ib <= 0;
}

// Nachschub oben: aktiv = Level laeuft (Abschnitte), sonst Auslauf bis zum leeren Profil, danach nichts mehr
export function erzeugeNachschub(aktiv = true) {
  if (!letzter) {
    if (!aktiv) return;
    letzter = { ...LEER, im: config.spielfeldBreite / 2 };
  }
  if (!aktiv && istLeer(letzter)) return;
  let oberstes = arrays.fels.reduce((min, s) => Math.min(min, s.y), Infinity);
  if (oberstes === Infinity) oberstes = 0;
  while (oberstes > -SEGMENT_HOEHE) {
    const oben = naechsterPunkt(aktiv);
    const y = oberstes - SEGMENT_HOEHE;
    arrays.fels.push(Anzeige.erzeuge({ id: neueId('fe'), x: 0, y, oben, unten: letzter }, 'fels'));
    letzter = oben;
    oberstes = y;
    if (!aktiv && istLeer(letzter)) return;
  }
}

// Profil an der absoluten Hoehe y (zwischen oben und unten eines Segments), sonst leer
export function profilBei(y) {
  for (const s of arrays.fels) {
    if (y < s.y || y > s.y + SEGMENT_HOEHE) continue;
    const t = (y - s.y) / SEGMENT_HOEHE; // 0 = oben, 1 = unten
    const mix = k => s.oben[k] + (s.unten[k] - s.oben[k]) * t;
    return { l: mix('l'), r: mix('r'), im: mix('im'), ib: mix('ib') };
  }
  return null;
}

// Freier Bereich [links, rechts] um x auf Hoehe y (Waende und Insel beruecksichtigt)
export function freierBereich(y, x) {
  const b = config.spielfeldBreite;
  const p = profilBei(y);
  if (!p) return { links: 0, rechts: b };
  let links = p.l;
  let rechts = b - p.r;
  if (p.ib > 0) {
    const il = p.im - p.ib / 2;
    const ir = p.im + p.ib / 2;
    if (x < p.im) rechts = Math.min(rechts, il);
    else links = Math.max(links, ir);
  }
  return { links, rechts };
}

// Schwebendes Objekt (Powerup, x/y = linke obere Ecke, Kantenlaenge g) gleitet mit hoechstens tempo px je Schritt
// in den freien Bereich auf Hoehe seiner Mitte, damit es erreichbar bleibt
export const SCHWEBE_RAND = 6;
export function schwebeInGang(obj, g, tempo = 3) {
  const mitteY = obj.y + g / 2;
  if (!profilBei(mitteY)) return;
  const { links, rechts } = freierBereich(mitteY, obj.x + g / 2);
  const ziel = Math.max(links + SCHWEBE_RAND, Math.min(rechts - g - SCHWEBE_RAND, obj.x));
  obj.x += Math.max(-tempo, Math.min(tempo, ziel - obj.x));
}

// Schiebt ein Schiff (x/y = linke obere Ecke) aus dem Fels; liefert true bei Beruehrung
export function schiebeHeraus(schiff) {
  const g = config.spielerGroesse;
  let beruehrt = false;
  for (const y of [schiff.y + 2, schiff.y + g / 2, schiff.y + g - 2]) {
    const p = profilBei(y);
    if (!p) continue;
    const mitte = schiff.x + g / 2;
    const { links, rechts } = freierBereich(y, mitte);
    if (schiff.x < links) {
      schiff.x = links + RUECKSTOSS;
      beruehrt = true;
    } else if (schiff.x + g > rechts) {
      schiff.x = rechts - g - RUECKSTOSS;
      beruehrt = true;
    }
  }
  schiff.x = Math.max(0, Math.min(config.spielfeldBreite - g, schiff.x));
  return beruehrt;
}

// Jeder Host-Schritt: scrollen, unten entfernen, Spieler pruefen
export function aktualisiereFels() {
  for (let i = arrays.fels.length - 1; i >= 0; i--) {
    const s = arrays.fels[i];
    s.y += tempo;
    if (s.y > config.spielfeldHoehe) {
      Anzeige.entferne(s);
      arrays.fels.splice(i, 1);
    }
  }
  if (!arrays.fels.length) return;
  pruefeSpieler(state, 'p1');
  if (isCoopMode() && state.p2) pruefeSpieler(state.p2, 'p2');
}

function pruefeSpieler(pState, key) {
  if (pState.isDead) return;
  if (schiebeHeraus(pState)) Utils.spielerGetroffen({ x: pState.x, y: pState.y, farbe: '#8a7aa0' }, false, key);
}

// Online: Segmente als Text "l r im ib,l r im ib" (oben, unten), ganzzahlig
// Knochen-Segmente (Insel-Boss) tragen am oberen Punkt eine fuenfte Zahl 1
export function profilAlsText(s) {
  const t = p => [p.l, p.r, p.im, p.ib].map(v => Math.round(v)).join(' ') + (p.knochen ? ' 1' : '');
  return `${t(s.oben)},${t(s.unten)}`;
}

export function profilAusText(text) {
  const [oben, unten] = text.split(',').map(teil => {
    const [l, r, im, ib, knochen] = teil.split(' ').map(Number);
    return knochen ? { l, r, im, ib, knochen: true } : { l, r, im, ib };
  });
  return { oben, unten };
}

export function netzListe() {
  return arrays.fels.map(s => ({ id: s.id, y: s.y, p: profilAlsText(s) }));
}

// Client: Segmente aus dem Snapshot anlegen, bewegen, entfernen
export function synchronisiere(liste) {
  const daten = liste || [];
  const ids = new Set(daten.map(d => d.id));
  for (let i = arrays.fels.length - 1; i >= 0; i--) {
    if (!ids.has(arrays.fels[i].id)) {
      Anzeige.entferne(arrays.fels[i]);
      arrays.fels.splice(i, 1);
    }
  }
  for (const d of daten) {
    let s = arrays.fels.find(f => f.id === d.id);
    if (!s) {
      s = Anzeige.erzeuge({ id: d.id, x: 0, y: d.y, ...profilAusText(d.p) }, 'fels');
      arrays.fels.push(s);
    }
    s.y = d.y;
  }
}
