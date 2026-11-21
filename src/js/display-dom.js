// DOM-Backend der Anzeige (siehe display.js): Weltobjekte sind absolut positionierte Elemente in
// #spielfeld, das Modell traegt sein Element in obj.el. Nur dieses Modul schreibt Position, Drehung,
// Deckkraft und Zustandsanzeigen (Schild, Risse, Betaeubung, Schlepp-Strahl ...) der Weltobjekte ins DOM.
import { arrays, dom, state, shipColors } from './state.js';
import { MINE_SIZE, isSniper, hitRadius, radiusFactor, isFull, chargeShare, CHARGE_FROM } from './sniper.js';
import {
  WAVE_SPEED,
  WAVE_STEPS,
  SWEEP_PARRY_COLOR,
  isGleve,
  isDashActive,
  isSweepActive,
  sweepOrigin,
  sweepLength,
} from './gleve.js';
import { isViper, isRollActive, isOverdrive } from './viper.js';
import { HACK_NAMES, HACK_DURATION } from './hack.js';
import { launcherBinding } from './utils.js';
import { CREATOR, EFFECT_STYLE, getShipSvgContent } from './display-dom-objects.js';

function setPosition(o) {
  const x = o.displayX !== undefined ? o.displayX : o.x;
  const y = o.displayY !== undefined ? o.displayY : o.y;
  o.el.style.left = x + 'px';
  o.el.style.top = y + 'px';
}

// Position und, falls das Modell eine Drehung traegt, die Drehung
function drawObject(o) {
  setPosition(o);
  if (typeof o.rot === 'number') o.el.style.transform = `rotate(${o.rot}deg)`;
}

function showStun(o) {
  o.el.classList.toggle('betaeubt', o.stunned > 0);
}

// Feind: Schild sichtbar solange schildHp > 0, Cling-on-Flammen erst nach dem Abloesen
function drawEnemy(f) {
  drawObject(f);
  showStun(f);
  if (f.open !== undefined) f.el.classList.toggle('offen', !!f.open);
  if (f.shieldEl && !(f.shieldHp > 0)) {
    f.shieldEl.remove();
    f.shieldEl = null;
  }
  if (f.pattern === 'clingOn') {
    const flames = f.phase === 'attached' ? 'none' : 'block';
    if (f.el.dataset.flames !== flames) {
      f.el.dataset.flames = flames;
      f.el.querySelectorAll('.feind-flame').forEach(fl => {
        fl.style.display = flames;
      });
    }
  }
}

// Asteroid: Magma-Klasse aus istUnzerstoerbar, Risse werden mit dem Schaden (hp/maxHp) sichtbar
function drawAsteroid(a) {
  drawObject(a);
  a.el.classList.toggle('unzerstoerbar', !!a.isIndestructible);
  if (a.isIndestructible) return;
  if (!a.crackEl) {
    // Geknackter Magma-Brocken: Risse ohne Muster
    a.crackEl = document.createElement('div');
    a.crackEl.classList.add('riss-layer');
    a.el.appendChild(a.crackEl);
  }
  if (a.maxHp) {
    const basis = a.carriesPowerup ? 0.5 : 0;
    a.crackEl.style.opacity = basis + (1 - basis) * (1 - Math.max(0, a.hp) / a.maxHp);
  }
}

function drawBoss(b) {
  setPosition(b);
  showStun(b);
  b.el.classList.toggle('repulsor-aktiv', !!b.repulsorActive);
  if (b.open !== undefined) b.el.classList.toggle('offen', !!b.open);
}

function removeBeam(p) {
  if (p.beamEl) {
    p.beamEl.remove();
    p.beamEl = null;
  }
}

