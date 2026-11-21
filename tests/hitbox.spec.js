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

// Tester feedback: hits from asteroids/enemies at a visible distance. The old bounding box counted empty corners.
test('Body collision: corner to corner diagonally is no longer a hit, overlapping in the middle still is', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { config } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const s = config.playerSize;
    const player = { x: 100, y: 300 };
    const check = (obj, share) => Utils.bodyHitsPlayer(player, obj, share);
    const A = Utils.ASTEROID_HIT_RADIUS;
    const F = Utils.ENEMY_HIT_RADIUS;
    return {
      // 45px asteroid top left, boxes overlap by 8 px per axis (used to be a hit)
      asteroidCorner: check({ x: player.x - 45 + 8, y: player.y - 45 + 8, size: 45 }, A),
      // Enemy diagonally top right, boxes overlap by 6 px per axis (used to be a hit)
      enemyCorner: check({ x: player.x + s - 6, y: player.y - 30 + 6, size: 30 }, F),
      // Head-on: asteroid directly above the ship, 10 px overlap
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

// Edge cases: hit radius pinned in pixels (ship 30 px, asteroid 45 px: 10.8 + 18.9 = 29.7 px;
// enemy 30 px: 10.8 + 12 = 22.8 px). 0.5 px inside = hit, 0.5 px outside = none, also diagonally.
test('Body collision: hit radius is exact to 0.5 px (straight and diagonal)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { config } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const s = config.playerSize;
    const player = { x: 100, y: 300 };
    const middle = { x: player.x + s / 2, y: player.y + s / 2 };
    // Object of size g with center distance d in direction angle
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
        ['straight', 0],
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
