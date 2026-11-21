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

function replace(file, pattern, replacement) {
  const old = readFileSync(file, 'utf8');
  const fresh = old.replace(pattern, replacement);
  if (fresh === old && !old.includes(version)) throw new Error(`Versionsstelle in ${file} nicht gefunden`);
  writeFileSync(file, fresh);
}

execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, { stdio: 'ignore' });
replace('src/index.html', /(<div id="version-anzeige">V )[\d.]+(<\/div>)/, `$1${version}$2`);
replace('README.md', /(badge\/version-)[\d.]+(-blue)/, `$1${version}$2`);
replace('src/js/changelog.js', /(export const GAME_VERSION = ')[\d.]+(')/, `$1${version}$2`);

const changelog = readFileSync('src/js/changelog.js', 'utf8');
if (!changelog.includes(`'${version}': {`)) {
  const lineEnd = changelog.includes('\r\n') ? '\r\n' : '\n';
  const entry = [
    `  '${version}': {`,
    `    version: '${version}',`,
    `    intro: 'Hey, es ist jetzt Version ${version} rausgekommen, folgendes wurde aktualisiert:',`,
    `    highlights: [`,
    `      'TODO'`,
    `    ]`,
    `  },`,
  ].join(lineEnd);
  writeFileSync(
    'src/js/changelog.js',
    changelog.replace(
      `export const changelogData = {${lineEnd}`,
      `export const changelogData = {${lineEnd}${entry}${lineEnd}`,
    ),
  );
  console.log(`Version ${version} gesetzt, Highlights in src/js/changelog.js eintragen (TODO)`);
} else {
  console.log(`Version ${version} gesetzt`);
}
