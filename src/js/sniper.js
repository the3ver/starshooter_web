// Spectre-SR (Model-ID `sniper`): Fadenkreuz-Laser mit Aufladen und Betaeubungsgranate (siehe AGENTS.md, Abschnitt Sniper).
// Stand S4: Fadenkreuz (Grundposition, Auto-Zielen ab Laser-Stufe 4), Sofort-Schuss auf den Trefferkreis, Aufladen
// (Druck startet Laden, Loslassen feuert) und Betaeubungsgranate auf der Raketen-Taste.
// pState ist `state` (P1) oder `state.p2`, pKey 'p1' / 'p2'.
// Zustand pro Spieler: sniperZielX/sniperZielY (Fadenkreuz-Mitte im Spielfeld, null = noch nicht gesetzt),
// sniperCooldown (Schritte bis zum naechsten Schuss), sniperGehalten (Laser-Taste im Schritt davor = Ladevorgang laeuft),
// sniperLadung (Ladeschritte 0-90), sniperVoll (Voll-Ton fuer diesen Ladevorgang schon gespielt).

import { state, config, arrays, shipColors } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Hack from './hack.js';
import * as Network from './network.js';
import { schadeZiel, zeigeLadungenHud } from './gleve.js';
import * as Anzeige from './anzeige.js';
import { erzeugeEffekt, entferneEffekte as entferneAlleEffekte } from './effekte.js';

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

// Granaten-Taste: Tippen (< HALTEN_AB Schritte) = Granate + EMP, Halten (ab HALTEN_AB) = Haftminen
export const HALTEN_AB = 10;
// EMP (beim Tippen): Ring waechst in EMP_SCHRITTE auf den Radius der Raketen-Stufe, zerstoert feindliche Geschosse und betaeubt Feinde
export const EMP_SCHRITTE = 10;
export const EMP_BETAEUBUNG = 30;
const EMP_RADIUS = [70, 80, 90, 100, 110];

// Haftminen (beim Halten): alle MINE_INTERVALL Schritte ab HALTEN_AB eine Mine, max. MINE_MAX_PRO_HALTEN pro Halten,
// max. MINE_MAX_AKTIV pro Spieler (aelteste weg). Lebensdauer MINE_LEBEN (die letzten MINE_BLINK blinkend); haftet am Ziel
// und explodiert nach MINE_ZUENDUNG Schritten mit Radius MINE_RADIUS.
export const MINE_INTERVALL = 12;
export const MINE_MAX_PRO_HALTEN = 5;
export const MINE_MAX_AKTIV = 8;
export const MINE_LEBEN = 360;
export const MINE_BLINK = 60;
export const MINE_ZUENDUNG = 30;
export const MINE_RADIUS = 30;
// Freie Minen driften langsam nach oben, den Gegnern entgegen (px pro Schritt)
export const MINE_DRIFT = 0.6;
export const MINE_GROESSE = 12;
const MINE_SCHADEN = [20, 25, 30, 35, 40];

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
// Granaten-Ladungen: Raketen-Stufe 1-3 -> 2, 4-5 -> 3. raketenCooldown ist die Ladezeit der naechsten Ladung.
export function granatenMax(pState) { return (pState.raketenStufe || 1) >= 4 ? 3 : 2; }

// Ladungen voll, kein laufendes Nachladen (Spielstart, Neustart, Schiffswechsel)
export function setzeGranatenLadungenVoll(pState) {
  if (!pState) return;
  pState.sniperGranatenLadungen = granatenMax(pState);
  pState.raketenCooldown = 0;
}

export function granatenLadungen(pState) {
  return pState.sniperGranatenLadungen === undefined ? granatenMax(pState) : pState.sniperGranatenLadungen;
}

// Verbraucht eine Ladung; ein Nachladen startet nur, wenn noch keins laeuft
function verbraucheGranate(pState) {
  pState.sniperGranatenLadungen = Math.max(0, granatenLadungen(pState) - 1);
  if ((pState.raketenCooldown || 0) <= 0) pState.raketenCooldown = granatenCooldown(pState);
}

