
import { state, dom, config, arrays } from './state.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import * as Cutscene from './cutscene.js';
import * as Network from './network.js';
import * as Hack from './hack.js';
import { animierenPartikel } from './partikel.js';
import { verwalteFeindSpawns, aktualisiereAsteroiden, aktualisiereFeinde, aktualisiereFeindLaser, aktualisiereHackProjektile } from './gegner.js';
import { aktualisiereBosse, aktualisiereBossBomben, aktualisiereBossRaketen } from './boss.js';
import { aktualisierePowerups } from './powerups.js';
import { aktualisiereUnverwundbarkeit, bewegeSpieler, aktualisiereEnergie, regeneriereSchild } from './spieler.js';
import { aktualisiereWaffen, versteckeAlleLaser } from './waffen.js';
import { clientSchritt } from './client.js';
import { pruefePause } from './pause.js';

// Bestehende Exporte bleiben ueber loop.js erreichbar
export { verwalteFeindSpawns, versteckeAlleLaser, animierenPartikel };


export function simulationsSchritt() {
  if (state.pausiert) {
    pruefePause();
    return;
  }

  if (state.cutsceneAktiv) {
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
          return;
        }
      } else {
        let startScreen = document.getElementById('start-screen');
        if (startScreen) startScreen.style.display = 'none';
        Cutscene.startCutscene();
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
    return;
  }

  // --- ONLINE CLIENT LOKALE STEUERUNG & RENDERING ---
  if (state.network && state.network.isClient && state.network.connected) {
    clientSchritt();
    return;
  }

  // --- I-Frames (Unverwundbarkeit Timer) ---
  aktualisiereUnverwundbarkeit();

  // --- 9.1 SPIELER 1 & 2 BEWEGUNG ---
  bewegeSpieler();
  if (state.durchschlagTimer > 0) {
    state.durchschlagTimer--;
    if (state.durchschlagTimer <= 0) {
      state.laserDurchschlag = false;
      Utils.updateAktivePowerupsUI();
    }
  }

  Hack.tickHacks(state);
  if (state.p2) Hack.tickHacks(state.p2);
  Hack.zeigeHackStatus();

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

  // --- 9.4 ENERGIE SPIELER 1 & 2 ---
  const { laserAktiv, laserAktivP2 } = aktualisiereEnergie();

  // --- 9.4b SCHILD REGENERATION (Phantom-NX) ---
  regeneriereSchild();

  // --- 9.5 POWERUPS ---
  aktualisierePowerups();

  // --- 9.6 ASTEROIDEN ---
  aktualisiereAsteroiden();

  // --- 9.7 FEINDE ---
  aktualisiereFeinde();

  // --- 9.8 FEIND-LASER ---
  aktualisiereFeindLaser();

  // --- 9.8b HACK-PROJEKTILE ---
  aktualisiereHackProjektile();

  // --- BOSS LOGIK ---
  aktualisiereBosse();

  // --- 9.8c BOSS BOMBEN UPDATE ---
  aktualisiereBossBomben();

  // --- 9.8d BOSS RAKETEN UPDATE ---
  aktualisiereBossRaketen();

  // --- 9.9 - 9.14 WAFFEN (Autolaser, Hitscan, Laser, Raketen, Bomben) ---
  aktualisiereWaffen(laserAktiv, laserAktivP2);

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

}

// --- FESTE SIMULATIONSSCHRITTE (60 Hz, unabhaengig von der Monitor-Bildrate) ---
export const SCHRITT_MS = 1000 / 60;
export const MAX_SCHRITTE_PRO_FRAME = 5;

// Wie viele feste Simulationsschritte fuer die vergangene Zeit faellig sind
export function berechneSchritte(kontoMs, deltaMs) {
  const delta = (typeof deltaMs === 'number' && deltaMs > 0) ? deltaMs : 0;
  const konto = (typeof kontoMs === 'number' && kontoMs > 0) ? kontoMs : 0;
  let neuesKonto = konto + delta;
  const schritte = Math.floor(neuesKonto / SCHRITT_MS);
  if (schritte > MAX_SCHRITTE_PRO_FRAME) {
    // Rueckstand (z.B. nach Tab-Wechsel) verwerfen statt vorzuspulen
    return { schritte: MAX_SCHRITTE_PRO_FRAME, kontoMs: 0 };
  }
  neuesKonto -= schritte * SCHRITT_MS;
  return { schritte, kontoMs: neuesKonto };
}

let letzterZeitstempel = null;
let zeitKontoMs = 0;

export function gameLoop(zeitstempel) {
  if (letzterZeitstempel === null || typeof zeitstempel !== 'number') {
    // Erster Aufruf: genau ein Schritt
    simulationsSchritt();
  } else {
    const ergebnis = berechneSchritte(zeitKontoMs, zeitstempel - letzterZeitstempel);
    zeitKontoMs = ergebnis.kontoMs;
    for (let i = 0; i < ergebnis.schritte; i++) {
      simulationsSchritt();
    }
  }
  if (typeof zeitstempel === 'number') letzterZeitstempel = zeitstempel;
  requestAnimationFrame(gameLoop);
}