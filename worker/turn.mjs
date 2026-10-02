// Reine TURN-Logik fuer den Worker (ohne Cloudflare-Laufzeit, daher testbar)

export const TURN_TTL_SEKUNDEN = 7200; // 2 Stunden: begrenzt Nachlauf nach Erreichen des Monatslimits
export const TURN_MAX_ANFRAGEN_PRO_STUNDE = 20;
// Kostenbremse: 1.000 GB Egress pro Monat sind frei; ab diesem Verbrauch keine neuen Zugangsdaten
export const TURN_MONATSLIMIT_GB_STANDARD = 800;
export const TURN_VERBRAUCH_CACHE_SEKUNDEN = 600;
const TURN_API_BASIS = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

// Entfernt URLs mit Port 53 (Browser blockieren ihn; Port 5349 bleibt erhalten) und verwirft Eintraege ohne URLs
export function filtereIceServers(iceServers) {
    if (!Array.isArray(iceServers)) return [];
    const ergebnis = [];
    for (const eintrag of iceServers) {
        if (!eintrag || !eintrag.urls) continue;
        const urlListe = Array.isArray(eintrag.urls) ? eintrag.urls : [eintrag.urls];
        const erlaubt = urlListe.filter(u => typeof u === 'string' && !/:53(?![0-9])/.test(u));
        if (erlaubt.length === 0) continue;
        ergebnis.push({
            ...eintrag,
            urls: Array.isArray(eintrag.urls) ? erlaubt : erlaubt[0]
        });
    }
    return ergebnis;
}

// Erlaubt GitHub Pages und lokale Entwicklung (beliebiger Port)
export function istErlaubteHerkunft(origin) {
    if (typeof origin !== 'string' || !origin) return false;
    if (origin === 'https://the3ver.github.io') return true;
    return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

async function sha256(str) {
    const daten = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', daten);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function antwort(daten, status, origin) {
    return new Response(JSON.stringify(daten), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': origin || 'null',
            'Vary': 'Origin'
        }
    });
}

// Rate-Limit ueber die Cache API (pro Rechenzentrum, ohne Schema-Aenderung).
// Zaehler pro IP-Hash, TTL 1 Stunde; nicht atomar, aber als Missbrauchsbremse ausreichend.
async function pruefeRateLimit(request, cache) {
    if (!cache) return true;
    const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    const ipHash = await sha256(`${ip}:${new Date().toISOString().slice(0, 13)}`);
    const schluessel = new Request(`https://turn-limit.invalid/${ipHash}`);
    const treffer = await cache.match(schluessel);
    const anzahl = treffer ? parseInt(await treffer.text(), 10) || 0 : 0;
    if (anzahl >= TURN_MAX_ANFRAGEN_PRO_STUNDE) return false;
    await cache.put(schluessel, new Response(String(anzahl + 1), {
        headers: { 'Cache-Control': 'max-age=3600' }
    }));
    return true;
}

// Monatsgrenzen im Format der GraphQL-API (UTC), z.B. { von: '2026-10-01', bis: '2026-10-02' }
export function monatsZeitraum(jetzt = new Date()) {
    const bis = jetzt.toISOString().slice(0, 10);
    return { von: bis.slice(0, 8) + '01', bis };
}

// Fragt den TURN-Egress des laufenden Monats (Bytes) ueber die Cloudflare-Analytics-API ab. Wirft bei Fehlern.
export async function holeMonatsverbrauchBytes(env, fetchFn = fetch, jetzt = new Date()) {
    const { von, bis } = monatsZeitraum(jetzt);
    const query = `query TurnVerbrauch($konto: string!, $von: Date!, $bis: Date!, $schluessel: string!) {
  viewer {
    accounts(filter: { accountTag: $konto }) {
      callsTurnUsageAdaptiveGroups(filter: { date_geq: $von, date_leq: $bis, keyId: $schluessel }, limit: 1) {
        sum { egressBytes }
      }
    }
  }
}`;
    const antwortApi = await fetchFn(CF_GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.CF_ANALYTICS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            query,
            variables: { konto: env.CF_ACCOUNT_ID, von, bis, schluessel: env.TURN_KEY_ID }
        })
    });
    if (!antwortApi.ok) throw new Error(`Analytics-API Status ${antwortApi.status}`);
    const daten = await antwortApi.json();
    if (daten.errors && daten.errors.length) throw new Error('Analytics-API meldet Fehler');
    const konten = daten.data && daten.data.viewer && daten.data.viewer.accounts;
    if (!Array.isArray(konten) || konten.length === 0) throw new Error('Analytics-API: Konto nicht gefunden');
    const gruppen = konten[0].callsTurnUsageAdaptiveGroups || [];
    // Keine Gruppen = noch kein Verbrauch in diesem Monat
    return gruppen.reduce((summe, g) => summe + ((g.sum && Number(g.sum.egressBytes)) || 0), 0);
}

