// Effects with a lifetime (shockwaves etc.): pure models in arrays.effects, no DOM.
// The logic counts rest down per simulation step, the backend draws size and opacity
// from the progress (see display-dom.js drawEffect). Effects therefore freeze with the world.
import { arrays } from './state.js';
import * as Display from './display.js';

// New effect: payload = { kind, x, y, rest, ... }; rest is the lifetime in steps (becomes duration).
// Optional delay (steps during which the effect is still invisible; they count towards the lifetime)
// and pKey (owner, for removeEffects).
export function createEffect(payload) {
  const effect = { ...payload, duration: payload.rest };
  arrays.effects.push(Display.create(effect, 'effect'));
  return effect;
}

export function updateEffects() {
  for (let i = arrays.effects.length - 1; i >= 0; i--) {
    const e = arrays.effects[i];
    e.rest--;
    if (e.rest <= 0) {
      Display.remove(e);
      arrays.effects.splice(i, 1);
    }
  }
}

// Remove all effects; with pKey only this player's
export function removeEffects(pKey) {
  for (let i = arrays.effects.length - 1; i >= 0; i--) {
    const e = arrays.effects[i];
    if (pKey !== undefined && e.pKey !== pKey) continue;
    Display.remove(e);
    arrays.effects.splice(i, 1);
  }
}
