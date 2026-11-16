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
  // Feld leeren, Spieler unten in der Mitte, keine Zufalls-Spawns; Helfer in window.__bw
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
    const segment = (y, p) => {
      const s = Anzeige.erzeuge({ id: 'fe_t' + y, x: 0, y, oben: { ...p }, unten: { ...p } }, 'fels');
      arrays.fels.push(s);
      return s;
    };
    // n Schritte, Fels dabei festhalten (Tempo 0) und keine Level-Spawns
    const Loop = await import('./js/loop.js');
    const schritte = n => {
      for (let i = 0; i < n; i++) {
        state.frameZaehler = 1;
        Loop.simulationsSchritt();
      }
    };
    window.__bw = {
      B: await import('./js/biowesen.js'),
      K: await import('./js/kette.js'),
      L: await import('./js/level.js'),
      Fels,
      Anzeige,
      state,
      arrays,
      config,
      segment,
      schritte,
    };
  });
});

test('Levelplan: Fels-Level nutzen den Bio-Spawner, starten frueher und haben halb so viele Asteroiden', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const { L } = window.__bw;
    const p3 = L.levelPlan(3);
    const p4 = L.levelPlan(4);
    const p5 = L.levelPlan(5);
    return {
      spawner: [p3.spawner, p4.spawner, p5.spawner],
      start4: p4.feindStart,
      takt: p4.asteroidenTakt.map(([, t]) => t),
      taktOhneFels: p5.asteroidenTakt.map(([, t]) => t),
      bioStart: L.BIO_FEIND_START,
    };
  });
  expect(r.spawner).toEqual(['standard', 'bio', 'standard']);
  expect(r.start4).toBe(r.bioStart);
  // Level 4: 90/70/50 ohne Fels, also 180/140/100
  expect(r.takt).toEqual([180, 140, 100]);
  expect(r.taktOhneFels).toEqual([80, 60, 40]);
});

test('Bio-Spawner erzeugt nur organische Gegner, alle fuenf Arten kommen vor', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { B, arrays, Anzeige } = window.__bw;
    const arten = new Set();
    for (let i = 0; i < 300; i++) {
      B.verwalteBioSpawns();
      arrays.feinde.forEach(f => arten.add(f.muster));
      arrays.feinde.forEach(Anzeige.entferne);
      arrays.feinde.length = 0;
    }
    return [...arten].sort();
  });
  expect(r).toEqual(['kette', 'krabbe', 'kugelkette', 'stachelkette', 'tentakler']);
});

test('Stachelkette ist ein Hindernis: zaeh, langsamer, schiesst nicht', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { K, arrays, schritte } = window.__bw;
    K.erzeugeKette('schlange', 6, 1, 'stachelkette');
    const glieder = arrays.feinde.slice();
    const t0 = glieder[0].kettenT;
    schritte(300);
    return {
      tempo: (glieder[0].kettenT - t0) / 300,
      hp: [glieder[0].maxHp, glieder[1].maxHp],
      schuesse: arrays.feindLaserArray.length,
      svg: !!glieder[1].el.querySelector('svg.ketten-koerper polygon'),
    };
  });
  expect(r.tempo).toBeCloseTo(0.7, 5);
  expect(r.hp).toEqual([40, 30]);
  expect(r.schuesse).toBe(0);
  expect(r.svg).toBe(true);
});

test('Kugelkette: nur Blasenglieder (jedes dritte) schiessen Kugeln auf den Spieler', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { K, arrays, schritte } = window.__bw;
    K.erzeugeKette('schlange', 9, 1, 'kugelkette');
    const glieder = arrays.feinde.slice();
    const pods = glieder.filter(g => g.kugelTimer !== undefined);
    schritte(260);
    const kugeln = arrays.feindLaserArray;
    return {
      podIndex: pods.map(g => g.kettenIndex),
      podGroesse: pods.every(g => g.groesse === K.POD_GROESSE),
      blase: !!pods[0].el.querySelector('.kugel-blase'),
      kugeln: kugeln.length,
      alleSporen: kugeln.every(k => k.spore),
      nachUnten: kugeln.every(k => k.vy > 0),
      kopfSchiesstNicht: glieder[0].schussTimer > 9000,
    };
  });
  expect(r.podIndex).toEqual([2, 5, 8]);
  expect(r).toMatchObject({
    podGroesse: true,
    blase: true,
    alleSporen: true,
    nachUnten: true,
    kopfSchiesstNicht: true,
  });
  expect(r.kugeln).toBeGreaterThanOrEqual(3);
});

