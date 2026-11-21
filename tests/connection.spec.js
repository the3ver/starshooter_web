const { test, expect } = require('@playwright/test');
const { setGameState, installClock, pauseClock } = require('./helpers');

const TRYSTERO_URL = 'https://cdn.jsdelivr.net/npm/@trystero-p2p/torrent/+esm';
const ICE_SERVERS = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' },
];

// Fake-Modul statt echtem Trystero: legt Hooks auf window, mit denen der Test Peer-Beitritt und -Abgang ausloest
const FAKE_TRYSTERO = `
export function joinRoom(config, id) {
  window.__joinConfigs = (window.__joinConfigs || []).concat([config]);
  return {
    makeAction: () => [() => {}, () => {}],
    onPeerJoin: (cb) => { window.__peerJoin = cb; },
    onPeerLeave: (cb) => { window.__peerLeave = cb; },
    leave: () => {}
  };
}`;

const HELLO_OK = "window.__game.Network.handleNetworkEvent({ type: 'hallo', protocol: window.__protocol }, 'peer')";

// Ein Tor, das ein Test von Node aus oeffnet (haelt Antworten an, bis die Phase geprueft ist)
function gate() {
  let openUp;
  const open = new Promise(r => {
    openUp = r;
  });
  return { open, openUp };
}

async function routes(page, { turnStatus = 503, turnGate = null, moduleGate = null } = {}) {
  await page.route('**/api/turn*', async route => {
    if (turnGate) await turnGate.open;
    if (turnStatus === 200) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ success: true, iceServers: ICE_SERVERS }),
      });
    } else {
      await route.fulfill({ status: turnStatus, body: '' });
    }
  });
  await page.route(TRYSTERO_URL, async route => {
    if (moduleGate) await moduleGate.open;
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: FAKE_TRYSTERO,
    });
  });
}

// mitClock: Fake-Uhr angehalten, Seitenzeit vergeht nur per page.clock.fastForward.
// Die Wartezeit-Anzeige rechnet mit Date.now() und einem 1-s-Intervall; fastForward springt die Uhr
// und feuert das faellige Intervall einmal, ohne jeden Frame des Spiel-Loops einzeln zu simulieren.
async function start(page, { withClock = false } = {}) {
  if (withClock) await installClock(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state, null, { polling: 50 });
  await page.evaluate(async () => {
    window.__protocol = (await import('./js/net-encoding.js')).PROTOCOL_VERSION;
  });
  if (withClock) await pauseClock(page);
}

const phase = page => page.evaluate(() => window.__game.state.network.connectionPhase);
const history = page => page.evaluate(() => window.__game.state.network.connectionHistory);
const statusText = page => page.evaluate(() => document.getElementById('online-status').textContent);

async function waitOnPhase(page, number) {
  await expect.poll(() => phase(page)).toBe(number);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await setGameState(page);
});

test('Host: Phasen 1 bis 5 erscheinen der Reihe nach, Raum-Code bleibt in Schritt 3 sichtbar', async ({ page }) => {
  const turnGate = gate();
  const moduleGate = gate();
  await routes(page, { turnGate, moduleGate });
  await start(page);

  await page.evaluate(() => {
    window.__hostRun = window.__game.Network.hostRoom('ABCDE');
  });
  await waitOnPhase(page, 1);
  expect(await statusText(page)).toContain('1/5 VERBINDUNGSDATEN HOLEN');

  turnGate.openUp();
  await waitOnPhase(page, 2);
  expect(await statusText(page)).toContain('2/5 NETZWERK-MODUL LADEN');
  expect(await statusText(page)).toContain('ohne TURN');

  moduleGate.openUp();
  await waitOnPhase(page, 3);
  const text3 = await statusText(page);
  expect(text3).toContain('3/5 RAUM ABCDE GEÖFFNET, WARTE AUF MITSPIELER (0:00)');
  expect(text3).toContain('RAUM-CODE: ABCDE');

  await page.evaluate(() => window.__peerJoin('peer1'));
  expect(await phase(page)).toBe(4);
  expect(await statusText(page)).toContain('4/5 MITSPIELER VERBUNDEN, VERSIONEN ABGLEICHEN');

  await page.evaluate(HELLO_OK);
  expect(await phase(page)).toBe(5);
  expect(await statusText(page)).toContain('5/5 BEREIT, SPIEL STARTET');
  expect(await history(page)).toEqual([1, 2, 3, 4, 5]);
  // Fortschrittsbalken: 5 Segmente, alle gefuellt
  expect(await page.locator('#online-status .vp-balken span').count()).toBe(5);
  expect(await page.locator('#online-status .vp-balken span.aktiv').count()).toBe(5);
});

