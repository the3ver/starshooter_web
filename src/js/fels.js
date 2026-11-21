import { state, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Display from './anzeige.js';
import { newId } from './entities.js';

// Fels-Level: Raender und Inseln, die mit FELS_TEMPO nach unten scrollen und nicht beruehrt werden duerfen.
// Das Profil besteht aus Punkten { l, r, im, ib }: linke/rechte Wandbreite, Inselmitte und -breite (0 = keine).
// Ein Segment (arrays.fels) spannt SEGMENT_HOEHE zwischen zwei Punkten (oben, unten); dazwischen wird linear
// interpoliert. Beruehrung: Schaden ueber spielerGetroffen (I-Frames, Schild, Dash wie sonst) und Rueckstoss
// in den freien Gang.

export const SEGMENT_HEIGHT = 40;
export const ROCK_SPEED = 1.5;
export const KNOCKBACK = 14;
export const MIN_PASSAGE = 75; // engster Spalt neben einer Insel (2,5 Schiffsbreiten)
export const NARROW_CORRIDOR = 100; // Durchlass einer Engstelle (gut 3 Schiffsbreiten)

const EMPTY = { l: 0, r: 0, inner: 0, ib: 0 };
let last = null; // oberster erzeugter Profilpunkt
let queue = []; // naechste Profilpunkte (ein Abschnitt)
let speed = ROCK_SPEED; // Scrolltempo (Insel-Boss haelt den Fels an)

export function reset() {
  last = null;
  queue = [];
  speed = ROCK_SPEED;
}

export function setSpeed(t) {
  speed = t;
}

export function getSpeed() {
  return speed;
}

// Feste Profilpunkte als naechste einreihen (Insel-Boss); Markierungen der Punkte bleiben am Segment
export function enqueue(points) {
  queue = points.slice();
}

export function hasQueue() {
  return queue.length > 0;
}

function minCorridor() {
  return Math.round(config.playfieldWidth * 0.4);
}

function maxWall() {
  return Math.floor((config.playfieldWidth - minCorridor()) / 2);
}

const jitter = () => (Math.random() - 0.5) * 6;

// Abschnitte: Folgen von Profilpunkten (von unten nach oben). Alle halten den Mindestgang ein.
const SECTIONS = {
  far(n = 6) {
    return Array.from({ length: n }, () => ({ l: 18 + jitter(), r: 18 + jitter(), inner: 0, ib: 0 }));
  },
  narrowing(n = 14) {
    const w = maxWall();
    return Array.from({ length: n }, (_, i) => {
      const s = Math.sin((Math.PI * (i + 1)) / (n + 1));
      return { l: 18 + (w - 18) * s + jitter(), r: 18 + (w - 18) * s + jitter(), inner: 0, ib: 0 };
    });
  },
  zigzag(n = 16) {
    const basis = 40;
    const swing = Math.max(0, maxWall() - basis - 6);
    return Array.from({ length: n }, (_, i) => {
      const offset = swing * Math.sin(i * 0.5);
      return { l: basis + offset + jitter(), r: basis - offset + jitter(), inner: 0, ib: 0 };
    });
  },
  pillar(n = 12) {
    const b = config.playfieldWidth;
    const maxIsland = Math.min(b * 0.25, b - 2 * 18 - 2 * MIN_PASSAGE);
    return Array.from({ length: n }, (_, i) => {
      const s = Math.sin((Math.PI * (i + 1)) / (n + 1));
      return { l: 18 + jitter(), r: 18 + jitter(), inner: b / 2 + jitter(), ib: Math.max(0, maxIsland * s) };
    });
  },
  // Engstelle: beide Waende schieben sich weit herein und lassen einen Durchlass von ENG_GANG; der Durchlass
  // liegt zufaellig versetzt, die Felsnasen links und rechts sind um einen Punkt gegeneinander verschoben
  narrows(n = 10) {
    const b = config.playfieldWidth;
    const middle = b / 2 + (Math.random() - 0.5) * b * 0.3;
    const narrowL = middle - NARROW_CORRIDOR / 2;
    const narrowR = b - (middle + NARROW_CORRIDOR / 2);
    // Anteil der vollen Einengung je Punkt, links einen Punkt frueher als rechts
    const history = [0.15, 0.45, 0.8, 1, 1, 1, 0.8, 0.45, 0.15, 0];
    return Array.from({ length: n }, (_, i) => {
      const sl = history[i] ?? 0;
      const sr = history[i - 1] ?? 0;
      return {
        l: 25 + (narrowL - 25) * sl + jitter(),
        r: 25 + (narrowR - 25) * sr + jitter(),
        inner: 0,
        ib: 0,
        narrow: sl > 0.9 || sr > 0.9,
      };
    });
  },
};
export const SECTION_NAMES = Object.keys(SECTIONS);
export { SECTIONS };

// Wandbreiten auf den erlaubten Bereich begrenzen: nie negativ, Gang nie enger als minGang (in einer
// Engstelle, Punkt mit eng, nie enger als ENG_GANG). Ohne Insel liegt ihre Mitte in der Feldmitte, damit eine
// Insel zur Mitte hin aus- und einlaeuft
export function minimumCorridor(p) {
  return p.narrow ? NARROW_CORRIDOR : minCorridor();
}

function clamp(p) {
  const b = config.playfieldWidth;
  let l = Math.max(0, p.l);
  let r = Math.max(0, p.r);
  if (p.narrow) {
    const tooMuch = NARROW_CORRIDOR - (b - l - r);
    if (tooMuch > 0) {
      l = Math.max(0, l - tooMuch / 2);
      r = Math.max(0, b - NARROW_CORRIDOR - l);
    }
  } else {
    const w = maxWall();
    l = Math.min(w, l);
    r = Math.min(w, r);
  }
  return { ...p, l, r, inner: p.ib > 0 ? p.inner : b / 2, ib: p.ib };
}

function nextPoint(active) {
  if (!active) {
    // Auslauf: Waende und Insel schrumpfen bis null
    return {
      l: Math.max(0, last.l - 8),
      r: Math.max(0, last.r - 8),
      inner: last.inner,
      ib: Math.max(0, last.ib - 12),
    };
  }
  if (!queue.length) {
    const name = SECTION_NAMES[Math.floor(Math.random() * SECTION_NAMES.length)];
    queue = SECTIONS[name]();
  }
  return clamp(queue.shift());
}

function isEmpty(p) {
  return p.l <= 0 && p.r <= 0 && p.ib <= 0;
}

// Nachschub oben: aktiv = Level laeuft (Abschnitte), sonst Auslauf bis zum leeren Profil, danach nichts mehr
export function createSupply(active = true) {
  if (!last) {
    if (!active) return;
    last = { ...EMPTY, inner: config.playfieldWidth / 2 };
  }
  if (!active && isEmpty(last)) return;
  let topmost = arrays.rock.reduce((min, s) => Math.min(min, s.y), Infinity);
  if (topmost === Infinity) topmost = 0;
  while (topmost > -SEGMENT_HEIGHT) {
    const top = nextPoint(active);
    const y = topmost - SEGMENT_HEIGHT;
    arrays.rock.push(Display.create({ id: newId('fe'), x: 0, y, top, bottom: last }, 'rock'));
    last = top;
    topmost = y;
    if (!active && isEmpty(last)) return;
  }
}

// Profil an der absoluten Hoehe y (zwischen oben und unten eines Segments), sonst leer
export function profileAt(y) {
  for (const s of arrays.rock) {
    if (y < s.y || y > s.y + SEGMENT_HEIGHT) continue;
    const t = (y - s.y) / SEGMENT_HEIGHT; // 0 = oben, 1 = unten
    const mix = k => s.top[k] + (s.bottom[k] - s.top[k]) * t;
    return { l: mix('l'), r: mix('r'), inner: mix('inner'), ib: mix('ib') };
  }
  return null;
}

// Freier Bereich [links, rechts] um x auf Hoehe y (Waende und Insel beruecksichtigt)
export function freeRange(y, x) {
  const b = config.playfieldWidth;
  const p = profileAt(y);
  if (!p) return { left: 0, right: b };
  let left = p.l;
  let right = b - p.r;
  if (p.ib > 0) {
    const il = p.inner - p.ib / 2;
    const ir = p.inner + p.ib / 2;
    if (x < p.inner) right = Math.min(right, il);
    else left = Math.max(left, ir);
  }
  return { left, right };
}

// Schwebendes Objekt (Powerup, x/y = linke obere Ecke, Kantenlaenge g) gleitet mit hoechstens tempo px je Schritt
// in den freien Bereich auf Hoehe seiner Mitte, damit es erreichbar bleibt
export const HOVER_EDGE = 6;
export function hoverInCorridor(obj, g, speed = 3) {
  const middleY = obj.y + g / 2;
  if (!profileAt(middleY)) return;
  const { left, right } = freeRange(middleY, obj.x + g / 2);
  const target = Math.max(left + HOVER_EDGE, Math.min(right - g - HOVER_EDGE, obj.x));
  obj.x += Math.max(-speed, Math.min(speed, target - obj.x));
}

// Schiebt ein Schiff (x/y = linke obere Ecke) aus dem Fels; liefert true bei Beruehrung
export function pushOut(ship) {
  const g = config.playerSize;
  let touched = false;
  for (const y of [ship.y + 2, ship.y + g / 2, ship.y + g - 2]) {
    const p = profileAt(y);
    if (!p) continue;
    const middle = ship.x + g / 2;
    const { left, right } = freeRange(y, middle);
    if (ship.x < left) {
      ship.x = left + KNOCKBACK;
      touched = true;
    } else if (ship.x + g > right) {
      ship.x = right - g - KNOCKBACK;
      touched = true;
    }
  }
  ship.x = Math.max(0, Math.min(config.playfieldWidth - g, ship.x));
  return touched;
}

// Jeder Host-Schritt: scrollen, unten entfernen, Spieler pruefen
export function updateRock() {
  for (let i = arrays.rock.length - 1; i >= 0; i--) {
    const s = arrays.rock[i];
    s.y += speed;
    if (s.y > config.playfieldHeight) {
      Display.remove(s);
      arrays.rock.splice(i, 1);
    }
  }
  if (!arrays.rock.length) return;
  checkPlayer(state, 'p1');
  if (isCoopMode() && state.p2) checkPlayer(state.p2, 'p2');
}

function checkPlayer(pState, key) {
  if (pState.isDead) return;
  if (pushOut(pState)) Utils.playerHit({ x: pState.x, y: pState.y, color: '#8a7aa0' }, false, key);
}

// Online: Segmente als Text "l r im ib,l r im ib" (oben, unten), ganzzahlig
// Knochen-Segmente (Insel-Boss) tragen am oberen Punkt eine fuenfte Zahl 1
export function profileAsText(s) {
  const t = p => [p.l, p.r, p.inner, p.ib].map(v => Math.round(v)).join(' ') + (p.bone ? ' 1' : '');
  return `${t(s.top)},${t(s.bottom)}`;
}

export function profileFromText(text) {
  const [top, bottom] = text.split(',').map(part => {
    const [l, r, inner, ib, bone] = part.split(' ').map(Number);
    return bone ? { l, r, inner, ib, bone: true } : { l, r, inner, ib };
  });
  return { top, bottom };
}

export function networkList() {
  return arrays.rock.map(s => ({ id: s.id, y: s.y, p: profileAsText(s) }));
}

// Client: Segmente aus dem Snapshot anlegen, bewegen, entfernen
export function sync(list) {
  const payload = list || [];
  const ids = new Set(payload.map(d => d.id));
  for (let i = arrays.rock.length - 1; i >= 0; i--) {
    if (!ids.has(arrays.rock[i].id)) {
      Display.remove(arrays.rock[i]);
      arrays.rock.splice(i, 1);
    }
  }
  for (const d of payload) {
    let s = arrays.rock.find(f => f.id === d.id);
    if (!s) {
      s = Display.create({ id: d.id, x: 0, y: d.y, ...profileFromText(d.p) }, 'rock');
      arrays.rock.push(s);
    }
    s.y = d.y;
  }
}
