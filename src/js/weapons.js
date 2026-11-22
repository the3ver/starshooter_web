import { state, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import * as Network from './network.js';
import * as Hack from './hack.js';
import * as Gleve from './gleve.js';
import * as Viper from './viper.js';
import * as Sniper from './sniper.js';
import * as Display from './display.js';
import { createParticles } from './particles.js';

// --- 9.10 MANUAL LASERS (projectiles) ---
function fireLaserForPlayer(pKey, pState, isFiring) {
  if (!pState || pState.isDead) return;
  if (pState.playerShotCooldown > 0) pState.playerShotCooldown--;
  if (isFiring && pState.playerShotCooldown <= 0) {
    pState.playerShotCooldown = Viper.shotCooldown(pState); // Fire rate (Viper: overdrive doubles, combo faster)
    Audio.playLaser(pState.laserTier);

    // Damage per projectile (scales inversely with the projectile count so total DPS grows in a controlled way)
    let reasonDamage = 16; // 1 projectile = 160 DPS (tier 1)
    if (pState.laserTier === 2)
      reasonDamage = 10; // 2 projectiles = 200 DPS
    else if (pState.laserTier === 3)
      reasonDamage = 12; // 2 projectiles = 240 DPS
    else if (pState.laserTier >= 4) reasonDamage = 8; // 4 projectiles = 320 DPS

    let beamsDef = [];
    const primaryColor = pKey === 'p2' ? '#3498db' : '#00ffff';
    const quadColor = pKey === 'p2' ? '#00d2d3' : '#a000ff';
    if (pState.laserTier === 1) {
      beamsDef.push({
        offsetX: 11,
        width: 8,
        vx: 0,
        color: primaryColor,
      });
    } else if (pState.laserTier === 2) {
      beamsDef.push({
        offsetX: 5,
        width: 4,
        vx: 0,
        color: primaryColor,
      });
      beamsDef.push({
        offsetX: 21,
        width: 4,
        vx: 0,
        color: primaryColor,
      });
    } else if (pState.laserTier >= 3) {
      beamsDef.push({
        offsetX: 5,
        width: 5,
        vx: 0,
        color: '#ffffff',
      });
      beamsDef.push({
        offsetX: 20,
        width: 5,
        vx: 0,
        color: '#ffffff',
      });
      if (pState.laserTier >= 4) {
        beamsDef.push({
          offsetX: 0,
          width: 4,
          vx: 0,
          color: quadColor,
        });
        beamsDef.push({
          offsetX: 26,
          width: 4,
          vx: 0,
          color: quadColor,
        });
      }
    }
    beamsDef.forEach(st => {
      arrays.laserArray.push(
        Display.create(
          {
            id: Entities.newId('l'),
            // Lasers flying sideways slightly rotated
            rot: st.vx !== 0 ? (Math.atan2(-15, st.vx) * 180) / Math.PI + 90 : undefined,
            color: st.color,
            x: pState.x + st.offsetX,
            y: pState.y,
            vx: st.vx,
            vy: 15,
            width: st.width,
            height: 20,
            damage: reasonDamage,
            owner: pKey,
            pierce: pState.laserPierce || Viper.isOverdrive(pState),
          },
          'laser',
        ),
      );
    });
  }
}

// --- 9.13 MISSILES ---
// Gleve: same cooldown counter and HUD bar, but for the dash (triggered in player.js / gleve.js)
function fireMissileForPlayer(pKey, pState) {
  if (!pState || pState.isDead) return;
  const isGleve = Gleve.isGleve(pState);
  if (isGleve) Gleve.updateDashCharges(pState);
  else if (Sniper.isSniper(pState)) Sniper.updateGrenadeCharges(pKey, pState);
  else if (pState.missileCooldown > 0) pState.missileCooldown--;

  let maxMissileCd = 180;
  if (pState.missileTier >= 2 && pState.missileTier <= 3) maxMissileCd = 150;
  if (pState.missileTier >= 4) maxMissileCd = 120;
  if (isGleve) maxMissileCd = Gleve.dashCooldown(pState);
  if (Sniper.isSniper(pState)) maxMissileCd = Sniper.grenadeCooldown(pState);

  if (isGleve) {
    Gleve.showDashHud(pKey, pState);
  } else if (Sniper.isSniper(pState)) {
    // HUD pflegt Sniper.aktualisiereGranatenLadungen
  } else if (pKey === 'p1') {
    const missileCdBar = document.getElementById('raketen-cd-balken');
    if (missileCdBar) {
      let pctR = Math.max(0, 100 - (pState.missileCooldown / maxMissileCd) * 100);
      missileCdBar.style.width = pctR + '%';
      missileCdBar.style.backgroundColor = pState.missileCooldown <= 0 ? '#2ecc71' : '#e74c3c';
    }
    const mobileBtnMissileCd = document.getElementById('btn-rakete-cd');
    if (mobileBtnMissileCd) {
      let pctR = Math.max(0, 100 - (pState.missileCooldown / maxMissileCd) * 100);
      mobileBtnMissileCd.style.height = pctR + '%';
      mobileBtnMissileCd.style.backgroundColor =
        pState.missileCooldown <= 0 ? 'rgba(46, 204, 113, 0.5)' : 'rgba(231, 76, 60, 0.5)';
    }
  } else {
    const missileCdBarP2 = document.getElementById('raketen-cd-balken-p2');
    if (missileCdBarP2) {
      let pctR = Math.max(0, 100 - (pState.missileCooldown / maxMissileCd) * 100);
      missileCdBarP2.style.width = pctR + '%';
      missileCdBarP2.style.backgroundColor = pState.missileCooldown <= 0 ? '#2ecc71' : '#e74c3c';
    }
  }

  if (isGleve) {
    // No missiles; a remembered online fire command must not be left lying around
    if (pKey === 'p2' && state.p2) state.p2.networkFireMissile = false;
    return;
  }

  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  // Online host: the client's held missile key acts like a true in every step
  if (
    pKey === 'p2' &&
    state.p2 &&
    state.p2.missileHeld &&
    state.network &&
    state.network.isOnline &&
    state.network.isHost
  ) {
    state.p2.networkFireMissile = true;
  }
  // Sniper: tap = grenade + EMP, hold = mines (hook); the online host remembers a press even if the release arrives in the same step
  if (Sniper.isSniper(pState)) {
    let held;
    if (pKey === 'p1') {
      held = isDualHumanCoop ? state.keysPressed.v : state.keysPressed.k || state.keysPressed.v;
    } else if (state.network && state.network.isOnline && state.network.isHost) {
      held = Boolean(state.p2.missileHeld || state.p2.networkGrenadeRequest);
      state.p2.networkGrenadeRequest = false;
      state.p2.networkFireMissile = false;
    } else {
      held = state.p2IsBot
        ? state.p2.botFireMissile || false
        : state.keysPressed.ö || state.keysPressed.numpad2 || state.keysPressed[','];
    }
    Sniper.updateGrenadeKey(pState, pKey, Boolean(held));
    Sniper.showGrenadeHud(pKey, pState);
    return;
  }
  const isTriggered =
    pKey === 'p1'
      ? isDualHumanCoop
        ? state.keysPressed.v
        : state.keysPressed.k || state.keysPressed.v
      : state.network && state.network.isOnline && state.network.isHost
        ? Boolean(state.p2 && state.p2.networkFireMissile)
        : state.p2IsBot
          ? state.p2.botFireMissile || false
          : state.keysPressed.ö || state.keysPressed.numpad2 || state.keysPressed[','];

  if (isTriggered && pState.missileCooldown <= 0 && !Hack.hasHack(pState, 'weaponsOffline')) {
    if (pKey === 'p2' && state.p2) state.p2.networkFireMissile = false;
    pState.missileCooldown = maxMissileCd;
    Audio.playMissile();
    let rDamage = 25;
    let rRadius = 80;
    let count = 1;
    if (pState.missileTier >= 2) rDamage = 30;
    if (pState.missileTier >= 3) count = 2;
    if (pState.missileTier >= 4) {
      rRadius = 100;
      rDamage = 35;
    }
    if (pState.missileTier >= 5) count = 3;

    let shipVx = pState.playerVx || 0;
    let shipVy = pState.playerVy || 0;
    let initVy = Math.max(0.5, 2.0 + shipVy * 0.6);

    let offsets = [];
    if (count === 1) {
      const isPhantom = pState.selectedShipModel === 'phantom';
      offsets = [
        {
          ox: isPhantom ? 29 : -9,
          ejectVx: 0,
          homing: false,
        },
      ];
    } else if (count === 2) {
      offsets = [
        {
          ox: -9,
          ejectVx: 0,
          homing: false,
        },
        {
          ox: 29,
          ejectVx: 0,
          homing: pState.missileTier >= 3,
        },
      ];
    } else if (count === 3) {
      offsets = [
        {
          ox: -9,
          ejectVx: 0,
          homing: true,
        },
        {
          ox: 10,
          ejectVx: 0,
          homing: false,
        },
        {
          ox: 29,
          ejectVx: 0,
          homing: true,
        },
      ];
    }
    offsets.forEach(off => {
      let vx = off.ejectVx + shipVx * 0.4;
      arrays.missileArray.push(
        Display.create(
          {
            id: Entities.newId('r'),
            rot: (Math.atan2(-initVy, vx) * 180) / Math.PI + 90,
            tier: pState.missileTier,
            x: pState.x + off.ox,
            y: pState.y,
            vx: vx,
            vy: initVy,
            damage: rDamage,
            radius: rRadius,
            homing: off.homing,
            owner: pKey,
            age: 0,
            detonated: false,
          },
          'missile',
        ),
      );
    });
  }
}

// --- 9.14 BOMBS ---
function throwBombForPlayer(pKey, pState) {
  if (!pState || pState.isDead) return;
  if (pState.bombCooldown > 0) pState.bombCooldown--;
  let maxBombCd = 2400 - pState.bombTier * 240; // 40s - 4s per level

  if (pKey === 'p1') {
    const bombCdBar = document.getElementById('bomben-cd-balken');
    if (bombCdBar) {
      let pctB = Math.max(0, 100 - (pState.bombCooldown / maxBombCd) * 100);
      bombCdBar.style.width = pctB + '%';
      bombCdBar.style.backgroundColor = pState.bombCooldown <= 0 ? '#2ecc71' : '#f39c12';
    }
    const mobileBtnBombCd = document.getElementById('btn-bombe-cd');
    if (mobileBtnBombCd) {
      let pctB = Math.max(0, 100 - (pState.bombCooldown / maxBombCd) * 100);
      mobileBtnBombCd.style.height = pctB + '%';
      mobileBtnBombCd.style.backgroundColor =
        pState.bombCooldown <= 0 ? 'rgba(46, 204, 113, 0.5)' : 'rgba(243, 156, 18, 0.5)';
    }
  } else {
    const bombCdBarP2 = document.getElementById('bomben-cd-balken-p2');
    if (bombCdBarP2) {
      let pctB = Math.max(0, 100 - (pState.bombCooldown / maxBombCd) * 100);
      bombCdBarP2.style.width = pctB + '%';
      bombCdBarP2.style.backgroundColor = pState.bombCooldown <= 0 ? '#2ecc71' : '#f39c12';
    }
  }

  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  // Online host: the client's held bomb key acts like a true in every step
  if (
    pKey === 'p2' &&
    state.p2 &&
    state.p2.bombHeld &&
    state.network &&
    state.network.isOnline &&
    state.network.isHost
  ) {
    state.p2.networkFireBomb = true;
  }
  const isTriggered =
    pKey === 'p1'
      ? isDualHumanCoop
        ? state.keysPressed.c
        : state.keysPressed[' '] || state.keysPressed.c
      : state.network && state.network.isOnline && state.network.isHost
        ? Boolean(state.p2 && state.p2.networkFireBomb)
        : state.p2IsBot
          ? state.p2.botFireBomb || false
          : state.keysPressed.l || state.keysPressed.enter || state.keysPressed.numpad3 || state.keysPressed.numpad0;

  if (isTriggered && pState.bombCooldown <= 0 && !Hack.hasHack(pState, 'weaponsOffline')) {
    if (pKey === 'p2' && state.p2) state.p2.networkFireBomb = false;
    pState.bombCooldown = maxBombCd;
    Audio.playBomb();
    let bDamage = 100 + pState.bombTier * 50;
    let bRadius = 150 + pState.bombTier * 50;
    const tierColors = { 1: '#e74c3c', 2: '#f39c12', 3: '#9b59b6', 4: '#00ffff', 5: '#f1c40f' };
    const tierSpeeds = { 1: 1.5, 2: 1.8, 3: 2.0, 4: 2.3, 5: 2.6 };
    arrays.bombArray.push(
      Display.create(
        {
          id: Entities.newId('b'),
          x: pState.x + 8,
          y: pState.y,
          targetX: config.playfieldWidth / 2 - 7,
          targetY: 285,
          startDist: 0,
          speed: tierSpeeds[pState.bombTier] || 1.5,
          rot: 0,
          damage: bDamage,
          radius: bRadius,
          tier: pState.bombTier,
          color: tierColors[pState.bombTier] || '#f39c12',
          owner: pKey,
          isMini: false,
          beepTimer: 999,
          delayFrames: 0,
        },
        'bomb',
      ),
    );
  }
}

export function updateWeapons(laserActive, laserActiveP2) {
  // Instead of a laser the Gleve has the sweep (gleve.js): neither projectile nor hitscan laser
  if (state.selectedShipModel === 'gleve') laserActive = false;
  if (state.p2 && state.p2.selectedShipModel === 'gleve') laserActiveP2 = false;
  // Instead of a laser the Sniper has the crosshair shot (sniper.js, called from player.js)
  if (state.selectedShipModel === 'sniper') laserActive = false;
  if (state.p2 && state.p2.selectedShipModel === 'sniper') laserActiveP2 = false;
  const allTargets = [
    ...arrays.asteroids,
    ...arrays.enemies,
    ...arrays.bosses,
    ...arrays.bossBombArray,
    ...arrays.bossMissileArray,
  ];

  // --- 9.9 AUTOLASER ---
  if (state.autolaserTimer > 0) {
    state.autolaserTimer--;
    if (state.autolaserTimer <= 0) {
      state.autolaserActive = false;
      Utils.updateActivePowerupsUi();
    }
  }
  if (state.autolaserActive && !Hack.hasHack(state, 'weaponsOffline')) {
    let target = null;
    let minDist = Infinity;
    let sx = state.x + 15;
    let sy = state.y;
    for (let i = 0; i < allTargets.length; i++) {
      let z = allTargets[i];
      if (z.isIndestructible) continue;
      if (z.y + z.size < sy) {
        let tx = z.x + z.size / 2;
        let ty = z.y + z.size / 2;
        let dist = Math.hypot(tx - sx, ty - sy);
        if (dist < minDist) {
          minDist = dist;
          target = z;
        }
      }
    }
    if (target) {
      if (state.autolaserTimer % 10 === 0) {
        Audio.playAutolaser();
      }
      let tx = target.x + target.size / 2;
      let ty = target.y + target.size / 2;
      let dx = tx - sx;
      let dy = ty - sy;
      let dist = Math.hypot(dx, dy);
      let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
      state.autolaserBeam = { x: sx, y: sy, length: dist, angle: angle };
      if (!target.isIndestructible) {
        if ((target.shieldHp || 0) > 0) {
          target.shieldHp -= 1.5;
          if (target.shieldHp <= 0) {
            target.shieldHp = 0;
          }
        } else {
          target.hp -= 1.5;
          Display.flash(target, 2.5);
          if (target.hp <= 0) Utils.destroyTarget(target, 'p1');
        }
      }
    } else {
      state.autolaserBeam = null;
    }
  } else {
    state.autolaserBeam = null;
  }

  // --- 9.12 HITSCAN LASER (Level 5) ---
  if (laserActive && state.laserTier >= 5) {
    let target = null;
    let closestDist = Infinity;
    let sx = state.x + 15;
    let sy = state.y;
    // Find the lowest target directly above the player
    for (let i = 0; i < allTargets.length; i++) {
      let z = allTargets[i];
      if (z.y + z.size < sy && z.x < sx + 10 && z.x + z.size > sx - 10) {
        let dist = sy - (z.y + z.size);
        if (dist < closestDist) {
          closestDist = dist;
          target = z;
        }
      }
    }
    if (target) {
      state.hitscanBeam = { x: sx, y: sy, length: closestDist };
      if (!target.isIndestructible) {
        if ((target.shieldHp || 0) > 0) {
          target.shieldHp -= 5;
          if (target.shieldHp <= 0) {
            target.shieldHp = 0;
          }
        } else {
          target.hp -= 5;
          Display.flash(target, 3);
          if (target.hp <= 0) Utils.destroyTarget(target, 'p1');
        }
      }
    } else {
      state.hitscanBeam = { x: sx, y: sy, length: sy }; // All the way to the top
    }
  } else {
    state.hitscanBeam = null;
  }

  // --- 9.10 MANUAL LASERS (projectiles) ---
  fireLaserForPlayer('p1', state, laserActive);
  if (isCoopMode() && state.p2) {
    fireLaserForPlayer('p2', state.p2, laserActiveP2);
  }

  // --- 9.10b LASER UPDATE & KOLLISION ---
  for (let i = arrays.laserArray.length - 1; i >= 0; i--) {
    let l = arrays.laserArray[i];
    l.x += l.vx;
    l.y -= l.vy;
    l.rot = l.vx !== 0 ? (Math.atan2(-l.vy, l.vx) * 180) / Math.PI + 90 : 0;
    if (l.y < -30 || l.x < -30 || l.x > config.playfieldWidth + 30) {
      Display.remove(l);
      arrays.laserArray.splice(i, 1);
      continue;
    }

    // Kollision
    let hitTarget = null;
    for (let j = 0; j < allTargets.length; j++) {
      let z = allTargets[j];
      if (z === l.ignoreTarget) continue; // Ignore the target after a bounce
      if ((z.immune || 0) <= 0) {
        let padding = z.isBoss ? z.size * 0.15 : 0;
        if (
          l.x < z.x + z.size - padding &&
          l.x + l.width > z.x + padding &&
          l.y < z.y + z.size - padding &&
          l.y + l.height > z.y + padding
        ) {
          hitTarget = z;
          break; // Hit the first target
        }
      }
    }
    if (hitTarget) {
      if (!hitTarget.isIndestructible) {
        if ((hitTarget.shieldHp || 0) > 0) {
          hitTarget.shieldHp -= l.damage;
          if (hitTarget.shieldHp <= 0) {
            hitTarget.shieldHp = 0;
            for (let k = 0; k < 5; k++) {
              Utils.createSmokeSparks(hitTarget.x + 15, hitTarget.y + 15, 10);
            }
          }
          Display.flash(hitTarget, 2.2);
        } else {
          hitTarget.hp -= l.damage;
          Display.flash(hitTarget, 2.5);
          if (hitTarget.hp <= 0) Utils.destroyTarget(hitTarget, l.owner || 'p1');
        }
        // Pierce: flag of the projectile (powerup or Viper overdrive), otherwise the global powerup as before (e.g. Gleve throwback)
        if (!l.pierce && !state.laserPierce) {
          Display.remove(l);
          arrays.laserArray.splice(i, 1);
        }
      } else {
        // Bounce logic (magma asteroids etc.)
        Audio.playHit('magma');
        // Ricochets now mostly keep flying upwards,
        // with a slight to medium deflection to the left or right.
        l.vy = 8 + Math.random() * 7; // vy between 8 and 15 (upwards)
        l.vx = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 6); // vx slightly to the side (2 to 8)

        l.isDeflected = true;
        l.ignoreTarget = hitTarget; // Prevents endless colliding in the same frame
        l.damage = Math.max(1, l.damage / 2); // Damage is halved
        l.color = '#e67e22'; // Tint orange/reddish
      }
    } else if (l.isDeflected) {
      // Collision with a player if deflected: only the shooter itself, no friendly fire in co-op
      const shooter = l.owner === 'p2' ? state.p2 : state;
      const hitsShooters = (l.owner !== 'p2' || isCoopMode()) && shooter && !shooter.isDead;
      if (
        hitsShooters &&
        !Utils.isDashInvulnerable(shooter) &&
        l.x < shooter.x + config.playerSize &&
        l.x + l.width > shooter.x &&
        l.y < shooter.y + config.playerSize &&
        l.y + l.height > shooter.y
      ) {
        Utils.playerHit(l, false, l.owner === 'p2' ? 'p2' : 'p1');
        Display.remove(l);
        arrays.laserArray.splice(i, 1);
      }
    }
  }

  // Gleve: running sweeps (hits, parry; started in player.js)
  if (Gleve.isGleve(state)) Gleve.updateSweep(state, 'p1');
  if (isCoopMode() && state.p2 && Gleve.isGleve(state.p2)) Gleve.updateSweep(state.p2, 'p2');
  Gleve.updateWaves();

  // --- 9.13 MISSILES ---
  fireMissileForPlayer('p1', state);
  if (isCoopMode() && state.p2) {
    fireMissileForPlayer('p2', state.p2);
  }

  // Missile update & collision (3-phase flight dynamics, proximity fuse & homing)
  for (let i = arrays.missileArray.length - 1; i >= 0; i--) {
    let r = arrays.missileArray[i];
    r.age = (r.age || 0) + 1;

    // 3-phase flight dynamics:
    // Phase 1 (frames 1-10): lateral release / detach, inherits the ship velocity
    if (r.age <= 10) {
      r.x += r.vx;
      r.y -= r.vy;
      r.vx *= 0.95;
    }
    // Phase 2 (Frames 11-18): Kurzes Verlangsamen ("Anlauf nehmen" & Triebwerkszündung)
    else if (r.age <= 18) {
      r.vx *= 0.82;
      r.vy = Math.max(0.3, r.vy * 0.85);
      r.x += r.vx;
      r.y -= r.vy;
    }
    // Phase 3 (Frames 19+): Starke, lineare Beschleunigung (Triebwerks-Vollschub)
    else {
      // In co-op (600px field) missiles accelerate harder to make up for the wider field
      const rMaxVy = isCoopMode() ? 15 : 13;
      const rAccel = isCoopMode() ? 0.5 : 0.45;
      r.vy = Math.min(rMaxVy, r.vy + rAccel);
      r.vx *= 0.92;

      // Homing steering (only against enemies and bosses) active from phase 3 on
      if (r.homing) {
        let bestDist = Infinity;
        let target = null;
        const enemyTargets = [...arrays.enemies, ...arrays.bosses];
        for (let f of enemyTargets) {
          if (!f.isIndestructible && (f.immune || 0) <= 0) {
            let zcx = f.x + (f.size || 20) / 2;
            let zcy = f.y + (f.size || 20) / 2;
            let d = Math.hypot(zcx - (r.x + 3), zcy - (r.y + 8));
            // Capture enemies ahead of or level with the missile
            // In co-op (600px) use a larger search range so enemies at the wide edge are found
            const homingYRange = isCoopMode() ? 200 : 140;
            if (d < bestDist && zcy < r.y + homingYRange) {
              bestDist = d;
              target = f;
            }
          }
        }

        if (target) {
          let zcx = target.x + (target.size || 20) / 2;
          let zcy = target.y + (target.size || 20) / 2;
          let targetAngle = Math.atan2(zcy - (r.y + 8), zcx - (r.x + 3));
          let currentAngle = Math.atan2(-r.vy, r.vx || 0.0001);
          let diff = targetAngle - currentAngle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;

          // In co-op a stronger steering rate so missiles can make up the larger horizontal distance
          let maxTurn = isCoopMode() ? 0.26 : 0.22;
          let newAngle = currentAngle + Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
          let currentSpeed = Math.hypot(r.vx, r.vy) || r.vy;
          r.vx = Math.cos(newAngle) * currentSpeed;
          r.vy = -Math.sin(newAngle) * currentSpeed;
        }
      }

      r.x += r.vx;
      r.y -= r.vy;
    }

    // Raketenausrichtung (Flugrichtung)
    r.rot = (Math.atan2(-r.vy, r.vx || 0.0001) * 180) / Math.PI + 90;

    // Particle trail (smoke on release, full fire in phase 3)
    let flameProb = r.age > 18 ? 0.85 : r.age > 10 ? 0.45 : 0.2;
    if (Math.random() < flameProb) {
      let color;
      if (r.homing && r.age > 18) {
        color = Math.random() < 0.5 ? '#00ffff' : '#3498db';
      } else if (r.age > 18) {
        color = Math.random() < 0.6 ? '#f1c40f' : '#e74c3c';
      } else {
        color = '#7f8c8d'; // Smoke on drop
      }
      createParticles({
        color,
        x: r.x + 2 + Math.random() * 4,
        y: r.y + 20,
        vx: (Math.random() - 0.5) * 0.5,
        vy: 0.5 + Math.random(),
        lives: 1.0,
        decay: 0.04,
      });
    }

    if (r.y < -40 || r.x < -50 || r.x > config.playfieldWidth + 50 || r.y > config.playfieldHeight + 50) {
      Display.remove(r);
      arrays.missileArray.splice(i, 1);
      continue;
    }

    // Check proximity fuse & direct hit
    let detonated = false;
    let rcx = r.x + 3;
    let rcy = r.y + 8;

    for (let j = 0; j < allTargets.length; j++) {
      let z = allTargets[j];
      if ((z.immune || 0) <= 0) {
        let zcx = z.x + (z.size || 20) / 2;
        let zcy = z.y + (z.size || 20) / 2;
        let dist = Math.hypot(zcx - rcx, zcy - rcy);
        // Proximity ignition on approach
        if (dist < (z.size || 20) / 2 + 18) {
          detonated = true;
          break;
        }
      }
    }

    if (detonated) {
      Utils.createMissileDetonation(rcx, rcy, r.radius);
      if (state.gameMode === 'online') {
        Network.sendNetworkEvent({
          type: 'missile_detonated',
          x: rcx,
          y: rcy,
          radius: r.radius,
        });
      }

      // Area damage
      for (let j = 0; j < allTargets.length; j++) {
        let z = allTargets[j];
        if ((z.immune || 0) <= 0) {
          let zcx = z.x + (z.size || 20) / 2;
          let zcy = z.y + (z.size || 20) / 2;
          if (Math.hypot(zcx - rcx, zcy - rcy) <= r.radius) {
            if (!z.isIndestructible) {
              if ((z.shieldHp || 0) > 0) {
                z.shieldHp -= r.damage;
                if (z.shieldHp <= 0) {
                  z.shieldHp = 0;
                  for (let k = 0; k < 5; k++) Utils.createSmokeSparks(z.x + 15, z.y + 15, 10);
                }
                Display.flash(z, 2.2);
              } else {
                z.hp -= r.damage;
                Display.flash(z, 2.5);
                if (z.hp <= 0) Utils.destroyTarget(z, r.owner || 'p1');
              }
            }
          }
        }
      }
      Display.remove(r);
      arrays.missileArray.splice(i, 1);
    }
  }

  // --- 9.14 BOMBS ---
  throwBombForPlayer('p1', state);
  if (isCoopMode() && state.p2) {
    throwBombForPlayer('p2', state.p2);
  }
  for (let i = arrays.bombArray.length - 1; i >= 0; i--) {
    let b = arrays.bombArray[i];

    // Mini bombs can have a delay
    if (b.delayFrames > 0) {
      b.delayFrames--;
    }

    // EMP effect for levels 4 and 5: wipes out enemy lasers immediately
    if (b.tier >= 4) {
      for (let l = arrays.enemyLaserArray.length - 1; l >= 0; l--) {
        let fl = arrays.enemyLaserArray[l];
        Utils.createExplosion(fl.x, fl.y, b.color, 2);
        Display.remove(fl);
        arrays.enemyLaserArray.splice(l, 1);
      }
      for (let l = arrays.bossLaserArray.length - 1; l >= 0; l--) {
        let bl = arrays.bossLaserArray[l];
        Utils.createExplosion(bl.x, bl.y, b.color, 2);
        Display.remove(bl);
        arrays.bossLaserArray.splice(l, 1);
      }
    }

    let dx = b.targetX - (b.x + (b.isMini ? 5 : 7));
    let dy = b.targetY - (b.y + (b.isMini ? 10 : 15));
    let dist = Math.hypot(dx, dy);
    if (b.startDist === 0) b.startDist = dist;

    // Tier 3: vortex gravity pull before the explosion
    if (b.tier === 3 && dist < 80) {
      let bcx = b.x + 7;
      let bcy = b.y + 15;
      allTargets.forEach(z => {
        let zcx = z.x + (z.size || 20) / 2;
        let zcy = z.y + (z.size || 20) / 2;
        let pullDx = bcx - zcx;
        let pullDy = bcy - zcy;
        let pullDist = Math.hypot(pullDx, pullDy);
        if (pullDist > 5 && pullDist < 160) {
          z.x += (pullDx / pullDist) * 1.5;
          z.y += (pullDy / pullDist) * 1.5;
        }
      });
    }

    if (dist > 5 && (!b.isMini || b.delayFrames > 0)) {
      b.x += (dx / dist) * b.speed;
      b.y += (dy / dist) * b.speed;
      b.rot += b.isMini ? 5 : 2;

      // Increase blink & aura pulse speed the closer to the target
      // Progress 1 -> 0 towards the target (bomb pulse in the display, beep cadence)
      const progress = (b.progress = dist / (b.startDist || 1));

      // Speed up the beep cadence the closer to the target
      let urgency = 1.0 - progress;
      b.beepTimer = (b.beepTimer || 0) + 1;
      let beepInterval = Math.max(3, Math.floor(progress * 22));
      if (b.beepTimer >= beepInterval) {
        b.beepTimer = 0;
        Audio.playBombBeep(urgency, false);
      }
    } else {
      // Level 5 Jericho split: the main bomb splits into 4 sub-bombs
      if (b.tier === 5 && !b.isMini) {
        let bcx = b.x + 7;
        let bcy = b.y + 15;
        Utils.createExplosion(bcx, bcy, '#ffffff', 40);

        // 4 Jericho mini bombs fan out diagonally
        const offsets = [
          { ox: -75, oy: -65, delay: 10 },
          { ox: 75, oy: -65, delay: 16 },
          { ox: -75, oy: 65, delay: 22 },
          { ox: 75, oy: 65, delay: 28 },
        ];

        offsets.forEach(off => {
          arrays.bombArray.push(
            Display.create(
              {
                id: Entities.newId('b'),
                x: bcx - 5,
                y: bcy - 10,
                targetX: Math.max(20, Math.min(config.playfieldWidth - 20, bcx + off.ox)),
                targetY: Math.max(20, Math.min(config.playfieldHeight - 20, bcy + off.oy)),
                startDist: 0,
                speed: 3.5,
                rot: Math.random() * 360,
                damage: 220,
                radius: 200,
                tier: 5,
                color: '#f1c40f',
                isMini: true,
                delayFrames: off.delay,
              },
              'bomb',
            ),
          );
        });

        Display.remove(b);
        arrays.bombArray.splice(i, 1);
        continue;
      }

      // Detonation
      let bcx = b.x + (b.isMini ? 5 : 7);
      let bcy = b.y + (b.isMini ? 10 : 15);
      Utils.createBombDetonation(bcx, bcy, b.color || '#f39c12', b.radius, b.tier, b.isMini);
      if (state.gameMode === 'online') {
        Network.sendNetworkEvent({
          type: 'bomb_detonated',
          x: bcx,
          y: bcy,
          color: b.color || '#f39c12',
          radius: b.radius,
          tier: b.tier,
          isMini: b.isMini,
        });
      }

      for (let j = 0; j < allTargets.length; j++) {
        let z = allTargets[j];
        if ((z.immune || 0) <= 0) {
          let zcx = z.x + z.size / 2;
          let zcy = z.y + z.size / 2;
          if (Math.hypot(zcx - bcx, zcy - bcy) <= b.radius) {
            if (z.isIndestructible && z.hp !== undefined && !z.isBoss) {
              // Bombs destroy magma asteroids (they become powerup carriers)
              z.isIndestructible = false;
              z.carriesPowerup = true;
            }
            if (!z.isIndestructible) {
              if ((z.shieldHp || 0) > 0) {
                z.shieldHp = 0;
              }
              z.hp -= b.damage;
              Display.flash(z, 3);
              if (z.hp <= 0) Utils.destroyTarget(z, b.owner || 'p1');
            }
          }
        }
      }
      Display.remove(b);
      arrays.bombArray.splice(i, 1);
    }
  }
}
