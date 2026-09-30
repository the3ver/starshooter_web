
import { state, dom, config, arrays, shipModels, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Bot from './bot.js';
import * as Hack from './hack.js';
import { versteckeAlleLaser } from './waffen.js';


export function aktualisiereUnverwundbarkeit() {
  if (state.invulnerableTimer > 0) {
    state.invulnerableTimer--;
    if (state.invulnerableTimer === 0) {
      dom.spieler.classList.remove('spieler-blink');
    }
  }
}

export function bewegeSpieler() {
  let baseFlameScale = 1.0;
  let targetRotate = 0;
  const towedCountP1 = isCoopMode() ? arrays.powerups.filter(p => p.towedBy === 'p1').length : 0;
  const speedMultP1 = Math.max(0.1, 1.0 - 0.10 * towedCountP1);
  const currentSpeed = ((shipModels && shipModels[state.selectedShipModel]?.speed) || config.geschwindigkeit) * speedMultP1;
  
  if (state.joystick && state.joystick.active) {
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
    const up = b.dy < 0, down = b.dy > 0, left = b.dx < 0, right = b.dx > 0;

    if (up) {
      state.y -= currentSpeed;
      baseFlameScale = 1.8;
    }
    if (down) {
      state.y += currentSpeed;
      baseFlameScale = 0.4;
    }
    if (left) {
      state.x -= currentSpeed;
      targetRotate = -15;
    }
    if (right) {
      state.x += currentSpeed;
      targetRotate = 15;
    }
  }
  if (state.x < 0) state.x = 0;
  if (state.y < 0) state.y = 0;
  if (state.x > config.spielfeldBreite - config.spielerGroesse) state.x = config.spielfeldBreite - config.spielerGroesse;
  if (state.y > config.spielfeldHoehe - config.spielerGroesse) state.y = config.spielfeldHoehe - config.spielerGroesse;
  state.spielerVx = state.x - (state.prevX !== undefined ? state.prevX : state.x);
  state.spielerVy = (state.prevY !== undefined ? state.prevY : state.y) - state.y;
  state.prevX = state.x;
  state.prevY = state.y;
  if (dom.spieler) {
    dom.spieler.style.left = state.x + 'px';
    dom.spieler.style.top = state.y + 'px';
    let currentRotate = parseFloat(dom.spieler.getAttribute('data-rotate') || 0);
    currentRotate += (targetRotate - currentRotate) * 0.15; // Smooth rotation
    dom.spieler.setAttribute('data-rotate', currentRotate);
    dom.spieler.style.transform = `rotate(${currentRotate}deg)`;
  }
  const fLeft1 = document.getElementById('flame-left');
  const fRight1 = document.getElementById('flame-right');
  if (fLeft1) fLeft1.style.transform = `scaleY(${baseFlameScale})`;
  if (fRight1) fRight1.style.transform = `scaleY(${baseFlameScale})`;

  if (!state.isDead && baseFlameScale > 0.5 && Math.random() < (baseFlameScale > 1.0 ? 0.6 : 0.2)) {
    const pEl = document.createElement('div');
    pEl.classList.add('partikel');
    pEl.style.backgroundColor = Math.random() < 0.5 ? '#f1c40f' : '#e74c3c';
    let px = state.x + 15 + (Math.random() * 8 - 4);
    let py = state.y + 28;
    pEl.style.left = px + 'px';
    pEl.style.top = py + 'px';
    dom.spielfeld.appendChild(pEl);
    arrays.partikelArray.push({
      el: pEl,
      x: px,
      y: py,
      vx: (Math.random() - 0.5) * 0.5,
      vy: 1 + Math.random() * baseFlameScale,
      leben: 1.0,
      zerfall: 0.05
    });
  }

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

      if (state.p2IsBot) {
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
        if (b2.dy < 0) {
          state.p2.y -= p2Speed;
          baseFlameScaleP2 = 1.8;
        }
        if (b2.dy > 0) {
          state.p2.y += p2Speed;
          baseFlameScaleP2 = 0.4;
        }
        if (b2.dx < 0) {
          state.p2.x -= p2Speed;
          targetRotateP2 = -15;
        }
        if (b2.dx > 0) {
          state.p2.x += p2Speed;
          targetRotateP2 = 15;
        }
      }

      if (state.p2.x < 0) state.p2.x = 0;
      if (state.p2.y < 0) state.p2.y = 0;
      if (state.p2.x > config.spielfeldBreite - config.spielerGroesse) state.p2.x = config.spielfeldBreite - config.spielerGroesse;
      if (state.p2.y > config.spielfeldHoehe - config.spielerGroesse) state.p2.y = config.spielfeldHoehe - config.spielerGroesse;

      state.p2.spielerVx = state.p2.x - (state.p2.prevX !== undefined ? state.p2.prevX : state.p2.x);
      state.p2.spielerVy = (state.p2.prevY !== undefined ? state.p2.prevY : state.p2.y) - state.p2.y;
      state.p2.prevX = state.p2.x;
      state.p2.prevY = state.p2.y;

      dom.spieler2.style.left = state.p2.x + 'px';
      dom.spieler2.style.top = state.p2.y + 'px';

      let currentRotateP2 = parseFloat(dom.spieler2.getAttribute('data-rotate') || 0);
      currentRotateP2 += (targetRotateP2 - currentRotateP2) * 0.15;
      dom.spieler2.setAttribute('data-rotate', currentRotateP2);
      dom.spieler2.style.transform = `rotate(${currentRotateP2}deg)`;

      const fLeftP2 = document.getElementById('flame-left-p2');
      const fRightP2 = document.getElementById('flame-right-p2');
      if (fLeftP2) fLeftP2.style.transform = `scaleY(${baseFlameScaleP2})`;
      if (fRightP2) fRightP2.style.transform = `scaleY(${baseFlameScaleP2})`;

      if (baseFlameScaleP2 > 0.5 && Math.random() < (baseFlameScaleP2 > 1.0 ? 0.6 : 0.2)) {
        const pEl2 = document.createElement('div');
        pEl2.classList.add('partikel');
        pEl2.style.backgroundColor = Math.random() < 0.5 ? '#74b9ff' : '#0984e3';
        let px2 = state.p2.x + 15 + (Math.random() * 8 - 4);
        let py2 = state.p2.y + 28;
        pEl2.style.left = px2 + 'px';
        pEl2.style.top = py2 + 'px';
        dom.spielfeld.appendChild(pEl2);
        arrays.partikelArray.push({
          el: pEl2,
          x: px2,
          y: py2,
          vx: (Math.random() - 0.5) * 0.5,
          vy: 1 + Math.random() * baseFlameScaleP2,
          leben: 1.0,
          zerfall: 0.05
        });
      }
    }
  }
}

