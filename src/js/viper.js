// Viper-X: Ausweichrolle. Doppeltipp auf links/rechts (Tasten) bzw. schnelles seitliches Wischen auf der
// Joystick-Zone startet eine Rolle: ROLLE_FRAMES Schritte lang wird das Schiff gleichmaessig um ROLLE_DISTANZ px
// zur Seite versetzt, die normale Steuerung ruht und das Schiff ist unverwundbar (Utils.istDashUnverwundbar
// wertet viperRolleTimer mit aus). Danach ROLLE_COOLDOWN Schritte Pause (ab Rollenstart).
// pState ist `state` (P1) oder `state.p2`, pKey 'p1' / 'p2'.
// Zustand pro Spieler: viperRolleTimer (Rest-Schritte inkl. aktuellem), viperRolleRichtung (+1 rechts / -1 links),
// viperRolleCooldown, Erkennung: viperLinksGehalten/viperRechtsGehalten (Tasten-Flanken), viperTapRichtung/
// viperTapAlter (letzter Tipp und Schritte seitdem), viperJoyRuhe/viperJoyVorher (Wischen).

import { dom, config, arrays, shipColors } from './state.js';
import * as Audio from './audio.js';
import * as Hack from './hack.js';

export const ROLLE_FRAMES = 12;
export const ROLLE_DISTANZ = 70;
export const ROLLE_COOLDOWN = 90;
export const DOPPELTIPP_FENSTER = 15; // Schritte zwischen zwei Druck-Flanken (250 ms bei 60 Hz)
export const WISCH_FENSTER = 8; // Schritte vom Ruhebereich (|x| < 0.2) bis |x| > 0.8
const WISCH_RUHE = 0.2;
const WISCH_SCHWELLE = 0.8;

export function istViper(pState) {
  return !!pState && pState.selectedShipModel === 'viper';
}

export function istRolleAktiv(pState) {
  return !!pState && (pState.viperRolleTimer || 0) > 0;
}

function schiffElement(pKey) {
  return pKey === 'p2' ? dom.spieler2 : dom.spieler;
}

function schiffFarbe(pState) {
  const c = shipColors[pState.selectedShipColor];
  return c ? c.prim : '#ffffff';
}

// Doppeltipp (zwei Druck-Flanken derselben Richtung binnen DOPPELTIPP_FENSTER Schritten) oder Wisch-Flick des
// Joysticks. Liefert die physische Richtung (+1 rechts, -1 links, 0 keine). Laeuft jeden Schritt, auch waehrend
// Rolle und Cooldown, damit die Flanken nie verloren gehen.
function erkenneRichtung(p, e) {
  let richtung = 0;
  p.viperTapAlter = Math.min((p.viperTapAlter || 0) + 1, 999);
  const flankeL = Boolean(e.links) && !p.viperLinksGehalten;
  const flankeR = Boolean(e.rechts) && !p.viperRechtsGehalten;
  p.viperLinksGehalten = Boolean(e.links);
  p.viperRechtsGehalten = Boolean(e.rechts);
  const flanke = flankeL === flankeR ? 0 : (flankeR ? 1 : -1);
  if (flanke) {
    if (flanke === p.viperTapRichtung && p.viperTapAlter <= DOPPELTIPP_FENSTER) {
      richtung = flanke;
      p.viperTapRichtung = 0;
    } else {
      p.viperTapRichtung = flanke;
    }
    p.viperTapAlter = 0;
  }

  // Mobil: Joystick-x springt binnen WISCH_FENSTER Schritten aus der Ruhe ueber die Schwelle. Eine Fingerbewegung
  // von der Mitte zum Rand ist damit ein Wisch, langsames Hineinziehen oder Halten am Rand loest nichts aus.
  if (e.joyX !== undefined) {
    const betrag = Math.abs(e.joyX);
    p.viperJoyRuhe = betrag < WISCH_RUHE ? 0 : Math.min((p.viperJoyRuhe || 0) + 1, 99);
    if (betrag > WISCH_SCHWELLE && (p.viperJoyVorher || 0) <= WISCH_SCHWELLE && p.viperJoyRuhe <= WISCH_FENSTER) {
      richtung = e.joyX > 0 ? 1 : -1;
    }
    p.viperJoyVorher = betrag;
  }
  return richtung;
}

