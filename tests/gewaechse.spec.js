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
  // Feld leeren, Spieler unten in der Mitte, keine Zufalls-Spawns; Helfer in window.__gw
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
    state.level = 1;
    state.x = config.spielfeldBreite / 2 - 15;
    state.y = 560;
    state.godMode = true;
    state.selectedShipModel = 'phantom';
    // Segment mit festem Profil (oben = unten) auf Hoehe y
    const segment = (y, p) => {
      const s = Anzeige.erzeuge({ id: 'fe_t' + y, x: 0, y, oben: { ...p }, unten: { ...p } }, 'fels');
      arrays.fels.push(s);
      return s;
    };
    window.__gw = {
      G: await import('./js/gewaechse.js'),
      Loop: await import('./js/loop.js'),
      Utils: await import('./js/utils.js'),
      Fels,
      Anzeige,
      state,
      arrays,
      config,
      segment,
    };
  });
});

test('Gewaechse sitzen an Wand- und Inselkanten und blicken in den Gang', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, segment, config } = window.__gw;
    const b = config.spielfeldBreite;
    const s = segment(200, { l: 60, r: 50, im: b / 2, ib: 80 });
    const lage = seite => {
      const f = G.erzeugeGewaechs('trichter', s, seite);
      return { x: f.x, y: f.y, rot: f.rot, richtung: f.richtung };
    };
    const ohnePlatz = G.erzeugeGewaechs('bluete', segment(300, { l: 10, r: 10, im: b / 2, ib: 0 }));
    return { l: lage('l'), r: lage('r'), il: lage('il'), ir: lage('ir'), ohnePlatz, b };
  });
  const g = 30;
  expect(r.l).toEqual({ x: 60 - g * 0.3, y: 205, rot: -90, richtung: 1 });
  expect(r.r).toEqual({ x: r.b - 50 - g * 0.7, y: 205, rot: 90, richtung: -1 });
  expect(r.il).toEqual({ x: r.b / 2 - 40 - g * 0.7, y: 205, rot: 90, richtung: -1 });
  expect(r.ir).toEqual({ x: r.b / 2 + 40 - g * 0.3, y: 205, rot: -90, richtung: 1 });
  expect(r.ohnePlatz).toBeNull();
});

test('Gewaechs scrollt mit seinem Felssegment', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, Loop, segment } = window.__gw;
    const s = segment(100, { l: 60, r: 60, im: 200, ib: 0 });
    const f = G.erzeugeGewaechs('kapsel', s, 'l');
    const vorher = f.y;
    for (let i = 0; i < 20; i++) Loop.simulationsSchritt();
    return { weg: f.y - vorher, abstand: f.y - s.y };
  });
  expect(r.weg).toBeCloseTo(20 * 1.5, 5);
  expect(r.abstand).toBe((40 - 24) / 2);
});

test('Bluete: zu und gepanzert, dann offen mit drei Sporen quer in den Gang, dann wieder zu', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, Loop, segment, arrays } = window.__gw;
    const s = segment(200, { l: 60, r: 60, im: 200, ib: 0 });
    s.y = 200;
    const f = G.erzeugeGewaechs('bluete', s, 'l');
    const verlauf = [];
    for (let i = 0; i < G.ZU_DAUER + G.OFFEN_DAUER + 2; i++) {
      s.y = 200; // Segment festhalten (Fels wird hier nicht gescrollt)
      Loop.simulationsSchritt();
      verlauf.push({ offen: f.offen, panzer: f.istUnzerstoerbar });
    }
    const sporen = arrays.feindLaserArray.filter(l => l.spore);
    return {
      zuAnfang: verlauf[0],
      offenNachZu: verlauf[G.ZU_DAUER],
      wiederZu: verlauf.at(-1),
      sporen: sporen.length,
      tempo: sporen.map(l => [l.vx, l.vy, l.width]),
      klasse: sporen[0] && sporen[0].el.className,
    };
  });
  expect(r.zuAnfang).toEqual({ offen: false, panzer: true });
  expect(r.offenNachZu).toEqual({ offen: true, panzer: false });
  expect(r.wiederZu).toEqual({ offen: false, panzer: true });
  expect(r.sporen).toBe(3);
  for (const [vx, vy, w] of r.tempo) {
    expect(vx).toBeCloseTo(2.6, 5);
    expect(Math.abs(vy)).toBeLessThan(1);
    expect(w).toBe(10);
  }
  expect(r.klasse).toBe('spore');
});

test('Laser prallen an der geschlossenen Bluete ab und treffen die offene', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, Loop, segment, arrays, Anzeige } = window.__gw;
    const s = segment(200, { l: 60, r: 60, im: 200, ib: 0 });
    const f = G.erzeugeGewaechs('bluete', s, 'l');
    const schuss = () => {
      s.y = 200;
      arrays.laserArray.push(
        Anzeige.erzeuge(
          {
            id: 'l_t' + Math.random(),
            x: f.x + 15,
            y: f.y + f.groesse + 4,
            vx: 0,
            vy: 15,
            width: 4,
            height: 20,
            schaden: 16,
            owner: 'p1',
          },
          'laser',
        ),
      );
      const hp = f.hp;
      Loop.simulationsSchritt();
      return hp - f.hp;
    };
    const zu = schuss();
    f.phase = 'offen';
    f.phaseTimer = G.OFFEN_DAUER;
    const offen = schuss();
    return { zu, offen };
  });
  expect(r.zu).toBe(0);
  expect(r.offen).toBe(16);
});

