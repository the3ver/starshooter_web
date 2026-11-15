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
  // Feld leeren, keine Zufalls-Spawns; Helfer in window.__fe
  await page.evaluate(async () => {
    const { state, arrays, config } = await import('./js/state.js');
    const Anzeige = await import('./js/anzeige.js');
    const Fels = await import('./js/fels.js');
    for (const name of Object.keys(arrays)) {
      if (name === 'sterne') continue;
      arrays[name].forEach(o => o.el && Anzeige.entferne(o));
      arrays[name].length = 0;
    }
    Fels.setzeZurueck();
    state.frameZaehler = 1;
    state.x = 185;
    state.y = 500;
    state.invulnerableTimer = 0;
    state.schildStufe = 0;
    state.leben = 3;
    state.selectedShipModel = 'phantom';
    // Segment mit festem Profil (oben = unten) auf Hoehe y
    const segment = (y, p) =>
      arrays.fels.push(Anzeige.erzeuge({ id: 'fe_t' + y, x: 0, y, oben: { ...p }, unten: { ...p } }, 'fels'));
    window.__fe = { Fels, Anzeige, state, arrays, config, segment, Loop: await import('./js/loop.js') };
  });
});

test('Abschnitte halten Mindestgang und Inseldurchgang ein (Feldbreite 400 und 600)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Fels, arrays, config, Anzeige } = window.__fe;
    const fehler = [];
    const breiteVorher = config.spielfeldBreite;
    for (const breite of [400, 600]) {
      config.spielfeldBreite = breite;
      Fels.setzeZurueck();
      for (let runde = 0; runde < 60; runde++) {
        Fels.erzeugeNachschub(true);
        for (const s of arrays.fels) s.y += Fels.SEGMENT_HOEHE; // Platz fuer neue Segmente
      }
      for (const s of arrays.fels) {
        const p = s.oben;
        const gang = breite - p.l - p.r;
        if (gang < Math.round(breite * 0.4) - 0.001) fehler.push(`${breite}: Gang ${gang}`);
        if (p.ib <= 0 && p.im !== breite / 2) fehler.push(`${breite}: Inselmitte ohne Insel ${p.im}`);
        if (p.ib > 0) {
          const spaltL = p.im - p.ib / 2 - p.l;
          const spaltR = breite - p.r - (p.im + p.ib / 2);
          if (Math.min(spaltL, spaltR) < Fels.MIN_DURCHGANG - 12)
            fehler.push(`${breite}: Spalt ${Math.min(spaltL, spaltR)}`);
        }
      }
      arrays.fels.forEach(Anzeige.entferne);
      arrays.fels.length = 0;
    }
    config.spielfeldBreite = breiteVorher;
    return fehler;
  });
  expect(r).toEqual([]);
});

test('Nachschub fuellt bis oben lueckenlos, Segmente scrollen und verschwinden unten', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Fels, arrays, config } = window.__fe;
    for (let i = 0; i < 700; i++) {
      Fels.erzeugeNachschub(true);
      Fels.aktualisiereFels();
    }
    const sortiert = [...arrays.fels].sort((a, b) => a.y - b.y);
    const lueckenlos = sortiert.every((s, i) => i === 0 || s.y - sortiert[i - 1].y === Fels.SEGMENT_HOEHE);
    const anschluss = sortiert.every((s, i) => i === 0 || sortiert[i - 1].unten === s.oben);
    return {
      lueckenlos,
      anschluss,
      oben: sortiert[0].y <= 0,
      unten: sortiert.at(-1).y <= config.spielfeldHoehe,
      anzahl: arrays.fels.length,
    };
  });
  expect(r).toMatchObject({ lueckenlos: true, anschluss: true, oben: true, unten: true });
  expect(r.anzahl).toBeLessThanOrEqual(Math.ceil(800 / 40) + 2);
});

test('Auslauf: Waende schrumpfen auf null, danach kommt kein Fels mehr', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Fels, arrays } = window.__fe;
    for (let i = 0; i < 200; i++) {
      Fels.erzeugeNachschub(true);
      Fels.aktualisiereFels();
    }
    for (let i = 0; i < 2000; i++) {
      Fels.erzeugeNachschub(false);
      Fels.aktualisiereFels();
    }
    return arrays.fels.length;
  });
  expect(r).toBe(0);
});

