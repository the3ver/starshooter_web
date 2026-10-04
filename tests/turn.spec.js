const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

const TRYSTERO_URL = 'https://cdn.jsdelivr.net/npm/@trystero-p2p/torrent/+esm';
const ICE_SERVERS = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }
];

// Kleines Fake-Modul statt echtem Trystero: merkt sich die Konfiguration von joinRoom
const FAKE_TRYSTERO = `
export function joinRoom(config, id) {
  window.__joinConfigs = (window.__joinConfigs || []).concat([config]);
  return {
    makeAction: () => [() => {}, () => {}],
    onPeerJoin: () => {},
    onPeerLeave: () => {},
    leave: () => {}
  };
}`;

function turnAntwort(status, body) {
  return route => route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.route(TRYSTERO_URL, route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    headers: { 'access-control-allow-origin': '*' },
    body: FAKE_TRYSTERO
  }));
  await setzeSpielstand(page);
  await page.goto('/');
});

function holeConfig(page, timeoutMs) {
  return page.evaluate(async (ms) => {
    const Network = await import('./js/network.js');
    return Network.holeTurnConfig(ms);
  }, timeoutMs);
}

function betreteRaeume(page) {
  return page.evaluate(async () => {
    const Network = await import('./js/network.js');
    await Network.hostRoom('ABCDE');
    await Network.joinOnlineRoom('FGHJK');
    return window.__joinConfigs;
  });
}

test('holeTurnConfig liefert die iceServers bei Antwort 200', async ({ page }) => {
  await page.route('**/api/turn*', turnAntwort(200, { success: true, iceServers: ICE_SERVERS }));
  expect(await holeConfig(page)).toEqual(ICE_SERVERS);
});

test('holeTurnConfig liefert null bei 503', async ({ page }) => {
  await page.route('**/api/turn*', turnAntwort(503, { success: false, error: 'TURN nicht konfiguriert' }));
  expect(await holeConfig(page)).toBeNull();
});

test('holeTurnConfig liefert null bei ungueltigem JSON', async ({ page }) => {
  await page.route('**/api/turn*', turnAntwort(200, 'das ist kein json'));
  expect(await holeConfig(page)).toBeNull();
});

test('holeTurnConfig liefert null bei leerer iceServers-Liste', async ({ page }) => {
  await page.route('**/api/turn*', turnAntwort(200, { success: true, iceServers: [] }));
  expect(await holeConfig(page)).toBeNull();
});

test('holeTurnConfig liefert null nach Timeout', async ({ page }) => {
  await page.route('**/api/turn*', () => { /* antwortet nie */ });
  const r = await page.evaluate(async () => {
    const Network = await import('./js/network.js');
    const start = performance.now();
    const ergebnis = await Network.holeTurnConfig(200);
    return { ergebnis, ms: performance.now() - start };
  });
  expect(r.ergebnis).toBeNull();
  expect(r.ms).toBeLessThan(2000);
});

test('hostRoom und joinOnlineRoom reichen turnConfig an joinRoom weiter', async ({ page }) => {
  await page.route('**/api/turn*', turnAntwort(200, { success: true, iceServers: ICE_SERVERS }));
  const configs = await betreteRaeume(page);
  expect(configs).toHaveLength(2);
  for (const c of configs) {
    expect(c.appId).toBe('starshooter-p2p');
    expect(c.turnConfig).toEqual(ICE_SERVERS);
  }
});

test('hostRoom und joinOnlineRoom laufen ohne turnConfig weiter, wenn TURN fehlt', async ({ page }) => {
  await page.route('**/api/turn*', turnAntwort(503, { success: false, error: 'TURN nicht konfiguriert' }));
  const configs = await betreteRaeume(page);
  expect(configs).toHaveLength(2);
  for (const c of configs) {
    expect(c).toEqual({ appId: 'starshooter-p2p' });
  }
});
