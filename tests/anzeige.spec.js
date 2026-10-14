// Anzeige-Schnittstelle (src/js/anzeige.js): Die Spiellogik aendert nur Modellfelder, ein austauschbares
// Backend zeichnet die Weltobjekte. Diese Tests setzen ein Test-Backend statt des DOM-Backends ein.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await setzeSpielstand(page);
  await page.goto('/');
});

test('Test-Backend: zeichneWelt einmal pro Schritt, Logik schreibt keine Positionen ins DOM, entferne beim Verlassen des Felds', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    const { state, arrays, config } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');

    state.spielLaeuft = true;
    state.godMode = true;
    Entities.erzeugeFeind(100, 50, 'normal', 0);
    const f = arrays.feinde[arrays.feinde.length - 1];
    const topVorher = f.el.style.top;
    const yVorher = f.y;

    const protokoll = { zeichne: 0, entfernt: [] };
    const domBackend = Anzeige.holeBackend();
    Anzeige.setzeBackend({
      zeichneWelt() { protokoll.zeichne++; },
      entferne(o) { protokoll.entfernt.push(o.id); }
    });
    try {
      for (let i = 0; i < 3; i++) simulationsSchritt();
      const nachSchritten = { zeichne: protokoll.zeichne, yBewegt: f.y > yVorher, topGleich: f.el.style.top === topVorher };
      f.y = config.spielfeldHoehe + 10;
      simulationsSchritt();
      return {
        ...nachSchritten,
        entferntFeind: protokoll.entfernt.includes(f.id),
        ausListe: !arrays.feinde.includes(f),
        elementNochDa: f.el.isConnected
      };
    } finally {
      Anzeige.setzeBackend(domBackend);
    }
  });
  expect(r.zeichne).toBe(3);
  expect(r.yBewegt).toBe(true);
  expect(r.topGleich).toBe(true);
  expect(r.entferntFeind).toBe(true);
  expect(r.ausListe).toBe(true);
  // Das Test-Backend entfernt nichts aus dem DOM: das Entfernen laeuft nur ueber die Anzeige
  expect(r.elementNochDa).toBe(true);
});

test('DOM-Backend zeichnet aus dem Modell: Position, Drehung, Anzeigeposition des Online-Clients', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const { arrays } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    Entities.erzeugeFeind(100, 50, 'normal', 0);
    const f = arrays.feinde[arrays.feinde.length - 1];
    f.x = 12; f.y = 34; f.rot = 45;
    Anzeige.zeichneWelt();
    const modell = [f.el.style.left, f.el.style.top, f.el.style.transform];
    f.anzeigeX = 56; f.anzeigeY = 78;
    Anzeige.zeichneWelt();
    const anzeige = [f.el.style.left, f.el.style.top];
    Anzeige.entferne(f);
    return { modell, anzeige, entfernt: !f.el.isConnected };
  });
  expect(r.modell).toEqual(['12px', '34px', 'rotate(45deg)']);
  expect(r.anzeige).toEqual(['56px', '78px']);
  expect(r.entfernt).toBe(true);
});

test('setzeBackend lehnt ein Backend ohne Pflichtfunktionen ab', async ({ page }) => {
  const fehler = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const meldungen = [];
    for (const b of [null, {}, { zeichneWelt() {} }, { entferne() {} }]) {
      try { Anzeige.setzeBackend(b); meldungen.push(null); } catch (e) { meldungen.push(e.message); }
    }
    return meldungen;
  });
  expect(fehler.every(m => typeof m === 'string' && m.startsWith('Anzeige-Backend ohne'))).toBe(true);
});

// Waechter: Diese Module laufen ueber die Anzeige-Schnittstelle. Positionen und Entfernen von Weltobjekten
// gehoeren ins Backend (anzeige-dom.js), nicht in die Spiellogik.
test('Spiellogik schreibt keine Position von Weltobjekten und entfernt keine Elemente direkt', () => {
  const module = ['loop.js', 'client.js', 'gegner.js', 'boss.js', 'waffen.js', 'powerups.js', 'partikel.js',
    'gleve.js', 'input.js', 'utils.js', 'network.js'];
  const verboten = /\.el\.style\.(left|top|transform|opacity)\s*=|\.el\.remove\(\)/;
  const funde = [];
  for (const datei of module) {
    const zeilen = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', datei), 'utf8').split('\n');
    zeilen.forEach((zeile, i) => { if (verboten.test(zeile)) funde.push(`${datei}:${i + 1}: ${zeile.trim()}`); });
  }
  expect(funde).toEqual([]);
});