// Traktorstrahl vom Schiff (strahlX/strahlY) zur Powerup-Mitte, Farbe nach Schlepper
function drawBeam(p) {
  if (!p.towedBy || p.beamX === undefined) {
    removeBeam(p);
    return;
  }
  if (p.beamEl && p.beamEl.dataset.fromEntry !== p.towedBy) removeBeam(p);
  if (!p.beamEl) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'tractor-beam-svg');
    svg.dataset.fromEntry = p.towedBy;
    Object.assign(svg.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '6',
    });
    const glow = document.createElementNS(ns, 'line');
    glow.setAttribute('class', 'tractor-beam-glow');
    glow.setAttribute('stroke', p.towedBy === 'p1' ? '#3498db' : '#2ecc71');
    glow.setAttribute('stroke-width', '4');
    glow.setAttribute('opacity', '0.45');
    const core = document.createElementNS(ns, 'line');
    core.setAttribute('class', 'tractor-beam-core');
    core.setAttribute('stroke', '#ffffff');
    core.setAttribute('stroke-width', '1.5');
    core.setAttribute('stroke-dasharray', '3 2');
    svg.appendChild(glow);
    svg.appendChild(core);
    dom.playfield.appendChild(svg);
    p.beamEl = svg;
  }
  const g = p.size || 24;
  const px = (p.displayX !== undefined ? p.displayX : p.x) + g / 2;
  const py = (p.displayY !== undefined ? p.displayY : p.y) + g / 2;
  p.beamEl.querySelectorAll('line').forEach(l => {
    l.setAttribute('x1', p.beamX);
    l.setAttribute('y1', p.beamY);
    l.setAttribute('x2', px);
    l.setAttribute('y2', py);
  });
}

function drawPowerup(p) {
  setPosition(p);
  const tug = p.towedBy || '';
  if (p.el.dataset.towedBy !== tug) {
    p.el.dataset.towedBy = tug;
    p.el.classList.remove('powerup-towed', 'powerup-towed-p1', 'powerup-towed-p2');
    if (tug) p.el.classList.add('powerup-towed', `powerup-towed-${tug}`);
  }
  drawBeam(p);
}

function setColor(o, color) {
  if (o.el.dataset.color === color) return;
  o.el.dataset.color = color;
  o.el.style.backgroundColor = color;
  o.el.style.boxShadow = `0 0 10px ${color}`;
}

// Spielerlaser: Farbe kann wechseln (Abpraller an Magma)
function drawLaser(l) {
  drawObject(l);
  if (l.color) setColor(l, l.color);
}

// Feindliche Geschosse: von der Gleve pariert (harmlos) orange
function drawProjectile(o) {
  drawObject(o);
  if (o.harmless && !o.el.classList.contains('gleve-pariert')) {
    o.el.classList.add('gleve-pariert');
    setColor(o, SWEEP_PARRY_COLOR);
  }
}

// Spielerbombe: Lichter und Aura pulsieren schneller, je naeher das Ziel (fortschritt 1 -> 0)
function drawBomb(b) {
  drawObject(b);
  if (b.progress === undefined) return;
  const blink = Math.max(0.08, b.progress) + 's';
  const aura = Math.max(0.06, b.progress * 0.8) + 's';
  b.el.querySelectorAll('.bombe-licht').forEach(l => {
    l.style.animationDuration = blink;
  });
  const auraEl = b.el.querySelector('.bombe-aura');
  if (auraEl) auraEl.style.animationDuration = aura;
}

function drawParticles(p) {
  setPosition(p);
  p.el.style.opacity = p.lives;
  p.el.style.transform = p.vRot ? `scale(${p.lives}) rotate(${p.rot || 0}deg)` : `scale(${p.lives})`;
}

// Gleve-Klingenwelle: verblasst mit der zurueckgelegten Strecke
function drawWave(w) {
  setPosition(w);
  const travel = Math.max(0, (w.startY === undefined ? w.y : w.startY) - w.y);
  w.el.style.opacity = String(Math.max(0.2, 1 - (0.8 * travel) / (WAVE_SPEED * WAVE_STEPS)));
}

// Sniper-Effekte, je Art eigene Rechnung aus t = 1 - rest / dauer. Ringe wachsen aus der Mitte (x/y) auf den Durchmesser d,
// der Strahl bleibt stehen und blendet nur aus.
function drawSniperRing(e, d, opacity) {
  e.el.style.width = d + 'px';
  e.el.style.height = d + 'px';
  e.el.style.left = e.x - d / 2 + 'px';
  e.el.style.top = e.y - d / 2 + 'px';
  e.el.style.opacity = opacity;
}

