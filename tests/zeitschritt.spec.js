const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.9.0');
    localStorage.setItem('starshooter_skip_cutscene', 'true');
  });
  await page.goto('/');
});

test('berechneSchritte liefert 60 Schritte pro Sekunde bei 144, 60 und 30 Hz', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { berechneSchritte } = await import('./js/loop.js');
    const ergebnisse = {};
    for (const hz of [144, 60, 30]) {
      const delta = 1000 / hz;
      let konto = 0;
      let summe = 0;
      for (let i = 0; i < hz; i++) {
        const e = berechneSchritte(konto, delta);
        konto = e.kontoMs;
        summe += e.schritte;
      }
      ergebnisse[hz] = summe;
    }
    return ergebnisse;
  });
  for (const hz of [144, 60, 30]) {
    expect(Math.abs(r[hz] - 60)).toBeLessThanOrEqual(1);
  }
});

test('berechneSchritte begrenzt grosse Deltas und ignoriert negative', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { berechneSchritte, MAX_SCHRITTE_PRO_FRAME } = await import('./js/loop.js');
    return {
      max: MAX_SCHRITTE_PRO_FRAME,
      gross: berechneSchritte(0, 5000),
      negativ: berechneSchritte(0, -100),
      nan: berechneSchritte(0, NaN)
    };
  });
  expect(r.gross.schritte).toBe(r.max);
  expect(r.gross.kontoMs).toBe(0);
  expect(r.negativ.schritte).toBe(0);
  expect(r.nan.schritte).toBe(0);
});

test('simulationsSchritt plant keinen Animation-Frame ein', async ({ page }) => {
  const anzahl = await page.evaluate(async () => {
    const { simulationsSchritt } = await import('./js/loop.js');
    const { state } = await import('./js/state.js');
    const original = window.requestAnimationFrame;
    let zaehler = 0;
    window.requestAnimationFrame = (cb) => { zaehler++; return original(cb); };
    try {
      // Startbildschirm (Frueh-Return-Zweig)
      for (let i = 0; i < 3; i++) simulationsSchritt();
      // Laufendes Spiel (kompletter Schritt bis zum Ende)
      state.spielLaeuft = true;
      state.godMode = true;
      for (let i = 0; i < 3; i++) simulationsSchritt();
      // Pause
      state.pausiert = true;
      simulationsSchritt();
      state.pausiert = false;
    } finally {
      window.requestAnimationFrame = original;
    }
    return zaehler;
  });
  expect(anzahl).toBe(0);
});
