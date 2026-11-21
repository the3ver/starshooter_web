// Reine TURN-Logik fuer den Worker (ohne Cloudflare-Laufzeit, daher testbar)

export const TURN_TTL_SECONDS = 7200; // 2 Stunden: begrenzt Nachlauf nach Erreichen des Monatslimits
export const TURN_MAX_REQUESTS_PRO_HOUR = 20;
// Kostenbremse: 1.000 GB Egress pro Monat sind frei; ab diesem Verbrauch keine neuen Zugangsdaten
export const TURN_MONTHLY_LIMIT_GB_STANDARD = 800;
export const TURN_USAGE_CACHE_SECONDS = 600;
const TURN_API_BASIS = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

// Entfernt URLs mit Port 53 (Browser blockieren ihn; Port 5349 bleibt erhalten) und verwirft Eintraege ohne URLs
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

// Erlaubt GitHub Pages und lokale Entwicklung (beliebiger Port)
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

// Rate-Limit ueber die Cache API (pro Rechenzentrum, ohne Schema-Aenderung).
// Zaehler pro IP-Hash, TTL 1 Stunde; nicht atomar, aber als Missbrauchsbremse ausreichend.
async function checkRateLimit(request, cache) {
  if (!cache) return true;
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const ipHash = await sha256(`${ip}:${new Date().toISOString().slice(0, 13)}`);
  const key = new Request(`https://turn-limit.invalid/${ipHash}`);
  const hit = await cache.match(key);
  const count = hit ? parseInt(await hit.text(), 10) || 0 : 0;
  if (count >= TURN_MAX_REQUESTS_PRO_HOUR) return false;
  await cache.put(
    key,
    new Response(String(count + 1), {
      headers: { 'Cache-Control': 'max-age=3600' },
    }),
  );
  return true;
}

// Monatsgrenzen im Format der GraphQL-API (UTC), z.B. { von: '2026-10-01', bis: '2026-10-02' }
export function monthPeriod(now = new Date()) {
  const until = now.toISOString().slice(0, 10);
  return { fromEntry: until.slice(0, 8) + '01', until };
}

// Fragt den TURN-Egress des laufenden Monats (Bytes) ueber die Cloudflare-Analytics-API ab. Wirft bei Fehlern.
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
  if (payload.errors && payload.errors.length) throw new Error('Analytics-API meldet Fehler');
  const accounts = payload.data && payload.data.viewer && payload.data.viewer.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('Analytics-API: Konto nicht gefunden');
  const groups = accounts[0].callsTurnUsageAdaptiveGroups || [];
  // Keine Gruppen = noch kein Verbrauch in diesem Monat
  return groups.reduce((sum, g) => sum + ((g.sum && Number(g.sum.egressBytes)) || 0), 0);
}

// Verbrauch mit Zwischenspeicher (pro Rechenzentrum), damit nicht jede Anfrage die Analytics-API trifft
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

// GET /api/turn: holt kurzlebige TURN-Zugangsdaten bei Cloudflare
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

    // Kostenbremse. Im Zweifel (keine Analytics-Zugangsdaten, API-Fehler) keine Zugangsdaten ausgeben.
    if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) {
      console.error('TURN-Kostenbremse: CF_ANALYTICS_TOKEN oder CF_ACCOUNT_ID fehlt');
      return response({ success: false, error: 'TURN derzeit nicht verfuegbar' }, 503, origin);
    }
    let usage;
    try {
      usage = await monthlyUsageWithCache(env, fetchFn, cache, now);
    } catch (err) {
      console.error('TURN-Kostenbremse: Verbrauch nicht abrufbar:', err && err.message);
      return response({ success: false, error: 'TURN derzeit nicht verfuegbar' }, 503, origin);
    }
    if (usage >= monthlyLimitBytes(env)) {
      console.error('TURN-Kostenbremse: Monatslimit erreicht, Bytes:', usage);
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
      console.error('TURN-API Fehler, Status:', responseCf.status);
      return response({ success: false, error: 'TURN-Dienst nicht erreichbar' }, 502, origin);
    }
    const payload = await responseCf.json();
    return response({ success: true, iceServers: filterIceServers(payload.iceServers) }, 200, origin);
  } catch (err) {
    console.error('TURN-Anfrage fehlgeschlagen:', err && err.message);
    return response({ success: false, error: 'TURN-Dienst nicht erreichbar' }, 502, origin);
  }
}
