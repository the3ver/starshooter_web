const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helpers');

// Viper-X Ausweichrolle: Doppeltipp links/rechts (mobil: Wisch auf dem Joystick) rollt 70 px in 12 Schritten,
// unverwundbar, Cooldown 90 Schritte ab Rollenstart. Alles deterministisch ueber simulationsSchritt().

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await page.route('**/api/turn*', route => route.fulfill({ status: 503, body: '' }));
  await setGameState(page);
  await page.goto('/');
});

// Spiel mit gewaehlten Schiffen starten und Feld leeren. window.__viperTest.leeren() stellt einen
// deterministischen Ausgangszustand her, tippe() fuehrt einen Doppeltipp aus (3 Schritte, Taste am Ende gehalten).
async function startGame(page, { coop = false, p1 = 'viper', p2 = 'viper' } = {}) {
  if (coop) {
    await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
    await page.locator('.hangar-player-tab[data-player="p2"]').click();
    await page.locator(`.hangar-model-btn[data-model="${p2}"]`).click();
    await page.locator('.hangar-player-tab[data-player="p1"]').click();
  }
  await page.locator(`.hangar-model-btn[data-model="${p1}"]`).click();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    window.__viperTest = {
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
        state.frameCounter = 1; // keine Spawns in den naechsten 100 Schritten
        state.level = 1;
        state.bossActive = false;
        state.hacks = [];
        state.joystick.active = false;
        state.joystick.x = 0;
        state.joystick.y = 0;
        for (const s of [state, state.p2]) {
          s.hacks = [];
          s.lives = 3;
          s.shieldTier = 0;
          s.invulnerableTimer = 0;
          s.isDead = false;
          s.viperRollTimer = 0;
          s.viperRollDirection = 0;
          s.viperRollCooldown = 0;
          s.viperLeftHeld = false;
          s.viperRightHeld = false;
          s.viperTapDirection = 0;
          s.viperTapAlter = 999;
          s.viperJoyRest = 0;
          s.viperJoyBeforehand = 0;
          s.viperCombo = 0;
          s.viperComboTimer = 0;
          s.viperOverdriveStrip = 0;
          s.viperOverdriveTimer = 0;
          s.laserTier = 1;
          s.playerShotCooldown = 0;
          s.energy = s.maxEnergy;
        }
        state.score = 0;
        state.x = 150;
        state.y = 400;
        state.p2.x = 250;
        state.p2.y = 400;
        window.__game.Audio.clearAudioHistory();
      },
      steps(n) {
        for (let i = 0; i < n; i++) window.__game.Loop.simulationStep();
      },
      // Zwei Druck-Flanken im Abstand abstand Schritten; Rueckgabe nach dem zweiten Druck-Schritt (Taste gehalten)
      tap(key, distance = 2) {
        const t = window.__game.state.keysPressed;
        t[key] = true;
        this.steps(1);
        t[key] = false;
        this.steps(distance - 1);
        t[key] = true;
        this.steps(1);
      },
      roll() {
        return window.__game.Audio.audioHistory.filter(a => a.name === 'roll').length;
      },
    };
  });
}

