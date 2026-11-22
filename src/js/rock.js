import { state, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Display from './display.js';
import { newId } from './entities.js';

// Rock levels: edges and islands that scroll down at ROCK_SPEED and must not be touched.
// The profile consists of points { l, r, im, ib }: left/right wall width, island center and width (0 = none).
// A segment (arrays.rock) spans SEGMENT_HEIGHT between two points (top, bottom); in between it is linearly
// interpolated. Contact: damage via playerHit (i-frames, shield, dash as usual) and knockback
// into the free corridor.

export const SEGMENT_HEIGHT = 40;
export const ROCK_SPEED = 1.5;
export const KNOCKBACK = 14;
export const MIN_PASSAGE = 75; // narrowest gap beside an island (2.5 ship widths)
export const NARROW_CORRIDOR = 100; // Passage of a narrows (a good 3 ship widths)

const EMPTY = { l: 0, r: 0, inner: 0, ib: 0 };
let last = null; // topmost created profile point
let queue = []; // next profile points (one section)
let speed = ROCK_SPEED; // Scroll speed (the island boss stops the rock)

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

// Enqueue fixed profile points as the next ones (island boss); the points' markers stay on the segment
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

// Sections: sequences of profile points (from bottom to top). All keep the minimum corridor.
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
  // Narrows: both walls push far in and leave a passage of NARROW_CORRIDOR; the passage
  // is offset at random, the rock noses left and right are shifted against each other by one point
  narrows(n = 10) {
    const b = config.playfieldWidth;
    const middle = b / 2 + (Math.random() - 0.5) * b * 0.3;
    const narrowL = middle - NARROW_CORRIDOR / 2;
    const narrowR = b - (middle + NARROW_CORRIDOR / 2);
    // Share of the full narrowing per point, on the left one point earlier than on the right
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

// Clamp wall widths to the allowed range: never negative, corridor never narrower than minCorridor (inside a
// narrows, a point with narrow, never narrower than NARROW_CORRIDOR). Without an island its center lies in the field center, so an
// island runs out and in towards the center
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
    // Runout: walls and island shrink to zero
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

// Supply at the top: active = level running (sections), otherwise runout to the empty profile, then nothing more
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

// Profile at the absolute height y (between top and bottom of a segment), otherwise empty
export function profileAt(y) {
  for (const s of arrays.rock) {
    if (y < s.y || y > s.y + SEGMENT_HEIGHT) continue;
    const t = (y - s.y) / SEGMENT_HEIGHT; // 0 = top, 1 = bottom
    const mix = k => s.top[k] + (s.bottom[k] - s.top[k]) * t;
    return { l: mix('l'), r: mix('r'), inner: mix('inner'), ib: mix('ib') };
  }
  return null;
}

// Free range [left, right] around x at height y (walls and island considered)
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

// A hovering object (powerup, x/y = top left corner, edge length g) glides at most speed px per step
// into the free range at the height of its center, so it stays reachable
export const HOVER_EDGE = 6;
export function hoverInCorridor(obj, g, speed = 3) {
  const middleY = obj.y + g / 2;
  if (!profileAt(middleY)) return;
  const { left, right } = freeRange(middleY, obj.x + g / 2);
  const target = Math.max(left + HOVER_EDGE, Math.min(right - g - HOVER_EDGE, obj.x));
  obj.x += Math.max(-speed, Math.min(speed, target - obj.x));
}

// Pushes a ship (x/y = top left corner) out of the rock; returns true on contact
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

// Every host step: scroll, remove at the bottom, check players
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

// Online: segments as text "l r im ib,l r im ib" (top, bottom), integers
// Bone segments (island boss) carry a fifth number 1 at the top point
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

// Client: create, move and remove segments from the snapshot
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
