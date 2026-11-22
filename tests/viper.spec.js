const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helpers');

// Viper-X evasive roll: double tap left/right (mobile: swipe on the joystick) rolls 70 px in 12 steps,
// invulnerable, cooldown 90 steps from the roll start. All deterministic via simulationStep().

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
});

// Start a game with the chosen ships and clear the field. window.__viperTest.empty() sets up a
// deterministic initial state, tap() performs a double tap (3 steps, key held at the end).
async function startGame(page, { coop = false, p1 = 'viper', p2 = 'viper' } = {}) {
  if (coop) {
    await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
    await page.locator('.hangar-player-tab[data-player="p2"]').click();
    await page.locator(`.hangar-model-btn[data-model="${p2}"]`).click();
    await page.locator('.hangar-player-tab[data-player="p1"]').click();
  }
  await page.locator(`.hangar-model-btn[data-model="${p1}"]`).click();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    window.__viperTest = {
      empty() {
        const { state, arrays } = window.__game;
        [
          'enemies',
          'asteroids',
          'enemyLaserArray',
          'hackProjectileArray',
          'bossLaserArray',
          'bossBombArray',
          'bossMissileArray',
          'bosses',
          'powerups',
          'laserArray',
          'missileArray',
        ].forEach(name => {
          arrays[name].forEach(o => o.el && o.el.remove());
          arrays[name].length = 0;
        });
        Object.keys(state.keysPressed).forEach(k => {
          state.keysPressed[k] = false;
        });
        state.frameCounter = 1; // no spawns in the next 100 steps
        state.level = 1;
        state.bossActive = false;
        state.hacks = [];
        state.joystick.active = false;
        state.joystick.x = 0;
        state.joystick.y = 0;
        for (const s of [state, state.p2]) {
          s.hacks = [];
          s.lives = 3;
          s.shieldTier = 0;
          s.invulnerableTimer = 0;
          s.isDead = false;
          s.viperRollTimer = 0;
          s.viperRollDirection = 0;
          s.viperRollCooldown = 0;
          s.viperLeftHeld = false;
          s.viperRightHeld = false;
          s.viperTapDirection = 0;
          s.viperTapAge = 999;
          s.viperJoyRest = 0;
          s.viperJoyBeforehand = 0;
          s.viperCombo = 0;
          s.viperComboTimer = 0;
          s.viperOverdriveStrip = 0;
          s.viperOverdriveTimer = 0;
          s.laserTier = 1;
          s.playerShotCooldown = 0;
          s.energy = s.maxEnergy;
        }
        state.score = 0;
        state.x = 150;
        state.y = 400;
        state.p2.x = 250;
        state.p2.y = 400;
        window.__game.Audio.clearAudioHistory();
      },
      steps(n) {
        for (let i = 0; i < n; i++) window.__game.Loop.simulationStep();
      },
      // Two press edges distance steps apart; returns after the second press step (key held)
      tap(key, distance = 2) {
        const t = window.__game.state.keysPressed;
        t[key] = true;
        this.steps(1);
        t[key] = false;
        this.steps(distance - 1);
        t[key] = true;
        this.steps(1);
      },
      roll() {
        return window.__game.Audio.audioHistory.filter(a => a.name === 'roll').length;
      },
    };
  });
}

