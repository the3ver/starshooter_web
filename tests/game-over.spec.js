// Game over screen: NEUSTART starts the next round directly, HAUPTMENÜ goes to the menu, and game keys
// still held or pressed right after the game over do not land in the highscore name field (issue #25).
const { test, expect } = require('@playwright/test');
const { setGameState, startGame, installClock, pauseClock, advanceClock } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false}' }),
  );
});

async function gameOver(page, mode) {
  await setGameState(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
  if (mode) await page.click(`#gamemode-btn-${mode}`);
  await startGame(page, 'KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning);
  await page.evaluate(() => window.__game.Utils.triggerGameOver());
}

test('NEUSTART starts the next round in the same mode with the same ship', async ({ page }) => {
  await gameOver(page, 'coop');
  const ship = await page.evaluate(() => window.__game.state.selectedShipModel);
  await page.click('#btn-restart');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.gameOverActive);
  const r = await page.evaluate(() => ({
    mode: window.__game.state.gameMode,
    ship: window.__game.state.selectedShipModel,
    startScreen: getComputedStyle(document.getElementById('start-screen')).display,
  }));
  expect(r).toEqual({ mode: 'coop', ship, startScreen: 'none' });
});

test('HAUPTMENÜ returns to the start menu', async ({ page }) => {
  await gameOver(page);
  await page.click('#btn-game-over-menu');
  const r = await page.evaluate(() => ({
    running: window.__game.state.gameRunning,
    over: window.__game.state.gameOverActive,
    startScreen: getComputedStyle(document.getElementById('start-screen')).display,
  }));
  expect(r).toEqual({ running: false, over: false, startScreen: 'block' });
});

test('online mode offers no NEUSTART (host and client would have to agree)', async ({ page }) => {
  await gameOver(page);
  await page.evaluate(() => {
    window.__game.state.gameMode = 'online';
    window.__game.Utils.triggerGameOver();
  });
  await expect(page.locator('#btn-restart')).toBeHidden();
  await expect(page.locator('#btn-game-over-menu')).toBeVisible();
});

test('keys right after the game over and auto-repeat do not type into the name field', async ({ page }) => {
  await installClock(page);
  await setGameState(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
  await pauseClock(page);
  await page.evaluate(() => window.__game.Utils.triggerGameOver());
  const field = page.locator('#highscore-name');
  await expect(field).toBeVisible();
  await field.focus();
  await page.keyboard.press('w');
  expect(await field.inputValue()).toBe('');
  await advanceClock(page, 600);
  await page.keyboard.down('d');
  await page.keyboard.down('d'); // held key: auto-repeat
  await page.keyboard.up('d');
  expect(await field.inputValue()).toBe('d');
  await page.keyboard.press('a');
  expect(await field.inputValue()).toBe('da');
});
