import { state, dom, config, arrays, shipModels, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Bot from './bot.js';
import * as Hack from './hack.js';
import * as Gleve from './gleve.js';
import * as Viper from './viper.js';
import * as Sniper from './sniper.js';
import { createParticles } from './particles.js';

// Laser-Taste von P1 (bei der Gleve: Sweep)
function laserKeyP1() {
  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  return isDualHumanCoop ? state.keysPressed.b : state.keysPressed.l || state.keysPressed.b;
}

// Raketen-Taste von P1 (bei der Gleve: Dash)
function missileKeyP1() {
  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  return isDualHumanCoop ? state.keysPressed.v : state.keysPressed.k || state.keysPressed.v;
}

function isOnlineHost() {
  return Boolean(state.network && state.network.isOnline && state.network.isHost);
}

// Laser-Taste von P2 (Online-Host: gehaltene Client-Eingabe, Bot: KI-Entscheidung)
function laserKeyP2() {
  if (isOnlineHost()) {
    // Sniper: ein Druck zaehlt mindestens einen Schritt, auch wenn Loslassen im selben Host-Schritt ankommt (kurzer Tipp = ein Schuss)
    if (state.p2 && state.p2.networkLaserRequest) {
      state.p2.networkLaserRequest = false;
      return true;
    }
    return Boolean(state.p2 && state.p2.laserInputRequested);
  }
  if (state.p2IsBot) return state.p2.botFireLaser || false;
  return state.keysPressed.ä || state.keysPressed.numpad1 || state.keysPressed['.'];
}

// Dash-Taste von P2 = Raketen-Taste (Online-Host: gehaltene Client-Eingabe plus gemerkter kurzer Druck,
// falls Druck und Loslassen im selben Host-Schritt ankommen; Bot: KI-Entscheidung als Flanke)
function dashKeyP2() {
  if (isOnlineHost()) {
    if (state.p2.networkDashRequest) {
      state.p2.networkDashRequest = false;
      // Jede Anfrage ist ein neuer Druck: ein verpasstes Loslassen nachholen, damit er als Flanke zaehlt
      state.p2.gleveDashKeyHeld = false;
      return true;
    }
    return Boolean(state.p2.missileHeld);
  }
  if (state.p2IsBot) return state.p2.botFireMissile || false;
  return state.keysPressed.ö || state.keysPressed.numpad2 || state.keysPressed[','];
}

// Links/Rechts-Tasten von P1 (im lokalen Zwei-Spieler-Coop gehoeren die Pfeiltasten P2)
function leftP1() {
  const t = state.keysPressed;
  return t.a || (!(state.gameMode === 'coop' && !state.p2IsBot) && t.arrowleft);
}

function rightP1() {
  const t = state.keysPressed;
  return t.d || (!(state.gameMode === 'coop' && !state.p2IsBot) && t.arrowright);
}

// Rollenwunsch von P2: lokaler Coop (Pfeiltasten) als Eingabe, Bot und Online-Host als fertige Richtung
function viperInputP2() {
  if (state.gameMode === 'coop' && !state.p2IsBot) {
    return Viper.inputFromKeys(state.keysPressed.arrowleft, state.keysPressed.arrowright, null);
  }
  return null;
}

function viperRequestP2() {
  const p2 = state.p2;
  let request = 0;
  if (state.p2IsBot) request = Viper.directionAfterHack(p2, p2.botRollRequest || 0);
  else if (isOnlineHost()) request = p2.networkRollRequest || 0;
  p2.botRollRequest = 0;
  p2.networkRollRequest = 0;
  return request;
}

// Aktuelle Steuerrichtung von P1 (Joystick oder Tasten, Hacks angewendet)
function controlDirectionP1() {
  if (state.joystick && state.joystick.active) {
    const mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
    if (mag <= 0.1) return { dx: 0, dy: 0 };
    return Hack.hackMovement(state, state.joystick.x / mag, state.joystick.y / mag);
  }
  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  const t = state.keysPressed;
  const up = t.w || (!isDualHumanCoop && t.arrowup);
  const down = t.s || (!isDualHumanCoop && t.arrowdown);
  const left = t.a || (!isDualHumanCoop && t.arrowleft);
  const right = t.d || (!isDualHumanCoop && t.arrowright);
  return Hack.hackMovement(state, (right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));
}

// Aktuelle Steuerrichtung von P2: lokal die Pfeiltasten, online die vom Client gemeldete Richtung
// (Hacks dort bereits angewendet), beim Bot die gewaehlte Dash-Richtung, sonst die letzte Bewegung
function controlDirectionP2() {
  if (state.gameMode === 'coop' && !state.p2IsBot) {
    const t = state.keysPressed;
    return Hack.hackMovement(
      state.p2,
      (t.arrowright ? 1 : 0) - (t.arrowleft ? 1 : 0),
      (t.arrowdown ? 1 : 0) - (t.arrowup ? 1 : 0),
    );
  }
  if (isOnlineHost() && state.p2.networkDirection) return state.p2.networkDirection;
  if (state.p2IsBot && state.p2.botDashDirection) {
    return Hack.hackMovement(state.p2, state.p2.botDashDirection.dx, state.p2.botDashDirection.dy);
  }
  return { dx: state.p2.playerVx || 0, dy: -(state.p2.playerVy || 0) };
}

export function updateInvulnerability() {
  if (state.invulnerableTimer > 0) {
    state.invulnerableTimer--;
  }
}

// Bewegung per Richtung (b.dx/b.dy aus hackeBewegung) mit fester Geschwindigkeit;
// liefert Flammen-Skalierung und Ziel-Rotation
function moveInDirection(s, b, speed) {
  let flame = 1.0;
  let rotation = 0;
  if (b.dy < 0) {
    s.y -= speed;
    flame = 1.8;
  }
  if (b.dy > 0) {
    s.y += speed;
    flame = 0.4;
  }
  if (b.dx < 0) {
    s.x -= speed;
    rotation = -15;
  }
  if (b.dx > 0) {
    s.x += speed;
    rotation = 15;
  }
  return { flame, rotation };
}

// Auf das Spielfeld begrenzen, Geschwindigkeit aus der Vorposition ableiten
function clampAndRememberPosition(s) {
  if (s.x < 0) s.x = 0;
  if (s.y < 0) s.y = 0;
  if (s.x > config.playfieldWidth - config.playerSize) s.x = config.playfieldWidth - config.playerSize;
  if (s.y > config.playfieldHeight - config.playerSize) s.y = config.playfieldHeight - config.playerSize;
  s.playerVx = s.x - (s.prevX !== undefined ? s.prevX : s.x);
  s.playerVy = (s.prevY !== undefined ? s.prevY : s.y) - s.y;
  s.prevX = s.x;
  s.prevY = s.y;
}

// Angezeigte Neigung weich zur Ziel-Rotation fuehren und Triebwerksflammen setzen (Modellfelder
// drehung/flammenSkala, die Anzeige zeichnet das Schiff daraus)
function setShipStatus(s, targetRotate, flameScale) {
  const current = s.rotation || 0;
  s.rotation = current + (targetRotate - current) * 0.15; // Smooth rotation
  s.flameScale = flameScale;
}

// Abgas-Partikel hinter dem Schiff (zufällig eine der beiden Farben)
function createExhaust(s, exhaustScale, color1, color2) {
  if (exhaustScale > 0.5 && Math.random() < (exhaustScale > 1.0 ? 0.6 : 0.2)) {
    const color = Math.random() < 0.5 ? color1 : color2;
    createParticles({
      color,
      x: s.x + 15 + (Math.random() * 8 - 4),
      y: s.y + 28,
      vx: (Math.random() - 0.5) * 0.5,
      vy: 1 + Math.random() * exhaustScale,
      lives: 1.0,
      decay: 0.05,
    });
  }
}

export function movePlayer() {
  let baseFlameScale = 1.0;
  let targetRotate = 0;
  const towedCountP1 = isCoopMode() ? arrays.powerups.filter(p => p.towedBy === 'p1').length : 0;
  const speedMultP1 = Math.max(0.1, 1.0 - 0.1 * towedCountP1);
  const currentSpeed = ((shipModels && shipModels[state.selectedShipModel]?.speed) || config.speed) * speedMultP1;

  // Gleve: Dash/Abprall ersetzt in diesem Schritt die normale Steuerung
  const gleveDashP1 = Gleve.isGleve(state) && Gleve.updateGleve(state, 'p1', missileKeyP1(), controlDirectionP1());

  // Viper: Ausweichrolle (Doppeltipp links/rechts oder Wisch) ersetzt die Steuerung
  const viperRollP1 =
    Viper.isViper(state) && Viper.updateViper(state, 'p1', Viper.inputFromKeys(leftP1(), rightP1(), state.joystick));

  if (gleveDashP1) {
    baseFlameScale = 2.2;
  } else if (viperRollP1) {
    baseFlameScale = 1.0;
  } else if (state.joystick && state.joystick.active) {
    let mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
    if (mag > 0.1) {
      const b = Hack.hackMovement(state, state.joystick.x / mag, state.joystick.y / mag);
      state.x += b.dx * currentSpeed;
      state.y += b.dy * currentSpeed;
    }

    if (state.joystick.y < -0.2) baseFlameScale = 1.8;
    else if (state.joystick.y > 0.2) baseFlameScale = 0.4;

    if (state.joystick.x < -0.2) targetRotate = -15;
    else if (state.joystick.x > 0.2) targetRotate = 15;
  } else if (!state.isDead) {
    const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
    const upRaw = state.keysPressed.w || (!isDualHumanCoop && state.keysPressed.arrowup);
    const downRaw = state.keysPressed.s || (!isDualHumanCoop && state.keysPressed.arrowdown);
    const leftRaw = state.keysPressed.a || (!isDualHumanCoop && state.keysPressed.arrowleft);
    const rightRaw = state.keysPressed.d || (!isDualHumanCoop && state.keysPressed.arrowright);
    const b = Hack.hackMovement(state, (rightRaw ? 1 : 0) - (leftRaw ? 1 : 0), (downRaw ? 1 : 0) - (upRaw ? 1 : 0));
    ({ flame: baseFlameScale, rotation: targetRotate } = moveInDirection(state, b, currentSpeed));
  }
  clampAndRememberPosition(state);
  setShipStatus(state, targetRotate, baseFlameScale);
  Viper.showRollHud('p1', state);

  if (!state.isDead) createExhaust(state, baseFlameScale, '#f1c40f', '#e74c3c');

  // --- 9.1b SPIELER 2 BEWEGUNG (Co-op) ---
  if (isCoopMode() && state.p2 && dom.player2) {
    if (state.p2.invulnerableTimer > 0) {
      state.p2.invulnerableTimer--;
    }

    if (!state.p2.isDead) {
      let baseFlameScaleP2 = 1.0;
      let targetRotateP2 = 0;
      const towedCountP2 = arrays.powerups.filter(p => p.towedBy === 'p2').length;
      const speedMultP2 = Math.max(0.1, 1.0 - 0.1 * towedCountP2);
      const p2Speed = ((shipModels && shipModels[state.p2.selectedShipModel]?.speed) || config.speed) * speedMultP2;

      const gleveDashP2 =
        Gleve.isGleve(state.p2) && Gleve.updateGleve(state.p2, 'p2', dashKeyP2(), controlDirectionP2());

      const viperRollP2 =
        Viper.isViper(state.p2) && Viper.updateViper(state.p2, 'p2', viperInputP2(), viperRequestP2());

      if (gleveDashP2) {
        // Gleve-Dash/Abprall uebernimmt die Bewegung
        baseFlameScaleP2 = 2.2;
      } else if (viperRollP2) {
        // Viper-Rolle uebernimmt die Bewegung
        baseFlameScaleP2 = 1.0;
      } else if (state.p2IsBot) {
        // Bot-KI steuert P2
        const prevBotX = state.p2.x;
        const prevBotY = state.p2.y;
        Bot.updateBot();
        // Hacks wirken auch auf die Bewegung des Bots
        const botB = Hack.hackMovement(state.p2, state.p2.x - prevBotX, state.p2.y - prevBotY);
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
        const t = state.keysPressed;
        const b2 = Hack.hackMovement(
          state.p2,
          (t.arrowright ? 1 : 0) - (t.arrowleft ? 1 : 0),
          (t.arrowdown ? 1 : 0) - (t.arrowup ? 1 : 0),
        );
        ({ flame: baseFlameScaleP2, rotation: targetRotateP2 } = moveInDirection(state.p2, b2, p2Speed));
      }

      clampAndRememberPosition(state.p2);
      setShipStatus(state.p2, targetRotateP2, baseFlameScaleP2);
      Viper.showRollHud('p2', state.p2);
      createExhaust(state.p2, baseFlameScaleP2, '#74b9ff', '#0984e3');
    }
  }
}

// Laser zünden, solange die Taste gedrückt ist und genug Energie da ist
function controlLaserIgnition(s, pressed) {
  if (pressed) {
    if (!s.laserShoots && s.energy >= s.minFuseEnergy) s.laserShoots = true;
    if (s.energy <= 0) s.laserShoots = false;
  } else {
    s.laserShoots = false;
  }
}

// Energie nach Schiffsmodell regenerieren, solange unter maxEnergie
function chargingEnergy(s) {
  const regenRate = (shipModels && shipModels[s.selectedShipModel]?.energyRegen) || 0.4;
  if (s.energy < s.maxEnergy) s.energy += regenRate;
}

function clampEnergy(s) {
  if (s.energy < 0) s.energy = 0;
  if (s.energy > s.maxEnergy) s.energy = s.maxEnergy;
}

// Ab welcher Energie die Primärwaffe wieder einsatzbereit ist (Gleve: Sweep-Kosten)
function fuseThreshold(s) {
  return Gleve.isGleve(s) ? Gleve.sweepCost(s) : s.minFuseEnergy;
}

// Gleve: kein Laser, die gehaltene Laser-Taste startet im Takt Sweeps (Kosten zieht gleve.js beim Start ab).
// Wie beim Laser lädt die Energie nicht, solange die Taste gehalten wird oder ein Sweep läuft.
function controlGleveSweep(s, pKey, held) {
  s.laserShoots = false;
  Gleve.controlSweep(s, pKey, held);
  if (!held && !Gleve.isSweepActive(s)) chargingEnergy(s);
}

// Sniper: kein Laser; die Laser-Taste laedt (Druck) und feuert beim Loslassen (sniper.js). `auto`: Joystick-Autofeuer
// (Normalschuesse im Schussabstand, kein Laden). Waehrend des Ladens regeneriert die Energie nicht.
function controlSniper(s, pKey, held, auto = false) {
  s.laserShoots = false;
  Sniper.updateSniper(s, pKey, held, auto);
  if (!Sniper.isCharging(s)) chargingEnergy(s);
}

// Joystick-Autofeuer von P1 (Handy): Taste L kommt vom Joystick und nicht von der Tastatur, B oder dem Lade-Knopf
function sniperAutofireP1() {
  return Boolean(state.joystick && state.joystick.fires) && !state.sniperChargingButton && !state.keysPressed.b;
}

export function updateEnergy() {
  let laserActive = false;
  if (Sniper.isSniper(state)) {
    controlSniper(
      state,
      'p1',
      Boolean(laserKeyP1() || state.sniperChargingButton) && !state.isDead,
      sniperAutofireP1(),
    );
  } else if (Gleve.isGleve(state)) {
    controlGleveSweep(state, 'p1', laserKeyP1() && !state.isDead);
  } else {
    controlLaserIgnition(state, laserKeyP1() && !state.isDead);
    laserActive = state.laserShoots && state.energy > 0 && !state.isDead && !Hack.hasHack(state, 'weaponOffline');
    if (laserActive) {
      if (!state.unlimitedEnergy) {
        state.energy -= 0.8 + Math.min(state.laserTier, 5) * 0.1;
      }
    } else {
      chargingEnergy(state);
    }
  }
  clampEnergy(state);
  if (dom.energyBar) {
    dom.energyBar.style.width = (state.energy / state.absMaxEnergy) * 100 + '%';
    if (state.unlimitedEnergy) {
      dom.energyBar.style.backgroundColor = '#f1c40f';
    } else {
      dom.energyBar.style.backgroundColor =
        state.energy < fuseThreshold(state) && !state.laserShoots ? '#e67e22' : '#1abc9c';
    }
  }

  // --- 9.4 ENERGIE SPIELER 2 (Co-op) ---
  let laserActiveP2 = false;
  if (Sniper.isSniper(state.p2) && (!isCoopMode() || state.p2.isDead)) Sniper.updateSniper(state.p2, 'p2', false); // Fadenkreuz entfernen
  if (isCoopMode() && state.p2 && !state.p2.isDead) {
    if (Sniper.isSniper(state.p2)) {
      // Online-Client mit Joystick-Autofeuer (Handy): Normalschuesse ohne Laden
      controlSniper(state.p2, 'p2', Boolean(laserKeyP2()), isOnlineHost() && Boolean(state.p2.sniperAutoInput));
    } else if (Gleve.isGleve(state.p2)) {
      controlGleveSweep(state.p2, 'p2', Boolean(laserKeyP2()));
    } else {
      controlLaserIgnition(state.p2, laserKeyP2());
      laserActiveP2 = state.p2.laserShoots && state.p2.energy > 0 && !Hack.hasHack(state.p2, 'weaponOffline');
      if (laserActiveP2) {
        state.p2.energy -= 0.8 + Math.min(state.p2.laserTier, 5) * 0.1;
      } else {
        chargingEnergy(state.p2);
      }
    }
    clampEnergy(state.p2);
    if (dom.energyBarP2) {
      dom.energyBarP2.style.width = (state.p2.energy / state.p2.absMaxEnergy) * 100 + '%';
      dom.energyBarP2.style.backgroundColor =
        state.p2.energy < fuseThreshold(state.p2) && !state.p2.laserShoots ? '#e67e22' : '#3498db';
    }

    // P2 Schild Regen (Phantom-NX)
    const p2Ship = shipModels && shipModels[state.p2.selectedShipModel || 'phantom'];
    if (p2Ship && p2Ship.shieldRegen && state.p2.shieldTier === 0 && state.p2.lives > 0 && !state.gameOverActive) {
      const maxRegen = state.p2.phantomShieldRegenMax || p2Ship.shieldRegenMax || 900;
      state.p2.phantomShieldRegenTimer = (state.p2.phantomShieldRegenTimer || 0) + 1;
      if (state.p2.phantomShieldRegenTimer % 6 === 0) {
        Utils.updateActivePowerupsP2Ui();
      }
      if (state.p2.phantomShieldRegenTimer >= maxRegen) {
        state.p2.shieldTier = 1;
        state.p2.phantomShieldRegenTimer = 0;
        Audio.playShieldRegen();
        Utils.updateActivePowerupsP2Ui();
      }
    }
  }
  return { laserActive, laserActiveP2 };
}

export function regenerateShield() {
  const activeShip = shipModels && shipModels[state.selectedShipModel || 'viper'];
  if (activeShip && activeShip.shieldRegen && state.shieldTier === 0 && state.lives > 0 && !state.gameOverActive) {
    const maxRegen = state.phantomShieldRegenMax || activeShip.shieldRegenMax || 900;
    state.phantomShieldRegenTimer = (state.phantomShieldRegenTimer || 0) + 1;
    if (state.phantomShieldRegenTimer % 6 === 0) {
      Utils.updateActivePowerupsUi();
    }
    if (state.phantomShieldRegenTimer >= maxRegen) {
      state.shieldTier = 1;
      state.phantomShieldRegenTimer = 0;
      Audio.playShieldRegen();
      Utils.updateActivePowerupsUi();
    }
  } else if (state.shieldTier > 0 && state.phantomShieldRegenTimer > 0) {
    state.phantomShieldRegenTimer = 0;
  }
}
