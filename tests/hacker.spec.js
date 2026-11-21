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

// Spiel starten und Spielfeld von zufälligen Spawns befreien
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

test.describe('Hacker-Gegner', () => {
  test('erzeugeFeind mit Muster hacker erzeugt gruenen Hacker ohne Schild mit 20 HP', async ({ page }) => {
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

  test('Hacker traegt mit 40 % Chance ein Powerup (normaler Feind 20 %)', async ({ page }) => {
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

  test('Abschuss eines Hackers gibt doppelte Punkte (200)', async ({ page }) => {
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

  test('Hacker stoppt zwischen y 100 und 200 und feuert Hack-Projektile statt Laser', async ({ page }) => {
    await startGame(page);
    // Anflug, Stopp und erster Schuss in 180 festen Simulationsschritten (~3 s), synchron ausgewertet
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
    expect(r.phase).toBe('lauern');
    expect(r.y).toBeGreaterThanOrEqual(100);
    expect(r.y).toBeLessThanOrEqual(200);
    expect(r.shots).toBeGreaterThanOrEqual(1);
    expect(r.laser).toBe(0);
    await expect(page.locator('.hack-projektil').first()).toBeAttached();
  });

  test('Hack-Projektil hackt den Spieler ohne Schaden und ignoriert den Schild', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.x = 185;
      state.y = 400;
      state.shieldTier = 2;
      Entities.createEnemy(185, 50, 'hacker', 0);
      const f = arrays.enemies[arrays.enemies.length - 1];
      f.phase = 'lauern';
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

  test('Hacker flieht nach Treffer oder nach 10 s nach oben aus dem Bild', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      Entities.createEnemy(100, 150, 'hacker', 0);
      Entities.createEnemy(250, 150, 'hacker', 0);
      const [a, b] = arrays.enemies;
      a.id = 'treffer';
      a.phase = 'lauern';
      a.lurkTimer = 9999;
      a.hackTimer = 9999;
      a.hackLanded = true;
      b.id = 'timeout';
      b.phase = 'lauern';
      b.lurkTimer = 1;
      b.hackTimer = 9999;
    });
    // Feste Simulationsschritte statt Echtzeit: erst Phasenwechsel, dann Flucht aus dem Bild
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
    expect(r.phases).toEqual(['flucht', 'flucht']);
    expect(r.left).toBe(0);
  });

  test('Ein Hacker kann nur einen Treffer landen', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.x = 185;
      state.y = 400;
      Entities.createEnemy(185, 50, 'hacker', 0);
      const f = arrays.enemies[0];
      f.phase = 'lauern';
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

  test('Hack-Effekte stapeln sich und laufen nach 3 s ab (P1 und P2)', async ({ page }) => {
    await startGame(page);
    // Ablauf ueber HACK_DAUER feste Simulationsschritte statt bis zu 3 s Echtzeit
    const r = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const { simulationStep } = await import('./js/loop.js');
      Hack.hackPlayer(state, 'hudGlitch');
      Hack.hackPlayer(state, 'inverted');
      Hack.hackPlayer(state.p2, 'weaponOffline');
      const beforehand = state.hacks.map(h => h.typ);
      const p2Beforehand = state.p2.hacks.map(h => h.typ);
      for (let i = 0; i < Hack.HACK_DURATION - 1; i++) simulationStep();
      const shortBeforeEnd = [state.hacks.length, state.p2.hacks.length];
      simulationStep();
      return { beforehand, p2Beforehand, shortBeforeEnd, afterwards: [state.hacks.length, state.p2.hacks.length] };
    });
    expect(r.beforehand).toEqual(['hudGlitch', 'inverted']);
    expect(r.p2Beforehand).toEqual(['weaponOffline']);
    expect(r.shortBeforeEnd).toEqual([2, 1]);
    expect(r.afterwards).toEqual([0, 0]);
  });

  test('Effekt invertiert: D bewegt das Schiff nach links', async ({ page }) => {
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

  test('Effekt tastenVertauscht: jede Richtung wird auf eine andere Richtung abgebildet', async ({ page }) => {
    await startGame(page);
    for (let run = 0; run < 5; run++) {
      const r = await page.evaluate(async () => {
        const { state } = await import('./js/state.js');
        const Hack = await import('./js/hack.js');
        Hack.removeHacks(state);
        Hack.hackPlayer(state, 'keySwapped');
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

  test('Effekt waffenOffline: Laser, Raketen und Bomben feuern nicht', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      state.godMode = true;
      state.energy = 50;
      state.missileCooldown = 0;
      state.bombCooldown = 0;
      Hack.hackPlayer(state, 'weaponOffline');
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

  test('Effekt hudGlitch: HUD bekommt Glitch-Klasse, solange der Effekt aktiv ist', async ({ page }) => {
    await startGame(page);
    // Feste Simulationsschritte: Klasse ist bis zum letzten Schritt der Hack-Dauer gesetzt, danach weg
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

  test('Gehackter Spieler zeigt Label mit Effektnamen, Restzeit-Balken und Glitch am Schiff', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      state.godMode = true;
      Hack.hackPlayer(state, 'inverted');
      Hack.hackPlayer(state, 'weaponOffline');
    });
    const label = page.locator('#hack-label-p1');
    await expect(label).toBeVisible();
    await expect(label).toContainText('INVERTED');
    await expect(label).toContainText('WEAPONS OFFLINE');
    await expect(label.locator('.hack-restzeit')).toHaveCount(1);
    await expect(page.locator('#spieler')).toHaveClass(/spieler-gehackt/);
    // Rest der Hack-Dauer in festen Simulationsschritten statt bis zu 3 s Echtzeit
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

  test('Spawn: Hacker erst ab Level 2 und hoechstens einer gleichzeitig', async ({ page }) => {
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

  test('Koop: invertiert wirkt auch auf die Pfeiltasten von Spieler 2', async ({ page }) => {
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

  test('Koop: Bot-Partner wird ebenfalls gehackt (invertiert kehrt seine Bewegung um)', async ({ page }) => {
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

  test('Online: Snapshot uebertraegt Hacks beider Spieler und Hack-Projektile', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const Entities = await import('./js/entities.js');
      const Network = await import('./js/network.js');
      state.paused = true;
      Hack.hackPlayer(state, 'inverted');
      Hack.hackPlayer(state.p2, 'keySwapped');
      Entities.createHackProjectile(100, 100, 100, 300);
      const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
      const perm = state.p2.hacks[0].perm;
      // Client-Seite simulieren: lokalen Zustand leeren und Snapshot anwenden
      Hack.removeHacks(state);
      Hack.removeHacks(state.p2);
      arrays.hackProjectileArray.forEach(h => h.el.remove());
      arrays.hackProjectileArray.length = 0;
      Network.applyGameStateSnapshot(snap);
      return {
        p1: state.hacks.map(h => h.typ),
        p2: state.p2.hacks.map(h => h.typ),
        permEqual: JSON.stringify(state.p2.hacks[0].perm) === JSON.stringify(perm),
        projectiles: arrays.hackProjectileArray.length,
        dom: document.querySelectorAll('.hack-projektil').length,
      };
    });
    expect(r).toEqual({ p1: ['inverted'], p2: ['keySwapped'], permEqual: true, projectiles: 1, dom: 1 });
  });

  test('Online-Client: Hack wirkt auf die lokale Steuerung und zeigt das Label', async ({ page }) => {
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

  test('restartGame entfernt aktive Hacks beider Spieler', async ({ page }) => {
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

  test('Neuer Hack spielt den Glitch-Sound', async ({ page }) => {
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

  test('Hack-Projektil lenkt in Richtung des Spielers', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      state.x = 330;
      state.y = 500;
      // Startet senkrecht nach unten, Spieler steht weit rechts
      Entities.createHackProjectile(50, 100, 50, 500);
    });
    await page.waitForTimeout(500);
    const vx = await page.evaluate(() => window.__game.arrays.hackProjectileArray[0].vx);
    expect(vx).toBeGreaterThan(0.5);
  });

  test('Hack-Projektil kann durch seitliches Ausweichen verfehlt werden', async ({ page }) => {
    await startGame(page);
    // Feste Simulationsschritte; Taste D ueber state.tastenGedrueckt (wie der keydown-Handler) gehalten.
    // Gegenprobe ohne Ausweichen: derselbe Orb trifft.
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
        // Spaet ausweichen, wenn der Orb ca. 80 px entfernt ist
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

  test('Hack-Projektil kehrt nach dem Vorbeiflug nicht um', async ({ page }) => {
    await startGame(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      state.x = 185;
      state.y = 200;
      // Orb ist bereits unter dem Spieler und fliegt nach unten
      Entities.createHackProjectile(194, 300, 194, 600);
    });
    // 72 feste Simulationsschritte (~1,2 s); vy wird in jedem Schritt geprueft, solange der Orb existiert
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
        b.phase = 'kampf';
        b.y = 20;
        b.shotTimer = 999999;
        b.baseShotRate = 999999;
        b.enragePhaseActive = enrage;
        b.hackTimer = 2;
      },
      { level, enrage },
    );
  }

  test('Boss feuert ab Level 5 Hack-Projektile, Reset auf 300 Frames', async ({ page }) => {
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

  test('Boss unter Level 5 feuert keine Hack-Projektile', async ({ page }) => {
    await bossFight(page, 4, false);
    await page.waitForTimeout(500);
    const n = await page.evaluate(() => window.__game.arrays.hackProjectileArray.length);
    expect(n).toBe(0);
  });

  test('Boss im Enrage feuert alle 180 Frames', async ({ page }) => {
    await bossFight(page, 5, true);
    await page.waitForFunction(() => window.__game.arrays.hackProjectileArray.length > 0);
    const timer = await page.evaluate(() => window.__game.arrays.bosses[0].hackTimer);
    expect(timer).toBeGreaterThan(160);
    expect(timer).toBeLessThanOrEqual(180);
  });

  test('Boss kann den Spieler mehrfach hacken (Quelle null blockiert nicht)', async ({ page }) => {
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
