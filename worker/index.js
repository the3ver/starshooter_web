// Starshooter Highscores Cloudflare Worker API
import { bereinigeName } from './validierung.mjs';
import { behandleTurnAnfrage } from './turn.mjs';

const SECRET_SALT = 'st4r-sh00t3r-s3cr3t-k3y-2026';
const VALID_MODES = ['single', 'coop_bot', 'online'];
const VALID_SHIPS = ['viper', 'phantom', 'gleve', 'sniper'];

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Score-Hash',
    'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
        }
    });
}

// SHA-256 Helper via Web Crypto
async function sha256(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Preflight OPTIONS Request
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders
            });
        }

        // --- GET /api/turn (Cloudflare TURN Zugangsdaten, Rate-Limit ueber Cache API) ---
        if (request.method === 'GET' && url.pathname === '/api/turn') {
            const cache = typeof caches !== 'undefined' ? caches.default : null;
            return behandleTurnAnfrage(request, env, fetch, cache);
        }

        // --- GET /api/highscores ---
        if (request.method === 'GET' && url.pathname === '/api/highscores') {
            const mode = url.searchParams.get('mode') || 'single';
            const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10), 1), 50);

            if (!VALID_MODES.includes(mode)) {
                return jsonResponse({ success: false, error: 'Ungültiger Spielmodus' }, 400);
            }

            try {
                const db = env.starshooter_db || env.DB;
                if (!db) {
                    // Fallback wenn DB nicht gebunden (z.B. Mock-Modus)
                    return jsonResponse({
                        success: true,
                        mode,
                        highscores: []
                    });
                }

                const { results } = await db.prepare(
                    `SELECT id, mode, name, score, level, ship_p1 as shipP1, ship_p2 as shipP2, country, city, created_at as createdAt 
                     FROM highscores 
                     WHERE mode = ? 
                     ORDER BY score DESC, created_at ASC 
                     LIMIT ?`
                ).bind(mode, limit).all();

                return jsonResponse({
                    success: true,
                    mode,
                    highscores: results || []
                });
            } catch (err) {
                console.error('Interner Fehler:', err);
                return jsonResponse({ success: false, error: 'Interner Serverfehler' }, 500);
            }
        }

        // --- POST /api/highscores ---
        if (request.method === 'POST' && url.pathname === '/api/highscores') {
            try {
                const body = await request.json();
                let { mode, name, score, level, shipP1, shipP2, timestamp, hash } = body;

                // 1. Modus validieren
                if (!VALID_MODES.includes(mode)) {
                    return jsonResponse({ success: false, error: 'Ungültiger Spielmodus' }, 400);
                }

                // 2. Name bereinigen & prüfen
                // (inkl. Zeichen-Check und Profanity-Filter, siehe validierung.mjs)
                const nameErgebnis = bereinigeName(name);
                if (!nameErgebnis.ok) {
                    return jsonResponse({ success: false, error: nameErgebnis.fehler }, 400);
                }
                name = nameErgebnis.name;

                // 3. Score & Level Plausibilität
                score = parseInt(score, 10);
                level = parseInt(level, 10) || 1;

                if (isNaN(score) || score <= 0 || score > 2000000) {
                    return jsonResponse({ success: false, error: 'Ungültiger Score-Wert' }, 400);
                }

                if (isNaN(level) || level < 1 || level > 100) {
                    return jsonResponse({ success: false, error: 'Ungültiges Level' }, 400);
                }

                // Plausibilitäts-Limit: Max. 60.000 Punkte pro erreichtem Level + Puffer
                const maxPossibleScore = (level + 1) * 60000 + 10000;
                if (score > maxPossibleScore) {
                    return jsonResponse({ success: false, error: 'Score für erreichtes Level unplausibel' }, 400);
                }

                // 4. Schiffe validieren
                if (!VALID_SHIPS.includes(shipP1)) {
                    shipP1 = 'viper';
                }
                if (shipP2 && !VALID_SHIPS.includes(shipP2)) {
                    shipP2 = 'phantom';
                }

                // 5. Zeitstempel & HMAC-Hash Cheat-Schutz
                timestamp = parseInt(timestamp, 10);
                const now = Date.now();
                if (!timestamp || Math.abs(now - timestamp) > 10 * 60 * 1000) {
                    return jsonResponse({ success: false, error: 'Zeitstempel abgelaufen oder ungültig' }, 400);
                }

                const expectedPayload = `${name}:${score}:${level}:${mode}:${timestamp}:${SECRET_SALT}`;
                const expectedHash = await sha256(expectedPayload);

                if (hash !== expectedHash) {
                    return jsonResponse({ success: false, error: 'Ungültige Signatur (Checksummen-Fehler)' }, 403);
                }

                // 6. Standort über Cloudflare Edge erfassen
                const country = (request.cf && request.cf.country) ? request.cf.country : null;
                const city = (request.cf && request.cf.city) ? request.cf.city : null;

                // Anonymisierter IP-Hash für Rate-Limiting / SPAM-Schutz
                const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
                const ipHash = await sha256(`${clientIp}:${new Date().toISOString().slice(0, 10)}`);

                const db = env.starshooter_db || env.DB;
                if (db) {
                    // Rate-Limit Check: Max 15 Einträge pro Stunde/IP
                    const countCheck = await db.prepare(
                        `SELECT COUNT(*) as cnt FROM highscores WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`
                    ).bind(ipHash).first();

                    if (countCheck && countCheck.cnt >= 15) {
                        return jsonResponse({ success: false, error: 'Zu viele Einträge in kurzer Zeit. Bitte später erneut versuchen.' }, 429);
                    }

                    // In Datenbank einfügen
                    const insertResult = await db.prepare(
                        `INSERT INTO highscores (mode, name, score, level, ship_p1, ship_p2, country, city, ip_hash)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).bind(mode, name, score, level, shipP1, shipP2 || null, country, city, ipHash).run();

                    // Rang ermitteln
                    const rankResult = await db.prepare(
                        `SELECT COUNT(*) + 1 as rank FROM highscores WHERE mode = ? AND score > ?`
                    ).bind(mode, score).first();

                    return jsonResponse({
                        success: true,
                        id: insertResult.meta ? insertResult.meta.last_row_id : null,
                        rank: rankResult ? rankResult.rank : 1,
                        entry: {
                            mode,
                            name,
                            score,
                            level,
                            shipP1,
                            shipP2,
                            country,
                            city
                        }
                    }, 201);
                }

                return jsonResponse({
                    success: true,
                    rank: 1,
                    entry: { mode, name, score, level, shipP1, shipP2, country, city }
                }, 201);
            } catch (err) {
                console.error('Interner Fehler:', err);
                return jsonResponse({ success: false, error: 'Interner Serverfehler' }, 500);
            }
        }

        return jsonResponse({ error: 'Not found' }, 404);
    }
};
