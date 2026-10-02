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

test('Host: applyPlayerInput akzeptiert nur endliche Zahlen und begrenzt auf das Spielfeld', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { state, config, Network } = window.__game;
    state.p2 = state.p2 || {};
    const maxX = config.spielfeldBreite - config.spielerGroesse;
    const maxY = config.spielfeldHoehe - config.spielerGroesse;
    const lies = () => ({ x: state.p2.x, y: state.p2.y });
    const out = { maxX, maxY };

    state.p2.x = 100; state.p2.y = 200;
    Network.applyPlayerInput({ x: 150, y: 250 });
    out.gueltig = lies();

    Network.applyPlayerInput({ x: NaN, y: Infinity });
    out.nan = lies();
    Network.applyPlayerInput({ x: '999', y: { a: 1 } });
    out.strings = lies();
    Network.applyPlayerInput({ x: null, y: undefined });
    out.leer = lies();

    Network.applyPlayerInput({ x: -500, y: -1 });
    out.unten = lies();
    Network.applyPlayerInput({ x: 99999, y: 99999 });
    out.oben = lies();

    // gemischt: x gueltig, y ungueltig
    state.p2.x = 10; state.p2.y = 20;
    Network.applyPlayerInput({ x: 77, y: NaN });
    out.gemischt = lies();
    return out;
  });
  expect(r.gueltig).toEqual({ x: 150, y: 250 });
  expect(r.nan).toEqual({ x: 150, y: 250 });
  expect(r.strings).toEqual({ x: 150, y: 250 });
  expect(r.leer).toEqual({ x: 150, y: 250 });
  expect(r.unten).toEqual({ x: 0, y: 0 });
  expect(r.oben).toEqual({ x: r.maxX, y: r.maxY });
  expect(r.gemischt).toEqual({ x: 77, y: 20 });
});

test('Bestenliste: API-Strings werden escaped, Titel-Attribut bleibt heil', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Utils } = window.__game;
    Utils.renderHighscoresTable('single', [
      { name: '<img src=x onerror=alert(1)>', city: 'A"B', country: 'DE', score: 1234, shipP1: 'viper' },
      { name: 'X&Y', city: "O'<b>", country: 'US', score: 5, shipP1: 'phantom' }
    ]);
    const tbody = document.getElementById('highscore-body');
    const zeilen = [...tbody.querySelectorAll('tr')];
    return {
      zeilen: zeilen.length,
      imgs: tbody.querySelectorAll('img').length,
      bs: tbody.querySelectorAll('b').length,
      name1: zeilen[0].children[1].textContent,
      titel1: zeilen[0].querySelector('.hs-location').getAttribute('title'),
      attrs: zeilen[0].querySelector('.hs-location').getAttributeNames(),
      name2: zeilen[1].children[1].textContent,
      titel2: zeilen[1].querySelector('.hs-location').getAttribute('title'),
      score1: zeilen[0].children[2].textContent
    };
  });
  expect(r.zeilen).toBe(2);
  expect(r.imgs).toBe(0);
  expect(r.bs).toBe(0);
  expect(r.name1.startsWith('<img src=x onerror=alert(1)>')).toBe(true);
  expect(r.titel1).toBe('A"B, DE');
  expect(r.attrs).toEqual(['class', 'title']);
  expect(r.name2.startsWith('X&Y')).toBe(true);
  expect(r.titel2).toBe("O'<b>, US");
  expect(r.score1).toBe('1234');
});
