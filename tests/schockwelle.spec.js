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
  // Feld leeren, Spieler unten links, keine Zufalls-Spawns; Helfer in window.__sw
  await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const Display = await import('./js/anzeige.js');
    for (const name of Object.keys(arrays)) {
      if (name === 'stars') continue;
      arrays[name].forEach(o => o.el && Display.remove(o));
      arrays[name].length = 0;
    }
    state.frameCounter = 1;
    state.x = 0;
    state.y = 560;
    state.godMode = true;
    state.selectedShipModel = 'phantom';
    window.__sw = {
      SW: await import('./js/schockwelle.js'),
      Entities: await import('./js/entities.js'),
      Loop: await import('./js/loop.js'),
      Audio: await import('./js/audio.js'),
      state,
      arrays,
    };
  });
});

test('Ring erfasst Feinde in Reihenfolge der Entfernung, nach WELLEN_DAUER Schritten sind alle weg', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const { SW, Entities, Loop, arrays } = window.__sw;
    Entities.createEnemy(185, 500, 'swoop', 0, false); // nah
    Entities.createEnemy(185, 100, 'swoop', 0, false); // fern
    const [near, remote] = arrays.enemies;
    near.vy = remote.vy = 0;
    SW.trigger(200, 560, 'p1');
    let nearGone = -1;
    let remoteGone = -1;
    for (let s = 1; s <= SW.WAVE_DURATION; s++) {
      Loop.simulationStep();
      if (nearGone < 0 && !arrays.enemies.includes(near)) nearGone = s;
      if (remoteGone < 0 && !arrays.enemies.includes(remote)) remoteGone = s;
    }
    return { nearGone, remoteGone, rest: arrays.enemies.length };
  });
  expect(r.nearGone).toBeGreaterThan(0);
  expect(r.remoteGone).toBeGreaterThan(r.nearGone);
  expect(r.rest).toBe(0);
});

test('Abschuesse zaehlen fuer den Sammler (Punkte), Asteroiden bleiben, Feindgeschosse verschwinden', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const { SW, Entities, Loop, arrays, state } = window.__sw;
    Entities.createEnemy(100, 200, 'swoop', 0, false);
    arrays.enemies[0].vy = 0;
    Entities.createAsteroid(250, 200, 30, 0, 0, 0, true);
    arrays.asteroids[0].vy = 0;
    Entities.createEnemyLaser(300, 300);
    const score = state.score;
    SW.trigger(200, 300, 'p1');
    for (let s = 0; s < SW.WAVE_DURATION; s++) Loop.simulationStep();
    return {
      enemies: arrays.enemies.length,
      asteroids: arrays.asteroids.length,
      laser: arrays.enemyLaserArray.length,
      points: state.score - score,
    };
  });
  expect(r).toMatchObject({ enemies: 0, asteroids: 1, laser: 0 });
  expect(r.points).toBeGreaterThanOrEqual(100);
});

test('Boss verliert einmal 15 % der Max-HP und stirbt nicht', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { SW, Entities, Loop, arrays, state } = window.__sw;
    Entities.createBoss();
    const b = arrays.bosses[0];
    b.y = 50;
    b.vx = b.vy = 0;
    b.phase = 'kampf';
    const full = b.hp;
    SW.trigger(200, 300, 'p1');
    for (let s = 0; s < SW.WAVE_DURATION; s++) Loop.simulationStep();
    const afterFull = b.hp;
    // fast tot: bleibt bei 1 HP
    b.hp = 5;
    SW.trigger(200, 300, 'p1');
    for (let s = 0; s < SW.WAVE_DURATION; s++) Loop.simulationStep();
    return {
      loss: full - afterFull,
      expected: Math.ceil(b.maxHp * SW.BOSS_DAMAGE_SHARE),
      almostDead: b.hp,
      alive: arrays.bosses.includes(b),
      bossActive: state.bossActive,
    };
  });
  expect(r.loss).toBe(r.expected);
  expect(r).toMatchObject({ almostDead: 1, alive: true, bossActive: true });
});

test('Einsammeln loest Ring, Blitz und Ton aus (Powerup-Typ schockwelle)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Entities, Loop, Audio, arrays, state } = window.__sw;
    Audio.clearAudioHistory();
    Entities.createPowerup(state.x + 3, state.y + 3, 'shockwave');
    const p = arrays.powerups[0];
    p.vy = 0;
    for (let s = 0; s < 3 && arrays.powerups.length; s++) Loop.simulationStep();
    const wave = arrays.effects.find(e => e.kind === 'shockwave');
    return {
      collected: arrays.powerups.length === 0,
      wave: !!wave,
      owner: wave && wave.owner,
      ring: !!(wave && wave.el && wave.el.classList.contains('schockwelle-ring')),
      tone: Audio.audioHistory.some(h => h.name === 'shockwave'),
      symbol: p.el.textContent.trim(),
    };
  });
  expect(r).toEqual({ collected: true, wave: true, owner: 'p1', ring: true, tone: true, symbol: 'Z' });
});

