const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await setGameState(page);
  await page.goto('/');
});

test('Gleve-MR: selectable in the hangar, perks, manta SVG, no launcher pods, HUD badges S/D', async ({ page }) => {
  const gleveBtn = page.locator('.hangar-model-btn[data-model="gleve"]');
  await expect(gleveBtn).toBeVisible();
  await gleveBtn.click();
  await expect(gleveBtn).toHaveClass(/active/);

  // Name and perks come from the ship model; the dash/sweep tests check the balancing values through behavior
  const values = await page.evaluate(async () => {
    const { state, shipModels } = await import('./js/state.js');
    return {
      model: state.selectedShipModel,
      name: shipModels.gleve.name,
      perks: shipModels.gleve.perks.map(p => p.label),
    };
  });
  expect(values.model).toBe('gleve');
  await expect(page.locator('#hangar-ship-name')).toContainText(values.name);
  await expect(page.locator('#hangar-ship-perks .hangar-perk-chip')).toHaveCount(values.perks.length);
  for (let i = 0; i < values.perks.length; i++) {
    await page.locator('#hangar-ship-perks .hangar-perk-chip').nth(i).click();
    await expect(page.locator('#hangar-perk-detail')).toContainText(values.perks[i]);
  }

  // Start the game
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(50);
  await page.keyboard.up('KeyW');
  await expect(page.locator('#spieler')).toBeVisible();

  // The manta SVG is rendered
  const svgHtml = await page.locator('#spieler svg').evaluate(el => el.innerHTML);
  expect(svgHtml).toContain('Gleve-MR');
  expect(await page.locator('#spieler svg path').count()).toBeGreaterThanOrEqual(5);

  // HUD labels: energy = sweep, missile cooldown = dash
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('S');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('D');

  // Launcher pods hidden even at missile tier 5, without a drop effect
  await expect(page.locator('#spieler .werfer-links')).toBeHidden();
  await expect(page.locator('#spieler .werfer-rechts')).toBeHidden();
  await expect(page.locator('#spieler .werfer-center')).toBeHidden();
  const drop = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    state.missileTier = 5;
    Utils.updateActivePowerupsUi();
    state.missileTier = 1;
    Utils.updateActivePowerupsUi();
    return document.querySelectorAll('.werfer-abgeworfen').length;
  });
  expect(drop).toBe(0);
  await expect(page.locator('#spieler .werfer-center')).toBeHidden();

  // Back to the Viper: original texts and launchers
  await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    state.selectedShipModel = 'viper';
    Utils.updatePlayerShipVisuals();
  });
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('E');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('R');
  await expect(page.locator('#spieler .werfer-links')).toBeVisible();
});

// Pick the Gleve in the hangar (optionally as P2 in local co-op), start the game and clear the field.
// Then window.__gleveTest.empty() sets up a deterministic initial state;
// setup, simulationStep() calls and evaluation run in one synchronous block per test.
async function startGleve(page, { coop = false } = {}) {
  if (coop) {
    await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
    await page.locator('.hangar-player-tab[data-player="p2"]').click();
  }
  await page.locator('.hangar-model-btn[data-model="gleve"]').click();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    window.__gleveTest = {
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
          'gleveWaves',
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
        for (const s of [state, state.p2]) {
          s.maxEnergy = 50;
          s.energy = 50;
          s.laserTier = 1;
          s.shieldTier = 0;
          s.lives = 3;
          s.invulnerableTimer = 0;
          s.unlimitedEnergy = false;
          s.gleveDashTimer = 0;
          s.gleveBounceTimer = 0;
          s.gleveInvulnerable = 0;
          s.gleveDashKeyHeld = false;
          s.missileTier = 1;
          s.missileCooldown = 0;
          s.gleveDashCharges = 2;
          s.gleveSweepTimer = 0;
          s.gleveSweepDirection = 0;
          s.gleveSweepHit = [];
          s.gleveSweepCadence = 0;
        }
        document.querySelectorAll('.gleve-klinge').forEach(el => el.remove());
        state.x = 185;
        state.y = 400;
      },
      steps(n) {
        for (let i = 0; i < n; i++) window.__game.Loop.simulationStep();
      },
    };
  });
}