test.describe('Viper-X Ausweichrolle', () => {
  test('Double tap right: 70 px evenly in 12 steps, class, sound, normal controls again afterwards', async ({
    page,
  }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const el = document.getElementById('spieler');
      T.empty();
      T.steps(1); // let the initial state settle
      const t = state.keysPressed;
      t.d = true;
      T.steps(1);
      t.d = false;
      T.steps(1);
      const x0 = state.x;
      t.d = true;
      T.steps(1); // Start of the roll (second press edge)
      t.d = false;
      const xs = [state.x - x0];
      const afterStart = {
        timer: state.viperRollTimer,
        cls: el.classList.contains('viper-rolle'),
        cd: state.viperRollCooldown,
        sounds: T.roll(),
      };
      for (let i = 0; i < 11; i++) {
        T.steps(1);
        xs.push(state.x - x0);
      }
      const amEnd = {
        x: state.x - x0,
        cls: el.classList.contains('viper-rolle'),
        afterimages: document.querySelectorAll('.viper-nachbild').length,
      };
      T.steps(1);
      const thereafter = { x: state.x - x0, cls: el.classList.contains('viper-rolle'), timer: state.viperRollTimer };
      // Normal controls active again
      t.a = true;
      T.steps(3);
      t.a = false;
      const left = state.x - x0;
      return { xs, afterStart, amEnd, thereafter, left };
    });
    expect(r.afterStart).toEqual({ timer: 12, cls: true, cd: 90, sounds: 1 });
    expect(r.xs).toHaveLength(12);
    r.xs.forEach((x, i) => expect(x).toBeCloseTo((70 / 12) * (i + 1), 3));
    expect(r.amEnd.x).toBeCloseTo(70, 3);
    expect(r.amEnd.cls).toBe(true);
    expect(r.amEnd.afterimages).toBeGreaterThan(0);
    expect(r.thereafter.x).toBeCloseTo(70, 3);
    expect(r.thereafter.cls).toBe(false);
    expect(r.thereafter.timer).toBe(0);
    expect(r.left).toBeLessThan(70);
  });

  test('Double tap left (A and arrow left): 70 px to the left', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const out = [];
      for (const key of ['a', 'arrowleft']) {
        T.empty();
        state.x = 250;
        const t = state.keysPressed;
        t[key] = true;
        T.steps(1);
        t[key] = false;
        T.steps(1);
        const x0 = state.x;
        t[key] = true;
        T.steps(1);
        t[key] = false;
        T.steps(11);
        out.push(state.x - x0);
      }
      return out;
    });
    r.forEach(d => expect(d).toBeCloseTo(-70, 3));
  });

  test('A single tap and a too slow double tap (more than 15 steps) do not roll', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      T.empty();
      const t = state.keysPressed;
      const timer = [];
      t.d = true;
      T.steps(1);
      timer.push(state.viperRollTimer);
      t.d = false;
      T.steps(40);
      timer.push(state.viperRollTimer);
      const single = { timer: [...timer], sounds: T.roll() };
      // Two taps 16 steps apart
      T.empty();
      T.tap('d', 16);
      const tooSlow = { timer: state.viperRollTimer, sounds: T.roll() };
      t.d = false;
      T.steps(3);
      // Exactly 15 steps apart still counts
      T.empty();
      T.tap('d', 15);
      const limit = { timer: state.viperRollTimer, sounds: T.roll() };
      // Alternating left and right is not a double tap
      t.d = false;
      T.steps(14);
      T.empty();
      t.a = true;
      T.steps(1);
      t.a = false;
      T.steps(1);
      t.d = true;
      T.steps(1);
      t.d = false;
      T.steps(1);
      const mixed = { timer: state.viperRollTimer, sounds: T.roll() };
      return { single, tooSlow, limit, mixed };
    });
    expect(r.single).toEqual({ timer: [0, 0], sounds: 0 });
    expect(r.tooSlow).toEqual({ timer: 0, sounds: 0 });
    expect(r.limit).toEqual({ timer: 12, sounds: 1 });
    expect(r.mixed).toEqual({ timer: 0, sounds: 0 });
  });

  test('Cooldown: a second double tap during the 90 steps does not roll, afterwards it does', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const t = state.keysPressed;
      T.empty();
      state.x = 100;
      T.tap('d'); // Roll start in this step (step 0 of the cooldown)
      t.d = false;
      T.steps(11); // Roll over at step 12
      T.steps(1);
      const afterRoll = { timer: state.viperRollTimer, cd: state.viperRollCooldown };
      // Double tap left in the middle of the cooldown (around step 30)
      T.steps(15);
      T.tap('a');
      t.a = false;
      T.steps(2);
      const inCooldown = { timer: state.viperRollTimer, sounds: T.roll(), cd: state.viperRollCooldown };
      // The cooldown expires: the last tap lies shortly before the end, so it does not count; a new double tap rolls
      T.steps(100);
      const free = state.viperRollCooldown;
      const x0 = state.x;
      T.tap('a');
      t.a = false;
      T.steps(11);
      return { afterRoll, inCooldown, free, afterSecondaryRoll: { sounds: T.roll(), dx: state.x - x0 } };
    });
    expect(r.afterRoll.timer).toBe(0);
    expect(r.afterRoll.cd).toBeGreaterThan(70);
    expect(r.inCooldown.timer).toBe(0);
    expect(r.inCooldown.sounds).toBe(1);
    expect(r.inCooldown.cd).toBeGreaterThan(0);
    expect(r.free).toBe(0);
    expect(r.afterSecondaryRoll.sounds).toBe(2);
    expect(r.afterSecondaryRoll.dx).toBeLessThan(-60);
  });

  test('Cooldown ends exactly 90 steps after the roll start', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.x = 100;
      T.tap('d');
      state.keysPressed.d = false;
      const values = [state.viperRollCooldown];
      T.steps(89);
      values.push(state.viperRollCooldown);
      T.steps(1);
      values.push(state.viperRollCooldown);
      return values;
    });
    expect(r).toEqual([90, 1, 0]);
  });

  test('Invulnerable during the roll (a stationary enemy laser does not hit), hits afterwards', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__viperTest;
      const t = state.keysPressed;
      T.empty();
      state.x = 100;
      t.d = true;
      T.steps(1);
      t.d = false;
      T.steps(1);
      // Stationary laser in the middle of the ship (the roll starts in the next step)
      Entities.createEnemyLaser(state.x + 14, state.y + 10);
      Object.assign(arrays.enemyLaserArray[0], { vx: 0, vy: 0 });
      t.d = true;
      T.steps(1);
      t.d = false;
      const atStart = {
        lives: state.lives,
        laser: arrays.enemyLaserArray.length,
        invulnerable: window.__game.Utils.isDashInvulnerable(state),
      };
      T.steps(11);
      const duringRoll = { lives: state.lives, laser: arrays.enemyLaserArray.length };
      // The roll is over: a new stationary laser at the ship hits
      T.steps(1);
      const afterRoll = window.__game.Utils.isDashInvulnerable(state);
      Entities.createEnemyLaser(state.x + 14, state.y + 10);
      Object.assign(arrays.enemyLaserArray[arrays.enemyLaserArray.length - 1], { vx: 0, vy: 0 });
      T.steps(1);
      return { atStart, duringRoll, afterRoll, thereafter: { lives: state.lives } };
    });
    expect(r.atStart).toEqual({ lives: 3, laser: 1, invulnerable: true });
    expect(r.duringRoll).toEqual({ lives: 3, laser: 1 });
    expect(r.afterRoll).toBe(false);
    expect(r.thereafter.lives).toBe(2);
  });

  test('Clamped at the playfield edge, also on the left', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, config } = window.__game;
      const T = window.__viperTest;
      const t = state.keysPressed;
      const out = {};
      T.empty();
      state.x = config.playfieldWidth - config.playerSize - 20;
      T.tap('d');
      t.d = false;
      T.steps(11);
      out.right = state.x;
      out.rightMax = config.playfieldWidth - config.playerSize;
      T.empty();
      state.x = 20;
      T.tap('a');
      t.a = false;
      T.steps(11);
      out.left = state.x;
      return out;
    });
    expect(r.right).toBe(r.rightMax);
    expect(r.left).toBe(0);
  });

  test('Only the Viper rolls: Phantom (P1) and Gleve ignore the double tap', async ({ page }) => {
    await startGame(page, { p1: 'phantom' });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.x = 100;
      const t = state.keysPressed;
      t.d = true;
      T.steps(1);
      t.d = false;
      T.steps(1);
      const x0 = state.x;
      t.d = true;
      T.steps(1);
      t.d = false;
      T.steps(11);
      return {
        dx: state.x - x0,
        timer: state.viperRollTimer,
        sounds: T.roll(),
        cls: document.getElementById('spieler').classList.contains('viper-rolle'),
        hud: document.getElementById('viper-rolle-hud').style.display,
      };
    });
    // Normal travel: at most one step of speed, never 70 px
    expect(Math.abs(r.dx)).toBeLessThan(20);
    expect(r.timer).toBe(0);
    expect(r.sounds).toBe(0);
    expect(r.cls).toBe(false);
    expect(r.hud).toBe('none');
  });

  test('Control hack (inverted) redirects the roll, weaponsOffline does not block it', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const out = {};
      T.empty();
      state.x = 200;
      state.hacks = [{ type: 'inverted', timer: 999 }];
      const x0 = state.x;
      T.tap('d');
      state.keysPressed.d = false;
      T.steps(11);
      out.inverted = state.x - x0;
      T.empty();
      state.x = 200;
      state.hacks = [{ type: 'weaponsOffline', timer: 999 }];
      const x1 = state.x;
      T.tap('d');
      state.keysPressed.d = false;
      T.steps(11);
      out.weaponsOffline = state.x - x1;
      return out;
    });
    // The tap step itself still moves (inverted: to the left) and counts towards the difference
    expect(r.inverted).toBeLessThan(-60);
    expect(r.weaponsOffline).toBeGreaterThan(60);
  });

  test('Mobile: a fast swipe on the joystick rolls, slowly pulling in does not', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const j = state.joystick;
      const out = {};
      T.empty();
      state.x = 150;
      j.active = true;
      j.x = 0;
      T.steps(2);
      const x0 = state.x;
      j.x = 1;
      T.steps(1);
      out.swipe = { timer: state.viperRollTimer, sounds: T.roll() };
      T.steps(11);
      out.swipeDx = state.x - x0;
      j.active = false;
      j.x = 0;
      T.steps(1);

      // Slow: 0.05 per step up to 1.0
      T.empty();
      state.x = 150;
      j.active = true;
      for (let k = 0; k <= 30; k++) {
        j.x = Math.min(1, k * 0.05);
        T.steps(1);
      }
      out.slow = { sounds: T.roll(), timer: state.viperRollTimer };
      j.active = false;
      j.x = 0;
      // To the left
      T.empty();
      state.x = 250;
      j.active = true;
      j.x = 0;
      T.steps(2);
      const x1 = state.x;
      j.x = -1;
      T.steps(12);
      out.leftDx = state.x - x1;
      j.active = false;
      j.x = 0;
      return out;
    });
    expect(r.swipe).toEqual({ timer: 12, sounds: 1 });
    // The joystick is fully right in this step; the roll replaces the travel, exactly 70 px remain
    expect(r.swipeDx).toBeCloseTo(70, 3);
    expect(r.slow).toEqual({ sounds: 0, timer: 0 });
    expect(r.leftDx).toBeCloseTo(-70, 3);
  });

  test('Local co-op: P2 rolls with the arrow keys, P1 with A/D, independently of each other', async ({ page }) => {
    await startGame(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const t = state.keysPressed;
      T.empty();
      state.p2IsBot = false;
      state.x = 100;
      state.p2.x = 200;
      // P2: arrow right twice
      t.arrowright = true;
      T.steps(1);
      t.arrowright = false;
      T.steps(1);
      const p2x0 = state.p2.x;
      const p1x0 = state.x;
      t.arrowright = true;
      T.steps(1);
      t.arrowright = false;
      T.steps(11);
      const p2 = {
        dx: state.p2.x - p2x0,
        timer: state.viperRollTimer,
        cd: state.p2.viperRollCooldown,
        p1dx: state.x - p1x0,
        p1cd: state.viperRollCooldown,
      };
      // P1: A twice (P1 cooldown independent)
      T.empty();
      state.p2IsBot = false;
      state.x = 200;
      state.p2.x = 100;
      t.a = true;
      T.steps(1);
      t.a = false;
      T.steps(1);
      const q1x0 = state.x;
      t.a = true;
      T.steps(1);
      t.a = false;
      T.steps(11);
      const p1 = { dx: state.x - q1x0, p2cd: state.p2.viperRollCooldown, p2timer: state.p2.viperRollTimer };
      return {
        p2,
        p1,
        class2: document.getElementById('spieler-2').classList.contains('viper-rolle'),
        hud2: document.getElementById('viper-rolle-hud-p2').style.display,
      };
    });
    expect(r.p2.dx).toBeCloseTo(70, 3);
    expect(r.p2.timer).toBe(0);
    expect(r.p2.cd).toBeGreaterThan(70);
    expect(r.p2.p1dx).toBe(0);
    expect(r.p2.p1cd).toBe(0);
    expect(r.p1.dx).toBeCloseTo(-70, 3);
    expect(r.p1.p2cd).toBe(0);
    expect(r.p1.p2timer).toBe(0);
    expect(r.class2).toBe(false);
    expect(r.hud2).toBe('block');
  });

  test('HUD: readiness display only for the Viper, green when ready, fills up during the cooldown', async ({
    page,
  }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const hud = document.getElementById('viper-rolle-hud');
      T.empty();
      T.steps(2);
      const ready = { display: hud.style.display, ready: hud.classList.contains('bereit') };
      T.tap('d');
      state.keysPressed.d = false;
      T.steps(1);
      const isCharging = {
        ready: hud.classList.contains('bereit'),
        width: parseFloat(hud.firstElementChild.style.width),
      };
      T.steps(100);
      const again = {
        ready: hud.classList.contains('bereit'),
        width: parseFloat(hud.firstElementChild.style.width),
      };
      return { ready, isCharging, again };
    });
    expect(r.ready).toEqual({ display: 'block', ready: true });
    expect(r.isCharging.ready).toBe(false);
    expect(r.isCharging.width).toBeLessThan(10);
    expect(r.again).toEqual({ ready: true, width: 100 });
  });
});

