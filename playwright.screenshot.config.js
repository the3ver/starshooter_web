// Nur fuer 'npm run screenshot': erzeugt docs/gameplay.png fuer die README (kein Test, laeuft nicht in 'npm test'/CI)
const { defineConfig } = require('@playwright/test');
const basis = require('./playwright.config');

module.exports = defineConfig({
  ...basis,
  testIgnore: [],
  testMatch: ['**/screenshot.spec.js'],
  retries: 0,
  reporter: [['list']],
});
