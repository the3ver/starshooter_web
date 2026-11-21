const { defineConfig, devices } = require('@playwright/test');
const server = require('./webserver.config');

module.exports = defineConfig({
  testDir: './tests',
  // The README screenshot is not a test and must not overwrite docs/gameplay.png on every run:
  // only via 'npm run screenshot' (playwright.screenshot.config.js)
  testIgnore: ['**/screenshot.spec.js'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // CI: 2 workers (runner with 4 vCPU); the weekly flake hunt uses the same number
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: server.baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: server.webServer,
});
