// Issue #32: the controls dialog keeps every entry on one line and explains the chosen ship's abilities
// (both ships in co-op) and the superweapon powerup S
const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false}' }),
  );
  await setGameState(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
});

async function openDialog(page, p1, p2) {
  await page.evaluate(
    ([a, b]) => {
      window.__game.state.selectedShipModel = a;
      if (b) window.__game.state.p2.selectedShipModel = b;
    },
    [p1, p2],
  );
  await page.click('#btn-open-steuerung');
  return page.locator('#steuerung-schiff');
}

test('no controls entry breaks across lines, ESC is listed for pause', async ({ page }) => {
  await openDialog(page, 'viper');
  const r = await page.evaluate(() => {
    const entries = [...document.querySelectorAll('#steuerung-overlay .steuerung-eintrag')].filter(
      e => e.offsetParent !== null,
    );
    // broken = split into several boxes (inline) or taller than one line (inline-block or block)
    const broken = e =>
      e.getClientRects().length > 1 ||
      e.getBoundingClientRect().height > 1.5 * parseFloat(getComputedStyle(e).lineHeight);
    return { count: entries.length, broken: entries.filter(broken).map(e => e.textContent) };
  });
  expect(r.count).toBeGreaterThan(5);
  expect(r.broken).toEqual([]);
  await expect(page.locator('#steuerung-info-single')).toContainText('ESC');
});

for (const [ship, words] of [
  ['viper', ['Ausweichrolle']],
  ['phantom', ['Schild']],
  ['gleve', ['Sweep', 'Dash']],
  ['sniper', ['Schuss', 'Granate', 'Minen']],
]) {
  test(`ship section for ${ship} names its abilities and the superweapon`, async ({ page }) => {
    const section = await openDialog(page, ship);
    for (const w of words) await expect(section).toContainText(w);
    await expect(section).toContainText('Superwaffe');
    await expect(section).not.toContainText('SPIELER 2');
  });
}

test('co-op lists the abilities of both ships', async ({ page }) => {
  await page.click('#gamemode-btn-coop');
  const section = await openDialog(page, 'gleve', 'sniper');
  await expect(section).toContainText('SPIELER 1');
  await expect(section).toContainText('Dash');
  await expect(section).toContainText('SPIELER 2');
  await expect(section).toContainText('Granate');
});
