// Rauchtest fuer den Balancing-Messstand (npm run balancing laeuft nicht in npm test/CI).
// Beleg: 938ccc5 (Menue-Umbau) brach den Messstand unbemerkt, repariert erst in b6a55cb.
const { test, expect } = require('@playwright/test');
const { measure, prepareMeasurement } = require('../balancing/measurement');

for (const ship of ['viper', 'phantom', 'gleve', 'sniper']) {
  test(`Messstand laeuft im Co-op-Feld: ${ship}`, async ({ page }) => {
    await prepareMeasurement(page, ship);
    const r = await measure(page, { ship, scenario: 'A_welle', seed: 1, maxSteps: 300 });
    expect(r.steps).toBeGreaterThan(0);
    // Spielfeld wie beim echten Co-op-Start (b6a55cb), nicht Menuebreite
    const width = await page.evaluate(() => window.__game.config.playfieldWidth);
    expect(width).toBe(600);
  });
}
