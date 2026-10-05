// Spectre-SR (Model-ID `sniper`): Fadenkreuz-Laser mit Aufladen und Betaeubungsgranate (siehe AGENTS.md, Abschnitt Sniper).
// Stand S4: Fadenkreuz (Grundposition, Auto-Zielen ab Laser-Stufe 4), Sofort-Schuss auf den Trefferkreis, Aufladen
// (Druck startet Laden, Loslassen feuert) und Betaeubungsgranate auf der Raketen-Taste.
// pState ist `state` (P1) oder `state.p2`, pKey 'p1' / 'p2'.
// Zustand pro Spieler: sniperZielX/sniperZielY (Fadenkreuz-Mitte im Spielfeld, null = noch nicht gesetzt),
// sniperCooldown (Schritte bis zum naechsten Schuss), sniperGehalten (Laser-Taste im Schritt davor = Ladevorgang laeuft),
// sniperLadung (Ladeschritte 0-90), sniperVoll (Voll-Ton fuer diesen Ladevorgang schon gespielt).

import { state, dom, config, arrays, shipColors } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Hack from './hack.js';
import * as Network from './network.js';
import { schadeZiel } from './gleve.js';

export const FADENKREUZ_ABSTAND = 220; // px ueber der Schiffsoberkante
export const SCHUSS_ENERGIE = 6;
const AUTOZIEL_REICHWEITE = 320;
const STRAHL_SCHRITTE = 8;
export const LADEN_AB = 10; // Haltedauer in Schritten, ab der aus dem Normalschuss ein Ladeschuss wird
export const LADUNG_VOLL = 90; // Schritte bis zur vollen Ladung (1,5 s)
export const LADE_ENERGIE = 19; // zusaetzliche Energie fuer das Laden von Schritt 10 bis 90 (gleichmaessig)
const LADE_KOSTEN = LADE_ENERGIE / (LADUNG_VOLL - LADEN_AB);
export const MAX_SCHADENSFAKTOR = 4;
export const MAX_RADIUSFAKTOR = 1.5;

// Werte pro Laser-Stufe 1-5
const RADIUS = [6, 14, 22, 22, 30];
const SCHADEN = [30, 35, 40, 45, 50];
const SCHUSS_ABSTAND = [24, 21, 21, 18, 18];
const AUTOZIEL_TEMPO = [0, 0, 0, 6, 10]; // px pro Schritt, 0 = kein Auto-Zielen

// Granate, Werte pro Raketen-Stufe 1-5
export const GRANATE_FLUG = 30; // Schritte bis zur Explosion
const GRANATE_BOGEN = 70; // px Bogenhoehe in der Mitte des Flugs
const STOSS_SCHRITTE = 10; // Wegstossen gleitet ueber so viele Schritte
const WELLE_SCHRITTE = 14; // Wachstum des Druckwellen-Rings
const GRANATE_RADIUS = [70, 80, 90, 100, 110];
const GRANATE_STOSS = [60, 70, 80, 90, 100];
const GRANATE_BETAEUBUNG = [60, 72, 90, 90, 120];
const GRANATE_SCHADEN = [0, 15, 25, 35, 45];
const GRANATE_COOLDOWN = [240, 210, 180, 180, 150];

// Granaten-Taste: Tippen (< HALTEN_AB Schritte) = Granate + EMP, Halten (ab HALTEN_AB) = Minen (E2, derzeit leerer Haken)
export const HALTEN_AB = 10;
// EMP (beim Tippen): Ring waechst in EMP_SCHRITTE auf den Radius der Raketen-Stufe, zerstoert feindliche Geschosse und betaeubt Feinde
export const EMP_SCHRITTE = 10;
export const EMP_BETAEUBUNG = 30;
const EMP_RADIUS = [70, 80, 90, 100, 110];

function stufenIndex(pState) {
  return Math.max(1, Math.min(5, pState.laserStufe || 1)) - 1;
}

function raketenIndex(pState) {
  return Math.max(1, Math.min(5, pState.raketenStufe || 1)) - 1;
}

export function istSniper(pState) {
  return !!pState && pState.selectedShipModel === 'sniper';
}

