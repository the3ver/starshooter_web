const { test, expect } = require('@playwright/test');
const { setGameState, installClock, pauseClock } = require('./helpers');

// Net encoding in online mode: delta snapshots, keyframes, inputs and protocol version

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
});

const LISTEN_ARRAYS = [
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
];

// Set up a host game in online mode (without a real connection)
async function asHost(page) {
  await page.evaluate(LISTEN_ARRAYS => {
    const { state, arrays, Utils } = window.__game;
    Utils.setGameMode('online');
    state.gameRunning = true;
    state.paused = false;
    state.cutsceneActive = false;
    state.gameOverActive = false;
    state.bossWarningActive = false;
    state.network.isOnline = true;
    state.network.isHost = true;
    state.network.isClient = false;
    state.network.connected = true;
    LISTEN_ARRAYS.forEach(n => {
      arrays[n].forEach(o => {
        if (o.el) o.el.remove();
      });
      arrays[n].length = 0;
    });
  }, LISTEN_ARRAYS);
}

test('Carry-over: splitter counters and Phantom shield charge reach the online client', async ({ page }) => {
  await asHost(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const { state } = g;
    // Host state
    state.selectedShipModel = 'viper';
    state.p2.selectedShipModel = 'phantom';
    state.splitterRed = 3;
    state.splitterWhite = 7;
    state.p2.splitterRed = 2;
    state.p2.splitterWhite = 5;
    state.p2.shieldTier = 0;
    state.p2.phantomShieldRegenTimer = 450;
    state.p2.phantomShieldRegenMax = 900;
    const snapshot = JSON.parse(JSON.stringify(g.Network.serializeGameState()));

    // Client state before the snapshot
    state.splitterRed = 0;
    state.splitterWhite = 0;
    state.p2.splitterRed = 0;
    state.p2.splitterWhite = 0;
    state.p2.phantomShieldRegenTimer = 0;
    state.network.isHost = false;
    state.network.isClient = true;
    g.Network.applyGameStateSnapshot(snapshot);
    return {
      p1: [state.splitterRed, state.splitterWhite],
      p2: [state.p2.splitterRed, state.p2.splitterWhite],
      regen: state.p2.phantomShieldRegenTimer,
      hudRot: document.getElementById('splitter-rot-count').textContent,
      hudWhite: document.getElementById('splitter-weiss-count').textContent,
      chargingIcon: Boolean(document.querySelector('#aktive-powerups-p2 .pu-recharging-shield')),
    };
  });
  expect(r).toEqual({ p1: [3, 7], p2: [2, 5], regen: 450, hudRot: '3', hudWhite: '7', chargingIcon: true });
});

test('Carry-over: the host sends snapshots during the boss warning as well', async ({ page }) => {
  await asHost(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const { simulationStep } = await import('./js/loop.js');
    state.godMode = true;
    state.frameCounter = 100;
    state.bossWarningActive = true;
    state.bossWarningTimer = 120;
    g.dom.warningOverlay.style.display = 'flex';
    const beforehand = state.network.snapshotPackets || 0;
    for (let i = 0; i < 119; i++) simulationStep();
    const during = (state.network.snapshotPackets || 0) - beforehand;
    const stillWarning = state.bossWarningActive;
    simulationStep();
    return { during, stillWarning, thereafter: state.bossWarningActive };
  });
  expect(r.stillWarning).toBe(true);
  expect(r.thereafter).toBe(false);
  expect(r.during).toBeGreaterThanOrEqual(55);
});

