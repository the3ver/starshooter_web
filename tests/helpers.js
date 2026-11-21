// Shared test helpers (not a spec, Playwright does not load it as a test)
const fs = require('fs');
const path = require('path');

// Read the current game version straight from the game code, so tests need no change on a release.
// changelog.js is an ES module in the browser source, hence a regex here instead of require.
const CHANGELOG_FILE_PATH = path.join(__dirname, '..', 'src', 'js', 'changelog.js');
const hit = /export\s+const\s+GAME_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(fs.readFileSync(CHANGELOG_FILE_PATH, 'utf8'));
if (!hit) throw new Error(`GAME_VERSION not found in ${CHANGELOG_FILE_PATH}`);
const GAME_VERSION = hit[1];

// Marks the current version as seen (no "what's new" dialog) and skips
// the intro cutscene by default. Applies to all following page loads of this page.
async function setGameState(page, { skipCutscene = true } = {}) {
  await page.addInitScript(
    ({ version, skip }) => {
      localStorage.setItem('starshooter_last_seen_version', version);
      if (skip) localStorage.setItem('starshooter_skip_cutscene', 'true');
    },
    { version: GAME_VERSION, skip: skipCutscene },
  );
}

// Starts the game with a key press. The key stays pressed until the game loop has processed
// the start (game running or intro cutscene active). A fixed 50 ms can be too short under load.
async function startGame(page, key = 'w') {
  await page.keyboard.down(key);
  await page.waitForFunction(() => window.__game.state.gameRunning || window.__game.state.cutsceneActive);
  await page.keyboard.up(key);
}

// Fake clock for time-dependent tests (cutscene, connection timers):
// installClock before page.goto, pauseClock after loading. After that, page time only passes
// via page.clock.fastForward/runFor, independent of machine load and real time.
const CLOCK_START = new Date('2026-01-01T12:00:00Z').getTime();
async function installClock(page) {
  await page.clock.install({ time: CLOCK_START });
}
async function pauseClock(page) {
  // Up to here the fake clock runs in real time from CLOCK_START; 60 s lead time is enough for any load
  await page.clock.pauseAt(CLOCK_START + 60_000);
}
// Advances in small steps so requestAnimationFrame animations run in between
async function advanceClock(page, ms, step = 250) {
  for (let t = 0; t < ms; t += step) await page.clock.fastForward(Math.min(step, ms - t));
}
// Advances in steps until condition() (in the test, async) is true; at most untilMs page time.
// Returns the elapsed page time or throws if the condition is not met.
async function windUntil(page, condition, untilMs, step = 250) {
  for (let t = 0; t <= untilMs; t += step) {
    if (await condition()) return t;
    await page.clock.fastForward(step);
  }
  throw new Error(`condition not met within ${untilMs} ms page time`);
}

module.exports = { GAME_VERSION, setGameState, startGame, installClock, pauseClock, advanceClock, windUntil };
