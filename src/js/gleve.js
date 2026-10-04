// Gleve-MR: Laser-Sweep als Hauptwaffe (Laser-Taste, laserStufe, kostet Energie), Dash als Zweitwaffe
// (Raketen-Taste, raketenStufe, Cooldown ueber raketenCooldown). pState ist `state` (P1) oder `state.p2`, pKey 'p1' / 'p2'.
// Zustand pro Spieler: gleveDashTimer, gleveDashVx/Vy (Schritt pro Frame, auch fuer den Abprall),
// gleveAbprallTimer, gleveUnverwundbar, gleveDashTasteGehalten (Flanke), gleveDashTreffer (Ziele dieses Dashs).
// Sweep: gleveSweepTimer (Restframes), gleveSweepWinkel (aktueller Strahlwinkel in Grad, 0 = senkrecht nach oben,
// positiv = rechts), gleveSweepRichtung (+1 links->rechts, -1 rechts->links; wechselt bei jedem Start),
// gleveSweepTreffer (Ziele dieses Sweeps), gleveSweepTakt (Frames bis zum naechsten moeglichen Start).

import { state, dom, config, arrays, shipModels, shipColors } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Hack from './hack.js';
import * as Entities from './entities.js';

export const DASH_FRAMES = 8;
export const DASH_NACHLAUF_FRAMES = 10; // Unverwundbar nach dem Dash
export const ABPRALL_FRAMES = 8;
export const ABPRALL_NACHLAUF_FRAMES = 30; // Unverwundbar nach dem Abprall
const ABPRALL_TIEFER = 30;

// Werte pro Stufe (raketenStufe 1-5)
const DASH_REICHWEITE = [100, 110, 120, 135, 150];
const DASH_SCHADEN = [60, 70, 80, 90, 100];
const DASH_COOLDOWN = [180, 165, 150, 135, 120];

function dashStufenIndex(pState) {
  return Math.max(1, Math.min(5, pState.raketenStufe || 1)) - 1;
}

export function dashReichweite(pState) { return DASH_REICHWEITE[dashStufenIndex(pState)]; }
export function dashSchaden(pState) { return DASH_SCHADEN[dashStufenIndex(pState)]; }
export function dashCooldown(pState) { return DASH_COOLDOWN[dashStufenIndex(pState)]; }
// Dash-Ladungen: Stufe 1-3 -> 2, Stufe 4-5 -> 3. raketenCooldown ist die Ladezeit der naechsten Ladung.
export function dashMaxLadungen(pState) { return (pState.raketenStufe || 1) >= 4 ? 3 : 2; }

// Ladungen voll, kein laufendes Nachladen (Spielstart, Neustart, Schiffswechsel)
export function setzeDashLadungenVoll(pState) {
  pState.gleveDashLadungen = dashMaxLadungen(pState);
  pState.raketenCooldown = 0;
}

// Eine Ladung ist fertig geladen: +1, danach weiter nachladen, bis voll
function schliesseNachladenAb(pState) {
  const max = dashMaxLadungen(pState);
  pState.gleveDashLadungen = Math.min(max, (pState.gleveDashLadungen || 0) + 1);
  pState.raketenCooldown = pState.gleveDashLadungen < max ? dashCooldown(pState) : 0;
}

// Pro Schritt (waffen.js): Nachladen der Dash-Ladungen
export function aktualisiereDashLadungen(pState) {
  const max = dashMaxLadungen(pState);
  if (pState.gleveDashLadungen === undefined) pState.gleveDashLadungen = max;
  if (pState.gleveDashLadungen > max) pState.gleveDashLadungen = max;
  if (pState.raketenCooldown > 0) {
    pState.raketenCooldown--;
    if (pState.raketenCooldown <= 0) {
      if (pState.gleveDashLadungen < max) schliesseNachladenAb(pState);
      else pState.raketenCooldown = 0;
    }
  } else if (pState.gleveDashLadungen < max) {
    // z. B. nach Upgrade auf Stufe 4: Nachladen starten
    pState.raketenCooldown = dashCooldown(pState);
  }
}

