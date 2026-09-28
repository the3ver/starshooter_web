// Hack-Effekte des Hacker-Gegners. pState ist `state` (P1) oder `state.p2`.

import { state, dom } from './state.js';
import * as Audio from './audio.js';

export const HACK_EFFEKTE = ['invertiert', 'waffenOffline', 'tastenVertauscht', 'hudGlitch'];
export const HACK_DAUER = 180; // 3 s bei 60 FPS

// Richtungen: oben, unten, links, rechts
const RICHTUNGEN = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// Zufällige Permutation ohne Fixpunkt: keine Taste behält ihre Richtung
function zufallsDerangement() {
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

export function hackeSpieler(pState, typ = null) {
  if (!pState.hacks) pState.hacks = [];
  const effekt = typ || HACK_EFFEKTE[Math.floor(Math.random() * HACK_EFFEKTE.length)];
  const hack = { typ: effekt, timer: HACK_DAUER };
  if (effekt === 'tastenVertauscht') hack.perm = zufallsDerangement();
  pState.hacks.push(hack);
  return effekt;
}

export function tickHacks(pState) {
  if (!pState.hacks) return;
  for (const h of pState.hacks) h.timer--;
  pState.hacks = pState.hacks.filter(h => h.timer > 0);
}

export function hatHack(pState, typ) {
  return !!pState.hacks && pState.hacks.some(h => h.typ === typ);
}

// Bildet eine Bewegung (dx, dy) durch alle aktiven Steuerungs-Hacks ab
export function hackeBewegung(pState, dx, dy) {
  if (!pState.hacks || pState.hacks.length === 0) return { dx, dy };
  for (const h of pState.hacks) {
    if (h.typ === 'invertiert') {
      dx = -dx;
      dy = -dy;
    } else if (h.typ === 'tastenVertauscht') {
      let nx = 0, ny = 0;
      RICHTUNGEN.forEach(([rx, ry], k) => {
        const anteil = Math.max(0, dx * rx + dy * ry);
        const [zx, zy] = RICHTUNGEN[h.perm[k]];
        nx += anteil * zx;
        ny += anteil * zy;
      });
      dx = nx;
      dy = ny;
    }
  }
  return { dx, dy };
}

export function entferneHacks(pState) {
  pState.hacks = [];
}

// Aktualisiert die sichtbaren Hack-Anzeigen beider Spieler
export function zeigeHackStatus() {
  zeigeFuerSpieler(state, 'p1', dom.spieler, dom.uiContainerP1);
  if (state.p2) zeigeFuerSpieler(state.p2, 'p2', dom.spieler2, dom.uiContainerP2);
}

const HACK_NAMEN = {
  invertiert: 'INVERTED',
  waffenOffline: 'WEAPONS OFFLINE',
  tastenVertauscht: 'KEYS SCRAMBLED',
  hudGlitch: 'HUD GLITCH'
};

function zeigeFuerSpieler(pState, pKey, schiffEl, hudEl) {
  const hacks = pState.hacks || [];
  const aktiv = hacks.length > 0 && !pState.isDead;
  // Sound bei neuem Hack (funktioniert auch auf dem Online-Client, der nur Snapshots sieht)
  if (hacks.length > (pState.angezeigteHacks || 0)) Audio.playHack();
  pState.angezeigteHacks = hacks.length;
  if (hudEl) hudEl.classList.toggle('hud-glitch', hatHack(pState, 'hudGlitch'));
  if (schiffEl) schiffEl.classList.toggle('spieler-gehackt', aktiv);

  let label = document.getElementById('hack-label-' + pKey);
  if (!aktiv) {
    if (label) label.style.display = 'none';
    return;
  }
  if (!label) {
    label = document.createElement('div');
    label.id = 'hack-label-' + pKey;
    label.classList.add('hack-label');
    label.innerHTML = '<div class="hack-text"></div><div class="hack-restzeit-rahmen"><div class="hack-restzeit"></div></div>';
    dom.spielfeld.appendChild(label);
  }
  const text = hacks.map(h => HACK_NAMEN[h.typ]).join(' + ');
  const textEl = label.querySelector('.hack-text');
  if (textEl.textContent !== text) textEl.textContent = text;
  const restMax = Math.max(...hacks.map(h => h.timer));
  label.querySelector('.hack-restzeit').style.width = (restMax / HACK_DAUER * 100) + '%';
  label.style.display = 'block';
  label.style.left = (pState.x + 15) + 'px';
  label.style.top = (pState.y - 22) + 'px';
}
