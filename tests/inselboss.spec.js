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
  // Feld leeren, Level 4 (Fels-Level), Spieler unten in der Mitte; Helfer in window.__ib
  await page.evaluate(async () => {
    const { state, arrays, config } = await import('./js/state.js');
    const Anzeige = await import('./js/anzeige.js');
    const Fels = await import('./js/fels.js');
    const Inselboss = await import('./js/inselboss.js');
    for (const name of Object.keys(arrays)) {
      if (name === 'sterne') continue;
      arrays[name].forEach(o => o.el && Anzeige.entferne(o));
      arrays[name].length = 0;
    }
    Fels.setzeZurueck();
    Inselboss.setzeZurueck();
    state.level = 4;
    state.frameZaehler = 5000; // nach dem Levelablauf: keine Spawns, keine zweite Warnung
    state.x = config.spielfeldBreite / 2 - 15;
    state.y = 560;
    state.godMode = true;
    state.selectedShipModel = 'phantom';
    const Loop = await import('./js/loop.js');
    const Level = await import('./js/level.js');
    // Boss starten und bis zum Kampf laufen lassen
    const bisKampf = () => {
      Level.starteBoss();
      for (let i = 0; i < 2000 && Inselboss.phase() !== 'kampf'; i++) Loop.simulationsSchritt();
    };
    const augen = () => arrays.bosses.filter(b => b.bossTyp === 'auge');
    window.__ib = {
      Inselboss,
      Fels,
      Loop,
      Level,
      Utils: await import('./js/utils.js'),
      Anzeige,
      state,
      arrays,
      config,
      bisKampf,
      augen,
    };
  });
});

test('Levelplan: Fels-Level enden mit dem Insel-Boss, die anderen mit dem Standard-Boss', async ({ page }) => {
  const r = await page.evaluate(() => [3, 4, 5, 6].map(l => window.__ib.Level.levelPlan(l).boss));
  expect(r).toEqual(['standard', 'insel', 'standard', 'insel']);
});

test('Standard-Boss: Abschuss beendet das Level und laesst drei Belohnungen fallen', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state, arrays, Utils } = window.__ib;
    const Entities = await import('./js/entities.js');
    state.level = 3;
    Entities.erzeugeBoss();
    Utils.zerstoereZiel(arrays.bosses[0]);
    return { level: state.level, bossAktiv: state.bossAktiv, drops: arrays.powerups.length, frame: state.frameZaehler };
  });
  expect(r).toEqual({ level: 4, bossAktiv: false, drops: 3, frame: 0 });
});

test('Einzug: Koerper aus Felssegmenten scrollt herein und haelt an, drei Augen und vier Roehren', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Inselboss, Fels, arrays, config, augen, state } = window.__ib;
    state.level = 4;
    window.__ib.Level.starteBoss();
    const imEinzug = [];
    for (let i = 0; i < 2000 && Inselboss.phase() !== 'kampf'; i++) {
      window.__ib.Loop.simulationsSchritt();
      if (augen().length) imEinzug.push(augen().every(a => a.istUnzerstoerbar && !a.offen));
    }
    const koerper = arrays.fels.filter(s => s.oben.bossIndex !== undefined);
    const unten = koerper.find(s => s.oben.bossIndex === 0);
    return {
      phase: Inselboss.phase(),
      tempo: Fels.holeTempo(),
      oberkante: Math.min(...koerper.map(s => s.y)),
      unterkante: unten.y + Fels.SEGMENT_HOEHE,
      soll: config.spielfeldHoehe * 0.45,
      augen: augen().length,
      roehren: arrays.feinde.filter(f => f.muster === 'roehre').length,
      zuImEinzug: imEinzug.every(Boolean),
      bossAktiv: state.bossAktiv,
    };
  });
  expect(r.phase).toBe('kampf');
  expect(r.tempo).toBe(0);
  // Bei stehendem Fels entstehen Segmente nur bis zum oberen Rand; der Koerper reicht darueber hinaus
  expect(r.oberkante).toBeLessThanOrEqual(0);
  expect(r.unterkante).toBeGreaterThanOrEqual(r.soll);
  expect(r.unterkante).toBeLessThan(r.soll + 3);
  expect(r).toMatchObject({ augen: 3, roehren: 4, zuImEinzug: true, bossAktiv: true });
});