// HUD der Dash-Ladungen: Balken = Fortschritt der naechsten Ladung (voll/gruen bei vollen Ladungen),
// Punkte = Ladungen (gefuellt = vorhanden), mobil Ladungszahl und Fuellung am Raketen-Button des lokalen Schiffs.
export function zeigeDashHud(pKey, pState) {
  if (!pState || !istGleve(pState)) return;
  const sfx = pKey === 'p2' ? '-p2' : '';
  const max = dashMaxLadungen(pState);
  const ladungen = Math.max(0, Math.min(max, Math.round(pState.gleveDashLadungen === undefined ? max : pState.gleveDashLadungen)));
  const voll = ladungen >= max;
  const pct = voll ? 100 : Math.max(0, Math.min(100, 100 - (pState.raketenCooldown || 0) / dashCooldown(pState) * 100));

  const balken = document.getElementById('raketen-cd-balken' + sfx);
  if (balken) {
    balken.style.width = pct + '%';
    balken.style.backgroundColor = voll ? '#2ecc71' : '#e74c3c';
  }
  const container = document.getElementById('dash-ladungen' + sfx);
  if (container) {
    while (container.children.length < max) {
      const punkt = document.createElement('div');
      punkt.className = 'dash-ladung';
      container.appendChild(punkt);
    }
    while (container.children.length > max) container.lastChild.remove();
    for (let i = 0; i < max; i++) container.children[i].classList.toggle('voll', i < ladungen);
  }

  const istClient = state.gameMode === 'online' && state.network && state.network.isClient;
  if ((pKey === 'p2') === !!istClient) {
    const zahl = document.getElementById('btn-rakete-ladungen');
    if (zahl) {
      zahl.style.display = '';
      zahl.textContent = String(ladungen);
    }
    const fuellung = document.getElementById('btn-rakete-cd');
    if (fuellung) {
      fuellung.style.height = pct + '%';
      fuellung.style.backgroundColor = voll ? 'rgba(46, 204, 113, 0.5)' : 'rgba(231, 76, 60, 0.5)';
    }
  }
}

// Ab Raketen-Stufe 5 knackt der Dash Magma
export function dashKnacktMagma(pState) {
  return (pState.raketenStufe || 1) >= 5;
}

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
  return (pState.gleveDashLadungen || 0) >= 1;
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
  pState.gleveDashLadungen = Math.max(0, (pState.gleveDashLadungen || 0) - 1);
  if ((pState.raketenCooldown || 0) <= 0) pState.raketenCooldown = dashCooldown(pState);
  pState.gleveDashRichtung = { dx, dy };
  const schritt = dashReichweite(pState) / DASH_FRAMES;
  pState.gleveDashVx = dx * schritt;
  pState.gleveDashVy = dy * schritt;
  pState.gleveDashTimer = DASH_FRAMES;
  pState.gleveAbprallTimer = 0;
  pState.gleveDashTreffer = [];
  pState.gleveUnverwundbar = Math.max(pState.gleveUnverwundbar || 0, DASH_FRAMES + DASH_NACHLAUF_FRAMES);
  Audio.playDash(pState.raketenStufe);
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

