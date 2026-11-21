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
  // Clear the field, level 4 (rock level), player bottom center; helpers in window.__ib
  await page.evaluate(async () => {
    const { state, arrays, config } = await import('./js/state.js');
    const Display = await import('./js/display.js');
    const Rock = await import('./js/rock.js');
    const IslandBoss = await import('./js/island-boss.js');
    for (const name of Object.keys(arrays)) {
      if (name === 'stars') continue;
      arrays[name].forEach(o => o.el && Display.remove(o));
      arrays[name].length = 0;
    }
    Rock.reset();
    IslandBoss.reset();
    state.level = 4;
    state.frameCounter = 5000; // after the level flow: no spawns, no second warning
    state.x = config.playfieldWidth / 2 - 15;
    state.y = 560;
    state.godMode = true;
    state.selectedShipModel = 'phantom';
    const Loop = await import('./js/loop.js');
    const Level = await import('./js/level.js');
    // Start the boss and let it run until the fight
    const untilFight = () => {
      Level.startBoss();
      for (let i = 0; i < 2000 && IslandBoss.phase() !== 'fight'; i++) Loop.simulationStep();
    };
    const eyes = () => arrays.bosses.filter(b => b.bossType === 'eye');
    window.__ib = {
      IslandBoss,
      Rock,
      Loop,
      Level,
      Utils: await import('./js/utils.js'),
      Display,
      state,
      arrays,
      config,
      untilFight,
      eyes,
    };
  });
});

test('Level plan: rock levels end with the island boss, the others with the standard boss', async ({ page }) => {
  const r = await page.evaluate(() => [3, 4, 5, 6].map(l => window.__ib.Level.levelPlan(l).boss));
  expect(r).toEqual(['standard', 'island', 'standard', 'island']);
});

test('Standard boss: shooting it down ends the level and drops three rewards', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state, arrays, Utils } = window.__ib;
    const Entities = await import('./js/entities.js');
    state.level = 3;
    Entities.createBoss();
    Utils.destroyTarget(arrays.bosses[0]);
    return {
      level: state.level,
      bossActive: state.bossActive,
      drops: arrays.powerups.length,
      frame: state.frameCounter,
    };
  });
  expect(r).toEqual({ level: 4, bossActive: false, drops: 3, frame: 0 });
});

test('Entry: the body made of rock segments scrolls in and stops, three eyes and four tubes', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { IslandBoss, Rock, arrays, config, eyes, state } = window.__ib;
    state.level = 4;
    window.__ib.Level.startBoss();
    const inEntry = [];
    for (let i = 0; i < 2000 && IslandBoss.phase() !== 'fight'; i++) {
      window.__ib.Loop.simulationStep();
      if (eyes().length) inEntry.push(eyes().every(a => a.isIndestructible && !a.open));
    }
    const body = arrays.rock.filter(s => s.top.bossIndex !== undefined);
    const bottom = body.find(s => s.top.bossIndex === 0);
    return {
      phase: IslandBoss.phase(),
      speed: Rock.getSpeed(),
      topEdge: Math.min(...body.map(s => s.y)),
      bottomEdge: bottom.y + Rock.SEGMENT_HEIGHT,
      should: config.playfieldHeight * 0.45,
      eyes: eyes().length,
      tubes: arrays.enemies.filter(f => f.pattern === 'tube').length,
      tooInEntry: inEntry.every(Boolean),
      bossActive: state.bossActive,
    };
  });
  expect(r.phase).toBe('fight');
  expect(r.speed).toBe(0);
  // With the rock standing, segments only appear up to the top edge; the body reaches beyond it
  expect(r.topEdge).toBeLessThanOrEqual(0);
  expect(r.bottomEdge).toBeGreaterThanOrEqual(r.should);
  expect(r.bottomEdge).toBeLessThan(r.should + 3);
  expect(r).toMatchObject({ eyes: 3, tubes: 4, tooInEntry: true, bossActive: true });
});

