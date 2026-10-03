// Gleve-MR: Dash statt Laser. pState ist `state` (P1) oder `state.p2`, pKey 'p1' / 'p2'.
// Zustand pro Spieler: gleveDashTimer, gleveDashVx/Vy (Schritt pro Frame, auch fuer den Abprall),
// gleveAbprallTimer, gleveUnverwundbar, gleveDashTasteGehalten (Flanke), gleveDashTreffer (Ziele dieses Dashs).

import { dom, config, arrays, shipModels, shipColors } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Hack from './hack.js';

export const DASH_FRAMES = 8;
export const DASH_NACHLAUF_FRAMES = 10; // Unverwundbar nach dem Dash
export const ABPRALL_FRAMES = 8;
export const ABPRALL_NACHLAUF_FRAMES = 30; // Unverwundbar nach dem Abprall
const ABPRALL_TIEFER = 30;

// Werte pro Stufe (laserStufe 1-5)
const DASH_REICHWEITE = [100, 110, 120, 135, 150];
const DASH_KOSTEN = [25, 24, 22, 20, 18];
const DASH_SCHADEN = [60, 70, 80, 90, 100];

function stufenIndex(pState) {
  return Math.max(1, Math.min(5, pState.laserStufe || 1)) - 1;
}

export function dashReichweite(pState) { return DASH_REICHWEITE[stufenIndex(pState)]; }
export function dashKosten(pState) { return DASH_KOSTEN[stufenIndex(pState)]; }
export function dashSchaden(pState) { return DASH_SCHADEN[stufenIndex(pState)]; }

export function istGleve(pState) {
  return !!pState && pState.selectedShipModel === 'gleve';
}

// Dash oder Abprall laeuft (keine normale Steuerung, keine Energie-Regeneration)
export function istDashAktiv(pState) {
  return (pState.gleveDashTimer || 0) > 0 || (pState.gleveAbprallTimer || 0) > 0;
}

function schiffElement(pKey) {
  return pKey === 'p2' ? dom.spieler2 : dom.spieler;
}

function schiffFarbe(pState) {
  const c = shipColors[pState.selectedShipColor];
  return c ? c.prim : '#ffffff';
}

function kannDashen(pState) {
  if (pState.isDead || istDashAktiv(pState)) return false;
  if (Hack.hatHack(pState, 'waffenOffline')) return false;
  return pState.unbegrenzteEnergie || pState.energie >= dashKosten(pState);
}

function starteDash(pState, pKey, richtung) {
  let dx = richtung ? richtung.dx : 0;
  let dy = richtung ? richtung.dy : 0;
  const laenge = Math.hypot(dx, dy);
  if (laenge < 0.01) {
    // Ohne Eingabe nach oben
    dx = 0;
    dy = -1;
  } else {
    dx /= laenge;
    dy /= laenge;
  }
  if (!pState.unbegrenzteEnergie) pState.energie -= dashKosten(pState);
  const schritt = dashReichweite(pState) / DASH_FRAMES;
  pState.gleveDashVx = dx * schritt;
  pState.gleveDashVy = dy * schritt;
  pState.gleveDashTimer = DASH_FRAMES;
  pState.gleveAbprallTimer = 0;
  pState.gleveDashTreffer = [];
  pState.gleveUnverwundbar = Math.max(pState.gleveUnverwundbar || 0, DASH_FRAMES + DASH_NACHLAUF_FRAMES);
  Audio.playDash(pState.laserStufe);
  erzeugeStartBlitz(pState);
}

function begrenzeAufSpielfeld(pState) {
  pState.x = Math.max(0, Math.min(config.spielfeldBreite - config.spielerGroesse, pState.x));
  pState.y = Math.max(0, Math.min(config.spielfeldHoehe - config.spielerGroesse, pState.y));
}

// Schaden wie bei den anderen Waffen: Schild zuerst, dann HP. Liefert true, wenn das Ziel zerstoert wurde.
function schadeZiel(z, schaden, pKey) {
  if ((z.schildHp || 0) > 0) {
    z.schildHp -= schaden;
    if (z.schildHp <= 0) {
      z.schildHp = 0;
      if (z.schildEl) {
        z.schildEl.remove();
        z.schildEl = null;
      }
    }
    return false;
  }
  z.hp -= schaden;
  if (z.rissEl) {
    let basisRiss = z.traegtPowerup ? 0.5 : 0;
    z.rissEl.style.opacity = basisRiss + (1 - basisRiss) * (1 - z.hp / z.maxHp);
  }
  if (z.el) {
    z.el.style.filter = 'brightness(2.5)';
    setTimeout(() => {
      if (z.el) z.el.style.filter = '';
    }, 50);
  }
  // Boss-Raketen und -Bomben raeumen sich bei hp <= 0 in boss.js selbst ab
  if (z.hp <= 0 && (arrays.feinde.includes(z) || arrays.asteroiden.includes(z) || arrays.bosses.includes(z))) {
    Utils.zerstoereZiel(z, pKey);
    return true;
  }
  return false;
}

