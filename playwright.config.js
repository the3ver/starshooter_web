const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Der README-Screenshot ist kein Test und soll docs/gameplay.png nicht bei jedem Lauf ueberschreiben:
  // nur ueber 'npm run screenshot' (playwright.screenshot.config.js)
  testIgnore: ['**/screenshot.spec.js'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx http-server src -p 8080 -c-1',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
  },
});