test('Kettenbonus: Schockwelle mit Zufall, hoechstens eine pro Level, nie im Bosskampf', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, state } = window.__sw;
    const K = await import('./js/kette.js');
    const Utils = await import('./js/utils.js');
    const Display = await import('./js/anzeige.js');
    const bonus = (random, bossActive = false) => {
      arrays.powerups.forEach(Display.remove);
      arrays.powerups.length = 0;
      state.bossActive = bossActive;
      K.createChain('snake', 2, 1);
      const chainLinks = arrays.enemies.slice(-2);
      const orig = Math.random;
      Math.random = () => random;
      try {
        chainLinks.forEach(g => Utils.destroyTarget(g));
      } finally {
        Math.random = orig;
      }
      state.bossActive = false;
      return arrays.powerups.map(p => p.type);
    };
    state.level = 3;
    state.shockwaveLevel = 0;
    const result = {
      inBoss: bonus(0.1, true),
      overChance: bonus(window.__sw.SW.SHOCKWAVE_CHANCE + 0.01),
      firstInLevel: bonus(0.1),
      secondInLevel: bonus(0.1),
    };
    state.level = 4;
    result.nextLevel = bonus(0.1);
    return result;
  });
  expect(r.inBoss).not.toContain('shockwave');
  expect(r.overChance).not.toContain('shockwave');
  expect(r.firstInLevel).toEqual(['shockwave']);
  expect(r.secondInLevel).not.toContain('shockwave');
  expect(r.nextLevel).toEqual(['shockwave']);
});

test('Neustart setzt die Schockwellen-Sperre zurueck und entfernt laufende Ringe', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { SW, arrays, state } = window.__sw;
    const Utils = await import('./js/utils.js');
    state.shockwaveLevel = 3;
    SW.trigger(200, 300, 'p1');
    Utils.restartGame();
    return { lock: state.shockwaveLevel, rings: arrays.effects.filter(e => e.kind === 'shockwave').length };
  });
  expect(r).toEqual({ lock: 0, rings: 0 });
});

test('Bot nimmt die Schockwelle erst bei mindestens 4 Zielen im Bild oder kurz vor dem unteren Rand', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { Entities, arrays } = window.__sw;
    const Bot = await import('./js/bot.js');
    Entities.createPowerup(200, 200, 'shockwave');
    const p = arrays.powerups[0];
    const paysOff = () => Bot.shockwaveWorthIt(p);
    const result = { empty: paysOff() };
    for (let i = 0; i < Bot.SHOCKWAVE_MIN_TARGETS - 1; i++) Entities.createEnemy(40 * i + 20, 100, 'swoop', 0, false);
    result.threeTargets = paysOff();
    Entities.createEnemyLaser(300, 300);
    result.fourTargets = paysOff();
    arrays.enemies.length = 0;
    arrays.enemyLaserArray.length = 0;
    p.y = 700;
    result.bottomEdge = paysOff();
    return result;
  });
  expect(r).toEqual({ empty: false, threeTargets: false, fourTargets: true, bottomEdge: true });
});

test('Online: Host sendet das Ereignis, der Client zeigt nur Ring und Blitz ohne Trefferlogik', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { SW, Entities, arrays, state } = window.__sw;
    const Network = await import('./js/network.js');
    state.gameMode = 'online';
    SW.trigger(120, 340, 'p2');
    const sent = { ...state.network.lastSentEvent };
    arrays.effects.forEach(e => e.el && e.el.remove());
    arrays.effects.length = 0;

    // Client: Ereignis anwenden, Ring ohne getroffen; ein Feind bleibt stehen
    Entities.createEnemy(110, 330, 'swoop', 0, false);
    Network.handleNetworkEvent(sent);
    const wave = arrays.effects.find(e => e.kind === 'shockwave');
    SW.updateShockwaves();
    state.gameMode = 'single';
    return {
      sent,
      clientRing: !!wave && !!wave.el,
      withoutLogic: !!wave && wave.hit === undefined,
      enemyAlive: arrays.enemies.length === 1,
    };
  });
  expect(r.sent.type).toBe('shockwave');
  expect(r.sent.x).toBe(120);
  expect(r.sent.y).toBe(340);
  expect(r.sent.radius).toBeGreaterThan(300);
  expect(r).toMatchObject({ clientRing: true, withoutLogic: true, enemyAlive: true });
});
