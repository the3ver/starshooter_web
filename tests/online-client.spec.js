const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

// Online-Client (Spieler 2): Snapshot-Anwendung und clientSchritt in einer Seite simulieren

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.route('**/api/turn*', route => route.fulfill({ status: 503, body: '' }));
  await setzeSpielstand(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
  // Client-Modus herstellen, ohne echte Verbindung (sendNetworkInput ist dann ein No-Op)
  await page.evaluate(() => {
    const { state, arrays } = window.__game;
    state.gameMode = 'online';
    state.spielLaeuft = true;
    state.pausiert = false;
    state.cutsceneAktiv = false;
    state.gameOverAktiv = false;
    state.bossWarningAktiv = false;
    state.network.isOnline = true;
    state.network.isHost = false;
    state.network.isClient = true;
    state.network.connected = true;
    ['feinde', 'asteroiden', 'bosses', 'powerups', 'laserArray', 'raketenArray', 'bombenArray',
      'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bossRaketenArray', 'bossBombenArray'].forEach(n => {
      arrays[n].forEach(o => { if (o.el) o.el.remove(); });
      arrays[n].length = 0;
    });
    window.__snapshot = (extra) => Object.assign({
      p1: { x: 200, y: 400, rotate: 0, leben: 3, energie: 50, maxEnergie: 50, isDead: false },
      p2: { x: 350, y: 400, rotate: 0, leben: 3, energie: 50, maxEnergie: 50, isDead: false },
      score: 0, level: 1, bossAktiv: false,
      feinde: [], asteroiden: [], bosses: [], laser: [], raketen: [], bomben: [],
      hackProjektile: [], feindLaser: [], bossLaser: [], bossRaketen: [], bossBomben: [], powerups: [], gleveWellen: []
    }, extra || {});
  });
});

test('Online-Client: Boss-Warnung aus dem Snapshot wird angezeigt, ausgeblendet und der Alarm nur beim Wechsel gespielt', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { simulationsSchritt } = await import('./js/loop.js');
    const overlay = document.getElementById('warning-overlay');
    const alarme = () => g.Audio.audioHistory.filter(e => e.name === 'bossAlert').length;
    const out = {};

    // Host serialisiert die Warnung
    g.state.bossWarningAktiv = true;
    out.serialisiert = g.Network.serializeGameState().bossWarningAktiv;
    g.state.bossWarningAktiv = false;

    g.Audio.clearAudioHistory();
    g.Network.applyGameStateSnapshot(window.__snapshot({ bossWarningAktiv: true }));
    out.anzeigeAn = overlay.style.display;
    g.Network.applyGameStateSnapshot(window.__snapshot({ bossWarningAktiv: true }));
    for (let i = 0; i < 150; i++) simulationsSchritt();
    out.alarmeNachZweitem = alarme();
    // Der Client erzeugt keinen eigenen Boss, das macht nur der Host
    out.bosseAufClient = g.arrays.bosses.length;
    out.anzeigeNachSchritten = overlay.style.display;

    g.Network.applyGameStateSnapshot(window.__snapshot({ bossWarningAktiv: false }));
    out.anzeigeAus = overlay.style.display;
    g.Network.applyGameStateSnapshot(window.__snapshot({ bossWarningAktiv: true }));
    out.alarmeNachNeuemWechsel = alarme();
    return out;
  });
  expect(r).toEqual({
    serialisiert: true,
    anzeigeAn: 'flex',
    alarmeNachZweitem: 1,
    bosseAufClient: 0,
    anzeigeNachSchritten: 'flex',
    anzeigeAus: 'none',
    alarmeNachNeuemWechsel: 2
  });
});

test('Online-Client: Waffenstufen beider Spieler aus dem Snapshot erscheinen im HUD', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const p1Hud = document.getElementById('aktive-powerups');
    const p2Hud = document.getElementById('aktive-powerups-p2');
    const out = {};

    // Host serialisiert die angezeigten Felder
    g.state.laserDurchschlag = true;
    g.state.p2.autolaserAktiv = true;
    const s = g.Network.serializeGameState();
    out.serialisiert = [s.p1.laserDurchschlag, s.p1.autolaserAktiv, s.p2.laserDurchschlag, s.p2.autolaserAktiv].map(v => v === true);
    g.state.laserDurchschlag = false;
    g.state.p2.autolaserAktiv = false;

    const snap = window.__snapshot();
    Object.assign(snap.p1, { laserStufe: 3, raketenStufe: 2, bombenStufe: 4, laserDurchschlag: true, autolaserAktiv: false });
    Object.assign(snap.p2, { laserStufe: 5, raketenStufe: 3, bombenStufe: 2, laserDurchschlag: false, autolaserAktiv: true });
    g.Network.applyGameStateSnapshot(snap);
    const icons = (el) => Array.from(el.querySelectorAll('.active-pu-icon:not(.pu-anim-lost)')).map(i => i.textContent);
    out.p1 = icons(p1Hud);
    out.p2 = icons(p2Hud);
    out.state = [g.state.laserStufe, g.state.raketenStufe, g.state.bombenStufe, g.state.p2.laserStufe, g.state.p2.raketenStufe, g.state.p2.bombenStufe];

    // Unveraenderter Snapshot baut das HUD nicht neu auf
    const obs = new MutationObserver(() => {});
    obs.observe(p1Hud, { childList: true, subtree: true });
    obs.observe(p2Hud, { childList: true, subtree: true });
    g.Network.applyGameStateSnapshot(JSON.parse(JSON.stringify(snap)));
    out.mutationen = obs.takeRecords().length;
    obs.disconnect();
    return out;
  });
  expect(r.serialisiert).toEqual([true, false, false, true]);
  expect(r.state).toEqual([3, 2, 4, 5, 3, 2]);
  expect(r.p1).toEqual(expect.arrayContaining(['L3', 'R2', 'B4', '↑']));
  expect(r.p2).toEqual(expect.arrayContaining(['L5', 'R3', 'B2', 'A']));
  expect(r.mutationen).toBe(0);
});

