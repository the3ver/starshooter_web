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
  // Feld leeren, Spieler unten links parken, keine Zufalls-Spawns
  await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const Anzeige = await import('./js/anzeige.js');
    ['feinde', 'asteroiden', 'feindLaserArray', 'powerups', 'laserArray'].forEach(name => {
      arrays[name].forEach(Anzeige.entferne);
      arrays[name].length = 0;
    });
    state.frameZaehler = 1;
    state.x = 0;
    state.y = 560;
    state.godMode = true;
    window.__kette = await import('./js/kette.js');
  });
});

test('Bahnen liegen vor dem Start ausserhalb des Felds, ab t = 0 laufen sie ins Feld', async ({ page }) => {
  const r = await page.evaluate(() => {
    const K = window.__kette;
    const fehler = [];
    for (const bahn of K.KETTEN_BAHNEN)
      for (const seite of [1, -1]) {
        for (let t = -120; t < 0; t++) {
          const p = K.bahnPunkt(bahn, t, seite, 400);
          if (p.x > 0 && p.x < 400 && p.y > 0) fehler.push(`${bahn}/${seite} t=${t} im Feld`);
        }
        const spaeter = K.bahnPunkt(bahn, 120, seite, 400);
        if (!(spaeter.x > 0 && spaeter.x < 400 && spaeter.y > 0)) fehler.push(`${bahn}/${seite} t=120 nicht im Feld`);
      }
    return fehler;
  });
  expect(r).toEqual([]);
});

test('Glieder folgen der Spur des Kopfes mit festem Zeitversatz und drehen sich in Flugrichtung', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const K = window.__kette;
    const { arrays } = await import('./js/state.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    K.erzeugeKette('schleife', 5, 1);
    const glieder = arrays.feinde.slice();
    const mitte = f => ({ x: f.x + f.groesse / 2, y: f.y + f.groesse / 2 });
    const spur = [];
    for (let i = 0; i < 80; i++) {
      simulationsSchritt();
      spur.push(mitte(glieder[0]));
    }
    // Glied 3 steht jetzt dort, wo der Kopf 3 * ABSTAND Schritte vorher war
    const soll = spur[spur.length - 1 - 3 * K.gliedAbstand('schleife', 1)];
    const ist = mitte(glieder[3]);
    return {
      abweichung: Math.hypot(soll.x - ist.x, soll.y - ist.y),
      alleNochDa: glieder.every(g => arrays.feinde.includes(g)),
      kopfGroesser: glieder[0].groesse > glieder[1].groesse,
      rotGesetzt: glieder.every(g => typeof g.rot === 'number'),
    };
  });
  expect(r.abweichung).toBeLessThan(0.001);
  expect(r).toMatchObject({ alleNochDa: true, kopfGroesser: true, rotGesetzt: true });
});

test('Glieder liegen auf jeder Bahn im Mittel etwa GLIED_ABSTAND_PX auseinander', async ({ page }) => {
  const r = await page.evaluate(() => {
    const K = window.__kette;
    const ergebnis = {};
    for (const bahn of K.KETTEN_BAHNEN) {
      const n = K.gliedAbstand(bahn, 1, 400);
      let summe = 0;
      for (let t = 100; t < 200; t++) {
        const a = K.bahnPunkt(bahn, t, 1, 400);
        const b = K.bahnPunkt(bahn, t - n, 1, 400);
        summe += Math.hypot(a.x - b.x, a.y - b.y);
      }
      ergebnis[bahn] = Math.abs(summe / 100 - K.GLIED_ABSTAND_PX) < 7;
    }
    return ergebnis;
  });
  expect(r).toEqual({ schlange: true, sKurve: true, schleife: true, spirale: true });
});

test('Wartende Glieder ausserhalb des Felds werden nicht entfernt (Bahn von der Seite)', async ({ page }) => {
  const anzahl = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    window.__kette.erzeugeKette('sKurve', 10, -1);
    simulationsSchritt();
    return arrays.feinde.filter(f => f.muster === 'kette').length;
  });
  expect(anzahl).toBe(10);
});

test('Nur der Kopf schiesst', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    window.__kette.erzeugeKette('schlange', 6, 1);
    const glieder = arrays.feinde.slice();
    for (let i = 0; i < 150; i++) simulationsSchritt();
    return {
      kopfBereit: glieder[0].schussTimer < 200,
      gliederStumm: glieder.slice(1).every(g => g.schussTimer > 9000),
    };
  });
  expect(r).toEqual({ kopfBereit: true, gliederStumm: true });
});

test('Kettenbonus: komplett abgeschossene Kette gibt ein Powerup und 500 Bonuspunkte', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    state.selectedShipModel = 'phantom'; // ohne Viper-Kill-Kombo (Faktor 1)
    window.__kette.erzeugeKette('schlange', 4, 1);
    const glieder = arrays.feinde.slice();
    glieder.slice(0, 3).forEach(g => Utils.zerstoereZiel(g));
    const powerupsVorher = arrays.powerups.length;
    const scoreVorher = state.score;
    Utils.zerstoereZiel(glieder[3]);
    return {
      powerupsVorher,
      powerupsNachher: arrays.powerups.length,
      punkte: state.score - scoreVorher,
      bonus: window.__kette.KETTEN_BONUS_PUNKTE,
    };
  });
  expect(r.powerupsVorher).toBe(0);
  expect(r.powerupsNachher).toBe(1);
  expect(r.punkte).toBe(100 + r.bonus);
});