test('Client: Phasen 1 bis 5 mit "Suche Host" in Schritt 3', async ({ page }) => {
  const turnGate = gate();
  const moduleGate = gate();
  await routes(page, { turnGate, moduleGate });
  await start(page);

  await page.evaluate(() => {
    window.__clientRun = window.__game.Network.joinOnlineRoom('fghjk');
  });
  await waitOnPhase(page, 1);
  expect(await statusText(page)).toContain('1/5 VERBINDUNGSDATEN HOLEN');
  expect(await statusText(page)).toContain('VERBINDE MIT RAUM FGHJK');

  turnGate.openUp();
  await waitOnPhase(page, 2);
  moduleGate.openUp();
  await waitOnPhase(page, 3);
  expect(await statusText(page)).toContain('3/5 SUCHE HOST IN RAUM FGHJK (0:00)');

  await page.evaluate(() => window.__peerJoin('host1'));
  expect(await phase(page)).toBe(4);
  expect(await statusText(page)).toContain('4/5 MITSPIELER VERBUNDEN, VERSIONEN ABGLEICHEN');

  await page.evaluate(HELLO_OK);
  expect(await phase(page)).toBe(5);
  expect(await statusText(page)).toContain('5/5 BEREIT, SPIEL STARTET');
  expect(await history(page)).toEqual([1, 2, 3, 4, 5]);
});

test('Host: Wartezeit zaehlt hoch, nur der Netzwerk-Hinweis erscheint nach 45 s', async ({ page }) => {
  await routes(page);
  await start(page, { withClock: true });
  await page.evaluate(() => {
    window.__game.Network.hostRoom('ABCDE');
  });
  await waitOnPhase(page, 3);

  await page.clock.fastForward(12000);
  expect(await statusText(page)).toContain('(0:12)');
  await page.clock.fastForward(10000);
  expect(await statusText(page)).toContain('(0:22)');
  const after22 = await statusText(page);
  expect(after22).not.toContain('Raum-Code prüfen');
  expect(after22).not.toContain('Manche Netzwerke');

  await page.clock.fastForward(25000);
  const after47 = await statusText(page);
  expect(after47).toContain('(0:47)');
  expect(after47).toContain('Manche Netzwerke blockieren direkte Verbindungen. Ggf. anderes Netz versuchen');
  expect(after47).not.toContain('Raum-Code prüfen');
});

test('Client: Hinweis zum Raum-Code nach 20 s, Netzwerk-Hinweis nach 45 s', async ({ page }) => {
  await routes(page);
  await start(page, { withClock: true });
  await page.evaluate(() => {
    window.__game.Network.joinOnlineRoom('FGHJK');
  });
  await waitOnPhase(page, 3);

  await page.clock.fastForward(19000);
  let text = await statusText(page);
  expect(text).toContain('(0:19)');
  expect(text).not.toContain('Raum-Code prüfen');

  await page.clock.fastForward(1000);
  text = await statusText(page);
  expect(text).toContain('(0:20)');
  expect(text).toContain('Raum-Code prüfen, der Host muss den Raum geöffnet haben');
  expect(text).not.toContain('Manche Netzwerke');

  await page.clock.fastForward(25000);
  text = await statusText(page);
  expect(text).toContain('(0:45)');
  expect(text).toContain('Manche Netzwerke blockieren direkte Verbindungen. Ggf. anderes Netz versuchen');
  expect(text).toContain('Raum-Code prüfen');
});

