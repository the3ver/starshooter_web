const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.6.53');
    localStorage.setItem('starshooter_skip_cutscene', 'true');
  });
  await page.goto('/');
});

test('Raketen-Schockwelle erscheint an der Detonationsstelle', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    const { dom } = await import('./js/state.js');
    Utils.erzeugeRaketenDetonation(300, 200, 70);
    const sw = dom.spielfeld.querySelector('.schockwelle');
    // Layout-Koordinaten relativ zum Spielfeld (unabhaengig von CSS-Skalierung)
    return {
      parent: sw.offsetParent === dom.spielfeld,
      cx: sw.offsetLeft + sw.offsetWidth / 2,
      cy: sw.offsetTop + sw.offsetHeight / 2
    };
  });
  expect(r.parent).toBe(true);
  expect(Math.abs(r.cx - 300)).toBeLessThanOrEqual(3);
  expect(Math.abs(r.cy - 200)).toBeLessThanOrEqual(3);
});
