const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.route('**/api/turn*', route => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ success: false, error: 'TURN nicht konfiguriert' })
  }));
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.8.0');
    localStorage.setItem('starshooter_skip_cutscene', 'true');
  });
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