test('Online-Client: Traktorstrahl wird fuer geschleppte Powerups gezeichnet und wieder entfernt', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { simulationsSchritt } = await import('./js/loop.js');
    const strahlen = () => document.querySelectorAll('#spielfeld .tractor-beam-svg');
    const pu = (towedBy) => [{ id: 'pu_t', x: 210, y: 470, type: 'schild', owner: 'p2', towedBy }];
    const out = {};

    g.Network.applyGameStateSnapshot(window.__snapshot({ powerups: pu('p1') }));
    simulationsSchritt();
    out.anzahlGeschleppt = strahlen().length;
    const linien = strahlen()[0] ? strahlen()[0].querySelectorAll('line') : [];
    out.linien = linien.length;
    out.start = linien[0] ? [linien[0].getAttribute('x1'), linien[0].getAttribute('y1')] : null;
    out.ende = linien[0] ? [linien[0].getAttribute('x2'), linien[0].getAttribute('y2')] : null;
    out.towedBy = g.arrays.powerups[0].towedBy;

    g.Network.applyGameStateSnapshot(window.__snapshot({ powerups: pu(null) }));
    simulationsSchritt();
    out.anzahlLosgelassen = strahlen().length;

    g.Network.applyGameStateSnapshot(window.__snapshot({ powerups: pu('p2') }));
    simulationsSchritt();
    out.anzahlP2 = strahlen().length;
    g.Network.applyGameStateSnapshot(window.__snapshot({ powerups: [] }));
    simulationsSchritt();
    out.anzahlWeg = strahlen().length;
    return out;
  });
  const ss = 30; // config.spielerGroesse
  expect(r.anzahlGeschleppt).toBe(1);
  expect(r.linien).toBe(2);
  expect(r.towedBy).toBe('p1');
  expect(r.start.map(Number)).toEqual([200 + ss / 2, 400 + ss]);
  expect(r.ende.map(Number)).toEqual([210 + 12, 470 + 12]);
  expect(r.anzahlLosgelassen).toBe(0);
  expect(r.anzahlP2).toBe(1);
  expect(r.anzahlWeg).toBe(0);
});

test('Online-Client: Projektile fliegen zwischen Snapshots mit ihrer Geschwindigkeit weiter', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { arrays } = g;
    const { simulationsSchritt } = await import('./js/loop.js');
    const snap1 = window.__snapshot({
      laser: [{ id: 'l1', x: 50, y: 300, vx: 1, vy: 15, width: 4, height: 20, owner: 'p1', color: '#00ffff' }],
      feindLaser: [{ id: 'fl1', x: 100, y: 100, vx: 2, vy: 7 }],
      bossLaser: [{ id: 'bl1', x: 150, y: 120, vx: -1, vy: 6, width: 8, height: 25 }],
      bossRaketen: [{ id: 'br1', x: 220, y: 130, vx: 2, vy: 3, rot: 120 }],
      hackProjektile: [{ id: 'hp1', x: 130, y: 210 }],
      raketen: [{ id: 'r1', x: 60, y: 310, rot: 0, owner: 'p1', stufe: 1 }]
    });
    g.Network.applyGameStateSnapshot(snap1);
    // Zweiter Snapshot zwei Host-Schritte spaeter: Hack-Projektil hat sich um (6, 4) bewegt
    const snap2 = JSON.parse(JSON.stringify(snap1));
    snap2.laser[0].x = 52; snap2.laser[0].y = 270;
    snap2.feindLaser[0].x = 104; snap2.feindLaser[0].y = 114;
    snap2.bossLaser[0].x = 148; snap2.bossLaser[0].y = 132;
    snap2.bossRaketen[0].x = 224; snap2.bossRaketen[0].y = 136;
    snap2.hackProjektile[0].x = 136; snap2.hackProjektile[0].y = 214;
    snap2.raketen[0].y = 300;
    g.Network.applyGameStateSnapshot(snap2);
    simulationsSchritt();
    const pos = (liste) => [arrays[liste][0].x, arrays[liste][0].y, arrays[liste][0].el.style.left, arrays[liste][0].el.style.top];
    return {
      laser: pos('laserArray'),
      feindLaser: pos('feindLaserArray'),
      bossLaser: pos('bossLaserArray'),
      bossRakete: pos('bossRaketenArray'),
      hack: pos('hackProjektilArray'),
      rakete: pos('raketenArray')
    };
  });
  expect(r.laser).toEqual([53, 255, '53px', '255px']);
  expect(r.feindLaser).toEqual([106, 121, '106px', '121px']);
  expect(r.bossLaser).toEqual([147, 138, '147px', '138px']);
  expect(r.bossRakete).toEqual([226, 139, '226px', '139px']);
  expect(r.hack).toEqual([139, 216, '139px', '216px']);
  expect(r.rakete).toEqual([60, 295, '60px', '295px']);
});

