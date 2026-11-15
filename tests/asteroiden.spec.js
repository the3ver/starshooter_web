const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await setzeSpielstand(page);
  await page.goto('/');
});

test('Asteroiden-Umriss: 8-13 Ecken im Kasten, unterschiedlich geformt', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Entities = await import('./js/entities.js');
    const formen = Array.from({ length: 200 }, () => Entities.generiereAsteroidForm());
    const ecken = formen.map(f => f.length);
    const imKasten = formen.every(f => f.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100));
    // kleinster Radius je Form: Einbuchtungen und Streckungen ergeben deutlich kleinere Werte
    const minRadius = formen.map(f => Math.min(...f.map(([x, y]) => Math.hypot(x - 50, y - 50))));
    return {
      min: Math.min(...ecken),
      max: Math.max(...ecken),
      imKasten,
      mitKerbe: minRadius.filter(r => r < 31).length,
      rund: minRadius.filter(r => r >= 37).length,
    };
  });
  expect(r.min).toBeGreaterThanOrEqual(8);
  expect(r.max).toBeLessThanOrEqual(13);
  expect(r.imKasten).toBe(true);
  expect(r.mitKerbe).toBeGreaterThan(20);
  expect(r.rund).toBeGreaterThan(20);
});

test('Asteroiden-Farben kommen aus den Gesteinspaletten', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Entities = await import('./js/entities.js');
    const { arrays, config } = await import('./js/state.js');
    for (let i = 0; i < 80; i++) Entities.erzeugeAsteroid(10, 10, 30, 0, 0, 0, true);
    const paare = new Set(arrays.asteroiden.map(a => a.farbe + a.farbe2));
    const erlaubt = new Set(config.asteroidenPaletten.map(p => p.a + p.b));
    return { alleErlaubt: [...paare].every(p => erlaubt.has(p)), verschiedene: paare.size };
  });
  expect(r.alleErlaubt).toBe(true);
  expect(r.verschiedene).toBeGreaterThan(3);
});

test('Asteroiden-Textur: Krater aus der Id (gleich bei gleicher Id), Magma mit Adern, Risse liegen darueber', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const Entities = await import('./js/entities.js');
    const form = Entities.generiereAsteroidForm();
    const bau = (id, extra = {}) =>
      Anzeige.erzeuge(
        { id, x: 0, y: 0, groesse: 40, farbe: '#9aa3a8', farbe2: '#3a4248', form, riss: 0, ...extra },
        'asteroid',
      ).el;
    const a = bau('a_5');
    const b = bau('a_5');
    const c = bau('a_6');
    const magma = bau('a_7', { istUnzerstoerbar: true, istMagma: true, riss: null });
    const textur = a.querySelector('svg.asteroid-textur');
    const riss = a.querySelector('.riss-layer');
    return {
      gleich: textur.innerHTML === b.querySelector('svg.asteroid-textur').innerHTML,
      anders: textur.innerHTML !== c.querySelector('svg.asteroid-textur').innerHTML,
      krater: textur.querySelectorAll('ellipse').length >= 4,
      adern: magma.querySelectorAll('path.magma-ader').length,
      rissDarueber: textur.compareDocumentPosition(riss) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
      rissPosition: getComputedStyle(riss).position,
    };
  });
  expect(r).toMatchObject({ gleich: true, anders: true, krater: true, rissDarueber: true, rissPosition: 'relative' });
  expect(r.adern).toBeGreaterThanOrEqual(2);
});
