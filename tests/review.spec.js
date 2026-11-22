const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helpers');

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

test('Host: applyPlayerInput accepts only finite numbers and clamps to the playfield', async ({ page }) => {
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

    // mixed: x valid, y invalid
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

test('Leaderboard: API strings are escaped, title attribute stays intact', async ({ page }) => {
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

// A manipulated host must not inject HTML into the client: the client builds the powerup owner tag
// from the snapshot (display-dom-objects.js powerupElement), so it accepts only 'p1' / 'p2' as owner.
test('Online client: a powerup owner from the snapshot cannot inject HTML', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { state, arrays, Network } = window.__game;
    state.gameMode = 'online';
    state.gameRunning = true;
    state.network.isOnline = true;
    state.network.isHost = false;
    state.network.isClient = true;
    arrays.powerups.forEach(p => p.el && p.el.remove());
    arrays.powerups.length = 0;
    window.__xss = false;
    const evil = '<img src=x onerror="window.__xss = true">';
    Network.applyGameStateSnapshot({
      p1: { x: 200, y: 400, rotate: 0, lives: 3, energy: 50, maxEnergy: 50, isDead: false },
      p2: { x: 350, y: 400, rotate: 0, lives: 3, energy: 50, maxEnergy: 50, isDead: false },
      score: 0,
      level: 1,
      powerups: [
        { id: 'pu_1', x: 100, y: 100, type: 'energy', owner: evil },
        { id: 'pu_2', x: 150, y: 100, type: 'energy', owner: 'p2' },
      ],
    });
    const playfield = document.getElementById('spielfeld');
    return {
      images: playfield.querySelectorAll('.powerup img').length,
      owners: arrays.powerups.map(p => p.owner),
      p2Tag: !!playfield.querySelector('.powerup .tag-p2'),
    };
  });
  expect(r.images).toBe(0);
  expect(r.owners).toEqual([null, 'p2']);
  expect(r.p2Tag).toBe(true);
});

// The powerup HUD builds HTML from the weapon tiers (utils.js drawActivePowerups), so the client takes
// tiers from the snapshot only as integers 0..5.
test('Online client: weapon and shield tiers from the snapshot arrive as integers 0..5', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { state, Network } = window.__game;
    state.gameMode = 'online';
    state.gameRunning = true;
    state.network.isOnline = true;
    state.network.isHost = false;
    state.network.isClient = true;
    const evil = '<img src=x onerror="window.__xss = true">';
    Network.applyGameStateSnapshot({
      p1: {
        x: 200,
        y: 400,
        rotate: 0,
        lives: 3,
        energy: 50,
        maxEnergy: 50,
        isDead: false,
        laserTier: '3',
        missileTier: evil,
        bombTier: 9,
        shieldTier: evil,
      },
      p2: {
        x: 350,
        y: 400,
        rotate: 0,
        lives: 3,
        energy: 50,
        maxEnergy: 50,
        isDead: false,
        laserTier: 2.6,
        missileTier: -1,
        shieldTier: '2',
      },
      score: 0,
      level: 1,
      powerups: [],
    });
    const p = state.p2;
    return [
      state.laserTier,
      state.missileTier,
      state.bombTier,
      state.shieldTier,
      p.laserTier,
      p.missileTier,
      p.shieldTier,
    ];
  });
  expect(r).toEqual([3, 0, 5, 0, 3, 0, 2]);
});