// Kill-Kette: Energie fuer jeden durch einen Dash zerstoerten Gegner
function belohneKill(pState, z) {
  if (!z.istFeind && !z.istBoss) return;
  const gewinn = (shipModels.gleve && shipModels.gleve.dashKillEnergie) || 0;
  pState.energie = Math.min(pState.maxEnergie, pState.energie + gewinn);
}

// Magma-Asteroid knacken wie bei der Bombe (wird zum Powerup-Traeger)
function knackeMagma(z) {
  z.istUnzerstoerbar = false;
  z.traegtPowerup = true;
  z.el.classList.remove('unzerstoerbar');
  if (!z.rissEl) {
    z.rissEl = document.createElement('div');
    z.rissEl.classList.add('riss-layer');
    z.el.appendChild(z.rissEl);
  }
}

function ueberlappt(pState, z, padding = 0) {
  const g = z.groesse || 20;
  const w = z.width || g;
  const h = z.height || g;
  return pState.x < z.x + w - padding && pState.x + config.spielerGroesse > z.x + padding &&
         pState.y < z.y + h - padding && pState.y + config.spielerGroesse > z.y + padding;
}

// Abprall schraeg zur Seite: auf die Seite, auf der die Gleve relativ zur Zielmitte ist,
// mindestens halbe Zielbreite neben der Zielkante und etwas tiefer (raus aus der Schusslinie)
function starteAbprall(pState, z) {
  const g = z.groesse || 30;
  const schiffMitte = pState.x + config.spielerGroesse / 2;
  const zielMitte = z.x + g / 2;
  let seite = Math.sign(schiffMitte - zielMitte);
  if (seite === 0) seite = Math.random() < 0.5 ? -1 : 1;

  const maxX = config.spielfeldBreite - config.spielerGroesse;
  const maxY = config.spielfeldHoehe - config.spielerGroesse;
  const landeX = s => Math.max(0, Math.min(maxX, s > 0 ? z.x + g + g / 2 : z.x - g / 2 - config.spielerGroesse));
  const unterZiel = x => x < z.x + g && x + config.spielerGroesse > z.x;
  let zielX = landeX(seite);
  // Am Spielfeldrand kein Platz: andere Seite versuchen
  if (unterZiel(zielX) && !unterZiel(landeX(-seite))) zielX = landeX(-seite);
  const zielY = Math.max(0, Math.min(maxY, pState.y + ABPRALL_TIEFER));

  pState.gleveDashTimer = 0;
  pState.gleveAbprallTimer = ABPRALL_FRAMES;
  pState.gleveDashVx = (zielX - pState.x) / ABPRALL_FRAMES;
  pState.gleveDashVy = (zielY - pState.y) / ABPRALL_FRAMES;
  pState.gleveUnverwundbar = Math.max(pState.gleveUnverwundbar || 0, ABPRALL_FRAMES + ABPRALL_NACHLAUF_FRAMES + 1);
  Audio.playHit('magma');
  Utils.erzeugeExplosion(schiffMitte, pState.y, '#ffffff', 12);
}

// Ein Dash-Frame: bewegen und alle beruehrten Ziele (je einmal pro Dash) behandeln
function dashSchritt(pState, pKey) {
  const altX = pState.x;
  const altY = pState.y;
  pState.x += pState.gleveDashVx;
  pState.y += pState.gleveDashVy;
  begrenzeAufSpielfeld(pState);
  pState.gleveDashTimer--;
  erzeugeNachbild(pState);

  const schaden = dashSchaden(pState);
  const stufe5 = (pState.laserStufe || 1) >= 5;
  const treffer = pState.gleveDashTreffer || (pState.gleveDashTreffer = []);
  let hindernis = null;

  const ziele = [...arrays.feinde, ...arrays.asteroiden, ...arrays.bosses, ...arrays.bossRaketenArray, ...arrays.bossBombenArray];
  for (const z of ziele) {
    if (treffer.includes(z) || (z.immune || 0) > 0) continue;
    if (!ueberlappt(pState, z, z.istBoss ? z.groesse * 0.15 : 0)) continue;
    treffer.push(z);
    erzeugeFunken(pState, z);

    if (z.istBoss) {
      // Boss bekommt Schaden und haelt den Dash auf
      if (schadeZiel(z, schaden, pKey)) belohneKill(pState, z);
      else if (!hindernis) hindernis = z;
    } else if (z.istUnzerstoerbar) {
      if (stufe5) {
        knackeMagma(z);
        schadeZiel(z, schaden, pKey);
      } else if (!hindernis) {
        hindernis = z;
      }
    } else if (z.istFeind || (arrays.asteroiden.includes(z) && !z.traegtPowerup)) {
      // Kleine Ziele werden durchschnitten
      Utils.zerstoereZiel(z, pKey);
      belohneKill(pState, z);
    } else {
      // Powerup-Asteroiden, Boss-Raketen und -Bomben
      schadeZiel(z, schaden, pKey);
    }
  }

  if (hindernis) {
    // Dash endet am Hindernis
    pState.x = altX;
    pState.y = altY;
    starteAbprall(pState, hindernis);
  }
}

