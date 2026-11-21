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
  // Feld leeren, keine Zufalls-Spawns; Helfer in window.__fe
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
    state.x = 185;
    state.y = 500;
    state.invulnerableTimer = 0;
    state.shieldTier = 0;
    state.lives = 3;
    state.selectedShipModel = 'phantom';
    // Segment mit festem Profil (oben = unten) auf Hoehe y
    const segment = (y, p) =>
      arrays.rock.push(Display.create({ id: 'fe_t' + y, x: 0, y, top: { ...p }, bottom: { ...p } }, 'rock'));
    window.__fe = { Rock, Display, state, arrays, config, segment, Loop: await import('./js/loop.js') };
  });
});

test('Abschnitte halten Mindestgang und Inseldurchgang ein (Feldbreite 400 und 600)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Rock, arrays, config, Display } = window.__fe;
    const error = [];
    const widthBeforehand = config.playfieldWidth;
    for (const width of [400, 600]) {
      config.playfieldWidth = width;
      Rock.reset();
      for (let round = 0; round < 60; round++) {
        Rock.createSupply(true);
        for (const s of arrays.rock) s.y += Rock.SEGMENT_HEIGHT; // Platz fuer neue Segmente
      }
      for (const s of arrays.rock) {
        const p = s.top;
        const corridor = width - p.l - p.r;
        if (corridor < Rock.minimumCorridor(p) - 0.001) error.push(`${width}: Gang ${corridor} (eng: ${!!p.narrow})`);
        if (corridor < Rock.NARROW_CORRIDOR - 0.001) error.push(`${width}: Gang unter ENG_GANG ${corridor}`);
        if (p.ib <= 0 && p.inner !== width / 2) error.push(`${width}: Inselmitte ohne Insel ${p.inner}`);
        if (p.ib > 0) {
          const gapL = p.inner - p.ib / 2 - p.l;
          const gapR = width - p.r - (p.inner + p.ib / 2);
          if (Math.min(gapL, gapR) < Rock.MIN_PASSAGE - 12) error.push(`${width}: Spalt ${Math.min(gapL, gapR)}`);
        }
      }
      arrays.rock.forEach(Display.remove);
      arrays.rock.length = 0;
    }
    config.playfieldWidth = widthBeforehand;
    return error;
  });
  expect(r).toEqual([]);
});

test('Nachschub fuellt bis oben lueckenlos, Segmente scrollen und verschwinden unten', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Rock, arrays, config } = window.__fe;
    for (let i = 0; i < 700; i++) {
      Rock.createSupply(true);
      Rock.updateRock();
    }
    const sorted = [...arrays.rock].sort((a, b) => a.y - b.y);
    const gapless = sorted.every((s, i) => i === 0 || s.y - sorted[i - 1].y === Rock.SEGMENT_HEIGHT);
    const connection = sorted.every((s, i) => i === 0 || sorted[i - 1].bottom === s.top);
    return {
      gapless,
      connection,
      top: sorted[0].y <= 0,
      bottom: sorted.at(-1).y <= config.playfieldHeight,
      count: arrays.rock.length,
    };
  });
  expect(r).toMatchObject({ gapless: true, connection: true, top: true, bottom: true });
  expect(r.count).toBeLessThanOrEqual(Math.ceil(800 / 40) + 2);
});

test('Auslauf: Waende schrumpfen auf null, danach kommt kein Fels mehr', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Rock, arrays } = window.__fe;
    for (let i = 0; i < 200; i++) {
      Rock.createSupply(true);
      Rock.updateRock();
    }
    for (let i = 0; i < 2000; i++) {
      Rock.createSupply(false);
      Rock.updateRock();
    }
    return arrays.rock.length;
  });
  expect(r).toBe(0);
});

test('Wand beruehrt: Schaden und Rueckstoss in den Gang; waehrend der I-Frames nur Rueckstoss', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Rock, state, segment } = window.__fe;
    segment(480, { l: 120, r: 30, inner: 0, ib: 0 });
    state.x = 110; // steckt 10 px in der linken Wand
    const lives = state.lives;
    Rock.updateRock();
    const first = { lives: state.lives, x: state.x, iframes: state.invulnerableTimer > 0 };
    state.x = 110;
    Rock.updateRock();
    return { first, lives, second: { lives: state.lives, x: state.x } };
  });
  expect(r.first.lives).toBe(r.lives - 1);
  expect(r.first.x).toBe(120 + 14);
  expect(r.first.iframes).toBe(true);
  expect(r.second).toEqual({ lives: r.lives - 1, x: 134 });
});

