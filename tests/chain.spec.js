const { test, expect } = require('@playwright/test');
const { setGameState, startGame } = require('./helpers');

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
  await startGame(page);
  await page.waitForFunction(() => window.__game.state.gameRunning);
  // Clear the field, park the player bottom left, no random spawns
  await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const Display = await import('./js/display.js');
    ['enemies', 'asteroids', 'enemyLaserArray', 'powerups', 'laserArray'].forEach(name => {
      arrays[name].forEach(Display.remove);
      arrays[name].length = 0;
    });
    state.frameCounter = 1;
    state.x = 0;
    state.y = 560;
    state.godMode = true;
    window.__chain = await import('./js/chain.js');
  });
});

test('Lanes lie outside the field before the start, from t = 0 on they run into the field', async ({ page }) => {
  const r = await page.evaluate(() => {
    const K = window.__chain;
    const error = [];
    for (const lane of K.CHAIN_LANES)
      for (const side of [1, -1]) {
        for (let t = -120; t < 0; t++) {
          const p = K.lanePoint(lane, t, side, 400);
          if (p.x > 0 && p.x < 400 && p.y > 0) error.push(`${lane}/${side} t=${t} im Feld`);
        }
        const later = K.lanePoint(lane, 120, side, 400);
        if (!(later.x > 0 && later.x < 400 && later.y > 0)) error.push(`${lane}/${side} t=120 nicht im Feld`);
      }
    return error;
  });
  expect(r).toEqual([]);
});

test('Links follow the head trail with a fixed time offset and rotate in the flight direction', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const K = window.__chain;
    const { arrays } = await import('./js/state.js');
    const { simulationStep } = await import('./js/loop.js');
    K.createChain('loop', 5, 1);
    const chainLinks = arrays.enemies.slice();
    const middle = f => ({ x: f.x + f.size / 2, y: f.y + f.size / 2 });
    const trail = [];
    for (let i = 0; i < 80; i++) {
      simulationStep();
      trail.push(middle(chainLinks[0]));
    }
    // Link 3 is now where the head was 3 * DISTANCE steps earlier
    const should = trail[trail.length - 1 - 3 * K.linkDistance('loop', 1)];
    const is = middle(chainLinks[3]);
    return {
      deviation: Math.hypot(should.x - is.x, should.y - is.y),
      allStillThere: chainLinks.every(g => arrays.enemies.includes(g)),
      headLarger: chainLinks[0].size > chainLinks[1].size,
      rotSet: chainLinks.every(g => typeof g.rot === 'number'),
    };
  });
  expect(r.deviation).toBeLessThan(0.001);
  expect(r).toMatchObject({ allStillThere: true, headLarger: true, rotSet: true });
});

test('Links are on average about LINK_DISTANCE_PX apart on every lane', async ({ page }) => {
  const r = await page.evaluate(() => {
    const K = window.__chain;
    const result = {};
    for (const lane of K.CHAIN_LANES) {
      const n = K.linkDistance(lane, 1, 400);
      let sum = 0;
      for (let t = 100; t < 200; t++) {
        const a = K.lanePoint(lane, t, 1, 400);
        const b = K.lanePoint(lane, t - n, 1, 400);
        sum += Math.hypot(a.x - b.x, a.y - b.y);
      }
      result[lane] = Math.abs(sum / 100 - K.LINK_DISTANCE_PX) < 7;
    }
    return result;
  });
  expect(r).toEqual({ snake: true, sCurve: true, loop: true, spiral: true });
});

test('Waiting links outside the field are not removed (lane from the side)', async ({ page }) => {
  const count = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const { simulationStep } = await import('./js/loop.js');
    window.__chain.createChain('sCurve', 10, -1);
    simulationStep();
    return arrays.enemies.filter(f => f.pattern === 'chain').length;
  });
  expect(count).toBe(10);
});

test('Only the head shoots', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const { simulationStep } = await import('./js/loop.js');
    window.__chain.createChain('snake', 6, 1);
    const chainLinks = arrays.enemies.slice();
    for (let i = 0; i < 150; i++) simulationStep();
    return {
      headReady: chainLinks[0].shotTimer < 200,
      linkMuted: chainLinks.slice(1).every(g => g.shotTimer > 9000),
    };
  });
  expect(r).toEqual({ headReady: true, linkMuted: true });
});

test('Chain bonus: a chain shot down completely gives a powerup and 500 bonus points', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    state.selectedShipModel = 'phantom'; // without the Viper kill combo (factor 1)
    window.__chain.createChain('snake', 4, 1);
    const chainLinks = arrays.enemies.slice();
    chainLinks.slice(0, 3).forEach(g => Utils.destroyTarget(g));
    const powerupsBeforehand = arrays.powerups.length;
    const scoreBeforehand = state.score;
    Utils.destroyTarget(chainLinks[3]);
    return {
      powerupsBeforehand,
      powerupsAfterwards: arrays.powerups.length,
      points: state.score - scoreBeforehand,
      bonus: window.__chain.CHAIN_BONUS_POINTS,
    };
  });
  expect(r.powerupsBeforehand).toBe(0);
  expect(r.powerupsAfterwards).toBe(1);
  expect(r.points).toBe(100 + r.bonus);
});