// Pro Schritt (waffen.js): Nachladen nacheinander (laeuft auf 0 -> +1 Ladung, ggf. weiter laden) und HUD
export function aktualisiereGranatenLadungen(pKey, pState) {
  const max = granatenMax(pState);
  if (pState.sniperGranatenLadungen === undefined) pState.sniperGranatenLadungen = max;
  if (pState.sniperGranatenLadungen > max) pState.sniperGranatenLadungen = max;
  if (pState.raketenCooldown > 0) {
    pState.raketenCooldown--;
    if (pState.raketenCooldown <= 0) {
      pState.sniperGranatenLadungen = Math.min(max, pState.sniperGranatenLadungen + 1);
      pState.raketenCooldown = pState.sniperGranatenLadungen < max ? granatenCooldown(pState) : 0;
    }
  } else if (pState.sniperGranatenLadungen < max) {
    // z. B. nach Upgrade auf Stufe 4: Nachladen starten
    pState.raketenCooldown = granatenCooldown(pState);
  }
  zeigeGranatenHud(pKey, pState);
}

export function zeigeGranatenHud(pKey, pState) {
  if (!pState || !istSniper(pState)) return;
  zeigeLadungenHud(pKey, pState, granatenLadungen(pState), granatenMax(pState), granatenCooldown(pState));
}
export function granatenRadius(pState) { return GRANATE_RADIUS[raketenIndex(pState)]; }
export function granatenStoss(pState) { return GRANATE_STOSS[raketenIndex(pState)]; }
export function granatenBetaeubung(pState) { return GRANATE_BETAEUBUNG[raketenIndex(pState)]; }
export function granatenSchaden(pState) { return GRANATE_SCHADEN[raketenIndex(pState)]; }
export function empRadius(pState) { return EMP_RADIUS[raketenIndex(pState)]; }
export function minenSchaden(pState) { return MINE_SCHADEN[raketenIndex(pState)]; }

// Ladeanteil 0-1 (unter 10 Schritten Haltedauer = Normalschuss, also 0)
export function ladeAnteil(ladung) {
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
// Das Fadenkreuz samt Ladering zeichnet das Anzeige-Backend aus dem Spielerzustand (zeichneFadenkreuz in anzeige-dom.js).

function erzeugeStrahl(pState, anteil = 0) {
  const n = schiffsNase(pState);
  const dx = pState.sniperZielX - n.x;
  const dy = pState.sniperZielY - n.y;
  erzeugeEffekt({
    art: 'sniperStrahl', x: n.x, y: n.y, laenge: Math.hypot(dx, dy), winkel: Math.atan2(dx, -dy) * 180 / Math.PI,
    breite: 3 + 9 * anteil, glow: anteil, farbe: schiffFarbe(pState), pKey: pState === state ? 'p1' : 'p2', rest: STRAHL_SCHRITTE
  });
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

// Granaten im Flug: arrays.sniperGranaten, { id, pKey, x, y (Mitte), startX, startY, zielX, zielY, rest, rot, werte }
// (Client: nur id, pKey, x, y, rest, rot aus dem Snapshot)
let granatenId = 0;
const stoesse = []; // { z, vx, vy, rest, pKey } laufendes Wegstossen

// Wurf zum Fadenkreuz (Position beim Wurf), Flug in GRANATE_FLUG Schritten im Bogen; die Werte der Stufe gelten ab dem Wurf.
export function werfeGranate(pState, pKey) {
  const n = schiffsNase(pState);
  const grund = grundPosition(pState);
  const zx = pState.sniperZielX != null ? pState.sniperZielX : grund.x;
  const zy = pState.sniperZielY != null ? pState.sniperZielY : grund.y;
  arrays.sniperGranaten.push(Anzeige.erzeuge({
    id: 'sg_' + (++granatenId), pKey, x: n.x, y: n.y, startX: n.x, startY: n.y, zielX: zx, zielY: zy, rest: GRANATE_FLUG, rot: 0,
    werte: {
      radius: granatenRadius(pState), stoss: granatenStoss(pState), betaeubung: granatenBetaeubung(pState),
      schaden: granatenSchaden(pState), loescht: (pState.raketenStufe || 1) >= 5
    }
  }, 'sniperGranate'));
}

function aktualisiereGranaten(pKey) {
  for (let i = arrays.sniperGranaten.length - 1; i >= 0; i--) {
    const g = arrays.sniperGranaten[i];
    if (g.pKey !== pKey) continue;
    g.rest--;
    if (g.rest <= 0) {
      Anzeige.entferne(g);
      arrays.sniperGranaten.splice(i, 1);
      explodiereGranate(g);
      continue;
    }
    const t = 1 - g.rest / GRANATE_FLUG;
    const x = g.startX + (g.zielX - g.startX) * t;
    const y = g.startY + (g.zielY - g.startY) * t - Math.sin(Math.PI * t) * GRANATE_BOGEN;
    g.rot += 24;
    g.x = x;
    g.y = y;
  }
}

function erzeugeDruckwelle(cx, cy, radius, pKey, art = 'sniperDruckwelle') {
  erzeugeEffekt({ art, x: cx, y: cy, radius, pKey, rest: WELLE_SCHRITTE });
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
      Anzeige.entferne(p);
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
    }
  }

  if (w.loescht) {
    loescheGeschosse(arrays.feindLaserArray, cx, cy, w.radius);
    loescheGeschosse(arrays.bossLaserArray, cx, cy, w.radius);
    loescheGeschosse(arrays.hackProjektilArray, cx, cy, w.radius);
  }
}

