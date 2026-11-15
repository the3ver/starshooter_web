import { state, dom } from './state.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import { verwalteFeindSpawns } from './gegner.js';
import * as Fels from './fels.js';
import * as Gewaechse from './gewaechse.js';
import * as Anzeige from './anzeige.js';
import * as Inselboss from './inselboss.js';

// Ablauf eines Levels: Asteroiden-Takt in drei Phasen, Feinde ab feindStart im Takt feindRate,
// Boss-Warnung bei bossFrame. levelPlan(level) liefert die Werte; neue Levelarten bekommen hier ihren Plan.
export const LEVEL_DAUER = 3600; // 60 s bei 60 Hz
export const FELS_AUSLAUF = 900; // so viele Schritte vor dem Boss laufen die Felswaende aus

// Fels-Level: ab Level 4 jedes zweite Level
export function istFelsLevel(level) {
  return level >= 4 && level % 2 === 0;
}

export function levelPlan(level) {
  const stufe = level - 1;
  const asteroidenStart = Math.max(40, 120 - stufe * 10);
  const asteroidenMitte = Math.max(30, asteroidenStart - 20);
  return {
    thema: istFelsLevel(level) ? 'biozone' : 'standard',
    fels: istFelsLevel(level),
    // [abFrame, Takt]: der letzte Eintrag mit abFrame < frame gilt
    asteroidenTakt: [
      [0, asteroidenStart],
      [1200, asteroidenMitte],
      [2400, Math.max(20, asteroidenMitte - 20)],
    ],
    feindStart: Math.max(600, 1200 - stufe * 100),
    feindRate: Math.max(120, 300 - stufe * 30),
    bossFrame: LEVEL_DAUER,
    boss: istFelsLevel(level) ? 'insel' : 'standard',
  };
}

// Boss des Levels erzeugen (nach der Boss-Warnung)
export function starteBoss() {
  if (levelPlan(state.level).boss === 'insel') Inselboss.erzeuge();
  else Entities.erzeugeBoss();
}

function taktBei(phasen, frame) {
  let takt = phasen[0][1];
  for (const [ab, t] of phasen) if (frame > ab) takt = t;
  return takt;
}

// Thema des aktuellen Levels an die Anzeige geben, nur bei Wechsel (Host jeden Schritt, Online-Client in clientSchritt)
let aktuellesThema = null;
// Neustart: zurueck zum Standard-Look (Cutszene, Level 1), naechstes pruefeThema setzt neu
export function setzeThemaZurueck() {
  aktuellesThema = null;
  Anzeige.setzeThema('standard');
}

export function pruefeThema() {
  const thema = levelPlan(state.level).thema;
  if (thema === aktuellesThema) return;
  aktuellesThema = thema;
  Anzeige.setzeThema(thema);
}

// Ein Simulationsschritt des Level-Ablaufs: zaehlt den Level-Frame hoch und spawnt nach Plan.
export function levelSchritt() {
  pruefeThema();
  state.frameZaehler++;
  if (state.bossAktiv) return;
  const plan = levelPlan(state.level);
  const frame = state.frameZaehler;

  if (frame % taktBei(plan.asteroidenTakt, frame) === 0) Entities.erzeugeAsteroid();
  if (frame > plan.feindStart && frame % plan.feindRate === 0) verwalteFeindSpawns();
  if (plan.fels) {
    const nachschub = frame < plan.bossFrame - FELS_AUSLAUF;
    Fels.erzeugeNachschub(nachschub);
    if (nachschub) Gewaechse.wachseNach(frame);
  }

  if (frame === plan.bossFrame && !state.bossWarningAktiv) {
    state.bossWarningAktiv = true;
    state.bossWarningTimer = 120; // 2 Sekunden Pause bei 60 FPS
    Audio.playBossAlert();
    dom.warningOverlay.style.display = 'flex';
  }
}
