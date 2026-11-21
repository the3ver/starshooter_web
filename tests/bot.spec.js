const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helfer');

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

// Coop-Spiel mit Bot-Partner (Phantom) starten und das Feld leeren
async function startBotGame(page) {
  await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  await page.keyboard.up('KeyW');
  await page.evaluate(async () => {
    const Bot = await import('./js/bot.js');
    window.__botTest = {
      Bot,
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
        state.frameCounter = 1;
        state.hacks = [];
        state.p2IsBot = true;
        state.p2BotDifficulty = 'normal';
        Bot.resetBot();
      },
    };
  });
}

test('Bot bevorzugt Gegnerschiffe vor Asteroiden und ignoriert unzerstoerbare Asteroiden', async ({ page }) => {
  await startBotGame(page);
  const r = await page.evaluate(() => {
    const { state, arrays, Entities } = window.__game;
    const T = window.__botTest;
    const target = () => T.Bot.findBestTarget(state.p2, { aimCorridor: 30 });
    T.empty();
    state.p2.x = 300;
    state.p2.y = 500;

    const asteroid = (x, y, g) => {
      Entities.createAsteroid(x, y, g, 0, 0, 0, true);
      return arrays.asteroids[arrays.asteroids.length - 1];
    };

    // Asteroid nah, Feind weiter weg: Feind gewinnt
    asteroid(290, 420, 20);
    Entities.createEnemy(80, 100, 'normal', 0, false);
    const withEnemy = target();

    // Nur ein Magma-Asteroid: kein Ziel
    T.empty();
    const magma = asteroid(290, 400, 40);
    Object.assign(magma, { isMagma: true, isIndestructible: true, carriesPowerup: false });
    const onlyMagma = { target: target(), indestructible: !!magma.isIndestructible };

    // Magma plus normaler Asteroid: der normale wird gewaehlt
    asteroid(100, 200, 20);
    const withNormal = target();
    return { withEnemy, onlyMagma, withNormal };
  });
  expect(r.withEnemy).toBeTruthy();
  expect(r.withEnemy.x).toBe(95);
  expect(r.onlyMagma.indestructible).toBe(true);
  expect(r.onlyMagma.target).toBeNull();
  expect(r.withNormal.x).toBeLessThan(150);
});

test('Bot laesst sich vom Jaeger-Boss (Typ 2) nicht an den Rand draengen und weicht seinen Schuessen aus', async ({
  page,
}) => {
  await startBotGame(page);
  const r = await page.evaluate(() => {
    const { state, arrays, Entities, Loop } = window.__game;
    const T = window.__botTest;
    T.empty();
    state.level = 2;
    state.godMode = true; // P1 steht nur als Zuschauer in der Ecke
    state.x = 560;
    state.y = 560;
    state.p2.x = 285;
    state.p2.y = 500;
    state.p2.shieldTier = 0;
    state.p2.lives = 3;
    Entities.createBoss();
    const b = arrays.bosses[0];
    Object.assign(b, { phase: 'kampf', y: 20, bombTimer: 1e9, missileTimer: 1e9, hackTimer: 1e9 });

    let minX = Infinity;
    let hit = 0;
    let beforehand = state.p2.lives * 10 + state.p2.shieldTier;
    for (let i = 0; i < 900; i++) {
      state.frameCounter = 1; // keine Spawns
      state.x = 560;
      state.y = 560;
      Loop.simulationStep();
      minX = Math.min(minX, state.p2.x);
      const now = state.p2.lives * 10 + state.p2.shieldTier;
      if (now < beforehand) hit++;
      // Zustand fuer die naechste Messung wiederherstellen
      state.p2.lives = 3;
      state.p2.shieldTier = 0;
      state.p2.invulnerableTimer = 0;
      state.p2.isDead = false;
      beforehand = 30;
    }
    return { minX, hit, typ: b.bossTyp };
  });
  expect(r.typ).toBe(2);
  expect(r.minX).toBeGreaterThan(30);
  expect(r.hit).toBeLessThanOrEqual(2);
});

test('Bot-Gleve fliegt in Sweep-Reichweite unter den Boss und dasht gegen ihn: Boss verliert deutlich HP', async ({
  page,
}) => {
  await startBotGame(page);
  const r = await page.evaluate(() => {
    const { state, arrays, Entities, Loop } = window.__game;
    const T = window.__botTest;
    T.empty();
    state.level = 1;
    state.invulnerableTimer = 1e9; // P1 steht nur als Zuschauer weit weg
    state.x = 560;
    state.y = 560;
    const p2 = state.p2;
    p2.selectedShipModel = 'gleve';
    p2.x = 285;
    p2.y = 500;
    p2.shieldTier = 0;
    p2.lives = 3;
    Entities.createBoss();
    const b = arrays.bosses[0];
    Object.assign(b, { phase: 'kampf', y: 20, shotTimer: 1e9, bombTimer: 1e9, missileTimer: 1e9, hackTimer: 1e9 });

    let dashes = 0;
    let beforehandDash = false;
    for (let i = 0; i < 600; i++) {
      state.frameCounter = 1; // keine Spawns
      state.x = 560;
      state.y = 560;
      b.shotTimer = 1e9;
      Loop.simulationStep();
      const dash = (p2.gleveDashTimer || 0) > 0;
      if (dash && !beforehandDash && b.hp > 0) dashes++;
      beforehandDash = dash;
      p2.lives = 3;
      p2.shieldTier = 0;
      p2.isDead = false;
      if (b.hp <= 0) break;
    }
    return { hpShare: arrays.bosses.length ? b.hp / b.maxHp : 0, dashes };
  });
  expect(r.hpShare).toBeLessThan(0.8);
  expect(r.dashes).toBeGreaterThanOrEqual(1);
});