test.describe('Viper-X Ausweichrolle: Bot', () => {
  test('Bot Viper rolls to the freer side on a very near projectile, and not during the cooldown', async ({ page }) => {
    await startGame(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__viperTest;
      const out = {};
      const standingProjectile = p => {
        Entities.createEnemyLaser(p.x + 13, p.y - 17);
        Object.assign(arrays.enemyLaserArray[arrays.enemyLaserArray.length - 1], { vx: 0, vy: 0 });
      };
      const prepare = x => {
        T.empty();
        state.p2IsBot = true;
        state.p2BotDifficulty = 'hard';
        state.x = 340;
        state.p2.x = x;
        state.p2.y = 500;
      };

      // Near the left edge: the right side is freer
      prepare(30);
      standingProjectile(state.p2);
      T.steps(3);
      out.left = { timer: state.p2.viperRollTimer, direction: state.p2.viperRollDirection, sounds: T.roll() };
      T.steps(12);
      out.leftX = state.p2.x;

      // Near the right edge: the left side is freer
      prepare(window.__game.config.playfieldWidth - 60);
      state.x = 20;
      standingProjectile(state.p2);
      T.steps(3);
      out.right = { direction: state.p2.viperRollDirection, sounds: T.roll() };

      // Cooldown free but no danger: no roll
      prepare(200);
      T.steps(20);
      out.withoutDanger = T.roll();

      // During the cooldown the bot does not roll, even in danger
      prepare(200);
      state.p2.viperRollCooldown = 50;
      standingProjectile(state.p2);
      T.steps(3);
      out.inCooldown = T.roll();
      return out;
    });
    expect(r.left.timer).toBeGreaterThan(0);
    expect(r.left.direction).toBe(1);
    expect(r.left.sounds).toBe(1);
    expect(r.leftX).toBeGreaterThan(80);
    expect(r.right).toEqual({ direction: -1, sounds: 1 });
    expect(r.withoutDanger).toBe(0);
    expect(r.inCooldown).toBe(0);
  });

  test('Bot Phantom never rolls', async ({ page }) => {
    await startGame(page, { coop: true, p2: 'phantom' });
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      state.p2.x = 200;
      state.p2.y = 500;
      Entities.createEnemyLaser(213, 483);
      Object.assign(arrays.enemyLaserArray[0], { vx: 0, vy: 0 });
      T.steps(5);
      return { sounds: T.roll(), timer: state.p2.viperRollTimer };
    });
    expect(r).toEqual({ sounds: 0, timer: 0 });
  });
});

