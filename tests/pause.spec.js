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
  await page.route('**/api/turn*', route =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'TURN nicht konfiguriert' }),
    }),
  );
  await setGameState(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
});

// Puts the page into a running online state (role 'host' or 'client')
async function online(page, roll) {
  await page.evaluate(roll => {
    const { state } = window.__game;
    state.gameMode = 'online';
    state.gameRunning = true;
    state.paused = false;
    state.cutsceneActive = false;
    state.gameOverActive = false;
    state.bossWarningActive = false;
    state.network.isOnline = true;
    state.network.isHost = roll === 'host';
    state.network.isClient = roll === 'client';
    state.network.connected = true;
    state.network.lastSentEvent = null;
  }, roll);
}

test('Online client: P2 blinking after player_hit ends after the i-frames', async ({ page }) => {
  await online(page, 'client');
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { simulationStep } = await import('./js/loop.js');
    const el = document.getElementById('spieler-2');
    el.classList.remove('spieler-blink');
    g.Network.handleNetworkEvent({ type: 'player_hit', target: 'p2', shield: true }, 'peer');
    const beforeEntry = el.classList.contains('spieler-blink');
    for (let i = 0; i < 60; i++) simulationStep();
    return { beforeEntry, thereafter: el.classList.contains('spieler-blink') };
  });
  expect(r.beforeEntry).toBe(true);
  expect(r.thereafter).toBe(false);
});

const pauseStatus = page =>
  page.evaluate(() => {
    const { state } = window.__game;
    const el = id => document.getElementById(id);
    return {
      paused: state.paused,
      fromEntry: state.pauseFrom,
      visible: el('pause-overlay').style.display !== 'none',
      title: el('pause-titel').textContent,
      info: el('pause-info').textContent,
      hint: el('pause-hinweis').textContent,
      last: state.network.lastSentEvent,
    };
  });

test('Pause a) host presses P: paused, pauseFrom p1, pause_start sent', async ({ page }) => {
  await online(page, 'host');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.paused);
  const s = await pauseStatus(page);
  expect(s.fromEntry).toBe('p1');
  expect(s.visible).toBe(true);
  expect(s.title).toContain('Spieler 1');
  expect(s.last).toMatchObject({ type: 'pause_start', fromEntry: 'p1', durationMs: 60000 });
});

test('Pause b) client receives pause_start, cannot resume and sees a hint', async ({ page }) => {
  await online(page, 'client');
  await page.evaluate(() => {
    window.__game.Network.handleNetworkEvent({ type: 'pause_start', fromEntry: 'p1', durationMs: 60000 }, 'peer');
  });
  let s = await pauseStatus(page);
  expect(s.paused).toBe(true);
  expect(s.fromEntry).toBe('p1');
  expect(s.title).toContain('Spieler 1');
  expect(s.info).toMatch(/\d:\d\d/);

  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => document.getElementById('pause-hinweis').textContent !== '');
  s = await pauseStatus(page);
  expect(s.paused).toBe(true);
  expect(s.hint).toContain('Nur Spieler 1');
  expect(s.last).toBeNull();
});

test('Pause c) the owner ends with P and sends pause_end, receiving it ends the other side', async ({ page }) => {
  await online(page, 'client');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.paused);
  expect((await pauseStatus(page)).fromEntry).toBe('p2');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => !window.__game.state.paused);
  let s = await pauseStatus(page);
  expect(s.visible).toBe(false);
  expect(s.last).toMatchObject({ type: 'pause_end' });

  // Other side: the host pauses via the client's pause_start and ends via pause_end
  await online(page, 'host');
  await page.evaluate(() => {
    const { Network } = window.__game;
    Network.handleNetworkEvent({ type: 'pause_start', fromEntry: 'p2', durationMs: 60000 }, 'peer');
  });
  expect((await pauseStatus(page)).paused).toBe(true);
  await page.evaluate(() => window.__game.Network.handleNetworkEvent({ type: 'pause_end' }, 'peer'));
  s = await pauseStatus(page);
  expect(s.paused).toBe(false);
  expect(s.fromEntry).toBeNull();
  expect(s.visible).toBe(false);
});

test('Pause d) timeout ends the pause, host sends pause_end, client ends locally', async ({ page }) => {
  await online(page, 'host');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.paused);
  await page.evaluate(() => {
    window.__game.state.pauseEndTime = Date.now() - 1;
    window.__game.state.network.lastSentEvent = null;
  });
  await page.waitForFunction(() => !window.__game.state.paused);
  let s = await pauseStatus(page);
  expect(s.fromEntry).toBeNull();
  expect(s.last).toMatchObject({ type: 'pause_end' });

  await online(page, 'client');
  await page.evaluate(() => {
    window.__game.Network.handleNetworkEvent({ type: 'pause_start', fromEntry: 'p1', durationMs: 50 }, 'peer');
  });
  await page.waitForFunction(() => !window.__game.state.paused);
  s = await pauseStatus(page);
  expect(s.visible).toBe(false);
  expect(s.last).toBeNull();
});

