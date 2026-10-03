const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.7.1');
    localStorage.setItem('starshooter_skip_cutscene', 'true');
  });
  await page.goto('/');
});

test('Gleve-MR: im Hangar wählbar, Werte, Manta-SVG, keine Werfer-Pods, HUD ANTRIEB/SWEEP', async ({ page }) => {
  const gleveBtn = page.locator('.hangar-model-btn[data-model="gleve"]');
  await expect(gleveBtn).toBeVisible();
  await gleveBtn.click();
  await expect(gleveBtn).toHaveClass(/active/);
  await expect(page.locator('#hangar-ship-name')).toContainText('GLEVE-MR REAVER');
  await expect(page.locator('#hangar-ship-perks .hangar-perk-badge')).toHaveCount(5);

  const werte = await page.evaluate(async () => {
    const { state, shipModels } = await import('./js/state.js');
    return { model: state.selectedShipModel, gleve: shipModels.gleve };
  });
  expect(werte.model).toBe('gleve');
  expect(werte.gleve).toBeTruthy();
  expect(werte.gleve.speed).toBe(5.0);
  expect(werte.gleve.energyRegen).toBe(0.3);
  expect(werte.gleve.startShield).toBe(0);
  expect(werte.gleve.loseUpgradesOnHit).toBe(false);
  expect(werte.gleve.shieldRegen).toBeFalsy();

  // Spiel starten
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(50);
  await page.keyboard.up('KeyW');
  await expect(page.locator('#spieler')).toBeVisible();

  // Manta-SVG wird gerendert
  const svgHtml = await page.locator('#spieler svg').evaluate(el => el.innerHTML);
  expect(svgHtml).toContain('Gleve-MR');
  expect(await page.locator('#spieler svg path').count()).toBeGreaterThanOrEqual(5);

  // HUD-Beschriftungen
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('ANTRIEB');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('SWEEP');

  // Werfer-Pods auch bei Raketenstufe 5 ausgeblendet, ohne Abwurf-Effekt
  await expect(page.locator('#spieler .werfer-links')).toBeHidden();
  await expect(page.locator('#spieler .werfer-rechts')).toBeHidden();
  await expect(page.locator('#spieler .werfer-center')).toBeHidden();
  const abwurf = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    state.raketenStufe = 5;
    Utils.updateAktivePowerupsUI();
    state.raketenStufe = 1;
    Utils.updateAktivePowerupsUI();
    return document.querySelectorAll('.werfer-abgeworfen').length;
  });
  expect(abwurf).toBe(0);
  await expect(page.locator('#spieler .werfer-center')).toBeHidden();

  // Zurück zur Viper: Originaltexte und Werfer
  await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    state.selectedShipModel = 'viper';
    Utils.updatePlayerShipVisuals();
  });
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('E');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('R');
  await expect(page.locator('#spieler .werfer-links')).toBeVisible();
});

test('Gleve-MR: im Coop für Spieler 2 wählbar, P2-HUD und Highscore-Badge G', async ({ page }) => {
  await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    Utils.setGameMode('coop');
  });
  await page.locator('.hangar-player-tab[data-player="p2"]').click();
  await page.locator('.hangar-model-btn[data-model="gleve"]').click();

  const modelle = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    return { p1: state.selectedShipModel, p2: state.p2.selectedShipModel };
  });
  expect(modelle.p1).toBe('viper');
  expect(modelle.p2).toBe('gleve');
  await expect(page.locator('#energie-cd-container-p2 .cooldown-letter')).toHaveText('ANTRIEB');
  await expect(page.locator('#raketen-cd-container-p2 .cooldown-letter')).toHaveText('SWEEP');
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('E');
  const p2Svg = await page.locator('#spieler-2 svg').evaluate(el => el.innerHTML);
  expect(p2Svg).toContain('Gleve-MR');

  // Highscore-Badges: Solo "Gleve-MR", Coop-Mini "G" mit eigener Klasse
  const badges = await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    Utils.renderHighscoresTable('single', [{ name: 'GLV', score: 500, shipP1: 'gleve' }]);
    const solo = document.querySelector('#highscore-body .hs-ship-gleve');
    const soloText = solo ? solo.textContent : null;
    Utils.renderHighscoresTable('coop_bot', [{ name: 'A+B', score: 500, shipP1: 'phantom', shipP2: 'gleve' }]);
    const mini = document.querySelector('#highscore-body .hs-badge-mini.hs-ship-gleve');
    return { soloText, miniText: mini ? mini.textContent : null };
  });
  expect(badges.soloText).toBe('Gleve-MR');
  expect(badges.miniText).toBe('P2:G');
});