// Run a real host game (co-op with bot, level 6, all weapons, boss fight) via simulationStep
// and encode and decode every 2nd step. loss: sequence numbers that do not arrive.
async function runScenario(page, { steps, loss }) {
  return page.evaluate(
    async ({ steps, loss }) => {
      const g = window.__game;
      const { state, arrays } = g;
      const NK = await import('./js/net-encoding.js');
      const { simulationStep } = await import('./js/loop.js');

      g.Utils.setGameMode('coop');
      state.p2IsBot = true;
      g.Cutscene.startCutscene();
      state.godMode = true;
      state.level = 6;
      state.laserTier = 4;
      state.missileTier = 3;
      state.bombTier = 2;
      state.p2.laserTier = 4;
      state.p2.missileTier = 3;
      state.p2.bombTier = 2;
      state.frameCounter = 3400; // Boss warning after 200 steps, then the boss fight

      const encoder = new NK.SnapshotEncoder();
      const decoder = new NK.SnapshotDecoder();
      const lost = new Set(loss || []);
      const error = [];
      const stat = {
        full: [],
        packet: [],
        keyframes: 0,
        nullAfterLoss: 0,
        applied: 0,
        maxListen: {},
        towed: 0,
        bossSteps: 0,
      };

      // x/y in lists may deviate by up to 0.5 px via dead reckoning, everything else exactly
      function compare(should, is, filePath, inList) {
        if (error.length > 20) return;
        if (typeof should === 'number' && typeof is === 'number' && inList && /\.(x|y)$/.test(filePath)) {
          if (Math.abs(should - is) > 0.5 + 1e-9) error.push(filePath + ': ' + should + ' != ' + is);
          return;
        }
        if (should === null || is === null || typeof should !== 'object' || typeof is !== 'object') {
          if (should !== is) error.push(filePath + ': ' + JSON.stringify(should) + ' != ' + JSON.stringify(is));
          return;
        }
        if (Array.isArray(should) !== Array.isArray(is)) {
          error.push(filePath + ': Typ');
          return;
        }
        const key = new Set([...Object.keys(should), ...Object.keys(is)]);
        for (const k of key) {
          const list = inList || (filePath === '' && NK.LISTEN.includes(k));
          compare(should[k], is[k], filePath + '.' + k, list);
        }
      }

      let waitsOnKeyframe = false;
      for (let i = 1; i <= steps; i++) {
        const keys = state.keysPressed;
        keys.l = true;
        keys.k = i % 90 < 45;
        keys[' '] = i % 250 === 0;
        keys.a = i % 80 < 40;
        keys.d = !keys.a;
        if (i % 45 === 0) g.Entities.createEnemy(80 + ((i * 7) % 400), 20, i % 90 === 0 ? 'hacker' : 'normal');
        if (i % 30 === 0) g.Entities.createAsteroid();
        if (i % 70 === 0) g.Entities.createPowerup(state.x, state.y, 'energy', 'p2'); // towed by P1
        if (i % 110 === 0) g.Entities.createPowerup(200, 40);
        if (i % 60 === 0) {
          g.Entities.createBossMissile(150 + (i % 300), 120, 1);
          g.Entities.createBossBomb(250, 100);
        }
        if (i % 50 === 0) {
          g.Entities.createHackProjectile(130, 210, 300, 400);
          g.Entities.createBossLaser(140, 220, 2, 6);
          g.Entities.createEnemyLaser(120, 200, 300, 400);
        }
        simulationStep();
        if (arrays.powerups.some(p => p.towedBy)) stat.towed++;
        if (arrays.bosses.length) stat.bossSteps++;

        if (i % 2 !== 0) continue;
        const full = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
        const packet = encoder.encode(full, i);
        const text = JSON.stringify(packet);
        stat.full.push(JSON.stringify(full).length);
        stat.packet.push(text.length);
        if (packet.k) stat.keyframes++;
        NK.LISTEN.forEach(n => {
          stat.maxListen[n] = Math.max(stat.maxListen[n] || 0, full[n].length);
        });
        if (lost.has(packet.n)) {
          waitsOnKeyframe = true;
          continue;
        }
        const recon = decoder.decode(JSON.parse(text));
        if (packet.k) waitsOnKeyframe = false;
        if (waitsOnKeyframe) {
          if (recon !== null) error.push('Paket ' + packet.n + ' applied after loss');
          stat.nullAfterLoss++;
          continue;
        }
        if (!recon) {
          error.push('Paket ' + packet.n + ' nicht dekodiert');
          continue;
        }
        stat.applied++;
        compare(NK.roundSnapshot(full), recon, '', false);
      }
      const sum = a => a.reduce((s, v) => s + v, 0);
      return {
        error,
        keyframes: stat.keyframes,
        applied: stat.applied,
        nullAfterLoss: stat.nullAfterLoss,
        maxListen: stat.maxListen,
        towed: stat.towed,
        bossSteps: stat.bossSteps,
        fullCut: Math.round(sum(stat.full) / stat.full.length),
        fullMax: Math.max(...stat.full),
        packetCut: Math.round(sum(stat.packet) / stat.packet.length),
        packetMax: Math.max(...stat.packet),
        packets: stat.packet.length,
      };
    },
    { steps, loss },
  );
}

