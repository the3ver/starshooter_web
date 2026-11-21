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

test('Coop: Magma-Abpraller trifft nur den eigenen Schuetzen, nie den Mitspieler', async ({ page }) => {
  await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  await page.keyboard.up('KeyW');

  const r = await page.evaluate(() => {
    const { state, arrays, dom, Loop } = window.__game;
    const empty = () => {
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
      for (const s of [state, state.p2]) {
        s.lives = 3;
        s.shieldTier = 0;
        s.invulnerableTimer = 0;
        s.isDead = false;
      }
      state.p2IsBot = false;
      state.x = 100;
      state.y = 400;
      state.p2.x = 400;
      state.p2.y = 400;
    };
    // Stehender, bereits abgeprallter Laser mitten im Schiff des Ziels
    const bouncer = (owner, target) => {
      const el = document.createElement('div');
      el.classList.add('laser-projektil');
      dom.playfield.appendChild(el);
      arrays.laserArray.push({
        id: 'test-' + owner,
        el,
        x: target.x + 10,
        y: target.y + 5,
        vx: 0,
        vy: 0,
        width: 8,
        height: 20,
        damage: 8,
        owner,
        isDeflected: true,
      });
    };
    const lives = () => ({ p1: state.lives, p2: state.p2.lives });
    const out = {};

    empty();
    bouncer('p2', state); // Abpraller von P2 im Schiff von P1
    Loop.simulationStep();
    out.p2ShotOnP1 = { ...lives(), left: arrays.laserArray.length };

    empty();
    bouncer('p2', state.p2); // eigener Abpraller von P2
    Loop.simulationStep();
    out.p2ShotOnP2 = { ...lives(), left: arrays.laserArray.length };

    empty();
    bouncer('p1', state); // eigener Abpraller von P1
    Loop.simulationStep();
    out.p1ShotOnP1 = { ...lives(), left: arrays.laserArray.length };

    empty();
    bouncer('p1', state.p2); // Abpraller von P1 im Schiff von P2
    Loop.simulationStep();
    out.p1ShotOnP2 = { ...lives(), left: arrays.laserArray.length };
    return out;
  });

  expect(r.p2ShotOnP1).toEqual({ p1: 3, p2: 3, left: 1 });
  expect(r.p2ShotOnP2).toEqual({ p1: 3, p2: 2, left: 0 });
  expect(r.p1ShotOnP1).toEqual({ p1: 2, p2: 3, left: 0 });
  expect(r.p1ShotOnP2).toEqual({ p1: 3, p2: 3, left: 1 });
});
