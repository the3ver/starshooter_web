const { test, expect } = require('@playwright/test');
const { setzeSpielstand, starteSpiel } = require('./helfer');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.route('**/api/turn*', route => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ success: false, error: 'TURN nicht konfiguriert' })
  }));
  await setzeSpielstand(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
});

// Versetzt die Seite in einen laufenden Online-Zustand (rolle 'host' oder 'client')
async function online(page, rolle) {
  await page.evaluate((rolle) => {
    const { state } = window.__game;
    state.gameMode = 'online';
    state.spielLaeuft = true;
    state.pausiert = false;
    state.cutsceneAktiv = false;
    state.gameOverAktiv = false;
    state.bossWarningAktiv = false;
    state.network.isOnline = true;
    state.network.isHost = rolle === 'host';
    state.network.isClient = rolle === 'client';
    state.network.connected = true;
    state.network.lastSentEvent = null;
  }, rolle);
}

test('Online-Client: P2-Blinken nach player_hit endet nach den I-Frames', async ({ page }) => {
  await online(page, 'client');
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { simulationsSchritt } = await import('./js/loop.js');
    const el = document.getElementById('spieler-2');
    el.classList.remove('spieler-blink');
    g.Network.handleNetworkEvent({ type: 'player_hit', target: 'p2', shield: true }, 'peer');
    const davor = el.classList.contains('spieler-blink');
    for (let i = 0; i < 60; i++) simulationsSchritt();
    return { davor, danach: el.classList.contains('spieler-blink') };
  });
  expect(r.davor).toBe(true);
  expect(r.danach).toBe(false);
});

const pauseStatus = (page) => page.evaluate(() => {
  const { state } = window.__game;
  const el = (id) => document.getElementById(id);
  return {
    pausiert: state.pausiert,
    von: state.pauseVon,
    sichtbar: el('pause-overlay').style.display !== 'none',
    titel: el('pause-titel').textContent,
    info: el('pause-info').textContent,
    hinweis: el('pause-hinweis').textContent,
    letztes: state.network.lastSentEvent
  };
});

test('Pause a) Host drueckt P: pausiert, pauseVon p1, pause_start gesendet', async ({ page }) => {
  await online(page, 'host');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.pausiert);
  const s = await pauseStatus(page);
  expect(s.von).toBe('p1');
  expect(s.sichtbar).toBe(true);
  expect(s.titel).toContain('Spieler 1');
  expect(s.letztes).toMatchObject({ type: 'pause_start', von: 'p1', dauerMs: 60000 });
});

test('Pause b) Client erhaelt pause_start, kann nicht fortsetzen und sieht einen Hinweis', async ({ page }) => {
  await online(page, 'client');
  await page.evaluate(() => {
    window.__game.Network.handleNetworkEvent({ type: 'pause_start', von: 'p1', dauerMs: 60000 }, 'peer');
  });
  let s = await pauseStatus(page);
  expect(s.pausiert).toBe(true);
  expect(s.von).toBe('p1');
  expect(s.titel).toContain('Spieler 1');
  expect(s.info).toMatch(/\d:\d\d/);

  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => document.getElementById('pause-hinweis').textContent !== '');
  s = await pauseStatus(page);
  expect(s.pausiert).toBe(true);
  expect(s.hinweis).toContain('Nur Spieler 1');
  expect(s.letztes).toBeNull();
});

test('Pause c) Besitzer beendet mit P und sendet pause_ende, Empfang beendet die Gegenseite', async ({ page }) => {
  await online(page, 'client');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.pausiert);
  expect((await pauseStatus(page)).von).toBe('p2');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => !window.__game.state.pausiert);
  let s = await pauseStatus(page);
  expect(s.sichtbar).toBe(false);
  expect(s.letztes).toMatchObject({ type: 'pause_ende' });

  // Gegenseite: Host pausiert durch pause_start des Clients und endet durch pause_ende
  await online(page, 'host');
  await page.evaluate(() => {
    const { Network } = window.__game;
    Network.handleNetworkEvent({ type: 'pause_start', von: 'p2', dauerMs: 60000 }, 'peer');
  });
  expect((await pauseStatus(page)).pausiert).toBe(true);
  await page.evaluate(() => window.__game.Network.handleNetworkEvent({ type: 'pause_ende' }, 'peer'));
  s = await pauseStatus(page);
  expect(s.pausiert).toBe(false);
  expect(s.von).toBeNull();
  expect(s.sichtbar).toBe(false);
});

