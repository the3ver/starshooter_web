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
const TURN_ENV = { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'geheim', CF_ANALYTICS_TOKEN: 'analytics', CF_ACCOUNT_ID: 'konto' };
const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

// Beantwortet die Verbrauchsabfrage (Kostenbremse) mit `bytes`, alle anderen Aufrufe gehen an turnFetch
function mitVerbrauch(turnFetch, bytes = 0) {
  return async (url, opts) => {
    if (url === GRAPHQL_URL) {
      const gruppen = bytes === null ? [] : [{ sum: { egressBytes: bytes } }];
      return new Response(JSON.stringify({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: gruppen }] } } }), { status: 200 });
    }
    return turnFetch(url, opts);
  };
}

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
    mitVerbrauch(async () => new Response('interner Fehler geheim', { status: 500 })));
  expect(fehlerStatus.status).toBe(502);
  expect(await fehlerStatus.text()).not.toContain('geheim');
  const fehlerWurf = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV,
    mitVerbrauch(async () => { throw new Error('Token geheim'); }));
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
  const r = await behandleTurnAnfrage(turnAnfrage('http://localhost:3000'), TURN_ENV, mitVerbrauch(fetchFn));
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
  const fetchFn = mitVerbrauch(async () => new Response(JSON.stringify({ iceServers: [{ urls: ['stun:a:3478'] }] }), { status: 201 }));
  for (let i = 0; i < TURN_MAX_ANFRAGEN_PRO_STUNDE; i++) {
    const r = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV, fetchFn, cache);
    expect(r.status).toBe(200);
  }
  const zuViel = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV, fetchFn, cache);
  expect(zuViel.status).toBe(429);
  const andereIp = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io', '9.9.9.9'), TURN_ENV, fetchFn, cache);
  expect(andereIp.status).toBe(200);
});

// --- TURN-Kostenbremse (Monatslimit) ---
const TURN_OK = async () => new Response(JSON.stringify({ iceServers: [{ urls: ['stun:a:3478'] }] }), { status: 201 });

test('Kostenbremse: monatsZeitraum liefert Monatsanfang bis heute (UTC)', async () => {
  const { monatsZeitraum } = await ladeTurn();
  expect(monatsZeitraum(new Date('2026-10-02T12:00:00Z'))).toEqual({ von: '2026-10-01', bis: '2026-10-02' });
  expect(monatsZeitraum(new Date('2026-12-31T23:59:00Z'))).toEqual({ von: '2026-12-01', bis: '2026-12-31' });
});

test('Kostenbremse: Verbrauchsabfrage nutzt Konto, Schluessel, Monatszeitraum und Analytics-Token', async () => {
  const { holeMonatsverbrauchBytes } = await ladeTurn();
  let aufruf;
  const fetchFn = async (url, opts) => {
    aufruf = { url, opts };
    return new Response(JSON.stringify({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [
      { sum: { egressBytes: 300 } }, { sum: { egressBytes: 200 } }
    ] }] } } }), { status: 200 });
  };
  const bytes = await holeMonatsverbrauchBytes(TURN_ENV, fetchFn, new Date('2026-10-02T12:00:00Z'));
  expect(bytes).toBe(500);
  expect(aufruf.url).toBe(GRAPHQL_URL);
  expect(aufruf.opts.headers.Authorization).toBe('Bearer analytics');
  const body = JSON.parse(aufruf.opts.body);
  expect(body.variables).toEqual({ konto: 'konto', von: '2026-10-01', bis: '2026-10-02', schluessel: 'kid' });
  expect(body.query).toContain('callsTurnUsageAdaptiveGroups');
  expect(body.query).toContain('egressBytes');
});

test('Kostenbremse: unter dem Limit gibt es Zugangsdaten, ab dem Limit 503', async () => {
  const { behandleTurnAnfrage } = await ladeTurn();
  const unter = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV, mitVerbrauch(TURN_OK, 799e9));
  expect(unter.status).toBe(200);
  const kein = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV, mitVerbrauch(TURN_OK, null));
  expect(kein.status).toBe(200);
  let turnAufgerufen = false;
  const genau = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV,
    mitVerbrauch(async () => { turnAufgerufen = true; return TURN_OK(); }, 800e9));
  expect(genau.status).toBe(503);
  expect(await genau.json()).toEqual({ success: false, error: 'TURN-Monatslimit erreicht' });
  expect(turnAufgerufen).toBe(false);
});

test('Kostenbremse: Limit per TURN_MONATSLIMIT_GB einstellbar', async () => {
  const { behandleTurnAnfrage } = await ladeTurn();
  const env = { ...TURN_ENV, TURN_MONATSLIMIT_GB: '1' };
  const unter = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), env, mitVerbrauch(TURN_OK, 0.5e9));
  expect(unter.status).toBe(200);
  const ueber = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), env, mitVerbrauch(TURN_OK, 1e9));
  expect(ueber.status).toBe(503);
});

test('Kostenbremse: im Zweifel keine Zugangsdaten (fehlende Analytics-Daten, API-Fehler, GraphQL-Fehler)', async () => {
  const { behandleTurnAnfrage } = await ladeTurn();
  const nieTurn = async (url) => {
    if (url === GRAPHQL_URL) throw new Error('Analytics geheim');
    throw new Error('TURN darf nicht aufgerufen werden');
  };
  const ohneToken = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'),
    { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'geheim' }, nieTurn);
  expect(ohneToken.status).toBe(503);
  const apiWirft = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV, nieTurn);
  expect(apiWirft.status).toBe(503);
  expect(await apiWirft.text()).not.toContain('geheim');
  const apiStatus = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV,
    async (url) => url === GRAPHQL_URL ? new Response('x', { status: 403 }) : TURN_OK());
  expect(apiStatus.status).toBe(503);
  const gqlFehler = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io'), TURN_ENV,
    async (url) => url === GRAPHQL_URL
      ? new Response(JSON.stringify({ data: null, errors: [{ message: 'not authorized' }] }), { status: 200 })
      : TURN_OK());
  expect(gqlFehler.status).toBe(503);
});

test('Kostenbremse: Verbrauch wird zwischengespeichert, nicht bei jeder Anfrage abgefragt', async () => {
  const { behandleTurnAnfrage } = await ladeTurn();
  const speicher = new Map();
  const cache = {
    match: async (req) => { const v = speicher.get(req.url); return v ? new Response(v) : undefined; },
    put: async (req, res) => { speicher.set(req.url, await res.text()); }
  };
  let abfragen = 0;
  const zaehlend = mitVerbrauch(TURN_OK, 1e9);
  const fetchFn = async (url, opts) => { if (url === GRAPHQL_URL) abfragen++; return zaehlend(url, opts); };
  for (let i = 0; i < 3; i++) {
    const r = await behandleTurnAnfrage(turnAnfrage('https://the3ver.github.io', `10.0.0.${i}`), TURN_ENV, fetchFn, cache);
    expect(r.status).toBe(200);
  }
  expect(abfragen).toBe(1);
});