test('Online: Gleve-Zustand und harmlos-Flag gehen in den Snapshot, Client zeigt Dash, Klinge und parierte Geschosse', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, arrays, dom } = g;
    const NK = await import('./js/netzkodierung.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    const out = {};

    // Host-Seite: Gleve-Felder nur fuer Gleve-Schiffe, harmlos nur bei weggeschleuderten Geschossen
    state.selectedShipModel = 'gleve';
    state.p2.selectedShipModel = 'viper';
    Object.assign(state, { gleveDashTimer: 5, gleveAbprallTimer: 0, gleveUnverwundbar: 13, gleveSweepTimer: 7, gleveSweepWinkel: -9, gleveSweepRichtung: 1 });
    g.Entities.erzeugeFeindLaser(100, 100);
    g.Entities.erzeugeFeindLaser(150, 100);
    arrays.feindLaserArray[0].harmlos = true;
    const voll = g.Network.serializeGameState();
    out.p1Felder = [voll.p1.gleveDashTimer, voll.p1.gleveUnverwundbar, voll.p1.gleveSweepTimer, voll.p1.gleveSweepWinkel, voll.p1.gleveSweepRichtung];
    out.p2OhneGleve = voll.p2.gleveSweepTimer === undefined;
    out.harmlos = voll.feindLaser.map(f => f.harmlos === true);
    // Ueber Kodierer/Dekodierer (Rundung) kommt alles an
    const paket = new NK.SnapshotKodierer().kodiere(voll, 0);
    const dek = new NK.SnapshotDekodierer().dekodiere(JSON.parse(JSON.stringify(paket)));
    out.dekodiert = [dek.p1.gleveDashTimer, dek.p1.gleveSweepWinkel, dek.p1.gleveSweepRichtung, dek.feindLaser[0].harmlos === true];
    arrays.feindLaserArray.forEach(o => o.el.remove());
    arrays.feindLaserArray.length = 0;
    Object.assign(state, { gleveDashTimer: 0, gleveUnverwundbar: 0, gleveSweepTimer: 0, gleveSweepWinkel: 0, gleveSweepRichtung: 0 });

    // Client-Seite: beide Schiffe sind Gleves
    state.p2.selectedShipModel = 'gleve';
    g.Audio.clearAudioHistory();
    const gleve = { gleveDashTimer: 5, gleveAbprallTimer: 0, gleveUnverwundbar: 13, gleveSweepTimer: 9, gleveSweepWinkel: -18, gleveSweepRichtung: 1 };
    const snap = window.__snapshot({
      feindLaser: [{ id: 'fl_1', x: 100, y: 100, vx: 9, vy: -1.5, harmlos: true }, { id: 'fl_2', x: 150, y: 100, vx: 0, vy: 7 }],
      bossLaser: [{ id: 'bl_1', x: 200, y: 100, vx: -9, vy: -1.5, width: 8, height: 25, harmlos: true }],
      hackProjektile: [{ id: 'hp_1', x: 250, y: 100, harmlos: true }]
    });
    Object.assign(snap.p1, gleve);
    g.Network.applyGameStateSnapshot(snap);
    simulationsSchritt();
    const klinge = document.querySelector('.gleve-klinge');
    out.client = {
      dashKlasse: dom.spieler.classList.contains('gleve-dash'),
      klinge: klinge ? klinge.style.transform : null,
      winkelDanach: state.gleveSweepWinkel,
      sounds: g.Audio.audioHistory.map(a => a.name).filter(n => n === 'dash' || n === 'sweep').sort(),
      pariert: [arrays.feindLaserArray[0].el.classList.contains('gleve-pariert'), arrays.feindLaserArray[1].el.classList.contains('gleve-pariert'),
        arrays.bossLaserArray[0].el.classList.contains('gleve-pariert'), arrays.hackProjektilArray[0].el.classList.contains('gleve-pariert')],
      farbe: arrays.feindLaserArray[0].el.style.backgroundColor
    };
    // Gleicher Zustand noch einmal: keine neuen Sounds
    g.Network.applyGameStateSnapshot(JSON.parse(JSON.stringify(snap)));
    out.soundsNachZweitem = g.Audio.audioHistory.filter(a => a.name === 'dash' || a.name === 'sweep').length;

    // Dash und Sweep vorbei: Klasse und Klinge weg
    const ende = window.__snapshot();
    Object.assign(ende.p1, gleve, { gleveDashTimer: 0, gleveSweepTimer: 0, gleveSweepWinkel: 22.5 });
    g.Network.applyGameStateSnapshot(ende);
    simulationsSchritt();
    out.ende = { dashKlasse: dom.spieler.classList.contains('gleve-dash'), klingen: document.querySelectorAll('.gleve-klinge').length };
    return out;
  });
  expect(r.p1Felder).toEqual([5, 13, 7, -9, 1]);
  expect(r.p2OhneGleve).toBe(true);
  expect(r.harmlos).toEqual([true, false]);
  expect(r.dekodiert).toEqual([5, -9, 1, true]);
  expect(r.client.dashKlasse).toBe(true);
  expect(r.client.klinge).toBe('rotate(-18deg)');
  // Stufe 1: 90-Grad-Bogen in 10 Frames, 9 Grad pro Schritt
  expect(r.client.winkelDanach).toBeCloseTo(-9, 5);
  expect(r.client.sounds).toEqual(['dash', 'sweep']);
  expect(r.client.pariert).toEqual([true, false, true, true]);
  expect(r.client.farbe).toBe('rgb(230, 126, 34)');
  expect(r.soundsNachZweitem).toBe(2);
  expect(r.ende).toEqual({ dashKlasse: false, klingen: 0 });
});

