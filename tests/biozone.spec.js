const { test, expect } = require('@playwright/test');
const { setzeSpielstand, starteSpiel } = require('./helfer');

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
  await starteSpiel(page);
  await page.waitForFunction(() => window.__game.state.spielLaeuft);
});

test('Levelplan: Fels-Level haben das Thema biozone, die anderen standard', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const L = await import('./js/level.js');
    return [3, 4, 5, 6].map(l => L.levelPlan(l).thema);
  });
  expect(r).toEqual(['standard', 'biozone', 'standard', 'biozone']);
});

test('Spielfeld bekommt im Fels-Level die Klasse thema-biozone und verliert sie im naechsten Level', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    const feld = document.getElementById('spielfeld');
    feld.style.transition = 'none'; // Farbe ohne Ueberblendung messen
    state.godMode = true;
    state.frameZaehler = 1;
    const klassen = () => [...feld.classList].filter(k => k.startsWith('thema-'));
    state.level = 4;
    simulationsSchritt();
    const level4 = klassen();
    const hintergrund = getComputedStyle(feld).backgroundColor;
    const netz = getComputedStyle(feld, '::before').backgroundImage.startsWith('url(');
    state.level = 5;
    simulationsSchritt();
    return { level4, hintergrund, netz, level5: klassen() };
  });
  expect(r.level4).toEqual(['thema-biozone']);
  expect(r.hintergrund).toBe('rgb(13, 9, 6)');
  expect(r.netz).toBe(true);
  expect(r.level5).toEqual([]);
});

test('Bildschirm-Blitz kehrt zur Themenfarbe zurueck statt zur festen Standardfarbe', async ({ page }) => {
  await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    const Anzeige = await import('./js/anzeige.js');
    document.getElementById('spielfeld').style.transition = 'none';
    state.godMode = true;
    state.level = 4;
    simulationsSchritt();
    Anzeige.blitzeSpielfeld('#ff0000', 20);
  });
  await page.waitForFunction(() => document.getElementById('spielfeld').style.backgroundColor === '');
  const farbe = await page.evaluate(() => getComputedStyle(document.getElementById('spielfeld')).backgroundColor);
  expect(farbe).toBe('rgb(13, 9, 6)');
});

test('Online-Client uebernimmt das Thema aus dem Level im Snapshot', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { clientSchritt } = await import('./js/client.js');
    const feld = document.getElementById('spielfeld');
    state.level = 6;
    clientSchritt();
    const sechs = feld.classList.contains('thema-biozone');
    state.level = 7;
    clientSchritt();
    return { sechs, sieben: feld.classList.contains('thema-biozone') };
  });
  expect(r).toEqual({ sechs: true, sieben: false });
});

test('Fels zeigt Steinplatten (globales Muster) mit dunkler Kante, ohne Knoten', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const Anzeige = await import('./js/anzeige.js');
    const p = { l: 50, r: 50, im: 200, ib: 0 };
    const s = Anzeige.erzeuge({ id: 'fe_t', x: 0, y: 100, oben: p, unten: p }, 'fels');
    arrays.fels.push(s);
    const wand = s.el.querySelector('polygon.fels-wand');
    return {
      muster: !!document.querySelector('#fels-defs pattern#fels-steine'),
      musterEinmal: document.querySelectorAll('#fels-defs').length,
      fuellung: getComputedStyle(wand).fill.includes('fels-steine'),
      saum: s.el.querySelectorAll('polyline.fels-kante').length,
      knoten: s.el.querySelectorAll('polyline.fels-knoten').length,
    };
  });
  expect(r).toEqual({ muster: true, musterEinmal: 1, fuellung: true, saum: 2, knoten: 0 });
});

test('Neustart entfernt das Biozonen-Thema (Cutszene und Level 1 ohne Geflecht)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    const Utils = await import('./js/utils.js');
    const feld = document.getElementById('spielfeld');
    state.godMode = true;
    state.level = 4;
    simulationsSchritt();
    const vorher = feld.classList.contains('thema-biozone');
    Utils.restartGame();
    const nachNeustart = feld.classList.contains('thema-biozone');
    // erneut ein Fels-Level: das Thema kommt wieder (nach dem Neustart laeuft erst die Cutszene)
    state.level = 4;
    (await import('./js/level.js')).pruefeThema();
    return { vorher, nachNeustart, wieder: feld.classList.contains('thema-biozone') };
  });
  expect(r).toEqual({ vorher: true, nachNeustart: false, wieder: true });
});
