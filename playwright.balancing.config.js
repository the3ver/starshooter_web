const { defineConfig, devices } = require('@playwright/test');
const server = require('./webserver.config');

// Balancing bench: runs only via 'npm run balancing', never in 'npm test' or CI
// (playwright.config.js tests ./tests only).
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
