import { state, dom } from './state.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import { manageEnemySpawns } from './opponents.js';
import * as Rock from './rock.js';
import * as Growths from './growths.js';
import * as Display from './display.js';
import * as IslandBoss from './island-boss.js';
import { manageBioSpawns } from './bio-creatures.js';

// Ablauf eines Levels: Asteroiden-Takt in drei Phasen, Feinde ab feindStart im Takt feindRate,
// Boss-Warnung bei bossFrame. levelPlan(level) liefert die Werte; neue Levelarten bekommen hier ihren Plan.
export const LEVEL_DURATION = 3600; // 60 s bei 60 Hz
export const ROCK_RUNOUT = 900; // so viele Schritte vor dem Boss laufen die Felswaende aus

// Fels-Level: ab Level 4 jedes zweite Level
export function isRockLevel(level) {
  return level >= 4 && level % 2 === 0;
}

// Gegner-Spawner je Levelart (Plan-Feld spawner)
const SPAWNER = { standard: manageEnemySpawns, bio: manageBioSpawns };

// Fels-Level (Biozone): eigener Gegnermix aus Ketten und Wesen, frueher Start, Asteroiden halb so oft
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
    // [abFrame, Takt]: der letzte Eintrag mit abFrame < frame gilt
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

// Boss des Levels erzeugen (nach der Boss-Warnung)
export function startBoss() {
  if (levelPlan(state.level).boss === 'island') IslandBoss.create();
  else Entities.createBoss();
}

function cadenceAt(phases, frame) {
  let cadence = phases[0][1];
  for (const [fromEntry, t] of phases) if (frame > fromEntry) cadence = t;
  return cadence;
}

// Thema des aktuellen Levels an die Anzeige geben, nur bei Wechsel (Host jeden Schritt, Online-Client in clientSchritt)
let currentTheme = null;
// Neustart: zurueck zum Standard-Look (Cutszene, Level 1), naechstes pruefeThema setzt neu
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

// Ein Simulationsschritt des Level-Ablaufs: zaehlt den Level-Frame hoch und spawnt nach Plan.
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
    state.bossWarningTimer = 120; // 2 Sekunden Pause bei 60 FPS
    Audio.playBossAlert();
    dom.warningOverlay.style.display = 'flex';
  }
}
