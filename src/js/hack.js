// Hack-Effekte des Hacker-Gegners. pState ist `state` (P1) oder `state.p2`.

import { state, dom } from './state.js';
import * as Audio from './audio.js';

export const HACK_EFFECTS = ['inverted', 'weaponOffline', 'keySwapped', 'hudGlitch'];
export const HACK_DURATION = 180; // 3 s bei 60 FPS

// Richtungen: oben, unten, links, rechts
const DIRECTIONS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// Zufällige Permutation ohne Fixpunkt: keine Taste behält ihre Richtung
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

export function hackPlayer(pState, typ = null) {
  if (!pState.hacks) pState.hacks = [];
  const effect = typ || HACK_EFFECTS[Math.floor(Math.random() * HACK_EFFECTS.length)];
  const hack = { typ: effect, timer: HACK_DURATION };
  if (effect === 'keySwapped') hack.perm = randomDerangement();
  pState.hacks.push(hack);
  return effect;
}

export function tickHacks(pState) {
  if (!pState.hacks) return;
  for (const h of pState.hacks) h.timer--;
  pState.hacks = pState.hacks.filter(h => h.timer > 0);
}

export function hasHack(pState, typ) {
  return !!pState.hacks && pState.hacks.some(h => h.typ === typ);
}

// Bildet eine Bewegung (dx, dy) durch alle aktiven Steuerungs-Hacks ab
export function hackMovement(pState, dx, dy) {
  if (!pState.hacks || pState.hacks.length === 0) return { dx, dy };
  for (const h of pState.hacks) {
    if (h.typ === 'inverted') {
      dx = -dx;
      dy = -dy;
    } else if (h.typ === 'keySwapped') {
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

// Hack-Ton und HUD-Glitch beider Spieler; Schiffsklasse spieler-gehackt und das Label ueber dem Schiff
// zeichnet die Anzeige aus pState.hacks
export function showHackStatus() {
  showForPlayer(state, dom.uiContainerP1);
  if (state.p2) showForPlayer(state.p2, dom.uiContainerP2);
}

export const HACK_NAMES = {
  inverted: 'INVERTED',
  weaponOffline: 'WEAPONS OFFLINE',
  keySwapped: 'KEYS SCRAMBLED',
  hudGlitch: 'HUD GLITCH',
};

function showForPlayer(pState, hudEl) {
  const hacks = pState.hacks || [];
  // Sound bei neuem Hack (funktioniert auch auf dem Online-Client, der nur Snapshots sieht)
  if (hacks.length > (pState.shownHacks || 0)) Audio.playHack();
  pState.shownHacks = hacks.length;
  if (hudEl) hudEl.classList.toggle('hud-glitch', hasHack(pState, 'hudGlitch'));
}