test('Online: Klingenwellen gehen in den Snapshot, Client zeigt .gleve-welle und entfernt sie wieder', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { arrays } = g;
    const NK = await import('./js/netzkodierung.js');
    const out = {};
    arrays.gleveWellen.push({ id: 'gw_1', x: 165.04, y: 298.3, breite: 70, hoehe: 14, owner: 'p1', schritte: 0, treffer: [], el: null });
    const voll = g.Network.serializeGameState();
    out.voll = voll.gleveWellen;
    const paket = new NK.SnapshotKodierer().kodiere(voll, 0);
    const dek = new NK.SnapshotDekodierer().dekodiere(JSON.parse(JSON.stringify(paket)));
    out.dekodiert = dek.gleveWellen;
    arrays.gleveWellen.length = 0;

    g.Network.applyGameStateSnapshot(window.__snapshot({ gleveWellen: out.dekodiert }));
    const el = document.querySelector('.gleve-welle');
    out.client = { anzahl: arrays.gleveWellen.length, dom: document.querySelectorAll('.gleve-welle').length, left: el && el.style.left, top: el && el.style.top, breite: el && el.style.width };
    g.Network.applyGameStateSnapshot(window.__snapshot({ gleveWellen: [{ id: 'gw_1', x: 165, y: 290, breite: 70, owner: 'p1' }] }));
    out.bewegt = [document.querySelectorAll('.gleve-welle').length, document.querySelector('.gleve-welle').style.top];
    g.Network.applyGameStateSnapshot(window.__snapshot());
    out.weg = [arrays.gleveWellen.length, document.querySelectorAll('.gleve-welle').length];
    return out;
  });
  expect(r.voll).toEqual([{ id: 'gw_1', x: 165.04, y: 298.3, breite: 70, owner: 'p1' }]);
  expect(r.dekodiert).toEqual([{ id: 'gw_1', x: 165, y: 298.3, breite: 70, owner: 'p1' }]);
  expect(r.client).toEqual({ anzahl: 1, dom: 1, left: '165px', top: '298.3px', breite: '70px' });
  expect(r.bewegt).toEqual([1, '290px']);
  expect(r.weg).toEqual([0, 0]);
});

test('Online: Dash-Ladungen gehen in den Snapshot (nur Gleve), Client zeigt Punkte und sagt ohne Ladung keinen Dash voraus', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const NK = await import('./js/netzkodierung.js');
    const Gleve = await import('./js/gleve.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    const out = {};

    // Host-Seite: nur Gleve-Schiffe senden gleveDashLadungen, ganzzahlig
    state.selectedShipModel = 'gleve';
    state.p2.selectedShipModel = 'viper';
    state.gleveDashLadungen = 1;
    const voll = g.Network.serializeGameState();
    out.p1 = voll.p1.gleveDashLadungen;
    out.p2OhneGleve = voll.p2.gleveDashLadungen === undefined;
    const paket = new NK.SnapshotKodierer().kodiere(voll, 0);
    const dek = new NK.SnapshotDekodierer().dekodiere(JSON.parse(JSON.stringify(paket)));
    out.dekodiert = dek.p1.gleveDashLadungen;

    // Client-Seite: eigenes Schiff (P2) ist eine Gleve
    state.selectedShipModel = 'viper';
    g.config.spielfeldBreite = 600;
    Object.assign(state.p2, {
      selectedShipModel: 'gleve', x: 300, y: 400, energie: 50, maxEnergie: 50, laserStufe: 1, raketenStufe: 1, raketenCooldown: 0, isDead: false, hacks: [],
      gleveDashTimer: 0, gleveAbprallTimer: 0, gleveDashTasteGehalten: false, gleveNetzAbprall: null
    });
    g.Utils.updateSchiffHudLabels();
    const gleveFelder = { gleveDashTimer: 0, gleveAbprallTimer: 0, gleveUnverwundbar: 0, gleveSweepTimer: 0, gleveSweepWinkel: 0, gleveSweepRichtung: 0 };
    const punkte = () => {
      const el = document.getElementById('dash-ladungen-p2');
      return [el.querySelectorAll('.dash-ladung').length, el.querySelectorAll('.dash-ladung.voll').length];
    };
    const mitLadungen = (n, cd) => {
      const snap = window.__snapshot();
      Object.assign(snap.p2, { raketenCooldown: cd, gleveDashLadungen: n }, gleveFelder);
      return snap;
    };

    g.Network.applyGameStateSnapshot(mitLadungen(0, 100));
    out.ohneLadung = { ladungen: state.p2.gleveDashLadungen, punkte: punkte(), pct: parseFloat(document.getElementById('raketen-cd-balken-p2').style.width), zahl: document.getElementById('btn-rakete-ladungen').textContent };
    state.tastenGedrueckt.k = true;
    simulationsSchritt();
    out.keinDash = { timer: state.p2.gleveDashTimer, y: state.p2.y, x: state.p2.x };
    state.tastenGedrueckt.k = false;
    simulationsSchritt();

    g.Network.applyGameStateSnapshot(mitLadungen(1, 100));
    out.eineLadung = { punkte: punkte(), zahl: document.getElementById('btn-rakete-ladungen').textContent };
    state.tastenGedrueckt.k = true;
    simulationsSchritt();
    out.dash = state.p2.gleveDashTimer;
    state.tastenGedrueckt.k = false;
    out.max = Gleve.dashMaxLadungen(state.p2);
    return out;
  });
  expect(r.p1).toBe(1);
  expect(r.p2OhneGleve).toBe(true);
  expect(r.dekodiert).toBe(1);
  expect(r.ohneLadung.ladungen).toBe(0);
  expect(r.ohneLadung.punkte).toEqual([r.max, 0]);
  expect(r.ohneLadung.pct).toBeCloseTo(100 - 100 / 180 * 100, 3);
  expect(r.ohneLadung.zahl).toBe('0');
  // Ohne Ladung kein vorhergesagter Dash
  expect(r.keinDash.timer).toBe(0);
  expect(r.eineLadung).toEqual({ punkte: [2, 1], zahl: '1' });
  expect(r.dash).toBeGreaterThan(0);
});