test('Pause e) peer_left ends the pause', async ({ page }) => {
  await online(page, 'client');
  await page.evaluate(() => {
    window.__game.Network.handleNetworkEvent({ type: 'pause_start', fromEntry: 'p1', durationMs: 60000 }, 'peer');
    window.__game.Network.handleNetworkEvent({ type: 'peer_left' }, 'peer');
  });
  const s = await pauseStatus(page);
  expect(s.paused).toBe(false);
  expect(s.visible).toBe(false);
});

test('Pause f) single player: P toggles as before without a time limit and without an event', async ({ page }) => {
  await page.evaluate(() => {
    const { state } = window.__game;
    state.gameMode = 'single';
    state.gameRunning = true;
    state.paused = false;
    state.cutsceneActive = false;
    state.gameOverActive = false;
    state.network.lastSentEvent = null;
  });
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.paused);
  let s = await pauseStatus(page);
  expect(s.fromEntry).toBeNull();
  expect(s.visible).toBe(true);
  expect(s.title).toBe('PAUSED');
  await page.evaluate(async () => {
    const { simulationStep } = await import('./js/loop.js');
    window.__game.state.pauseEndTime = Date.now() - 1000;
    for (let i = 0; i < 5; i++) simulationStep();
  });
  s = await pauseStatus(page);
  expect(s.paused).toBe(true);
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => !window.__game.state.paused);
  s = await pauseStatus(page);
  expect(s.visible).toBe(false);
  expect(s.last).toBeNull();
});

// --- Pause menu: buttons RESUME / MAIN MENU (local only) ---

async function startPaused(page, mode) {
  if (mode === 'coop') await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
  await startGame(page);
  await page.waitForFunction(() => window.__game.state.gameRunning);
  await page.evaluate(() => {
    const g = window.__game;
    g.Entities.createEnemy(100, 50);
    g.Entities.createAsteroid(200, 80, 40, 0, 1);
    g.state.score = 1234;
  });
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.paused);
}

const visible = (page, id) =>
  page.evaluate(id => {
    const el = document.getElementById(id);
    return Boolean(el) && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
  }, id);

for (const mode of ['single', 'coop']) {
  test(`pause menu (${mode}): buttons, RESUME, CANCEL, ESC`, async ({ page }) => {
    await startPaused(page, mode);
    expect(await visible(page, 'btn-pause-weiter')).toBe(true);
    expect(await visible(page, 'btn-pause-hauptmenue')).toBe(true);
    expect(await visible(page, 'btn-pause-ja')).toBe(false);

    // Query via the button, CANCEL stays paused
    await page.click('#btn-pause-hauptmenue');
    expect(await visible(page, 'btn-pause-ja')).toBe(true);
    expect(await visible(page, 'pause-abfrage-text')).toBe(true);
    await page.click('#btn-pause-abbrechen');
    expect(await visible(page, 'btn-pause-ja')).toBe(false);
    expect(await visible(page, 'btn-pause-weiter')).toBe(true);
    expect(await page.evaluate(() => window.__game.state.paused)).toBe(true);

    // ESC opens and closes the query
    await page.keyboard.press('Escape');
    expect(await visible(page, 'btn-pause-ja')).toBe(true);
    await page.keyboard.press('Escape');
    expect(await visible(page, 'btn-pause-ja')).toBe(false);
    expect(await page.evaluate(() => window.__game.state.paused)).toBe(true);

    // RESUME ends the pause
    await page.click('#btn-pause-weiter');
    expect(await page.evaluate(() => window.__game.state.paused)).toBe(false);
    expect(await visible(page, 'pause-overlay')).toBe(false);
    expect(await page.evaluate(() => window.__game.state.gameRunning)).toBe(true);
  });

  test(`pause menu (${mode}): YES ends the game without game over and a new game starts`, async ({ page }) => {
    await startPaused(page, mode);
    await page.click('#btn-pause-hauptmenue');
    await page.click('#btn-pause-ja');
    const r = await page.evaluate(() => {
      const g = window.__game;
      const el = id => document.getElementById(id);
      const a = g.arrays;
      return {
        start: el('start-screen').style.display,
        go: el('game-over-screen').style.display,
        runs: g.state.gameRunning,
        paused: g.state.paused,
        gameOver: g.state.gameOverActive,
        mode: g.state.gameMode,
        overlay: el('pause-overlay').style.display,
        enemies: a.enemies.length + a.asteroids.length + a.laserArray.length + a.enemyLaserArray.length,
        dom: document.querySelectorAll('.feind, .asteroid, .laser, .feind-laser').length,
        score: g.state.score,
        scoreText: document.getElementById('score') ? document.getElementById('score').textContent : null,
      };
    });
    expect(r.start).toBe('block');
    expect(r.go).toBe('none');
    expect(r.runs).toBe(false);
    expect(r.paused).toBe(false);
    expect(r.gameOver).toBe(false);
    expect(r.mode).toBe(mode);
    expect(r.overlay).toBe('none');
    expect(r.enemies).toBe(0);
    expect(r.dom).toBe(0);
    expect(r.score).toBe(0);
    if (r.scoreText !== null) expect(r.scoreText).not.toContain('1234');

    // A new game starts normally
    await startGame(page);
    await page.waitForFunction(() => window.__game.state.gameRunning);
    expect(await page.evaluate(() => window.__game.state.paused)).toBe(false);
  });
}