// Kill-Kette: jeder durch einen Dash zerstoerte Gegner verkuerzt das laufende Nachladen
function belohneKill(pState, z) {
  if (!z.istFeind && !z.istBoss) return;
  const bonus = (shipModels.gleve && shipModels.gleve.dashKillCooldown) || 0;
  if ((pState.raketenCooldown || 0) <= 0) return; // nichts am Laden
  pState.raketenCooldown = Math.max(0, pState.raketenCooldown - bonus);
  if (pState.raketenCooldown <= 0) schliesseNachladenAb(pState);
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
  const stufe5 = dashKnacktMagma(pState);
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
// tasteGedrueckt: Raketen-Taste dieses Spielers, richtung: { dx, dy } aus der Steuerung (Hacks bereits angewendet).
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

// --- ONLINE-CLIENT ---
// Der Client steuert sein Schiff selbst und schickt die Position an den Host. Den eigenen Dash sagt er
// mit derselben Bewegung voraus: Im Schritt des Tastendrucks bleibt das Schiff stehen und das Eingabe-Paket
// traegt Startposition und Richtung zum Host, der von genau dort aus dasht (und solange Client-Positionen
// ignoriert). Ab dem naechsten Schritt laufen beide Dashs gleich. Treffer, Schaden und der Abprall bleiben
// beim Host: An Bossen/Magma haelt die Vorhersage nur an, den Abprall uebernimmt der Client aus dem Snapshot.

// Steht das Schiff im naechsten Dash-Schritt in einem Hindernis (Boss, Magma unter Stufe 5)?
function hindernisAufClient(pState) {
  const stufe5 = dashKnacktMagma(pState);
  for (const b of arrays.bosses) {
    if (ueberlappt(pState, b, (b.groesse || 100) * 0.15)) return true;
  }
  if (!stufe5) {
    for (const a of arrays.asteroiden) {
      if (a.istUnzerstoerbar && ueberlappt(pState, a)) return true;
    }
  }
  return false;
}

// Pro Client-Schritt fuer das eigene Schiff (vor der normalen Steuerung). Liefert true, wenn
// Dash/Abprall die Bewegung in diesem Schritt uebernimmt.
export function sageDashVorher(pState, tasteGedrueckt, richtung) {
  const flanke = !!tasteGedrueckt && !pState.gleveDashTasteGehalten;
  pState.gleveDashTasteGehalten = !!tasteGedrueckt;
  if (pState.isDead) {
    pState.gleveDashTimer = 0;
    pState.gleveNetzAbprall = null;
    return false;
  }

  // Abprall vom Host: zur gemeldeten Host-Position gleiten
  if (pState.gleveNetzAbprall) {
    const ziel = pState.gleveNetzAbprall;
    pState.x += (ziel.x - pState.x) / 2;
    pState.y += (ziel.y - pState.y) / 2;
    begrenzeAufSpielfeld(pState);
    // Sicherheitsnetz, falls kein Snapshot mehr kommt
    if (++ziel.schritte > ABPRALL_FRAMES + ABPRALL_NACHLAUF_FRAMES) {
      pState.gleveNetzAbprall = null;
      pState.gleveAbprallTimer = 0;
    }
    return true;
  }

  if ((pState.gleveDashTimer || 0) > 0) {
    const altX = pState.x;
    const altY = pState.y;
    pState.x += pState.gleveDashVx;
    pState.y += pState.gleveDashVy;
    begrenzeAufSpielfeld(pState);
    pState.gleveDashTimer--;
    if (hindernisAufClient(pState)) {
      // Am Hindernis stehen bleiben, der Host meldet den Abprall
      pState.x = altX;
      pState.y = altY;
      pState.gleveDashTimer = 0;
    }
    return true;
  }

  // Ohne Ladung laut letztem Snapshot kein Dash (kannDashen prueft gleveDashLadungen)
  if (flanke && kannDashen(pState)) {
    starteDash(pState, 'p2', richtung);
    pState.gleveDashStartX = pState.x;
    pState.gleveDashStartY = pState.y;
    return true; // Startschritt ohne Bewegung (siehe oben)
  }
  return false;
}

// Was der Client dem Host meldet: waehrend des vorhergesagten Dashs Startposition und Dash-Richtung
export function netzEingabe(pState, richtung) {
  if (istGleve(pState) && (pState.gleveDashTimer || 0) > 0 && pState.gleveDashRichtung) {
    return { x: pState.gleveDashStartX, y: pState.gleveDashStartY, rx: pState.gleveDashRichtung.dx, ry: pState.gleveDashRichtung.dy };
  }
  return { x: pState.x, y: pState.y, rx: richtung ? richtung.dx : 0, ry: richtung ? richtung.dy : 0 };
}

// Gleve-Zustand eines Spielers aus dem Host-Snapshot uebernehmen. eigenes: Schiff des Clients
// (Dash lokal vorhergesagt, vom Host kommen nur Abprall, Sweep und Unverwundbarkeit).
export function uebernehmeSnapshot(pState, daten, eigenes) {
  if (!daten || daten.gleveSweepTimer === undefined) return;
  if (daten.gleveDashLadungen !== undefined) pState.gleveDashLadungen = daten.gleveDashLadungen;
  const sweepTimer = daten.gleveSweepTimer || 0;
  const sweepRichtung = daten.gleveSweepRichtung || 0;
  // Neuer Sweep: Richtung wechselt bei jedem Einsatz
  if (sweepTimer > 0 && sweepRichtung !== (pState.gleveSweepRichtung || 0)) Audio.playSweep(pState.laserStufe);
  pState.gleveSweepTimer = sweepTimer;
  pState.gleveSweepWinkel = daten.gleveSweepWinkel || 0;
  pState.gleveSweepRichtung = sweepRichtung;
  pState.gleveUnverwundbar = daten.gleveUnverwundbar || 0;

  const abprall = daten.gleveAbprallTimer || 0;
  if (eigenes) {
    if (abprall > 0) {
      pState.gleveDashTimer = 0;
      pState.gleveAbprallTimer = abprall;
      pState.gleveNetzAbprall = { x: daten.x, y: daten.y, schritte: 0 };
    } else if (pState.gleveNetzAbprall) {
      // Abprall auf dem Host beendet: Landepunkt uebernehmen, danach steuert wieder der Client
      if (Number.isFinite(daten.x)) pState.x = daten.x;
      if (Number.isFinite(daten.y)) pState.y = daten.y;
      pState.gleveNetzAbprall = null;
      pState.gleveAbprallTimer = 0;
    }
  } else {
    const dash = daten.gleveDashTimer || 0;
    if (dash > 0 && !istDashAktiv(pState)) Audio.playDash(pState.raketenStufe);
    pState.gleveDashTimer = dash;
    pState.gleveAbprallTimer = abprall;
  }
}

// Pro Client-Schritt fuer beide Schiffe: Dash-Darstellung und Sweep-Klinge zwischen den Snapshots
export function zeigeGleveZustand(pState, pKey) {
  const el = schiffElement(pKey);
  const gleve = istGleve(pState) && !pState.isDead;
  const dash = gleve && istDashAktiv(pState);
  if (el) el.classList.toggle('gleve-dash', dash);
  if (dash) erzeugeNachbild(pState);

  if (gleve && istSweepAktiv(pState)) {
    zeigeKlinge(pState, pKey);
    // Strahl bis zum naechsten Snapshot weiterdrehen
    pState.gleveSweepWinkel += (pState.gleveSweepRichtung || 1) * sweepBogen(pState) / SWEEP_FRAMES;
    pState.gleveSweepTimer--;
    if (pState.gleveSweepTimer <= 0) {
      pState.gleveSweepTimer = 0;
      entferneKlinge(pKey);
      erzeugeFaecherSpur(pState);
    }
  } else if (klingen[pKey]) {
    entferneKlinge(pKey);
  }
}

// --- LASER-SWEEP ---

export const SWEEP_FRAMES = 10;
const SWEEP_UMKEHR_TEMPO = 10; // zurueckgeworfene Geschosse fliegen mit vy 10 nach oben
const SWEEP_UMKEHR_SCHADEN = 15;
const SWEEP_PARADE_FARBE = '#e67e22';

// Werte pro Stufe (laserStufe 1-5). Bogen in Grad, symmetrisch um die Senkrechte;
// Takt = Frames von einem Sweep-Start bis zum naechsten, solange die Taste gehalten wird
const SWEEP_BOGEN = [90, 105, 120, 135, 150];
const SWEEP_LAENGE = [100, 110, 120, 130, 140];
const SWEEP_SCHADEN = [30, 35, 40, 45, 50];
const SWEEP_TAKT = [20, 19, 18, 17, 16];
const SWEEP_KOSTEN = [8, 8, 7, 7, 6];

function sweepStufenIndex(pState) {
  return Math.max(1, Math.min(5, pState.laserStufe || 1)) - 1;
}

export function sweepBogen(pState) { return SWEEP_BOGEN[sweepStufenIndex(pState)]; }
export function sweepLaenge(pState) { return SWEEP_LAENGE[sweepStufenIndex(pState)]; }
export function sweepSchaden(pState) { return SWEEP_SCHADEN[sweepStufenIndex(pState)]; }
export function sweepTakt(pState) { return SWEEP_TAKT[sweepStufenIndex(pState)]; }
export function sweepKosten(pState) { return SWEEP_KOSTEN[sweepStufenIndex(pState)]; }

export function istSweepAktiv(pState) {
  return (pState.gleveSweepTimer || 0) > 0;
}

// Ursprung des Strahls: Schiffsmitte oben
function sweepUrsprung(pState) {
  return { x: pState.x + config.spielerGroesse / 2, y: pState.y + 5 };
}

// Box eines Ziels oder Geschosses (Bosse wie bei den anderen Waffen etwas verkleinert)
function zielBox(z) {
  const g = z.groesse || 20;
  const w = z.width || g;
  const h = z.height || g;
  const pad = z.istBoss ? g * 0.15 : 0;
  return { x1: z.x + pad, y1: z.y + pad, x2: z.x + w - pad, y2: z.y + h - pad };
}

// Liegt der Punkt im Kreissektor [winkelA, winkelB] (Grad, 0 = oben) bis zur Laenge?
function imSektor(o, px, py, winkelA, winkelB, laenge) {
  const dx = px - o.x;
  const dy = py - o.y;
  const dist = Math.hypot(dx, dy);
  if (dist > laenge) return false;
  if (dist < 0.5) return true;
  const phi = Math.atan2(dx, -dy) * 180 / Math.PI;
  return phi >= Math.min(winkelA, winkelB) - 0.001 && phi <= Math.max(winkelA, winkelB) + 0.001;
}

// Schneidet die Strahl-Strecke (Ursprung, Winkel, Laenge) die Box? (Slab-Verfahren)
function strahlTrifftBox(o, winkel, laenge, b) {
  const rad = winkel * Math.PI / 180;
  const dx = Math.sin(rad) * laenge;
  const dy = -Math.cos(rad) * laenge;
  let tMin = 0;
  let tMax = 1;
  for (const [start, d, lo, hi] of [[o.x, dx, b.x1, b.x2], [o.y, dy, b.y1, b.y2]]) {
    if (Math.abs(d) < 1e-9) {
      if (start < lo || start > hi) return false;
    } else {
      let t1 = (lo - start) / d;
      let t2 = (hi - start) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
  }
  return true;
}

// Wird die Box in diesem Frame vom Strahl ueberstrichen (Teilsektor winkelA -> winkelB)?
function imSweep(o, b, winkelA, winkelB, laenge) {
  // Naechster Punkt der Box zum Ursprung und Mittelpunkt
  const nx = Math.max(b.x1, Math.min(o.x, b.x2));
  const ny = Math.max(b.y1, Math.min(o.y, b.y2));
  if (imSektor(o, nx, ny, winkelA, winkelB, laenge)) return true;
  if (imSektor(o, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, winkelA, winkelB, laenge)) return true;
  // Breite Ziele, deren naechster Punkt ausserhalb des Bogens liegt, aber vom Strahl geschnitten werden
  return strahlTrifftBox(o, winkelA, laenge, b) || strahlTrifftBox(o, winkelB, laenge, b);
}

function kannSweepen(pState) {
  if (pState.isDead || istSweepAktiv(pState)) return false;
  return !Hack.hatHack(pState, 'waffenOffline');
}

// Startet einen Sweep (Kosten und Takt regelt steuereSweep). Liefert true, wenn der Sweep gestartet wurde.
export function starteSweep(pState, pKey) {
  if (!kannSweepen(pState)) return false;
  pState.gleveSweepRichtung = (pState.gleveSweepRichtung || -1) > 0 ? -1 : 1;
  pState.gleveSweepWinkel = -pState.gleveSweepRichtung * sweepBogen(pState) / 2;
  pState.gleveSweepTimer = SWEEP_FRAMES;
  pState.gleveSweepTreffer = [];
  Audio.playSweep(pState.laserStufe);
  zeigeKlinge(pState, pKey);
  return true;
}

// Pro Simulationsschritt aus spieler.js (Energie-Phase): Takt herunterzaehlen und, solange die Laser-Taste
// gehalten wird, im Takt pendelnde Sweeps starten (Kosten beim Start, Superwaffe kostenlos).
// Liefert true, wenn in diesem Schritt ein Sweep gestartet wurde.
export function steuereSweep(pState, pKey, gehalten) {
  if ((pState.gleveSweepTakt || 0) > 0) pState.gleveSweepTakt--;
  if (!gehalten || (pState.gleveSweepTakt || 0) > 0) return false;
  const kosten = pState.unbegrenzteEnergie ? 0 : sweepKosten(pState);
  if ((pState.energie || 0) < kosten || !starteSweep(pState, pKey)) return false;
  pState.energie -= kosten;
  pState.gleveSweepTakt = sweepTakt(pState);
  return true;
}

// Sweep abbrechen (Tod, Neustart): Klinge entfernen
export function beendeSweep(pState, pKey) {
  pState.gleveSweepTimer = 0;
  pState.gleveSweepTreffer = [];
  entferneKlinge(pKey);
}

// Schaden fuer alle in diesem Frame ueberstrichenen Ziele (je einmal pro Sweep)
function sweepTreffer(pState, pKey, o, winkelA, winkelB, laenge) {
  const schaden = sweepSchaden(pState);
  const treffer = pState.gleveSweepTreffer || (pState.gleveSweepTreffer = []);
  const ziele = [...arrays.feinde, ...arrays.asteroiden, ...arrays.bosses, ...arrays.bossRaketenArray, ...arrays.bossBombenArray];
  for (const z of ziele) {
    // Magma bleibt unversehrt
    if (z.istUnzerstoerbar || treffer.includes(z) || (z.immune || 0) > 0) continue;
    if (!imSweep(o, zielBox(z), winkelA, winkelB, laenge)) continue;
    treffer.push(z);
    erzeugeFunken(pState, z);
    schadeZiel(z, schaden, pKey);
  }
}

// Parade: Feind-, Hack- und Boss-Geschosse, die der Strahl beruehrt, werden weggeschleudert oder zurueckgeworfen
function sweepParade(pState, pKey, o, winkelA, winkelB, laenge) {
  const stufe = pState.laserStufe || 1;
  const listen = [arrays.feindLaserArray, arrays.hackProjektilArray, arrays.bossLaserArray];
  for (const liste of listen) {
    for (let i = liste.length - 1; i >= 0; i--) {
      const p = liste[i];
      if (p.harmlos || !imSweep(o, zielBox(p), winkelA, winkelB, laenge)) continue;
      const zurueck = stufe >= 5 || (stufe >= 3 && Math.random() < 0.5);
      erzeugeParadeFunken(p);
      if (zurueck) {
        liste.splice(i, 1);
        wirfZurueck(p, pKey);
      } else {
        schleudereWeg(p, o);
      }
    }
  }
}

function faerbeOrange(el) {
  if (!el) return;
  el.style.backgroundColor = SWEEP_PARADE_FARBE;
  el.style.boxShadow = `0 0 10px ${SWEEP_PARADE_FARBE}`;
}

// Seitlich weg von der Schiffsmitte, harmlos (gegner.js / boss.js pruefen `harmlos`), verlaesst das Feld
function schleudereWeg(p, o) {
  const b = zielBox(p);
  let seite = Math.sign((b.x1 + b.x2) / 2 - o.x);
  if (seite === 0) seite = Math.random() < 0.5 ? -1 : 1;
  p.harmlos = true;
  p.lenkZeit = 0; // Hack-Projektile lenken nicht mehr nach
  p.vx = seite * 9;
  p.vy = -1.5;
  zeigePariert(p.el, p.vx, p.vy);
}

// Darstellung eines weggeschleuderten Geschosses (auch beim Online-Client aus dem harmlos-Flag)
export function zeigePariert(el, vx, vy) {
  if (!el) return;
  el.classList.add('gleve-pariert');
  faerbeOrange(el);
  if (Number.isFinite(vx) && Number.isFinite(vy) && (vx || vy)) {
    el.style.transform = `rotate(${Math.atan2(vy, vx) * 180 / Math.PI - 90}deg)`;
  }
}

// Zurueckgeworfen: wird zum Spieler-Projektil in arrays.laserArray (Bewegung y -= vy)
function wirfZurueck(p, pKey) {
  const el = p.el || document.createElement('div');
  el.className = 'laser-projektil gleve-reflektiert';
  if (pKey === 'p2') el.classList.add('laser-p2');
  faerbeOrange(el);
  el.style.width = (p.width || 4) + 'px';
  el.style.height = (p.height || 15) + 'px';
  el.style.left = p.x + 'px';
  el.style.top = p.y + 'px';
  el.style.transform = 'rotate(0deg)';
  if (!el.isConnected) dom.spielfeld.appendChild(el);
  arrays.laserArray.push({
    id: Entities.neueId('l'),
    el,
    x: p.x,
    y: p.y,
    vx: 0,
    vy: SWEEP_UMKEHR_TEMPO,
    width: p.width || 4,
    height: p.height || 15,
    schaden: SWEEP_UMKEHR_SCHADEN,
    owner: pKey,
    reflektiert: true
  });
}

// Pro Simulationsschritt fuer eine Gleve aufrufen (aus waffen.js; gestartet wird in steuereSweep)
export function aktualisiereSweep(pState, pKey) {
  if (pState.isDead) {
    if (istSweepAktiv(pState)) beendeSweep(pState, pKey);
    return;
  }
  if (!istSweepAktiv(pState)) return;

  const richtung = pState.gleveSweepRichtung || 1;
  const winkelA = pState.gleveSweepWinkel;
  const winkelB = winkelA + richtung * sweepBogen(pState) / SWEEP_FRAMES;
  const o = sweepUrsprung(pState);
  const laenge = sweepLaenge(pState);

  sweepTreffer(pState, pKey, o, winkelA, winkelB, laenge);
  sweepParade(pState, pKey, o, winkelA, winkelB, laenge);

  pState.gleveSweepWinkel = winkelB;
  pState.gleveSweepTimer--;
  if (pState.gleveSweepTimer <= 0) {
    pState.gleveSweepTimer = 0;
    pState.gleveSweepTreffer = [];
    entferneKlinge(pKey);
    erzeugeFaecherSpur(pState);
  } else {
    zeigeKlinge(pState, pKey);
  }
}

// --- EFFEKTE ---

// Klingen-Element pro Spieler (nur Darstellung, nicht im State)
const klingen = { p1: null, p2: null };

function zeigeKlinge(pState, pKey) {
  let el = klingen[pKey];
  if (!el || !el.isConnected) {
    el = document.createElement('div');
    el.classList.add('gleve-klinge');
    dom.spielfeld.appendChild(el);
    klingen[pKey] = el;
  }
  const o = sweepUrsprung(pState);
  const laenge = sweepLaenge(pState);
  const farbe = schiffFarbe(pState);
  el.style.height = laenge + 'px';
  el.style.left = (o.x - 2) + 'px';
  el.style.top = (o.y - laenge) + 'px';
  el.style.boxShadow = `0 0 4px #ffffff, 0 0 8px ${farbe}, 0 0 14px ${farbe}`;
  el.style.borderColor = farbe;
  // Leicht gebogen: Neigung gegen die Laufrichtung
  el.style.borderRadius = (pState.gleveSweepRichtung || 1) > 0 ? '0 100% 0 0 / 0 100% 0 0' : '100% 0 0 0 / 100% 0 0 0';
  el.style.transform = `rotate(${pState.gleveSweepWinkel}deg)`;
}

function entferneKlinge(pKey) {
  if (klingen[pKey]) {
    klingen[pKey].remove();
    klingen[pKey] = null;
  }
}

// Kurz verblassende Faecher-Spur ueber den ganzen Bogen (Kreissektor ueber dem Ursprung)
function erzeugeFaecherSpur(pState) {
  const o = sweepUrsprung(pState);
  const laenge = sweepLaenge(pState);
  const farbe = schiffFarbe(pState);
  const bogen = sweepBogen(pState);
  const el = document.createElement('div');
  el.classList.add('gleve-faecher');
  el.style.width = (laenge * 2) + 'px';
  el.style.height = laenge + 'px';
  el.style.borderRadius = `${laenge}px ${laenge}px 0 0`;
  el.style.background = `conic-gradient(from ${-bogen / 2}deg at 50% 100%, ${farbe}99 0deg, rgba(255, 255, 255, 0.6) ${bogen / 2}deg, ${farbe}99 ${bogen}deg, transparent ${bogen}deg)`;
  const x = o.x - laenge;
  const y = o.y - laenge;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  dom.spielfeld.appendChild(el);
  arrays.partikelArray.push({ el, x, y, vx: 0, vy: 0, leben: 0.8, zerfall: 0.08 });
}

function erzeugeParadeFunken(p) {
  const b = zielBox(p);
  const cx = (b.x1 + b.x2) / 2;
  const cy = (b.y1 + b.y2) / 2;
  Utils.erzeugeExplosion(cx, cy, '#ffffff', 5);
  Utils.erzeugeExplosion(cx, cy, SWEEP_PARADE_FARBE, 5);
}

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