test('Net encoding: the reconstruction matches the rounded full snapshot (600 steps, boss fight)', async ({ page }) => {
  const r = await runScenario(page, { steps: 600 });
  console.log(
    `Snapshot voll: Schnitt ${r.fullCut} B, max ${r.fullMax} B | kodiert: Schnitt ${r.packetCut} B, max ${r.packetMax} B | ` +
      `${Math.round((r.packetCut / r.fullCut) * 100)} % | Pakete ${r.packets}, Keyframes ${r.keyframes} | max. Listen ${JSON.stringify(r.maxListen)} | ` +
      `geschleppt ${r.towed} Schritte, Boss ${r.bossSteps} Schritte`,
  );
  expect(r.error).toEqual([]);
  expect(r.applied).toBe(300);
  expect(r.keyframes).toBe(10);
  // The scenario covers the important lists
  expect(r.bossSteps).toBeGreaterThan(100);
  expect(r.towed).toBeGreaterThan(0);
  for (const list of [
    'enemies',
    'asteroids',
    'bosses',
    'laser',
    'missiles',
    'bombs',
    'hackProjectiles',
    'enemyLaser',
    'bossLaser',
    'bossMissiles',
    'bossBombs',
    'powerups',
  ]) {
    expect(r.maxListen[list], list).toBeGreaterThan(0);
  }
  // Size guard: encodes at most 35 % of the full snapshot
  expect(r.packetCut).toBeLessThanOrEqual(r.fullCut * 0.35);
});

test('Net encoding: after packet loss the client waits for the next keyframe and is exact again afterwards', async ({
  page,
}) => {
  const r = await runScenario(page, { steps: 300, loss: [5, 40, 41, 75, 89] });
  expect(r.error).toEqual([]);
  // Loss at 5 -> 6..30 dropped, 31 keyframe; 40/41 -> 42..60; 75 -> 76..90 (89 lost) -> 91 keyframe
  expect(r.keyframes).toBe(5);
  expect(r.nullAfterLoss).toBe(25 + 19 + 14);
  expect(r.applied).toBe(150 - 5 - 25 - 19 - 14);
});

test('Net encoding: ids, rounding and dead reckoning in detail', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const NK = await import('./js/net-encoding.js');
    const empty = {
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
    };
    const snap = (laser, extra) =>
      Object.assign(
        {},
        empty,
        { p1: { x: 1.26, hacks: [] }, p2: null, score: 0, level: 1, bossActive: false, laser },
        extra || {},
      );
    const k = new NK.SnapshotEncoder();
    const d = new NK.SnapshotDecoder();
    const out = {};
    const round = (s, t) => {
      const p = k.encode(s, t);
      return { p, r: d.decode(JSON.parse(JSON.stringify(p))) };
    };

    // Without a keyframe the decoder accepts no deltas
    const foreign = new NK.SnapshotEncoder();
    foreign.encode(snap([]), 0);
    out.withoutKeyframe = new NK.SnapshotDecoder().decode(JSON.parse(JSON.stringify(foreign.encode(snap([]), 2))));

    const a = round(
      snap([
        { id: 'l_404', x: 100.04, y: 500.123456, vx: 2, vy: 15, owner: 'p2', color: 'x' },
        { id: 'sonder_7', x: 5, y: 500.1, vx: 0, vy: 15 },
      ]),
      0,
    );
    out.keyframe = a.p.k;
    out.ids = a.r.laser.map(l => l.id);
    out.idCodes = a.p.l.laser.i;
    out.x = a.r.laser[0].x;
    out.p1x = a.r.p1.x;
    // 4 steps later exactly on the predicted path (player laser: y -= vy): no x/y in the packet
    const b = round(
      snap([
        { id: 'l_404', x: 108, y: 440.1, vx: 2, vy: 15, owner: 'p2', color: 'x' },
        { id: 'sonder_7', x: 5, y: 440.3, vx: 0, vy: 15 },
      ]),
      4,
    );
    out.deltaB = b.p.l && b.p.l.laser;
    out.reconB = b.r.laser.map(l => [l.x, l.y]);
    // Deflected (vx changed, position deviates): x is sent
    const c = round(
      snap([{ id: 'l_404', x: 100, y: 410.1, vx: -3, vy: 15, owner: 'p2', color: 'x' }], { bossWarningActive: true }),
      6,
    );
    out.deltaC = c.p.l.laser;
    out.topC = c.p.o;
    out.reconC = c.r.laser;
    out.warningC = c.r.bossWarningActive;
    // Optional field disappears again
    const e = round(snap([], {}), 8);
    out.topE = e.p.o;
    out.warningE = 'bossWarningActive' in e.r;
    return out;
  });
  expect(r.withoutKeyframe).toBeNull();
  expect(r.keyframe).toBe(1);
  expect(r.ids).toEqual(['l_404', 'sonder_7']);
  expect(r.idCodes).toEqual([404, 'sonder_7']);
  expect(r.x).toBe(100);
  expect(r.p1x).toBe(1.3);
  expect(r.deltaB).toBeUndefined();
  // sonder_7 deviates by 0.2 px and stays on the prediction
  expect(r.reconB).toEqual([
    [108, 440.1],
    [5, 440.1],
  ]);
  expect(r.deltaC).toEqual({ i: [404], d: [{ x: 100, vx: -3 }] });
  expect(r.topC).toEqual({ bossWarningActive: true });
  expect(r.reconC).toEqual([{ id: 'l_404', x: 100, y: 410.1, vx: -3, vy: 15, owner: 'p2', color: 'x' }]);
  expect(r.warningC).toBe(true);
  expect(r.topE).toEqual({ _d: ['bossWarningActive'] });
  expect(r.warningE).toBe(false);
});

