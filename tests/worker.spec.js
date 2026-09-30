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