test('Online-Client: eigener Gleve-Dash (Raketen-Taste) wird lokal vorhergesagt, Abprall kommt vom Host', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, dom } = g;
    const { simulationsSchritt } = await import('./js/loop.js');
    const out = {};
    g.config.spielfeldBreite = 600; // wie in startOnlineGame
    state.selectedShipModel = 'viper';
    Object.assign(state.p2, {
      selectedShipModel: 'gleve', x: 300, y: 400, energie: 50, maxEnergie: 50, laserStufe: 1, raketenStufe: 1, raketenCooldown: 0, isDead: false, hacks: [],
      gleveDashLadungen: 2, gleveDashTimer: 0, gleveAbprallTimer: 0, gleveDashTasteGehalten: false, gleveNetzAbprall: null
    });
    g.Audio.clearAudioHistory();

    // Druck mit Richtung rechts: im ersten Schritt steht das Schiff, Paket traegt Start und Richtung
    state.tastenGedrueckt.k = true;
    state.tastenGedrueckt.d = true;
    simulationsSchritt();
    const paket = state.network.lastSentInput;
    out.start = { x: state.p2.x, paket: [paket.x, paket.y, paket.rakete, paket.laser, paket.rx, paket.ry], energie: state.p2.energie, cd: state.p2.raketenCooldown };
    state.tastenGedrueckt.k = false;
    state.tastenGedrueckt.d = false;
    simulationsSchritt();
    out.loslassenPaket = [state.network.lastSentInput.x, state.network.lastSentInput.rakete];
    out.klasseWaehrend = dom.spieler2.classList.contains('gleve-dash');
    for (let i = 0; i < 7; i++) simulationsSchritt();
    out.ende = { x: state.p2.x, y: state.p2.y, klasse: dom.spieler2.classList.contains('gleve-dash'), dashSounds: g.Audio.audioHistory.filter(a => a.name === 'dash').length };
    simulationsSchritt();
    out.danach = { x: state.p2.x, paketX: state.network.lastSentInput.x };

    // Host meldet Abprall: Client gleitet zur Host-Position und uebernimmt am Ende den Landepunkt
    const abprall = window.__snapshot();
    Object.assign(abprall.p2, { x: 360, y: 440, gleveDashTimer: 0, gleveAbprallTimer: 6, gleveUnverwundbar: 30, gleveSweepTimer: 0, gleveSweepWinkel: 0, gleveSweepRichtung: 0 });
    g.Network.applyGameStateSnapshot(abprall);
    simulationsSchritt();
    out.gleiten = { x: state.p2.x, y: state.p2.y, klasse: dom.spieler2.classList.contains('gleve-dash') };
    const gelandet = window.__snapshot();
    Object.assign(gelandet.p2, { x: 365, y: 445, gleveDashTimer: 0, gleveAbprallTimer: 0, gleveUnverwundbar: 25, gleveSweepTimer: 0, gleveSweepWinkel: 0, gleveSweepRichtung: 0 });
    g.Network.applyGameStateSnapshot(gelandet);
    out.landung = { x: state.p2.x, y: state.p2.y };
    simulationsSchritt();
    out.wiederFrei = dom.spieler2.classList.contains('gleve-dash');
    return out;
  });
  expect(r.start.x).toBe(300);
  expect(r.start.paket).toEqual([300, 400, true, false, 1, 0]);
  // Dash kostet keine Energie, sondern startet den Cooldown (Stufe 1: 180)
  expect(r.start.energie).toBeCloseTo(50, 5);
  expect(r.start.cd).toBe(180);
  // Waehrend des Dashs bleibt die gemeldete Position der Startpunkt
  expect(r.loslassenPaket).toEqual([300, false]);
  expect(r.klasseWaehrend).toBe(true);
  expect(r.ende.x).toBeCloseTo(400, 5);
  expect(r.ende.y).toBeCloseTo(400, 5);
  expect(r.ende.klasse).toBe(false);
  expect(r.ende.dashSounds).toBe(1);
  // Nach dem Dash steuert und meldet der Client wieder seine echte Position
  expect(r.danach.x).toBeCloseTo(400, 5);
  expect(r.danach.paketX).toBe(400);
  expect(r.gleiten.x).toBeCloseTo(380, 5);
  expect(r.gleiten.y).toBeCloseTo(420, 5);
  expect(r.gleiten.klasse).toBe(true);
  expect(r.landung).toEqual({ x: 365, y: 445 });
  expect(r.wiederFrei).toBe(false);
});

test('Online-Client: Gegner und Host-Schiff gleiten zur neuen Snapshot-Position statt zu springen', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { arrays, dom } = g;
    const { simulationsSchritt } = await import('./js/loop.js');
    const feind = (y) => [{ id: 'f1', x: 100, y, hp: 3, maxHp: 3, groesse: 30, typ: 1, muster: 'normal' }];
    const p1 = (x) => ({ x, y: 400, rotate: 0, leben: 3, energie: 50, maxEnergie: 50, isDead: false });
    const out = {};

    g.Network.applyGameStateSnapshot(window.__snapshot({ p1: p1(200), feinde: feind(50) }));
    out.start = [arrays.feinde[0].el.style.top, dom.spieler.style.left];
    g.Network.applyGameStateSnapshot(window.__snapshot({ p1: p1(210), feinde: feind(60) }));
    out.direktNachSnapshot = [arrays.feinde[0].el.style.top, dom.spieler.style.left];
    simulationsSchritt();
    out.schritt1 = [arrays.feinde[0].el.style.top, dom.spieler.style.left];
    simulationsSchritt();
    out.schritt2 = [arrays.feinde[0].el.style.top, dom.spieler.style.left];
    simulationsSchritt();
    out.schritt3 = [arrays.feinde[0].el.style.top, dom.spieler.style.left];
    // Logische Position folgt sofort dem Snapshot
    out.logisch = [arrays.feinde[0].y, g.state.x];

    // Grosser Sprung (Respawn/Teleport): sofort uebernehmen
    g.Network.applyGameStateSnapshot(window.__snapshot({ p1: p1(500), feinde: feind(400) }));
    out.sprung = [arrays.feinde[0].el.style.top, dom.spieler.style.left];
    return out;
  });
  expect(r.start).toEqual(['50px', '200px']);
  expect(r.direktNachSnapshot).toEqual(['50px', '200px']);
  expect(r.schritt1).toEqual(['55px', '205px']);
  expect(r.schritt2).toEqual(['60px', '210px']);
  expect(r.schritt3).toEqual(['60px', '210px']);
  expect(r.logisch).toEqual([60, 210]);
  expect(r.sprung).toEqual(['400px', '500px']);
});

