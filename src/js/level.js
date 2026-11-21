import { state, dom } from './state.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import { manageEnemySpawns } from './opponents.js';
import * as Rock from './rock.js';
import * as Growths from './growths.js';
import * as Display from './display.js';
import * as IslandBoss from './island-boss.js';
import { manageBioSpawns } from './bio-creatures.js';

// Flow of a level: asteroid cadence in three phases, enemies from enemyStart on at cadence enemyRate,
// boss warning at bossFrame. levelPlan(level) returns the values; new level kinds get their plan here.
export const LEVEL_DURATION = 3600; // 60 s at 60 Hz
export const ROCK_RUNOUT = 900; // this many steps before the boss the rock walls run out

// Rock levels: every second level from level 4 on
export function isRockLevel(level) {
  return level >= 4 && level % 2 === 0;
}

// Opponent spawner per level kind (plan field spawner)
const SPAWNER = { standard: manageEnemySpawns, bio: manageBioSpawns };

// Rock levels (biozone): own opponent mix of chains and creatures, earlier start, half as many asteroids
export const BIO_ENEMY_START = 300;

export function levelPlan(level) {
  const tier = level - 1;
  const bio = isRockLevel(level);
  const factor = bio ? 2 : 1;
  const asteroidsStart = Math.max(40, 120 - tier * 10);
  const asteroidsMiddle = Math.max(30, asteroidsStart - 20);
  return {
    theme: isRockLevel(level) ? 'biozone' : 'standard',
    rock: isRockLevel(level),
    // [fromFrame, cadence]: the last entry with fromFrame < frame applies
    asteroidsCadence: [
      [0, asteroidsStart * factor],
      [1200, asteroidsMiddle * factor],
      [2400, Math.max(20, asteroidsMiddle - 20) * factor],
    ],
    enemyStart: bio ? BIO_ENEMY_START : Math.max(600, 1200 - tier * 100),
    enemyRate: Math.max(120, 300 - tier * 30),
    bossFrame: LEVEL_DURATION,
    boss: isRockLevel(level) ? 'island' : 'standard',
    spawner: bio ? 'bio' : 'standard',
  };
}

// Create the level's boss (after the boss warning)
export function startBoss() {
  if (levelPlan(state.level).boss === 'island') IslandBoss.create();
  else Entities.createBoss();
}

function cadenceAt(phases, frame) {
  let cadence = phases[0][1];
  for (const [fromEntry, t] of phases) if (frame > fromEntry) cadence = t;
  return cadence;
}

// Pass the current level's theme to the display, only on change (host every step, online client in clientStep)
let currentTheme = null;
// Restart: back to the standard look (cutscene, level 1), the next checkTheme sets it again
export function resetTheme() {
  currentTheme = null;
  Display.setTheme('standard');
}

export function checkTheme() {
  const theme = levelPlan(state.level).theme;
  if (theme === currentTheme) return;
  currentTheme = theme;
  Display.setTheme(theme);
}

// One simulation step of the level flow: counts up the level frame and spawns according to the plan.
export function levelStep() {
  checkTheme();
  state.frameCounter++;
  if (state.bossActive) return;
  const plan = levelPlan(state.level);
  const frame = state.frameCounter;

  if (frame % cadenceAt(plan.asteroidsCadence, frame) === 0) Entities.createAsteroid();
  if (frame > plan.enemyStart && frame % plan.enemyRate === 0) SPAWNER[plan.spawner]();
  if (plan.rock) {
    const supply = frame < plan.bossFrame - ROCK_RUNOUT;
    Rock.createSupply(supply);
    if (supply) Growths.regrow(frame);
  }

  if (frame === plan.bossFrame && !state.bossWarningActive) {
    state.bossWarningActive = true;
    state.bossWarningTimer = 120; // 2 second pause at 60 FPS
    Audio.playBossAlert();
    dom.warningOverlay.style.display = 'flex';
  }
}