test('Wand beruehrt: Schaden und Rueckstoss in den Gang; waehrend der I-Frames nur Rueckstoss', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Fels, state, segment } = window.__fe;
    segment(480, { l: 120, r: 30, im: 0, ib: 0 });
    state.x = 110; // steckt 10 px in der linken Wand
    const leben = state.leben;
    Fels.aktualisiereFels();
    const erst = { leben: state.leben, x: state.x, iframes: state.invulnerableTimer > 0 };
    state.x = 110;
    Fels.aktualisiereFels();
    return { erst, leben, zweit: { leben: state.leben, x: state.x } };
  });
  expect(r.erst.leben).toBe(r.leben - 1);
  expect(r.erst.x).toBe(120 + 14);
  expect(r.erst.iframes).toBe(true);
  expect(r.zweit).toEqual({ leben: r.leben - 1, x: 134 });
});

test('Rechte Wand und Insel schieben zur naeheren freien Seite', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Fels, state, segment, config } = window.__fe;
    const b = config.spielfeldBreite;
    state.godMode = true;
    segment(480, { l: 20, r: 60, im: b / 2, ib: 100 });
    state.x = b - 60 - 20; // 10 px in der rechten Wand
    Fels.aktualisiereFels();
    const rechts = state.x;
    state.x = b / 2 - 40; // linke Haelfte der Insel
    Fels.aktualisiereFels();
    const inselLinks = state.x;
    state.x = b / 2 + 15; // rechte Haelfte der Insel
    Fels.aktualisiereFels();
    return { rechts, inselLinks, inselRechts: state.x, b };
  });
  const g = 30;
  expect(r.rechts).toBe(r.b - 60 - g - 14);
  expect(r.inselLinks).toBe(r.b / 2 - 50 - g - 14);
  expect(r.inselRechts).toBe(r.b / 2 + 50 + 14);
});

test('Levelplan: Fels ab Level 4 in jedem zweiten Level, Auslauf vor dem Boss', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const L = await import('./js/level.js');
    const { state, arrays, Loop, Anzeige, Fels } = window.__fe;
    const plaene = [3, 4, 5, 6, 7, 8].map(l => [l, L.levelPlan(l).fels]);
    state.godMode = true;
    const lauf = (level, startFrame, schritte) => {
      arrays.fels.forEach(Anzeige.entferne);
      arrays.fels.length = 0;
      Fels.setzeZurueck();
      state.level = level;
      state.frameZaehler = startFrame;
      for (let i = 0; i < schritte; i++) Loop.simulationsSchritt();
      return arrays.fels.length;
    };
    return {
      plaene,
      level3: lauf(3, 1, 120),
      level4: lauf(4, 1, 120),
      imAuslauf: lauf(4, L.LEVEL_DAUER - L.FELS_AUSLAUF + 1, 60),
    };
  });
  expect(r.plaene).toEqual([
    [3, false],
    [4, true],
    [5, false],
    [6, true],
    [7, false],
    [8, true],
  ]);
  expect(r.level3).toBe(0);
  // Fels scrollt von oben herein: 120 Schritte * 1,5 px = 180 px, also 5-6 Segmente
  expect(r.level4).toBeGreaterThanOrEqual(5);
  expect(r.imAuslauf).toBe(0); // Auslauf ohne vorherigen Fels: nichts Neues
});

test('Darstellung: Segment mit Polygonen fuer Wand und Insel', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { arrays, segment } = window.__fe;
    segment(100, { l: 40, r: 40, im: 200, ib: 60 });
    segment(140, { l: 0, r: 0, im: 200, ib: 0 });
    const [mit, leer] = arrays.fels;
    return {
      mit: mit.el.querySelectorAll('polygon.fels-wand').length,
      leer: leer.el.querySelectorAll('polygon').length,
      top: mit.el.style.top,
    };
  });
  expect(r).toEqual({ mit: 3, leer: 0, top: '100px' });
});

