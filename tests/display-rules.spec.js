// Static guards of the display layer: read source only, need no page.
// Separate from display.spec.js so they do not pay for its beforeEach (page.goto).
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test('Player ships: logic does not write into #spieler / #spieler-2', () => {
  const module = [
    'player.js',
    'client.js',
    'network.js',
    'powerups.js',
    'input.js',
    'main.js',
    'cutscene.js',
    'loop.js',
    'utils.js',
    'gleve.js',
    'viper.js',
    'hack.js',
    'weapons.js',
  ];
  const forbidden =
    /dom\.player2?\.(style|classList|setAttribute|querySelector)|flame-(left|right)|autolaserEl|hitscan-laser|schiffElement/;
  const findings = [];
  for (const file of module) {
    const lines = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (forbidden.test(line)) findings.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(findings).toEqual([]);
});

// Guard: these modules go through the display interface. Positions and removal of world objects
// belong in the backend (display-dom.js), not in the game logic.
test('Game logic does not touch the elements of world objects (position, state, removal)', () => {
  const module = [
    'loop.js',
    'level.js',
    'chain.js',
    'shockwave.js',
    'rock.js',
    'growths.js',
    'island-boss.js',
    'bio-creatures.js',
    'client.js',
    'opponents.js',
    'boss.js',
    'weapons.js',
    'powerups.js',
    'particles.js',
    'gleve.js',
    'input.js',
    'utils.js',
    'network.js',
    'entities.js',
  ];
  const forbidden = /\.el\.style\.|\.el\.remove\(\)|\.el\.classList|\.el\.querySelector|shieldEl|crackEl|beamEl/;
  const findings = [];
  for (const file of module) {
    const lines = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (forbidden.test(line)) findings.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(findings).toEqual([]);
});

test('entities.js builds no DOM elements (creation only via Display.create)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'entities.js'), 'utf8');
  expect(source.match(/document\.\w+|\.el\.(style|innerHTML|classList|appendChild)/g)).toBeNull();
});

test('Particles are created only via createParticles (particles.js)', () => {
  const folder = path.join(__dirname, '..', 'src', 'js');
  const findings = fs
    .readdirSync(folder)
    .filter(d => d.endsWith('.js') && d !== 'particles.js')
    .filter(d => fs.readFileSync(path.join(folder, d), 'utf8').includes('partikelArray.push'));
  expect(findings).toEqual([]);
});

test('sniper.js builds no grenade elements (creation via Display.create)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(/sniper-granate/);
  expect(text).not.toMatch(/netzGranaten\b|const grenades\b/);
});

test('sniper.js builds no mine elements (creation via Display.create)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(/sniper-mine'|netzMinen\b|zeigeMine\b/);
});

test('sniper.js does not touch the DOM (no createElement, no dom.playfield, no isConnected, no el.remove)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(
    /createElement|dom.playfield|isConnected|.el.remove|fadenkreuze\b|holeFadenkreuz|zeigeFadenkreuz|entferneFadenkreuz/,
  );
});

test('gleve.js creates no blade in the DOM (no gleve-klinge, no dom.playfield, no isConnected, no el.remove)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'gleve.js'), 'utf8');
  // createElement stays allowed only for the HUD dots of the dash charges (showChargesHud)
  expect((text.match(/createElement/g) || []).length).toBe(1);
  expect(text).toMatch(/const point = document\.createElement/);
  expect(text).not.toMatch(/gleve-klinge|dom\.playfield|isConnected|\.el\.remove|zeigeKlinge|entferneKlinge|blades\[/);
});

test('Logic does not set the playfield background itself (utils, powerups, network: no playfield.style.backgroundColor)', () => {
  for (const file of ['utils', 'powerups', 'network']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file + '.js'), 'utf8');
    expect(text, file).not.toMatch(/playfield\.style\.backgroundColor/);
  }
});

// Global guard: these modules build nothing in the playfield and do not query the DOM for their elements.
// Only exception: gleve.js builds the HUD dots (.dash-ladung) via createElement in showChargesHud inside the
// HUD container #dash-ladungen. It lies outside #spielfeld and deliberately stays HTML.
test('Game logic modules contain no document.createElement, no dom.playfield and no isConnected', () => {
  const module = [
    'opponents',
    'boss',
    'weapons',
    'powerups',
    'particles',
    'gleve',
    'sniper',
    'viper',
    'hack',
    'entities',
    'player',
    'client',
    'loop',
    'level',
    'chain',
    'shockwave',
    'rock',
    'growths',
    'island-boss',
    'bio-creatures',
    'effects',
  ];
  for (const file of module) {
    let text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file + '.js'), 'utf8');
    if (file === 'gleve') text = text.replace(/const point = document\.createElement\('div'\);/, '');
    expect(text, file).not.toMatch(/document\.createElement|dom\.playfield|\.isConnected/);
  }
});