test.describe('Viper-X Ausweichrolle', () => {
  test('Doppeltipp rechts: 70 px gleichmaessig in 12 Schritten, Klasse, Sound, danach wieder normale Steuerung', async ({
    page,
  }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const el = document.getElementById('spieler');
      T.empty();
      T.steps(1); // Ausgangszustand setzen lassen
      const t = state.keysPressed;
      t.d = true;
      T.steps(1);
      t.d = false;
      T.steps(1);
      const x0 = state.x;
      t.d = true;
      T.steps(1); // Start der Rolle (zweite Druck-Flanke)
      t.d = false;
      const xs = [state.x - x0];
      const afterStart = {
        timer: state.viperRollTimer,
        cls: el.classList.contains('viper-rolle'),
        cd: state.viperRollCooldown,
        sounds: T.roll(),
      };
      for (let i = 0; i < 11; i++) {
        T.steps(1);
        xs.push(state.x - x0);
      }
      const amEnd = {
        x: state.x - x0,
        cls: el.classList.contains('viper-rolle'),
        afterimages: document.querySelectorAll('.viper-nachbild').length,
      };
      T.steps(1);
      const thereafter = { x: state.x - x0, cls: el.classList.contains('viper-rolle'), timer: state.viperRollTimer };
      // Normale Steuerung wieder aktiv
      t.a = true;
      T.steps(3);
      t.a = false;
      const left = state.x - x0;
      return { xs, afterStart, amEnd, thereafter, left };
    });
    expect(r.afterStart).toEqual({ timer: 12, cls: true, cd: 90, sounds: 1 });
    expect(r.xs).toHaveLength(12);
    r.xs.forEach((x, i) => expect(x).toBeCloseTo((70 / 12) * (i + 1), 3));
    expect(r.amEnd.x).toBeCloseTo(70, 3);
    expect(r.amEnd.cls).toBe(true);
    expect(r.amEnd.afterimages).toBeGreaterThan(0);
    expect(r.thereafter.x).toBeCloseTo(70, 3);
    expect(r.thereafter.cls).toBe(false);
    expect(r.thereafter.timer).toBe(0);
    expect(r.left).toBeLessThan(70);
  });

  test('Doppeltipp links (A und Pfeil links): 70 px nach links', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const out = [];
      for (const key of ['a', 'arrowleft']) {
        T.empty();
        state.x = 250;
        const t = state.keysPressed;
        t[key] = true;
        T.steps(1);
        t[key] = false;
        T.steps(1);
        const x0 = state.x;
        t[key] = true;
        T.steps(1);
        t[key] = false;
        T.steps(11);
        out.push(state.x - x0);
      }
      return out;
    });
    r.forEach(d => expect(d).toBeCloseTo(-70, 3));
  });

  test('Einzeltipp und zu langsamer Doppeltipp (mehr als 15 Schritte) rollen nicht', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      T.empty();
      const t = state.keysPressed;
      const timer = [];
      t.d = true;
      T.steps(1);
      timer.push(state.viperRollTimer);
      t.d = false;
      T.steps(40);
      timer.push(state.viperRollTimer);
      const single = { timer: [...timer], sounds: T.roll() };
      // Zwei Tipps mit 16 Schritten Abstand
      T.empty();
      T.tap('d', 16);
      const tooSlow = { timer: state.viperRollTimer, sounds: T.roll() };
      t.d = false;
      T.steps(3);
      // Genau 15 Schritte Abstand zaehlt noch
      T.empty();
      T.tap('d', 15);
      const limit = { timer: state.viperRollTimer, sounds: T.roll() };
      // Links und rechts im Wechsel ist kein Doppeltipp
      t.d = false;
      T.steps(14);
      T.empty();
      t.a = true;
      T.steps(1);
      t.a = false;
      T.steps(1);
      t.d = true;
      T.steps(1);
      t.d = false;
      T.steps(1);
      const mixed = { timer: state.viperRollTimer, sounds: T.roll() };
      return { single, tooSlow, limit, mixed };
    });
    expect(r.single).toEqual({ timer: [0, 0], sounds: 0 });
    expect(r.tooSlow).toEqual({ timer: 0, sounds: 0 });
    expect(r.limit).toEqual({ timer: 12, sounds: 1 });
    expect(r.mixed).toEqual({ timer: 0, sounds: 0 });
  });

  test('Cooldown: zweiter Doppeltipp waehrend der 90 Schritte rollt nicht, danach wieder', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const t = state.keysPressed;
      T.empty();
      state.x = 100;
      T.tap('d'); // Rollenstart in diesem Schritt (Schritt 0 des Cooldowns)
      t.d = false;
      T.steps(11); // Rolle vorbei bei Schritt 12
      T.steps(1);
      const afterRoll = { timer: state.viperRollTimer, cd: state.viperRollCooldown };
      // Doppeltipp links mitten im Cooldown (um Schritt 30)
      T.steps(15);
      T.tap('a');
      t.a = false;
      T.steps(2);
      const inCooldown = { timer: state.viperRollTimer, sounds: T.roll(), cd: state.viperRollCooldown };
      // Cooldown laeuft ab: der letzte Tipp liegt kurz vor Ende, zaehlt also nicht; neuer Doppeltipp rollt
      T.steps(100);
      const free = state.viperRollCooldown;
      const x0 = state.x;
      T.tap('a');
      t.a = false;
      T.steps(11);
      return { afterRoll, inCooldown, free, afterSecondaryRoll: { sounds: T.roll(), dx: state.x - x0 } };
    });
    expect(r.afterRoll.timer).toBe(0);
    expect(r.afterRoll.cd).toBeGreaterThan(70);
    expect(r.inCooldown.timer).toBe(0);
    expect(r.inCooldown.sounds).toBe(1);
    expect(r.inCooldown.cd).toBeGreaterThan(0);
    expect(r.free).toBe(0);
    expect(r.afterSecondaryRoll.sounds).toBe(2);
    expect(r.afterSecondaryRoll.dx).toBeLessThan(-60);
  });

  test('Cooldown endet genau 90 Schritte nach dem Rollenstart', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.x = 100;
      T.tap('d');
      state.keysPressed.d = false;
      const values = [state.viperRollCooldown];
      T.steps(89);
      values.push(state.viperRollCooldown);
      T.steps(1);
      values.push(state.viperRollCooldown);
      return values;
    });
    expect(r).toEqual([90, 1, 0]);
  });

  test('Unverwundbar waehrend der Rolle (stehender Feindlaser trifft nicht), danach trifft er', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__viperTest;
      const t = state.keysPressed;
      T.empty();
      state.x = 100;
      t.d = true;
      T.steps(1);
      t.d = false;
      T.steps(1);
      // Stehender Laser mitten im Schiff (die Rolle beginnt im naechsten Schritt)
      Entities.createEnemyLaser(state.x + 14, state.y + 10);
      Object.assign(arrays.enemyLaserArray[0], { vx: 0, vy: 0 });
      t.d = true;
      T.steps(1);
      t.d = false;
      const atStart = {
        lives: state.lives,
        laser: arrays.enemyLaserArray.length,
        invulnerable: window.__game.Utils.isDashInvulnerable(state),
      };
      T.steps(11);
      const duringRoll = { lives: state.lives, laser: arrays.enemyLaserArray.length };
      // Rolle ist vorbei: ein neuer stehender Laser am Schiff trifft
      T.steps(1);
      const afterRoll = window.__game.Utils.isDashInvulnerable(state);
      Entities.createEnemyLaser(state.x + 14, state.y + 10);
      Object.assign(arrays.enemyLaserArray[arrays.enemyLaserArray.length - 1], { vx: 0, vy: 0 });
      T.steps(1);
      return { atStart, duringRoll, afterRoll, thereafter: { lives: state.lives } };
    });
    expect(r.atStart).toEqual({ lives: 3, laser: 1, invulnerable: true });
    expect(r.duringRoll).toEqual({ lives: 3, laser: 1 });
    expect(r.afterRoll).toBe(false);
    expect(r.thereafter.lives).toBe(2);
  });

  test('Am Spielfeldrand begrenzt, auch links', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, config } = window.__game;
      const T = window.__viperTest;
      const t = state.keysPressed;
      const out = {};
      T.empty();
      state.x = config.playfieldWidth - config.playerSize - 20;
      T.tap('d');
      t.d = false;
      T.steps(11);
      out.right = state.x;
      out.rightMax = config.playfieldWidth - config.playerSize;
      T.empty();
      state.x = 20;
      T.tap('a');
      t.a = false;
      T.steps(11);
      out.left = state.x;
      return out;
    });
    expect(r.right).toBe(r.rightMax);
    expect(r.left).toBe(0);
  });

  test('Nur die Viper rollt: Phantom (P1) und Gleve ignorieren den Doppeltipp', async ({ page }) => {
    await startGame(page, { p1: 'phantom' });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.x = 100;
      const t = state.keysPressed;
      t.d = true;
      T.steps(1);
      t.d = false;
      T.steps(1);
      const x0 = state.x;
      t.d = true;
      T.steps(1);
      t.d = false;
      T.steps(11);
      return {
        dx: state.x - x0,
        timer: state.viperRollTimer,
        sounds: T.roll(),
        cls: document.getElementById('spieler').classList.contains('viper-rolle'),
        hud: document.getElementById('viper-rolle-hud').style.display,
      };
    });
    // Normale Fahrt: hoechstens ein Schritt Geschwindigkeit, nie 70 px
    expect(Math.abs(r.dx)).toBeLessThan(20);
    expect(r.timer).toBe(0);
    expect(r.sounds).toBe(0);
    expect(r.cls).toBe(false);
    expect(r.hud).toBe('none');
  });

  test('Steuerungs-Hack (invertiert) lenkt die Rolle um, waffenOffline blockiert sie nicht', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const out = {};
      T.empty();
      state.x = 200;
      state.hacks = [{ typ: 'inverted', timer: 999 }];
      const x0 = state.x;
      T.tap('d');
      state.keysPressed.d = false;
      T.steps(11);
      out.inverted = state.x - x0;
      T.empty();
      state.x = 200;
      state.hacks = [{ typ: 'weaponOffline', timer: 999 }];
      const x1 = state.x;
      T.tap('d');
      state.keysPressed.d = false;
      T.steps(11);
      out.weaponOffline = state.x - x1;
      return out;
    });
    // Der Tipp-Schritt selbst bewegt noch (invertiert: nach links) und zaehlt zur Differenz
    expect(r.inverted).toBeLessThan(-60);
    expect(r.weaponOffline).toBeGreaterThan(60);
  });

  test('Mobil: schneller Wisch auf dem Joystick rollt, langsames Hineinziehen nicht', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const j = state.joystick;
      const out = {};
      T.empty();
      state.x = 150;
      j.active = true;
      j.x = 0;
      T.steps(2);
      const x0 = state.x;
      j.x = 1;
      T.steps(1);
      out.swipe = { timer: state.viperRollTimer, sounds: T.roll() };
      T.steps(11);
      out.swipeDx = state.x - x0;
      j.active = false;
      j.x = 0;
      T.steps(1);

      // Langsam: 0.05 pro Schritt bis 1.0
      T.empty();
      state.x = 150;
      j.active = true;
      for (let k = 0; k <= 30; k++) {
        j.x = Math.min(1, k * 0.05);
        T.steps(1);
      }
      out.slow = { sounds: T.roll(), timer: state.viperRollTimer };
      j.active = false;
      j.x = 0;
      // Nach links
      T.empty();
      state.x = 250;
      j.active = true;
      j.x = 0;
      T.steps(2);
      const x1 = state.x;
      j.x = -1;
      T.steps(12);
      out.leftDx = state.x - x1;
      j.active = false;
      j.x = 0;
      return out;
    });
    expect(r.swipe).toEqual({ timer: 12, sounds: 1 });
    // Der Joystick steht in diesem Schritt voll rechts; die Rolle ersetzt die Fahrt, es bleiben genau 70 px
    expect(r.swipeDx).toBeCloseTo(70, 3);
    expect(r.slow).toEqual({ sounds: 0, timer: 0 });
    expect(r.leftDx).toBeCloseTo(-70, 3);
  });

  test('Lokaler Coop: P2 rollt mit den Pfeiltasten, P1 mit A/D, unabhaengig voneinander', async ({ page }) => {
    await startGame(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const t = state.keysPressed;
      T.empty();
      state.p2IsBot = false;
      state.x = 100;
      state.p2.x = 200;
      // P2: Pfeil rechts doppelt
      t.arrowright = true;
      T.steps(1);
      t.arrowright = false;
      T.steps(1);
      const p2x0 = state.p2.x;
      const p1x0 = state.x;
      t.arrowright = true;
      T.steps(1);
      t.arrowright = false;
      T.steps(11);
      const p2 = {
        dx: state.p2.x - p2x0,
        timer: state.viperRollTimer,
        cd: state.p2.viperRollCooldown,
        p1dx: state.x - p1x0,
        p1cd: state.viperRollCooldown,
      };
      // P1: A doppelt (P1-Cooldown unabhaengig)
      T.empty();
      state.p2IsBot = false;
      state.x = 200;
      state.p2.x = 100;
      t.a = true;
      T.steps(1);
      t.a = false;
      T.steps(1);
      const q1x0 = state.x;
      t.a = true;
      T.steps(1);
      t.a = false;
      T.steps(11);
      const p1 = { dx: state.x - q1x0, p2cd: state.p2.viperRollCooldown, p2timer: state.p2.viperRollTimer };
      return {
        p2,
        p1,
        class2: document.getElementById('spieler-2').classList.contains('viper-rolle'),
        hud2: document.getElementById('viper-rolle-hud-p2').style.display,
      };
    });
    expect(r.p2.dx).toBeCloseTo(70, 3);
    expect(r.p2.timer).toBe(0);
    expect(r.p2.cd).toBeGreaterThan(70);
    expect(r.p2.p1dx).toBe(0);
    expect(r.p2.p1cd).toBe(0);
    expect(r.p1.dx).toBeCloseTo(-70, 3);
    expect(r.p1.p2cd).toBe(0);
    expect(r.p1.p2timer).toBe(0);
    expect(r.class2).toBe(false);
    expect(r.hud2).toBe('block');
  });

  test('HUD: Bereitschaftsanzeige nur bei Viper, gruen wenn bereit, fuellt sich im Cooldown', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const hud = document.getElementById('viper-rolle-hud');
      T.empty();
      T.steps(2);
      const ready = { display: hud.style.display, ready: hud.classList.contains('bereit') };
      T.tap('d');
      state.keysPressed.d = false;
      T.steps(1);
      const isCharging = {
        ready: hud.classList.contains('bereit'),
        width: parseFloat(hud.firstElementChild.style.width),
      };
      T.steps(100);
      const again = {
        ready: hud.classList.contains('bereit'),
        width: parseFloat(hud.firstElementChild.style.width),
      };
      return { ready, isCharging, again };
    });
    expect(r.ready).toEqual({ display: 'block', ready: true });
    expect(r.isCharging.ready).toBe(false);
    expect(r.isCharging.width).toBeLessThan(10);
    expect(r.again).toEqual({ ready: true, width: 100 });
  });
});