// ---------------------------------------------------------------------------------------------
// Spectre-SR online (S5a): Snapshot-Felder, Darstellung beim Client, Eingaben

test('Online: Sniper-Felder gehen nur fuer Sniper in den Snapshot (Granatenliste sonst leer) und ueberstehen Kodierer/Dekodierer (gerundet)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, arrays } = g;
    const NK = await import('./js/netzkodierung.js');
    const Sniper = await import('./js/sniper.js');
    const out = {};
    state.selectedShipModel = 'sniper';
    state.p2.selectedShipModel = 'viper';
    Object.assign(state, { sniperZielX: 123.456, sniperZielY: 99.04, sniperLadung: 45.4, sniperCooldown: 17.6, x: 108, y: 319 });
    g.Entities.erzeugeFeind(100, 100, 'normal', 0, false);
    g.Entities.erzeugeFeind(200, 100, 'normal', 0, false);
    arrays.feinde[0].betaeubt = 33.4;
    const voll = g.Network.serializeGameState();
    out.p1 = ['sniperZielX', 'sniperZielY', 'sniperLadung', 'sniperVoll', 'sniperCooldown'].every(k => k in voll.p1);
    out.p2Ohne = Object.keys(voll.p2).filter(k => k.startsWith('sniper')).length;
    out.liste = Array.isArray(voll.sniperGranaten);
    out.betaeubtNurWenn = [voll.feinde[0].betaeubt, 'betaeubt' in voll.feinde[1]];
    // Ohne Sniper keine Sniper-Felder und keine Granatenliste
    state.selectedShipModel = 'viper';
    const ohne = g.Network.serializeGameState();
    out.ohneSniper = [Object.keys(ohne.p1).filter(k => k.startsWith('sniper')).length, ohne.sniperGranaten.length];
    state.selectedShipModel = 'sniper';
    // Granate im Flug: Eintrag mit Id, Position, Besitzer, Flugfortschritt
    Sniper.werfeGranate(state, 'p1');
    const mitGranate = g.Network.serializeGameState();
    out.granate = mitGranate.sniperGranaten.map(x => ({ id: typeof x.id, owner: x.owner, rest: x.rest, hatPos: Number.isFinite(x.x) && Number.isFinite(x.y) }));
    // Kodierer -> Dekodierer
    const k = new NK.SnapshotKodierer();
    const dek = new NK.SnapshotDekodierer().dekodiere(JSON.parse(JSON.stringify(k.kodiere(mitGranate, 0))));
    out.dekodiert = [dek.p1.sniperZielX, dek.p1.sniperZielY, dek.p1.sniperLadung, dek.p1.sniperCooldown, dek.feinde[0].betaeubt, dek.sniperGranaten.length];
    out.protokoll = NK.PROTOKOLL_VERSION;
    Sniper.setzeZurueck(state);
    return out;
  });
  expect(r.p1).toBe(true);
  expect(r.p2Ohne).toBe(0);
  expect(r.liste).toBe(true);
  expect(r.betaeubtNurWenn).toEqual([33.4, false]);
  expect(r.ohneSniper).toEqual([0, 0]);
  expect(r.granate).toEqual([{ id: 'string', owner: 'p1', rest: 30, hatPos: true }]);
  expect(r.dekodiert).toEqual([123.5, 99, 45, 18, 33, 1]);
  expect(r.protokoll).toBe(11);
});