test.describe('Gleve-MR dash (missile key)', () => {
  test('Dash moves the ship by the range in the steering direction, costs no energy and starts the cooldown', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Diagonally up right, tier 1: 100 px, 180 frames cooldown
      state.keysPressed.d = true;
      state.keysPressed.w = true;
      state.keysPressed.k = true;
      T.steps(1);
      const afterStart = { energy: state.energy, timer: state.gleveDashTimer, cd: state.missileCooldown };
      T.steps(2);
      const classDuring = document.getElementById('spieler').classList.contains('gleve-dash');
      T.steps(5);
      const end = { x: state.x, y: state.y, energy: state.energy, cd: state.missileCooldown };
      const bar = parseFloat(document.getElementById('raketen-cd-balken').style.width);
      const classThereafter = document.getElementById('spieler').classList.contains('gleve-dash');
      const effects = document.querySelectorAll('.gleve-nachbild').length;
      Object.keys(state.keysPressed).forEach(k => {
        state.keysPressed[k] = false;
      });
      return {
        afterStart,
        classDuring,
        end,
        bar,
        classThereafter,
        effects,
        dashSounds: window.__game.Audio.audioHistory.filter(a => a.name === 'dash').length,
      };
    });
    // The cooldown already counts one frame down in the same step
    expect(r.afterStart).toEqual({ energy: 50, timer: 7, cd: 179 });
    expect(r.classDuring).toBe(true);
    expect(r.classThereafter).toBe(false);
    expect(r.end.x).toBeCloseTo(185 + 100 / Math.SQRT2, 1);
    expect(r.end.y).toBeCloseTo(400 - 100 / Math.SQRT2, 1);
    // The dash itself is free (afterStart), at the end the combo sweep follows (tier 1: 8 energy)
    expect(r.end.energy).toBe(42);
    expect(r.end.cd).toBe(172);
    // The HUD missile bar shows the dash cooldown
    expect(r.bar).toBeCloseTo(100 - (172 / 180) * 100, 3);
    expect(r.effects).toBeGreaterThan(0);
    expect(r.dashSounds).toBe(1);
  });

  test('Only one dash per key press, charges and range by missile tier, weaponsOffline blocks, no missiles', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(async () => {
      const { state, arrays, Audio } = window.__game;
      const Hack = await import('./js/hack.js');
      const T = window.__gleveTest;
      T.empty();
      // Key held for 30 steps: only one dash upwards
      state.keysPressed.k = true;
      T.steps(30);
      const held = { y: state.y, charges: state.gleveDashCharges };
      // Release and press again: second charge, second dash
      state.keysPressed.k = false;
      T.steps(1);
      state.keysPressed.k = true;
      T.steps(10);
      const secondary = { y: state.y, charges: state.gleveDashCharges, cd: state.missileCooldown };
      state.keysPressed.k = false;
      T.steps(1);
      // No charge left: no dash
      state.keysPressed.k = true;
      T.steps(10);
      const withoutCharge = { y: state.y, charges: state.gleveDashCharges };
      state.keysPressed.k = false;
      T.steps(1);
      // A charge again: dash
      state.gleveDashCharges = 1;
      state.keysPressed.k = true;
      T.steps(10);
      const third = state.y;
      state.keysPressed.k = false;
      T.steps(1);

      // The weaponsOffline hack blocks the dash
      state.y = 400;
      state.missileCooldown = 0;
      state.gleveDashCharges = 2;
      Hack.hackPlayer(state, 'weaponsOffline');
      state.keysPressed.k = true;
      T.steps(10);
      const hacked = { y: state.y, cd: state.missileCooldown, charges: state.gleveDashCharges };
      state.keysPressed.k = false;
      state.hacks = [];
      T.steps(1);

      // Range and cooldown per missile tier (after 8 steps)
      const tiers = [];
      for (let s = 1; s <= 5; s++) {
        state.missileTier = s;
        state.missileCooldown = 0;
        state.gleveDashCharges = 2;
        state.y = 500;
        state.keysPressed.k = true;
        T.steps(8);
        tiers.push({ gone: Math.round((500 - state.y) * 1000) / 1000, cd: state.missileCooldown });
        state.keysPressed.k = false;
        T.steps(1);
      }
      return {
        held,
        secondary,
        withoutCharge,
        third,
        hacked,
        tiers,
        energy: state.energy,
        lasers: arrays.laserArray.length,
        missiles: arrays.missileArray.length,
        missileSounds: Audio.audioHistory.filter(a => a.name === 'missile').length,
      };
    });
    // Held key: only one dash, one charge used
    expect(r.held.y).toBeCloseTo(300, 5);
    expect(r.held.charges).toBe(1);
    // A second press uses the second charge; the running recharge is not restarted
    expect(r.secondary.y).toBeCloseTo(200, 5);
    expect(r.secondary.charges).toBe(0);
    expect(r.secondary.cd).toBe(139);
    expect(r.withoutCharge.y).toBeCloseTo(200, 5);
    expect(r.withoutCharge.charges).toBe(0);
    expect(r.third).toBeCloseTo(100, 5);
    expect(r.hacked.y).toBeCloseTo(400, 5);
    expect(r.hacked.cd).toBe(0);
    expect(r.hacked.charges).toBe(2);
    expect(r.tiers).toEqual([
      { gone: 100, cd: 172 },
      { gone: 110, cd: 157 },
      { gone: 120, cd: 142 },
      { gone: 135, cd: 127 },
      { gone: 150, cd: 112 },
    ]);
    // The Gleve fires neither laser projectiles nor missiles
    expect(r.lasers).toBe(0);
    expect(r.missiles).toBe(0);
    expect(r.missileSounds).toBe(0);
  });

  test('Normal enemies on the path are destroyed, the kill chain shortens the recharge by 30 frames per kill', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Two enemies (one with a shield) directly above the ship, no shot
      Entities.createEnemy(185, 350, 'normal', 0, true);
      Entities.createEnemy(185, 315, 'normal', 0, false);
      arrays.enemies.forEach(f => {
        f.shotTimer = 9999;
        f.carriesPowerup = false;
      });
      const scoreBeforehand = state.score;
      state.keysPressed.k = true;
      T.steps(8);
      state.keysPressed.k = false;
      return {
        enemies: arrays.enemies.length,
        energy: state.energy,
        cd: state.missileCooldown,
        charges: state.gleveDashCharges,
        lives: state.lives,
        points: state.score - scoreBeforehand,
        y: state.y,
      };
    });
    expect(r.enemies).toBe(0);
    expect(r.lives).toBe(3);
    expect(r.points).toBeGreaterThanOrEqual(200);
    // 180 (recharge) - 2 * 30 (kill chain) - 8 steps
    expect(r.cd).toBe(112);
    expect(r.charges).toBe(1);
    expect(r.energy).toBe(42); // only the combo sweep costs energy
    expect(r.y).toBeCloseTo(300, 5);
  });

  test('A boss takes dash damage, the ship bounces off diagonally to the side', async ({ page }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      Entities.createBoss();
      const b = arrays.bosses[0];
      Object.assign(b, {
        phase: 'fight',
        x: 150,
        y: 20,
        vx: 0,
        shotTimer: 9999,
        bombTimer: 9999,
        missileTimer: 9999,
      });
      // Ship left of the boss center, dash upwards into the boss
      state.x = 170;
      state.y = 160;
      state.keysPressed.k = true;
      T.steps(5);
      const impact = { hp: b.hp, maxHp: b.maxHp, dash: state.gleveDashTimer, bounce: state.gleveBounceTimer };
      T.steps(8);
      state.keysPressed.k = false;
      return {
        impact,
        x: state.x,
        y: state.y,
        bossX: b.x,
        size: b.size,
        invulnerable: state.gleveInvulnerable,
        lives: state.lives,
        bossThere: arrays.bosses.length,
      };
    });
    expect(r.bossThere).toBe(1);
    expect(r.impact.hp).toBe(r.impact.maxHp - 60);
    expect(r.impact.dash).toBe(0);
    expect(r.impact.bounce).toBe(8);
    // Landing point: half a boss width left of the boss edge, 30 px lower than the impact point (y 110)
    expect(r.x).toBeCloseTo(r.bossX - r.size / 2 - 30, 5);
    expect(r.y).toBeCloseTo(140, 5);
    expect(r.lives).toBe(3);
    // Invulnerability runs for another 30 frames after the bounce
    expect(r.invulnerable).toBe(31);
  });

  test('Invulnerable during the dash and shortly after: an enemy laser does not hit', async ({ page }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Stationary enemy lasers on the path and at the target point
      Entities.createEnemyLaser(198, 350);
      Entities.createEnemyLaser(198, 310);
      arrays.enemyLaserArray.forEach(fl => {
        fl.vy = 0;
        fl.vx = 0;
      });
      state.keysPressed.k = true;
      T.steps(12); // 8 dash frames + 4 trail
      const during = { lives: state.lives, laser: arrays.enemyLaserArray.length, blink: state.invulnerableTimer };
      T.steps(10); // Trail over: the laser at the target point hits now
      state.keysPressed.k = false;
      return { during, thereafter: state.lives, y: state.y };
    });
    expect(r.y).toBeCloseTo(300, 5);
    expect(r.during.lives).toBe(3);
    expect(r.during.laser).toBe(2);
    expect(r.during.blink).toBe(0);
    expect(r.thereafter).toBe(2);
  });

  test('Magma: below missile tier 5 a bounce, at tier 5 it is cracked and destroyed', async ({ page }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      const createMagma = () => {
        Entities.createAsteroid(185, 330, 30, 0, 0, 0, true);
        const m = arrays.asteroids[arrays.asteroids.length - 1];
        m.isIndestructible = true;
        m.isMagma = true;
        m.vRot = 0;
        m.el.classList.add('unzerstoerbar');
        if (m.crackEl) {
          m.crackEl.remove();
          m.crackEl = null;
        }
        return m;
      };

      // Tier 1 (laser tier 5 changes nothing): bounce, magma stays intact
      T.empty();
      state.laserTier = 5;
      const m1 = createMagma();
      state.keysPressed.k = true;
      T.steps(14);
      state.keysPressed.k = false;
      const tier1 = {
        there: arrays.asteroids.includes(m1),
        indestructible: m1.isIndestructible,
        x: state.x,
        y: state.y,
      };

      // Missile tier 5: crack and cut through
      T.empty();
      state.missileTier = 5;
      const m5 = createMagma();
      state.keysPressed.k = true;
      T.steps(8);
      state.keysPressed.k = false;
      return {
        tier1,
        tier5: {
          there: arrays.asteroids.includes(m5),
          indestructible: m5.isIndestructible,
          carriesPowerup: m5.carriesPowerup,
          y: state.y,
        },
      };
    });
    expect(r.tier1.there).toBe(true);
    expect(r.tier1.indestructible).toBe(true);
    // Landed beside the magma (half a width away from the edge)
    expect(r.tier1.x <= 185 - 15 - 30 + 0.01 || r.tier1.x >= 185 + 30 + 15 - 0.01).toBe(true);
    expect(r.tier1.y).toBeGreaterThan(330);
    expect(r.tier5.indestructible).toBe(false);
    expect(r.tier5.carriesPowerup).toBe(true);
    expect(r.tier5.there).toBe(false);
    expect(r.tier5.y).toBeCloseTo(250, 5);
  });

  test('Co-op: player 2 dashes with Ö, own cooldown', async ({ page }) => {
    await startGleve(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      state.p2.x = 400;
      state.p2.y = 400;
      state.keysPressed['ö'] = true;
      state.keysPressed.arrowleft = true;
      T.steps(8);
      state.keysPressed['ö'] = false;
      state.keysPressed.arrowleft = false;
      return {
        x: state.p2.x,
        y: state.p2.y,
        energy: state.p2.energy,
        cdP2: state.p2.missileCooldown,
        cdP1: state.missileCooldown,
        p1y: state.y,
        barP2: parseFloat(document.getElementById('raketen-cd-balken-p2').style.width),
      };
    });
    expect(r.x).toBeCloseTo(300, 5);
    expect(r.y).toBeCloseTo(400, 5);
    expect(r.energy).toBe(42); // only the combo sweep costs energy
    expect(r.cdP2).toBe(172);
    expect(r.cdP1).toBe(0);
    expect(r.p1y).toBeCloseTo(400, 5);
    expect(r.barP2).toBeCloseTo(100 - (172 / 180) * 100, 3);
  });
});