const SNIPER_EFFECT_DRAWER = {
  // Powerup-Schockwelle: waechst linear bis radius (fernste Feldecke), verblasst nur teilweise
  shockwave: e => {
    const t = 1 - e.rest / e.duration;
    drawSniperRing(e, e.radius * 2 * t, 1 - t * 0.6);
  },
  sniperBeam: e => {
    e.el.style.opacity = e.rest / e.duration;
  },
  // schnell am Anfang, gegen Ende auslaufend
  sniperBlastWave: e => {
    const t = 1 - e.rest / e.duration;
    drawSniperRing(e, e.radius * 2 * Math.sqrt(t), 1 - t * 0.85);
  },
  sniperMineExplosion: e => {
    const t = 1 - e.rest / e.duration;
    drawSniperRing(e, e.radius * 2 * Math.sqrt(t), 1 - t * 0.85);
  },
  sniperEmp: e => {
    const t = 1 - e.rest / e.duration;
    drawSniperRing(e, e.radius * 2 * t, 1 - t * 0.8);
  },
};

// Effekt mit Lebensdauer: Fortschritt t aus rest/dauer (nach einer Verzoegerung unsichtbar), Mitte x/y,
// Groesse waechst bis skala und die Deckkraft sinkt auf 0
function drawEffect(e) {
  const sniper = SNIPER_EFFECT_DRAWER[e.kind];
  if (sniper) {
    sniper(e);
    return;
  }
  const style = EFFECT_STYLE[e.kind];
  const dir = e.delay || 0;
  const elapsed = e.duration - e.rest;
  const visible = elapsed >= dir;
  const t = visible ? (elapsed - dir) / (e.duration - dir) : 0;
  e.el.style.left = e.x - e.radius + 'px';
  e.el.style.top = e.y - e.radius + 'px';
  e.el.style.opacity = visible ? String(1 - t) : '0';
  e.el.style.transform = `scale(${1 + (style.scale - 1) * t})`;
}

// Sniper-Granate im Flug: x/y = Mitte, 14 px gross, Drehung aus rot
function drawSniperGrenade(g) {
  g.el.style.left = g.x - 7 + 'px';
  g.el.style.top = g.y - 7 + 'px';
  g.el.style.transform = `rotate(${g.rot}deg)`;
}

// Haftmine: x/y = Mitte, 12 px gross (MINE_GROESSE), Klassen haftet/blinkt aus dem Modell
function drawSniperMine(m) {
  m.el.style.left = m.x - MINE_SIZE / 2 + 'px';
  m.el.style.top = m.y - MINE_SIZE / 2 + 'px';
  m.el.classList.toggle('haftet', !!m.sticks);
  m.el.classList.toggle('blinkt', !!m.blinks);
}

// Zeichner je Objektart (beim Erzeugen) und je Liste (jeder Schritt).
const DRAWER_PER_KIND = {
  star: setPosition,
  enemy: drawEnemy,
  asteroid: drawAsteroid,
  boss: drawBoss,
  powerup: drawPowerup,
  laser: drawLaser,
  missile: drawObject,
  bomb: drawBomb,
  enemyLaser: drawProjectile,
  bossLaser: drawProjectile,
  bossMissile: drawObject,
  bossBomb: drawObject,
  hackProjectile: drawProjectile,
  gleveWave: drawWave,
  particles: drawParticles,
  effect: drawEffect,
  sniperGrenade: drawSniperGrenade,
  sniperMine: drawSniperMine,
  rock: setPosition,
};

const DRAWER = {
  stars: setPosition,
  asteroids: drawAsteroid,
  enemies: drawEnemy,
  bosses: drawBoss,
  powerups: drawPowerup,
  laserArray: drawLaser,
  missileArray: drawObject,
  bombArray: drawBomb,
  enemyLaserArray: drawProjectile,
  bossLaserArray: drawProjectile,
  bossMissileArray: drawObject,
  bossBombArray: drawObject,
  hackProjectileArray: drawProjectile,
  particleArray: drawParticles,
  gleveWaves: drawWave,
  effects: drawEffect,
  sniperGrenades: drawSniperGrenade,
  sniperMines: drawSniperMine,
  rock: setPosition,
};

