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

// Tester-Feedback: Treffer durch Asteroiden/Feinde mit sichtbarem Abstand. Die alte Bounding-Box zaehlte leere Ecken mit.
test('Koerperkollision: diagonal Ecke an Ecke ist kein Treffer mehr, mittig ueberlappend schon', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { config } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const s = config.spielerGroesse;
    const spieler = { x: 100, y: 300 };
    const pruefe = (obj, anteil) => Utils.koerperTrifftSpieler(spieler, obj, anteil);
    const A = Utils.ASTEROID_TREFFER_RADIUS;
    const F = Utils.FEIND_TREFFER_RADIUS;
    return {
      // 45er-Asteroid oben links, Boxen ueberlappen um 8 px je Achse (frueher Treffer)
      asteroidEcke: pruefe({ x: spieler.x - 45 + 8, y: spieler.y - 45 + 8, groesse: 45 }, A),
      // Feind schraeg oben rechts, Boxen ueberlappen um 6 px je Achse (frueher Treffer)
      feindEcke: pruefe({ x: spieler.x + s - 6, y: spieler.y - 30 + 6, groesse: 30 }, F),
      // Frontal: Asteroid direkt ueber dem Schiff, 10 px Ueberlappung
      asteroidFrontal: pruefe({ x: spieler.x - 7, y: spieler.y - 45 + 10, groesse: 45 }, A),
      // Deckungsgleich
      feindMitte: pruefe({ x: spieler.x, y: spieler.y, groesse: 30 }, F),
      // Klar getrennt
      weitWeg: pruefe({ x: spieler.x + 80, y: spieler.y, groesse: 45 }, A),
    };
  });
  expect(r.asteroidEcke).toBe(false);
  expect(r.feindEcke).toBe(false);
  expect(r.asteroidFrontal).toBe(true);
  expect(r.feindMitte).toBe(true);
  expect(r.weitWeg).toBe(false);
});
