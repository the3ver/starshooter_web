const { defineConfig, devices } = require('@playwright/test');
const server = require('./webserver.config');

module.exports = defineConfig({
  testDir: './tests',
  // Der README-Screenshot ist kein Test und soll docs/gameplay.png nicht bei jedem Lauf ueberschreiben:
  // nur ueber 'npm run screenshot' (playwright.screenshot.config.js)
  testIgnore: ['**/screenshot.spec.js'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // CI: 2 Worker (Runner mit 4 vCPU); die woechentliche Flake-Suche laeuft mit derselben Zahl
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
