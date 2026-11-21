const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helfer');

// Online-Client (Spieler 2): Snapshot-Anwendung und clientSchritt in einer Seite simulieren

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await page.route('**/api/turn*', route => route.fulfill({ status: 503, body: '' }));
  await setGameState(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
  // Client-Modus herstellen, ohne echte Verbindung (sendNetworkInput ist dann ein No-Op)
  await page.evaluate(() => {
    const { state, arrays } = window.__game;
    state.gameMode = 'online';
    state.gameRunning = true;
    state.paused = false;
    state.cutsceneActive = false;
    state.gameOverActive = false;
    state.bossWarningActive = false;
    state.network.isOnline = true;
    state.network.isHost = false;
    state.network.isClient = true;
    state.network.connected = true;
    [
      'enemies',
      'asteroids',
      'bosses',
      'powerups',
      'laserArray',
      'missileArray',
      'bombArray',
      'enemyLaserArray',
      'hackProjectileArray',
      'bossLaserArray',
      'bossMissileArray',
      'bossBombArray',
    ].forEach(n => {
      arrays[n].forEach(o => {
        if (o.el) o.el.remove();
      });
      arrays[n].length = 0;
    });
    window.__snapshot = extra =>
      Object.assign(
        {
          p1: { x: 200, y: 400, rotate: 0, lives: 3, energy: 50, maxEnergy: 50, isDead: false },
          p2: { x: 350, y: 400, rotate: 0, lives: 3, energy: 50, maxEnergy: 50, isDead: false },
          score: 0,
          level: 1,
          bossActive: false,
          enemies: [],
          asteroids: [],
          bosses: [],
          laser: [],
          missiles: [],
          bombs: [],
          hackProjectiles: [],
          enemyLaser: [],
          bossLaser: [],
          bossMissiles: [],
          bossBombs: [],
          powerups: [],
          gleveWaves: [],
        },
        extra || {},
      );
  });
});

test('Online-Client: Boss-Warnung aus dem Snapshot wird angezeigt, ausgeblendet und der Alarm nur beim Wechsel gespielt', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { simulationStep } = await import('./js/loop.js');
    const overlay = document.getElementById('warning-overlay');
    const alarms = () => g.Audio.audioHistory.filter(e => e.name === 'bossAlert').length;
    const out = {};

    // Host serialisiert die Warnung
    g.state.bossWarningActive = true;
    out.serialized = g.Network.serializeGameState().bossWarningActive;
    g.state.bossWarningActive = false;

    g.Audio.clearAudioHistory();
    g.Network.applyGameStateSnapshot(window.__snapshot({ bossWarningActive: true }));
    out.displayOn = overlay.style.display;
    g.Network.applyGameStateSnapshot(window.__snapshot({ bossWarningActive: true }));
    for (let i = 0; i < 150; i++) simulationStep();
    out.alarmsAfterSecond = alarms();
    // Der Client erzeugt keinen eigenen Boss, das macht nur der Host
    out.bossesOnClient = g.arrays.bosses.length;
    out.displayAfterSteps = overlay.style.display;

    g.Network.applyGameStateSnapshot(window.__snapshot({ bossWarningActive: false }));
    out.displayOff = overlay.style.display;
    g.Network.applyGameStateSnapshot(window.__snapshot({ bossWarningActive: true }));
    out.alarmsAfterNewSwitch = alarms();
    return out;
  });
  expect(r).toEqual({
    serialized: true,
    displayOn: 'flex',
    alarmsAfterSecond: 1,
    bossesOnClient: 0,
    displayAfterSteps: 'flex',
    displayOff: 'none',
    alarmsAfterNewSwitch: 2,
  });
});

test('Online-Client: Waffenstufen beider Spieler aus dem Snapshot erscheinen im HUD', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const p1Hud = document.getElementById('aktive-powerups');
    const p2Hud = document.getElementById('aktive-powerups-p2');
    const out = {};

    // Host serialisiert die angezeigten Felder
    g.state.laserPierce = true;
    g.state.p2.autolaserActive = true;
    const s = g.Network.serializeGameState();
    out.serialized = [s.p1.laserPierce, s.p1.autolaserActive, s.p2.laserPierce, s.p2.autolaserActive].map(
      v => v === true,
    );
    g.state.laserPierce = false;
    g.state.p2.autolaserActive = false;

    const snap = window.__snapshot();
    Object.assign(snap.p1, {
      laserTier: 3,
      missileTier: 2,
      bombTier: 4,
      laserPierce: true,
      autolaserActive: false,
    });
    Object.assign(snap.p2, {
      laserTier: 5,
      missileTier: 3,
      bombTier: 2,
      laserPierce: false,
      autolaserActive: true,
    });
    g.Network.applyGameStateSnapshot(snap);
    const icons = el => Array.from(el.querySelectorAll('.active-pu-icon:not(.pu-anim-lost)')).map(i => i.textContent);
    out.p1 = icons(p1Hud);
    out.p2 = icons(p2Hud);
    out.state = [
      g.state.laserTier,
      g.state.missileTier,
      g.state.bombTier,
      g.state.p2.laserTier,
      g.state.p2.missileTier,
      g.state.p2.bombTier,
    ];

    // Unveraenderter Snapshot baut das HUD nicht neu auf
    const obs = new MutationObserver(() => {});
    obs.observe(p1Hud, { childList: true, subtree: true });
    obs.observe(p2Hud, { childList: true, subtree: true });
    g.Network.applyGameStateSnapshot(JSON.parse(JSON.stringify(snap)));
    out.mutations = obs.takeRecords().length;
    obs.disconnect();
    return out;
  });
  expect(r.serialized).toEqual([true, false, false, true]);
  expect(r.state).toEqual([3, 2, 4, 5, 3, 2]);
  expect(r.p1).toEqual(expect.arrayContaining(['L3', 'R2', 'B4', '↑']));
  expect(r.p2).toEqual(expect.arrayContaining(['L5', 'R3', 'B2', 'A']));
  expect(r.mutations).toBe(0);
});

