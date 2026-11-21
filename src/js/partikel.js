import { arrays } from './state.js';
import * as Display from './anzeige.js';

// Neues Partikel (Modell): x, y, vx, vy, leben (1 = voll), zerfall pro Schritt; Aussehen ueber
// sorte ('funke' Standard, 'gleveBlitz', 'gleveNachbild', 'gleveFaecher' mit laenge/bogen, 'viperNachbild',
// 'nearMissPlus', 'werfer'),
// farbe, optional groesse (px) und glow (Leuchten in farbe), rot/vRot fuer drehende Teile
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