export function aktualisiereEnergie() {
  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  const p1LaserKey = isDualHumanCoop ? state.tastenGedrueckt.b : (state.tastenGedrueckt.l || state.tastenGedrueckt.b);
  if (p1LaserKey && !state.isDead) {
    if (!state.laserSchiesst && state.energie >= state.minZuendEnergie) state.laserSchiesst = true;
    if (state.energie <= 0) state.laserSchiesst = false;
  } else {
    state.laserSchiesst = false;
  }
  let laserAktiv = state.laserSchiesst && state.energie > 0 && !state.isDead && !Hack.hatHack(state, 'waffenOffline');
  if (laserAktiv) {
    if (!state.unbegrenzteEnergie) {
      state.energie -= 0.8 + Math.min(state.laserStufe, 5) * 0.1;
    }
  } else {
    const regenRate = (shipModels && shipModels[state.selectedShipModel]?.energyRegen) || 0.4;
    if (state.energie < state.maxEnergie) state.energie += regenRate;
    versteckeAlleLaser();
  }
  if (state.energie < 0) state.energie = 0;
  if (state.energie > state.maxEnergie) state.energie = state.maxEnergie;
  if (dom.energieBalken) {
    dom.energieBalken.style.width = state.energie / state.absMaxEnergie * 100 + '%';
    if (state.unbegrenzteEnergie) {
      dom.energieBalken.style.backgroundColor = '#f1c40f';
    } else {
      dom.energieBalken.style.backgroundColor = state.energie < state.minZuendEnergie && !state.laserSchiesst ? '#e67e22' : '#1abc9c';
    }
  }

  // --- 9.4 ENERGIE SPIELER 2 (Co-op) ---
  let laserAktivP2 = false;
  if (isCoopMode() && state.p2 && !state.p2.isDead) {
    const p2LaserKey = (state.network && state.network.isOnline && state.network.isHost)
      ? Boolean(state.p2 && state.p2.laserInputRequested)
      : (state.p2IsBot ? (state.p2.botFireLaser || false) : (state.tastenGedrueckt.ä || state.tastenGedrueckt.numpad1 || state.tastenGedrueckt['.']));
    if (p2LaserKey) {
      if (!state.p2.laserSchiesst && state.p2.energie >= state.p2.minZuendEnergie) state.p2.laserSchiesst = true;
      if (state.p2.energie <= 0) state.p2.laserSchiesst = false;
    } else {
      state.p2.laserSchiesst = false;
    };
    laserAktivP2 = state.p2.laserSchiesst && state.p2.energie > 0 && !Hack.hatHack(state.p2, 'waffenOffline');
    if (laserAktivP2) {
      state.p2.energie -= 0.8 + Math.min(state.p2.laserStufe, 5) * 0.1;
    } else {
      const p2RegenRate = (shipModels && shipModels[state.p2.selectedShipModel]?.energyRegen) || 0.4;
      if (state.p2.energie < state.p2.maxEnergie) state.p2.energie += p2RegenRate;
    }
    if (state.p2.energie < 0) state.p2.energie = 0;
    if (state.p2.energie > state.p2.maxEnergie) state.p2.energie = state.p2.maxEnergie;
    if (dom.energieBalkenP2) {
      dom.energieBalkenP2.style.width = state.p2.energie / state.p2.absMaxEnergie * 100 + '%';
      dom.energieBalkenP2.style.backgroundColor = state.p2.energie < state.p2.minZuendEnergie && !state.p2.laserSchiesst ? '#e67e22' : '#3498db';
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
