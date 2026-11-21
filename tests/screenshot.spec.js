const { test } = require('@playwright/test');
const path = require('path');
const { setGameState } = require('./helpers');

test('Generate gameplay screenshot for README.md', async ({ page }) => {
  await setGameState(page);

  await page.goto('/');

  // Start the game with a key
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(50);
  await page.keyboard.up('KeyW');

  // Wait briefly until the playfield is active
  await page.waitForTimeout(500);

  // Spawn a few action-rich elements dynamically
  await page.evaluate(async () => {
    const stateMod = await import('./js/state.js');
    const entitiesModule = await import('./js/entities.js');
    const inputMod = await import('./js/input.js');

    // Laser feuern
    stateMod.state.energy = 100;
    if (inputMod.fireLaser) inputMod.fireLaser();

    // Create enemies and asteroids
    entitiesModule.createEnemy();
    entitiesModule.createEnemy();
    entitiesModule.createAsteroid();
    entitiesModule.createAsteroid();

    // Adjust enemy positions a bit for a good composition
    if (stateMod.arrays.enemies[0]) {
      stateMod.arrays.enemies[0].y = 120;
      stateMod.arrays.enemies[0].x = 100;
      stateMod.arrays.enemies[0].el.style.top = '120px';
      stateMod.arrays.enemies[0].el.style.left = '100px';
    }
    if (stateMod.arrays.enemies[1]) {
      stateMod.arrays.enemies[1].y = 180;
      stateMod.arrays.enemies[1].x = 240;
      stateMod.arrays.enemies[1].el.style.top = '180px';
      stateMod.arrays.enemies[1].el.style.left = '240px';
    }
    if (stateMod.arrays.asteroids[0]) {
      stateMod.arrays.asteroids[0].y = 80;
      stateMod.arrays.asteroids[0].x = 180;
      stateMod.arrays.asteroids[0].el.style.top = '80px';
      stateMod.arrays.asteroids[0].el.style.left = '180px';
    }
  });

  await page.waitForTimeout(300);

  // Take a screenshot of the playfield (path independent of the working directory)
  const playfield = page.locator('#spielfeld');
  await playfield.screenshot({ path: path.join(__dirname, '..', 'docs', 'gameplay.png') });
});