test.describe('Viper-X Ausweichrolle: Bot', () => {
  test('Bot-Viper rollt bei sehr nahem Geschoss zur freieren Seite und nicht im Cooldown', async ({ page }) => {
    await startGame(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__viperTest;
      const out = {};
      const standingProjectile = p => {
        Entities.createEnemyLaser(p.x + 13, p.y - 17);
        Object.assign(arrays.enemyLaserArray[arrays.enemyLaserArray.length - 1], { vx: 0, vy: 0 });
      };
      const prepare = x => {
        T.empty();
        state.p2IsBot = true;
        state.p2BotDifficulty = 'hard';
        state.x = 340;
        state.p2.x = x;
        state.p2.y = 500;
      };

      // Nahe am linken Rand: die rechte Seite ist freier
      prepare(30);
      standingProjectile(state.p2);
      T.steps(3);
      out.left = { timer: state.p2.viperRollTimer, direction: state.p2.viperRollDirection, sounds: T.roll() };
      T.steps(12);
      out.leftX = state.p2.x;

      // Nahe am rechten Rand: die linke Seite ist freier
      prepare(window.__game.config.playfieldWidth - 60);
      state.x = 20;
      standingProjectile(state.p2);
      T.steps(3);
      out.right = { direction: state.p2.viperRollDirection, sounds: T.roll() };

      // Cooldown frei, aber keine Gefahr: keine Rolle
      prepare(200);
      T.steps(20);
      out.withoutDanger = T.roll();

      // Im Cooldown rollt der Bot nicht, auch bei Gefahr
      prepare(200);
      state.p2.viperRollCooldown = 50;
      standingProjectile(state.p2);
      T.steps(3);
      out.inCooldown = T.roll();
      return out;
    });
    expect(r.left.timer).toBeGreaterThan(0);
    expect(r.left.direction).toBe(1);
    expect(r.left.sounds).toBe(1);
    expect(r.leftX).toBeGreaterThan(80);
    expect(r.right).toEqual({ direction: -1, sounds: 1 });
    expect(r.withoutDanger).toBe(0);
    expect(r.inCooldown).toBe(0);
  });

  test('Bot-Phantom rollt nie', async ({ page }) => {
    await startGame(page, { coop: true, p2: 'phantom' });
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      state.p2.x = 200;
      state.p2.y = 500;
      Entities.createEnemyLaser(213, 483);
      Object.assign(arrays.enemyLaserArray[0], { vx: 0, vy: 0 });
      T.steps(5);
      return { sounds: T.roll(), timer: state.p2.viperRollTimer };
    });
    expect(r).toEqual({ sounds: 0, timer: 0 });
  });
});