test('Augen blinzeln, sind nur offen verwundbar und schiessen offen gezielt Sporen', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Loop, arrays, Anzeige, bisKampf, augen, Inselboss } = window.__ib;
    bisKampf();
    const a = augen()[0];
    a.phase = 'zu';
    a.phaseTimer = 1;
    const laser = () => {
      arrays.laserArray.push(
        Anzeige.erzeuge(
          {
            id: 'l_t' + Math.random(),
            x: a.x + a.groesse / 2 - 2,
            y: a.y + a.groesse + 2,
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
    };
    // zu: Treffer ohne Schaden
    a.phaseTimer = 50;
    let hp = a.hp;
    laser();
    Loop.simulationsSchritt();
    const zuSchaden = hp - a.hp;
    // oeffnen
    a.phaseTimer = 1;
    Loop.simulationsSchritt();
    const offen = { offen: a.offen, panzer: a.istUnzerstoerbar };
    hp = a.hp;
    laser();
    Loop.simulationsSchritt();
    const offenSchaden = hp - a.hp;
    arrays.feindLaserArray.length = 0;
    for (let i = 0; i < Inselboss.AUGE_SCHUSS + 1; i++) Loop.simulationsSchritt();
    const sporen = arrays.feindLaserArray.filter(l => l.spore);
    return { zuSchaden, offen, offenSchaden, sporen: sporen.length, nachUnten: sporen.every(s => s.vy > 0) };
  });
  expect(r.zuSchaden).toBe(0);
  expect(r.offen).toEqual({ offen: true, panzer: false });
  expect(r.offenSchaden).toBe(16);
  expect(r.sporen).toBeGreaterThanOrEqual(2);
  expect(r.nachUnten).toBe(true);
});

test('Erst das letzte Auge besiegt den Boss; vorher Enrage mit Vorruecken, danach scrollt der Koerper hinaus', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const { Loop, Utils, Fels, Inselboss, arrays, state, bisKampf, augen } = window.__ib;
    bisKampf();
    const [a1, a2, a3] = augen();
    const score = state.score;
    Utils.zerstoereZiel(a1);
    Loop.simulationsSchritt();
    const nachEins = { level: state.level, bossAktiv: state.bossAktiv, phase: Inselboss.phase() };
    Utils.zerstoereZiel(a2);
    Loop.simulationsSchritt();
    const enrage = { phase: Inselboss.phase(), tempo: Fels.holeTempo(), auge: a3.enragePhaseAktiv };
    Utils.zerstoereZiel(a3);
    Loop.simulationsSchritt();
    const sieg = {
      level: state.level,
      bossAktiv: state.bossAktiv,
      aktiv: Inselboss.istAktiv(),
      tempo: Fels.holeTempo(),
      roehrenLarven: arrays.feinde.filter(f => f.muster === 'roehre' || f.muster === 'larve').length,
      punkte: state.score - score > 0,
    };
    // Das Skelett zerplatzt sofort: kein Knochen-Segment mehr, Explosionspartikel im Feld
    return {
      nachEins,
      enrage,
      sieg,
      koerperDanach: arrays.fels.filter(s => s.oben.knochen).length,
      partikel: arrays.partikelArray.length > 0,
    };
  });
  expect(r.nachEins).toEqual({ level: 4, bossAktiv: true, phase: 'kampf' });
  expect(r.enrage).toEqual({ phase: 'enrage', tempo: 0.12, auge: true });
  expect(r.sieg).toEqual({ level: 5, bossAktiv: false, aktiv: false, tempo: 1.5, roehrenLarven: 0, punkte: true });
  expect(r.koerperDanach).toBe(0);
  expect(r.partikel).toBe(true);
});

