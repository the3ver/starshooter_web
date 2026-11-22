import { state, dom, config, arrays, isCoopMode } from './state.js';
import * as Audio from './audio.js';
import * as Display from './display.js';

// Stable object IDs so the online client can reuse DOM elements between snapshots
let idCounter = 0;
export function newId(prefix) {
  return `${prefix}_${++idCounter}`;
}

// Random asteroid outline: corner points [x, y] in percent of the size (one decimal place)
// Outline in percent of the edge length: 8-13 corners with an irregular radius, occasionally stretched
// (factor 0.72-1 along a random axis) and with one deep dent (chipped off)
export function generateAsteroidForm() {
  const points = [];
  const countCorners = Math.floor(Math.random() * 6) + 8;
  const stretch = Math.random() < 0.45 ? 0.72 + Math.random() * 0.28 : 1;
  const axis = Math.random() * Math.PI;
  const notch = Math.random() < 0.35 ? Math.floor(Math.random() * countCorners) : -1;
  const offset = Math.random() * Math.PI * 2;
  for (let i = 0; i < countCorners; i++) {
    const angle = offset + (i / countCorners) * Math.PI * 2;
    let radius = i === notch ? 0.5 + Math.random() * 0.12 : 0.74 + Math.random() * 0.26;
    // Stretch: the share along the axis stays, across it shrinks
    const across = Math.sin(angle - axis);
    radius *= Math.sqrt(1 - (1 - stretch * stretch) * across * across);
    const px = 50 + Math.cos(angle) * 50 * radius;
    const py = 50 + Math.sin(angle) * 50 * radius;
    points.push([Math.round(px * 10) / 10, Math.round(py * 10) / 10]);
  }
  return points;
}

// Outline for the network: "x y,x y,..." and back
export function formAsText(form) {
  return form.map(([px, py]) => `${px} ${py}`).join(',');
}
export function formFromText(text) {
  return text.split(',').map(pair => pair.split(' ').map(Number));
}

// Glow color of a powerup (frame, screen flash on pickup)
const POWERUP_COLORS = {
  lives: '#e74c3c',
  energy: '#f1c40f',
  pierce: '#00ffff',
  shield: '#3498db',
  laserWeapon: '#9b59b6',
  laser: '#9b59b6',
  missileWeapon: '#e67e22',
  missile: '#e67e22',
  bombWeapon: '#c0392b',
  bomb: '#c0392b',
  autolaser: '#f39c12',
  superWeapon: '#ffffff',
  splitterRed: '#e74c3c',
  splitterWhite: '#ffffff',
  shockwave: '#7fffd4',
};
export function powerupColor(type) {
  return POWERUP_COLORS[type] || '#f1c40f';
}

let nextCoopLootOwner = 'p1';

export function createPowerup(px, py, forceType = null, forceOwner = null) {
  const puTypes = ['lives', 'energy', 'pierce', 'shield', 'laserWeapon', 'missileWeapon', 'bombWeapon'];
  if (state.laserTier >= 5) puTypes.push('autolaser');
  let rawType = forceType ? forceType : puTypes[Math.floor(Math.random() * puTypes.length)];

  // Normalisiere Kurzbezeichnungen
  let type = rawType;
  if (rawType === 'laser') type = 'laserWeapon';
  else if (rawType === 'missile') type = 'missileWeapon';
  else if (rawType === 'bomb') type = 'bombWeapon';

  let owner = null;
  if (isCoopMode()) {
    if (forceOwner) {
      owner = forceOwner;
    } else if (state.isDead && state.p2 && !state.p2.isDead) {
      owner = 'p2';
    } else if (state.p2 && state.p2.isDead && !state.isDead) {
      owner = 'p1';
    } else {
      owner = nextCoopLootOwner;
      nextCoopLootOwner = nextCoopLootOwner === 'p1' ? 'p2' : 'p1';
    }
  }

  arrays.powerups.push(
    Display.create(
      {
        id: newId('pu'),
        x: px,
        y: py,
        size: 24,
        vy: 2,
        type: type,
        color: powerupColor(type),
        owner: owner,
      },
      'powerup',
    ),
  );
}
export function createAsteroid(
  startX,
  startY,
  startSize,
  startVx,
  startVy,
  immuneFrames = 0,
  forceDestructible = false,
) {
  const size = startSize !== undefined ? startSize : Math.random() * 30 + 15;
  let isMagma = false;
  let isIndestructible = false;
  let carriesPowerup = false;
  if (!forceDestructible && Math.random() < 0.2) {
    isMagma = true;
    if (Math.random() < 0.3) {
      carriesPowerup = true;
      isIndestructible = false;
    } else {
      isIndestructible = true;
    }
  }
  // Gradient (color -> color2), outline and crack pattern are model data; the display draws from them
  let color, color2;
  if (isMagma) {
    let c = config.magmaBasisColors[Math.floor(Math.random() * config.magmaBasisColors.length)];
    color = c.a;
    color2 = c.b;
  } else {
    const palette = config.asteroidsPalettes[Math.floor(Math.random() * config.asteroidsPalettes.length)];
    color = palette.a;
    color2 = palette.b;
  }
  const form = generateAsteroidForm();
  const finalX = startX !== undefined ? startX : Math.random() * (config.playfieldWidth - size);
  const finalY = startY !== undefined ? startY : -size;
  const crack = isIndestructible ? null : Math.floor(Math.random() * config.crackPattern.length);
  let startHp = size * 1.2;
  if (carriesPowerup) startHp *= 3;
  let computedVx = startVx !== undefined ? startVx : (Math.random() - 0.5) * 4;
  // SLOWER SCALING: asteroids fall only slightly faster in higher levels
  let computedVy = startVy !== undefined ? startVy : Math.random() * 1.5 + 1.0 + state.level * 0.1;
  if (carriesPowerup && startVx === undefined) computedVx = Math.random() - 0.5;
  let startRot = Math.random() * 360;
  let vRot = (Math.random() - 0.5) * 3;
  arrays.asteroids.push(
    Display.create(
      {
        id: newId('a'),
        x: finalX,
        y: finalY,
        size: size,
        vx: computedVx,
        vy: computedVy,
        immune: immuneFrames,
        hp: startHp,
        maxHp: startHp,
        isMagma: isMagma,
        isIndestructible: isIndestructible,
        carriesPowerup: carriesPowerup,
        color,
        color2,
        form,
        crack,
        isEnemy: false,
        rot: startRot,
        vRot: vRot,
      },
      'asteroid',
    ),
  );
}
export function getEnemyColor(pattern = 'normal') {
  if (pattern === 'stopAndGo') return '#e67e22';
  if (pattern === 'crossfire') return '#1abc9c';
  if (pattern === 'swoop') return '#2ecc71';
  if (pattern === 'hacker') return '#39ff14';
  if (pattern === 'chain') return '#d9822b';
  if (pattern === 'spikeChain') return '#7d8f5a';
  if (pattern === 'ballChain') return '#9b6ad0';
  if (pattern === 'crab') return '#d0532a';
  if (pattern === 'tentacler') return '#b06ad8';
  return '#9b59b6';
}

