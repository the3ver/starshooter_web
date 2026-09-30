
import { arrays } from './state.js';


export function animierenPartikel() {
  for (let i = arrays.partikelArray.length - 1; i >= 0; i--) {
    let p = arrays.partikelArray[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.leben -= p.zerfall;
    if (p.leben <= 0) {
      if (p.el) p.el.remove();
      arrays.partikelArray.splice(i, 1);
    } else {
      if (p.el) {
        p.el.style.left = p.x + 'px';
        p.el.style.top = p.y + 'px';
        p.el.style.opacity = p.leben;
        if (p.vRot) {
          p.rot = (p.rot || 0) + p.vRot;
          p.el.style.transform = `scale(${p.leben}) rotate(${p.rot}deg)`;
        } else {
          p.el.style.transform = `scale(${p.leben})`;
        }
      }
    }
  }
}