test.describe('Viper-X Ausweichrolle: Online', () => {
  // Online state without a real connection: host = true host, otherwise client (P2)
  async function asOnline(page, host) {
    await page.evaluate(host => {
      const { state, arrays, Utils } = window.__game;
      Utils.setGameMode('online');
      state.gameRunning = true;
      state.paused = false;
      state.cutsceneActive = false;
      state.gameOverActive = false;
      state.bossWarningActive = false;
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'viper';
      state.network.isOnline = true;
      state.network.isHost = host;
      state.network.isClient = !host;
      state.network.connected = true;
      state.frameCounter = 1;
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
      Object.keys(state.keysPressed).forEach(k => {
        state.keysPressed[k] = false;
      });
    }, host);
  }

  test('Host serializes the roll state of both ships, it survives the net encoding and the client shows the class', async ({
    page,
  }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await asOnline(page, true);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const { state } = g;
      const NK = await import('./js/net-encoding.js');
      const out = {};
      state.viperRollTimer = 7;
      state.viperRollDirection = -1;
      state.viperRollCooldown = 61.4;
      state.p2.viperRollTimer = 0;
      state.p2.viperRollCooldown = 33;
      const full = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
      out.p1 = [full.p1.viperRollTimer, full.p1.viperRollDirection, full.p1.viperRollCooldown];
      out.p2 = [full.p2.viperRollTimer, full.p2.viperRollCooldown];

      // A non-Viper carries no roll fields
      state.p2.selectedShipModel = 'phantom';
      out.phantomFields = 'viperRollTimer' in g.Network.serializeGameState().p2;
      state.p2.selectedShipModel = 'viper';

      // Encode and decode as on the wire (integer rounding)
      const encoder = new NK.SnapshotEncoder();
      const decoder = new NK.SnapshotDecoder();
      const recon = decoder.decode(JSON.parse(JSON.stringify(encoder.encode(full, 0))));
      out.wire = [
        recon.p1.viperRollTimer,
        recon.p1.viperRollDirection,
        recon.p1.viperRollCooldown,
        recon.p2.viperRollCooldown,
      ];

      // The client applies: host P1 still rolls for 7 steps
      state.network.isHost = false;
      state.network.isClient = true;
      state.viperRollTimer = 0;
      state.viperRollCooldown = 0;
      g.Network.applyGameStateSnapshot(recon);
      g.Audio.clearAudioHistory();
      out.cooldownClient = state.p2.viperRollCooldown;
      const el = document.getElementById('spieler');
      const classes = [];
      for (let i = 0; i < 9; i++) {
        g.Loop.simulationStep();
        classes.push(el.classList.contains('viper-rolle'));
      }
      out.classes = classes;
      out.cooldownAfterSteps = state.p2.viperRollCooldown;
      return out;
    });
    // The raw value is serialized, rounding happens only when encoding
    expect(r.p1).toEqual([7, -1, 61.4]);
    expect(r.p2).toEqual([0, 33]);
    expect(r.phantomFields).toBe(false);
    expect(r.wire).toEqual([7, -1, 61, 33]);
    // 7 remaining steps from the snapshot: drawing happens after every step (after counting down, as on the host),
    // so the class stays for 6 client steps, then gone
    expect(r.classes).toEqual([true, true, true, true, true, true, false, false, false]);
    expect(r.cooldownClient).toBe(33);
    // The client keeps counting the applied cooldown down itself
    expect(r.cooldownAfterSteps).toBe(24);
  });

  test('Client predicts its own roll and reports start and direction; the host rolls from there', async ({ page }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await asOnline(page, false);
    const packet = await page.evaluate(() => {
      const g = window.__game;
      const { state } = g;
      const t = state.keysPressed;
      const el = document.getElementById('spieler-2');
      state.p2.x = 150;
      state.p2.y = 400;
      state.p2.viperRollCooldown = 0;
      const packets = [];
      const step = () => {
        g.Loop.simulationStep();
        packets.push(g.Network.serializePlayerInput());
      };
      t.d = true;
      step();
      t.d = false;
      step();
      const x0 = state.p2.x;
      t.d = true;
      step();
      t.d = false;
      const classAfterStart = el.classList.contains('viper-rolle');
      for (let i = 0; i < 11; i++) step();
      return { packets: packets.map(p => ({ x: p.x, ro: p.ro })), x0, xEnd: state.p2.x, classAfterStart };
    });
    // The start packet carries the position before the roll and the direction, only this one
    expect(packet.packets[2]).toEqual({ x: packet.x0, ro: 1 });
    expect(packet.packets.filter(p => p.ro !== undefined)).toHaveLength(1);
    expect(packet.classAfterStart).toBe(true);
    expect(packet.xEnd - packet.x0).toBeCloseTo(70, 3);

    // Host: receive the start packet, then P2 rolls there for 12 steps, ignores client positions and is invulnerable
    await asOnline(page, true);
    const host = await page.evaluate(async p => {
      const g = window.__game;
      const { state, arrays, Entities } = g;
      const NK = await import('./js/net-encoding.js');
      const out = {};
      state.p2.viperRollTimer = 0;
      state.p2.viperRollCooldown = 0;
      state.p2.isDead = false;
      state.p2.lives = 3;
      state.p2.y = 400;
      // The sender sends the start packet immediately
      const sender = new NK.InputSender();
      const input = { x: p.x0, y: 400, rotate: 0, laser: false, missile: false, bomb: false };
      sender.next(input);
      const startPacket = sender.next({ ...input, ro: 1 });
      out.senderPacket = startPacket ? startPacket.ro : null;
      g.Network.applyPlayerInput({ ...input, ro: 1 });
      // Wrong direction values are ignored
      out.withRo = state.p2.networkRollRequest;
      // A following client packet with a further position must not shift the start point
      g.Network.applyPlayerInput({ ...input, x: p.x0 + 12 });
      out.xBeforeStart = state.p2.x;
      Entities.createEnemyLaser(p.x0 + 14, 410);
      Object.assign(arrays.enemyLaserArray[0], { vx: 0, vy: 0 });
      g.Loop.simulationStep();
      out.afterStart = {
        timer: state.p2.viperRollTimer,
        cls: document.getElementById('spieler-2').classList.contains('viper-rolle'),
        lives: state.p2.lives,
        cd: state.p2.viperRollCooldown,
      };
      // Client positions during the roll are ignored
      g.Network.applyPlayerInput({ ...input, x: 5 });
      for (let i = 0; i < 11; i++) g.Loop.simulationStep();
      out.dx = state.p2.x - p.x0;
      out.lives = state.p2.lives;
      out.snapshot = [
        g.Network.serializeGameState().p2.viperRollTimer,
        g.Network.serializeGameState().p2.viperRollCooldown,
      ];
      g.Loop.simulationStep();
      out.thereafter = state.p2.viperRollTimer;
      // A second request during the cooldown is rejected
      g.Network.applyPlayerInput({ ...input, x: state.p2.x, ro: -1 });
      g.Loop.simulationStep();
      out.second = state.p2.viperRollTimer;
      return out;
    }, packet);
    expect(host.senderPacket).toBe(1);
    expect(host.withRo).toBe(1);
    expect(host.xBeforeStart).toBeCloseTo(packet.x0, 3);
    expect(host.afterStart.timer).toBe(12);
    expect(host.afterStart.cls).toBe(true);
    expect(host.afterStart.lives).toBe(3);
    expect(host.afterStart.cd).toBe(90);
    expect(host.dx).toBeCloseTo(70, 3);
    expect(host.lives).toBe(3);
    expect(host.snapshot[0]).toBe(1);
    expect(host.snapshot[1]).toBeGreaterThan(70);
    expect(host.thereafter).toBe(0);
    expect(host.second).toBe(0);
  });
});

// --- Near-Miss + Overdrive ---
// An enemy projectile that comes within <= 18 px of the ship without hitting and then moves away
// charges the overdrive strip by 10. At 100 the overdrive starts for 300 steps (double fire rate, pierce).