test.describe('Viper-X Ausweichrolle: Online', () => {
  // Online-Zustand ohne echte Verbindung: host = true Host, sonst Client (P2)
  async function asOnline(page, host) {
    await page.evaluate(host => {
      const { state, arrays, Utils } = window.__game;
      Utils.setGameMode('online');
      state.gameRunning = true;
      state.paused = false;
      state.cutsceneActive = false;
      state.gameOverActive = false;
      state.bossWarningActive = false;
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'viper';
      state.network.isOnline = true;
      state.network.isHost = host;
      state.network.isClient = !host;
      state.network.connected = true;
      state.frameCounter = 1;
      [
        'enemies',
        'asteroids',
        'bosses',
        'powerups',
        'laserArray',
        'missileArray',
        'bombArray',
        'enemyLaserArray',
        'hackProjectileArray',
        'bossLaserArray',
        'bossMissileArray',
        'bossBombArray',
      ].forEach(n => {
        arrays[n].forEach(o => {
          if (o.el) o.el.remove();
        });
        arrays[n].length = 0;
      });
      Object.keys(state.keysPressed).forEach(k => {
        state.keysPressed[k] = false;
      });
    }, host);
  }

  test('Host serialisiert den Rollen-Zustand beider Schiffe, er ueberlebt die Netzkodierung und der Client zeigt die Klasse', async ({
    page,
  }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await asOnline(page, true);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const { state } = g;
      const NK = await import('./js/net-encoding.js');
      const out = {};
      state.viperRollTimer = 7;
      state.viperRollDirection = -1;
      state.viperRollCooldown = 61.4;
      state.p2.viperRollTimer = 0;
      state.p2.viperRollCooldown = 33;
      const full = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
      out.p1 = [full.p1.viperRollTimer, full.p1.viperRollDirection, full.p1.viperRollCooldown];
      out.p2 = [full.p2.viperRollTimer, full.p2.viperRollCooldown];

      // Nicht-Viper traegt keine Rollenfelder
      state.p2.selectedShipModel = 'phantom';
      out.phantomFields = 'viperRollTimer' in g.Network.serializeGameState().p2;
      state.p2.selectedShipModel = 'viper';

      // Kodieren und dekodieren wie auf dem Draht (Rundung ganzzahlig)
      const encoder = new NK.SnapshotEncoder();
      const decoder = new NK.SnapshotDecoder();
      const recon = decoder.decode(JSON.parse(JSON.stringify(encoder.encode(full, 0))));
      out.wire = [
        recon.p1.viperRollTimer,
        recon.p1.viperRollDirection,
        recon.p1.viperRollCooldown,
        recon.p2.viperRollCooldown,
      ];

      // Client uebernimmt: Host-P1 rollt noch 7 Schritte
      state.network.isHost = false;
      state.network.isClient = true;
      state.viperRollTimer = 0;
      state.viperRollCooldown = 0;
      g.Network.applyGameStateSnapshot(recon);
      g.Audio.clearAudioHistory();
      out.cooldownClient = state.p2.viperRollCooldown;
      const el = document.getElementById('spieler');
      const classes = [];
      for (let i = 0; i < 9; i++) {
        g.Loop.simulationStep();
        classes.push(el.classList.contains('viper-rolle'));
      }
      out.classes = classes;
      out.cooldownAfterSteps = state.p2.viperRollCooldown;
      return out;
    });
    // Serialisiert wird der Rohwert, gerundet wird erst beim Kodieren
    expect(r.p1).toEqual([7, -1, 61.4]);
    expect(r.p2).toEqual([0, 33]);
    expect(r.phantomFields).toBe(false);
    expect(r.wire).toEqual([7, -1, 61, 33]);
    // 7 Restschritte aus dem Snapshot: gezeichnet wird nach jedem Schritt (nach dem Herunterzaehlen, wie beim Host),
    // die Klasse steht daher 6 Client-Schritte, dann weg
    expect(r.classes).toEqual([true, true, true, true, true, true, false, false, false]);
    expect(r.cooldownClient).toBe(33);
    // Der Client zaehlt den uebernommenen Cooldown selbst weiter herunter
    expect(r.cooldownAfterSteps).toBe(24);
  });

  test('Client sagt die eigene Rolle voraus und meldet Start und Richtung; der Host rollt von dort aus', async ({
    page,
  }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await asOnline(page, false);
    const packet = await page.evaluate(() => {
      const g = window.__game;
      const { state } = g;
      const t = state.keysPressed;
      const el = document.getElementById('spieler-2');
      state.p2.x = 150;
      state.p2.y = 400;
      state.p2.viperRollCooldown = 0;
      const packets = [];
      const step = () => {
        g.Loop.simulationStep();
        packets.push(g.Network.serializePlayerInput());
      };
      t.d = true;
      step();
      t.d = false;
      step();
      const x0 = state.p2.x;
      t.d = true;
      step();
      t.d = false;
      const classAfterStart = el.classList.contains('viper-rolle');
      for (let i = 0; i < 11; i++) step();
      return { packets: packets.map(p => ({ x: p.x, ro: p.ro })), x0, xEnd: state.p2.x, classAfterStart };
    });
    // Start-Paket traegt die Position vor der Rolle und die Richtung, nur dieses
    expect(packet.packets[2]).toEqual({ x: packet.x0, ro: 1 });
    expect(packet.packets.filter(p => p.ro !== undefined)).toHaveLength(1);
    expect(packet.classAfterStart).toBe(true);
    expect(packet.xEnd - packet.x0).toBeCloseTo(70, 3);

    // Host: Start-Paket empfangen, danach rollt P2 dort 12 Schritte, ignoriert Client-Positionen und ist unverwundbar
    await asOnline(page, true);
    const host = await page.evaluate(async p => {
      const g = window.__game;
      const { state, arrays, Entities } = g;
      const NK = await import('./js/net-encoding.js');
      const out = {};
      state.p2.viperRollTimer = 0;
      state.p2.viperRollCooldown = 0;
      state.p2.isDead = false;
      state.p2.lives = 3;
      state.p2.y = 400;
      // Der Sender schickt das Start-Paket sofort
      const sender = new NK.InputSender();
      const input = { x: p.x0, y: 400, rotate: 0, laser: false, missile: false, bomb: false };
      sender.next(input);
      const startPacket = sender.next({ ...input, ro: 1 });
      out.senderPacket = startPacket ? startPacket.ro : null;
      g.Network.applyPlayerInput({ ...input, ro: 1 });
      // Falsche Richtungswerte werden ignoriert
      out.withRo = state.p2.networkRollRequest;
      // Nachfolgendes Client-Paket mit weiterer Position darf den Startpunkt nicht verschieben
      g.Network.applyPlayerInput({ ...input, x: p.x0 + 12 });
      out.xBeforeStart = state.p2.x;
      Entities.createEnemyLaser(p.x0 + 14, 410);
      Object.assign(arrays.enemyLaserArray[0], { vx: 0, vy: 0 });
      g.Loop.simulationStep();
      out.afterStart = {
        timer: state.p2.viperRollTimer,
        cls: document.getElementById('spieler-2').classList.contains('viper-rolle'),
        lives: state.p2.lives,
        cd: state.p2.viperRollCooldown,
      };
      // Client-Positionen waehrend der Rolle werden ignoriert
      g.Network.applyPlayerInput({ ...input, x: 5 });
      for (let i = 0; i < 11; i++) g.Loop.simulationStep();
      out.dx = state.p2.x - p.x0;
      out.lives = state.p2.lives;
      out.snapshot = [
        g.Network.serializeGameState().p2.viperRollTimer,
        g.Network.serializeGameState().p2.viperRollCooldown,
      ];
      g.Loop.simulationStep();
      out.thereafter = state.p2.viperRollTimer;
      // Eine zweite Anfrage im Cooldown wird abgelehnt
      g.Network.applyPlayerInput({ ...input, x: state.p2.x, ro: -1 });
      g.Loop.simulationStep();
      out.second = state.p2.viperRollTimer;
      return out;
    }, packet);
    expect(host.senderPacket).toBe(1);
    expect(host.withRo).toBe(1);
    expect(host.xBeforeStart).toBeCloseTo(packet.x0, 3);
    expect(host.afterStart.timer).toBe(12);
    expect(host.afterStart.cls).toBe(true);
    expect(host.afterStart.lives).toBe(3);
    expect(host.afterStart.cd).toBe(90);
    expect(host.dx).toBeCloseTo(70, 3);
    expect(host.lives).toBe(3);
    expect(host.snapshot[0]).toBe(1);
    expect(host.snapshot[1]).toBeGreaterThan(70);
    expect(host.thereafter).toBe(0);
    expect(host.second).toBe(0);
  });
});

// --- Near-Miss + Overdrive ---
// Ein feindliches Geschoss, das dem Schiff auf <= 18 px nahe kommt, ohne zu treffen, und sich dann entfernt,
// laedt die Overdrive-Leiste um 10. Bei 100 startet der Overdrive fuer 300 Schritte (doppelte Feuerrate, Durchschlag).

