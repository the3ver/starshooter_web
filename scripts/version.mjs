// Setzt die Spielversion an allen Stellen: node scripts/version.mjs 1.15.6
// package.json und package-lock.json (npm version), src/index.html, README-Badge, GAME_VERSION
// und ein Geruest fuer den changelogData-Eintrag. tests/version.spec.js prueft, dass alle Stellen gleich sind.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Aufruf: node scripts/version.mjs X.Y.Z');
  process.exit(1);
}

function ersetze(datei, muster, ersatz) {
  const alt = readFileSync(datei, 'utf8');
  const neu = alt.replace(muster, ersatz);
  if (neu === alt && !alt.includes(version)) throw new Error(`Versionsstelle in ${datei} nicht gefunden`);
  writeFileSync(datei, neu);
}

execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, { stdio: 'ignore' });
ersetze('src/index.html', /(<div id="version-anzeige">V )[\d.]+(<\/div>)/, `$1${version}$2`);
ersetze('README.md', /(badge\/version-)[\d.]+(-blue)/, `$1${version}$2`);
ersetze('src/js/changelog.js', /(export const GAME_VERSION = ')[\d.]+(')/, `$1${version}$2`);

const changelog = readFileSync('src/js/changelog.js', 'utf8');
if (!changelog.includes(`'${version}': {`)) {
  const zeilenende = changelog.includes('\r\n') ? '\r\n' : '\n';
  const eintrag = [
    `  '${version}': {`,
    `    version: '${version}',`,
    `    intro: 'Hey, es ist jetzt Version ${version} rausgekommen, folgendes wurde aktualisiert:',`,
    `    highlights: [`,
    `      'TODO'`,
    `    ]`,
    `  },`,
  ].join(zeilenende);
  writeFileSync(
    'src/js/changelog.js',
    changelog.replace(
      `export const changelogData = {${zeilenende}`,
      `export const changelogData = {${zeilenende}${eintrag}${zeilenende}`,
    ),
  );
  console.log(`Version ${version} gesetzt, Highlights in src/js/changelog.js eintragen (TODO)`);
} else {
  console.log(`Version ${version} gesetzt`);
}
