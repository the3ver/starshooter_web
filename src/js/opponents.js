import { state, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Hack from './hack.js';
import * as Display from './display.js';
import * as Chain from './chain.js';
import * as Growths from './growths.js';
import * as BioCreature from './bio-creatures.js';

export function manageEnemySpawns() {
  // Hacker: Spezialeinheit ab Level 2, höchstens einer gleichzeitig
  const hackerActive = arrays.enemies.some(f => f.pattern === 'hacker');
  if (state.level >= 2 && !hackerActive && Math.random() < 0.1) {
    Entities.createEnemy(30 + Math.random() * (config.playfieldWidth - 90), -30, 'hacker', 0);
    return;
  }

  let pV = state.level >= 2 ? Math.min(0.25, 0.05 + (state.level - 2) * 0.05) : 0;
  let pCross = state.level >= 1 ? Math.min(0.2, 0.05 + (state.level - 1) * 0.05) : 0;
  let pSwoop = state.level >= 1 ? Math.min(0.2, 0.05 + (state.level - 1) * 0.05) : 0;
  let pClingOn = state.level >= 1 ? Math.min(0.2, 0.05 + (state.level - 1) * 0.05) : 0;
  let pChain = state.level >= 3 ? Math.min(0.1, 0.05 + (state.level - 3) * 0.05) : 0; // klein: hohe Level behalten Einzeljaeger

  let r = Math.random();

  if (r < pV) {
    // V-Formation (3 oder 5 Jäger)
    let count = Math.random() < 0.5 ? 3 : 5;
    let spacingX = 40;
    let spacingY = 30;
    let centerX = config.playfieldWidth / 2 - 15;
    for (let i = 0; i < count; i++) {
      let offset = Math.ceil(i / 2);
      let side = i % 2 === 0 && i !== 0 ? -1 : 1;
      if (i === 0) {
        offset = 0;
        side = 0;
      }
      Entities.createEnemy(centerX + offset * spacingX * side, -30 - offset * spacingY, 'normal', 0);
    }
  } else if (r < pV + pCross) {
    // Crossfire (2 Jäger überkreuz)
    Entities.createEnemy(10, -30, 'crossfire', 2.5);
    Entities.createEnemy(config.playfieldWidth - 40, -30, 'crossfire', -2.5);
  } else if (r < pV + pCross + pSwoop) {
    // Swoop (1 Jäger von der Seite)
    let spawnLeft = Math.random() < 0.5;
    Entities.createEnemy(
      spawnLeft ? -30 : config.playfieldWidth,
      20 + Math.random() * 50,
      'swoop',
      spawnLeft ? 3.5 : -3.5,
    );
  } else if (r < pV + pCross + pSwoop + pClingOn) {
    // Cling-on Feind an neuem Asteroid
    Entities.createClingOnEnemy();
  } else if (r < pV + pCross + pSwoop + pClingOn + pChain) {
    // Organische Kette (6-10 Glieder auf gemeinsamer Bahn)
    Chain.createRandomChain();
  } else {
    // Einzelner Jäger (Normal oder Stop&Go)
    Entities.createEnemy();
  }
}

// Nächster lebender Spieler (state oder state.p2). Abstand von der Spieler-Ecke
// (x/y) zum Referenzpunkt; P2 nur im Coop, wenn er lebt. Toter P1 oder
// kleinerer Abstand wählt P2, bei Gleichstand bleibt es P1.
export function nextPlayer(refX, refY) {
  if (isCoopMode() && state.p2 && !state.p2.isDead) {
    let distP1 = Math.hypot(state.x - refX, state.y - refY);
    let distP2 = Math.hypot(state.p2.x - refX, state.p2.y - refY);
    if (state.isDead || distP2 < distP1) return state.p2;
  }
  return state;
}

// Position (Mitte) des nächsten lebenden Spielers, gemessen ab der Ecke von f
export function nextPlayerMiddle(f) {
  const s = nextPlayer(f.x, f.y);
  return { x: s.x + config.playerSize / 2, y: s.y + config.playerSize / 2 };
}

const HACKER_LURK_TIME = 600; // 10 s
const HACK_MAX_ROTATION = 0.025; // rad pro Frame (~1,5°), damit man ausweichen kann
const HACKER_SHOT_INTERVAL = 120; // 2 s

function updateHacker(f) {
  if (f.phase === 'anflug') {
    f.y += f.vy * 2;
    if (f.y >= f.stopY) {
      f.y = f.stopY;
      f.phase = 'lauern';
      f.lurkTimer = HACKER_LURK_TIME;
      f.hackTimer = 30;
    }
  } else if (f.phase === 'lauern') {
    f.hackTimer--;
    if (f.hackTimer <= 0) {
      const target = nextPlayerMiddle(f);
      Entities.createHackProjectile(f.x + f.size / 2 - 6, f.y + f.size, target.x, target.y, f);
      f.hackShots++;
      f.hackTimer = HACKER_SHOT_INTERVAL;
    }
    f.lurkTimer--;
    if (f.lurkTimer <= 0 || f.hackLanded) f.phase = 'flucht';
  } else if (f.phase === 'flucht') {
    f.y -= 5;
  }
}

export function updateAsteroids() {
  for (let i = arrays.asteroids.length - 1; i >= 0; i--) {
    let ast = arrays.asteroids[i];
    if (!ast) break;
    if (ast.immune > 0) ast.immune--;
    ast.x += ast.vx;
    ast.y += ast.vy;
    if (ast.vRot) ast.rot += ast.vRot;
    if (ast.y > config.playfieldHeight || ast.x < -ast.size || ast.x > config.playfieldWidth) {
      Display.remove(ast);
      arrays.asteroids.splice(i, 1);
      continue;
    }
    if (
      !state.isDead &&
      !Utils.isDashInvulnerable(state) &&
      Utils.bodyHitsPlayer(state, ast, Utils.ASTEROID_HIT_RADIUS)
    ) {
      Utils.playerHit(ast, true, 'p1');
      Display.remove(ast);
      arrays.asteroids.splice(i, 1);
      continue;
    }
    if (
      isCoopMode() &&
      state.p2 &&
      !state.p2.isDead &&
      !Utils.isDashInvulnerable(state.p2) &&
      Utils.bodyHitsPlayer(state.p2, ast, Utils.ASTEROID_HIT_RADIUS)
    ) {
      Utils.playerHit(ast, true, 'p2');
      Display.remove(ast);
      arrays.asteroids.splice(i, 1);
      continue;
    }
  }
}

// Betaeubung (Sniper-Granate): zaehlt pro Schritt herunter; true = das Ziel ist in diesem Schritt noch betaeubt
// (keine Bewegung, kein Schiessen, keine Hacks, keine Boss-Angriffe). Die Anzeige zeigt betaeubt > 0 an.
export function tickStun(z) {
  if (!(z.stunned > 0)) return false;
  z.stunned--;
  return true;
}

export function updateEnemies() {
  for (let i = arrays.enemies.length - 1; i >= 0; i--) {
    let f = arrays.enemies[i];
    if (!f) break;
    const stunned = tickStun(f);
    if (stunned) {
      // betaeubt: steht still (Position, Muster-Zeit und Timer bleiben stehen)
    } else if (f.pattern === 'stopAndGo') {
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
          const target = nextPlayerMiddle(f);
          Entities.createEnemyLaser(f.x + f.size / 2 - 2, f.y + f.size, target.x, target.y);
        }
        if (f.stopTimer <= 0) {
          f.phase = 'abflug';
          f.shotTimer = 9999;
        }
      } else if (f.phase === 'abflug') {
        f.y += f.vy * 3.5; // Sehr schneller Abflug
      }
      f.time += 0.05;
      f.x = f.basisX + Math.sin(f.time) * 20;
    } else if (f.pattern === 'swoop' || f.pattern === 'crossfire') {
      f.x += f.vx;
      f.y += f.vy * 1.5;
      f.rot = (Math.atan2(f.vy * 1.5, f.vx) * 180) / Math.PI - 90;
    } else if (f.pattern === 'clingOn') {
      if (f.phase === 'attached') {
        let asteroidExists = arrays.asteroids.includes(f.attachedAsteroid);
        if (!asteroidExists || f.attachedAsteroid.y >= 150) {
          f.phase = 'attack';
          f.vy = 2;
          f.shotTimer = 9999;

          const target = nextPlayerMiddle(f);
          Entities.createEnemyLaser(f.x + f.size / 2 - 2, f.y + f.size, target.x, target.y);
        } else {
          f.x = f.attachedAsteroid.x + f.attachedAsteroid.size / 2 - f.size / 2;
          f.y = f.attachedAsteroid.y + f.attachedAsteroid.size / 2 - f.size / 2;
        }
      }
      if (f.phase === 'attack') {
        const target = nextPlayerMiddle(f);
        let dx = target.x - (f.x + f.size / 2);
        let dy = target.y - (f.y + f.size / 2);
        let dist = Math.hypot(dx, dy);
        if (dist > 5) {
          f.vx = (dx / dist) * 3;
          f.vy = (dy / dist) * 3;
        }
        f.x += f.vx;
        f.y += f.vy;
        f.rot = (Math.atan2(f.vy, f.vx) * 180) / Math.PI - 90;
      }
    } else if (Chain.isChainLink(f)) {
      Chain.moveLink(f);
    } else if (Growths.isGrowth(f)) {
      Growths.update(f);
    } else if (BioCreature.isCreature(f)) {
      BioCreature.update(f);
    } else if (f.pattern === 'larva') {
      Growths.moveLarva(f);
    } else if (f.pattern === 'hacker') {
      updateHacker(f);
    } else {
      f.y += f.vy;
      f.time += 0.05;
      f.x = f.basisX + Math.sin(f.time) * 30;
    }
    if (
      !Chain.waitsForStart(f) &&
      (f.y > config.playfieldHeight ||
        f.x < -f.size - 50 ||
        f.x > config.playfieldWidth + 50 ||
        (f.phase === 'flucht' && f.y < -f.size - 10))
    ) {
      Display.remove(f);
      arrays.enemies.splice(i, 1);
      continue;
    }

    if (!stunned && f.pattern !== 'hacker' && (f.pattern !== 'clingOn' || f.phase !== 'attached')) {
      if (f.burstCount > 0) {
        f.burstTimer--;
        if (f.burstTimer <= 0) {
          Entities.createEnemyLaser(f.x + f.size / 2 - 2, f.y + f.size);
          f.burstCount--;
          f.burstTimer = 8;
        }
      }

      f.shotTimer--;
      if (f.shotTimer <= 0) {
        Entities.createEnemyLaser(f.x + f.size / 2 - 2, f.y + f.size);
        let shotBasis = Math.max(25, 60 - (state.level - 1) * 8);
        f.shotTimer = Math.random() * shotBasis + shotBasis;

        if (state.level >= 3 && (Math.random() < Math.min(0.9, 0.5 + (state.level - 3) * 0.2) || f.forceBurst)) {
          f.burstCount = 1;
          f.burstTimer = 8;
        }
      }
    }
    if (!state.isDead && !Utils.isDashInvulnerable(state) && Utils.bodyHitsPlayer(state, f, Utils.ENEMY_HIT_RADIUS)) {
      Utils.playerHit(f, true, 'p1');
      Display.remove(f);
      arrays.enemies.splice(i, 1);
      continue;
    }
    if (
      isCoopMode() &&
      state.p2 &&
      !state.p2.isDead &&
      !Utils.isDashInvulnerable(state.p2) &&
      Utils.bodyHitsPlayer(state.p2, f, Utils.ENEMY_HIT_RADIUS)
    ) {
      Utils.playerHit(f, true, 'p2');
      Display.remove(f);
      arrays.enemies.splice(i, 1);
      continue;
    }
  }
}