test('Roehren werfen Larven aus (hoechstens MAX_LARVEN), Larven kriechen auf den Spieler zu', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { Loop, arrays, state, bisKampf } = window.__ib;
    const G = await import('./js/gewaechse.js');
    bisKampf();
    arrays.feinde.filter(f => f.muster === 'roehre').forEach(f => (f.phaseTimer = 1));
    Loop.simulationsSchritt();
    const larve = arrays.feinde.find(f => f.muster === 'larve');
    const abstand = () => Math.hypot(larve.x - state.x, larve.y - state.y);
    const vorher = abstand();
    for (let i = 0; i < 30; i++) Loop.simulationsSchritt();
    const naeher = abstand() < vorher;
    for (let i = 0; i < 2000; i++) {
      arrays.feinde.filter(f => f.muster === 'roehre').forEach(f => (f.phaseTimer = Math.min(f.phaseTimer, 2)));
      Loop.simulationsSchritt();
    }
    return {
      erste: !!larve,
      naeher,
      hoechstens: arrays.feinde.filter(f => f.muster === 'larve').length <= G.MAX_LARVEN,
    };
  });
  expect(r).toEqual({ erste: true, naeher: true, hoechstens: true });
});

test('Im Coop hat der Insel-Boss fuenf Augen (zweites Armpaar)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Utils, bisKampf, augen } = window.__ib;
    Utils.setGameMode('coop');
    bisKampf();
    return augen().length;
  });
  expect(r).toBe(5);
});

test('Online: Augen mit offen im Snapshot, Client zeigt Lid und Klasse, HP-Balken summiert alle Augen', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { arrays, state, bisKampf, augen } = window.__ib;
    const Network = await import('./js/network.js');
    bisKampf();
    const [a1, a2] = augen();
    a1.offen = true;
    a1.hp = 0.5 * a1.maxHp;
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    const gesendet = snap.bosses.map(b => ({ typ: b.typ, offen: b.offen }));
    arrays.bosses.forEach(b => b.el.remove());
    arrays.bosses.length = 0;
    const netz = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    state.network = netz;
    const c1 = arrays.bosses.find(b => b.id === a1.id);
    const c2 = arrays.bosses.find(b => b.id === a2.id);
    return {
      gesendet,
      lid: !!c1.el.querySelector('.auge-lid'),
      offen: c1.el.classList.contains('offen'),
      zu: c2.el.classList.contains('offen'),
      balken: parseFloat(document.getElementById('boss-hp-balken').style.width),
    };
  });
  expect(r.gesendet).toEqual([
    { typ: 'auge', offen: true },
    { typ: 'auge', offen: false },
    { typ: 'auge', offen: false },
  ]);
  expect(r).toMatchObject({ lid: true, offen: true, zu: false });
  expect(r.balken).toBeCloseTo((2.5 / 3) * 100, 0);
});

test('Bot zielt nur auf offene Augen', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { bisKampf, augen, config, arrays, Anzeige } = window.__ib;
    const Bot = await import('./js/bot.js');
    bisKampf();
    // nur die Augen als moegliche Ziele (Roehren waeren naeher)
    arrays.feinde.forEach(Anzeige.entferne);
    arrays.feinde.length = 0;
    const p2 = { x: config.spielfeldBreite / 2, y: 560 };
    augen().forEach(a => {
      a.istUnzerstoerbar = true;
    });
    const zu = Bot.findBestTarget(p2, { aimCorridor: 30 });
    const a = augen()[1];
    a.istUnzerstoerbar = false;
    const offen = Bot.findBestTarget(p2, { aimCorridor: 30 });
    return { zuBoss: !!(zu && zu.isBoss), offenX: offen && offen.x, augeX: a.x + a.groesse / 2 };
  });
  expect(r.zuBoss).toBe(false);
  expect(r.offenX).toBe(r.augeX);
});

test('Neustart beendet den Insel-Boss und setzt das Felstempo zurueck', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Utils, Fels, Inselboss, arrays, bisKampf } = window.__ib;
    bisKampf();
    Utils.restartGame();
    return {
      aktiv: Inselboss.istAktiv(),
      tempo: Fels.holeTempo(),
      fels: arrays.fels.length,
      bosse: arrays.bosses.length,
    };
  });
  expect(r).toEqual({ aktiv: false, tempo: 1.5, fels: 0, bosse: 0 });
});