test('TURN-Detail: "ohne TURN" bei 503, "TURN verfügbar" bei 200', async ({ page }) => {
  await routes(page, { turnStatus: 503 });
  await start(page);
  await page.evaluate(() => window.__game.Network.hostRoom('ABCDE'));
  expect(await phase(page)).toBe(3);
  expect(await statusText(page)).toContain('ohne TURN');
  expect(await statusText(page)).not.toContain('TURN verfügbar');

  const side2 = await page.context().newPage();
  await routes(side2, { turnStatus: 200 });
  await setGameState(side2);
  await side2.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await start(side2);
  await side2.evaluate(() => window.__game.Network.joinOnlineRoom('FGHJK'));
  expect(await phase(side2)).toBe(3);
  expect(await statusText(side2)).toContain('TURN verfügbar');
  expect(await side2.evaluate(() => window.__joinConfigs[0].turnConfig.length)).toBe(2);
});

test('Fehler in Schritt 4 nennt den Schritt, Versionsabweichung behaelt ihre Meldung', async ({ page }) => {
  await routes(page);
  await start(page);
  await page.evaluate(() => window.__game.Network.hostRoom('ABCDE'));
  await page.evaluate(() => window.__peerJoin('peer1'));
  expect(await phase(page)).toBe(4);

  // Mitspieler geht vor dem Versionsabgleich
  await page.evaluate(() => window.__peerLeave('peer1'));
  expect(await statusText(page)).toBe('MITSPIELER HAT DAS SPIEL VERLASSEN! (BEI SCHRITT 4/5)');
  expect(await page.evaluate(() => document.getElementById('online-status').style.color)).toBe('rgb(231, 76, 60)');
  expect(await phase(page)).toBe(0);

  // Client: Host verlaesst den Raum waehrend Schritt 4
  const client = await page.context().newPage();
  await routes(client);
  await setGameState(client);
  await client.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await start(client);
  await client.evaluate(() => window.__game.Network.joinOnlineRoom('FGHJK'));
  await client.evaluate(() => window.__peerJoin('host1'));
  await client.evaluate(() => window.__peerLeave('host1'));
  expect(await statusText(client)).toBe('VERBINDUNG ZUM HOST VERLOREN! (BEI SCHRITT 4/5)');

  // Versionsabweichung: Meldung bleibt unveraendert, Phase ist beendet
  await page.evaluate(() => window.__game.Network.hostRoom('ABCDE'));
  await page.evaluate(() => window.__peerJoin('peer2'));
  await page.evaluate(() =>
    window.__game.Network.handleNetworkEvent({ type: 'hallo', protocol: window.__protocol - 1 }, 'peer'),
  );
  expect(await statusText(page)).toBe('Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)');
  expect(await phase(page)).toBe(0);
});

test('Schritt 3 bis 5: Timer laufen nach Raum verlassen und nach Schritt 5 nicht weiter', async ({ page }) => {
  await routes(page);
  await start(page, { withClock: true });
  await page.evaluate(() => {
    window.__game.Network.hostRoom('ABCDE');
  });
  await waitOnPhase(page, 3);
  await page.clock.fastForward(3000);
  expect(await statusText(page)).toContain('(0:03)');

  await page.evaluate(() => window.__game.Network.leaveOnlineRoom());
  expect(await phase(page)).toBe(0);
  await page.clock.fastForward(5000);
  // Ein noch laufender Ticker wuerde den Status wieder einblenden
  expect(await page.evaluate(() => document.getElementById('online-status').textContent)).toBe('RAUM VERLASSEN');

  // Nach Schritt 5 bleibt der Text stehen
  await page.evaluate(() => {
    window.__game.Network.hostRoom('ABCDE');
  });
  await waitOnPhase(page, 3);
  await page.evaluate(() => window.__peerJoin('peer1'));
  await page.evaluate(HELLO_OK);
  expect(await phase(page)).toBe(5);
  const text5 = await statusText(page);
  await page.clock.fastForward(5000);
  expect(await statusText(page)).toBe(text5);
});

test('Raum verlassen waehrend Schritt 1 bricht den Aufbau ab, es wird kein Raum betreten', async ({ page }) => {
  const turnGate = gate();
  await routes(page, { turnGate });
  await start(page);
  await page.evaluate(() => {
    window.__hostRun = window.__game.Network.hostRoom('ABCDE');
  });
  await waitOnPhase(page, 1);
  await page.evaluate(() => window.__game.Network.leaveOnlineRoom());
  turnGate.openUp();
  await page.evaluate(() => window.__hostRun);
  expect(await page.evaluate(() => window.__joinConfigs || null)).toBeNull();
  expect(await phase(page)).toBe(0);
});