export function create(obj, kind) {
  const build = CREATOR[kind];
  if (!build) throw new Error(`Unbekannte Objektart fuer die Anzeige: ${kind}`);
  obj.el = build(obj);
  dom.playfield.appendChild(obj.el);
  DRAWER_PER_KIND[kind](obj);
}

// Spielerschiffe: feste Elemente #spieler / #spieler-2 mit Triebwerksflammen
const SHIPS = [
  { pKey: 'p1', el: () => dom.player, status: () => state, flames: ['flame-left', 'flame-right'] },
  { pKey: 'p2', el: () => dom.player2, status: () => state.p2, flames: ['flame-left-p2', 'flame-right-p2'] },
];

// SVG nach Modell und Farbe; Gleve hat nur ein Mittel-Triebwerk (Flammen per Klasse zentriert)
function drawLook(s, el) {
  const model = s.selectedShipModel || 'viper';
  const color = s.selectedShipColor || 'red';
  const key = model + '|' + color;
  if (el.dataset.look === key) return;
  el.dataset.look = key;
  const svg = el.querySelector('svg');
  if (svg) svg.innerHTML = getShipSvgContent(model, color);
  el.classList.toggle('schiff-gleve', model === 'gleve');
}

// Raketenwerfer-Pods nach Modell und Raketen-Stufe
function drawLauncher(s, el) {
  const binding = launcherBinding(s);
  const tier = Math.min(5, Math.max(1, s.missileTier || 1));
  const key = [binding.left, binding.right, binding.middle, tier].join('|');
  if (el.dataset.launcher === key) return;
  el.dataset.launcher = key;
  const pods = [
    ['.werfer-links', binding.left],
    ['.werfer-rechts', binding.right],
    ['.werfer-center', binding.middle],
  ];
  for (const [selector, visible] of pods) {
    const pod = el.querySelector(selector);
    if (!pod) continue;
    pod.style.display = visible ? 'block' : 'none';
    pod.classList.remove('werfer-lvl-1', 'werfer-lvl-2', 'werfer-lvl-3', 'werfer-lvl-4', 'werfer-lvl-5');
    pod.classList.add(`werfer-lvl-${tier}`);
  }
}

// Laufende Hacks: Label mit Namen und Restzeit ueber dem Schiff
function drawHackLabel(s, pKey, active) {
  let label = document.getElementById('hack-label-' + pKey);
  if (!active) {
    if (label) label.style.display = 'none';
    return;
  }
  if (!label) {
    label = document.createElement('div');
    label.id = 'hack-label-' + pKey;
    label.classList.add('hack-label');
    label.innerHTML =
      '<div class="hack-text"></div><div class="hack-restzeit-rahmen"><div class="hack-restzeit"></div></div>';
    dom.playfield.appendChild(label);
  }
  const text = s.hacks.map(h => HACK_NAMES[h.typ]).join(' + ');
  const textEl = label.querySelector('.hack-text');
  if (textEl.textContent !== text) textEl.textContent = text;
  const restMax = Math.max(...s.hacks.map(h => h.timer));
  /** @type {HTMLElement} */ (label.querySelector('.hack-restzeit')).style.width =
    (restMax / HACK_DURATION) * 100 + '%';
  label.style.display = 'block';
  label.style.left = s.x + 15 + 'px';
  label.style.top = s.y - 22 + 'px';
}

