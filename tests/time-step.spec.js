const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await setGameState(page);
  await page.goto('/');
});

test('berechneSchritte liefert 60 Schritte pro Sekunde bei 144, 60 und 30 Hz', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { computeSteps } = await import('./js/loop.js');
    const results = {};
    for (const hz of [144, 60, 30]) {
      const delta = 1000 / hz;
      let account = 0;
      let sum = 0;
      for (let i = 0; i < hz; i++) {
        const e = computeSteps(account, delta);
        account = e.accountMs;
        sum += e.steps;
      }
      results[hz] = sum;
    }
    return results;
  });
  for (const hz of [144, 60, 30]) {
    expect(Math.abs(r[hz] - 60)).toBeLessThanOrEqual(1);
  }
});

test('berechneSchritte begrenzt grosse Deltas und ignoriert negative', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { computeSteps, MAX_STEPS_PRO_FRAME } = await import('./js/loop.js');
    return {
      max: MAX_STEPS_PRO_FRAME,
      big: computeSteps(0, 5000),
      negative: computeSteps(0, -100),
      nan: computeSteps(0, NaN),
    };
  });
  expect(r.big.steps).toBe(r.max);
  expect(r.big.accountMs).toBe(0);
  expect(r.negative.steps).toBe(0);
  expect(r.nan.steps).toBe(0);
});

test('simulationsSchritt plant keinen Animation-Frame ein', async ({ page }) => {
  const count = await page.evaluate(async () => {
    const { simulationStep } = await import('./js/loop.js');
    const { state } = await import('./js/state.js');
    const original = window.requestAnimationFrame;
    let counter = 0;
    window.requestAnimationFrame = cb => {
      counter++;
      return original(cb);
    };
    try {
      // Startbildschirm (Frueh-Return-Zweig)
      for (let i = 0; i < 3; i++) simulationStep();
      // Laufendes Spiel (kompletter Schritt bis zum Ende)
      state.gameRunning = true;
      state.godMode = true;
      for (let i = 0; i < 3; i++) simulationStep();
      // Pause
      state.paused = true;
      simulationStep();
      state.paused = false;
    } finally {
      window.requestAnimationFrame = original;
    }
    return counter;
  });
  expect(count).toBe(0);
});
