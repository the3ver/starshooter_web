import { state, dom, config, arrays } from './state.js';
import * as Utils from './utils.js';
import * as Cutscene from './cutscene.js';
import * as Network from './network.js';
import * as Hack from './hack.js';
import * as Viper from './viper.js';
import * as Display from './anzeige.js';
import { animateParticles } from './partikel.js';
import { updateEffects } from './effekte.js';
import {
  manageEnemySpawns,
  updateAsteroids,
  updateEnemies,
  updateEnemyLaser,
  updateHackProjectiles,
} from './gegner.js';
import { updateBosses, updateBossBombs, updateBossMissiles } from './boss.js';
import { updatePowerups } from './powerups.js';
import { updateInvulnerability, movePlayer, updateEnergy, regenerateShield } from './spieler.js';
import { updateWeapons } from './waffen.js';
import { clientStep } from './client.js';
import { checkPause } from './pause.js';
import { levelStep, startBoss } from './level.js';
import { updateRock } from './fels.js';
import { updateShockwaves } from './schockwelle.js';

// Bestehende Exporte bleiben ueber loop.js erreichbar
export { manageEnemySpawns, animateParticles };

// Zaehlt die Schritte, in denen sich die Welt bewegt. Die Netzkodierung sagt damit
// Projektilpositionen voraus (Dead Reckoning); in der Boss-Warnung steht die Welt still.
let worldStep = 0;

function sendHostSnapshot() {
  if (state.network && state.network.isOnline && state.network.isHost && state.network.connected) {
    Network.sendNetworkState(Network.serializeGameState(), worldStep);
  }
}

// Sterne fallen und erscheinen oben neu (alle Spielphasen, auch auf dem Online-Client)
export function moveStars() {
  arrays.stars.forEach(star => {
    star.y += star.speed;
    if (star.y > config.playfieldHeight) {
      star.y = -5;
      star.x = Math.random() * config.playfieldWidth;
    }
  });
}

// Ein fester Schritt: erst die Simulation, dann die Anzeige der Welt (anzeige.js)
export function simulationStep() {
  simulate();
  Display.drawWorld();
}

