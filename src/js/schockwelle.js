import { state, config, arrays } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Network from './network.js';
import * as Anzeige from './anzeige.js';
import { erzeugeEffekt } from './effekte.js';

// Powerup Schockwelle: Ein Ring laeuft vom Aufnahmepunkt in WELLEN_DAUER Schritten bis zur fernsten Feldecke.
// Was der Ring erreicht: Feinde explodieren (Abschuss fuer den Sammler), Feind- und Boss-Geschosse verschwinden,
// Bosse verlieren einmal BOSS_SCHADEN_ANTEIL ihrer Max-HP (sterben aber nicht). Asteroiden bleiben.
// Der Ring ist ein Effekt (arrays.effekte, Art schockwelle); getroffen merkt sich die erfassten Ziele.

export const WELLEN_DAUER = 36;
export const BOSS_SCHADEN_ANTEIL = 0.15;

const GESCHOSS_LISTEN = [
  'feindLaserArray',
  'hackProjektilArray',
  'bossLaserArray',
  'bossRaketenArray',
  'bossBombenArray',
];

function fernsteEcke(x, y) {
  const b = config.spielfeldBreite;
  const h = config.spielfeldHoehe;
  return Math.max(Math.hypot(x, y), Math.hypot(b - x, y), Math.hypot(x, h - y), Math.hypot(b - x, h - y));
}

// Ring, Blitz und Ton (Host und Online-Client)
function zeige(x, y, radius) {
  Anzeige.blitzeSpielfeld('#ffffff', 90);
  Audio.playSchockwelle();
  return erzeugeEffekt({ art: 'schockwelle', x, y, radius, rest: WELLEN_DAUER });
}

// Host/Solo: Welle mit Trefferlogik ausloesen; owner = Sammler (Abschuesse zaehlen fuer ihn)
export function loeseAus(x, y, owner = 'p1') {
  const radius = fernsteEcke(x, y);
  const welle = zeige(x, y, radius);
  welle.owner = owner;
  welle.getroffen = new Set();
  if (state.gameMode === 'online') Network.sendNetworkEvent({ type: 'schockwelle', x, y, radius });
  return welle;
}

// Online-Client: nur Darstellung
export function zeigeSchockwelle(data) {
  zeige(data.x, data.y, data.radius);
}

function mitte(o) {
  const g = o.groesse || 0;
  const w = o.width || g;
  const h = o.height || g;
  return { x: o.x + w / 2, y: o.y + h / 2 };
}

// Aktueller Ringradius: waechst linear, im ersten Schritt schon ein Stueck
export function aktuellerRadius(welle) {
  return (welle.radius * (welle.dauer - welle.rest + 1)) / welle.dauer;
}

// Jeder Host-Schritt vor aktualisiereEffekte: erfasst, was der Ring neu erreicht
export function aktualisiereSchockwellen() {
  for (const welle of arrays.effekte) {
    if (welle.art !== 'schockwelle' || !welle.getroffen) continue;
    const r = aktuellerRadius(welle);
    const imRing = o => {
      const m = mitte(o);
      return Math.hypot(m.x - welle.x, m.y - welle.y) <= r;
    };

    for (const f of arrays.feinde.slice()) {
      if (welle.getroffen.has(f) || f.kettenT < 0 || !imRing(f)) continue;
      welle.getroffen.add(f);
      Utils.zerstoereZiel(f, welle.owner);
    }

    for (const b of arrays.bosses) {
      if (welle.getroffen.has(b) || !imRing(b)) continue;
      welle.getroffen.add(b);
      b.hp = Math.max(1, b.hp - Math.ceil(b.maxHp * BOSS_SCHADEN_ANTEIL));
      Anzeige.blitze(b, 1);
    }

    for (const name of GESCHOSS_LISTEN) {
      const liste = arrays[name];
      for (let i = liste.length - 1; i >= 0; i--) {
        if (!imRing(liste[i])) continue;
        Anzeige.entferne(liste[i]);
        liste.splice(i, 1);
      }
    }
  }
}