test('Gleve-MR dash combo: at the end of a regular dash a sweep follows immediately (normal cost), not without energy', async ({
  page,
}) => {
  await startGleve(page);
  const r = await page.evaluate(() => {
    const { state, arrays, Entities } = window.__game;
    const T = window.__gleveTest;
    // Dash upwards (tier 1: 100 px, 8 steps) ends at y 300; the enemy then lies within sweep range but not within dash range
    const dashOnEnemy = energy => {
      T.empty();
      state.energy = energy;
      Entities.createEnemy(185, 230, 'normal', 0, false);
      const enemy = arrays.enemies[0];
      Object.assign(enemy, { vy: 0, shotTimer: 9999, carriesPowerup: false });
      state.keysPressed.k = true;
      T.steps(8);
      state.keysPressed.k = false;
      const afterDash = { y: state.y, sweep: state.gleveSweepTimer, energy: state.energy };
      T.steps(10);
      return { afterDash, enemyThere: arrays.enemies.includes(enemy) };
    };
    return { full: dashOnEnemy(50), empty: dashOnEnemy(5) };
  });
  expect(r.full.afterDash.y).toBeCloseTo(300, 5);
  expect(r.full.afterDash.sweep).toBeGreaterThan(0);
  expect(r.full.afterDash.energy).toBe(42);
  expect(r.full.enemyThere).toBe(false);
  // Too little energy for a sweep: no combo sweep, the enemy stays
  expect(r.empty.afterDash.sweep).toBe(0);
  expect(r.empty.enemyThere).toBe(true);
});

test.describe('Gleve-MR dash charges', () => {
  test('Start with 2 charges: two dashes right after each other, the third not; recharge every dashCooldown steps', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Gleve = await import('./js/gleve.js');
      const T = window.__gleveTest;
      // One dash per press: press the key, wait for the dash duration, release (11 steps)
      const dash = () => {
        state.keysPressed.k = true;
        T.steps(10);
        state.keysPressed.k = false;
        T.steps(1);
      };
      const dashCd = Gleve.dashCooldown(state);
      T.empty();
      const start = { charges: state.gleveDashCharges, max: Gleve.dashMaxCharges(state), cd: state.missileCooldown };
      state.y = 500;
      dash();
      const afterOne = { charges: state.gleveDashCharges, y: state.y };
      dash();
      const afterTwo = { charges: state.gleveDashCharges, y: state.y };
      dash();
      const afterThree = { charges: state.gleveDashCharges, y: state.y };
      // The recharge has been running since the first dash (33 steps passed)
      T.steps(dashCd - 33 - 1);
      const beforeOne = state.gleveDashCharges;
      T.steps(1);
      const afterOneLoaded = state.gleveDashCharges;
      T.steps(dashCd - 1);
      const beforeFull = state.gleveDashCharges;
      T.steps(1);
      const full = { charges: state.gleveDashCharges, cd: state.missileCooldown };
      T.steps(dashCd * 2);
      const permanent = state.gleveDashCharges;
      return { start, afterOne, afterTwo, afterThree, beforeOne, afterOneLoaded, beforeFull, full, permanent };
    });
    expect(r.start).toEqual({ charges: 2, max: 2, cd: 0 });
    expect(r.afterOne.charges).toBe(1);
    expect(r.afterOne.y).toBeLessThan(500);
    expect(r.afterTwo.charges).toBe(0);
    expect(r.afterTwo.y).toBeLessThan(r.afterOne.y);
    expect(r.afterThree).toEqual(r.afterTwo);
    expect(r.beforeOne).toBe(0);
    expect(r.afterOneLoaded).toBe(1);
    expect(r.beforeFull).toBe(1);
    expect(r.full).toEqual({ charges: 2, cd: 0 });
    expect(r.permanent).toBe(2);
  });

  test('HUD: the DASH bar shows the recharge, dots show the charges (2, tier 4: 3), Viper without dots', async ({
    page,
  }) => {
    await startGleve(page);
    const points = (sfx = '') =>
      page.evaluate(id => {
        const el = document.getElementById(id);
        return {
          total: el.querySelectorAll('.dash-ladung').length,
          full: el.querySelectorAll('.dash-ladung.voll').length,
          visible: getComputedStyle(el).display !== 'none',
        };
      }, 'dash-ladungen' + sfx);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Gleve = await import('./js/gleve.js');
      const T = window.__gleveTest;
      const bar = () => document.getElementById('raketen-cd-balken');
      const read = () => ({ pct: parseFloat(bar().style.width), color: bar().style.backgroundColor });
      T.empty();
      T.steps(1);
      const start = read();
      state.y = 500;
      state.keysPressed.k = true;
      T.steps(10);
      state.keysPressed.k = false;
      T.steps(1);
      const afterDash = { ...read(), charges: state.gleveDashCharges };
      return { start, afterDash, max: Gleve.dashMaxCharges(state) };
    });
    expect(r.start).toEqual({ pct: 100, color: 'rgb(46, 204, 113)' });
    expect(r.afterDash.charges).toBe(1);
    expect(r.afterDash.pct).toBeLessThan(100);
    expect(r.afterDash.color).not.toBe('rgb(46, 204, 113)');
    expect(await points()).toEqual({ total: r.max, full: 1, visible: true });

    // Fully charged: all dots filled
    await page.evaluate(() => {
      window.__gleveTest.empty();
      window.__gleveTest.steps(1);
    });
    expect(await points()).toEqual({ total: 2, full: 2, visible: true });

    // Tier 4: three dots, the third is missing until recharged
    await page.evaluate(() => {
      const { state } = window.__game;
      state.missileTier = 4;
      window.__gleveTest.steps(1);
    });
    expect(await points()).toEqual({ total: 3, full: 2, visible: true });

    // Viper: no dots
    await page.evaluate(() => {
      const { state, Utils } = window.__game;
      state.selectedShipModel = 'viper';
      Utils.updateShipHudLabels();
      window.__gleveTest.steps(1);
    });
    expect(await points()).toEqual({ total: 0, full: 0, visible: false });
  });

  test('Max charges by missile tier: 1-3 -> 2, 4-5 -> 3; an upgrade recharges by itself, charges never above max', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Gleve = await import('./js/gleve.js');
      const T = window.__gleveTest;
      T.empty();
      const max = [1, 2, 3, 4, 5].map(s => {
        state.missileTier = s;
        return Gleve.dashMaxCharges(state);
      });
      // Upgrade to tier 4: 2 of 3 charges, the recharge starts and fills up to 3
      state.missileTier = 4;
      T.steps(1);
      const afterUpgrade = { charges: state.gleveDashCharges, cd: state.missileCooldown };
      T.steps(Gleve.dashCooldown(state));
      const charged = { charges: state.gleveDashCharges, cd: state.missileCooldown };
      T.steps(Gleve.dashCooldown(state) * 3);
      const neverOverMax = state.gleveDashCharges;
      // Too many charges are clamped
      state.gleveDashCharges = 9;
      T.steps(1);
      const clamped = state.gleveDashCharges;
      return { max, afterUpgrade, charged, neverOverMax, clamped };
    });
    expect(r.max).toEqual([2, 2, 2, 3, 3]);
    expect(r.afterUpgrade.charges).toBe(2);
    expect(r.afterUpgrade.cd).toBeGreaterThan(100);
    expect(r.charged).toEqual({ charges: 3, cd: 0 });
    expect(r.neverOverMax).toBe(3);
    expect(r.clamped).toBe(3);
  });

  test('The kill chain shortens the recharge; when it reaches 0 the charge comes immediately and charging continues', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // A charge is already on its way (40 frames left): the dash kill (-30) shortens it, the second kill finishes it
      state.gleveDashCharges = 1;
      state.missileCooldown = 40;
      Entities.createEnemy(185, 350, 'normal', 0, false);
      Entities.createEnemy(185, 315, 'normal', 0, false);
      arrays.enemies.forEach(f => {
        f.shotTimer = 9999;
        f.carriesPowerup = false;
      });
      state.keysPressed.k = true;
      T.steps(8);
      state.keysPressed.k = false;
      return { enemies: arrays.enemies.length, charges: state.gleveDashCharges, cd: state.missileCooldown };
    });
    expect(r.enemies).toBe(0);
    // Dash 1 -> 0 charges; kill 1: 40 -> 10; kill 2: recharge done, +1 charge, new recharge (180), minus what passed until the end of the step
    expect(r.charges).toBe(1);
    expect(r.cd).toBeGreaterThan(100);
    expect(r.cd).toBeLessThan(180);
  });
});

