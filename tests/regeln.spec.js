// Statische Regeln fuer den Testcode (lesen nur Dateien, kein Browser)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const TESTS = __dirname;
const zaehle = (text, muster) => (text.match(muster) || []).length;

// Echtzeit-Wartezeiten machen Tests unter Last wackelig (3e8c59b, 1d732ba, bad758c).
// Stattdessen simulationsSchritt() in einem evaluate oder die Fake-Uhr aus helfer.js nutzen.
// Bestand je Datei; er darf nur sinken. Nach dem Abbau den Wert hier senken.
const ECHTZEIT_BESTAND = {
  'game.spec.js': 47,
  'gleve.spec.js': 1,
  'hacker.spec.js': 9,
  'menue.spec.js': 1,
  'screenshot.spec.js': 3,
};

test('keine neuen Echtzeit-Wartezeiten in Tests (waitForTimeout, setTimeout-Promise)', () => {
  const zuViel = [];
  for (const datei of fs.readdirSync(TESTS).filter(d => d.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(TESTS, datei), 'utf8');
    const anzahl = zaehle(text, /waitForTimeout\(/g) + zaehle(text, /new Promise\(\s*\w+\s*=>\s*setTimeout\(/g);
    const erlaubt = ECHTZEIT_BESTAND[datei] || 0;
    if (anzahl > erlaubt) zuViel.push(`${datei}: ${anzahl} statt hoechstens ${erlaubt}`);
  }
  expect(zuViel, 'Echtzeit-Wartezeit durch simulationsSchritt() oder Fake-Uhr ersetzen').toEqual([]);
});
