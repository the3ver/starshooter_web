// Statische Waechter der Anzeige-Schicht: lesen nur Quelltext, brauchen keine Seite.
// Getrennt von anzeige.spec.js, damit sie nicht dessen beforeEach (page.goto) bezahlen.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test('Spielerschiffe: Logik schreibt nicht in #spieler / #spieler-2', () => {
  const module = [
    'spieler.js',
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
    'waffen.js',
  ];
  const verboten =
    /dom\.spieler2?\.(style|classList|setAttribute|querySelector)|flame-(left|right)|autolaserEl|hitscan-laser|schiffElement/;
  const funde = [];
  for (const datei of module) {
    const zeilen = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', datei), 'utf8').split('\n');
    zeilen.forEach((zeile, i) => {
      if (verboten.test(zeile)) funde.push(`${datei}:${i + 1}: ${zeile.trim()}`);
    });
  }
  expect(funde).toEqual([]);
});

// Waechter: Diese Module laufen ueber die Anzeige-Schnittstelle. Positionen und Entfernen von Weltobjekten
// gehoeren ins Backend (anzeige-dom.js), nicht in die Spiellogik.
test('Spiellogik fasst die Elemente der Weltobjekte nicht an (Position, Zustand, Entfernen)', () => {
  const module = [
    'loop.js',
    'level.js',
    'kette.js',
    'schockwelle.js',
    'fels.js',
    'gewaechse.js',
    'inselboss.js',
    'biowesen.js',
    'client.js',
    'gegner.js',
    'boss.js',
    'waffen.js',
    'powerups.js',
    'partikel.js',
    'gleve.js',
    'input.js',
    'utils.js',
    'network.js',
    'entities.js',
  ];
  const verboten = /\.el\.style\.|\.el\.remove\(\)|\.el\.classList|\.el\.querySelector|schildEl|rissEl|beamEl/;
  const funde = [];
  for (const datei of module) {
    const zeilen = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', datei), 'utf8').split('\n');
    zeilen.forEach((zeile, i) => {
      if (verboten.test(zeile)) funde.push(`${datei}:${i + 1}: ${zeile.trim()}`);
    });
  }
  expect(funde).toEqual([]);
});

test('entities.js baut keine DOM-Elemente (Erzeugen nur ueber Anzeige.erzeuge)', () => {
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'entities.js'), 'utf8');
  expect(quelle.match(/document\.\w+|\.el\.(style|innerHTML|classList|appendChild)/g)).toBeNull();
});

test('Partikel entstehen nur ueber erzeugePartikel (partikel.js)', () => {
  const ordner = path.join(__dirname, '..', 'src', 'js');
  const funde = fs
    .readdirSync(ordner)
    .filter(d => d.endsWith('.js') && d !== 'partikel.js')
    .filter(d => fs.readFileSync(path.join(ordner, d), 'utf8').includes('partikelArray.push'));
  expect(funde).toEqual([]);
});

test('sniper.js baut keine Granaten-Elemente (Erzeugen ueber Anzeige.erzeuge)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(/sniper-granate/);
  expect(text).not.toMatch(/netzGranaten\b|const granaten\b/);
});

test('sniper.js baut keine Minen-Elemente (Erzeugen ueber Anzeige.erzeuge)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(/sniper-mine'|netzMinen\b|zeigeMine\b/);
});

test('sniper.js fasst das DOM nicht an (kein createElement, kein dom.spielfeld, kein isConnected, kein el.remove)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(
    /createElement|dom.spielfeld|isConnected|.el.remove|fadenkreuze\b|holeFadenkreuz|zeigeFadenkreuz|entferneFadenkreuz/,
  );
});

test('gleve.js legt keine Klinge im DOM an (kein gleve-klinge, kein dom.spielfeld, kein isConnected, kein el.remove)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'gleve.js'), 'utf8');
  // createElement bleibt nur fuer die HUD-Punkte der Dash-Ladungen (zeigeLadungenHud) erlaubt
  expect((text.match(/createElement/g) || []).length).toBe(1);
  expect(text).toMatch(/const punkt = document\.createElement/);
  expect(text).not.toMatch(/gleve-klinge|dom\.spielfeld|isConnected|\.el\.remove|zeigeKlinge|entferneKlinge|klingen\[/);
});

test('Logik setzt den Spielfeld-Hintergrund nicht selbst (utils, powerups, network: kein spielfeld.style.backgroundColor)', () => {
  for (const datei of ['utils', 'powerups', 'network']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', datei + '.js'), 'utf8');
    expect(text, datei).not.toMatch(/spielfeld\.style\.backgroundColor/);
  }
});

// Globaler Waechter: Diese Module bauen nichts im Spielfeld und fragen das DOM nicht nach ihren Elementen.
// Einzige Ausnahme: gleve.js baut in zeigeLadungenHud die HUD-Punkte (.dash-ladung) per createElement in den
// HUD-Container #dash-ladungen. Der liegt ausserhalb von #spielfeld und bleibt bewusst HTML.
test('Spiellogik-Module enthalten kein document.createElement, kein dom.spielfeld und kein isConnected', () => {
  const module = [
    'gegner',
    'boss',
    'waffen',
    'powerups',
    'partikel',
    'gleve',
    'sniper',
    'viper',
    'hack',
    'entities',
    'spieler',
    'client',
    'loop',
    'level',
    'kette',
    'schockwelle',
    'fels',
    'gewaechse',
    'inselboss',
    'biowesen',
    'effekte',
  ];
  for (const datei of module) {
    let text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', datei + '.js'), 'utf8');
    if (datei === 'gleve') text = text.replace(/const punkt = document\.createElement\('div'\);/, '');
    expect(text, datei).not.toMatch(/document\.createElement|dom\.spielfeld|\.isConnected/);
  }
});
