// Issue #31: a visible pause button next to the sound button, and a touch controls switch in the controls
// dialog (AUTO / AN / AUS, stored in the browser) for hybrid devices
const { test, expect } = require('@playwright/test');
const { setGameState, startGame } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false}' }),
  );
  await setGameState(page);
});

async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
}

async function mobileControlsInGame(page) {
  await startGame(page, 'KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning);
  return page.evaluate(() => getComputedStyle(document.getElementById('mobile-controls')).display !== 'none');
}

test('pause button: hidden in the menu, pauses and resumes a running game by click', async ({ page }) => {
  await open(page);
  const btn = page.locator('#btn-pause');
  await expect(btn).toBeHidden();
  await startGame(page, 'KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning);
  await page.evaluate(async () => (await import('./js/loop.js')).simulationStep());
  await expect(btn).toBeVisible();
  await btn.click();
  expect(await page.evaluate(() => window.__game.state.paused)).toBe(true);
  await btn.click();
  expect(await page.evaluate(() => window.__game.state.paused)).toBe(false);
});

test('AUTO on a desktop shows no touch controls', async ({ page }) => {
  await open(page);
  expect(await mobileControlsInGame(page)).toBe(false);
});

test('touch switch: AUTO -> AN -> AUS -> AUTO, AN shows the controls and is remembered', async ({ page }) => {
  await open(page);
  await page.click('#btn-open-steuerung');
  const sw = page.locator('#btn-touch-steuerung');
  const stored = () => page.evaluate(() => localStorage.getItem('starshooter_touch_controls'));
  await expect(sw).toHaveText('TOUCH-STEUERUNG: AUTO');
  await sw.click();
  await expect(sw).toHaveText('TOUCH-STEUERUNG: AN');
  expect(await stored()).toBe('on');
  await sw.click();
  await expect(sw).toHaveText('TOUCH-STEUERUNG: AUS');
  expect(await stored()).toBe('off');
  await sw.click();
  await expect(sw).toHaveText('TOUCH-STEUERUNG: AUTO');
  expect(await stored()).toBeNull();
  await sw.click();
  await page.click('#btn-close-steuerung');
  expect(await mobileControlsInGame(page)).toBe(true);
  await open(page);
  await page.click('#btn-open-steuerung');
  await expect(sw).toHaveText('TOUCH-STEUERUNG: AN');
});

test.describe('on a touch device', () => {
  test.use({ hasTouch: true });

  test('AUTO shows the touch controls, AUS (via the switch) hides them', async ({ page }) => {
    await open(page);
    expect(await mobileControlsInGame(page)).toBe(true);
    await open(page);
    await page.click('#btn-open-steuerung');
    await page.click('#btn-touch-steuerung');
    await page.click('#btn-touch-steuerung');
    await expect(page.locator('#btn-touch-steuerung')).toHaveText('TOUCH-STEUERUNG: AUS');
    await page.click('#btn-close-steuerung');
    expect(await mobileControlsInGame(page)).toBe(false);
  });
});