test('Kein Kettenbonus, wenn ein Glied entkommt oder den Spieler rammt', async ({ page }) => {
  const powerups = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const Anzeige = await import('./js/anzeige.js');
    window.__kette.erzeugeKette('schlange', 4, 1);
    const glieder = arrays.feinde.slice();
    // Glied 2 verschwindet ohne Abschuss
    Anzeige.entferne(glieder[2]);
    arrays.feinde.splice(arrays.feinde.indexOf(glieder[2]), 1);
    [0, 1, 3].forEach(i => Utils.zerstoereZiel(glieder[i]));
    return arrays.powerups.length;
  });
  expect(powerups).toBe(0);
});

test('Spawn: ab Level 3 erzeugt verwalteFeindSpawns Ketten, in Level 2 nicht', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const { verwalteFeindSpawns } = await import('./js/gegner.js');
    const Anzeige = await import('./js/anzeige.js');
    const orig = Math.random;
    const lauf = level => {
      arrays.feinde.forEach(Anzeige.entferne);
      arrays.feinde.length = 0;
      state.level = level;
      // Level 3: V 0,10 + Kreuz 0,15 + Swoop 0,15 + Cling-on 0,15 = 0,55; Kette bis 0,60
      Math.random = () => 0.57;
      try {
        verwalteFeindSpawns();
      } finally {
        Math.random = orig;
      }
      return arrays.feinde.map(f => f.muster);
    };
    return { level3: lauf(3), level2: lauf(2) };
  });
  // 0,57: Bahn schleife, 6 + floor(0,57 * 5) = 8 Glieder, Seite -1
  expect(r.level3).toEqual(Array(8).fill('kette'));
  expect(r.level2).not.toContain('kette');
});

test('Darstellung: Kopf und Glieder bekommen den pulsierenden Kettenkoerper, Puls versetzt', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    window.__kette.erzeugeKette('schlange', 3, 1);
    const [kopf, g1, g2] = arrays.feinde;
    return {
      koerper: [kopf, g1, g2].every(f => !!f.el.querySelector('svg.ketten-koerper')),
      kopfAuge: kopf.el.querySelectorAll('circle').length,
      verzug: new Set([g1, g2].map(f => f.el.style.getPropertyValue('--puls-verzug'))).size,
    };
  });
  expect(r.koerper).toBe(true);
  expect(r.kopfAuge).toBeGreaterThan(0);
  expect(r.verzug).toBe(2);
});

test('Online: Snapshot traegt Muster, Groesse und Drehung, der Client baut daraus Kopf und Glieder', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const Network = await import('./js/network.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    window.__kette.erzeugeKette('spirale', 3, 1);
    for (let i = 0; i < 40; i++) simulationsSchritt();
    const host = arrays.feinde.map(f => ({ id: f.id, groesse: f.groesse, rot: Math.round(f.rot) }));
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    const gesendet = snap.feinde.map(f => ({
      muster: f.muster,
      groesse: f.groesse,
      hatRot: typeof f.rot === 'number',
    }));

    // Als Client uebernehmen
    arrays.feinde.forEach(f => f.el.remove());
    arrays.feinde.length = 0;
    const netzVorher = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    const client = arrays.feinde.map(f => ({
      id: f.id,
      groesse: f.groesse,
      rot: Math.round(f.rot),
      koerper: !!f.el.querySelector('svg.ketten-koerper'),
    }));
    state.network = netzVorher;
    return { host, gesendet, client };
  });
  expect(r.gesendet).toEqual([
    { muster: 'kette', groesse: 28, hatRot: true },
    { muster: 'kette', groesse: 22, hatRot: true },
    { muster: 'kette', groesse: 22, hatRot: true },
  ]);
  expect(r.client.map(({ id, groesse, rot }) => ({ id, groesse, rot }))).toEqual(r.host);
  expect(r.client.every(c => c.koerper)).toBe(true);
});

test('Neustart entfernt alle Kettenglieder', async ({ page }) => {
  const anzahl = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    window.__kette.erzeugeKette('schlange', 6, 1);
    Utils.restartGame();
    return arrays.feinde.filter(f => f.muster === 'kette').length;
  });
  expect(anzahl).toBe(0);
});

test('Bot nimmt Kettenglieder als Ziel', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    const Bot = await import('./js/bot.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    window.__kette.erzeugeKette('schlange', 4, 1);
    for (let i = 0; i < 60; i++) simulationsSchritt();
    const p2 = { ...state, x: 200, y: 500, selectedShipModel: 'phantom' };
    const ziel = Bot.findBestTarget(p2, { aimCorridor: 400 });
    return { istKette: !!ziel && arrays.feinde.some(f => f.muster === 'kette' && f.x + f.groesse / 2 === ziel.x) };
  });
  expect(r.istKette).toBe(true);
});