// Steuerungs-Hacks lenken die Rolle wie eine normale Seitwaertsbewegung um (0 = nicht seitlich, keine Rolle)
export function richtungNachHack(pState, richtung) {
  if (!richtung) return 0;
  return Math.sign(Hack.hackeBewegung(pState, richtung, 0).dx);
}

function kannRollen(p) {
  return !p.isDead && !istRolleAktiv(p) && (p.viperRolleCooldown || 0) <= 0;
}

function starteRolle(p, richtung) {
  p.viperRolleTimer = ROLLE_FRAMES;
  p.viperRolleRichtung = richtung;
  p.viperRolleCooldown = ROLLE_COOLDOWN;
  // Online-Client: Startposition und Richtung gehen im Eingabe-Paket zum Host (siehe netzEingabe)
  p.viperNetzStart = { x: p.x, y: p.y, ro: richtung };
  Audio.playRolle();
}

function rolleSchritt(p) {
  p.x = Math.max(0, Math.min(config.spielfeldBreite - config.spielerGroesse, p.x + p.viperRolleRichtung * ROLLE_DISTANZ / ROLLE_FRAMES));
  erzeugeNachbild(p);
}

// Ein Schritt fuer ein Viper-Schiff, vor der normalen Steuerung. eingabe: { links, rechts, joyX } (physische Tasten
// bzw. Joystick, Hacks wendet diese Funktion an) oder null; anfrage: fertige Richtung von Bot bzw. Online-Host
// (Hacks schon angewendet). Liefert true, wenn die Rolle in diesem Schritt die Bewegung uebernimmt.
export function aktualisiereViper(pState, pKey, eingabe, anfrage = 0) {
  if ((pState.viperRolleTimer || 0) > 0) pState.viperRolleTimer--;
  if ((pState.viperRolleCooldown || 0) > 0) pState.viperRolleCooldown--;
  pState.viperNetzStart = null;

  const el = schiffElement(pKey);
  if (pState.isDead) {
    pState.viperRolleTimer = 0;
    if (el) el.classList.remove('viper-rolle');
    return false;
  }

  let wunsch = anfrage || 0;
  if (eingabe) wunsch = richtungNachHack(pState, erkenneRichtung(pState, eingabe)) || wunsch;
  if (wunsch && kannRollen(pState)) starteRolle(pState, wunsch);

  const rollt = istRolleAktiv(pState);
  if (rollt) rolleSchritt(pState);
  if (el) el.classList.toggle('viper-rolle', rollt);
  return rollt;
}

// Tastenzustand eines Spielers fuer aktualisiereViper (Joystick nur, wenn er aktiv ist)
export function eingabeVonTasten(links, rechts, joystick) {
  return { links, rechts, joyX: joystick && joystick.active ? joystick.x : 0 };
}

// --- ONLINE ---
// Der Client sagt seine eigene Rolle mit derselben Funktion voraus (aktualisiereViper). Im Startschritt traegt das
// Eingabe-Paket Startposition und Richtung (ro); der Host startet von dort dieselbe Rolle, ignoriert waehrenddessen
// Client-Positionen und ist fuer Treffer massgeblich. Der Snapshot bringt Timer/Richtung/Cooldown fuer die Anzeige
// (P1 des Hosts) und gleicht den Cooldown des Clients nach oben ab.

export function netzEingabe(pState) {
  return pState.viperNetzStart || null;
}

export function uebernehmeSnapshot(pState, daten, eigenes) {
  if (!daten || daten.viperRolleTimer === undefined) return;
  const cooldown = daten.viperRolleCooldown || 0;
  if (eigenes) {
    // Rolle laeuft lokal vorhergesagt; der Cooldown des Hosts gilt, wenn er laenger ist
    if (cooldown > (pState.viperRolleCooldown || 0)) pState.viperRolleCooldown = cooldown;
    return;
  }
  const timer = daten.viperRolleTimer || 0;
  if (timer > 0 && !istRolleAktiv(pState)) Audio.playRolle();
  pState.viperRolleTimer = timer;
  pState.viperRolleRichtung = daten.viperRolleRichtung || 0;
  pState.viperRolleCooldown = cooldown;
}