function simulate() {
  if (state.paused) {
    checkPause();
    return;
  }

  if (state.cutsceneActive) {
    return;
  }

  if (!state.gameRunning) {
    const whatsNew = document.getElementById('whats-new-overlay');
    const controlsOpen = document.getElementById('steuerung-overlay');
    const isWhatsNewOpen =
      (whatsNew && whatsNew.style.display !== 'none') || (controlsOpen && controlsOpen.style.display !== 'none');
    const keys = state.keysPressed;
    const startKeyPressed =
      keys.w ||
      keys.a ||
      keys.s ||
      keys.d ||
      keys.l ||
      keys.k ||
      keys[' '] ||
      keys.b ||
      keys.v ||
      keys.c ||
      keys.ä ||
      keys.ö ||
      keys.arrowup ||
      keys.arrowdown ||
      keys.arrowleft ||
      keys.arrowright;
    if (!isWhatsNewOpen && startKeyPressed) {
      if (state.gameMode === 'online') {
        if (state.network && state.network.isHost && state.network.connected) {
          Network.hostStartGame();
          return;
        }
      } else {
        let startScreen = document.getElementById('start-screen');
        if (startScreen) startScreen.style.display = 'none';
        Cutscene.startCutscene();
        return;
      }
    } else {
      // Vor dem Start bewegen sich nur die Sterne
      moveStars();
      return;
    }
  }

  if (state.bossWarningActive) {
    state.bossWarningTimer--;
    if (state.bossWarningTimer <= 0) {
      state.bossWarningActive = false;
      dom.warningOverlay.style.display = 'none';
      startBoss();
    }
    moveStars();
    // Auch waehrend der Warnung senden, damit der Client sie sicher sieht (und danach den Boss)
    if (state.bossWarningTimer % 2 === 0) sendHostSnapshot();
    return;
  }
  if (state.gameOverActive) {
    // Nur Sterne fliegen weiter
    moveStars();
    return;
  }

  // --- ONLINE CLIENT LOKALE STEUERUNG & RENDERING ---
  if (state.network && state.network.isClient && state.network.connected) {
    clientStep();
    return;
  }

  worldStep++;

  // --- I-Frames (Unverwundbarkeit Timer) ---
  updateInvulnerability();

  // --- 9.1 SPIELER 1 & 2 BEWEGUNG ---
  movePlayer();
  if (state.pierceTimer > 0) {
    state.pierceTimer--;
    if (state.pierceTimer <= 0) {
      state.laserPierce = false;
      Utils.updateActivePowerupsUi();
    }
  }

  Hack.tickHacks(state);
  if (state.p2) Hack.tickHacks(state.p2);
  Hack.showHackStatus();

  // --- 9.2 STERNE BEWEGUNG & SPARTIKEL ---
  moveStars();

  // --- 9.3 SPAWNS & BOSS-WARNUNG nach Levelplan (level.js) ---
  levelStep();
  updateRock();

  // --- 9.3 LEVEL TEXT TIMER & SCORE ---
  if (state.levelTextTimer > 0) {
    state.levelTextTimer--;
    if (state.levelTextTimer === 0) dom.levelDisplayMiddle.style.display = 'none';
  }
  if (state.frameCounter % 60 === 0) Utils.addScore(5);

  // --- 9.4 ENERGIE SPIELER 1 & 2 ---
  const { laserActive, laserActiveP2 } = updateEnergy();

  // --- 9.4b SCHILD REGENERATION (Phantom-NX) ---
  regenerateShield();

  // --- 9.5 POWERUPS ---
  updatePowerups();

  // --- 9.6 ASTEROIDEN ---
  updateAsteroids();

  // --- 9.7 FEINDE ---
  updateEnemies();

  // --- 9.8 FEIND-LASER ---
  updateEnemyLaser();

  // --- 9.8b HACK-PROJEKTILE ---
  updateHackProjectiles();

  // --- BOSS LOGIK ---
  updateBosses();

  // --- 9.8c BOSS BOMBEN UPDATE ---
  updateBossBombs();

  // --- 9.8d BOSS RAKETEN UPDATE ---
  updateBossMissiles();

  // --- 9.8e VIPER NEAR-MISS (nach allen Geschoss-Bewegungen und Treffern) ---
  Viper.checkNearMiss();

  // --- 9.9 - 9.14 WAFFEN (Autolaser, Hitscan, Laser, Raketen, Bomben) ---
  updateWeapons(laserActive, laserActiveP2);

  // --- 9.11 PARTIKEL ANIMIEREN ---
  animateParticles();
  updateShockwaves();
  updateEffects();

  // Network Syncing in Online Mode (der Client sendet seine Eingaben in clientSchritt)
  if (state.frameCounter % 2 === 0) sendHostSnapshot();
}

// --- FESTE SIMULATIONSSCHRITTE (60 Hz, unabhaengig von der Monitor-Bildrate) ---
export const STEP_MS = 1000 / 60;
export const MAX_STEPS_PRO_FRAME = 5;

// Wie viele feste Simulationsschritte fuer die vergangene Zeit faellig sind
export function computeSteps(accountMs, deltaMs) {
  const delta = typeof deltaMs === 'number' && deltaMs > 0 ? deltaMs : 0;
  const account = typeof accountMs === 'number' && accountMs > 0 ? accountMs : 0;
  let newAccount = account + delta;
  const steps = Math.floor(newAccount / STEP_MS);
  if (steps > MAX_STEPS_PRO_FRAME) {
    // Rueckstand (z.B. nach Tab-Wechsel) verwerfen statt vorzuspulen
    return { steps: MAX_STEPS_PRO_FRAME, accountMs: 0 };
  }
  newAccount -= steps * STEP_MS;
  return { steps, accountMs: newAccount };
}

let lastTimestamp = null;
let timeAccountMs = 0;

export function gameLoop(timestamp) {
  if (lastTimestamp === null || typeof timestamp !== 'number') {
    // Erster Aufruf: genau ein Schritt
    simulationStep();
  } else {
    const result = computeSteps(timeAccountMs, timestamp - lastTimestamp);
    timeAccountMs = result.accountMs;
    for (let i = 0; i < result.steps; i++) {
      simulationStep();
    }
  }
  if (typeof timestamp === 'number') lastTimestamp = timestamp;
  requestAnimationFrame(gameLoop);
}
