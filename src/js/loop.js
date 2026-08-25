
import { state, dom, config, arrays, shipModels, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Input from './input.js';
import * as Audio from './audio.js';
import * as Cutscene from './cutscene.js';
import * as Bot from './bot.js';
import * as Network from './network.js';


export function verwalteFeindSpawns() {
  let pV = state.level >= 2 ? Math.min(0.25, 0.05 + (state.level - 2) * 0.05) : 0;
  let pCross = state.level >= 1 ? Math.min(0.20, 0.05 + (state.level - 1) * 0.05) : 0;
  let pSwoop = state.level >= 1 ? Math.min(0.20, 0.05 + (state.level - 1) * 0.05) : 0;
  let pClingOn = state.level >= 1 ? Math.min(0.20, 0.05 + (state.level - 1) * 0.05) : 0;
  
  let r = Math.random();
  
  if (r < pV) {
    // V-Formation (3 oder 5 Jäger)
    let count = Math.random() < 0.5 ? 3 : 5;
    let spacingX = 40;
    let spacingY = 30;
    let centerX = config.spielfeldBreite / 2 - 15;
    for (let i = 0; i < count; i++) {
      let offset = Math.ceil(i / 2);
      let side = i % 2 === 0 && i !== 0 ? -1 : 1;
      if (i === 0) {
        offset = 0;
        side = 0;
      }
      Entities.erzeugeFeind(centerX + offset * spacingX * side, -30 - offset * spacingY, 'normal', 0);
    }
  } else if (r < pV + pCross) {
    // Crossfire (2 Jäger überkreuz)
    Entities.erzeugeFeind(10, -30, 'crossfire', 2.5);
    Entities.erzeugeFeind(config.spielfeldBreite - 40, -30, 'crossfire', -2.5);
  } else if (r < pV + pCross + pSwoop) {
    // Swoop (1 Jäger von der Seite)
    let spawnLeft = Math.random() < 0.5;
    Entities.erzeugeFeind(spawnLeft ? -30 : config.spielfeldBreite, 20 + Math.random() * 50, 'swoop', spawnLeft ? 3.5 : -3.5);
  } else if (r < pV + pCross + pSwoop + pClingOn) {
    // Cling-on Feind an neuem Asteroid
    Entities.erzeugeClingOnFeind();
  } else {
    // Einzelner Jäger (Normal oder Stop&Go)
    Entities.erzeugeFeind();
  }
}
export
// ------------------------------

function versteckeAlleLaser() {
  dom.laser1.style.display = 'none';
  dom.laser2.style.display = 'none';
  dom.laserDiagLinks.style.display = 'none';
  dom.laserDiagRechts.style.display = 'none';
}
export function gameLoop() {
  if (state.pausiert) {
    requestAnimationFrame(gameLoop);
    return;
  }

  if (state.cutsceneAktiv) {
    requestAnimationFrame(gameLoop);
    return;
  }

  if (!state.spielLaeuft) {
    const whatsNew = document.getElementById('whats-new-overlay');
    const isWhatsNewOpen = whatsNew && whatsNew.style.display !== 'none';
    const keys = state.tastenGedrueckt;
    const startKeyPressed = keys.w || keys.a || keys.s || keys.d || keys.l || keys.k || keys[' '] ||
                            keys.b || keys.v || keys.c || keys.ä || keys.ö ||
                            keys.arrowup || keys.arrowdown || keys.arrowleft || keys.arrowright;
    if (!isWhatsNewOpen && startKeyPressed) {
      if (state.gameMode === 'online') {
        if (state.network && state.network.isHost && state.network.connected) {
          Network.hostStartGame();
          requestAnimationFrame(gameLoop);
          return;
        }
      } else {
        let startScreen = document.getElementById('start-screen');
        if (startScreen) startScreen.style.display = 'none';
        Cutscene.startCutscene();
        requestAnimationFrame(gameLoop);
        return;
      }
    } else {
      // Nur Sterne und Spieler rendern
      arrays.sterne.forEach(stern => {
        stern.y += stern.speed;
        if (stern.y > config.spielfeldHoehe) {
          stern.y = -5;
          stern.x = Math.random() * config.spielfeldBreite;
        }
        stern.el.style.top = stern.y + 'px';
        stern.el.style.left = stern.x + 'px';
      });
      requestAnimationFrame(gameLoop);
      return;
    }
  }

  if (state.bossWarningAktiv) {
    state.bossWarningTimer--;
    if (state.bossWarningTimer <= 0) {
      state.bossWarningAktiv = false;
      dom.warningOverlay.style.display = 'none';
      Entities.erzeugeBoss();
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
    requestAnimationFrame(gameLoop);
    return;
  }
  if (state.gameOverAktiv) {
    // Nur Sterne fliegen weiter
    arrays.sterne.forEach(stern => {
      stern.y += stern.speed;
      if (stern.y > config.spielfeldHoehe) {
        stern.y = -5;
        stern.x = Math.random() * config.spielfeldBreite;
      }
      stern.el.style.top = stern.y + 'px';
      stern.el.style.left = stern.x + 'px';
    });
    requestAnimationFrame(gameLoop);
    return;
  }

  // --- ONLINE CLIENT LOKALE STEUERUNG & RENDERING ---
  if (state.network && state.network.isClient && state.network.connected) {
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

      if (state.joystick && state.joystick.active) {
        let mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
        if (mag > 0.1) {
          let dirX = state.joystick.x / mag;
          let dirY = state.joystick.y / mag;
          state.p2.x += dirX * p2Speed;
          state.p2.y += dirY * p2Speed;
        }
        if (state.joystick.y < -0.2) baseFlameScaleP2 = 1.8;
        else if (state.joystick.y > 0.2) baseFlameScaleP2 = 0.4;
        if (state.joystick.x < -0.2) targetRotateP2 = -15;
        else if (state.joystick.x > 0.2) targetRotateP2 = 15;
      } else {
        if (keys.w || keys.arrowup) {
          state.p2.y -= p2Speed;
          baseFlameScaleP2 = 1.8;
        }
        if (keys.s || keys.arrowdown) {
          state.p2.y += p2Speed;
          baseFlameScaleP2 = 0.4;
        }
        if (keys.a || keys.arrowleft) {
          state.p2.x -= p2Speed;
          targetRotateP2 = -15;
        }
        if (keys.d || keys.arrowright) {
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

    // Partikel auf dem Client animieren und löschen
    animierenPartikel();

    Network.sendNetworkInput(Network.serializePlayerInput());

    requestAnimationFrame(gameLoop);
    return;
  }

  // --- I-Frames (Unverwundbarkeit Timer) ---
  if (state.invulnerableTimer > 0) {
    state.invulnerableTimer--;
    if (state.invulnerableTimer === 0) {
      dom.spieler.classList.remove('spieler-blink');
    }
  }

  // --- 9.1 SPIELER 1 BEWEGUNG ---
  let baseFlameScale = 1.0;
  let targetRotate = 0;
  const towedCountP1 = isCoopMode() ? arrays.powerups.filter(p => p.towedBy === 'p1').length : 0;
  const speedMultP1 = Math.max(0.1, 1.0 - 0.10 * towedCountP1);
  const currentSpeed = ((shipModels && shipModels[state.selectedShipModel]?.speed) || config.geschwindigkeit) * speedMultP1;
  
  if (state.joystick && state.joystick.active) {
    let mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
    if (mag > 0.1) {
      let dirX = state.joystick.x / mag;
      let dirY = state.joystick.y / mag;
      state.x += dirX * currentSpeed;
      state.y += dirY * currentSpeed;
    }
    
    if (state.joystick.y < -0.2) baseFlameScale = 1.8;
    else if (state.joystick.y > 0.2) baseFlameScale = 0.4;
    
    if (state.joystick.x < -0.2) targetRotate = -15;
    else if (state.joystick.x > 0.2) targetRotate = 15;
  } else if (!state.isDead) {
    const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
    const up = state.tastenGedrueckt.w || (!isDualHumanCoop && state.tastenGedrueckt.arrowup);
    const down = state.tastenGedrueckt.s || (!isDualHumanCoop && state.tastenGedrueckt.arrowdown);
    const left = state.tastenGedrueckt.a || (!isDualHumanCoop && state.tastenGedrueckt.arrowleft);
    const right = state.tastenGedrueckt.d || (!isDualHumanCoop && state.tastenGedrueckt.arrowright);

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
        // Flammen/Rotation aus Bot-Bewegung ableiten
        const botDy = state.p2.y - prevBotY;
        const botDx = state.p2.x - prevBotX;
        if (botDy < -0.5) baseFlameScaleP2 = 1.8;
        else if (botDy > 0.5) baseFlameScaleP2 = 0.4;
        if (botDx < -0.5) targetRotateP2 = -15;
        else if (botDx > 0.5) targetRotateP2 = 15;
      } else if (state.gameMode === 'coop') {
        // Menschliche Steuerung via Arrow-Keys im lokalen Coop
        if (state.tastenGedrueckt.arrowup) {
          state.p2.y -= p2Speed;
          baseFlameScaleP2 = 1.8;
        }
        if (state.tastenGedrueckt.arrowdown) {
          state.p2.y += p2Speed;
          baseFlameScaleP2 = 0.4;
        }
        if (state.tastenGedrueckt.arrowleft) {
          state.p2.x -= p2Speed;
          targetRotateP2 = -15;
        }
        if (state.tastenGedrueckt.arrowright) {
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
  if (state.durchschlagTimer > 0) {
    state.durchschlagTimer--;
    if (state.durchschlagTimer <= 0) {
      state.laserDurchschlag = false;
      Utils.updateAktivePowerupsUI();
    }
  }

  // --- 9.2 STERNE BEWEGUNG & SPARTIKEL ---
  arrays.sterne.forEach(stern => {
    stern.y += stern.speed;
    if (stern.y > config.spielfeldHoehe) {
      stern.y = -5;
      stern.x = Math.random() * config.spielfeldBreite;
    }
    stern.el.style.top = stern.y + 'px';
    stern.el.style.left = stern.x + 'px';
  });

  // --- 9.3 SPAWNS & DIFFICULTY CURVE (Skaliert mit Level!) ---
  state.frameZaehler++;
  if (!state.bossAktiv) {
    // LANGSAMERE SKALIERUNG: Asteroiden-Raten sinken nicht mehr so extrem schnell
    let startRate = Math.max(40, 120 - (state.level - 1) * 10);
    let midRate = Math.max(30, startRate - 20);
    let endRate = Math.max(20, midRate - 20);
    let astRate = startRate;
    // Das Level dauert nun 60 Sekunden (3600 Frames)
    if (state.frameZaehler > 1200) astRate = midRate; // Nach 20 Sek
    if (state.frameZaehler > 2400) astRate = endRate; // Nach 40 Sek

    if (state.frameZaehler % astRate === 0) Entities.erzeugeAsteroid();
    let feindSpawnZeit = Math.max(600, 1200 - (state.level - 1) * 100);
    let feindRate = Math.max(120, 300 - (state.level - 1) * 30);
    if (state.frameZaehler > feindSpawnZeit && state.frameZaehler % feindRate === 0) verwalteFeindSpawns();

    // Boss erscheint am Ende des Levels (nach 60 Sekunden / 3600 Frames)
    if (state.frameZaehler === 3600 && !state.bossAktiv && !state.bossWarningAktiv) {
      state.bossWarningAktiv = true;
      state.bossWarningTimer = 120; // 2 Sekunden Pause bei 60 FPS
      Audio.playBossAlert();
      dom.warningOverlay.style.display = 'flex';
    }
  }

  // --- 9.3 LEVEL TEXT TIMER & SCORE ---
  if (state.levelTextTimer > 0) {
    state.levelTextTimer--;
    if (state.levelTextTimer === 0) dom.levelAnzeigeMitte.style.display = 'none';
  }
  if (state.frameZaehler % 60 === 0) Utils.addScore(5);

  // --- 9.4 ENERGIE SPIELER 1 ---
  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  const p1LaserKey = isDualHumanCoop ? state.tastenGedrueckt.b : (state.tastenGedrueckt.l || state.tastenGedrueckt.b);
  if (p1LaserKey && !state.isDead) {
    if (!state.laserSchiesst && state.energie >= state.minZuendEnergie) state.laserSchiesst = true;
    if (state.energie <= 0) state.laserSchiesst = false;
  } else {
    state.laserSchiesst = false;
  }
  let laserAktiv = state.laserSchiesst && state.energie > 0 && !state.isDead;
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
    laserAktivP2 = state.p2.laserSchiesst && state.p2.energie > 0;
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

  // --- 9.4b SCHILD REGENERATION (Phantom-NX) ---
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

  // --- 9.5 POWERUPS ---
  function wendePowerupAn(p, targetKey = 'p1') {
    const isP1 = targetKey === 'p1';
    const pState = isP1 ? state : state.p2;
    const pDom = isP1 ? dom.spieler : dom.spieler2;
    if (!pState) return;

    Audio.playPowerup(p.type);
    if (p.type === 'leben') {
      pState.leben++;
      if (isCoopMode()) {
        const otherState = isP1 ? state.p2 : state;
        const otherDom = isP1 ? dom.spieler2 : dom.spieler;
        if (otherState && otherState.isDead) {
          otherState.isDead = false;
          otherState.leben = 1;
          otherState.energie = otherState.maxEnergie / 2;
          otherState.invulnerableTimer = 180;
          if (otherDom) {
            otherDom.style.display = 'block';
            otherDom.classList.add('spieler-blink');
          }
          if (isP1) Utils.updateLebenP2UI();
          else Utils.updateLebenUI();
        }
      }
      if (isP1) Utils.updateLebenUI();
      else Utils.updateLebenP2UI();
    } else if (p.type === 'energie') {
      if (pState.maxEnergie >= pState.absMaxEnergie) {
        pState.unbegrenzteEnergie = true;
        const marker = isP1 ? dom.maxEnergieMarker : dom.maxEnergieMarkerP2;
        if (marker) marker.style.display = 'none';
        pState.energie = pState.absMaxEnergie;
      } else {
        pState.maxEnergie = Math.min(pState.absMaxEnergie, pState.maxEnergie + 10);
        pState.energie = pState.maxEnergie;
        if (isP1) Utils.updateMaxEnergieMarker();
        else Utils.updateMaxEnergieMarkerP2();
      }
    } else if (p.type === 'durchschlag') {
      pState.laserDurchschlag = true;
      pState.durchschlagTimer = 600;
      if (isP1) Utils.updateAktivePowerupsUI();
      else Utils.updateAktivePowerupsP2UI();
    } else if (p.type === 'schild') {
      if (pState.schildStufe > 0 && pDom) pDom.classList.remove(`schild-aktiv-${pState.schildStufe}`);
      if (pState.schildStufe < 3) pState.schildStufe++;
      if (pDom) pDom.classList.add(`schild-aktiv-${pState.schildStufe}`);
      if (isP1) Utils.updateAktivePowerupsUI();
      else Utils.updateAktivePowerupsP2UI();
    } else if (p.type === 'laserWaffe') {
      if (pState.laserStufe < 5) {
        pState.laserStufe++;
        if (isP1) Utils.updateAktivePowerupsUI();
        else Utils.updateAktivePowerupsP2UI();
      }
    } else if (p.type === 'raketenWaffe') {
      if (pState.raketenStufe < 5) {
        pState.raketenStufe++;
        if (isP1) Utils.updateAktivePowerupsUI();
        else Utils.updateAktivePowerupsP2UI();
      }
    } else if (p.type === 'bombenWaffe') {
      if (pState.bombenStufe < 5) {
        pState.bombenStufe++;
        if (isP1) Utils.updateAktivePowerupsUI();
        else Utils.updateAktivePowerupsP2UI();
      }
    } else if (p.type === 'superWaffe') {
      if (pState.laserStufe < 5) pState.laserStufe++;
      if (pState.raketenStufe < 5) pState.raketenStufe++;
      if (pState.bombenStufe < 5) pState.bombenStufe++;
      if (isP1) Utils.updateAktivePowerupsUI();
      else Utils.updateAktivePowerupsP2UI();
    } else if (p.type === 'autolaser') {
      pState.autolaserAktiv = true;
      pState.autolaserTimer = 600;
      if (isP1) Utils.updateAktivePowerupsUI();
      else Utils.updateAktivePowerupsP2UI();
    } else if (p.type === 'splitterRot') {
      pState.splitterRot = (pState.splitterRot || 0) + 1;
      if (pState.splitterRot >= 10) {
        pState.splitterRot -= 10;
        pState.leben++;
        if (isCoopMode()) {
          const otherState = isP1 ? state.p2 : state;
          const otherDom = isP1 ? dom.spieler2 : dom.spieler;
          if (otherState && otherState.isDead) {
            otherState.isDead = false;
            otherState.leben = 1;
            otherState.energie = otherState.maxEnergie / 2;
            otherState.invulnerableTimer = 180;
            if (otherDom) {
              otherDom.style.display = 'block';
              otherDom.classList.add('spieler-blink');
            }
            if (isP1) Utils.updateLebenP2UI();
            else Utils.updateLebenUI();
          }
        }
        if (isP1) Utils.updateLebenUI();
        else Utils.updateLebenP2UI();
        Audio.playPowerup('leben');
      }
      if (isP1) Utils.updateSplitterUI();
      else Utils.updateSplitterP2UI();
    } else if (p.type === 'splitterWeiss') {
      pState.splitterWeiss = (pState.splitterWeiss || 0) + 1;
      if (pState.splitterWeiss >= 10) {
        pState.splitterWeiss -= 10;
        if (pState.laserStufe < 5) pState.laserStufe++;
        if (pState.raketenStufe < 5) pState.raketenStufe++;
        if (pState.bombenStufe < 5) pState.bombenStufe++;
        if (isP1) Utils.updateAktivePowerupsUI();
        else Utils.updateAktivePowerupsP2UI();
        Audio.playPowerup('superWaffe');
      }
      if (isP1) Utils.updateSplitterUI();
      else Utils.updateSplitterP2UI();
    }
    Utils.addScore(50);
    const isOnline = state.gameMode === 'online' || (state.network && state.network.isOnline);
    if (!isOnline || isP1) {
      if (dom.spielfeld) {
        dom.spielfeld.style.backgroundColor = p.farbe;
        setTimeout(() => {
          if (dom.spielfeld) dom.spielfeld.style.backgroundColor = '#0b1319';
        }, 100);
      }
    } else if (isOnline && !isP1) {
      Network.sendNetworkEvent({ type: 'powerup_collected', target: 'p2', farbe: p.farbe });
    }
  }

  function updateTractorBeam(p, sx, sy) {
    const spielfeld = dom.spielfeld || document.getElementById('spielfeld');
    if (!spielfeld) return;

    if (!p.beamEl) {
      const beamSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      beamSvg.setAttribute('class', 'tractor-beam-svg');
      beamSvg.style.position = 'absolute';
      beamSvg.style.top = '0';
      beamSvg.style.left = '0';
      beamSvg.style.width = '100%';
      beamSvg.style.height = '100%';
      beamSvg.style.pointerEvents = 'none';
      beamSvg.style.zIndex = '6';

      const lineGlow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      lineGlow.setAttribute('class', 'tractor-beam-glow');
      lineGlow.setAttribute('stroke', p.towedBy === 'p1' ? '#3498db' : '#2ecc71');
      lineGlow.setAttribute('stroke-width', '4');
      lineGlow.setAttribute('opacity', '0.45');

      const lineCore = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      lineCore.setAttribute('class', 'tractor-beam-core');
      lineCore.setAttribute('stroke', '#ffffff');
      lineCore.setAttribute('stroke-width', '1.5');
      lineCore.setAttribute('stroke-dasharray', '3 2');

      beamSvg.appendChild(lineGlow);
      beamSvg.appendChild(lineCore);
      spielfeld.appendChild(beamSvg);
      p.beamEl = beamSvg;
    }

    const px = p.x + p.groesse / 2;
    const py = p.y + p.groesse / 2;

    const lines = p.beamEl.querySelectorAll('line');
    lines.forEach(l => {
      l.setAttribute('x1', sx);
      l.setAttribute('y1', sy);
      l.setAttribute('x2', px);
      l.setAttribute('y2', py);
    });
  }

  for (let i = arrays.powerups.length - 1; i >= 0; i--) {
    let p = arrays.powerups[i];

    // --- CASE A: Von Spieler 1 geschleppt ---
    if (p.towedBy === 'p1') {
      if (state.isDead) {
        p.towedBy = null;
        if (p.beamEl) { p.beamEl.remove(); p.beamEl = null; }
        p.el.classList.remove('powerup-towed', 'powerup-towed-p1', 'powerup-towed-p2');
        p.vy = 1.0;
      } else {
        const p1Towed = arrays.powerups.filter(pu => pu.towedBy === 'p1');
        const slotIdx = p1Towed.indexOf(p);
        let targetX = state.x + config.spielerGroesse / 2 - p.groesse / 2;
        let targetY = state.y + config.spielerGroesse + 16;
        if (slotIdx === 1) { targetX -= 18; targetY += 16; }
        else if (slotIdx === 2) { targetX += 18; targetY += 16; }

        p.x += (targetX - p.x) * 0.28;
        p.y += (targetY - p.y) * 0.28;
        p.el.style.left = p.x + 'px';
        p.el.style.top = p.y + 'px';

        updateTractorBeam(p, state.x + config.spielerGroesse / 2, state.y + config.spielerGroesse);

        // Übergabe an Spieler 2 prüfen
        if (isCoopMode() && state.p2 && !state.p2.isDead &&
            state.p2.x < p.x + p.groesse && state.p2.x + config.spielerGroesse > p.x &&
            state.p2.y < p.y + p.groesse && state.p2.y + config.spielerGroesse > p.y) {
          if (p.beamEl) { p.beamEl.remove(); p.beamEl = null; }
          wendePowerupAn(p, 'p2');
          p.el.remove();
          arrays.powerups.splice(i, 1);
          continue;
        }
      }
      continue;
    }

    // --- CASE B: Von Spieler 2 geschleppt ---
    if (p.towedBy === 'p2') {
      if (state.p2 && state.p2.isDead) {
        p.towedBy = null;
        if (p.beamEl) { p.beamEl.remove(); p.beamEl = null; }
        p.el.classList.remove('powerup-towed', 'powerup-towed-p1', 'powerup-towed-p2');
        p.vy = 1.0;
      } else if (state.p2) {
        const p2Towed = arrays.powerups.filter(pu => pu.towedBy === 'p2');
        const slotIdx = p2Towed.indexOf(p);
        let targetX = state.p2.x + config.spielerGroesse / 2 - p.groesse / 2;
        let targetY = state.p2.y + config.spielerGroesse + 16;
        if (slotIdx === 1) { targetX -= 18; targetY += 16; }
        else if (slotIdx === 2) { targetX += 18; targetY += 16; }

        p.x += (targetX - p.x) * 0.28;
        p.y += (targetY - p.y) * 0.28;
        p.el.style.left = p.x + 'px';
        p.el.style.top = p.y + 'px';

        updateTractorBeam(p, state.p2.x + config.spielerGroesse / 2, state.p2.y + config.spielerGroesse);

        // Übergabe an Spieler 1 prüfen
        if (!state.isDead &&
            state.x < p.x + p.groesse && state.x + config.spielerGroesse > p.x &&
            state.y < p.y + p.groesse && state.y + config.spielerGroesse > p.y) {
          if (p.beamEl) { p.beamEl.remove(); p.beamEl = null; }
          wendePowerupAn(p, 'p1');
          p.el.remove();
          arrays.powerups.splice(i, 1);
          continue;
        }
      }
      continue;
    }

    // --- CASE C: Freies Powerup ---
    p.y += p.vy;
    p.el.style.top = p.y + 'px';
    if (p.y > config.spielfeldHoehe) {
      if (p.beamEl) p.beamEl.remove();
      p.el.remove();
      arrays.powerups.splice(i, 1);
      continue;
    }

    // Prüfe Einsammeln durch Spieler 1
    const p1Col = !state.isDead &&
      state.x < p.x + p.groesse && state.x + config.spielerGroesse > p.x &&
      state.y < p.y + p.groesse && state.y + config.spielerGroesse > p.y;

    // Prüfe Einsammeln durch Spieler 2 (Co-op)
    const p2Col = isCoopMode() && state.p2 && !state.p2.isDead &&
      state.p2.x < p.x + p.groesse && state.p2.x + config.spielerGroesse > p.x &&
      state.p2.y < p.y + p.groesse && state.p2.y + config.spielerGroesse > p.y;

    if (p1Col) {
      if (!p.owner || p.owner === 'p1') {
        wendePowerupAn(p, 'p1');
        p.el.remove();
        arrays.powerups.splice(i, 1);
        continue;
      } else if (isCoopMode() && p.owner === 'p2') {
        const p1TowedCount = arrays.powerups.filter(pu => pu.towedBy === 'p1').length;
        if (p1TowedCount < 3) {
          p.towedBy = 'p1';
          p.el.classList.add('powerup-towed', 'powerup-towed-p1');
          Audio.playPowerup('tether');
          updateTractorBeam(p, state.x + config.spielerGroesse / 2, state.y + config.spielerGroesse);
        }
      }
    } else if (p2Col) {
      if (!p.owner || p.owner === 'p2') {
        wendePowerupAn(p, 'p2');
        p.el.remove();
        arrays.powerups.splice(i, 1);
        continue;
      } else if (isCoopMode() && p.owner === 'p1') {
        const p2TowedCount = arrays.powerups.filter(pu => pu.towedBy === 'p2').length;
        if (p2TowedCount < 3) {
          p.towedBy = 'p2';
          p.el.classList.add('powerup-towed', 'powerup-towed-p2');
          Audio.playPowerup('tether');
          updateTractorBeam(p, state.p2.x + config.spielerGroesse / 2, state.p2.y + config.spielerGroesse);
        }
      }
    }
  }

  // --- 9.6 ASTEROIDEN ---
  for (let i = arrays.asteroiden.length - 1; i >= 0; i--) {
    let ast = arrays.asteroiden[i];
    if (!ast) break;
    if (ast.immune > 0) ast.immune--;
    ast.x += ast.vx;
    ast.y += ast.vy;
    if (ast.vRot) {
      ast.rot += ast.vRot;
      ast.el.style.transform = `rotate(${ast.rot}deg)`;
    }
    ast.el.style.left = ast.x + 'px';
    ast.el.style.top = ast.y + 'px';
    if (ast.y > config.spielfeldHoehe || ast.x < -ast.groesse || ast.x > config.spielfeldBreite) {
      ast.el.remove();
      arrays.asteroiden.splice(i, 1);
      continue;
    }
    if (!state.isDead && state.x < ast.x + ast.groesse && state.x + config.spielerGroesse > ast.x && state.y < ast.y + ast.groesse && state.y + config.spielerGroesse > ast.y) {
      Utils.spielerGetroffen(ast, true, 'p1');
      ast.el.remove();
      arrays.asteroiden.splice(i, 1);
      continue;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && state.p2.x < ast.x + ast.groesse && state.p2.x + config.spielerGroesse > ast.x && state.p2.y < ast.y + ast.groesse && state.p2.y + config.spielerGroesse > ast.y) {
      Utils.spielerGetroffen(ast, true, 'p2');
      ast.el.remove();
      arrays.asteroiden.splice(i, 1);
      continue;
    }
  }

  // --- 9.7 FEINDE ---
  for (let i = arrays.feinde.length - 1; i >= 0; i--) {
    let f = arrays.feinde[i];
    if (!f) break;
    if (f.muster === 'stopAndGo') {
      if (f.phase === 'anflug') {
        f.y += f.vy * 2.5; // Schneller Anflug
        if (f.y >= f.stopY) {
          f.phase = 'stop';
          f.stopTimer = 40;
        }
      } else if (f.phase === 'stop') {
        f.stopTimer--;
        if (f.stopTimer === 10) {
          // Gezielter Schuss auf den näheren Spieler
          let targetX = state.x;
          let targetY = state.y;
          if (isCoopMode() && state.p2 && !state.p2.isDead) {
            let distP1 = Math.hypot(state.x - f.x, state.y - f.y);
            let distP2 = Math.hypot(state.p2.x - f.x, state.p2.y - f.y);
            if (state.isDead || distP2 < distP1) {
              targetX = state.p2.x;
              targetY = state.p2.y;
            }
          }
          Entities.erzeugeFeindLaser(f.x + f.groesse / 2 - 2, f.y + f.groesse, targetX + config.spielerGroesse / 2, targetY + config.spielerGroesse / 2);
        }
        if (f.stopTimer <= 0) {
          f.phase = 'abflug';
          f.schussTimer = 9999;
        }
      } else if (f.phase === 'abflug') {
        f.y += f.vy * 3.5; // Sehr schneller Abflug
      }
      f.zeit += 0.05;
      f.x = f.basisX + Math.sin(f.zeit) * 20;
    } else if (f.muster === 'swoop' || f.muster === 'crossfire') {
      f.x += f.vx;
      f.y += f.vy * 1.5;
      f.el.style.transform = `rotate(${Math.atan2(f.vy * 1.5, f.vx) * 180 / Math.PI - 90}deg)`;
    } else if (f.muster === 'clingOn') {
      if (f.phase === 'attached') {
        let asteroidExists = arrays.asteroiden.includes(f.attachedAsteroid);
        if (!asteroidExists || f.attachedAsteroid.y >= 150) {
          f.phase = 'attack';
          f.vy = 2;
          f.schussTimer = 9999;
          
          let flames = f.el.querySelectorAll('.feind-flame');
          flames.forEach(fl => fl.style.display = 'block');
          
          let targetX = state.x;
          let targetY = state.y;
          if (isCoopMode() && state.p2 && !state.p2.isDead) {
            let distP1 = Math.hypot(state.x - f.x, state.y - f.y);
            let distP2 = Math.hypot(state.p2.x - f.x, state.p2.y - f.y);
            if (state.isDead || distP2 < distP1) {
              targetX = state.p2.x;
              targetY = state.p2.y;
            }
          }
          Entities.erzeugeFeindLaser(f.x + f.groesse / 2 - 2, f.y + f.groesse, targetX + config.spielerGroesse / 2, targetY + config.spielerGroesse / 2);
        } else {
          f.x = f.attachedAsteroid.x + f.attachedAsteroid.groesse / 2 - f.groesse / 2;
          f.y = f.attachedAsteroid.y + f.attachedAsteroid.groesse / 2 - f.groesse / 2;
        }
      }
      if (f.phase === 'attack') {
        let targetX = state.x;
        let targetY = state.y;
        if (isCoopMode() && state.p2 && !state.p2.isDead) {
          let distP1 = Math.hypot(state.x - f.x, state.y - f.y);
          let distP2 = Math.hypot(state.p2.x - f.x, state.p2.y - f.y);
          if (state.isDead || distP2 < distP1) {
            targetX = state.p2.x;
            targetY = state.p2.y;
          }
        }
        let dx = (targetX + config.spielerGroesse / 2) - (f.x + f.groesse / 2);
        let dy = (targetY + config.spielerGroesse / 2) - (f.y + f.groesse / 2);
        let dist = Math.hypot(dx, dy);
        if (dist > 5) {
          f.vx = dx / dist * 3;
          f.vy = dy / dist * 3;
        }
        f.x += f.vx;
        f.y += f.vy;
        f.el.style.transform = `rotate(${Math.atan2(f.vy, f.vx) * 180 / Math.PI - 90}deg)`;
      }
    } else {
      f.y += f.vy;
      f.zeit += 0.05;
      f.x = f.basisX + Math.sin(f.zeit) * 30;
    }
    f.el.style.left = f.x + 'px';
    f.el.style.top = f.y + 'px';
    if (f.y > config.spielfeldHoehe || f.x < -f.groesse - 50 || f.x > config.spielfeldBreite + 50) {
      f.el.remove();
      arrays.feinde.splice(i, 1);
      continue;
    }

    if (f.muster !== 'clingOn' || f.phase !== 'attached') {
      if (f.burstCount > 0) {
        f.burstTimer--;
        if (f.burstTimer <= 0) {
          Entities.erzeugeFeindLaser(f.x + f.groesse / 2 - 2, f.y + f.groesse);
          f.burstCount--;
          f.burstTimer = 8;
        }
      }

      f.schussTimer--;
      if (f.schussTimer <= 0) {
        Entities.erzeugeFeindLaser(f.x + f.groesse / 2 - 2, f.y + f.groesse);
        let schussBasis = Math.max(25, 60 - (state.level - 1) * 8);
        f.schussTimer = Math.random() * schussBasis + schussBasis;

        if (state.level >= 3 && (Math.random() < Math.min(0.9, 0.5 + (state.level - 3) * 0.2) || f.forceBurst)) {
          f.burstCount = 1;
          f.burstTimer = 8;
        }
      }
    }
    if (!state.isDead && state.x < f.x + f.groesse && state.x + config.spielerGroesse > f.x && state.y < f.y + f.groesse && state.y + config.spielerGroesse > f.y) {
      Utils.spielerGetroffen(f, true, 'p1');
      f.el.remove();
      arrays.feinde.splice(i, 1);
      continue;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && state.p2.x < f.x + f.groesse && state.p2.x + config.spielerGroesse > f.x && state.p2.y < f.y + f.groesse && state.p2.y + config.spielerGroesse > f.y) {
      Utils.spielerGetroffen(f, true, 'p2');
      f.el.remove();
      arrays.feinde.splice(i, 1);
      continue;
    }
  }

  // --- 9.8 FEIND-LASER ---
  for (let i = arrays.feindLaserArray.length - 1; i >= 0; i--) {
    let fl = arrays.feindLaserArray[i];
    if (!fl) break;
    fl.y += fl.vy;
    if (fl.vx) fl.x += fl.vx;
    fl.el.style.top = fl.y + 'px';
    fl.el.style.left = fl.x + 'px';
    if (fl.y > config.spielfeldHoehe || fl.x < -fl.width || fl.x > config.spielfeldBreite) {
      fl.el.remove();
      arrays.feindLaserArray.splice(i, 1);
      continue;
    }
    if (!state.isDead && state.x < fl.x + fl.width && state.x + config.spielerGroesse > fl.x && state.y < fl.y + fl.height && state.y + config.spielerGroesse > fl.y) {
      Utils.spielerGetroffen(fl, false, 'p1');
      fl.el.remove();
      arrays.feindLaserArray.splice(i, 1);
      continue;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && state.p2.x < fl.x + fl.width && state.p2.x + config.spielerGroesse > fl.x && state.p2.y < fl.y + fl.height && state.p2.y + config.spielerGroesse > fl.y) {
      Utils.spielerGetroffen(fl, false, 'p2');
      fl.el.remove();
      arrays.feindLaserArray.splice(i, 1);
      continue;
    }
  }

  // --- BOSS LOGIK ---
  for (let i = arrays.bosses.length - 1; i >= 0; i--) {
    let b = arrays.bosses[i];
    if (!b) break;
    if (b.phase === 'einzug') {
      if (!b.el.classList.contains('repulsor-aktiv')) b.el.classList.add('repulsor-aktiv');
      b.y += b.vy;
      if (b.y >= 20) {
        b.y = 20;
        b.phase = 'kampf';
        b.el.classList.remove('repulsor-aktiv');
      }

      // Repulsor auf Projektile anwenden
      arrays.laserArray.forEach(l => {
        let cx = b.x + b.groesse / 2;
        let cy = b.y + b.groesse / 2;
        let lx = l.x + l.width / 2;
        let ly = l.y;
        let dx = lx - cx;
        let dy = ly - cy;
        let dist = Math.hypot(dx, dy);
        if (dist < b.groesse * 1.5 && dy > 0) {
          // Wirkt am besten nach unten abwehrend
          let kraft = (b.groesse * 1.5 - dist) * 0.15;
          l.vx += dx > 0 ? kraft : -kraft;
        }
      });
      b.el.style.left = b.x + 'px';
      b.el.style.top = b.y + 'px';
      dom.bossHpBalken.style.width = Math.max(0, b.hp / b.maxHp * 100) + '%';
      continue; // Überspringt Kampf-Bewegungen und Schießen
    } else {
      // Enrage Check für alle Typen
      if (!b.enragePhaseAktiv && b.hp < b.maxHp * 0.5) {
        b.enragePhaseAktiv = true;
        b.baseSchussRate = Math.max(15, Math.floor(b.baseSchussRate / 2));
        dom.bossHpBalken.style.backgroundColor = '#8e44ad'; // Visualisiert Enrage im Balken
        if (b.bossTyp === 2) b.vx *= 1.5; // Jäger wird im Enrage schneller
      }

      // Bewegung
      if (b.bossTyp === 1) {
        // Kreuzer
        b.x += b.vx;
        if (b.x <= 10 || b.x >= config.spielfeldBreite - b.groesse - 10) b.vx *= -1;
      } else if (b.bossTyp === 2) {
        // Jäger - verfolgt den näheren lebenden Spieler
        let targetX = state.x;
        let targetY = state.y;
        if (isCoopMode() && state.p2 && !state.p2.isDead) {
          let distP1 = Math.hypot(state.x - b.x, state.y - b.y);
          let distP2 = Math.hypot(state.p2.x - b.x, state.p2.y - b.y);
          if (state.isDead || distP2 < distP1) {
            targetX = state.p2.x;
            targetY = state.p2.y;
          }
        }
        let zielX = targetX + config.spielerGroesse / 2 - b.groesse / 2;
        if (b.x < zielX - 5) b.x += b.vx;else if (b.x > zielX + 5) b.x -= b.vx;
      } else if (b.bossTyp === 3) {
        // Träger
        b.zeit = (b.zeit || 0) + 0.02 * (b.enragePhaseAktiv ? 1.5 : 1);
        b.x = config.spielfeldBreite / 2 - b.groesse / 2 + Math.sin(b.zeit) * (config.spielfeldBreite / 2 - b.groesse / 2 - 10);
      } else if (b.bossTyp === 4) {
        // Festung
        b.x += b.vx * 0.5; // Bewegt sich sehr langsam
        if (b.x <= 10 || b.x >= config.spielfeldBreite - b.groesse - 10) b.vx *= -1;
      }

      // Update HP Balken Breite
      dom.bossHpBalken.style.width = Math.max(0, b.hp / b.maxHp * 100) + '%';
      if (b.enragePhaseAktiv) {
        Utils.erzeugeRauchFunken(b.x, b.y, b.groesse);
      }
      if (b.bossTyp === 1) {
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.3, b.y - b.groesse * 0.05, -2);
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.7, b.y - b.groesse * 0.05, -2);
      } else if (b.bossTyp === 2) {
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.35, b.y - b.groesse * 0.05, -2);
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.65, b.y - b.groesse * 0.05, -2);
      } else if (b.bossTyp === 3) {
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.5, b.y - b.groesse * 0.05, -2);
      } else if (b.bossTyp === 4) {
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.25, b.y - b.groesse * 0.05, -2);
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.75, b.y - b.groesse * 0.05, -2);
      }
      b.schussTimer--;
      if (b.schussTimer <= 0) {
        if (b.bossTyp === 1) {
          Entities.erzeugeBossLaser(b.x + b.groesse * 0.2, b.y + b.groesse * 0.7);
          Entities.erzeugeBossLaser(b.x + b.groesse * 0.46, b.y + b.groesse * 0.9);
          Entities.erzeugeBossLaser(b.x + b.groesse * 0.72, b.y + b.groesse * 0.7);
          if (b.enragePhaseAktiv) {
            Entities.erzeugeBossLaser(b.x + b.groesse * 0.1, b.y + b.groesse * 0.5);
            Entities.erzeugeBossLaser(b.x + b.groesse * 0.82, b.y + b.groesse * 0.5);
          }
        } else if (b.bossTyp === 2) {
          // Gezielter Schuss auf den näheren lebenden Spieler
          let targetX = state.x + config.spielerGroesse / 2;
          let targetY = state.y + config.spielerGroesse / 2;
          if (isCoopMode() && state.p2 && !state.p2.isDead) {
            let distP1 = Math.hypot(state.x - b.x, state.y - b.y);
            let distP2 = Math.hypot(state.p2.x - b.x, state.p2.y - b.y);
            if (state.isDead || distP2 < distP1) {
              targetX = state.p2.x + config.spielerGroesse / 2;
              targetY = state.p2.y + config.spielerGroesse / 2;
            }
          }
          let startX = b.x + b.groesse / 2 - 4;
          let startY = b.y + b.groesse;
          let winkel = Math.atan2(targetY - startY, targetX - startX);
          Entities.erzeugeBossLaser(startX, startY, Math.cos(winkel) * 8, Math.sin(winkel) * 8);
          if (b.enragePhaseAktiv) {
            Entities.erzeugeBossLaser(startX, startY, Math.cos(winkel - 0.2) * 8, Math.sin(winkel - 0.2) * 8);
            Entities.erzeugeBossLaser(startX, startY, Math.cos(winkel + 0.2) * 8, Math.sin(winkel + 0.2) * 8);
          }
        } else if (b.bossTyp === 3) {
          // Spawnt einen Feind
          Entities.erzeugeFeind(b.x + b.groesse / 2 - 15, b.y + b.groesse);
          if (Math.random() < 0.5 || b.enragePhaseAktiv) Entities.erzeugeBossLaser(b.x + b.groesse / 2 - 4, b.y + b.groesse);
        } else if (b.bossTyp === 4) {
          // Fächerschuss (Spread)
          let anzahl = b.enragePhaseAktiv ? 7 : 5;
          let startX = b.x + b.groesse / 2 - 4;
          let startY = b.y + b.groesse - 10;
          for (let j = 0; j < anzahl; j++) {
            let winkel = Math.PI / 2 - 0.5 + j * (1.0 / (anzahl - 1));
            Entities.erzeugeBossLaser(startX, startY, Math.cos(winkel) * 6, Math.sin(winkel) * 6);
          }
        }
        b.schussTimer = b.baseSchussRate;
      }

      // Boss-Bomben Abwurf
      b.bombenTimer = (b.bombenTimer !== undefined ? b.bombenTimer : (Math.random() * 120 + 240)) - 1;
      if (b.bombenTimer <= 0) {
        Entities.erzeugeBossBombe(b.x + b.groesse / 2 - 13, b.y + b.groesse * 0.7);
        b.bombenTimer = Math.max(160, 360 - (state.level - 1) * 30);
      }

      // Boss-Raketen Abwurf (seitlich zielsuchend)
      b.raketenTimer = (b.raketenTimer !== undefined ? b.raketenTimer : (Math.random() * 140 + 200)) - 1;
      if (b.raketenTimer <= 0) {
        let side = Math.random() < 0.5 ? -1 : 1;
        Entities.erzeugeBossRakete(b.x + (side < 0 ? 0 : b.groesse - 14), b.y + b.groesse * 0.5, side);
        if (b.enragePhaseAktiv || state.level >= 4) {
          Entities.erzeugeBossRakete(b.x + (-side < 0 ? 0 : b.groesse - 14), b.y + b.groesse * 0.5, -side);
        }
        b.raketenTimer = Math.max(180, 360 - (state.level - 1) * 25);
      }
    }
    b.el.style.left = b.x + 'px';
    b.el.style.top = b.y + 'px';
    let bossPadding = b.groesse * 0.15;
    if (!state.isDead && state.x < b.x + b.groesse - bossPadding && state.x + config.spielerGroesse > b.x + bossPadding && state.y < b.y + b.groesse - bossPadding && state.y + config.spielerGroesse > b.y + bossPadding) {
      Utils.spielerGetroffen(b, false, 'p1');
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && state.p2.x < b.x + b.groesse - bossPadding && state.p2.x + config.spielerGroesse > b.x + bossPadding && state.p2.y < b.y + b.groesse - bossPadding && state.p2.y + config.spielerGroesse > b.y + bossPadding) {
      Utils.spielerGetroffen(b, false, 'p2');
    }
  }
  for (let i = arrays.bossLaserArray.length - 1; i >= 0; i--) {
    let bl = arrays.bossLaserArray[i];
    if (!bl) break;
    bl.x += bl.vx || 0;
    bl.y += bl.vy;
    bl.el.style.left = bl.x + 'px';
    bl.el.style.top = bl.y + 'px';
    if (bl.y > config.spielfeldHoehe || bl.x < -10 || bl.x > config.spielfeldBreite + 10) {
      bl.el.remove();
      arrays.bossLaserArray.splice(i, 1);
      continue;
    }
    if (!state.isDead && state.x < bl.x + bl.width && state.x + config.spielerGroesse > bl.x && state.y < bl.y + bl.height && state.y + config.spielerGroesse > bl.y) {
      Utils.spielerGetroffen(bl, false, 'p1');
      bl.el.remove();
      arrays.bossLaserArray.splice(i, 1);
      continue;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && state.p2.x < bl.x + bl.width && state.p2.x + config.spielerGroesse > bl.x && state.p2.y < bl.y + bl.height && state.p2.y + config.spielerGroesse > bl.y) {
      Utils.spielerGetroffen(bl, false, 'p2');
      bl.el.remove();
      arrays.bossLaserArray.splice(i, 1);
      continue;
    }
  }

  // --- 9.8c BOSS BOMBEN UPDATE ---
  for (let i = arrays.bossBombenArray.length - 1; i >= 0; i--) {
    let bb = arrays.bossBombenArray[i];
    if (!bb) break;
    bb.x += bb.vx;
    bb.y += bb.vy;
    bb.el.style.left = bb.x + 'px';
    bb.el.style.top = bb.y + 'px';
    bb.timer--;

    // Beep-Takt beschleunigen je näher an der Detonation
    let bbProgress = Math.max(0, bb.timer / (bb.maxTimer || 180));
    let bbUrgency = 1.0 - bbProgress;
    bb.beepTimer = (bb.beepTimer || 0) + 1;
    let bbBeepInterval = Math.max(3, Math.floor(bbProgress * 20));
    if (bb.beepTimer >= bbBeepInterval) {
      bb.beepTimer = 0;
      Audio.playBombBeep(bbUrgency, true);
    }

    if (bb.hp <= 0) {
      Utils.addScore(150);
      Utils.erzeugeExplosion(bb.x + 13, bb.y + 13, '#2ecc71', 25);
      bb.el.remove();
      arrays.bossBombenArray.splice(i, 1);
      continue;
    }

    if (bb.y > config.spielfeldHoehe + 40 || bb.x < -40 || bb.x > config.spielfeldBreite + 40) {
      bb.el.remove();
      arrays.bossBombenArray.splice(i, 1);
      continue;
    }

    if (bb.timer <= 0 || bb.y >= config.spielfeldHoehe - 60) {
      let cx = bb.x + 13;
      let cy = bb.y + 13;
      Utils.erzeugeExplosion(cx, cy, '#e74c3c', 40);

      const sw = document.createElement('div');
      sw.classList.add('boss-shockwave');
      sw.style.position = 'absolute';
      sw.style.width = bb.radius * 2 + 'px';
      sw.style.height = bb.radius * 2 + 'px';
      sw.style.left = cx - bb.radius + 'px';
      sw.style.top = cy - bb.radius + 'px';
      sw.style.borderRadius = '50%';
      sw.style.backgroundColor = 'rgba(231, 76, 60, 0.45)';
      sw.style.boxShadow = '0 0 30px #e74c3c';
      sw.style.zIndex = '9';
      sw.style.pointerEvents = 'none';
      sw.style.transition = 'all 0.4s ease-out';
      dom.spielfeld.appendChild(sw);
      setTimeout(() => {
        sw.style.opacity = '0';
        sw.style.transform = 'scale(1.25)';
      }, 10);
      setTimeout(() => sw.remove(), 400);

      let distP1 = Math.hypot((state.x + config.spielerGroesse / 2) - cx, (state.y + config.spielerGroesse / 2) - cy);
      if (!state.isDead && distP1 <= bb.radius) {
        Utils.spielerGetroffen(bb, false, 'p1');
      }
      if (isCoopMode() && state.p2 && !state.p2.isDead) {
        let distP2 = Math.hypot((state.p2.x + config.spielerGroesse / 2) - cx, (state.p2.y + config.spielerGroesse / 2) - cy);
        if (distP2 <= bb.radius) {
          Utils.spielerGetroffen(bb, false, 'p2');
        }
      }

      bb.el.remove();
      arrays.bossBombenArray.splice(i, 1);
      continue;
    }

    if (!state.isDead && state.x < bb.x + bb.groesse && state.x + config.spielerGroesse > bb.x && state.y < bb.y + bb.groesse && state.y + config.spielerGroesse > bb.y) {
      Utils.spielerGetroffen(bb, false, 'p1');
      bb.hp = 0;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && state.p2.x < bb.x + bb.groesse && state.p2.x + config.spielerGroesse > bb.x && state.p2.y < bb.y + bb.groesse && state.p2.y + config.spielerGroesse > bb.y) {
      Utils.spielerGetroffen(bb, false, 'p2');
      bb.hp = 0;
    }
  }

  // --- 9.8d BOSS RAKETEN UPDATE ---
  for (let i = arrays.bossRaketenArray.length - 1; i >= 0; i--) {
    let br = arrays.bossRaketenArray[i];
    if (!br) break;
    br.age = (br.age || 0) + 1;

    if (br.age % 8 === 0) {
      Audio.playBossRocketFlight();
    }

    // Homing Richtung näherer lebender Spieler
    let zielX = state.x + config.spielerGroesse / 2;
    let zielY = state.y + config.spielerGroesse / 2;
    if (isCoopMode() && state.p2 && !state.p2.isDead) {
      let distP1 = Math.hypot(state.x - br.x, state.y - br.y);
      let distP2 = Math.hypot(state.p2.x - br.x, state.p2.y - br.y);
      if (state.isDead || distP2 < distP1) {
        zielX = state.p2.x + config.spielerGroesse / 2;
        zielY = state.p2.y + config.spielerGroesse / 2;
      }
    }
    let dx = zielX - (br.x + br.width / 2);
    let dy = zielY - (br.y + br.height / 2);
    let targetAngle = Math.atan2(dy, dx);

    let currentAngle = Math.atan2(br.vy, br.vx);
    let angleDiff = targetAngle - currentAngle;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

    let turnSpeed = br.turnRate || 0.045;
    let newAngle = currentAngle + Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turnSpeed);

    let currentSpeed = br.speed || 2.3;
    br.vx = Math.cos(newAngle) * currentSpeed;
    br.vy = Math.sin(newAngle) * currentSpeed;

    br.x += br.vx;
    br.y += br.vy;
    br.el.style.left = br.x + 'px';
    br.el.style.top = br.y + 'px';
    let rotDeg = Math.atan2(br.vy, br.vx) * 180 / Math.PI + 90;
    br.el.style.transform = `rotate(${rotDeg}deg)`;

    // Partikel-Schweif
    if (Math.random() < 0.4) {
      const pEl = document.createElement('div');
      pEl.classList.add('partikel');
      pEl.style.backgroundColor = Math.random() < 0.6 ? '#e74c3c' : '#f39c12';
      let px = br.x + br.width / 2;
      let py = br.y + br.height;
      pEl.style.left = px + 'px';
      pEl.style.top = py + 'px';
      dom.spielfeld.appendChild(pEl);
      arrays.partikelArray.push({
        el: pEl,
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 0.4,
        vy: 0.5 + Math.random() * 0.5,
        leben: 0.8,
        zerfall: 0.05
      });
    }

    // Wenn vom Spieler zerstört
    if (br.hp <= 0) {
      Utils.addScore(100);
      Audio.playMissileExplosion();
      Utils.erzeugeExplosion(br.x + br.width / 2, br.y + br.height / 2, '#e67e22', 20);
      br.el.remove();
      arrays.bossRaketenArray.splice(i, 1);
      continue;
    }

    // Bildschirm weit verlassen
    if (br.y > config.spielfeldHoehe + 60 || br.x < -80 || br.x > config.spielfeldBreite + 80 || br.y < -100) {
      br.el.remove();
      arrays.bossRaketenArray.splice(i, 1);
      continue;
    }

    // Kollision mit Spieler
    if (!state.isDead && state.x < br.x + br.width && state.x + config.spielerGroesse > br.x && state.y < br.y + br.height && state.y + config.spielerGroesse > br.y) {
      Utils.spielerGetroffen(br, false, 'p1');
      Audio.playMissileExplosion();
      Utils.erzeugeExplosion(br.x + br.width / 2, br.y + br.height / 2, '#e74c3c', 25);
      br.el.remove();
      arrays.bossRaketenArray.splice(i, 1);
      continue;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && state.p2.x < br.x + br.width && state.p2.x + config.spielerGroesse > br.x && state.p2.y < br.y + br.height && state.p2.y + config.spielerGroesse > br.y) {
      Utils.spielerGetroffen(br, false, 'p2');
      Audio.playMissileExplosion();
      Utils.erzeugeExplosion(br.x + br.width / 2, br.y + br.height / 2, '#e74c3c', 25);
      br.el.remove();
      arrays.bossRaketenArray.splice(i, 1);
      continue;
    }
  }

  const alleZiele = [...arrays.asteroiden, ...arrays.feinde, ...arrays.bosses, ...arrays.bossBombenArray, ...arrays.bossRaketenArray];

  // --- 9.9 AUTOLASER ---
  if (state.autolaserTimer > 0) {
    state.autolaserTimer--;
    if (state.autolaserTimer <= 0) {
      state.autolaserAktiv = false;
      Utils.updateAktivePowerupsUI();
    }
  }
  if (state.autolaserAktiv) {
    let target = null;
    let minDist = Infinity;
    let sx = state.x + 15;
    let sy = state.y;
    for (let i = 0; i < alleZiele.length; i++) {
      let z = alleZiele[i];
      if (z.istUnzerstoerbar) continue;
      if (z.y + z.groesse < sy) {
        let tx = z.x + z.groesse / 2;
        let ty = z.y + z.groesse / 2;
        let dist = Math.hypot(tx - sx, ty - sy);
        if (dist < minDist) {
          minDist = dist;
          target = z;
        }
      }
    }
    if (target) {
      if (state.autolaserTimer % 10 === 0) {
        Audio.playAutolaser();
      }
      let tx = target.x + target.groesse / 2;
      let ty = target.y + target.groesse / 2;
      let dx = tx - sx;
      let dy = ty - sy;
      let dist = Math.hypot(dx, dy);
      let angle = Math.atan2(dx, -dy) * 180 / Math.PI;
      dom.autolaserEl.style.display = 'block';
      dom.autolaserEl.style.height = dist + 'px';
      dom.autolaserEl.style.top = sy - dist + 'px';
      dom.autolaserEl.style.left = sx - 2 + 'px';
      dom.autolaserEl.style.transform = `rotate(${angle}deg)`;
      if (!target.istUnzerstoerbar) {
        if ((target.schildHp || 0) > 0) {
          target.schildHp -= 1.5;
          if (target.schildHp <= 0) {
            target.schildHp = 0;
            if (target.schildEl) {
              target.schildEl.remove();
              target.schildEl = null;
            }
          }
        } else {
          target.hp -= 1.5;
          if (target.rissEl) {
            let basisRiss = target.traegtPowerup ? 0.5 : 0;
            let schadenProzent = basisRiss + (1 - basisRiss) * (1 - target.hp / target.maxHp);
            target.rissEl.style.opacity = schadenProzent;
          }
          target.el.style.filter = 'brightness(2.5)';
          setTimeout(() => {
            if (target.el) target.el.style.filter = '';
          }, 50);
          if (target.hp <= 0) Utils.zerstoereZiel(target, 'p1');
        }
      }
    } else {
      dom.autolaserEl.style.display = 'none';
    }
  } else {
    dom.autolaserEl.style.display = 'none';
  }

  // --- 9.12 HITSCAN LASER (Level 5) ---
  const hitscanLaserEl = document.getElementById('hitscan-laser');
  if (laserAktiv && state.laserStufe >= 5) {
    let target = null;
    let closestDist = Infinity;
    let sx = state.x + 15;
    let sy = state.y;
    // Finde tiefstes Ziel direkt über dem Spieler
    for (let i = 0; i < alleZiele.length; i++) {
      let z = alleZiele[i];
      if (z.y + z.groesse < sy && z.x < sx + 10 && z.x + z.groesse > sx - 10) {
        let dist = sy - (z.y + z.groesse);
        if (dist < closestDist) {
          closestDist = dist;
          target = z;
        }
      }
    }
    if (target) {
      hitscanLaserEl.style.display = 'block';
      hitscanLaserEl.style.height = closestDist + 'px';
      hitscanLaserEl.style.top = (sy - closestDist) + 'px';
      hitscanLaserEl.style.left = (sx - 3) + 'px';
      if (!target.istUnzerstoerbar) {
        if ((target.schildHp || 0) > 0) {
          target.schildHp -= 5;
          if (target.schildHp <= 0) {
            target.schildHp = 0;
            if (target.schildEl) {
              target.schildEl.remove();
              target.schildEl = null;
            }
          }
        } else {
          target.hp -= 5;
          if (target.rissEl) {
            let basisRiss = target.traegtPowerup ? 0.5 : 0;
            let schadenProzent = basisRiss + (1 - basisRiss) * (1 - target.hp / target.maxHp);
            target.rissEl.style.opacity = schadenProzent;
          }
          target.el.style.filter = 'brightness(3)';
          setTimeout(() => {
            if (target.el) target.el.style.filter = '';
          }, 50);
          if (target.hp <= 0) Utils.zerstoereZiel(target, 'p1');
        }
      }
    } else {
      hitscanLaserEl.style.display = 'block';
      hitscanLaserEl.style.height = sy + 'px'; // Bis ganz nach oben
      hitscanLaserEl.style.top = '0px';
      hitscanLaserEl.style.left = sx - 3 + 'px';
    }
  } else {
    hitscanLaserEl.style.display = 'none';
  }

  // --- 9.10 MANUELLE LASER (Projektile) ---
  function feuerLaserFuerSpieler(pKey, pState, isFiring) {
    if (!pState || pState.isDead) return;
    if (pState.spielerSchussCooldown > 0) pState.spielerSchussCooldown--;
    if (isFiring && pState.spielerSchussCooldown <= 0) {
      pState.spielerSchussCooldown = 6; // Schussrate
      Audio.playLaser(pState.laserStufe);

      // Schaden pro Projektil (skaliert umgekehrt zur Projektilanzahl, damit Gesamt-DPS kontrolliert wächst)
      let grundSchaden = 16; // 1 Projektil = 160 DPS (Stufe 1)
      if (pState.laserStufe === 2) grundSchaden = 10; // 2 Projektile = 200 DPS
      else if (pState.laserStufe === 3) grundSchaden = 12; // 2 Projektile = 240 DPS
      else if (pState.laserStufe >= 4) grundSchaden = 8; // 4 Projektile = 320 DPS

      let strahlenDef = [];
      const primaryColor = pKey === 'p2' ? '#3498db' : '#00ffff';
      const quadColor = pKey === 'p2' ? '#00d2d3' : '#a000ff';
      if (pState.laserStufe === 1) {
        strahlenDef.push({
          offsetX: 11,
          width: 8,
          vx: 0,
          color: primaryColor
        });
      } else if (pState.laserStufe === 2) {
        strahlenDef.push({
          offsetX: 5,
          width: 4,
          vx: 0,
          color: primaryColor
        });
        strahlenDef.push({
          offsetX: 21,
          width: 4,
          vx: 0,
          color: primaryColor
        });
      } else if (pState.laserStufe >= 3) {
        strahlenDef.push({
          offsetX: 5,
          width: 5,
          vx: 0,
          color: '#ffffff'
        });
        strahlenDef.push({
          offsetX: 20,
          width: 5,
          vx: 0,
          color: '#ffffff'
        });
        if (pState.laserStufe >= 4) {
          strahlenDef.push({
            offsetX: 0,
            width: 4,
            vx: 0,
            color: quadColor
          });
          strahlenDef.push({
            offsetX: 26,
            width: 4,
            vx: 0,
            color: quadColor
          });
        }
      }
      strahlenDef.forEach(st => {
        const el = document.createElement('div');
        el.classList.add('laser-projektil');
        if (pKey === 'p2') el.classList.add('laser-p2');
        el.style.backgroundColor = st.color;
        el.style.boxShadow = `0 0 10px ${st.color}`;
        el.style.width = st.width + 'px';
        el.style.height = '20px';
        el.style.left = pState.x + st.offsetX + 'px';
        el.style.top = pState.y + 'px';

        // Rotiere den Laser leicht, wenn er seitlich fliegt
        if (st.vx !== 0) {
          let winkel = Math.atan2(-15, st.vx) * 180 / Math.PI;
          el.style.transform = `rotate(${winkel + 90}deg)`;
        }
        dom.spielfeld.appendChild(el);
        arrays.laserArray.push({
          el: el,
          x: pState.x + st.offsetX,
          y: pState.y,
          vx: st.vx,
          vy: 15,
          width: st.width,
          height: 20,
          schaden: grundSchaden,
          owner: pKey,
          durchschlag: pState.laserDurchschlag
        });
      });
    }
  }

  feuerLaserFuerSpieler('p1', state, laserAktiv);
  if (isCoopMode() && state.p2) {
    feuerLaserFuerSpieler('p2', state.p2, laserAktivP2);
  }

  // --- 9.10b LASER UPDATE & KOLLISION ---
  for (let i = arrays.laserArray.length - 1; i >= 0; i--) {
    let l = arrays.laserArray[i];
    l.x += l.vx;
    l.y -= l.vy;
    l.el.style.left = l.x + 'px';
    l.el.style.top = l.y + 'px';
    if (l.vx !== 0) {
      let winkel = Math.atan2(-l.vy, l.vx) * 180 / Math.PI;
      l.el.style.transform = `rotate(${winkel + 90}deg)`;
    } else {
      l.el.style.transform = 'rotate(0deg)';
    }
    if (l.y < -30 || l.x < -30 || l.x > config.spielfeldBreite + 30) {
      l.el.remove();
      arrays.laserArray.splice(i, 1);
      continue;
    }

    // Kollision
    let getroffenZiel = null;
    for (let j = 0; j < alleZiele.length; j++) {
      let z = alleZiele[j];
      if (z === l.ignoreTarget) continue; // Ignoriere Ziel nach Abpraller
      if ((z.immune || 0) <= 0) {
        let padding = z.istBoss ? z.groesse * 0.15 : 0;
        if (l.x < z.x + z.groesse - padding && l.x + l.width > z.x + padding && l.y < z.y + z.groesse - padding && l.y + l.height > z.y + padding) {
          getroffenZiel = z;
          break; // Erstes Ziel treffen
        }
      }
    }
    if (getroffenZiel) {
      if (!getroffenZiel.istUnzerstoerbar) {
        if ((getroffenZiel.schildHp || 0) > 0) {
          getroffenZiel.schildHp -= l.schaden;
          if (getroffenZiel.schildHp <= 0) {
            getroffenZiel.schildHp = 0;
            if (getroffenZiel.schildEl) {
              getroffenZiel.schildEl.remove();
              getroffenZiel.schildEl = null;
            }
            for (let k = 0; k < 5; k++) {
              Utils.erzeugeRauchFunken(getroffenZiel.x + 15, getroffenZiel.y + 15, 10);
            }
          }
          getroffenZiel.el.style.filter = 'brightness(2.2)';
          setTimeout(() => {
            if (getroffenZiel.el) getroffenZiel.el.style.filter = '';
          }, 50);
        } else {
          getroffenZiel.hp -= l.schaden;
          if (getroffenZiel.rissEl) {
            let basisRiss = getroffenZiel.traegtPowerup ? 0.5 : 0;
            let schadenProzent = basisRiss + (1 - basisRiss) * (1 - getroffenZiel.hp / getroffenZiel.maxHp);
            getroffenZiel.rissEl.style.opacity = schadenProzent;
          }
          getroffenZiel.el.style.filter = 'brightness(2.5)';
          setTimeout(() => {
            if (getroffenZiel.el) getroffenZiel.el.style.filter = '';
          }, 50);
          if (getroffenZiel.hp <= 0) Utils.zerstoereZiel(getroffenZiel, l.owner || 'p1');
        }
        if (!state.laserDurchschlag) {
          l.el.remove();
          arrays.laserArray.splice(i, 1);
        }
      } else {
        // Abpraller-Logik (Magma-Asteroiden etc.)
        Audio.playHit('magma');
        // Querschläger fliegen nun vorwiegend weiter nach oben, 
        // mit einer leichten bis mittleren Ablenkung nach links oder rechts.
        l.vy = 8 + Math.random() * 7; // vy zwischen 8 und 15 (aufwärts)
        l.vx = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 6); // vx leicht zur Seite (2 bis 8)

        l.isDeflected = true;
        l.ignoreTarget = getroffenZiel; // Verhindert endloses Kollidieren im selben Frame
        l.schaden = Math.max(1, l.schaden / 2); // Schaden wird halbiert
        l.el.style.backgroundColor = '#e67e22'; // Orange/Rötlich einfärben
        l.el.style.boxShadow = `0 0 10px #e67e22`;
      }
    } else if (l.isDeflected) {
      // Kollision mit Spieler, falls abgelenkt
      if (l.x < state.x + config.spielerGroesse && l.x + l.width > state.x && l.y < state.y + config.spielerGroesse && l.y + l.height > state.y) {
        Utils.spielerGetroffen(l, false);
        l.el.remove();
        arrays.laserArray.splice(i, 1);
      }
    }
  }

  // --- 9.13 RAKETEN ---
  function feuerRaketenFuerSpieler(pKey, pState) {
    if (!pState || pState.isDead) return;
    if (pState.raketenCooldown > 0) pState.raketenCooldown--;

    let maxRaketenCd = 180;
    if (pState.raketenStufe >= 2 && pState.raketenStufe <= 3) maxRaketenCd = 150;
    if (pState.raketenStufe >= 4) maxRaketenCd = 120;

    if (pKey === 'p1') {
      const raketenCdBalken = document.getElementById('raketen-cd-balken');
      if (raketenCdBalken) {
        let pctR = Math.max(0, 100 - pState.raketenCooldown / maxRaketenCd * 100);
        raketenCdBalken.style.width = pctR + '%';
        raketenCdBalken.style.backgroundColor = pState.raketenCooldown <= 0 ? '#2ecc71' : '#e74c3c';
      }
      const mobileBtnRaketeCd = document.getElementById('btn-rakete-cd');
      if (mobileBtnRaketeCd) {
        let pctR = Math.max(0, 100 - pState.raketenCooldown / maxRaketenCd * 100);
        mobileBtnRaketeCd.style.height = pctR + '%';
        mobileBtnRaketeCd.style.backgroundColor = pState.raketenCooldown <= 0 ? 'rgba(46, 204, 113, 0.5)' : 'rgba(231, 76, 60, 0.5)';
      }
    } else {
      const raketenCdBalkenP2 = document.getElementById('raketen-cd-balken-p2');
      if (raketenCdBalkenP2) {
        let pctR = Math.max(0, 100 - pState.raketenCooldown / maxRaketenCd * 100);
        raketenCdBalkenP2.style.width = pctR + '%';
        raketenCdBalkenP2.style.backgroundColor = pState.raketenCooldown <= 0 ? '#2ecc71' : '#e74c3c';
      }
    }

    const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
    const isTriggered = pKey === 'p1'
      ? (isDualHumanCoop ? state.tastenGedrueckt.v : (state.tastenGedrueckt.k || state.tastenGedrueckt.v))
      : ((state.network && state.network.isOnline && state.network.isHost)
          ? Boolean(state.p2 && state.p2.networkFireRakete)
          : (state.p2IsBot ? (state.p2.botFireRakete || false) : (state.tastenGedrueckt.ö || state.tastenGedrueckt.numpad2 || state.tastenGedrueckt[','])));

    if (isTriggered && pState.raketenCooldown <= 0) {
      if (pKey === 'p2' && state.p2) state.p2.networkFireRakete = false;
      pState.raketenCooldown = maxRaketenCd;
      Audio.playMissile();
      let rSchaden = 25;
      let rRadius = 80;
      let anzahl = 1;
      if (pState.raketenStufe >= 2) rSchaden = 30;
      if (pState.raketenStufe >= 3) anzahl = 2;
      if (pState.raketenStufe >= 4) {
        rRadius = 100;
        rSchaden = 35;
      }
      if (pState.raketenStufe >= 5) anzahl = 3;

      let shipVx = pState.spielerVx || 0;
      let shipVy = pState.spielerVy || 0;
      let initVy = Math.max(0.5, 2.0 + shipVy * 0.6);

      let offsets = [];
      if (anzahl === 1) {
        const isPhantom = pState.selectedShipModel === 'phantom';
        offsets = [{
          ox: isPhantom ? 29 : -9,
          ejectVx: 0,
          homing: false
        }];
      } else if (anzahl === 2) {
        offsets = [{
          ox: -9,
          ejectVx: 0,
          homing: false
        }, {
          ox: 29,
          ejectVx: 0,
          homing: pState.raketenStufe >= 3
        }];
      } else if (anzahl === 3) {
        offsets = [{
          ox: -9,
          ejectVx: 0,
          homing: true
        }, {
          ox: 10,
          ejectVx: 0,
          homing: false
        }, {
          ox: 29,
          ejectVx: 0,
          homing: true
        }];
      }
      offsets.forEach(off => {
        const el = document.createElement('div');
        el.classList.add('raketen-projektil');
        if (pState.raketenStufe >= 2) el.classList.add('rakete-lvl-2');
        if (off.homing) el.classList.add('rakete-homing');
        if (pKey === 'p2') el.classList.add('rakete-p2');
        el.innerHTML = `
                          <div class="rakete-sensor"></div>
                          <div class="rakete-canards"></div>
                          <div class="rakete-rumpf"></div>
                          <div class="rakete-fluegel"></div>
                          <div class="rakete-feuer"></div>
                      `;
        el.style.left = pState.x + off.ox + 'px';
        el.style.top = pState.y + 'px';
        let vx = off.ejectVx + shipVx * 0.4;
        let winkel = Math.atan2(-initVy, vx) * 180 / Math.PI;
        el.style.transform = `rotate(${winkel + 90}deg)`;
        dom.spielfeld.appendChild(el);
        arrays.raketenArray.push({
          el: el,
          x: pState.x + off.ox,
          y: pState.y,
          vx: vx,
          vy: initVy,
          schaden: rSchaden,
          radius: rRadius,
          homing: off.homing,
          owner: pKey,
          age: 0,
          detoniert: false
        });
      });
    }
  }

  feuerRaketenFuerSpieler('p1', state);
  if (isCoopMode() && state.p2) {
    feuerRaketenFuerSpieler('p2', state.p2);
  }

  // Raketen Update & Kollision (3-Phasen-Flugdynamik, Näherungszünder & Zielsuche)
  for (let i = arrays.raketenArray.length - 1; i >= 0; i--) {
    let r = arrays.raketenArray[i];
    r.age = (r.age || 0) + 1;

    // 3-Phasen-Flugdynamik:
    // Phase 1 (Frames 1-10): Seitliches Lösen / Ausklinken, erbt Schiffsgeschwindigkeit
    if (r.age <= 10) {
      r.x += r.vx;
      r.y -= r.vy;
      r.vx *= 0.95;
    }
    // Phase 2 (Frames 11-18): Kurzes Verlangsamen ("Anlauf nehmen" & Triebwerkszündung)
    else if (r.age <= 18) {
      r.vx *= 0.82;
      r.vy = Math.max(0.3, r.vy * 0.85);
      r.x += r.vx;
      r.y -= r.vy;
    }
    // Phase 3 (Frames 19+): Starke, lineare Beschleunigung (Triebwerks-Vollschub)
    else {
      // Im Co-op (600px Feld) beschleunigen Raketen stärker, um das breitere Feld zu kompensieren
      const rMaxVy = isCoopMode() ? 15 : 13;
      const rAccel = isCoopMode() ? 0.5 : 0.45;
      r.vy = Math.min(rMaxVy, r.vy + rAccel);
      r.vx *= 0.92;

      // Zielsuchende Lenkung (nur gegen Feinde und Bosse) ab Phase 3 aktiv
      if (r.homing) {
        let bestDist = Infinity;
        let target = null;
        const feindZiele = [...arrays.feinde, ...arrays.bosses];
        for (let f of feindZiele) {
          if (!f.istUnzerstoerbar && (f.immune || 0) <= 0) {
            let zcx = f.x + (f.groesse || 20) / 2;
            let zcy = f.y + (f.groesse || 20) / 2;
            let d = Math.hypot(zcx - (r.x + 3), zcy - (r.y + 8));
            // Feinde vor oder auf Höhe der Rakete erfassen
            // Im Co-op (600px) größeren Suchbereich nutzen, damit Feinde am breiten Rand gefunden werden
            const homingYRange = isCoopMode() ? 200 : 140;
            if (d < bestDist && zcy < r.y + homingYRange) {
              bestDist = d;
              target = f;
            }
          }
        }

        if (target) {
          let zcx = target.x + (target.groesse || 20) / 2;
          let zcy = target.y + (target.groesse || 20) / 2;
          let targetAngle = Math.atan2(zcy - (r.y + 8), zcx - (r.x + 3));
          let currentAngle = Math.atan2(-r.vy, r.vx || 0.0001);
          let diff = targetAngle - currentAngle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;

          // Im Co-op stärkere Lenkrate, damit Raketen den größeren horizontalen Abstand ausgleichen können
          let maxTurn = isCoopMode() ? 0.26 : 0.22;
          let newAngle = currentAngle + Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
          let currentSpeed = Math.hypot(r.vx, r.vy) || r.vy;
          r.vx = Math.cos(newAngle) * currentSpeed;
          r.vy = -Math.sin(newAngle) * currentSpeed;
        }
      }

      r.x += r.vx;
      r.y -= r.vy;
    }

    // Raketenausrichtung & DOM-Position aktualisieren
    let flightAngle = Math.atan2(-r.vy, r.vx || 0.0001) * 180 / Math.PI + 90;
    r.el.style.transform = `rotate(${flightAngle}deg)`;
    r.el.style.top = r.y + 'px';
    r.el.style.left = r.x + 'px';

    // Partikelschweif (Rauch beim Ausklinken, Vollfeuer in Phase 3)
    let flameProb = r.age > 18 ? 0.85 : (r.age > 10 ? 0.45 : 0.2);
    if (Math.random() < flameProb) {
      const pEl = document.createElement('div');
      pEl.classList.add('partikel');
      if (r.homing && r.age > 18) {
        pEl.style.backgroundColor = Math.random() < 0.5 ? '#00ffff' : '#3498db';
      } else if (r.age > 18) {
        pEl.style.backgroundColor = Math.random() < 0.6 ? '#f1c40f' : '#e74c3c';
      } else {
        pEl.style.backgroundColor = '#7f8c8d'; // Rauch beim Abwurf
      }
      let px = r.x + 2 + Math.random() * 4;
      let py = r.y + 20;
      pEl.style.left = px + 'px';
      pEl.style.top = py + 'px';
      dom.spielfeld.appendChild(pEl);
      arrays.partikelArray.push({
        el: pEl,
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 0.5,
        vy: 0.5 + Math.random(),
        leben: 1.0,
        zerfall: 0.04
      });
    }

    if (r.y < -40 || r.x < -50 || r.x > config.spielfeldBreite + 50 || r.y > config.spielfeldHoehe + 50) {
      r.el.remove();
      arrays.raketenArray.splice(i, 1);
      continue;
    }

    // Näherungszünder & Direkttreffer prüfen
    let detoniert = false;
    let rcx = r.x + 3;
    let rcy = r.y + 8;

    for (let j = 0; j < alleZiele.length; j++) {
      let z = alleZiele[j];
      if ((z.immune || 0) <= 0) {
        let zcx = z.x + (z.groesse || 20) / 2;
        let zcy = z.y + (z.groesse || 20) / 2;
        let dist = Math.hypot(zcx - rcx, zcy - rcy);
        // Näherungszündung bei Annäherung
        if (dist < (z.groesse || 20) / 2 + 18) {
          detoniert = true;
          break;
        }
      }
    }

    if (detoniert) {
      Utils.erzeugeRaketenDetonation(rcx, rcy, r.radius);
      if (state.gameMode === 'online') {
        Network.sendNetworkEvent({
          type: 'missile_detonated',
          x: rcx,
          y: rcy,
          radius: r.radius
        });
      }

      // Flächenschaden
      for (let j = 0; j < alleZiele.length; j++) {
        let z = alleZiele[j];
        if ((z.immune || 0) <= 0) {
          let zcx = z.x + (z.groesse || 20) / 2;
          let zcy = z.y + (z.groesse || 20) / 2;
          if (Math.hypot(zcx - rcx, zcy - rcy) <= r.radius) {
            if (!z.istUnzerstoerbar) {
              if ((z.schildHp || 0) > 0) {
                z.schildHp -= r.schaden;
                if (z.schildHp <= 0) {
                  z.schildHp = 0;
                  if (z.schildEl) { z.schildEl.remove(); z.schildEl = null; }
                  for (let k = 0; k < 5; k++) Utils.erzeugeRauchFunken(z.x + 15, z.y + 15, 10);
                }
                z.el.style.filter = 'brightness(2.2)';
                setTimeout(() => { if (z.el) z.el.style.filter = ''; }, 50);
              } else {
                z.hp -= r.schaden;
                if (z.rissEl) {
                  let basisRiss = z.traegtPowerup ? 0.5 : 0;
                  let schadenProzent = basisRiss + (1 - basisRiss) * (1 - z.hp / z.maxHp);
                  z.rissEl.style.opacity = schadenProzent;
                }
                z.el.style.filter = 'brightness(2.5)';
                setTimeout(() => {
                  if (z.el) z.el.style.filter = '';
                }, 50);
                if (z.hp <= 0) Utils.zerstoereZiel(z, r.owner || 'p1');
              }
            }
          }
        }
      }
      r.el.remove();
      arrays.raketenArray.splice(i, 1);
    }
  }

  // --- 9.14 BOMBEN ---
  function wirfBombeFuerSpieler(pKey, pState) {
    if (!pState || pState.isDead) return;
    if (pState.bombenCooldown > 0) pState.bombenCooldown--;
    let maxBombenCd = 2400 - pState.bombenStufe * 240; // 40s - 4s per level

    if (pKey === 'p1') {
      const bombenCdBalken = document.getElementById('bomben-cd-balken');
      if (bombenCdBalken) {
        let pctB = Math.max(0, 100 - pState.bombenCooldown / maxBombenCd * 100);
        bombenCdBalken.style.width = pctB + '%';
        bombenCdBalken.style.backgroundColor = pState.bombenCooldown <= 0 ? '#2ecc71' : '#f39c12';
      }
      const mobileBtnBombeCd = document.getElementById('btn-bombe-cd');
      if (mobileBtnBombeCd) {
        let pctB = Math.max(0, 100 - pState.bombenCooldown / maxBombenCd * 100);
        mobileBtnBombeCd.style.height = pctB + '%';
        mobileBtnBombeCd.style.backgroundColor = pState.bombenCooldown <= 0 ? 'rgba(46, 204, 113, 0.5)' : 'rgba(243, 156, 18, 0.5)';
      }
    } else {
      const bombenCdBalkenP2 = document.getElementById('bomben-cd-balken-p2');
      if (bombenCdBalkenP2) {
        let pctB = Math.max(0, 100 - pState.bombenCooldown / maxBombenCd * 100);
        bombenCdBalkenP2.style.width = pctB + '%';
        bombenCdBalkenP2.style.backgroundColor = pState.bombenCooldown <= 0 ? '#2ecc71' : '#f39c12';
      }
    }

    const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
    const isTriggered = pKey === 'p1'
      ? (isDualHumanCoop ? state.tastenGedrueckt.c : (state.tastenGedrueckt[' '] || state.tastenGedrueckt.c))
      : ((state.network && state.network.isOnline && state.network.isHost)
          ? Boolean(state.p2 && state.p2.networkFireBombe)
          : (state.p2IsBot ? (state.p2.botFireBombe || false) : (state.tastenGedrueckt.l || state.tastenGedrueckt.enter || state.tastenGedrueckt.numpad3 || state.tastenGedrueckt.numpad0)));

    if (isTriggered && pState.bombenCooldown <= 0) {
      if (pKey === 'p2' && state.p2) state.p2.networkFireBombe = false;
      pState.bombenCooldown = maxBombenCd;
      Audio.playBomb();
      const el = document.createElement('div');
      el.classList.add('bomben-projektil', `bombe-lvl-${pState.bombenStufe}`);
      if (pKey === 'p2') el.classList.add('bombe-p2');
      el.innerHTML = `
                      <div class="bombe-aura"></div>
                      <div class="bombe-body"></div>
                      <div class="bombe-licht" style="top: 4px;"></div>
                      <div class="bombe-licht" style="top: 13px;"></div>
                      <div class="bombe-licht" style="top: 22px;"></div>
                  `;
      el.style.left = pState.x + 8 + 'px';
      el.style.top = pState.y + 'px';

      // Alle Lichter animieren
      Array.from(el.querySelectorAll('.bombe-licht')).forEach(l => {
        l.style.animation = 'bombeBlink 1s infinite alternate';
      });
      dom.spielfeld.appendChild(el);
      let bSchaden = 100 + pState.bombenStufe * 50;
      let bRadius = 150 + pState.bombenStufe * 50;
      const stufeColors = { 1: '#e74c3c', 2: '#f39c12', 3: '#9b59b6', 4: '#00ffff', 5: '#f1c40f' };
      const stufeSpeeds = { 1: 1.5, 2: 1.8, 3: 2.0, 4: 2.3, 5: 2.6 };
      arrays.bombenArray.push({
        el: el,
        x: pState.x + 8,
        y: pState.y,
        targetX: config.spielfeldBreite / 2 - 7,
        targetY: 285,
        startDist: 0,
        speed: stufeSpeeds[pState.bombenStufe] || 1.5,
        rot: 0,
        schaden: bSchaden,
        radius: bRadius,
        stufe: pState.bombenStufe,
        color: stufeColors[pState.bombenStufe] || '#f39c12',
        owner: pKey,
        isMini: false,
        beepTimer: 999,
        delayFrames: 0
      });
    }
  }

  wirfBombeFuerSpieler('p1', state);
  if (isCoopMode() && state.p2) {
    wirfBombeFuerSpieler('p2', state.p2);
  }
  for (let i = arrays.bombenArray.length - 1; i >= 0; i--) {
    let b = arrays.bombenArray[i];

    // Mini-Bomben können eine Verzögerung haben
    if (b.delayFrames > 0) {
      b.delayFrames--;
    }

    // EMP-Effekt für Level 4 und 5: Löscht gegnerische Laser sofort aus
    if (b.stufe >= 4) {
      for (let l = arrays.feindLaserArray.length - 1; l >= 0; l--) {
        let fl = arrays.feindLaserArray[l];
        Utils.erzeugeExplosion(fl.x, fl.y, b.color, 2);
        fl.el.remove();
        arrays.feindLaserArray.splice(l, 1);
      }
      for (let l = arrays.bossLaserArray.length - 1; l >= 0; l--) {
        let bl = arrays.bossLaserArray[l];
        Utils.erzeugeExplosion(bl.x, bl.y, b.color, 2);
        bl.el.remove();
        arrays.bossLaserArray.splice(l, 1);
      }
    }

    let dx = b.targetX - (b.x + (b.isMini ? 5 : 7));
    let dy = b.targetY - (b.y + (b.isMini ? 10 : 15));
    let dist = Math.hypot(dx, dy);
    if (b.startDist === 0) b.startDist = dist;

    // Stufe 3: Vortex Gravitations-Sog vor der Explosion
    if (b.stufe === 3 && dist < 80) {
      let bcx = b.x + 7;
      let bcy = b.y + 15;
      alleZiele.forEach(z => {
        let zcx = z.x + (z.groesse || 20) / 2;
        let zcy = z.y + (z.groesse || 20) / 2;
        let pullDx = bcx - zcx;
        let pullDy = bcy - zcy;
        let pullDist = Math.hypot(pullDx, pullDy);
        if (pullDist > 5 && pullDist < 160) {
          z.x += (pullDx / pullDist) * 1.5;
          z.y += (pullDy / pullDist) * 1.5;
          z.el.style.left = z.x + 'px';
          z.el.style.top = z.y + 'px';
        }
      });
    }

    if (dist > 5 && (!b.isMini || b.delayFrames > 0)) {
      b.x += dx / dist * b.speed;
      b.y += dy / dist * b.speed;
      b.rot += b.isMini ? 5 : 2;
      b.el.style.left = b.x + 'px';
      b.el.style.top = b.y + 'px';
      b.el.style.transform = `rotate(${b.rot}deg)`;

      // Blink- & Aura-Puls-Geschwindigkeit erhöhen je näher am Ziel
      let progress = dist / (b.startDist || 1);
      let blinkSpeed = Math.max(0.08, progress * 1.0);
      let auraPulseSpeed = Math.max(0.06, progress * 0.8);
      Array.from(b.el.querySelectorAll('.bombe-licht')).forEach(l => {
        l.style.animationDuration = blinkSpeed + 's';
      });
      const aura = b.el.querySelector('.bombe-aura');
      if (aura) {
        aura.style.animationDuration = auraPulseSpeed + 's';
      }

      // Beep-Takt beschleunigen je näher am Ziel
      let urgency = 1.0 - progress;
      b.beepTimer = (b.beepTimer || 0) + 1;
      let beepInterval = Math.max(3, Math.floor(progress * 22));
      if (b.beepTimer >= beepInterval) {
        b.beepTimer = 0;
        Audio.playBombBeep(urgency, false);
      }
    } else {
      // Level 5 Jericho-Split: Hauptbombe teilt sich in 4 Sub-Bomben auf
      if (b.stufe === 5 && !b.isMini) {
        let bcx = b.x + 7;
        let bcy = b.y + 15;
        Utils.erzeugeExplosion(bcx, bcy, '#ffffff', 40);

        // 4 Jericho Mini-Bomben fächern diagonal aus
        const offsets = [
          { ox: -75, oy: -65, delay: 10 },
          { ox: 75, oy: -65, delay: 16 },
          { ox: -75, oy: 65, delay: 22 },
          { ox: 75, oy: 65, delay: 28 }
        ];

        offsets.forEach(off => {
          const miniEl = document.createElement('div');
          miniEl.classList.add('bomben-projektil', 'bombe-mini', 'bombe-lvl-5');
          miniEl.innerHTML = `
            <div class="bombe-aura"></div>
            <div class="bombe-body"></div>
            <div class="bombe-licht" style="top: 3px;"></div>
            <div class="bombe-licht" style="top: 8px;"></div>
            <div class="bombe-licht" style="top: 13px;"></div>
          `;
          miniEl.style.left = bcx - 5 + 'px';
          miniEl.style.top = bcy - 10 + 'px';
          Array.from(miniEl.querySelectorAll('.bombe-licht')).forEach(l => {
            l.style.animation = 'bombeBlink 0.4s infinite alternate';
          });
          dom.spielfeld.appendChild(miniEl);

          arrays.bombenArray.push({
            el: miniEl,
            x: bcx - 5,
            y: bcy - 10,
            targetX: Math.max(20, Math.min(config.spielfeldBreite - 20, bcx + off.ox)),
            targetY: Math.max(20, Math.min(config.spielfeldHoehe - 20, bcy + off.oy)),
            startDist: 0,
            speed: 3.5,
            rot: Math.random() * 360,
            schaden: 220,
            radius: 200,
            stufe: 5,
            color: '#f1c40f',
            isMini: true,
            delayFrames: off.delay
          });
        });

        b.el.remove();
        arrays.bombenArray.splice(i, 1);
        continue;
      }

      // Detonation
      let bcx = b.x + (b.isMini ? 5 : 7);
      let bcy = b.y + (b.isMini ? 10 : 15);
      Utils.erzeugeBombenDetonation(bcx, bcy, b.color || '#f39c12', b.radius, b.stufe, b.isMini);
      if (state.gameMode === 'online') {
        Network.sendNetworkEvent({
          type: 'bomb_detonated',
          x: bcx,
          y: bcy,
          color: b.color || '#f39c12',
          radius: b.radius,
          stufe: b.stufe,
          isMini: b.isMini
        });
      }

      for (let j = 0; j < alleZiele.length; j++) {
        let z = alleZiele[j];
        if ((z.immune || 0) <= 0) {
          let zcx = z.x + z.groesse / 2;
          let zcy = z.y + z.groesse / 2;
          if (Math.hypot(zcx - bcx, zcy - bcy) <= b.radius) {
            if (z.istUnzerstoerbar && z.hp !== undefined && !z.istBoss) {
              // Bomben zerstören Magma-Asteroiden (werden zu Powerup-Trägern)
              z.istUnzerstoerbar = false;
              z.traegtPowerup = true;
              z.el.classList.remove('unzerstoerbar');
              if (!z.rissEl) {
                z.rissEl = document.createElement('div');
                z.rissEl.classList.add('riss-layer');
                z.el.appendChild(z.rissEl);
              }
            }
            if (!z.istUnzerstoerbar) {
              if ((z.schildHp || 0) > 0) {
                z.schildHp = 0;
                if (z.schildEl) {
                  z.schildEl.remove();
                  z.schildEl = null;
                }
              }
              z.hp -= b.schaden;
              if (z.rissEl) {
                let basisRiss = z.traegtPowerup ? 0.5 : 0;
                let schadenProzent = basisRiss + (1 - basisRiss) * (1 - z.hp / z.maxHp);
                z.rissEl.style.opacity = schadenProzent;
              }
              z.el.style.filter = 'brightness(3)';
              setTimeout(() => {
                if (z.el) z.el.style.filter = '';
              }, 50);
              if (z.hp <= 0) Utils.zerstoereZiel(z, b.owner || 'p1');
            }
          }
        }
      }
      b.el.remove();
      arrays.bombenArray.splice(i, 1);
    }
  }

  // --- 9.11 PARTIKEL ANIMIEREN ---
  animierenPartikel();


  // Network Syncing in Online Mode
  if (state.network && state.network.isOnline && state.network.connected) {
    if (state.network.isHost && state.frameZaehler % 2 === 0) {
      Network.sendNetworkState(Network.serializeGameState());
    } else if (state.network.isClient) {
      Network.sendNetworkInput(Network.serializePlayerInput());
    }
  }

  requestAnimationFrame(gameLoop);
}

export function animierenPartikel() {
  for (let i = arrays.partikelArray.length - 1; i >= 0; i--) {
    let p = arrays.partikelArray[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.leben -= p.zerfall;
    if (p.leben <= 0) {
      if (p.el) p.el.remove();
      arrays.partikelArray.splice(i, 1);
    } else {
      if (p.el) {
        p.el.style.left = p.x + 'px';
        p.el.style.top = p.y + 'px';
        p.el.style.opacity = p.leben;
        if (p.vRot) {
          p.rot = (p.rot || 0) + p.vRot;
          p.el.style.transform = `scale(${p.leben}) rotate(${p.rot}deg)`;
        } else {
          p.el.style.transform = `scale(${p.leben})`;
        }
      }
    }
  }
}