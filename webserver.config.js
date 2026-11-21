// Shared test server for playwright.config.js and playwright.balancing.config.js.
// Port per working tree (8100-8999 from the path), so two clones or worktrees on one machine
// never test against each other's server (reuseExistingServer). PORT overrides.
const { createHash } = require('node:crypto');

function portFor(directory, env = process.env) {
  if (env.PORT) return Number(env.PORT);
  return 8100 + (createHash('sha1').update(directory).digest().readUInt32BE(0) % 900);
}

const PORT = portFor(__dirname);
const url = `http://localhost:${PORT}`;

module.exports = {
  portFor,
  baseURL: url,
  webServer: {
    command: `npx http-server src -p ${PORT} -c-1`,
    url,
    reuseExistingServer: true,
  },
};
