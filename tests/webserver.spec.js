// Test server port per working tree (webserver.config.js): two clones on one machine never share a server
const { test, expect } = require('@playwright/test');
const { portFor } = require('../webserver.config');

test('port depends on the working tree and is stable per path', () => {
  const a = portFor('/home/dev/repos/starshooter-web', {});
  const b = portFor('/tmp/scratch/om', {});
  expect(a).not.toBe(b);
  expect(portFor('/home/dev/repos/starshooter-web', {})).toBe(a);
  for (const port of [a, b]) {
    expect(port).toBeGreaterThanOrEqual(8100);
    expect(port).toBeLessThanOrEqual(8999);
  }
});

test('PORT overrides the port derived from the path', () => {
  expect(portFor('/beliebig', { PORT: '9123' })).toBe(9123);
});