test('Pause d) Zeitablauf beendet die Pause, Host sendet pause_ende, Client beendet lokal', async ({ page }) => {
  await online(page, 'host');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.pausiert);
  await page.evaluate(() => { window.__game.state.pauseEndeZeit = Date.now() - 1; window.__game.state.network.lastSentEvent = null; });
  await page.waitForFunction(() => !window.__game.state.pausiert);
  let s = await pauseStatus(page);
  expect(s.von).toBeNull();
  expect(s.letztes).toMatchObject({ type: 'pause_ende' });

  await online(page, 'client');
  await page.evaluate(() => {
    window.__game.Network.handleNetworkEvent({ type: 'pause_start', von: 'p1', dauerMs: 50 }, 'peer');
  });
  await page.waitForFunction(() => !window.__game.state.pausiert);
  s = await pauseStatus(page);
  expect(s.sichtbar).toBe(false);
  expect(s.letztes).toBeNull();
});

test('Pause e) peer_left beendet die Pause', async ({ page }) => {
  await online(page, 'client');
  await page.evaluate(() => {
    window.__game.Network.handleNetworkEvent({ type: 'pause_start', von: 'p1', dauerMs: 60000 }, 'peer');
    window.__game.Network.handleNetworkEvent({ type: 'peer_left' }, 'peer');
  });
  const s = await pauseStatus(page);
  expect(s.pausiert).toBe(false);
  expect(s.sichtbar).toBe(false);
});

test('Pause f) Singleplayer: P schaltet wie bisher ohne Zeitlimit und ohne Event', async ({ page }) => {
  await page.evaluate(() => {
    const { state } = window.__game;
    state.gameMode = 'single';
    state.spielLaeuft = true;
    state.pausiert = false;
    state.cutsceneAktiv = false;
    state.gameOverAktiv = false;
    state.network.lastSentEvent = null;
  });
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.pausiert);
  let s = await pauseStatus(page);
  expect(s.von).toBeNull();
  expect(s.sichtbar).toBe(true);
  expect(s.titel).toBe('PAUSED');
  await page.evaluate(async () => {
    const { simulationsSchritt } = await import('./js/loop.js');
    window.__game.state.pauseEndeZeit = Date.now() - 1000;
    for (let i = 0; i < 5; i++) simulationsSchritt();
  });
  s = await pauseStatus(page);
  expect(s.pausiert).toBe(true);
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => !window.__game.state.pausiert);
  s = await pauseStatus(page);
  expect(s.sichtbar).toBe(false);
  expect(s.letztes).toBeNull();
});

// --- Pausenmenue: Knoepfe WEITER / HAUPTMENUE (nur lokal) ---

async function startePausiert(page, modus) {
  if (modus === 'coop') await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
  await starteSpiel(page);
  await page.waitForFunction(() => window.__game.state.spielLaeuft);
  await page.evaluate(() => {
    const g = window.__game;
    g.Entities.erzeugeFeind(100, 50);
    g.Entities.erzeugeAsteroid(200, 80, 40, 0, 1);
    g.state.score = 1234;
  });
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.pausiert);
}

const sichtbar = (page, id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  return Boolean(el) && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
}, id);