test.describe('Gleve-MR laser sweep (laser key)', () => {
  test('Blade wave: one sweep sends exactly one wave that hits targets beyond the range once with half damage; magma intact, wave disappears, restart cleans up', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities, Utils } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Origin (200, 405), length 100: tip at y = 305; wave 70 px wide (x 165-235), starts at y = 298
      const enemy = (x, y) => {
        Entities.createEnemy(x, y, 'normal', 0, false);
        const f = arrays.enemies[arrays.enemies.length - 1];
        Object.assign(f, { vy: 0, shotTimer: 9999, carriesPowerup: false });
        return f;
      };
      const top = enemy(185, 220); // about 60 px above the sweep range
      const lateral = enemy(330, 220);
      Entities.createAsteroid(185, 230, 30, 0, 0, 0, true);
      const magma = arrays.asteroids[arrays.asteroids.length - 1];
      Object.assign(magma, { isIndestructible: true, isMagma: true, carriesPowerup: false, vRot: 0 });
      const hp0 = [top.hp, lateral.hp, magma.hp];
      const out = {};
      state.keysPressed.l = true;
      T.steps(10);
      state.keysPressed.l = false;
      out.waves = arrays.gleveWaves.length;
      out.dom = document.querySelectorAll('.gleve-welle').length;
      out.width = arrays.gleveWaves[0] && arrays.gleveWaves[0].width;
      out.owner = arrays.gleveWaves[0] && arrays.gleveWaves[0].owner;
      T.steps(12);
      out.afterFlight = [hp0[0] - top.hp, hp0[1] - lateral.hp, hp0[2] - magma.hp];
      T.steps(8);
      out.endWaves = arrays.gleveWaves.length;
      out.endDom = document.querySelectorAll('.gleve-welle').length;
      out.endDamage = hp0[0] - top.hp;
      out.magmaThere = arrays.asteroids.includes(magma);
      // Restart removes waves
      state.keysPressed.l = true;
      T.steps(10);
      state.keysPressed.l = false;
      out.beforeRestart = arrays.gleveWaves.length;
      Utils.restartGame();
      out.afterRestart = [arrays.gleveWaves.length, document.querySelectorAll('.gleve-welle').length];
      return out;
    });
    expect(r.waves).toBe(1);
    expect(r.dom).toBe(1);
    expect(r.owner).toBe('p1');
    expect(r.width).toBeGreaterThanOrEqual(50);
    // Enemy at the top: exactly once half the sweep damage (15); sideways and magma nothing
    expect(r.afterFlight).toEqual([15, 0, 0]);
    expect(r.endDamage).toBe(15);
    expect(r.magmaThere).toBe(true);
    expect(r.endWaves).toBe(0);
    expect(r.endDom).toBe(0);
    expect(r.beforeRestart).toBe(1);
    expect(r.afterRestart).toEqual([0, 0]);
  });

  test('Sweep hits targets in the arc exactly once, not sideways, behind or too far away; magma stays intact', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Origin of the beam: (200, 405), tier 1: 90 degree arc, length 100, damage 30
      const asteroid = (x, y, g = 30) => {
        Entities.createAsteroid(x, y, g, 0, 0, 0, true);
        const a = arrays.asteroids[arrays.asteroids.length - 1];
        a.vRot = 0;
        return a;
      };
      // Enemy with a shield straight ahead: the shield catches the damage
      Entities.createEnemy(185, 340, 'normal', 0, true);
      const enemy = arrays.enemies[0];
      Object.assign(enemy, { vy: 0, shotTimer: 9999 });
      const inArc = asteroid(167, 322); // ca. -15 Grad, 70 px
      const lateral = asteroid(240, 390); // 90 Grad
      const behind = asteroid(185, 440);
      const tooFar = asteroid(185, 265); // nearest point 110 px away
      Entities.createAsteroid(250, 330, 30, 0, 0, 0, true);
      const magma = arrays.asteroids[arrays.asteroids.length - 1];
      Object.assign(magma, { x: 205, y: 340, isIndestructible: true, isMagma: true, carriesPowerup: false, vRot: 0 });
      magma.el.classList.add('unzerstoerbar');
      const hpBeforehand = [inArc, lateral, behind, tooFar, magma].map(a => a.hp);

      state.keysPressed.l = true;
      T.steps(5);
      const blade = document.querySelector('.gleve-klinge');
      const bladeDuring = blade
        ? { transform: blade.style.transform, origin: getComputedStyle(blade).transformOrigin }
        : null;
      T.steps(5);
      state.keysPressed.l = false;
      const afterSweep = {
        blade: document.querySelectorAll('.gleve-klinge').length,
        fan: document.querySelectorAll('.gleve-faecher').length,
        energy: state.energy,
      };
      // Further steps without the key: no second sweep, no second damage
      T.steps(20);
      return {
        enemy: { there: arrays.enemies.includes(enemy), shield: enemy.shieldHp, hp: enemy.hp },
        hp: [inArc, lateral, behind, tooFar, magma].map((a, i) => hpBeforehand[i] - a.hp),
        magma: { there: arrays.asteroids.includes(magma), indestructible: magma.isIndestructible },
        bladeDuring,
        afterSweep,
        timer: state.gleveSweepTimer,
        sounds: window.__game.Audio.audioHistory.filter(a => a.name === 'sweep').length,
      };
    });
    expect(r.enemy.there).toBe(true);
    expect(r.enemy.shield).toBe(0);
    expect(r.enemy.hp).toBe(20);
    // in the arc: exactly once 30 damage; sideways, behind, magma: nothing;
    // too far for the sweep: only the blade wave hits (half damage, once)
    expect(r.hp).toEqual([30, 0, 0, 15, 0]);
    expect(r.magma.there).toBe(true);
    expect(r.magma.indestructible).toBe(true);
    // The blade rotates around the ship bow (vertical after 5 of 10 frames)
    expect(r.bladeDuring).not.toBeNull();
    expect(r.bladeDuring.transform).toBe('rotate(0deg)');
    expect(r.bladeDuring.origin).toMatch(/ 100px$/);
    expect(r.afterSweep.blade).toBe(0);
    expect(r.afterSweep.fan).toBe(1);
    // 8 energy per sweep, no regeneration while holding
    expect(r.afterSweep.energy).toBe(42);
    expect(r.timer).toBe(0);
    expect(r.sounds).toBe(1);
  });

  test('Arc by laser tier: tier 1 (90 degrees) hits at 40, not at 60 degrees; tier 5 (150 degrees) hits at 70 degrees', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      // Small target (10 px) with its center 70 px from the beam origin (200, 405) at the angle (degrees, 0 = top)
      const target = angle => {
        const rad = (angle * Math.PI) / 180;
        Entities.createAsteroid(200 + Math.sin(rad) * 70 - 5, 405 - Math.cos(rad) * 70 - 5, 10, 0, 0, 0, true);
        const a = arrays.asteroids[arrays.asteroids.length - 1];
        a.vRot = 0;
        a.carriesPowerup = false;
        return { a, hp: a.hp };
      };
      const damage = z => z.hp - z.a.hp;
      const sweep = () => {
        state.keysPressed.l = true;
        T.steps(10);
        state.keysPressed.l = false;
        T.steps(1);
      };

      T.empty();
      const tier1 = [target(40), target(-40), target(60), target(-60)];
      sweep();

      T.empty();
      state.laserTier = 5;
      const tier5 = [target(70), target(-70), target(85)];
      sweep();
      return { tier1: tier1.map(damage), tier5: tier5.map(damage) };
    });
    expect(r.tier1).toEqual([30, 30, 0, 0]);
    expect(r.tier5).toEqual([50, 50, 0]);
  });

  test('Held, the sweep swings on the cadence, uses energy without regeneration; cadence by tier, energy limit, superweapon, weaponsOffline', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(async () => {
      const { state, arrays, Audio } = window.__game;
      const Hack = await import('./js/hack.js');
      const T = window.__gleveTest;
      const color = () => document.getElementById('energie-balken').style.backgroundColor;
      const z = () => ({
        direction: state.gleveSweepDirection,
        angle: state.gleveSweepAngle,
        timer: state.gleveSweepTimer,
        energy: state.energy,
      });

      // Tier 1: cadence 20, 8 energy per sweep
      T.empty();
      Audio.clearAudioHistory();
      state.keysPressed.l = true;
      T.steps(1);
      const first = z();
      T.steps(19);
      const beforeSecond = z();
      T.steps(1);
      const secondary = z();
      T.steps(20);
      const third = z();
      const colorFull = color();
      state.keysPressed.l = false;
      T.steps(9);
      const released = z(); // the last sweep is still running: no regeneration
      T.steps(10);
      const loaded = state.energy;
      const sounds = Audio.audioHistory.filter(a => a.name === 'sweep').length;

      // Tier 5: cadence 16, 6 energy, 150 degree arc
      T.empty();
      state.laserTier = 5;
      state.keysPressed.l = true;
      T.steps(1);
      const s5erster = z();
      T.steps(15);
      const s5vor = z();
      T.steps(1);
      const s5zweiter = z();
      state.keysPressed.l = false;
      T.steps(1);

      // Too little energy: no sweep, no regeneration while held either, bar orange
      T.empty();
      state.energy = 7;
      state.keysPressed.l = true;
      T.steps(5);
      const withoutEnergy = { ...z(), color: color() };
      state.keysPressed.l = false;
      T.steps(1);

      // Superweapon: sweep without cost
      T.empty();
      state.unlimitedEnergy = true;
      state.energy = 0;
      state.keysPressed.l = true;
      T.steps(1);
      const superweapon = z();
      state.keysPressed.l = false;
      T.steps(1);

      // weaponsOffline blocks the sweep
      T.empty();
      Hack.hackPlayer(state, 'weaponsOffline');
      state.keysPressed.l = true;
      T.steps(5);
      const hacked = z();
      state.keysPressed.l = false;
      state.hacks = [];

      return {
        first,
        beforeSecond,
        secondary,
        third,
        colorFull,
        released,
        loaded,
        sounds,
        s5erster,
        s5vor,
        s5zweiter,
        withoutEnergy,
        superweapon,
        hacked,
        lasers: arrays.laserArray.length,
        missiles: arrays.missileArray.length,
      };
    });
    // First sweep left -> right: start at -45 degrees, 9 degrees per step
    expect(r.first).toEqual({ direction: 1, angle: -36, timer: 9, energy: 42 });
    expect(r.beforeSecond).toEqual({ direction: 1, angle: 45, timer: 0, energy: 42 });
    // Second sweep after 20 frames right -> left
    expect(r.secondary).toEqual({ direction: -1, angle: 36, timer: 9, energy: 34 });
    expect(r.third.direction).toBe(1);
    expect(r.third.energy).toBe(26);
    expect(r.colorFull).toBe('rgb(26, 188, 156)');
    expect(r.released.timer).toBe(0);
    expect(r.released.energy).toBe(26);
    // After that 0.4 per step
    expect(r.loaded).toBeCloseTo(30, 5);
    expect(r.sounds).toBe(3);
    expect(r.s5erster).toEqual({ direction: 1, angle: -60, timer: 9, energy: 44 });
    expect(r.s5vor.direction).toBe(1);
    expect(r.s5zweiter.direction).toBe(-1);
    expect(r.s5zweiter.energy).toBe(38);
    expect(r.withoutEnergy).toEqual({
      direction: 0,
      angle: expect.any(Number),
      timer: 0,
      energy: 7,
      color: 'rgb(230, 126, 34)',
    });
    expect(r.superweapon.timer).toBe(9);
    expect(r.superweapon.energy).toBe(0);
    expect(r.hacked.timer).toBe(0);
    expect(r.hacked.energy).toBe(50);
    expect(r.lasers).toBe(0);
    expect(r.missiles).toBe(0);
  });

  test('Parry laser tier 1: an enemy laser is flung sideways, is harmless and leaves the field', async ({ page }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // An enemy laser flies from above towards the ship (slightly right of the center)
      Entities.createEnemyLaser(201, 320);
      const fl = arrays.enemyLaserArray[0];
      // Hack projectile to the left of it, without homing
      Entities.createHackProjectile(186, 330, 186, 600);
      const hp = arrays.hackProjectileArray[0];
      hp.steerTime = 0;
      hp.vx = 0;
      hp.vy = 3;
      state.keysPressed.l = true;
      T.steps(10);
      state.keysPressed.l = false;
      const parried = {
        harmless: fl.harmless,
        vx: fl.vx,
        color: fl.el.style.backgroundColor,
        hackHarmless: hp.harmless,
        hackVx: hp.vx,
        hackSteerTime: hp.steerTime,
      };
      // Put the ship directly into the flight path: no hit
      state.x = fl.x + fl.vx - 10;
      state.y = fl.y + fl.vy - 10;
      T.steps(1);
      const inGone = { lives: state.lives, laserThere: arrays.enemyLaserArray.includes(fl), hacks: state.hacks.length };
      state.x = 185;
      state.y = 400;
      T.steps(60);
      return {
        parried,
        inGone,
        laserRest: arrays.enemyLaserArray.length,
        hackRest: arrays.hackProjectileArray.length,
        lives: state.lives,
        hacks: state.hacks.length,
        playerLaser: arrays.laserArray.length,
      };
    });
    expect(r.parried.harmless).toBe(true);
    expect(r.parried.vx).toBeGreaterThan(0);
    expect(r.parried.color).toBe('rgb(230, 126, 34)');
    expect(r.parried.hackHarmless).toBe(true);
    expect(r.parried.hackVx).toBeLessThan(0);
    expect(r.parried.hackSteerTime).toBe(0);
    expect(r.inGone.lives).toBe(3);
    expect(r.inGone.laserThere).toBe(true);
    expect(r.inGone.hacks).toBe(0);
    expect(r.laserRest).toBe(0);
    expect(r.hackRest).toBe(0);
    expect(r.lives).toBe(3);
    expect(r.hacks).toBe(0);
    // Tier 1 throws nothing back
    expect(r.playerLaser).toBe(0);
  });

  test('Parry laser tier 5: a boss laser is thrown back and hits; tier 3 with a 50 % chance', async ({ page }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      state.laserTier = 5;
      // Target far above the sweep length (140 px) and the blade wave (+120 px), directly above the ship
      Entities.createAsteroid(185, 100, 30, 0, 0, 0, true);
      const target = arrays.asteroids[0];
      target.vRot = 0;
      const hpBeforehand = target.hp;
      Entities.createBossLaser(196, 320, 0, 6);
      const bl = arrays.bossLaserArray[0];
      state.keysPressed.l = true;
      T.steps(10);
      state.keysPressed.l = false;
      const l = arrays.laserArray[0];
      const back = {
        bossLaser: arrays.bossLaserArray.length,
        playerLaser: arrays.laserArray.length,
        owner: l && l.owner,
        damage: l && l.damage,
        vy: l && l.vy,
        vx: l && l.vx,
        color: l && l.el.style.backgroundColor,
        // The boss laser vanishes, a thrown back player laser appears in its place
        reflectedEl: l && l.el.classList.contains('gleve-reflektiert') && !bl.el.isConnected,
      };
      T.steps(30);
      const result = { damage: hpBeforehand - target.hp, playerLaser: arrays.laserArray.length, lives: state.lives };

      // Tier 3: chance decides (Math.random stubbed)
      const original = Math.random;
      const parry = random => {
        T.empty();
        state.laserTier = 3;
        Entities.createEnemyLaser(201, 320);
        const fl = arrays.enemyLaserArray[0];
        Math.random = () => random;
        try {
          state.keysPressed.l = true;
          T.steps(10);
          state.keysPressed.l = false;
        } finally {
          Math.random = original;
        }
        return {
          enemyLaser: arrays.enemyLaserArray.length,
          harmless: !!fl.harmless,
          playerLaser: arrays.laserArray.length,
        };
      };
      return { back, result, tier3Back: parry(0.1), tier3Gone: parry(0.9) };
    });
    expect(r.back.bossLaser).toBe(0);
    expect(r.back.playerLaser).toBe(1);
    expect(r.back.owner).toBe('p1');
    expect(r.back.damage).toBe(15);
    expect(r.back.vy).toBe(10);
    expect(r.back.vx).toBe(0);
    expect(r.back.color).toBe('rgb(230, 126, 34)');
    expect(r.back.reflectedEl).toBe(true);
    expect(r.result.damage).toBe(15);
    expect(r.result.playerLaser).toBe(0);
    expect(r.result.lives).toBe(3);
    expect(r.tier3Back).toEqual({ enemyLaser: 0, harmless: false, playerLaser: 1 });
    expect(r.tier3Gone).toEqual({ enemyLaser: 1, harmless: true, playerLaser: 0 });
  });

  test('Co-op: player 2 sweeps with Ä and own energy', async ({ page }) => {
    await startGleve(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      state.p2.x = 400;
      state.p2.y = 400;
      Entities.createAsteroid(400, 330, 30, 0, 0, 0, true);
      const a = arrays.asteroids[0];
      a.vRot = 0;
      const hpBeforehand = a.hp;
      state.keysPressed['ä'] = true;
      T.steps(10);
      state.keysPressed['ä'] = false;
      return {
        damage: hpBeforehand - a.hp,
        energyP2: state.p2.energy,
        energyP1: state.energy,
        cdP2: state.p2.missileCooldown,
        directionP1: state.gleveSweepDirection,
      };
    });
    expect(r.damage).toBe(30);
    expect(r.energyP2).toBe(42);
    expect(r.energyP1).toBe(50);
    expect(r.cdP2).toBe(0);
    expect(r.directionP1).toBe(0);
  });
});

