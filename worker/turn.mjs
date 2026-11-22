// Pure TURN logic for the worker (without the Cloudflare runtime, therefore testable)

export const TURN_TTL_SECONDS = 7200; // 2 hours: limits the overrun after the monthly limit is reached
export const TURN_MAX_REQUESTS_PER_HOUR = 20;
// Cost brake: 1,000 GB egress per month are free; no new credentials from this usage on
export const TURN_MONTHLY_LIMIT_GB_STANDARD = 800;
export const TURN_USAGE_CACHE_SECONDS = 600;
const TURN_API_BASIS = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

// Removes URLs with port 53 (browsers block it; port 5349 stays) and drops entries without URLs
export function filterIceServers(iceServers) {
  if (!Array.isArray(iceServers)) return [];
  const result = [];
  for (const entry of iceServers) {
    if (!entry || !entry.urls) continue;
    const urlList = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    const allowed = urlList.filter(u => typeof u === 'string' && !/:53(?![0-9])/.test(u));
    if (allowed.length === 0) continue;
    result.push({
      ...entry,
      urls: Array.isArray(entry.urls) ? allowed : allowed[0],
    });
  }
  return result;
}

// Allows GitHub Pages and local development (any port)
export function isAllowedOrigin(origin) {
  if (typeof origin !== 'string' || !origin) return false;
  if (origin === 'https://the3ver.github.io') return true;
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

async function sha256(str) {
  const payload = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function response(payload, status, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin || 'null',
      Vary: 'Origin',
    },
  });
}

// Rate limit via the Cache API (per data center, no schema change).
// Counter per IP hash, TTL 1 hour; not atomic, but sufficient as an abuse brake.
async function checkRateLimit(request, cache) {
  if (!cache) return true;
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const ipHash = await sha256(`${ip}:${new Date().toISOString().slice(0, 13)}`);
  const key = new Request(`https://turn-limit.invalid/${ipHash}`);
  const hit = await cache.match(key);
  const count = hit ? parseInt(await hit.text(), 10) || 0 : 0;
  if (count >= TURN_MAX_REQUESTS_PER_HOUR) return false;
  await cache.put(
    key,
    new Response(String(count + 1), {
      headers: { 'Cache-Control': 'max-age=3600' },
    }),
  );
  return true;
}

// Month boundaries in the format of the GraphQL API (UTC), e.g. { from: '2026-10-01', until: '2026-10-02' }
export function monthPeriod(now = new Date()) {
  const until = now.toISOString().slice(0, 10);
  return { fromEntry: until.slice(0, 8) + '01', until };
}

// Queries the TURN egress of the current month (bytes) via the Cloudflare Analytics API. Throws on errors.
export async function getMonthlyUsageBytes(env, fetchFn = fetch, now = new Date()) {
  const { fromEntry, until } = monthPeriod(now);
  const query = `query TurnVerbrauch($konto: string!, $von: Date!, $bis: Date!, $schluessel: string!) {
  viewer {
    accounts(filter: { accountTag: $konto }) {
      callsTurnUsageAdaptiveGroups(filter: { date_geq: $von, date_leq: $bis, keyId: $schluessel }, limit: 1) {
        sum { egressBytes }
      }
    }
  }
}`;
  const responseApi = await fetchFn(CF_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { account: env.CF_ACCOUNT_ID, fromEntry, until, key: env.TURN_KEY_ID },
    }),
  });
  if (!responseApi.ok) throw new Error(`Analytics-API Status ${responseApi.status}`);
  const payload = await responseApi.json();
  if (payload.errors && payload.errors.length) throw new Error('Analytics API reports an error');
  const accounts = payload.data && payload.data.viewer && payload.data.viewer.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('Analytics API: account not found');
  const groups = accounts[0].callsTurnUsageAdaptiveGroups || [];
  // No groups = no usage in this month yet
  return groups.reduce((sum, g) => sum + ((g.sum && Number(g.sum.egressBytes)) || 0), 0);
}

// Usage with a cache (per data center), so not every request hits the Analytics API
async function monthlyUsageWithCache(env, fetchFn, cache, now) {
  const key = new Request(`https://turn-verbrauch.invalid/${monthPeriod(now).fromEntry}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) {
      const value = Number(await hit.text());
      if (Number.isFinite(value)) return value;
    }
  }
  const bytes = await getMonthlyUsageBytes(env, fetchFn, now);
  if (cache) {
    await cache.put(
      key,
      new Response(String(bytes), {
        headers: { 'Cache-Control': `max-age=${TURN_USAGE_CACHE_SECONDS}` },
      }),
    );
  }
  return bytes;
}

export function monthlyLimitBytes(env) {
  const gb = Number(env && env.TURN_MONATSLIMIT_GB);
  return (Number.isFinite(gb) && gb > 0 ? gb : TURN_MONTHLY_LIMIT_GB_STANDARD) * 1e9;
}

// GET /api/turn: fetches short-lived TURN credentials from Cloudflare
export async function handleTurnRequest(request, env, fetchFn = fetch, cache = null, now = new Date()) {
  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin)) {
    return response({ success: false, error: 'Herkunft nicht erlaubt' }, 403, null);
  }
  if (!env || !env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return response({ success: false, error: 'TURN nicht konfiguriert' }, 503, origin);
  }

  try {
    if (!(await checkRateLimit(request, cache))) {
      return response({ success: false, error: 'Zu viele Anfragen' }, 429, origin);
    }

    // Cost brake. When in doubt (no analytics credentials, API error) hand out no credentials.
    if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) {
      console.error('TURN cost brake: CF_ANALYTICS_TOKEN or CF_ACCOUNT_ID missing');
      return response({ success: false, error: 'TURN derzeit nicht verfuegbar' }, 503, origin);
    }
    let usage;
    try {
      usage = await monthlyUsageWithCache(env, fetchFn, cache, now);
    } catch (err) {
      console.error('TURN cost brake: usage not available:', err && err.message);
      return response({ success: false, error: 'TURN derzeit nicht verfuegbar' }, 503, origin);
    }
    if (usage >= monthlyLimitBytes(env)) {
      console.error('TURN cost brake: monthly limit reached, bytes:', usage);
      return response({ success: false, error: 'TURN-Monatslimit erreicht' }, 503, origin);
    }

    const responseCf = await fetchFn(`${TURN_API_BASIS}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    });
    if (!responseCf.ok) {
      console.error('TURN API error, status:', responseCf.status);
      return response({ success: false, error: 'TURN-Dienst nicht erreichbar' }, 502, origin);
    }
    const payload = await responseCf.json();
    return response({ success: true, iceServers: filterIceServers(payload.iceServers) }, 200, origin);
  } catch (err) {
    console.error('TURN request failed:', err && err.message);
    return response({ success: false, error: 'TURN-Dienst nicht erreichbar' }, 502, origin);
  }
}