// Feindlichen Laser (kein Zielen, gerade nach unten) mit linker Kante x ueber dem Schiff erzeugen
async function nearMissLane(page, { x, list = 'enemyLaserArray', harmless = false, ys = [300], steps = 60 }) {
  return page.evaluate(
    ({ x, list, harmless, ys, steps }) => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.viperOverdriveStrip = 0;
      state.viperOverdriveTimer = 0;
      state.x = 150;
      state.y = 400;
      ys.forEach((y, i) => {
        const el = document.createElement('div');
        el.classList.add('feind-laser');
        document.getElementById('spielfeld').appendChild(el);
        arrays[list].push({
          id: 'nm' + i,
          el,
          x,
          y,
          vx: 0,
          vy: 5,
          width: 4,
          height: 15,
          harmless: harmless || undefined,
        });
      });
      const lives = state.lives;
      T.steps(steps);
      return {
        strip: state.viperOverdriveStrip,
        timer: state.viperOverdriveTimer,
        lives: state.lives,
        lost: lives - state.lives,
        ticks: window.__game.Audio.audioHistory.filter(a => a.name === 'nearMiss').length,
        plus: document.querySelectorAll('.viper-nearmiss-plus').length,
      };
    },
    { x, list, harmless, ys, steps },
  );
}

test.describe('Viper-X Near-Miss und Overdrive', () => {
  test('Geschoss 10 px neben dem Schiff: +10, nur einmal; 30 px daneben: 0; Treffer: 0; harmlos: 0', async ({
    page,
  }) => {
    await startGame(page);
    // Schiff x 150..180; Laser-Kante bei 190 = 10 px Abstand
    const near = await nearMissLane(page, { x: 190 });
    expect(near.strip).toBe(10);
    expect(near.ticks).toBe(1);
    expect(near.lost).toBe(0);
    // weitere Schritte zaehlen dasselbe Geschoss nicht noch einmal (ist laengst aus dem Feld, Leiste bleibt)
    const overlaps = await page.evaluate(() => {
      window.__viperTest.steps(30);
      return window.__game.state.viperOverdriveStrip;
    });
    expect(overlaps).toBe(10);
    // Linke Seite: Laser rechts der Kante 150: Mitte 142 -> Abstand 150 - (142 + 4) = 4
    expect((await nearMissLane(page, { x: 142 })).strip).toBe(10);
    // 30 px daneben
    const remote = await nearMissLane(page, { x: 210 });
    expect(remote.strip).toBe(0);
    expect(remote.ticks).toBe(0);
    // genau 18 px zaehlt, 19 px nicht
    expect((await nearMissLane(page, { x: 198 })).strip).toBe(10);
    expect((await nearMissLane(page, { x: 199 })).strip).toBe(0);
    // Treffer zaehlt nicht
    const hit = await nearMissLane(page, { x: 165 });
    expect(hit.strip).toBe(0);
    expect(hit.lost).toBe(1);
    // harmlos (von der Gleve weggeschleudert) zaehlt nicht
    expect((await nearMissLane(page, { x: 190, harmless: true })).strip).toBe(0);
    // Boss-Laser zaehlt wie Feind-Laser
    expect((await nearMissLane(page, { x: 190, list: 'bossLaserArray' })).strip).toBe(10);
    // Zwei Geschosse nacheinander: +20
    expect((await nearMissLane(page, { x: 190, ys: [300, 330] })).strip).toBe(20);
  });

  test('waehrend der Ausweichrolle zaehlt ein Near-Miss ebenfalls; mehrere Geschosse mit Hack-Projektil und Rakete', async ({
    page,
  }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.viperOverdriveStrip = 0;
      state.viperOverdriveTimer = 0;
      // Rolle laeuft (Richtung 0: das Schiff bleibt stehen), unverwundbar
      state.viperRollTimer = 200;
      state.viperRollDirection = 0;
      const fresh = (list, extra) => {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays[list].push({ id: 'x' + list, el, x: 190, y: 300, vx: 0, vy: 5, width: 4, height: 15, ...extra });
      };
      fresh('enemyLaserArray', {});
      fresh('hackProjectileArray', { y: 280, steerTime: 0, width: 6, height: 6 });
      fresh('bossMissileArray', { y: 260, hp: 5, width: 10, height: 20, speed: 5, turnRate: 0 });
      T.steps(40);
      return state.viperOverdriveStrip;
    });
    expect(r).toBe(30);
  });

  test('10 Near-Misses starten den Overdrive fuer 300 Schritte, die Leiste leert sich, danach aus', async ({
    page,
  }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      const out = {};
      T.empty();
      state.viperOverdriveStrip = 0;
      state.viperOverdriveTimer = 0;
      for (let i = 0; i < 10; i++) {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays.enemyLaserArray.push({ id: 'od' + i, el, x: 190, y: 100 + i * 20, vx: 0, vy: 5, width: 4, height: 15 });
      }
      T.steps(100);
      const cls = () => document.getElementById('spieler').classList.contains('viper-overdrive');
      out.start = [state.viperOverdriveStrip, state.viperOverdriveTimer, cls()];
      out.sounds = [
        window.__game.Audio.audioHistory.filter(a => a.name === 'overdrive').length,
        window.__game.Audio.audioHistory.filter(a => a.name === 'nearMiss').length,
      ];
      const timerAfterStart = state.viperOverdriveTimer;
      // weitere Near-Misses laden waehrend des Overdrives nicht nach
      const el = document.createElement('div');
      document.getElementById('spielfeld').appendChild(el);
      arrays.enemyLaserArray.push({ id: 'extra', el, x: 190, y: 300, vx: 0, vy: 5, width: 4, height: 15 });
      const t0 = timerAfterStart;
      T.steps(60);
      out.middle = [state.viperOverdriveStrip, state.viperOverdriveTimer, t0 - state.viperOverdriveTimer, cls()];
      out.hud = document.getElementById('viper-overdrive-hud').classList.contains('aktiv');
      T.steps(timerAfterStart - 60 - 1);
      out.fast = [state.viperOverdriveTimer, cls()];
      T.steps(1);
      out.off = [state.viperOverdriveStrip, state.viperOverdriveTimer, cls()];
      out.hudOff = document.getElementById('viper-overdrive-hud').classList.contains('aktiv');
      return out;
    });
    expect(r.start[0]).toBeGreaterThan(50);
    expect(r.start[1]).toBeGreaterThan(0);
    expect(r.start[2]).toBe(true);
    expect(r.sounds).toEqual([1, 9]);
    expect(r.middle[2]).toBe(60);
    expect(r.middle[0]).toBeLessThan(r.start[0]);
    expect(r.middle[3]).toBe(true);
    expect(r.hud).toBe(true);
    expect(r.fast).toEqual([1, true]);
    expect(r.off).toEqual([0, 0, false]);
    expect(r.hudOff).toBe(false);
  });

  test('Overdrive dauert genau 300 Schritte ab Start', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.viperOverdriveStrip = 90;
      state.viperOverdriveTimer = 0;
      const el = document.createElement('div');
      document.getElementById('spielfeld').appendChild(el);
      arrays.enemyLaserArray.push({ id: 'z', el, x: 190, y: 380, vx: 0, vy: 5, width: 4, height: 15 });
      let start = null;
      for (let i = 1; i <= 20 && start === null; i++) {
        T.steps(1);
        if (state.viperOverdriveTimer > 0) start = i;
      }
      const t = state.viperOverdriveTimer;
      let duration = 0;
      while (state.viperOverdriveTimer > 0 && duration < 400) {
        T.steps(1);
        duration++;
      }
      return { t, strip: state.viperOverdriveStrip, duration };
    });
    expect(r.t).toBe(300);
    expect(r.duration).toBe(300);
    expect(r.strip).toBe(0);
  });

  test('im Overdrive halbe Schussabstaende und Durchschlag, ausserhalb nicht', async ({ page }) => {
    await startGame(page);
    const measure = overdrive =>
      page.evaluate(overdrive => {
        const { state, arrays } = window.__game;
        const T = window.__viperTest;
        T.empty();
        state.laserTier = 1;
        state.laserPierce = false;
        state.energy = 50;
        state.maxEnergy = 50;
        state.unlimitedEnergy = true;
        state.playerShotCooldown = 0;
        state.viperOverdriveStrip = overdrive ? 100 : 0;
        state.viperOverdriveTimer = overdrive ? 300 : 0;
        // zwei hintereinander stehende, ruhende Ziele ueber dem Schiff
        const targets = [300, 200].map((y, i) => {
          const el = document.createElement('div');
          el.classList.add('asteroid');
          document.getElementById('spielfeld').appendChild(el);
          const a = {
            id: 'target' + i,
            el,
            x: 140,
            y,
            size: 50,
            vx: 0,
            vy: 0,
            immune: 0,
            hp: 100000,
            maxHp: 100000,
            isMagma: false,
            isIndestructible: false,
            carriesPowerup: false,
            crackEl: null,
            isEnemy: false,
            rot: 0,
            vRot: 0,
          };
          arrays.asteroids.push(a);
          return a;
        });
        const ids = new Set();
        state.keysPressed.l = true;
        for (let i = 0; i < 30; i++) {
          T.steps(1);
          arrays.laserArray.forEach(l => ids.add(l.id));
        }
        state.keysPressed.l = false;
        return { shots: ids.size, hp: targets.map(z => z.hp) };
      }, overdrive);
    const normal = await measure(false);
    const od = await measure(true);
    expect(normal.hp[0]).toBeLessThan(100000);
    expect(normal.hp[1]).toBe(100000);
    expect(od.hp[0]).toBeLessThan(100000);
    expect(od.hp[1]).toBeLessThan(100000);
    expect(normal.shots).toBe(5);
    expect(od.shots).toBe(10);
  });

  test('Phantom bekommt keinen Overdrive und keine Leiste im HUD', async ({ page }) => {
    await startGame(page, { p1: 'phantom' });
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.viperOverdriveStrip = 0;
      state.viperOverdriveTimer = 0;
      for (let i = 0; i < 12; i++) {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays.enemyLaserArray.push({ id: 'ph' + i, el, x: 190, y: 100 + i * 20, vx: 0, vy: 5, width: 4, height: 15 });
      }
      T.steps(100);
      return {
        strip: state.viperOverdriveStrip,
        timer: state.viperOverdriveTimer,
        hud: document.getElementById('viper-overdrive-hud').style.display,
        cls: document.getElementById('spieler').classList.contains('viper-overdrive'),
      };
    });
    expect(r).toEqual({ strip: 0, timer: 0, hud: 'none', cls: false });
  });

  test('Neustart setzt Leiste und Overdrive zurueck', async ({ page }) => {
    await startGame(page);
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      state.viperOverdriveStrip = 70;
      state.viperOverdriveTimer = 120;
      state.p2.viperOverdriveStrip = 30;
      Utils.restartGame();
      return [state.viperOverdriveStrip, state.viperOverdriveTimer, state.p2.viperOverdriveStrip];
    });
    expect(r).toEqual([0, 0, 0]);
  });

  test('Bot-Viper sammelt Near-Misses ohne Fehler', async ({ page }) => {
    await startGame(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.empty();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      state.p2.viperOverdriveStrip = 0;
      state.p2.viperOverdriveTimer = 0;
      state.x = 340;
      state.p2.x = 150;
      state.p2.y = 400;
      const error = [];
      window.addEventListener('error', e => error.push(e.message));
      for (let i = 0; i < 6; i++) {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays.enemyLaserArray.push({ id: 'b' + i, el, x: 192, y: 100 + i * 25, vx: 0, vy: 5, width: 4, height: 15 });
      }
      T.steps(120);
      return {
        error,
        stripPlausible: state.p2.viperOverdriveStrip >= 0 && state.p2.viperOverdriveStrip <= 100,
        lives: state.p2.lives,
      };
    });
    expect(r.error).toEqual([]);
    expect(r.stripPlausible).toBe(true);
  });
});

