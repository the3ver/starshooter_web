
import { state, dom, config, arrays, shipModels, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Bot from './bot.js';
import * as Hack from './hack.js';
import { versteckeAlleLaser } from './waffen.js';
import * as Gleve from './gleve.js';
import * as Viper from './viper.js';

// Laser-Taste von P1 (bei der Gleve: Sweep)
function laserTasteP1() {
  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  return isDualHumanCoop ? state.tastenGedrueckt.b : (state.tastenGedrueckt.l || state.tastenGedrueckt.b);
}

// Raketen-Taste von P1 (bei der Gleve: Dash)
function raketenTasteP1() {
  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  return isDualHumanCoop ? state.tastenGedrueckt.v : (state.tastenGedrueckt.k || state.tastenGedrueckt.v);
}

function istOnlineHost() {
  return Boolean(state.network && state.network.isOnline && state.network.isHost);
}

// Laser-Taste von P2 (Online-Host: gehaltene Client-Eingabe, Bot: KI-Entscheidung)
function laserTasteP2() {
  if (istOnlineHost()) return Boolean(state.p2 && state.p2.laserInputRequested);
  if (state.p2IsBot) return state.p2.botFireLaser || false;
  return state.tastenGedrueckt.ä || state.tastenGedrueckt.numpad1 || state.tastenGedrueckt['.'];
}

// Dash-Taste von P2 = Raketen-Taste (Online-Host: gehaltene Client-Eingabe plus gemerkter kurzer Druck,
// falls Druck und Loslassen im selben Host-Schritt ankommen; Bot: KI-Entscheidung als Flanke)
function dashTasteP2() {
  if (istOnlineHost()) {
    if (state.p2.netzDashAnfrage) {
      state.p2.netzDashAnfrage = false;
      // Jede Anfrage ist ein neuer Druck: ein verpasstes Loslassen nachholen, damit er als Flanke zaehlt
      state.p2.gleveDashTasteGehalten = false;
      return true;
    }
    return Boolean(state.p2.raketeGehalten);
  }
  if (state.p2IsBot) return state.p2.botFireRakete || false;
  return state.tastenGedrueckt.ö || state.tastenGedrueckt.numpad2 || state.tastenGedrueckt[','];
}

// Links/Rechts-Tasten von P1 (im lokalen Zwei-Spieler-Coop gehoeren die Pfeiltasten P2)
function linksP1() {
  const t = state.tastenGedrueckt;
  return t.a || (!(state.gameMode === 'coop' && !state.p2IsBot) && t.arrowleft);
}

function rechtsP1() {
  const t = state.tastenGedrueckt;
  return t.d || (!(state.gameMode === 'coop' && !state.p2IsBot) && t.arrowright);
}

// Rollenwunsch von P2: lokaler Coop (Pfeiltasten) als Eingabe, Bot und Online-Host als fertige Richtung
function viperEingabeP2() {
  if (state.gameMode === 'coop' && !state.p2IsBot) {
    return Viper.eingabeVonTasten(state.tastenGedrueckt.arrowleft, state.tastenGedrueckt.arrowright, null);
  }
  return null;
}

function viperAnfrageP2() {
  const p2 = state.p2;
  let anfrage = 0;
  if (state.p2IsBot) anfrage = Viper.richtungNachHack(p2, p2.botRolleAnfrage || 0);
  else if (istOnlineHost()) anfrage = p2.netzRolleAnfrage || 0;
  p2.botRolleAnfrage = 0;
  p2.netzRolleAnfrage = 0;
  return anfrage;
}

// Aktuelle Steuerrichtung von P1 (Joystick oder Tasten, Hacks angewendet)
function steuerRichtungP1() {
  if (state.joystick && state.joystick.active) {
    const mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
    if (mag <= 0.1) return { dx: 0, dy: 0 };
    return Hack.hackeBewegung(state, state.joystick.x / mag, state.joystick.y / mag);
  }
  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  const t = state.tastenGedrueckt;
  const up = t.w || (!isDualHumanCoop && t.arrowup);
  const down = t.s || (!isDualHumanCoop && t.arrowdown);
  const left = t.a || (!isDualHumanCoop && t.arrowleft);
  const right = t.d || (!isDualHumanCoop && t.arrowright);
  return Hack.hackeBewegung(state, (right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));
}

// Aktuelle Steuerrichtung von P2: lokal die Pfeiltasten, online die vom Client gemeldete Richtung
// (Hacks dort bereits angewendet), beim Bot die gewaehlte Dash-Richtung, sonst die letzte Bewegung
function steuerRichtungP2() {
  if (state.gameMode === 'coop' && !state.p2IsBot) {
    const t = state.tastenGedrueckt;
    return Hack.hackeBewegung(state.p2, (t.arrowright ? 1 : 0) - (t.arrowleft ? 1 : 0), (t.arrowdown ? 1 : 0) - (t.arrowup ? 1 : 0));
  }
  if (istOnlineHost() && state.p2.netzRichtung) return state.p2.netzRichtung;
  if (state.p2IsBot && state.p2.botDashRichtung) {
    return Hack.hackeBewegung(state.p2, state.p2.botDashRichtung.dx, state.p2.botDashRichtung.dy);
  }
  return { dx: state.p2.spielerVx || 0, dy: -(state.p2.spielerVy || 0) };
}


export function aktualisiereUnverwundbarkeit() {
  if (state.invulnerableTimer > 0) {
    state.invulnerableTimer--;
    if (state.invulnerableTimer === 0) {
      dom.spieler.classList.remove('spieler-blink');
    }
  }
}

// Bewegung per Richtung (b.dx/b.dy aus hackeBewegung) mit fester Geschwindigkeit;
// liefert Flammen-Skalierung und Ziel-Rotation
function bewegeInRichtung(s, b, speed) {
  let flamme = 1.0;
  let rotation = 0;
  if (b.dy < 0) {
    s.y -= speed;
    flamme = 1.8;
  }
  if (b.dy > 0) {
    s.y += speed;
    flamme = 0.4;
  }
  if (b.dx < 0) {
    s.x -= speed;
    rotation = -15;
  }
  if (b.dx > 0) {
    s.x += speed;
    rotation = 15;
  }
  return { flamme, rotation };
}

// Auf das Spielfeld begrenzen, Geschwindigkeit aus der Vorposition ableiten
function begrenzeUndMerkePosition(s) {
  if (s.x < 0) s.x = 0;
  if (s.y < 0) s.y = 0;
  if (s.x > config.spielfeldBreite - config.spielerGroesse) s.x = config.spielfeldBreite - config.spielerGroesse;
  if (s.y > config.spielfeldHoehe - config.spielerGroesse) s.y = config.spielfeldHoehe - config.spielerGroesse;
  s.spielerVx = s.x - (s.prevX !== undefined ? s.prevX : s.x);
  s.spielerVy = (s.prevY !== undefined ? s.prevY : s.y) - s.y;
  s.prevX = s.x;
  s.prevY = s.y;
}

// Schiffs-Element positionieren und weich zur Ziel-Rotation drehen
function setzeSchiffElement(el, s, targetRotate) {
  el.style.left = s.x + 'px';
  el.style.top = s.y + 'px';
  let currentRotate = parseFloat(el.getAttribute('data-rotate') || 0);
  currentRotate += (targetRotate - currentRotate) * 0.15; // Smooth rotation
  el.setAttribute('data-rotate', currentRotate);
  el.style.transform = `rotate(${currentRotate}deg)`;
}

function setzeFlammen(idLinks, idRechts, scale) {
  const fLeft = document.getElementById(idLinks);
  const fRight = document.getElementById(idRechts);
  if (fLeft) fLeft.style.transform = `scaleY(${scale})`;
  if (fRight) fRight.style.transform = `scaleY(${scale})`;
}

// Abgas-Partikel hinter dem Schiff (zufällig eine der beiden Farben)
function erzeugeAbgas(s, flammenScale, farbe1, farbe2) {
  if (flammenScale > 0.5 && Math.random() < (flammenScale > 1.0 ? 0.6 : 0.2)) {
    const pEl = document.createElement('div');
    pEl.classList.add('partikel');
    pEl.style.backgroundColor = Math.random() < 0.5 ? farbe1 : farbe2;
    let px = s.x + 15 + (Math.random() * 8 - 4);
    let py = s.y + 28;
    pEl.style.left = px + 'px';
    pEl.style.top = py + 'px';
    dom.spielfeld.appendChild(pEl);
    arrays.partikelArray.push({
      el: pEl,
      x: px,
      y: py,
      vx: (Math.random() - 0.5) * 0.5,
      vy: 1 + Math.random() * flammenScale,
      leben: 1.0,
      zerfall: 0.05
    });
  }
}

export function bewegeSpieler() {
  let baseFlameScale = 1.0;
  let targetRotate = 0;
  const towedCountP1 = isCoopMode() ? arrays.powerups.filter(p => p.towedBy === 'p1').length : 0;
  const speedMultP1 = Math.max(0.1, 1.0 - 0.10 * towedCountP1);
  const currentSpeed = ((shipModels && shipModels[state.selectedShipModel]?.speed) || config.geschwindigkeit) * speedMultP1;

  // Gleve: Dash/Abprall ersetzt in diesem Schritt die normale Steuerung
  const gleveDashP1 = Gleve.istGleve(state) && Gleve.aktualisiereGleve(state, 'p1', raketenTasteP1(), steuerRichtungP1());

  // Viper: Ausweichrolle (Doppeltipp links/rechts oder Wisch) ersetzt die Steuerung
  const viperRolleP1 = Viper.istViper(state) && Viper.aktualisiereViper(state, 'p1', Viper.eingabeVonTasten(linksP1(), rechtsP1(), state.joystick));

  if (gleveDashP1) {
    baseFlameScale = 2.2;
  } else if (viperRolleP1) {
    baseFlameScale = 1.0;
  } else if (state.joystick && state.joystick.active) {
    let mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
    if (mag > 0.1) {
      const b = Hack.hackeBewegung(state, state.joystick.x / mag, state.joystick.y / mag);
      state.x += b.dx * currentSpeed;
      state.y += b.dy * currentSpeed;
    }
    
    if (state.joystick.y < -0.2) baseFlameScale = 1.8;
    else if (state.joystick.y > 0.2) baseFlameScale = 0.4;
    
    if (state.joystick.x < -0.2) targetRotate = -15;
    else if (state.joystick.x > 0.2) targetRotate = 15;
  } else if (!state.isDead) {
    const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
    const upRaw = state.tastenGedrueckt.w || (!isDualHumanCoop && state.tastenGedrueckt.arrowup);
    const downRaw = state.tastenGedrueckt.s || (!isDualHumanCoop && state.tastenGedrueckt.arrowdown);
    const leftRaw = state.tastenGedrueckt.a || (!isDualHumanCoop && state.tastenGedrueckt.arrowleft);
    const rightRaw = state.tastenGedrueckt.d || (!isDualHumanCoop && state.tastenGedrueckt.arrowright);
    const b = Hack.hackeBewegung(state, (rightRaw ? 1 : 0) - (leftRaw ? 1 : 0), (downRaw ? 1 : 0) - (upRaw ? 1 : 0));
    ({ flamme: baseFlameScale, rotation: targetRotate } = bewegeInRichtung(state, b, currentSpeed));
  }
  begrenzeUndMerkePosition(state);
  if (dom.spieler) setzeSchiffElement(dom.spieler, state, targetRotate);
  setzeFlammen('flame-left', 'flame-right', baseFlameScale);
  Viper.zeigeRollenHud('p1', state);

  if (!state.isDead) erzeugeAbgas(state, baseFlameScale, '#f1c40f', '#e74c3c');

  // --- 9.1b SPIELER 2 BEWEGUNG (Co-op) ---
  if (isCoopMode() && state.p2 && dom.spieler2) {
    if (state.p2.invulnerableTimer > 0) {
      state.p2.invulnerableTimer--;
      if (state.p2.invulnerableTimer === 0) {
        dom.spieler2.classList.remove('spieler-blink');
      }
    }

    if (!state.p2.isDead) {
      let baseFlameScaleP2 = 1.0;
      let targetRotateP2 = 0;
      const towedCountP2 = arrays.powerups.filter(p => p.towedBy === 'p2').length;
      const speedMultP2 = Math.max(0.1, 1.0 - 0.10 * towedCountP2);
      const p2Speed = ((shipModels && shipModels[state.p2.selectedShipModel]?.speed) || config.geschwindigkeit) * speedMultP2;

      const gleveDashP2 = Gleve.istGleve(state.p2) && Gleve.aktualisiereGleve(state.p2, 'p2', dashTasteP2(), steuerRichtungP2());

      const viperRolleP2 = Viper.istViper(state.p2) && Viper.aktualisiereViper(state.p2, 'p2', viperEingabeP2(), viperAnfrageP2());

      if (gleveDashP2) {
        // Gleve-Dash/Abprall uebernimmt die Bewegung
        baseFlameScaleP2 = 2.2;
      } else if (viperRolleP2) {
        // Viper-Rolle uebernimmt die Bewegung
        baseFlameScaleP2 = 1.0;
      } else if (state.p2IsBot) {
        // Bot-KI steuert P2
        const prevBotX = state.p2.x;
        const prevBotY = state.p2.y;
        Bot.updateBot();
        // Hacks wirken auch auf die Bewegung des Bots
        const botB = Hack.hackeBewegung(state.p2, state.p2.x - prevBotX, state.p2.y - prevBotY);
        state.p2.x = prevBotX + botB.dx;
        state.p2.y = prevBotY + botB.dy;
        // Flammen/Rotation aus Bot-Bewegung ableiten
        const botDy = botB.dy;
        const botDx = botB.dx;
        if (botDy < -0.5) baseFlameScaleP2 = 1.8;
        else if (botDy > 0.5) baseFlameScaleP2 = 0.4;
        if (botDx < -0.5) targetRotateP2 = -15;
        else if (botDx > 0.5) targetRotateP2 = 15;
      } else if (state.gameMode === 'coop') {
        // Menschliche Steuerung via Arrow-Keys im lokalen Coop
        const t = state.tastenGedrueckt;
        const b2 = Hack.hackeBewegung(state.p2, (t.arrowright ? 1 : 0) - (t.arrowleft ? 1 : 0), (t.arrowdown ? 1 : 0) - (t.arrowup ? 1 : 0));
        ({ flamme: baseFlameScaleP2, rotation: targetRotateP2 } = bewegeInRichtung(state.p2, b2, p2Speed));
      }

      begrenzeUndMerkePosition(state.p2);
      setzeSchiffElement(dom.spieler2, state.p2, targetRotateP2);
      setzeFlammen('flame-left-p2', 'flame-right-p2', baseFlameScaleP2);
      Viper.zeigeRollenHud('p2', state.p2);
      erzeugeAbgas(state.p2, baseFlameScaleP2, '#74b9ff', '#0984e3');
    }
  }
}

// Laser zünden, solange die Taste gedrückt ist und genug Energie da ist
function steuereLaserZuendung(s, gedrueckt) {
  if (gedrueckt) {
    if (!s.laserSchiesst && s.energie >= s.minZuendEnergie) s.laserSchiesst = true;
    if (s.energie <= 0) s.laserSchiesst = false;
  } else {
    s.laserSchiesst = false;
  }
}

// Energie nach Schiffsmodell regenerieren, solange unter maxEnergie
function ladeEnergie(s) {
  const regenRate = (shipModels && shipModels[s.selectedShipModel]?.energyRegen) || 0.4;
  if (s.energie < s.maxEnergie) s.energie += regenRate;
}

function begrenzeEnergie(s) {
  if (s.energie < 0) s.energie = 0;
  if (s.energie > s.maxEnergie) s.energie = s.maxEnergie;
}

// Ab welcher Energie die Primärwaffe wieder einsatzbereit ist (Gleve: Sweep-Kosten)
function zuendSchwelle(s) {
  return Gleve.istGleve(s) ? Gleve.sweepKosten(s) : s.minZuendEnergie;
}

// Gleve: kein Laser, die gehaltene Laser-Taste startet im Takt Sweeps (Kosten zieht gleve.js beim Start ab).
// Wie beim Laser lädt die Energie nicht, solange die Taste gehalten wird oder ein Sweep läuft.
function steuereGleveSweep(s, pKey, gehalten) {
  s.laserSchiesst = false;
  Gleve.steuereSweep(s, pKey, gehalten);
  if (!gehalten && !Gleve.istSweepAktiv(s)) ladeEnergie(s);
}

export function aktualisiereEnergie() {
  let laserAktiv = false;
  if (Gleve.istGleve(state)) {
    steuereGleveSweep(state, 'p1', laserTasteP1() && !state.isDead);
    versteckeAlleLaser();
  } else {
    steuereLaserZuendung(state, laserTasteP1() && !state.isDead);
    laserAktiv = state.laserSchiesst && state.energie > 0 && !state.isDead && !Hack.hatHack(state, 'waffenOffline');
    if (laserAktiv) {
      if (!state.unbegrenzteEnergie) {
        state.energie -= 0.8 + Math.min(state.laserStufe, 5) * 0.1;
      }
    } else {
      ladeEnergie(state);
      versteckeAlleLaser();
    }
  }
  begrenzeEnergie(state);
  if (dom.energieBalken) {
    dom.energieBalken.style.width = state.energie / state.absMaxEnergie * 100 + '%';
    if (state.unbegrenzteEnergie) {
      dom.energieBalken.style.backgroundColor = '#f1c40f';
    } else {
      dom.energieBalken.style.backgroundColor = state.energie < zuendSchwelle(state) && !state.laserSchiesst ? '#e67e22' : '#1abc9c';
    }
  }

  // --- 9.4 ENERGIE SPIELER 2 (Co-op) ---
  let laserAktivP2 = false;
  if (isCoopMode() && state.p2 && !state.p2.isDead) {
    if (Gleve.istGleve(state.p2)) {
      steuereGleveSweep(state.p2, 'p2', Boolean(laserTasteP2()));
    } else {
      steuereLaserZuendung(state.p2, laserTasteP2());
      laserAktivP2 = state.p2.laserSchiesst && state.p2.energie > 0 && !Hack.hatHack(state.p2, 'waffenOffline');
      if (laserAktivP2) {
        state.p2.energie -= 0.8 + Math.min(state.p2.laserStufe, 5) * 0.1;
      } else {
        ladeEnergie(state.p2);
      }
    }
    begrenzeEnergie(state.p2);
    if (dom.energieBalkenP2) {
      dom.energieBalkenP2.style.width = state.p2.energie / state.p2.absMaxEnergie * 100 + '%';
      dom.energieBalkenP2.style.backgroundColor = state.p2.energie < zuendSchwelle(state.p2) && !state.p2.laserSchiesst ? '#e67e22' : '#3498db';
    }

    // P2 Schild Regen (Phantom-NX)
    const p2Ship = shipModels && shipModels[state.p2.selectedShipModel || 'phantom'];
    if (p2Ship && p2Ship.shieldRegen && state.p2.schildStufe === 0 && state.p2.leben > 0 && !state.gameOverAktiv) {
      const maxRegen = state.p2.phantomSchildRegenMax || p2Ship.shieldRegenMax || 900;
      state.p2.phantomSchildRegenTimer = (state.p2.phantomSchildRegenTimer || 0) + 1;
      if (state.p2.phantomSchildRegenTimer % 6 === 0) {
        Utils.updateAktivePowerupsP2UI();
      }
      if (state.p2.phantomSchildRegenTimer >= maxRegen) {
        state.p2.schildStufe = 1;
        state.p2.phantomSchildRegenTimer = 0;
        Audio.playShieldRegen();
        if (dom.spieler2) {
          dom.spieler2.classList.remove('schild-aktiv-1', 'schild-aktiv-2', 'schild-aktiv-3');
          dom.spieler2.classList.add('schild-aktiv-1');
        }
        Utils.updateAktivePowerupsP2UI();
      }
    }
  }
  return { laserAktiv, laserAktivP2 };
}

export function regeneriereSchild() {
  const activeShip = shipModels && shipModels[state.selectedShipModel || 'viper'];
  if (activeShip && activeShip.shieldRegen && state.schildStufe === 0 && state.leben > 0 && !state.gameOverAktiv) {
    const maxRegen = state.phantomSchildRegenMax || activeShip.shieldRegenMax || 900;
    state.phantomSchildRegenTimer = (state.phantomSchildRegenTimer || 0) + 1;
    if (state.phantomSchildRegenTimer % 6 === 0) {
      Utils.updateAktivePowerupsUI();
    }
    if (state.phantomSchildRegenTimer >= maxRegen) {
      state.schildStufe = 1;
      state.phantomSchildRegenTimer = 0;
      Audio.playShieldRegen();
      dom.spieler.classList.remove('schild-aktiv-1', 'schild-aktiv-2', 'schild-aktiv-3');
      dom.spieler.classList.add('schild-aktiv-1');
      Utils.updateAktivePowerupsUI();
    }
  } else if (state.schildStufe > 0 && state.phantomSchildRegenTimer > 0) {
    state.phantomSchildRegenTimer = 0;
  }
}
