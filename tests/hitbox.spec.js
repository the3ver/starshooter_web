const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helfer');

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

// Tester-Feedback: Treffer durch Asteroiden/Feinde mit sichtbarem Abstand. Die alte Bounding-Box zaehlte leere Ecken mit.
test('Koerperkollision: diagonal Ecke an Ecke ist kein Treffer mehr, mittig ueberlappend schon', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { config } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const s = config.playerSize;
    const player = { x: 100, y: 300 };
    const check = (obj, share) => Utils.bodyHitsPlayer(player, obj, share);
    const A = Utils.ASTEROID_HIT_RADIUS;
    const F = Utils.ENEMY_HIT_RADIUS;
    return {
      // 45er-Asteroid oben links, Boxen ueberlappen um 8 px je Achse (frueher Treffer)
      asteroidCorner: check({ x: player.x - 45 + 8, y: player.y - 45 + 8, size: 45 }, A),
      // Feind schraeg oben rechts, Boxen ueberlappen um 6 px je Achse (frueher Treffer)
      enemyCorner: check({ x: player.x + s - 6, y: player.y - 30 + 6, size: 30 }, F),
      // Frontal: Asteroid direkt ueber dem Schiff, 10 px Ueberlappung
      asteroidFrontal: check({ x: player.x - 7, y: player.y - 45 + 10, size: 45 }, A),
      // Deckungsgleich
      enemyMiddle: check({ x: player.x, y: player.y, size: 30 }, F),
      // Klar getrennt
      farGone: check({ x: player.x + 80, y: player.y, size: 45 }, A),
    };
  });
  expect(r.asteroidCorner).toBe(false);
  expect(r.enemyCorner).toBe(false);
  expect(r.asteroidFrontal).toBe(true);
  expect(r.enemyMiddle).toBe(true);
  expect(r.farGone).toBe(false);
});

// Grenzfaelle: Trefferradius in Pixeln festgehalten (Schiff 30 px, Asteroid 45 px: 10,8 + 18,9 = 29,7 px;
// Feind 30 px: 10,8 + 12 = 22,8 px). 0,5 px innerhalb = Treffer, 0,5 px ausserhalb = keiner, auch diagonal.
test('Koerperkollision: Trefferradius stimmt auf 0,5 px (gerade und diagonal)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { config } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const s = config.playerSize;
    const player = { x: 100, y: 300 };
    const middle = { x: player.x + s / 2, y: player.y + s / 2 };
    // Objekt der Groesse g mit Mittelpunktabstand d in Richtung winkel
    const hits = (g, share, d, angle) =>
      Utils.bodyHitsPlayer(
        player,
        { x: middle.x + d * Math.cos(angle) - g / 2, y: middle.y + d * Math.sin(angle) - g / 2, size: g },
        share,
      );
    const cases = {};
    for (const [name, g, share, radius] of [
      ['asteroid', 45, Utils.ASTEROID_HIT_RADIUS, 29.7],
      ['enemy', 30, Utils.ENEMY_HIT_RADIUS, 22.8],
    ]) {
      for (const [direction, angle] of [
        ['gerade', 0],
        ['diagonal', Math.PI / 4],
      ]) {
        cases[`${name} ${direction} innen`] = hits(g, share, radius - 0.5, angle);
        cases[`${name} ${direction} aussen`] = hits(g, share, radius + 0.5, angle);
      }
    }
    return { playerSize: s, cases };
  });
  expect(r.playerSize).toBe(30);
  for (const [fall, hit] of Object.entries(r.cases)) expect(hit, fall).toBe(fall.endsWith('innen'));
});
