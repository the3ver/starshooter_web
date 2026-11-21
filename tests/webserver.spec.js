// Testserver-Port je Arbeitsbaum (webserver.config.js): zwei Klone auf einem Rechner teilen sich keinen Server
const { test, expect } = require('@playwright/test');
const { portFor } = require('../webserver.config');

test('Port haengt vom Arbeitsbaum ab und bleibt je Pfad gleich', () => {
  const a = portFor('/home/dev/repos/starshooter-web', {});
  const b = portFor('/tmp/scratch/om', {});
  expect(a).not.toBe(b);
  expect(portFor('/home/dev/repos/starshooter-web', {})).toBe(a);
  for (const port of [a, b]) {
    expect(port).toBeGreaterThanOrEqual(8100);
    expect(port).toBeLessThanOrEqual(8999);
  }
});

test('PORT ueberschreibt den Port aus dem Pfad', () => {
  expect(portFor('/beliebig', { PORT: '9123' })).toBe(9123);
});