test('Eyes blink, are vulnerable only while open and shoot aimed spores while open', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Loop, arrays, Display, untilFight, eyes, IslandBoss } = window.__ib;
    untilFight();
    const a = eyes()[0];
    a.phase = 'closed';
    a.phaseTimer = 1;
    const laser = () => {
      arrays.laserArray.push(
        Display.create(
          {
            id: 'l_t' + Math.random(),
            x: a.x + a.size / 2 - 2,
            y: a.y + a.size + 2,
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
    };
    // closed: hit without damage
    a.phaseTimer = 50;
    let hp = a.hp;
    laser();
    Loop.simulationStep();
    const tooDamage = hp - a.hp;
    // oeffnen
    a.phaseTimer = 1;
    Loop.simulationStep();
    const open = { open: a.open, armor: a.isIndestructible };
    hp = a.hp;
    laser();
    Loop.simulationStep();
    const openDamage = hp - a.hp;
    arrays.enemyLaserArray.length = 0;
    for (let i = 0; i < IslandBoss.EYE_SHOT + 1; i++) Loop.simulationStep();
    const spores = arrays.enemyLaserArray.filter(l => l.spore);
    return { tooDamage, open, openDamage, spores: spores.length, afterBottom: spores.every(s => s.vy > 0) };
  });
  expect(r.tooDamage).toBe(0);
  expect(r.open).toEqual({ open: true, armor: false });
  expect(r.openDamage).toBe(16);
  expect(r.spores).toBeGreaterThanOrEqual(2);
  expect(r.afterBottom).toBe(true);
});

test('Only the last eye defeats the boss; before that enrage with an advance, afterwards the body scrolls out', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const { Loop, Utils, Rock, IslandBoss, arrays, state, untilFight, eyes } = window.__ib;
    untilFight();
    const [a1, a2, a3] = eyes();
    const score = state.score;
    Utils.destroyTarget(a1);
    Loop.simulationStep();
    const afterOne = { level: state.level, bossActive: state.bossActive, phase: IslandBoss.phase() };
    Utils.destroyTarget(a2);
    Loop.simulationStep();
    const enrage = { phase: IslandBoss.phase(), speed: Rock.getSpeed(), eye: a3.enragePhaseActive };
    Utils.destroyTarget(a3);
    Loop.simulationStep();
    const victory = {
      level: state.level,
      bossActive: state.bossActive,
      active: IslandBoss.isActive(),
      speed: Rock.getSpeed(),
      tubeLarvae: arrays.enemies.filter(f => f.pattern === 'tube' || f.pattern === 'larva').length,
      points: state.score - score > 0,
    };
    // The skeleton bursts immediately: no bone segment left, explosion particles in the field
    return {
      afterOne,
      enrage,
      victory,
      bodyThereafter: arrays.rock.filter(s => s.top.bone).length,
      particles: arrays.particleArray.length > 0,
    };
  });
  expect(r.afterOne).toEqual({ level: 4, bossActive: true, phase: 'fight' });
  expect(r.enrage).toEqual({ phase: 'enrage', speed: 0.12, eye: true });
  expect(r.victory).toEqual({ level: 5, bossActive: false, active: false, speed: 1.5, tubeLarvae: 0, points: true });
  expect(r.bodyThereafter).toBe(0);
  expect(r.particles).toBe(true);
});

