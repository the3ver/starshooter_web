// Static rules for test and game code (read files only, no browser)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const TESTS = __dirname;
const tally = (text, pattern) => (text.match(pattern) || []).length;

// Real-time waits make tests flaky under load (3e8c59b, 1d732ba, bad758c).
// Use simulationStep() inside an evaluate or the fake clock from helpers.js instead.
// Baseline per file; it may only go down. Lower the value here after removing waits.
const REAL_TIME_BASELINE = {
  'game.spec.js': 45,
  'gleve.spec.js': 1,
  'hacker.spec.js': 9,
  'menu.spec.js': 1,
  'screenshot.spec.js': 3,
};

test('no new real-time waits in tests (waitForTimeout, setTimeout promise)', () => {
  const tooMuch = [];
  for (const file of fs.readdirSync(TESTS).filter(d => d.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(TESTS, file), 'utf8');
    const count = tally(text, /waitForTimeout\(/g) + tally(text, /new Promise\(\s*\w+\s*=>\s*setTimeout\(/g);
    const allowed = REAL_TIME_BASELINE[file] || 0;
    if (count > allowed) tooMuch.push(`${file}: ${count} statt hoechstens ${allowed}`);
  }
  expect(tooMuch, 'replace the real-time wait with simulationStep() or the fake clock').toEqual([]);
});

// Module state survives restartGame() if nobody resets it (642b082: currentTheme in level.js,
// before that afd5d90, 5522e68, b6a55cb). Every module variable (top-level let) is listed here with its reset
// or the reason why it may survive a restart.
const MODULE_STATUS = {
  'display.js': { lets: ['backend'], reason: 'the display backend applies for the whole session' },
  'audio.js': {
    lets: ['audioCtx', 'masterGain', 'isMuted', 'sharedNoiseBuffer'],
    reason: 'audio context and mute apply for the whole session',
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
  'client.js': { lets: ['stepsSinceSnapshot'], reason: 'every snapshot sets it to 0' },
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
    reason: 'own lifetime: startCutscene/end of the cutscene clean up',
  },
  'entities.js': {
    lets: ['idCounter', 'nextCoopLootOwner'],
    reason: 'IDs stay unique across the session; loot alternation in co-op, start value irrelevant',
  },
  'rock.js': { lets: ['last', 'queue', 'speed'], reason: 'Rock.reset() in restartGame' },
  'island-boss.js': { lets: ['boss'], reason: 'IslandBoss.reset() in restartGame' },
  'level.js': { lets: ['currentTheme'], reason: 'Level.setzeThemaZurueck() in restartGame' },
  'loop.js': {
    lets: ['worldStep', 'lastTimestamp', 'timeAccountMs'],
    reason: 'clock of the game loop, keeps running across restarts',
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
    reason: 'connection and sync have their own lifetime (join/leave room)',
  },
  'pause.js': { lets: ['hintUntil', 'queryOpen'], reason: 'pause display, every pause sets it again' },
  'sniper.js': { lets: ['grenadeId', 'mineId'], reason: 'IDs stay unique across the session' },
  'utils.js': {
    lets: ['prevLives', 'prevPuState', 'prevLivesP2', 'prevPuStateP2', 'prevLauncherStatesP1', 'prevLauncherStatesP2'],
    reason: 'HUD comparison values, the next display syncs them',
  },
};

test('every module variable in src/js has a reset in restartGame or a reason (MODULE_STATUS)', () => {
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
    'New module variable: reset it in restartGame (utils.js) and add it to MODULE_STATUS, or give a reason there',
  ).toEqual(should);
});
