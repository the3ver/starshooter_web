const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helfer');

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

test('Host: applyPlayerInput akzeptiert nur endliche Zahlen und begrenzt auf das Spielfeld', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { state, config, Network } = window.__game;
    state.p2 = state.p2 || {};
    const maxX = config.playfieldWidth - config.playerSize;
    const maxY = config.playfieldHeight - config.playerSize;
    const read = () => ({ x: state.p2.x, y: state.p2.y });
    const out = { maxX, maxY };

    state.p2.x = 100;
    state.p2.y = 200;
    Network.applyPlayerInput({ x: 150, y: 250 });
    out.valid = read();

    Network.applyPlayerInput({ x: NaN, y: Infinity });
    out.nan = read();
    Network.applyPlayerInput({ x: '999', y: { a: 1 } });
    out.strings = read();
    Network.applyPlayerInput({ x: null, y: undefined });
    out.empty = read();

    Network.applyPlayerInput({ x: -500, y: -1 });
    out.bottom = read();
    Network.applyPlayerInput({ x: 99999, y: 99999 });
    out.top = read();

    // gemischt: x gueltig, y ungueltig
    state.p2.x = 10;
    state.p2.y = 20;
    Network.applyPlayerInput({ x: 77, y: NaN });
    out.mixed = read();
    return out;
  });
  expect(r.valid).toEqual({ x: 150, y: 250 });
  expect(r.nan).toEqual({ x: 150, y: 250 });
  expect(r.strings).toEqual({ x: 150, y: 250 });
  expect(r.empty).toEqual({ x: 150, y: 250 });
  expect(r.bottom).toEqual({ x: 0, y: 0 });
  expect(r.top).toEqual({ x: r.maxX, y: r.maxY });
  expect(r.mixed).toEqual({ x: 77, y: 20 });
});

test('Bestenliste: API-Strings werden escaped, Titel-Attribut bleibt heil', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Utils } = window.__game;
    Utils.renderHighscoresTable('single', [
      { name: '<img src=x onerror=alert(1)>', city: 'A"B', country: 'DE', score: 1234, shipP1: 'viper' },
      { name: 'X&Y', city: "O'<b>", country: 'US', score: 5, shipP1: 'phantom' },
    ]);
    const tbody = document.getElementById('highscore-body');
    const lines = [...tbody.querySelectorAll('tr')];
    return {
      lines: lines.length,
      imgs: tbody.querySelectorAll('img').length,
      bs: tbody.querySelectorAll('b').length,
      name1: lines[0].children[1].textContent,
      title1: lines[0].querySelector('.hs-location').getAttribute('title'),
      attrs: lines[0].querySelector('.hs-location').getAttributeNames(),
      name2: lines[1].children[1].textContent,
      title2: lines[1].querySelector('.hs-location').getAttribute('title'),
      score1: lines[0].children[2].textContent,
    };
  });
  expect(r.lines).toBe(2);
  expect(r.imgs).toBe(0);
  expect(r.bs).toBe(0);
  expect(r.name1.startsWith('<img src=x onerror=alert(1)>')).toBe(true);
  expect(r.title1).toBe('A"B, DE');
  expect(r.attrs).toEqual(['class', 'title']);
  expect(r.name2.startsWith('X&Y')).toBe(true);
  expect(r.title2).toBe("O'<b>, US");
  expect(r.score1).toBe('1234');
});
