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

// Coop-Spiel mit Bot-Partner (Phantom) starten und das Feld leeren
async function starteBotSpiel(page) {
  await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
  await page.keyboard.up('KeyW');
  await page.evaluate(async () => {
    const Bot = await import('./js/bot.js');
    window.__botTest = {
      Bot,
      leeren() {
        const { state, arrays } = window.__game;
        ['feinde', 'asteroiden', 'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bossBombenArray',
          'bossRaketenArray', 'bosses', 'powerups', 'laserArray', 'raketenArray'].forEach(name => {
          arrays[name].forEach(o => o.el && o.el.remove());
          arrays[name].length = 0;
        });
        Object.keys(state.tastenGedrueckt).forEach(k => { state.tastenGedrueckt[k] = false; });
        state.frameZaehler = 1;
        state.hacks = [];
        state.p2IsBot = true;
        state.p2BotDifficulty = 'normal';
        Bot.resetBot();
      }
    };
  });
}

test('Bot bevorzugt Gegnerschiffe vor Asteroiden und ignoriert unzerstoerbare Asteroiden', async ({ page }) => {
  await starteBotSpiel(page);
  const r = await page.evaluate(() => {
    const { state, arrays, Entities } = window.__game;
    const T = window.__botTest;
    const ziel = () => T.Bot.findBestTarget(state.p2, { aimCorridor: 30 });
    T.leeren();
    state.p2.x = 300;
    state.p2.y = 500;

    const asteroid = (x, y, g) => {
      Entities.erzeugeAsteroid(x, y, g, 0, 0, 0, true);
      return arrays.asteroiden[arrays.asteroiden.length - 1];
    };

    // Asteroid nah, Feind weiter weg: Feind gewinnt
    asteroid(290, 420, 20);
    Entities.erzeugeFeind(80, 100, 'normal', 0, false);
    const mitFeind = ziel();

    // Nur ein Magma-Asteroid: kein Ziel
    T.leeren();
    const magma = asteroid(290, 400, 40);
    Object.assign(magma, { istMagma: true, istUnzerstoerbar: true, traegtPowerup: false });
    const nurMagma = { ziel: ziel(), unzerstoerbar: !!magma.istUnzerstoerbar };

    // Magma plus normaler Asteroid: der normale wird gewaehlt
    asteroid(100, 200, 20);
    const mitNormal = ziel();
    return { mitFeind, nurMagma, mitNormal };
  });
  expect(r.mitFeind).toBeTruthy();
  expect(r.mitFeind.x).toBe(95);
  expect(r.nurMagma.unzerstoerbar).toBe(true);
  expect(r.nurMagma.ziel).toBeNull();
  expect(r.mitNormal.x).toBeLessThan(150);
});

test('Bot laesst sich vom Jaeger-Boss (Typ 2) nicht an den Rand draengen und weicht seinen Schuessen aus', async ({ page }) => {
  await starteBotSpiel(page);
  const r = await page.evaluate(() => {
    const { state, arrays, Entities, Loop } = window.__game;
    const T = window.__botTest;
    T.leeren();
    state.level = 2;
    state.godMode = true; // P1 steht nur als Zuschauer in der Ecke
    state.x = 560;
    state.y = 560;
    state.p2.x = 285;
    state.p2.y = 500;
    state.p2.schildStufe = 0;
    state.p2.leben = 3;
    Entities.erzeugeBoss();
    const b = arrays.bosses[0];
    Object.assign(b, { phase: 'kampf', y: 20, bombenTimer: 1e9, raketenTimer: 1e9, hackTimer: 1e9 });

    let minX = Infinity;
    let treffer = 0;
    let vorher = state.p2.leben * 10 + state.p2.schildStufe;
    for (let i = 0; i < 900; i++) {
      state.frameZaehler = 1; // keine Spawns
      state.x = 560;
      state.y = 560;
      Loop.simulationsSchritt();
      minX = Math.min(minX, state.p2.x);
      const jetzt = state.p2.leben * 10 + state.p2.schildStufe;
      if (jetzt < vorher) treffer++;
      // Zustand fuer die naechste Messung wiederherstellen
      state.p2.leben = 3;
      state.p2.schildStufe = 0;
      state.p2.invulnerableTimer = 0;
      state.p2.isDead = false;
      vorher = 30;
    }
    return { minX, treffer, typ: b.bossTyp };
  });
  expect(r.typ).toBe(2);
  expect(r.minX).toBeGreaterThan(30);
  expect(r.treffer).toBeLessThanOrEqual(2);
});
