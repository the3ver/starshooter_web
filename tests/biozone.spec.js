const { test, expect } = require('@playwright/test');
const { setGameState, startGame } = require('./helfer');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await setGameState(page);
  await page.goto('/');
  await startGame(page);
  await page.waitForFunction(() => window.__game.state.gameRunning);
});

test('Levelplan: Fels-Level haben das Thema biozone, die anderen standard', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const L = await import('./js/level.js');
    return [3, 4, 5, 6].map(l => L.levelPlan(l).theme);
  });
  expect(r).toEqual(['standard', 'biozone', 'standard', 'biozone']);
});

test('Spielfeld bekommt im Fels-Level die Klasse thema-biozone und verliert sie im naechsten Level', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { simulationStep } = await import('./js/loop.js');
    const field = document.getElementById('spielfeld');
    field.style.transition = 'none'; // Farbe ohne Ueberblendung messen
    state.godMode = true;
    state.frameCounter = 1;
    const classes = () => [...field.classList].filter(k => k.startsWith('thema-'));
    state.level = 4;
    simulationStep();
    const level4 = classes();
    const background = getComputedStyle(field).backgroundColor;
    const network = getComputedStyle(field, '::before').backgroundImage.startsWith('url(');
    state.level = 5;
    simulationStep();
    return { level4, background, network, level5: classes() };
  });
  expect(r.level4).toEqual(['thema-biozone']);
  expect(r.background).toBe('rgb(13, 9, 6)');
  expect(r.network).toBe(true);
  expect(r.level5).toEqual([]);
});

test('Bildschirm-Blitz kehrt zur Themenfarbe zurueck statt zur festen Standardfarbe', async ({ page }) => {
  await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { simulationStep } = await import('./js/loop.js');
    const Display = await import('./js/anzeige.js');
    document.getElementById('spielfeld').style.transition = 'none';
    state.godMode = true;
    state.level = 4;
    simulationStep();
    Display.flashPlayfield('#ff0000', 20);
  });
  await page.waitForFunction(() => document.getElementById('spielfeld').style.backgroundColor === '');
  const color = await page.evaluate(() => getComputedStyle(document.getElementById('spielfeld')).backgroundColor);
  expect(color).toBe('rgb(13, 9, 6)');
});

test('Online-Client uebernimmt das Thema aus dem Level im Snapshot', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { clientStep } = await import('./js/client.js');
    const field = document.getElementById('spielfeld');
    state.level = 6;
    clientStep();
    const six = field.classList.contains('thema-biozone');
    state.level = 7;
    clientStep();
    return { six, seven: field.classList.contains('thema-biozone') };
  });
  expect(r).toEqual({ six: true, seven: false });
});

test('Fels zeigt Steinplatten (globales Muster) mit dunkler Kante, ohne Knoten', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const Display = await import('./js/anzeige.js');
    const p = { l: 50, r: 50, inner: 200, ib: 0 };
    const s = Display.create({ id: 'fe_t', x: 0, y: 100, top: p, bottom: p }, 'rock');
    arrays.rock.push(s);
    const wall = s.el.querySelector('polygon.fels-wand');
    return {
      pattern: !!document.querySelector('#fels-defs pattern#fels-steine'),
      patternOnce: document.querySelectorAll('#fels-defs').length,
      fill: getComputedStyle(wall).fill.includes('fels-steine'),
      seam: s.el.querySelectorAll('polyline.fels-kante').length,
      node: s.el.querySelectorAll('polyline.fels-knoten').length,
    };
  });
  expect(r).toEqual({ pattern: true, patternOnce: 1, fill: true, seam: 2, node: 0 });
});

test('Neustart entfernt das Biozonen-Thema (Cutszene und Level 1 ohne Geflecht)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { simulationStep } = await import('./js/loop.js');
    const Utils = await import('./js/utils.js');
    const field = document.getElementById('spielfeld');
    state.godMode = true;
    state.level = 4;
    simulationStep();
    const beforehand = field.classList.contains('thema-biozone');
    Utils.restartGame();
    const afterRestart = field.classList.contains('thema-biozone');
    // erneut ein Fels-Level: das Thema kommt wieder (nach dem Neustart laeuft erst die Cutszene)
    state.level = 4;
    (await import('./js/level.js')).checkTheme();
    return { beforehand, afterRestart, again: field.classList.contains('thema-biozone') };
  });
  expect(r).toEqual({ beforehand: true, afterRestart: false, again: true });
});

test('Felsoptik: gleiche Segment-Id ergibt dieselbe Zeichnung, Wurmloecher nur auf breitem Fels, Kante gestuft', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const Display = await import('./js/anzeige.js');
    const build = (id, p) => Display.create({ id, x: 0, y: 0, top: { ...p }, bottom: { ...p } }, 'rock').el;
    const wide = { l: 140, r: 140, inner: 200, ib: 0 };
    const narrow = { l: 20, r: 20, inner: 200, ib: 0 };
    const a = build('fe_77', wide);
    const b = build('fe_77', wide);
    let holesWide = 0;
    let holesNarrow = 0;
    for (let i = 0; i < 40; i++) {
      holesWide += build('fe_b' + i, wide).querySelectorAll('.wurmloch, .fels-kugel').length;
      holesNarrow += build('fe_s' + i, narrow).querySelectorAll('.wurmloch, .fels-kugel').length;
    }
    const edge = a.querySelector('polyline.fels-kante').getAttribute('points').split(' ').length;
    [a, b].forEach(el => el.remove());
    document.querySelectorAll('.fels-segment').forEach(el => el.remove());
    return { equal: a.innerHTML === b.innerHTML, holesWide, holesNarrow, edge };
  });
  expect(r.equal).toBe(true);
  expect(r.holesWide).toBeGreaterThan(20);
  expect(r.holesNarrow).toBe(0);
  expect(r.edge).toBe(4); // zwei Plattenreihen, je zwei Punkte
});