test('Tubes eject larvae (at most MAX_LARVAE), larvae crawl towards the player', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { Loop, arrays, state, untilFight } = window.__ib;
    const G = await import('./js/growths.js');
    untilFight();
    arrays.enemies.filter(f => f.pattern === 'tube').forEach(f => (f.phaseTimer = 1));
    Loop.simulationStep();
    const larva = arrays.enemies.find(f => f.pattern === 'larva');
    const distance = () => Math.hypot(larva.x - state.x, larva.y - state.y);
    const beforehand = distance();
    for (let i = 0; i < 30; i++) Loop.simulationStep();
    const closer = distance() < beforehand;
    for (let i = 0; i < 2000; i++) {
      arrays.enemies.filter(f => f.pattern === 'tube').forEach(f => (f.phaseTimer = Math.min(f.phaseTimer, 2)));
      Loop.simulationStep();
    }
    return {
      first: !!larva,
      closer,
      atMost: arrays.enemies.filter(f => f.pattern === 'larva').length <= G.MAX_LARVAE,
    };
  });
  expect(r).toEqual({ first: true, closer: true, atMost: true });
});

test('In co-op the island boss has five eyes (second arm pair)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Utils, untilFight, eyes } = window.__ib;
    Utils.setGameMode('coop');
    untilFight();
    return eyes().length;
  });
  expect(r).toBe(5);
});

test('Online: eyes with open in the snapshot, the client shows lid and class, the HP bar sums all eyes', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { arrays, state, untilFight, eyes } = window.__ib;
    const Network = await import('./js/network.js');
    untilFight();
    const [a1, a2] = eyes();
    a1.open = true;
    a1.hp = 0.5 * a1.maxHp;
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    const sent = snap.bosses.map(b => ({ type: b.type, open: b.open }));
    arrays.bosses.forEach(b => b.el.remove());
    arrays.bosses.length = 0;
    const network = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    state.network = network;
    const c1 = arrays.bosses.find(b => b.id === a1.id);
    const c2 = arrays.bosses.find(b => b.id === a2.id);
    return {
      sent,
      lid: !!c1.el.querySelector('.auge-lid'),
      open: c1.el.classList.contains('offen'),
      too: c2.el.classList.contains('offen'),
      bar: parseFloat(document.getElementById('boss-hp-balken').style.width),
    };
  });
  expect(r.sent).toEqual([
    { type: 'eye', open: true },
    { type: 'eye', open: false },
    { type: 'eye', open: false },
  ]);
  expect(r).toMatchObject({ lid: true, open: true, too: false });
  expect(r.bar).toBeCloseTo((2.5 / 3) * 100, 0);
});

test('Bot aims only at open eyes', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { untilFight, eyes, config, arrays, Display } = window.__ib;
    const Bot = await import('./js/bot.js');
    untilFight();
    // only the eyes as possible targets (tubes would be nearer)
    arrays.enemies.forEach(Display.remove);
    arrays.enemies.length = 0;
    const p2 = { x: config.playfieldWidth / 2, y: 560 };
    eyes().forEach(a => {
      a.isIndestructible = true;
    });
    const too = Bot.findBestTarget(p2, { aimCorridor: 30 });
    const a = eyes()[1];
    a.isIndestructible = false;
    const open = Bot.findBestTarget(p2, { aimCorridor: 30 });
    return { tooBoss: !!(too && too.isBoss), openX: open && open.x, eyeX: a.x + a.size / 2 };
  });
  expect(r.tooBoss).toBe(false);
  expect(r.openX).toBe(r.eyeX);
});

test('Restart ends the island boss and resets the rock speed', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Utils, Rock, IslandBoss, arrays, untilFight } = window.__ib;
    untilFight();
    Utils.restartGame();
    return {
      active: IslandBoss.isActive(),
      speed: Rock.getSpeed(),
      rock: arrays.rock.length,
      bosses: arrays.bosses.length,
    };
  });
  expect(r).toEqual({ active: false, speed: 1.5, rock: 0, bosses: 0 });
});