test('Online-Client: Traktorstrahl wird fuer geschleppte Powerups gezeichnet und wieder entfernt', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { simulationStep } = await import('./js/loop.js');
    const beams = () => document.querySelectorAll('#spielfeld .tractor-beam-svg');
    const pu = towedBy => [{ id: 'pu_t', x: 210, y: 470, type: 'shield', owner: 'p2', towedBy }];
    const out = {};

    g.Network.applyGameStateSnapshot(window.__snapshot({ powerups: pu('p1') }));
    simulationStep();
    out.countTowed = beams().length;
    const lines = beams()[0] ? beams()[0].querySelectorAll('line') : [];
    out.lines = lines.length;
    out.start = lines[0] ? [lines[0].getAttribute('x1'), lines[0].getAttribute('y1')] : null;
    out.end = lines[0] ? [lines[0].getAttribute('x2'), lines[0].getAttribute('y2')] : null;
    out.towedBy = g.arrays.powerups[0].towedBy;

    g.Network.applyGameStateSnapshot(window.__snapshot({ powerups: pu(null) }));
    simulationStep();
    out.countReleased = beams().length;

    g.Network.applyGameStateSnapshot(window.__snapshot({ powerups: pu('p2') }));
    simulationStep();
    out.countP2 = beams().length;
    g.Network.applyGameStateSnapshot(window.__snapshot({ powerups: [] }));
    simulationStep();
    out.countGone = beams().length;
    return out;
  });
  const ss = 30; // config.spielerGroesse
  expect(r.countTowed).toBe(1);
  expect(r.lines).toBe(2);
  expect(r.towedBy).toBe('p1');
  expect(r.start.map(Number)).toEqual([200 + ss / 2, 400 + ss]);
  expect(r.end.map(Number)).toEqual([210 + 12, 470 + 12]);
  expect(r.countReleased).toBe(0);
  expect(r.countP2).toBe(1);
  expect(r.countGone).toBe(0);
});

test('Online-Client: Projektile fliegen zwischen Snapshots mit ihrer Geschwindigkeit weiter', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { arrays } = g;
    const { simulationStep } = await import('./js/loop.js');
    const snap1 = window.__snapshot({
      laser: [{ id: 'l1', x: 50, y: 300, vx: 1, vy: 15, width: 4, height: 20, owner: 'p1', color: '#00ffff' }],
      enemyLaser: [{ id: 'fl1', x: 100, y: 100, vx: 2, vy: 7 }],
      bossLaser: [{ id: 'bl1', x: 150, y: 120, vx: -1, vy: 6, width: 8, height: 25 }],
      bossMissiles: [{ id: 'br1', x: 220, y: 130, vx: 2, vy: 3, rot: 120 }],
      hackProjectiles: [{ id: 'hp1', x: 130, y: 210 }],
      missiles: [{ id: 'r1', x: 60, y: 310, rot: 0, owner: 'p1', tier: 1 }],
    });
    g.Network.applyGameStateSnapshot(snap1);
    // Zweiter Snapshot zwei Host-Schritte spaeter: Hack-Projektil hat sich um (6, 4) bewegt
    const snap2 = JSON.parse(JSON.stringify(snap1));
    snap2.laser[0].x = 52;
    snap2.laser[0].y = 270;
    snap2.enemyLaser[0].x = 104;
    snap2.enemyLaser[0].y = 114;
    snap2.bossLaser[0].x = 148;
    snap2.bossLaser[0].y = 132;
    snap2.bossMissiles[0].x = 224;
    snap2.bossMissiles[0].y = 136;
    snap2.hackProjectiles[0].x = 136;
    snap2.hackProjectiles[0].y = 214;
    snap2.missiles[0].y = 300;
    g.Network.applyGameStateSnapshot(snap2);
    simulationStep();
    const pos = list => [
      arrays[list][0].x,
      arrays[list][0].y,
      arrays[list][0].el.style.left,
      arrays[list][0].el.style.top,
    ];
    return {
      laser: pos('laserArray'),
      enemyLaser: pos('enemyLaserArray'),
      bossLaser: pos('bossLaserArray'),
      bossMissile: pos('bossMissileArray'),
      hack: pos('hackProjectileArray'),
      missile: pos('missileArray'),
    };
  });
  expect(r.laser).toEqual([53, 255, '53px', '255px']);
  expect(r.enemyLaser).toEqual([106, 121, '106px', '121px']);
  expect(r.bossLaser).toEqual([147, 138, '147px', '138px']);
  expect(r.bossMissile).toEqual([226, 139, '226px', '139px']);
  expect(r.hack).toEqual([139, 216, '139px', '216px']);
  expect(r.missile).toEqual([60, 295, '60px', '295px']);
});