function abprallSchritt(pState) {
  pState.x += pState.gleveDashVx;
  pState.y += pState.gleveDashVy;
  begrenzeAufSpielfeld(pState);
  pState.gleveAbprallTimer--;
  erzeugeNachbild(pState);
}

// Pro Simulationsschritt fuer eine Gleve aufrufen (vor der normalen Bewegung).
// tasteGedrueckt: Laser-Taste dieses Spielers, richtung: { dx, dy } aus der Steuerung (Hacks bereits angewendet).
// Liefert true, wenn Dash/Abprall die Bewegung in diesem Schritt uebernommen hat.
export function aktualisiereGleve(pState, pKey, tasteGedrueckt, richtung) {
  if ((pState.gleveUnverwundbar || 0) > 0) pState.gleveUnverwundbar--;
  const flanke = !!tasteGedrueckt && !pState.gleveDashTasteGehalten;
  pState.gleveDashTasteGehalten = !!tasteGedrueckt;

  const el = schiffElement(pKey);
  if (pState.isDead) {
    pState.gleveDashTimer = 0;
    pState.gleveAbprallTimer = 0;
    if (el) el.classList.remove('gleve-dash');
    return false;
  }

  if (flanke && kannDashen(pState)) starteDash(pState, pKey, richtung);

  let uebernommen = false;
  if ((pState.gleveDashTimer || 0) > 0) {
    dashSchritt(pState, pKey);
    uebernommen = true;
  } else if ((pState.gleveAbprallTimer || 0) > 0) {
    abprallSchritt(pState);
    uebernommen = true;
  }
  if (el) el.classList.toggle('gleve-dash', istDashAktiv(pState));
  return uebernommen;
}

// --- EFFEKTE ---

function erzeugeStartBlitz(pState) {
  const cx = pState.x + config.spielerGroesse / 2;
  const cy = pState.y + config.spielerGroesse / 2;
  const el = document.createElement('div');
  el.classList.add('gleve-blitz');
  el.style.left = (cx - 20) + 'px';
  el.style.top = (cy - 20) + 'px';
  dom.spielfeld.appendChild(el);
  arrays.partikelArray.push({ el, x: cx - 20, y: cy - 20, vx: 0, vy: 0, leben: 1.0, zerfall: 0.2 });
  Utils.erzeugeExplosion(cx, cy, '#ffffff', 6);
}

// Nachbild in Schiffsfarbe plus Streifen-Partikel entlang der Strecke
function erzeugeNachbild(pState) {
  const farbe = schiffFarbe(pState);
  const el = document.createElement('div');
  el.classList.add('gleve-nachbild');
  el.style.backgroundColor = farbe;
  el.style.left = pState.x + 'px';
  el.style.top = pState.y + 'px';
  dom.spielfeld.appendChild(el);
  arrays.partikelArray.push({ el, x: pState.x, y: pState.y, vx: 0, vy: 0, leben: 0.7, zerfall: 0.08 });

  for (let i = 0; i < 2; i++) {
    const pEl = document.createElement('div');
    pEl.classList.add('partikel');
    pEl.style.backgroundColor = i === 0 ? farbe : '#ffffff';
    const px = pState.x + 15 + (Math.random() * 16 - 8);
    const py = pState.y + 15 + (Math.random() * 16 - 8);
    pEl.style.left = px + 'px';
    pEl.style.top = py + 'px';
    dom.spielfeld.appendChild(pEl);
    arrays.partikelArray.push({
      el: pEl,
      x: px,
      y: py,
      vx: -pState.gleveDashVx * 0.15,
      vy: -pState.gleveDashVy * 0.15,
      leben: 1.0,
      zerfall: 0.07
    });
  }
}

// Funken und Schnitt-Effekt am getroffenen Ziel
function erzeugeFunken(pState, z) {
  const g = z.groesse || 20;
  const cx = z.x + (z.width || g) / 2;
  const cy = z.y + (z.height || g) / 2;
  Utils.erzeugeExplosion(cx, cy, '#ffffff', 8);
  Utils.erzeugeExplosion(cx, cy, schiffFarbe(pState), 4);
}
