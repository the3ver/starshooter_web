// The game HUD (hearts, weapon bars, score, level, P2 HUD) is visible only while a game runs or on the
// game over screen; the start menu and the intro cutscene hide it (issues #28, #27, #24).
const { test, expect } = require('@playwright/test');
const { setGameState, startGame, installClock, pauseClock, windUntil } = require('./helpers');

const HUD = ['#ui-container', '#ui-container-p2', '#score-anzeige', '#level-anzeige'];

async function hudVisible(page) {
  return page.evaluate(
    ids =>
      Object.fromEntries(
        ids.map(id => {
          const el = document.querySelector(id);
          const style = getComputedStyle(el);
          return [id, style.visibility !== 'hidden' && style.display !== 'none'];
        }),
      ),
    HUD,
  );
}

// Starts the intro cutscene with a paused fake clock: page time passes only by winding, so the cutscene
// cannot end or animate on its own while the test measures
async function startCutsceneWithClock(page) {
  await setGameState(page, { skipCutscene: false });
  await installClock(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
  await pauseClock(page);
  await page.keyboard.down('w');
  await windUntil(page, () => page.evaluate(() => window.__game.state.cutsceneActive), 1000, 50);
  await page.keyboard.up('w');
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false}' }),
  );
});

test('start menu hides the game HUD, a running game shows it (#28)', async ({ page }) => {
  await setGameState(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
  const menu = await hudVisible(page);
  expect(menu['#ui-container']).toBe(false);
  expect(menu['#score-anzeige']).toBe(false);
  expect(menu['#level-anzeige']).toBe(false);
  await startGame(page, 'KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning);
  await page.evaluate(async () => (await import('./js/loop.js')).simulationStep());
  const game = await hudVisible(page);
  expect(game['#ui-container']).toBe(true);
  expect(game['#score-anzeige']).toBe(true);
  expect(game['#level-anzeige']).toBe(true);
});

test('the intro cutscene hides the score under the skip hint (#27)', async ({ page }) => {
  await startCutsceneWithClock(page);
  await page.evaluate(async () => (await import('./js/loop.js')).simulationStep());
  const cutscene = await hudVisible(page);
  expect(cutscene['#score-anzeige']).toBe(false);
  expect(cutscene['#ui-container']).toBe(false);
});

test('co-op back to the main menu hides the P2 HUD (#24)', async ({ page }) => {
  await setGameState(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
  await page.click('#gamemode-btn-coop');
  await startGame(page, 'KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning);
  await page.evaluate(async () => (await import('./js/loop.js')).simulationStep());
  expect((await hudVisible(page))['#ui-container-p2']).toBe(true);
  await page.evaluate(async () => {
    const Pause = await import('./js/pause.js');
    Pause.togglePause();
    Pause.endGameToMainMenu();
    (await import('./js/loop.js')).simulationStep();
  });
  const menu = await hudVisible(page);
  expect(menu['#ui-container-p2']).toBe(false);
  expect(menu['#ui-container']).toBe(false);
});

test('the sound button stays clickable during the intro cutscene (#27)', async ({ page }) => {
  await startCutsceneWithClock(page);
  const onTop = await page.evaluate(() => {
    const b = document.getElementById('btn-sound-toggle');
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return b === top || b.contains(top);
  });
  expect(onTop).toBe(true);
});

test('the game over screen keeps the HUD visible (final hearts and score)', async ({ page }) => {
  await setGameState(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
  await startGame(page, 'KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning);
  await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    Utils.triggerGameOver();
    (await import('./js/loop.js')).simulationStep();
  });
  expect(await page.evaluate(() => window.__game.state.gameOverActive)).toBe(true);
  const over = await hudVisible(page);
  expect(over['#ui-container']).toBe(true);
  expect(over['#score-anzeige']).toBe(true);
});
