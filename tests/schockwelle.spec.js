const { test, expect } = require('@playwright/test');
const { setzeSpielstand, starteSpiel } = require('./helfer');

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
  await starteSpiel(page);
  await page.waitForFunction(() => window.__game.state.spielLaeuft);
  // Feld leeren, Spieler unten links, keine Zufalls-Spawns; Helfer in window.__sw
  await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const Anzeige = await import('./js/anzeige.js');
    for (const name of Object.keys(arrays)) {
      if (name === 'sterne') continue;
      arrays[name].forEach(o => o.el && Anzeige.entferne(o));
      arrays[name].length = 0;
    }
    state.frameZaehler = 1;
    state.x = 0;
    state.y = 560;
    state.godMode = true;
    state.selectedShipModel = 'phantom';
    window.__sw = {
      SW: await import('./js/schockwelle.js'),
      Entities: await import('./js/entities.js'),
      Loop: await import('./js/loop.js'),
      Audio: await import('./js/audio.js'),
      state,
      arrays,
    };
  });
});

test('Ring erfasst Feinde in Reihenfolge der Entfernung, nach WELLEN_DAUER Schritten sind alle weg', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const { SW, Entities, Loop, arrays } = window.__sw;
    Entities.erzeugeFeind(185, 500, 'swoop', 0, false); // nah
    Entities.erzeugeFeind(185, 100, 'swoop', 0, false); // fern
    const [nah, fern] = arrays.feinde;
    nah.vy = fern.vy = 0;
    SW.loeseAus(200, 560, 'p1');
    let nahWeg = -1;
    let fernWeg = -1;
    for (let s = 1; s <= SW.WELLEN_DAUER; s++) {
      Loop.simulationsSchritt();
      if (nahWeg < 0 && !arrays.feinde.includes(nah)) nahWeg = s;
      if (fernWeg < 0 && !arrays.feinde.includes(fern)) fernWeg = s;
    }
    return { nahWeg, fernWeg, rest: arrays.feinde.length };
  });
  expect(r.nahWeg).toBeGreaterThan(0);
  expect(r.fernWeg).toBeGreaterThan(r.nahWeg);
  expect(r.rest).toBe(0);
});

test('Abschuesse zaehlen fuer den Sammler (Punkte), Asteroiden bleiben, Feindgeschosse verschwinden', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const { SW, Entities, Loop, arrays, state } = window.__sw;
    Entities.erzeugeFeind(100, 200, 'swoop', 0, false);
    arrays.feinde[0].vy = 0;
    Entities.erzeugeAsteroid(250, 200, 30, 0, 0, 0, true);
    arrays.asteroiden[0].vy = 0;
    Entities.erzeugeFeindLaser(300, 300);
    const score = state.score;
    SW.loeseAus(200, 300, 'p1');
    for (let s = 0; s < SW.WELLEN_DAUER; s++) Loop.simulationsSchritt();
    return {
      feinde: arrays.feinde.length,
      asteroiden: arrays.asteroiden.length,
      laser: arrays.feindLaserArray.length,
      punkte: state.score - score,
    };
  });
  expect(r).toMatchObject({ feinde: 0, asteroiden: 1, laser: 0 });
  expect(r.punkte).toBeGreaterThanOrEqual(100);
});

test('Boss verliert einmal 15 % der Max-HP und stirbt nicht', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { SW, Entities, Loop, arrays, state } = window.__sw;
    Entities.erzeugeBoss();
    const b = arrays.bosses[0];
    b.y = 50;
    b.vx = b.vy = 0;
    b.phase = 'kampf';
    const voll = b.hp;
    SW.loeseAus(200, 300, 'p1');
    for (let s = 0; s < SW.WELLEN_DAUER; s++) Loop.simulationsSchritt();
    const nachVoll = b.hp;
    // fast tot: bleibt bei 1 HP
    b.hp = 5;
    SW.loeseAus(200, 300, 'p1');
    for (let s = 0; s < SW.WELLEN_DAUER; s++) Loop.simulationsSchritt();
    return {
      verlust: voll - nachVoll,
      erwartet: Math.ceil(b.maxHp * SW.BOSS_SCHADEN_ANTEIL),
      fastTot: b.hp,
      lebt: arrays.bosses.includes(b),
      bossAktiv: state.bossAktiv,
    };
  });
  expect(r.verlust).toBe(r.erwartet);
  expect(r).toMatchObject({ fastTot: 1, lebt: true, bossAktiv: true });
});

test('Einsammeln loest Ring, Blitz und Ton aus (Powerup-Typ schockwelle)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Entities, Loop, Audio, arrays, state } = window.__sw;
    Audio.clearAudioHistory();
    Entities.erzeugePowerup(state.x + 3, state.y + 3, 'schockwelle');
    const p = arrays.powerups[0];
    p.vy = 0;
    for (let s = 0; s < 3 && arrays.powerups.length; s++) Loop.simulationsSchritt();
    const welle = arrays.effekte.find(e => e.art === 'schockwelle');
    return {
      eingesammelt: arrays.powerups.length === 0,
      welle: !!welle,
      owner: welle && welle.owner,
      ring: !!(welle && welle.el && welle.el.classList.contains('schockwelle-ring')),
      ton: Audio.audioHistory.some(h => h.name === 'schockwelle'),
      symbol: p.el.textContent.trim(),
    };
  });
  expect(r).toEqual({ eingesammelt: true, welle: true, owner: 'p1', ring: true, ton: true, symbol: 'Z' });
});