test('No chain bonus if a link escapes or rams the player', async ({ page }) => {
  const powerups = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const Display = await import('./js/display.js');
    window.__chain.createChain('snake', 4, 1);
    const chainLinks = arrays.enemies.slice();
    // Link 2 vanishes without a kill
    Display.remove(chainLinks[2]);
    arrays.enemies.splice(arrays.enemies.indexOf(chainLinks[2]), 1);
    [0, 1, 3].forEach(i => Utils.destroyTarget(chainLinks[i]));
    return arrays.powerups.length;
  });
  expect(powerups).toBe(0);
});

test('Spawn: from level 3 on manageEnemySpawns creates chains, not in level 2', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const { manageEnemySpawns } = await import('./js/opponents.js');
    const Display = await import('./js/display.js');
    const orig = Math.random;
    const run = level => {
      arrays.enemies.forEach(Display.remove);
      arrays.enemies.length = 0;
      state.level = level;
      // Level 3: V 0.10 + cross 0.15 + swoop 0.15 + cling-on 0.15 = 0.55; chain up to 0.60
      Math.random = () => 0.57;
      try {
        manageEnemySpawns();
      } finally {
        Math.random = orig;
      }
      return arrays.enemies.map(f => f.pattern);
    };
    return { level3: run(3), level2: run(2) };
  });
  // 0.57: lane loop, 6 + floor(0.57 * 5) = 8 links, side -1
  expect(r.level3).toEqual(Array(8).fill('chain'));
  expect(r.level2).not.toContain('chain');
});

test('Display: head and links get the pulsing chain body, pulse offset', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    window.__chain.createChain('snake', 3, 1);
    const [head, g1, g2] = arrays.enemies;
    return {
      body: [head, g1, g2].every(f => !!f.el.querySelector('svg.ketten-koerper')),
      headEye: head.el.querySelectorAll('circle').length,
      lag: new Set([g1, g2].map(f => f.el.style.getPropertyValue('--puls-verzug'))).size,
    };
  });
  expect(r.body).toBe(true);
  expect(r.headEye).toBeGreaterThan(0);
  expect(r.lag).toBe(2);
});

test('Online: the snapshot carries pattern, size and rotation, the client builds head and links from it', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const Network = await import('./js/network.js');
    const { simulationStep } = await import('./js/loop.js');
    window.__chain.createChain('spiral', 3, 1);
    for (let i = 0; i < 40; i++) simulationStep();
    const host = arrays.enemies.map(f => ({ id: f.id, size: f.size, rot: Math.round(f.rot) }));
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    const sent = snap.enemies.map(f => ({
      pattern: f.pattern,
      size: f.size,
      hasRot: typeof f.rot === 'number',
    }));

    // Apply as the client
    arrays.enemies.forEach(f => f.el.remove());
    arrays.enemies.length = 0;
    const networkBeforehand = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    const client = arrays.enemies.map(f => ({
      id: f.id,
      size: f.size,
      rot: Math.round(f.rot),
      body: !!f.el.querySelector('svg.ketten-koerper'),
    }));
    state.network = networkBeforehand;
    return { host, sent, client };
  });
  expect(r.sent).toEqual([
    { pattern: 'chain', size: 28, hasRot: true },
    { pattern: 'chain', size: 22, hasRot: true },
    { pattern: 'chain', size: 22, hasRot: true },
  ]);
  expect(r.client.map(({ id, size, rot }) => ({ id, size, rot }))).toEqual(r.host);
  expect(r.client.every(c => c.body)).toBe(true);
});

test('Restart removes all chain links', async ({ page }) => {
  const count = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    window.__chain.createChain('snake', 6, 1);
    Utils.restartGame();
    return arrays.enemies.filter(f => f.pattern === 'chain').length;
  });
  expect(count).toBe(0);
});

test('Bot targets chain links', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const Bot = await import('./js/bot.js');
    const { simulationStep } = await import('./js/loop.js');
    window.__chain.createChain('snake', 4, 1);
    for (let i = 0; i < 60; i++) simulationStep();
    const p2 = { ...state, x: 200, y: 500, selectedShipModel: 'phantom' };
    const target = Bot.findBestTarget(p2, { aimCorridor: 400 });
    return { isChain: !!target && arrays.enemies.some(f => f.pattern === 'chain' && f.x + f.size / 2 === target.x) };
  });
  expect(r.isChain).toBe(true);
});