test('Online: Gleve-Zustand und harmlos-Flag gehen in den Snapshot, Client zeigt Dash, Klinge und parierte Geschosse', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, arrays, dom } = g;
    const NK = await import('./js/netzkodierung.js');
    const { simulationStep } = await import('./js/loop.js');
    const out = {};

    // Host-Seite: Gleve-Felder nur fuer Gleve-Schiffe, harmlos nur bei weggeschleuderten Geschossen
    state.selectedShipModel = 'gleve';
    state.p2.selectedShipModel = 'viper';
    Object.assign(state, {
      gleveDashTimer: 5,
      gleveBounceTimer: 0,
      gleveInvulnerable: 13,
      gleveSweepTimer: 7,
      gleveSweepAngle: -9,
      gleveSweepDirection: 1,
    });
    g.Entities.createEnemyLaser(100, 100);
    g.Entities.createEnemyLaser(150, 100);
    arrays.enemyLaserArray[0].harmless = true;
    const full = g.Network.serializeGameState();
    out.p1Fields = [
      full.p1.gleveDashTimer,
      full.p1.gleveInvulnerable,
      full.p1.gleveSweepTimer,
      full.p1.gleveSweepAngle,
      full.p1.gleveSweepDirection,
    ];
    out.p2WithoutGleve = full.p2.gleveSweepTimer === undefined;
    out.harmless = full.enemyLaser.map(f => f.harmless === true);
    // Ueber Kodierer/Dekodierer (Rundung) kommt alles an
    const packet = new NK.SnapshotEncoder().encode(full, 0);
    const dek = new NK.SnapshotDecoder().decode(JSON.parse(JSON.stringify(packet)));
    out.decoded = [
      dek.p1.gleveDashTimer,
      dek.p1.gleveSweepAngle,
      dek.p1.gleveSweepDirection,
      dek.enemyLaser[0].harmless === true,
    ];
    arrays.enemyLaserArray.forEach(o => o.el.remove());
    arrays.enemyLaserArray.length = 0;
    Object.assign(state, {
      gleveDashTimer: 0,
      gleveInvulnerable: 0,
      gleveSweepTimer: 0,
      gleveSweepAngle: 0,
      gleveSweepDirection: 0,
    });

    // Client-Seite: beide Schiffe sind Gleves
    state.p2.selectedShipModel = 'gleve';
    g.Audio.clearAudioHistory();
    const gleve = {
      gleveDashTimer: 5,
      gleveBounceTimer: 0,
      gleveInvulnerable: 13,
      gleveSweepTimer: 9,
      gleveSweepAngle: -18,
      gleveSweepDirection: 1,
    };
    const snap = window.__snapshot({
      enemyLaser: [
        { id: 'fl_1', x: 100, y: 100, vx: 9, vy: -1.5, harmless: true },
        { id: 'fl_2', x: 150, y: 100, vx: 0, vy: 7 },
      ],
      bossLaser: [{ id: 'bl_1', x: 200, y: 100, vx: -9, vy: -1.5, width: 8, height: 25, harmless: true }],
      hackProjectiles: [{ id: 'hp_1', x: 250, y: 100, harmless: true }],
    });
    Object.assign(snap.p1, gleve);
    g.Network.applyGameStateSnapshot(snap);
    simulationStep();
    const blade = document.querySelector('.gleve-klinge');
    out.client = {
      dashClass: dom.player.classList.contains('gleve-dash'),
      blade: blade ? blade.style.transform : null,
      angleThereafter: state.gleveSweepAngle,
      sounds: g.Audio.audioHistory
        .map(a => a.name)
        .filter(n => n === 'dash' || n === 'sweep')
        .sort(),
      parried: [
        arrays.enemyLaserArray[0].el.classList.contains('gleve-pariert'),
        arrays.enemyLaserArray[1].el.classList.contains('gleve-pariert'),
        arrays.bossLaserArray[0].el.classList.contains('gleve-pariert'),
        arrays.hackProjectileArray[0].el.classList.contains('gleve-pariert'),
      ],
      color: arrays.enemyLaserArray[0].el.style.backgroundColor,
    };
    // Gleicher Zustand noch einmal: keine neuen Sounds
    g.Network.applyGameStateSnapshot(JSON.parse(JSON.stringify(snap)));
    out.soundsAfterSecond = g.Audio.audioHistory.filter(a => a.name === 'dash' || a.name === 'sweep').length;

    // Dash und Sweep vorbei: Klasse und Klinge weg
    const end = window.__snapshot();
    Object.assign(end.p1, gleve, { gleveDashTimer: 0, gleveSweepTimer: 0, gleveSweepAngle: 22.5 });
    g.Network.applyGameStateSnapshot(end);
    simulationStep();
    out.end = {
      dashClass: dom.player.classList.contains('gleve-dash'),
      blades: document.querySelectorAll('.gleve-klinge').length,
    };
    return out;
  });
  expect(r.p1Fields).toEqual([5, 13, 7, -9, 1]);
  expect(r.p2WithoutGleve).toBe(true);
  expect(r.harmless).toEqual([true, false]);
  expect(r.decoded).toEqual([5, -9, 1, true]);
  expect(r.client.dashClass).toBe(true);
  // Die Anzeige zeichnet am Ende des Schritts (nach dem Weiterdrehen des Winkels), die Klinge steht also schon beim Winkel danach
  expect(r.client.blade).toBe('rotate(-9deg)');
  // Stufe 1: 90-Grad-Bogen in 10 Frames, 9 Grad pro Schritt
  expect(r.client.angleThereafter).toBeCloseTo(-9, 5);
  expect(r.client.sounds).toEqual(['dash', 'sweep']);
  expect(r.client.parried).toEqual([true, false, true, true]);
  expect(r.client.color).toBe('rgb(230, 126, 34)');
  expect(r.soundsAfterSecond).toBe(2);
  expect(r.end).toEqual({ dashClass: false, blades: 0 });
});

test('Online: Klingenwellen gehen in den Snapshot, Client zeigt .gleve-welle und entfernt sie wieder', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { arrays } = g;
    const NK = await import('./js/netzkodierung.js');
    const out = {};
    arrays.gleveWaves.push({
      id: 'gw_1',
      x: 165.04,
      y: 298.3,
      width: 70,
      height: 14,
      owner: 'p1',
      steps: 0,
      hit: [],
      el: null,
    });
    const full = g.Network.serializeGameState();
    out.full = full.gleveWaves;
    const packet = new NK.SnapshotEncoder().encode(full, 0);
    const dek = new NK.SnapshotDecoder().decode(JSON.parse(JSON.stringify(packet)));
    out.decoded = dek.gleveWaves;
    arrays.gleveWaves.length = 0;

    g.Network.applyGameStateSnapshot(window.__snapshot({ gleveWaves: out.decoded }));
    const el = document.querySelector('.gleve-welle');
    out.client = {
      count: arrays.gleveWaves.length,
      dom: document.querySelectorAll('.gleve-welle').length,
      left: el && el.style.left,
      top: el && el.style.top,
      width: el && el.style.width,
    };
    g.Network.applyGameStateSnapshot(
      window.__snapshot({ gleveWaves: [{ id: 'gw_1', x: 165, y: 290, width: 70, owner: 'p1' }] }),
    );
    out.moved = [document.querySelectorAll('.gleve-welle').length, document.querySelector('.gleve-welle').style.top];
    g.Network.applyGameStateSnapshot(window.__snapshot());
    out.gone = [arrays.gleveWaves.length, document.querySelectorAll('.gleve-welle').length];
    return out;
  });
  expect(r.full).toEqual([{ id: 'gw_1', x: 165.04, y: 298.3, width: 70, owner: 'p1' }]);
  expect(r.decoded).toEqual([{ id: 'gw_1', x: 165, y: 298.3, width: 70, owner: 'p1' }]);
  expect(r.client).toEqual({ count: 1, dom: 1, left: '165px', top: '298.3px', width: '70px' });
  expect(r.moved).toEqual([1, '290px']);
  expect(r.gone).toEqual([0, 0]);
});

