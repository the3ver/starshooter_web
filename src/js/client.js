
import { state, dom, config, arrays, shipModels } from './state.js';
import * as Network from './network.js';
import * as Hack from './hack.js';
import { animierenPartikel } from './partikel.js';
import { zeichneTraktorstrahl, entferneTraktorstrahl } from './powerups.js';
import * as Gleve from './gleve.js';
import * as Viper from './viper.js';

// Steuerrichtung des Clients (Joystick normalisiert oder Tasten, Hacks angewendet)
function steuerRichtung(keys) {
  if (state.joystick && state.joystick.active) {
    const mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
    if (mag <= 0.1) return { dx: 0, dy: 0 };
    return Hack.hackeBewegung(state.p2, state.joystick.x / mag, state.joystick.y / mag);
  }
  return Hack.hackeBewegung(state.p2,
    ((keys.d || keys.arrowright) ? 1 : 0) - ((keys.a || keys.arrowleft) ? 1 : 0),
    ((keys.s || keys.arrowdown) ? 1 : 0) - ((keys.w || keys.arrowup) ? 1 : 0));
}


// --- GLAETTUNG ZWISCHEN HOST-SNAPSHOTS ---
// Der Host sendet nur jeden 2. Simulationsschritt einen Snapshot. Dazwischen bewegt der Client:
// - Projektile mit bekannter Geschwindigkeit weiter (Extrapolation, der naechste Snapshot korrigiert)
// - alle anderen entfernten Objekte gleichmaessig zur letzten Snapshot-Position (Interpolation)
export const INTERPOLATION_SCHRITTE = 2;     // Schritte zwischen zwei Host-Snapshots
export const SPRUNG_DISTANZ = 100;           // ab dieser Distanz (px) springen statt gleiten (Respawn/Teleport)
export const MAX_EXTRAPOLATION_SCHRITTE = 4; // ohne neuen Snapshot nicht endlos weiterfliegen

// Angezeigte Position des Host-Schiffs (P1) auf dem Client
export const p1Anzeige = {};

let schritteSeitSnapshot = 0;

export function snapshotEmpfangen() {
  schritteSeitSnapshot = 0;
}

// Glaetten nur, wenn clientSchritt auch laeuft; sonst Snapshot-Position direkt zeigen
function glaettungAktiv() {
  return Boolean(state.network && state.network.isClient && state.network.connected && !state.pausiert);
}