test('Online: Snapshot traegt Hoehe und Profil, der Client baut dieselben Segmente und schiebt sein Schiff', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { arrays, state, segment, Fels, Anzeige } = window.__fe;
    const Network = await import('./js/network.js');
    segment(200, { l: 50, r: 70, im: 0, ib: 0 });
    segment(160, { l: 60, r: 60, im: 200, ib: 80 });
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    const gesendet = snap.fels;
    arrays.fels.forEach(Anzeige.entferne);
    arrays.fels.length = 0;
    const netz = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    state.network = netz;
    const client = arrays.fels.map(s => ({ id: s.id, y: s.y, p: Fels.profilAlsText(s), el: !!s.el }));
    // Client-Vorhersage: eigenes Schiff ragt in die linke Wand
    const schiff = { x: 40, y: 200 };
    const beruehrt = Fels.schiebeHeraus(schiff);
    return { gesendet, client, beruehrt, x: schiff.x };
  });
  expect(r.gesendet).toEqual([
    { id: 'fe_t200', y: 200, p: '50 70 0 0,50 70 0 0' },
    { id: 'fe_t160', y: 160, p: '60 60 200 80,60 60 200 80' },
  ]);
  expect(r.client.map(({ id, y, p }) => ({ id, y, p }))).toEqual(r.gesendet);
  expect(r.client.every(c => c.el)).toBe(true);
  expect(r.beruehrt).toBe(true);
  expect(r.x).toBe(50 + 14);
});

test('Bot weicht von Wand und Insel zur Mitte des freien Bereichs aus', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { segment, config } = window.__fe;
    const Bot = await import('./js/bot.js');
    const b = config.spielfeldBreite;
    for (let y = 400; y <= 560; y += 40) segment(y, { l: 60, r: 60, im: b / 2, ib: 80 });
    return {
      linkeWand: Bot.felsAusweichen({ x: 65, y: 480 }),
      rechteWand: Bot.felsAusweichen({ x: b - 60 - 30 - 5, y: 480 }),
      vorInsel: Bot.felsAusweichen({ x: b / 2 - 40 - 30 - 5, y: 480 }),
      frei: Bot.felsAusweichen({ x: 60 + 40, y: 480 }),
    };
  });
  expect(r).toEqual({ linkeWand: 1, rechteWand: -1, vorInsel: -1, frei: 0 });
});

test('Neustart leert den Fels und setzt das Profil zurueck', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { Fels, arrays } = window.__fe;
    const Utils = await import('./js/utils.js');
    for (let i = 0; i < 50; i++) Fels.erzeugeNachschub(true);
    Utils.restartGame();
    const nachNeustart = arrays.fels.length;
    Fels.erzeugeNachschub(false); // ohne Profil kein Auslauf-Fels
    return { nachNeustart, auslauf: arrays.fels.length };
  });
  expect(r).toEqual({ nachNeustart: 0, auslauf: 0 });
});

test('Powerups im Fels schweben in den freien Gang (Wand und Insel)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, segment, config, state, Loop } = window.__fe;
    const Entities = await import('./js/entities.js');
    const b = config.spielfeldBreite;
    state.godMode = true;
    state.x = b / 2 - 15;
    state.y = 580;
    for (let y = -40; y <= 600; y += 40) segment(y, { l: 100, r: 30, im: b / 2 + 20, ib: 80 });
    Entities.erzeugePowerup(20, 100, 'energie'); // in der linken Wand
    Entities.erzeugePowerup(b / 2 + 10, 300, 'energie'); // in der Insel, rechts der Mitte
    const [inWand, inInsel] = arrays.powerups;
    for (let i = 0; i < 60; i++) {
      for (const s of arrays.fels) s.y -= 1.5; // Fels festhalten
      Loop.simulationsSchritt();
    }
    const g = inWand.groesse;
    return {
      wand: inWand.x >= 100 && inWand.x + g <= b / 2 + 20 - 40,
      insel: inInsel.x >= b / 2 + 20 + 40 && inInsel.x + g <= b - 30,
    };
  });
  expect(r).toEqual({ wand: true, insel: true });
});