test('Online: Dash-Ladungen gehen in den Snapshot (nur Gleve), Client zeigt Punkte und sagt ohne Ladung keinen Dash voraus', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const NK = await import('./js/netzkodierung.js');
    const Gleve = await import('./js/gleve.js');
    const { simulationStep } = await import('./js/loop.js');
    const out = {};

    // Host-Seite: nur Gleve-Schiffe senden gleveDashLadungen, ganzzahlig
    state.selectedShipModel = 'gleve';
    state.p2.selectedShipModel = 'viper';
    state.gleveDashCharges = 1;
    const full = g.Network.serializeGameState();
    out.p1 = full.p1.gleveDashCharges;
    out.p2WithoutGleve = full.p2.gleveDashCharges === undefined;
    const packet = new NK.SnapshotEncoder().encode(full, 0);
    const dek = new NK.SnapshotDecoder().decode(JSON.parse(JSON.stringify(packet)));
    out.decoded = dek.p1.gleveDashCharges;

    // Client-Seite: eigenes Schiff (P2) ist eine Gleve
    state.selectedShipModel = 'viper';
    g.config.playfieldWidth = 600;
    Object.assign(state.p2, {
      selectedShipModel: 'gleve',
      x: 300,
      y: 400,
      energy: 50,
      maxEnergy: 50,
      laserTier: 1,
      missileTier: 1,
      missileCooldown: 0,
      isDead: false,
      hacks: [],
      gleveDashTimer: 0,
      gleveBounceTimer: 0,
      gleveDashKeyHeld: false,
      gleveNetworkBounce: null,
    });
    g.Utils.updateShipHudLabels();
    const gleveFields = {
      gleveDashTimer: 0,
      gleveBounceTimer: 0,
      gleveInvulnerable: 0,
      gleveSweepTimer: 0,
      gleveSweepAngle: 0,
      gleveSweepDirection: 0,
    };
    const points = () => {
      const el = document.getElementById('dash-ladungen-p2');
      return [el.querySelectorAll('.dash-ladung').length, el.querySelectorAll('.dash-ladung.voll').length];
    };
    const withCharges = (n, cd) => {
      const snap = window.__snapshot();
      Object.assign(snap.p2, { missileCooldown: cd, gleveDashCharges: n }, gleveFields);
      return snap;
    };

    g.Network.applyGameStateSnapshot(withCharges(0, 100));
    out.withoutCharge = {
      charges: state.p2.gleveDashCharges,
      points: points(),
      pct: parseFloat(document.getElementById('raketen-cd-balken-p2').style.width),
      number: document.getElementById('btn-rakete-ladungen').textContent,
    };
    state.keysPressed.k = true;
    simulationStep();
    out.noDash = { timer: state.p2.gleveDashTimer, y: state.p2.y, x: state.p2.x };
    state.keysPressed.k = false;
    simulationStep();

    g.Network.applyGameStateSnapshot(withCharges(1, 100));
    out.oneOfCharge = { points: points(), number: document.getElementById('btn-rakete-ladungen').textContent };
    state.keysPressed.k = true;
    simulationStep();
    out.dash = state.p2.gleveDashTimer;
    state.keysPressed.k = false;
    out.max = Gleve.dashMaxCharges(state.p2);
    return out;
  });
  expect(r.p1).toBe(1);
  expect(r.p2WithoutGleve).toBe(true);
  expect(r.decoded).toBe(1);
  expect(r.withoutCharge.charges).toBe(0);
  expect(r.withoutCharge.points).toEqual([r.max, 0]);
  expect(r.withoutCharge.pct).toBeCloseTo(100 - (100 / 180) * 100, 3);
  expect(r.withoutCharge.number).toBe('0');
  // Ohne Ladung kein vorhergesagter Dash
  expect(r.noDash.timer).toBe(0);
  expect(r.oneOfCharge).toEqual({ points: [2, 1], number: '1' });
  expect(r.dash).toBeGreaterThan(0);
});

test('Online-Client: eigener Gleve-Dash (Raketen-Taste) wird lokal vorhergesagt, Abprall kommt vom Host', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, dom } = g;
    const { simulationStep } = await import('./js/loop.js');
    const out = {};
    g.config.playfieldWidth = 600; // wie in startOnlineGame
    state.selectedShipModel = 'viper';
    Object.assign(state.p2, {
      selectedShipModel: 'gleve',
      x: 300,
      y: 400,
      energy: 50,
      maxEnergy: 50,
      laserTier: 1,
      missileTier: 1,
      missileCooldown: 0,
      isDead: false,
      hacks: [],
      gleveDashCharges: 2,
      gleveDashTimer: 0,
      gleveBounceTimer: 0,
      gleveDashKeyHeld: false,
      gleveNetworkBounce: null,
    });
    g.Audio.clearAudioHistory();

    // Druck mit Richtung rechts: im ersten Schritt steht das Schiff, Paket traegt Start und Richtung
    state.keysPressed.k = true;
    state.keysPressed.d = true;
    simulationStep();
    const packet = state.network.lastSentInput;
    out.start = {
      x: state.p2.x,
      packet: [packet.x, packet.y, packet.missile, packet.laser, packet.rx, packet.ry],
      energy: state.p2.energy,
      cd: state.p2.missileCooldown,
    };
    state.keysPressed.k = false;
    state.keysPressed.d = false;
    simulationStep();
    out.releasePacket = [state.network.lastSentInput.x, state.network.lastSentInput.missile];
    out.classDuring = dom.player2.classList.contains('gleve-dash');
    for (let i = 0; i < 7; i++) simulationStep();
    out.end = {
      x: state.p2.x,
      y: state.p2.y,
      cls: dom.player2.classList.contains('gleve-dash'),
      dashSounds: g.Audio.audioHistory.filter(a => a.name === 'dash').length,
    };
    simulationStep();
    out.thereafter = { x: state.p2.x, packetX: state.network.lastSentInput.x };

    // Host meldet Abprall: Client gleitet zur Host-Position und uebernimmt am Ende den Landepunkt
    const bounce = window.__snapshot();
    Object.assign(bounce.p2, {
      x: 360,
      y: 440,
      gleveDashTimer: 0,
      gleveBounceTimer: 6,
      gleveInvulnerable: 30,
      gleveSweepTimer: 0,
      gleveSweepAngle: 0,
      gleveSweepDirection: 0,
    });
    g.Network.applyGameStateSnapshot(bounce);
    simulationStep();
    out.glide = { x: state.p2.x, y: state.p2.y, cls: dom.player2.classList.contains('gleve-dash') };
    const landed = window.__snapshot();
    Object.assign(landed.p2, {
      x: 365,
      y: 445,
      gleveDashTimer: 0,
      gleveBounceTimer: 0,
      gleveInvulnerable: 25,
      gleveSweepTimer: 0,
      gleveSweepAngle: 0,
      gleveSweepDirection: 0,
    });
    g.Network.applyGameStateSnapshot(landed);
    out.landing = { x: state.p2.x, y: state.p2.y };
    simulationStep();
    out.againFree = dom.player2.classList.contains('gleve-dash');
    return out;
  });
  expect(r.start.x).toBe(300);
  expect(r.start.packet).toEqual([300, 400, true, false, 1, 0]);
  // Dash kostet keine Energie, sondern startet den Cooldown (Stufe 1: 180)
  expect(r.start.energy).toBeCloseTo(50, 5);
  expect(r.start.cd).toBe(180);
  // Waehrend des Dashs bleibt die gemeldete Position der Startpunkt
  expect(r.releasePacket).toEqual([300, false]);
  expect(r.classDuring).toBe(true);
  expect(r.end.x).toBeCloseTo(400, 5);
  expect(r.end.y).toBeCloseTo(400, 5);
  expect(r.end.cls).toBe(false);
  expect(r.end.dashSounds).toBe(1);
  // Nach dem Dash steuert und meldet der Client wieder seine echte Position
  expect(r.thereafter.x).toBeCloseTo(400, 5);
  expect(r.thereafter.packetX).toBe(400);
  expect(r.glide.x).toBeCloseTo(380, 5);
  expect(r.glide.y).toBeCloseTo(420, 5);
  expect(r.glide.cls).toBe(true);
  expect(r.landing).toEqual({ x: 365, y: 445 });
  expect(r.againFree).toBe(false);
});

