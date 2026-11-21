import { state, dom, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import { nextPlayerMiddle, tickStun } from './opponents.js';
import * as Display from './display.js';
import { createParticles } from './particles.js';
import { createEffect } from './effects.js';
import * as IslandBoss from './island-boss.js';

const BOSS_HACK_FROM_LEVEL = 5;
const BOSS_HACK_INTERVAL = 300; // 5 s
const BOSS_HACK_INTERVAL_ENRAGE = 180; // 3 s

export function updateBosses() {
  IslandBoss.update();
  for (let i = arrays.bosses.length - 1; i >= 0; i--) {
    let b = arrays.bosses[i];
    if (!b) break;
    const stunned = tickStun(b); // Sniper grenade: no movement, no attacks
    if (b.bossType === 'eye') {
      // Island boss: eyes sit in the body (rock), no movement of their own, no ram damage
      IslandBoss.updateEye(b, stunned);
      continue;
    }
    if (b.phase === 'entry') {
      b.repulsorActive = true;
      b.y += b.vy;
      if (b.y >= 20) {
        b.y = 20;
        b.phase = 'fight';
        b.repulsorActive = false;
      }

      // Apply the repulsor to projectiles
      arrays.laserArray.forEach(l => {
        let cx = b.x + b.size / 2;
        let cy = b.y + b.size / 2;
        let lx = l.x + l.width / 2;
        let ly = l.y;
        let dx = lx - cx;
        let dy = ly - cy;
        let dist = Math.hypot(dx, dy);
        if (dist < b.size * 1.5 && dy > 0) {
          // Works best defending downwards
          let force = (b.size * 1.5 - dist) * 0.15;
          l.vx += dx > 0 ? force : -force;
        }
      });
      dom.bossHpBar.style.width = Math.max(0, (b.hp / b.maxHp) * 100) + '%';
      continue; // Skips fight movements and shooting
    } else {
      // Enrage check for all types
      if (!b.enragePhaseActive && b.hp < b.maxHp * 0.5) {
        b.enragePhaseActive = true;
        b.baseShotRate = Math.max(15, Math.floor(b.baseShotRate / 2));
        dom.bossHpBar.style.backgroundColor = '#8e44ad'; // Visualizes enrage in the bar
        if (b.bossType === 2) b.vx *= 1.5; // The hunter gets faster in enrage
      }

      // Hack projectiles from level 5 on (source null so the boss can hack several times)
      if (!stunned && state.level >= BOSS_HACK_FROM_LEVEL) {
        b.hackTimer--;
        if (b.hackTimer <= 0) {
          const target = nextPlayerMiddle(b);
          Entities.createHackProjectile(b.x + b.size / 2 - 6, b.y + b.size, target.x, target.y, null);
          b.hackTimer = b.enragePhaseActive ? BOSS_HACK_INTERVAL_ENRAGE : BOSS_HACK_INTERVAL;
        }
      }

      // Movement
      if (stunned) {
        // betaeubt: steht still
      } else if (b.bossType === 1) {
        // Kreuzer
        b.x += b.vx;
        if (b.x <= 10 || b.x >= config.playfieldWidth - b.size - 10) b.vx *= -1;
      } else if (b.bossType === 2) {
        // Hunter - chases the nearer living player
        let targetX = nextPlayerMiddle(b).x - b.size / 2;
        if (b.x < targetX - 5) b.x += b.vx;
        else if (b.x > targetX + 5) b.x -= b.vx;
      } else if (b.bossType === 3) {
        // Carrier
        b.time = (b.time || 0) + 0.02 * (b.enragePhaseActive ? 1.5 : 1);
        b.x = config.playfieldWidth / 2 - b.size / 2 + Math.sin(b.time) * (config.playfieldWidth / 2 - b.size / 2 - 10);
      } else if (b.bossType === 4) {
        // Festung
        b.x += b.vx * 0.5; // Moves very slowly
        if (b.x <= 10 || b.x >= config.playfieldWidth - b.size - 10) b.vx *= -1;
      }

      // Update the HP bar width
      dom.bossHpBar.style.width = Math.max(0, (b.hp / b.maxHp) * 100) + '%';
      if (b.enragePhaseActive) {
        Utils.createSmokeSparks(b.x, b.y, b.size);
      }
      if (b.bossType === 1) {
        Utils.createDriveSmoke(b.x + b.size * 0.3, b.y - b.size * 0.05, -2);
        Utils.createDriveSmoke(b.x + b.size * 0.7, b.y - b.size * 0.05, -2);
      } else if (b.bossType === 2) {
        Utils.createDriveSmoke(b.x + b.size * 0.35, b.y - b.size * 0.05, -2);
        Utils.createDriveSmoke(b.x + b.size * 0.65, b.y - b.size * 0.05, -2);
      } else if (b.bossType === 3) {
        Utils.createDriveSmoke(b.x + b.size * 0.5, b.y - b.size * 0.05, -2);
      } else if (b.bossType === 4) {
        Utils.createDriveSmoke(b.x + b.size * 0.25, b.y - b.size * 0.05, -2);
        Utils.createDriveSmoke(b.x + b.size * 0.75, b.y - b.size * 0.05, -2);
      }
      if (!stunned) b.shotTimer--;
      if (!stunned && b.shotTimer <= 0) {
        if (b.bossType === 1) {
          Entities.createBossLaser(b.x + b.size * 0.2, b.y + b.size * 0.7);
          Entities.createBossLaser(b.x + b.size * 0.46, b.y + b.size * 0.9);
          Entities.createBossLaser(b.x + b.size * 0.72, b.y + b.size * 0.7);
          if (b.enragePhaseActive) {
            Entities.createBossLaser(b.x + b.size * 0.1, b.y + b.size * 0.5);
            Entities.createBossLaser(b.x + b.size * 0.82, b.y + b.size * 0.5);
          }
        } else if (b.bossType === 2) {
          // Aimed shot at the nearer living player
          const target = nextPlayerMiddle(b);
          let startX = b.x + b.size / 2 - 4;
          let startY = b.y + b.size;
          let angle = Math.atan2(target.y - startY, target.x - startX);
          Entities.createBossLaser(startX, startY, Math.cos(angle) * 8, Math.sin(angle) * 8);
          if (b.enragePhaseActive) {
            Entities.createBossLaser(startX, startY, Math.cos(angle - 0.2) * 8, Math.sin(angle - 0.2) * 8);
            Entities.createBossLaser(startX, startY, Math.cos(angle + 0.2) * 8, Math.sin(angle + 0.2) * 8);
          }
        } else if (b.bossType === 3) {
          // Spawns an enemy
          Entities.createEnemy(b.x + b.size / 2 - 15, b.y + b.size);
          if (Math.random() < 0.5 || b.enragePhaseActive) Entities.createBossLaser(b.x + b.size / 2 - 4, b.y + b.size);
        } else if (b.bossType === 4) {
          // Fan shot (spread)
          let count = b.enragePhaseActive ? 7 : 5;
          let startX = b.x + b.size / 2 - 4;
          let startY = b.y + b.size - 10;
          for (let j = 0; j < count; j++) {
            let angle = Math.PI / 2 - 0.5 + j * (1.0 / (count - 1));
            Entities.createBossLaser(startX, startY, Math.cos(angle) * 6, Math.sin(angle) * 6);
          }
        }
        b.shotTimer = b.baseShotRate;
      }

      // Boss bomb drop
      b.bombTimer = (b.bombTimer !== undefined ? b.bombTimer : Math.random() * 120 + 240) - (stunned ? 0 : 1);
      if (!stunned && b.bombTimer <= 0) {
        Entities.createBossBomb(b.x + b.size / 2 - 13, b.y + b.size * 0.7);
        b.bombTimer = Math.max(160, 360 - (state.level - 1) * 30);
      }

      // Boss missile drop (homing from the side)
      b.missileTimer = (b.missileTimer !== undefined ? b.missileTimer : Math.random() * 140 + 200) - (stunned ? 0 : 1);
      if (!stunned && b.missileTimer <= 0) {
        let side = Math.random() < 0.5 ? -1 : 1;
        Entities.createBossMissile(b.x + (side < 0 ? 0 : b.size - 14), b.y + b.size * 0.5, side);
        if (b.enragePhaseActive || state.level >= 4) {
          Entities.createBossMissile(b.x + (-side < 0 ? 0 : b.size - 14), b.y + b.size * 0.5, -side);
        }
        b.missileTimer = Math.max(180, 360 - (state.level - 1) * 25);
      }
    }
    let bossPadding = b.size * 0.15;
    if (
      !state.isDead &&
      !Utils.isDashInvulnerable(state) &&
      state.x < b.x + b.size - bossPadding &&
      state.x + config.playerSize > b.x + bossPadding &&
      state.y < b.y + b.size - bossPadding &&
      state.y + config.playerSize > b.y + bossPadding
    ) {
      Utils.playerHit(b, false, 'p1');
    }
    if (
      isCoopMode() &&
      state.p2 &&
      !state.p2.isDead &&
      !Utils.isDashInvulnerable(state.p2) &&
      state.p2.x < b.x + b.size - bossPadding &&
      state.p2.x + config.playerSize > b.x + bossPadding &&
      state.p2.y < b.y + b.size - bossPadding &&
      state.p2.y + config.playerSize > b.y + bossPadding
    ) {
      Utils.playerHit(b, false, 'p2');
    }
  }
  for (let i = arrays.bossLaserArray.length - 1; i >= 0; i--) {
    let bl = arrays.bossLaserArray[i];
    if (!bl) break;
    bl.x += bl.vx || 0;
    bl.y += bl.vy;
    if (bl.y > config.playfieldHeight || bl.y < -bl.height || bl.x < -10 || bl.x > config.playfieldWidth + 10) {
      Display.remove(bl);
      arrays.bossLaserArray.splice(i, 1);
      continue;
    }
    // Flung sideways by the Gleve: no longer hits players
    if (bl.harmless) continue;
    if (
      !state.isDead &&
      !Utils.isDashInvulnerable(state) &&
      state.x < bl.x + bl.width &&
      state.x + config.playerSize > bl.x &&
      state.y < bl.y + bl.height &&
      state.y + config.playerSize > bl.y
    ) {
      Utils.playerHit(bl, false, 'p1');
      Display.remove(bl);
      arrays.bossLaserArray.splice(i, 1);
      continue;
    }
    if (
      isCoopMode() &&
      state.p2 &&
      !state.p2.isDead &&
      !Utils.isDashInvulnerable(state.p2) &&
      state.p2.x < bl.x + bl.width &&
      state.p2.x + config.playerSize > bl.x &&
      state.p2.y < bl.y + bl.height &&
      state.p2.y + config.playerSize > bl.y
    ) {
      Utils.playerHit(bl, false, 'p2');
      Display.remove(bl);
      arrays.bossLaserArray.splice(i, 1);
      continue;
    }
  }
}

export function updateBossBombs() {
  for (let i = arrays.bossBombArray.length - 1; i >= 0; i--) {
    let bb = arrays.bossBombArray[i];
    if (!bb) break;
    bb.x += bb.vx;
    bb.y += bb.vy;
    bb.timer--;

    // Speed up the beep cadence the closer it gets to detonation
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
      Utils.createExplosion(bb.x + 13, bb.y + 13, '#2ecc71', 25);
      Display.remove(bb);
      arrays.bossBombArray.splice(i, 1);
      continue;
    }

    if (bb.y > config.playfieldHeight + 40 || bb.x < -40 || bb.x > config.playfieldWidth + 40) {
      Display.remove(bb);
      arrays.bossBombArray.splice(i, 1);
      continue;
    }

    if (bb.timer <= 0 || bb.y >= config.playfieldHeight - 60) {
      let cx = bb.x + 13;
      let cy = bb.y + 13;
      Utils.createExplosion(cx, cy, '#e74c3c', 40);

      createEffect({ kind: 'bossWave', x: cx, y: cy, radius: bb.radius, rest: 24 });

      let distP1 = Math.hypot(state.x + config.playerSize / 2 - cx, state.y + config.playerSize / 2 - cy);
      if (!state.isDead && distP1 <= bb.radius) {
        Utils.playerHit(bb, false, 'p1');
      }
      if (isCoopMode() && state.p2 && !state.p2.isDead) {
        let distP2 = Math.hypot(state.p2.x + config.playerSize / 2 - cx, state.p2.y + config.playerSize / 2 - cy);
        if (distP2 <= bb.radius) {
          Utils.playerHit(bb, false, 'p2');
        }
      }

      Display.remove(bb);
      arrays.bossBombArray.splice(i, 1);
      continue;
    }

    if (
      !state.isDead &&
      !Utils.isDashInvulnerable(state) &&
      state.x < bb.x + bb.size &&
      state.x + config.playerSize > bb.x &&
      state.y < bb.y + bb.size &&
      state.y + config.playerSize > bb.y
    ) {
      Utils.playerHit(bb, false, 'p1');
      bb.hp = 0;
    }
    if (
      isCoopMode() &&
      state.p2 &&
      !state.p2.isDead &&
      !Utils.isDashInvulnerable(state.p2) &&
      state.p2.x < bb.x + bb.size &&
      state.p2.x + config.playerSize > bb.x &&
      state.p2.y < bb.y + bb.size &&
      state.p2.y + config.playerSize > bb.y
    ) {
      Utils.playerHit(bb, false, 'p2');
      bb.hp = 0;
    }
  }
}

