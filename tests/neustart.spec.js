// Neustart raeumt alle Weltlisten ab (afd5d90, 5522e68: vergessene Listen blieben nach dem Neustart stehen)
const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

// Listen, die den Neustart bewusst ueberleben
const BLEIBEN = ['sterne'];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await setzeSpielstand(page);
  await page.goto('/');
});

test('restartGame leert jede Liste in arrays (neue Liste ohne Aufraeumen = rot)', async ({ page }) => {
  const r = await page.evaluate(async (bleiben) => {
    const Anzeige = await import('./js/anzeige.js');
    const { arrays, state } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const domBackend = Anzeige.holeBackend();
    // Null-Backend: die Platzhalter haben keine Darstellung
    Anzeige.setzeBackend({ erzeuge() {}, zeichneWelt() {}, zeichneSpieler() {}, entferne() {}, blitze() {}, blitzeSpielfeld() {} });
    try {
      state.gameMode = 'coop';
      const listen = Object.keys(arrays).filter(k => !bleiben.includes(k));
      for (const k of listen) {
        for (const pKey of ['p1', 'p2']) arrays[k].push({ id: `${k}_${pKey}`, pKey, owner: pKey, x: 0, y: 0 });
      }
      Utils.restartGame();
      return { listen, uebrig: listen.filter(k => arrays[k].length > 0) };
    } finally {
      Anzeige.setzeBackend(domBackend);
    }
  }, BLEIBEN);
  expect(r.listen.length).toBeGreaterThan(10);
  expect(r.uebrig, 'restartGame (utils.js) muss diese Listen leeren').toEqual([]);
});