test('Online-Client: Gegner und Host-Schiff gleiten zur neuen Snapshot-Position statt zu springen', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { arrays, dom } = g;
    const { simulationStep } = await import('./js/loop.js');
    const enemy = y => [{ id: 'f1', x: 100, y, hp: 3, maxHp: 3, size: 30, typ: 1, pattern: 'normal' }];
    const p1 = x => ({ x, y: 400, rotate: 0, lives: 3, energy: 50, maxEnergy: 50, isDead: false });
    const out = {};

    g.Network.applyGameStateSnapshot(window.__snapshot({ p1: p1(200), enemies: enemy(50) }));
    out.start = [arrays.enemies[0].el.style.top, dom.player.style.left];
    g.Network.applyGameStateSnapshot(window.__snapshot({ p1: p1(210), enemies: enemy(60) }));
    out.directAfterSnapshot = [arrays.enemies[0].el.style.top, dom.player.style.left];
    simulationStep();
    out.step1 = [arrays.enemies[0].el.style.top, dom.player.style.left];
    simulationStep();
    out.step2 = [arrays.enemies[0].el.style.top, dom.player.style.left];
    simulationStep();
    out.step3 = [arrays.enemies[0].el.style.top, dom.player.style.left];
    // Logische Position folgt sofort dem Snapshot
    out.logical = [arrays.enemies[0].y, g.state.x];

    // Grosser Sprung (Respawn/Teleport): sofort uebernehmen
    g.Network.applyGameStateSnapshot(window.__snapshot({ p1: p1(500), enemies: enemy(400) }));
    out.jump = [arrays.enemies[0].el.style.top, dom.player.style.left];
    return out;
  });
  expect(r.start).toEqual(['50px', '200px']);
  expect(r.directAfterSnapshot).toEqual(['50px', '200px']);
  expect(r.step1).toEqual(['55px', '205px']);
  expect(r.step2).toEqual(['60px', '210px']);
  expect(r.step3).toEqual(['60px', '210px']);
  expect(r.logical).toEqual([60, 210]);
  expect(r.jump).toEqual(['400px', '500px']);
});

// ---------------------------------------------------------------------------------------------
// Spectre-SR online (S5a): Snapshot-Felder, Darstellung beim Client, Eingaben

test('Online: Sniper-Felder gehen nur fuer Sniper in den Snapshot (Granatenliste sonst leer) und ueberstehen Kodierer/Dekodierer (gerundet)', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, arrays } = g;
    const NK = await import('./js/netzkodierung.js');
    const Sniper = await import('./js/sniper.js');
    const out = {};
    state.selectedShipModel = 'sniper';
    state.p2.selectedShipModel = 'viper';
    Object.assign(state, {
      sniperTargetX: 123.456,
      sniperTargetY: 99.04,
      sniperCharge: 45.4,
      sniperCooldown: 17.6,
      x: 108,
      y: 319,
    });
    g.Entities.createEnemy(100, 100, 'normal', 0, false);
    g.Entities.createEnemy(200, 100, 'normal', 0, false);
    arrays.enemies[0].stunned = 33.4;
    const full = g.Network.serializeGameState();
    out.p1 = ['sniperTargetX', 'sniperTargetY', 'sniperCharge', 'sniperFull', 'sniperCooldown'].every(
      k => k in full.p1,
    );
    out.p2Without = Object.keys(full.p2).filter(k => k.startsWith('sniper')).length;
    out.list = Array.isArray(full.sniperGrenades);
    out.stunnedOnlyWhen = [full.enemies[0].stunned, 'stunned' in full.enemies[1]];
    // Ohne Sniper keine Sniper-Felder und keine Granatenliste
    state.selectedShipModel = 'viper';
    const without = g.Network.serializeGameState();
    out.withoutSniper = [
      Object.keys(without.p1).filter(k => k.startsWith('sniper')).length,
      without.sniperGrenades.length,
    ];
    state.selectedShipModel = 'sniper';
    // Granate im Flug: Eintrag mit Id, Position, Besitzer, Flugfortschritt
    Sniper.throwGrenade(state, 'p1');
    const withGrenade = g.Network.serializeGameState();
    out.grenade = withGrenade.sniperGrenades.map(x => ({
      id: typeof x.id,
      owner: x.owner,
      rest: x.rest,
      hasPos: Number.isFinite(x.x) && Number.isFinite(x.y),
    }));
    // Kodierer -> Dekodierer
    const k = new NK.SnapshotEncoder();
    const dek = new NK.SnapshotDecoder().decode(JSON.parse(JSON.stringify(k.encode(withGrenade, 0))));
    out.decoded = [
      dek.p1.sniperTargetX,
      dek.p1.sniperTargetY,
      dek.p1.sniperCharge,
      dek.p1.sniperCooldown,
      dek.enemies[0].stunned,
      dek.sniperGrenades.length,
    ];
    out.protocol = NK.PROTOCOL_VERSION;
    Sniper.reset(state);
    return out;
  });
  expect(r.p1).toBe(true);
  expect(r.p2Without).toBe(0);
  expect(r.list).toBe(true);
  expect(r.stunnedOnlyWhen).toEqual([33.4, false]);
  expect(r.withoutSniper).toEqual([0, 0]);
  expect(r.grenade).toEqual([{ id: 'string', owner: 'p1', rest: 30, hasPos: true }]);
  expect(r.decoded).toEqual([123.5, 99, 45, 18, 33, 1]);
  expect(r.protocol).toBeGreaterThanOrEqual(14); // Sniper-Felder seit Protokoll 14
});