test.describe('Viper-X Near-Miss und Overdrive: Online', () => {
  async function asOnline(page, host) {
    await page.evaluate(host => {
      const { state, arrays, Utils } = window.__game;
      Utils.setGameMode('online');
      state.gameRunning = true;
      state.paused = false;
      state.cutsceneActive = false;
      state.gameOverActive = false;
      state.bossWarningActive = false;
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'viper';
      state.network.isOnline = true;
      state.network.isHost = host;
      state.network.isClient = !host;
      state.network.connected = true;
      state.frameCounter = 1;
      [
        'enemies',
        'asteroids',
        'bosses',
        'powerups',
        'laserArray',
        'missileArray',
        'bombArray',
        'enemyLaserArray',
        'hackProjectileArray',
        'bossLaserArray',
        'bossMissileArray',
        'bossBombArray',
      ].forEach(n => {
        arrays[n].forEach(o => {
          if (o.el) o.el.remove();
        });
        arrays[n].length = 0;
      });
      Object.keys(state.keysPressed).forEach(k => {
        state.keysPressed[k] = false;
      });
    }, host);
  }

  test('Snapshot enthaelt Leiste und Overdrive-Timer (ganzzahlig), der Client zeigt die Klasse und spielt die Sounds fuer das eigene Schiff', async ({
    page,
  }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await asOnline(page, true);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const { state } = g;
      const NK = await import('./js/net-encoding.js');
      const out = {};
      state.viperOverdriveStrip = 50;
      state.viperOverdriveTimer = 150.4;
      state.p2.viperOverdriveStrip = 40;
      state.p2.viperOverdriveTimer = 0;
      const full = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
      out.raw = [
        full.p1.viperOverdriveStrip,
        full.p1.viperOverdriveTimer,
        full.p2.viperOverdriveStrip,
        full.p2.viperOverdriveTimer,
      ];
      state.p2.selectedShipModel = 'phantom';
      out.phantomFields = 'viperOverdriveStrip' in g.Network.serializeGameState().p2;
      state.p2.selectedShipModel = 'viper';
      const encoder = new NK.SnapshotEncoder();
      const decoder = new NK.SnapshotDecoder();
      const recon = decoder.decode(JSON.parse(JSON.stringify(encoder.encode(full, 0))));
      out.wire = [
        recon.p1.viperOverdriveStrip,
        recon.p1.viperOverdriveTimer,
        recon.p2.viperOverdriveStrip,
        recon.p2.viperOverdriveTimer,
      ];

      // Client: Host-P1 im Overdrive, eigenes Schiff (P2) lernt einen Near-Miss kennen
      state.network.isHost = false;
      state.network.isClient = true;
      state.viperOverdriveStrip = 0;
      state.viperOverdriveTimer = 0;
      state.p2.viperOverdriveStrip = 30;
      state.p2.viperOverdriveTimer = 0;
      g.Audio.clearAudioHistory();
      g.Network.applyGameStateSnapshot(recon);
      g.Loop.simulationStep();
      out.classP1 = document.getElementById('spieler').classList.contains('viper-overdrive');
      out.hudP1 = document.getElementById('viper-overdrive-hud').classList.contains('aktiv');
      out.classP2 = document.getElementById('spieler-2').classList.contains('viper-overdrive');
      out.stripClientP2 = state.p2.viperOverdriveStrip;
      out.tickAudio = g.Audio.audioHistory.filter(a => a.name === 'nearMiss').length;
      // eigener Overdrive startet
      const copy = JSON.parse(JSON.stringify(recon));
      copy.p2.viperOverdriveStrip = 100;
      copy.p2.viperOverdriveTimer = 300;
      g.Network.applyGameStateSnapshot(copy);
      g.Loop.simulationStep();
      out.classP2Thereafter = document.getElementById('spieler-2').classList.contains('viper-overdrive');
      out.overdriveAudio = g.Audio.audioHistory.filter(a => a.name === 'overdrive').length;
      return out;
    });
    expect(r.raw).toEqual([50, 150.4, 40, 0]);
    expect(r.phantomFields).toBe(false);
    expect(r.wire).toEqual([50, 150, 40, 0]);
    expect(r.classP1).toBe(true);
    expect(r.hudP1).toBe(true);
    expect(r.classP2).toBe(false);
    expect(r.stripClientP2).toBe(40);
    expect(r.tickAudio).toBe(1);
    expect(r.classP2Thereafter).toBe(true);
    expect(r.overdriveAudio).toBe(1);
  });

  test('Host erkennt Near-Miss des Client-Schiffs (P2) und serialisiert die Leiste', async ({ page }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await asOnline(page, true);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const { state, arrays } = g;
      state.p2.x = 250;
      state.p2.y = 400;
      state.p2.isDead = false;
      state.p2.viperOverdriveStrip = 0;
      state.p2.viperOverdriveTimer = 0;
      const el = document.createElement('div');
      document.getElementById('spielfeld').appendChild(el);
      arrays.enemyLaserArray.push({ id: 'h', el, x: 290, y: 300, vx: 0, vy: 5, width: 4, height: 15 });
      for (let i = 0; i < 40; i++) g.Loop.simulationStep();
      return [state.p2.viperOverdriveStrip, g.Network.serializeGameState().p2.viperOverdriveStrip];
    });
    expect(r).toEqual([10, 10]);
  });
});