// --- GRANATEN-TASTE (Tippen / Halten) und EMP ---

// Mittelpunkt des Schiffs (EMP-Ursprung)
function schiffsMitte(pState) {
  return { x: pState.x + config.spielerGroesse / 2, y: pState.y + config.spielerGroesse / 2 };
}

function erzeugeEmpRing(cx, cy, radius, pKey) {
  erzeugeEffekt({ art: 'sniperEmp', x: cx, y: cy, radius, pKey, rest: EMP_SCHRITTE });
}

// Feindliche Geschosse im Radius entfernen (mit kleinem Funken); Bomben ohne Detonation
function zerstoereGeschosse(array, cx, cy, r) {
  for (let i = array.length - 1; i >= 0; i--) {
    const p = array[i];
    const b = { x1: p.x, y1: p.y, x2: p.x + (p.width || p.groesse || 4), y2: p.y + (p.height || p.groesse || 4) };
    if (boxSchneidetKreis(b, cx, cy, r)) {
      Utils.erzeugeExplosion((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, '#4fc3f7', 4);
      Anzeige.entferne(p);
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
  }
  if (state.gameMode === 'online' && state.network && state.network.isHost) {
    Network.sendNetworkEvent({ type: 'emp_ausgeloest', x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10, radius: r, owner: pKey });
  }
}

// --- HAFTMINEN ---

function ueberlappen(a, b) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}

function mineBox(m) {
  const h = MINE_GROESSE / 2;
  return { x1: m.x - h, y1: m.y - h, x2: m.x + h, y2: m.y + h };
}

// Ziele fuer Kontakt und Explosion: Feinde, Asteroiden (ausser Magma) und Bosse
function minenZiele() {
  return [...arrays.feinde, ...arrays.asteroiden, ...arrays.bosses].filter(z => !z.istUnzerstoerbar && (z.hp === undefined || z.hp > 0));
}

let minenId = 0;

// Darstellungsfelder haftet/blinkt aus dem Zustand ableiten (Host); der Client uebernimmt sie aus dem Snapshot
function setzeMineAnzeige(m) {
  m.haftet = !!m.ziel;
  m.blinkt = !m.ziel && m.rest <= MINE_BLINK;
}

function entferneMine(m) {
  Anzeige.entferne(m);
  const i = arrays.sniperMinen.indexOf(m);
  if (i >= 0) arrays.sniperMinen.splice(i, 1);
}

// Mine unter der Schiffsmitte legen; ueber dem Limit pro Spieler faellt die aelteste weg
function legeMine(pState, pKey) {
  const eigene = arrays.sniperMinen.filter(m => m.pKey === pKey);
  while (eigene.length >= MINE_MAX_AKTIV) entferneMine(eigene.shift());
  const m = {
    id: 'sm_' + (++minenId), pKey, x: pState.x + config.spielerGroesse / 2, y: pState.y + config.spielerGroesse,
    rest: MINE_LEBEN, ziel: null, offX: 0, offY: 0, zuender: -1, schaden: minenSchaden(pState), haftet: false, blinkt: false
  };
  arrays.sniperMinen.push(Anzeige.erzeuge(m, 'sniperMine'));
  Audio.playMineLegen();
}

function erzeugeMinenExplosion(cx, cy, pKey) {
  Audio.playMineExplosion();
  Utils.erzeugeExplosion(cx, cy, '#ffffff', 6);
  Utils.erzeugeExplosion(cx, cy, '#ff9800', 8);
  erzeugeDruckwelle(cx, cy, MINE_RADIUS, pKey, 'sniperMinenExplosion');
}

// Explosion an der aktuellen Position: jedes Ziel im Radius genau einmal (Schild zuerst)
function explodiereMine(m) {
  entferneMine(m);
  erzeugeMinenExplosion(m.x, m.y, m.pKey);
  if (state.gameMode === 'online' && state.network && state.network.isHost) {
    Network.sendNetworkEvent({ type: 'mine_explodiert', x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10, radius: MINE_RADIUS, owner: m.pKey });
  }
  for (const z of minenZiele().filter(t => boxSchneidetKreis(zielBox(t), m.x, m.y, MINE_RADIUS))) {
    schadeZiel(z, m.schaden, m.pKey);
  }
  // Boss-Raketen und -Bomben im Radius werden zerstoert (wie beim EMP)
  zerstoereGeschosse(arrays.bossRaketenArray, m.x, m.y, MINE_RADIUS);
  zerstoereGeschosse(arrays.bossBombenArray, m.x, m.y, MINE_RADIUS);
}

// Beruehrt eine Boss-Rakete oder -Bombe die Mine?
function bossGeschossAnMine(m) {
  const box = mineBox(m);
  return [...arrays.bossRaketenArray, ...arrays.bossBombenArray].some(g => ueberlappen(box, zielBox(g)));
}

function zielLebt(z) {
  return (arrays.feinde.includes(z) || arrays.asteroiden.includes(z) || arrays.bosses.includes(z)) && (z.hp === undefined || z.hp > 0);
}

function aktualisiereMinen(pKey) {
  for (let i = arrays.sniperMinen.length - 1; i >= 0; i--) {
    const m = arrays.sniperMinen[i];
    if (!m || m.pKey !== pKey) continue;
    if (m.ziel) {
      if (!zielLebt(m.ziel)) { explodiereMine(m); continue; } // Ziel vorher gestorben: Explosion an der letzten Position
      const c = zielMitte(m.ziel);
      m.x = c.x + m.offX;
      m.y = c.y + m.offY;
      m.zuender--;
      if (m.zuender <= 0) { explodiereMine(m); continue; }
      if (m.zuender % 10 === 0) Audio.playMinePiep();
    } else {
      m.rest--;
      m.y -= MINE_DRIFT;
      if (m.rest <= 0 || m.y < -MINE_GROESSE) { entferneMine(m); continue; }
      // Boss-Raketen und -Bomben loesen die Mine sofort aus (kein Haften an Geschossen)
      if (bossGeschossAnMine(m)) { explodiereMine(m); continue; }
      const box = mineBox(m);
      const z = minenZiele().find(t => ueberlappen(box, zielBox(t)));
      if (z) {
        const c = zielMitte(z);
        m.ziel = z;
        m.offX = m.x - c.x;
        m.offY = m.y - c.y;
        m.zuender = MINE_ZUENDUNG;
        Audio.playMinePiep();
      }
    }
    setzeMineAnzeige(m);
  }
}

// Halten der Granaten-Taste (aus aktualisiereGranatenTaste, ab HALTEN_AB): alle MINE_INTERVALL Schritte eine Mine, bei freiem Cooldown.
// `schritte` = bisherige Haltedauer.
export function haltenSchritt(pState, pKey, schritte) {
  if (Hack.hatHack(pState, 'waffenOffline')) return;
  if ((pState.granateMinen || 0) >= MINE_MAX_PRO_HALTEN) return;
  if ((schritte - HALTEN_AB) % MINE_INTERVALL !== 0) return;
  // Die erste Mine eines Haltens kostet eine Ladung (ohne Ladung keine Minen), weitere nichts
  if ((pState.granateMinen || 0) === 0) {
    if (granatenLadungen(pState) < 1) return;
    verbraucheGranate(pState);
  }
  legeMine(pState, pKey);
  pState.granateMinen = (pState.granateMinen || 0) + 1;
}

// Tippen: Granate ins Fadenkreuz und EMP, danach startet der Cooldown
function tippeGranate(pState, pKey) {
  verbraucheGranate(pState);
  werfeGranate(pState, pKey);
  loeseEmpAus(pState, pKey);
}

// Pro Schritt aus waffen.js (statt der Raketen): `gehalten` ist die Raketen-Taste. Druck startet die Zaehlung, Loslassen
// entscheidet: unter HALTEN_AB Schritten (und freiem Cooldown) = Tippen; nach dem Halten startet der Cooldown, wenn Minen lagen.
export function aktualisiereGranatenTaste(pState, pKey, gehalten) {
  if (!istSniper(pState)) return;
  const sperre = Hack.hatHack(pState, 'waffenOffline') || pState.isDead || !state.spielLaeuft;
  if (gehalten && !sperre) {
    if (!pState.granateGehalten) { pState.granateSchritte = 0; pState.granateMinen = 0; }
    pState.granateGehalten = true;
    pState.granateSchritte = (pState.granateSchritte || 0) + 1;
    if (pState.granateSchritte >= HALTEN_AB) haltenSchritt(pState, pKey, pState.granateSchritte);
  } else if (pState.granateGehalten) {
    const schritte = pState.granateSchritte || 0;
    pState.granateGehalten = false;
    pState.granateSchritte = 0;
    pState.granateMinen = 0;
    if (!sperre && schritte < HALTEN_AB && granatenLadungen(pState) >= 1) tippeGranate(pState, pKey);
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
    if (s.rest === 0) stoesse.splice(i, 1);
  }
}

function entferneGranatenEffekte(pKey) {
  entferneAlleEffekte(pKey);
  for (let i = arrays.sniperMinen.length - 1; i >= 0; i--) {
    if (!pKey || arrays.sniperMinen[i].pKey === pKey) entferneMine(arrays.sniperMinen[i]);
  }
  for (let i = arrays.sniperGranaten.length - 1; i >= 0; i--) {
    if (pKey && arrays.sniperGranaten[i].pKey !== pKey) continue;
    Anzeige.entferne(arrays.sniperGranaten[i]);
    arrays.sniperGranaten.splice(i, 1);
  }
  for (let i = stoesse.length - 1; i >= 0; i--) {
    if (pKey && stoesse[i].pKey !== pKey) continue;
    stoesse.splice(i, 1);
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
  aktualisiereGranaten(pKey);
  aktualisiereMinen(pKey);
  aktualisiereStoesse(pKey);
  if (pState.isDead || !state.spielLaeuft) {
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
    sniperCooldown: pState.sniperCooldown || 0,
    sniperGranatenLadungen: granatenLadungen(pState)
  };
}

// Host: fliegende Granaten fuer den Snapshot (id, Position, Besitzer, Restschritte des Flugs)
export function netzGranatenListe() {
  return arrays.sniperGranaten.map(g => ({ id: g.id, x: g.x, y: g.y, owner: g.pKey, rest: g.rest }));
}

// Host: aktive Minen fuer den Snapshot (id, Position, Besitzer, haftet, Restzuendzeit, Restlebensdauer, blinkt)
export function netzMinenListe() {
  return arrays.sniperMinen.map(m => ({
    id: m.id, x: m.x, y: m.y, owner: m.pKey, haftet: !!m.ziel, zuender: m.ziel ? m.zuender : 0, rest: m.rest,
    blinkt: !m.ziel && m.rest <= MINE_BLINK
  }));
}

// Client: Zustand eines Spielers aus dem Snapshot uebernehmen und darstellen. Der Schuss wird am Sprung des
// Schussabstands erkannt (Strahl mit der zuletzt bekannten Ladung), Sounds nur fuer das eigene Schiff.
export function uebernehmeSnapshot(pState, daten, pKey, eigenes) {
  if (!pState) return;
  if (!istSniper(pState) || !daten || daten.sniperZielX === undefined || daten.isDead) {
    // Kein Sniper-Zustand im Snapshot: Fadenkreuz ausblenden (die Anzeige zeichnet es nur bei gesetztem Ziel)
    pState.sniperZielX = null;
    pState.sniperZielY = null;
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
  if (daten.sniperGranatenLadungen !== undefined) {
    pState.sniperGranatenLadungen = daten.sniperGranatenLadungen;
    zeigeGranatenHud(pKey, pState);
  }
  if (pState.sniperCooldown > alterCooldown) {
    const anteil = ladeAnteil(alteLadung);
    erzeugeStrahl(pState, anteil);
    erzeugeEinschlag(pState, pState.sniperZielX, pState.sniperZielY, anteil);
    if (eigenes) Audio.playSniperSchuss(pState.laserStufe || 1, anteil);
  }
  if (eigenes && pState.sniperVoll && !warVoll) Audio.playSniperVoll();
}

// Client: Granaten des Hosts abgleichen (Modell pro Id in arrays.sniperGranaten, Position und Drehung aus dem Snapshot;
// auf dem Client laeuft aktualisiereGranaten nicht, die Liste gehoert allein dem Snapshot)
export function synchronisiereGranaten(liste) {
  const daten = liste || [];
  const ids = new Set(daten.map(d => d.id));
  const gran = arrays.sniperGranaten;
  for (let i = gran.length - 1; i >= 0; i--) {
    if (!ids.has(gran[i].id)) {
      Anzeige.entferne(gran[i]);
      gran.splice(i, 1);
    }
  }
  for (const d of daten) {
    let g = gran.find(n => n.id === d.id);
    if (!g) {
      g = Anzeige.erzeuge({ id: d.id, pKey: d.owner, x: d.x, y: d.y, rest: d.rest || 0, rot: (GRANATE_FLUG - (d.rest || 0)) * 24 }, 'sniperGranate');
      gran.push(g);
    }
    g.x = d.x;
    g.y = d.y;
    g.rest = d.rest || 0;
    g.rot = (GRANATE_FLUG - g.rest) * 24;
  }
}

// Client: Minen des Hosts abgleichen (Modell pro Id in arrays.sniperMinen; aktualisiereMinen laeuft dort nicht, die
// Liste gehoert allein dem Snapshot). Legen-, Haft- und Piep-Ton bleiben hier.
export function synchronisiereMinen(liste) {
  const daten = liste || [];
  const ids = new Set(daten.map(d => d.id));
  const minen = arrays.sniperMinen;
  for (let i = minen.length - 1; i >= 0; i--) {
    if (!ids.has(minen[i].id)) {
      Anzeige.entferne(minen[i]);
      minen.splice(i, 1);
    }
  }
  for (const d of daten) {
    let m = minen.find(n => n.id === d.id);
    if (!m) {
      m = Anzeige.erzeuge({ id: d.id, pKey: d.owner === 'p2' ? 'p2' : 'p1', x: d.x, y: d.y, rest: d.rest || 0, haftet: !!d.haftet, blinkt: !d.haftet && !!d.blinkt }, 'sniperMine');
      minen.push(m);
      Audio.playMineLegen();
    }
    if (d.haftet && !m.haftet) Audio.playMinePiep();
    m.x = d.x;
    m.y = d.y;
    m.rest = d.rest || 0;
    m.haftet = !!d.haftet;
    m.blinkt = !m.haftet && !!d.blinkt;
  }
}

// Client: Minen-Explosion (Ereignis 'mine_explodiert')
export function zeigeMinenExplosion(daten) {
  if (!daten || !Number.isFinite(daten.x) || !Number.isFinite(daten.y)) return;
  erzeugeMinenExplosion(daten.x, daten.y, daten.owner === 'p2' ? 'p2' : 'p1');
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

// Client, jeden Schritt: das eigene Fadenkreuz folgt dem vorhergesagten Schiff
// (ohne Auto-Zielen liegt es auf der Grundposition, mit Auto-Zielen gilt der Host-Wert)
export function clientSchritt() {
  const p = state.p2;
  if (p && istSniper(p) && !p.isDead && p.sniperZielX != null) {
    if (autoZielTempo(p) === 0) {
      const grund = grundPosition(p);
      p.sniperZielX = grund.x;
      p.sniperZielY = grund.y;
    }
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
  setzeGranatenLadungenVoll(pState);
  pState.granateGehalten = false;
  pState.granateSchritte = 0;
  pState.granateMinen = 0;
  entferneGranatenEffekte(pState === state ? 'p1' : 'p2');
  return true;
}

// Alle Sniper-Darstellungen entfernen (Game Over: danach laeuft keine Simulation mehr, die sie abraeumen wuerde)
export function entferneEffekte() {
  for (const s of [state, state.p2]) {
    if (!s) continue;
    s.sniperZielX = null;
    s.sniperZielY = null;
  }
  entferneGranatenEffekte();
}