export function updateBossMissiles() {
  for (let i = arrays.bossMissileArray.length - 1; i >= 0; i--) {
    let br = arrays.bossMissileArray[i];
    if (!br) break;
    br.age = (br.age || 0) + 1;

    if (br.age % 8 === 0) {
      Audio.playBossRocketFlight();
    }

    // Homing towards the nearer living player
    const target = nextPlayerMiddle(br);
    let dx = target.x - (br.x + br.width / 2);
    let dy = target.y - (br.y + br.height / 2);
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
    br.rot = (Math.atan2(br.vy, br.vx) * 180) / Math.PI + 90;

    // Particle trail
    if (Math.random() < 0.4) {
      const color = Math.random() < 0.6 ? '#e74c3c' : '#f39c12';
      createParticles({
        color,
        x: br.x + br.width / 2,
        y: br.y + br.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: 0.5 + Math.random() * 0.5,
        lives: 0.8,
        decay: 0.05,
      });
    }

    // When destroyed by the player
    if (br.hp <= 0) {
      Utils.addScore(100);
      Audio.playMissileExplosion();
      Utils.createExplosion(br.x + br.width / 2, br.y + br.height / 2, '#e67e22', 20);
      Display.remove(br);
      arrays.bossMissileArray.splice(i, 1);
      continue;
    }

    // Left the screen far behind
    if (br.y > config.playfieldHeight + 60 || br.x < -80 || br.x > config.playfieldWidth + 80 || br.y < -100) {
      Display.remove(br);
      arrays.bossMissileArray.splice(i, 1);
      continue;
    }

    // Collision with a player
    if (
      !state.isDead &&
      !Utils.isDashInvulnerable(state) &&
      state.x < br.x + br.width &&
      state.x + config.playerSize > br.x &&
      state.y < br.y + br.height &&
      state.y + config.playerSize > br.y
    ) {
      Utils.playerHit(br, false, 'p1');
      Audio.playMissileExplosion();
      Utils.createExplosion(br.x + br.width / 2, br.y + br.height / 2, '#e74c3c', 25);
      Display.remove(br);
      arrays.bossMissileArray.splice(i, 1);
      continue;
    }
    if (
      isCoopMode() &&
      state.p2 &&
      !state.p2.isDead &&
      !Utils.isDashInvulnerable(state.p2) &&
      state.p2.x < br.x + br.width &&
      state.p2.x + config.playerSize > br.x &&
      state.p2.y < br.y + br.height &&
      state.p2.y + config.playerSize > br.y
    ) {
      Utils.playerHit(br, false, 'p2');
      Audio.playMissileExplosion();
      Utils.createExplosion(br.x + br.width / 2, br.y + br.height / 2, '#e74c3c', 25);
      Display.remove(br);
      arrays.bossMissileArray.splice(i, 1);
      continue;
    }
  }
}