test('Skeleton: eyes sit at the arm tips and at the bottom tip and do not move during the fight', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Loop, Rock, arrays, config, untilFight, eyes } = window.__ib;
    untilFight();
    const c = config.playfieldWidth / 2;
    const middle = a => ({ x: a.x + a.size / 2, y: a.y + a.size / 2 });
    const positions = eyes().map(a => {
      const p = a.segment.top;
      const m = middle(a);
      if (a.side === 'bottom') return { kind: 'bottom', amEdge: Math.abs(m.x - p.inner) < 1 };
      const tip = a.side === 'right' ? p.inner + p.ib / 2 : p.inner - p.ib / 2;
      return { kind: a.side, amEdge: Math.abs(m.x - tip) < 10 && Math.abs(m.x - c) > 60 };
    });
    const beforehand = eyes().map(a => [a.x, a.y]);
    for (let i = 0; i < 120; i++) Loop.simulationStep();
    const calm = eyes().every((a, i) => a.x === beforehand[i][0] && a.y === beforehand[i][1]);
    const el = eyes()[0].el;
    return {
      positions: positions.map(l => l.kind).sort(),
      amEdge: positions.every(l => l.amEdge),
      calm,
      speed: Rock.getSpeed(),
      cls: el.classList.contains('boss-auge'),
      animation: getComputedStyle(el).animationName,
      bone: arrays.rock.filter(s => s.top.bone).every(s => !!s.el.querySelector('polygon.fels-knochen')),
    };
  });
  expect(r).toEqual({
    positions: ['bottom', 'left', 'right'],
    amEdge: true,
    calm: true,
    speed: 0,
    cls: true,
    animation: 'none',
    bone: true,
  });
});

test('Skeleton leaves a passage of at least MIN_PASSAGE beside every arm', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { IslandBoss, Rock, config, Utils } = window.__ib;
    const result = [];
    for (const mode of ['single', 'coop']) {
      Utils.setGameMode(mode);
      const b = config.playfieldWidth;
      for (const p of IslandBoss.bodyProfile()) {
        result.push(Math.min(p.inner - p.ib / 2, b - (p.inner + p.ib / 2)) >= Rock.MIN_PASSAGE);
      }
    }
    Utils.setGameMode('single');
    return result.every(Boolean);
  });
  expect(r).toBe(true);
});

test('Online: bone segments carry the marker in the profile text, the client draws bone', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, state, untilFight, Rock } = window.__ib;
    const Network = await import('./js/network.js');
    untilFight();
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    const boneText = snap.rock.filter(f => f.p.split(',')[0].split(' ').length === 5).length;
    arrays.rock.forEach(s => s.el.remove());
    arrays.rock.length = 0;
    const network = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    state.network = network;
    const client = arrays.rock.filter(s => s.top.bone);
    return {
      boneText,
      client: client.length,
      polygon: client.every(s => !!s.el.querySelector('polygon.fels-knochen')),
      roundTrip: Rock.profileAsText(client[0]) === snap.rock.find(f => f.id === client[0].id).p,
    };
  });
  expect(r.boneText).toBeGreaterThan(0);
  expect(r.client).toBe(r.boneText);
  expect(r).toMatchObject({ polygon: true, roundTrip: true });
});

test('Skeleton is mirror-symmetric to the vertical center axis (profile and eyes)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { IslandBoss, Utils, config, untilFight, eyes } = window.__ib;
    const c = config.playfieldWidth / 2;
    const result = {};
    for (const mode of ['single', 'coop']) {
      Utils.setGameMode(mode);
      const profile = IslandBoss.bodyProfile();
      result[mode] = {
        centered: profile.every(p => p.inner === config.playfieldWidth / 2),
        eyePairs: profile.every(
          p => p.eyes.filter(s => s === 'left').length === p.eyes.filter(s => s === 'right').length,
        ),
      };
    }
    Utils.setGameMode('single');
    untilFight();
    const center = eyes().map(a => +(a.x + a.size / 2 - c).toFixed(3));
    const mirrored = center.every(d => center.some(e => Math.abs(e + d) < 0.01));
    return { result, mirrored, c };
  });
  expect(r.result).toEqual({
    single: { centered: true, eyePairs: true },
    coop: { centered: true, eyePairs: true },
  });
  expect(r.mirrored).toBe(true);
});