export function trefferRadius(pState) { return RADIUS[stufenIndex(pState)]; }
export function schussSchaden(pState) { return SCHADEN[stufenIndex(pState)]; }
export function schussAbstand(pState) { return SCHUSS_ABSTAND[stufenIndex(pState)]; }
export function autoZielTempo(pState) { return AUTOZIEL_TEMPO[stufenIndex(pState)]; }
export function granatenCooldown(pState) { return GRANATE_COOLDOWN[raketenIndex(pState)]; }
export function granatenRadius(pState) { return GRANATE_RADIUS[raketenIndex(pState)]; }
export function granatenStoss(pState) { return GRANATE_STOSS[raketenIndex(pState)]; }
export function granatenBetaeubung(pState) { return GRANATE_BETAEUBUNG[raketenIndex(pState)]; }
export function granatenSchaden(pState) { return GRANATE_SCHADEN[raketenIndex(pState)]; }
export function empRadius(pState) { return EMP_RADIUS[raketenIndex(pState)]; }

// Ladeanteil 0-1 (unter 10 Schritten Haltedauer = Normalschuss, also 0)
function ladeAnteil(ladung) {
  return ladung < LADEN_AB ? 0 : Math.min(1, ladung / LADUNG_VOLL);
}
export function schadensFaktor(ladung) { return 1 + (MAX_SCHADENSFAKTOR - 1) * ladeAnteil(ladung); }
export function radiusFaktor(ladung) { return 1 + (MAX_RADIUSFAKTOR - 1) * ladeAnteil(ladung); }
export function istVoll(ladung) { return ladung >= LADUNG_VOLL; }
// Laedt der Spieler gerade (Taste gehalten)? Dann gibt es keine Energie-Regeneration.
export function laedt(pState) { return !!pState && istSniper(pState) && !!pState.sniperGehalten; }

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

function zeigeLadering(el, pState) {
  let ring = el.querySelector('.sniper-ladering');
  if (!ring) {
    ring = document.createElement('div');
    ring.classList.add('sniper-ladering');
    el.appendChild(ring);
  }
  const ladung = pState.sniperLadung || 0;
  const sichtbar = !!pState.sniperGehalten && ladung >= LADEN_AB;
  ring.style.display = sichtbar ? 'block' : 'none';
  ring.classList.toggle('voll', sichtbar && istVoll(ladung));
  if (!sichtbar) return;
  // Der Ring zeigt den aktuellen Trefferkreis: waechst von Radius x1 auf x1,5; Deckkraft und Randstaerke steigen mit der Ladung
  const d = trefferRadius(pState) * 2 * radiusFaktor(ladung);
  const anteil = ladeAnteil(ladung);
  ring.style.width = d + 'px';
  ring.style.height = d + 'px';
  ring.style.opacity = 0.45 + 0.55 * anteil;
  ring.style.borderWidth = (1.5 + 2.5 * anteil) + 'px';
}

