const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

// The worker validation is an ES module (.mjs), the spec is CommonJS
async function chargingValidation() {
  return import(pathToFileURL(path.join(__dirname, '..', 'worker', 'validation.mjs')).href);
}

test('Profanity: only the forbidden part is replaced (BASS+ASS -> BASS+***)', async () => {
  const { cleanName } = await chargingValidation();
  expect(cleanName('BASS+ASS')).toEqual({ ok: true, name: 'BASS+***', error: null });
});

test('Profanity: forbidden part in front, several forbidden parts, duplicate', async () => {
  const { cleanName } = await chargingValidation();
  expect(cleanName('ASS+BASS').name).toBe('***+BASS');
  expect(cleanName('FCK+SEX').name).toBe('***+***');
  expect(cleanName('SS+SS').name).toBe('***+***');
});

test('Profanity: a forbidden name on its own is censored', async () => {
  const { cleanName } = await chargingValidation();
  expect(cleanName('ASS')).toEqual({ ok: true, name: '***', error: null });
});

test('Valid names stay unchanged', async () => {
  const { cleanName } = await chargingValidation();
  for (const n of ['ABC', 'AAA+BBB', 'BASS', 'A_B-C', 'X1Y2']) {
    expect(cleanName(n)).toEqual({ ok: true, name: n, error: null });
  }
});

test('Invalid characters and empty names are rejected', async () => {
  const { cleanName } = await chargingValidation();
  for (const n of ['A B', 'ÄÖÜ', '<script>', 'A!B', '', '   ', null, undefined]) {
    const r = cleanName(n);
    expect(r.ok, String(n)).toBe(false);
    expect(r.error).toBeTruthy();
  }
});

test('Lowercase letters become uppercase, whitespace is trimmed', async () => {
  const { cleanName } = await chargingValidation();
  expect(cleanName('  abc+def ').name).toBe('ABC+DEF');
});

test('Name is shortened to 10 characters', async () => {
  const { cleanName } = await chargingValidation();
  expect(cleanName('ABCDEFGHIJKLMNOP').name).toBe('ABCDEFGHIJ');
});

// --- TURN (worker/turn.mjs) ---
async function chargingTurn() {
  return import(pathToFileURL(path.join(__dirname, '..', 'worker', 'turn.mjs')).href);
}

test('TURN: filterIceServers removes port 53 for array and string urls', async () => {
  const { filterIceServers } = await chargingTurn();
  const r = filterIceServers([
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    { urls: 'turn:turn.cloudflare.com:53?transport=udp', username: 'u', credential: 'c' },
    { urls: 'turn:turn.cloudflare.com:3478?transport=udp', username: 'u', credential: 'c' },
  ]);
  expect(r).toEqual([
    { urls: ['stun:stun.cloudflare.com:3478'] },
    { urls: 'turn:turn.cloudflare.com:3478?transport=udp', username: 'u', credential: 'c' },
  ]);
});

test('TURN: filterIceServers drops entries without urls and leaves normal ones unchanged', async () => {
  const { filterIceServers } = await chargingTurn();
  const normal = {
    urls: ['turn:turn.cloudflare.com:443?transport=tcp', 'turns:turn.cloudflare.com:5349?transport=tcp'],
    username: 'u',
    credential: 'c',
  };
  const r = filterIceServers([
    {
      urls: ['turn:turn.cloudflare.com:53?transport=udp', 'turn:turn.cloudflare.com:53?transport=tcp'],
      username: 'u',
      credential: 'c',
    },
    { username: 'x' },
    null,
    normal,
  ]);
  expect(r).toEqual([normal]);
  expect(filterIceServers(undefined)).toEqual([]);
});

test('TURN: isAllowedOrigin allows GitHub Pages and localhost with any port', async () => {
  const { isAllowedOrigin } = await chargingTurn();
  expect(isAllowedOrigin('https://the3ver.github.io')).toBe(true);
  expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
  expect(isAllowedOrigin('http://localhost:8080')).toBe(true);
  expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
});

test('TURN: isAllowedOrigin rejects a foreign origin', async () => {
  const { isAllowedOrigin } = await chargingTurn();
  for (const o of [
    'https://example.com',
    'http://the3ver.github.io',
    'https://the3ver.github.io.evil.com',
    'http://localhost',
    'https://localhost:3000',
    'http://localhost:3000.evil.com',
    '',
    null,
    undefined,
  ]) {
    expect(isAllowedOrigin(o), String(o)).toBe(false);
  }
});

function turnRequest(origin, ip = '1.2.3.4') {
  const headers = { 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  return new Request('https://api.example/api/turn', { headers });
}
const TURN_ENV = {
  TURN_KEY_ID: 'kid',
  TURN_KEY_API_TOKEN: 'secret',
  CF_ANALYTICS_TOKEN: 'analytics',
  CF_ACCOUNT_ID: 'account',
};
const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

// Answers the usage query (cost brake) with `bytes`, all other calls go to turnFetch
function withUsage(turnFetch, bytes = 0) {
  return async (url, opts) => {
    if (url === GRAPHQL_URL) {
      const groups = bytes === null ? [] : [{ sum: { egressBytes: bytes } }];
      return new Response(
        JSON.stringify({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: groups }] } } }),
        { status: 200 },
      );
    }
    return turnFetch(url, opts);
  };
}