test('Krabbe ohne Fels: Anflug, dann seitlich krabbeln im Feld, Kugelpaare, spaeter Abzug', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { B, schritte, config } = window.__bw;
    const Audio = await import('./js/audio.js');
    Audio.clearAudioHistory();
    const k = B.erzeugeKrabbe(100);
    const phasen = new Set();
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < B.KRABBE_DAUER + 20; i++) {
      schritte(1);
      phasen.add(k.phase);
      if (k.phase === 'krabbeln') {
        minX = Math.min(minX, k.x);
        maxX = Math.max(maxX, k.x + k.groesse);
      }
    }
    return {
      phasen: [...phasen],
      imFeld: minX >= 0 && maxX <= config.spielfeldBreite,
      weg: maxX - minX,
      // Kugeln ueber die Schussgeraeusche zaehlen (Treffer am Spieler entfernen Kugeln)
      kugeln: Audio.audioHistory.filter(h => h.name === 'spore').length,
      svg: !!k.el.querySelector('.krabbe-beine') && k.el.querySelectorAll('.stielauge').length === 2,
    };
  });
  expect(r.phasen).toEqual(['anflug', 'krabbeln', 'abzug']);
  expect(r.imFeld).toBe(true);
  expect(r.weg).toBeGreaterThan(150);
  expect(r.kugeln % 2).toBe(0);
  expect(r.kugeln).toBeGreaterThanOrEqual(8);
  expect(r.svg).toBe(true);
});

test('Krabbe an der Felswand: laeuft an der Kante mit Blick in den Gang, springt dann ab', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { B, Fels, segment, schritte } = window.__bw;
    for (let y = -40; y <= 600; y += 40) segment(y, { l: 90, r: 30, im: 200, ib: 0 });
    Fels.setzeTempo(0);
    const k = B.erzeugeKrabbe();
    const start = { phase: k.phase, wand: k.wand, rot: k.rot, x: k.x };
    const anKante = Math.abs(k.x + k.groesse * 0.25 - 90) < 0.01;
    const y0 = k.y;
    let sprungX = null;
    for (let i = 0; i < 400 && k.phase !== 'krabbeln'; i++) {
      schritte(1);
      if (k.phase === 'sprung' && sprungX === null) sprungX = k.x;
    }
    return { start, anKante, gelaufen: k.y > y0, sprungX, endX: k.x, endPhase: k.phase, endRot: k.rot };
  });
  expect(r.start).toMatchObject({ phase: 'wand', wand: 'l', rot: -90 });
  expect(r.anKante).toBe(true);
  expect(r.gelaufen).toBe(true);
  expect(r.sprungX).not.toBeNull();
  expect(r.endX).toBeGreaterThan(r.sprungX + 30); // in den Gang hinein
  expect(r.endPhase).toBe('krabbeln');
  expect(r.endRot).toBe(0);
});

test('Krabbe bleibt beim Krabbeln im freien Gang zwischen den Felswaenden', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { B, Fels, segment, schritte } = window.__bw;
    for (let y = -40; y <= 600; y += 40) segment(y, { l: 120, r: 100, im: 200, ib: 0 });
    Fels.setzeTempo(0);
    const k = B.erzeugeKrabbe(150);
    k.phase = 'krabbeln';
    k.y = 200;
    let ok = true;
    for (let i = 0; i < 300; i++) {
      schritte(1);
      if (k.x < 120 || k.x + k.groesse > 400 - 100) ok = false;
    }
    return ok;
  });
  expect(r).toBe(true);
});

test('Tentakler pendelt beim Sinken und stoesst Kugelringe aus', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { B, arrays, schritte } = window.__bw;
    const t = B.erzeugeTentakler(180);
    t.schussTakt = 1;
    t.y = 50;
    const xs = [];
    schritte(2);
    const ring = arrays.feindLaserArray.filter(l => l.spore);
    for (let i = 0; i < 120; i++) {
      schritte(1);
      xs.push(t.x);
    }
    const winkel = ring.map(k => Math.atan2(k.vy, k.vx));
    return {
      ring: ring.length,
      rundum: Math.max(...winkel) - Math.min(...winkel) > 4,
      pendel: Math.max(...xs) - Math.min(...xs) > 40,
      svg: !!t.el.querySelector('.tentakel') && !!t.el.querySelector('.schirm'),
    };
  });
  expect(r).toEqual({ ring: 6, rundum: true, pendel: true, svg: true });
});

test('Online: Muster und Drehung kommen beim Client an, er zeichnet dieselben Wesen', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { B, K, arrays, state, segment, Fels } = window.__bw;
    const Network = await import('./js/network.js');
    for (let y = -40; y <= 600; y += 40) segment(y, { l: 90, r: 30, im: 200, ib: 0 });
    Fels.setzeTempo(0);
    B.erzeugeKrabbe();
    B.erzeugeTentakler(200);
    K.erzeugeKette('schlange', 3, 1, 'kugelkette');
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    arrays.feinde.forEach(f => f.el.remove());
    arrays.feinde.length = 0;
    const netz = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    state.network = netz;
    const nach = m => arrays.feinde.find(f => f.muster === m);
    return {
      krabbeRot: nach('krabbe').rot,
      krabbeSvg: !!nach('krabbe').el.querySelector('.stielauge'),
      tentaklerSvg: !!nach('tentakler').el.querySelector('.tentakel'),
      pod: arrays.feinde.filter(f => f.muster === 'kugelkette' && f.el.querySelector('.kugel-blase')).length,
    };
  });
  expect(r).toEqual({ krabbeRot: -90, krabbeSvg: true, tentaklerSvg: true, pod: 1 });
});
