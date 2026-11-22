import { state, dom, config, arrays } from './state.js';
import * as Utils from './utils.js';
import * as Cutscene from './cutscene.js';
import * as Network from './network.js';
import * as Hack from './hack.js';
import * as Viper from './viper.js';
import * as Display from './display.js';
import { animateParticles } from './particles.js';
import { updateEffects } from './effects.js';
import {
  manageEnemySpawns,
  updateAsteroids,
  updateEnemies,
  updateEnemyLaser,
  updateHackProjectiles,
} from './opponents.js';
import { updateBosses, updateBossBombs, updateBossMissiles } from './boss.js';
import { updatePowerups } from './powerups.js';
import { updateInvulnerability, movePlayer, updateEnergy, regenerateShield } from './player.js';
import { updateWeapons } from './weapons.js';
import { clientStep } from './client.js';
import { checkPause } from './pause.js';
import { levelStep, startBoss } from './level.js';
import { updateRock } from './rock.js';
import { updateShockwaves } from './shockwave.js';

// Existing exports stay reachable via loop.js
export { manageEnemySpawns, animateParticles };

// Counts the steps in which the world moves. The net encoding uses it to
// predict projectile positions (dead reckoning); during the boss warning the world stands still.
let worldStep = 0;

function sendHostSnapshot() {
  if (state.network && state.network.isOnline && state.network.isHost && state.network.connected) {
    Network.sendNetworkState(Network.serializeGameState(), worldStep);
  }
}

// Stars fall and reappear at the top (all game phases, also on the online client)
export function moveStars() {
  arrays.stars.forEach(star => {
    star.y += star.speed;
    if (star.y > config.playfieldHeight) {
      star.y = -5;
      star.x = Math.random() * config.playfieldWidth;
    }
  });
}

// One fixed step: simulation first, then the display of the world (display.js)
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
      // Before the start only the stars move
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
    // Send during the warning too, so the client is sure to see it (and the boss afterwards)
    if (state.bossWarningTimer % 2 === 0) sendHostSnapshot();
    return;
  }
  if (state.gameOverActive) {
    // Only stars keep flying
    moveStars();
    return;
  }

  // --- ONLINE CLIENT LOCAL CONTROL & RENDERING ---
  if (state.network && state.network.isClient && state.network.connected) {
    clientStep();
    return;
  }

  worldStep++;

  // --- I-frames (invulnerability timer) ---
  updateInvulnerability();

  // --- 9.1 PLAYER 1 & 2 MOVEMENT ---
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

  // --- 9.2 STAR MOVEMENT & PARTICLES ---
  moveStars();

  // --- 9.3 SPAWNS & BOSS WARNING per level plan (level.js) ---
  levelStep();
  updateRock();

  // --- 9.3 LEVEL TEXT TIMER & SCORE ---
  if (state.levelTextTimer > 0) {
    state.levelTextTimer--;
    if (state.levelTextTimer === 0) dom.levelDisplayMiddle.style.display = 'none';
  }
  if (state.frameCounter % 60 === 0) Utils.addScore(5);

  // --- 9.4 ENERGY PLAYER 1 & 2 ---
  const { laserActive, laserActiveP2 } = updateEnergy();

  // --- 9.4b SHIELD REGENERATION (Phantom-NX) ---
  regenerateShield();

  // --- 9.5 POWERUPS ---
  updatePowerups();

  // --- 9.6 ASTEROIDS ---
  updateAsteroids();

  // --- 9.7 ENEMIES ---
  updateEnemies();

  // --- 9.8 ENEMY LASERS ---
  updateEnemyLaser();

  // --- 9.8b HACK PROJECTILES ---
  updateHackProjectiles();

  // --- BOSS LOGIC ---
  updateBosses();

  // --- 9.8c BOSS BOMB UPDATE ---
  updateBossBombs();

  // --- 9.8d BOSS MISSILE UPDATE ---
  updateBossMissiles();

  // --- 9.8e VIPER NEAR MISS (after all projectile movements and hits) ---
  Viper.checkNearMiss();

  // --- 9.9 - 9.14 WEAPONS (autolaser, hitscan, laser, missiles, bombs) ---
  updateWeapons(laserActive, laserActiveP2);

  // --- 9.11 ANIMATE PARTICLES ---
  animateParticles();
  updateShockwaves();
  updateEffects();

  // Network syncing in online mode (the client sends its inputs in clientStep)
  if (state.frameCounter % 2 === 0) sendHostSnapshot();
}

// --- FIXED SIMULATION STEPS (60 Hz, independent of the monitor frame rate) ---
export const STEP_MS = 1000 / 60;
export const MAX_STEPS_PER_FRAME = 5;

// How many fixed simulation steps are due for the elapsed time
export function computeSteps(accountMs, deltaMs) {
  const delta = typeof deltaMs === 'number' && deltaMs > 0 ? deltaMs : 0;
  const account = typeof accountMs === 'number' && accountMs > 0 ? accountMs : 0;
  let newAccount = account + delta;
  const steps = Math.floor(newAccount / STEP_MS);
  if (steps > MAX_STEPS_PER_FRAME) {
    // Drop a backlog (e.g. after a tab switch) instead of fast-forwarding
    return { steps: MAX_STEPS_PER_FRAME, accountMs: 0 };
  }
  newAccount -= steps * STEP_MS;
  return { steps, accountMs: newAccount };
}

let lastTimestamp = null;
let timeAccountMs = 0;

export function gameLoop(timestamp) {
  if (lastTimestamp === null || typeof timestamp !== 'number') {
    // First call: exactly one step
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
