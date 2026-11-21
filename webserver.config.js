// Gemeinsamer Testserver fuer playwright.config.js und playwright.balancing.config.js
const PORT = 8080;
const url = `http://localhost:${PORT}`;

module.exports = {
  baseURL: url,
  webServer: {
    command: `npx http-server src -p ${PORT} -c-1`,
    url,
    reuseExistingServer: true,
  },
};