test('Gleve-MR: a sweep kill on an enemy ship returns energy, on asteroids not', async ({ page }) => {
  await startGleve(page);
  const r = await page.evaluate(() => {
    const { state, arrays, Entities, shipModels } = window.__game;
    const T = window.__gleveTest;
    // One sweep (tier 1: 30 damage, 8 energy) at a target straight ahead; measure the energy while the sweep is still running
    const sweepOn = create => {
      T.empty();
      const target = create();
      state.keysPressed.l = true;
      T.steps(10);
      const energy = state.energy;
      state.keysPressed.l = false;
      return { energy, destroyed: !arrays.enemies.includes(target) && !arrays.asteroids.includes(target) };
    };
    const enemy = sweepOn(() => {
      Entities.createEnemy(185, 340, 'normal', 0, false);
      const f = arrays.enemies[0];
      Object.assign(f, { vy: 0, shotTimer: 9999, carriesPowerup: false });
      return f;
    });
    const asteroid = sweepOn(() => {
      Entities.createAsteroid(185, 340, 20, 0, 0, 0, true);
      const a = arrays.asteroids[0];
      a.carriesPowerup = false;
      return a;
    });
    return { enemy, asteroid, bonus: shipModels.gleve.sweepKillEnergy, start: 50 };
  });
  expect(r.bonus).toBeGreaterThan(0);
  expect(r.enemy.destroyed).toBe(true);
  expect(r.asteroid.destroyed).toBe(true);
  // Both sweeps cost the same; only the enemy kill returns the bonus
  expect(r.enemy.energy - r.asteroid.energy).toBeCloseTo(r.bonus, 5);
  expect(r.asteroid.energy).toBeLessThan(r.start);
});