// Set up client mode (without a real connection)
async function asClient(page) {
  await page.evaluate(LISTEN_ARRAYS => {
    const { state, arrays, Utils } = window.__game;
    Utils.setGameMode('online');
    Utils.applyPlayfieldWidth('online'); // Game start: only now does the online width (600 px) apply
    state.gameRunning = true;
    state.paused = false;
    state.cutsceneActive = false;
    state.gameOverActive = false;
    state.bossWarningActive = false;
    state.network.isOnline = true;
    state.network.isHost = false;
    state.network.isClient = true;
    state.network.connected = true;
    LISTEN_ARRAYS.forEach(n => {
      arrays[n].forEach(o => {
        if (o.el) o.el.remove();
      });
      arrays[n].length = 0;
    });
    window.__snapshot = extra =>
      Object.assign(
        {
          p1: { x: 200, y: 400, rotate: 0, lives: 3, energy: 50, maxEnergy: 50, isDead: false, hacks: [] },
          p2: { x: 350, y: 400, rotate: 0, lives: 3, energy: 50, maxEnergy: 50, isDead: false, hacks: [] },
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
        },
        extra || {},
      );
  }, LISTEN_ARRAYS);
}

test('Inputs: held missile and bomb keys fire on the host exactly as before', async ({ page }) => {
  await asHost(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, arrays } = g;
    const NK = await import('./js/net-encoding.js');
    const { simulationStep } = await import('./js/loop.js');
    state.godMode = true;
    // Hold long, release, tap briefly (1 step), hold again
    const pattern = i => ({
      missile: (i >= 10 && i < 400) || i === 470 || (i >= 520 && i < 560),
      bomb: (i >= 5 && i < 120) || i === 300 || (i >= 400 && i < 410),
    });
    function run(fresh) {
      ['laserArray', 'missileArray', 'bombArray', 'enemies', 'asteroids'].forEach(n => {
        arrays[n].forEach(o => {
          if (o.el) o.el.remove();
        });
        arrays[n].length = 0;
      });
      Object.assign(state.p2, {
        missileCooldown: 0,
        bombCooldown: 0,
        networkFireMissile: false,
        networkFireBomb: false,
        missileHeld: false,
        bombHeld: false,
        laserInputRequested: false,
        isDead: false,
        missileTier: 1,
        bombTier: 1,
        hacks: [],
      });
      state.frameCounter = 10;
      const sender = new NK.InputSender();
      let missiles = 0,
        bombs = 0,
        packets = 0;
      for (let i = 0; i < 700; i++) {
        const m = pattern(i);
        const input = { x: 370, y: 400, rotate: 0, laser: false, missile: m.missile, bomb: m.bomb };
        if (fresh) {
          const p = sender.next(input);
          if (p) {
            packets++;
            g.Network.receiveInputPacket(JSON.parse(JSON.stringify(p)));
          }
        } else {
          // Before: a full packet every client frame
          packets++;
          g.Network.applyPlayerInput(input);
        }
        state.p2.invulnerableTimer = 1000;
        const rcd = state.p2.missileCooldown;
        const bcd = state.p2.bombCooldown;
        simulationStep();
        if (state.p2.missileCooldown > rcd) missiles++;
        if (state.p2.bombCooldown > bcd) bombs++;
        // Short bomb cooldown so holding counts several times (the same in both runs)
        if (state.p2.bombCooldown > 50) state.p2.bombCooldown = 50;
        arrays.asteroids.forEach(o => o.el && o.el.remove());
        arrays.asteroids.length = 0;
        arrays.enemies.forEach(o => o.el && o.el.remove());
        arrays.enemies.length = 0;
      }
      return { missiles, bombs, packets };
    }
    return { old: run(false), fresh: run(true), online: state.network.isOnline };
  });
  console.log(
    `input packets in 700 steps: before ${r.old.packets}, now ${r.fresh.packets} | missiles ${r.old.missiles}/${r.fresh.missiles}, bombs ${r.old.bombs}/${r.fresh.bombs}`,
  );
  expect(r.online).toBe(true);
  expect(r.old.missiles).toBeGreaterThanOrEqual(4);
  expect(r.old.bombs).toBeGreaterThanOrEqual(4);
  expect(r.fresh.missiles).toBe(r.old.missiles);
  expect(r.fresh.bombs).toBe(r.old.bombs);
  expect(r.fresh.packets).toBeLessThan(r.old.packets / 10);
});

