const { test, expect } = require('@playwright/test');
const { setGameState, startGame } = require('./helpers');

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

// Ein Simulationsschritt bei Level/Frame (frame = Zaehlerstand nach dem Schritt) auf leerem Feld.
// Math.random = 0.99: kein Hacker, verwalteFeindSpawns erzeugt genau einen normalen Jaeger.
async function stepAt(page, level, frame, bossActive = false) {
  return page.evaluate(
    async ({ level, frame, bossActive }) => {
      const { state, arrays } = await import('./js/state.js');
      const { simulationStep } = await import('./js/loop.js');
      const Display = await import('./js/display.js');
      const Growths = await import('./js/growths.js');
      ['enemies', 'asteroids', 'enemyLaserArray', 'powerups'].forEach(name => {
        arrays[name].forEach(Display.remove);
        arrays[name].length = 0;
      });
      state.level = level;
      state.bossActive = bossActive;
      state.bossWarningActive = false;
      state.frameCounter = frame - 1;
      const orig = Math.random;
      Math.random = () => 0.99;
      try {
        simulationStep();
      } finally {
        Math.random = orig;
      }
      const r = {
        asteroids: arrays.asteroids.length,
        // nur Feinde aus dem Feind-Takt; Gewaechse (Fels-Level) wachsen nach eigenem Takt
        enemies: arrays.enemies.filter(f => !Growths.isGrowth(f)).length,
        bossWarning: state.bossWarningActive,
      };
      state.bossWarningActive = false;
      state.bossActive = false;
      return r;
    },
    { level, frame, bossActive },
  );
}

// Charakterisierung des Level-Ablaufs: Asteroiden-Takt in drei Phasen (bis 1200, bis 2400, danach),
// Feinde ab einem Startframe im festen Takt, Boss-Warnung bei Frame 3600. Raten skalieren mit dem Level.
const cases = [
  // [level, frame, asteroiden, feinde]
  [1, 120, 1, 0],
  [1, 121, 0, 0],
  [1, 900, 0, 0],
  [1, 1200, 1, 0], // Grenze: noch Starttakt 120, Feinde erst nach 1200
  [1, 1300, 1, 0], // Mitteltakt 100
  [1, 1500, 1, 1], // Feindtakt 300
  [1, 2480, 1, 0], // Endtakt 80
  [5, 900, 0, 1], // Asteroiden 80/60/40, Feinde ab 800 alle 180
  [5, 960, 1, 0],
  [11, 600, 1, 0], // Untergrenzen 40/30/20, Feinde ab 600 alle 120 (Level 11: kein Fels-Level)
  [11, 720, 1, 1],
  [12, 600, 0, 1], // Fels-Level: Asteroiden halb so oft (80), Bio-Feinde ab 300 alle 120
  [12, 640, 1, 0],
];

for (const [level, frame, asteroids, enemies] of cases) {
  test(`Level ${level}, Frame ${frame}: ${asteroids} Asteroid(en), ${enemies} Feind(e)`, async ({ page }) => {
    const r = await stepAt(page, level, frame);
    expect(r).toEqual({ asteroids, enemies, bossWarning: false });
  });
}

test('Boss-Warnung genau bei Frame 3600, nicht davor oder danach', async ({ page }) => {
  expect((await stepAt(page, 1, 3599)).bossWarning).toBe(false);
  expect((await stepAt(page, 1, 3600)).bossWarning).toBe(true);
  expect((await stepAt(page, 1, 3601)).bossWarning).toBe(false);
});

test('Waehrend des Bosskampfs keine Spawns', async ({ page }) => {
  const r = await stepAt(page, 1, 1500, true);
  expect(r).toEqual({ asteroids: 0, enemies: 0, bossWarning: false });
});
