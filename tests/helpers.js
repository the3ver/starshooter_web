// Gemeinsame Testhelfer (kein Spec, wird von Playwright nicht als Test geladen)
const fs = require('fs');
const path = require('path');

// Aktuelle Spielversion direkt aus dem Spielcode lesen, damit Tests bei einem Release nicht angepasst werden muessen.
// changelog.js ist ein ES-Modul im Browser-Quelltext, deshalb hier per Regex statt require.
const CHANGELOG_FILE_PATH = path.join(__dirname, '..', 'src', 'js', 'changelog.js');
const hit = /export\s+const\s+GAME_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(fs.readFileSync(CHANGELOG_FILE_PATH, 'utf8'));
if (!hit) throw new Error(`GAME_VERSION nicht in ${CHANGELOG_FILE_PATH} gefunden`);
const GAME_VERSION = hit[1];

// Markiert die aktuelle Version als gesehen (kein "Was gibt's Neues"-Dialog) und ueberspringt
// standardmaessig die Intro-Cutszene. Gilt fuer alle folgenden Seitenaufrufe dieser Seite.
async function setGameState(page, { skipCutscene = true } = {}) {
  await page.addInitScript(
    ({ version, skip }) => {
      localStorage.setItem('starshooter_last_seen_version', version);
      if (skip) localStorage.setItem('starshooter_skip_cutscene', 'true');
    },
    { version: GAME_VERSION, skip: skipCutscene },
  );
}

// Startet das Spiel per Tastendruck. Die Taste bleibt gedrueckt, bis der Game-Loop den Start
// verarbeitet hat (Spiel laeuft oder Intro-Cutszene aktiv). Feste 50 ms koennen unter Last zu kurz sein.
async function startGame(page, key = 'w') {
  await page.keyboard.down(key);
  await page.waitForFunction(() => window.__game.state.gameRunning || window.__game.state.cutsceneActive);
  await page.keyboard.up(key);
}

// Fake-Uhr fuer zeitabhaengige Tests (Cutszene, Verbindungs-Timer):
// installiereUhr vor page.goto, haltUhrAn nach dem Laden. Danach vergeht Seitenzeit nur noch
// per page.clock.fastForward/runFor, unabhaengig von Rechnerlast und Echtzeit.
const CLOCK_START = new Date('2026-01-01T12:00:00Z').getTime();
async function installClock(page) {
  await page.clock.install({ time: CLOCK_START });
}
async function pauseClock(page) {
  // Bis hierhin laeuft die Fake-Uhr in Echtzeit ab UHR_START; 60 s Vorlauf reichen fuer jedes Laden
  await page.clock.pauseAt(CLOCK_START + 60_000);
}
// Spult in kleinen Schritten vor, damit requestAnimationFrame-Animationen zwischendurch laufen
async function advanceClock(page, ms, step = 250) {
  for (let t = 0; t < ms; t += step) await page.clock.fastForward(Math.min(step, ms - t));
}
// Spult in Schritten vor, bis bedingung() (im Test, async) wahr ist; hoechstens bisMs Seitenzeit.
// Liefert die vergangene Seitenzeit oder wirft, wenn die Bedingung nicht eintritt.
async function windUntil(page, condition, untilMs, step = 250) {
  for (let t = 0; t <= untilMs; t += step) {
    if (await condition()) return t;
    await page.clock.fastForward(step);
  }
  throw new Error(`Bedingung nicht innerhalb von ${untilMs} ms Seitenzeit erfuellt`);
}

module.exports = { GAME_VERSION, setGameState, startGame, installClock, pauseClock, advanceClock, windUntil };