test('Pause menu online: no buttons, ESC has no effect', async ({ page }) => {
  await online(page, 'host');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.paused);
  expect(await visible(page, 'pause-overlay')).toBe(true);
  expect(await visible(page, 'btn-pause-weiter')).toBe(false);
  expect(await visible(page, 'btn-pause-hauptmenue')).toBe(false);
  await page.keyboard.press('Escape');
  expect(await visible(page, 'btn-pause-ja')).toBe(false);
  expect(await page.evaluate(() => window.__game.state.paused)).toBe(true);
});

test('Pause menu online (client, other side paused): no buttons', async ({ page }) => {
  await online(page, 'client');
  await page.evaluate(() => {
    window.__game.Network.handleNetworkEvent({ type: 'pause_start', fromEntry: 'p1', durationMs: 60000 }, 'peer');
  });
  await page.waitForFunction(() => window.__game.state.paused);
  expect(await visible(page, 'btn-pause-weiter')).toBe(false);
  expect(await visible(page, 'btn-pause-hauptmenue')).toBe(false);
});

// --- Issue #30: ESC pauses like P, NEUSTART in the local pause menu ---

test('ESC in a running game pauses, ESC in the pause opens the query, P resumes', async ({ page }) => {
  await startGame(page);
  await page.waitForFunction(() => window.__game.state.gameRunning);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__game.state.paused)).toBe(true);
  expect(await visible(page, 'btn-pause-weiter')).toBe(true);
  await page.keyboard.press('Escape');
  expect(await visible(page, 'btn-pause-ja')).toBe(true);
  await page.keyboard.press('Escape');
  expect(await visible(page, 'btn-pause-ja')).toBe(false);
  await page.keyboard.press('KeyP');
  expect(await page.evaluate(() => window.__game.state.paused)).toBe(false);
});

test('ESC in the start menu does not start or pause anything', async ({ page }) => {
  await page.keyboard.press('Escape');
  const r = await page.evaluate(() => ({ paused: window.__game.state.paused, runs: window.__game.state.gameRunning }));
  expect(r).toEqual({ paused: false, runs: false });
});

test('online: ESC pauses like P and sends pause_start', async ({ page }) => {
  await online(page, 'host');
  await page.keyboard.press('Escape');
  const r = await page.evaluate(() => ({
    paused: window.__game.state.paused,
    fromEntry: window.__game.state.pauseFrom,
    sent: window.__game.state.network.lastSentEvent && window.__game.state.network.lastSentEvent.type,
  }));
  expect(r).toEqual({ paused: true, fromEntry: 'p1', sent: 'pause_start' });
});

for (const mode of ['single', 'coop']) {
  test(`pause menu (${mode}): NEUSTART asks, CANCEL keeps the game, YES starts a new round`, async ({ page }) => {
    await startPaused(page, mode);
    expect(await visible(page, 'btn-pause-neustart')).toBe(true);
    await page.click('#btn-pause-neustart');
    expect(await page.locator('#pause-abfrage-text').textContent()).toContain('neu starten');
    await page.click('#btn-pause-abbrechen');
    expect(await page.evaluate(() => window.__game.state.score)).toBe(1234);
    await page.click('#btn-pause-neustart');
    await page.click('#btn-pause-ja');
    await page.waitForFunction(() => window.__game.state.gameRunning);
    const r = await page.evaluate(() => ({
      paused: window.__game.state.paused,
      mode: window.__game.state.gameMode,
      score: window.__game.state.score,
      enemies: window.__game.arrays.enemies.length,
      start: document.getElementById('start-screen').style.display,
    }));
    expect(r).toEqual({ paused: false, mode, score: 0, enemies: 0, start: 'none' });
  });
}

test('pause menu: the main menu query keeps its own text', async ({ page }) => {
  await startPaused(page, 'single');
  await page.click('#btn-pause-hauptmenue');
  expect(await page.locator('#pause-abfrage-text').textContent()).toContain('beenden');
});

test('a held ESC pauses once and does not flip the query with auto-repeat', async ({ page }) => {
  await startGame(page);
  await page.waitForFunction(() => window.__game.state.gameRunning);
  await page.keyboard.down('Escape');
  await page.keyboard.down('Escape'); // auto-repeat (an odd count would flip the query open)
  await page.keyboard.up('Escape');
  expect(await page.evaluate(() => window.__game.state.paused)).toBe(true);
  expect(await visible(page, 'btn-pause-ja')).toBe(false);
});
