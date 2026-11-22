// Every class the game sets on elements in #spielfeld has a rule in src/style.css.
// Evidence: #35, the English rename turned the particle class 'partikel' into 'particles' (no CSS rule:
// particles were invisible) and no test noticed.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { setGameState } = require('./helpers');

// Classes without a CSS rule that serve only as markers for JS or tests. Shrink this list, never grow it
// without a reason.
const MARKERS_WITHOUT_CSS = [
  'aktive-powerups-p2',
  'bombe-p2',
  'credits',
  'fels-kugel',
  'gewaechs',
  'highscore-status',
  'leben-anzeige',
  'powerup-towed-p1',
  'powerup-towed-p2',
  'stielauge',
  'trichter-mund',
  'werfer-lvl-1',
  'wurmloch',
];

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
  await page.waitForFunction(() => window.__game && window.__game.state);
});

test('every class set in #spielfeld during a busy co-op game has a CSS rule or is a known marker', async ({ page }) => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'style.css'), 'utf8');
  const known = [...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m => m[1]))];
  const seen = await page.evaluate(async () => {
    const { state } = window.__game;
    // Fixed seed (mulberry32): the scenario must create the same elements on every run
    let x = 7;
    Math.random = () => {
      x = (x + 0x6d2b79f5) | 0;
      let t = Math.imul(x ^ (x >>> 15), 1 | x);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const Loop = await import('./js/loop.js');
    const Entities = await import('./js/entities.js');
    const Utils = await import('./js/utils.js');
    Utils.setGameMode('coop');
    Utils.restartGame();
    state.gameRunning = true;
    state.godMode = true;
    state.level = 4;
    for (const t of ['laserTier', 'missileTier', 'bombTier']) state[t] = 5;
    const classes = new Set();
    for (let i = 0; i < 900; i++) {
      if (i % 30 === 0) {
        Entities.createEnemy(100 + (i % 200), 50);
        Entities.createAsteroid();
        Entities.createPowerup(200, 100);
      }
      state.keysPressed[' '] = i % 4 === 0;
      state.keysPressed.l = true;
      state.keysPressed.k = i % 10 === 0;
      Loop.simulationStep();
      if (i % 10 === 0)
        document.querySelectorAll('#spielfeld *').forEach(el => el.classList.forEach(c => classes.add(c)));
    }
    return [...classes];
  });
  const allowed = new Set([...known, ...MARKERS_WITHOUT_CSS]);
  expect(seen.length, 'test setup: the scenario must create many elements').toBeGreaterThan(30);
  expect(seen.includes('partikel'), 'explosions create spark particles').toBe(true);
  expect(
    seen.filter(c => !allowed.has(c)).sort(),
    'class without a rule in src/style.css (CSS classes stay German, see docs/review.md R1)',
  ).toEqual([]);
});