test('Kettenbonus: Schockwelle mit Zufall, hoechstens eine pro Level, nie im Bosskampf', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, state } = window.__sw;
    const K = await import('./js/kette.js');
    const Utils = await import('./js/utils.js');
    const Anzeige = await import('./js/anzeige.js');
    const bonus = (zufall, bossAktiv = false) => {
      arrays.powerups.forEach(Anzeige.entferne);
      arrays.powerups.length = 0;
      state.bossAktiv = bossAktiv;
      K.erzeugeKette('schlange', 2, 1);
      const glieder = arrays.feinde.slice(-2);
      const orig = Math.random;
      Math.random = () => zufall;
      try {
        glieder.forEach(g => Utils.zerstoereZiel(g));
      } finally {
        Math.random = orig;
      }
      state.bossAktiv = false;
      return arrays.powerups.map(p => p.type);
    };
    state.level = 3;
    state.schockwelleLevel = 0;
    const ergebnis = {
      imBoss: bonus(0.1, true),
      ueberChance: bonus(K.SCHOCKWELLE_CHANCE + 0.01),
      ersteImLevel: bonus(0.1),
      zweiteImLevel: bonus(0.1),
    };
    state.level = 4;
    ergebnis.naechstesLevel = bonus(0.1);
    return ergebnis;
  });
  expect(r.imBoss).not.toContain('schockwelle');
  expect(r.ueberChance).not.toContain('schockwelle');
  expect(r.ersteImLevel).toEqual(['schockwelle']);
  expect(r.zweiteImLevel).not.toContain('schockwelle');
  expect(r.naechstesLevel).toEqual(['schockwelle']);
});

test('Neustart setzt die Schockwellen-Sperre zurueck und entfernt laufende Ringe', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { SW, arrays, state } = window.__sw;
    const Utils = await import('./js/utils.js');
    state.schockwelleLevel = 3;
    SW.loeseAus(200, 300, 'p1');
    Utils.restartGame();
    return { sperre: state.schockwelleLevel, ringe: arrays.effekte.filter(e => e.art === 'schockwelle').length };
  });
  expect(r).toEqual({ sperre: 0, ringe: 0 });
});

test('Bot nimmt die Schockwelle erst bei mindestens 4 Zielen im Bild oder kurz vor dem unteren Rand', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { Entities, arrays } = window.__sw;
    const Bot = await import('./js/bot.js');
    Entities.erzeugePowerup(200, 200, 'schockwelle');
    const p = arrays.powerups[0];
    const lohnt = () => Bot.schockwelleLohnt(p);
    const ergebnis = { leer: lohnt() };
    for (let i = 0; i < Bot.SCHOCKWELLE_MIN_ZIELE - 1; i++) Entities.erzeugeFeind(40 * i + 20, 100, 'swoop', 0, false);
    ergebnis.dreiZiele = lohnt();
    Entities.erzeugeFeindLaser(300, 300);
    ergebnis.vierZiele = lohnt();
    arrays.feinde.length = 0;
    arrays.feindLaserArray.length = 0;
    p.y = 700;
    ergebnis.untenRand = lohnt();
    return ergebnis;
  });
  expect(r).toEqual({ leer: false, dreiZiele: false, vierZiele: true, untenRand: true });
});

test('Online: Host sendet das Ereignis, der Client zeigt nur Ring und Blitz ohne Trefferlogik', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { SW, Entities, arrays, state } = window.__sw;
    const Network = await import('./js/network.js');
    state.gameMode = 'online';
    SW.loeseAus(120, 340, 'p2');
    const gesendet = { ...state.network.lastSentEvent };
    arrays.effekte.forEach(e => e.el && e.el.remove());
    arrays.effekte.length = 0;

    // Client: Ereignis anwenden, Ring ohne getroffen; ein Feind bleibt stehen
    Entities.erzeugeFeind(110, 330, 'swoop', 0, false);
    Network.handleNetworkEvent(gesendet);
    const welle = arrays.effekte.find(e => e.art === 'schockwelle');
    SW.aktualisiereSchockwellen();
    state.gameMode = 'single';
    return {
      gesendet,
      clientRing: !!welle && !!welle.el,
      ohneLogik: !!welle && welle.getroffen === undefined,
      feindLebt: arrays.feinde.length === 1,
    };
  });
  expect(r.gesendet.type).toBe('schockwelle');
  expect(r.gesendet.x).toBe(120);
  expect(r.gesendet.y).toBe(340);
  expect(r.gesendet.radius).toBeGreaterThan(300);
  expect(r).toMatchObject({ clientRing: true, ohneLogik: true, feindLebt: true });
});