// Sniper-Fadenkreuz (Kreis mit vier Strichen) samt Ladering aus sniperZielX/Y, Laser-Stufe, sniperLadung und sniperGehalten.
// Sichtbar nur fuer lebende Sniper bei laufendem Spiel und gesetztem Ziel.
function drawCrosshair(s, pKey) {
  const id = 'fadenkreuz-' + pKey;
  let el = document.getElementById(id);
  const visible = isSniper(s) && !s.isDead && state.gameRunning && s.sniperTargetX != null;
  if (!visible) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.classList.add('sniper-fadenkreuz', 'sniper-fadenkreuz-' + pKey);
    for (const side of ['o', 'u', 'l', 'r']) {
      const stroke = document.createElement('i');
      stroke.classList.add('sniper-strich', 'sniper-strich-' + side);
      el.appendChild(stroke);
    }
    dom.playfield.appendChild(el);
  }
  const r = hitRadius(s);
  const c = shipColors[s.selectedShipColor];
  const color = c ? c.prim : '#ffffff';
  drawChargeRing(el, s);
  el.style.width = r * 2 + 'px';
  el.style.height = r * 2 + 'px';
  el.style.left = s.sniperTargetX - r + 'px';
  el.style.top = s.sniperTargetY - r + 'px';
  el.style.color = color;
  el.style.borderColor = color;
  el.style.boxShadow = `0 0 6px ${color}, inset 0 0 4px ${color}`;
}

// Ladering im Fadenkreuz: zeigt den aktuellen Trefferkreis, waechst mit der Ladung, Klasse voll bei voller Ladung
function drawChargeRing(el, s) {
  let ring = el.querySelector('.sniper-ladering');
  if (!ring) {
    ring = document.createElement('div');
    ring.classList.add('sniper-ladering');
    el.appendChild(ring);
  }
  const charge = s.sniperCharge || 0;
  const visible = !!s.sniperHeld && charge >= CHARGE_FROM;
  ring.style.display = visible ? 'block' : 'none';
  ring.classList.toggle('voll', visible && isFull(charge));
  if (!visible) return;
  const d = hitRadius(s) * 2 * radiusFactor(charge);
  const share = chargeShare(charge);
  ring.style.width = d + 'px';
  ring.style.height = d + 'px';
  ring.style.opacity = 0.45 + 0.55 * share;
  ring.style.borderWidth = 1.5 + 2.5 * share + 'px';
}

// Gleve-Sweep-Klinge aus gleveSweepTimer, -Winkel und -Richtung; sichtbar nur fuer lebende Gleve mit laufendem Sweep.
// Ursprung und Laenge kommen aus der Spiellogik (sweepUrsprung, sweepLaenge), Farbe aus der Schiffsfarbe.
function drawBlade(s, pKey) {
  const id = 'gleve-klinge-' + pKey;
  let el = document.getElementById(id);
  if (!(isGleve(s) && !s.isDead && isSweepActive(s))) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.classList.add('gleve-klinge');
    dom.playfield.appendChild(el);
  }
  const o = sweepOrigin(s);
  const length = sweepLength(s);
  const c = shipColors[s.selectedShipColor];
  const color = c ? c.prim : '#ffffff';
  el.style.height = length + 'px';
  el.style.left = o.x - 2 + 'px';
  el.style.top = o.y - length + 'px';
  el.style.boxShadow = `0 0 4px #ffffff, 0 0 8px ${color}, 0 0 14px ${color}`;
  el.style.borderColor = color;
  // Leicht gebogen: Neigung gegen die Laufrichtung
  el.style.borderRadius = (s.gleveSweepDirection || 1) > 0 ? '0 100% 0 0 / 0 100% 0 0' : '100% 0 0 0 / 100% 0 0 0';
  el.style.transform = `rotate(${s.gleveSweepAngle}deg)`;
}