test('Online-Client: Fadenkreuz an der Host-Position, Ladering bei Ladung, Strahl beim Schuss, Sounds nur fuers eigene Schiff', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const { state } = g;
    const out = {};
    state.selectedShipModel = 'sniper';
    state.p2.selectedShipModel = 'sniper';
    const snap = (p1, p2) => {
      const s = window.__snapshot();
      Object.assign(s.p1, { laserStufe: 1 }, p1);
      Object.assign(s.p2, { laserStufe: 1 }, p2);
      return s;
    };
    const z = (x, y, ladung, cd) => ({ sniperZielX: x, sniperZielY: y, sniperLadung: ladung, sniperVoll: ladung >= 90, sniperCooldown: cd });
    g.Audio.clearAudioHistory();
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 0, 0), z(350, 180, 0, 0)));
    const k1 = document.querySelector('.sniper-fadenkreuz-p1');
    const k2 = document.querySelector('.sniper-fadenkreuz-p2');
    out.kreuze = document.querySelectorAll('.sniper-fadenkreuz').length;
    out.p1Mitte = [parseFloat(k1.style.left) + parseFloat(k1.style.width) / 2, parseFloat(k1.style.top) + parseFloat(k1.style.height) / 2];
    out.p2Mitte = [parseFloat(k2.style.left) + parseFloat(k2.style.width) / 2, parseFloat(k2.style.top) + parseFloat(k2.style.height) / 2];
    out.ringAus = !k1.querySelector('.sniper-ladering') || k1.querySelector('.sniper-ladering').style.display === 'none';

    // Ladung 50: Ring sichtbar und groesser als der Trefferkreis, noch nicht voll
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 50, 0), z(350, 180, 50, 0)));
    const ring = k1.querySelector('.sniper-ladering');
    out.ring = { an: ring.style.display, breite: parseFloat(ring.style.width), voll: ring.classList.contains('voll') };
    // Voll: Klasse voll, Ton nur fuer das eigene Schiff (P2) und nur einmal
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 90, 0), z(350, 180, 90, 0)));
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 90, 0), z(350, 180, 90, 0)));
    out.voll = k1.querySelector('.sniper-ladering').classList.contains('voll');
    out.vollTon = g.Audio.audioHistory.filter(a => a.name === 'sniperVoll').length;

    // Schuss: Cooldown springt hoch, Ladung ist zurueck auf 0 -> ein Strahl pro Schiff, breit wegen der Ladung
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 0, 24), z(350, 180, 0, 24)));
    const strahlen = [...document.querySelectorAll('.sniper-strahl')];
    out.strahlen = strahlen.length;
    out.breit = strahlen.every(s => parseFloat(s.style.width) > 8);
    out.schussTon = g.Audio.audioHistory.filter(a => a.name === 'sniperSchuss').length;
    out.ringWeg = k1.querySelector('.sniper-ladering').style.display;
    // Sinkender Cooldown: kein weiterer Strahl
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 0, 22), z(350, 180, 0, 22)));
    out.strahlenDanach = document.querySelectorAll('.sniper-strahl').length;

    // Tod des Hosts und Schiffswechsel: Fadenkreuz weg
    g.Network.applyGameStateSnapshot(snap(Object.assign(z(123.4, 99.2, 0, 0), { isDead: true }), z(350, 180, 0, 0)));
    out.nachTod = document.querySelectorAll('.sniper-fadenkreuz-p1').length;
    state.p2.selectedShipModel = 'viper';
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 0, 0), {}));
    out.nachWechsel = document.querySelectorAll('.sniper-fadenkreuz-p2').length;
    return out;
  });
  expect(r.kreuze).toBe(2);
  expect(r.p1Mitte).toEqual([123.4, 99.2]);
  expect(r.p2Mitte).toEqual([350, 180]);
  expect(r.ringAus).toBe(true);
  expect(r.ring.an).toBe('block');
  expect(r.ring.breite).toBeGreaterThan(12);
  expect(r.ring.voll).toBe(false);
  expect(r.voll).toBe(true);
  expect(r.vollTon).toBe(1);
  expect(r.strahlen).toBe(2);
  expect(r.breit).toBe(true);
  expect(r.schussTon).toBe(1);
  expect(r.ringWeg).toBe('none');
  expect(r.strahlenDanach).toBe(2);
  expect(r.nachTod).toBe(0);
  expect(r.nachWechsel).toBe(0);
});

test('Online-Client: Granate im Flug, Druckwelle per Ereignis, betaeubte Gegner mit Klasse, Granaten-HUD', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, arrays } = g;
    const { simulationsSchritt } = await import('./js/loop.js');
    const out = {};
    state.selectedShipModel = 'sniper';
    state.p2.selectedShipModel = 'sniper';
    const feind = (bet) => ({ id: 'f_1', x: 100, y: 100, hp: 30, maxHp: 30, groesse: 30, typ: 1, muster: 'normal', hatSchild: false, schildHp: 0, ...(bet ? { betaeubt: bet } : {}) });
    const boss = (bet) => ({ id: 'boss_1', x: 200, y: 50, hp: 400, maxHp: 400, groesse: 100, typ: 1, enrage: false, ...(bet ? { betaeubt: bet } : {}) });

    // Granate: erscheint, bewegt sich mit dem Snapshot, verschwindet wieder
    g.Network.applyGameStateSnapshot(window.__snapshot({ sniperGranaten: [{ id: 'sg_1', x: 150, y: 250, owner: 'p2', rest: 20 }] }));
    const el = document.querySelector('.sniper-granate');
    out.granate = [document.querySelectorAll('.sniper-granate').length, parseFloat(el.style.left) + 7, parseFloat(el.style.top) + 7];
    g.Network.applyGameStateSnapshot(window.__snapshot({ sniperGranaten: [{ id: 'sg_1', x: 160, y: 230, owner: 'p2', rest: 18 }] }));
    out.bewegt = [document.querySelectorAll('.sniper-granate').length, parseFloat(el.style.left) + 7, parseFloat(el.style.top) + 7, el.isConnected];
    g.Network.applyGameStateSnapshot(window.__snapshot({ sniperGranaten: [] }));
    out.weg = document.querySelectorAll('.sniper-granate').length;

    // Druckwelle ueber Ereignis, waechst mit den Client-Schritten und verschwindet
    g.Audio.clearAudioHistory();
    g.Network.handleNetworkEvent({ type: 'granate_detonated', x: 160, y: 200, radius: 90, owner: 'p1' }, 'host');
    out.welleDa = document.querySelectorAll('.sniper-druckwelle').length;
    out.granateTon = g.Audio.audioHistory.filter(a => a.name === 'granate').length;
    simulationsSchritt(); simulationsSchritt(); simulationsSchritt();
    const welle = document.querySelector('.sniper-druckwelle');
    out.welleBreit = parseFloat(welle.style.width);
    for (let i = 0; i < 20; i++) simulationsSchritt();
    out.welleWeg = document.querySelectorAll('.sniper-druckwelle').length;
    // Unsinnige Ereignisse werden ignoriert
    g.Network.handleNetworkEvent({ type: 'granate_detonated', x: 'a', y: null, radius: -3 }, 'host');
    out.unsinn = document.querySelectorAll('.sniper-druckwelle').length;

    // Betaeubung: Klasse an Feind und Boss, nach dem Snapshot ohne Feld wieder weg
    g.Network.applyGameStateSnapshot(window.__snapshot({ feinde: [feind(40)], bosses: [boss(30)] }));
    out.betaeubt = [arrays.feinde[0].el.classList.contains('betaeubt'), arrays.bosses[0].el.classList.contains('betaeubt')];
    g.Network.applyGameStateSnapshot(window.__snapshot({ feinde: [feind(0)], bosses: [boss(0)] }));
    out.vorbei = [arrays.feinde[0].el.classList.contains('betaeubt'), arrays.bosses[0].el.classList.contains('betaeubt')];

    // Granaten-HUD: Cooldown-Balken des eigenen Schiffs nutzt den Granaten-Cooldown (Stufe 1: 240)
    const s = window.__snapshot();
    Object.assign(s.p2, { laserStufe: 1, raketenStufe: 1, raketenCooldown: 120, sniperZielX: 350, sniperZielY: 180, sniperLadung: 0, sniperVoll: false, sniperCooldown: 0 });
    g.Network.applyGameStateSnapshot(s);
    out.hud = document.getElementById('raketen-cd-balken-p2').style.width;
    return out;
  });
  expect(r.granate).toEqual([1, 150, 250]);
  expect(r.bewegt).toEqual([1, 160, 230, true]);
  expect(r.weg).toBe(0);
  expect(r.welleDa).toBe(1);
  expect(r.granateTon).toBe(1);
  expect(r.welleBreit).toBeGreaterThan(0);
  expect(r.welleWeg).toBe(0);
  expect(r.unsinn).toBe(0);
  expect(r.betaeubt).toEqual([true, true]);
  expect(r.vorbei).toEqual([false, false]);
  expect(r.hud).toBe('50%');
});

