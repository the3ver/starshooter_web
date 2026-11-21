const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helpers');

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
});

test('Asteroid outline: 8-13 corners inside the box, shaped differently', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Entities = await import('./js/entities.js');
    const shapes = Array.from({ length: 200 }, () => Entities.generateAsteroidForm());
    const corners = shapes.map(f => f.length);
    const inBox = shapes.every(f => f.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100));
    // smallest radius per shape: dents and stretches give clearly smaller values
    const minRadius = shapes.map(f => Math.min(...f.map(([x, y]) => Math.hypot(x - 50, y - 50))));
    return {
      min: Math.min(...corners),
      max: Math.max(...corners),
      inBox,
      withNotch: minRadius.filter(r => r < 31).length,
      round: minRadius.filter(r => r >= 37).length,
    };
  });
  expect(r.min).toBeGreaterThanOrEqual(8);
  expect(r.max).toBeLessThanOrEqual(13);
  expect(r.inBox).toBe(true);
  expect(r.withNotch).toBeGreaterThan(20);
  expect(r.round).toBeGreaterThan(20);
});

test('Asteroid colors come from the rock palettes', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Entities = await import('./js/entities.js');
    const { arrays, config } = await import('./js/state.js');
    for (let i = 0; i < 80; i++) Entities.createAsteroid(10, 10, 30, 0, 0, 0, true);
    const pairs = new Set(arrays.asteroids.map(a => a.color + a.color2));
    const allowed = new Set(config.asteroidsPalettes.map(p => p.a + p.b));
    return { allAllowed: [...pairs].every(p => allowed.has(p)), different: pairs.size };
  });
  expect(r.allAllowed).toBe(true);
  expect(r.different).toBeGreaterThan(3);
});

test('Asteroid texture: craters from the id (same for the same id), magma with veins, cracks on top', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const Entities = await import('./js/entities.js');
    const form = Entities.generateAsteroidForm();
    const build = (id, extra = {}) =>
      Display.create(
        { id, x: 0, y: 0, size: 40, color: '#9aa3a8', color2: '#3a4248', form, crack: 0, ...extra },
        'asteroid',
      ).el;
    const a = build('a_5');
    const b = build('a_5');
    const c = build('a_6');
    const magma = build('a_7', { isIndestructible: true, isMagma: true, crack: null });
    const texture = a.querySelector('svg.asteroid-textur');
    const crack = a.querySelector('.riss-layer');
    return {
      equal: texture.innerHTML === b.querySelector('svg.asteroid-textur').innerHTML,
      different: texture.innerHTML !== c.querySelector('svg.asteroid-textur').innerHTML,
      crater: texture.querySelectorAll('ellipse').length >= 4,
      veins: magma.querySelectorAll('path.magma-ader').length,
      crackAbove: texture.compareDocumentPosition(crack) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
      crackPosition: getComputedStyle(crack).position,
    };
  });
  expect(r).toMatchObject({ equal: true, different: true, crater: true, crackAbove: true, crackPosition: 'relative' });
  expect(r.veins).toBeGreaterThanOrEqual(2);
});
