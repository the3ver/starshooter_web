// Rauchtest fuer den Balancing-Messstand (npm run balancing laeuft nicht in npm test/CI).
// Beleg: 938ccc5 (Menue-Umbau) brach den Messstand unbemerkt, repariert erst in b6a55cb.
const { test, expect } = require('@playwright/test');
const { messe, bereiteMessungVor } = require('../balancing/messung');

for (const schiff of ['viper', 'phantom', 'gleve', 'sniper']) {
  test(`Messstand laeuft im Co-op-Feld: ${schiff}`, async ({ page }) => {
    await bereiteMessungVor(page, schiff);
    const r = await messe(page, { schiff, szenario: 'A_welle', seed: 1, maxSchritte: 300 });
    expect(r.schritte).toBeGreaterThan(0);
    // Spielfeld wie beim echten Co-op-Start (b6a55cb), nicht Menuebreite
    const breite = await page.evaluate(() => window.__game.config.spielfeldBreite);
    expect(breite).toBe(600);
  });
}