// Kill-Kombo (V3): Kills binnen 120 Schritten steigern viperKombo (Punkte x(1+0.1*Kombo), max x3; Feuerrate ab 5/10),
// ein Treffer setzt sie auf 0 und die Viper verliert keine Waffen-Upgrades mehr.
test.describe('Viper-X Kill-Kombo', () => {
  // Hilfen im Seitenkontext: killFeind(killer) zerstoert einen Dummy-Feind ueber Utils.zerstoereZiel
  async function ready(page, opts) {
    await startGame(page, opts);
    await page.evaluate(() => {
      const T = window.__viperTest;
      T.killEnemy = (killer = 'p1') => {
        const { arrays, Utils } = window.__game;
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        const enemy = { el, x: 20, y: 20, size: 30, isEnemy: true, pattern: 'normal', hp: 0 };
        arrays.enemies.push(enemy);
        Utils.destroyTarget(enemy, killer);
      };
      T.empty();
    });
  }

  test('3 Kills im Fenster -> Kombo 3; Fenster laeuft ab -> 0; der erste Kill zaehlt als 1', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state } = window.__game;
      const out = {};
      // Asteroiden spawnen bei frameZaehler % 120 === 0 und koennten das Schiff treffen (Kombo -> 0):
      // Zaehler vor jedem Block zuruecksetzen, damit kein Block die 120 erreicht
      const steps = n => {
        state.frameCounter = 1;
        T.steps(n);
      };
      T.killEnemy();
      out.first = state.viperCombo;
      steps(100);
      T.killEnemy();
      steps(100);
      T.killEnemy();
      out.three = [state.viperCombo, state.viperComboTimer];
      steps(119);
      out.stillThere = state.viperCombo;
      steps(2);
      out.expired = [state.viperCombo, state.viperComboTimer];
      return out;
    });
    expect(r.first).toBe(1);
    expect(r.three).toEqual([3, 120]);
    expect(r.stillThere).toBe(3);
    expect(r.expired).toEqual([0, 0]);
  });

  test('Treffer setzt die Kombo auf 0 (auch ein vom Schild abgefangener), Waffenstufen bleiben unveraendert', async ({
    page,
  }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      const dummy = { isEnemy: false, el: { dataset: {} }, x: 0, y: 0 };
      const out = {};
      state.laserTier = 4;
      state.missileTier = 3;
      state.bombTier = 2;
      state.viperCombo = 8;
      state.viperComboTimer = 90;
      Utils.playerHit(dummy, false, 'p1');
      out.hit = {
        combo: state.viperCombo,
        timer: state.viperComboTimer,
        lives: state.lives,
        tiers: [state.laserTier, state.missileTier, state.bombTier],
      };
      // Schild faengt den Treffer ab, die Kombo faellt trotzdem
      state.invulnerableTimer = 0;
      state.shieldTier = 1;
      state.viperCombo = 6;
      state.viperComboTimer = 50;
      Utils.playerHit(dummy, false, 'p1');
      out.shield = { combo: state.viperCombo, lives: state.lives, shield: state.shieldTier };
      // Unverwundbar (kein Treffer) laesst die Kombo stehen
      state.viperCombo = 4;
      Utils.playerHit(dummy, false, 'p1');
      out.withoutHit = state.viperCombo;
      return out;
    });
    expect(r.hit).toEqual({ combo: 0, timer: 0, lives: 2, tiers: [4, 3, 2] });
    expect(r.shield).toEqual({ combo: 0, lives: 2, shield: 0 });
    expect(r.withoutHit).toBe(4);
  });

  test('Viper hat loseUpgradesOnHit aus; Perk-Liste nennt Kombo statt Upgrade-Verlust', async ({ page }) => {
    await page.waitForFunction(() => window.__game && window.__game.shipModels);
    const r = await page.evaluate(() => {
      const v = window.__game.shipModels.viper;
      return { lose: v.loseUpgradesOnHit, labels: v.perks.map(p => p.label) };
    });
    expect(r.lose).toBe(false);
    expect(r.labels).toContain('KILL-KOMBO');
    expect(r.labels).toContain('TREFFER: KOMBO WEG');
    expect(r.labels).not.toContain('TREFFER: -1 UPGRADE');
  });

  test('Punkte eines Kills bei Kombo 10 = Grundpunkte x 2.0, ab Kombo 20 bei x3 gedeckelt', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state } = window.__game;
      const delta = combo => {
        state.viperCombo = combo;
        state.viperComboTimer = 120;
        const s0 = state.score;
        T.killEnemy();
        return state.score - s0;
      };
      return {
        k0: delta(0),
        k5: delta(5),
        k10: delta(10),
        k20: delta(20),
        k50: delta(50),
        thereafter: state.viperCombo,
      };
    });
    expect(r.k0).toBe(100);
    expect(r.k5).toBe(150);
    expect(r.k10).toBe(200);
    expect(r.k20).toBe(300);
    expect(r.k50).toBe(300);
    expect(r.thereafter).toBe(51);
  });

  test('Feuerrate: Kombo 5 -> Cooldown 5, Kombo 10 -> 4, Overdrive bleibt bei 3, ohne Kombo 6', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state } = window.__game;
      const cd = (combo, overdrive = 0) => {
        state.viperCombo = combo;
        state.viperComboTimer = 120;
        state.viperOverdriveTimer = overdrive;
        state.playerShotCooldown = 0;
        state.energy = state.maxEnergy;
        state.keysPressed.l = true;
        T.steps(1);
        state.keysPressed.l = false;
        T.steps(1);
        return state.playerShotCooldown;
      };
      // nach dem Schuss-Schritt zaehlt der Folgeschritt 1 herunter: Wert = Cooldown - 1
      return { k0: cd(0), k4: cd(4), k5: cd(5), k9: cd(9), k10: cd(10), k25: cd(25), od: cd(10, 100) };
    });
    expect(r.k0).toBe(5);
    expect(r.k4).toBe(5);
    expect(r.k5).toBe(4);
    expect(r.k9).toBe(4);
    expect(r.k10).toBe(3);
    expect(r.k25).toBe(3);
    expect(r.od).toBe(2);
  });

  test('Sound bei Kombo 5, 10 und 20 (genau dort), sonst keiner', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { Audio } = window.__game;
      const tiers = [];
      for (let i = 1; i <= 21; i++) {
        Audio.clearAudioHistory();
        T.killEnemy();
        const h = Audio.audioHistory.filter(a => a.name === 'combo');
        if (h.length) tiers.push([i, h[0].details.tier]);
      }
      return tiers;
    });
    expect(r).toEqual([
      [5, 1],
      [10, 2],
      [20, 3],
    ]);
  });

  test('Phantom hat keine Kombo: Kills aendern nichts, Punkte ohne Faktor, Cooldown 6', async ({ page }) => {
    await ready(page, { p1: 'phantom' });
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state } = window.__game;
      const s0 = state.score;
      state.viperCombo = 10; // kuenstlich gesetzt: ohne Viper wirkungslos
      T.killEnemy();
      const points = state.score - s0;
      state.keysPressed.l = true;
      T.steps(1);
      return {
        points,
        combo: state.viperCombo,
        cooldown: state.playerShotCooldown,
        hud: document.getElementById('viper-kombo-hud').style.display,
      };
    });
    expect(r.points).toBe(100);
    expect(r.combo).toBe(10);
    expect(r.cooldown).toBe(6);
    expect(r.hud).toBe('none');
  });

  test('Coop: Kills von P2 erhoehen nur die Kombo von P2, Treffer an P1 laesst P2 unberuehrt', async ({ page }) => {
    await ready(page, { coop: true });
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state, Utils } = window.__game;
      T.killEnemy('p2');
      T.killEnemy('p2');
      T.killEnemy('p1');
      const afterKills = { p1: state.viperCombo, p2: state.p2.viperCombo };
      // P2-Kill mit Kombo 10 zaehlt x2, P1-Kill (Kombo 1) x1.1
      state.p2.viperCombo = 10;
      const s0 = state.score;
      T.killEnemy('p2');
      const p2Points = state.score - s0;
      const s1 = state.score;
      T.killEnemy('p1');
      const p1Points = state.score - s1;
      Utils.playerHit({ isEnemy: false, el: { dataset: {} }, x: 0, y: 0 }, false, 'p1');
      return { afterKills, p2Points, p1Points, afterHit: { p1: state.viperCombo, p2: state.p2.viperCombo } };
    });
    expect(r.afterKills).toEqual({ p1: 1, p2: 2 });
    expect(r.p2Points).toBe(200);
    expect(r.p1Points).toBe(110);
    expect(r.afterHit).toEqual({ p1: 0, p2: 11 });
  });

  test('HUD: "KOMBO 7 · x1.7" nur bei Kombo > 0, Puls bei Erhoehung, P2 analog, x3.0 gedeckelt', async ({ page }) => {
    await ready(page, { coop: true });
    const r = await page.evaluate(() => {
      const T = window.__viperTest;
      const { state } = window.__game;
      const h1 = document.getElementById('viper-kombo-hud');
      const h2 = document.getElementById('viper-kombo-hud-p2');
      const read = h => ({ display: h.style.display, text: h.textContent, pulse: h.classList.contains('puls') });
      const out = {};
      T.steps(1);
      out.null = [read(h1).display, read(h2).display];
      state.viperCombo = 7;
      state.viperComboTimer = 100;
      state.p2.viperCombo = 25;
      state.p2.viperComboTimer = 100;
      T.steps(1);
      out.p1 = read(h1);
      out.p2 = read(h2);
      state.viperCombo = 8;
      T.steps(1);
      out.p1High = read(h1);
      state.viperComboTimer = 1;
      T.steps(2);
      out.p1Gone = read(h1);
      return out;
    });
    expect(r.null).toEqual(['none', 'none']);
    expect(r.p1.display).toBe('block');
    expect(r.p1.text).toBe('KOMBO 7 · x1.7');
    expect(r.p2.text).toBe('KOMBO 25 · x3.0');
    expect(r.p1High.text).toBe('KOMBO 8 · x1.8');
    expect(r.p1High.pulse).toBe(true);
    expect(r.p1Gone.display).toBe('none');
  });

  test('Online: Snapshot traegt Kombo und Timer beider Viper (ganzzahlig, nur Viper), der Client zeigt sie und tickt nicht selbst', async ({
    page,
  }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await page.evaluate(() => {
      const { state, arrays, Utils } = window.__game;
      Utils.setGameMode('online');
      state.gameRunning = true;
      state.paused = false;
      state.cutsceneActive = false;
      state.gameOverActive = false;
      state.bossWarningActive = false;
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'viper';
      state.network.isOnline = true;
      state.network.isHost = true;
      state.network.isClient = false;
      state.network.connected = true;
      state.frameCounter = 1;
      [
        'enemies',
        'asteroids',
        'bosses',
        'powerups',
        'laserArray',
        'missileArray',
        'bombArray',
        'enemyLaserArray',
        'hackProjectileArray',
        'bossLaserArray',
        'bossMissileArray',
        'bossBombArray',
      ].forEach(n => {
        arrays[n].forEach(o => {
          if (o.el) o.el.remove();
        });
        arrays[n].length = 0;
      });
      Object.keys(state.keysPressed).forEach(k => {
        state.keysPressed[k] = false;
      });
    });
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const { state } = g;
      const NK = await import('./js/net-encoding.js');
      const out = {};
      state.viperCombo = 7;
      state.viperComboTimer = 80.4;
      state.p2.viperCombo = 5;
      state.p2.viperComboTimer = 30;
      const full = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
      out.raw = [full.p1.viperCombo, full.p1.viperComboTimer, full.p2.viperCombo, full.p2.viperComboTimer];
      state.p2.selectedShipModel = 'phantom';
      out.phantomFields = 'viperCombo' in g.Network.serializeGameState().p2;
      state.p2.selectedShipModel = 'viper';
      const encoder = new NK.SnapshotEncoder();
      const decoder = new NK.SnapshotDecoder();
      const recon = decoder.decode(JSON.parse(JSON.stringify(encoder.encode(full, 0))));
      out.wire = [recon.p1.viperCombo, recon.p1.viperComboTimer, recon.p2.viperCombo, recon.p2.viperComboTimer];

      // Client: Host-P1 Kombo 7, eigenes Schiff (P2) springt von 4 auf 5 -> Sound
      state.network.isHost = false;
      state.network.isClient = true;
      state.viperCombo = 0;
      state.viperComboTimer = 0;
      state.p2.viperCombo = 4;
      state.p2.viperComboTimer = 10;
      g.Audio.clearAudioHistory();
      g.Network.applyGameStateSnapshot(recon);
      g.Loop.simulationStep();
      out.client = [
        state.viperCombo,
        state.p2.viperCombo,
        document.getElementById('viper-kombo-hud').textContent,
        document.getElementById('viper-kombo-hud-p2').style.display,
      ];
      out.sounds = g.Audio.audioHistory.filter(a => a.name === 'combo').length;
      // Der Client zaehlt das Fenster nicht selbst herunter und verwirft die Kombo nicht
      state.p2.viperComboTimer = 1;
      for (let i = 0; i < 5; i++) g.Loop.simulationStep();
      out.noTick = [state.p2.viperCombo, state.p2.viperComboTimer];
      return out;
    });
    expect(r.raw).toEqual([7, 80.4, 5, 30]);
    expect(r.phantomFields).toBe(false);
    expect(r.wire).toEqual([7, 80, 5, 30]);
    expect(r.client[0]).toBe(7);
    expect(r.client[1]).toBe(5);
    expect(r.client[2]).toBe('KOMBO 7 · x1.7');
    expect(r.client[3]).toBe('block');
    expect(r.sounds).toBe(1);
    expect(r.noTick).toEqual([5, 1]);
  });
});
