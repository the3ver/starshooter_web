// Only for 'npm run screenshot': creates docs/gameplay.png for the README (not a test, does not run in 'npm test'/CI)
const { defineConfig } = require('@playwright/test');
const basis = require('./playwright.config');

module.exports = defineConfig({
  ...basis,
  testIgnore: [],
  testMatch: ['**/screenshot.spec.js'],
  retries: 0,
  reporter: [['list']],
});
