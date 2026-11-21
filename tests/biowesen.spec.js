const { test, expect } = require('@playwright/test');
const { setGameState, startGame } = require('./helfer');

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
  // Feld leeren, Spieler unten in der Mitte, keine Zufalls-Spawns; Helfer in window.__bw
  await page.evaluate(async () => {
    const { state, arrays, config } = await import('./js/state.js');
    const Display = await import('./js/anzeige.js');
    const Rock = await import('./js/fels.js');
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
    const segment = (y, p) => {
      const s = Display.create({ id: 'fe_t' + y, x: 0, y, top: { ...p }, bottom: { ...p } }, 'rock');
      arrays.rock.push(s);
      return s;
    };
    // n Schritte, Fels dabei festhalten (Tempo 0) und keine Level-Spawns
    const Loop = await import('./js/loop.js');
    const steps = n => {
      for (let i = 0; i < n; i++) {
        state.frameCounter = 1;
        Loop.simulationStep();
      }
    };
    window.__bw = {
      B: await import('./js/biowesen.js'),
      K: await import('./js/kette.js'),
      L: await import('./js/level.js'),
      Rock,
      Display,
      state,
      arrays,
      config,
      segment,
      steps,
    };
  });
});

test('Levelplan: Fels-Level nutzen den Bio-Spawner, starten frueher und haben halb so viele Asteroiden', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const { L } = window.__bw;
    const p3 = L.levelPlan(3);
    const p4 = L.levelPlan(4);
    const p5 = L.levelPlan(5);
    return {
      spawner: [p3.spawner, p4.spawner, p5.spawner],
      start4: p4.enemyStart,
      cadence: p4.asteroidsCadence.map(([, t]) => t),
      cadenceWithoutRock: p5.asteroidsCadence.map(([, t]) => t),
      bioStart: L.BIO_ENEMY_START,
    };
  });
  expect(r.spawner).toEqual(['standard', 'bio', 'standard']);
  expect(r.start4).toBe(r.bioStart);
  // Level 4: 90/70/50 ohne Fels, also 180/140/100
  expect(r.cadence).toEqual([180, 140, 100]);
  expect(r.cadenceWithoutRock).toEqual([80, 60, 40]);
});

test('Bio-Spawner erzeugt nur organische Gegner, alle fuenf Arten kommen vor', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { B, arrays, Display } = window.__bw;
    const kinds = new Set();
    for (let i = 0; i < 300; i++) {
      B.manageBioSpawns();
      arrays.enemies.forEach(f => kinds.add(f.pattern));
      arrays.enemies.forEach(Display.remove);
      arrays.enemies.length = 0;
    }
    return [...kinds].sort();
  });
  expect(r).toEqual(['ballChain', 'chain', 'crab', 'spikeChain', 'tentacler']);
});

test('Stachelkette ist ein Hindernis: zaeh, langsamer, schiesst nicht', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { K, arrays, steps } = window.__bw;
    K.createChain('snake', 6, 1, 'spikeChain');
    const chainLinks = arrays.enemies.slice();
    const t0 = chainLinks[0].chainT;
    steps(300);
    return {
      speed: (chainLinks[0].chainT - t0) / 300,
      hp: [chainLinks[0].maxHp, chainLinks[1].maxHp],
      shots: arrays.enemyLaserArray.length,
      svg: !!chainLinks[1].el.querySelector('svg.ketten-koerper polygon'),
    };
  });
  expect(r.speed).toBeCloseTo(0.7, 5);
  expect(r.hp).toEqual([40, 30]);
  expect(r.shots).toBe(0);
  expect(r.svg).toBe(true);
});

test('Kugelkette: nur Blasenglieder (jedes dritte) schiessen Kugeln auf den Spieler', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { K, arrays, steps } = window.__bw;
    K.createChain('snake', 9, 1, 'ballChain');
    const chainLinks = arrays.enemies.slice();
    const pods = chainLinks.filter(g => g.ballTimer !== undefined);
    steps(260);
    const balls = arrays.enemyLaserArray;
    return {
      podIndex: pods.map(g => g.chainIndex),
      podSize: pods.every(g => g.size === K.POD_SIZE),
      bubble: !!pods[0].el.querySelector('.kugel-blase'),
      balls: balls.length,
      allSpores: balls.every(k => k.spore),
      afterBottom: balls.every(k => k.vy > 0),
      headShootsNot: chainLinks[0].shotTimer > 9000,
    };
  });
  expect(r.podIndex).toEqual([2, 5, 8]);
  expect(r).toMatchObject({
    podSize: true,
    bubble: true,
    allSpores: true,
    afterBottom: true,
    headShootsNot: true,
  });
  expect(r.balls).toBeGreaterThanOrEqual(3);
});

