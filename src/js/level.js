import { state, dom } from './state.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import { verwalteFeindSpawns } from './gegner.js';

// Ablauf eines Levels: Asteroiden-Takt in drei Phasen, Feinde ab feindStart im Takt feindRate,
// Boss-Warnung bei bossFrame. levelPlan(level) liefert die Werte; neue Levelarten bekommen hier ihren Plan.
export const LEVEL_DAUER = 3600; // 60 s bei 60 Hz

export function levelPlan(level) {
  const stufe = level - 1;
  const asteroidenStart = Math.max(40, 120 - stufe * 10);
  const asteroidenMitte = Math.max(30, asteroidenStart - 20);
  return {
    thema: 'standard',
    // [abFrame, Takt]: der letzte Eintrag mit abFrame < frame gilt
    asteroidenTakt: [
      [0, asteroidenStart],
      [1200, asteroidenMitte],
      [2400, Math.max(20, asteroidenMitte - 20)],
    ],
    feindStart: Math.max(600, 1200 - stufe * 100),
    feindRate: Math.max(120, 300 - stufe * 30),
    bossFrame: LEVEL_DAUER,
  };
}

function taktBei(phasen, frame) {
  let takt = phasen[0][1];
  for (const [ab, t] of phasen) if (frame > ab) takt = t;
  return takt;
}

// Ein Simulationsschritt des Level-Ablaufs: zaehlt den Level-Frame hoch und spawnt nach Plan.
export function levelSchritt() {
  state.frameZaehler++;
  if (state.bossAktiv) return;
  const plan = levelPlan(state.level);
  const frame = state.frameZaehler;

  if (frame % taktBei(plan.asteroidenTakt, frame) === 0) Entities.erzeugeAsteroid();
  if (frame > plan.feindStart && frame % plan.feindRate === 0) verwalteFeindSpawns();

  if (frame === plan.bossFrame && !state.bossWarningAktiv) {
    state.bossWarningAktiv = true;
    state.bossWarningTimer = 120; // 2 Sekunden Pause bei 60 FPS
    Audio.playBossAlert();
    dom.warningOverlay.style.display = 'flex';
  }
}
