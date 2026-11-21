// Statische Regeln fuer Test- und Spielcode (lesen nur Dateien, kein Browser)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const TESTS = __dirname;
const tally = (text, pattern) => (text.match(pattern) || []).length;

// Echtzeit-Wartezeiten machen Tests unter Last wackelig (3e8c59b, 1d732ba, bad758c).
// Stattdessen simulationsSchritt() in einem evaluate oder die Fake-Uhr aus helpers.js nutzen.
// Bestand je Datei; er darf nur sinken. Nach dem Abbau den Wert hier senken.
const REAL_TIME_BASELINE = {
  'game.spec.js': 45,
  'gleve.spec.js': 1,
  'hacker.spec.js': 9,
  'menu.spec.js': 1,
  'screenshot.spec.js': 3,
};

test('keine neuen Echtzeit-Wartezeiten in Tests (waitForTimeout, setTimeout-Promise)', () => {
  const tooMuch = [];
  for (const file of fs.readdirSync(TESTS).filter(d => d.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(TESTS, file), 'utf8');
    const count = tally(text, /waitForTimeout\(/g) + tally(text, /new Promise\(\s*\w+\s*=>\s*setTimeout\(/g);
    const allowed = REAL_TIME_BASELINE[file] || 0;
    if (count > allowed) tooMuch.push(`${file}: ${count} statt hoechstens ${allowed}`);
  }
  expect(tooMuch, 'Echtzeit-Wartezeit durch simulationsSchritt() oder Fake-Uhr ersetzen').toEqual([]);
});

// Modulzustand ueberlebt restartGame(), wenn ihn niemand zuruecksetzt (642b082: aktuellesThema in level.js,
// vorher afd5d90, 5522e68, b6a55cb). Jede Modulvariable (let auf oberster Ebene) steht hier mit ihrem Reset
// oder dem Grund, warum sie einen Neustart ueberleben darf.
const MODULE_STATUS = {
  'display.js': { lets: ['backend'], reason: 'Anzeige-Backend gilt fuer die ganze Sitzung' },
  'audio.js': {
    lets: ['audioCtx', 'masterGain', 'isMuted', 'sharedNoiseBuffer'],
    reason: 'Audio-Kontext und Stummschaltung gelten fuer die ganze Sitzung',
  },
  'bot.js': {
    lets: [
      'reactionCounter',
      'lastDecision',
      'gleveDashLock',
      'sniperMode',
      'sniperHoldTime',
      'sniperTapRest',
      'sniperTapPause',
      'sniperMineStop',
      'sniperMineSteps',
    ],
    reason: 'Bot.resetBot() in restartGame',
  },
  'client.js': { lets: ['stepsSinceSnapshot'], reason: 'jeder Snapshot setzt ihn auf 0' },
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
    reason: 'eigene Lebensdauer: startCutscene/Ende der Cutszene raeumen auf',
  },
  'entities.js': {
    lets: ['idCounter', 'nextCoopLootOwner'],
    reason: 'IDs bleiben ueber die Sitzung eindeutig; Beute-Wechsel im Co-op, Startwert egal',
  },
  'rock.js': { lets: ['last', 'queue', 'speed'], reason: 'Fels.setzeZurueck() in restartGame' },
  'island-boss.js': { lets: ['boss'], reason: 'Inselboss.setzeZurueck() in restartGame' },
  'level.js': { lets: ['currentTheme'], reason: 'Level.setzeThemaZurueck() in restartGame' },
  'loop.js': {
    lets: ['worldStep', 'lastTimestamp', 'timeAccountMs'],
    reason: 'Taktgeber der Spielschleife, laeuft ueber Neustarts weiter',
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
      'keyframeWaitCounter',
      'helloTimer',
      'turnWarningIssued',
      'connectionTimer',
      'connectionStart',
      'connectionText',
      'lastHudSignatureP1',
      'lastHudSignatureP2',
      'lastSplitterSignatureP1',
      'lastSplitterSignatureP2',
    ],
    reason: 'Verbindung und Sync haben eigene Lebensdauer (Raum betreten/verlassen)',
  },
  'pause.js': { lets: ['hintUntil', 'queryOpen'], reason: 'Pause-Anzeige, jede Pause setzt sie neu' },
  'sniper.js': { lets: ['grenadeId', 'mineId'], reason: 'IDs bleiben ueber die Sitzung eindeutig' },
  'utils.js': {
    lets: ['prevLives', 'prevPuState', 'prevLivesP2', 'prevPuStateP2', 'prevLauncherStatesP1', 'prevLauncherStatesP2'],
    reason: 'HUD-Vergleichswerte, die naechste Anzeige gleicht sie an',
  },
};

test('jede Modulvariable in src/js hat einen Reset bei restartGame oder einen Grund (MODUL_ZUSTAND)', () => {
  const folder = path.join(TESTS, '..', 'src', 'js');
  const is = {};
  for (const file of fs.readdirSync(folder).filter(d => d.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(folder, file), 'utf8');
    const lets = [...text.matchAll(/^(?:export )?let ([A-Za-z_$][\w$]*)/gm)].map(t => t[1]);
    if (lets.length) is[file] = lets;
  }
  const should = Object.fromEntries(Object.entries(MODULE_STATUS).map(([file, e]) => [file, e.lets]));
  expect(
    is,
    'Neue Modulvariable: in restartGame (utils.js) zuruecksetzen und in MODUL_ZUSTAND eintragen, oder dort begruenden',
  ).toEqual(should);
});