// Create an enemy laser (no aiming, straight down) with left edge x above the ship
async function nearMissLane(page, { x, list = 'enemyLaserArray', harmless = false, ys = [300], steps = 60 }) {
  return page.evaluate(
    ({ x, list, harmless, ys, steps }) => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.viperOverdriveStrip = 0;
      state.viperOverdriveTimer = 0;
      state.x = 150;
      state.y = 400;
      ys.forEach((y, i) => {
        const el = document.createElement('div');
        el.classList.add('feind-laser');
        document.getElementById('spielfeld').appendChild(el);
        arrays[list].push({
          id: 'nm' + i,
          el,
          x,
          y,
          vx: 0,
          vy: 5,
          width: 4,
          height: 15,
          harmless: harmless || undefined,
        });
      });
      const lives = state.lives;
      T.steps(steps);
      return {
        strip: state.viperOverdriveStrip,
        timer: state.viperOverdriveTimer,
        lives: state.lives,
        lost: lives - state.lives,
        ticks: window.__game.Audio.audioHistory.filter(a => a.name === 'nearMiss').length,
        plus: document.querySelectorAll('.viper-nearmiss-plus').length,
      };
    },
    { x, list, harmless, ys, steps },
  );
}

test.describe('Viper-X near miss and overdrive', () => {
  test('Projectile 10 px beside the ship: +10, only once; 30 px beside: 0; hit: 0; harmless: 0', async ({ page }) => {
    await startGame(page);
    // Ship x 150..180; laser edge at 190 = 10 px distance
    const near = await nearMissLane(page, { x: 190 });
    expect(near.strip).toBe(10);
    expect(near.ticks).toBe(1);
    expect(near.lost).toBe(0);
    // further steps do not count the same projectile again (it is long out of the field, the strip stays)
    const overlaps = await page.evaluate(() => {
      window.__viperTest.steps(30);
      return window.__game.state.viperOverdriveStrip;
    });
    expect(overlaps).toBe(10);
    // Left side: laser right of the edge 150: center 142 -> distance 150 - (142 + 4) = 4
    expect((await nearMissLane(page, { x: 142 })).strip).toBe(10);
    // 30 px daneben
    const remote = await nearMissLane(page, { x: 210 });
    expect(remote.strip).toBe(0);
    expect(remote.ticks).toBe(0);
    // exactly 18 px counts, 19 px does not
    expect((await nearMissLane(page, { x: 198 })).strip).toBe(10);
    expect((await nearMissLane(page, { x: 199 })).strip).toBe(0);
    // A hit does not count
    const hit = await nearMissLane(page, { x: 165 });
    expect(hit.strip).toBe(0);
    expect(hit.lost).toBe(1);
    // harmless (flung away by the Gleve) does not count
    expect((await nearMissLane(page, { x: 190, harmless: true })).strip).toBe(0);
    // A boss laser counts like an enemy laser
    expect((await nearMissLane(page, { x: 190, list: 'bossLaserArray' })).strip).toBe(10);
    // Two projectiles one after another: +20
    expect((await nearMissLane(page, { x: 190, ys: [300, 330] })).strip).toBe(20);
  });

  test('a near miss also counts during the evasive roll; several projectiles with a hack projectile and a missile', async ({
    page,
  }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.viperOverdriveStrip = 0;
      state.viperOverdriveTimer = 0;
      // The roll runs (direction 0: the ship stands still), invulnerable
      state.viperRollTimer = 200;
      state.viperRollDirection = 0;
      const fresh = (list, extra) => {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays[list].push({ id: 'x' + list, el, x: 190, y: 300, vx: 0, vy: 5, width: 4, height: 15, ...extra });
      };
      fresh('enemyLaserArray', {});
      fresh('hackProjectileArray', { y: 280, steerTime: 0, width: 6, height: 6 });
      fresh('bossMissileArray', { y: 260, hp: 5, width: 10, height: 20, speed: 5, turnRate: 0 });
      T.steps(40);
      return state.viperOverdriveStrip;
    });
    expect(r).toBe(30);
  });

  test('10 near misses start the overdrive for 300 steps, the strip empties, off afterwards', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      const out = {};
      T.empty();
      state.viperOverdriveStrip = 0;
      state.viperOverdriveTimer = 0;
      for (let i = 0; i < 10; i++) {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays.enemyLaserArray.push({ id: 'od' + i, el, x: 190, y: 100 + i * 20, vx: 0, vy: 5, width: 4, height: 15 });
      }
      T.steps(100);
      const cls = () => document.getElementById('spieler').classList.contains('viper-overdrive');
      out.start = [state.viperOverdriveStrip, state.viperOverdriveTimer, cls()];
      out.sounds = [
        window.__game.Audio.audioHistory.filter(a => a.name === 'overdrive').length,
        window.__game.Audio.audioHistory.filter(a => a.name === 'nearMiss').length,
      ];
      const timerAfterStart = state.viperOverdriveTimer;
      // further near misses do not recharge during the overdrive
      const el = document.createElement('div');
      document.getElementById('spielfeld').appendChild(el);
      arrays.enemyLaserArray.push({ id: 'extra', el, x: 190, y: 300, vx: 0, vy: 5, width: 4, height: 15 });
      const t0 = timerAfterStart;
      T.steps(60);
      out.middle = [state.viperOverdriveStrip, state.viperOverdriveTimer, t0 - state.viperOverdriveTimer, cls()];
      out.hud = document.getElementById('viper-overdrive-hud').classList.contains('aktiv');
      T.steps(timerAfterStart - 60 - 1);
      out.fast = [state.viperOverdriveTimer, cls()];
      T.steps(1);
      out.off = [state.viperOverdriveStrip, state.viperOverdriveTimer, cls()];
      out.hudOff = document.getElementById('viper-overdrive-hud').classList.contains('aktiv');
      return out;
    });
    expect(r.start[0]).toBeGreaterThan(50);
    expect(r.start[1]).toBeGreaterThan(0);
    expect(r.start[2]).toBe(true);
    expect(r.sounds).toEqual([1, 9]);
    expect(r.middle[2]).toBe(60);
    expect(r.middle[0]).toBeLessThan(r.start[0]);
    expect(r.middle[3]).toBe(true);
    expect(r.hud).toBe(true);
    expect(r.fast).toEqual([1, true]);
    expect(r.off).toEqual([0, 0, false]);
    expect(r.hudOff).toBe(false);
  });

  test('Overdrive lasts exactly 300 steps from the start', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.viperOverdriveStrip = 90;
      state.viperOverdriveTimer = 0;
      const el = document.createElement('div');
      document.getElementById('spielfeld').appendChild(el);
      arrays.enemyLaserArray.push({ id: 'z', el, x: 190, y: 380, vx: 0, vy: 5, width: 4, height: 15 });
      let start = null;
      for (let i = 1; i <= 20 && start === null; i++) {
        T.steps(1);
        if (state.viperOverdriveTimer > 0) start = i;
      }
      const t = state.viperOverdriveTimer;
      let duration = 0;
      while (state.viperOverdriveTimer > 0 && duration < 400) {
        T.steps(1);
        duration++;
      }
      return { t, strip: state.viperOverdriveStrip, duration };
    });
    expect(r.t).toBe(300);
    expect(r.duration).toBe(300);
    expect(r.strip).toBe(0);
  });

  test('in the overdrive half the shot intervals and pierce, outside of it not', async ({ page }) => {
    await startGame(page);
    const measure = overdrive =>
      page.evaluate(overdrive => {
        const { state, arrays } = window.__game;
        const T = window.__viperTest;
        T.empty();
        state.laserTier = 1;
        state.laserPierce = false;
        state.energy = 50;
        state.maxEnergy = 50;
        state.unlimitedEnergy = true;
        state.playerShotCooldown = 0;
        state.viperOverdriveStrip = overdrive ? 100 : 0;
        state.viperOverdriveTimer = overdrive ? 300 : 0;
        // two stationary targets above the ship, one behind the other
        const targets = [300, 200].map((y, i) => {
          const el = document.createElement('div');
          el.classList.add('asteroid');
          document.getElementById('spielfeld').appendChild(el);
          const a = {
            id: 'target' + i,
            el,
            x: 140,
            y,
            size: 50,
            vx: 0,
            vy: 0,
            immune: 0,
            hp: 100000,
            maxHp: 100000,
            isMagma: false,
            isIndestructible: false,
            carriesPowerup: false,
            crackEl: null,
            isEnemy: false,
            rot: 0,
            vRot: 0,
          };
          arrays.asteroids.push(a);
          return a;
        });
        const ids = new Set();
        state.keysPressed.l = true;
        for (let i = 0; i < 30; i++) {
          T.steps(1);
          arrays.laserArray.forEach(l => ids.add(l.id));
        }
        state.keysPressed.l = false;
        return { shots: ids.size, hp: targets.map(z => z.hp) };
      }, overdrive);
    const normal = await measure(false);
    const od = await measure(true);
    expect(normal.hp[0]).toBeLessThan(100000);
    expect(normal.hp[1]).toBe(100000);
    expect(od.hp[0]).toBeLessThan(100000);
    expect(od.hp[1]).toBeLessThan(100000);
    expect(normal.shots).toBe(5);
    expect(od.shots).toBe(10);
  });

  test('Phantom gets no overdrive and no strip in the HUD', async ({ page }) => {
    await startGame(page, { p1: 'phantom' });
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.viperOverdriveStrip = 0;
      state.viperOverdriveTimer = 0;
      for (let i = 0; i < 12; i++) {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays.enemyLaserArray.push({ id: 'ph' + i, el, x: 190, y: 100 + i * 20, vx: 0, vy: 5, width: 4, height: 15 });
      }
      T.steps(100);
      return {
        strip: state.viperOverdriveStrip,
        timer: state.viperOverdriveTimer,
        hud: document.getElementById('viper-overdrive-hud').style.display,
        cls: document.getElementById('spieler').classList.contains('viper-overdrive'),
      };
    });
    expect(r).toEqual({ strip: 0, timer: 0, hud: 'none', cls: false });
  });

  test('Restart resets the strip and the overdrive', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      state.viperOverdriveStrip = 70;
      state.viperOverdriveTimer = 120;
      state.p2.viperOverdriveStrip = 30;
      Utils.restartGame();
      return [state.viperOverdriveStrip, state.viperOverdriveTimer, state.p2.viperOverdriveStrip];
    });
    expect(r).toEqual([0, 0, 0]);
  });

  test('Bot Viper collects near misses without errors', async ({ page }) => {
    await startGame(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      state.p2.viperOverdriveStrip = 0;
      state.p2.viperOverdriveTimer = 0;
      state.x = 340;
      state.p2.x = 150;
      state.p2.y = 400;
      const error = [];
      window.addEventListener('error', e => error.push(e.message));
      for (let i = 0; i < 6; i++) {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays.enemyLaserArray.push({ id: 'b' + i, el, x: 192, y: 100 + i * 25, vx: 0, vy: 5, width: 4, height: 15 });
      }
      T.steps(120);
      return {
        error,
        stripPlausible: state.p2.viperOverdriveStrip >= 0 && state.p2.viperOverdriveStrip <= 100,
        lives: state.p2.lives,
      };
    });
    expect(r.error).toEqual([]);
    expect(r.stripPlausible).toBe(true);
  });
});