test('Rechte Wand und Insel schieben zur naeheren freien Seite', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Rock, state, segment, config } = window.__fe;
    const b = config.playfieldWidth;
    state.godMode = true;
    segment(480, { l: 20, r: 60, inner: b / 2, ib: 100 });
    state.x = b - 60 - 20; // 10 px in der rechten Wand
    Rock.updateRock();
    const right = state.x;
    state.x = b / 2 - 40; // linke Haelfte der Insel
    Rock.updateRock();
    const islandLeft = state.x;
    state.x = b / 2 + 15; // rechte Haelfte der Insel
    Rock.updateRock();
    return { right, islandLeft, islandRight: state.x, b };
  });
  const g = 30;
  expect(r.right).toBe(r.b - 60 - g - 14);
  expect(r.islandLeft).toBe(r.b / 2 - 50 - g - 14);
  expect(r.islandRight).toBe(r.b / 2 + 50 + 14);
});

test('Levelplan: Fels ab Level 4 in jedem zweiten Level, Auslauf vor dem Boss', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const L = await import('./js/level.js');
    const { state, arrays, Loop, Display, Rock } = window.__fe;
    const plans = [3, 4, 5, 6, 7, 8].map(l => [l, L.levelPlan(l).rock]);
    state.godMode = true;
    const run = (level, startFrame, steps) => {
      arrays.rock.forEach(Display.remove);
      arrays.rock.length = 0;
      Rock.reset();
      state.level = level;
      state.frameCounter = startFrame;
      for (let i = 0; i < steps; i++) Loop.simulationStep();
      return arrays.rock.length;
    };
    return {
      plans,
      level3: run(3, 1, 120),
      level4: run(4, 1, 120),
      inRunout: run(4, L.LEVEL_DURATION - L.ROCK_RUNOUT + 1, 60),
    };
  });
  expect(r.plans).toEqual([
    [3, false],
    [4, true],
    [5, false],
    [6, true],
    [7, false],
    [8, true],
  ]);
  expect(r.level3).toBe(0);
  // Fels scrollt von oben herein: 120 Schritte * 1,5 px = 180 px, also 5-6 Segmente
  expect(r.level4).toBeGreaterThanOrEqual(5);
  expect(r.inRunout).toBe(0); // Auslauf ohne vorherigen Fels: nichts Neues
});

test('Darstellung: Segment mit Polygonen fuer Wand und Insel', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { arrays, segment } = window.__fe;
    segment(100, { l: 40, r: 40, inner: 200, ib: 60 });
    segment(140, { l: 0, r: 0, inner: 200, ib: 0 });
    const [withEntry, empty] = arrays.rock;
    return {
      withEntry: withEntry.el.querySelectorAll('polygon.fels-wand').length,
      empty: empty.el.querySelectorAll('polygon').length,
      top: withEntry.el.style.top,
    };
  });
  expect(r).toEqual({ withEntry: 3, empty: 0, top: '100px' });
});

test('Online: Snapshot traegt Hoehe und Profil, der Client baut dieselben Segmente und schiebt sein Schiff', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { arrays, state, segment, Rock, Display } = window.__fe;
    const Network = await import('./js/network.js');
    segment(200, { l: 50, r: 70, inner: 0, ib: 0 });
    segment(160, { l: 60, r: 60, inner: 200, ib: 80 });
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    const sent = snap.rock;
    arrays.rock.forEach(Display.remove);
    arrays.rock.length = 0;
    const network = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    state.network = network;
    const client = arrays.rock.map(s => ({ id: s.id, y: s.y, p: Rock.profileAsText(s), el: !!s.el }));
    // Client-Vorhersage: eigenes Schiff ragt in die linke Wand
    const ship = { x: 40, y: 200 };
    const touched = Rock.pushOut(ship);
    return { sent, client, touched, x: ship.x };
  });
  expect(r.sent).toEqual([
    { id: 'fe_t200', y: 200, p: '50 70 0 0,50 70 0 0' },
    { id: 'fe_t160', y: 160, p: '60 60 200 80,60 60 200 80' },
  ]);
  expect(r.client.map(({ id, y, p }) => ({ id, y, p }))).toEqual(r.sent);
  expect(r.client.every(c => c.el)).toBe(true);
  expect(r.touched).toBe(true);
  expect(r.x).toBe(50 + 14);
});

test('Bot weicht von Wand und Insel zur Mitte des freien Bereichs aus', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { segment, config } = window.__fe;
    const Bot = await import('./js/bot.js');
    const b = config.playfieldWidth;
    for (let y = 400; y <= 560; y += 40) segment(y, { l: 60, r: 60, inner: b / 2, ib: 80 });
    return {
      leftWall: Bot.dodgeRock({ x: 65, y: 480 }),
      rightWall: Bot.dodgeRock({ x: b - 60 - 30 - 5, y: 480 }),
      beforeIsland: Bot.dodgeRock({ x: b / 2 - 40 - 30 - 5, y: 480 }),
      free: Bot.dodgeRock({ x: 60 + 40, y: 480 }),
    };
  });
  expect(r).toEqual({ leftWall: 1, rightWall: -1, beforeIsland: -1, free: 0 });
});