function setzePosition(el, x, y) {
  if (!el) return;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

// Neue Snapshot-Position (x, y) fuer ein entferntes Objekt merken. Das Objekt gleitet in
// INTERPOLATION_SCHRITTE Schritten von seiner angezeigten Position dorthin.
export function setzeInterpolationsZiel(obj, el, x, y) {
  const distanz = Math.hypot(x - obj.anzeigeX, y - obj.anzeigeY); // NaN beim ersten Mal
  obj.zielX = x;
  obj.zielY = y;
  if (!glaettungAktiv() || !(distanz <= SPRUNG_DISTANZ)) {
    obj.anzeigeX = x;
    obj.anzeigeY = y;
    obj.ipSchritte = 0;
    setzePosition(el, x, y);
    return;
  }
  obj.ipDx = (x - obj.anzeigeX) / INTERPOLATION_SCHRITTE;
  obj.ipDy = (y - obj.anzeigeY) / INTERPOLATION_SCHRITTE;
  obj.ipSchritte = INTERPOLATION_SCHRITTE;
}

function interpoliere(obj, el) {
  if (!obj.ipSchritte) return;
  obj.ipSchritte--;
  if (obj.ipSchritte === 0) {
    obj.anzeigeX = obj.zielX;
    obj.anzeigeY = obj.zielY;
  } else {
    obj.anzeigeX += obj.ipDx;
    obj.anzeigeY += obj.ipDy;
  }
  setzePosition(el, obj.anzeigeX, obj.anzeigeY);
}

// Fuer Projektile ohne Geschwindigkeit im Snapshot: aus zwei Snapshots ableiten
export function leiteGeschwindigkeitAb(obj, x, y) {
  if (obj.snapX !== undefined) {
    obj.vx = (x - obj.snapX) / INTERPOLATION_SCHRITTE;
    obj.vy = (y - obj.snapY) / INTERPOLATION_SCHRITTE;
  }
  obj.snapX = x;
  obj.snapY = y;
}

function bewegeProjektil(o, vx, vy) {
  if (!vx && !vy) return;
  o.x += vx || 0;
  o.y += vy || 0;
  setzePosition(o.el, o.x, o.y);
}

function extrapoliereProjektile() {
  if (schritteSeitSnapshot >= MAX_EXTRAPOLATION_SCHRITTE) return;
  schritteSeitSnapshot++;
  // Spielerlaser fliegen auf dem Host mit y -= vy
  arrays.laserArray.forEach(l => bewegeProjektil(l, l.vx, -(l.vy || 0)));
  [arrays.feindLaserArray, arrays.hackProjektilArray, arrays.bossLaserArray, arrays.bossRaketenArray,
    arrays.raketenArray, arrays.bombenArray, arrays.bossBombenArray].forEach(liste => {
    liste.forEach(o => bewegeProjektil(o, o.vx, o.vy));
  });
}

function interpoliereObjekte() {
  [arrays.feinde, arrays.asteroiden, arrays.bosses, arrays.powerups].forEach(liste => {
    liste.forEach(o => interpoliere(o, o.el));
  });
  interpoliere(p1Anzeige, dom.spieler);
}

// Traktorstrahlen geschleppter Powerups mit derselben Darstellung wie beim Host zeichnen
function zeichneTraktorstrahlen() {
  const ss = config.spielerGroesse;
  arrays.powerups.forEach(p => {
    let sx, sy;
    if (p.towedBy === 'p1') {
      sx = p1Anzeige.anzeigeX !== undefined ? p1Anzeige.anzeigeX : state.x;
      sy = p1Anzeige.anzeigeY !== undefined ? p1Anzeige.anzeigeY : state.y;
    } else if (p.towedBy === 'p2' && state.p2) {
      sx = state.p2.x;
      sy = state.p2.y;
    } else {
      entferneTraktorstrahl(p);
      return;
    }
    const groesse = p.groesse || 24;
    const px = p.anzeigeX !== undefined ? p.anzeigeX : p.x;
    const py = p.anzeigeY !== undefined ? p.anzeigeY : p.y;
    zeichneTraktorstrahl(p, sx + ss / 2, sy + ss, px + groesse / 2, py + groesse / 2);
  });
}

export function clientSchritt() {
  // I-Frames / Blink-Timer auf Client dekrementieren
  if (state.invulnerableTimer > 0) {
    state.invulnerableTimer--;
    if (state.invulnerableTimer === 0 && dom.spieler) {
      dom.spieler.classList.remove('spieler-blink');
    }
  }
  if (state.p2 && state.p2.invulnerableTimer > 0) {
    state.p2.invulnerableTimer--;
    if (state.p2.invulnerableTimer === 0 && dom.spieler2) {
      dom.spieler2.classList.remove('spieler-blink');
    }
  }

  arrays.sterne.forEach(stern => {
    stern.y += stern.speed;
    if (stern.y > config.spielfeldHoehe) {
      stern.y = -5;
      stern.x = Math.random() * config.spielfeldBreite;
    }
    stern.el.style.top = stern.y + 'px';
    stern.el.style.left = stern.x + 'px';
  });

  if (state.p2 && dom.spieler2 && !state.p2.isDead) {
    let baseFlameScaleP2 = 1.0;
    let targetRotateP2 = 0;
    const p2Speed = (shipModels && shipModels[state.p2.selectedShipModel]?.speed) || config.geschwindigkeit;
    const keys = state.tastenGedrueckt;

    // Gleve: Steuerrichtung (fuer Dash und Eingabe-Paket) und lokal vorhergesagter Dash (Raketen-Taste,
    // mobil der Raketen-Button)
    let gleveDash = false;
    if (Gleve.istGleve(state.p2)) {
      const richtung = steuerRichtung(keys);
      state.p2.clientSteuerRichtung = richtung;
      gleveDash = Gleve.sageDashVorher(state.p2, keys.k || keys.v, richtung);
    }

    // Viper: Ausweichrolle des eigenen Schiffs lokal vorhergesagt (Startposition geht im Eingabe-Paket zum Host)
    const viperRolle = Viper.istViper(state.p2) &&
      Viper.aktualisiereViper(state.p2, 'p2', Viper.eingabeVonTasten(keys.a || keys.arrowleft, keys.d || keys.arrowright, state.joystick));

    if (gleveDash) {
      baseFlameScaleP2 = 2.2;
    } else if (viperRolle) {
      baseFlameScaleP2 = 1.0;
    } else if (state.joystick && state.joystick.active) {
      let mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
      if (mag > 0.1) {
        const b = Hack.hackeBewegung(state.p2, state.joystick.x / mag, state.joystick.y / mag);
        state.p2.x += b.dx * p2Speed;
        state.p2.y += b.dy * p2Speed;
      }
      if (state.joystick.y < -0.2) baseFlameScaleP2 = 1.8;
      else if (state.joystick.y > 0.2) baseFlameScaleP2 = 0.4;
      if (state.joystick.x < -0.2) targetRotateP2 = -15;
      else if (state.joystick.x > 0.2) targetRotateP2 = 15;
    } else {
      const b = Hack.hackeBewegung(state.p2,
        ((keys.d || keys.arrowright) ? 1 : 0) - ((keys.a || keys.arrowleft) ? 1 : 0),
        ((keys.s || keys.arrowdown) ? 1 : 0) - ((keys.w || keys.arrowup) ? 1 : 0));
      if (b.dy < 0) {
        state.p2.y -= p2Speed;
        baseFlameScaleP2 = 1.8;
      }
      if (b.dy > 0) {
        state.p2.y += p2Speed;
        baseFlameScaleP2 = 0.4;
      }
      if (b.dx < 0) {
        state.p2.x -= p2Speed;
        targetRotateP2 = -15;
      }
      if (b.dx > 0) {
        state.p2.x += p2Speed;
        targetRotateP2 = 15;
      }
    }

    if (state.p2.x < 0) state.p2.x = 0;
    if (state.p2.y < 0) state.p2.y = 0;
    if (state.p2.x > config.spielfeldBreite - config.spielerGroesse) state.p2.x = config.spielfeldBreite - config.spielerGroesse;
    if (state.p2.y > config.spielfeldHoehe - config.spielerGroesse) state.p2.y = config.spielfeldHoehe - config.spielerGroesse;

    state.p2.rotate = targetRotateP2;
    dom.spieler2.style.left = state.p2.x + 'px';
    dom.spieler2.style.top = state.p2.y + 'px';
    dom.spieler2.style.transform = `rotate(${targetRotateP2}deg)`;

    const fLeftP2 = document.getElementById('flame-left-p2');
    const fRightP2 = document.getElementById('flame-right-p2');
    if (fLeftP2) fLeftP2.style.transform = `scaleY(${baseFlameScaleP2})`;
    if (fRightP2) fRightP2.style.transform = `scaleY(${baseFlameScaleP2})`;
  }

  // Gleve-Effekte beider Schiffe (Dash-Klasse, Nachbilder, Sweep-Klinge)
  Gleve.zeigeGleveZustand(state, 'p1');
  if (state.p2) Gleve.zeigeGleveZustand(state.p2, 'p2');
  // Viper-Rolle: Klasse, Nachbilder und Bereitschaftsanzeige beider Schiffe
  Viper.zeigeViperZustand(state, 'p1', false);
  if (state.p2) Viper.zeigeViperZustand(state.p2, 'p2', true);

  // Entfernte Objekte zwischen den Snapshots weiterbewegen
  extrapoliereProjektile();
  interpoliereObjekte();
  zeichneTraktorstrahlen();

  // Partikel auf dem Client animieren und löschen
  animierenPartikel();
  Hack.zeigeHackStatus();

  // Eingaben nur bei Aenderung, Bewegung (jeden 2. Schritt) oder als Heartbeat senden
  Network.sendeEingabe();
}
