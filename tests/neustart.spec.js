// Neustart raeumt alle Weltlisten ab (afd5d90, 5522e68: vergessene Listen blieben nach dem Neustart stehen)
const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

// Listen, die den Neustart bewusst ueberleben
const BLEIBEN = ['sterne'];

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

test('restartGame leert jede Liste in arrays (neue Liste ohne Aufraeumen = rot)', async ({ page }) => {
  const r = await page.evaluate(async bleiben => {
    const Anzeige = await import('./js/anzeige.js');
    const { arrays, state } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const domBackend = Anzeige.holeBackend();
    // Null-Backend: die Platzhalter haben keine Darstellung
    Anzeige.setzeBackend({
      erzeuge() {},
      zeichneWelt() {},
      zeichneSpieler() {},
      entferne() {},
      blitze() {},
      blitzeSpielfeld() {},
    });
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

// Klassen auf body und #spielfeld (Thema, Modus-Effekte) muessen nach dem Neustart wie beim Laden sein
// (642b082: thema-biozone blieb nach dem Neustart sichtbar)
test('restartGame stellt die Klassen von body und #spielfeld wie beim Laden her', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    const Utils = await import('./js/utils.js');
    const klassen = () => ({
      body: [...document.body.classList].sort(),
      spielfeld: [...document.getElementById('spielfeld').classList].sort(),
    });
    const geladen = klassen();
    state.godMode = true;
    state.spielLaeuft = true;
    state.level = 4; // Fels-Level: setzt das Biozonen-Thema
    simulationsSchritt();
    const imSpiel = klassen();
    Utils.restartGame();
    return { geladen, imSpiel, nachNeustart: klassen() };
  });
  expect(r.imSpiel, 'Testaufbau: das Fels-Level muss eine Klasse setzen').not.toEqual(r.geladen);
  expect(r.nachNeustart, 'restartGame (utils.js) muss diese Klassen zuruecksetzen').toEqual(r.geladen);
});