test('Neustart leert den Fels und setzt das Profil zurueck', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { Rock, arrays } = window.__fe;
    const Utils = await import('./js/utils.js');
    for (let i = 0; i < 50; i++) Rock.createSupply(true);
    Utils.restartGame();
    const afterRestart = arrays.rock.length;
    Rock.createSupply(false); // ohne Profil kein Auslauf-Fels
    return { afterRestart, runout: arrays.rock.length };
  });
  expect(r).toEqual({ afterRestart: 0, runout: 0 });
});

test('Powerups im Fels schweben in den freien Gang (Wand und Insel)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, segment, config, state, Loop } = window.__fe;
    const Entities = await import('./js/entities.js');
    const b = config.playfieldWidth;
    state.godMode = true;
    state.x = b / 2 - 15;
    state.y = 580;
    for (let y = -40; y <= 600; y += 40) segment(y, { l: 100, r: 30, inner: b / 2 + 20, ib: 80 });
    Entities.createPowerup(20, 100, 'energy'); // in der linken Wand
    Entities.createPowerup(b / 2 + 10, 300, 'energy'); // in der Insel, rechts der Mitte
    const [inWall, inIsland] = arrays.powerups;
    for (let i = 0; i < 60; i++) {
      for (const s of arrays.rock) s.y -= 1.5; // Fels festhalten
      Loop.simulationStep();
    }
    const g = inWall.size;
    return {
      wall: inWall.x >= 100 && inWall.x + g <= b / 2 + 20 - 40,
      island: inIsland.x >= b / 2 + 20 + 40 && inIsland.x + g <= b - 30,
    };
  });
  expect(r).toEqual({ wall: true, island: true });
});

test('Engstelle: Waende kommen bis auf ENG_GANG zusammen, versetzt und nicht immer mittig', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Rock, config } = window.__fe;
    const b = config.playfieldWidth;
    const result = [];
    for (const random of [0.1, 0.5, 0.9]) {
      const orig = Math.random;
      Math.random = () => random;
      Rock.reset();
      let points;
      try {
        points = Rock.SECTIONS.narrows();
      } finally {
        Math.random = orig;
      }
      const narrowest = Math.min(...points.map(p => b - p.l - p.r));
      const middleNarrow = points.filter(p => p.narrow).map(p => p.l + (b - p.l - p.r) / 2);
      const leftFirst = points.findIndex(p => p.l > b * 0.25) < points.findIndex(p => p.r > b * 0.25);
      result.push({ narrowest: Math.round(narrowest), middle: Math.round(middleNarrow[0]), leftFirst });
    }
    return { result, narrow: Rock.NARROW_CORRIDOR, b, names: Rock.SECTION_NAMES };
  });
  for (const e of r.result) {
    expect(e.narrowest).toBeGreaterThanOrEqual(r.narrow - 6); // Rohpunkte mit Zittern, begrenze erzwingt ENG_GANG
    expect(e.narrowest).toBeLessThan(r.narrow + 20);
    expect(e.leftFirst).toBe(true);
  }
  expect(new Set(r.result.map(e => e.middle)).size).toBe(3);
  expect(r.names).toContain('narrows');
});

test('Bot findet durch eine Engstelle, ohne den Fels zu beruehren', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { Rock, Loop, arrays, state, config, Display } = window.__fe;
    const Bot = await import('./js/bot.js');
    const Utils = await import('./js/utils.js');
    Utils.setGameMode('coop');
    for (const name of ['enemies', 'asteroids', 'rock']) {
      arrays[name].forEach(Display.remove);
      arrays[name].length = 0;
    }
    Rock.reset();
    state.godMode = true;
    state.x = 0;
    state.y = 570;
    state.p2IsBot = true;
    state.p2.x = config.playfieldWidth / 2 - 15;
    state.p2.y = 500;
    state.p2.lives = 3;
    state.p2.shieldTier = 0;
    state.p2.invulnerableTimer = 0;
    Bot.resetBot();
    const orig = Math.random;
    Math.random = () => 0.85; // Durchlass deutlich rechts der Mitte
    try {
      Rock.enqueue(Rock.SECTIONS.narrows());
    } finally {
      Math.random = orig;
    }
    let hit = 0;
    for (let i = 0; i < 900; i++) {
      Rock.createSupply(Rock.hasQueue());
      const lives = state.p2.lives;
      Loop.simulationStep();
      state.frameCounter = 1;
      if (state.p2.lives < lives) hit++;
      state.p2.invulnerableTimer = 0;
    }
    return hit;
  });
  expect(r).toBe(0);
});
