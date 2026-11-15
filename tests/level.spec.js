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

// Ein Simulationsschritt bei Level/Frame (frame = Zaehlerstand nach dem Schritt) auf leerem Feld.
// Math.random = 0.99: kein Hacker, verwalteFeindSpawns erzeugt genau einen normalen Jaeger.
async function schrittBei(page, level, frame, bossAktiv = false) {
  return page.evaluate(
    async ({ level, frame, bossAktiv }) => {
      const { state, arrays } = await import('./js/state.js');
      const { simulationsSchritt } = await import('./js/loop.js');
      const Anzeige = await import('./js/anzeige.js');
      ['feinde', 'asteroiden', 'feindLaserArray', 'powerups'].forEach(name => {
        arrays[name].forEach(Anzeige.entferne);
        arrays[name].length = 0;
      });
      state.level = level;
      state.bossAktiv = bossAktiv;
      state.bossWarningAktiv = false;
      state.frameZaehler = frame - 1;
      const orig = Math.random;
      Math.random = () => 0.99;
      try {
        simulationsSchritt();
      } finally {
        Math.random = orig;
      }
      const r = {
        asteroiden: arrays.asteroiden.length,
        feinde: arrays.feinde.length,
        bossWarnung: state.bossWarningAktiv,
      };
      state.bossWarningAktiv = false;
      state.bossAktiv = false;
      return r;
    },
    { level, frame, bossAktiv },
  );
}

// Charakterisierung des Level-Ablaufs: Asteroiden-Takt in drei Phasen (bis 1200, bis 2400, danach),
// Feinde ab einem Startframe im festen Takt, Boss-Warnung bei Frame 3600. Raten skalieren mit dem Level.
const faelle = [
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
  [12, 600, 1, 0], // Untergrenzen 40/30/20, Feinde ab 600 alle 120
  [12, 720, 1, 1],
];

for (const [level, frame, asteroiden, feinde] of faelle) {
  test(`Level ${level}, Frame ${frame}: ${asteroiden} Asteroid(en), ${feinde} Feind(e)`, async ({ page }) => {
    const r = await schrittBei(page, level, frame);
    expect(r).toEqual({ asteroiden, feinde, bossWarnung: false });
  });
}

test('Boss-Warnung genau bei Frame 3600, nicht davor oder danach', async ({ page }) => {
  expect((await schrittBei(page, 1, 3599)).bossWarnung).toBe(false);
  expect((await schrittBei(page, 1, 3600)).bossWarnung).toBe(true);
  expect((await schrittBei(page, 1, 3601)).bossWarnung).toBe(false);
});

test('Waehrend des Bosskampfs keine Spawns', async ({ page }) => {
  const r = await schrittBei(page, 1, 1500, true);
  expect(r).toEqual({ asteroiden: 0, feinde: 0, bossWarnung: false });
});
