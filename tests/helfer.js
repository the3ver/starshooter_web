// Gemeinsame Testhelfer (kein Spec, wird von Playwright nicht als Test geladen)
const fs = require('fs');
const path = require('path');

// Aktuelle Spielversion direkt aus dem Spielcode lesen, damit Tests bei einem Release nicht angepasst werden muessen.
// changelog.js ist ein ES-Modul im Browser-Quelltext, deshalb hier per Regex statt require.
const CHANGELOG_PFAD = path.join(__dirname, '..', 'src', 'js', 'changelog.js');
const treffer = /export\s+const\s+GAME_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(fs.readFileSync(CHANGELOG_PFAD, 'utf8'));
if (!treffer) throw new Error(`GAME_VERSION nicht in ${CHANGELOG_PFAD} gefunden`);
const GAME_VERSION = treffer[1];

// Markiert die aktuelle Version als gesehen (kein "Was gibt's Neues"-Dialog) und ueberspringt
// standardmaessig die Intro-Cutszene. Gilt fuer alle folgenden Seitenaufrufe dieser Seite.
async function setzeSpielstand(page, { skipCutscene = true } = {}) {
  await page.addInitScript(({ version, skip }) => {
    localStorage.setItem('starshooter_last_seen_version', version);
    if (skip) localStorage.setItem('starshooter_skip_cutscene', 'true');
  }, { version: GAME_VERSION, skip: skipCutscene });
}

module.exports = { GAME_VERSION, setzeSpielstand };