test('TURN route: 403 on a foreign or missing origin', async () => {
  const { handleTurnRequest } = await chargingTurn();
  const fetchFn = async () => {
    throw new Error('must not be called');
  };
  for (const o of ['https://evil.example', null]) {
    const r = await handleTurnRequest(turnRequest(o), TURN_ENV, fetchFn);
    expect(r.status).toBe(403);
  }
});

test('TURN route: 503 without secrets', async () => {
  const { handleTurnRequest } = await chargingTurn();
  const r = await handleTurnRequest(turnRequest('https://the3ver.github.io'), {}, async () => {
    throw new Error('x');
  });
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ success: false, error: 'TURN nicht konfiguriert' });
});

test('TURN route: 502 on an upstream error without leaking details', async () => {
  const { handleTurnRequest } = await chargingTurn();
  const errorStatus = await handleTurnRequest(
    turnRequest('https://the3ver.github.io'),
    TURN_ENV,
    withUsage(async () => new Response('interner Fehler secret', { status: 500 })),
  );
  expect(errorStatus.status).toBe(502);
  expect(await errorStatus.text()).not.toContain('secret');
  const errorThrow = await handleTurnRequest(
    turnRequest('https://the3ver.github.io'),
    TURN_ENV,
    withUsage(async () => {
      throw new Error('Token secret');
    }),
  );
  expect(errorThrow.status).toBe(502);
  expect(await errorThrow.text()).not.toContain('secret');
});

test('TURN route: 200 returns filtered iceServers, CORS origin and no-store', async () => {
  const { handleTurnRequest, TURN_TTL_SECONDS } = await chargingTurn();
  let call;
  const fetchFn = async (url, opts) => {
    call = { url, opts };
    return new Response(
      JSON.stringify({
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
          { urls: ['turn:turn.cloudflare.com:53?transport=udp'], username: 'u', credential: 'c' },
          { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' },
        ],
      }),
      { status: 201 },
    );
  };
  const r = await handleTurnRequest(turnRequest('http://localhost:3000'), TURN_ENV, withUsage(fetchFn));
  expect(r.status).toBe(200);
  expect(r.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  expect(r.headers.get('Cache-Control')).toBe('no-store');
  const body = await r.json();
  expect(body.success).toBe(true);
  expect(body.iceServers).toEqual([
    { urls: ['stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' },
  ]);
  expect(call.url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers');
  expect(call.opts.method).toBe('POST');
  expect(call.opts.headers.Authorization).toBe('Bearer secret');
  expect(JSON.parse(call.opts.body)).toEqual({ ttl: TURN_TTL_SECONDS });
});

test('TURN route: rate limit returns 429 after too many requests from the same IP', async () => {
  const { handleTurnRequest, TURN_MAX_REQUESTS_PRO_HOUR } = await chargingTurn();
  const storage = new Map();
  const cache = {
    match: async req => {
      const v = storage.get(req.url);
      return v ? new Response(v) : undefined;
    },
    put: async (req, res) => {
      storage.set(req.url, await res.text());
    },
  };
  const fetchFn = withUsage(
    async () => new Response(JSON.stringify({ iceServers: [{ urls: ['stun:a:3478'] }] }), { status: 201 }),
  );
  for (let i = 0; i < TURN_MAX_REQUESTS_PRO_HOUR; i++) {
    const r = await handleTurnRequest(turnRequest('https://the3ver.github.io'), TURN_ENV, fetchFn, cache);
    expect(r.status).toBe(200);
  }
  const tooMuch = await handleTurnRequest(turnRequest('https://the3ver.github.io'), TURN_ENV, fetchFn, cache);
  expect(tooMuch.status).toBe(429);
  const otherIp = await handleTurnRequest(
    turnRequest('https://the3ver.github.io', '9.9.9.9'),
    TURN_ENV,
    fetchFn,
    cache,
  );
  expect(otherIp.status).toBe(200);
});

// --- TURN cost brake (monthly limit) ---
const TURN_OK = async () => new Response(JSON.stringify({ iceServers: [{ urls: ['stun:a:3478'] }] }), { status: 201 });

test('Cost brake: monthPeriod returns start of month until today (UTC)', async () => {
  const { monthPeriod } = await chargingTurn();
  expect(monthPeriod(new Date('2026-10-02T12:00:00Z'))).toEqual({ fromEntry: '2026-10-01', until: '2026-10-02' });
  expect(monthPeriod(new Date('2026-12-31T23:59:00Z'))).toEqual({ fromEntry: '2026-12-01', until: '2026-12-31' });
});

test('Cost brake: usage query uses account, key, month period and analytics token', async () => {
  const { getMonthlyUsageBytes } = await chargingTurn();
  let call;
  const fetchFn = async (url, opts) => {
    call = { url, opts };
    return new Response(
      JSON.stringify({
        data: {
          viewer: {
            accounts: [
              { callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 300 } }, { sum: { egressBytes: 200 } }] },
            ],
          },
        },
      }),
      { status: 200 },
    );
  };
  const bytes = await getMonthlyUsageBytes(TURN_ENV, fetchFn, new Date('2026-10-02T12:00:00Z'));
  expect(bytes).toBe(500);
  expect(call.url).toBe(GRAPHQL_URL);
  expect(call.opts.headers.Authorization).toBe('Bearer analytics');
  const body = JSON.parse(call.opts.body);
  expect(body.variables).toEqual({ account: 'account', fromEntry: '2026-10-01', until: '2026-10-02', key: 'kid' });
  expect(body.query).toContain('callsTurnUsageAdaptiveGroups');
  expect(body.query).toContain('egressBytes');
});

