const { defineConfig, devices } = require('@playwright/test');

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
    baseURL: 'http://localhost:8080',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx http-server src -p 8080 -c-1',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
  },
});
