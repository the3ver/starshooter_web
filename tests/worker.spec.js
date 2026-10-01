const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

// Worker-Validierung ist ein ES-Modul (.mjs), die Spec ist CommonJS
async function ladeValidierung() {
  return import(pathToFileURL(path.join(__dirname, '..', 'worker', 'validierung.mjs')).href);
}

test('Profanity: nur der verbotene Teil wird ersetzt (BASS+ASS -> BASS+***)', async () => {
  const { bereinigeName } = await ladeValidierung();
  expect(bereinigeName('BASS+ASS')).toEqual({ ok: true, name: 'BASS+***', fehler: null });
});

test('Profanity: verbotener Teil vorne, mehrere verbotene Teile, doppelt', async () => {
  const { bereinigeName } = await ladeValidierung();
  expect(bereinigeName('ASS+BASS').name).toBe('***+BASS');
  expect(bereinigeName('FCK+SEX').name).toBe('***+***');
  expect(bereinigeName('SS+SS').name).toBe('***+***');
});

test('Profanity: verbotener Name allein wird zensiert', async () => {
  const { bereinigeName } = await ladeValidierung();
  expect(bereinigeName('ASS')).toEqual({ ok: true, name: '***', fehler: null });
});

test('Gueltige Namen bleiben unveraendert', async () => {
  const { bereinigeName } = await ladeValidierung();
  for (const n of ['ABC', 'AAA+BBB', 'BASS', 'A_B-C', 'X1Y2']) {
    expect(bereinigeName(n)).toEqual({ ok: true, name: n, fehler: null });
  }
});

test('Ungueltige Zeichen und leere Namen werden abgelehnt', async () => {
  const { bereinigeName } = await ladeValidierung();
  for (const n of ['A B', 'ÄÖÜ', '<script>', 'A!B', '', '   ', null, undefined]) {
    const r = bereinigeName(n);
    expect(r.ok, String(n)).toBe(false);
    expect(r.fehler).toBeTruthy();
  }
});

test('Kleinbuchstaben werden groß, Leerraum wird getrimmt', async () => {
  const { bereinigeName } = await ladeValidierung();
  expect(bereinigeName('  abc+def ').name).toBe('ABC+DEF');
});

test('Name wird auf 10 Zeichen gekuerzt', async () => {
  const { bereinigeName } = await ladeValidierung();
  expect(bereinigeName('ABCDEFGHIJKLMNOP').name).toBe('ABCDEFGHIJ');
});


// --- TURN (worker/turn.mjs) ---
async function ladeTurn() {
  return import(pathToFileURL(path.join(__dirname, '..', 'worker', 'turn.mjs')).href);
}

test('TURN: filtereIceServers entfernt Port 53 bei Array- und String-urls', async () => {
  const { filtereIceServers } = await ladeTurn();
  const r = filtereIceServers([
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    { urls: 'turn:turn.cloudflare.com:53?transport=udp', username: 'u', credential: 'c' },
    { urls: 'turn:turn.cloudflare.com:3478?transport=udp', username: 'u', credential: 'c' }
  ]);
  expect(r).toEqual([
    { urls: ['stun:stun.cloudflare.com:3478'] },
    { urls: 'turn:turn.cloudflare.com:3478?transport=udp', username: 'u', credential: 'c' }
  ]);
});

test('TURN: filtereIceServers verwirft Eintraege ohne urls und laesst normale unveraendert', async () => {
  const { filtereIceServers } = await ladeTurn();
  const normal = { urls: ['turn:turn.cloudflare.com:443?transport=tcp', 'turns:turn.cloudflare.com:5349?transport=tcp'], username: 'u', credential: 'c' };
  const r = filtereIceServers([
    { urls: ['turn:turn.cloudflare.com:53?transport=udp', 'turn:turn.cloudflare.com:53?transport=tcp'], username: 'u', credential: 'c' },
    { username: 'x' },
    null,
    normal
  ]);
  expect(r).toEqual([normal]);
  expect(filtereIceServers(undefined)).toEqual([]);
});

test('TURN: istErlaubteHerkunft erlaubt GitHub Pages und localhost mit beliebigem Port', async () => {
  const { istErlaubteHerkunft } = await ladeTurn();
  expect(istErlaubteHerkunft('https://the3ver.github.io')).toBe(true);
  expect(istErlaubteHerkunft('http://localhost:3000')).toBe(true);
  expect(istErlaubteHerkunft('http://localhost:8080')).toBe(true);
  expect(istErlaubteHerkunft('http://127.0.0.1:5173')).toBe(true);
});

