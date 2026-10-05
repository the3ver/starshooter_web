// Spectre-SR (Model-ID `sniper`): Fadenkreuz-Laser mit Aufladen und Betaeubungsgranate (siehe AGENTS.md, Abschnitt Sniper).
// Stand S2: Fadenkreuz (Grundposition, Auto-Zielen ab Laser-Stufe 4) und Sofort-Schuss auf den Trefferkreis.
// pState ist `state` (P1) oder `state.p2`, pKey 'p1' / 'p2'.
// Zustand pro Spieler: sniperZielX/sniperZielY (Fadenkreuz-Mitte im Spielfeld, null = noch nicht gesetzt),
// sniperCooldown (Schritte bis zum naechsten Schuss), sniperGehalten (Laser-Taste im Schritt davor; Grundlage fuer
// das spaetere Flanken-/Lade-Modell).

import { state, dom, config, arrays, shipColors } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Hack from './hack.js';
import { schadeZiel } from './gleve.js';

export const FADENKREUZ_ABSTAND = 220; // px ueber der Schiffsoberkante
export const SCHUSS_ENERGIE = 6;
const AUTOZIEL_REICHWEITE = 320;
const STRAHL_SCHRITTE = 8;

// Werte pro Laser-Stufe 1-5
const RADIUS = [6, 14, 22, 22, 30];
const SCHADEN = [30, 35, 40, 45, 50];
const SCHUSS_ABSTAND = [24, 21, 21, 18, 18];
const AUTOZIEL_TEMPO = [0, 0, 0, 6, 10]; // px pro Schritt, 0 = kein Auto-Zielen

function stufenIndex(pState) {
  return Math.max(1, Math.min(5, pState.laserStufe || 1)) - 1;
}

export function istSniper(pState) {
  return !!pState && pState.selectedShipModel === 'sniper';
}

export function trefferRadius(pState) { return RADIUS[stufenIndex(pState)]; }
export function schussSchaden(pState) { return SCHADEN[stufenIndex(pState)]; }
export function schussAbstand(pState) { return SCHUSS_ABSTAND[stufenIndex(pState)]; }
export function autoZielTempo(pState) { return AUTOZIEL_TEMPO[stufenIndex(pState)]; }

function schiffFarbe(pState) {
  const c = shipColors[pState.selectedShipColor];
  return c ? c.prim : '#ffffff';
}

// Schiffsmitte oben (Strahlursprung)
function schiffsNase(pState) {
  return { x: pState.x + 15, y: pState.y };
}

// Grundposition des Fadenkreuzes: ueber dem Schiff, am oberen Feldrand begrenzt
export function grundPosition(pState) {
  const n = schiffsNase(pState);
  return { x: n.x, y: Math.max(0, n.y - FADENKREUZ_ABSTAND) };
}

// --- ZIELE ---

function zielBox(z) {
  const g = z.groesse || 20;
  const w = z.width || g;
  const h = z.height || g;
  const pad = z.istBoss ? g * 0.15 : 0;
  return { x1: z.x + pad, y1: z.y + pad, x2: z.x + w - pad, y2: z.y + h - pad };
}

function zielMitte(z) {
  const b = zielBox(z);
  return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
}

// Schneidet die Box den Kreis? (naechster Punkt der Box zum Kreismittelpunkt)
function boxSchneidetKreis(b, cx, cy, r) {
  const nx = Math.max(b.x1, Math.min(cx, b.x2));
  const ny = Math.max(b.y1, Math.min(cy, b.y2));
  return Math.hypot(nx - cx, ny - cy) <= r;
}

function alleZiele() {
  return [...arrays.feinde, ...arrays.asteroiden, ...arrays.bosses, ...arrays.bossRaketenArray, ...arrays.bossBombenArray];
}

// Ziele im Trefferkreis (Magma bleibt unversehrt und zaehlt nicht mit)
export function zieleImKreis(cx, cy, r) {
  return alleZiele().filter(z => !z.istUnzerstoerbar && (z.hp === undefined || z.hp > 0) && (z.immune || 0) <= 0
    && boxSchneidetKreis(zielBox(z), cx, cy, r));
}

// --- AUTO-ZIELEN ---

