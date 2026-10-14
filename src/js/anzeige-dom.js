// DOM-Backend der Anzeige (siehe anzeige.js): Weltobjekte sind absolut positionierte Elemente in
// #spielfeld, das Modell traegt sein Element in obj.el. Nur dieses Modul schreibt Position, Drehung und
// Deckkraft der Weltobjekte ins DOM.
import { arrays } from './state.js';
import { WELLE_TEMPO, WELLE_SCHRITTE } from './gleve.js';

function setzePosition(o) {
  const x = o.anzeigeX !== undefined ? o.anzeigeX : o.x;
  const y = o.anzeigeY !== undefined ? o.anzeigeY : o.y;
  o.el.style.left = x + 'px';
  o.el.style.top = y + 'px';
}

// Position und, falls das Modell eine Drehung traegt, die Drehung
function zeichneObjekt(o) {
  setzePosition(o);
  if (typeof o.rot === 'number') o.el.style.transform = `rotate(${o.rot}deg)`;
}

function zeichnePartikel(p) {
  setzePosition(p);
  p.el.style.opacity = p.leben;
  p.el.style.transform = p.vRot ? `scale(${p.leben}) rotate(${p.rot || 0}deg)` : `scale(${p.leben})`;
}

// Gleve-Klingenwelle: verblasst mit der zurueckgelegten Strecke
function zeichneWelle(w) {
  setzePosition(w);
  const strecke = Math.max(0, (w.startY === undefined ? w.y : w.startY) - w.y);
  w.el.style.opacity = String(Math.max(0.2, 1 - 0.8 * strecke / (WELLE_TEMPO * WELLE_SCHRITTE)));
}

// Welche Liste wie gezeichnet wird. Listen ohne Eintrag zeichnet ihr Modul noch selbst (sniperMinen).
const ZEICHNER = {
  sterne: setzePosition,
  asteroiden: zeichneObjekt,
  feinde: zeichneObjekt,
  bosses: setzePosition,
  powerups: setzePosition,
  laserArray: zeichneObjekt,
  raketenArray: zeichneObjekt,
  bombenArray: zeichneObjekt,
  feindLaserArray: zeichneObjekt,
  bossLaserArray: zeichneObjekt,
  bossRaketenArray: zeichneObjekt,
  bossBombenArray: zeichneObjekt,
  hackProjektilArray: zeichneObjekt,
  partikelArray: zeichnePartikel,
  gleveWellen: zeichneWelle
};

export function zeichneWelt() {
  for (const name in ZEICHNER) {
    const zeichne = ZEICHNER[name];
    for (const o of arrays[name]) {
      if (o.el) zeichne(o);
    }
  }
}

export function entferne(obj) {
  if (obj.el) obj.el.remove();
}
