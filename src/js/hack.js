// Hack effects of the hacker enemy. pState is `state` (P1) or `state.p2`.

import { state, dom } from './state.js';
import * as Audio from './audio.js';

export const HACK_EFFECTS = ['inverted', 'weaponsOffline', 'keysSwapped', 'hudGlitch'];
export const HACK_DURATION = 180; // 3 s at 60 FPS

// Directions: top, bottom, left, right
const DIRECTIONS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// Random permutation without a fixed point: no key keeps its direction
function randomDerangement() {
  let perm;
  do {
    perm = [0, 1, 2, 3];
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
  } while (perm.some((p, i) => p === i));
  return perm;
}

export function hackPlayer(pState, type = null) {
  if (!pState.hacks) pState.hacks = [];
  const effect = type || HACK_EFFECTS[Math.floor(Math.random() * HACK_EFFECTS.length)];
  const hack = { type: effect, timer: HACK_DURATION };
  if (effect === 'keysSwapped') hack.perm = randomDerangement();
  pState.hacks.push(hack);
  return effect;
}

export function tickHacks(pState) {
  if (!pState.hacks) return;
  for (const h of pState.hacks) h.timer--;
  pState.hacks = pState.hacks.filter(h => h.timer > 0);
}

export function hasHack(pState, type) {
  return !!pState.hacks && pState.hacks.some(h => h.type === type);
}

// Maps a movement (dx, dy) through all active control hacks
export function hackMovement(pState, dx, dy) {
  if (!pState.hacks || pState.hacks.length === 0) return { dx, dy };
  for (const h of pState.hacks) {
    if (h.type === 'inverted') {
      dx = -dx;
      dy = -dy;
    } else if (h.type === 'keysSwapped') {
      let nx = 0,
        ny = 0;
      DIRECTIONS.forEach(([rx, ry], k) => {
        const share = Math.max(0, dx * rx + dy * ry);
        const [zx, zy] = DIRECTIONS[h.perm[k]];
        nx += share * zx;
        ny += share * zy;
      });
      dx = nx;
      dy = ny;
    }
  }
  return { dx, dy };
}

export function removeHacks(pState) {
  pState.hacks = [];
}

// Hack sound and HUD glitch for both players; the display draws the ship class spieler-gehackt and the label
// above the ship from pState.hacks
export function showHackStatus() {
  showForPlayer(state, dom.uiContainerP1);
  if (state.p2) showForPlayer(state.p2, dom.uiContainerP2);
}

export const HACK_NAMES = {
  inverted: 'INVERTED',
  weaponsOffline: 'WEAPONS OFFLINE',
  keysSwapped: 'KEYS SCRAMBLED',
  hudGlitch: 'HUD GLITCH',
};

function showForPlayer(pState, hudEl) {
  const hacks = pState.hacks || [];
  // Sound on a new hack (also works on the online client, which only sees snapshots)
  if (hacks.length > (pState.shownHacks || 0)) Audio.playHack();
  pState.shownHacks = hacks.length;
  if (hudEl) hudEl.classList.toggle('hud-glitch', hasHack(pState, 'hudGlitch'));
}