test('Online-Client: Fadenkreuz an der Host-Position, Ladering bei Ladung, Strahl beim Schuss, Sounds nur fuers eigene Schiff', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const { state } = g;
    const out = {};
    state.selectedShipModel = 'sniper';
    state.p2.selectedShipModel = 'sniper';
    const snap = (p1, p2) => {
      const s = window.__snapshot();
      Object.assign(s.p1, { laserTier: 1 }, p1);
      Object.assign(s.p2, { laserTier: 1 }, p2);
      return s;
    };
    const z = (x, y, charge, cd) => ({
      sniperTargetX: x,
      sniperTargetY: y,
      sniperCharge: charge,
      sniperFull: charge >= 90,
      sniperCooldown: cd,
    });
    g.Audio.clearAudioHistory();
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 0, 0), z(350, 180, 0, 0)));
    const k1 = document.querySelector('.sniper-fadenkreuz-p1');
    const k2 = document.querySelector('.sniper-fadenkreuz-p2');
    out.crosses = document.querySelectorAll('.sniper-fadenkreuz').length;
    out.p1Middle = [
      parseFloat(k1.style.left) + parseFloat(k1.style.width) / 2,
      parseFloat(k1.style.top) + parseFloat(k1.style.height) / 2,
    ];
    out.p2Middle = [
      parseFloat(k2.style.left) + parseFloat(k2.style.width) / 2,
      parseFloat(k2.style.top) + parseFloat(k2.style.height) / 2,
    ];
    out.ringOff =
      !k1.querySelector('.sniper-ladering') || k1.querySelector('.sniper-ladering').style.display === 'none';

    // Ladung 50: Ring sichtbar und groesser als der Trefferkreis, noch nicht voll
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 50, 0), z(350, 180, 50, 0)));
    const ring = k1.querySelector('.sniper-ladering');
    out.ring = { an: ring.style.display, width: parseFloat(ring.style.width), full: ring.classList.contains('voll') };
    // Voll: Klasse voll, Ton nur fuer das eigene Schiff (P2) und nur einmal
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 90, 0), z(350, 180, 90, 0)));
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 90, 0), z(350, 180, 90, 0)));
    out.full = k1.querySelector('.sniper-ladering').classList.contains('voll');
    out.fullTone = g.Audio.audioHistory.filter(a => a.name === 'sniperFull').length;

    // Schuss: Cooldown springt hoch, Ladung ist zurueck auf 0 -> ein Strahl pro Schiff, breit wegen der Ladung
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 0, 24), z(350, 180, 0, 24)));
    const beams = [...document.querySelectorAll('.sniper-strahl')];
    out.beams = beams.length;
    out.wide = beams.every(s => parseFloat(s.style.width) > 8);
    out.shotTone = g.Audio.audioHistory.filter(a => a.name === 'sniperSchuss').length;
    out.ringGone = k1.querySelector('.sniper-ladering').style.display;
    // Sinkender Cooldown: kein weiterer Strahl
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 0, 22), z(350, 180, 0, 22)));
    out.beamsThereafter = document.querySelectorAll('.sniper-strahl').length;

    // Tod des Hosts und Schiffswechsel: Fadenkreuz weg
    g.Network.applyGameStateSnapshot(snap(Object.assign(z(123.4, 99.2, 0, 0), { isDead: true }), z(350, 180, 0, 0)));
    out.afterDeath = document.querySelectorAll('.sniper-fadenkreuz-p1').length;
    state.p2.selectedShipModel = 'viper';
    g.Network.applyGameStateSnapshot(snap(z(123.4, 99.2, 0, 0), {}));
    out.afterSwitch = document.querySelectorAll('.sniper-fadenkreuz-p2').length;
    return out;
  });
  expect(r.crosses).toBe(2);
  expect(r.p1Middle).toEqual([123.4, 99.2]);
  expect(r.p2Middle).toEqual([350, 180]);
  expect(r.ringOff).toBe(true);
  expect(r.ring.an).toBe('block');
  expect(r.ring.width).toBeGreaterThan(12);
  expect(r.ring.full).toBe(false);
  expect(r.full).toBe(true);
  expect(r.fullTone).toBe(1);
  expect(r.beams).toBe(2);
  expect(r.wide).toBe(true);
  expect(r.shotTone).toBe(1);
  expect(r.ringGone).toBe('none');
  expect(r.beamsThereafter).toBe(2);
  expect(r.afterDeath).toBe(0);
  expect(r.afterSwitch).toBe(0);
});