test('Skelett: Augen sitzen an den Armspitzen und an der unteren Spitze und bewegen sich im Kampf nicht', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const { Loop, Fels, arrays, config, bisKampf, augen } = window.__ib;
    bisKampf();
    const c = config.spielfeldBreite / 2;
    const mitte = a => ({ x: a.x + a.groesse / 2, y: a.y + a.groesse / 2 });
    const lagen = augen().map(a => {
      const p = a.segment.oben;
      const m = mitte(a);
      if (a.seite === 'unten') return { art: 'unten', amRand: Math.abs(m.x - p.im) < 1 };
      const spitze = a.seite === 'rechts' ? p.im + p.ib / 2 : p.im - p.ib / 2;
      return { art: a.seite, amRand: Math.abs(m.x - spitze) < 10 && Math.abs(m.x - c) > 60 };
    });
    const vorher = augen().map(a => [a.x, a.y]);
    for (let i = 0; i < 120; i++) Loop.simulationsSchritt();
    const ruhig = augen().every((a, i) => a.x === vorher[i][0] && a.y === vorher[i][1]);
    const el = augen()[0].el;
    return {
      lagen: lagen.map(l => l.art).sort(),
      amRand: lagen.every(l => l.amRand),
      ruhig,
      tempo: Fels.holeTempo(),
      klasse: el.classList.contains('boss-auge'),
      animation: getComputedStyle(el).animationName,
      knochen: arrays.fels.filter(s => s.oben.knochen).every(s => !!s.el.querySelector('polygon.fels-knochen')),
    };
  });
  expect(r).toEqual({
    lagen: ['links', 'rechts', 'unten'],
    amRand: true,
    ruhig: true,
    tempo: 0,
    klasse: true,
    animation: 'none',
    knochen: true,
  });
});

test('Skelett laesst neben jedem Arm einen Durchgang von mindestens MIN_DURCHGANG frei', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Inselboss, Fels, config, Utils } = window.__ib;
    const ergebnis = [];
    for (const modus of ['single', 'coop']) {
      Utils.setGameMode(modus);
      const b = config.spielfeldBreite;
      for (const p of Inselboss.koerperProfil()) {
        ergebnis.push(Math.min(p.im - p.ib / 2, b - (p.im + p.ib / 2)) >= Fels.MIN_DURCHGANG);
      }
    }
    Utils.setGameMode('single');
    return ergebnis.every(Boolean);
  });
  expect(r).toBe(true);
});

test('Online: Knochen-Segmente tragen die Markierung im Profiltext, der Client zeichnet Knochen', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, state, bisKampf, Fels } = window.__ib;
    const Network = await import('./js/network.js');
    bisKampf();
    const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
    const knochenText = snap.fels.filter(f => f.p.split(',')[0].split(' ').length === 5).length;
    arrays.fels.forEach(s => s.el.remove());
    arrays.fels.length = 0;
    const netz = state.network;
    state.network = { isOnline: true, isHost: false, connected: true };
    Network.applyGameStateSnapshot(snap);
    state.network = netz;
    const client = arrays.fels.filter(s => s.oben.knochen);
    return {
      knochenText,
      client: client.length,
      polygon: client.every(s => !!s.el.querySelector('polygon.fels-knochen')),
      rundreise: Fels.profilAlsText(client[0]) === snap.fels.find(f => f.id === client[0].id).p,
    };
  });
  expect(r.knochenText).toBeGreaterThan(0);
  expect(r.client).toBe(r.knochenText);
  expect(r).toMatchObject({ polygon: true, rundreise: true });
});

test('Skelett ist spiegelsymmetrisch zur senkrechten Mittelachse (Profil und Augen)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { Inselboss, Utils, config, bisKampf, augen } = window.__ib;
    const c = config.spielfeldBreite / 2;
    const ergebnis = {};
    for (const modus of ['single', 'coop']) {
      Utils.setGameMode(modus);
      const profil = Inselboss.koerperProfil();
      ergebnis[modus] = {
        mittig: profil.every(p => p.im === config.spielfeldBreite / 2),
        augenPaare: profil.every(
          p => p.augen.filter(s => s === 'links').length === p.augen.filter(s => s === 'rechts').length,
        ),
      };
    }
    Utils.setGameMode('single');
    bisKampf();
    const mitten = augen().map(a => +(a.x + a.groesse / 2 - c).toFixed(3));
    const gespiegelt = mitten.every(d => mitten.some(e => Math.abs(e + d) < 0.01));
    return { ergebnis, gespiegelt, c };
  });
  expect(r.ergebnis).toEqual({
    single: { mittig: true, augenPaare: true },
    coop: { mittig: true, augenPaare: true },
  });
  expect(r.gespiegelt).toBe(true);
});
