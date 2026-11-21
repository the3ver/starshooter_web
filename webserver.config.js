// Gemeinsamer Testserver fuer playwright.config.js und playwright.balancing.config.js.
// Port je Arbeitsbaum (8100-8999 aus dem Pfad), damit zwei Klone oder Worktrees auf einem Rechner
// nicht gegen den Server des anderen testen (reuseExistingServer). PORT ueberschreibt.
const { createHash } = require('node:crypto');

function portFuer(verzeichnis, env = process.env) {
  if (env.PORT) return Number(env.PORT);
  return 8100 + (createHash('sha1').update(verzeichnis).digest().readUInt32BE(0) % 900);
}

const PORT = portFuer(__dirname);
const url = `http://localhost:${PORT}`;

module.exports = {
  portFuer,
  baseURL: url,
  webServer: {
    command: `npx http-server src -p ${PORT} -c-1`,
    url,
    reuseExistingServer: true,
  },
};