export function createEnemy(sX, sY, forcePattern = null, forceVx = 0, forceShield = null) {
  let pattern = forcePattern !== null ? forcePattern : 'normal';
  let stopY = 0;
  if (forcePattern === null && state.level >= 1 && Math.random() < Math.min(0.6, state.level * 0.2)) {
    pattern = 'stopAndGo';
  }
  if (pattern === 'stopAndGo') {
    stopY = 80 + Math.random() * 120;
  } else if (pattern === 'hacker') {
    stopY = 100 + Math.random() * 100;
  }

  let hasShield = false;
  if (pattern === 'hacker') {
    hasShield = false;
  } else if (forceShield !== null) {
    hasShield = forceShield;
  } else if (state.level >= 3 && Math.random() < Math.min(0.5, (state.level - 2) * 0.15)) {
    hasShield = true;
  }

  const startX = sX !== undefined ? sX : Math.random() * (config.playfieldWidth - 30);
  const startY = sY !== undefined ? sY : -30;
  let shotBasis = Math.max(25, 60 - (state.level - 1) * 8);
  const enemyHpMult = isCoopMode() ? 1.25 : 1.0;
  const enemyHp = Math.round(20 * enemyHpMult);
  const enemyShieldHp = hasShield ? Math.round(20 * enemyHpMult) : 0;
  arrays.enemies.push(
    Display.create(
      {
        id: newId('f'),
        x: startX,
        y: startY,
        size: 30,
        hp: enemyHp,
        maxHp: enemyHp,
        shieldHp: enemyShieldHp,
        maxShieldHp: enemyShieldHp,
        hasShield: hasShield,
        color: getEnemyColor(pattern),
        vy: 1.2,
        vx: forceVx,
        basisX: startX,
        time: 0,
        shotTimer: Math.random() * shotBasis + shotBasis,
        burstCount: 0,
        burstTimer: 0,
        isEnemy: true,
        isIndestructible: false,
        carriesPowerup: Math.random() < (pattern === 'hacker' ? 0.4 : 0.2),
        pattern: pattern,
        phase: 'approach',
        stopTimer: 0,
        stopY: stopY,
        lurkTimer: 0,
        hackTimer: 0,
        hackShots: 0,
        hackLanded: false,
      },
      'enemy',
    ),
  );
}

