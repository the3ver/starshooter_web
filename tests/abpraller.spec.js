const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await setzeSpielstand(page);
  await page.goto('/');
});

test('Coop: Magma-Abpraller trifft nur den eigenen Schuetzen, nie den Mitspieler', async ({ page }) => {
  await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
  await page.keyboard.up('KeyW');

  const r = await page.evaluate(() => {
    const { state, arrays, dom, Loop } = window.__game;
    const leeren = () => {
      ['feinde', 'asteroiden', 'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bossBombenArray',
        'bossRaketenArray', 'bosses', 'powerups', 'laserArray', 'raketenArray'].forEach(name => {
        arrays[name].forEach(o => o.el && o.el.remove());
        arrays[name].length = 0;
      });
      Object.keys(state.tastenGedrueckt).forEach(k => { state.tastenGedrueckt[k] = false; });
      state.frameZaehler = 1;
      for (const s of [state, state.p2]) {
        s.leben = 3;
        s.schildStufe = 0;
        s.invulnerableTimer = 0;
        s.isDead = false;
      }
      state.p2IsBot = false;
      state.x = 100; state.y = 400;
      state.p2.x = 400; state.p2.y = 400;
    };
    // Stehender, bereits abgeprallter Laser mitten im Schiff des Ziels
    const abpraller = (owner, ziel) => {
      const el = document.createElement('div');
      el.classList.add('laser-projektil');
      dom.spielfeld.appendChild(el);
      arrays.laserArray.push({ id: 'test-' + owner, el, x: ziel.x + 10, y: ziel.y + 5, vx: 0, vy: 0, width: 8, height: 20,
        schaden: 8, owner, isDeflected: true });
    };
    const leben = () => ({ p1: state.leben, p2: state.p2.leben });
    const out = {};

    leeren();
    abpraller('p2', state); // Abpraller von P2 im Schiff von P1
    Loop.simulationsSchritt();
    out.p2SchussAufP1 = { ...leben(), uebrig: arrays.laserArray.length };

    leeren();
    abpraller('p2', state.p2); // eigener Abpraller von P2
    Loop.simulationsSchritt();
    out.p2SchussAufP2 = { ...leben(), uebrig: arrays.laserArray.length };

    leeren();
    abpraller('p1', state); // eigener Abpraller von P1
    Loop.simulationsSchritt();
    out.p1SchussAufP1 = { ...leben(), uebrig: arrays.laserArray.length };

    leeren();
    abpraller('p1', state.p2); // Abpraller von P1 im Schiff von P2
    Loop.simulationsSchritt();
    out.p1SchussAufP2 = { ...leben(), uebrig: arrays.laserArray.length };
    return out;
  });

  expect(r.p2SchussAufP1).toEqual({ p1: 3, p2: 3, uebrig: 1 });
  expect(r.p2SchussAufP2).toEqual({ p1: 3, p2: 2, uebrig: 0 });
  expect(r.p1SchussAufP1).toEqual({ p1: 2, p2: 3, uebrig: 0 });
  expect(r.p1SchussAufP2).toEqual({ p1: 3, p2: 3, uebrig: 1 });
});