test.describe('Gleve-MR bot and online host', () => {
  // The bot (hard: decides every step) flies the Gleve as player 2
  async function startBot(page) {
    await startGleve(page, { coop: true });
    await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      window.__gleveTest.botEmpty = () => {
        const { state } = window.__game;
        window.__gleveTest.empty();
        state.p2IsBot = true;
        state.p2BotDifficulty = 'hard';
        Bot.resetBot();
        state.p2.x = 400;
        state.p2.y = 400;
        state.p2.botFireLaser = false;
        state.p2.botFireMissile = false;
        state.p2.botDashDirection = null;
        window.__game.Audio.clearAudioHistory();
      };
    });
  }

  test('Bot dashes deliberately at a near enemy, but not without a target, without a charge or into a boss', async ({
    page,
  }) => {
    await startBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities, Audio } = window.__game;
      const T = window.__gleveTest;
      const dashes = () => Audio.audioHistory.filter(a => a.name === 'dash').length;
      const enemy = (x, y) => {
        Entities.createEnemy(x, y, 'normal', 0, false);
        const f = arrays.enemies[arrays.enemies.length - 1];
        f.shotTimer = 9999;
        f.carriesPowerup = false;
        return f;
      };
      const out = {};

      // Empty field: no dash
      T.botEmpty();
      T.steps(60);
      out.empty = dashes();

      // Enemy diagonally up right within range (without energy for the sweep, so only the dash hits)
      T.botEmpty();
      state.p2.energy = 0;
      enemy(440, 330);
      T.steps(12);
      out.near = {
        dashes: dashes(),
        enemies: arrays.enemies.length,
        cd: state.p2.missileCooldown,
        x: state.p2.x,
        y: state.p2.y,
        pressure: state.p2.botFireMissile,
      };
      // After that no further dash without a target
      T.steps(60);
      out.nearThereafter = dashes();

      // No dash charge: no dash
      T.botEmpty();
      state.p2.energy = 0;
      state.p2.gleveDashCharges = 0;
      state.p2.missileCooldown = 999;
      enemy(440, 330);
      T.steps(12);
      out.withoutCharge = { dashes: dashes(), enemies: arrays.enemies.length };

      // Enemy behind a boss: no dash into the boss
      T.botEmpty();
      state.p2.energy = 0;
      Entities.createBoss();
      const b = arrays.bosses[0];
      Object.assign(b, {
        phase: 'fight',
        x: 360,
        y: 280,
        vx: 0,
        shotTimer: 9999,
        bombTimer: 9999,
        missileTimer: 9999,
      });
      state.p2.y = 420;
      enemy(400, 330);
      T.steps(4);
      out.boss = { dashes: dashes(), bossHp: b.hp, maxHp: b.maxHp };
      return out;
    });
    expect(r.empty).toBe(0);
    expect(r.near.dashes).toBe(1);
    expect(r.near.enemies).toBe(0);
    expect(r.near.cd).toBeGreaterThan(100);
    expect(r.near.x).toBeGreaterThan(400);
    expect(r.near.y).toBeLessThan(400);
    // The dash press is an edge and does not stay
    expect(r.near.pressure).toBe(false);
    expect(r.nearThereafter).toBe(1);
    expect(r.withoutCharge).toEqual({ dashes: 0, enemies: 1 });
    expect(r.boss.dashes).toBe(0);
    expect(r.boss.bossHp).toBe(r.boss.maxHp);
  });

  test('Bot sweeps at an enemy laser in front of it and parries it', async ({ page }) => {
    await startBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities, Audio } = window.__game;
      const T = window.__gleveTest;
      T.botEmpty();
      // Enemy laser off to the side (outside of arc and length): no sweep, no energy used
      Entities.createEnemyLaser(300, 330);
      T.steps(3);
      const lateral = { sweeps: Audio.audioHistory.filter(a => a.name === 'sweep').length, energy: state.p2.energy };
      T.botEmpty();
      // Enemy laser directly in front of the ship
      Entities.createEnemyLaser(state.p2.x + 13, 330);
      const fl = arrays.enemyLaserArray[0];
      T.steps(10);
      return {
        lateral,
        sweeps: Audio.audioHistory.filter(a => a.name === 'sweep').length,
        energy: state.p2.energy,
        harmless: !!fl.harmless,
        lives: state.p2.lives,
        dashes: Audio.audioHistory.filter(a => a.name === 'dash').length,
      };
    });
    expect(r.lateral).toEqual({ sweeps: 0, energy: 50 });
    expect(r.sweeps).toBe(1);
    expect(r.energy).toBe(42);
    expect(r.harmless).toBe(true);
    expect(r.lives).toBe(3);
    expect(r.dashes).toBe(0);
  });

  test('Online host: the client dash via the missile input with the reported direction, also on a short press; sweep via the held laser input', async ({
    page,
  }) => {
    await startGleve(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, Network, Audio } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      state.gameMode = 'online';
      Object.assign(state.network, { isOnline: true, isHost: true, isClient: false, connected: false });
      state.p2.laserInputRequested = false;
      state.p2.missileHeld = false;
      state.p2.networkDashRequest = false;
      Audio.clearAudioHistory();
      const input = e =>
        Network.applyPlayerInput(
          Object.assign({ x: 300, y: 400, rotate: 0, laser: false, missile: false, bomb: false, rx: 0, ry: 0 }, e),
        );

      // Press and release arrive before the same host step
      input({ missile: true, rx: 1, ry: 0 });
      input({ missile: false, rx: 1, ry: 0 });
      T.steps(1);
      const first = {
        x: state.p2.x,
        energy: state.p2.energy,
        cd: state.p2.missileCooldown,
        sweep: state.p2.gleveSweepTimer,
      };
      // The client position during the dash is ignored
      input({ x: 500, y: 300 });
      T.steps(7);
      const end = { x: state.p2.x, y: state.p2.y };
      // After that the client position applies again
      input({ x: 410, y: 390 });
      const thereafter = { x: state.p2.x, y: state.p2.y };

      // Held laser input: swinging sweeps, no dash
      input({ x: 410, y: 390, laser: true });
      T.steps(21);
      const sweep = {
        direction: state.p2.gleveSweepDirection,
        energy: state.p2.energy,
        sweeps: Audio.audioHistory.filter(a => a.name === 'sweep').length,
        dashes: Audio.audioHistory.filter(a => a.name === 'dash').length,
      };
      input({ x: 410, y: 390, laser: false });
      Object.assign(state.network, { isOnline: false, isHost: false });
      return { first, end, thereafter, sweep };
    });
    expect(r.first.x).toBeCloseTo(312.5, 5);
    expect(r.first.energy).toBe(50);
    expect(r.first.cd).toBe(179);
    expect(r.first.sweep).toBe(0);
    expect(r.end.x).toBeCloseTo(400, 5);
    expect(r.end.y).toBeCloseTo(400, 5);
    expect(r.thereafter).toEqual({ x: 410, y: 390 });
    expect(r.sweep).toEqual({ direction: -1, energy: 34, sweeps: 2, dashes: 1 });
  });
});