export function updateEnemyLaser() {
  for (let i = arrays.enemyLaserArray.length - 1; i >= 0; i--) {
    let fl = arrays.enemyLaserArray[i];
    if (!fl) break;
    fl.y += fl.vy;
    if (fl.vx) fl.x += fl.vx;
    if (fl.y > config.playfieldHeight || fl.y < -fl.height || fl.x < -fl.width || fl.x > config.playfieldWidth) {
      Display.remove(fl);
      arrays.enemyLaserArray.splice(i, 1);
      continue;
    }
    // Von der Gleve seitlich weggeschleudert: trifft keine Spieler mehr
    if (fl.harmless) continue;
    if (
      !state.isDead &&
      !Utils.isDashInvulnerable(state) &&
      state.x < fl.x + fl.width &&
      state.x + config.playerSize > fl.x &&
      state.y < fl.y + fl.height &&
      state.y + config.playerSize > fl.y
    ) {
      Utils.playerHit(fl, false, 'p1');
      Display.remove(fl);
      arrays.enemyLaserArray.splice(i, 1);
      continue;
    }
    if (
      isCoopMode() &&
      state.p2 &&
      !state.p2.isDead &&
      !Utils.isDashInvulnerable(state.p2) &&
      state.p2.x < fl.x + fl.width &&
      state.p2.x + config.playerSize > fl.x &&
      state.p2.y < fl.y + fl.height &&
      state.p2.y + config.playerSize > fl.y
    ) {
      Utils.playerHit(fl, false, 'p2');
      Display.remove(fl);
      arrays.enemyLaserArray.splice(i, 1);
      continue;
    }
  }
}