// Ein Schiff aus seinem Zustand: Sichtbarkeit (schiffSichtbar), Position (anzeigeX/Y oder x/y), Neigung
// (drehung), Flammen (flammenSkala), Blinken waehrend der Unverwundbarkeit, Schild-Ring je schildStufe
function drawShip(s, el, flameIds, pKey) {
  drawLook(s, el);
  drawLauncher(s, el);
  const alive = !s.isDead;
  el.classList.toggle('gleve-dash', alive && isGleve(s) && isDashActive(s));
  el.classList.toggle('viper-rolle', alive && isViper(s) && isRollActive(s));
  el.classList.toggle('viper-overdrive', alive && isViper(s) && isOverdrive(s));
  const hacked = alive && (s.hacks || []).length > 0;
  el.classList.toggle('spieler-gehackt', hacked);
  drawHackLabel(s, pKey, hacked);
  drawCrosshair(s, pKey);
  drawBlade(s, pKey);
  if (typeof s.shipVisible === 'boolean') el.style.display = s.shipVisible ? 'block' : 'none';
  setPosition({ el, x: s.x, y: s.y, displayX: s.displayX, displayY: s.displayY });
  if (typeof s.rotation === 'number') el.style.transform = `rotate(${s.rotation}deg)`;
  if (typeof s.flameScale === 'number') {
    for (const id of flameIds) {
      const flame = document.getElementById(id);
      if (flame) flame.style.transform = `scaleY(${s.flameScale})`;
    }
  }
  el.classList.toggle('spieler-blink', s.invulnerableTimer > 0);
  for (let tier = 1; tier <= 3; tier++) el.classList.toggle(`schild-aktiv-${tier}`, s.shieldTier === tier);
}

export function drawPlayer() {
  for (const ship of SHIPS) {
    const el = ship.el();
    const s = ship.status();
    if (el && s) drawShip(s, el, ship.flames, ship.pKey);
  }
  drawBeams();
}

// Autolaser (gedrehter Strahl zum Ziel) und Hitscan-Laser (senkrecht) des Spielers 1
function drawBeams() {
  const auto = state.autolaserBeam;
  if (dom.autolaserEl) {
    dom.autolaserEl.style.display = auto ? 'block' : 'none';
    if (auto) {
      dom.autolaserEl.style.height = auto.length + 'px';
      dom.autolaserEl.style.top = auto.y - auto.length + 'px';
      dom.autolaserEl.style.left = auto.x - 2 + 'px';
      dom.autolaserEl.style.transform = `rotate(${auto.angle}deg)`;
    }
  }
  const hitscan = state.hitscanBeam;
  const hitscanEl = document.getElementById('hitscan-laser');
  if (hitscanEl) {
    hitscanEl.style.display = hitscan ? 'block' : 'none';
    if (hitscan) {
      hitscanEl.style.height = hitscan.length + 'px';
      hitscanEl.style.top = hitscan.y - hitscan.length + 'px';
      hitscanEl.style.left = hitscan.x - 3 + 'px';
    }
  }
}

export function drawWorld() {
  drawPlayer();
  for (const name in DRAWER) {
    const draw = DRAWER[name];
    for (const o of arrays[name]) {
      if (o.el) draw(o);
    }
  }
}

export function remove(obj) {
  removeBeam(obj);
  if (obj.el) obj.el.remove();
}

// Kurzes Aufhellen bei einem Treffer (staerke = Helligkeitsfaktor), unabhaengig vom Simulationstakt
export function flash(obj, strength) {
  const el = obj.el;
  if (!el) return;
  el.style.filter = `brightness(${strength})`;
  setTimeout(() => {
    el.style.filter = '';
  }, 50);
}

// Bildschirm-Blitz: Spielfeldhintergrund kurz faerben, nach ms zurueck zur Grundfarbe. Jeder Blitz setzt seinen
// eigenen Timer (wie bisher in der Logik): ein zweiter Blitz im ersten setzt die Grundfarbe beim Ablauf des ersten.
export function flashPlayfield(color, ms) {
  const el = dom.playfield || document.getElementById('spielfeld');
  if (!el) return;
  el.style.backgroundColor = color;
  setTimeout(() => {
    // zurueck zur Farbe aus dem Stylesheet (Thema-Klasse)
    el.style.backgroundColor = '';
  }, ms);
}

// Thema als Klasse thema-<name> am Spielfeld; 'standard' = keine Klasse
export function setTheme(name) {
  const el = dom.playfield || document.getElementById('spielfeld');
  if (!el) return;
  [...el.classList].filter(k => k.startsWith('thema-')).forEach(k => el.classList.remove(k));
  if (name && name !== 'standard') el.classList.add('thema-' + name);
}