// Naechster Gegner (Feind/Boss, kein Asteroid) oberhalb des Schiffs innerhalb der Reichweite
function autoZiel(pState) {
  const n = schiffsNase(pState);
  let bestes = null;
  let besteDist = Infinity;
  for (const z of [...arrays.feinde, ...arrays.bosses]) {
    if (z.istUnzerstoerbar || (z.hp !== undefined && z.hp <= 0)) continue;
    const m = zielMitte(z);
    if (m.y >= n.y) continue;
    const dist = Math.hypot(m.x - n.x, m.y - n.y);
    if (dist <= AUTOZIEL_REICHWEITE && dist < besteDist) {
      besteDist = dist;
      bestes = m;
    }
  }
  return bestes;
}

function gleiteZu(pState, zx, zy, tempo) {
  const dx = zx - pState.sniperZielX;
  const dy = zy - pState.sniperZielY;
  const dist = Math.hypot(dx, dy);
  if (dist <= tempo) {
    pState.sniperZielX = zx;
    pState.sniperZielY = zy;
  } else {
    pState.sniperZielX += dx / dist * tempo;
    pState.sniperZielY += dy / dist * tempo;
  }
}

function aktualisiereFadenkreuz(pState) {
  const grund = grundPosition(pState);
  const tempo = autoZielTempo(pState);
  if (pState.sniperZielX == null || tempo === 0) {
    // Kein Auto-Zielen: Fadenkreuz klebt an der Grundposition (auch beim Wechsel auf eine niedrigere Stufe)
    pState.sniperZielX = grund.x;
    pState.sniperZielY = grund.y;
    return;
  }
  const ziel = autoZiel(pState);
  const sollX = ziel ? ziel.x : grund.x;
  const sollY = ziel ? ziel.y : grund.y;
  gleiteZu(pState, sollX, sollY, tempo);
  pState.sniperZielX = Math.max(0, Math.min(config.spielfeldBreite, pState.sniperZielX));
  pState.sniperZielY = Math.max(0, Math.min(config.spielfeldHoehe, pState.sniperZielY));
}

// --- DARSTELLUNG ---

const fadenkreuze = { p1: null, p2: null };
const strahlen = []; // { el, rest }

function holeFadenkreuz(pKey) {
  let el = fadenkreuze[pKey];
  if (!el || !el.isConnected) {
    el = document.createElement('div');
    el.classList.add('sniper-fadenkreuz', 'sniper-fadenkreuz-' + pKey);
    for (const seite of ['o', 'u', 'l', 'r']) {
      const strich = document.createElement('i');
      strich.classList.add('sniper-strich', 'sniper-strich-' + seite);
      el.appendChild(strich);
    }
    dom.spielfeld.appendChild(el);
    fadenkreuze[pKey] = el;
  }
  return el;
}

function zeigeFadenkreuz(pState, pKey) {
  const el = holeFadenkreuz(pKey);
  const r = trefferRadius(pState);
  const farbe = schiffFarbe(pState);
  el.style.width = (r * 2) + 'px';
  el.style.height = (r * 2) + 'px';
  el.style.left = (pState.sniperZielX - r) + 'px';
  el.style.top = (pState.sniperZielY - r) + 'px';
  el.style.color = farbe;
  el.style.borderColor = farbe;
  el.style.boxShadow = `0 0 6px ${farbe}, inset 0 0 4px ${farbe}`;
}

function entferneFadenkreuz(pKey) {
  if (fadenkreuze[pKey]) {
    fadenkreuze[pKey].remove();
    fadenkreuze[pKey] = null;
  }
}

function erzeugeStrahl(pState) {
  const n = schiffsNase(pState);
  const dx = pState.sniperZielX - n.x;
  const dy = pState.sniperZielY - n.y;
  const dist = Math.hypot(dx, dy);
  const farbe = schiffFarbe(pState);
  const el = document.createElement('div');
  el.classList.add('sniper-strahl');
  el.style.height = dist + 'px';
  el.style.top = (n.y - dist) + 'px';
  el.style.left = (n.x - 1.5) + 'px';
  el.style.transform = `rotate(${Math.atan2(dx, -dy) * 180 / Math.PI}deg)`;
  el.style.boxShadow = `0 0 4px #ffffff, 0 0 8px ${farbe}, 0 0 14px ${farbe}`;
  dom.spielfeld.appendChild(el);
  strahlen.push({ el, rest: STRAHL_SCHRITTE });
}

