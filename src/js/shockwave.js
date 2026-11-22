import { state, config, arrays } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Network from './network.js';
import * as Display from './display.js';
import { createEffect } from './effects.js';

// Shockwave powerup: a ring runs from the pickup point to the farthest field corner in WAVE_DURATION steps.
// What the ring reaches: enemies explode (kill for the collector), enemy and boss projectiles vanish,
// bosses lose BOSS_DAMAGE_SHARE of their max HP once (but do not die). Asteroids stay.
// The ring is an effect (arrays.effects, kind shockwave); hit remembers the captured targets.

export const WAVE_DURATION = 36;

// Bonus drop (chain bonus, egg capsule): a shockwave with SHOCKWAVE_CHANCE, at most one per level and
// never during the boss fight; otherwise null (random powerup)
export const SHOCKWAVE_CHANCE = 0.35;
export function bonusType() {
  if (state.bossActive || state.shockwaveLevel === state.level) return null;
  if (Math.random() >= SHOCKWAVE_CHANCE) return null;
  state.shockwaveLevel = state.level;
  return 'shockwave';
}

export const BOSS_DAMAGE_SHARE = 0.15;

const PROJECTILE_LISTEN = [
  'enemyLaserArray',
  'hackProjectileArray',
  'bossLaserArray',
  'bossMissileArray',
  'bossBombArray',
];

function farthestCorner(x, y) {
  const b = config.playfieldWidth;
  const h = config.playfieldHeight;
  return Math.max(Math.hypot(x, y), Math.hypot(b - x, y), Math.hypot(x, h - y), Math.hypot(b - x, h - y));
}

// Ring, flash and sound (host and online client)
function show(x, y, radius) {
  Display.flashPlayfield('#ffffff', 90);
  Audio.playShockwave();
  return createEffect({ kind: 'shockwave', x, y, radius, rest: WAVE_DURATION });
}

// Host/solo: trigger the wave with hit logic; owner = collector (kills count for them)
export function trigger(x, y, owner = 'p1') {
  const radius = farthestCorner(x, y);
  const wave = show(x, y, radius);
  wave.owner = owner;
  wave.hit = new Set();
  if (state.gameMode === 'online') Network.sendNetworkEvent({ type: 'shockwave', x, y, radius });
  return wave;
}

// Online client: display only
export function showShockwave(data) {
  show(data.x, data.y, data.radius);
}

function middle(o) {
  const g = o.size || 0;
  const w = o.width || g;
  const h = o.height || g;
  return { x: o.x + w / 2, y: o.y + h / 2 };
}

// Current ring radius: grows linearly, already a bit in the first step
export function currentRadius(wave) {
  return (wave.radius * (wave.duration - wave.rest + 1)) / wave.duration;
}

// Every host step before updateEffects: captures what the ring newly reaches
export function updateShockwaves() {
  for (const wave of arrays.effects) {
    if (wave.kind !== 'shockwave' || !wave.hit) continue;
    const r = currentRadius(wave);
    const inRing = o => {
      const m = middle(o);
      return Math.hypot(m.x - wave.x, m.y - wave.y) <= r;
    };

    for (const f of arrays.enemies.slice()) {
      // closed blooms (isIndestructible) survive the wave
      if (wave.hit.has(f) || f.chainT < 0 || f.isIndestructible || !inRing(f)) continue;
      wave.hit.add(f);
      Utils.destroyTarget(f, wave.owner);
    }

    for (const b of arrays.bosses) {
      if (wave.hit.has(b) || b.isIndestructible || !inRing(b)) continue;
      wave.hit.add(b);
      b.hp = Math.max(1, b.hp - Math.ceil(b.maxHp * BOSS_DAMAGE_SHARE));
      Display.flash(b, 1);
    }

    for (const name of PROJECTILE_LISTEN) {
      const list = arrays[name];
      for (let i = list.length - 1; i >= 0; i--) {
        if (!inRing(list[i])) continue;
        Display.remove(list[i]);
        list.splice(i, 1);
      }
    }
  }
}
