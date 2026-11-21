const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await setzeSpielstand(page);
  await page.goto('/');
});

// Tester-Feedback: Treffer durch Asteroiden/Feinde mit sichtbarem Abstand. Die alte Bounding-Box zaehlte leere Ecken mit.
test('Koerperkollision: diagonal Ecke an Ecke ist kein Treffer mehr, mittig ueberlappend schon', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { config } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const s = config.spielerGroesse;
    const spieler = { x: 100, y: 300 };
    const pruefe = (obj, anteil) => Utils.koerperTrifftSpieler(spieler, obj, anteil);
    const A = Utils.ASTEROID_TREFFER_RADIUS;
    const F = Utils.FEIND_TREFFER_RADIUS;
    return {
      // 45er-Asteroid oben links, Boxen ueberlappen um 8 px je Achse (frueher Treffer)
      asteroidEcke: pruefe({ x: spieler.x - 45 + 8, y: spieler.y - 45 + 8, groesse: 45 }, A),
      // Feind schraeg oben rechts, Boxen ueberlappen um 6 px je Achse (frueher Treffer)
      feindEcke: pruefe({ x: spieler.x + s - 6, y: spieler.y - 30 + 6, groesse: 30 }, F),
      // Frontal: Asteroid direkt ueber dem Schiff, 10 px Ueberlappung
      asteroidFrontal: pruefe({ x: spieler.x - 7, y: spieler.y - 45 + 10, groesse: 45 }, A),
      // Deckungsgleich
      feindMitte: pruefe({ x: spieler.x, y: spieler.y, groesse: 30 }, F),
      // Klar getrennt
      weitWeg: pruefe({ x: spieler.x + 80, y: spieler.y, groesse: 45 }, A),
    };
  });
  expect(r.asteroidEcke).toBe(false);
  expect(r.feindEcke).toBe(false);
  expect(r.asteroidFrontal).toBe(true);
  expect(r.feindMitte).toBe(true);
  expect(r.weitWeg).toBe(false);
});

// Grenzfaelle: Trefferradius in Pixeln festgehalten (Schiff 30 px, Asteroid 45 px: 10,8 + 18,9 = 29,7 px;
// Feind 30 px: 10,8 + 12 = 22,8 px). 0,5 px innerhalb = Treffer, 0,5 px ausserhalb = keiner, auch diagonal.
test('Koerperkollision: Trefferradius stimmt auf 0,5 px (gerade und diagonal)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { config } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const s = config.spielerGroesse;
    const spieler = { x: 100, y: 300 };
    const mitte = { x: spieler.x + s / 2, y: spieler.y + s / 2 };
    // Objekt der Groesse g mit Mittelpunktabstand d in Richtung winkel
    const trifft = (g, anteil, d, winkel) =>
      Utils.koerperTrifftSpieler(
        spieler,
        { x: mitte.x + d * Math.cos(winkel) - g / 2, y: mitte.y + d * Math.sin(winkel) - g / 2, groesse: g },
        anteil,
      );
    const faelle = {};
    for (const [name, g, anteil, radius] of [
      ['asteroid', 45, Utils.ASTEROID_TREFFER_RADIUS, 29.7],
      ['feind', 30, Utils.FEIND_TREFFER_RADIUS, 22.8],
    ]) {
      for (const [richtung, winkel] of [
        ['gerade', 0],
        ['diagonal', Math.PI / 4],
      ]) {
        faelle[`${name} ${richtung} innen`] = trifft(g, anteil, radius - 0.5, winkel);
        faelle[`${name} ${richtung} aussen`] = trifft(g, anteil, radius + 0.5, winkel);
      }
    }
    return { spielerGroesse: s, faelle };
  });
  expect(r.spielerGroesse).toBe(30);
  for (const [fall, treffer] of Object.entries(r.faelle)) expect(treffer, fall).toBe(fall.endsWith('innen'));
});
