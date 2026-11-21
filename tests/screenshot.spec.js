const { test } = require('@playwright/test');
const path = require('path');
const { setGameState } = require('./helfer');

test('Generiere Gameplay-Screenshot fuer README.md', async ({ page }) => {
  await setGameState(page);

  await page.goto('/');

  // Spiel starten durch Taste
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(50);
  await page.keyboard.up('KeyW');

  // Kurz warten, bis Spielfeld aktiv ist
  await page.waitForTimeout(500);

  // Dynamisch ein paar actionreiche Elemente spawnen
  await page.evaluate(async () => {
    const stateMod = await import('./js/state.js');
    const entMod = await import('./js/entities.js');
    const inputMod = await import('./js/input.js');

    // Laser feuern
    stateMod.state.energy = 100;
    if (inputMod.fireLaser) inputMod.fireLaser();

    // Feinde und Asteroiden erzeugen
    entMod.createEnemy();
    entMod.createEnemy();
    entMod.createAsteroid();
    entMod.createAsteroid();

    // Positionen der Feinde etwas anpassen fuer gute Bildkomposition
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

  // Screenshot vom Spielfeld aufnehmen (Pfad unabhaengig vom Arbeitsverzeichnis)
  const playfield = page.locator('#spielfeld');
  await playfield.screenshot({ path: path.join(__dirname, '..', 'docs', 'gameplay.png') });
});
