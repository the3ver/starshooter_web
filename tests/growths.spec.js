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
  // Clear the field, player bottom center, no random spawns; helpers in window.__gw
  await page.evaluate(async () => {
    const { state, arrays, config } = await import('./js/state.js');
    const Display = await import('./js/display.js');
    const Rock = await import('./js/rock.js');
    for (const name of Object.keys(arrays)) {
      if (name === 'stars') continue;
      arrays[name].forEach(o => o.el && Display.remove(o));
      arrays[name].length = 0;
    }
    Rock.reset();
    state.frameCounter = 1;
    state.level = 1;
    state.x = config.playfieldWidth / 2 - 15;
    state.y = 560;
    state.godMode = true;
    state.selectedShipModel = 'phantom';
    // Segment with a fixed profile (top = bottom) at height y
    const segment = (y, p) => {
      const s = Display.create({ id: 'fe_t' + y, x: 0, y, top: { ...p }, bottom: { ...p } }, 'rock');
      arrays.rock.push(s);
      return s;
    };
    window.__gw = {
      G: await import('./js/growths.js'),
      Loop: await import('./js/loop.js'),
      Utils: await import('./js/utils.js'),
      Rock,
      Display,
      state,
      arrays,
      config,
      segment,
    };
  });
});

test('Growths sit on wall and island edges and face the corridor', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, segment, config } = window.__gw;
    const b = config.playfieldWidth;
    const s = segment(200, { l: 60, r: 50, inner: b / 2, ib: 80 });
    const position = side => {
      const f = G.createGrowth('funnel', s, side);
      return { x: f.x, y: f.y, rot: f.rot, direction: f.direction };
    };
    const withoutSpot = G.createGrowth('bloom', segment(300, { l: 10, r: 10, inner: b / 2, ib: 0 }));
    return { l: position('l'), r: position('r'), il: position('il'), ir: position('ir'), withoutSpot, b };
  });
  const g = 30;
  expect(r.l).toEqual({ x: 60 - g * 0.3, y: 205, rot: -90, direction: 1 });
  expect(r.r).toEqual({ x: r.b - 50 - g * 0.7, y: 205, rot: 90, direction: -1 });
  expect(r.il).toEqual({ x: r.b / 2 - 40 - g * 0.7, y: 205, rot: 90, direction: -1 });
  expect(r.ir).toEqual({ x: r.b / 2 + 40 - g * 0.3, y: 205, rot: -90, direction: 1 });
  expect(r.withoutSpot).toBeNull();
});

test('Growth scrolls with its rock segment', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, Loop, segment } = window.__gw;
    const s = segment(100, { l: 60, r: 60, inner: 200, ib: 0 });
    const f = G.createGrowth('capsule', s, 'l');
    const beforehand = f.y;
    for (let i = 0; i < 20; i++) Loop.simulationStep();
    return { gone: f.y - beforehand, distance: f.y - s.y };
  });
  expect(r.gone).toBeCloseTo(20 * 1.5, 5);
  expect(r.distance).toBe((40 - 24) / 2);
});

test('Bloom: closed and armored, then open with three spores across the corridor, then closed again', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const { G, Loop, segment, arrays } = window.__gw;
    const s = segment(200, { l: 60, r: 60, inner: 200, ib: 0 });
    s.y = 200;
    const f = G.createGrowth('bloom', s, 'l');
    const history = [];
    for (let i = 0; i < G.CLOSED_DURATION + G.OPEN_DURATION + 2; i++) {
      s.y = 200; // Keep the segment fixed (rock does not scroll here)
      Loop.simulationStep();
      history.push({ open: f.open, armor: f.isIndestructible });
    }
    const spores = arrays.enemyLaserArray.filter(l => l.spore);
    return {
      tooStart: history[0],
      openAfterClosed: history[G.CLOSED_DURATION],
      closedAgain: history.at(-1),
      spores: spores.length,
      speed: spores.map(l => [l.vx, l.vy, l.width]),
      cls: spores[0] && spores[0].el.className,
    };
  });
  expect(r.tooStart).toEqual({ open: false, armor: true });
  expect(r.openAfterClosed).toEqual({ open: true, armor: false });
  expect(r.closedAgain).toEqual({ open: false, armor: true });
  expect(r.spores).toBe(3);
  for (const [vx, vy, w] of r.speed) {
    expect(vx).toBeCloseTo(2.6, 5);
    expect(Math.abs(vy)).toBeLessThan(1);
    expect(w).toBe(10);
  }
  expect(r.cls).toBe('spore');
});

test('Lasers bounce off the closed bloom and hit the open one', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, Loop, segment, arrays, Display } = window.__gw;
    const s = segment(200, { l: 60, r: 60, inner: 200, ib: 0 });
    const f = G.createGrowth('bloom', s, 'l');
    const shot = () => {
      s.y = 200;
      arrays.laserArray.push(
        Display.create(
          {
            id: 'l_t' + Math.random(),
            x: f.x + 15,
            y: f.y + f.size + 4,
            vx: 0,
            vy: 15,
            width: 4,
            height: 20,
            damage: 16,
            owner: 'p1',
          },
          'laser',
        ),
      );
      const hp = f.hp;
      Loop.simulationStep();
      return hp - f.hp;
    };
    const too = shot();
    f.phase = 'open';
    f.phaseTimer = G.OPEN_DURATION;
    const open = shot();
    return { too, open };
  });
  expect(r.too).toBe(0);
  expect(r.open).toBe(16);
});

