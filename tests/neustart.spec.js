// Neustart raeumt alle Weltlisten ab (afd5d90, 5522e68: vergessene Listen blieben nach dem Neustart stehen)
const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helfer');

// Listen, die den Neustart bewusst ueberleben
const REMAIN = ['stars'];

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

test('restartGame leert jede Liste in arrays (neue Liste ohne Aufraeumen = rot)', async ({ page }) => {
  const r = await page.evaluate(async remain => {
    const Display = await import('./js/anzeige.js');
    const { arrays, state } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const domBackend = Display.getBackend();
    // Null-Backend: die Platzhalter haben keine Darstellung
    Display.setBackend({
      create() {},
      drawWorld() {},
      drawPlayer() {},
      remove() {},
      flash() {},
      flashPlayfield() {},
    });
    try {
      state.gameMode = 'coop';
      const listen = Object.keys(arrays).filter(k => !remain.includes(k));
      for (const k of listen) {
        for (const pKey of ['p1', 'p2']) arrays[k].push({ id: `${k}_${pKey}`, pKey, owner: pKey, x: 0, y: 0 });
      }
      Utils.restartGame();
      return { listen, left: listen.filter(k => arrays[k].length > 0) };
    } finally {
      Display.setBackend(domBackend);
    }
  }, REMAIN);
  expect(r.listen.length).toBeGreaterThan(10);
  expect(r.left, 'restartGame (utils.js) muss diese Listen leeren').toEqual([]);
});

// Klassen auf body und #spielfeld (Thema, Modus-Effekte) muessen nach dem Neustart wie beim Laden sein
// (642b082: thema-biozone blieb nach dem Neustart sichtbar)
test('restartGame stellt die Klassen von body und #spielfeld wie beim Laden her', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { simulationStep } = await import('./js/loop.js');
    const Utils = await import('./js/utils.js');
    const classes = () => ({
      body: [...document.body.classList].sort(),
      playfield: [...document.getElementById('spielfeld').classList].sort(),
    });
    const loaded = classes();
    state.godMode = true;
    state.gameRunning = true;
    state.level = 4; // Fels-Level: setzt das Biozonen-Thema
    simulationStep();
    const inGame = classes();
    Utils.restartGame();
    return { loaded, inGame, afterRestart: classes() };
  });
  expect(r.inGame, 'Testaufbau: das Fels-Level muss eine Klasse setzen').not.toEqual(r.loaded);
  expect(r.afterRestart, 'restartGame (utils.js) muss diese Klassen zuruecksetzen').toEqual(r.loaded);
});