test.describe('Viper-X near miss and overdrive: online', () => {
  async function asOnline(page, host) {
    await page.evaluate(host => {
      const { state, arrays, Utils } = window.__game;
      Utils.setGameMode('online');
      state.gameRunning = true;
      state.paused = false;
      state.cutsceneActive = false;
      state.gameOverActive = false;
      state.bossWarningActive = false;
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'viper';
      state.network.isOnline = true;
      state.network.isHost = host;
      state.network.isClient = !host;
      state.network.connected = true;
      state.frameCounter = 1;
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
      Object.keys(state.keysPressed).forEach(k => {
        state.keysPressed[k] = false;
      });
    }, host);
  }

  test('Snapshot contains the strip and the overdrive timer (integers), the client shows the class and plays the sounds for the own ship', async ({
    page,
  }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await asOnline(page, true);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const { state } = g;
      const NK = await import('./js/net-encoding.js');
      const out = {};
      state.viperOverdriveStrip = 50;
      state.viperOverdriveTimer = 150.4;
      state.p2.viperOverdriveStrip = 40;
      state.p2.viperOverdriveTimer = 0;
      const full = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
      out.raw = [
        full.p1.viperOverdriveStrip,
        full.p1.viperOverdriveTimer,
        full.p2.viperOverdriveStrip,
        full.p2.viperOverdriveTimer,
      ];
      state.p2.selectedShipModel = 'phantom';
      out.phantomFields = 'viperOverdriveStrip' in g.Network.serializeGameState().p2;
      state.p2.selectedShipModel = 'viper';
      const encoder = new NK.SnapshotEncoder();
      const decoder = new NK.SnapshotDecoder();
      const recon = decoder.decode(JSON.parse(JSON.stringify(encoder.encode(full, 0))));
      out.wire = [
        recon.p1.viperOverdriveStrip,
        recon.p1.viperOverdriveTimer,
        recon.p2.viperOverdriveStrip,
        recon.p2.viperOverdriveTimer,
      ];

      // Client: host P1 in overdrive, own ship (P2) learns about a near miss
      state.network.isHost = false;
      state.network.isClient = true;
      state.viperOverdriveStrip = 0;
      state.viperOverdriveTimer = 0;
      state.p2.viperOverdriveStrip = 30;
      state.p2.viperOverdriveTimer = 0;
      g.Audio.clearAudioHistory();
      g.Network.applyGameStateSnapshot(recon);
      g.Loop.simulationStep();
      out.classP1 = document.getElementById('spieler').classList.contains('viper-overdrive');
      out.hudP1 = document.getElementById('viper-overdrive-hud').classList.contains('aktiv');
      out.classP2 = document.getElementById('spieler-2').classList.contains('viper-overdrive');
      out.stripClientP2 = state.p2.viperOverdriveStrip;
      out.tickAudio = g.Audio.audioHistory.filter(a => a.name === 'nearMiss').length;
      // own overdrive starts
      const copy = JSON.parse(JSON.stringify(recon));
      copy.p2.viperOverdriveStrip = 100;
      copy.p2.viperOverdriveTimer = 300;
      g.Network.applyGameStateSnapshot(copy);
      g.Loop.simulationStep();
      out.classP2Thereafter = document.getElementById('spieler-2').classList.contains('viper-overdrive');
      out.overdriveAudio = g.Audio.audioHistory.filter(a => a.name === 'overdrive').length;
      return out;
    });
    expect(r.raw).toEqual([50, 150.4, 40, 0]);
    expect(r.phantomFields).toBe(false);
    expect(r.wire).toEqual([50, 150, 40, 0]);
    expect(r.classP1).toBe(true);
    expect(r.hudP1).toBe(true);
    expect(r.classP2).toBe(false);
    expect(r.stripClientP2).toBe(40);
    expect(r.tickAudio).toBe(1);
    expect(r.classP2Thereafter).toBe(true);
    expect(r.overdriveAudio).toBe(1);
  });

  test('Host detects a near miss of the client ship (P2) and serializes the strip', async ({ page }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await asOnline(page, true);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const { state, arrays } = g;
      state.p2.x = 250;
      state.p2.y = 400;
      state.p2.isDead = false;
      state.p2.viperOverdriveStrip = 0;
      state.p2.viperOverdriveTimer = 0;
      const el = document.createElement('div');
      document.getElementById('spielfeld').appendChild(el);
      arrays.enemyLaserArray.push({ id: 'h', el, x: 290, y: 300, vx: 0, vy: 5, width: 4, height: 15 });
      for (let i = 0; i < 40; i++) g.Loop.simulationStep();
      return [state.p2.viperOverdriveStrip, g.Network.serializeGameState().p2.viperOverdriveStrip];
    });
    expect(r).toEqual([10, 10]);
  });
});