// Verbrauch mit Zwischenspeicher (pro Rechenzentrum), damit nicht jede Anfrage die Analytics-API trifft
async function monatsverbrauchMitCache(env, fetchFn, cache, jetzt) {
    const schluessel = new Request(`https://turn-verbrauch.invalid/${monatsZeitraum(jetzt).von}`);
    if (cache) {
        const treffer = await cache.match(schluessel);
        if (treffer) {
            const wert = Number(await treffer.text());
            if (Number.isFinite(wert)) return wert;
        }
    }
    const bytes = await holeMonatsverbrauchBytes(env, fetchFn, jetzt);
    if (cache) {
        await cache.put(schluessel, new Response(String(bytes), {
            headers: { 'Cache-Control': `max-age=${TURN_VERBRAUCH_CACHE_SEKUNDEN}` }
        }));
    }
    return bytes;
}

export function monatslimitBytes(env) {
    const gb = Number(env && env.TURN_MONATSLIMIT_GB);
    return (Number.isFinite(gb) && gb > 0 ? gb : TURN_MONATSLIMIT_GB_STANDARD) * 1e9;
}

// GET /api/turn: holt kurzlebige TURN-Zugangsdaten bei Cloudflare
export async function behandleTurnAnfrage(request, env, fetchFn = fetch, cache = null, jetzt = new Date()) {
    const origin = request.headers.get('Origin');
    if (!istErlaubteHerkunft(origin)) {
        return antwort({ success: false, error: 'Herkunft nicht erlaubt' }, 403, null);
    }
    if (!env || !env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
        return antwort({ success: false, error: 'TURN nicht konfiguriert' }, 503, origin);
    }

    try {
        if (!(await pruefeRateLimit(request, cache))) {
            return antwort({ success: false, error: 'Zu viele Anfragen' }, 429, origin);
        }

        // Kostenbremse. Im Zweifel (keine Analytics-Zugangsdaten, API-Fehler) keine Zugangsdaten ausgeben.
        if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) {
            console.error('TURN-Kostenbremse: CF_ANALYTICS_TOKEN oder CF_ACCOUNT_ID fehlt');
            return antwort({ success: false, error: 'TURN derzeit nicht verfuegbar' }, 503, origin);
        }
        let verbrauch;
        try {
            verbrauch = await monatsverbrauchMitCache(env, fetchFn, cache, jetzt);
        } catch (err) {
            console.error('TURN-Kostenbremse: Verbrauch nicht abrufbar:', err && err.message);
            return antwort({ success: false, error: 'TURN derzeit nicht verfuegbar' }, 503, origin);
        }
        if (verbrauch >= monatslimitBytes(env)) {
            console.error('TURN-Kostenbremse: Monatslimit erreicht, Bytes:', verbrauch);
            return antwort({ success: false, error: 'TURN-Monatslimit erreicht' }, 503, origin);
        }

        const antwortCf = await fetchFn(
            `${TURN_API_BASIS}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.TURN_KEY_API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ttl: TURN_TTL_SEKUNDEN })
            }
        );
        if (!antwortCf.ok) {
            console.error('TURN-API Fehler, Status:', antwortCf.status);
            return antwort({ success: false, error: 'TURN-Dienst nicht erreichbar' }, 502, origin);
        }
        const daten = await antwortCf.json();
        return antwort({ success: true, iceServers: filtereIceServers(daten.iceServers) }, 200, origin);
    } catch (err) {
        console.error('TURN-Anfrage fehlgeschlagen:', err && err.message);
        return antwort({ success: false, error: 'TURN-Dienst nicht erreichbar' }, 502, origin);
    }
}
