// Pure validation logic for the highscore worker (no Cloudflare dependencies, therefore testable)

// Profanity filter (simple block list for 3-letter tags and common terms)
export const FORBIDDEN_WORDS = [
  'ASS',
  'FUK',
  'FCK',
  'NAZ',
  'SS',
  'KKK',
  'SEX',
  'DIC',
  'DIK',
  'COK',
  'NIG',
  'HIT',
  'WTF',
  'SHI',
];

// Bereinigt einen Spielernamen: trimmen, Grossbuchstaben, max. 10 Zeichen, Zeichen pruefen, Profanity-Filter
export function cleanName(name) {
  name = (name || '').trim().toUpperCase().slice(0, 10);
  if (!name || !/^[A-Z0-9+_-]{1,10}$/.test(name)) {
    return { ok: false, name: '', error: 'Ungültiger Spielername (nur A-Z, 0-9, max. 10 Zeichen)' };
  }

  // Check each part separately, otherwise replace() hits the first match in the whole name
  name = name
    .split('+')
    .map(part => (FORBIDDEN_WORDS.includes(part) ? '***' : part))
    .join('+');
  return { ok: true, name, error: null };
}
