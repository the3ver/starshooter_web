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
      hackProjektile: [], feindLaser: [], bossLaser: [], bossRaketen: [], bossBomben: [], powerups: []
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