test('Gleve-MR: selectable for player 2 in co-op, P2 HUD and highscore badge G', async ({ page }) => {
  await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    Utils.setGameMode('coop');
  });
  await page.locator('.hangar-player-tab[data-player="p2"]').click();
  await page.locator('.hangar-model-btn[data-model="gleve"]').click();

  const models = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    return { p1: state.selectedShipModel, p2: state.p2.selectedShipModel };
  });
  expect(models.p1).toBe('viper');
  expect(models.p2).toBe('gleve');
  await expect(page.locator('#energie-cd-container-p2 .cooldown-letter')).toHaveText('S');
  await expect(page.locator('#raketen-cd-container-p2 .cooldown-letter')).toHaveText('D');
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('E');
  const p2Svg = await page.locator('#spieler-2 svg').evaluate(el => el.innerHTML);
  expect(p2Svg).toContain('Gleve-MR');

  // Highscore badges: solo "Gleve-MR", co-op mini "G" with its own class
  const badges = await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    Utils.renderHighscoresTable('single', [{ name: 'GLV', score: 500, shipP1: 'gleve' }]);
    const solo = document.querySelector('#highscore-body .hs-ship-gleve');
    const soloText = solo ? solo.textContent : null;
    Utils.renderHighscoresTable('coop_bot', [{ name: 'A+B', score: 500, shipP1: 'phantom', shipP2: 'gleve' }]);
    const mini = document.querySelector('#highscore-body .hs-badge-mini.hs-ship-gleve');
    return { soloText, miniText: mini ? mini.textContent : null };
  });
  expect(badges.soloText).toBe('Gleve-MR');
  expect(badges.miniText).toBe('P2:G');
});