test('Inputs: the client sends immediately only on a key change, movement every 2nd step, otherwise a heartbeat', async ({
  page,
}) => {
  await asClient(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const { simulationStep } = await import('./js/loop.js');
    const keys = state.keysPressed;
    Object.keys(keys).forEach(k => {
      keys[k] = false;
    });
    const tally = n => {
      const beforehand = state.network.inputPackets || 0;
      for (let i = 0; i < n; i++) simulationStep();
      return (state.network.inputPackets || 0) - beforehand;
    };
    const out = {};
    tally(1);
    out.rest90 = tally(90);
    keys.k = true;
    out.pressure = tally(1);
    out.pressureValue = state.network.lastSentInput.missile;
    out.hold = tally(10);
    keys.k = false;
    out.release = tally(1);
    out.releaseValue = state.network.lastSentInput.missile;
    keys.d = true;
    out.movement20 = tally(20);
    out.xRounded = state.network.lastSentInput.x === Math.round(state.network.lastSentInput.x * 10) / 10;
    const { PROTOCOL_VERSION } = await import('./js/net-encoding.js');
    out.versionFits = state.network.lastSentInput.v === PROTOCOL_VERSION;
    keys.d = false;
    return out;
  });
  expect(r).toEqual({
    rest90: 3,
    pressure: 1,
    pressureValue: true,
    hold: 0,
    release: 1,
    releaseValue: false,
    movement20: 10,
    xRounded: true,
    versionFits: true,
  });
});

test('Client applies encoded packets and requests a keyframe after a gap', async ({ page }) => {
  await asClient(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, arrays } = g;
    const NK = await import('./js/net-encoding.js');
    const k = new NK.SnapshotEncoder();
    const enemy = (x, hp) => ({
      id: 'f_7',
      x,
      y: 50,
      hp,
      maxHp: 30,
      size: 30,
      type: 1,
      pattern: 'normal',
      hasShield: false,
      shieldHp: 0,
    });
    const send = (snap, t) => JSON.parse(JSON.stringify(k.encode(snap, t)));
    const out = {};
    g.Network.receiveSnapshotPacket(send(window.__snapshot({ enemies: [enemy(100, 30)], score: 10 }), 0));
    out.afterKeyframe = [arrays.enemies.length, arrays.enemies[0].x, state.score];
    g.Network.receiveSnapshotPacket(send(window.__snapshot({ enemies: [enemy(103.33, 20)], score: 20 }), 2));
    out.afterDelta = [arrays.enemies[0].x, arrays.enemies[0].hp, state.score];
    state.network.lastSentEvent = null;
    send(window.__snapshot({ enemies: [enemy(106, 20)], score: 30 }), 4); // gets lost
    g.Network.receiveSnapshotPacket(send(window.__snapshot({ enemies: [enemy(109, 20)], score: 40 }), 6));
    out.afterGap = [arrays.enemies[0].x, state.score];
    out.request = state.network.lastSentEvent && state.network.lastSentEvent.type;
    k.forceKeyframe();
    g.Network.receiveSnapshotPacket(send(window.__snapshot({ enemies: [], score: 50 }), 8));
    out.afterNewKeyframe = [arrays.enemies.length, state.score];
    out.online = state.network.isOnline;
    return out;
  });
  expect(r).toEqual({
    afterKeyframe: [1, 100, 10],
    afterDelta: [103.3, 20, 20],
    afterGap: [103.3, 20],
    request: 'keyframe_request',
    afterNewKeyframe: [0, 50],
    online: true,
  });
});