test('TURN: istErlaubteHerkunft lehnt fremde Herkunft ab', async () => {
  const { istErlaubteHerkunft } = await ladeTurn();
  for (const o of ['https://example.com', 'http://the3ver.github.io', 'https://the3ver.github.io.evil.com',
    'http://localhost', 'https://localhost:3000', 'http://localhost:3000.evil.com', '', null, undefined]) {
    expect(istErlaubteHerkunft(o), String(o)).toBe(false);
  }
});

function turnAnfrage(origin, ip = '1.2.3.4') {
  const headers = { 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  return new Request('https://api.example/api/turn', { headers });
}
const TURN_ENV = { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'geheim' };

test('TURN-Route: 403 bei fremder oder fehlender Herkunft', async () => {
  const { behandleTurnAnfrage } = await ladeTurn();
  const fetchFn = async () => { throw new Error('darf nicht aufgerufen werden'); };
  for (const o of ['https://evil.example', null]) {
    const r = await behandleTurnAnfrage(turnAnfrage(o), TURN_ENV, fetchFn);
    expect(r.status).toBe(403);
  }
});

test('TURN-Route: 503 ohne Secrets', async () => {
  const { behandleTurnAnfrage } = await ladeTurn();
  const r = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), {}, async () => { throw new Error('x'); });
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ success: false, error: 'TURN nicht konfiguriert' });
});

test('TURN-Route: 502 bei Upstream-Fehler ohne Leck von Details', async () => {
  const { behandleTurnAnfrage } = await ladeTurn();
  const fehlerStatus = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV,
    async () => new Response('interner Fehler geheim', { status: 500 }));
  expect(fehlerStatus.status).toBe(502);
  expect(await fehlerStatus.text()).not.toContain('geheim');
  const fehlerWurf = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV,
    async () => { throw new Error('Token geheim'); });
  expect(fehlerWurf.status).toBe(502);
  expect(await fehlerWurf.text()).not.toContain('geheim');
});

test('TURN-Route: 200 liefert gefilterte iceServers, CORS-Origin und no-store', async () => {
  const { behandleTurnAnfrage, TURN_TTL_SEKUNDEN } = await ladeTurn();
  let aufruf;
  const fetchFn = async (url, opts) => {
    aufruf = { url, opts };
    return new Response(JSON.stringify({ iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      { urls: ['turn:turn.cloudflare.com:53?transport=udp'], username: 'u', credential: 'c' },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }
    ] }), { status: 201 });
  };
  const r = await behandleTurnAnfrage(turnAnfrage('http://localhost:3000'), TURN_ENV, fetchFn);
  expect(r.status).toBe(200);
  expect(r.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  expect(r.headers.get('Cache-Control')).toBe('no-store');
  const body = await r.json();
  expect(body.success).toBe(true);
  expect(body.iceServers).toEqual([
    { urls: ['stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }
  ]);
  expect(aufruf.url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers');
  expect(aufruf.opts.method).toBe('POST');
  expect(aufruf.opts.headers.Authorization).toBe('Bearer geheim');
  expect(JSON.parse(aufruf.opts.body)).toEqual({ ttl: TURN_TTL_SEKUNDEN });
});

test('TURN-Route: Rate-Limit liefert 429 nach zu vielen Anfragen derselben IP', async () => {
  const { behandleTurnAnfrage, TURN_MAX_ANFRAGEN_PRO_STUNDE } = await ladeTurn();
  const speicher = new Map();
  const cache = {
    match: async (req) => { const v = speicher.get(req.url); return v ? new Response(v) : undefined; },
    put: async (req, res) => { speicher.set(req.url, await res.text()); }
  };
  const fetchFn = async () => new Response(JSON.stringify({ iceServers: [{ urls: ['stun:a:3478'] }] }), { status: 201 });
  for (let i = 0; i < TURN_MAX_ANFRAGEN_PRO_STUNDE; i++) {
    const r = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV, fetchFn, cache);
    expect(r.status).toBe(200);
  }
  const zuViel = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV, fetchFn, cache);
  expect(zuViel.status).toBe(429);
  const andereIp = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io', '9.9.9.9'), TURN_ENV, fetchFn, cache);
  expect(andereIp.status).toBe(200);
});