test('Online-Client: Granate im Flug, Druckwelle per Ereignis, betaeubte Gegner mit Klasse, Granaten-HUD', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, arrays } = g;
    const { simulationStep } = await import('./js/loop.js');
    const out = {};
    state.selectedShipModel = 'sniper';
    state.p2.selectedShipModel = 'sniper';
    const enemy = bet => ({
      id: 'f_1',
      x: 100,
      y: 100,
      hp: 30,
      maxHp: 30,
      size: 30,
      typ: 1,
      pattern: 'normal',
      hasShield: false,
      shieldHp: 0,
      ...(bet ? { stunned: bet } : {}),
    });
    const boss = bet => ({
      id: 'boss_1',
      x: 200,
      y: 50,
      hp: 400,
      maxHp: 400,
      size: 100,
      typ: 1,
      enrage: false,
      ...(bet ? { stunned: bet } : {}),
    });

    // Granate: erscheint, bewegt sich mit dem Snapshot, verschwindet wieder
    g.Network.applyGameStateSnapshot(
      window.__snapshot({ sniperGrenades: [{ id: 'sg_1', x: 150, y: 250, owner: 'p2', rest: 20 }] }),
    );
    const el = document.querySelector('.sniper-granate');
    out.grenade = [
      document.querySelectorAll('.sniper-granate').length,
      parseFloat(el.style.left) + 7,
      parseFloat(el.style.top) + 7,
    ];
    g.Network.applyGameStateSnapshot(
      window.__snapshot({ sniperGrenades: [{ id: 'sg_1', x: 160, y: 230, owner: 'p2', rest: 18 }] }),
    );
    out.moved = [
      document.querySelectorAll('.sniper-granate').length,
      parseFloat(el.style.left) + 7,
      parseFloat(el.style.top) + 7,
      el.isConnected,
    ];
    g.Network.applyGameStateSnapshot(window.__snapshot({ sniperGrenades: [] }));
    out.gone = document.querySelectorAll('.sniper-granate').length;

    // Druckwelle ueber Ereignis, waechst mit den Client-Schritten und verschwindet
    g.Audio.clearAudioHistory();
    g.Network.handleNetworkEvent({ type: 'granate_detonated', x: 160, y: 200, radius: 90, owner: 'p1' }, 'host');
    out.waveThere = document.querySelectorAll('.sniper-druckwelle').length;
    out.grenadeTone = g.Audio.audioHistory.filter(a => a.name === 'grenade').length;
    simulationStep();
    simulationStep();
    simulationStep();
    const wave = document.querySelector('.sniper-druckwelle');
    out.waveWide = parseFloat(wave.style.width);
    for (let i = 0; i < 20; i++) simulationStep();
    out.waveGone = document.querySelectorAll('.sniper-druckwelle').length;
    // Unsinnige Ereignisse werden ignoriert
    g.Network.handleNetworkEvent({ type: 'granate_detonated', x: 'a', y: null, radius: -3 }, 'host');
    out.nonsense = document.querySelectorAll('.sniper-druckwelle').length;

    // Betaeubung: Klasse an Feind und Boss, nach dem Snapshot ohne Feld wieder weg
    g.Network.applyGameStateSnapshot(window.__snapshot({ enemies: [enemy(40)], bosses: [boss(30)] }));
    out.stunned = [
      arrays.enemies[0].el.classList.contains('betaeubt'),
      arrays.bosses[0].el.classList.contains('betaeubt'),
    ];
    g.Network.applyGameStateSnapshot(window.__snapshot({ enemies: [enemy(0)], bosses: [boss(0)] }));
    out.past = [
      arrays.enemies[0].el.classList.contains('betaeubt'),
      arrays.bosses[0].el.classList.contains('betaeubt'),
    ];

    // Granaten-HUD: Cooldown-Balken des eigenen Schiffs nutzt den Granaten-Cooldown (Stufe 1: 240)
    const s = window.__snapshot();
    Object.assign(s.p2, {
      laserTier: 1,
      missileTier: 1,
      missileCooldown: 120,
      sniperTargetX: 350,
      sniperTargetY: 180,
      sniperCharge: 0,
      sniperFull: false,
      sniperCooldown: 0,
    });
    g.Network.applyGameStateSnapshot(s);
    out.hud = document.getElementById('raketen-cd-balken-p2').style.width;
    return out;
  });
  expect(r.grenade).toEqual([1, 150, 250]);
  expect(r.moved).toEqual([1, 160, 230, true]);
  expect(r.gone).toBe(0);
  expect(r.waveThere).toBe(1);
  expect(r.grenadeTone).toBe(1);
  expect(r.waveWide).toBeGreaterThan(0);
  expect(r.waveGone).toBe(0);
  expect(r.nonsense).toBe(0);
  expect(r.stunned).toEqual([true, true]);
  expect(r.past).toEqual([false, false]);
  expect(r.hud).toBe('50%');
});

test('Online-Client: Eingabe-Paket traegt Lade-Knopf als Laser, Joystick-Autofeuer als auto, Taste L ohne auto', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const NK = await import('./js/netzkodierung.js');
    const keys = state.keysPressed;
    Object.keys(keys).forEach(k => {
      keys[k] = false;
    });
    state.p2.selectedShipModel = 'sniper';
    const read = () => {
      const e = g.Network.serializePlayerInput();
      return { laser: e.laser, auto: e.auto === true };
    };
    const out = {};
    out.rest = read();
    keys.l = true;
    out.key = read();
    keys.l = false;
    state.sniperChargingButton = true;
    out.button = read();
    state.sniperChargingButton = false;
    state.joystick.active = true;
    state.joystick.fires = true;
    keys.l = true; // wie input.js beim Joystick-touchstart
    out.joystick = read();
    state.sniperChargingButton = true;
    out.joystickAndButton = read();
    state.sniperChargingButton = false;
    state.joystick.active = false;
    state.joystick.fires = false;
    keys.l = false;
    // Anderes Schiff: nie auto, Knopf zaehlt nicht
    state.p2.selectedShipModel = 'viper';
    state.joystick.fires = true;
    keys.l = true;
    out.viper = read();
    state.joystick.fires = false;
    keys.l = false;
    // Der Sender schickt auto nur wenn gesetzt, eine Aenderung geht sofort raus
    const s = new NK.InputSender();
    const basis = { x: 1, y: 2, rotate: 0, laser: true, missile: false, bomb: false };
    const a = s.next(basis);
    const b = s.next(basis);
    const c = s.next({ ...basis, auto: true });
    const d = s.next({ ...basis, auto: true });
    out.sender = [a && 'auto' in a, b, c && c.auto, d];
    return out;
  });
  expect(r.rest).toEqual({ laser: false, auto: false });
  expect(r.key).toEqual({ laser: true, auto: false });
  expect(r.button).toEqual({ laser: true, auto: false });
  expect(r.joystick).toEqual({ laser: true, auto: true });
  expect(r.joystickAndButton).toEqual({ laser: true, auto: false });
  expect(r.viper).toEqual({ laser: true, auto: false });
  expect(r.sender).toEqual([false, null, true, null]);
});

