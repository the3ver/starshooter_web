// Statische Regeln fuer Test- und Spielcode (lesen nur Dateien, kein Browser)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const TESTS = __dirname;
const zaehle = (text, muster) => (text.match(muster) || []).length;

// Echtzeit-Wartezeiten machen Tests unter Last wackelig (3e8c59b, 1d732ba, bad758c).
// Stattdessen simulationsSchritt() in einem evaluate oder die Fake-Uhr aus helfer.js nutzen.
// Bestand je Datei; er darf nur sinken. Nach dem Abbau den Wert hier senken.
const ECHTZEIT_BESTAND = {
  'game.spec.js': 45,
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

// Modulzustand ueberlebt restartGame(), wenn ihn niemand zuruecksetzt (642b082: aktuellesThema in level.js,
// vorher afd5d90, 5522e68, b6a55cb). Jede Modulvariable (let auf oberster Ebene) steht hier mit ihrem Reset
// oder dem Grund, warum sie einen Neustart ueberleben darf.
const MODUL_ZUSTAND = {
  'anzeige.js': { lets: ['backend'], grund: 'Anzeige-Backend gilt fuer die ganze Sitzung' },
  'audio.js': {
    lets: ['audioCtx', 'masterGain', 'isMuted', 'sharedNoiseBuffer'],
    grund: 'Audio-Kontext und Stummschaltung gelten fuer die ganze Sitzung',
  },
  'bot.js': {
    lets: [
      'reactionCounter',
      'lastDecision',
      'gleveDashSperre',
      'sniperModus',
      'sniperHaltedauer',
      'sniperTippRest',
      'sniperTippPause',
      'sniperMinenHalt',
      'sniperMinenSchritte',
    ],
    grund: 'Bot.resetBot() in restartGame',
  },
  'client.js': { lets: ['schritteSeitSnapshot'], grund: 'jeder Snapshot setzt ihn auf 0' },
  'cutscene.js': {
    lets: [
      'cutsceneContainer',
      'cutsceneAnimationId',
      'cutsceneTimeouts',
      'cutsceneIntervals',
      'cutsceneDebrisArray',
      'cutsceneActive',
      'onCompleteCallback',
    ],
    grund: 'eigene Lebensdauer: startCutscene/Ende der Cutszene raeumen auf',
  },
  'entities.js': {
    lets: ['idZaehler', 'nextCoopLootOwner'],
    grund: 'IDs bleiben ueber die Sitzung eindeutig; Beute-Wechsel im Co-op, Startwert egal',
  },
  'fels.js': { lets: ['letzter', 'warteschlange', 'tempo'], grund: 'Fels.setzeZurueck() in restartGame' },
  'inselboss.js': { lets: ['boss'], grund: 'Inselboss.setzeZurueck() in restartGame' },
  'level.js': { lets: ['aktuellesThema'], grund: 'Level.setzeThemaZurueck() in restartGame' },
  'loop.js': {
    lets: ['weltSchritt', 'letzterZeitstempel', 'zeitKontoMs'],
    grund: 'Taktgeber der Spielschleife, laeuft ueber Neustarts weiter',
  },
  'network.js': {
    lets: [
      'room',
      'sendStateAction',
      'sendInputAction',
      'sendEventAction',
      'onStateCallbacks',
      'onInputCallbacks',
      'onEventCallbacks',
      'trysteroJoinRoom',
      'keyframeWarteZaehler',
      'halloTimer',
      'turnWarnungAusgegeben',
      'verbindungsTimer',
      'verbindungsStart',
      'verbindungsText',
      'letzteHudSignaturP1',
      'letzteHudSignaturP2',
      'letzteSplitterSignaturP1',
      'letzteSplitterSignaturP2',
    ],
    grund: 'Verbindung und Sync haben eigene Lebensdauer (Raum betreten/verlassen)',
  },
  'pause.js': { lets: ['hinweisBis', 'abfrageOffen'], grund: 'Pause-Anzeige, jede Pause setzt sie neu' },
  'sniper.js': { lets: ['granatenId', 'minenId'], grund: 'IDs bleiben ueber die Sitzung eindeutig' },
  'utils.js': {
    lets: ['prevLeben', 'prevPuState', 'prevLebenP2', 'prevPuStateP2', 'prevWerferStatesP1', 'prevWerferStatesP2'],
    grund: 'HUD-Vergleichswerte, die naechste Anzeige gleicht sie an',
  },
};

test('jede Modulvariable in src/js hat einen Reset bei restartGame oder einen Grund (MODUL_ZUSTAND)', () => {
  const ordner = path.join(TESTS, '..', 'src', 'js');
  const ist = {};
  for (const datei of fs.readdirSync(ordner).filter(d => d.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(ordner, datei), 'utf8');
    const lets = [...text.matchAll(/^(?:export )?let ([A-Za-z_$][\w$]*)/gm)].map(t => t[1]);
    if (lets.length) ist[datei] = lets;
  }
  const soll = Object.fromEntries(Object.entries(MODUL_ZUSTAND).map(([datei, e]) => [datei, e.lets]));
  expect(
    ist,
    'Neue Modulvariable: in restartGame (utils.js) zuruecksetzen und in MODUL_ZUSTAND eintragen, oder dort begruenden',
  ).toEqual(soll);
});