export function updateHackProjectiles() {
  for (let i = arrays.hackProjectileArray.length - 1; i >= 0; i--) {
    let hp = arrays.hackProjectileArray[i];
    if (hp.steerTime > 0) {
      hp.steerTime--;
      const target = nextPlayerMiddle(hp);
      // Nach dem Vorbeiflug nicht mehr nachlenken
      if (hp.y + hp.height / 2 > target.y) hp.steerTime = 0;
      const is = Math.atan2(hp.vy, hp.vx);
      const should = Math.atan2(target.y - (hp.y + hp.height / 2), target.x - (hp.x + hp.width / 2));
      let diff = Math.atan2(Math.sin(should - is), Math.cos(should - is));
      diff = Math.max(-HACK_MAX_ROTATION, Math.min(HACK_MAX_ROTATION, diff));
      const speed = Math.hypot(hp.vx, hp.vy);
      hp.vx = Math.cos(is + diff) * speed;
      hp.vy = Math.sin(is + diff) * speed;
    }
    hp.x += hp.vx;
    hp.y += hp.vy;
    if (hp.y > config.playfieldHeight || hp.y < -hp.height || hp.x < -hp.width || hp.x > config.playfieldWidth) {
      Display.remove(hp);
      arrays.hackProjectileArray.splice(i, 1);
      continue;
    }
    // Von der Gleve seitlich weggeschleudert: trifft keine Spieler mehr
    if (hp.harmless) continue;
    let hit = null;
    if (
      !state.isDead &&
      !Utils.isDashInvulnerable(state) &&
      state.x < hp.x + hp.width &&
      state.x + config.playerSize > hp.x &&
      state.y < hp.y + hp.height &&
      state.y + config.playerSize > hp.y
    ) {
      hit = state;
    } else if (
      isCoopMode() &&
      state.p2 &&
      !state.p2.isDead &&
      !Utils.isDashInvulnerable(state.p2) &&
      state.p2.x < hp.x + hp.width &&
      state.p2.x + config.playerSize > hp.x &&
      state.p2.y < hp.y + hp.height &&
      state.p2.y + config.playerSize > hp.y
    ) {
      hit = state.p2;
    }
    if (hit) {
      // Ein Hacker kann nur einen Treffer landen
      if (!hp.source || !hp.source.hackLanded) {
        Hack.hackPlayer(hit);
        if (hp.source) hp.source.hackLanded = true;
      }
      Display.remove(hp);
      arrays.hackProjectileArray.splice(i, 1);
    }
  }
}
