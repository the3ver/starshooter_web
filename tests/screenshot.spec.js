const { test, expect } = require('@playwright/test');

test('Generiere Gameplay-Screenshot fuer README.md', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.6.50');
    localStorage.setItem('starshooter_skip_cutscene', 'true');
  });

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
    stateMod.state.energie = 100;
    if (inputMod.feuereLaser) inputMod.feuereLaser();

    // Feinde und Asteroiden erzeugen
    entMod.erzeugeFeind();
    entMod.erzeugeFeind();
    entMod.erzeugeAsteroid();
    entMod.erzeugeAsteroid();

    // Positionen der Feinde etwas anpassen fuer gute Bildkomposition
    if (stateMod.arrays.feinde[0]) {
      stateMod.arrays.feinde[0].y = 120;
      stateMod.arrays.feinde[0].x = 100;
      stateMod.arrays.feinde[0].el.style.top = '120px';
      stateMod.arrays.feinde[0].el.style.left = '100px';
    }
    if (stateMod.arrays.feinde[1]) {
      stateMod.arrays.feinde[1].y = 180;
      stateMod.arrays.feinde[1].x = 240;
      stateMod.arrays.feinde[1].el.style.top = '180px';
      stateMod.arrays.feinde[1].el.style.left = '240px';
    }
    if (stateMod.arrays.asteroiden[0]) {
      stateMod.arrays.asteroiden[0].y = 80;
      stateMod.arrays.asteroiden[0].x = 180;
      stateMod.arrays.asteroiden[0].el.style.top = '80px';
      stateMod.arrays.asteroiden[0].el.style.left = '180px';
    }
  });

  await page.waitForTimeout(300);

  // Screenshot vom Spielfeld aufnehmen
  const spielfeld = page.locator('#spielfeld');
  await spielfeld.screenshot({ path: 'docs/gameplay.png' });
});