import { arrays } from './state.js';
import * as Anzeige from './anzeige.js';


export function animierenPartikel() {
  for (let i = arrays.partikelArray.length - 1; i >= 0; i--) {
    let p = arrays.partikelArray[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.leben -= p.zerfall;
    if (p.leben <= 0) {
      Anzeige.entferne(p);
      arrays.partikelArray.splice(i, 1);
    } else if (p.vRot) {
      p.rot = (p.rot || 0) + p.vRot;
    }
  }
}