test('Online-Client: eigenes Fadenkreuz folgt dem vorhergesagten Schiff (ohne Auto-Zielen), mit Auto-Zielen gilt der Host-Wert', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const { simulationStep } = await import('./js/loop.js');
    const keys = state.keysPressed;
    Object.keys(keys).forEach(k => {
      keys[k] = false;
    });
    state.p2.selectedShipModel = 'sniper';
    const s = window.__snapshot();
    Object.assign(s.p2, {
      laserTier: 1,
      sniperTargetX: 365,
      sniperTargetY: 180,
      sniperCharge: 0,
      sniperFull: false,
      sniperCooldown: 0,
    });
    g.Network.applyGameStateSnapshot(s);
    simulationStep();
    const out = {};
    const stand = state.p2.x;
    keys.a = true;
    for (let i = 0; i < 10; i++) simulationStep();
    keys.a = false;
    out.run = state.p2.x < stand;
    out.follows = [state.p2.sniperTargetX, state.p2.x + 15];
    // Stufe 4: Host-Wert bleibt stehen
    const s4 = window.__snapshot();
    Object.assign(s4.p2, {
      laserTier: 4,
      sniperTargetX: 300,
      sniperTargetY: 150,
      sniperCharge: 0,
      sniperFull: false,
      sniperCooldown: 0,
    });
    g.Network.applyGameStateSnapshot(s4);
    simulationStep();
    out.auto = [state.p2.sniperTargetX, state.p2.sniperTargetY];
    return out;
  });
  expect(r.run).toBe(true);
  expect(r.follows[0]).toBeCloseTo(r.follows[1], 5);
  expect(r.auto).toEqual([300, 150]);
});

test('Online-Client: Haftminen aus dem Snapshot (Legen, Blinken, Haften, Ton), Explosion per Ereignis, Entfernen', async ({
  page,
}) => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const out = {};
    const mine = extra =>
      Object.assign(
        { id: 'sm_1', x: 150, y: 250, owner: 'p2', sticks: false, fuse: 0, rest: 300, blinks: false },
        extra || {},
      );
    g.Audio.clearAudioHistory();
    g.Network.applyGameStateSnapshot(window.__snapshot({ sniperMines: [mine()] }));
    const el = document.querySelector('.sniper-mine');
    out.there = [
      document.querySelectorAll('.sniper-mine').length,
      el.classList.contains('sniper-mine-p2'),
      parseFloat(el.style.left) + 6,
      parseFloat(el.style.top) + 6,
    ];
    out.putTone = g.Audio.audioHistory.filter(a => a.name === 'mine_legen').length;
    g.Network.applyGameStateSnapshot(window.__snapshot({ sniperMines: [mine({ rest: 40, blinks: true })] }));
    out.blinks = [
      el.classList.contains('blinkt'),
      el.classList.contains('haftet'),
      document.querySelectorAll('.sniper-mine').length,
    ];
    g.Network.applyGameStateSnapshot(
      window.__snapshot({ sniperMines: [mine({ x: 170, y: 260, sticks: true, fuse: 20 })] }),
    );
    out.sticks = [el.classList.contains('haftet'), el.classList.contains('blinkt'), parseFloat(el.style.left) + 6];
    out.beep = g.Audio.audioHistory.filter(a => a.name === 'mine_piep').length;
    g.Audio.clearAudioHistory();
    g.Network.handleNetworkEvent({ type: 'mine_explodiert', x: 170, y: 260, radius: 30, owner: 'p2' }, 'host');
    out.wave = document.querySelectorAll('.sniper-mine-explosion').length;
    out.bang = g.Audio.audioHistory.filter(a => a.name === 'mine_explosion').length;
    g.Network.handleNetworkEvent({ type: 'mine_explodiert', x: 'a', y: null }, 'host');
    out.nonsense = document.querySelectorAll('.sniper-mine-explosion').length;
    g.Network.applyGameStateSnapshot(window.__snapshot({ sniperMines: [] }));
    out.gone = document.querySelectorAll('.sniper-mine').length;
    return out;
  });
  expect(r.there).toEqual([1, true, 150, 250]);
  expect(r.putTone).toBe(1);
  expect(r.blinks).toEqual([true, false, 1]);
  expect(r.sticks).toEqual([true, false, 170]);
  expect(r.beep).toBe(1);
  expect(r.wave).toBe(1);
  expect(r.bang).toBe(1);
  expect(r.nonsense).toBe(1);
  expect(r.gone).toBe(0);
});

test('Online: Granaten-Ladungen des Sniper im Client: Punkte und Mobil-Zahl aus dem Snapshot', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const { state } = g;
    state.selectedShipModel = 'viper';
    Object.assign(state.p2, {
      selectedShipModel: 'sniper',
      x: 300,
      y: 400,
      missileTier: 1,
      missileCooldown: 0,
      isDead: false,
      hacks: [],
    });
    g.Utils.updateShipHudLabels();
    const points = () => {
      const el = document.getElementById('dash-ladungen-p2');
      return [el.querySelectorAll('.dash-ladung').length, el.querySelectorAll('.dash-ladung.voll').length];
    };
    const show = (n, cd) => {
      const snap = window.__snapshot();
      Object.assign(snap.p2, {
        missileCooldown: cd,
        sniperGrenadeCharges: n,
        sniperTargetX: 315,
        sniperTargetY: 180,
        sniperCharge: 0,
        sniperFull: false,
        sniperCooldown: 0,
      });
      g.Network.applyGameStateSnapshot(snap);
      return {
        charges: state.p2.sniperGrenadeCharges,
        points: points(),
        number: document.getElementById('btn-rakete-ladungen').textContent,
        bar: parseFloat(document.getElementById('raketen-cd-balken-p2').style.width),
      };
    };
    return { oneOf: show(1, 120), full: show(2, 0) };
  });
  expect(r.oneOf.charges).toBe(1);
  expect(r.oneOf.points).toEqual([2, 1]);
  expect(r.oneOf.number).toBe('1');
  expect(r.oneOf.bar).toBeCloseTo(50, 3);
  expect(r.full.points).toEqual([2, 2]);
  expect(r.full.number).toBe('2');
  expect(r.full.bar).toBe(100);
});