// Pro Client-Schritt: Klasse, Nachbilder und Bereitschaftsanzeige. Fremde Schiffe (P1 des Hosts) zaehlen den
// Timer zwischen den Snapshots selbst herunter, das eigene Schiff macht aktualisiereViper.
export function zeigeViperZustand(pState, pKey, eigenes) {
  const el = schiffElement(pKey);
  const viper = istViper(pState) && !pState.isDead;
  const rollt = viper && istRolleAktiv(pState);
  if (el) el.classList.toggle('viper-rolle', rollt);
  if (rollt && !eigenes) {
    erzeugeNachbild(pState);
    pState.viperRolleTimer--;
    if ((pState.viperRolleCooldown || 0) > 0) pState.viperRolleCooldown--;
  }
  zeigeRollenHud(pKey, pState);
}

// --- HUD ---

const hudZustand = { p1: '', p2: '' };

// Kleiner Bereitschaftsbalken neben dem Energiebalken, nur bei Viper (P2 nur, wenn P2 mitspielt)
export function zeigeRollenHud(pKey, pState, sichtbar = true) {
  const el = document.getElementById(pKey === 'p2' ? 'viper-rolle-hud-p2' : 'viper-rolle-hud');
  if (!el) return;
  const zeigen = sichtbar && istViper(pState);
  const cd = pState ? (pState.viperRolleCooldown || 0) : 0;
  const bereit = zeigen && cd <= 0 && !istRolleAktiv(pState);
  const fuell = zeigen ? Math.round((1 - cd / ROLLE_COOLDOWN) * 100) : 0;
  const signatur = `${zeigen}|${bereit}|${fuell}`;
  if (hudZustand[pKey] === signatur) return;
  hudZustand[pKey] = signatur;
  el.style.display = zeigen ? 'block' : 'none';
  el.classList.toggle('bereit', bereit);
  const balken = el.firstElementChild;
  if (balken) balken.style.width = Math.max(0, Math.min(100, fuell)) + '%';
}

export function setzeZurueck(pState, schiffEl) {
  pState.viperRolleTimer = 0;
  pState.viperRolleRichtung = 0;
  pState.viperRolleCooldown = 0;
  pState.viperLinksGehalten = false;
  pState.viperRechtsGehalten = false;
  pState.viperTapRichtung = 0;
  pState.viperTapAlter = 999;
  pState.viperJoyRuhe = 0;
  pState.viperJoyVorher = 0;
  pState.viperNetzStart = null;
  // Bot und Online-Host: gemerkte Rollenwuensche
  pState.botRolleAnfrage = 0;
  pState.netzRolleAnfrage = 0;
  if (schiffEl) schiffEl.classList.remove('viper-rolle');
}

// Nachbild in Schiffsfarbe plus ein Funken-Partikel am Schiff
function erzeugeNachbild(pState) {
  const farbe = schiffFarbe(pState);
  const el = document.createElement('div');
  el.classList.add('viper-nachbild');
  el.style.backgroundColor = farbe;
  el.style.left = pState.x + 'px';
  el.style.top = pState.y + 'px';
  dom.spielfeld.appendChild(el);
  arrays.partikelArray.push({ el, x: pState.x, y: pState.y, vx: 0, vy: 0, leben: 0.6, zerfall: 0.08 });

  const pEl = document.createElement('div');
  pEl.classList.add('partikel');
  pEl.style.backgroundColor = '#ffffff';
  const px = pState.x + 15 + (Math.random() * 12 - 6);
  const py = pState.y + 15 + (Math.random() * 12 - 6);
  pEl.style.left = px + 'px';
  pEl.style.top = py + 'px';
  dom.spielfeld.appendChild(pEl);
  arrays.partikelArray.push({
    el: pEl,
    x: px,
    y: py,
    vx: -(pState.viperRolleRichtung || 0) * 1.2,
    vy: 0,
    leben: 1.0,
    zerfall: 0.07
  });
}
