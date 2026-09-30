// Reine Validierungslogik fuer den Highscore-Worker (ohne Cloudflare-Abhaengigkeiten, daher testbar)

// Schimpfwort-/Profanity-Filter (einfache Sperrliste für 3-Buchstaben-Kürzel & gängige Begriffe)
export const FORBIDDEN_WORDS = ['ASS', 'FUK', 'FCK', 'NAZ', 'SS', 'KKK', 'SEX', 'DIC', 'DIK', 'COK', 'NIG', 'HIT', 'WTF', 'SHI'];

// Bereinigt einen Spielernamen: trimmen, Grossbuchstaben, max. 10 Zeichen, Zeichen pruefen, Profanity-Filter
export function bereinigeName(name) {
    name = (name || '').trim().toUpperCase().slice(0, 10);
    if (!name || !/^[A-Z0-9+_-]{1,10}$/.test(name)) {
        return { ok: false, name: '', fehler: 'Ungültiger Spielername (nur A-Z, 0-9, max. 10 Zeichen)' };
    }

    // Jeden Teil einzeln pruefen, sonst trifft replace() die erste Fundstelle im ganzen Namen
    name = name.split('+').map(part => FORBIDDEN_WORDS.includes(part) ? '***' : part).join('+');
    return { ok: true, name, fehler: null };
}