test('Krabbe ohne Fels: Anflug, dann seitlich krabbeln im Feld, Kugelpaare, spaeter Abzug', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { B, steps, config } = window.__bw;
    const Audio = await import('./js/audio.js');
    Audio.clearAudioHistory();
    const k = B.createCrab(100);
    const phases = new Set();
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < B.CRAB_DURATION + 20; i++) {
      steps(1);
      phases.add(k.phase);
      if (k.phase === 'krabbeln') {
        minX = Math.min(minX, k.x);
        maxX = Math.max(maxX, k.x + k.size);
      }
    }
    return {
      phases: [...phases],
      inField: minX >= 0 && maxX <= config.playfieldWidth,
      gone: maxX - minX,
      // Kugeln ueber die Schussgeraeusche zaehlen (Treffer am Spieler entfernen Kugeln)
      balls: Audio.audioHistory.filter(h => h.name === 'spore').length,
      svg: !!k.el.querySelector('.krabbe-beine') && k.el.querySelectorAll('.stielauge').length === 2,
    };
  });
  expect(r.phases).toEqual(['anflug', 'krabbeln', 'abzug']);
  expect(r.inField).toBe(true);
  expect(r.gone).toBeGreaterThan(150);
  expect(r.balls % 2).toBe(0);
  expect(r.balls).toBeGreaterThanOrEqual(8);
  expect(r.svg).toBe(true);
});

test('Krabbe an der Felswand: laeuft an der Kante mit Blick in den Gang, springt dann ab', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { B, Rock, segment, steps } = window.__bw;
    for (let y = -40; y <= 600; y += 40) segment(y, { l: 90, r: 30, inner: 200, ib: 0 });
    Rock.setSpeed(0);
    const k = B.createCrab();
    const start = { phase: k.phase, wall: k.wall, rot: k.rot, x: k.x };
    const anEdge = Math.abs(k.x + k.size * 0.25 - 90) < 0.01;
    const y0 = k.y;
    let jumpX = null;
    for (let i = 0; i < 400 && k.phase !== 'krabbeln'; i++) {
      steps(1);
      if (k.phase === 'jump' && jumpX === null) jumpX = k.x;
    }
    return { start, anEdge, run: k.y > y0, jumpX, endX: k.x, endPhase: k.phase, endRot: k.rot };
  });
  expect(r.start).toMatchObject({ phase: 'wall', wall: 'l', rot: -90 });
  expect(r.anEdge).toBe(true);
  expect(r.run).toBe(true);
  expect(r.jumpX).not.toBeNull();
  expect(r.endX).toBeGreaterThan(r.jumpX + 30); // in den Gang hinein
  expect(r.endPhase).toBe('krabbeln');
  expect(r.endRot).toBe(0);
});

test('Krabbe bleibt beim Krabbeln im freien Gang zwischen den Felswaenden', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { B, Rock, segment, steps } = window.__bw;
    for (let y = -40; y <= 600; y += 40) segment(y, { l: 120, r: 100, inner: 200, ib: 0 });
    Rock.setSpeed(0);
    const k = B.createCrab(150);
    k.phase = 'krabbeln';
    k.y = 200;
    let ok = true;
    for (let i = 0; i < 300; i++) {
      steps(1);
      if (k.x < 120 || k.x + k.size > 400 - 100) ok = false;
    }
    return ok;
  });
  expect(r).toBe(true);
});

test('Tentakler pendelt beim Sinken und stoesst Kugelringe aus', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { B, arrays, steps } = window.__bw;
    const t = B.createTentacler(180);
    t.shotCadence = 1;
    t.y = 50;
    const xs = [];
    steps(2);
    const ring = arrays.enemyLaserArray.filter(l => l.spore);
    for (let i = 0; i < 120; i++) {
      steps(1);
      xs.push(t.x);
    }
    const angle = ring.map(k => Math.atan2(k.vy, k.vx));
    return {
      ring: ring.length,
      allAround: Math.max(...angle) - Math.min(...angle) > 4,
      pendulum: Math.max(...xs) - Math.min(...xs) > 40,
      svg: !!t.el.querySelector('.tentakel') && !!t.el.querySelector('.schirm'),
    };
  });
  expect(r).toEqual({ ring: 6, allAround: true, pendulum: true, svg: true });
});

test('Online: Muster und Drehung kommen beim Client an, er zeichnet dieselben Wesen', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { B, K, arrays, state, segment, Rock } = window.__bw;
    const Network = await import('./js/network.js');
    for (let y = -40; y <= 600; y += 40) segment(y, { l: 90, r: 30, inner: 200, ib: 0 });
    Rock.setSpeed(0);
    B.createCrab();
    B.createTentacler(200);
    K.createChain('snake', 3, 1, 'ballChain');
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    arrays.enemies.forEach(f => f.el.remove());
    arrays.enemies.length = 0;
    const network = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    state.network = network;
    const afterEntry = m => arrays.enemies.find(f => f.pattern === m);
    return {
      crabRot: afterEntry('crab').rot,
      crabSvg: !!afterEntry('crab').el.querySelector('.stielauge'),
      tentaclerSvg: !!afterEntry('tentacler').el.querySelector('.tentakel'),
      pod: arrays.enemies.filter(f => f.pattern === 'ballChain' && f.el.querySelector('.kugel-blase')).length,
    };
  });
  expect(r).toEqual({ crabRot: -90, crabSvg: true, tentaclerSvg: true, pod: 1 });
});