test('Funnel shoots single spores on its cadence, capsule never', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, Loop, segment, arrays } = window.__gw;
    const s = segment(200, { l: 60, r: 60, inner: 200, ib: 0 });
    const t = G.createGrowth('funnel', s, 'l');
    t.phaseTimer = 5;
    const k = G.createGrowth('capsule', s, 'r');
    for (let i = 0; i < 5 + G.FUNNEL_CADENCE; i++) {
      s.y = 200;
      Loop.simulationStep();
    }
    const spores = arrays.enemyLaserArray.filter(l => l.spore);
    return { count: spores.length, directions: spores.map(l => Math.sign(l.vx)), capsuleOpen: k.open };
  });
  expect(r.count).toBe(2);
  expect(r.directions).toEqual([1, 1]);
  expect(r.capsuleOpen).toBe(true);
});

test('Egg capsule drops the bonus when shot (shockwave at most once per level)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, Utils, segment, arrays, state } = window.__gw;
    state.level = 4;
    state.shockwaveLevel = 0;
    const s = segment(200, { l: 60, r: 60, inner: 200, ib: 0 });
    const types = [];
    const orig = Math.random;
    for (let i = 0; i < 2; i++) {
      const k = G.createGrowth('capsule', s, 'l');
      Math.random = () => 0.1;
      try {
        Utils.destroyTarget(k);
      } finally {
        Math.random = orig;
      }
      types.push(arrays.powerups.at(-1).type);
    }
    return types;
  });
  expect(r[0]).toBe('shockwave');
  expect(r[1]).not.toBe('shockwave');
});

test('Shockwave leaves closed blooms standing and captures open growths', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { G, Loop, segment, arrays } = window.__gw;
    const SW = await import('./js/shockwave.js');
    const s = segment(200, { l: 60, r: 60, inner: 200, ib: 0 });
    const too = G.createGrowth('bloom', s, 'l');
    const funnel = G.createGrowth('funnel', s, 'r');
    SW.trigger(200, 300, 'p1');
    for (let i = 0; i < SW.WAVE_DURATION; i++) {
      s.y = 200;
      Loop.simulationStep();
    }
    return { bloom: arrays.enemies.includes(too), funnel: arrays.enemies.includes(funnel) };
  });
  expect(r).toEqual({ bloom: true, funnel: false });
});

test('Rock levels grow growths, normal levels do not', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Loop, arrays, state, Display, Rock, G } = window.__gw;
    // Fixed seed (mulberry32): the result depends on the dice (flake hunt 2026-11-21: 0 growths once in CI)
    let x = 1;
    Math.random = () => {
      x = (x + 0x6d2b79f5) | 0;
      let t = Math.imul(x ^ (x >>> 15), 1 | x);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const run = level => {
      // empty all world lists: real-time frames run between beforeEach and the test (asteroids, powerups)
      for (const name of Object.keys(arrays)) {
        if (name === 'stars') continue;
        arrays[name].forEach(o => o.el && Display.remove(o));
        arrays[name].length = 0;
      }
      Rock.reset();
      state.level = level;
      state.frameCounter = 1;
      for (let i = 0; i < 700; i++) Loop.simulationStep();
      return arrays.enemies.filter(G.isGrowth).length;
    };
    return { level3: run(3), level4: run(4) };
  });
  expect(r.level3).toBe(0);
  expect(r.level4).toBeGreaterThan(0);
});

test('Online: the snapshot carries open and spore, the client shows bloom and spore', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { G, segment, arrays, state } = window.__gw;
    const Network = await import('./js/network.js');
    const s = segment(200, { l: 60, r: 60, inner: 200, ib: 0 });
    const f = G.createGrowth('bloom', s, 'l');
    f.open = true;
    G.createSpore(f);
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    const sent = { open: snap.enemies[0].open, spore: snap.enemyLaser[0].spore };
    for (const name of ['enemies', 'enemyLaserArray']) {
      arrays[name].forEach(o => o.el.remove());
      arrays[name].length = 0;
    }
    const network = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    state.network = network;
    const cf = arrays.enemies[0];
    const cs = arrays.enemyLaserArray[0];
    return {
      sent,
      bloom: !!cf.el.querySelector('svg.gewaechs .bluete-kappe'),
      openClass: cf.el.classList.contains('offen'),
      sporeClass: cs.el.className,
      sporeBox: [cs.width, cs.height],
    };
  });
  expect(r).toEqual({
    sent: { open: true, spore: true },
    bloom: true,
    openClass: true,
    sporeClass: 'spore',
    sporeBox: [10, 10],
  });
});

test('Bot does not aim at closed blooms', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { G, segment, config } = window.__gw;
    const Bot = await import('./js/bot.js');
    const s = segment(200, { l: 60, r: 60, inner: 200, ib: 0 });
    const f = G.createGrowth('bloom', s, 'l');
    const p2 = { x: config.playfieldWidth / 2, y: 500 };
    const too = Bot.findBestTarget(p2, { aimCorridor: 30 });
    f.open = true;
    f.isIndestructible = false;
    const open = Bot.findBestTarget(p2, { aimCorridor: 30 });
    return { too, open: !!open };
  });
  expect(r).toEqual({ too: null, open: true });
});
