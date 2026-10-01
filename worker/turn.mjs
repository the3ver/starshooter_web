// Reine TURN-Logik fuer den Worker (ohne Cloudflare-Laufzeit, daher testbar)

export const TURN_TTL_SEKUNDEN = 14400; // 4 Stunden
export const TURN_MAX_ANFRAGEN_PRO_STUNDE = 20;
const TURN_API_BASIS = 'https://rtc.live.cloudflare.com/v1/turn/keys';

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

// GET /api/turn: holt kurzlebige TURN-Zugangsdaten bei Cloudflare
export async function behandleTurnAnfrage(request, env, fetchFn = fetch, cache = null) {
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
