const { test, expect } = require('@playwright/test');
const { setGameState, startGame, installClock, pauseClock, advanceClock, windUntil } = require('./helpers');

test.beforeEach(async ({ page }) => {
  // Mock API requests by default so tests do not change the live DB
  await page.route('**/api/highscores*', async route => {
    const url = new URL(route.request().url());
    const mode = url.searchParams.get('mode') || 'single';
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, rank: 1, entry: {} }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, mode, highscores: [] }),
      });
    }
  });
  // Mock the TURN endpoint: tests must not depend on the real worker (behavior as without TURN)
  await page.route('**/api/turn*', route =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'TURN nicht konfiguriert' }),
    }),
  );
  // Do not load Trystero from the internet: tests must not depend on the CDN
  await page.route('https://cdn.jsdelivr.net/npm/@trystero-p2p/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: `export function joinRoom() {
  return { makeAction: () => [() => {}, () => {}], onPeerJoin: () => {}, onPeerLeave: () => {}, leave: () => {} };
}`,
    }),
  );

  // Mark as already seen by default so the tests can interact directly
  await setGameState(page);
  await page.goto('/');
});

test.describe('Space Shooter', () => {
  test('The browser tab shows the game name (issue #34)', async ({ page }) => {
    await expect(page).toHaveTitle('Star Shooter');
  });

  test('The game loads and the start text is shown', async ({ page }) => {
    const startText = page.locator('#start-text');
    await expect(startText).toBeVisible();
    await expect(startText).toContainText('TAP OR PRESS ANY KEY TO START');
  });

  test('The lives display is visible at game start and shows 3 hearts', async ({ page }) => {
    // the start menu hides the game HUD (#28), so start a game first
    await startGame(page, 'KeyW');
    const livesDisplay = page.locator('#leben-anzeige');
    await expect(livesDisplay).toBeVisible();
    const hearts = page.locator('#leben-anzeige .leben-herz');
    await expect(hearts).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(hearts.nth(i)).toHaveText('♥');
    }
  });

  test('Energy and cooldown bars show circular powerup letters E, R and B', async ({ page }) => {
    await startGame(page, 'KeyW');
    const energyLetter = page.locator('#energie-cd-container .cooldown-letter-e');
    await expect(energyLetter).toBeVisible();
    await expect(energyLetter).toHaveText('E');

    const missileLetter = page.locator('#raketen-cd-container .cooldown-letter-r');
    await expect(missileLetter).toBeVisible();
    await expect(missileLetter).toHaveText('R');

    const bombLetter = page.locator('#bomben-cd-container .cooldown-letter-b');
    await expect(bombLetter).toBeVisible();
    await expect(bombLetter).toHaveText('B');

    // Check that the badges are circular (border-radius 50%)
    const borderRadius = await energyLetter.evaluate(el => window.getComputedStyle(el).borderRadius);
    expect(borderRadius).toBe('50%');
  });

  test('The game starts after a key press and stars fly', async ({ page }) => {
    // Before that gameRunning is false
    const startText = page.locator('#start-text');
    await expect(startText).toBeVisible();

    // Simulate a key press (hold it so the game loop registers it in the next frame)
    await page.keyboard.down('w');

    // Start-Text verschwindet
    await expect(startText).toBeHidden();

    // Release the key again
    await page.keyboard.up('w');
  });

  test('A bomb has a level-specific aura (lvl 1)', async ({ page }) => {
    // Start the game
    await startGame(page, 'KeyW');

    // Put the ship far below the bomb target (playfield center, y 285): from the start point (y 285)
    // the bomb detonates after ~10 frames, and with a 36 s cooldown no second one comes in case the
    // locator query misses these frames
    await page.evaluate(() => {
      window.__game.state.y = 500;
    });

    // Fire a bomb with the space bar
    await page.keyboard.down('Space');
    const bombAura = page.locator('.bomben-projektil.bombe-lvl-1 .bombe-aura');
    await expect(bombAura).toBeAttached();
    await page.keyboard.up('Space');
  });

  test('The tier 5 Jericho bomb splits into 4 mini bombs', async ({ page }) => {
    // Start the game and set bomb tier 5
    await startGame(page, 'KeyW');

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.bombTier = 5;
      stateMod.state.bombCooldown = 0;
    });

    // Fire a bomb
    await page.keyboard.down('Space');
    const bombLvl5 = page.locator('.bomben-projektil.bombe-lvl-5').first();
    await expect(bombLvl5).toBeAttached();
    await page.keyboard.up('Space');

    // Wait for the Jericho split (mini bombs)
    const miniBombs = page.locator('.bomben-projektil.bombe-mini');
    await expect(miniBombs.first()).toBeAttached({ timeout: 5000 });
  });

  test('A tier 4 bomb clears enemy lasers without an exception (EMP effect)', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // Start the game
    await startGame(page, 'KeyW');

    // Create enemy lasers and a tier 4 bomb
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      stateMod.state.bombTier = 4;
      stateMod.state.bombCooldown = 0;
      entitiesMod.createEnemyLaser(150, 100);
      entitiesMod.createBossLaser(200, 100);
    });

    // Fire a bomb with the space bar
    await page.keyboard.down('Space');
    await page.waitForTimeout(200);
    await page.keyboard.up('Space');

    // Check that no exception was thrown
    expect(pageErrors).toEqual([]);

    // Check that enemy lasers were removed by the EMP
    const laserCount = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.enemyLaserArray.length + stateMod.arrays.bossLaserArray.length;
    });
    expect(laserCount).toBe(0);
  });

  test('Cheat codes idkf1 to idkf5 set all weapon tiers (1 to 5), reset cooldowns and show an overlay', async ({
    page,
  }) => {
    // Start the game
    await startGame(page, 'KeyW');

    for (let lvl = 1; lvl <= 5; lvl++) {
      // Raise cooldowns artificially
      await page.evaluate(async () => {
        const stateMod = await import('./js/state.js');
        stateMod.state.bombCooldown = 500;
        stateMod.state.missileCooldown = 200;
        stateMod.state.energy = 5;
      });

      const cheat = `idkf${lvl}`;
      // Evaluation happens synchronously in the keydown handler, pauses between the characters are unnecessary
      await page.keyboard.type(cheat);

      const tiers = await page.evaluate(async () => {
        const stateMod = await import('./js/state.js');
        return {
          laser: stateMod.state.laserTier,
          missiles: stateMod.state.missileTier,
          bombs: stateMod.state.bombTier,
          cheatUsed: stateMod.state.cheatUsed,
          bombCooldown: stateMod.state.bombCooldown,
          missileCooldown: stateMod.state.missileCooldown,
          energy: stateMod.state.energy,
          maxEnergy: stateMod.state.maxEnergy,
        };
      });

      expect(tiers.laser).toBe(lvl);
      expect(tiers.missiles).toBe(lvl);
      expect(tiers.bombs).toBe(lvl);
      expect(tiers.cheatUsed).toBe(true);
      expect(tiers.bombCooldown).toBe(0);
      expect(tiers.missileCooldown).toBe(0);
      expect(tiers.energy).toBe(tiers.maxEnergy);

      const overlay = page.locator('#warning-overlay');
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText(`IDKF${lvl}`);
    }
  });

  test('Cheat codes idkfl1 to idkfl9 jump directly into the corresponding level and update the UI', async ({
    page,
  }) => {
    // Start the game
    await startGame(page, 'KeyW');

    for (const lvl of [1, 3, 5, 9]) {
      const cheat = `idkfl${lvl}`;
      // Evaluation happens synchronously in the keydown handler, pauses between the characters are unnecessary
      await page.keyboard.type(cheat);

      const stateInfo = await page.evaluate(async () => {
        const stateMod = await import('./js/state.js');
        return {
          level: stateMod.state.level,
          cheatUsed: stateMod.state.cheatUsed,
        };
      });

      expect(stateInfo.level).toBe(lvl);
      expect(stateInfo.cheatUsed).toBe(true);

      const levelDisplay = page.locator('#level-anzeige');
      await expect(levelDisplay).toHaveText(`LEVEL ${lvl}`);

      const overlay = page.locator('#warning-overlay');
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText(`IDKFL${lvl}`);
    }
  });

  test('The highscore input field is focused automatically on game over', async ({ page }) => {
    // Start the game
    await startGame(page, 'KeyW');

    // Simulate game over via state & playerHit
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.lives = 1;
      stateMod.state.score = 500;
      utilsMod.playerHit({ x: 0, y: 0, el: document.createElement('div') }, false);
    });

    const hsForm = page.locator('#highscore-form');
    await expect(hsForm).toBeVisible();

    const hsInput = page.locator('#highscore-name');
    await expect(hsInput).toBeFocused();

    // Type right away and save with Enter
    await page.keyboard.type('XYZ');
    await page.keyboard.press('Enter');

    await expect(hsForm).toBeHidden();
    const table = page.locator('#highscore-tabelle');
    await expect(table).toContainText('XYZ');
  });

  test('The highscore table saves and shows the ship type used behind every highscore', async ({ page }) => {
    await startGame(page, 'KeyW');

    await page.evaluate(async () => {
      const utilsMod = await import('./js/utils.js');
      localStorage.removeItem('spaceShooterHighscores');
      utilsMod.saveHighscore('VIP', 800, 'viper');
      utilsMod.saveHighscore('PHA', 1200, 'phantom');
      utilsMod.renderHighscores();
    });

    const rows = page.locator('#highscore-body tr');
    await expect(rows).toHaveCount(2);

    // First row: PHA with 1200 and Phantom-NX
    const row1 = rows.nth(0);
    await expect(row1).toContainText('PHA');
    await expect(row1).toContainText('1200');
    await expect(row1).toContainText('Phantom-NX');

    // Second row: VIP with 800 and Viper-X
    const row2 = rows.nth(1);
    await expect(row2).toContainText('VIP');
    await expect(row2).toContainText('800');
    await expect(row2).toContainText('Viper-X');
  });

  test('From tier 2 on missiles have a heavy warhead design with canards', async ({ page }) => {
    // Start the game and set missile tier 2
    await startGame(page, 'KeyW');

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.missileTier = 2;
      stateMod.state.missileCooldown = 0;
    });

    // Fire missiles with key K
    await page.keyboard.down('k');
    const heavyRocket = page.locator('.raketen-projektil.rakete-lvl-2');
    await expect(heavyRocket).toBeAttached();
    const canards = page.locator('.raketen-projektil.rakete-lvl-2 .rakete-canards');
    await expect(canards).toBeAttached();
    await page.keyboard.up('k');
  });

  test('From tier 3 on a missile homes in on enemies', async ({ page }) => {
    // Start the game and set missile tier 3
    await startGame(page, 'KeyW');

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      stateMod.state.missileTier = 3;
      stateMod.state.missileCooldown = 0;
      // Place an enemy top right
      entitiesMod.createEnemy(300, 50, 'normal', 0);
    });

    // Fire missiles with key K
    await page.keyboard.down('k');
    const homingRocket = page.locator('.raketen-projektil.rakete-homing');
    await expect(homingRocket).toBeAttached();
    await page.keyboard.up('k');

    // Wait briefly (past the ejection & stall phase) and check that the homing missile steers its x value to the right
    await page.waitForTimeout(200);
    const homingX = await page.evaluate(() => {
      const el = document.querySelector('.raketen-projektil.rakete-homing');
      return el ? parseFloat(el.style.left) : null;
    });

    // The origin was ~205px (state.x + 20), it should have moved to the right (> 205px)
    expect(homingX).toBeGreaterThan(205);
  });

  test('At tier 5, 2 of 3 missiles home in (dual homing flanks)', async ({ page }) => {
    // Start the game and set missile tier 5
    await startGame(page, 'KeyW');

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.missileTier = 5;
      stateMod.state.missileCooldown = 0;
    });

    // Fire missiles with key K
    await page.keyboard.down('k');
    const homingRockets = page.locator('.raketen-projektil.rakete-homing');
    await expect(homingRockets).toHaveCount(2);
    const allRockets = page.locator('.raketen-projektil');
    await expect(allRockets).toHaveCount(3);
    await page.keyboard.up('k');
  });

  test('At laser tier 4 the ship fires 4 parallel, bundled lasers without diagonal spread (vx = 0)', async ({
    page,
  }) => {
    // Start the game and set laser tier 4
    await startGame(page, 'KeyW');

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.laserTier = 4;
      stateMod.state.energy = 100;
      stateMod.state.playerShotCooldown = 0;
    });

    // Fire lasers with key L
    await page.keyboard.down('KeyL');
    await page.waitForTimeout(100);

    const laserInfo = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.laserArray.map(l => ({
        vx: l.vx,
        vy: l.vy,
        width: l.width,
      }));
    });

    await page.keyboard.up('KeyL');

    expect(laserInfo.length).toBeGreaterThanOrEqual(4);
    const batch = laserInfo.slice(-4);
    expect(batch.length).toBe(4);
    for (const l of batch) {
      expect(l.vx).toBe(0);
    }
  });

  test('The automatic laser does not aim at indestructible asteroids but picks destructible targets', async ({
    page,
  }) => {
    // Start the game
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => window.__game.state.gameRunning);
    await page.keyboard.up('KeyW');

    // Setup, fixed simulation steps and evaluation in one synchronous block,
    // so the live loop does not keep computing in between. The autolaser deals 1.5
    // damage per step: after 5 steps the enemy (20 HP) is surely still alive.
    const enemyHp = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');
      stateMod.state.autolaserActive = true;
      stateMod.state.autolaserTimer = 600;
      stateMod.state.x = 200;
      stateMod.state.y = 400;

      // 1. Indestructible asteroid very close above the player (y: 350, directly above the ship)
      entitiesMod.createAsteroid(200, 350, 30, 0, 0, false, 0);
      const indestructibleAst = stateMod.arrays.asteroids[stateMod.arrays.asteroids.length - 1];
      indestructibleAst.isIndestructible = true;

      // 2. Destructible enemy farther away (y: 200, x: 250)
      entitiesMod.createEnemy(250, 200, 'normal', 0);

      for (let i = 0; i < 5; i++) simulationStep();
      return stateMod.arrays.enemies[0]?.hp;
    });

    // The enemy must have taken damage (< 20 HP)
    expect(enemyHp).toBeLessThan(20);
  });

  test('The player ship stays within the 4 playfield bounds (top, bottom, left, right)', async ({ page }) => {
    // Start the game
    await startGame(page, 'KeyW');

    // Set / steer to the extreme right and bottom
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.x = 1000;
      stateMod.state.y = 1000;
    });

    await page.waitForTimeout(50);

    const pos1 = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return { x: stateMod.state.x, y: stateMod.state.y };
    });

    // Playfield 400x600, player 30x30 -> max x: 370, max y: 570
    expect(pos1.x).toBe(370);
    expect(pos1.y).toBe(570);

    // Set / steer to the extreme left and top
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.x = -500;
      stateMod.state.y = -500;
    });

    await page.waitForTimeout(50);

    const pos2 = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return { x: stateMod.state.x, y: stateMod.state.y };
    });

    expect(pos2.x).toBe(0);
    expect(pos2.y).toBe(0);
  });

  test('Hangar: the ship model can be switched between Viper-X and Phantom-NX', async ({ page }) => {
    const hangar = page.locator('#hangar-container');
    await expect(hangar).toBeVisible();

    const nameDisplay = page.locator('#hangar-ship-name');
    await expect(nameDisplay).toContainText('VIPER-X');

    // Switch to Phantom-NX
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    await expect(nameDisplay).toContainText('PHANTOM-NX');
    await expect(phantomBtn).toHaveClass(/active/);

    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await expect(viperBtn).not.toHaveClass(/active/);

    const modelPhantom = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.state.selectedShipModel;
    });
    expect(modelPhantom).toBe('phantom');

    // Check that the player ship SVG contains the Phantom geometry
    const playerSvgMarkup = page.locator('#spieler svg');
    const svgHtml1 = await playerSvgMarkup.evaluate(el => el.innerHTML);
    expect(svgHtml1).toContain('Phantom-NX');

    // Switch back to Viper-X
    await viperBtn.click();
    await expect(nameDisplay).toContainText('VIPER-X');
    const modelViper = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.state.selectedShipModel;
    });
    expect(modelViper).toBe('viper');
    const svgHtml2 = await playerSvgMarkup.evaluate(el => el.innerHTML);
    expect(svgHtml2).toContain('Viper-X');
  });

  test('Hangar: the color choice cycles through all 5 color variants', async ({ page }) => {
    const colors = ['blue', 'green', 'yellow', 'purple', 'red'];
    for (const c of colors) {
      const colorBtn = page.locator(`.hangar-color-btn[data-color="${c}"]`);
      await colorBtn.click();
      await expect(colorBtn).toHaveClass(/active/);

      const stateColor = await page.evaluate(async () => {
        const stateMod = await import('./js/state.js');
        return stateMod.state.selectedShipColor;
      });
      expect(stateColor).toBe(c);
    }
  });

  test('Ship properties: Viper-X moves noticeably faster than Phantom-NX', async ({ page }) => {
    // A fixed number of simulation steps in one synchronous block instead of a real-time wait,
    // so both ships fly the same number of steps
    async function travel(model) {
      await page.goto('/');
      await page.locator(`.hangar-model-btn[data-model="${model}"]`).click();
      await startGame(page, 'KeyW');
      await page.keyboard.down('KeyD');
      const delta = await page.evaluate(async () => {
        const stateMod = await import('./js/state.js');
        const { simulationStep } = await import('./js/loop.js');
        stateMod.state.x = 100;
        stateMod.state.y = 100;
        for (let i = 0; i < 10; i++) simulationStep();
        return stateMod.state.x - 100;
      });
      await page.keyboard.up('KeyD');
      return delta;
    }
    const viperDelta = await travel('viper');
    const phantomDelta = await travel('phantom');

    // Behavior instead of constants: the Viper covers a longer distance in the same time
    expect(viperDelta).toBeGreaterThan(0);
    expect(viperDelta).toBeGreaterThan(phantomDelta);
  });

  test('Ship properties: Phantom-NX regenerates shield tier 1 after a hit and shows the clock charge animation (O1)', async ({
    page,
  }) => {
    // 1. Choose Phantom-NX
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    // Start the game
    await startGame(page, 'KeyW');

    // Set the shield to 0 (simulate a hit) and set 50% regeneration
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.shieldTier = 0;
      stateMod.state.phantomShieldRegenTimer = 450; // 50% charged
      document.getElementById('spieler').classList.remove('schild-aktiv-1');
      utilsMod.updateActivePowerupsUi();
    });

    // Check that the O1 icon is shown during the regeneration and has a conic-gradient background
    const o1Recharge = page.locator('#aktive-powerups .pu-recharging-shield');
    await expect(o1Recharge).toBeVisible();
    await expect(o1Recharge).toContainText('O1');

    const background = await o1Recharge.evaluate(el => el.style.background);
    expect(background).toContain('conic-gradient');

    // Timer fast vollenden (899 Frames)
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.phantomShieldRegenTimer = 899;
    });

    // Wait briefly so the game loop ticks the frame and regenerates the shield to tier 1
    await page.waitForTimeout(100);

    const shieldState = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const playerEl = document.getElementById('spieler');
      return {
        tier: stateMod.state.shieldTier,
        hasShieldClass: playerEl.classList.contains('schild-aktiv-1'),
        timer: stateMod.state.phantomShieldRegenTimer,
      };
    });

    expect(shieldState.tier).toBe(1);
    expect(shieldState.hasShieldClass).toBe(true);
    expect(shieldState.timer).toBe(0);
  });

  test('Ship properties: Phantom-NX starts with shield tier 1, Viper-X without a shield', async ({ page }) => {
    // 1. Start with Phantom-NX
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    // Start the game with key W
    await startGame(page, 'KeyW');

    // Check whether shield tier 1 is active
    const phantomShield = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const playerEl = document.getElementById('spieler');
      return {
        tier: stateMod.state.shieldTier,
        hasShieldClass: playerEl.classList.contains('schild-aktiv-1'),
      };
    });

    expect(phantomShield.tier).toBe(1);
    expect(phantomShield.hasShieldClass).toBe(true);

    // 2. Reload the page and start with Viper-X
    await page.goto('/');
    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await viperBtn.click();

    await startGame(page, 'KeyW');

    const viperShield = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const playerEl = document.getElementById('spieler');
      return {
        tier: stateMod.state.shieldTier,
        hasShieldClass: playerEl.classList.contains('schild-aktiv-1'),
      };
    });

    expect(viperShield.tier).toBe(0);
    expect(viperShield.hasShieldClass).toBe(false);
  });

  test('Ship properties: Phantom-NX and Viper-X lose no upgrades on hits (Viper: combo instead of loss)', async ({
    page,
  }) => {
    // 1. Test with Phantom-NX: loses NO upgrades on a hit
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.laserTier = 3;
      stateMod.state.missileTier = 3;
      stateMod.state.bombTier = 3;
      stateMod.state.shieldTier = 0; // No shield, so the hit goes straight to HP
      stateMod.state.lives = 3;
      stateMod.state.invulnerableTimer = 0;

      // Simulate a hit
      utilsMod.playerHit({ x: 0, y: 0, el: document.createElement('div'), isEnemy: true }, false);
    });

    const phantomUpgrades = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return {
        laser: stateMod.state.laserTier,
        missiles: stateMod.state.missileTier,
        bombs: stateMod.state.bombTier,
        lives: stateMod.state.lives,
      };
    });

    // Lives were reduced (3 -> 2), but all weapon tiers stayed unchanged at 3
    expect(phantomUpgrades.lives).toBe(2);
    expect(phantomUpgrades.laser).toBe(3);
    expect(phantomUpgrades.missiles).toBe(3);
    expect(phantomUpgrades.bombs).toBe(3);

    // 2. Test with Viper-X: since V3 it loses no upgrade either (instead the kill combo drops, see viper.spec.js)
    await page.goto('/');
    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await viperBtn.click();

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.laserTier = 3;
      stateMod.state.missileTier = 3;
      stateMod.state.bombTier = 3;
      stateMod.state.shieldTier = 0;
      stateMod.state.lives = 3;
      stateMod.state.invulnerableTimer = 0;

      // Simulate a hit
      utilsMod.playerHit({ x: 0, y: 0, el: document.createElement('div'), isEnemy: true }, false);
    });

    const viperUpgrades = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return {
        laser: stateMod.state.laserTier,
        missiles: stateMod.state.missileTier,
        bombs: stateMod.state.bombTier,
        lives: stateMod.state.lives,
        sum: stateMod.state.laserTier + stateMod.state.missileTier + stateMod.state.bombTier,
      };
    });

    // Lives were reduced (3 -> 2), the sum of the weapon tiers stays 9
    expect(viperUpgrades.lives).toBe(2);
    expect(viperUpgrades.sum).toBe(9);
  });

  test('Ship properties: Viper-X regenerates laser energy faster than Phantom-NX', async ({ page }) => {
    // 1. Choose Viper-X
    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await viperBtn.click();

    // Start the game and set the energy to 0
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => window.__game.state.gameRunning);
    await page.keyboard.up('KeyW');

    // A fixed number of simulation steps in one synchronous block instead of a real-time wait,
    // so both ships regenerate the same number of steps
    const viperRegen = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const { simulationStep } = await import('./js/loop.js');
      stateMod.state.energy = 0;
      stateMod.state.laserShoots = false;
      for (let i = 0; i < 30; i++) simulationStep();
      return {
        energy: stateMod.state.energy,
        configRegen: stateMod.shipModels.viper.energyRegen,
      };
    });

    // 2. Choose Phantom-NX
    await page.goto('/');
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => window.__game.state.gameRunning);
    await page.keyboard.up('KeyW');

    const phantomRegen = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const { simulationStep } = await import('./js/loop.js');
      stateMod.state.energy = 0;
      stateMod.state.laserShoots = false;
      for (let i = 0; i < 30; i++) simulationStep();
      return {
        energy: stateMod.state.energy,
        configRegen: stateMod.shipModels.phantom.energyRegen,
      };
    });

    // Behavior instead of constants: both regenerate, the Viper charges more in the same number of steps
    expect(phantomRegen.energy).toBeGreaterThan(0);
    expect(viperRegen.energy).toBeGreaterThan(phantomRegen.energy);
  });

  test('Ship properties: Viper-X gets energy back when destroying small opponents (+5 energy)', async ({ page }) => {
    // 1. Choose Viper-X (default)
    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await viperBtn.click();

    // Start the game
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => window.__game.state.gameRunning);
    await page.keyboard.up('KeyW');

    // Set the energy, create an enemy, destroy it and read it out in one synchronous block:
    // The real game loop cannot run in between (no regeneration between the steps)
    const r = await page.evaluate(() => {
      const { state, arrays, Entities, Utils } = window.__game;
      state.energy = 20;
      // Create and destroy a small enemy
      Entities.createEnemy(200, 100, 'normal', 0);
      const enemy = arrays.enemies[arrays.enemies.length - 1];
      Utils.destroyTarget(enemy);
      return { energy: state.energy, model: state.selectedShipModel, removed: !arrays.enemies.includes(enemy) };
    });

    expect(r.model).toBe('viper');
    expect(r.removed).toBe(true);
    // The energy must have risen from 20 to exactly 25
    expect(r.energy).toBe(25);
  });

  test('Hangar: shows the perk badges of the ships dynamically when switching', async ({ page }) => {
    const perksContainer = page.locator('#hangar-ship-perks');
    await expect(perksContainer).toBeVisible();

    const badges = perksContainer.locator('.hangar-perk-chip');
    const detail = page.locator('#hangar-perk-detail');

    // Expected perks come from the ship config, not from fixed texts/counts
    const getPerks = model =>
      page.evaluate(m => window.__game.shipModels[m].perks.map(p => ({ label: p.label, type: p.type })), model);

    // Checks that the displayed badges match the perks of the model exactly
    const checkBadges = async model => {
      const perks = await getPerks(model);
      expect(perks.length).toBeGreaterThan(0);
      await expect(badges).toHaveCount(perks.length);
      for (let i = 0; i < perks.length; i++) {
        await badges.nth(i).click();
        await expect(detail).toContainText(perks[i].label);
        await expect(badges.nth(i)).toHaveClass(perks[i].type === 'nerf' ? /perk-nerf/ : /perk-buff/);
      }
      return perks.map(p => p.label);
    };

    // 1. Initially with Viper-X
    const viperLabels = await checkBadges('viper');
    expect(viperLabels).toContain('SPLITTER-DROP');

    // 2. Switch to Phantom-NX
    await page.locator('.hangar-model-btn[data-model="phantom"]').click();
    const phantomLabels = await checkBadges('phantom');
    expect(phantomLabels).not.toEqual(viperLabels);
    expect(phantomLabels).not.toContain('SPLITTER-DROP');

    // 3. Switch to Gleve-MR
    await page.locator('.hangar-model-btn[data-model="gleve"]').click();
    const gleveLabels = await checkBadges('gleve');
    expect(gleveLabels).not.toEqual(phantomLabels);

    // 4. Back to Viper-X
    await page.locator('.hangar-model-btn[data-model="viper"]').click();
    expect(await checkBadges('viper')).toEqual(viperLabels);
  });

  test('The playfield scales dynamically with the window size', async ({ page }) => {
    const playfield = page.locator('#spielfeld');
    const container = page.locator('#spielfeld-container');

    await expect(container).toBeAttached();

    // Check the initial transformation
    let transform = await playfield.evaluate(el => el.style.transform);
    expect(transform).toContain('scale');

    // Change the window size drastically
    await page.setViewportSize({ width: 1920, height: 1080 });
    // Wait briefly until the event listener triggers
    await page.waitForTimeout(100);

    let newTransform = await playfield.evaluate(el => el.style.transform);
    expect(newTransform).toContain('scale');
    expect(newTransform).not.toEqual(transform); // The scale factor should have changed
  });
});

test.describe('What is new modal (changelog)', () => {
  test('Shown automatically on a new version and can be closed', async ({ page }) => {
    // Simulate an old release
    await page.addInitScript(() => {
      localStorage.setItem('starshooter_last_seen_version', '1.2.0');
    });
    await page.goto('/');

    const modal = page.locator('#whats-new-overlay');
    await expect(modal).toBeVisible();

    const title = page.locator('#whats-new-title');
    await expect(title).toContainText("WAS GIBT'S NEUES");

    const intro = page.locator('#whats-new-intro');
    // Expected values from the game code, so the test needs no change on a release
    const { version, count } = await page.evaluate(async () => {
      const { GAME_VERSION, changelogData } = await import('./js/changelog.js');
      return {
        version: GAME_VERSION,
        count: changelogData[GAME_VERSION] ? changelogData[GAME_VERSION].highlights.length : 0,
      };
    });
    expect(count).toBeGreaterThan(0); // every release version needs a changelog entry
    await expect(intro).toContainText(version);

    const items = page.locator('#whats-new-list li');
    await expect(items).toHaveCount(count);

    // Close
    const closeBtn = page.locator('#btn-close-whats-new');
    await closeBtn.click();

    await expect(modal).toBeHidden();

    // Check that localStorage was updated
    const storedVersion = await page.evaluate(() => localStorage.getItem('starshooter_last_seen_version'));
    expect(storedVersion).toBe(version);

    // Open again via the start screen button
    const openBtn = page.locator('#btn-open-whats-new');
    await openBtn.click();
    await expect(modal).toBeVisible();
  });
});

test.describe('Mobile UI positioning - phone (Pixel)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  test('Buttons are placed correctly relative to the playfield and do not stick into it awkwardly', async ({
    page,
  }) => {
    // Perform a real tap on the start text
    await page.tap('#start-text');

    // Wait until the controls are there
    await expect(page.locator('#mobile-controls')).toBeVisible();

    const missileBtn = page.locator('#btn-rakete');
    const playfield = page.locator('#spielfeld');

    const missileBox = await missileBtn.boundingBox();
    const fieldBox = await playfield.boundingBox();

    // The distance from the right button edge to the right playfield edge should be small (below 60px)
    const distanceToRightEdge = missileBox.x + missileBox.width - (fieldBox.x + fieldBox.width);
    expect(Math.abs(distanceToRightEdge)).toBeLessThan(60);

    // Check that the button lies in the bottom area / below the playing area
    expect(missileBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height - 50);
  });
});

test.describe('Mobile UI Positionierung - Tablet (iPad)', () => {
  // iPad Pro format / typical tablet landscape/portrait
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 1366 } });

  test('Buttons do not stick to the right screen edge but to the playfield', async ({ page }) => {
    await page.tap('#start-text');

    await expect(page.locator('#mobile-controls')).toBeVisible();

    const missileBtn = page.locator('#btn-rakete');
    const playfield = page.locator('#spielfeld');

    const missileBox = await missileBtn.boundingBox();
    const fieldBox = await playfield.boundingBox();

    const distanceToRightEdge = missileBox.x + missileBox.width - (fieldBox.x + fieldBox.width);
    expect(Math.abs(distanceToRightEdge)).toBeLessThan(60);

    // Check that the button lies in the bottom area / below the playing area
    expect(missileBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height - 50);
  });
});

test.describe('Missile launchers on the ship', () => {
  test('At tier 1 the Viper-X shows only the left launcher, the Phantom-NX only the right launcher', async ({
    page,
  }) => {
    // Start the game with Viper-X (default)
    await startGame(page, 'KeyW');

    const launcherLeft = page.locator('#spieler .werfer-links');
    const launcherRight = page.locator('#spieler .werfer-rechts');
    const launcherCenter = page.locator('#spieler .werfer-center');

    await expect(launcherLeft).toBeVisible();
    await expect(launcherRight).toBeHidden();
    await expect(launcherCenter).toBeHidden();

    // Zu Phantom-NX wechseln
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.selectedShipModel = 'phantom';
      utilsMod.updatePlayerShipVisuals();
    });

    await expect(launcherLeft).toBeHidden();
    await expect(launcherRight).toBeVisible();
    await expect(launcherCenter).toBeHidden();
  });

  test('At tiers 3 and 4 both side launchers appear, at tier 5 the third center launcher', async ({ page }) => {
    await startGame(page, 'KeyW');

    const launcherLeft = page.locator('#spieler .werfer-links');
    const launcherRight = page.locator('#spieler .werfer-rechts');
    const launcherCenter = page.locator('#spieler .werfer-center');

    // Tier 3
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.missileTier = 3;
      utilsMod.updateActivePowerupsUi();
    });

    await expect(launcherLeft).toBeVisible();
    await expect(launcherRight).toBeVisible();
    await expect(launcherCenter).toBeHidden();

    // Tier 4
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.missileTier = 4;
      utilsMod.updateActivePowerupsUi();
    });

    await expect(launcherLeft).toBeVisible();
    await expect(launcherRight).toBeVisible();
    await expect(launcherCenter).toBeHidden();

    // Tier 5
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.missileTier = 5;
      utilsMod.updateActivePowerupsUi();
    });

    await expect(launcherLeft).toBeVisible();
    await expect(launcherRight).toBeVisible();
    await expect(launcherCenter).toBeVisible();
  });

  test('Missiles launch straight ahead directly from the active launchers (Viper left, Phantom right)', async ({
    page,
  }) => {
    await startGame(page, 'KeyW');

    // 1. Viper-X: firing at tier 1 -> the missile launches left of the ship and flies straight (no slanted ejection)
    await page.keyboard.down('KeyK');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyK');

    const missileViper = page.locator('.raketen-projektil').first();
    await expect(missileViper).toBeAttached();

    const viperX = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const r = stateMod.arrays.missileArray[0];
      return { shipX: stateMod.state.x, rocketX: r.x, vx: r.vx };
    });

    // The missile must start left of the hull
    expect(viperX.rocketX).toBeLessThan(viperX.shipX + 5);
    // The missile starts straight forward (vx = 0)
    expect(viperX.vx).toBe(0);

    // 2. Second shot with the Viper -> must STILL start on the left (no longer alternating)
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.arrays.missileArray.forEach(r => r.el.remove());
      stateMod.arrays.missileArray.length = 0;
      stateMod.state.missileCooldown = 0;
    });

    await page.keyboard.down('KeyK');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyK');

    const viperX2 = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const r = stateMod.arrays.missileArray[0];
      return { shipX: stateMod.state.x, rocketX: r.x, vx: r.vx };
    });
    expect(viperX2.rocketX).toBeLessThan(viperX2.shipX + 5);
    expect(viperX2.vx).toBe(0);

    // 3. Phantom-NX: at tier 1 the missile starts right of the ship and straight
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.arrays.missileArray.forEach(r => r.el.remove());
      stateMod.arrays.missileArray.length = 0;
      stateMod.state.missileCooldown = 0;
      stateMod.state.selectedShipModel = 'phantom';
      utilsMod.updatePlayerShipVisuals();
    });

    await page.keyboard.down('KeyK');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyK');

    const phantomX = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const r = stateMod.arrays.missileArray[0];
      return { shipX: stateMod.state.x, rocketX: r.x, vx: r.vx };
    });

    // The missile must start right of the hull
    expect(phantomX.rocketX).toBeGreaterThan(phantomX.shipX + 20);
    expect(phantomX.vx).toBe(0);
  });

  test('On a downgrade the lost launcher detaches with a fling animation', async ({ page }) => {
    await startGame(page, 'KeyW');

    // Set to tier 5
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.missileTier = 5;
      utilsMod.updateActivePowerupsUi();
    });

    // Downgrade from tier 5 to tier 3 (the center launcher is lost)
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.missileTier = 3;
      utilsMod.updateActivePowerupsUi();
    });

    const ejectedPod = page.locator('.werfer-abgeworfen');
    await expect(ejectedPod).toBeAttached();
  });
});

test.describe('Late game difficulty & opponent mechanics', () => {
  test('The opponent fire rate scales with the level, from level 3 on 2-shot bursts', async ({ page }) => {
    await startGame(page, 'KeyW');

    // 1. Check the shot interval at level 1 vs level 5
    const timers = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');

      stateMod.state.level = 1;
      entitiesMod.createEnemy(100, 50, 'normal', 0);
      const f1 = stateMod.arrays.enemies[stateMod.arrays.enemies.length - 1];

      stateMod.state.level = 5;
      entitiesMod.createEnemy(200, 50, 'normal', 0);
      const f5 = stateMod.arrays.enemies[stateMod.arrays.enemies.length - 1];

      return { f1Timer: f1.shotTimer, f5Timer: f5.shotTimer };
    });

    expect(timers.f5Timer).toBeLessThan(timers.f1Timer);

    // 2. Check 2-shot bursts at level 3+
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      stateMod.arrays.enemies.forEach(f => f.el.remove());
      stateMod.arrays.enemies.length = 0;
      stateMod.arrays.enemyLaserArray.forEach(l => l.el.remove());
      stateMod.arrays.enemyLaserArray.length = 0;

      stateMod.state.level = 3;
      entitiesMod.createEnemy(150, 50, 'normal', 0);
      const f = stateMod.arrays.enemies[0];
      f.forceBurst = true;
      f.shotTimer = 1; // Unmittelbar feuern
    });

    // After a short wait the burst should have fired 2 enemy lasers
    await page.waitForTimeout(250);
    const laserCount = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.enemyLaserArray.length;
    });

    expect(laserCount).toBeGreaterThanOrEqual(2);
  });

  test('Shield opponents have a protective energy shield from level 3 on that must be destroyed first', async ({
    page,
  }) => {
    await startGame(page, 'KeyW');

    // Spawn an enemy with a shield
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      stateMod.arrays.enemies.forEach(f => f.el.remove());
      stateMod.arrays.enemies.length = 0;

      stateMod.state.level = 4;
      // Spawn with forceShield = true and pattern crossfire
      entitiesMod.createEnemy(185, 100, 'crossfire', 0, true);
      const f = stateMod.arrays.enemies[0];
      f.vy = 0; // Stationary for a precise hit test
      f.hp = 50;
      f.maxHp = 50;
    });

    const shieldEl = page.locator('.feind-schiff .feind-schild');
    await expect(shieldEl).toBeVisible();

    // Laserschuss abfeuern
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.x = 185;
      stateMod.state.y = 250;
      stateMod.state.energy = 50;
      stateMod.state.laserTier = 2;
      stateMod.state.playerShotCooldown = 0;
    });

    await page.keyboard.down('KeyL');
    await page.waitForTimeout(80);
    await page.keyboard.up('KeyL');

    // Wait until the laser projectiles have reached and hit the target at y=100
    await page.waitForTimeout(300);

    // The shield should be destroyed, but the enemy still alive
    const enemyStatus = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const f = stateMod.arrays.enemies[0];
      return f ? { alive: true, shieldHp: f.shieldHp, hp: f.hp } : { alive: false };
    });

    expect(enemyStatus.alive).toBe(true);
    expect(enemyStatus.shieldHp).toBeLessThanOrEqual(0);
    expect(enemyStatus.hp).toBeGreaterThan(0);
    await expect(shieldEl).toBeHidden();
  });

  test('The boss can drop a destructible boss bomb that can be shot down before the detonation', async ({ page }) => {
    await startGame(page, 'KeyW');

    // Setup and fixed simulation steps in one synchronous block (no real-time waiting).
    // The player holds the laser until the bomb is gone. The bomb has more HP than one
    // shot deals and its timer (180) only expires after clearly more steps.
    const r = await page.evaluate(() => {
      const { state, arrays, config, Entities, Loop } = window.__game;

      for (const list of Object.values(arrays)) {
        for (const e of list) if (e && e.el && e.el.remove) e.el.remove();
        list.length = 0;
      }
      document.querySelectorAll('.boss-shockwave').forEach(el => el.remove());

      state.frameCounter = 1; // no spawns
      state.unlimitedEnergy = true;
      state.energy = state.maxEnergy;
      state.laserTier = 2;
      state.playerShotCooldown = 0;
      state.x = 185;
      state.y = 400;
      state.keysPressed.l = true;

      Entities.createBossBomb(185, 100);
      const bomb = arrays.bossBombArray[0];
      const startHp = bomb.hp;
      const timerStart = bomb.timer;
      const livesBeforehand = state.lives;
      const scoreBeforehand = state.score;

      const hpHistory = new Set();
      let steps = 0;
      let shockwaves = 0;
      while (arrays.bossBombArray.includes(bomb) && steps < 150) {
        Loop.simulationStep();
        steps++;
        hpHistory.add(bomb.hp);
        shockwaves += document.querySelectorAll('.boss-shockwave').length;
      }
      state.keysPressed.l = false;

      return {
        startHp,
        timerStart,
        steps,
        hpTiers: hpHistory.size,
        timerRest: bomb.timer,
        bombStillThere: arrays.bossBombArray.includes(bomb),
        scoreDiff: state.score - scoreBeforehand,
        livesDiff: state.lives - livesBeforehand,
        shockwaves,
        bombY: bomb.y,
        maxY: config.playfieldHeight - 60,
      };
    });

    // The bomb was shot down (not detonated, not expired)
    expect(r.bombStillThere).toBe(false);
    expect(r.steps).toBeLessThan(r.timerStart);
    expect(r.timerRest).toBeGreaterThan(0);
    expect(r.bombY).toBeLessThan(r.maxY);
    // Several hits needed: HP dropped step by step
    expect(r.hpTiers).toBeGreaterThan(2);
    // Kill reward instead of detonation
    expect(r.scoreDiff).toBe(150);
    expect(r.shockwaves).toBe(0);
    expect(r.livesDiff).toBe(0);
  });

  test('The boss fires homing missiles starting from the side that the player can shoot down in flight', async ({
    page,
  }) => {
    await startGame(page, 'KeyW');

    // 1. Release a boss missile to the side
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');

      if (stateMod.arrays.bossMissileArray) {
        stateMod.arrays.bossMissileArray.forEach(r => r.el.remove());
        stateMod.arrays.bossMissileArray.length = 0;
      }

      stateMod.state.x = 200;
      stateMod.state.y = 350;

      // Release a boss missile on the left (dir = -1)
      entitiesMod.createBossMissile(150, 100, -1);
    });

    const missileEl = page.locator('.boss-rakete');
    await expect(missileEl).toBeVisible();

    // 2. Check the initial velocity: starting to the left (vx < 0)
    const initialVx = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.bossMissileArray[0].vx;
    });
    expect(initialVx).toBeLessThan(0);

    // 3. After a short time the missile should turn towards the player (homing)
    await page.waitForTimeout(200);
    const trackingInfo = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const r = stateMod.arrays.bossMissileArray[0];
      return r ? { x: r.x, y: r.y, vy: r.vy } : null;
    });
    expect(trackingInfo).not.toBeNull();
    expect(trackingInfo.vy).toBeGreaterThan(0); // Flies down towards the player

    // 4. Test destructibility by a player shot
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const r = stateMod.arrays.bossMissileArray[0];
      // Position the player directly in front of the flight path
      stateMod.state.x = r.x - 10;
      stateMod.state.y = r.y + 120;
      stateMod.state.energy = 50;
      stateMod.state.laserTier = 2;
      stateMod.state.playerShotCooldown = 0;
    });

    await page.keyboard.down('KeyL');
    await page.waitForTimeout(100);
    await page.keyboard.up('KeyL');

    await page.waitForTimeout(250);

    // The boss missile should have been shot down
    await expect(missileEl).toBeHidden();
    const remainingCount = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.bossMissileArray.length;
    });
    expect(remainingCount).toBe(0);
  });

  test('Invulnerability after a hit ignores follow-up hits and ends after about 0.75 s', async ({ page }) => {
    await startGame(page, 'KeyW');

    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const { playerHit } = window.__game.Utils;
      const { simulationStep } = window.__game.Loop;
      const hit = () => playerHit({ x: 0, y: 0, el: document.createElement('div') }, false);
      const empty = () => {
        for (const k of ['enemies', 'bosses', 'powerups', 'enemyShots', 'asteroids']) {
          if (arrays[k]) arrays[k].length = 0;
        }
      };

      state.godMode = false;
      state.isDead = false;
      state.invulnerableTimer = 0;
      state.shieldTier = 0;
      state.lives = 5;

      hit();
      const afterFirst = state.lives;
      hit(); // within the window: ignored
      const afterSecond = state.lives;

      // Measure the window
      let steps = 0;
      while (state.invulnerableTimer > 0 && steps < 500) {
        empty();
        state.frameCounter = 1;
        simulationStep();
        steps++;
      }

      hit(); // after expiry: takes effect again
      return { afterFirst, afterSecond, steps, afterThird: state.lives };
    });

    expect(r.afterFirst).toBe(4);
    expect(r.afterSecond).toBe(r.afterFirst);
    expect(r.steps).toBeGreaterThan(30);
    expect(r.steps).toBeLessThan(60);
    expect(r.afterThird).toBe(r.afterFirst - 1);
  });
  test('Sound mute toggle: key M and the sound button toggle the sound and sync with localStorage', async ({
    page,
  }) => {
    const soundBtn = page.locator('#btn-sound-toggle');
    await expect(soundBtn).toBeVisible();
    await expect(soundBtn).toHaveText('🔊');

    // Clicking the button mutes the sound
    await soundBtn.click();
    await expect(soundBtn).toHaveText('🔇');

    let isMutedInStorage = await page.evaluate(() => localStorage.getItem('starshooter_muted'));
    expect(isMutedInStorage).toBe('true');

    // Pressing key 'M' unmutes the sound again
    await page.keyboard.press('KeyM');
    await expect(soundBtn).toHaveText('🔊');

    isMutedInStorage = await page.evaluate(() => localStorage.getItem('starshooter_muted'));
    expect(isMutedInStorage).toBe('false');
  });

  test('Sound trigger: laser and autolaser shots trigger playLaser and playAutolaser', async ({ page }) => {
    await startGame(page, 'KeyW');

    // Set laser tier 3 and energy, clear the history
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.laserTier = 3;
      stateMod.state.energy = 50;
      stateMod.state.laserShoots = false;
      stateMod.state.playerShotCooldown = 0;
    });

    // Laser abfeuern
    await page.keyboard.down('KeyL');
    await page.waitForTimeout(100);
    await page.keyboard.up('KeyL');

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });

    const laserEvents = history.filter(h => h.name === 'laser');
    expect(laserEvents.length).toBeGreaterThan(0);
    expect(laserEvents[0].details.level).toBe(3);

    // Activate the autolaser and test with a target (clean up previous lasers)
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      stateMod.arrays.laserArray.forEach(l => l.el.remove());
      stateMod.arrays.laserArray.length = 0;
      stateMod.state.gameRunning = true;
      stateMod.state.paused = false;
      stateMod.state.laserShoots = false;
      stateMod.state.keysPressed.l = false;
      stateMod.state.y = 400; // Position the player further down
      stateMod.state.autolaserActive = true;
      stateMod.state.autolaserTimer = 100;
      entitiesMod.createAsteroid(185, 100, 30, 0, 0, 0, true);
    });

    await page.waitForTimeout(400);

    const historyAfter = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });

    const autolaserEvents = historyAfter.filter(h => h.name === 'autolaser');
    expect(autolaserEvents.length).toBeGreaterThan(0);
  });

  test('Sound trigger: missile and bomb drops trigger playMissile and playBomb', async ({ page }) => {
    await startGame(page, 'KeyW');

    // Fire missiles
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.missileCooldown = 0;
      stateMod.state.missileTier = 2;
    });

    await page.keyboard.down('KeyK');
    await page.waitForTimeout(100);
    await page.keyboard.up('KeyK');

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const missileEvents = history.filter(h => h.name === 'missile');
    expect(missileEvents.length).toBeGreaterThan(0);

    // Drop a bomb
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.bombCooldown = 0;
      stateMod.state.bombTier = 1;
    });

    await page.keyboard.down('Space');
    await page.waitForTimeout(100);
    await page.keyboard.up('Space');

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const bombEvents = history.filter(h => h.name === 'bomb');
    expect(bombEvents.length).toBeGreaterThan(0);
  });

  test('Sound trigger: destruction, hits and magma bouncers trigger playExplosion and playHit', async ({ page }) => {
    await startGame(page, 'KeyW');

    // 1. Test target destruction
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const utilsMod = await import('./js/utils.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();

      const dummyTarget = {
        x: 100,
        y: 100,
        size: 30,
        maxHp: 30,
        hp: 0,
        el: document.createElement('div'),
        isBoss: false,
        isEnemy: true,
      };
      stateMod.arrays.enemies.push(dummyTarget);
      utilsMod.destroyTarget(dummyTarget);
    });

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const explosionEvents = history.filter(h => h.name === 'explosion');
    expect(explosionEvents.length).toBeGreaterThan(0);

    // 2. Test a player hit
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const utilsMod = await import('./js/utils.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.invulnerableTimer = 0;
      stateMod.state.godMode = false;
      const dummyLaser = { x: 185, y: 285, width: 4, height: 10, el: document.createElement('div') };
      utilsMod.playerHit(dummyLaser, false);
    });

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const hitEvents = history.filter(h => h.name === 'hit' && h.details.type === 'player');
    expect(hitEvents.length).toBeGreaterThan(0);
  });

  test('Sound trigger: powerup pickup and shield regeneration trigger playPowerup and playShieldRegen', async ({
    page,
  }) => {
    await startGame(page, 'KeyW');

    // 1. Test the powerup pickup
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      stateMod.state.gameRunning = true;
      stateMod.state.x = 185;
      stateMod.state.y = 285;
      // Spawn a powerup directly on the player ship
      entitiesMod.createPowerup(185, 285, 'laserWeapon');
    });

    await page.waitForTimeout(100);

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const powerupEvents = history.filter(h => h.name === 'powerup');
    expect(powerupEvents.length).toBeGreaterThan(0);

    // 2. Test the Phantom-NX shield regeneration
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.selectedShipModel = 'phantom';
      stateMod.state.shieldTier = 0;
      stateMod.state.phantomShieldRegenTimer = (stateMod.state.phantomShieldRegenMax || 900) - 2;
    });

    await page.waitForTimeout(100);

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const shieldEvents = history.filter(h => h.name === 'shieldRegen');
    expect(shieldEvents.length).toBeGreaterThan(0);
  });

  test('Sound trigger: boss warning and game over trigger playBossAlert and playGameOver', async ({ page }) => {
    await startGame(page, 'KeyW');

    // 1. Boss Warning Alert Sound testen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.bossActive = false;
      stateMod.state.bossWarningActive = false;
      stateMod.state.frameCounter = 3599; // Frame before the boss warning trigger
    });

    await page.waitForTimeout(100);

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const bossAlertEvents = history.filter(h => h.name === 'bossAlert');
    expect(bossAlertEvents.length).toBeGreaterThan(0);

    // 2. Game Over Sound testen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const utilsMod = await import('./js/utils.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.lives = 1;
      stateMod.state.shieldTier = 0;
      stateMod.state.invulnerableTimer = 0;
      stateMod.state.godMode = false;
      const dummyLaser = { x: 185, y: 285, width: 4, height: 10, el: document.createElement('div') };
      utilsMod.playerHit(dummyLaser, false);
    });

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const gameOverEvents = history.filter(h => h.name === 'gameOver');
    expect(gameOverEvents.length).toBeGreaterThan(0);
  });

  test('Sound trigger: opponent and boss lasers trigger playEnemyLaser and playBossLaser', async ({ page }) => {
    await startGame(page, 'KeyW');

    // 1. Fire an enemy laser
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      entitiesMod.createEnemyLaser(100, 100);
    });

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const enemyLaserEvents = history.filter(h => h.name === 'enemyLaser');
    expect(enemyLaserEvents.length).toBeGreaterThan(0);

    // 2. Boss-Laser feuern
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      entitiesMod.createBossLaser(150, 50, 0, 6);
    });

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const bossLaserEvents = history.filter(h => h.name === 'bossLaser');
    expect(bossLaserEvents.length).toBeGreaterThan(0);
  });

  test('Sound trigger: boss bombs and boss missiles trigger playBossBombLaunch and playBossRocketLaunch', async ({
    page,
  }) => {
    await startGame(page, 'KeyW');

    // 1. Spawn a boss bomb
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      entitiesMod.createBossBomb(180, 100);
    });

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const bombLaunchEvents = history.filter(h => h.name === 'bossBombLaunch');
    expect(bombLaunchEvents.length).toBeGreaterThan(0);

    // 2. Spawn a boss missile
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      entitiesMod.createBossMissile(150, 100, 1);
    });

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const rocketLaunchEvents = history.filter(h => h.name === 'bossRocketLaunch');
    expect(rocketLaunchEvents.length).toBeGreaterThan(0);
  });

  test('Sound synthesizer: playMissile creates a realistic New Year rocket hiss with a noise filter', async ({
    page,
  }) => {
    await startGame(page, 'KeyW');

    const result = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      audioMod.clearAudioHistory();
      audioMod.initAudio();

      // Observe the factory methods of the AudioContext to collect the created nodes
      const proto = (window.BaseAudioContext || window.AudioContext).prototype;
      const filters = [];
      const sources = [];
      const origFilter = proto.createBiquadFilter;
      const origSource = proto.createBufferSource;
      proto.createBiquadFilter = function (...args) {
        const node = origFilter.apply(this, args);
        filters.push(node);
        return node;
      };
      proto.createBufferSource = function (...args) {
        const node = origSource.apply(this, args);
        sources.push(node);
        return node;
      };

      // Call playMissile directly and check that no exception is thrown
      let threwError = false;
      try {
        audioMod.playMissile();
      } catch (err) {
        threwError = true;
      } finally {
        proto.createBiquadFilter = origFilter;
        proto.createBufferSource = origSource;
      }

      return {
        threwError,
        history: audioMod.audioHistory,
        hasNoiseBuffer: !!audioMod.getNoiseBuffer(audioMod.getAudioContext()),
        filterTypes: filters.map(f => f.type),
        loopingNoiseSources: sources.filter(s => s.buffer != null && s.loop === true).length,
      };
    });

    expect(result.threwError).toBe(false);
    expect(result.hasNoiseBuffer).toBe(true);
    // Noise hiss: a bandpass filter and a looped BufferSource with a noise buffer were created
    expect(result.filterTypes).toContain('bandpass');
    expect(result.loopingNoiseSources).toBeGreaterThanOrEqual(1);
    const missileEvent = result.history.find(h => h.name === 'missile');
    expect(missileEvent).toBeDefined();
  });

  test('Sound trigger: a missile detonation triggers playMissileExplosion', async ({ page }) => {
    await startGame(page, 'KeyW');

    // Everything in one synchronous block after the imports: the real game loop does not run in between
    const history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');
      audioMod.clearAudioHistory();
      stateMod.state.gameRunning = true;
      // Ship out of the way: otherwise, depending on the start time, it rams the enemy before the missile ignites
      stateMod.state.x = 0;
      stateMod.state.y = stateMod.config.playfieldHeight - 60;

      const rEl = document.createElement('div');
      rEl.classList.add('rakete');
      document.getElementById('spielfeld').appendChild(rEl);

      // The missile flies upwards (r.y -= r.vy) towards the enemy directly above it
      stateMod.arrays.missileArray.push({
        el: rEl,
        x: 200,
        y: 200,
        vx: 0,
        vy: 8,
        tier: 1,
        radius: 60,
        damage: 50,
        isHoming: false,
      });
      entitiesMod.createEnemy(200, 180, 'normal', 0, false);

      // Fixed simulation steps instead of a real-time wait
      for (let i = 0; i < 6; i++) simulationStep();
      return audioMod.audioHistory;
    });
    const missileExpEvents = history.filter(h => h.name === 'missileExplosion');
    expect(missileExpEvents.length).toBeGreaterThan(0);
  });

  test('Sound trigger: flying bombs (player & boss) create an accelerating beep (playBombBeep)', async ({ page }) => {
    await startGame(page, 'KeyW');

    // 1. Spawn a boss bomb and let it fly
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      stateMod.state.gameRunning = true;
      entitiesMod.createBossBomb(200, 100);
    });

    await page.waitForTimeout(200);

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const bombBeepEvents = history.filter(h => h.name === 'bombBeep');
    expect(bombBeepEvents.length).toBeGreaterThan(0);
  });

  test('Sound trigger: boss missiles periodically create engine noises in flight (playBossRocketFlight)', async ({
    page,
  }) => {
    await startGame(page, 'KeyW');

    // Spawn a boss missile and let it fly
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      stateMod.state.gameRunning = true;
      entitiesMod.createBossMissile(150, 100, 1);
    });

    await page.waitForTimeout(200);

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const rocketFlightEvents = history.filter(h => h.name === 'bossRocketFlight');
    expect(rocketFlightEvents.length).toBeGreaterThan(0);
  });
});

test.describe('Story intro cutscene', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('starshooter_skip_cutscene');
    });
    await page.goto('/');
  });

  test('Starts after the ship selection and shows a convoy with all ship types', async ({ page }) => {
    // Set the ship model to Phantom-NX and the color to blue
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();
    const blueBtn = page.locator('.hangar-color-btn[data-color="blue"]');
    await blueBtn.click();

    // Start via key press
    await startGame(page);

    // The start screen is gone
    const startScreen = page.locator('#start-screen');
    await expect(startScreen).toBeHidden();

    // The in-game player ship is hidden during the cutscene
    const inGamePlayer = page.locator('#spieler');
    await expect(inGamePlayer).toBeHidden();

    // The cutscene container is visible
    const cutsceneContainer = page.locator('#cutscene-container');
    await expect(cutsceneContainer).toBeVisible();

    // The skip button (ESC) is present
    const skipBtn = page.locator('#cutscene-skip-btn');
    await expect(skipBtn).toBeVisible();
    await expect(skipBtn).toContainText('ESC');

    // Check that all convoy ships are present
    const playerConvoyShip = page.locator('.cutscene-ship.ship-player');
    await expect(playerConvoyShip).toBeAttached();
    // Check that the player ship reflects the chosen model (Phantom) & color (blue)
    const playerSvg = playerConvoyShip.locator('svg');
    await expect(playerSvg).toBeAttached();
    const svgHtml = await playerSvg.innerHTML();
    expect(svgHtml).toContain('#3498db'); // Blue color

    const freighter = page.locator('.cutscene-ship.ship-freighter');
    await expect(freighter).toBeAttached();

    const hospitalShip = page.locator('.cutscene-ship.ship-hospital');
    await expect(hospitalShip).toBeAttached();

    const destroyer = page.locator('.cutscene-ship.ship-destroyer');
    await expect(destroyer).toBeAttached();

    const escorts = page.locator('.cutscene-ship.ship-escort');
    await expect(escorts).toHaveCount(2);

    // Check that the ships fly (animation / movement from left to right)
    const initialX = await playerConvoyShip.evaluate(el =>
      parseFloat(el.style.left || window.getComputedStyle(el).left),
    );
    await page.waitForTimeout(300);
    const newX = await playerConvoyShip.evaluate(el => parseFloat(el.style.left || window.getComputedStyle(el).left));
    expect(newX).toBeGreaterThan(initialX);
  });

  // Starts the cutscene with the fake clock paused: hold the key until a (fast-forwarded) frame processes it
  async function startCutsceneWithClock(page) {
    await installClock(page);
    await page.goto('/');
    await page.waitForFunction(() => window.__game && window.__game.state);
    await pauseClock(page);
    await page.keyboard.down('w');
    await windUntil(page, () => page.evaluate(() => window.__game.state.cutsceneActive), 1000, 50);
    await page.keyboard.up('w');
  }

  test('Alien speech bubbles appear with unreadable glyphs in the foreground and trigger audio', async ({ page }) => {
    await startCutsceneWithClock(page);

    // Wait for the first alien speech bubble (page time, ~2.2 s)
    const bubble = page.locator('.alien-speech-bubble');
    await windUntil(page, () => bubble.first().isVisible(), 4000);
    await expect(bubble.first()).toBeVisible();

    // Check that unreadable glyphs are contained
    const alienText = page.locator('.alien-speech-bubble .alien-text');
    await expect(alienText.first()).toBeVisible();
    const textContent = await alienText.first().textContent();
    expect(textContent.length).toBeGreaterThan(5);

    // Check the audio history
    const hasAlienChatter = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory.some(h => h.name === 'alienChatter');
    });
    expect(hasAlienChatter).toBe(true);
  });

  // Formerly two tests with the same precondition and the same flow (attack, then light beam) with
  // ~28 s of real time together. Now one cutscene with a fake clock; the time windows apply in page time from the start.
  test('A surprise attack destroys all escort ships except the player ship, then a light beam and a seamless transition into the game', async ({
    page,
  }) => {
    await startCutsceneWithClock(page);

    const destroyer = page.locator('.cutscene-ship.ship-destroyer');
    const freighter = page.locator('.cutscene-ship.ship-freighter');
    const hospitalShip = page.locator('.cutscene-ship.ship-hospital');
    const escorts = page.locator('.cutscene-ship.ship-escort');
    const playerShip = page.locator('.cutscene-ship.ship-player');

    // --- Surprise attack ---
    // During the destruction phase fireballs appear (live 600 ms, step size 250 ms)
    const fireball = page.locator('.cutscene-fireball');
    let time = await windUntil(page, async () => (await fireball.count()) > 0, 11000);
    await expect(fireball.first()).toBeAttached();

    // After the destruction phase is complete (until 14 s) all escort ships are gone
    time += await windUntil(
      page,
      async () =>
        (await destroyer.isHidden()) &&
        (await freighter.isHidden()) &&
        (await hospitalShip.isHidden()) &&
        (await escorts.count()) === 0,
      14000 - time,
    );
    await expect(destroyer).toBeHidden();
    await expect(freighter).toBeHidden();
    await expect(hospitalShip).toBeHidden();
    await expect(escorts).toHaveCount(0);

    // The player ship is still present
    await expect(playerShip).toBeAttached();

    const history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    expect(history.some(h => h.name === 'incomingArtillery')).toBe(true);
    expect(history.some(h => h.name === 'explosion')).toBe(true);

    // --- Light beam and transition into the game ---
    // The light beam appears (~12.2 s, at the latest 14.5 s)
    const lightBeam = page.locator('#cutscene-light-beam.cutscene-beam-active');
    time += await windUntil(page, () => lightBeam.isVisible(), 14500 - time);
    await expect(lightBeam).toBeVisible();

    // End of the cutscene and transition into the game (~14.4 s, at the latest 17.5 s)
    const cutsceneContainer = page.locator('#cutscene-container');
    await windUntil(page, () => cutsceneContainer.isHidden(), 17500 - time);
    await expect(cutsceneContainer).toBeHidden();

    // The game is now active (gameRunning = true, cutsceneActive = false)
    const gameState = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return {
        gameRunning: stateMod.state.gameRunning,
        cutsceneActive: stateMod.state.cutsceneActive,
      };
    });
    expect(gameState.gameRunning).toBe(true);
    expect(gameState.cutsceneActive).toBe(false);

    // The in-game player ship is now visible
    await expect(page.locator('#spieler')).toBeVisible();

    const hasLightWhoosh = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory.some(h => h.name === 'lightBeamWhoosh');
    });
    expect(hasLightWhoosh).toBe(true);
  });

  test('The cutscene can be skipped at any time via the ESC key or the skip button', async ({ page }) => {
    // 1. Test via the ESC key
    await startGame(page);

    const cutsceneContainer = page.locator('#cutscene-container');
    await expect(cutsceneContainer).toBeVisible();

    // Press ESC
    await page.keyboard.press('Escape');

    // The container disappeared immediately and the game started
    await expect(cutsceneContainer).toBeHidden();
    let isRunning = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.state.gameRunning && !stateMod.state.cutsceneActive;
    });
    expect(isRunning).toBe(true);

    // 2. Restart & test via the skip button
    await page.evaluate(async () => {
      const utilsMod = await import('./js/utils.js');
      utilsMod.restartGame();
    });

    const startScreen = page.locator('#start-screen');
    await expect(startScreen).toBeVisible();

    // Start the cutscene again
    await startGame(page);

    await expect(cutsceneContainer).toBeVisible();

    // Click the skip button
    const skipBtn = page.locator('#cutscene-skip-btn');
    await skipBtn.click();

    // The container disappeared immediately and the game started
    await expect(cutsceneContainer).toBeHidden();
    isRunning = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.state.gameRunning && !stateMod.state.cutsceneActive;
    });
    expect(isRunning).toBe(true);
  });

  test('Restart after a boss fight removes all boss missiles, boss bombs and artifacts completely', async ({
    page,
  }) => {
    // Start the game and create a boss missile & boss bomb artificially
    await startGame(page);

    await page.evaluate(async () => {
      const entitiesMod = await import('./js/entities.js');
      const stateMod = await import('./js/state.js');
      stateMod.state.gameRunning = true;
      // Create a boss missile and a boss bomb
      entitiesMod.createBossMissile(150, 200, 1);
      entitiesMod.createBossBomb(200, 250);
    });

    // Check that the elements exist in the DOM
    const bossMissile = page.locator('.boss-rakete');
    const bossBomb = page.locator('.boss-bombe');
    await expect(bossMissile).toHaveCount(1);
    await expect(bossBomb).toHaveCount(1);

    // Now perform a restart (as on game over or a click on restart)
    await page.evaluate(async () => {
      const utilsMod = await import('./js/utils.js');
      utilsMod.restartGame();
    });

    // Check that all boss missiles, boss bombs and arrays are cleared completely
    await expect(bossMissile).toHaveCount(0);
    await expect(bossBomb).toHaveCount(0);

    const arrayLengths = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return {
        bossMissiles: stateMod.arrays.bossMissileArray.length,
        bossBombs: stateMod.arrays.bossBombArray.length,
      };
    });
    expect(arrayLengths.bossMissiles).toBe(0);
    expect(arrayLengths.bossBombs).toBe(0);
  });
});

test.describe('Two-player mode (co-op)', () => {
  test('The mode choice on the start screen switches between 1 player (400px) and 2-player co-op (600px)', async ({
    page,
  }) => {
    const btnSingle = page.locator('#gamemode-btn-single');
    const btnCoop = page.locator('#gamemode-btn-coop');

    // Both buttons visible on the start screen
    await expect(btnSingle).toBeVisible();
    await expect(btnCoop).toBeVisible();
    await expect(btnSingle).toHaveClass(/active/);
    await expect(btnCoop).not.toHaveClass(/active/);

    // Solo by default: 400px
    let modeInfo = await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');
      return { gameMode: state.gameMode, width: config.playfieldWidth };
    });
    expect(modeInfo.gameMode).toBe('single');
    expect(modeInfo.width).toBe(400);

    // Click on 2-player co-op mode
    await btnCoop.click();

    await expect(btnCoop).toHaveClass(/active/);
    await expect(btnSingle).not.toHaveClass(/active/);

    modeInfo = await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');
      return { gameMode: state.gameMode, width: config.playfieldWidth };
    });
    expect(modeInfo.gameMode).toBe('coop');
    // In the menu the width stays fixed (no jump on a mode switch)
    expect(modeInfo.width).toBe(400);
    expect(await page.evaluate(() => document.getElementById('spielfeld').style.width)).toBe('400px');

    // Only after game start does the co-op width of 600 px apply
    await startGame(page);
    await page.waitForFunction(() => window.__game.state.gameRunning);
    modeInfo = await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');
      return { gameMode: state.gameMode, width: config.playfieldWidth };
    });
    expect(modeInfo.width).toBe(600);
    const styleWidth = await page.evaluate(() => document.getElementById('spielfeld').style.width);
    expect(styleWidth).toBe('600px');

    // Back to the main menu: menu width again
    await page.evaluate(() => window.__game.Utils.restartGame());
    await expect(btnSingle).toBeVisible();

    // Back to 1 player
    await btnSingle.click();
    await expect(btnSingle).toHaveClass(/active/);
    modeInfo = await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');
      return { gameMode: state.gameMode, width: config.playfieldWidth };
    });
    expect(modeInfo.gameMode).toBe('single');
    expect(modeInfo.width).toBe(400);
  });

  test('Hangar: separate ship and color choice for player 1 and player 2', async ({ page }) => {
    const btnCoop = page.locator('#gamemode-btn-coop');
    await btnCoop.click();

    const tabP1 = page.locator('.hangar-player-tab[data-player="p1"]');
    const tabP2 = page.locator('.hangar-player-tab[data-player="p2"]');
    await expect(tabP1).toBeVisible();
    await expect(tabP2).toBeVisible();

    // Choose player 1: Viper-X, yellow
    await tabP1.click();
    await expect(tabP1).toHaveClass(/active/);
    await page.locator('.hangar-model-btn[data-model="viper"]').click();
    await page.locator('.hangar-color-btn[data-color="yellow"]').click();

    // Choose player 2: Phantom-NX, green
    await tabP2.click();
    await expect(tabP2).toHaveClass(/active/);
    await expect(tabP1).not.toHaveClass(/active/);
    await page.locator('.hangar-model-btn[data-model="phantom"]').click();
    await page.locator('.hangar-color-btn[data-color="green"]').click();

    // Check the state
    const shipsState = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p1Model: state.selectedShipModel,
        p1Color: state.selectedShipColor,
        p2Model: state.p2.selectedShipModel,
        p2Color: state.p2.selectedShipColor,
      };
    });
    expect(shipsState.p1Model).toBe('viper');
    expect(shipsState.p1Color).toBe('yellow');
    expect(shipsState.p2Model).toBe('phantom');
    expect(shipsState.p2Color).toBe('green');

    // Click tab P1 again: the buttons must show Viper & yellow as active
    await tabP1.click();
    await expect(page.locator('.hangar-model-btn[data-model="viper"]')).toHaveClass(/active/);
    await expect(page.locator('.hangar-color-btn[data-color="yellow"]')).toHaveClass(/active/);

    // Click tab P2 again: the buttons must show Phantom & green as active
    await tabP2.click();
    await expect(page.locator('.hangar-model-btn[data-model="phantom"]')).toHaveClass(/active/);
    await expect(page.locator('.hangar-color-btn[data-color="green"]')).toHaveClass(/active/);
  });

  test('Keyboard controls in two-player mode: player 1 moves with WASD, player 2 with the arrow keys, independently', async ({
    page,
  }) => {
    // Activate two-player mode and start the game
    await page.locator('#gamemode-btn-coop').click();

    // Start the game (by key press)
    await startGame(page);

    const player1 = page.locator('#spieler');
    const player2 = page.locator('#spieler-2');
    await expect(player1).toBeVisible();
    await expect(player2).toBeVisible();

    const startPos = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p1X: state.x,
        p1Y: state.y,
        p2X: state.p2.x,
        p2Y: state.p2.y,
      };
    });

    // 1. Player 1 moves to the right (key 'd')
    await page.keyboard.down('d');
    await page.waitForTimeout(100);
    await page.keyboard.up('d');

    const posAfterP1Move = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p1X: state.x,
        p1Y: state.y,
        p2X: state.p2.x,
        p2Y: state.p2.y,
      };
    });

    expect(posAfterP1Move.p1X).toBeGreaterThan(startPos.p1X);
    expect(posAfterP1Move.p2X).toBe(startPos.p2X); // P2 did not move

    // 2. Player 2 moves to the left (key 'ArrowLeft')
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(100);
    await page.keyboard.up('ArrowLeft');

    const posAfterP2Move = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p1X: state.x,
        p1Y: state.y,
        p2X: state.p2.x,
        p2Y: state.p2.y,
      };
    });

    expect(posAfterP2Move.p2X).toBeLessThan(posAfterP1Move.p2X);
    expect(posAfterP2Move.p1X).toBe(posAfterP1Move.p1X); // P1 did not move
  });

  test('Weapon systems in two-player mode: P1 fires with B/V/C, P2 with Ä/Ö/L with separate cooldowns and energy bars', async ({
    page,
  }) => {
    // Activate two-player mode and start the game
    await page.locator('#gamemode-btn-coop').click();

    await startGame(page);

    // 1. LASER TEST: P1 fires with 'b', P2 with 'ä'
    await page.keyboard.down('b');
    await page.waitForTimeout(100);
    await page.keyboard.up('b');

    let weaponState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1Energy: state.energy,
        p2Energy: state.p2.energy,
        laserCount: arrays.laserArray.length,
        p1Lasers: arrays.laserArray.filter(l => l.owner === 'p1').length,
        p2Lasers: arrays.laserArray.filter(l => l.owner === 'p2').length,
      };
    });

    expect(weaponState.p1Energy).toBeLessThan(50);
    expect(weaponState.p2Energy).toBe(50);
    expect(weaponState.p1Lasers).toBeGreaterThan(0);
    expect(weaponState.p2Lasers).toBe(0);

    // P2 fires with 'ä' (quote key)
    await page.keyboard.down('Quote');
    await page.waitForTimeout(100);
    await page.keyboard.up('Quote');

    weaponState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1Energy: state.energy,
        p2Energy: state.p2.energy,
        p2Lasers: arrays.laserArray.filter(l => l.owner === 'p2').length,
      };
    });

    expect(weaponState.p2Energy).toBeLessThan(50);
    expect(weaponState.p2Lasers).toBeGreaterThan(0);

    // 2. MISSILE TEST: P1 fires with 'v', P2 with 'ö' (semicolon key)
    await page.keyboard.down('v');
    await page.waitForTimeout(50);
    await page.keyboard.up('v');

    weaponState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1MissileCd: state.missileCooldown,
        p2MissileCd: state.p2.missileCooldown,
        missileCount: arrays.missileArray.length,
      };
    });

    expect(weaponState.p1MissileCd).toBeGreaterThan(0);
    expect(weaponState.p2MissileCd).toBe(0);
    expect(weaponState.missileCount).toBeGreaterThan(0);

    // P2 fires a missile with 'ö' (semicolon)
    await page.keyboard.down('Semicolon');
    await page.waitForTimeout(50);
    await page.keyboard.up('Semicolon');

    weaponState = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p2MissileCd: state.p2.missileCooldown,
      };
    });
    expect(weaponState.p2MissileCd).toBeGreaterThan(0);

    // 3. BOMB TEST: P1 drops with 'c', P2 with 'l'
    await page.keyboard.down('c');
    await page.waitForTimeout(50);
    await page.keyboard.up('c');

    weaponState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1BombCd: state.bombCooldown,
        p2BombCd: state.p2.bombCooldown,
        bombCount: arrays.bombArray.length,
      };
    });

    expect(weaponState.p1BombCd).toBeGreaterThan(0);
    expect(weaponState.p2BombCd).toBe(0);
    expect(weaponState.bombCount).toBeGreaterThan(0);

    // P2 drops a bomb with 'l'
    await page.keyboard.down('l');
    await page.waitForTimeout(50);
    await page.keyboard.up('l');

    weaponState = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p2BombCd: state.p2.bombCooldown,
      };
    });
    expect(weaponState.p2BombCd).toBeGreaterThan(0);
  });

  test('Dedicated loot system in two-player mode: powerups belong to P1 or P2 and can only be collected by that player', async ({
    page,
  }) => {
    // Activate two-player mode and start the game
    await page.locator('#gamemode-btn-coop').click();

    await startGame(page);

    // 1. Spawn a P1 powerup directly at the P2 position (x=370, y=285)
    await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      const { state } = await import('./js/state.js');
      // Set the P1 & P2 positions
      state.x = 100;
      state.y = 285;
      state.p2.x = 370;
      state.p2.y = 285;
      // Spawn a P1 powerup directly at P2
      Entities.createPowerup(370, 285, 'laser', 'p1');
    });

    await page.waitForTimeout(200);

    // P2 touches the P1 powerup -> must NOT be collected!
    let lootState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1LaserTier: state.laserTier,
        p2LaserTier: state.p2.laserTier,
        powerupCount: arrays.powerups.length,
      };
    });

    expect(lootState.p2LaserTier).toBe(1);
    expect(lootState.powerupCount).toBe(1);

    // Now P1 moves to the powerup position (it is towed by P2)
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const pu = arrays.powerups[0];
      if (pu) {
        state.x = pu.x;
        state.y = pu.y;
      }
    });

    await page.waitForTimeout(200);

    // P1 touches its own powerup -> it is collected!
    lootState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1LaserTier: state.laserTier,
        p2LaserTier: state.p2.laserTier,
        powerupCount: arrays.powerups.length,
      };
    });

    expect(lootState.p1LaserTier).toBe(2);
    expect(lootState.powerupCount).toBe(0);

    // 2. Spawn a P2 powerup directly at the P1 position (x=100, y=285)
    await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      const { state } = await import('./js/state.js');
      state.x = 100;
      state.y = 285;
      state.p2.x = 450;
      state.p2.y = 285;
      Entities.createPowerup(100, 285, 'missile', 'p2');
    });

    await page.waitForTimeout(200);

    // P1 touches the P2 powerup -> must NOT be collected!
    lootState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1MissileTier: state.missileTier,
        p2MissileTier: state.p2.missileTier,
        powerupCount: arrays.powerups.length,
      };
    });

    expect(lootState.p1MissileTier).toBe(1);
    expect(lootState.powerupCount).toBe(1);

    // P2 moves to the powerup position (it is towed by P1)
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const pu = arrays.powerups[0];
      if (pu) {
        state.p2.x = pu.x;
        state.p2.y = pu.y;
      }
    });

    await page.waitForTimeout(200);

    // P2 touches its own powerup -> it is collected!
    lootState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1MissileTier: state.missileTier,
        p2MissileTier: state.p2.missileTier,
        powerupCount: arrays.powerups.length,
      };
    });

    expect(lootState.p2MissileTier).toBe(2);
    expect(lootState.powerupCount).toBe(0);
  });

  test('Balancing & spawns in two-player mode: the wider playfield (600px) uses adapted enemy formations and balanced HP scaling', async ({
    page,
  }) => {
    // 1. SOLO MODE CHECK: standard HP
    await page.locator('#gamemode-btn-single').click();
    let soloHp = await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      const { arrays } = await import('./js/state.js');
      Entities.createEnemy(100, -30, 'normal', 0);
      Entities.createBoss();
      const enemy = arrays.enemies[arrays.enemies.length - 1];
      const boss = arrays.bosses[arrays.bosses.length - 1];
      return {
        enemyHp: enemy.hp,
        bossHp: boss.hp,
      };
    });

    expect(soloHp.enemyHp).toBeGreaterThan(0);
    expect(soloHp.bossHp).toBeGreaterThan(soloHp.enemyHp);

    // 2. CO-OP MODE CHECK: +25% enemy HP, +40% boss HP
    await page.locator('#gamemode-btn-coop').click();
    let coopHp = await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      const { arrays } = await import('./js/state.js');
      Entities.createEnemy(100, -30, 'normal', 0);
      Entities.createBoss();
      const enemy = arrays.enemies[arrays.enemies.length - 1];
      const boss = arrays.bosses[arrays.bosses.length - 1];
      return {
        enemyHp: enemy.hp,
        bossHp: boss.hp,
      };
    });

    // Co-op rule: enemy HP x1.25, boss HP x1.4 (relative to the solo value)
    expect(coopHp.enemyHp).toBeGreaterThan(soloHp.enemyHp);
    expect(coopHp.bossHp).toBeGreaterThan(soloHp.bossHp);
    expect(coopHp.enemyHp).toBe(Math.round(soloHp.enemyHp * 1.25));
    expect(coopHp.bossHp).toBe(Math.round(soloHp.bossHp * 1.4));
  });

  test('Lives & revive system in two-player mode: separate lives, game over only when both players are destroyed, revive on boss victory', async ({
    page,
  }) => {
    // Activate two-player mode and start the game
    await page.locator('#gamemode-btn-coop').click();

    await startGame(page);

    // 1. Destroy player 1 (3 hits)
    await page.evaluate(async () => {
      const Utils = await import('./js/utils.js');
      const { state } = await import('./js/state.js');
      const dummy = { isEnemy: false, el: { dataset: {} }, x: 0, y: 0 };
      Utils.playerHit(dummy, false, 'p1');
      state.invulnerableTimer = 0;
      Utils.playerHit(dummy, false, 'p1');
      state.invulnerableTimer = 0;
      Utils.playerHit(dummy, false, 'p1');
    });

    let liveState = await page.evaluate(async () => {
      const { state, dom } = await import('./js/state.js');
      return {
        p1Lives: state.lives,
        p1Dead: state.isDead,
        p1Display: dom.player.style.display,
        p2Lives: state.p2.lives,
        p2Dead: state.p2.isDead,
        gameOver: state.gameOverActive,
      };
    });

    expect(liveState.p1Lives).toBe(0);
    expect(liveState.p1Dead).toBe(true);
    expect(liveState.p1Display).toBe('none');
    expect(liveState.p2Lives).toBe(3);
    expect(liveState.p2Dead).toBe(false);
    expect(liveState.gameOver).toBe(false); // The game goes on!

    // 2. Defeat the boss -> revives the dead player 1!
    await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      const Utils = await import('./js/utils.js');
      const { arrays } = await import('./js/state.js');
      Entities.createBoss();
      const boss = arrays.bosses[arrays.bosses.length - 1];
      Utils.destroyTarget(boss, 'p2');
    });

    liveState = await page.evaluate(async () => {
      const { state, dom } = await import('./js/state.js');
      return {
        p1Lives: state.lives,
        p1Dead: state.isDead,
        p1Display: dom.player.style.display,
        p1Invuln: state.invulnerableTimer > 0,
      };
    });

    expect(liveState.p1Lives).toBe(1);
    expect(liveState.p1Dead).toBe(false);
    expect(liveState.p1Display).not.toBe('none');
    expect(liveState.p1Invuln).toBe(true);

    // 3. Now eliminate both players -> triggers game over
    await page.evaluate(async () => {
      const Utils = await import('./js/utils.js');
      const { state } = await import('./js/state.js');
      state.invulnerableTimer = 0;
      state.p2.invulnerableTimer = 0;
      state.p2.shieldTier = 0;
      const dummy = { isEnemy: false, el: { dataset: {} }, x: 0, y: 0 };
      // Eliminate P1 (1 life left)
      Utils.playerHit(dummy, false, 'p1');
      // Eliminate P2 (3 lives)
      Utils.playerHit(dummy, false, 'p2');
      state.p2.invulnerableTimer = 0;
      Utils.playerHit(dummy, false, 'p2');
      state.p2.invulnerableTimer = 0;
      Utils.playerHit(dummy, false, 'p2');
    });

    liveState = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p1Dead: state.isDead,
        p2Dead: state.p2.isDead,
        gameOver: state.gameOverActive,
      };
    });

    expect(liveState.p1Dead).toBe(true);
    expect(liveState.p2Dead).toBe(true);
    expect(liveState.gameOver).toBe(true);
    await expect(page.locator('#game-over-screen')).toBeVisible();
  });

  test('Player 2 energy bar: #energie-container-p2 and #energie-balken-p2 are visible and styled correctly in two-player mode', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();
    await startGame(page);

    const energyContainerP2 = page.locator('#energie-container-p2');
    const energyBarP2 = page.locator('#energie-balken-p2');
    await expect(energyContainerP2).toBeVisible();
    await expect(energyBarP2).toBeVisible();

    const box = await energyContainerP2.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(75);
    expect(box.height).toBeGreaterThanOrEqual(6);

    const barBox = await energyBarP2.boundingBox();
    expect(barBox.width).toBeGreaterThan(0);
    expect(barBox.height).toBeGreaterThanOrEqual(6);
  });

  test('Player 2 shield: #spieler-2 shows a visual shield aura ::after at an active shield tier (1, 2, 3)', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();
    await startGame(page);

    // Check shield tier 1
    await page.evaluate(async () => {
      const { state, dom } = await import('./js/state.js');
      state.p2.shieldTier = 1;
      dom.player2.className = 'spieler-schiff schild-aktiv-1';
    });

    let shieldAfter1 = await page.evaluate(() => {
      const el = document.getElementById('spieler-2');
      const afterStyle = window.getComputedStyle(el, '::after');
      return {
        boxShadow: afterStyle.boxShadow,
        borderRadius: afterStyle.borderRadius,
      };
    });

    expect(shieldAfter1.borderRadius).toBe('50%');
    expect(shieldAfter1.boxShadow).toContain('52, 152, 219'); // #3498db

    // A hit via the real game code: tier 3 -> 2, the class must be set by the game
    const hit = () =>
      page.evaluate(async () => {
        const { state, dom } = await import('./js/state.js');
        const Utils = await import('./js/utils.js');
        const livesBeforehand = state.p2.lives;
        state.p2.invulnerableTimer = 0;
        Utils.playerHit({ x: 0, y: 0 }, false, 'p2');
        return {
          tier: state.p2.shieldTier,
          lives: state.p2.lives,
          livesBeforehand,
          classes: Array.from(dom.player2.classList).filter(k => k.startsWith('schild-aktiv-')),
        };
      });

    await page.evaluate(async () => {
      const { state, dom } = await import('./js/state.js');
      state.p2.shieldTier = 3;
      dom.player2.className = 'spieler-schiff schild-aktiv-3';
    });

    const afterHit1 = await hit();
    expect(afterHit1.tier).toBe(2);
    expect(afterHit1.classes).toEqual(['schild-aktiv-2']);
    expect(afterHit1.lives).toBe(afterHit1.livesBeforehand);

    await page.waitForTimeout(350);

    const shieldAfter2 = await page.evaluate(() => {
      const el = document.getElementById('spieler-2');
      return window.getComputedStyle(el, '::after').boxShadow;
    });
    expect(shieldAfter2).toContain('46, 204, 113'); // #2ecc71

    const afterHit2 = await hit();
    expect(afterHit2.tier).toBe(1);
    expect(afterHit2.classes).toEqual(['schild-aktiv-1']);
    expect(afterHit2.lives).toBe(afterHit2.livesBeforehand);

    const afterHit3 = await hit();
    expect(afterHit3.tier).toBe(0);
    expect(afterHit3.classes).toEqual([]);
    expect(afterHit3.lives).toBe(afterHit3.livesBeforehand);
  });

  test('Boss targeting in co-op: when player 1 dies, boss type 2 (hunter) chases and targets player 2', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();
    await startGame(page);

    // Set level 2 (boss type 2 - hunter) and spawn the boss
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.level = 2;
      Entities.createBoss();
      const boss = arrays.bosses[arrays.bosses.length - 1];
      boss.phase = 'fight'; // Straight into fight mode
      boss.x = 200;

      // Player 1 dies at position x=50
      state.x = 50;
      state.y = 500;
      state.lives = 0;
      state.isDead = true;

      // Player 2 lives at position x=450
      state.p2.x = 450;
      state.p2.y = 500;
      state.p2.lives = 3;
      state.p2.isDead = false;
    });

    // Wait 200ms so the loop can move the boss
    await page.waitForTimeout(200);

    const bossState = await page.evaluate(async () => {
      const { arrays } = await import('./js/state.js');
      const boss = arrays.bosses[arrays.bosses.length - 1];
      return {
        x: boss.x,
      };
    });

    // Since P2 is at 450 and the boss started at 200, the boss must have moved to the right (> 200)
    // If it were stubbornly fixed on P1 (x=50), it would have moved to the left (< 200).
    expect(bossState.x).toBeGreaterThan(200);
  });

  test('Player 2 key controls: in co-op mode key L fires only the bomb and NOT the laser', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();
    await startGame(page);

    // Clear cooldowns and arrays
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      state.p2.energy = 50;
      state.p2.bombCooldown = 0;
      state.p2.laserShoots = false;
      arrays.bombArray.length = 0;
      arrays.laserArray.length = 0;
    });

    // Press key L
    await page.keyboard.down('KeyL');
    await page.waitForTimeout(50);

    const shotState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        bombCount: arrays.bombArray.length,
        laserCount: arrays.laserArray.length,
        p2LaserShoots: state.p2.laserShoots,
      };
    });

    await page.keyboard.up('KeyL');

    expect(shotState.bombCount).toBe(1);
    expect(shotState.laserCount).toBe(0);
    expect(shotState.p2LaserShoots).toBe(false);
  });

  test('HUD layout in co-op mode: score and level display are centered and do not cover the P2 HUD', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();
    await startGame(page);

    const scoreBox = await page.locator('#score-anzeige').boundingBox();
    const levelBox = await page.locator('#level-anzeige').boundingBox();
    const uiP2Box = await page.locator('#ui-container-p2').boundingBox();

    expect(scoreBox).not.toBeNull();
    expect(levelBox).not.toBeNull();
    expect(uiP2Box).not.toBeNull();

    // In a 600px wide playfield: score and level must lie left of the P2 HUD (no overlap in X)
    expect(scoreBox.x + scoreBox.width).toBeLessThanOrEqual(uiP2Box.x + 5);
    expect(levelBox.x + levelBox.width).toBeLessThanOrEqual(uiP2Box.x + 5);
  });

  test('Dedicated loot in co-op: while both live, powerups alternate between P1 and P2', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();
    await startGame(page);
    const owners = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.isDead = false;
      state.p2.isDead = false;
      const beforehand = arrays.powerups.length;
      for (let i = 0; i < 4; i++) Entities.createPowerup(200, 100, 'energy');
      return arrays.powerups.slice(beforehand).map(p => p.owner);
    });
    expect(owners).toHaveLength(4);
    expect(['p1', 'p2']).toContain(owners[0]);
    for (let i = 1; i < 4; i++) expect(owners[i], `Powerup ${i}`).not.toBe(owners[i - 1]);
  });

  test('Dedicated loot with a sole survivor: when one player is dead, only powerups for the living player spawn', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();
    await startGame(page);

    // Case 1: player 1 is dead, player 2 lives
    const p2OnlyOwners = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.isDead = true;
      state.lives = 0;
      state.p2.isDead = false;
      state.p2.lives = 3;

      arrays.powerups.forEach(p => p.el && p.el.remove());
      arrays.powerups.length = 0;

      for (let i = 0; i < 4; i++) {
        Entities.createPowerup(100 + i * 40, 100);
      }
      return arrays.powerups.map(p => p.owner);
    });

    expect(p2OnlyOwners).toEqual(['p2', 'p2', 'p2', 'p2']);

    // Case 2: player 2 is dead, player 1 lives
    const p1OnlyOwners = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.isDead = false;
      state.lives = 3;
      state.p2.isDead = true;
      state.p2.lives = 0;

      arrays.powerups.forEach(p => p.el && p.el.remove());
      arrays.powerups.length = 0;

      for (let i = 0; i < 4; i++) {
        Entities.createPowerup(100 + i * 40, 100);
      }
      return arrays.powerups.map(p => p.owner);
    });

    expect(p1OnlyOwners).toEqual(['p1', 'p1', 'p1', 'p1']);
  });

  test('Highscore separation: saveHighscore and getHighscores store solo and co-op leaderboards in separate localStorage keys', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      localStorage.removeItem('spaceShooterHighscores');
      localStorage.removeItem('spaceShooterHighscores_coop');

      const Utils = await import('./js/utils.js');
      Utils.saveHighscore('SOL', 1500, 'viper', 'single');
      Utils.saveHighscore('COP', 3200, 'phantom', 'coop', 'viper');

      return {
        singleList: Utils.getHighscores('single'),
        coopList: Utils.getHighscores('coop'),
        rawSingleStorage: localStorage.getItem('spaceShooterHighscores'),
        rawCoopStorage: localStorage.getItem('spaceShooterHighscores_coop'),
      };
    });

    expect(result.singleList.length).toBe(1);
    expect(result.singleList[0].name).toBe('SOL');
    expect(result.singleList[0].score).toBe(1500);

    expect(result.coopList.length).toBe(1);
    expect(result.coopList[0].name).toBe('COP');
    expect(result.coopList[0].score).toBe(3200);
    expect(result.coopList[0].shipP1).toBe('phantom');
    expect(result.coopList[0].shipP2).toBe('viper');

    expect(result.rawSingleStorage).not.toBeNull();
    expect(result.rawCoopStorage).not.toBeNull();
    expect(result.rawSingleStorage).not.toContain('COP');
    expect(result.rawCoopStorage).not.toContain('SOL');
  });

  test('Game over in co-op mode: the highscore input qualifies for the co-op leaderboard and stores the ships of both players', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();
    await startGame(page);

    // Set ships and score
    await page.evaluate(async () => {
      localStorage.removeItem('spaceShooterHighscores');
      localStorage.removeItem('spaceShooterHighscores_coop');
      const { state } = await import('./js/state.js');
      const Utils = await import('./js/utils.js');
      state.score = 2400;
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'phantom';
      Utils.triggerGameOver();
    });

    const hsForm = page.locator('#highscore-form');
    await expect(hsForm).toBeVisible();

    const hsInput = page.locator('#highscore-name');
    await hsInput.fill('DUO');
    await page.locator('#btn-save-score').click();

    await expect(hsForm).toBeHidden();

    const storedData = await page.evaluate(async () => {
      const Utils = await import('./js/utils.js');
      return {
        coopList: Utils.getHighscores('coop'),
        singleList: Utils.getHighscores('single'),
      };
    });

    expect(storedData.coopList.length).toBe(1);
    expect(storedData.coopList[0].name).toBe('DUO');
    expect(storedData.coopList[0].score).toBe(2400);
    expect(storedData.coopList[0].shipP1).toBe('viper');
    expect(storedData.coopList[0].shipP2).toBe('phantom');
    expect(storedData.singleList.length).toBe(0);
  });

  test('Highscore tabs: the game over screen allows switching between the solo and co-op leaderboard', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();
    await startGame(page);

    await page.evaluate(async () => {
      localStorage.removeItem('spaceShooterHighscores');
      localStorage.removeItem('spaceShooterHighscores_coop');

      const Utils = await import('./js/utils.js');
      Utils.saveHighscore('SOL', 1111, 'viper', 'single');
      Utils.saveHighscore('DUO', 9999, 'viper', 'coop', 'phantom');

      Utils.triggerGameOver();
    });

    const tabSingle = page.locator('#hs-tab-single');
    const tabBot = page.locator('#hs-tab-bot');

    await expect(tabSingle).toBeVisible();
    await expect(tabBot).toBeVisible();

    // Solo Tab anklicken
    await tabSingle.click();
    await expect(tabSingle).toHaveClass(/active/);
    await expect(page.locator('#highscore-body')).toContainText('SOL');
    await expect(page.locator('#highscore-body')).toContainText('1111');
    await expect(page.locator('#highscore-body')).not.toContainText('DUO');

    // Bot Co-op Tab anklicken
    await tabBot.click();
    await expect(tabBot).toHaveClass(/active/);
    await expect(page.locator('#highscore-body')).toContainText('DUO');
    await expect(page.locator('#highscore-body')).toContainText('9999');
    await expect(page.locator('#highscore-body')).not.toContainText('SOL');
    await expect(page.locator('#highscore-body .hs-coop-badges')).toBeVisible();
  });

  // Formerly two tests with the same precondition (co-op, cutscene on) and the same flow, one of them
  // with ~14 s of real time. Now one cutscene with a paused fake clock.
  test('Co-op cutscene: both player ships (P1 and P2) appear in the convoy, survive the attack and rise together in the light beam', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('starshooter_skip_cutscene');
    });
    await installClock(page);
    await page.goto('/');

    await page.locator('#gamemode-btn-coop').click();

    // Choose the P1 and P2 models in the hangar
    await page.locator('#hangar-player-tabs button[data-player="p1"]').click();
    await page.locator('.hangar-model-btn[data-model="viper"]').click();
    await page.locator('#hangar-player-tabs button[data-player="p2"]').click();
    await page.locator('.hangar-model-btn[data-model="phantom"]').click();

    // From here on page time only passes by fast-forwarding
    await pauseClock(page);
    await page.keyboard.down('w');
    const startTime = await windUntil(page, () => page.evaluate(() => window.__game.state.cutsceneActive), 1000, 50);
    await page.keyboard.up('w');

    await expect(page.locator('#cutscene-container')).toBeVisible();

    const p1CutsceneShip = page.locator('.cutscene-ship.ship-player-p1');
    const p2CutsceneShip = page.locator('.cutscene-ship.ship-player-p2');
    await expect(p1CutsceneShip).toBeVisible();
    await expect(p2CutsceneShip).toBeVisible();

    // Lead time until shortly after the start of the light beam phase (12.2 s)
    await advanceClock(page, 12600 - startTime);

    // Both ships must have survived
    await expect(p1CutsceneShip).toBeAttached();
    await expect(p2CutsceneShip).toBeAttached();

    // Light beam active
    await expect(page.locator('#cutscene-light-beam')).toBeVisible();

    // style.top instead of getBoundingClientRect: the CSS transition does not follow the fake clock
    const heights = () =>
      page.evaluate(() =>
        ['.ship-player-p1', '.ship-player-p2'].map(sel =>
          parseFloat(document.querySelector('.cutscene-ship' + sel).style.top),
        ),
      );
    for (const y of await heights()) expect(y).toBeGreaterThanOrEqual(200);

    // After another 1 s (rise from 13.5 s, end of the cutscene 14.4 s) both rise upwards (top < 200)
    await advanceClock(page, 1000);
    for (const y of await heights()) expect(y).toBeLessThan(200);
  });

  test('Player 2 missile launcher visuals: shows the correct launcher pods on player 2 depending on ship model and level', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Choose Viper-X for P2
    await page.locator('#hangar-player-tabs button[data-player="p2"]').click();
    await page.locator('.hangar-model-btn[data-model="viper"]').click();

    // Start
    await startGame(page);

    const p2Left = page.locator('#spieler-2 .werfer-links');
    const p2Right = page.locator('#spieler-2 .werfer-rechts');
    const p2Center = page.locator('#spieler-2 .werfer-center');

    // Viper-X at tier 1: left launcher visible, right one invisible
    await expect(p2Left).toBeVisible();
    await expect(p2Right).toBeHidden();
    await expect(p2Center).toBeHidden();

    // Switch P2 to Phantom-NX tier 1
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Utils = await import('./js/utils.js');
      state.p2.selectedShipModel = 'phantom';
      state.p2.missileTier = 1;
      Utils.updateMissileLauncherVisuals();
    });

    await expect(p2Left).toBeHidden();
    await expect(p2Right).toBeVisible();
    await expect(p2Center).toBeHidden();

    // At tier 3: both side launchers visible
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Utils = await import('./js/utils.js');
      state.p2.missileTier = 3;
      Utils.updateMissileLauncherVisuals();
    });

    await expect(p2Left).toBeVisible();
    await expect(p2Right).toBeVisible();
    await expect(p2Center).toBeHidden();

    // At tier 5: all 3 launchers visible
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Utils = await import('./js/utils.js');
      state.p2.missileTier = 5;
      Utils.updateMissileLauncherVisuals();
    });

    await expect(p2Left).toBeVisible();
    await expect(p2Right).toBeVisible();
    await expect(p2Center).toBeVisible();
  });

  test('Boss missile orientation: missiles fly forwards with the tip in the flight direction towards the player', async ({
    page,
  }) => {
    // Start the game
    await startGame(page);

    const result = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { createBossMissile } = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');

      // Player position bottom center
      state.x = 185;
      state.y = 500;

      // Create a boss missile top center with a downward direction
      createBossMissile(185, 100, 0);
      const br = arrays.bossMissileArray[arrays.bossMissileArray.length - 1];
      br.vx = 0;
      br.vy = 2.5; // Flies straight down towards the player

      // Run one loop frame
      simulationStep();

      return {
        vx: br.vx,
        vy: br.vy,
        transform: br.el.style.transform,
      };
    });

    // With a vertical flight downwards (vx=0, vy>0) the rotation must be ~180deg (tip points down at the player)
    const match = result.transform.match(/rotate\(([-\d.]+)deg\)/);
    expect(match).not.toBeNull();
    const deg = parseFloat(match[1]);
    expect(Math.abs(deg - 180)).toBeLessThan(5);
  });

  test('Player missile flight dynamics & homing: missiles fly with 3-phase physics and track enemies in 600px mode', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await startGame(page);

    const testResult = await page.evaluate(async () => {
      const { arrays } = await import('./js/state.js');
      const { createEnemy } = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');

      // Clear previous enemies and missiles
      arrays.enemies.forEach(f => {
        if (f.el) f.el.remove();
      });
      arrays.enemies.length = 0;
      arrays.missileArray.forEach(r => {
        if (r.el) r.el.remove();
      });
      arrays.missileArray.length = 0;

      // Create an enemy on the right side of the 600px field
      createEnemy(450, 100);

      // A missile on the left side of the 600px field with the homing property
      const rEl = document.createElement('div');
      rEl.className = 'raketen-projektil rakete-homing';
      document.getElementById('spielfeld').appendChild(rEl);

      const rocket = {
        el: rEl,
        x: 100,
        y: 450,
        vx: 0,
        vy: 2.0,
        damage: 30,
        radius: 80,
        homing: true,
        owner: 'p1',
        age: 0,
        detonated: false,
      };
      arrays.missileArray.push(rocket);

      let vyAtPhase2 = 0;
      let maxObservedVy = 0;

      for (let f = 0; f < 45; f++) {
        simulationStep();
        if (rocket.age === 15) vyAtPhase2 = rocket.vy;
        if (rocket.vy > maxObservedVy) maxObservedVy = rocket.vy;
      }

      return {
        initialX: 100,
        finalX: rocket.x,
        finalVx: rocket.vx,
        vyAtPhase2: vyAtPhase2,
        maxVy: maxObservedVy,
      };
    });

    // In phase 2 (taking a run-up) the missile slows noticeably below the start speed
    expect(testResult.vyAtPhase2).toBeLessThan(1.5);
    // The missile speed vy stays controlled (max <= 13)
    expect(testResult.maxVy).toBeLessThanOrEqual(13);
    // The missile must have turned clearly to the right towards the enemy at x=450 (vx > 0 and finalX > 160)
    expect(testResult.finalVx).toBeGreaterThan(1.0);
    expect(testResult.finalX).toBeGreaterThan(160);
  });

  test('Missile balancing co-op: in co-op missiles have a higher max speed, a larger homing search range and a stronger steering rate than in solo mode', async ({
    page,
  }) => {
    // Real game behavior (weapons.js, missile phase 3) is executed via simulationStep(),
    // once in co-op and once in solo mode with identical start conditions.
    await page.locator('#gamemode-btn-coop').click();
    await startGame(page);

    const measureMode = mode =>
      page.evaluate(mode => {
        const { state, arrays, config, Utils, Entities, Loop } = window.__game;
        Utils.setGameMode(mode);

        function emptyField() {
          for (const key of Object.keys(arrays)) {
            const arr = arrays[key];
            if (!Array.isArray(arr)) continue;
            arr.forEach(e => {
              if (e && e.el && e.el.remove) e.el.remove();
            });
            arr.length = 0;
          }
        }
        function step() {
          state.frameCounter = 1; // prevents timed spawns
          Loop.simulationStep();
        }
        // Missile directly before phase 3 (age 18), the same fields as fireMissileForPlayer
        function createMissile(x, y, homing) {
          const el = document.createElement('div');
          el.className = 'raketen-projektil';
          document.getElementById('spielfeld').appendChild(el);
          const r = {
            id: 'test-rakete',
            el,
            x,
            y,
            vx: 0,
            vy: 1,
            damage: 30,
            radius: 80,
            homing,
            owner: 'p1',
            age: 18,
            detonated: false,
          };
          arrays.missileArray.push(r);
          return r;
        }
        function createTarget(zcx, zcy) {
          Entities.createEnemy(0, 0, 'normal');
          const f = arrays.enemies[arrays.enemies.length - 1];
          f.vx = 0;
          f.vy = 0;
          f.speed = 0;
          f.shotTimer = 100000;
          f.x = zcx - (f.size || 20) / 2;
          f.y = zcy - (f.size || 20) / 2;
          f.basisX = f.x; // Enemy movement swings around baseX
          return f;
        }
        const angle = r => Math.atan2(-r.vy, r.vx || 0.0001);

        // (a) Maximum speed: let a missile without a target fly from bottom to top
        emptyField();
        const rA = createMissile(config.playfieldWidth / 2, config.playfieldHeight - 10, false);
        let maxVy = 0;
        let inField = true;
        for (let i = 0; i < 40; i++) {
          step();
          if (!arrays.missileArray.includes(rA)) {
            inField = false;
            break;
          }
          maxVy = Math.max(maxVy, rA.vy);
        }

        // (b) Homing search range: target 170 px below the missile (between 140 and 200), offset sideways
        emptyField();
        const rB = createMissile(100, 300, true);
        const targetB = createTarget(rB.x + 3 + 100, rB.y + 170);
        step();
        const homingDetected = rB.vx > 0.1;
        const targetBRemained = arrays.enemies.includes(targetB);

        // (c) Steering rate: target far top right, angle change of one step (limited by maxTurn)
        emptyField();
        const rC = createMissile(100, 500, true);
        createTarget(rC.x + 3 + 300, 400);
        const anglePrev = angle(rC);
        step();
        const steerAngle = Math.abs(angle(rC) - anglePrev);

        emptyField();
        return { maxVy, inField, homingDetected, targetBRemained, steerAngle };
      }, mode);

    const coop = await measureMode('coop');
    const solo = await measureMode('single');

    // Test setup valid: missiles stayed in the field, targets still existed
    expect(coop.inField).toBe(true);
    expect(solo.inField).toBe(true);
    expect(coop.targetBRemained).toBe(true);
    expect(solo.targetBRemained).toBe(true);

    // (a) Maximum flight speed: co-op 15, solo 13
    expect(coop.maxVy).toBeCloseTo(15, 5);
    expect(solo.maxVy).toBeCloseTo(13, 5);

    // (b) Homing search range: a target 170 px below is captured only in co-op (200), not in solo (140)
    expect(coop.homingDetected).toBe(true);
    expect(solo.homingDetected).toBe(false);

    // (c) Steering rate per step: co-op 0.26 rad, solo 0.22 rad
    expect(coop.steerAngle).toBeGreaterThan(solo.steerAngle);
    expect(coop.steerAngle).toBeCloseTo(0.26, 2);
    expect(solo.steerAngle).toBeCloseTo(0.22, 2);
  });

  test('Tractor beam coupling in two-player mode: a player couples up to 3 powerups for the partner', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await startGame(page);

    const result = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { createPowerup } = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');

      // Clear existing powerups
      arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      arrays.powerups.length = 0;

      // Create 4 powerups for player 2 at the same X/Y position as player 1
      state.x = 200;
      state.y = 300;

      createPowerup(200, 300, 'laserWeapon', 'p2');
      simulationStep();

      createPowerup(200, 300, 'missileWeapon', 'p2');
      simulationStep();

      createPowerup(200, 300, 'bombWeapon', 'p2');
      simulationStep();

      createPowerup(200, 300, 'shield', 'p2');
      simulationStep();

      return {
        totalPowerups: arrays.powerups.length,
        towedCount: arrays.powerups.filter(p => p.towedBy === 'p1').length,
        untowedCount: arrays.powerups.filter(p => !p.towedBy).length,
      };
    });

    expect(result.totalPowerups).toBe(4);
    expect(result.towedCount).toBe(3);
    expect(result.untowedCount).toBe(1);
  });

  test('Tractor beam coupling: every towed powerup slows the ship by 10% (1=90%, 2=80%, 3=70%)', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await startGame(page);

    const testSpeeds = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { createPowerup } = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');

      arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      arrays.powerups.length = 0;

      // Base speed with 0 powerups
      state.y = 300;
      state.keysPressed.w = true;
      simulationStep();
      const dist0 = 300 - state.y;
      state.keysPressed.w = false;

      // 1 powerup attached
      createPowerup(state.x, state.y, 'laserWeapon', 'p2');
      simulationStep(); // P1 koppelt an
      state.y = 300;
      state.keysPressed.w = true;
      simulationStep();
      const dist1 = 300 - state.y;
      state.keysPressed.w = false;

      // 2 powerups attached
      createPowerup(state.x, state.y, 'missileWeapon', 'p2');
      simulationStep(); // P1 koppelt an
      state.y = 300;
      state.keysPressed.w = true;
      simulationStep();
      const dist2 = 300 - state.y;
      state.keysPressed.w = false;

      // 3 powerups attached
      createPowerup(state.x, state.y, 'bombWeapon', 'p2');
      simulationStep(); // P1 koppelt an
      state.y = 300;
      state.keysPressed.w = true;
      simulationStep();
      const dist3 = 300 - state.y;
      state.keysPressed.w = false;

      return {
        dist0: Math.round(dist0 * 100) / 100,
        dist1: Math.round(dist1 * 100) / 100,
        dist2: Math.round(dist2 * 100) / 100,
        dist3: Math.round(dist3 * 100) / 100,
      };
    });

    // Base distance from the measurement without a powerup; every towed powerup takes 10% of it away
    expect(testSpeeds.dist0).toBeGreaterThan(0);
    expect(testSpeeds.dist1 / testSpeeds.dist0).toBeCloseTo(0.9, 2);
    expect(testSpeeds.dist2 / testSpeeds.dist0).toBeCloseTo(0.8, 2);
    expect(testSpeeds.dist3 / testSpeeds.dist0).toBeCloseTo(0.7, 2);
  });

  test('Tractor beam coupling: the partner collects a towed powerup by touching it and releases the beam', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await startGame(page);

    const result = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { createPowerup } = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');

      arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      arrays.powerups.length = 0;

      state.laserTier = 1;
      state.p2.laserTier = 1;

      // P1 couples a powerup for P2
      state.x = 200;
      state.y = 300;
      state.p2.x = 450;
      state.p2.y = 300;

      createPowerup(200, 300, 'laserWeapon', 'p2');
      simulationStep();

      const pu = arrays.powerups[0];
      const afterAttach = {
        isTowed: pu && pu.towedBy === 'p1',
        p1Laser: state.laserTier,
        p2Laser: state.p2.laserTier,
        hasBeam: !!document.querySelector('.tractor-beam-svg'),
      };

      // P2 moves towards the towed powerup
      state.p2.x = pu.x;
      state.p2.y = pu.y;

      simulationStep();

      const afterHandoff = {
        totalPowerups: arrays.powerups.length,
        p1Laser: state.laserTier,
        p2Laser: state.p2.laserTier,
        hasBeam: !!document.querySelector('.tractor-beam-svg'),
      };

      return {
        afterAttach,
        afterHandoff,
      };
    });

    expect(result.afterAttach.isTowed).toBe(true);
    expect(result.afterAttach.p1Laser).toBe(1);
    expect(result.afterAttach.p2Laser).toBe(1);
    expect(result.afterAttach.hasBeam).toBe(true);

    expect(result.afterHandoff.totalPowerups).toBe(0);
    expect(result.afterHandoff.p1Laser).toBe(1);
    expect(result.afterHandoff.p2Laser).toBe(2); // P2 received the upgrade!
    expect(result.afterHandoff.hasBeam).toBe(false); // The beam was removed!
  });

  test('Tractor beam coupling: when the towing player dies, the tractor beam releases and the powerup drifts on freely', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await startGame(page);

    const result = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { createPowerup } = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');

      arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      arrays.powerups.length = 0;

      // P1 koppelt Powerup an
      state.x = 200;
      state.y = 300;
      createPowerup(200, 300, 'shield', 'p2');
      simulationStep();

      const pu = arrays.powerups[0];
      const beforeDeath = {
        isTowed: pu && pu.towedBy === 'p1',
        hasBeam: !!document.querySelector('.tractor-beam-svg'),
      };

      // P1 gets destroyed
      state.isDead = true;
      simulationStep();

      const afterDeath = {
        isTowed: pu && pu.towedBy !== null,
        hasBeam: !!document.querySelector('.tractor-beam-svg'),
        powerupExists: arrays.powerups.length === 1,
      };

      return {
        beforeDeath,
        afterDeath,
      };
    });

    expect(result.beforeDeath.isTowed).toBe(true);
    expect(result.beforeDeath.hasBeam).toBe(true);

    expect(result.afterDeath.isTowed).toBe(false);
    expect(result.afterDeath.hasBeam).toBe(false);
    expect(result.afterDeath.powerupExists).toBe(true);
  });

  test('Viper splitter drop: every 10th enemy destroyed by the Viper drops a splitter (red or white), while the Phantom creates no splitters', async ({
    page,
  }) => {
    // Start game
    await startGame(page);

    const result = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { createEnemy } = await import('./js/entities.js');
      const { destroyTarget } = await import('./js/utils.js');

      arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      arrays.powerups.length = 0;
      arrays.enemies.forEach(f => {
        if (f.el) f.el.remove();
      });
      arrays.enemies.length = 0;

      state.selectedShipModel = 'viper';
      state.viperKillCount = 0;

      // 1. Destroy 9 enemies -> no splitter drop yet
      for (let i = 0; i < 9; i++) {
        createEnemy(100, 100);
        const f = arrays.enemies[arrays.enemies.length - 1];
        f.carriesPowerup = false;
        destroyTarget(f, 'p1');
      }

      const countAfter9 = arrays.powerups.length;

      // 2. Destroy the 10th enemy -> exactly 1 splitter drop
      createEnemy(100, 100);
      const f10 = arrays.enemies[arrays.enemies.length - 1];
      f10.carriesPowerup = false;
      destroyTarget(f10, 'p1');

      const countAfter10 = arrays.powerups.length;
      const dropType10 = arrays.powerups.length > 0 ? arrays.powerups[0].type : null;

      // 3. Destroy another 9 enemies (19 in total)
      for (let i = 0; i < 9; i++) {
        createEnemy(100, 100);
        const f = arrays.enemies[arrays.enemies.length - 1];
        f.carriesPowerup = false;
        destroyTarget(f, 'p1');
      }

      const countAfter19 = arrays.powerups.length;

      // 4. Destroy the 20th enemy -> 2nd splitter drop
      createEnemy(100, 100);
      const f20 = arrays.enemies[arrays.enemies.length - 1];
      f20.carriesPowerup = false;
      destroyTarget(f20, 'p1');

      const countAfter20 = arrays.powerups.length;

      // 5. Phantom check: destroy 10 enemies with the Phantom -> 0 drops
      arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      arrays.powerups.length = 0;
      state.selectedShipModel = 'phantom';

      for (let i = 0; i < 10; i++) {
        createEnemy(100, 100);
        const f = arrays.enemies[arrays.enemies.length - 1];
        f.carriesPowerup = false;
        destroyTarget(f, 'p1');
      }

      const phantomDrops = arrays.powerups.length;

      return {
        countAfter9,
        countAfter10,
        dropType10,
        countAfter19,
        countAfter20,
        phantomDrops,
      };
    });

    expect(result.countAfter9).toBe(0);
    expect(result.countAfter10).toBe(1);
    expect(['splitterRed', 'splitterWhite']).toContain(result.dropType10);
    expect(result.countAfter19).toBe(1);
    expect(result.countAfter20).toBe(2);
    expect(result.phantomDrops).toBe(0);
  });

  test('Viper red splitter: collecting 10 red splitters grants +1 life and resets the counter', async ({ page }) => {
    // Start game
    await startGame(page);

    const result = await page.evaluate(async () => {
      const { arrays, state, dom } = await import('./js/state.js');
      const { createPowerup } = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');

      arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      arrays.powerups.length = 0;

      state.selectedShipModel = 'viper';
      state.lives = 3;
      state.splitterRed = 0;
      state.x = 200;
      state.y = 200;

      // Collect 1 red splitter
      createPowerup(200, 200, 'splitterRed');
      simulationStep();

      const after1 = {
        splitterRed: state.splitterRed,
        lives: state.lives,
      };

      // Set the counter to 9 and collect the 10th splitter
      state.splitterRed = 9;
      createPowerup(200, 200, 'splitterRed');
      simulationStep();

      const after10 = {
        splitterRed: state.splitterRed,
        lives: state.lives,
        heartsCount: dom.livesDisplay.querySelectorAll('.leben-herz').length,
      };

      return {
        after1,
        after10,
      };
    });

    expect(result.after1.splitterRed).toBe(1);
    expect(result.after1.lives).toBe(3);

    expect(result.after10.splitterRed).toBe(0);
    expect(result.after10.lives).toBe(4);
    expect(result.after10.heartsCount).toBe(4);
  });

  test('Viper white splitter: collecting 10 white splitters activates the superweapon and resets the counter', async ({
    page,
  }) => {
    // Start game
    await startGame(page);

    const result = await page.evaluate(async () => {
      const { arrays, state, dom } = await import('./js/state.js');
      const { createPowerup } = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');

      arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      arrays.powerups.length = 0;

      state.selectedShipModel = 'viper';
      state.laserTier = 1;
      state.missileTier = 1;
      state.bombTier = 1;
      state.splitterWhite = 0;
      state.x = 200;
      state.y = 200;

      // Collect 1 white splitter
      createPowerup(200, 200, 'splitterWhite');
      simulationStep();

      const after1 = {
        splitterWhite: state.splitterWhite,
        laserTier: state.laserTier,
        missileTier: state.missileTier,
        bombTier: state.bombTier,
      };

      // Set the counter to 9 and collect the 10th splitter
      state.splitterWhite = 9;
      createPowerup(200, 200, 'splitterWhite');
      simulationStep();

      const after10 = {
        splitterWhite: state.splitterWhite,
        laserTier: state.laserTier,
        missileTier: state.missileTier,
        bombTier: state.bombTier,
        activePuText: dom.activePowerupsContainer.textContent,
      };

      return {
        after1,
        after10,
      };
    });

    expect(result.after1.splitterWhite).toBe(1);
    expect(result.after1.laserTier).toBe(1);
    expect(result.after1.missileTier).toBe(1);
    expect(result.after1.bombTier).toBe(1);

    expect(result.after10.splitterWhite).toBe(0);
    expect(result.after10.laserTier).toBe(2);
    expect(result.after10.missileTier).toBe(2);
    expect(result.after10.bombTier).toBe(2);
  });

  test('Co-op splitter system: independent counting for players 1 & 2 and ship-specific HUD visibility', async ({
    page,
  }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await startGame(page);

    const result = await page.evaluate(async () => {
      const { arrays, state, dom } = await import('./js/state.js');
      const { createPowerup } = await import('./js/entities.js');
      const { simulationStep } = await import('./js/loop.js');
      const { updateSplitterUI, updateSplitterP2UI } = await import('./js/utils.js');

      arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      arrays.powerups.length = 0;

      // P1 is a Viper, P2 is a Viper
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'viper';
      state.splitterRed = 0;
      state.splitterWhite = 0;
      state.p2.splitterRed = 0;
      state.p2.splitterWhite = 0;

      updateSplitterUI();
      updateSplitterP2UI();

      const initialHud = {
        p1HudDisplay: dom.splitterHudP1 ? dom.splitterHudP1.style.display : null,
        p2HudDisplay: dom.splitterHudP2 ? dom.splitterHudP2.style.display : null,
      };

      // P1 collects a red splitter
      state.x = 100;
      state.y = 200;
      createPowerup(100, 200, 'splitterRed', 'p1');
      simulationStep();

      // P2 collects a white splitter
      state.p2.x = 400;
      state.p2.y = 200;
      createPowerup(400, 200, 'splitterWhite', 'p2');
      simulationStep();

      const afterPickups = {
        p1Rot: state.splitterRed,
        p1White: state.splitterWhite,
        p2Rot: state.p2.splitterRed,
        p2White: state.p2.splitterWhite,
        p1RotText: dom.splitterRedCountP1 ? dom.splitterRedCountP1.textContent : '',
        p2WhiteText: dom.splitterWhiteCountP2 ? dom.splitterWhiteCountP2.textContent : '',
      };

      // If P2 is a Phantom, the P2 HUD must be hidden
      state.p2.selectedShipModel = 'phantom';
      updateSplitterP2UI();

      const phantomCheck = {
        p1HudDisplay: dom.splitterHudP1 ? dom.splitterHudP1.style.display : null,
        p2HudDisplay: dom.splitterHudP2 ? dom.splitterHudP2.style.display : null,
      };

      return {
        initialHud,
        afterPickups,
        phantomCheck,
      };
    });

    expect(result.initialHud.p1HudDisplay).toBe('flex');
    expect(result.initialHud.p2HudDisplay).toBe('flex');

    expect(result.afterPickups.p1Rot).toBe(1);
    expect(result.afterPickups.p1White).toBe(0);
    expect(result.afterPickups.p2Rot).toBe(0);
    expect(result.afterPickups.p2White).toBe(1);
    expect(result.afterPickups.p1RotText).toBe('1');
    expect(result.afterPickups.p2WhiteText).toBe('1');

    expect(result.phantomCheck.p1HudDisplay).toBe('flex');
    expect(result.phantomCheck.p2HudDisplay).toBe('none');
  });

  test('Boss splitter drops: a defeated boss always drops a guaranteed 3 splitters (red or white) in addition to its rewards', async ({
    page,
  }) => {
    // Start game
    await startGame(page);

    const result = await page.evaluate(async () => {
      const { arrays } = await import('./js/state.js');
      const { createBoss } = await import('./js/entities.js');
      const { destroyTarget } = await import('./js/utils.js');

      arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      arrays.powerups.length = 0;
      arrays.bosses.forEach(b => {
        if (b.el) b.el.remove();
      });
      arrays.bosses.length = 0;

      createBoss();
      const boss = arrays.bosses[0];

      destroyTarget(boss, 'p1');

      const allDrops = arrays.powerups.map(p => p.type);
      const shardDrops = allDrops.filter(t => t === 'splitterRed' || t === 'splitterWhite');
      const regularDrops = allDrops.filter(t => t !== 'splitterRed' && t !== 'splitterWhite');

      return {
        totalPowerups: allDrops.length,
        shardCount: shardDrops.length,
        regularCount: regularDrops.length,
        hasSuperWeapon: regularDrops.includes('superWeapon'),
      };
    });

    expect(result.shardCount).toBe(3);
    expect(result.regularCount).toBe(3);
    expect(result.totalPowerups).toBe(6);
    expect(result.hasSuperWeapon).toBe(true);
  });

  test('Splitter look: splitters are rendered as pointed, scalene triangles without letters', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { arrays } = await import('./js/state.js');
      const { createPowerup } = await import('./js/entities.js');

      arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      arrays.powerups.length = 0;

      createPowerup(100, 100, 'splitterRed');
      createPowerup(150, 100, 'splitterWhite');

      const rotPu = arrays.powerups[0];
      const whitePu = arrays.powerups[1];

      const rotSvg = rotPu.el.querySelector('svg.splitter-shard-svg');
      const whiteSvg = whitePu.el.querySelector('svg.splitter-shard-svg');

      const rotPolygon = rotSvg ? rotSvg.querySelector('polygon') : null;
      const whitePolygon = whiteSvg ? whiteSvg.querySelector('polygon') : null;

      return {
        rotHasClass: rotPu.el.classList.contains('powerup-splitter'),
        whiteHasClass: whitePu.el.classList.contains('powerup-splitter'),
        rotText: rotPu.el.textContent.trim(),
        whiteText: whitePu.el.textContent.trim(),
        rotHasSvgPolygon: !!rotPolygon,
        whiteHasSvgPolygon: !!whitePolygon,
        rotPoints: rotPolygon ? rotPolygon.getAttribute('points') : null,
      };
    });

    expect(result.rotHasClass).toBe(true);
    expect(result.whiteHasClass).toBe(true);
    expect(result.rotText).toBe('');
    expect(result.whiteText).toBe('');
    expect(result.rotHasSvgPolygon).toBe(true);
    expect(result.whiteHasSvgPolygon).toBe(true);
    expect(result.rotPoints).toBeTruthy();
  });
});

test.describe('Bot-Partner', () => {
  test('The bot toggle appears in co-op mode on the P2 tab and sets p2IsBot', async ({ page }) => {
    // Close the what's new overlay in case it appears
    const whatsNewOverlay = page.locator('#whats-new-overlay');
    if (await whatsNewOverlay.isVisible()) {
      await page.click('#btn-close-whats-new');
      await expect(whatsNewOverlay).toBeHidden();
    }

    // The bot controls are not visible initially
    const botControls = page.locator('#p2-bot-controls');
    await expect(botControls).toBeHidden();

    // Activate co-op mode
    await page.click('#gamemode-btn-coop');

    // P2-Tab anklicken
    await page.click('.hangar-player-tab[data-player="p2"]');

    // The bot controls are visible now
    await expect(botControls).toBeVisible();

    // The bot toggle button exists and has the correct initial text
    const botToggle = page.locator('#btn-p2-bot-toggle');
    await expect(botToggle).toBeVisible();
    await expect(botToggle).toContainText('BOT');

    // p2IsBot is false initially
    let p2IsBot = await page.evaluate(() => {
      const mod = window.__gameState || null;
      if (mod) return mod.p2IsBot;
      // Fallback: look directly in the ES module
      return document.querySelector('#btn-p2-bot-toggle').classList.contains('active');
    });
    expect(p2IsBot).toBe(false);

    // Click on the bot toggle
    await botToggle.click();

    // The button now has the 'active' class
    await expect(botToggle).toHaveClass(/active/);
    await expect(botToggle).toContainText('BOT AKTIV');

    // The difficulty panel is visible now
    const diffPanel = page.locator('#bot-difficulty-panel');
    await expect(diffPanel).toBeVisible();

    // Normal is active by default
    const normalBtn = page.locator('.bot-diff-btn[data-diff="normal"]');
    await expect(normalBtn).toHaveClass(/active/);

    // Click on hard
    const hardBtn = page.locator('.bot-diff-btn[data-diff="hard"]');
    await hardBtn.click();
    await expect(hardBtn).toHaveClass(/active/);
    await expect(normalBtn).not.toHaveClass(/active/);

    // Back to single player: the bot controls disappear + the state is reset
    await page.click('#gamemode-btn-single');
    await expect(botControls).toBeHidden();
    await expect(botToggle).not.toHaveClass(/active/);
  });

  test('The bot moves towards an enemy', async ({ page }) => {
    // The what's new overlay does not appear (setGameState in beforeEach)
    await expect(page.locator('#whats-new-overlay')).toBeHidden();

    // Activate co-op mode + activate the bot
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Start the game
    await startGame(page);

    // Wait until the cutscene is over and the game runs
    await page.waitForFunction(
      () => {
        const mod = window.__game;
        if (mod && mod.state) return mod.state.gameRunning;
        // Fallback: check whether the player is visible
        const player = document.getElementById('spieler');
        return player && player.style.display !== 'none';
      },
      null,
      { timeout: 5000 },
    );

    // Record the P2 start position, spawn an enemy left of P2 and run 30 fixed simulation steps (~0.5 s)
    // synchronously so the bot reacts (independent of wall clock and frame rate)
    const { startPos, endPos } = await page.evaluate(() => {
      const mod = window.__game;
      const s = mod.state;
      const enemyX = s.p2.x - 100;
      const startPos = { x: s.p2.x, y: s.p2.y, enemyX };
      mod.Entities.createEnemy(enemyX, 50, 'stop_and_go', 0);
      for (let i = 0; i < 30; i++) mod.Loop.simulationStep();
      return { startPos, endPos: { x: s.p2.x, y: s.p2.y } };
    });

    expect(startPos).toBeTruthy();
    expect(endPos).toBeTruthy();
    // The bot should have moved to the left (towards the enemy)
    expect(endPos.x).toBeLessThan(startPos.x);
  });

  test('The bot fires the laser when an enemy is in the corridor', async ({ page }) => {
    // Activate co-op mode + activate the bot
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Start the game
    await startGame(page);

    // Wait until the game runs
    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // Put an enemy exactly into the P2 corridor, then 18 fixed simulation steps (~0.3 s)
    const laserFired = await page.evaluate(() => {
      const mod = window.__game;
      const s = mod.state;
      mod.Entities.createEnemy(s.p2.x, 50, 'stop_and_go', 0);
      for (let i = 0; i < 18; i++) mod.Loop.simulationStep();
      return s.p2.laserShoots || s.p2.botFireLaser || s.p2.energy < s.p2.maxEnergy;
    });

    expect(laserFired).toBe(true);
  });

  test('The bot dodges an asteroid', async ({ page }) => {
    // Activate co-op mode + activate the bot
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Start the game
    await startGame(page);

    // Wait until the game runs
    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // Spawn an asteroid near P2 on the right and run a fixed number of simulation steps
    // synchronously (independent of wall clock time and frame rate). After about 20
    // steps the asteroid leaves the dodge radius and the bot aims at it again,
    // hence 10 steps.
    const initialData = { startX: 300, startY: 480 };
    const endX = await page.evaluate(() => {
      const mod = window.__game;
      const s = mod.state;
      s.p2.x = 300;
      s.p2.y = 480;
      // Spawn an asteroid 30px right of and 50px above P2
      mod.Entities.createAsteroid(330, 430);
      for (let i = 0; i < 10; i++) mod.Loop.simulationStep();
      return s.p2.x;
    });

    // The bot should have dodged to the left (away from the asteroid)
    expect(endX).toBeLessThan(initialData.startX);
  });

  test('The bot steers towards near powerups', async ({ page }) => {
    // Activate co-op mode + activate the bot
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Start the game
    await startGame(page);

    // Wait until the game runs
    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // Clean up previous entities and spawn a powerup right of P2
    const initialData = await page.evaluate(() => {
      const mod = window.__game;
      mod.arrays.enemies.forEach(f => f.el.remove());
      mod.arrays.enemies.length = 0;
      mod.arrays.asteroids.forEach(a => a.el.remove());
      mod.arrays.asteroids.length = 0;

      const s = mod.state;
      const startX = s.p2.x;
      const startY = s.p2.y;
      // Place a powerup 80px right of P2, then 24 fixed simulation steps (~0.4 s)
      mod.Entities.createPowerup(startX + 80, startY - 20, 'shield');
      for (let i = 0; i < 24; i++) mod.Loop.simulationStep();
      return { startX, startY, endX: s.p2.x };
    });
    const endX = initialData.endX;

    // P2 should have moved to the right (towards the powerup)
    expect(endX).toBeGreaterThan(initialData.startX);
  });

  test('The bot fires missiles at near enemies and bombs at enemy clusters', async ({ page }) => {
    // Activate co-op mode + activate the bot
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Start the game
    await startGame(page);

    // Wait until the game runs
    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // 1. Missile test: spawn an enemy within missile range (<120px)
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.p2.missileCooldown = 0;
      mod.Entities.createEnemy(mod.state.p2.x, mod.state.p2.y - 80, 'stop_and_go', 0);
    });

    // 18 fixed simulation steps (~0.3 s) and evaluation in one synchronous block
    const missileFired = await page.evaluate(() => {
      const mod = window.__game;
      for (let i = 0; i < 18; i++) mod.Loop.simulationStep();
      return mod.state.p2.missileCooldown > 0 || mod.arrays.missileArray.some(r => r.pKey === 'p2');
    });
    expect(missileFired).toBe(true);

    // 2. Bomb test: spawn 3 enemies + reset the bomb cooldown
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.p2.bombCooldown = 0;
      mod.Entities.createEnemy(100, 100, 'stop_and_go', 0);
      mod.Entities.createEnemy(200, 100, 'stop_and_go', 0);
      mod.Entities.createEnemy(300, 100, 'stop_and_go', 0);
    });

    const bombFired = await page.evaluate(() => {
      const mod = window.__game;
      for (let i = 0; i < 18; i++) mod.Loop.simulationStep();
      return mod.state.p2.bombCooldown > 0 || mod.arrays.bombArray.some(b => b.pKey === 'p2');
    });
    expect(bombFired).toBe(true);
  });

  test('Bot difficulty levels (easy vs hard) affect the dodge radius', async ({ page }) => {
    // Activate co-op mode + activate the bot
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Start the game
    await startGame(page);

    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // The same starting situation per tier: a stationary enemy laser right of P2 at distance d.
    // P1 stands so the formation movement does not shift P2; movement comes only from dodging.
    const dx = await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      const { state, config, arrays, Entities } = window.__game;
      const half = config.playerSize / 2;
      const measure = (tier, distance) => {
        for (const k of Object.keys(arrays)) if (Array.isArray(arrays[k])) arrays[k].length = 0;
        document.querySelectorAll('.feind-laser').forEach(el => el.remove());
        state.frameCounter = 1;
        state.p2BotDifficulty = tier;
        state.p2.isDead = false;
        state.p2.x = 400;
        state.p2.y = config.playfieldHeight - 100 - half;
        const cx = state.p2.x + half;
        const cy = state.p2.y + half;
        // Formation target of P2 = current position (no drive without danger)
        state.x = cx - 50 - half;
        state.y = cy - half;
        // Laser center (x + 2, y + 5) exactly distance px right of the P2 center
        Entities.createEnemyLaser(cx + distance - 2, cy - 5);
        arrays.enemyLaserArray[0].vx = 0;
        arrays.enemyLaserArray[0].vy = 0;
        Bot.resetBot();
        const startX = state.p2.x;
        for (let i = 0; i < 8; i++) Bot.updateBot(); // easy: reactionFrames 8 -> at least one decision
        return state.p2.x - startX;
      };
      const out = {};
      for (const distance of [90, 70]) {
        for (const tier of ['easy', 'normal', 'hard']) out[tier + distance] = measure(tier, distance);
      }
      return out;
    });

    // 90 px (between normal 80 and hard 100): only hard dodges (to the left, away from the laser)
    expect(dx.hard90).toBeLessThan(-1);
    expect(Math.abs(dx.normal90)).toBeLessThan(0.5);
    expect(Math.abs(dx.easy90)).toBeLessThan(0.5);
    // 70 px (between easy 60 and normal 80): normal and hard dodge, easy does not
    expect(dx.hard70).toBeLessThan(-1);
    expect(dx.normal70).toBeLessThan(-1);
    expect(Math.abs(dx.easy70)).toBeLessThan(0.5);
  });

  test('The bot holds formation with player 1 while idle', async ({ page }) => {
    // Activate co-op mode + activate the bot
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Start the game
    await startGame(page);

    // Wait until the game runs
    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // Clear all entities and position P1 / P2 deliberately
    const initialData = await page.evaluate(() => {
      const mod = window.__game;
      mod.arrays.enemies.forEach(f => f.el.remove());
      mod.arrays.enemies.length = 0;
      mod.arrays.asteroids.forEach(a => a.el.remove());
      mod.arrays.asteroids.length = 0;
      mod.arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      mod.arrays.powerups.length = 0;

      // Set P1 to x=100, P2 to x=400 (far right)
      mod.state.x = 100;
      mod.state.y = 300;
      mod.state.p2.x = 400;
      mod.state.p2.y = 300;

      // 24 fixed simulation steps (~0.4 s) so the bot moves towards the P1 formation
      const p2StartX = mod.state.p2.x;
      for (let i = 0; i < 24; i++) mod.Loop.simulationStep();
      return { p2StartX, endX: mod.state.p2.x };
    });
    const endX = initialData.endX;

    // P2 should have moved to the left (towards the P1 formation at x=150)
    expect(endX).toBeLessThan(initialData.p2StartX);
  });

  test('After player 1 dies in two-player mode and a restart, player 1 can be controlled again', async ({ page }) => {
    // Activate co-op mode + activate the bot
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Start round 1
    await startGame(page);

    // Wait until the game runs
    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // Player 1 dies first (isDead = true), then P2 too -> game over
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.lives = 0;
      mod.state.isDead = true;
      mod.state.p2.lives = 0;
      mod.state.p2.isDead = true;
      mod.Utils.triggerGameOver();
    });

    // Game over screen visible
    const btnRestart = page.locator('#btn-restart');
    await expect(btnRestart).toBeVisible();

    // Click restart
    await btnRestart.click();

    // Start round 2
    await startGame(page);

    // Wait until game 2 runs
    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // Record the start position of P1
    const startX = await page.evaluate(() => window.__game.state.x);

    // Press key D to move to the right
    await page.keyboard.down('d');
    await page.waitForTimeout(300);
    await page.keyboard.up('d');

    const endX = await page.evaluate(() => window.__game.state.x);

    // Player 1 must have moved to the right (endX > startX)
    expect(endX).toBeGreaterThan(startX);
  });

  test('The bot acts from the lower quarter of the playfield and shoots bosses from a distance', async ({ page }) => {
    // Activate co-op mode + activate the bot
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Start the game
    await startGame(page);

    // Wait until the game runs
    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // Spawn boss 1 at the top (y=60) and let 60 fixed simulation steps (~1 s) run
    // (without the baseline tactic the bot would fly up to y=180)
    const botY = await page.evaluate(() => {
      const mod = window.__game;
      mod.state.p2.y = 480; // P2 starts in the lower area
      mod.Entities.createBoss();
      for (let i = 0; i < 60; i++) mod.Loop.simulationStep();
      return mod.state.p2.y;
    });

    // The bot should stay in the lower quarter of the playfield (y >= 450 on a 600px playfield)
    expect(botY).toBeGreaterThanOrEqual(450);
  });

  test('Online multiplayer › the mode choice switches to online mode and shows the online lobby', async ({ page }) => {
    const btnOnline = page.locator('#gamemode-btn-online');
    await expect(btnOnline).toBeVisible();

    // Click on online mode
    await btnOnline.click();

    // The button must be active; in the menu the playfield stays narrow (no layout jumps)
    await expect(btnOnline).toHaveClass(/active/);
    const playfield = page.locator('#spielfeld');
    await expect(playfield).not.toHaveClass(/mode-coop/);

    // The online lobby area must be visible
    const lobby = page.locator('#online-lobby-container');
    await expect(lobby).toBeVisible();
    await expect(page.locator('#btn-online-host')).toBeVisible();
    await expect(page.locator('#online-room-input')).toBeVisible();
    await expect(page.locator('#btn-online-join')).toBeVisible();

    // Switching back to 1 player hides the lobby again
    await page.click('#gamemode-btn-single');
    await expect(lobby).toBeHidden();

    // Only at the online game start is the playfield enlarged to 600px
    await btnOnline.click();
    await page.evaluate(() => window.__game.Network.startOnlineGame());
    await expect(playfield).toHaveClass(/mode-coop/);
    expect(await page.evaluate(() => window.__game.config.playfieldWidth)).toBe(600);
  });

  test('Online multiplayer › creating a room (host) generates a room code and shows the status', async ({ page }) => {
    // Switch to online mode
    await page.click('#gamemode-btn-online');

    // Click on "RAUM ERSTELLEN"
    await page.click('#btn-online-host');

    // The status element must become visible and contain the room code and the waiting status
    const status = page.locator('#online-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('WARTE AUF MITSPIELER');

    // Check the state object
    const networkState = await page.evaluate(() => window.__game.state.network);
    expect(networkState).toBeDefined();
    expect(networkState.isOnline).toBe(true);
    expect(networkState.isHost).toBe(true);
    expect(networkState.isClient).toBe(false);
    expect(typeof networkState.roomCode).toBe('string');
    expect(networkState.roomCode.length).toBeGreaterThanOrEqual(4);
  });

  test('Online multiplayer › joining a room (client) validates the room code and sets the client state', async ({
    page,
  }) => {
    // Switch to online mode
    await page.click('#gamemode-btn-online');

    // 1. Leereingabe testen
    await page.click('#btn-online-join');
    const status = page.locator('#online-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('BITTE GÜLTIGEN RAUM-CODE EINGEBEN');

    // 2. Enter a valid room code
    await page.fill('#online-room-input', 'ROOM9');
    await page.click('#btn-online-join');

    await expect(status).toContainText('VERBINDE MIT RAUM ROOM9');

    // Check the state object
    const networkState = await page.evaluate(() => window.__game.state.network);
    expect(networkState).toBeDefined();
    expect(networkState.isOnline).toBe(true);
    expect(networkState.isHost).toBe(false);
    expect(networkState.isClient).toBe(true);
    expect(networkState.roomCode).toBe('ROOM9');
  });

  test('Online multiplayer › game start on peer connection in the 600px online co-op mode', async ({ page }) => {
    // Switch to online mode and host a room
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    // Simulate the peer connection
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Network.onPeerJoined('mock_peer_123');
    });

    // Wait until the game runs
    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // Both ships and the P2 HUD must be visible
    const player1 = page.locator('#spieler');
    const player2 = page.locator('#spieler-2');
    const uiP2 = page.locator('#ui-container-p2');

    await expect(player1).toBeVisible();
    await expect(player2).toBeVisible();
    await expect(uiP2).toBeVisible();

    // The playfield must be 600px wide
    const playfield = page.locator('#spielfeld');
    await expect(playfield).toHaveClass(/mode-coop/);
  });

  test('Online-Multiplayer › Host Game-State Serialisierung & Client Snapshot Rendering', async ({ page }) => {
    // Activate online mode
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    // Simulate the peer connection
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Network.onPeerJoined('mock_peer_123');
    });

    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // 1. Check the host serialization
    const snapshot = await page.evaluate(() => {
      const mod = window.__game;
      mod.Entities.createEnemy();
      mod.Entities.createAsteroid();
      return mod.Network.serializeGameState();
    });

    expect(snapshot).toBeDefined();
    expect(snapshot.p1).toBeDefined();
    expect(Array.isArray(snapshot.enemies)).toBe(true);
    expect(snapshot.enemies.length).toBeGreaterThan(0);
    expect(Array.isArray(snapshot.asteroids)).toBe(true);
    expect(snapshot.asteroids.length).toBeGreaterThan(0);

    // 2. Test the client snapshot application
    await page.evaluate(() => {
      const mod = window.__game;
      // Simulate client mode
      mod.state.network.isHost = false;
      mod.state.network.isClient = true;

      const mockSnapshot = {
        p1: { x: 120, y: 350, lives: 2, energy: 40, isDead: false },
        score: 4500,
        level: 3,
        enemies: [{ id: 'f_test_1', x: 250, y: 180, hp: 10, maxHp: 10, size: 24, type: 1, pattern: 'normal' }],
        asteroids: [
          { id: 'a_test_1', x: 100, y: 220, size: 30, isMagma: false, isIndestructible: false, rot: 45 },
          {
            id: 'a_test_magma_destructible',
            x: 150,
            y: 200,
            size: 35,
            isMagma: true,
            isIndestructible: false,
            carriesPowerup: true,
            rot: 10,
          },
          { id: 'a_test_magma_solid', x: 180, y: 240, size: 40, isMagma: true, isIndestructible: true, rot: 20 },
        ],
        bosses: [{ id: 'b_test_1', x: 200, y: 50, hp: 300, maxHp: 400, size: 100, type: 1 }],
        laser: [{ id: 'l_test_1', x: 125, y: 300, vx: 0, vy: 15, width: 4, height: 20, owner: 'p1', color: '#00ffff' }],
        missiles: [{ id: 'r_test_1', x: 130, y: 290, rot: 90, owner: 'p1', tier: 2 }],
        bombs: [{ id: 'b_test_1', x: 140, y: 280, rot: 0, owner: 'p1', tier: 1 }],
        bossLaser: [{ id: 'bl_test_1', x: 210, y: 120, vx: 0, vy: 6, width: 8, height: 25 }],
        bossMissiles: [{ id: 'br_test_1', x: 220, y: 130, vx: 2, vy: 3, rot: 120 }],
        bossBombs: [{ id: 'bb_test_1', x: 230, y: 140, size: 26 }],
        powerups: [
          { id: 'pu_test_1', x: 110, y: 310, type: 'shield', owner: 'p1' },
          { id: 'pu_test_2', x: 160, y: 310, type: 'splitterRed', owner: 'p2' },
        ],
      };

      mod.Network.applyGameStateSnapshot(mockSnapshot);
    });

    // Check whether the P1 position and HUD were updated
    const p1Pos = await page.evaluate(() => ({ x: window.__game.state.x, y: window.__game.state.y }));
    expect(p1Pos.x).toBe(120);
    expect(p1Pos.y).toBe(350);

    const scoreText = await page.locator('#score-anzeige').textContent();
    expect(scoreText).toContain('4500');

    // Check whether the enemy was rendered in the DOM with an SVG
    const enemyInfo = await page.evaluate(() => {
      const el = document.querySelector('.feind-schiff');
      return {
        exists: !!el,
        hasSvg: el ? !!el.querySelector('svg') : false,
      };
    });
    expect(enemyInfo.exists).toBe(true);
    expect(enemyInfo.hasSvg).toBe(true);

    // Check whether asteroids (normal vs magma destructible vs magma indestructible) were rendered correctly
    const asteroidCheck = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('.asteroid'));
      const solidMagma = all.find(a => a.classList.contains('unzerstoerbar'));
      return {
        total: all.length,
        hasSolidMagma: !!solidMagma,
        hasDestructibleMagma: all.some(a => a.querySelector('.riss-layer')),
      };
    });
    expect(asteroidCheck.total).toBe(3);
    expect(asteroidCheck.hasSolidMagma).toBe(true);
    expect(asteroidCheck.hasDestructibleMagma).toBe(true);

    // Check whether lasers, missiles, bombs were rendered in the DOM
    const playerProjectiles = await page.evaluate(() => ({
      hasLaser: !!document.querySelector('.laser-projektil'),
      hasMissile: !!document.querySelector('.raketen-projektil'),
      hasBomb: !!document.querySelector('.bomben-projektil'),
    }));
    expect(playerProjectiles.hasLaser).toBe(true);
    expect(playerProjectiles.hasMissile).toBe(true);
    expect(playerProjectiles.hasBomb).toBe(true);

    // Check whether boss projectiles (laser, missile, bomb) were rendered in the DOM
    const bossProjectiles = await page.evaluate(() => ({
      hasBossLaser: !!document.querySelector('.boss-laser'),
      hasBossMissile: !!document.querySelector('.boss-rakete'),
      hasBossBomb: !!document.querySelector('.boss-bombe'),
    }));
    expect(bossProjectiles.hasBossLaser).toBe(true);
    expect(bossProjectiles.hasBossMissile).toBe(true);
    expect(bossProjectiles.hasBossBomb).toBe(true);

    // Check whether powerups were rendered with styling, owner tag and splitter SVG
    const powerupCheck = await page.evaluate(() => {
      const pus = Array.from(document.querySelectorAll('.powerup'));
      const p1Pu = pus.find(p => p.classList.contains('pu-owner-p1'));
      const p2Splitter = pus.find(p => p.classList.contains('powerup-splitter'));
      return {
        count: pus.length,
        hasP1Border: p1Pu ? p1Pu.style.border !== '' && p1Pu.style.border !== 'none' : false,
        hasP1Tag: p1Pu ? !!p1Pu.querySelector('.pu-owner-tag') : false,
        hasSplitterSvg: p2Splitter ? !!p2Splitter.querySelector('svg') : false,
      };
    });
    expect(powerupCheck.count).toBe(2);
    expect(powerupCheck.hasP1Border).toBe(true);
    expect(powerupCheck.hasP1Tag).toBe(true);
    expect(powerupCheck.hasSplitterSvg).toBe(true);
  });

  test('Online multiplayer › client input serialization & host input application to player 2', async ({ page }) => {
    // Activate online mode
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    // Simulate the peer connection
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Network.onPeerJoined('mock_peer_123');
    });

    await page.waitForFunction(
      () => {
        const mod = window.__game;
        return mod && mod.state && mod.state.gameRunning;
      },
      null,
      { timeout: 5000 },
    );

    // 1. Test the client input serialization (solo controls: WASD, L, K, space)
    const clientInput = await page.evaluate(() => {
      const mod = window.__game;
      mod.state.p2.x = 420;
      mod.state.p2.y = 510;
      mod.state.keysPressed.l = true; // Laser with L
      mod.state.keysPressed.k = true; // Missile with K
      mod.state.keysPressed[' '] = true; // Bomb with the space bar
      return mod.Network.serializePlayerInput();
    });

    expect(clientInput).toBeDefined();
    expect(clientInput.x).toBe(420);
    expect(clientInput.y).toBe(510);
    expect(clientInput.laser).toBe(true);
    expect(clientInput.missile).toBe(true);
    expect(clientInput.bomb).toBe(true);

    // 2. Test the host application to state.p2 (atomically in the same frame)
    const p2State = await page.evaluate(() => {
      const mod = window.__game;
      const remoteInput = {
        x: 350,
        y: 480,
        rotate: -15,
        laser: true,
        missile: true,
        bomb: true,
      };
      mod.Network.applyPlayerInput(remoteInput);
      return {
        x: mod.state.p2.x,
        y: mod.state.p2.y,
        rotate: mod.state.p2.rotate,
        laserInputRequested: mod.state.p2.laserInputRequested,
        networkFireMissile: mod.state.p2.networkFireMissile,
        networkFireBomb: mod.state.p2.networkFireBomb,
      };
    });

    expect(p2State.x).toBe(350);
    expect(p2State.y).toBe(480);
    expect(p2State.rotate).toBe(-15);
    expect(p2State.laserInputRequested).toBe(true);
    expect(p2State.networkFireMissile).toBe(true);
    expect(p2State.networkFireBomb).toBe(true);
  });

  test('Online multiplayer › skip the cutscene in sync with ESC & damage flash only on the machine of the player who was hit', async ({
    page,
  }) => {
    // 1. Test the cutscene synchronization
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    // The host starts the cutscene
    const cutsceneSkippedResult = await page.evaluate(() => {
      const mod = window.__game;
      mod.state.network.connected = true;
      mod.state.network.isOnline = true;
      mod.state.network.isHost = true;

      // Record all sent events (sendNetworkEvent always sets lastSentEvent)
      const sentEvents = [];
      let lastSent = null;
      Object.defineProperty(mod.state.network, 'lastSentEvent', {
        configurable: true,
        get: () => lastSent,
        set: v => {
          lastSent = v;
          sentEvents.push(v);
        },
      });

      // Start and skip the cutscene
      localStorage.removeItem('starshooter_skip_cutscene'); // The setup sets the flag, otherwise no cutscene runs
      mod.Cutscene.startCutscene();
      const activeBeforeSkip = mod.Cutscene.isCutsceneActive();
      mod.Cutscene.skipCutscene();

      return {
        activeBeforeSkip,
        cutsceneActive: mod.Cutscene.isCutsceneActive(),
        gameRunning: mod.state.gameRunning,
        sentTypes: sentEvents.filter(Boolean).map(e => e.type),
      };
    });

    expect(cutsceneSkippedResult.activeBeforeSkip).toBe(true);
    expect(cutsceneSkippedResult.cutsceneActive).toBe(false);
    expect(cutsceneSkippedResult.gameRunning).toBe(true);
    expect(cutsceneSkippedResult.sentTypes).toContain('skip_cutscene');

    // 2. Test the damage flash in online mode (P2 hit -> the host screen must NOT turn red)
    const flashCheck = await page.evaluate(() => {
      const mod = window.__game;
      mod.state.network.isOnline = true;
      mod.state.network.isHost = true;
      mod.state.network.connected = true;
      mod.state.gameMode = 'online';
      mod.state.p2.lives = 3;
      mod.state.p2.shieldTier = 0;
      mod.state.p2.invulnerableTimer = 0;
      mod.state.p2.isDead = false;

      const playfield = document.getElementById('spielfeld');
      playfield.style.backgroundColor = '#0b1319';

      // P2 gets hit on the host
      mod.Utils.playerHit(null, false, 'p2');
      const hostBgAfterP2Hit = playfield.style.backgroundColor;

      return {
        hostBgAfterP2Hit: hostBgAfterP2Hit,
        lastSentEvent: mod.state.network.lastSentEvent,
      };
    });

    // The host screen stays dark and is not flashed red
    expect(flashCheck.hostBgAfterP2Hit).toBe('rgb(11, 19, 25)');
    expect(flashCheck.lastSentEvent).toBeDefined();
    expect(flashCheck.lastSentEvent.type).toBe('player_hit');
    expect(flashCheck.lastSentEvent.target).toBe('p2');
  });

  test('Online multiplayer › highscore coordination: both players enter tags and are saved as AAA+BBB in the co-op leaderboard', async ({
    page,
  }) => {
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    // 1. Trigger game over in online mode
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.network.connected = true;
      mod.state.network.isOnline = true;
      mod.state.network.isHost = true;
      mod.state.gameMode = 'online';
      mod.state.score = 7500;
      mod.state.cheatUsed = false;
      mod.state.selectedShipModel = 'viper';
      mod.state.p2.selectedShipModel = 'phantom';

      mod.Utils.triggerGameOver();
    });

    const hsForm = page.locator('#highscore-form');
    await expect(hsForm).toBeVisible();

    // 2. Player 1 (host) enters 'AAA' and saves
    await page.fill('#highscore-name', 'AAA');
    await page.click('#btn-save-score');

    // Check that the host event was sent and the waiting message appears
    const hostStatus = await page.evaluate(() => {
      const mod = window.__game;
      const waitingMsg = document.getElementById('highscore-waiting-msg');
      return {
        lastSentEvent: mod.state.network.lastSentEvent,
        waitingMsgText: waitingMsg ? waitingMsg.textContent : '',
        waitingMsgVisible: waitingMsg && waitingMsg.style.display !== 'none',
      };
    });

    expect(hostStatus.lastSentEvent).toBeDefined();
    expect(hostStatus.lastSentEvent.type).toBe('highscore_name');
    expect(hostStatus.lastSentEvent.role).toBe('p1');
    expect(hostStatus.lastSentEvent.name).toBe('AAA');
    expect(hostStatus.waitingMsgVisible).toBe(true);
    expect(hostStatus.waitingMsgText).toContain('Spieler 2');

    // 3. Player 2 reports the tag 'BBB'
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Utils.receiveOnlineHighscoreName('p2', 'BBB');
    });

    // Check that the form is hidden now and the highscore table contains 'AAA+BBB'
    await expect(hsForm).toBeHidden();

    const storedCoopScores = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('spaceShooterHighscores_coop') || '[]');
    });

    expect(storedCoopScores.length).toBeGreaterThan(0);
    expect(storedCoopScores[0].name).toBe('AAA+BBB');
    expect(storedCoopScores[0].score).toBe(7500);
    expect(storedCoopScores[0].shipP1).toBe('viper');
    expect(storedCoopScores[0].shipP2).toBe('phantom');

    // Check the leaderboard table in the DOM
    const firstRowText = await page.locator('#highscore-body tr').first().innerText();
    expect(firstRowText).toContain('AAA+BBB');
    expect(firstRowText).toContain('7500');
  });

  test('Online multiplayer › cheat codes are disabled in online mode (neither host nor client)', async ({ page }) => {
    // 1. Activate online mode
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.network.isOnline = true;
      mod.state.network.connected = true;
      mod.state.gameMode = 'online';
      mod.state.gameRunning = true;
      mod.state.laserTier = 1;
      mod.state.missileTier = 1;
      mod.state.bombTier = 1;
      mod.state.shieldTier = 0;
      mod.state.godMode = false;
      mod.state.cheatUsed = false;
    });

    // Try to enter the cheat 'idkfa'
    await page.keyboard.type('idkfa');

    const stateAfterCheat = await page.evaluate(() => ({
      laserTier: window.__game.state.laserTier,
      shieldTier: window.__game.state.shieldTier,
      cheatUsed: window.__game.state.cheatUsed,
      godMode: window.__game.state.godMode,
    }));

    // In online mode the cheat must not have taken effect
    expect(stateAfterCheat.laserTier).toBe(1);
    expect(stateAfterCheat.shieldTier).toBe(0);
    expect(stateAfterCheat.cheatUsed).toBe(false);

    // Try to enter the cheat 'idgod'
    await page.keyboard.type('idgod');

    const stateAfterGod = await page.evaluate(() => ({
      godMode: window.__game.state.godMode,
      cheatUsed: window.__game.state.cheatUsed,
    }));

    expect(stateAfterGod.godMode).toBe(false);
    expect(stateAfterGod.cheatUsed).toBe(false);
  });

  test('Mobile/touch › tapping the mode buttons (co-op / online) and hangar options does not start the game', async ({
    page,
  }) => {
    // 1. Trigger touchstart on the mode buttons
    await page.dispatchEvent('#gamemode-btn-coop', 'touchstart');
    await page.click('#gamemode-btn-coop');

    const stateAfterCoopTouch = await page.evaluate(() => ({
      gameMode: window.__game.state.gameMode,
      gameRunning: window.__game.state.gameRunning,
      cutsceneActive: window.__game.state.cutsceneActive,
    }));

    expect(stateAfterCoopTouch.gameMode).toBe('coop');
    expect(stateAfterCoopTouch.gameRunning).toBe(false);
    expect(stateAfterCoopTouch.cutsceneActive).toBe(false);

    // 2. Trigger touchstart on the online button
    await page.dispatchEvent('#gamemode-btn-online', 'touchstart');
    await page.click('#gamemode-btn-online');

    const stateAfterOnlineTouch = await page.evaluate(() => ({
      gameMode: window.__game.state.gameMode,
      gameRunning: window.__game.state.gameRunning,
      cutsceneActive: window.__game.state.cutsceneActive,
    }));

    expect(stateAfterOnlineTouch.gameMode).toBe('online');
    expect(stateAfterOnlineTouch.gameRunning).toBe(false);
    expect(stateAfterOnlineTouch.cutsceneActive).toBe(false);

    // The start screen must still be visible
    const startScreen = page.locator('#start-screen');
    await expect(startScreen).toBeVisible();

    // 3. Touch on the hangar container and model buttons
    await page.dispatchEvent('#hangar-container', 'touchstart');
    await page.dispatchEvent('.hangar-model-btn[data-model="phantom"]', 'touchstart');
    await page.click('.hangar-model-btn[data-model="phantom"]');

    const stateAfterHangar = await page.evaluate(() => ({
      gameRunning: window.__game.state.gameRunning,
      cutsceneActive: window.__game.state.cutsceneActive,
      model: window.__game.state.selectedShipModel,
    }));
    expect(stateAfterHangar.gameRunning).toBe(false);
    expect(stateAfterHangar.cutsceneActive).toBe(false);
    expect(stateAfterHangar.model).toBe('phantom');

    // 4. Mode back to single and a touch on #start-text starts the game
    await page.click('#gamemode-btn-single');
    await page.dispatchEvent('#start-text', 'touchstart');

    const stateAfterStartText = await page.evaluate(() => ({
      gameRunning: window.__game.state.gameRunning,
      cutsceneActive: window.__game.state.cutsceneActive,
    }));
    expect(stateAfterStartText.gameRunning || stateAfterStartText.cutsceneActive).toBe(true);
  });

  test('Online multiplayer › bomb & missile detonations create shockwaves and particles on the client', async ({
    page,
  }) => {
    // 1. Prepare online client mode
    await page.click('#gamemode-btn-online');
    await page.fill('#online-room-input', 'ABCDE');
    await page.click('#btn-online-join');

    // 2. Bomb Detonation simulieren
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Utils.createBombDetonation(300, 250, '#f39c12', 150, 1, false);
    });

    const particlesAfterBomb = await page.evaluate(() => {
      return window.__game.arrays.particleArray.length;
    });
    expect(particlesAfterBomb).toBeGreaterThanOrEqual(60);

    // 3. Simulate a missile detonation
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Utils.createMissileDetonation(200, 150, 70);
    });

    const particlesAfterRocket = await page.evaluate(() => {
      return window.__game.arrays.particleArray.length;
    });
    expect(particlesAfterRocket).toBeGreaterThanOrEqual(100);

    // 4. Check the shockwave in the DOM
    const shockwaveCount = await page.locator('.schockwelle').count();
    expect(shockwaveCount).toBeGreaterThanOrEqual(1);
  });

  test('Online multiplayer › rematch & restart: the host sees the start game button with a connected session and can start a rematch', async ({
    page,
  }) => {
    // 1. Set up the online host in the connected state
    await page.click('#gamemode-btn-online');
    await page.evaluate(() => {
      const s = window.__game.state;
      s.gameMode = 'online';
      s.network.isOnline = true;
      s.network.isHost = true;
      s.network.isClient = false;
      s.network.connected = true;
      s.network.roomCode = 'TEST1';
      window.__game.Network.updateOnlineLobbyUI();
    });

    // 2. Check the buttons
    const btnStart = page.locator('#btn-online-start');
    const btnLeave = page.locator('#btn-online-leave');
    await expect(btnStart).toBeVisible();
    await expect(btnLeave).toBeVisible();

    // 3. After game over and restart the start button must still be available to the host
    await page.evaluate(() => {
      window.__game.Utils.restartGame();
    });
    await expect(btnStart).toBeVisible();

    // 4. The host clicks start game -> the online match starts
    await btnStart.click();
    const stateAfterStart = await page.evaluate(() => ({
      gameRunning: window.__game.state.gameRunning,
      cutsceneActive: window.__game.state.cutsceneActive,
      lastEvent: window.__game.state.network.lastSentEvent,
    }));
    expect(stateAfterStart.gameRunning || stateAfterStart.cutsceneActive).toBe(true);
    expect(stateAfterStart.lastEvent.type).toBe('game_start');

    // 5. Test leaving the room
    await page.evaluate(() => {
      window.__game.Utils.restartGame();
    });
    await btnLeave.click();
    const actionsVisible = await page.locator('#online-lobby-actions').isVisible();
    expect(actionsVisible).toBe(true);
  });

  test('Global leaderboard: highscore tabs (SOLO, BOT CO-OP, ONLINE CO-OP) present on the game over screen and switchable', async ({
    page,
  }) => {
    // 1. Trigger game over
    await page.evaluate(() => {
      window.__game.state.score = 5000;
      window.__game.Utils.triggerGameOver();
    });

    const tabSingle = page.locator('#hs-tab-single');
    const tabBot = page.locator('#hs-tab-bot');
    const tabOnline = page.locator('#hs-tab-online');

    // 2. All 3 tabs must be visible with the correct label
    await expect(tabSingle).toBeVisible();
    await expect(tabSingle).toHaveText('SOLO');
    await expect(tabBot).toBeVisible();
    await expect(tabBot).toHaveText('BOT CO-OP');
    await expect(tabOnline).toBeVisible();
    await expect(tabOnline).toHaveText('ONLINE CO-OP');

    // 3. Tab switch to BOT CO-OP
    await tabBot.click();
    await expect(tabBot).toHaveClass(/active/);
    await expect(tabSingle).not.toHaveClass(/active/);
    await expect(tabOnline).not.toHaveClass(/active/);

    // 4. Tab switch to ONLINE CO-OP
    await tabOnline.click();
    await expect(tabOnline).toHaveClass(/active/);
    await expect(tabBot).not.toHaveClass(/active/);
    await expect(tabSingle).not.toHaveClass(/active/);

    // 5. Tab switch back to SOLO
    await tabSingle.click();
    await expect(tabSingle).toHaveClass(/active/);
    await expect(tabBot).not.toHaveClass(/active/);
    await expect(tabOnline).not.toHaveClass(/active/);
  });

  test('Global leaderboard: load and render global highscores with geo location (flag and city), rank and ships', async ({
    page,
  }) => {
    // Mock API route for global highscores
    await page.route('**/api/highscores?mode=single*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          mode: 'single',
          highscores: [
            { id: 1, name: 'FRK', score: 95000, level: 10, shipP1: 'viper', country: 'DE', city: 'Frankfurt' },
            { id: 2, name: 'PET', score: 82000, level: 8, shipP1: 'phantom', country: 'US', city: 'New York' },
            { id: 3, name: 'BEN', score: 71000, level: 7, shipP1: 'viper', country: 'JP', city: 'Tokyo' },
          ],
        }),
      });
    });

    // Trigger game over
    await page.evaluate(() => {
      window.__game.state.score = 5000;
      window.__game.Utils.triggerGameOver();
    });

    // Wait until the data is loaded and the table rendered
    const rows = page.locator('#highscore-body tr');
    await expect(rows).toHaveCount(3);

    // Check the status display
    const statusText = page.locator('#highscore-status-text');
    await expect(statusText).toContainText('GLOBALE BESTENLISTE');

    // Row 1: #1, FRK, 🇩🇪 (DE), 95000, Viper-X
    const row1 = rows.nth(0);
    await expect(row1).toContainText('#1');
    await expect(row1).toContainText('FRK');
    await expect(row1).toContainText('🇩🇪');
    await expect(row1).toContainText('95000');
    await expect(row1.locator('.hs-ship-viper')).toBeVisible();

    // Row 2: #2, PET, 🇺🇸 (US), 82000, Phantom-NX
    const row2 = rows.nth(1);
    await expect(row2).toContainText('#2');
    await expect(row2).toContainText('PET');
    await expect(row2).toContainText('🇺🇸');
    await expect(row2).toContainText('82000');
    await expect(row2.locator('.hs-ship-phantom')).toBeVisible();

    // Row 3: #3, BEN, 🇯🇵 (JP), 71000
    const row3 = rows.nth(2);
    await expect(row3).toContainText('#3');
    await expect(row3).toContainText('BEN');
    await expect(row3).toContainText('🇯🇵');
    await expect(row3).toContainText('71000');
  });

  test('Global leaderboard: the highscore submit transmits mode, name, score, ships and a valid SHA-256 hash', async ({
    page,
  }) => {
    let capturedRequest = null;

    // Intercept the route for POST
    await page.route('**/api/highscores', async route => {
      if (route.request().method() === 'POST') {
        capturedRequest = JSON.parse(route.request().postData());
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            rank: 1,
            entry: {
              mode: capturedRequest.mode,
              name: capturedRequest.name,
              score: capturedRequest.score,
              level: capturedRequest.level,
              shipP1: capturedRequest.shipP1,
              country: 'DE',
              city: 'Berlin',
            },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
        });
      }
    });

    // Prepare the game state and trigger game over
    await page.evaluate(() => {
      window.__game.state.score = 12500;
      window.__game.state.level = 4;
      window.__game.state.selectedShipModel = 'viper';
      window.__game.state.gameMode = 'single';
      window.__game.Utils.triggerGameOver();
    });

    // Fill in and submit the form
    const nameInput = page.locator('#highscore-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('MAX');

    const saveBtn = page.locator('#btn-save-score');
    await saveBtn.click();

    // Wait until the POST request was sent and captured
    await expect.poll(() => capturedRequest).not.toBeNull();
    expect(capturedRequest.mode).toBe('single');
    expect(capturedRequest.name).toBe('MAX');
    expect(capturedRequest.score).toBe(12500);
    expect(capturedRequest.level).toBe(4);
    expect(capturedRequest.shipP1).toBe('viper');
    expect(typeof capturedRequest.timestamp).toBe('number');
    expect(capturedRequest.hash).toMatch(/^[a-f0-9]{64}$/); // Valid 64-digit SHA-256 hex hash
  });

  test('Global leaderboard: the offline fallback switches to local highscores on a server error', async ({ page }) => {
    // 1. Prepare local highscores in localStorage
    await page.evaluate(() => {
      localStorage.setItem(
        'spaceShooterHighscores',
        JSON.stringify([{ name: 'LOC', score: 3333, ship: 'viper', mode: 'single' }]),
      );
    });

    // 2. Configure the route so it fails with 500 Internal Server Error
    await page.route('**/api/highscores*', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Server unavailable' }),
      });
    });

    // 3. GameOver triggern
    await page.evaluate(() => {
      window.__game.state.score = 1000;
      window.__game.Utils.triggerGameOver();
    });

    // 4. The status display must switch to offline (local)
    const statusText = page.locator('#highscore-status-text');
    await expect(statusText).toContainText('LOKALE BESTENLISTE (Offline)');

    // 5. The local entry must be rendered
    const rows = page.locator('#highscore-body tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('LOC');
    await expect(rows.nth(0)).toContainText('3333');
  });

  test('Global leaderboard: the cheat lock prevents a submit to the global leaderboard', async ({ page }) => {
    let postRequestSent = false;

    // Intercept the route for POST
    await page.route('**/api/highscores', async route => {
      if (route.request().method() === 'POST') {
        postRequestSent = true;
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
        });
      }
    });

    // Activate a cheat and save a highscore
    await page.evaluate(() => {
      window.__game.state.cheatUsed = true;
      window.__game.state.score = 50000;
      window.__game.Utils.saveHighscore('CHT', 50000);
    });

    await page.waitForTimeout(500);

    // No POST must have been sent to the global API
    expect(postRequestSent).toBe(false);
  });

  test('Online multiplayer bug 1: the ship choice of host and client is synchronized correctly and not swapped', async ({
    page,
  }) => {
    // 1. Client scenario: the client picks 'viper' in the hangar and joins the online lobby
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.selectedShipModel = 'viper';
      mod.state.selectedShipColor = 'red';
      mod.state.gameMode = 'online';
      mod.state.network.isClient = true;
      mod.state.network.isHost = false;
      mod.state.network.connected = true;

      // The client receives game_start from the host, who picked 'phantom' (blue)
      mod.Network.handleNetworkEvent({
        type: 'game_start',
        hostShipModel: 'phantom',
        hostShipColor: 'blue',
      });
    });

    const clientState = await page.evaluate(() => {
      const mod = window.__game;
      return {
        p1Model: mod.state.selectedShipModel,
        p2Model: mod.state.p2.selectedShipModel,
      };
    });

    // P1 (host) must be the Phantom, P2 (client) must be the Viper
    expect(clientState.p1Model).toBe('phantom');
    expect(clientState.p2Model).toBe('viper');

    // 2. Host scenario: the host picks 'phantom' and receives client_ready from the client with 'viper'
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.selectedShipModel = 'phantom';
      mod.state.gameMode = 'online';
      mod.state.network.isHost = true;
      mod.state.network.isClient = false;
      mod.state.network.connected = true;
      // Preset P2 deliberately differently, otherwise 'viper' would already be set from the client scenario
      mod.state.p2.selectedShipModel = 'gleve';
      mod.state.p2.selectedShipColor = 'green';

      mod.Network.handleNetworkEvent({
        type: 'client_ready',
        clientShipModel: 'viper',
        clientShipColor: 'red',
      });
    });

    const hostState = await page.evaluate(() => {
      const mod = window.__game;
      return {
        p1Model: mod.state.selectedShipModel,
        p2Model: mod.state.p2.selectedShipModel,
        p2Color: mod.state.p2.selectedShipColor,
      };
    });

    // Host: P1=Phantom, P2=Viper in the client color
    expect(hostState.p1Model).toBe('phantom');
    expect(hostState.p2Model).toBe('viper');
    expect(hostState.p2Color).toBe('red');
  });

  test('Online multiplayer bug 3: particles on the client animate, decay and are removed from DOM and array', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.gameMode = 'online';
      mod.state.gameRunning = true;
      mod.state.network.isClient = true;
      mod.state.network.isHost = false;
      mod.state.network.connected = true;

      // Clear the particle array
      mod.arrays.particleArray.length = 0;

      // Trigger an explosion on the client
      mod.Utils.createExplosion(200, 200, '#f1c40f', 5);

      // Give particles a fast decay manually for the test
      mod.arrays.particleArray.forEach(p => {
        p.lives = 0.2;
        p.decay = 0.1;
      });

      // Simulate 3 frames in the game loop (0.2 -> 0.1 -> 0.0 -> deleted)
      mod.Loop.simulationStep();
      mod.Loop.simulationStep();
      mod.Loop.simulationStep();
    });

    const result = await page.evaluate(() => {
      const mod = window.__game;
      const domParticles = document.querySelectorAll('.partikel');
      return {
        arrayCount: mod.arrays.particleArray.length,
        domCount: domParticles.length,
      };
    });

    expect(result.arrayCount).toBe(0);
    expect(result.domCount).toBe(0);
  });

  test('Online multiplayer bug 4: in online mode only the host sends exactly ONE global highscore submit with the correct ships', async ({
    page,
  }) => {
    let postRequests = [];

    await page.route('**/api/highscores*', async route => {
      if (route.request().method() === 'POST') {
        const payload = JSON.parse(route.request().postData() || '{}');
        postRequests.push(payload);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, rank: 1, entry: payload }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, mode: 'online', highscores: [] }),
        });
      }
    });

    // 1. The client simulates a commit: the client must NOT send a global POST
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.gameMode = 'online';
      mod.state.network.isOnline = true;
      mod.state.network.isClient = true;
      mod.state.network.isHost = false;
      mod.state.selectedShipModel = 'phantom';
      mod.state.p2.selectedShipModel = 'viper';
      mod.state.finalScore = 8500;
      mod.state.level = 4;
      mod.state.onlineHighscoreNames = { p1: 'AAA', p2: 'BBB' };

      mod.Utils.checkAndCommitOnlineHighscore();
    });

    await page.waitForTimeout(300);

    // The client sent no request
    expect(postRequests.length).toBe(0);

    // 2. The host simulates a commit: the host MUST send exactly 1 global POST with the right ships
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.gameMode = 'online';
      mod.state.network.isOnline = true;
      mod.state.network.isHost = true;
      mod.state.network.isClient = false;
      mod.state.selectedShipModel = 'phantom';
      mod.state.p2.selectedShipModel = 'viper';
      mod.state.finalScore = 8500;
      mod.state.level = 4;
      mod.state.onlineHighscoreNames = { p1: 'AAA', p2: 'BBB' };

      mod.Utils.checkAndCommitOnlineHighscore();
    });

    await page.waitForTimeout(300);

    // Exactly 1 submit from the host
    expect(postRequests.length).toBe(1);
    expect(postRequests[0].name).toBe('AAA+BBB');
    expect(postRequests[0].mode).toBe('online');
    expect(postRequests[0].score).toBe(8500);
    expect(postRequests[0].shipP1).toBe('phantom');
    expect(postRequests[0].shipP2).toBe('viper');
  });

  test('Online multiplayer issue 1: the energy & cooldown HUD is synced to the client and the host blocks the laser on insufficient minimum energy', async ({
    page,
  }) => {
    // 1. Client-HUD-Sync testen
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.gameMode = 'online';
      mod.state.gameRunning = true;
      mod.state.network.isClient = true;
      mod.state.network.isHost = false;
      mod.state.network.connected = true;

      const mockSnapshot = {
        p1: { x: 200, y: 300, energy: 40, maxEnergy: 100, missileCooldown: 0, bombCooldown: 0 },
        p2: {
          x: 350,
          y: 400,
          energy: 10, // unter minZuendEnergie (15)
          maxEnergy: 100,
          missileCooldown: 90,
          bombCooldown: 600,
          laserShoots: false,
        },
        enemies: [],
        asteroids: [],
        bosses: [],
        laser: [],
        missiles: [],
        bombs: [],
        powerups: [],
      };

      mod.Network.applyGameStateSnapshot(mockSnapshot);
    });

    const hudState = await page.evaluate(() => {
      const eBarP2 = document.getElementById('energie-balken-p2');
      const rBarP2 = document.getElementById('raketen-cd-balken-p2');
      const bBarP2 = document.getElementById('bomben-cd-balken-p2');
      return {
        eWidth: eBarP2 ? eBarP2.style.width : '',
        eColor: eBarP2 ? eBarP2.style.backgroundColor : '',
        rWidth: rBarP2 ? rBarP2.style.width : '',
        bWidth: bBarP2 ? bBarP2.style.width : '',
      };
    });

    // The P2 energy bar must be at 10% and carry the warning color (#e67e22) for below the minimum energy
    expect(hudState.eWidth).toBe('10%');
    expect(hudState.eColor).toBe('rgb(230, 126, 34)'); // #e67e22
    expect(hudState.rWidth).not.toBe('');
    expect(hudState.bWidth).not.toBe('');

    // 2. Test the host minimum ignition energy check
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.gameMode = 'online';
      mod.state.gameRunning = true;
      mod.state.network.isHost = true;
      mod.state.network.isClient = false;
      mod.state.network.connected = true;

      mod.state.p2.energy = 10; // below minFuseEnergy (15)
      mod.state.p2.minFuseEnergy = 15;
      mod.state.p2.laserShoots = false;

      // Client fordert Laser an
      mod.Network.applyPlayerInput({ laser: true });

      // Host simuliert einen Frame im GameLoop
      mod.Loop.simulationStep();
    });

    const hostP2Laser = await page.evaluate(() => window.__game.state.p2.laserShoots);
    // Since 10 < 15 the laser must not be activated
    expect(hostP2Laser).toBe(false);
  });

  test('Online multiplayer issue 2: the host takes the client ship choice from client_ready and updates the SVG and the game_start event', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.gameMode = 'online';
      mod.state.network.isOnline = true;
      mod.state.network.isHost = true;
      mod.state.network.isClient = false;
      mod.state.network.connected = true;
      mod.state.selectedShipModel = 'phantom';
      mod.state.p2.selectedShipModel = 'phantom'; // initial default

      // The host receives client_ready from the client, who picked the Viper
      mod.Network.handleNetworkEvent({
        type: 'client_ready',
        clientShipModel: 'viper',
        clientShipColor: 'green',
      });
    });

    const hostP2State = await page.evaluate(() => {
      const mod = window.__game;
      const s2Svg = mod.dom.player2 ? mod.dom.player2.querySelector('svg') : null;
      return {
        model: mod.state.p2.selectedShipModel,
        color: mod.state.p2.selectedShipColor,
        hasViperSvg: s2Svg
          ? s2Svg.innerHTML.includes('#2ecc71') ||
            s2Svg.innerHTML.includes('#27ae60') ||
            s2Svg.innerHTML.includes('viper')
          : false,
      };
    });

    expect(hostP2State.model).toBe('viper');
    expect(hostP2State.color).toBe('green');
  });

  test('Online multiplayer issue 3: the client updates the leaderboard after the highscore_committed event from the host', async ({
    page,
  }) => {
    // Mock the route: old list before, new list after the refresh
    let callCount = 0;
    await page.route('**/api/highscores*', async route => {
      callCount++;
      if (callCount <= 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            mode: 'online',
            highscores: [{ name: 'OLD+OLD', score: 1000, shipP1: 'viper', shipP2: 'phantom', level: 1 }],
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            mode: 'online',
            highscores: [{ name: 'NEW+WIN', score: 9999, shipP1: 'viper', shipP2: 'viper', level: 5 }],
          }),
        });
      }
    });

    // 1. The client initializes the leaderboard with the old list
    await page.evaluate(async () => {
      const mod = window.__game;
      mod.state.gameMode = 'online';
      mod.state.network.isOnline = true;
      mod.state.network.isClient = true;
      mod.state.network.isHost = false;
      mod.state.network.connected = true;
      mod.state.currentHighscoreTab = 'online';

      mod.Utils.renderHighscores('online');
    });

    // renderHighscores loads asynchronously: a waiting assertion instead of reading immediately
    await expect(page.locator('#highscore-body')).toContainText('OLD+OLD');

    // 2. The client receives the highscore_committed event from the host
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Network.handleNetworkEvent({
        type: 'highscore_committed',
      });
    });

    // 3. The client leaderboard must now show NEW+WIN
    await expect(page.locator('#highscore-body')).toContainText('NEW+WIN');
    await expect(page.locator('#highscore-body')).toContainText('9999');
  });

  test('Online multiplayer issue 4: only L, K, space (and WASD) control actions; ö and ä are disabled in online mode', async ({
    page,
  }) => {
    const inputResults = await page.evaluate(() => {
      const mod = window.__game;
      mod.state.gameMode = 'online';
      mod.state.network.isOnline = true;
      mod.state.network.isClient = true;

      // Reset all keys
      Object.keys(mod.state.keysPressed).forEach(k => {
        mod.state.keysPressed[k] = false;
      });

      // 1. Press the local co-op keys ö and ä
      mod.state.keysPressed['ö'] = true;
      mod.state.keysPressed['ä'] = true;
      const coopKeysInput = mod.Network.serializePlayerInput();

      // 2. Press the regular keys: L, K, space
      mod.state.keysPressed['ö'] = false;
      mod.state.keysPressed['ä'] = false;
      mod.state.keysPressed.l = true;
      mod.state.keysPressed.k = true;
      mod.state.keysPressed[' '] = true;
      const standardKeysInput = mod.Network.serializePlayerInput();

      return {
        coopKeysInput,
        standardKeysInput,
      };
    });

    // ö and ä must trigger neither missile nor bomb in online mode
    expect(inputResults.coopKeysInput.missile).toBe(false);
    expect(inputResults.coopKeysInput.bomb).toBe(false);

    // L, K and space must fire
    expect(inputResults.standardKeysInput.laser).toBe(true);
    expect(inputResults.standardKeysInput.missile).toBe(true);
    expect(inputResults.standardKeysInput.bomb).toBe(true);
  });

  test('In local co-op mode with a bot partner player 1 can use the standard controls L (laser), K (missile) and space (bomb)', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.gameMode = 'coop';
      mod.state.p2IsBot = true; // Bot active
      mod.state.gameRunning = true;
      mod.state.energy = 100;
      mod.state.missileCooldown = 0;
      mod.state.bombCooldown = 0;

      // Reset key presses
      Object.keys(mod.state.keysPressed).forEach(k => {
        mod.state.keysPressed[k] = false;
      });

      // Press L (laser), K (missile), space (bomb)
      mod.state.keysPressed.l = true;
      mod.state.keysPressed.k = true;
      mod.state.keysPressed[' '] = true;

      // Run 1 frame of the game loop
      mod.Loop.simulationStep();
    });

    const p1Actions = await page.evaluate(() => {
      const mod = window.__game;
      return {
        laserShoots: mod.state.laserShoots,
        missileCooldown: mod.state.missileCooldown,
        bombCooldown: mod.state.bombCooldown,
        missileCount: mod.arrays.missileArray.filter(r => r.owner === 'p1').length,
        bombCount: mod.arrays.bombArray.filter(b => b.owner === 'p1').length,
      };
    });

    expect(p1Actions.laserShoots).toBe(true);
    expect(p1Actions.missileCooldown).toBeGreaterThan(0);
    expect(p1Actions.bombCooldown).toBeGreaterThan(0);
    expect(p1Actions.missileCount).toBeGreaterThanOrEqual(1);
    expect(p1Actions.bombCount).toBeGreaterThanOrEqual(1);
  });

  test('Online multiplayer ship choice: the client keeps the Viper chosen in its hangar on game_start and does not overwrite it with the old host default', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.gameMode = 'online';
      mod.state.network.isOnline = true;
      mod.state.network.isClient = true;
      mod.state.network.isHost = false;
      mod.state.network.connected = true;

      // The client picked the Viper in the hangar
      mod.state.selectedShipModel = 'viper';
      mod.state.selectedShipColor = 'green';
      if (mod.state.p2) {
        mod.state.p2.selectedShipModel = 'viper';
        mod.state.p2.selectedShipColor = 'green';
      }

      // The host sends game_start (the host sent a stale clientShipModel 'phantom')
      mod.Network.handleNetworkEvent({
        type: 'game_start',
        hostShipModel: 'phantom',
        hostShipColor: 'blue',
        clientShipModel: 'phantom', // Stale Host Default
        clientShipColor: 'blue',
      });
    });

    const clientP2State = await page.evaluate(() => {
      const mod = window.__game;
      const s2Svg = mod.dom.player2 ? mod.dom.player2.querySelector('svg') : null;
      const speed = (mod.shipModels && mod.shipModels[mod.state.p2.selectedShipModel]?.speed) || 0;
      return {
        modelP2: mod.state.p2.selectedShipModel,
        colorP2: mod.state.p2.selectedShipColor,
        speedP2: speed,
        hasViperSvg: s2Svg ? s2Svg.innerHTML.includes('#2ecc71') || s2Svg.innerHTML.includes('#27ae60') : false,
      };
    });

    // The client must keep flying the Viper (its speed, green color)
    const viperSpeed = await page.evaluate(() => window.__game.shipModels.viper.speed);
    expect(clientP2State.modelP2).toBe('viper');
    expect(clientP2State.colorP2).toBe('green');
    expect(clientP2State.speedP2).toBe(viperSpeed);
    expect(clientP2State.hasViperSvg).toBe(true);
  });

  test('Splitter drops: in solo mode with the Phantom-NX enemies and bosses drop no splitters', async ({ page }) => {
    const dropResults = await page.evaluate(() => {
      const mod = window.__game;
      mod.state.gameMode = 'single';
      mod.state.selectedShipModel = 'phantom';
      mod.state.viperKillCount = 0;

      // Clear existing powerups
      mod.arrays.powerups.forEach(p => {
        if (p.el) p.el.remove();
      });
      mod.arrays.powerups.length = 0;
      mod.arrays.bosses.forEach(b => {
        if (b.el) b.el.remove();
      });
      mod.arrays.bosses.length = 0;

      // Destroy 10 enemies with the Phantom
      for (let i = 0; i < 10; i++) {
        const enemy = { isEnemy: true, size: 30, x: 100, y: 100, el: document.createElement('div') };
        mod.arrays.enemies.push(enemy);
        mod.Utils.destroyTarget(enemy, 'p1');
      }

      const enemyDropShards = mod.arrays.powerups.filter(
        p => p.type === 'splitterRed' || p.type === 'splitterWhite',
      ).length;

      // Destroy a boss with the Phantom
      mod.Entities.createBoss();
      const boss = mod.arrays.bosses[0];
      mod.Utils.destroyTarget(boss, 'p1');

      const allShards = mod.arrays.powerups.filter(p => p.type === 'splitterRed' || p.type === 'splitterWhite').length;
      const regularPowerups = mod.arrays.powerups.filter(
        p => p.type !== 'splitterRed' && p.type !== 'splitterWhite',
      ).length;

      return {
        enemyDropShards,
        allShards,
        regularPowerups,
      };
    });

    // The Phantom must get no splitters from enemies or the boss
    expect(dropResults.enemyDropShards).toBe(0);
    expect(dropResults.allShards).toBe(0);
    expect(dropResults.regularPowerups).toBe(3); // Only the 3 regular boss powerups
  });

  test('Splitter drops: in co-op mode splitters drop only for Viper players and none when both fly the Phantom', async ({
    page,
  }) => {
    const coopResults = await page.evaluate(() => {
      const mod = window.__game;
      mod.state.gameMode = 'coop';

      function resetDrops() {
        mod.arrays.powerups.forEach(p => {
          if (p.el) p.el.remove();
        });
        mod.arrays.powerups.length = 0;
        mod.arrays.bosses.forEach(b => {
          if (b.el) b.el.remove();
        });
        mod.arrays.bosses.length = 0;
        mod.state.viperKillCount = 0;
        if (mod.state.p2) mod.state.p2.viperKillCount = 0;
      }

      // --- SCENARIO 1: BOTH PHANTOM ---
      resetDrops();
      mod.state.selectedShipModel = 'phantom';
      mod.state.p2.selectedShipModel = 'phantom';

      // 10 Kills P1, 10 Kills P2
      for (let i = 0; i < 10; i++) {
        const f1 = { isEnemy: true, size: 30, x: 100, y: 100, el: document.createElement('div') };
        mod.arrays.enemies.push(f1);
        mod.Utils.destroyTarget(f1, 'p1');
        const f2 = { isEnemy: true, size: 30, x: 100, y: 100, el: document.createElement('div') };
        mod.arrays.enemies.push(f2);
        mod.Utils.destroyTarget(f2, 'p2');
      }

      // Boss Kill
      mod.Entities.createBoss();
      mod.Utils.destroyTarget(mod.arrays.bosses[0], 'p1');
      const bothPhantomShards = mod.arrays.powerups.filter(p => p.type === 'splitterRed' || p.type === 'splitterWhite');

      // --- SCENARIO 2: P1 PHANTOM, P2 VIPER ---
      resetDrops();
      mod.state.selectedShipModel = 'phantom';
      mod.state.p2.selectedShipModel = 'viper';

      // 10 Kills P1 (Phantom) -> 0 Drops
      for (let i = 0; i < 10; i++) {
        const f = { isEnemy: true, size: 30, x: 100, y: 100, el: document.createElement('div') };
        mod.arrays.enemies.push(f);
        mod.Utils.destroyTarget(f, 'p1');
      }
      const p1PhantomKillsShards = mod.arrays.powerups.filter(
        p => p.type === 'splitterRed' || p.type === 'splitterWhite',
      ).length;

      // 10 kills by P2 (Viper) -> 1 drop for P2
      for (let i = 0; i < 10; i++) {
        const f = { isEnemy: true, size: 30, x: 100, y: 100, el: document.createElement('div') };
        mod.arrays.enemies.push(f);
        mod.Utils.destroyTarget(f, 'p2');
      }
      const p2ViperKillsShards = mod.arrays.powerups.filter(
        p => (p.type === 'splitterRed' || p.type === 'splitterWhite') && p.owner === 'p2',
      ).length;

      // Boss Kill durch P1 (Phantom) -> Splitter gehen an P2 (Viper)
      mod.Entities.createBoss();
      mod.Utils.destroyTarget(mod.arrays.bosses[0], 'p1');
      const bossShardsToP2 = mod.arrays.powerups.filter(
        p => (p.type === 'splitterRed' || p.type === 'splitterWhite') && p.owner === 'p2',
      ).length;
      const shardsToP1 = mod.arrays.powerups.filter(
        p => (p.type === 'splitterRed' || p.type === 'splitterWhite') && p.owner === 'p1',
      ).length;

      return {
        bothPhantomShardCount: bothPhantomShards.length,
        p1PhantomKillsShards,
        p2ViperKillsShards,
        bossShardsToP2,
        shardsToP1,
      };
    });

    // Beide Phantom -> 0 Splitter
    expect(coopResults.bothPhantomShardCount).toBe(0);

    // P1 Phantom Kill -> 0 Splitter
    expect(coopResults.p1PhantomKillsShards).toBe(0);

    // P2 Viper kill -> 1 splitter for P2
    expect(coopResults.p2ViperKillsShards).toBe(1);

    // Boss splitters go only to P2 (Viper), none to P1 (Phantom)
    expect(coopResults.bossShardsToP2).toBe(4); // 1 from minion kills + 3 from the boss
    expect(coopResults.shardsToP1).toBe(0);
  });

  test('Issue 11: a highscore list with many entries is scrollable and limited in height', async ({ page }) => {
    // Show the game over screen with the leaderboard (as utils.js does at the end of the game)
    await page.evaluate(() => {
      document.getElementById('game-over-screen').style.display = 'flex';
    });
    const container = page.locator('.highscore-table-container');
    await expect(container).toBeVisible();

    const measured = await page.evaluate(async () => {
      const utilsMod = await import('./js/utils.js');
      const list = [];
      for (let i = 0; i < 30; i++) {
        list.push({ name: 'P' + i, score: 3000 - i * 10, shipP1: 'viper', level: 1 });
      }
      utilsMod.renderHighscoresTable('single', list);
      const el = document.querySelector('.highscore-table-container');
      return {
        lines: document.querySelectorAll('#highscore-body tr').length,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    });

    expect(measured.lines).toBe(30);
    // The content is taller than the visible area -> scrollable
    expect(measured.scrollHeight).toBeGreaterThan(measured.clientHeight);
    // The container does not grow with the list
    expect(measured.clientHeight).toBeLessThan(400);

    // It can actually be scrolled
    const scrolled = await container.evaluate(el => {
      el.scrollTop = 50;
      return el.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
  });
});