export function createClingOnEnemy() {
  let size = Math.random() * 20 + 30; // 30-50
  // Create a guaranteed destructible (gray) asteroid
  createAsteroid(undefined, undefined, size, undefined, undefined, 0, true);
  let ast = arrays.asteroids[arrays.asteroids.length - 1]; // Most recently created asteroid

  // Create the enemy at the asteroid's position
  createEnemy(ast.x, ast.y, 'clingOn', 0);
  let f = arrays.enemies[arrays.enemies.length - 1];
  f.attachedAsteroid = ast;
  f.phase = 'attached';
  f.shotTimer = 9999; // Does not shoot while it clings
}
export function createHackProjectile(fx, fy, targetX, targetY, source = null) {
  const speed = 3;
  let dx = targetX - fx;
  let dy = targetY - fy;
  let dist = Math.hypot(dx, dy) || 1;
  arrays.hackProjectileArray.push(
    Display.create(
      {
        id: newId('hp'),
        x: fx,
        y: fy,
        vx: (dx / dist) * speed,
        vy: (dy / dist) * speed,
        width: 12,
        height: 12,
        source: source,
        steerTime: 90, // 1,5 s Zielsuche, danach geradeaus
      },
      'hackProjectile',
    ),
  );
}

export function createEnemyLaser(fx, fy, targetX = null, targetY = null) {
  Audio.playEnemyLaser();
  let vx = 0;
  let vy = 7;
  let rot;
  if (targetX !== null && targetY !== null) {
    let dx = targetX - fx;
    let dy = targetY - fy;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      vx = (dx / dist) * 7;
      vy = (dy / dist) * 7;
    }
    rot = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
  }
  arrays.enemyLaserArray.push(
    Display.create(
      {
        id: newId('fl'),
        x: fx,
        y: fy,
        vx: vx,
        vy: vy,
        width: 4,
        height: 15,
        rot,
      },
      'enemyLaser',
    ),
  );
}

// --- BOSS SCALING & LOOK ---
export function getBossColor(level = 1) {
  return config.bossColors[(level - 1) % config.bossColors.length];
}

export function createBoss() {
  state.bossActive = true;
  dom.bossHpContainer.style.display = 'block';
  dom.bossHpBar.style.width = '100%';
  dom.bossHpBar.style.backgroundColor = '#e74c3c';

  // Determine boss type based on level
  let bType = state.level % 4;
  if (bType === 0) bType = 4; // 1, 2, 3, 4, 1, 2, ...

  let bossSize = 100 + (state.level - 1) * 10;
  bossSize = Math.min(bossSize, 160); // Cap the maximum size
  let startX = config.playfieldWidth / 2 - bossSize / 2;

  // SCALING: HP grows moderately in co-op mode (+40%), standard in solo mode
  const bossHpMult = isCoopMode() ? 1.4 : 1.0;
  let bossHp = Math.round((400 + (state.level - 1) * 350) * bossHpMult);
  let bossVx = 2 + (state.level - 1) * 0.2;
  let shotRhythmus = Math.max(45, 90 - (state.level - 1) * 10);
  arrays.bosses.push(
    Display.create(
      {
        id: newId('boss'),
        x: startX,
        y: -150,
        size: bossSize,
        hp: bossHp,
        maxHp: bossHp,
        vx: bossVx,
        vy: 1,
        phase: 'entry',
        shotTimer: 60,
        baseShotRate: shotRhythmus,
        isEnemy: false,
        isBoss: true,
        isIndestructible: false,
        bossType: bType,
        glowColor: getBossColor(state.level),
        enragePhaseActive: false,
        hackTimer: 180, // erster Hack-Orb nach 3 s Kampf (ab Level 5)
      },
      'boss',
    ),
  );
}
export function createBossLaser(fx, fy, vx = 0, vy = 6) {
  Audio.playBossLaser();
  arrays.bossLaserArray.push(
    Display.create(
      {
        id: newId('bl'),
        rot: vx !== 0 ? (Math.atan2(vy, vx) * 180) / Math.PI - 90 : undefined,
        x: fx,
        y: fy,
        vx: vx,
        vy: vy,
        width: 8,
        height: 25,
      },
      'bossLaser',
    ),
  );
}

export function createBossBomb(bx, by) {
  Audio.playBossBombLaunch();

  let bHp = 20 + state.level * 5;
  arrays.bossBombArray.push(
    Display.create(
      {
        id: newId('bb'),
        x: bx,
        y: by,
        size: 26,
        hp: bHp,
        maxHp: bHp,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 1.3,
        timer: 180, // 3 Sekunden bis Detonation
        maxTimer: 180,
        beepTimer: 999,
        radius: 90,
        isBossBomb: true,
        isIndestructible: false,
        immune: 0,
      },
      'bossBomb',
    ),
  );
}

export function createBossMissile(bx, by, sideDirection = 1) {
  Audio.playBossRocketLaunch();
  let initVx = sideDirection * (3.0 + Math.random() * 1.0);
  let initVy = 0.8 + Math.random() * 0.4;
  let rHp = 15;
  arrays.bossMissileArray.push(
    Display.create(
      {
        id: newId('br'),
        x: bx,
        y: by,
        size: 18,
        width: 14,
        height: 24,
        hp: rHp,
        maxHp: rHp,
        vx: initVx,
        vy: initVy,
        turnRate: 0.045,
        speed: 2.3,
        age: 0,
        isBossMissile: true,
        isIndestructible: false,
        immune: 0,
      },
      'bossMissile',
    ),
  );
}
// ------------------------------
