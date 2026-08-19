
import { state, dom, config, arrays } from './state.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Input from './input.js';


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

  if (!state.spielLaeuft) {
    const whatsNew = document.getElementById('whats-new-overlay');
    const isWhatsNewOpen = whatsNew && whatsNew.style.display !== 'none';
    if (!isWhatsNewOpen && (state.tastenGedrueckt.w || state.tastenGedrueckt.a || state.tastenGedrueckt.s || state.tastenGedrueckt.d || state.tastenGedrueckt.l || state.tastenGedrueckt.k || state.tastenGedrueckt[' '])) {
      state.spielLaeuft = true;
      let startScreen = document.getElementById('start-screen');
      if (startScreen) startScreen.style.display = 'none';
      Utils.updateMobileControlsVisibility();
      // Verhindere sofortiges Feuern beim Spielstart
      state.tastenGedrueckt[' '] = false;
      state.tastenGedrueckt.k = false;
      state.tastenGedrueckt.l = false;
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

  // --- I-Frames (Unverwundbarkeit Timer) ---
  if (state.invulnerableTimer > 0) {
    state.invulnerableTimer--;
    if (state.invulnerableTimer === 0) {
      dom.spieler.classList.remove('spieler-blink');
    }
  }

  // --- 9.1 SPIELER-BEWEGUNG ---
  let baseFlameScale = 1.0;
  let targetRotate = 0;
  
  if (state.joystick && state.joystick.active) {
    let mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
    if (mag > 0.1) {
      let dirX = state.joystick.x / mag;
      let dirY = state.joystick.y / mag;
      state.x += dirX * config.geschwindigkeit;
      state.y += dirY * config.geschwindigkeit;
    }
    
    if (state.joystick.y < -0.2) baseFlameScale = 1.8;
    else if (state.joystick.y > 0.2) baseFlameScale = 0.4;
    
    if (state.joystick.x < -0.2) targetRotate = -15;
    else if (state.joystick.x > 0.2) targetRotate = 15;
  } else {
    if (state.tastenGedrueckt.w) {
      state.y -= config.geschwindigkeit;
      baseFlameScale = 1.8;
    }
    if (state.tastenGedrueckt.s) {
      state.y += config.geschwindigkeit;
      baseFlameScale = 0.4;
    }
    if (state.tastenGedrueckt.a) {
      state.x -= config.geschwindigkeit;
      targetRotate = -15;
    }
    if (state.tastenGedrueckt.d) {
      state.x += config.geschwindigkeit;
      targetRotate = 15;
    }
  }
  if (state.x < 0) state.x = 0;
  if (state.y < 0) state.y = 0;
  if (state.x > config.spielfeldBreite - config.spielerGroesse) state.x = config.spielfeldBreite - config.spielerGroesse;
  if (state.y > config.spielfeldHoehe - config.spielerGroesse) state.y = config.spielfeldHoehe - config.spielerGroesse;
  dom.spieler.style.left = state.x + 'px';
  dom.spieler.style.top = state.y + 'px';
  let currentRotate = parseFloat(dom.spieler.getAttribute('data-rotate') || 0);
  currentRotate += (targetRotate - currentRotate) * 0.15; // Smooth rotation
  dom.spieler.setAttribute('data-rotate', currentRotate);
  dom.spieler.style.transform = `rotate(${currentRotate}deg)`;
  document.getElementById('flame-left').style.transform = `scaleY(${baseFlameScale})`;
  document.getElementById('flame-right').style.transform = `scaleY(${baseFlameScale})`;
  if (baseFlameScale > 0.5 && Math.random() < (baseFlameScale > 1.0 ? 0.6 : 0.2)) {
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
  if (state.durchschlagTimer > 0) {
    state.durchschlagTimer--;
    if (state.durchschlagTimer <= 0) {
      state.laserDurchschlag = false;
      Utils.updateAktivePowerupsUI();
    }
  }

  // --- 9.2 STERNE ---
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
      dom.warningOverlay.style.display = 'flex';
    }
  }
  if (state.frameZaehler % 60 === 0) Utils.addScore(5);

  // --- 9.4 ENERGIE ---
  if (state.tastenGedrueckt.l) {
    if (!state.laserSchiesst && state.energie >= state.minZuendEnergie) state.laserSchiesst = true;
    if (state.energie <= 0) state.laserSchiesst = false;
  } else {
    state.laserSchiesst = false;
  }
  let laserAktiv = state.laserSchiesst && state.energie > 0;
  if (laserAktiv) {
    if (!state.unbegrenzteEnergie) {
      state.energie -= 0.8 + Math.min(state.laserStufe, 5) * 0.1;
    }
  } else {
    if (state.energie < state.maxEnergie) state.energie += 0.4;
    versteckeAlleLaser();
  }
  if (state.energie < 0) state.energie = 0;
  if (state.energie > state.maxEnergie) state.energie = state.maxEnergie;
  dom.energieBalken.style.width = state.energie / state.absMaxEnergie * 100 + '%';
  if (state.unbegrenzteEnergie) {
    dom.energieBalken.style.backgroundColor = '#f1c40f';
  } else {
    dom.energieBalken.style.backgroundColor = state.energie < state.minZuendEnergie && !state.laserSchiesst ? '#e67e22' : '#1abc9c';
  }

  // --- 9.5 POWERUPS ---
  for (let i = arrays.powerups.length - 1; i >= 0; i--) {
    let p = arrays.powerups[i];
    p.y += p.vy;
    p.el.style.top = p.y + 'px';
    if (p.y > config.spielfeldHoehe) {
      p.el.remove();
      arrays.powerups.splice(i, 1);
      continue;
    }
    if (state.x < p.x + p.groesse && state.x + config.spielerGroesse > p.x && state.y < p.y + p.groesse && state.y + config.spielerGroesse > p.y) {
      if (p.type === 'leben') {
        state.leben++;
        Utils.updateLebenUI();
      } else if (p.type === 'energie') {
        if (state.maxEnergie >= state.absMaxEnergie) {
          state.unbegrenzteEnergie = true;
          dom.maxEnergieMarker.style.display = 'none';
          state.energie = state.absMaxEnergie;
        } else {
          state.maxEnergie = Math.min(state.absMaxEnergie, state.maxEnergie + 10);
          state.energie = state.maxEnergie;
          Utils.updateMaxEnergieMarker();
        }
      } else if (p.type === 'durchschlag') {
        state.laserDurchschlag = true;
        state.durchschlagTimer = 600;
        Utils.updateAktivePowerupsUI();
      } else if (p.type === 'schild') {
        if (state.schildStufe > 0) dom.spieler.classList.remove(`schild-aktiv-${state.schildStufe}`);
        if (state.schildStufe < 3) state.schildStufe++;
        dom.spieler.classList.add(`schild-aktiv-${state.schildStufe}`);
        Utils.updateAktivePowerupsUI();
      } else if (p.type === 'laserWaffe') {
        if (state.laserStufe < 5) {
          state.laserStufe++;
          Utils.updateAktivePowerupsUI();
        }
      } else if (p.type === 'raketenWaffe') {
        if (state.raketenStufe < 5) {
          state.raketenStufe++;
          Utils.updateAktivePowerupsUI();
        }
      } else if (p.type === 'bombenWaffe') {
        if (state.bombenStufe < 5) {
          state.bombenStufe++;
          Utils.updateAktivePowerupsUI();
        }
      } else if (p.type === 'superWaffe') {
        if (state.laserStufe < 5) state.laserStufe++;
        if (state.raketenStufe < 5) state.raketenStufe++;
        if (state.bombenStufe < 5) state.bombenStufe++;
        Utils.updateAktivePowerupsUI();
      } else if (p.type === 'autolaser') {
        state.autolaserAktiv = true;
        state.autolaserTimer = 600;
        Utils.updateAktivePowerupsUI();
      }
      Utils.addScore(50);
      dom.spielfeld.style.backgroundColor = p.farbe;
      setTimeout(() => {
        dom.spielfeld.style.backgroundColor = '#0b1319';
      }, 100);
      p.el.remove();
      arrays.powerups.splice(i, 1);
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
    if (state.x < ast.x + ast.groesse && state.x + config.spielerGroesse > ast.x && state.y < ast.y + ast.groesse && state.y + config.spielerGroesse > ast.y) {
      Utils.spielerGetroffen(ast, true);
      ast.el.remove();
      arrays.asteroiden.splice(i, 1);
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
          // Gezielter Schuss auf den Spieler kurz vor Abflug
          Entities.erzeugeFeindLaser(f.x + f.groesse / 2 - 2, f.y + f.groesse, state.x + config.spielerGroesse / 2, state.y + config.spielerGroesse / 2);
        }
        if (f.stopTimer <= 0) {
          f.phase = 'abflug';
          f.schussTimer = 9999;
        }
      } else if (f.phase === 'abflug') {
        f.y += f.vy * 3.5; // Sehr schneller Abflug
      }
      f.zeit += 0.05;
      f.x = f.basisX + Math.sin(f.zeit) * 20; // Weniger starkes Wackeln im Stop&Go
    } else if (f.muster === 'swoop' || f.muster === 'crossfire') {
      f.x += f.vx;
      f.y += f.vy * 1.5;
      f.el.style.transform = `rotate(${Math.atan2(f.vy * 1.5, f.vx) * 180 / Math.PI - 90}deg)`;
    } else if (f.muster === 'clingOn') {
      if (f.phase === 'attached') {
        let asteroidExists = arrays.asteroiden.includes(f.attachedAsteroid);
        if (!asteroidExists || f.attachedAsteroid.y >= 150) {
          f.phase = 'attack';
          f.vy = 2; // start speed
          f.schussTimer = 9999;
          
          let flames = f.el.querySelectorAll('.feind-flame');
          flames.forEach(fl => fl.style.display = 'block');
          
          Entities.erzeugeFeindLaser(f.x + f.groesse / 2 - 2, f.y + f.groesse, state.x + config.spielerGroesse / 2, state.y + config.spielerGroesse / 2);
        } else {
          f.x = f.attachedAsteroid.x + f.attachedAsteroid.groesse / 2 - f.groesse / 2;
          f.y = f.attachedAsteroid.y + f.attachedAsteroid.groesse / 2 - f.groesse / 2;
        }
      }
      if (f.phase === 'attack') {
        f.vy += 0.1; // accelerate
        f.y += f.vy;
      }
    } else {
      f.zeit += 0.05;
      f.x = f.basisX + Math.sin(f.zeit) * 60;
      f.y += f.vy;
    }
    if (f.muster !== 'swoop' && f.muster !== 'crossfire' && f.muster !== 'clingOn') {
      if (f.x < 0) f.x = 0;
      if (f.x > config.spielfeldBreite - f.groesse) f.x = config.spielfeldBreite - f.groesse;
    }
    f.el.style.left = f.x + 'px';
    f.el.style.top = f.y + 'px';
    if (f.phase !== 'attached') {
      Utils.erzeugeAntriebsRauch(f.x + 13, f.y - 2, -1.5);
    }
    if (f.y > config.spielfeldHoehe || f.x < -100 || f.x > config.spielfeldBreite + 100) {
      f.el.remove();
      arrays.feinde.splice(i, 1);
      continue;
    }
    if (f.muster !== 'stopAndGo' && f.muster !== 'clingOn') {
      f.schussTimer--;
      if (f.schussTimer <= 0) {
        Entities.erzeugeFeindLaser(f.x + f.groesse / 2 - 2, f.y + f.groesse);
        f.schussTimer = Math.random() * 60 + 60;
      }
    }
    if (state.x < f.x + f.groesse && state.x + config.spielerGroesse > f.x && state.y < f.y + f.groesse && state.y + config.spielerGroesse > f.y) {
      Utils.spielerGetroffen(f, true);
      f.el.remove();
      arrays.feinde.splice(i, 1);
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
    if (state.x < fl.x + fl.width && state.x + config.spielerGroesse > fl.x && state.y < fl.y + fl.height && state.y + config.spielerGroesse > fl.y) {
      Utils.spielerGetroffen(fl, false);
      fl.el.remove();
      arrays.feindLaserArray.splice(i, 1);
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
        // Jäger
        let zielX = state.x + config.spielerGroesse / 2 - b.groesse / 2;
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
          // Gezielter Schuss
          let startX = b.x + b.groesse / 2 - 4;
          let startY = b.y + b.groesse;
          let winkel = Math.atan2(state.y - startY, state.x - startX);
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
    }
    b.el.style.left = b.x + 'px';
    b.el.style.top = b.y + 'px';
    let bossPadding = b.groesse * 0.15;
    if (state.x < b.x + b.groesse - bossPadding && state.x + config.spielerGroesse > b.x + bossPadding && state.y < b.y + b.groesse - bossPadding && state.y + config.spielerGroesse > b.y + bossPadding) {
      Utils.spielerGetroffen(b, false);
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
    if (state.x < bl.x + bl.width && state.x + config.spielerGroesse > bl.x && state.y < bl.y + bl.height && state.y + config.spielerGroesse > bl.y) {
      Utils.spielerGetroffen(bl, false);
      bl.el.remove();
      arrays.bossLaserArray.splice(i, 1);
    }
  }
  const alleZiele = [...arrays.asteroiden, ...arrays.feinde, ...arrays.bosses];

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
        if (target.hp <= 0) Utils.zerstoereZiel(target);
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
      hitscanLaserEl.style.top = sy - closestDist + 'px';
      hitscanLaserEl.style.left = sx - 3 + 'px';
      if (!target.istUnzerstoerbar) {
        target.hp -= 2.5; // Starker konstanter Schaden
        if (target.rissEl) {
          let basisRiss = target.traegtPowerup ? 0.5 : 0;
          let schadenProzent = basisRiss + (1 - basisRiss) * (1 - target.hp / target.maxHp);
          target.rissEl.style.opacity = schadenProzent;
        }
        target.el.style.filter = 'brightness(2.5)';
        setTimeout(() => {
          if (target.el) target.el.style.filter = '';
        }, 50);
        if (target.hp <= 0) Utils.zerstoereZiel(target);
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
  if (state.spielerSchussCooldown > 0) state.spielerSchussCooldown--;
  if (laserAktiv && state.spielerSchussCooldown <= 0) {
    state.spielerSchussCooldown = 6; // Schussrate

    // Schaden pro Projektil (skaliert umgekehrt zur Projektilanzahl, damit Gesamt-DPS kontrolliert wächst)
    let grundSchaden = 16; // 1 Projektil = 160 DPS (Stufe 1)
    if (state.laserStufe === 2) grundSchaden = 10; // 2 Projektile = 200 DPS
    else if (state.laserStufe === 3) grundSchaden = 12; // 2 Projektile = 240 DPS
    else if (state.laserStufe >= 4) grundSchaden = 8; // 4 Projektile = 320 DPS

    let strahlenDef = [];
    if (state.laserStufe === 1) {
      strahlenDef.push({
        offsetX: 11,
        width: 8,
        vx: 0,
        color: '#00ffff'
      });
    } else if (state.laserStufe === 2) {
      strahlenDef.push({
        offsetX: 5,
        width: 4,
        vx: 0,
        color: '#00ffff'
      });
      strahlenDef.push({
        offsetX: 21,
        width: 4,
        vx: 0,
        color: '#00ffff'
      });
    } else if (state.laserStufe >= 3) {
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
      if (state.laserStufe >= 4) {
        strahlenDef.push({
          offsetX: -5,
          width: 4,
          vx: -2,
          color: '#a000ff'
        });
        strahlenDef.push({
          offsetX: 31,
          width: 4,
          vx: 2,
          color: '#a000ff'
        });
      }
    }
    strahlenDef.forEach(st => {
      const el = document.createElement('div');
      el.classList.add('laser-projektil');
      el.style.backgroundColor = st.color;
      el.style.boxShadow = `0 0 10px ${st.color}`;
      el.style.width = st.width + 'px';
      el.style.height = '20px';
      el.style.left = state.x + st.offsetX + 'px';
      el.style.top = state.y + 'px';

      // Rotiere den Laser leicht, wenn er seitlich fliegt
      if (st.vx !== 0) {
        let winkel = Math.atan2(-15, st.vx) * 180 / Math.PI;
        el.style.transform = `rotate(${winkel + 90}deg)`;
      }
      dom.spielfeld.appendChild(el);
      arrays.laserArray.push({
        el: el,
        x: state.x + st.offsetX,
        y: state.y,
        vx: st.vx,
        vy: 15,
        width: st.width,
        height: 20,
        schaden: grundSchaden
      });
    });
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
        if (getroffenZiel.hp <= 0) Utils.zerstoereZiel(getroffenZiel);
        if (!state.laserDurchschlag) {
          l.el.remove();
          arrays.laserArray.splice(i, 1);
        }
      } else {
        // Abpraller-Logik (Magma-Asteroiden etc.)
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
  if (state.raketenCooldown > 0) state.raketenCooldown--;

  // Cooldown-Anzeige Update
  let maxRaketenCd = 180;
  if (state.raketenStufe >= 2 && state.raketenStufe <= 3) maxRaketenCd = 150;
  if (state.raketenStufe >= 4) maxRaketenCd = 120;
  const raketenCdBalken = document.getElementById('raketen-cd-balken');
  let pctR = Math.max(0, 100 - state.raketenCooldown / maxRaketenCd * 100);
  raketenCdBalken.style.width = pctR + '%';
  raketenCdBalken.style.backgroundColor = state.raketenCooldown <= 0 ? '#2ecc71' : '#e74c3c';
  
  const mobileBtnRaketeCd = document.getElementById('btn-rakete-cd');
  if (mobileBtnRaketeCd) {
    mobileBtnRaketeCd.style.height = pctR + '%';
    mobileBtnRaketeCd.style.backgroundColor = state.raketenCooldown <= 0 ? 'rgba(46, 204, 113, 0.5)' : 'rgba(231, 76, 60, 0.5)';
  }
  if (state.tastenGedrueckt.k && state.raketenCooldown <= 0) {
    state.raketenCooldown = maxRaketenCd;
    let rSchaden = 25;
    let rRadius = 80;
    let anzahl = 1;
    if (state.raketenStufe >= 2) rSchaden = 30;
    if (state.raketenStufe >= 3) anzahl = 2;
    if (state.raketenStufe >= 4) {
      rRadius = 100;
      rSchaden = 35;
    }
    if (state.raketenStufe >= 5) anzahl = 3;
    let offsets = [{
      ox: 10,
      vy: 8,
      vx: 0
    }];
    if (anzahl === 2) {
      offsets = [{
        ox: 2,
        vy: 8,
        vx: 0
      }, {
        ox: 18,
        vy: 8,
        vx: 0
      }];
    } else if (anzahl === 3) {
      offsets = [{
        ox: 10,
        vy: 8,
        vx: 0
      }, {
        ox: -2,
        vy: 8,
        vx: -1.5
      }, {
        ox: 22,
        vy: 8,
        vx: 1.5
      }];
    }
    offsets.forEach(off => {
      const el = document.createElement('div');
      el.classList.add('raketen-projektil');
      el.innerHTML = `
                        <div class="rakete-sensor"></div>
                        <div class="rakete-rumpf"></div>
                        <div class="rakete-fluegel"></div>
                        <div class="rakete-feuer"></div>
                    `;
      el.style.left = state.x + off.ox + 'px';
      el.style.top = state.y + 'px';
      if (off.vx !== 0) {
        let winkel = Math.atan2(-off.vy, off.vx) * 180 / Math.PI;
        el.style.transform = `rotate(${winkel + 90}deg)`;
      }
      dom.spielfeld.appendChild(el);
      arrays.raketenArray.push({
        el: el,
        x: state.x + off.ox,
        y: state.y,
        vx: off.vx,
        vy: off.vy,
        schaden: rSchaden,
        radius: rRadius,
        detoniert: false
      });
    });
  }

  // Raketen Update & Kollision (Näherungszünder)
  for (let i = arrays.raketenArray.length - 1; i >= 0; i--) {
    let r = arrays.raketenArray[i];
    r.y -= r.vy;
    if (r.vx) r.x += r.vx;
    r.el.style.top = r.y + 'px';
    if (r.vx) r.el.style.left = r.x + 'px';

    // Partikelschweif (Rauch und Feuer)
    if (Math.random() < 0.7) {
      const pEl = document.createElement('div');
      pEl.classList.add('partikel');
      pEl.style.backgroundColor = Math.random() < 0.4 ? '#f39c12' : '#7f8c8d'; // Feuer oder Rauch
      let px = r.x + 3 + Math.random() * 4; // Mitte der Rakete (Breite 10)
      let py = r.y + 24; // Unten an der Rakete
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
    if (r.y < -30) {
      r.el.remove();
      arrays.raketenArray.splice(i, 1);
      continue;
    }

    // Näherungszünder prüfen
    let zielGefunden = false;
    for (let j = 0; j < alleZiele.length; j++) {
      let z = alleZiele[j];
      if ((z.immune || 0) <= 0) {
        let zcx = z.x + z.groesse / 2;
        let zcy = z.y + z.groesse / 2;
        let rcx = r.x + 3; // 3 ist halbe Breite der Rakete
        let rcy = r.y + 9; // 9 ist halbe Höhe
        let dist = Math.hypot(zcx - rcx, zcy - rcy);
        if (dist < 50) {
          // Zündradius
          zielGefunden = true;
          break;
        }
      }
    }
    if (zielGefunden) {
      r.detoniert = true;
      // Explosion auslösen
      let rcx = r.x + 3;
      let rcy = r.y + 9;
      Utils.erzeugeExplosion(rcx, rcy, '#e74c3c', 30); // Rote Partikel

      // Visuelle Schockwelle
      const shockwave = document.createElement('div');
      shockwave.style.position = 'absolute';
      shockwave.style.width = r.radius * 2 + 'px';
      shockwave.style.height = r.radius * 2 + 'px';
      shockwave.style.left = rcx - r.radius + 'px';
      shockwave.style.top = rcy - r.radius + 'px';
      shockwave.style.borderRadius = '50%';
      shockwave.style.backgroundColor = 'rgba(231, 76, 60, 0.5)';
      shockwave.style.boxShadow = '0 0 20px #e74c3c';
      shockwave.style.zIndex = '9';
      shockwave.style.pointerEvents = 'none';
      shockwave.style.transition = 'all 0.3s ease-out';
      dom.spielfeld.appendChild(shockwave);

      // Schockwelle animieren und entfernen
      setTimeout(() => {
        shockwave.style.opacity = '0';
        shockwave.style.transform = 'scale(1.2)';
      }, 10);
      setTimeout(() => {
        shockwave.remove();
      }, 300);

      // Flächenschaden
      for (let j = 0; j < alleZiele.length; j++) {
        let z = alleZiele[j];
        if ((z.immune || 0) <= 0) {
          let zcx = z.x + z.groesse / 2;
          let zcy = z.y + z.groesse / 2;
          let dist = Math.hypot(zcx - rcx, zcy - rcy);
          if (dist <= r.radius) {
            if (!z.istUnzerstoerbar) {
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
              if (z.hp <= 0) Utils.zerstoereZiel(z);
            }
          }
        }
      }
      r.el.remove();
      arrays.raketenArray.splice(i, 1);
    }
  }
  // --- 9.14 BOMBEN ---
  if (state.bombenCooldown > 0) state.bombenCooldown--;
  let maxBombenCd = 2400 - state.bombenStufe * 240; // 40s - 4s per level

  const bombenCdBalken = document.getElementById('bomben-cd-balken');
  let pctB = Math.max(0, 100 - state.bombenCooldown / maxBombenCd * 100);
  bombenCdBalken.style.width = pctB + '%';
  bombenCdBalken.style.backgroundColor = state.bombenCooldown <= 0 ? '#2ecc71' : '#f39c12';
  
  const mobileBtnBombeCd = document.getElementById('btn-bombe-cd');
  if (mobileBtnBombeCd) {
    mobileBtnBombeCd.style.height = pctB + '%';
    mobileBtnBombeCd.style.backgroundColor = state.bombenCooldown <= 0 ? 'rgba(46, 204, 113, 0.5)' : 'rgba(243, 156, 18, 0.5)';
  }
  if (state.tastenGedrueckt[' '] && state.bombenCooldown <= 0) {
    state.bombenCooldown = maxBombenCd;
    const el = document.createElement('div');
    el.classList.add('bomben-projektil', `bombe-lvl-${state.bombenStufe}`);
    el.innerHTML = `
                    <div class="bombe-aura"></div>
                    <div class="bombe-body"></div>
                    <div class="bombe-licht" style="top: 4px;"></div>
                    <div class="bombe-licht" style="top: 13px;"></div>
                    <div class="bombe-licht" style="top: 22px;"></div>
                `;
    el.style.left = state.x + 8 + 'px'; // Mittig aus dem Schiff
    el.style.top = state.y + 'px';

    // Alle Lichter animieren
    Array.from(el.querySelectorAll('.bombe-licht')).forEach(l => {
      l.style.animation = 'bombeBlink 1s infinite alternate';
    });
    dom.spielfeld.appendChild(el);
    let bSchaden = 100 + state.bombenStufe * 50;
    let bRadius = 150 + state.bombenStufe * 50;
    const stufeColors = { 1: '#e74c3c', 2: '#f39c12', 3: '#9b59b6', 4: '#00ffff', 5: '#f1c40f' };
    const stufeSpeeds = { 1: 1.5, 2: 1.8, 3: 2.0, 4: 2.3, 5: 2.6 };
    arrays.bombenArray.push({
      el: el,
      x: state.x + 8,
      y: state.y,
      targetX: 193,
      targetY: 285,
      startDist: 0,
      speed: stufeSpeeds[state.bombenStufe] || 1.5,
      rot: 0,
      schaden: bSchaden,
      radius: bRadius,
      stufe: state.bombenStufe,
      color: stufeColors[state.bombenStufe] || '#f39c12',
      isMini: false,
      delayFrames: 0
    });
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
      Utils.erzeugeExplosion(bcx, bcy, b.color || '#f39c12', b.isMini ? 35 : 60);
      const shockwave = document.createElement('div');
      shockwave.style.position = 'absolute';
      shockwave.style.width = b.radius * 2 + 'px';
      shockwave.style.height = b.radius * 2 + 'px';
      shockwave.style.left = bcx - b.radius + 'px';
      shockwave.style.top = bcy - b.radius + 'px';
      shockwave.style.borderRadius = '50%';
      shockwave.style.backgroundColor = b.color === '#00ffff' ? 'rgba(0, 255, 255, 0.4)' : (b.color === '#9b59b6' ? 'rgba(155, 89, 182, 0.4)' : (b.color === '#f1c40f' ? 'rgba(241, 196, 15, 0.45)' : 'rgba(231, 76, 60, 0.4)'));
      shockwave.style.boxShadow = `0 0 45px ${b.color || '#f39c12'}`;
      shockwave.style.zIndex = '9';
      shockwave.style.pointerEvents = 'none';
      shockwave.style.transition = 'all 0.5s ease-out';
      dom.spielfeld.appendChild(shockwave);
      setTimeout(() => {
        shockwave.style.opacity = '0';
        shockwave.style.transform = 'scale(1.2)';
      }, 10);
      setTimeout(() => {
        shockwave.remove();
      }, 500);

      // Stufe 3 Vortex: Zweite Schockwelle leicht verzögert
      if (b.stufe === 3 && !b.isMini) {
        setTimeout(() => {
          const sw2 = document.createElement('div');
          sw2.style.position = 'absolute';
          sw2.style.width = (b.radius * 1.5) + 'px';
          sw2.style.height = (b.radius * 1.5) + 'px';
          sw2.style.left = bcx - (b.radius * 0.75) + 'px';
          sw2.style.top = bcy - (b.radius * 0.75) + 'px';
          sw2.style.borderRadius = '50%';
          sw2.style.backgroundColor = 'rgba(155, 89, 182, 0.3)';
          sw2.style.boxShadow = '0 0 30px #9b59b6';
          sw2.style.zIndex = '9';
          sw2.style.pointerEvents = 'none';
          sw2.style.transition = 'all 0.4s ease-out';
          dom.spielfeld.appendChild(sw2);
          setTimeout(() => {
            sw2.style.opacity = '0';
            sw2.style.transform = 'scale(1.3)';
          }, 10);
          setTimeout(() => sw2.remove(), 400);
        }, 150);
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
              if (z.hp <= 0) Utils.zerstoereZiel(z);
            }
          }
        }
      }
      b.el.remove();
      arrays.bombenArray.splice(i, 1);
    }
  }

  // --- 9.11 PARTIKEL ANIMIEREN ---
  for (let i = arrays.partikelArray.length - 1; i >= 0; i--) {
    let p = arrays.partikelArray[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.leben -= p.zerfall;
    if (p.leben <= 0) {
      p.el.remove();
      arrays.partikelArray.splice(i, 1);
    } else {
      p.el.style.left = p.x + 'px';
      p.el.style.top = p.y + 'px';
      p.el.style.opacity = p.leben;
      p.el.style.transform = `scale(${p.leben})`;
    }
  }
  requestAnimationFrame(gameLoop);
}