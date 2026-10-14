// DOM-Backend der Anzeige (siehe anzeige.js): Weltobjekte sind absolut positionierte Elemente in
// #spielfeld, das Modell traegt sein Element in obj.el. Nur dieses Modul schreibt Position, Drehung,
// Deckkraft und Zustandsanzeigen (Schild, Risse, Betaeubung, Schlepp-Strahl ...) der Weltobjekte ins DOM.
import { arrays, dom, state } from './state.js';
import { WELLE_TEMPO, WELLE_SCHRITTE, SWEEP_PARADE_FARBE } from './gleve.js';
import { ERZEUGER } from './anzeige-dom-objekte.js';

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

function zeigeBetaeubung(o) {
  o.el.classList.toggle('betaeubt', o.betaeubt > 0);
}

// Feind: Schild sichtbar solange schildHp > 0, Cling-on-Flammen erst nach dem Abloesen
function zeichneFeind(f) {
  zeichneObjekt(f);
  zeigeBetaeubung(f);
  if (f.schildEl && !(f.schildHp > 0)) {
    f.schildEl.remove();
    f.schildEl = null;
  }
  if (f.muster === 'clingOn') {
    const flammen = f.phase === 'attached' ? 'none' : 'block';
    if (f.el.dataset.flammen !== flammen) {
      f.el.dataset.flammen = flammen;
      f.el.querySelectorAll('.feind-flame').forEach(fl => { fl.style.display = flammen; });
    }
  }
}

// Asteroid: Magma-Klasse aus istUnzerstoerbar, Risse werden mit dem Schaden (hp/maxHp) sichtbar
function zeichneAsteroid(a) {
  zeichneObjekt(a);
  a.el.classList.toggle('unzerstoerbar', !!a.istUnzerstoerbar);
  if (a.istUnzerstoerbar) return;
  if (!a.rissEl) {
    // Geknackter Magma-Brocken: Risse ohne Muster
    a.rissEl = document.createElement('div');
    a.rissEl.classList.add('riss-layer');
    a.el.appendChild(a.rissEl);
  }
  if (a.maxHp) {
    const basis = a.traegtPowerup ? 0.5 : 0;
    a.rissEl.style.opacity = basis + (1 - basis) * (1 - Math.max(0, a.hp) / a.maxHp);
  }
}

function zeichneBoss(b) {
  setzePosition(b);
  zeigeBetaeubung(b);
  b.el.classList.toggle('repulsor-aktiv', !!b.repulsorAktiv);
}

function entferneStrahl(p) {
  if (p.beamEl) {
    p.beamEl.remove();
    p.beamEl = null;
  }
}

// Traktorstrahl vom Schiff (strahlX/strahlY) zur Powerup-Mitte, Farbe nach Schlepper
function zeichneStrahl(p) {
  if (!p.towedBy || p.strahlX === undefined) {
    entferneStrahl(p);
    return;
  }
  if (p.beamEl && p.beamEl.dataset.von !== p.towedBy) entferneStrahl(p);
  if (!p.beamEl) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'tractor-beam-svg');
    svg.dataset.von = p.towedBy;
    Object.assign(svg.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '6' });
    const glow = document.createElementNS(ns, 'line');
    glow.setAttribute('class', 'tractor-beam-glow');
    glow.setAttribute('stroke', p.towedBy === 'p1' ? '#3498db' : '#2ecc71');
    glow.setAttribute('stroke-width', '4');
    glow.setAttribute('opacity', '0.45');
    const kern = document.createElementNS(ns, 'line');
    kern.setAttribute('class', 'tractor-beam-core');
    kern.setAttribute('stroke', '#ffffff');
    kern.setAttribute('stroke-width', '1.5');
    kern.setAttribute('stroke-dasharray', '3 2');
    svg.appendChild(glow);
    svg.appendChild(kern);
    dom.spielfeld.appendChild(svg);
    p.beamEl = svg;
  }
  const g = p.groesse || 24;
  const px = (p.anzeigeX !== undefined ? p.anzeigeX : p.x) + g / 2;
  const py = (p.anzeigeY !== undefined ? p.anzeigeY : p.y) + g / 2;
  p.beamEl.querySelectorAll('line').forEach(l => {
    l.setAttribute('x1', p.strahlX);
    l.setAttribute('y1', p.strahlY);
    l.setAttribute('x2', px);
    l.setAttribute('y2', py);
  });
}

function zeichnePowerup(p) {
  setzePosition(p);
  const schlepper = p.towedBy || '';
  if (p.el.dataset.towedBy !== schlepper) {
    p.el.dataset.towedBy = schlepper;
    p.el.classList.remove('powerup-towed', 'powerup-towed-p1', 'powerup-towed-p2');
    if (schlepper) p.el.classList.add('powerup-towed', `powerup-towed-${schlepper}`);
  }
  zeichneStrahl(p);
}

function setzeFarbe(o, farbe) {
  if (o.el.dataset.farbe === farbe) return;
  o.el.dataset.farbe = farbe;
  o.el.style.backgroundColor = farbe;
  o.el.style.boxShadow = `0 0 10px ${farbe}`;
}

// Spielerlaser: Farbe kann wechseln (Abpraller an Magma)
function zeichneLaser(l) {
  zeichneObjekt(l);
  if (l.farbe) setzeFarbe(l, l.farbe);
}

