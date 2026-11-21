import { arrays } from './state.js';
import * as Display from './display.js';

// New particle (model): x, y, vx, vy, lives (1 = full), decay per step; look via
// sort ('spark' default, 'gleveFlash', 'gleveAfterimage', 'gleveFan' with length/arc, 'viperAfterimage',
// 'nearMissPlus', 'launcher'),
// color, optional size (px) and glow (glow in color), rot/vRot for rotating parts
export function createParticles(p) {
  arrays.particleArray.push(Display.create(p, 'particles'));
}

export function animateParticles() {
  for (let i = arrays.particleArray.length - 1; i >= 0; i--) {
    let p = arrays.particleArray[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.lives -= p.decay;
    if (p.lives <= 0) {
      Display.remove(p);
      arrays.particleArray.splice(i, 1);
    } else if (p.vRot) {
      p.rot = (p.rot || 0) + p.vRot;
    }
  }
}