for (const modus of ['single', 'coop']) {
  test(`Pausenmenue (${modus}): Knoepfe, WEITER, ABBRECHEN, ESC`, async ({ page }) => {
    await startePausiert(page, modus);
    expect(await sichtbar(page, 'btn-pause-weiter')).toBe(true);
    expect(await sichtbar(page, 'btn-pause-hauptmenue')).toBe(true);
    expect(await sichtbar(page, 'btn-pause-ja')).toBe(false);

    // Abfrage ueber Knopf, ABBRECHEN bleibt pausiert
    await page.click('#btn-pause-hauptmenue');
    expect(await sichtbar(page, 'btn-pause-ja')).toBe(true);
    expect(await sichtbar(page, 'pause-abfrage-text')).toBe(true);
    await page.click('#btn-pause-abbrechen');
    expect(await sichtbar(page, 'btn-pause-ja')).toBe(false);
    expect(await sichtbar(page, 'btn-pause-weiter')).toBe(true);
    expect(await page.evaluate(() => window.__game.state.pausiert)).toBe(true);

    // ESC oeffnet und schliesst die Abfrage
    await page.keyboard.press('Escape');
    expect(await sichtbar(page, 'btn-pause-ja')).toBe(true);
    await page.keyboard.press('Escape');
    expect(await sichtbar(page, 'btn-pause-ja')).toBe(false);
    expect(await page.evaluate(() => window.__game.state.pausiert)).toBe(true);

    // WEITER beendet die Pause
    await page.click('#btn-pause-weiter');
    expect(await page.evaluate(() => window.__game.state.pausiert)).toBe(false);
    expect(await sichtbar(page, 'pause-overlay')).toBe(false);
    expect(await page.evaluate(() => window.__game.state.spielLaeuft)).toBe(true);
  });

  test(`Pausenmenue (${modus}): JA beendet das Spiel ohne Game-Over und ein neues Spiel startet`, async ({ page }) => {
    await startePausiert(page, modus);
    await page.click('#btn-pause-hauptmenue');
    await page.click('#btn-pause-ja');
    const r = await page.evaluate(() => {
      const g = window.__game;
      const el = (id) => document.getElementById(id);
      const a = g.arrays;
      return {
        start: el('start-screen').style.display,
        go: el('game-over-screen').style.display,
        laeuft: g.state.spielLaeuft,
        pausiert: g.state.pausiert,
        gameOver: g.state.gameOverAktiv,
        modus: g.state.gameMode,
        overlay: el('pause-overlay').style.display,
        feinde: a.feinde.length + a.asteroiden.length + a.laserArray.length + a.feindLaserArray.length,
        dom: document.querySelectorAll('.feind, .asteroid, .laser, .feind-laser').length,
        score: g.state.score,
        scoreText: document.getElementById('score') ? document.getElementById('score').textContent : null
      };
    });
    expect(r.start).toBe('block');
    expect(r.go).toBe('none');
    expect(r.laeuft).toBe(false);
    expect(r.pausiert).toBe(false);
    expect(r.gameOver).toBe(false);
    expect(r.modus).toBe(modus);
    expect(r.overlay).toBe('none');
    expect(r.feinde).toBe(0);
    expect(r.dom).toBe(0);
    expect(r.score).toBe(0);
    if (r.scoreText !== null) expect(r.scoreText).not.toContain('1234');

    // Neues Spiel startet normal
    await starteSpiel(page);
    await page.waitForFunction(() => window.__game.state.spielLaeuft);
    expect(await page.evaluate(() => window.__game.state.pausiert)).toBe(false);
  });
}

test('Pausenmenue online: keine Knoepfe, ESC wirkungslos', async ({ page }) => {
  await online(page, 'host');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__game.state.pausiert);
  expect(await sichtbar(page, 'pause-overlay')).toBe(true);
  expect(await sichtbar(page, 'btn-pause-weiter')).toBe(false);
  expect(await sichtbar(page, 'btn-pause-hauptmenue')).toBe(false);
  await page.keyboard.press('Escape');
  expect(await sichtbar(page, 'btn-pause-ja')).toBe(false);
  expect(await page.evaluate(() => window.__game.state.pausiert)).toBe(true);
});

test('Pausenmenue online (Client, fremde Pause): keine Knoepfe', async ({ page }) => {
  await online(page, 'client');
  await page.evaluate(() => {
    window.__game.Network.handleNetworkEvent({ type: 'pause_start', von: 'p1', dauerMs: 60000 }, 'peer');
  });
  await page.waitForFunction(() => window.__game.state.pausiert);
  expect(await sichtbar(page, 'btn-pause-weiter')).toBe(false);
  expect(await sichtbar(page, 'btn-pause-hauptmenue')).toBe(false);
});