// Feindliche Geschosse: von der Gleve pariert (harmlos) orange
function zeichneGeschoss(o) {
  zeichneObjekt(o);
  if (o.harmlos && !o.el.classList.contains('gleve-pariert')) {
    o.el.classList.add('gleve-pariert');
    setzeFarbe(o, SWEEP_PARADE_FARBE);
  }
}

// Spielerbombe: Lichter und Aura pulsieren schneller, je naeher das Ziel (fortschritt 1 -> 0)
function zeichneBombe(b) {
  zeichneObjekt(b);
  if (b.fortschritt === undefined) return;
  const blink = Math.max(0.08, b.fortschritt) + 's';
  const aura = Math.max(0.06, b.fortschritt * 0.8) + 's';
  b.el.querySelectorAll('.bombe-licht').forEach(l => { l.style.animationDuration = blink; });
  const auraEl = b.el.querySelector('.bombe-aura');
  if (auraEl) auraEl.style.animationDuration = aura;
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

// Zeichner je Objektart (beim Erzeugen) und je Liste (jeder Schritt).
// Listen ohne Eintrag zeichnet ihr Modul noch selbst (sniperMinen).
const ZEICHNER_JE_ART = {
  feind: zeichneFeind,
  asteroid: zeichneAsteroid,
  boss: zeichneBoss,
  powerup: zeichnePowerup,
  laser: zeichneLaser,
  rakete: zeichneObjekt,
  bombe: zeichneBombe,
  feindLaser: zeichneGeschoss,
  bossLaser: zeichneGeschoss,
  bossRakete: zeichneObjekt,
  bossBombe: zeichneObjekt,
  hackProjektil: zeichneGeschoss,
  gleveWelle: zeichneWelle,
  partikel: zeichnePartikel
};

const ZEICHNER = {
  sterne: setzePosition,
  asteroiden: zeichneAsteroid,
  feinde: zeichneFeind,
  bosses: zeichneBoss,
  powerups: zeichnePowerup,
  laserArray: zeichneLaser,
  raketenArray: zeichneObjekt,
  bombenArray: zeichneBombe,
  feindLaserArray: zeichneGeschoss,
  bossLaserArray: zeichneGeschoss,
  bossRaketenArray: zeichneObjekt,
  bossBombenArray: zeichneObjekt,
  hackProjektilArray: zeichneGeschoss,
  partikelArray: zeichnePartikel,
  gleveWellen: zeichneWelle
};

export function erzeuge(obj, art) {
  const baue = ERZEUGER[art];
  if (!baue) throw new Error(`Unbekannte Objektart fuer die Anzeige: ${art}`);
  obj.el = baue(obj);
  dom.spielfeld.appendChild(obj.el);
  ZEICHNER_JE_ART[art](obj);
}

// Spielerschiffe: feste Elemente #spieler / #spieler-2 mit Triebwerksflammen
const SCHIFFE = [
  { el: () => dom.spieler, zustand: () => state, flammen: ['flame-left', 'flame-right'] },
  { el: () => dom.spieler2, zustand: () => state.p2, flammen: ['flame-left-p2', 'flame-right-p2'] }
];

// Ein Schiff aus seinem Zustand: Sichtbarkeit (schiffSichtbar), Position (anzeigeX/Y oder x/y), Neigung
// (drehung), Flammen (flammenSkala), Blinken waehrend der Unverwundbarkeit, Schild-Ring je schildStufe
function zeichneSchiff(s, el, flammenIds) {
  if (typeof s.schiffSichtbar === 'boolean') el.style.display = s.schiffSichtbar ? 'block' : 'none';
  setzePosition({ el, x: s.x, y: s.y, anzeigeX: s.anzeigeX, anzeigeY: s.anzeigeY });
  if (typeof s.drehung === 'number') el.style.transform = `rotate(${s.drehung}deg)`;
  if (typeof s.flammenSkala === 'number') {
    for (const id of flammenIds) {
      const flamme = document.getElementById(id);
      if (flamme) flamme.style.transform = `scaleY(${s.flammenSkala})`;
    }
  }
  el.classList.toggle('spieler-blink', s.invulnerableTimer > 0);
  for (let stufe = 1; stufe <= 3; stufe++) el.classList.toggle(`schild-aktiv-${stufe}`, s.schildStufe === stufe);
}

export function zeichneSpieler() {
  for (const schiff of SCHIFFE) {
    const el = schiff.el();
    const s = schiff.zustand();
    if (el && s) zeichneSchiff(s, el, schiff.flammen);
  }
}

export function zeichneWelt() {
  zeichneSpieler();
  for (const name in ZEICHNER) {
    const zeichne = ZEICHNER[name];
    for (const o of arrays[name]) {
      if (o.el) zeichne(o);
    }
  }
}

export function entferne(obj) {
  entferneStrahl(obj);
  if (obj.el) obj.el.remove();
}

// Kurzes Aufhellen bei einem Treffer (staerke = Helligkeitsfaktor), unabhaengig vom Simulationstakt
export function blitze(obj, staerke) {
  const el = obj.el;
  if (!el) return;
  el.style.filter = `brightness(${staerke})`;
  setTimeout(() => { el.style.filter = ''; }, 50);
}
