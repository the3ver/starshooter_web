// Messlogik des Balancing-Messstands, gemeinsam fuer npm run balancing und den Rauchtest in tests/
const { setGameState } = require('../tests/helpers');

// Laeuft im Browser vor jedem Seitenskript: Math.random durch mulberry32 ersetzen
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

// Aufbau und Lauf passieren synchron nach den Imports, damit die echte rAF-Schleife nicht dazwischenfunkt
async function measure(page, { ship, scenario, seed, maxSteps }) {
  return page.evaluate(
    async ({ ship, scenario, seed, maxSteps }) => {
      const Gleve = await import('./js/gleve.js');
      const Sniper = await import('./js/sniper.js');
      const Bot = await import('./js/bot.js');
      const { state, arrays, Entities, Loop, shipModels, config } = window.__game;
      window.__setSeed(seed);

      // Sauberer Ausgangszustand wie beim Spielstart (die echte Schleife hat vorher beliebig viele Schritte gemacht)
      window.__game.Utils.restartGame();
      // restartGame setzt das Spielfeld auf Menuebreite zurueck; gespielt wird im Co-op-Feld wie beim echten Start
      window.__game.Utils.applyPlayfieldWidth('coop');
      state.gameRunning = true;
      window.__game.dom.player.style.display = 'block';
      window.__game.dom.player2.style.display = 'block';
      state.frameCounter = 1;
      // Sterne verbrauchen beim Umbruch Zufallswerte; ihre Lage haengt von den echten Schritten davor ab
      arrays.stars.forEach((star, i) => {
        star.y = (i * 47) % config.playfieldHeight;
        star.x = (i * 83) % config.playfieldWidth;
      });

      // Feld leeren
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

      // P1: nur Zuschauer
      // godMode schuetzt auch P2, deshalb P1 ueber Dauer-I-Frames unverwundbar halten
      state.godMode = false;
      state.autolaserActive = false;

      // P2-Bot mit dem Schiff wie beim echten Start (Werte analog restartGame)
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

      // Szenario aufbauen
      state.level = scenario === 'C_boss2' ? 2 : 1;
      state.frameCounter = 1;
      const isBoss = scenario !== 'A_welle';
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
        state.frameCounter = 1; // keine natuerlichen Spawns
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
        // Feind-Abgaenge: im Feld = besiegt (oder Rammstoss), ausserhalb = entkommen
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

// Seite laden, Seed-Hook installieren und ein Co-op-Spiel mit dem Bot-Schiff als P2 starten
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
