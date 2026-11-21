// Statische Waechter der Anzeige-Schicht: lesen nur Quelltext, brauchen keine Seite.
// Getrennt von display.spec.js, damit sie nicht dessen beforeEach (page.goto) bezahlen.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test('Spielerschiffe: Logik schreibt nicht in #spieler / #spieler-2', () => {
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

// Waechter: Diese Module laufen ueber die Anzeige-Schnittstelle. Positionen und Entfernen von Weltobjekten
// gehoeren ins Backend (display-dom.js), nicht in die Spiellogik.
test('Spiellogik fasst die Elemente der Weltobjekte nicht an (Position, Zustand, Entfernen)', () => {
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

test('entities.js baut keine DOM-Elemente (Erzeugen nur ueber Anzeige.erzeuge)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'entities.js'), 'utf8');
  expect(source.match(/document\.\w+|\.el\.(style|innerHTML|classList|appendChild)/g)).toBeNull();
});

test('Partikel entstehen nur ueber erzeugePartikel (particles.js)', () => {
  const folder = path.join(__dirname, '..', 'src', 'js');
  const findings = fs
    .readdirSync(folder)
    .filter(d => d.endsWith('.js') && d !== 'particles.js')
    .filter(d => fs.readFileSync(path.join(folder, d), 'utf8').includes('partikelArray.push'));
  expect(findings).toEqual([]);
});

test('sniper.js baut keine Granaten-Elemente (Erzeugen ueber Anzeige.erzeuge)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(/sniper-granate/);
  expect(text).not.toMatch(/netzGranaten\b|const grenades\b/);
});

test('sniper.js baut keine Minen-Elemente (Erzeugen ueber Anzeige.erzeuge)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(/sniper-mine'|netzMinen\b|zeigeMine\b/);
});

test('sniper.js fasst das DOM nicht an (kein createElement, kein dom.spielfeld, kein isConnected, kein el.remove)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(
    /createElement|dom.playfield|isConnected|.el.remove|fadenkreuze\b|holeFadenkreuz|zeigeFadenkreuz|entferneFadenkreuz/,
  );
});

test('gleve.js legt keine Klinge im DOM an (kein gleve-klinge, kein dom.spielfeld, kein isConnected, kein el.remove)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'gleve.js'), 'utf8');
  // createElement bleibt nur fuer die HUD-Punkte der Dash-Ladungen (zeigeLadungenHud) erlaubt
  expect((text.match(/createElement/g) || []).length).toBe(1);
  expect(text).toMatch(/const point = document\.createElement/);
  expect(text).not.toMatch(/gleve-klinge|dom\.playfield|isConnected|\.el\.remove|zeigeKlinge|entferneKlinge|blades\[/);
});

test('Logik setzt den Spielfeld-Hintergrund nicht selbst (utils, powerups, network: kein spielfeld.style.backgroundColor)', () => {
  for (const file of ['utils', 'powerups', 'network']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file + '.js'), 'utf8');
    expect(text, file).not.toMatch(/playfield\.style\.backgroundColor/);
  }
});

// Globaler Waechter: Diese Module bauen nichts im Spielfeld und fragen das DOM nicht nach ihren Elementen.
// Einzige Ausnahme: gleve.js baut in zeigeLadungenHud die HUD-Punkte (.dash-ladung) per createElement in den
// HUD-Container #dash-ladungen. Der liegt ausserhalb von #spielfeld und bleibt bewusst HTML.
test('Spiellogik-Module enthalten kein document.createElement, kein dom.spielfeld und kein isConnected', () => {
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
