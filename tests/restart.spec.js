// Restart clears all world lists (afd5d90, 5522e68: forgotten lists stayed after the restart)
const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helpers');

// Lists that deliberately survive the restart
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

test('restartGame empties every list in arrays (new list without cleanup = red)', async ({ page }) => {
  const r = await page.evaluate(async remain => {
    const Display = await import('./js/display.js');
    const { arrays, state } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const domBackend = Display.getBackend();
    // Null backend: the placeholders have no display
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
  expect(r.left, 'restartGame (utils.js) must empty these lists').toEqual([]);
});

// Classes on body and #spielfeld (theme, mode effects) must be as on load after the restart
// (642b082: thema-biozone stayed visible after the restart)
test('restartGame restores the classes of body and #spielfeld to the loaded state', async ({ page }) => {
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
    state.level = 4; // Rock level: sets the biozone theme
    simulationStep();
    const inGame = classes();
    Utils.restartGame();
    return { loaded, inGame, afterRestart: classes() };
  });
  expect(r.inGame, 'Test setup: the rock level must set a class').not.toEqual(r.loaded);
  expect(r.afterRestart, 'restartGame (utils.js) must reset these classes').toEqual(r.loaded);
});
