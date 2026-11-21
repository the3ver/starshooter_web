// Measurement logic of the balancing bench, shared by npm run balancing and the smoke test in tests/
const { setGameState } = require('../tests/helpers');

// Runs in the browser before every page script: replace Math.random with mulberry32
function installSeed() {
  window.__setSeed = seed => {
    let a = seed >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  window.__setSeed(1);
}

// Setup and run happen synchronously after the imports, so the real rAF loop cannot interfere
async function measure(page, { ship, scenario, seed, maxSteps }) {
  return page.evaluate(
    async ({ ship, scenario, seed, maxSteps }) => {
      const Gleve = await import('./js/gleve.js');
      const Sniper = await import('./js/sniper.js');
      const Bot = await import('./js/bot.js');
      const { state, arrays, Entities, Loop, shipModels, config } = window.__game;
      window.__setSeed(seed);

      // Clean initial state as at game start (the real loop has already made any number of steps)
      window.__game.Utils.restartGame();
      // restartGame resets the playfield to menu width; the game is played in the co-op field as on a real start
      window.__game.Utils.applyPlayfieldWidth('coop');
      state.gameRunning = true;
      window.__game.dom.player.style.display = 'block';
      window.__game.dom.player2.style.display = 'block';
      state.frameCounter = 1;
      // Stars consume random values when wrapping; their position depends on the real steps before
      arrays.stars.forEach((star, i) => {
        star.y = (i * 47) % config.playfieldHeight;
        star.x = (i * 83) % config.playfieldWidth;
      });

      // Clear the field
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
        'bombArray',
      ].forEach(name => {
        arrays[name].forEach(o => o.el && o.el.remove());
        arrays[name].length = 0;
      });
      Object.keys(state.keysPressed).forEach(k => {
        state.keysPressed[k] = false;
      });
      state.bossActive = false;
      state.bossWarningActive = false;
      state.hacks = [];

      // P1: spectator only
      // godMode also protects P2, so keep P1 invulnerable via permanent i-frames
      state.godMode = false;
      state.autolaserActive = false;

      // P2 bot with the ship as on a real start (values as in restartGame)
      const p2 = state.p2;
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      p2.selectedShipModel = ship;
      p2.lives = 3;
      p2.maxEnergy = 50;
      p2.energy = 50;
      p2.laserTier = 1;
      p2.missileTier = 1;
      p2.bombTier = 1;
      p2.laserPierce = false;
      p2.pierceTimer = 0;
      p2.phantomShieldRegenTimer = 0;
      p2.autolaserActive = false;
      p2.autolaserTimer = 0;
      p2.missileCooldown = 0;
      p2.bombCooldown = 0;
      p2.playerShotCooldown = 0;
      p2.invulnerableTimer = 0;
      p2.isDead = false;
      p2.hacks = [];
      p2.splitterRed = 0;
      p2.splitterWhite = 0;
      p2.viperKillCount = 0;
      p2.shieldTier = (shipModels[ship] && shipModels[ship].startShield) || 0;
      p2.x = 370;
      p2.y = 285;
      Gleve.setDashChargeFull(p2);
      Sniper.reset(p2);
      Bot.resetBot();
      const shieldStart = p2.shieldTier;

      // Build the scenario
      state.level = scenario === 'C_boss2' ? 2 : 1;
      state.frameCounter = 1;
      const isBoss = scenario !== 'A_wave';
      if (isBoss) {
        Entities.createBoss();
      } else {
        const pattern = ['normal', 'normal', 'normal', 'stopAndGo', 'stopAndGo', 'stopAndGo', 'normal', 'normal'];
        const xs = [40, 110, 180, 250, 320, 390, 470, 540];
        const ys = [-30, -60, -30, -90, -30, -60, -30, -90];
        for (let i = 0; i < 8; i++) {
          Entities.createEnemy(xs[i], ys[i], pattern[i], 0, i >= 6);
        }
      }

      let steps = 0;
      let victory = false;
      let hit = 0;
      let kills = 0;
      let escaped = 0;
      let bossHpRest = null;
      while (steps < maxSteps) {
        state.frameCounter = 1; // no natural spawns
        state.x = 560;
        state.y = 560;
        state.invulnerableTimer = 1e9;
        state.isDead = false;
        state.autolaserActive = false;
        state.autolaserTimer = 0;
        const beforehandEnemies = arrays.enemies.slice();
        Loop.simulationStep();
        steps++;
        if (state.gameOverActive) throw new Error('Game Over im Messlauf');
        // Enemy exits: inside the field = defeated (or rammed), outside = escaped
        for (const f of beforehandEnemies) {
          if (!arrays.enemies.includes(f)) {
            if (
              f.y > config.playfieldHeight ||
              f.x < -f.size - 50 ||
              f.x > config.playfieldWidth + 50 ||
              f.y < -f.size - 10
            )
              escaped++;
            else kills++;
          }
        }
        if (p2.lives * 10 + p2.shieldTier < 3 * 10 + shieldStart) hit++;
        p2.lives = 3;
        p2.shieldTier = shieldStart;
        p2.isDead = false;
        if (isBoss ? arrays.bosses.length === 0 : arrays.enemies.length === 0) {
          victory = true;
          break;
        }
      }
      if (isBoss && arrays.bosses[0]) bossHpRest = Math.round(arrays.bosses[0].hp);
      return { steps, victory, hit, kills, escaped, bossHpRest };
    },
    { ship, scenario, seed, maxSteps },
  );
}

// Load the page, install the seed hook and start a co-op game with the bot ship as P2
async function prepareMeasurement(page, ship) {
  await page.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await setGameState(page);
  await page.addInitScript(installSeed);
  await page.goto('/');
  await page.evaluate(s => {
    window.__game.Utils.setGameMode('coop');
    window.__game.state.p2IsBot = true;
    window.__game.state.p2BotDifficulty = 'hard';
    window.__game.state.p2.selectedShipModel = s;
  }, ship);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  await page.keyboard.up('KeyW');
}

module.exports = { measure, prepareMeasurement };