test('Gleve-MR: game over during sweep and dash clears the blade and the dash rendering', async ({ page }) => {
  await startGleve(page);
  const r = await page.evaluate(() => {
    const { state, Utils } = window.__game;
    const T = window.__gleveTest;
    T.empty();
    state.keysPressed.k = true;
    state.keysPressed.l = true;
    T.steps(3);
    const beforehand = {
      blades: document.querySelectorAll('.gleve-klinge').length,
      dash: document.getElementById('spieler').classList.contains('gleve-dash'),
    };
    Object.keys(state.keysPressed).forEach(k => {
      state.keysPressed[k] = false;
    });
    Utils.triggerGameOver();
    // After game over the simulation does not continue
    T.steps(5);
    return {
      beforehand,
      blades: document.querySelectorAll('.gleve-klinge').length,
      dash: document.getElementById('spieler').classList.contains('gleve-dash'),
    };
  });
  expect(r.beforehand.blades).toBe(1);
  expect(r.beforehand.dash).toBe(true);
  expect(r.blades).toBe(0);
  expect(r.dash).toBe(false);
});

test.describe('Gleve-MR mobile controls', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  test('Joystick sweeps automatically for the Gleve, missile button "D" triggers exactly one dash, no separate dash button', async ({
    page,
  }) => {
    await page.locator('.hangar-model-btn[data-model="gleve"]').click();
    await page.tap('#start-text');
    await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
    await expect(page.locator('#mobile-controls')).toBeVisible();
    await expect(page.locator('#btn-dash')).toHaveCount(0);
    await expect(page.locator('#btn-rakete span')).toHaveText('D');

    const r = await page.evaluate(() => {
      const { state, arrays, Loop } = window.__game;
      [
        'enemies',
        'asteroids',
        'enemyLaserArray',
        'hackProjectileArray',
        'bossLaserArray',
        'bosses',
        'powerups',
      ].forEach(name => {
        arrays[name].forEach(o => o.el && o.el.remove());
        arrays[name].length = 0;
      });
      state.frameCounter = 1;
      state.energy = 50;
      state.maxEnergy = 50;
      state.laserTier = 1;
      state.missileTier = 1;
      state.missileCooldown = 0;
      state.gleveDashKeyHeld = false;
      state.gleveSweepCadence = 0;
      state.x = 185;
      state.y = 400;
      const touch = (el, type) => {
        const t = new Touch({
          identifier: 1,
          target: el,
          clientX: el.getBoundingClientRect().left + 20,
          clientY: el.getBoundingClientRect().top + 20,
        });
        el.dispatchEvent(
          new TouchEvent(type, {
            touches: type === 'touchstart' ? [t] : [],
            changedTouches: [t],
            bubbles: true,
            cancelable: true,
          }),
        );
      };
      const zone = document.getElementById('joystick-zone');
      const btn = document.getElementById('btn-rakete');

      // Joystick touch: auto-fire, i.e. sweep (no movement without a deflection)
      touch(zone, 'touchstart');
      const laserAfterJoystick = state.keysPressed.l;
      Loop.simulationStep();
      const sweepAfterJoystick = { timer: state.gleveSweepTimer, energy: state.energy, dash: state.gleveDashTimer };
      touch(zone, 'touchend');
      const laserReleased = state.keysPressed.l;

      // Missile button: one dash upwards while the short press lasts
      touch(btn, 'touchstart');
      const missilePressed = state.keysPressed.k;
      for (let i = 0; i < 20; i++) Loop.simulationStep();
      const yAfterDash = state.y;
      const cd = state.missileCooldown;
      const cdHeight = parseFloat(document.getElementById('btn-rakete-cd').style.height);
      return { laserAfterJoystick, sweepAfterJoystick, laserReleased, missilePressed, yAfterDash, cd, cdHeight };
    });
    expect(r.laserAfterJoystick).toBe(true);
    expect(r.sweepAfterJoystick).toEqual({ timer: 9, energy: 42, dash: 0 });
    expect(r.laserReleased).toBe(false);
    expect(r.missilePressed).toBe(true);
    // Exactly one dash upwards (tier 1: 100 px), button fill level = dash cooldown
    expect(r.yAfterDash).toBeCloseTo(300, 5);
    expect(r.cd).toBe(160);
    expect(r.cdHeight).toBeCloseTo(100 - (160 / 180) * 100, 3);

    // Viper: the joystick keeps firing automatically, the button is called R again
    const viper = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      state.selectedShipModel = 'viper';
      Utils.updatePlayerShipVisuals();
      const zone = document.getElementById('joystick-zone');
      const t = new Touch({ identifier: 2, target: zone, clientX: 50, clientY: 850 });
      zone.dispatchEvent(
        new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }),
      );
      const anAtContact = state.keysPressed.l;
      zone.dispatchEvent(
        new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }),
      );
      return {
        anAtContact,
        offThereafter: state.keysPressed.l,
        label: document.querySelector('#btn-rakete span').textContent,
      };
    });
    expect(viper).toEqual({ anAtContact: true, offThereafter: false, label: 'R' });
  });

  test('Missile button shows the number of dash charges and the charge progress, only for the Gleve', async ({
    page,
  }) => {
    await page.locator('.hangar-model-btn[data-model="gleve"]').click();
    await page.tap('#start-text');
    await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
    const r = await page.evaluate(() => {
      const { state, arrays, Loop, Utils } = window.__game;
      [
        'enemies',
        'asteroids',
        'enemyLaserArray',
        'hackProjectileArray',
        'bossLaserArray',
        'bosses',
        'powerups',
      ].forEach(name => {
        arrays[name].forEach(o => o.el && o.el.remove());
        arrays[name].length = 0;
      });
      state.frameCounter = 1;
      state.missileTier = 1;
      state.missileCooldown = 0;
      state.gleveDashCharges = 2;
      state.gleveDashKeyHeld = false;
      state.y = 500;
      const number = document.getElementById('btn-rakete-ladungen');
      const fill = document.getElementById('btn-rakete-cd');
      const read = () => ({
        text: number.textContent,
        visible: getComputedStyle(number).display !== 'none',
        height: parseFloat(fill.style.height),
      });
      Loop.simulationStep();
      const full = read();
      state.keysPressed.k = true;
      for (let i = 0; i < 12; i++) Loop.simulationStep();
      state.keysPressed.k = false;
      Loop.simulationStep();
      const afterDash = read();
      state.selectedShipModel = 'viper';
      Utils.updateShipHudLabels();
      const viper = read();
      return { full, afterDash, viper };
    });
    expect(r.full).toEqual({ text: '2', visible: true, height: 100 });
    expect(r.afterDash.text).toBe('1');
    expect(r.afterDash.height).toBeLessThan(100);
    expect(r.viper).toMatchObject({ text: '', visible: false });
  });

  test('Online client: the missile button label follows the own ship (P2)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      const old = { mode: state.gameMode, isClient: state.network.isClient, p2: state.p2.selectedShipModel };
      const label = () => document.querySelector('#btn-rakete span').textContent;
      state.selectedShipModel = 'viper';
      state.gameMode = 'online';
      state.network.isClient = true;
      state.p2.selectedShipModel = 'gleve';
      Utils.updateShipHudLabels();
      const clientGleve = { model: Utils.localShipModel(), label: label() };
      state.p2.selectedShipModel = 'phantom';
      Utils.updateShipHudLabels();
      const clientPhantom = label();
      state.gameMode = old.mode;
      state.network.isClient = old.isClient;
      state.p2.selectedShipModel = old.p2;
      return { clientGleve, clientPhantom };
    });
    expect(r.clientGleve).toEqual({ model: 'gleve', label: 'D' });
    expect(r.clientPhantom).toBe('R');
  });
});
