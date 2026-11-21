const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    });
  });
  await setGameState(page);
  await page.goto('/');
});

// Start the game and clear the playfield of random spawns
async function startGame(page) {
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning);
  await page.keyboard.up('KeyW');
  await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    state.frameCounter = 0;
    arrays.enemies.forEach(f => f.el.remove());
    arrays.enemies.length = 0;
    arrays.asteroids.forEach(a => a.el.remove());
    arrays.asteroids.length = 0;
  });
}

test.describe('Hacker opponent', () => {
  test('createEnemy with pattern hacker creates a green hacker without a shield with 20 HP', async ({ page }) => {
    await startGame(page);
    const f = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.level = 5;
      Entities.createEnemy(100, 50, 'hacker', 0);
      const f = arrays.enemies[arrays.enemies.length - 1];
      return {
        pattern: f.pattern,
        hp: f.hp,
        shieldHp: f.shieldHp,
        color: f.el.dataset.baseColor,
        hasSvg: !!f.el.querySelector('svg'),
      };
    });
    expect(f).toEqual({ pattern: 'hacker', hp: 20, shieldHp: 0, color: '#39ff14', hasSvg: true });
  });

  test('Hacker carries a powerup with a 40 % chance (normal enemy 20 %)', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(async () => {
      const { arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      const orig = Math.random;
      Math.random = () => 0.3;
      Entities.createEnemy(100, 50, 'hacker', 0);
      Entities.createEnemy(200, 50, 'normal', 0);
      Math.random = orig;
      return arrays.enemies.map(f => f.carriesPowerup);
    });
    expect(r).toEqual([true, false]);
  });

  test('Shooting down a hacker gives double points (200)', async ({ page }) => {
    await startGame(page);
    const diff = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      const Utils = await import('./js/utils.js');
      Entities.createEnemy(100, 50, 'hacker', 0);
      const f = arrays.enemies[arrays.enemies.length - 1];
      f.carriesPowerup = false;
      const beforehand = state.score;
      Utils.destroyTarget(f, 'p1');
      return state.score - beforehand;
    });
    expect(diff).toBe(200);
  });

  test('Hacker stops between y 100 and 200 and fires hack projectiles instead of lasers', async ({ page }) => {
    await startGame(page);
    // Approach, stop and first shot in 180 fixed simulation steps (~3 s), evaluated synchronously
    const r = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');
      state.godMode = true;
      state.x = 0;
      state.y = 560;
      Entities.createEnemy(200, -30, 'hacker', 0);
      for (let i = 0; i < 180; i++) simulationStep();
      const f = arrays.enemies.find(f => f.pattern === 'hacker');
      return { y: f.y, phase: f.phase, shots: f.hackShots, laser: arrays.enemyLaserArray.length };
    });
    expect(r.phase).toBe('lurk');
    expect(r.y).toBeGreaterThanOrEqual(100);
    expect(r.y).toBeLessThanOrEqual(200);
    expect(r.shots).toBeGreaterThanOrEqual(1);
    expect(r.laser).toBe(0);
    await expect(page.locator('.hack-projektil').first()).toBeAttached();
  });

  test('Hack projectile hacks the player without damage and ignores the shield', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.x = 185;
      state.y = 400;
      state.shieldTier = 2;
      Entities.createEnemy(185, 50, 'hacker', 0);
      const f = arrays.enemies[arrays.enemies.length - 1];
      f.phase = 'lurk';
      f.lurkTimer = 9999;
      f.hackTimer = 9999;
      f.y = 100;
      f.stopY = 100;
      Entities.createHackProjectile(194, 360, 200, 415, f);
    });
    await page.waitForFunction(() => window.__game.arrays.hackProjectileArray.length === 0);
    const r = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const f = arrays.enemies.find(f => f.pattern === 'hacker');
      return { hacks: state.hacks.length, lives: state.lives, shield: state.shieldTier, landed: f.hackLanded };
    });
    expect(r).toEqual({ hacks: 1, lives: 3, shield: 2, landed: true });
  });

  test('Hacker flees upwards out of the screen after a hit or after 10 s', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      Entities.createEnemy(100, 150, 'hacker', 0);
      Entities.createEnemy(250, 150, 'hacker', 0);
      const [a, b] = arrays.enemies;
      a.id = 'treffer';
      a.phase = 'lurk';
      a.lurkTimer = 9999;
      a.hackTimer = 9999;
      a.hackLanded = true;
      b.id = 'timeout';
      b.phase = 'lurk';
      b.lurkTimer = 1;
      b.hackTimer = 9999;
    });
    // Fixed simulation steps instead of real time: phase change first, then escape from the screen
    const r = await page.evaluate(() => {
      const { arrays, Loop } = window.__game;
      for (let i = 0; i < 6; i++) Loop.simulationStep();
      const phases = arrays.enemies.map(f => f.phase);
      let steps = 0;
      while (arrays.enemies.length > 0 && steps < 600) {
        Loop.simulationStep();
        steps++;
      }
      return { phases, left: arrays.enemies.length };
    });
    expect(r.phases).toEqual(['escape', 'escape']);
    expect(r.left).toBe(0);
  });

  test('A hacker can land only one hit', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.x = 185;
      state.y = 400;
      Entities.createEnemy(185, 50, 'hacker', 0);
      const f = arrays.enemies[0];
      f.phase = 'lurk';
      f.lurkTimer = 9999;
      f.hackTimer = 9999;
      f.y = 100;
      Entities.createHackProjectile(194, 360, 200, 415, f);
      Entities.createHackProjectile(194, 330, 200, 415, f);
    });
    await page.waitForFunction(() => window.__game.arrays.hackProjectileArray.length === 0);
    const hacks = await page.evaluate(() => window.__game.state.hacks.length);
    expect(hacks).toBe(1);
  });

  test('Hack effects stack and expire after 3 s (P1 and P2)', async ({ page }) => {
    await startGame(page);
    // Expiry over HACK_DURATION fixed simulation steps instead of up to 3 s of real time
    const r = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const { simulationStep } = await import('./js/loop.js');
      Hack.hackPlayer(state, 'hudGlitch');
      Hack.hackPlayer(state, 'inverted');
      Hack.hackPlayer(state.p2, 'weaponsOffline');
      const beforehand = state.hacks.map(h => h.type);
      const p2Beforehand = state.p2.hacks.map(h => h.type);
      for (let i = 0; i < Hack.HACK_DURATION - 1; i++) simulationStep();
      const shortBeforeEnd = [state.hacks.length, state.p2.hacks.length];
      simulationStep();
      return { beforehand, p2Beforehand, shortBeforeEnd, afterwards: [state.hacks.length, state.p2.hacks.length] };
    });
    expect(r.beforehand).toEqual(['hudGlitch', 'inverted']);
    expect(r.p2Beforehand).toEqual(['weaponsOffline']);
    expect(r.shortBeforeEnd).toEqual([2, 1]);
    expect(r.afterwards).toEqual([0, 0]);
  });

  test('Effect inverted: D moves the ship to the left', async ({ page }) => {
    await startGame(page);
    const startX = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      state.godMode = true;
      state.x = 185;
      Hack.hackPlayer(state, 'inverted');
      return state.x;
    });
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyD');
    const x = await page.evaluate(() => window.__game.state.x);
    expect(x).toBeLessThan(startX - 20);
  });

  test('Effect keysSwapped: every direction is mapped to a different direction', async ({ page }) => {
    await startGame(page);
    for (let run = 0; run < 5; run++) {
      const r = await page.evaluate(async () => {
        const { state } = await import('./js/state.js');
        const Hack = await import('./js/hack.js');
        Hack.removeHacks(state);
        Hack.hackPlayer(state, 'keysSwapped');
        const directions = [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ];
        return directions.map(([dx, dy]) => {
          const b = Hack.hackMovement(state, dx, dy);
          return { equal: b.dx === dx && b.dy === dy, target: `${b.dx},${b.dy}` };
        });
      });
      expect(r.some(x => x.equal)).toBe(false);
      expect(new Set(r.map(x => x.target)).size).toBe(4);
    }
  });

  test('Effect weaponsOffline: laser, missiles and bombs do not fire', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      state.godMode = true;
      state.energy = 50;
      state.missileCooldown = 0;
      state.bombCooldown = 0;
      Hack.hackPlayer(state, 'weaponsOffline');
    });
    await page.keyboard.down('KeyL');
    await page.keyboard.down('KeyK');
    await page.keyboard.down('Space');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyL');
    await page.keyboard.up('KeyK');
    await page.keyboard.up('Space');
    const r = await page.evaluate(async () => {
      const { arrays } = await import('./js/state.js');
      return {
        laser: arrays.laserArray.length,
        missiles: arrays.missileArray.length,
        bombs: arrays.bombArray.length,
      };
    });
    expect(r).toEqual({ laser: 0, missiles: 0, bombs: 0 });
  });

  test('Effect hudGlitch: the HUD gets the glitch class while the effect is active', async ({ page }) => {
    await startGame(page);
    // Fixed simulation steps: the class is set until the last step of the hack duration, gone afterwards
    const r = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const { simulationStep } = await import('./js/loop.js');
      const glitch = () => document.getElementById('ui-container').classList.contains('hud-glitch');
      Hack.hackPlayer(state, 'hudGlitch');
      simulationStep();
      const amStart = glitch();
      for (let i = 1; i < Hack.HACK_DURATION - 1; i++) simulationStep();
      const shortBeforeEnd = glitch();
      simulationStep();
      return { amStart, shortBeforeEnd, afterEnd: glitch() };
    });
    expect(r).toEqual({ amStart: true, shortBeforeEnd: true, afterEnd: false });
    await expect(page.locator('#ui-container')).not.toHaveClass(/hud-glitch/);
  });

  test('Hacked player shows a label with the effect name, remaining time bar and glitch on the ship', async ({
    page,
  }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      state.godMode = true;
      Hack.hackPlayer(state, 'inverted');
      Hack.hackPlayer(state, 'weaponsOffline');
    });
    const label = page.locator('#hack-label-p1');
    await expect(label).toBeVisible();
    await expect(label).toContainText('INVERTED');
    await expect(label).toContainText('WEAPONS OFFLINE');
    await expect(label.locator('.hack-restzeit')).toHaveCount(1);
    await expect(page.locator('#spieler')).toHaveClass(/spieler-gehackt/);
    // Rest of the hack duration in fixed simulation steps instead of up to 3 s of real time
    const steps = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const { simulationStep } = await import('./js/loop.js');
      let n = 0;
      while (state.hacks.length > 0 && n <= Hack.HACK_DURATION) {
        simulationStep();
        n++;
      }
      return n;
    });
    expect(steps).toBeLessThanOrEqual(180);
    await expect(label).toBeHidden();
    await expect(page.locator('#spieler')).not.toHaveClass(/spieler-gehackt/);
  });

  test('Spawn: hackers only from level 2 on and at most one at a time', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Loop = await import('./js/loop.js');
      const count = () => arrays.enemies.filter(f => f.pattern === 'hacker').length;
      const orig = Math.random;
      Math.random = () => 0.05;
      state.level = 1;
      Loop.manageEnemySpawns();
      const level1 = count();
      state.level = 2;
      Loop.manageEnemySpawns();
      const level2 = count();
      Loop.manageEnemySpawns();
      const again = count();
      Math.random = orig;
      return { level1, level2, again };
    });
    expect(r).toEqual({ level1: 0, level2: 1, again: 1 });
  });

  test('Co-op: inverted also affects the arrow keys of player 2', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      config.playfieldWidth = 600;
      state.godMode = true;
      state.gameMode = 'coop';
      state.p2IsBot = false;
      state.p2.isDead = false;
      state.p2.x = 300;
      state.p2.y = 400;
      Hack.hackPlayer(state.p2, 'inverted');
    });
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowRight');
    const r = await page.evaluate(() => ({ p1: window.__game.state.x, p2: window.__game.state.p2.x }));
    expect(r.p2).toBeLessThan(280);
  });

  test('Co-op: the bot partner gets hacked as well (inverted reverses its movement)', async ({ page }) => {
    await startGame(page);
    const setup = async withHack =>
      page.evaluate(async withHack => {
        const { state, config } = await import('./js/state.js');
        const Hack = await import('./js/hack.js');
        config.playfieldWidth = 600;
        state.godMode = true;
        state.gameMode = 'coop';
        state.p2IsBot = true;
        state.p2.isDead = false;
        state.x = 50;
        state.y = 400;
        state.p2.x = 450;
        state.p2.y = 400;
        Hack.removeHacks(state.p2);
        if (withHack) Hack.hackPlayer(state.p2, 'inverted');
      }, withHack);
    await setup(false);
    await page.waitForTimeout(300);
    const without = await page.evaluate(() => window.__game.state.p2.x);
    await setup(true);
    await page.waitForTimeout(300);
    const withEntry = await page.evaluate(() => window.__game.state.p2.x);
    expect(without).toBeLessThan(450);
    expect(withEntry).toBeGreaterThan(450);
  });

  test('Online: the snapshot transfers the hacks of both players and hack projectiles', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const Entities = await import('./js/entities.js');
      const Network = await import('./js/network.js');
      state.paused = true;
      Hack.hackPlayer(state, 'inverted');
      Hack.hackPlayer(state.p2, 'keysSwapped');
      Entities.createHackProjectile(100, 100, 100, 300);
      const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
      const perm = state.p2.hacks[0].perm;
      // Simulate the client side: clear the local state and apply the snapshot
      Hack.removeHacks(state);
      Hack.removeHacks(state.p2);
      arrays.hackProjectileArray.forEach(h => h.el.remove());
      arrays.hackProjectileArray.length = 0;
      Network.applyGameStateSnapshot(snap);
      return {
        p1: state.hacks.map(h => h.type),
        p2: state.p2.hacks.map(h => h.type),
        permEqual: JSON.stringify(state.p2.hacks[0].perm) === JSON.stringify(perm),
        projectiles: arrays.hackProjectileArray.length,
        dom: document.querySelectorAll('.hack-projektil').length,
      };
    });
    expect(r).toEqual({ p1: ['inverted'], p2: ['keysSwapped'], permEqual: true, projectiles: 1, dom: 1 });
  });

  test('Online client: the hack affects the local controls and shows the label', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      config.playfieldWidth = 600;
      state.gameMode = 'online';
      state.network.isClient = true;
      state.network.connected = true;
      state.p2.isDead = false;
      state.p2.x = 300;
      state.p2.y = 400;
      Hack.hackPlayer(state.p2, 'inverted');
    });
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyD');
    const x = await page.evaluate(() => window.__game.state.p2.x);
    expect(x).toBeLessThan(280);
    await expect(page.locator('#hack-label-p2')).toContainText('INVERTED');
  });

  test('restartGame removes active hacks of both players', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const Utils = await import('./js/utils.js');
      Hack.hackPlayer(state, 'inverted');
      Hack.hackPlayer(state.p2, 'hudGlitch');
      Utils.restartGame();
      return [state.hacks.length, state.p2.hacks.length];
    });
    expect(r).toEqual([0, 0]);
  });

  test('A new hack plays the glitch sound', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const Audio = await import('./js/audio.js');
      Audio.clearAudioHistory();
      Hack.hackPlayer(state, 'inverted');
    });
    await page.waitForFunction(async () => {
      const Audio = await import('./js/audio.js');
      return Audio.audioHistory.filter(a => a.name === 'hack').length === 1;
    });
    await page.waitForTimeout(200);
    const count = await page.evaluate(async () => {
      const Audio = await import('./js/audio.js');
      return Audio.audioHistory.filter(a => a.name === 'hack').length;
    });
    expect(count).toBe(1);
  });

  test('Hack projectile steers towards the player', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      state.x = 330;
      state.y = 500;
      // Starts straight down, the player stands far to the right
      Entities.createHackProjectile(50, 100, 50, 500);
    });
    await page.waitForTimeout(500);
    const vx = await page.evaluate(() => window.__game.arrays.hackProjectileArray[0].vx);
    expect(vx).toBeGreaterThan(0.5);
  });

  test('Hack projectile can be missed by dodging sideways', async ({ page }) => {
    await startGame(page);
    // Fixed simulation steps; key D held via state.keysPressed (like the keydown handler).
    // Cross-check without dodging: the same orb hits.
    const run = dodge =>
      page.evaluate(async dodge => {
        const { state, arrays } = await import('./js/state.js');
        const Entities = await import('./js/entities.js');
        const Hack = await import('./js/hack.js');
        const { simulationStep } = await import('./js/loop.js');
        Hack.removeHacks(state);
        arrays.hackProjectileArray.forEach(h => h.el.remove());
        arrays.hackProjectileArray.length = 0;
        state.godMode = true;
        state.x = 185;
        state.y = 450;
        Entities.createHackProjectile(194, 250, 200, 465);
        // Dodge late, when the orb is about 80 px away
        let n = 0;
        while (arrays.hackProjectileArray[0] && arrays.hackProjectileArray[0].y <= 370 && n < 300) {
          simulationStep();
          n++;
        }
        const orbBeforeDodge = !!arrays.hackProjectileArray[0];
        if (dodge) state.keysPressed.d = true;
        for (let i = 0; i < 120; i++) simulationStep();
        state.keysPressed.d = false;
        return { orbBeforeDodge, hacks: state.hacks.length };
      }, dodge);
    const withEntry = await run(true);
    expect(withEntry).toEqual({ orbBeforeDodge: true, hacks: 0 });
    const without = await run(false);
    expect(without).toEqual({ orbBeforeDodge: true, hacks: 1 });
  });

  test('Hack projectile does not turn around after the flyby', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      state.x = 185;
      state.y = 200;
      // The orb is already below the player and flies down
      Entities.createHackProjectile(194, 300, 194, 600);
    });
    // 72 fixed simulation steps (~1.2 s); vy is checked every step while the orb exists
    const r = await page.evaluate(() => {
      const { arrays, Loop } = window.__game;
      const vys = [];
      for (let i = 0; i < 72; i++) {
        Loop.simulationStep();
        const hp = arrays.hackProjectileArray[0];
        if (hp) vys.push(hp.vy);
      }
      return { stepsWithOrb: vys.length, minVy: Math.min(...vys) };
    });
    expect(r.stepsWithOrb).toBeGreaterThan(0);
    expect(r.minVy).toBeGreaterThan(0);
  });

  async function bossFight(page, level, enrage) {
    await startGame(page);
    await page.evaluate(
      async ({ level, enrage }) => {
        const { state, arrays } = await import('./js/state.js');
        const Entities = await import('./js/entities.js');
        state.godMode = true;
        state.level = level;
        state.x = 185;
        state.y = 500;
        Entities.createBoss();
        const b = arrays.bosses[arrays.bosses.length - 1];
        b.phase = 'fight';
        b.y = 20;
        b.shotTimer = 999999;
        b.baseShotRate = 999999;
        b.enragePhaseActive = enrage;
        b.hackTimer = 2;
      },
      { level, enrage },
    );
  }

  test('Boss fires hack projectiles from level 5 on, reset to 300 frames', async ({ page }) => {
    await bossFight(page, 5, false);
    await page.waitForFunction(() => window.__game.arrays.hackProjectileArray.length > 0);
    const r = await page.evaluate(() => {
      const b = window.__game.arrays.bosses[0];
      return { timer: b.hackTimer, source: window.__game.arrays.hackProjectileArray[0].source };
    });
    expect(r.timer).toBeGreaterThan(280);
    expect(r.timer).toBeLessThanOrEqual(300);
    expect(r.source).toBeNull();
  });

  test('Boss below level 5 fires no hack projectiles', async ({ page }) => {
    await bossFight(page, 4, false);
    await page.waitForTimeout(500);
    const n = await page.evaluate(() => window.__game.arrays.hackProjectileArray.length);
    expect(n).toBe(0);
  });

  test('Boss in enrage fires every 180 frames', async ({ page }) => {
    await bossFight(page, 5, true);
    await page.waitForFunction(() => window.__game.arrays.hackProjectileArray.length > 0);
    const timer = await page.evaluate(() => window.__game.arrays.bosses[0].hackTimer);
    expect(timer).toBeGreaterThan(160);
    expect(timer).toBeLessThanOrEqual(180);
  });

  test('Boss can hack the player several times (source null does not block)', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      state.x = 185;
      state.y = 400;
      Entities.createHackProjectile(194, 395, 194, 415, null);
    });
    await page.waitForFunction(() => window.__game.arrays.hackProjectileArray.length === 0);
    await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      Entities.createHackProjectile(194, 395, 194, 415, null);
    });
    await page.waitForFunction(() => window.__game.arrays.hackProjectileArray.length === 0);
    const n = await page.evaluate(() => window.__game.state.hacks.length);
    expect(n).toBe(2);
  });
});