function aktualisiereStrahlen() {
  for (let i = strahlen.length - 1; i >= 0; i--) {
    const s = strahlen[i];
    s.rest--;
    if (s.rest <= 0 || !s.el.isConnected) {
      s.el.remove();
      strahlen.splice(i, 1);
    } else {
      s.el.style.opacity = s.rest / STRAHL_SCHRITTE;
    }
  }
}

function erzeugeEinschlag(pState, cx, cy) {
  Utils.erzeugeExplosion(cx, cy, '#ffffff', 6);
  Utils.erzeugeExplosion(cx, cy, schiffFarbe(pState), 4);
}

// --- SCHUSS ---

// Trifft Ziele im Kreis um das Fadenkreuz: Stufe 1-2 nur das naechste (Mitte am naechsten am Fadenkreuz), ab Stufe 3 alle.
// Gibt die Anzahl der getroffenen Ziele zurueck.
export function feuereSchuss(pState, pKey) {
  const cx = pState.sniperZielX;
  const cy = pState.sniperZielY;
  let ziele = zieleImKreis(cx, cy, trefferRadius(pState));
  if ((pState.laserStufe || 1) < 3 && ziele.length > 1) {
    let bestes = ziele[0];
    let besteDist = Infinity;
    for (const z of ziele) {
      const m = zielMitte(z);
      const d = Math.hypot(m.x - cx, m.y - cy);
      if (d < besteDist) {
        besteDist = d;
        bestes = z;
      }
    }
    ziele = [bestes];
  }
  const schaden = schussSchaden(pState);
  for (const z of ziele) {
    const m = zielMitte(z);
    erzeugeEinschlag(pState, m.x, m.y);
    schadeZiel(z, schaden, pKey);
  }
  if (!ziele.length) erzeugeEinschlag(pState, cx, cy);
  erzeugeStrahl(pState);
  Audio.playSniperSchuss(pState.laserStufe || 1);
  return ziele.length;
}

// Pro Schritt aus spieler.js (Energie-Phase, nach der Bewegung): Fadenkreuz pflegen und bei gehaltener Laser-Taste
// im Schussabstand schiessen. `gehalten` ist die Laser-Taste (Bot/Online liefern sie ebenfalls). Die Ausloesung haengt
// nur an `gehalten` und `sniperGehalten` (Vorschritt), damit ein Flanken-/Halte-Modell leicht ergaenzt werden kann.
export function aktualisiereSniper(pState, pKey, gehalten) {
  if (!istSniper(pState)) return false;
  aktualisiereStrahlen();
  if (pState.isDead || !state.spielLaeuft) {
    entferneFadenkreuz(pKey);
    pState.sniperGehalten = false;
    return false;
  }
  aktualisiereFadenkreuz(pState);
  zeigeFadenkreuz(pState, pKey);

  if (pState.sniperCooldown > 0) pState.sniperCooldown--;
  let geschossen = false;
  const kannSchiessen = gehalten && !Hack.hatHack(pState, 'waffenOffline');
  if (kannSchiessen && (pState.sniperCooldown || 0) <= 0
      && (pState.unbegrenzteEnergie || pState.energie >= SCHUSS_ENERGIE)) {
    if (!pState.unbegrenzteEnergie) pState.energie -= SCHUSS_ENERGIE;
    pState.sniperCooldown = schussAbstand(pState);
    feuereSchuss(pState, pKey);
    geschossen = true;
  }
  pState.sniperGehalten = !!gehalten;
  return geschossen;
}

// Fadenkreuz, Strahlen und Schusszustand eines Spielers zuruecksetzen (restartGame, Game Over, Schiffswechsel)
export function setzeZurueck(pState) {
  if (!pState) return false;
  pState.sniperZielX = null;
  pState.sniperZielY = null;
  pState.sniperCooldown = 0;
  pState.sniperGehalten = false;
  entferneFadenkreuz(pState === state ? 'p1' : 'p2');
  return true;
}

// Alle Sniper-Darstellungen entfernen (Game Over: danach laeuft keine Simulation mehr, die sie abraeumen wuerde)
export function entferneEffekte() {
  entferneFadenkreuz('p1');
  entferneFadenkreuz('p2');
  strahlen.forEach(s => s.el.remove());
  strahlen.length = 0;
}