function zeigeFadenkreuz(pState, pKey) {
  const el = holeFadenkreuz(pKey);
  const r = trefferRadius(pState);
  const farbe = schiffFarbe(pState);
  zeigeLadering(el, pState);
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

function erzeugeStrahl(pState, anteil = 0) {
  const n = schiffsNase(pState);
  const breite = 3 + 9 * anteil;
  const dx = pState.sniperZielX - n.x;
  const dy = pState.sniperZielY - n.y;
  const dist = Math.hypot(dx, dy);
  const farbe = schiffFarbe(pState);
  const el = document.createElement('div');
  el.classList.add('sniper-strahl');
  el.style.height = dist + 'px';
  el.style.top = (n.y - dist) + 'px';
  el.style.width = breite + 'px';
  el.style.left = (n.x - breite / 2) + 'px';
  el.style.transform = `rotate(${Math.atan2(dx, -dy) * 180 / Math.PI}deg)`;
  el.style.boxShadow = `0 0 ${4 + 6 * anteil}px #ffffff, 0 0 ${8 + 10 * anteil}px ${farbe}, 0 0 ${14 + 18 * anteil}px ${farbe}`;
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

function erzeugeEinschlag(pState, cx, cy, anteil = 0) {
  Utils.erzeugeExplosion(cx, cy, '#ffffff', 6 + Math.round(8 * anteil));
  Utils.erzeugeExplosion(cx, cy, schiffFarbe(pState), 4 + Math.round(6 * anteil));
}

// --- SCHUSS ---

// Trifft Ziele im Kreis um das Fadenkreuz: Stufe 1-2 nur das naechste (Mitte am naechsten am Fadenkreuz), ab Stufe 3 alle.
// `ladung` (Schritte, 0 = Normalschuss) skaliert Schaden (x1 bis x4) und Radius (x1 bis x1,5); der voll geladene Schuss
// trifft unabhaengig von der Stufe alle Ziele im Kreis und ignoriert Schilde (Schild weg, Schaden auf die HP).
// Gibt die Anzahl der getroffenen Ziele zurueck.
export function feuereSchuss(pState, pKey, ladung = 0) {
  const cx = pState.sniperZielX;
  const cy = pState.sniperZielY;
  const voll = istVoll(ladung);
  const anteil = ladeAnteil(ladung);
  let ziele = zieleImKreis(cx, cy, trefferRadius(pState) * radiusFaktor(ladung));
  if (!voll && (pState.laserStufe || 1) < 3 && ziele.length > 1) {
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
  const schaden = schussSchaden(pState) * schadensFaktor(ladung);
  for (const z of ziele) {
    const m = zielMitte(z);
    erzeugeEinschlag(pState, m.x, m.y, anteil);
    if (voll && (z.schildHp || 0) > 0) {
      z.schildHp = 0;
      if (z.schildEl) {
        z.schildEl.remove();
        z.schildEl = null;
      }
    }
    schadeZiel(z, schaden, pKey);
  }
  if (!ziele.length) erzeugeEinschlag(pState, cx, cy, anteil);
  erzeugeStrahl(pState, anteil);
  Audio.playSniperSchuss(pState.laserStufe || 1, anteil);
  return ziele.length;
}

function setzeLadungZurueck(pState) {
  pState.sniperLadung = 0;
  pState.sniperVoll = false;
}

// Einen Ladeschritt (Taste gehalten): die ersten 10 Schritte kosten nichts, danach 19/80 Energie pro Schritt.
// Reicht die Energie nicht (es muss immer noch der Schuss mit 6 Energie moeglich bleiben), bleibt die Ladung stehen.
function lade(pState) {
  if ((pState.sniperLadung || 0) >= LADUNG_VOLL) return;
  if (pState.sniperLadung >= LADEN_AB && !pState.unbegrenzteEnergie) {
    if (pState.energie - LADE_KOSTEN < SCHUSS_ENERGIE) return;
    pState.energie -= LADE_KOSTEN;
  }
  pState.sniperLadung++;
  if (istVoll(pState.sniperLadung) && !pState.sniperVoll) {
    pState.sniperVoll = true;
    Audio.playSniperVoll();
  }
}

// Schuss mit Schussabstand-Sperre und Energiepruefung; false = kein Schuss (Ladung verfaellt)
function versuche(pState, pKey, ladung) {
  if ((pState.sniperCooldown || 0) > 0) return false;
  if (!pState.unbegrenzteEnergie && pState.energie < SCHUSS_ENERGIE) return false;
  if (!pState.unbegrenzteEnergie) pState.energie -= SCHUSS_ENERGIE;
  pState.sniperCooldown = schussAbstand(pState);
  feuereSchuss(pState, pKey, ladung);
  return true;
}

// --- GRANATE ---

const granaten = []; // { id, el, pKey, x, y, startX, startY, zielX, zielY, rest, rot, werte }
let granatenId = 0;
const stoesse = []; // { z, vx, vy, rest, pKey } laufendes Wegstossen
const wellen = []; // { el, pKey, cx, cy, radius, rest }
const netzGranaten = []; // Online-Client: { id, el, pKey } nach Snapshot der Granaten des Hosts

// Wurf zum Fadenkreuz (Position beim Wurf), Flug in GRANATE_FLUG Schritten im Bogen; die Werte der Stufe gelten ab dem Wurf.
export function werfeGranate(pState, pKey) {
  const n = schiffsNase(pState);
  const grund = grundPosition(pState);
  const zx = pState.sniperZielX != null ? pState.sniperZielX : grund.x;
  const zy = pState.sniperZielY != null ? pState.sniperZielY : grund.y;
  const el = document.createElement('div');
  el.classList.add('sniper-granate');
  el.style.left = (n.x - 7) + 'px';
  el.style.top = (n.y - 7) + 'px';
  dom.spielfeld.appendChild(el);
  granaten.push({
    id: 'sg_' + (++granatenId), el, pKey, x: n.x, y: n.y, startX: n.x, startY: n.y, zielX: zx, zielY: zy, rest: GRANATE_FLUG, rot: 0,
    werte: {
      radius: granatenRadius(pState), stoss: granatenStoss(pState), betaeubung: granatenBetaeubung(pState),
      schaden: granatenSchaden(pState), loescht: (pState.raketenStufe || 1) >= 5
    }
  });
}

function aktualisiereGranaten(pKey) {
  for (let i = granaten.length - 1; i >= 0; i--) {
    const g = granaten[i];
    if (g.pKey !== pKey) continue;
    g.rest--;
    if (g.rest <= 0 || !g.el.isConnected) {
      g.el.remove();
      granaten.splice(i, 1);
      if (g.rest <= 0) explodiereGranate(g);
      continue;
    }
    const t = 1 - g.rest / GRANATE_FLUG;
    const x = g.startX + (g.zielX - g.startX) * t;
    const y = g.startY + (g.zielY - g.startY) * t - Math.sin(Math.PI * t) * GRANATE_BOGEN;
    g.rot += 24;
    g.x = x;
    g.y = y;
    g.el.style.left = (x - 7) + 'px';
    g.el.style.top = (y - 7) + 'px';
    g.el.style.transform = 'rotate(' + g.rot + 'deg)';
  }
}

function erzeugeDruckwelle(cx, cy, radius, pKey) {
  const el = document.createElement('div');
  el.classList.add('sniper-druckwelle');
  el.style.left = cx + 'px';
  el.style.top = cy + 'px';
  el.style.width = '0px';
  el.style.height = '0px';
  dom.spielfeld.appendChild(el);
  wellen.push({ el, pKey, cx, cy, radius, rest: WELLE_SCHRITTE });
}

function aktualisiereWellen(pKey) {
  for (let i = wellen.length - 1; i >= 0; i--) {
    const w = wellen[i];
    if (pKey && w.pKey !== pKey) continue;
    w.rest--;
    if (w.rest <= 0 || !w.el.isConnected) {
      w.el.remove();
      wellen.splice(i, 1);
      continue;
    }
    const t = 1 - w.rest / WELLE_SCHRITTE;
    const d = w.radius * 2 * Math.sqrt(t); // schnell am Anfang, gegen Ende auslaufend
    w.el.style.width = d + 'px';
    w.el.style.height = d + 'px';
    w.el.style.left = (w.cx - d / 2) + 'px';
    w.el.style.top = (w.cy - d / 2) + 'px';
    w.el.style.opacity = 1 - t * 0.85;
  }
}

function wegstossZiele() {
  return [...arrays.feinde, ...arrays.asteroiden, ...arrays.bosses];
}

function loescheGeschosse(array, cx, cy, r) {
  for (let i = array.length - 1; i >= 0; i--) {
    const p = array[i];
    const b = { x1: p.x, y1: p.y, x2: p.x + (p.width || p.groesse || 4), y2: p.y + (p.height || p.groesse || 4) };
    if (boxSchneidetKreis(b, cx, cy, r)) {
      Utils.erzeugeExplosion((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, '#ffffff', 3);
      if (p.el) p.el.remove();
      array.splice(i, 1);
    }
  }
}

function explodiereGranate(g) {
  const cx = g.zielX;
  const cy = g.zielY;
  const w = g.werte;
  Audio.playGranate();
  Utils.erzeugeExplosion(cx, cy, '#ffffff', 10);
  Utils.erzeugeExplosion(cx, cy, '#ffeb3b', 10);
  erzeugeDruckwelle(cx, cy, w.radius, g.pKey);
  // Online-Host: der Client zeigt die Druckwelle ueber ein Ereignis (Granate verschwindet im Snapshot)
  if (state.gameMode === 'online' && state.network && state.network.isHost) {
    Network.sendNetworkEvent({ type: 'granate_detonated', x: Math.round(cx * 10) / 10, y: Math.round(cy * 10) / 10, radius: w.radius, owner: g.pKey });
  }

  for (const z of wegstossZiele().filter(t => (t.hp === undefined || t.hp > 0) && boxSchneidetKreis(zielBox(t), cx, cy, w.radius))) {
    const m = zielMitte(z);
    let dx = m.x - cx;
    let dy = m.y - cy;
    let dist = Math.hypot(dx, dy);
    if (dist < 0.001) { dx = 0; dy = -1; dist = 1; }
    if (w.schaden > 0 && !z.istUnzerstoerbar) schadeZiel(z, w.schaden, g.pKey);
    // Vom Schaden zerstoert: nichts mehr zu tun
    if (!wegstossZiele().includes(z)) continue;
    if (!z.istBoss) {
      stoesse.push({ z, vx: dx / dist * w.stoss / STOSS_SCHRITTE, vy: dy / dist * w.stoss / STOSS_SCHRITTE, rest: STOSS_SCHRITTE, pKey: g.pKey });
    }
    if (z.istFeind || z.istBoss) {
      const dauer = z.istBoss ? Math.round(w.betaeubung / 2) : w.betaeubung;
      z.betaeubt = Math.max(z.betaeubt || 0, dauer);
      if (z.el) z.el.classList.add('betaeubt');
    }
  }

  if (w.loescht) {
    loescheGeschosse(arrays.feindLaserArray, cx, cy, w.radius);
    loescheGeschosse(arrays.bossLaserArray, cx, cy, w.radius);
    loescheGeschosse(arrays.hackProjektilArray, cx, cy, w.radius);
  }
}

// --- GRANATEN-TASTE (Tippen / Halten) und EMP ---

const emps = []; // { el, pKey, cx, cy, radius, rest }

// Mittelpunkt des Schiffs (EMP-Ursprung)
function schiffsMitte(pState) {
  return { x: pState.x + config.spielerGroesse / 2, y: pState.y + config.spielerGroesse / 2 };
}

function erzeugeEmpRing(cx, cy, radius, pKey) {
  const el = document.createElement('div');
  el.classList.add('sniper-emp');
  el.style.left = cx + 'px';
  el.style.top = cy + 'px';
  el.style.width = '0px';
  el.style.height = '0px';
  dom.spielfeld.appendChild(el);
  emps.push({ el, pKey, cx, cy, radius, rest: EMP_SCHRITTE });
}

function aktualisiereEmps(pKey) {
  for (let i = emps.length - 1; i >= 0; i--) {
    const e = emps[i];
    if (pKey && e.pKey !== pKey) continue;
    e.rest--;
    if (e.rest <= 0 || !e.el.isConnected) {
      e.el.remove();
      emps.splice(i, 1);
      continue;
    }
    const t = 1 - e.rest / EMP_SCHRITTE;
    const d = e.radius * 2 * t;
    e.el.style.width = d + 'px';
    e.el.style.height = d + 'px';
    e.el.style.left = (e.cx - d / 2) + 'px';
    e.el.style.top = (e.cy - d / 2) + 'px';
    e.el.style.opacity = 1 - t * 0.8;
  }
}

// Feindliche Geschosse im Radius entfernen (mit kleinem Funken); Bomben ohne Detonation
function zerstoereGeschosse(array, cx, cy, r) {
  for (let i = array.length - 1; i >= 0; i--) {
    const p = array[i];
    const b = { x1: p.x, y1: p.y, x2: p.x + (p.width || p.groesse || 4), y2: p.y + (p.height || p.groesse || 4) };
    if (boxSchneidetKreis(b, cx, cy, r)) {
      Utils.erzeugeExplosion((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, '#4fc3f7', 4);
      if (p.el) p.el.remove();
      array.splice(i, 1);
    }
  }
}

// EMP ums eigene Schiff: Geschosse zerstoeren, Feinde (keine Bosse, keine Asteroiden) 30 Schritte betaeuben, kein Schaden.
export function loeseEmpAus(pState, pKey) {
  const m = schiffsMitte(pState);
  const r = empRadius(pState);
  Audio.playEmp();
  erzeugeEmpRing(m.x, m.y, r, pKey);
  for (const liste of [arrays.feindLaserArray, arrays.bossLaserArray, arrays.hackProjektilArray, arrays.bossRaketenArray, arrays.bossBombenArray]) {
    zerstoereGeschosse(liste, m.x, m.y, r);
  }
  for (const f of arrays.feinde) {
    if (f.hp !== undefined && f.hp <= 0) continue;
    if (!boxSchneidetKreis(zielBox(f), m.x, m.y, r)) continue;
    f.betaeubt = Math.max(f.betaeubt || 0, EMP_BETAEUBUNG);
    if (f.el) f.el.classList.add('betaeubt');
  }
  if (state.gameMode === 'online' && state.network && state.network.isHost) {
    Network.sendNetworkEvent({ type: 'emp_ausgeloest', x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10, radius: r, owner: pKey });
  }
}

// Haken fuer das Halten der Granaten-Taste (E2: Minen legen). `schritte` = bisherige Haltedauer, ab HALTEN_AB aufgerufen.
// Derzeit ohne Wirkung: kein Wurf, kein EMP, kein Cooldown.
export function haltenSchritt(pState, pKey, schritte) { // eslint-disable-line no-unused-vars
}

// Tippen: Granate ins Fadenkreuz und EMP, danach startet der Cooldown
function tippeGranate(pState, pKey) {
  pState.raketenCooldown = granatenCooldown(pState);
  werfeGranate(pState, pKey);
  loeseEmpAus(pState, pKey);
}

// Pro Schritt aus waffen.js (statt der Raketen): `gehalten` ist die Raketen-Taste. Druck startet die Zaehlung, Loslassen
// entscheidet: unter HALTEN_AB Schritten (und freiem Cooldown) = Tippen, sonst tut das Loslassen nichts (Halten gehoert den Minen).
export function aktualisiereGranatenTaste(pState, pKey, gehalten) {
  if (!istSniper(pState)) return;
  const sperre = Hack.hatHack(pState, 'waffenOffline') || pState.isDead || !state.spielLaeuft;
  if (gehalten && !sperre) {
    if (!pState.granateGehalten) pState.granateSchritte = 0;
    pState.granateGehalten = true;
    pState.granateSchritte = (pState.granateSchritte || 0) + 1;
    if (pState.granateSchritte >= HALTEN_AB) haltenSchritt(pState, pKey, pState.granateSchritte);
  } else if (pState.granateGehalten) {
    const schritte = pState.granateSchritte || 0;
    pState.granateGehalten = false;
    pState.granateSchritte = 0;
    if (!sperre && schritte < HALTEN_AB && (pState.raketenCooldown || 0) <= 0) tippeGranate(pState, pKey);
  }
}

// Wegstossen: pro Schritt ein Stueck, am Feld begrenzt (seitlich und oben; unten darf ein Ziel das Feld verlassen)
function aktualisiereStoesse(pKey) {
  for (let i = stoesse.length - 1; i >= 0; i--) {
    const s = stoesse[i];
    if (s.pKey !== pKey) continue;
    const z = s.z;
    s.rest--;
    if (s.rest < 0 || !wegstossZiele().includes(z)) {
      stoesse.splice(i, 1);
      continue;
    }
    const g = z.groesse || 30;
    const nx = Math.max(0, Math.min(config.spielfeldBreite - g, z.x + s.vx));
    let ny = z.y + s.vy;
    if (ny < 0 && z.y >= 0) ny = 0;
    const ddx = nx - z.x;
    const ddy = ny - z.y;
    z.x = nx;
    z.y = ny;
    if (z.basisX !== undefined) z.basisX += ddx;
    if (z.festX !== undefined) z.festX += ddx;
    if (z.festY !== undefined) z.festY += ddy;
    if (z.el) {
      z.el.style.left = z.x + 'px';
      z.el.style.top = z.y + 'px';
    }
    if (s.rest === 0) stoesse.splice(i, 1);
  }
}

function entferneGranatenEffekte(pKey) {
  for (const liste of [granaten, wellen, stoesse, netzGranaten, emps]) {
    for (let i = liste.length - 1; i >= 0; i--) {
      if (pKey && liste[i].pKey !== pKey) continue;
      if (liste[i].el) liste[i].el.remove();
      liste.splice(i, 1);
    }
  }
}

// Pro Schritt aus spieler.js (Energie-Phase, nach der Bewegung): Fadenkreuz pflegen und Schuss ausloesen.
// `gehalten` ist die Laser-Taste (Bot/Online liefern sie ebenfalls). Auswahl des Modells:
// - normal: Druck startet das Laden, Loslassen feuert (Haltedauer unter 10 Schritten = Normalschuss, sonst Ladeschuss).
//   Wird in der Schussabstand-Sperre losgelassen, faellt der Schuss (samt Ladung) automatisch, sobald die Sperre abläuft.
// - `auto` (Joystick-Autofeuer am Handy): Dauerfeuer aus Normalschuessen im Schussabstand, kein Laden.
// Gibt zurueck, ob in diesem Schritt geschossen wurde.
export function aktualisiereSniper(pState, pKey, gehalten, auto = false) {
  if (!istSniper(pState)) return false;
  aktualisiereStrahlen();
  aktualisiereGranaten(pKey);
  aktualisiereStoesse(pKey);
  aktualisiereWellen(pKey);
  aktualisiereEmps(pKey);
  if (pState.isDead || !state.spielLaeuft) {
    entferneFadenkreuz(pKey);
    pState.sniperGehalten = false;
    pState.sniperGepuffert = null;
    setzeLadungZurueck(pState);
    return false;
  }
  aktualisiereFadenkreuz(pState);

  if (pState.sniperCooldown > 0) pState.sniperCooldown--;
  let geschossen = false;
  const kannSchiessen = !Hack.hatHack(pState, 'waffenOffline');
  // In der Sperre losgelassener Schuss: faellt, sobald die Sperre abgelaufen ist
  if (pState.sniperGepuffert != null && pState.sniperCooldown <= 0) {
    if (kannSchiessen) geschossen = versuche(pState, pKey, pState.sniperGepuffert);
    pState.sniperGepuffert = null;
  }
  if (auto) {
    setzeLadungZurueck(pState);
    pState.sniperGehalten = false;
    if (gehalten && kannSchiessen) geschossen = versuche(pState, pKey, 0);
  } else {
    const haelt = !!gehalten && kannSchiessen;
    if (haelt) {
      if (!pState.sniperGehalten) setzeLadungZurueck(pState); // Druck
      lade(pState);
    } else if (pState.sniperGehalten && kannSchiessen) {
      // Loslassen: sofort feuern oder bis zum Ende der Sperre vormerken
      if (pState.sniperCooldown > 0) pState.sniperGepuffert = pState.sniperLadung || 0;
      else geschossen = versuche(pState, pKey, pState.sniperLadung || 0);
      setzeLadungZurueck(pState);
    } else {
      setzeLadungZurueck(pState);
    }
    pState.sniperGehalten = haelt;
  }
  zeigeFadenkreuz(pState, pKey);
  return geschossen;
}

// --- ONLINE ---

// Host: Sniper-Zustand eines Spielers fuer den Snapshot (leer bei anderen Schiffen)
export function netzZustand(pState) {
  if (!istSniper(pState)) return {};
  const grund = grundPosition(pState);
  return {
    sniperZielX: pState.sniperZielX != null ? pState.sniperZielX : grund.x,
    sniperZielY: pState.sniperZielY != null ? pState.sniperZielY : grund.y,
    sniperLadung: pState.sniperLadung || 0,
    sniperVoll: istVoll(pState.sniperLadung || 0),
    sniperCooldown: pState.sniperCooldown || 0
  };
}

// Host: fliegende Granaten fuer den Snapshot (id, Position, Besitzer, Restschritte des Flugs)
export function netzGranatenListe() {
  return granaten.map(g => ({ id: g.id, x: g.x, y: g.y, owner: g.pKey, rest: g.rest }));
}

// Client: Zustand eines Spielers aus dem Snapshot uebernehmen und darstellen. Der Schuss wird am Sprung des
// Schussabstands erkannt (Strahl mit der zuletzt bekannten Ladung), Sounds nur fuer das eigene Schiff.
export function uebernehmeSnapshot(pState, daten, pKey, eigenes) {
  if (!pState) return;
  if (!istSniper(pState) || !daten || daten.sniperZielX === undefined || daten.isDead) {
    entferneFadenkreuz(pKey);
    pState.sniperGehalten = false;
    pState.sniperLadung = 0;
    pState.sniperCooldown = 0;
    pState.sniperVoll = false;
    return;
  }
  const alteLadung = pState.sniperLadung || 0;
  const alterCooldown = pState.sniperCooldown || 0;
  const warVoll = !!pState.sniperVoll;
  pState.sniperZielX = daten.sniperZielX;
  pState.sniperZielY = daten.sniperZielY;
  pState.sniperLadung = daten.sniperLadung || 0;
  pState.sniperVoll = !!daten.sniperVoll;
  pState.sniperCooldown = daten.sniperCooldown || 0;
  pState.sniperGehalten = pState.sniperLadung > 0;
  if (pState.sniperCooldown > alterCooldown) {
    const anteil = ladeAnteil(alteLadung);
    erzeugeStrahl(pState, anteil);
    erzeugeEinschlag(pState, pState.sniperZielX, pState.sniperZielY, anteil);
    if (eigenes) Audio.playSniperSchuss(pState.laserStufe || 1, anteil);
  }
  if (eigenes && pState.sniperVoll && !warVoll) Audio.playSniperVoll();
  zeigeFadenkreuz(pState, pKey);
}

// Client: Granaten des Hosts abgleichen (Element pro Id, Position und Drehung aus dem Snapshot)
export function synchronisiereGranaten(liste) {
  const daten = liste || [];
  const ids = new Set(daten.map(d => d.id));
  for (let i = netzGranaten.length - 1; i >= 0; i--) {
    if (!ids.has(netzGranaten[i].id)) {
      netzGranaten[i].el.remove();
      netzGranaten.splice(i, 1);
    }
  }
  for (const d of daten) {
    let g = netzGranaten.find(n => n.id === d.id);
    if (!g) {
      const el = document.createElement('div');
      el.classList.add('sniper-granate');
      dom.spielfeld.appendChild(el);
      g = { id: d.id, el, pKey: d.owner };
      netzGranaten.push(g);
    }
    g.el.style.left = (d.x - 7) + 'px';
    g.el.style.top = (d.y - 7) + 'px';
    g.el.style.transform = 'rotate(' + (GRANATE_FLUG - (d.rest || 0)) * 24 + 'deg)';
  }
}

// Client: Explosion einer Granate (Ereignis 'granate_detonated')
export function zeigeDetonation(daten) {
  if (!daten || !Number.isFinite(daten.x) || !Number.isFinite(daten.y) || !(daten.radius > 0)) return;
  Audio.playGranate();
  Utils.erzeugeExplosion(daten.x, daten.y, '#ffffff', 10);
  Utils.erzeugeExplosion(daten.x, daten.y, '#ffeb3b', 10);
  erzeugeDruckwelle(daten.x, daten.y, daten.radius, daten.owner === 'p2' ? 'p2' : 'p1');
}

// Client: EMP-Ring (Ereignis 'emp_ausgeloest')
export function zeigeEmp(daten) {
  if (!daten || !Number.isFinite(daten.x) || !Number.isFinite(daten.y) || !(daten.radius > 0)) return;
  Audio.playEmp();
  erzeugeEmpRing(daten.x, daten.y, daten.radius, daten.owner === 'p2' ? 'p2' : 'p1');
}

// Client, jeden Schritt: Strahlen und Druckwellen animieren; das eigene Fadenkreuz folgt dem vorhergesagten Schiff
// (ohne Auto-Zielen liegt es auf der Grundposition, mit Auto-Zielen gilt der Host-Wert)
export function clientSchritt() {
  aktualisiereStrahlen();
  aktualisiereWellen();
  aktualisiereEmps();
  const p = state.p2;
  if (p && istSniper(p) && !p.isDead && p.sniperZielX != null) {
    if (autoZielTempo(p) === 0) {
      const grund = grundPosition(p);
      p.sniperZielX = grund.x;
      p.sniperZielY = grund.y;
    }
    zeigeFadenkreuz(p, 'p2');
  }
}

// Fadenkreuz, Strahlen und Schusszustand eines Spielers zuruecksetzen (restartGame, Game Over, Schiffswechsel)
export function setzeZurueck(pState) {
  if (!pState) return false;
  pState.sniperZielX = null;
  pState.sniperZielY = null;
  pState.sniperCooldown = 0;
  pState.sniperGehalten = false;
  pState.sniperGepuffert = null;
  pState.sniperLadung = 0;
  pState.sniperVoll = false;
  pState.granateGehalten = false;
  pState.granateSchritte = 0;
  entferneFadenkreuz(pState === state ? 'p1' : 'p2');
  entferneGranatenEffekte(pState === state ? 'p1' : 'p2');
  return true;
}

// Alle Sniper-Darstellungen entfernen (Game Over: danach laeuft keine Simulation mehr, die sie abraeumen wuerde)
export function entferneEffekte() {
  entferneFadenkreuz('p1');
  entferneFadenkreuz('p2');
  strahlen.forEach(s => s.el.remove());
  strahlen.length = 0;
  entferneGranatenEffekte();
}
