// Smoke test for the balancing bench (npm run balancing does not run in npm test/CI).
// Evidence: 938ccc5 (menu rework) broke the bench unnoticed, fixed only in b6a55cb.
const { test, expect } = require('@playwright/test');
const { measure, prepareMeasurement } = require('../balancing/measurement');

for (const ship of ['viper', 'phantom', 'gleve', 'sniper']) {
  test(`bench runs in the co-op field: ${ship}`, async ({ page }) => {
    await prepareMeasurement(page, ship);
    const r = await measure(page, { ship, scenario: 'A_wave', seed: 1, maxSteps: 300 });
    expect(r.steps).toBeGreaterThan(0);
    // Playfield as on a real co-op start (b6a55cb), not menu width
    const width = await page.evaluate(() => window.__game.config.playfieldWidth);
    expect(width).toBe(600);
  });
}