test('Cost brake: below the limit there are credentials, from the limit on 503', async () => {
  const { handleTurnRequest } = await chargingTurn();
  const below = await handleTurnRequest(turnRequest('https://the3ver.github.io'), TURN_ENV, withUsage(TURN_OK, 799e9));
  expect(below.status).toBe(200);
  const no = await handleTurnRequest(turnRequest('https://the3ver.github.io'), TURN_ENV, withUsage(TURN_OK, null));
  expect(no.status).toBe(200);
  let turnCalled = false;
  const exact = await handleTurnRequest(
    turnRequest('https://the3ver.github.io'),
    TURN_ENV,
    withUsage(async () => {
      turnCalled = true;
      return TURN_OK();
    }, 800e9),
  );
  expect(exact.status).toBe(503);
  expect(await exact.json()).toEqual({ success: false, error: 'TURN-Monatslimit erreicht' });
  expect(turnCalled).toBe(false);
});

test('Cost brake: limit adjustable via TURN_MONATSLIMIT_GB', async () => {
  const { handleTurnRequest } = await chargingTurn();
  const env = { ...TURN_ENV, TURN_MONATSLIMIT_GB: '1' };
  const below = await handleTurnRequest(turnRequest('https://the3ver.github.io'), env, withUsage(TURN_OK, 0.5e9));
  expect(below.status).toBe(200);
  const over = await handleTurnRequest(turnRequest('https://the3ver.github.io'), env, withUsage(TURN_OK, 1e9));
  expect(over.status).toBe(503);
});

test('Cost brake: when in doubt no credentials (missing analytics data, API error, GraphQL error)', async () => {
  const { handleTurnRequest } = await chargingTurn();
  const neverTurn = async url => {
    if (url === GRAPHQL_URL) throw new Error('Analytics secret');
    throw new Error('TURN must not be called');
  };
  const withoutToken = await handleTurnRequest(
    turnRequest('https://the3ver.github.io'),
    { TURN_KEY_ID: 'kid', TURN_KEY_API_TOKEN: 'secret' },
    neverTurn,
  );
  expect(withoutToken.status).toBe(503);
  const apiThrows = await handleTurnRequest(turnRequest('https://the3ver.github.io'), TURN_ENV, neverTurn);
  expect(apiThrows.status).toBe(503);
  expect(await apiThrows.text()).not.toContain('secret');
  const apiStatus = await handleTurnRequest(turnRequest('https://the3ver.github.io'), TURN_ENV, async url =>
    url === GRAPHQL_URL ? new Response('x', { status: 403 }) : TURN_OK(),
  );
  expect(apiStatus.status).toBe(503);
  const gqlError = await handleTurnRequest(turnRequest('https://the3ver.github.io'), TURN_ENV, async url =>
    url === GRAPHQL_URL
      ? new Response(JSON.stringify({ data: null, errors: [{ message: 'not authorized' }] }), { status: 200 })
      : TURN_OK(),
  );
  expect(gqlError.status).toBe(503);
});

test('Cost brake: usage is cached, not queried on every request', async () => {
  const { handleTurnRequest } = await chargingTurn();
  const storage = new Map();
  const cache = {
    match: async req => {
      const v = storage.get(req.url);
      return v ? new Response(v) : undefined;
    },
    put: async (req, res) => {
      storage.set(req.url, await res.text());
    },
  };
  let query = 0;
  const counting = withUsage(TURN_OK, 1e9);
  const fetchFn = async (url, opts) => {
    if (url === GRAPHQL_URL) query++;
    return counting(url, opts);
  };
  for (let i = 0; i < 3; i++) {
    const r = await handleTurnRequest(
      turnRequest('https://the3ver.github.io', `10.0.0.${i}`),
      TURN_ENV,
      fetchFn,
      cache,
    );
    expect(r.status).toBe(200);
  }
  expect(query).toBe(1);
});
