// Alle Versionsstellen stimmen ueberein (gesetzt von scripts/version.mjs)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const find = (file, pattern) => {
  const hit = pattern.exec(read(file));
  if (!hit) throw new Error(`Versionsstelle in ${file} nicht gefunden`);
  return hit[1];
};

test('Version ist an allen Stellen gleich', () => {
  const version = JSON.parse(read('package.json')).version;
  const lock = JSON.parse(read('package-lock.json'));
  const places = {
    'package-lock.json': lock.version,
    'package-lock.json (packages[""])': lock.packages[''].version,
    'src/index.html': find('src/index.html', /<div id="version-anzeige">V ([\d.]+)<\/div>/),
    'README.md': find('README.md', /badge\/version-([\d.]+)-blue/),
    GAME_VERSION: find('src/js/changelog.js', /export const GAME_VERSION = '([\d.]+)'/),
  };
  for (const [place, value] of Object.entries(places)) {
    expect(value, `${place} weicht von package.json ab`).toBe(version);
  }
  expect(read('src/js/changelog.js'), 'changelogData-Eintrag fehlt').toContain(`'${version}': {`);
  expect(read('src/js/changelog.js'), 'Highlights im Changelog ausfuellen').not.toMatch(/'TODO'/);
});