test('Protocol: a matching version is accepted, another version ends the session with a hint', async ({ page }) => {
  await asHost(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const NK = await import('./js/net-encoding.js');
    g.Network.handleNetworkEvent({ type: 'hallo', protocol: NK.PROTOCOL_VERSION, version: '1.7.0' }, 'peer');
    const matching = { online: state.network.isOnline, ok: state.network.protocolOk };
    g.Network.handleNetworkEvent({ type: 'hallo', protocol: NK.PROTOCOL_VERSION - 1, version: '1.6.60' }, 'peer');
    const status = document.getElementById('online-status');
    return {
      matching,
      online: state.network.isOnline,
      connected: state.network.connected,
      game: state.gameRunning,
      text: status.textContent,
      visible: status.style.display,
      color: status.style.color,
      lastEvent: state.network.lastSentEvent && state.network.lastSentEvent.type,
    };
  });
  expect(r).toEqual({
    matching: { online: true, ok: true },
    online: false,
    connected: false,
    game: false,
    text: 'Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)',
    visible: 'block',
    color: 'rgb(231, 76, 60)',
    lastEvent: 'peer_left',
  });
});

test('Protocol: the client drops old snapshots and the host old inputs (session ends with a hint)', async ({
  page,
}) => {
  await asClient(page);
  const client = await page.evaluate(() => {
    const g = window.__game;
    g.Network.receiveSnapshotPacket(window.__snapshot({ enemies: [{ id: 'f_1', x: 10, y: 10, hp: 1, maxHp: 1 }] }));
    return {
      online: g.state.network.isOnline,
      enemies: g.arrays.enemies.length,
      text: document.getElementById('online-status').textContent,
    };
  });
  expect(client).toEqual({
    online: false,
    enemies: 0,
    text: 'Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)',
  });

  await asHost(page);
  const host = await page.evaluate(() => {
    const g = window.__game;
    g.Network.receiveInputPacket({ x: 100, y: 100, rotate: 0, laser: true, missile: false, bomb: false });
    return {
      online: g.state.network.isOnline,
      applied: g.state.p2.x === 100,
      text: document.getElementById('online-status').textContent,
    };
  });
  expect(host).toEqual({
    online: false,
    applied: false,
    text: 'Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)',
  });
});

test('Protocol: without hello from the teammate the session ends after the timeout', async ({ page }) => {
  await installClock(page);
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.state);
  // Pause the clock: the hello timeout (setTimeout) only fires via fastForward, without frame-by-frame simulation
  await pauseClock(page);
  await page.evaluate(() => {
    const g = window.__game;
    g.Utils.setGameMode('online');
    g.state.network.isOnline = true;
    g.state.network.isHost = true;
    g.Network.onPeerJoined('alter_peer');
  });
  expect(await page.evaluate(() => window.__game.state.network.connected)).toBe(true);
  const status = () =>
    page.evaluate(() => ({
      online: window.__game.state.network.isOnline,
      text: document.getElementById('online-status').textContent,
    }));
  // Shortly before HELLO_TIMEOUT_MS (10 s) the session is still running
  await page.clock.fastForward(10000 - 100);
  expect((await status()).online).toBe(true);
  await page.clock.fastForward(200);
  const r = await page.evaluate(() => ({
    online: window.__game.state.network.isOnline,
    text: document.getElementById('online-status').textContent,
  }));
  expect(r).toEqual({ online: false, text: 'Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)' });
});