test('Trichter schiesst im Takt einzelne Sporen, Kapsel nie', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, Loop, segment, arrays } = window.__gw;
    const s = segment(200, { l: 60, r: 60, im: 200, ib: 0 });
    const t = G.erzeugeGewaechs('trichter', s, 'l');
    t.phaseTimer = 5;
    const k = G.erzeugeGewaechs('kapsel', s, 'r');
    for (let i = 0; i < 5 + G.TRICHTER_TAKT; i++) {
      s.y = 200;
      Loop.simulationsSchritt();
    }
    const sporen = arrays.feindLaserArray.filter(l => l.spore);
    return { anzahl: sporen.length, richtungen: sporen.map(l => Math.sign(l.vx)), kapselOffen: k.offen };
  });
  expect(r.anzahl).toBe(2);
  expect(r.richtungen).toEqual([1, 1]);
  expect(r.kapselOffen).toBe(true);
});

test('Eierkapsel laesst beim Abschuss den Bonus fallen (Schockwelle hoechstens einmal pro Level)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, Utils, segment, arrays, state } = window.__gw;
    state.level = 4;
    state.schockwelleLevel = 0;
    const s = segment(200, { l: 60, r: 60, im: 200, ib: 0 });
    const typen = [];
    const orig = Math.random;
    for (let i = 0; i < 2; i++) {
      const k = G.erzeugeGewaechs('kapsel', s, 'l');
      Math.random = () => 0.1;
      try {
        Utils.zerstoereZiel(k);
      } finally {
        Math.random = orig;
      }
      typen.push(arrays.powerups.at(-1).type);
    }
    return typen;
  });
  expect(r[0]).toBe('schockwelle');
  expect(r[1]).not.toBe('schockwelle');
});

test('Schockwelle laesst geschlossene Blueten stehen und erfasst offene Gewaechse', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { G, Loop, segment, arrays } = window.__gw;
    const SW = await import('./js/schockwelle.js');
    const s = segment(200, { l: 60, r: 60, im: 200, ib: 0 });
    const zu = G.erzeugeGewaechs('bluete', s, 'l');
    const trichter = G.erzeugeGewaechs('trichter', s, 'r');
    SW.loeseAus(200, 300, 'p1');
    for (let i = 0; i < SW.WELLEN_DAUER; i++) {
      s.y = 200;
      Loop.simulationsSchritt();
    }
    return { bluete: arrays.feinde.includes(zu), trichter: arrays.feinde.includes(trichter) };
  });
  expect(r).toEqual({ bluete: true, trichter: false });
});

test('Fels-Level laesst Gewaechse wachsen, normale Level nicht', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Loop, arrays, state, Anzeige, Fels, G } = window.__gw;
    const lauf = level => {
      for (const name of ['feinde', 'fels', 'feindLaserArray']) {
        arrays[name].forEach(Anzeige.entferne);
        arrays[name].length = 0;
      }
      Fels.setzeZurueck();
      state.level = level;
      state.frameZaehler = 1;
      for (let i = 0; i < 700; i++) Loop.simulationsSchritt();
      return arrays.feinde.filter(G.istGewaechs).length;
    };
    return { level3: lauf(3), level4: lauf(4) };
  });
  expect(r.level3).toBe(0);
  expect(r.level4).toBeGreaterThan(0);
});

test('Online: Snapshot traegt offen und spore, der Client zeigt Bluete und Spore', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { G, segment, arrays, state } = window.__gw;
    const Network = await import('./js/network.js');
    const s = segment(200, { l: 60, r: 60, im: 200, ib: 0 });
    const f = G.erzeugeGewaechs('bluete', s, 'l');
    f.offen = true;
    G.erzeugeSpore(f);
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    const gesendet = { offen: snap.feinde[0].offen, spore: snap.feindLaser[0].spore };
    for (const name of ['feinde', 'feindLaserArray']) {
      arrays[name].forEach(o => o.el.remove());
      arrays[name].length = 0;
    }
    const netz = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    state.network = netz;
    const cf = arrays.feinde[0];
    const cs = arrays.feindLaserArray[0];
    return {
      gesendet,
      bluete: !!cf.el.querySelector('svg.gewaechs .bluete-kappe'),
      offenKlasse: cf.el.classList.contains('offen'),
      sporeKlasse: cs.el.className,
      sporeBox: [cs.width, cs.height],
    };
  });
  expect(r).toEqual({
    gesendet: { offen: true, spore: true },
    bluete: true,
    offenKlasse: true,
    sporeKlasse: 'spore',
    sporeBox: [10, 10],
  });
});

test('Bot zielt nicht auf geschlossene Blueten', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { G, segment, config } = window.__gw;
    const Bot = await import('./js/bot.js');
    const s = segment(200, { l: 60, r: 60, im: 200, ib: 0 });
    const f = G.erzeugeGewaechs('bluete', s, 'l');
    const p2 = { x: config.spielfeldBreite / 2, y: 500 };
    const zu = Bot.findBestTarget(p2, { aimCorridor: 30 });
    f.offen = true;
    f.istUnzerstoerbar = false;
    const offen = Bot.findBestTarget(p2, { aimCorridor: 30 });
    return { zu, offen: !!offen };
  });
  expect(r).toEqual({ zu: null, offen: true });
});
