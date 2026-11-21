const { defineConfig, devices } = require('@playwright/test');
const server = require('./webserver.config');

// Balancing-Messstand: laeuft nur ueber 'npm run balancing', nie in 'npm test' oder CI
// (playwright.config.js testet ausschliesslich ./tests).
module.exports = defineConfig({
  testDir: './balancing',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 300_000,
  reporter: 'list',
  use: {
    baseURL: server.baseURL,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: server.webServer,
});