test('Online-Client: Eingabe-Paket traegt Lade-Knopf als Laser, Joystick-Autofeuer als auto, Taste L ohne auto', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const NK = await import('./js/netzkodierung.js');
    const keys = state.tastenGedrueckt;
    Object.keys(keys).forEach(k => { keys[k] = false; });
    state.p2.selectedShipModel = 'sniper';
    const lies = () => { const e = g.Network.serializePlayerInput(); return { laser: e.laser, auto: e.auto === true }; };
    const out = {};
    out.ruhe = lies();
    keys.l = true;
    out.taste = lies();
    keys.l = false;
    state.sniperLadeKnopf = true;
    out.knopf = lies();
    state.sniperLadeKnopf = false;
    state.joystick.active = true; state.joystick.feuert = true; keys.l = true; // wie input.js beim Joystick-touchstart
    out.joystick = lies();
    state.sniperLadeKnopf = true;
    out.joystickUndKnopf = lies();
    state.sniperLadeKnopf = false;
    state.joystick.active = false; state.joystick.feuert = false; keys.l = false;
    // Anderes Schiff: nie auto, Knopf zaehlt nicht
    state.p2.selectedShipModel = 'viper';
    state.joystick.feuert = true; keys.l = true;
    out.viper = lies();
    state.joystick.feuert = false; keys.l = false;
    // Der Sender schickt auto nur wenn gesetzt, eine Aenderung geht sofort raus
    const s = new NK.EingabeSender();
    const basis = { x: 1, y: 2, rotate: 0, laser: true, rakete: false, bombe: false };
    const a = s.naechstes(basis);
    const b = s.naechstes(basis);
    const c = s.naechstes({ ...basis, auto: true });
    const d = s.naechstes({ ...basis, auto: true });
    out.sender = [a && 'auto' in a, b, c && c.auto, d];
    return out;
  });
  expect(r.ruhe).toEqual({ laser: false, auto: false });
  expect(r.taste).toEqual({ laser: true, auto: false });
  expect(r.knopf).toEqual({ laser: true, auto: false });
  expect(r.joystick).toEqual({ laser: true, auto: true });
  expect(r.joystickUndKnopf).toEqual({ laser: true, auto: false });
  expect(r.viper).toEqual({ laser: true, auto: false });
  expect(r.sender).toEqual([false, null, true, null]);
});

test('Online-Client: eigenes Fadenkreuz folgt dem vorhergesagten Schiff (ohne Auto-Zielen), mit Auto-Zielen gilt der Host-Wert', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const { simulationsSchritt } = await import('./js/loop.js');
    const keys = state.tastenGedrueckt;
    Object.keys(keys).forEach(k => { keys[k] = false; });
    state.p2.selectedShipModel = 'sniper';
    const s = window.__snapshot();
    Object.assign(s.p2, { laserStufe: 1, sniperZielX: 365, sniperZielY: 180, sniperLadung: 0, sniperVoll: false, sniperCooldown: 0 });
    g.Network.applyGameStateSnapshot(s);
    simulationsSchritt();
    const out = {};
    const stand = state.p2.x;
    keys.a = true;
    for (let i = 0; i < 10; i++) simulationsSchritt();
    keys.a = false;
    out.gelaufen = state.p2.x < stand;
    out.folgt = [state.p2.sniperZielX, state.p2.x + 15];
    // Stufe 4: Host-Wert bleibt stehen
    const s4 = window.__snapshot();
    Object.assign(s4.p2, { laserStufe: 4, sniperZielX: 300, sniperZielY: 150, sniperLadung: 0, sniperVoll: false, sniperCooldown: 0 });
    g.Network.applyGameStateSnapshot(s4);
    simulationsSchritt();
    out.auto = [state.p2.sniperZielX, state.p2.sniperZielY];
    return out;
  });
  expect(r.gelaufen).toBe(true);
  expect(r.folgt[0]).toBeCloseTo(r.folgt[1], 5);
  expect(r.auto).toEqual([300, 150]);
});
