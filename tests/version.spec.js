// Alle Versionsstellen stimmen ueberein (gesetzt von scripts/version.mjs)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const lies = (datei) => fs.readFileSync(path.join(__dirname, '..', datei), 'utf8');
const finde = (datei, muster) => {
  const treffer = muster.exec(lies(datei));
  if (!treffer) throw new Error(`Versionsstelle in ${datei} nicht gefunden`);
  return treffer[1];
};

test('Version ist an allen Stellen gleich', () => {
  const version = JSON.parse(lies('package.json')).version;
  const lock = JSON.parse(lies('package-lock.json'));
  const stellen = {
    'package-lock.json': lock.version,
    'package-lock.json (packages[""])': lock.packages[''].version,
    'src/index.html': finde('src/index.html', /<div id="version-anzeige">V ([\d.]+)<\/div>/),
    'README.md': finde('README.md', /badge\/version-([\d.]+)-blue/),
    'GAME_VERSION': finde('src/js/changelog.js', /export const GAME_VERSION = '([\d.]+)'/),
  };
  for (const [stelle, wert] of Object.entries(stellen)) {
    expect(wert, `${stelle} weicht von package.json ab`).toBe(version);
  }
  expect(lies('src/js/changelog.js'), 'changelogData-Eintrag fehlt').toContain(`'${version}': {`);
  expect(lies('src/js/changelog.js'), 'Highlights im Changelog ausfuellen').not.toMatch(/'TODO'/);
});