// Kill combo (V3): kills within 120 steps raise viperCombo (points x(1+0.1*combo), max x3; fire rate from 5/10),
// a hit sets it to 0 and the Viper no longer loses weapon upgrades.
test.describe('Viper-X kill combo', () => {
  // Helpers in the page context: killEnemy(killer) destroys a dummy enemy via Utils.destroyTarget
  async function ready(page, opts) {
    await startGame(page, opts);
    await page.evaluate(() => {
      const T = window.__viperTest;
      T.killEnemy = (killer = 'p1') => {
        const { arrays, Utils } = window.__game;
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        const enemy = { el, x: 20, y: 20, size: 30, isEnemy: true, pattern: 'normal', hp: 0 };
        arrays.enemies.push(enemy);
        Utils.destroyTarget(enemy, killer);
      };
      T.empty();
    });
  }

  test('3 kills in the window -> combo 3; window expires -> 0; the first kill counts as 1', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state } = window.__game;
      const out = {};
      // Asteroids spawn at frameCounter % 120 === 0 and could hit the ship (combo -> 0):
      // reset the counter before every block so no block reaches 120
      const steps = n => {
        state.frameCounter = 1;
        T.steps(n);
      };
      T.killEnemy();
      out.first = state.viperCombo;
      steps(100);
      T.killEnemy();
      steps(100);
      T.killEnemy();
      out.three = [state.viperCombo, state.viperComboTimer];
      steps(119);
      out.stillThere = state.viperCombo;
      steps(2);
      out.expired = [state.viperCombo, state.viperComboTimer];
      return out;
    });
    expect(r.first).toBe(1);
    expect(r.three).toEqual([3, 120]);
    expect(r.stillThere).toBe(3);
    expect(r.expired).toEqual([0, 0]);
  });

  test('A hit sets the combo to 0 (also one caught by the shield), weapon tiers stay unchanged', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      const dummy = { isEnemy: false, el: { dataset: {} }, x: 0, y: 0 };
      const out = {};
      state.laserTier = 4;
      state.missileTier = 3;
      state.bombTier = 2;
      state.viperCombo = 8;
      state.viperComboTimer = 90;
      Utils.playerHit(dummy, false, 'p1');
      out.hit = {
        combo: state.viperCombo,
        timer: state.viperComboTimer,
        lives: state.lives,
        tiers: [state.laserTier, state.missileTier, state.bombTier],
      };
      // The shield catches the hit, the combo drops anyway
      state.invulnerableTimer = 0;
      state.shieldTier = 1;
      state.viperCombo = 6;
      state.viperComboTimer = 50;
      Utils.playerHit(dummy, false, 'p1');
      out.shield = { combo: state.viperCombo, lives: state.lives, shield: state.shieldTier };
      // Invulnerable (no hit) leaves the combo standing
      state.viperCombo = 4;
      Utils.playerHit(dummy, false, 'p1');
      out.withoutHit = state.viperCombo;
      return out;
    });
    expect(r.hit).toEqual({ combo: 0, timer: 0, lives: 2, tiers: [4, 3, 2] });
    expect(r.shield).toEqual({ combo: 0, lives: 2, shield: 0 });
    expect(r.withoutHit).toBe(4);
  });

  test('Viper has loseUpgradesOnHit off; the perk list names combo instead of upgrade loss', async ({ page }) => {
    await page.waitForFunction(() => window.__game && window.__game.shipModels);
    const r = await page.evaluate(() => {
      const v = window.__game.shipModels.viper;
      return { lose: v.loseUpgradesOnHit, labels: v.perks.map(p => p.label) };
    });
    expect(r.lose).toBe(false);
    expect(r.labels).toContain('KILL-KOMBO');
    expect(r.labels).toContain('TREFFER: KOMBO WEG');
    expect(r.labels).not.toContain('TREFFER: -1 UPGRADE');
  });

  test('Points of a kill at combo 10 = base points x 2.0, capped at x3 from combo 20', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state } = window.__game;
      const delta = combo => {
        state.viperCombo = combo;
        state.viperComboTimer = 120;
        const s0 = state.score;
        T.killEnemy();
        return state.score - s0;
      };
      return {
        k0: delta(0),
        k5: delta(5),
        k10: delta(10),
        k20: delta(20),
        k50: delta(50),
        thereafter: state.viperCombo,
      };
    });
    expect(r.k0).toBe(100);
    expect(r.k5).toBe(150);
    expect(r.k10).toBe(200);
    expect(r.k20).toBe(300);
    expect(r.k50).toBe(300);
    expect(r.thereafter).toBe(51);
  });

  test('Fire rate: combo 5 -> cooldown 5, combo 10 -> 4, overdrive stays at 3, without combo 6', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state } = window.__game;
      const cd = (combo, overdrive = 0) => {
        state.viperCombo = combo;
        state.viperComboTimer = 120;
        state.viperOverdriveTimer = overdrive;
        state.playerShotCooldown = 0;
        state.energy = state.maxEnergy;
        state.keysPressed.l = true;
        T.steps(1);
        state.keysPressed.l = false;
        T.steps(1);
        return state.playerShotCooldown;
      };
      // after the shot step the following step counts down 1: value = cooldown - 1
      return { k0: cd(0), k4: cd(4), k5: cd(5), k9: cd(9), k10: cd(10), k25: cd(25), od: cd(10, 100) };
    });
    expect(r.k0).toBe(5);
    expect(r.k4).toBe(5);
    expect(r.k5).toBe(4);
    expect(r.k9).toBe(4);
    expect(r.k10).toBe(3);
    expect(r.k25).toBe(3);
    expect(r.od).toBe(2);
  });

  test('Sound at combo 5, 10 and 20 (exactly there), otherwise none', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { Audio } = window.__game;
      const tiers = [];
      for (let i = 1; i <= 21; i++) {
        Audio.clearAudioHistory();
        T.killEnemy();
        const h = Audio.audioHistory.filter(a => a.name === 'combo');
        if (h.length) tiers.push([i, h[0].details.tier]);
      }
      return tiers;
    });
    expect(r).toEqual([
      [5, 1],
      [10, 2],
      [20, 3],
    ]);
  });

  test('Phantom has no combo: kills change nothing, points without a factor, cooldown 6', async ({ page }) => {
    await ready(page, { p1: 'phantom' });
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state } = window.__game;
      const s0 = state.score;
      state.viperCombo = 10; // set artificially: without a Viper it has no effect
      T.killEnemy();
      const points = state.score - s0;
      state.keysPressed.l = true;
      T.steps(1);
      return {
        points,
        combo: state.viperCombo,
        cooldown: state.playerShotCooldown,
        hud: document.getElementById('viper-kombo-hud').style.display,
      };
    });
    expect(r.points).toBe(100);
    expect(r.combo).toBe(10);
    expect(r.cooldown).toBe(6);
    expect(r.hud).toBe('none');
  });

  test('Co-op: kills of P2 raise only the combo of P2, a hit on P1 leaves P2 untouched', async ({ page }) => {
    await ready(page, { coop: true });
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state, Utils } = window.__game;
      T.killEnemy('p2');
      T.killEnemy('p2');
      T.killEnemy('p1');
      const afterKills = { p1: state.viperCombo, p2: state.p2.viperCombo };
      // P2 kill with combo 10 counts x2, P1 kill (combo 1) x1.1
      state.p2.viperCombo = 10;
      const s0 = state.score;
      T.killEnemy('p2');
      const p2Points = state.score - s0;
      const s1 = state.score;
      T.killEnemy('p1');
      const p1Points = state.score - s1;
      Utils.playerHit({ isEnemy: false, el: { dataset: {} }, x: 0, y: 0 }, false, 'p1');
      return { afterKills, p2Points, p1Points, afterHit: { p1: state.viperCombo, p2: state.p2.viperCombo } };
    });
    expect(r.afterKills).toEqual({ p1: 1, p2: 2 });
    expect(r.p2Points).toBe(200);
    expect(r.p1Points).toBe(110);
    expect(r.afterHit).toEqual({ p1: 0, p2: 11 });
  });

  test('HUD: "KOMBO 7 · x1.7" only at combo > 0, pulse on increase, P2 likewise, capped at x3.0', async ({ page }) => {
    await ready(page, { coop: true });
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state } = window.__game;
      const h1 = document.getElementById('viper-kombo-hud');
      const h2 = document.getElementById('viper-kombo-hud-p2');
      const read = h => ({ display: h.style.display, text: h.textContent, pulse: h.classList.contains('puls') });
      const out = {};
      T.steps(1);
      out.null = [read(h1).display, read(h2).display];
      state.viperCombo = 7;
      state.viperComboTimer = 100;
      state.p2.viperCombo = 25;
      state.p2.viperComboTimer = 100;
      T.steps(1);
      out.p1 = read(h1);
      out.p2 = read(h2);
      state.viperCombo = 8;
      T.steps(1);
      out.p1High = read(h1);
      state.viperComboTimer = 1;
      T.steps(2);
      out.p1Gone = read(h1);
      return out;
    });
    expect(r.null).toEqual(['none', 'none']);
    expect(r.p1.display).toBe('block');
    expect(r.p1.text).toBe('KOMBO 7 · x1.7');
    expect(r.p2.text).toBe('KOMBO 25 · x3.0');
    expect(r.p1High.text).toBe('KOMBO 8 · x1.8');
    expect(r.p1High.pulse).toBe(true);
    expect(r.p1Gone.display).toBe('none');
  });

  test('Online: the snapshot carries combo and timer of both Vipers (integers, Viper only), the client shows them and does not tick itself', async ({
    page,
  }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await page.evaluate(() => {
      const { state, arrays, Utils } = window.__game;
      Utils.setGameMode('online');
      state.gameRunning = true;
      state.paused = false;
      state.cutsceneActive = false;
      state.gameOverActive = false;
      state.bossWarningActive = false;
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'viper';
      state.network.isOnline = true;
      state.network.isHost = true;
      state.network.isClient = false;
      state.network.connected = true;
      state.frameCounter = 1;
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
      Object.keys(state.keysPressed).forEach(k => {
        state.keysPressed[k] = false;
      });
    });
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const { state } = g;
      const NK = await import('./js/net-encoding.js');
      const out = {};
      state.viperCombo = 7;
      state.viperComboTimer = 80.4;
      state.p2.viperCombo = 5;
      state.p2.viperComboTimer = 30;
      const full = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
      out.raw = [full.p1.viperCombo, full.p1.viperComboTimer, full.p2.viperCombo, full.p2.viperComboTimer];
      state.p2.selectedShipModel = 'phantom';
      out.phantomFields = 'viperCombo' in g.Network.serializeGameState().p2;
      state.p2.selectedShipModel = 'viper';
      const encoder = new NK.SnapshotEncoder();
      const decoder = new NK.SnapshotDecoder();
      const recon = decoder.decode(JSON.parse(JSON.stringify(encoder.encode(full, 0))));
      out.wire = [recon.p1.viperCombo, recon.p1.viperComboTimer, recon.p2.viperCombo, recon.p2.viperComboTimer];

      // Client: host P1 combo 7, own ship (P2) jumps from 4 to 5 -> sound
      state.network.isHost = false;
      state.network.isClient = true;
      state.viperCombo = 0;
      state.viperComboTimer = 0;
      state.p2.viperCombo = 4;
      state.p2.viperComboTimer = 10;
      g.Audio.clearAudioHistory();
      g.Network.applyGameStateSnapshot(recon);
      g.Loop.simulationStep();
      out.client = [
        state.viperCombo,
        state.p2.viperCombo,
        document.getElementById('viper-kombo-hud').textContent,
        document.getElementById('viper-kombo-hud-p2').style.display,
      ];
      out.sounds = g.Audio.audioHistory.filter(a => a.name === 'combo').length;
      // The client does not count the window down itself and does not discard the combo
      state.p2.viperComboTimer = 1;
      for (let i = 0; i < 5; i++) g.Loop.simulationStep();
      out.noTick = [state.p2.viperCombo, state.p2.viperComboTimer];
      return out;
    });
    expect(r.raw).toEqual([7, 80.4, 5, 30]);
    expect(r.phantomFields).toBe(false);
    expect(r.wire).toEqual([7, 80, 5, 30]);
    expect(r.client[0]).toBe(7);
    expect(r.client[1]).toBe(5);
    expect(r.client[2]).toBe('KOMBO 7 · x1.7');
    expect(r.client[3]).toBe('block');
    expect(r.sounds).toBe(1);
    expect(r.noTick).toEqual([5, 1]);
  });
});
