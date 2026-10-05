const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

// Spectre-SR (sniper), Stand S1: nur Grundlage (Auswahl, Anzeige, HUD, Uebergangsverhalten mit normalen Waffen).

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.route('**/api/turn*', route => route.fulfill({ status: 503, body: '' }));
  await setzeSpielstand(page);
  await page.goto('/');
});

async function startePerTaste(page) {
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
  await page.keyboard.up('KeyW');
}

test('Spectre-SR: im Hangar waehlbar, Name und Perks aus shipModels, Railgun-SVG, Werfer-Pods aus, HUD GRANATE', async ({ page }) => {
  const btn = page.locator('.hangar-model-btn[data-model="sniper"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(btn).toHaveClass(/active/);

  const werte = await page.evaluate(() => {
    const { state, shipModels } = window.__game;
    const m = shipModels.sniper;
    return { model: state.selectedShipModel, name: m.name, speed: m.speed, regen: m.energyRegen, perks: m.perks.map(p => p.label) };
  });
  expect(werte.model).toBe('sniper');
  expect(werte.speed).toBe(4.5);
  expect(werte.regen).toBe(0.45);
  expect(werte.perks).toHaveLength(5);
  await expect(page.locator('#hangar-ship-name')).toContainText(werte.name);
  await expect(page.locator('#hangar-ship-perks .hangar-perk-chip')).toHaveCount(werte.perks.length);
  for (let i = 0; i < werte.perks.length; i++) {
    await page.locator('#hangar-ship-perks .hangar-perk-chip').nth(i).click();
    await expect(page.locator('#hangar-perk-detail')).toContainText(werte.perks[i]);
  }
  expect(await page.locator('#hangar-preview-svg').evaluate(el => el.innerHTML)).toContain('Railgun');

  await startePerTaste(page);

  expect(await page.locator('#spieler svg').evaluate(el => el.innerHTML)).toContain('Railgun');
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('E');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('GRANATE');
  await expect(page.locator('#btn-rakete span')).toHaveText('G');

  // Pods bleiben auch bei hoher Raketenstufe aus, ohne Abwurf-Effekt
  const abwurf = await page.evaluate(() => {
    const { state, Utils } = window.__game;
    state.raketenStufe = 5;
    Utils.updateAktivePowerupsUI();
    state.raketenStufe = 1;
    Utils.updateAktivePowerupsUI();
    return document.querySelectorAll('.werfer-abgeworfen').length;
  });
  expect(abwurf).toBe(0);
  for (const pod of ['links', 'rechts', 'center']) {
    await expect(page.locator('#spieler .werfer-' + pod)).toBeHidden();
  }

  // Zurueck zur Viper: Originaltexte und Werfer
  await page.evaluate(() => {
    window.__game.state.selectedShipModel = 'viper';
    window.__game.Utils.updatePlayerShipVisuals();
  });
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('R');
  await expect(page.locator('#btn-rakete span')).toHaveText('R');
  await expect(page.locator('#spieler .werfer-links')).toBeVisible();
});

test('Spectre-SR: im Coop fuer Spieler 2 waehlbar, P2-HUD, Highscore-Badge', async ({ page }) => {
  await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
  await page.locator('.hangar-player-tab[data-player="p2"]').click();
  await page.locator('.hangar-model-btn[data-model="sniper"]').click();
  const modelle = await page.evaluate(() => ({ p1: window.__game.state.selectedShipModel, p2: window.__game.state.p2.selectedShipModel }));
  expect(modelle).toEqual({ p1: 'viper', p2: 'sniper' });
  await expect(page.locator('#raketen-cd-container-p2 .cooldown-letter')).toHaveText('GRANATE');
  await expect(page.locator('#energie-cd-container-p2 .cooldown-letter')).toHaveText('E');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('R');
  expect(await page.locator('#spieler-2 svg').evaluate(el => el.innerHTML)).toContain('Railgun');

  const badge = await page.evaluate(() => {
    window.__game.Utils.renderHighscoresTable('single', [{ name: 'AAA', score: 100, level: 1, shipP1: 'sniper', country: '', city: '' }]);
    const b = document.querySelector('#highscore-body [class*="hs-ship-"]');
    return b ? { klasse: b.className, text: b.textContent } : null;
  });
  expect(badge).not.toBeNull();
  expect(badge.klasse).toContain('hs-ship-sniper');
  expect(badge.klasse).not.toContain('hs-ship-viper');
});

test('Spectre-SR: Uebergang mit normalen Waffen, Coop mit Bot laeuft ohne Fehler', async ({ page }) => {
  const fehler = [];
  page.on('pageerror', e => fehler.push(e.message));
  await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
  await page.locator('.hangar-player-tab[data-player="p2"]').click();
  await page.locator('.hangar-model-btn[data-model="sniper"]').click();
  await page.locator('.hangar-player-tab[data-player="p1"]').click();
  await page.locator('.hangar-model-btn[data-model="sniper"]').click();
  await page.evaluate(() => { window.__game.state.p2IsBot = true; });
  await startePerTaste(page);
  const ergebnis = await page.evaluate(() => {
    const { state, arrays, Loop } = window.__game;
    state.godMode = true;
    state.tastenGedrueckt.l = true;
    state.tastenGedrueckt.k = true;
    let laser = 0;
    for (let i = 0; i < 900; i++) {
      Loop.simulationsSchritt();
      laser = Math.max(laser, arrays.laserArray.length);
    }
    return { laser, p1: state.selectedShipModel, p2: state.p2.selectedShipModel };
  });
  expect(ergebnis.laser).toBeGreaterThan(0);
  expect(ergebnis.p1).toBe('sniper');
  expect(ergebnis.p2).toBe('sniper');
  expect(fehler).toEqual([]);
});

test('Spectre-SR: Menue bleibt mit vier Hangar-Knoepfen einzeilig und ohne Scrollen', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  const m = await page.evaluate(() => {
    const start = document.getElementById('start-screen');
    const knoepfe = [...document.querySelectorAll('.hangar-model-btn')].map(b => ({
      top: Math.round(b.getBoundingClientRect().top), ueberlaeuft: b.scrollWidth > b.clientWidth
    }));
    return { anzahl: knoepfe.length, tops: new Set(knoepfe.map(k => k.top)).size, ueberlaeuft: knoepfe.some(k => k.ueberlaeuft), scroll: start.scrollHeight - start.clientHeight };
  });
  expect(m.anzahl).toBe(4);
  expect(m.tops).toBe(1);
  expect(m.ueberlaeuft).toBe(false);
  expect(m.scroll).toBeLessThanOrEqual(0);
});
