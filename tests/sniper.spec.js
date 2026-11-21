const { test, expect } = require('@playwright/test');
const { setGameState } = require('./helpers');

// Spectre-SR (sniper): Grundlage (Auswahl, Anzeige, HUD) und Fadenkreuz-Schuss (S2).

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

async function startPerKey(page) {
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  await page.keyboard.up('KeyW');
}

test('Spectre-SR: im Hangar waehlbar, Name und Perks aus shipModels, Railgun-SVG, Werfer-Pods aus, HUD GRANATE', async ({
  page,
}) => {
  const btn = page.locator('.hangar-model-btn[data-model="sniper"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(btn).toHaveClass(/active/);

  const values = await page.evaluate(() => {
    const { state, shipModels } = window.__game;
    const m = shipModels.sniper;
    return {
      model: state.selectedShipModel,
      name: m.name,
      speed: m.speed,
      regen: m.energyRegen,
      perks: m.perks.map(p => p.label),
    };
  });
  expect(values.model).toBe('sniper');
  expect(values.speed).toBe(4.5);
  expect(values.regen).toBe(0.45);
  expect(values.perks).toHaveLength(5);
  await expect(page.locator('#hangar-ship-name')).toContainText(values.name);
  await expect(page.locator('#hangar-ship-perks .hangar-perk-chip')).toHaveCount(values.perks.length);
  for (let i = 0; i < values.perks.length; i++) {
    await page.locator('#hangar-ship-perks .hangar-perk-chip').nth(i).click();
    await expect(page.locator('#hangar-perk-detail')).toContainText(values.perks[i]);
  }
  expect(await page.locator('#hangar-preview-svg').evaluate(el => el.innerHTML)).toContain('Railgun');

  await startPerKey(page);

  expect(await page.locator('#spieler svg').evaluate(el => el.innerHTML)).toContain('Railgun');
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('E');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('GRANATE');
  await expect(page.locator('#btn-rakete span')).toHaveText('G');

  // Pods bleiben auch bei hoher Raketenstufe aus, ohne Abwurf-Effekt
  const drop = await page.evaluate(() => {
    const { state, Utils } = window.__game;
    state.missileTier = 5;
    Utils.updateActivePowerupsUi();
    state.missileTier = 1;
    Utils.updateActivePowerupsUi();
    return document.querySelectorAll('.werfer-abgeworfen').length;
  });
  expect(drop).toBe(0);
  for (const pod of ['left', 'right', 'center']) {
    await expect(page.locator('#spieler .werfer-' + pod)).toBeHidden();
  }

  // Zurueck zur Viper: Originaltexte und Werfer
  await page.evaluate(() => {
    window.__game.state.selectedShipModel = 'viper';
    window.__game.Utils.updatePlayerShipVisuals();
  });
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('R');
  await expect(page.locator('#btn-rakete span')).toHaveText('R');
  await expect(page.locator('#spieler .werfer-links')).toBeVisible();
});

test('Spectre-SR: im Coop fuer Spieler 2 waehlbar, P2-HUD, Highscore-Badge', async ({ page }) => {
  await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
  await page.locator('.hangar-player-tab[data-player="p2"]').click();
  await page.locator('.hangar-model-btn[data-model="sniper"]').click();
  const models = await page.evaluate(() => ({
    p1: window.__game.state.selectedShipModel,
    p2: window.__game.state.p2.selectedShipModel,
  }));
  expect(models).toEqual({ p1: 'viper', p2: 'sniper' });
  await expect(page.locator('#raketen-cd-container-p2 .cooldown-letter')).toHaveText('GRANATE');
  await expect(page.locator('#energie-cd-container-p2 .cooldown-letter')).toHaveText('E');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('R');
  expect(await page.locator('#spieler-2 svg').evaluate(el => el.innerHTML)).toContain('Railgun');

  const badge = await page.evaluate(() => {
    window.__game.Utils.renderHighscoresTable('single', [
      { name: 'AAA', score: 100, level: 1, shipP1: 'sniper', country: '', city: '' },
    ]);
    const b = document.querySelector('#highscore-body [class*="hs-ship-"]');
    return b ? { cls: b.className, text: b.textContent } : null;
  });
  expect(badge).not.toBeNull();
  expect(badge.cls).toContain('hs-ship-sniper');
  expect(badge.cls).not.toContain('hs-ship-viper');
});

test('Spectre-SR: Coop mit Bot und Dauerfeuer laeuft ohne Fehler und ohne normale Laserprojektile', async ({
  page,
}) => {
  const error = [];
  page.on('pageerror', e => error.push(e.message));
  await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
  await page.locator('.hangar-player-tab[data-player="p2"]').click();
  await page.locator('.hangar-model-btn[data-model="sniper"]').click();
  await page.locator('.hangar-player-tab[data-player="p1"]').click();
  await page.locator('.hangar-model-btn[data-model="sniper"]').click();
  await page.evaluate(() => {
    window.__game.state.p2IsBot = true;
  });
  await startPerKey(page);
  const result = await page.evaluate(() => {
    const { state, arrays, Loop } = window.__game;
    state.godMode = true;
    state.keysPressed.l = true;
    state.keysPressed.k = true;
    let laser = 0;
    for (let i = 0; i < 900; i++) {
      Loop.simulationStep();
      laser = Math.max(laser, arrays.laserArray.length);
    }
    return { laser, p1: state.selectedShipModel, p2: state.p2.selectedShipModel };
  });
  expect(result.laser).toBe(0);
  expect(result.p1).toBe('sniper');
  expect(result.p2).toBe('sniper');
  expect(error).toEqual([]);
});

test('Spectre-SR: Menue bleibt mit vier Hangar-Knoepfen einzeilig und ohne Scrollen', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  const m = await page.evaluate(() => {
    const start = document.getElementById('start-screen');
    const buttons = [...document.querySelectorAll('.hangar-model-btn')].map(b => ({
      top: Math.round(b.getBoundingClientRect().top),
      overflows: b.scrollWidth > b.clientWidth,
    }));
    return {
      count: buttons.length,
      tops: new Set(buttons.map(k => k.top)).size,
      overflows: buttons.some(k => k.overflows),
      scroll: start.scrollHeight - start.clientHeight,
    };
  });
  expect(m.count).toBe(4);
  expect(m.tops).toBe(1);
  expect(m.overflows).toBe(false);
  expect(m.scroll).toBeLessThanOrEqual(0);
});

// ---------------------------------------------------------------------------------------------
// Fadenkreuz + Schuss (S2). Aufbau, simulationsSchritt()-Aufrufe und Auswertung laufen je Test in
// einem synchronen page.evaluate-Block, damit nichts zwischendurch dazwischenfunkt.

async function startSniper(page, { coop = false } = {}) {
  if (coop) {
    await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
    await page.locator('.hangar-player-tab[data-player="p2"]').click();
    await page.locator('.hangar-model-btn[data-model="sniper"]').click();
    await page.locator('.hangar-player-tab[data-player="p1"]').click();
  }
  await page.locator('.hangar-model-btn[data-model="sniper"]').click();
  await startPerKey(page);
  await page.evaluate(() => {
    const { Entities, arrays, state } = window.__game;
    window.__sn = {
      // Ausgangslage: leeres Feld, Schiff bei (185|400) -> Fadenkreuz-Mitte (200|180); P2 bei (385|400) -> (400|180)
      empty() {
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
        arrays.sniperMines.forEach(m => m.el && m.el.remove());
        arrays.sniperMines.length = 0;
        document.querySelectorAll('.sniper-mine, .sniper-mine-explosion').forEach(e => e.remove());
        Object.keys(state.keysPressed).forEach(k => {
          state.keysPressed[k] = false;
        });
        state.frameCounter = 1;
        state.level = 1;
        state.bossActive = false;
        state.hacks = [];
        state.godMode = true;
        state.p2IsBot = false;
        for (const s of [state, state.p2]) {
          s.maxEnergy = 50;
          s.energy = 50;
          s.laserTier = 1;
          s.shieldTier = 0;
          s.lives = 3;
          s.isDead = false;
          s.invulnerableTimer = 0;
          s.unlimitedEnergy = false;
          s.sniperTargetX = null;
          s.sniperTargetY = null;
          s.sniperCooldown = 0;
          s.sniperHeld = false;
          s.sniperCharge = 0;
          s.sniperFull = false;
          s.hacks = [];
        }
        state.joystick.fires = false;
        state.joystick.active = false;
        state.sniperChargingButton = false;
        state.x = 185;
        state.y = 400;
        state.p2.x = 385;
        state.p2.y = 400;
      },
      // Feind mit Mitte (cx|cy), ruhend, schiesst nicht, viel Leben
      enemy(cx, cy, hp = 1000) {
        Entities.createEnemy(cx - 15, cy - 15, 'normal', 0, false);
        const f = arrays.enemies[arrays.enemies.length - 1];
        Object.assign(f, { vx: 0, vy: 0, hp, maxHp: hp, shotTimer: 999999, fixedX: f.x, fixedY: f.y });
        return f;
      },
      asteroid(cx, cy, size = 30, magma = false) {
        Entities.createAsteroid(cx - size / 2, cy - size / 2, size, 0, 0, 0, true);
        const a = arrays.asteroids[arrays.asteroids.length - 1];
        a.hp = a.maxHp = 1000;
        a.vRot = 0;
        a.fixedX = a.x;
        a.fixedY = a.y;
        if (magma) {
          a.isIndestructible = true;
          a.isMagma = true;
        }
        return a;
      },
      // Feinde und Asteroiden werden nach jedem Schritt an ihren Platz zurueckgesetzt (Pendeln/Fallen stoert die Messung)
      // Taste n Schritte halten, loslassen und einen Schritt weiter (der Schuss faellt beim Loslassen)
      tap(n = 1, key = 'l') {
        state.keysPressed[key] = true;
        this.steps(n);
        state.keysPressed[key] = false;
        this.steps(1);
      },
      steps(n) {
        for (let i = 0; i < n; i++) {
          window.__game.Loop.simulationStep();
          [...arrays.enemies, ...arrays.asteroids].forEach(o => {
            if (o.fixedX === undefined) return;
            o.x = o.fixedX;
            o.y = o.fixedY;
            o.el.style.left = o.x + 'px';
            o.el.style.top = o.y + 'px';
          });
        }
      },
    };
  });
}

test.describe('Spectre-SR Fadenkreuz', () => {
  test('Fadenkreuz steht 220 px ueber dem Schiff, folgt ihm und ist am oberen Rand begrenzt', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.empty();
      T.steps(1);
      const a = {
        x: state.sniperTargetX,
        y: state.sniperTargetY,
        el: document.querySelectorAll('.sniper-fadenkreuz').length,
      };
      state.x = 85;
      state.y = 350;
      T.steps(1);
      const b = { x: state.sniperTargetX, y: state.sniperTargetY };
      state.y = 100;
      T.steps(1);
      const c = { y: state.sniperTargetY };
      state.y = 400;
      state.x = 185;
      T.steps(1);
      const k = document.querySelector('.sniper-fadenkreuz');
      const rad = parseFloat(k.style.width) / 2;
      return {
        a,
        b,
        c,
        middleX: parseFloat(k.style.left) + rad,
        middleY: parseFloat(k.style.top) + rad,
        rad,
        color: k.style.borderColor,
        strokes: k.querySelectorAll('.sniper-strich').length,
      };
    });
    expect(r.a).toEqual({ x: 200, y: 180, el: 1 });
    expect(r.b).toEqual({ x: 100, y: 130 });
    expect(r.c.y).toBe(0);
    expect(r.middleX).toBe(200);
    expect(r.middleY).toBe(180);
    expect(r.rad).toBe(6); // Stufe 1
    expect(r.color).not.toBe('');
    expect(r.strokes).toBe(4);
  });

  test('Radius waechst mit der Laser-Stufe (6/14/22/22/30)', async ({ page }) => {
    await startSniper(page);
    const radii = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.empty();
      const out = [];
      for (let tier = 1; tier <= 5; tier++) {
        state.laserTier = tier;
        T.steps(1);
        out.push(parseFloat(document.querySelector('.sniper-fadenkreuz').style.width) / 2);
      }
      return out;
    });
    expect(radii).toEqual([6, 14, 22, 22, 30]);
  });

  test('Fadenkreuz verschwindet bei Tod, Game Over und Neustart; Nicht-Sniper hat keins', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      const T = window.__sn;
      T.empty();
      T.steps(2);
      const there = document.querySelectorAll('.sniper-fadenkreuz').length;
      state.isDead = true;
      T.steps(1);
      const dead = document.querySelectorAll('.sniper-fadenkreuz').length;
      state.isDead = false;
      T.steps(1);
      const again = document.querySelectorAll('.sniper-fadenkreuz').length;
      T.tap();
      const beam = document.querySelectorAll('.sniper-strahl').length;
      Utils.triggerGameOver();
      const gameOver = document.querySelectorAll('.sniper-fadenkreuz, .sniper-strahl').length;
      Utils.restartGame();
      const restart = document.querySelectorAll('.sniper-fadenkreuz, .sniper-strahl').length;
      return { there, dead, again, beam, gameOver, restart, targetX: state.sniperTargetX };
    });
    expect(r).toEqual({ there: 1, dead: 0, again: 1, beam: 1, gameOver: 0, restart: 0, targetX: null });
  });
});

test.describe('Spectre-SR Schuss', () => {
  test('trifft den Feind im Kreis, NICHT den zwischen Schiff und Fadenkreuz, NICHT einen knapp ausserhalb des Radius', async ({
    page,
  }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const T = window.__sn;
      T.empty();
      // Jeder Fall einzeln (Stufe 1 trifft sonst nur das naechste Ziel und verdeckt die anderen)
      const hits = (cx, cy) => {
        T.empty();
        const f = T.enemy(cx, cy);
        T.tap();
        return f.hp;
      };
      const between = hits(200, 300); // direkt auf der Schusslinie, aber nicht im Kreis
      const outside = hits(200 + 15 + 6 + 2, 180); // Box beginnt 8 px neben der Mitte (Radius 6)
      const inside = hits(200 - 15 - 6 + 2, 180); // Box endet 4 px neben der Mitte
      return { between, outside, inside, laser: window.__game.arrays.laserArray.length };
    });
    expect(r.between).toBe(1000);
    expect(r.outside).toBe(1000);
    expect(r.inside).toBe(970);
    expect(r.laser).toBe(0);
  });

  test('Schuss erzeugt einen Strahl zum Fadenkreuz, der in wenigen Schritten verblasst', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const T = window.__sn;
      T.empty();
      T.tap();
      const beam = document.querySelector('.sniper-strahl');
      const height = parseFloat(beam.style.height);
      let steps = 0;
      while (document.querySelector('.sniper-strahl') && steps < 30) {
        T.steps(1);
        steps++;
      }
      return { height, steps };
    });
    expect(r.height).toBeCloseTo(220, 5);
    expect(r.steps).toBeGreaterThan(2);
    expect(r.steps).toBeLessThanOrEqual(12);
  });

  test('Stufe 1-2 treffen nur das Ziel mit der Mitte am naechsten am Fadenkreuz, Stufe 3 beide', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const out = {};
      for (const tier of [1, 2, 3]) {
        T.empty();
        state.laserTier = tier;
        const nearer = T.enemy(200 - 14, 180);
        const farther = T.enemy(200 + 20, 180);
        T.tap();
        out[tier] = { nearer: nearer.hp, farther: farther.hp };
      }
      return out;
    });
    expect(r[1]).toEqual({ nearer: 970, farther: 1000 });
    expect(r[2]).toEqual({ nearer: 965, farther: 1000 });
    expect(r[3]).toEqual({ nearer: 960, farther: 960 });
  });

  test('Schaden je Stufe 30/35/40/45/50', async ({ page }) => {
    await startSniper(page);
    const damage = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const out = [];
      for (let tier = 1; tier <= 5; tier++) {
        T.empty();
        state.laserTier = tier;
        const f = T.enemy(200, 180);
        T.tap();
        out.push(1000 - f.hp);
      }
      return out;
    });
    expect(damage).toEqual([30, 35, 40, 45, 50]);
  });

  test('Schussabstand je Stufe 24/21/21/18/18 Schritte (Sperre zwischen den Schuessen)', async ({ page }) => {
    await startSniper(page);
    const distances = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const out = [];
      for (let tier = 1; tier <= 5; tier++) {
        T.empty();
        state.laserTier = tier;
        state.unlimitedEnergy = true;
        const f = T.enemy(200, 180);
        const times = [];
        let hp = f.hp;
        for (let i = 1; i <= 90; i++) {
          // Halten (laden), im ersten Schritt ohne Sperre loslassen, im naechsten gleich wieder druecken
          state.keysPressed.l = !(state.sniperHeld && state.sniperCooldown <= 1);
          T.steps(1);
          if (f.hp < hp) {
            times.push(i);
            hp = f.hp;
          }
        }
        out.push(times.slice(1).map((z, i) => z - times[i]));
      }
      return out;
    });
    const expected = [24, 21, 21, 18, 18];
    distances.forEach((list, i) => {
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(new Set(list)).toEqual(new Set([expected[i]]));
    });
  });

  test('Energie: 6 pro Schuss, ohne genug Energie kein Schuss', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.empty();
      const f = T.enemy(200, 180);
      T.tap();
      const afterShot = state.energy; // 50 - 6 + Regeneration 0,45 (nur im Loslass-Schritt, waehrend des Haltens keine)
      // zu wenig Energie
      T.empty();
      const g = T.enemy(200, 180);
      state.energy = 5.3;
      T.tap();
      const tooFew = { hp: g.hp, energy: state.energy };
      let tapper = 1;
      while (g.hp === 1000 && tapper < 10) {
        T.tap();
        tapper++;
      }
      return { afterShot, hp: f.hp, tooFew, tapper };
    });
    expect(r.hp).toBe(970);
    expect(r.afterShot).toBeCloseTo(44.45, 5);
    expect(r.tooFew.hp).toBe(1000);
    expect(r.tooFew.energy).toBeCloseTo(5.75, 5); // nur normale Regeneration (im Loslass-Schritt)
    expect(r.tapper).toBe(3); // 5,3 -> 5,75 -> 6,2 -> Schuss beim 3. Tippen
  });

  test('Schild zuerst, Magma unversehrt (und zieht den Schuss nicht an), Kill gibt Punkte', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__sn;
      T.empty();
      const f = T.enemy(200, 180);
      f.shieldHp = f.maxShieldHp = 100;
      T.tap();
      const shield = { shield: f.shieldHp, hp: f.hp };

      // Magma genau im Fadenkreuz, Feind am Rand des Kreises (Stufe 3): beide Ziele zaehlen, nur der Feind wird getroffen
      T.empty();
      state.laserTier = 3;
      const magma = T.asteroid(200, 180, 30, true);
      const target = T.enemy(200 + 17, 180);
      T.tap();
      const mag = { magma: magma.hp, target: target.hp };

      // Stufe 1 mit Magma genau im Fadenkreuz und Feind am Rand: Feind wird trotzdem getroffen
      T.empty();
      const magma1 = T.asteroid(200, 180, 30, true);
      const target1 = T.enemy(200 + 15 + 5, 180);
      T.tap();
      const mag1 = { magma: magma1.hp, target: target1.hp };

      // Kill
      T.empty();
      const victim = T.enemy(200, 180, 20);
      const points = state.score;
      T.tap();
      return { shield, mag, mag1, dead: !arrays.enemies.includes(victim), points: state.score - points };
    });
    expect(r.shield).toEqual({ shield: 70, hp: 1000 });
    expect(r.mag).toEqual({ magma: 1000, target: 960 });
    expect(r.mag1).toEqual({ magma: 1000, target: 970 });
    expect(r.dead).toBe(true);
    expect(r.points).toBeGreaterThan(0);
  });

  test('Asteroiden im Kreis werden getroffen', async ({ page }) => {
    await startSniper(page);
    const hp = await page.evaluate(() => {
      const T = window.__sn;
      T.empty();
      const a = T.asteroid(200, 180);
      T.tap();
      return a.hp;
    });
    expect(hp).toBe(970);
  });

  test('keine normalen Laserprojektile und kein Hitscan, auch auf Stufe 5', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__sn;
      T.empty();
      state.laserTier = 5;
      state.keysPressed.l = true;
      let max = 0;
      for (let i = 0; i < 120; i++) {
        T.steps(1);
        max = Math.max(max, arrays.laserArray.length);
      }
      return { max, hitscan: getComputedStyle(document.getElementById('hitscan-laser')).display };
    });
    expect(r.max).toBe(0);
    expect(r.hitscan).toBe('none');
  });
});

test.describe('Spectre-SR Auto-Zielen', () => {
  test('Stufe 4 gleitet zum naechsten Feind (nicht zum naeheren Asteroiden), ohne Ziel zurueck', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.empty();
      state.laserTier = 4;
      T.steps(1);
      const start = { x: state.sniperTargetX, y: state.sniperTargetY };
      T.asteroid(200, 175); // nah am Fadenkreuz, aber ein Asteroid
      const f = T.enemy(110, 160);
      T.steps(1);
      const step1 = Math.hypot(state.sniperTargetX - start.x, state.sniperTargetY - start.y);
      T.steps(30);
      const reached = { x: state.sniperTargetX, y: state.sniperTargetY };
      // Feind weg: zurueck zur Grundposition
      f.el.remove();
      window.__game.arrays.enemies.length = 0;
      T.steps(60);
      const back = { x: state.sniperTargetX, y: state.sniperTargetY };
      return { start, step1, reached, back };
    });
    expect(r.start).toEqual({ x: 200, y: 180 });
    expect(r.step1).toBeCloseTo(6, 5);
    expect(r.reached.x).toBeCloseTo(110, 5);
    expect(r.reached.y).toBeCloseTo(160, 5);
    expect(r.back.x).toBeCloseTo(200, 5);
    expect(r.back.y).toBeCloseTo(180, 5);
  });

  test('Stufe 5 gleitet mit 10 px/Schritt; Stufe 3 nicht; Ziele ausser Reichweite oder unter dem Schiff zaehlen nicht', async ({
    page,
  }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const out = {};
      T.empty();
      state.laserTier = 5;
      T.steps(1);
      T.enemy(110, 160);
      T.steps(1);
      out.tier5 = Math.hypot(state.sniperTargetX - 200, state.sniperTargetY - 180);

      T.empty();
      state.laserTier = 3;
      T.steps(1);
      T.enemy(110, 160);
      T.steps(10);
      out.tier3 = { x: state.sniperTargetX, y: state.sniperTargetY };

      T.empty();
      state.laserTier = 4;
      T.steps(1);
      T.enemy(185, 60); // 340 px entfernt: ausser Reichweite
      T.enemy(100, 450); // unter dem Schiff
      T.steps(10);
      out.noTarget = { x: state.sniperTargetX, y: state.sniperTargetY };
      return out;
    });
    expect(r.tier5).toBeCloseTo(10, 5);
    expect(r.tier3).toEqual({ x: 200, y: 180 });
    expect(r.noTarget).toEqual({ x: 200, y: 180 });
  });

  test('Stufe 4 nimmt den seitlich versetzten Feind unter Feuer', async ({ page }) => {
    await startSniper(page);
    const hp = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.empty();
      state.laserTier = 4;
      state.unlimitedEnergy = true;
      const f = T.enemy(110, 160);
      T.steps(40);
      T.tap();
      return f.hp;
    });
    expect(hp).toBeLessThan(1000);
  });
});

test.describe('Spectre-SR Coop', () => {
  test('P2 hat eigenes Fadenkreuz, schiesst mit seiner Taste; P1 (Viper) bleibt ohne Fadenkreuz', async ({ page }) => {
    await startSniper(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__sn;
      T.empty();
      state.selectedShipModel = 'viper';
      window.__game.Utils.updatePlayerShipVisuals();
      state.p2.selectedShipModel = 'sniper';
      document.querySelectorAll('.sniper-fadenkreuz').forEach(el => el.remove()); // Rest von P1 vor dem Modellwechsel
      const f = T.enemy(400, 180);
      const g = T.enemy(200, 180);
      T.steps(1);
      const withoutKey = f.hp;
      T.tap(1, 'ä');
      const p2 = {
        x: state.p2.sniperTargetX,
        y: state.p2.sniperTargetY,
        hp: f.hp,
        energy: state.p2.energy,
        count: document.querySelectorAll('.sniper-fadenkreuz').length,
      };
      return { withoutKey, p2, gHp: g.hp, laser: arrays.laserArray.length, p1Target: state.sniperTargetX };
    });
    expect(r.withoutKey).toBe(1000);
    expect(r.p2.x).toBe(400);
    expect(r.p2.y).toBe(180);
    expect(r.p2.hp).toBe(970);
    expect(r.p2.energy).toBeCloseTo(44.45, 5);
    expect(r.p2.count).toBe(1);
    expect(r.gHp).toBe(1000);
    expect(r.laser).toBe(0);
    expect(r.p1Target).toBeNull();
  });

  test('beide Sniper: zwei Fadenkreuze, P1 mit B, P2 mit Punkt; P2-Tod entfernt nur sein Fadenkreuz', async ({
    page,
  }) => {
    await startSniper(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.empty();
      const f1 = T.enemy(200, 180);
      const f2 = T.enemy(400, 180);
      T.tap(1, 'b');
      const onlyP1 = { f1: f1.hp, f2: f2.hp, count: document.querySelectorAll('.sniper-fadenkreuz').length };
      T.tap(1, '.');
      const thenP2 = { f1: f1.hp, f2: f2.hp };
      state.p2.isDead = true;
      T.steps(1);
      return { onlyP1, thenP2, afterDeath: document.querySelectorAll('.sniper-fadenkreuz').length };
    });
    expect(r.onlyP1).toEqual({ f1: 970, f2: 1000, count: 2 });
    expect(r.thenP2).toEqual({ f1: 970, f2: 970 });
    expect(r.afterDeath).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Aufladen (S3): Druck startet Laden, Loslassen feuert. Haltedauer unter 10 Schritten = Normalschuss, sonst Ladeschuss
// (Schaden x1..x4, Radius x1..x1,5 bei 90 Schritten; voll: alle Ziele im Kreis, Schild ignoriert).

test.describe('Spectre-SR Aufladen', () => {
  test('Tippen (5 Schritte) ist ein Normalschuss; ein gehaltener Schuss faellt erst beim Loslassen', async ({
    page,
  }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.empty();
      const f = T.enemy(200, 180);
      state.keysPressed.l = true;
      T.steps(5);
      const duringHold = f.hp;
      state.keysPressed.l = false;
      T.steps(1);
      const normal = 1000 - f.hp;
      const beamWidth = parseFloat(document.querySelector('.sniper-strahl').style.width);

      // Genau 9 Schritte gehalten = noch Normalschuss, 10 Schritte = schon geladen
      T.empty();
      const g = T.enemy(200, 180);
      T.tap(9);
      const nine = 1000 - g.hp;
      T.empty();
      const h = T.enemy(200, 180);
      T.tap(10);
      const ten = 1000 - h.hp;
      return { duringHold, normal, beamWidth, nine, ten };
    });
    expect(r.duringHold).toBe(1000);
    expect(r.normal).toBe(30);
    expect(r.beamWidth).toBe(3);
    expect(r.nine).toBe(30);
    expect(r.ten).toBeGreaterThan(30);
  });

  test('Halten 45 Schritte: Schaden Faktor 2,5, Radius noch kaum groesser', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.empty();
      const f = T.enemy(200, 180);
      T.tap(45);
      const damage = 1000 - f.hp;
      // Stufe 3 (Schaden 40): ebenfalls Faktor 2,5
      T.empty();
      state.laserTier = 3;
      const g = T.enemy(200, 180);
      T.tap(45);
      const tier3 = 1000 - g.hp;
      // Radius bei 45 Schritten: 6 x 1,25 = 7,5 -> Feind mit Kante 8 px neben der Mitte wird (noch) nicht getroffen
      T.empty();
      const h = T.enemy(200 + 15 + 8, 180);
      T.tap(45);
      return {
        damage,
        tier3,
        outside: h.hp,
        width: parseFloat(document.querySelector('.sniper-strahl').style.width),
      };
    });
    expect(r.damage).toBeCloseTo(75, 5);
    expect(r.tier3).toBeCloseTo(100, 5);
    expect(r.outside).toBe(1000);
    expect(r.width).toBeGreaterThan(3);
    expect(r.width).toBeLessThan(12);
  });

  test('Halten 90 Schritte: Faktor 4, Radius 1,5x, Schild wird ignoriert, alle Ziele im Kreis auch auf Stufe 1', async ({
    page,
  }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const T = window.__sn;
      const out = {};
      T.empty();
      const f = T.enemy(200, 180);
      T.tap(90);
      out.damage = 1000 - f.hp;
      out.width = parseFloat(document.querySelector('.sniper-strahl').style.width);

      // Ziel knapp ausserhalb des normalen Radius 6 (Kante 8 px neben der Mitte), innerhalb von 9
      T.empty();
      const close = T.enemy(200 + 15 + 8, 180);
      T.tap(90);
      out.close = 1000 - close.hp;
      T.empty();
      const close2 = T.enemy(200 + 15 + 8, 180);
      T.tap(1);
      out.closeNormal = 1000 - close2.hp;
      // ausserhalb von 9: nicht getroffen
      T.empty();
      const far = T.enemy(200 + 15 + 11, 180);
      T.tap(90);
      out.far = 1000 - far.hp;

      // Schild ignorieren: Schild weg, volle Schadenswirkung auf hp
      T.empty();
      const g = T.enemy(200, 180);
      g.shieldHp = g.maxShieldHp = 100;
      T.tap(90);
      out.shieldFull = { shield: g.shieldHp, hp: 1000 - g.hp, el: g.shieldEl };
      // fast voll (89 Schritte): Schild zuerst
      T.empty();
      const g2 = T.enemy(200, 180);
      g2.shieldHp = g2.maxShieldHp = 300;
      T.tap(89);
      out.shieldFast = { shield: g2.shieldHp, hp: g2.hp };

      // Stufe 1: alle Ziele im Kreis; 89 Schritte nur das naechste
      T.empty();
      const a = T.enemy(200 - 6, 180);
      const b = T.enemy(200 + 6, 180);
      const c = T.enemy(200, 180 + 30);
      T.tap(90);
      out.all = [a, b, c].map(z => 1000 - z.hp);
      T.empty();
      const a2 = T.enemy(200 - 3, 180);
      const b2 = T.enemy(200 + 8, 180);
      T.tap(89);
      out.fast = [a2, b2].map(z => 1000 - z.hp);
      return out;
    });
    expect(r.damage).toBeCloseTo(120, 5);
    expect(r.width).toBeGreaterThan(10);
    expect(r.close).toBeCloseTo(120, 5);
    expect(r.closeNormal).toBe(0);
    expect(r.far).toBe(0);
    expect(r.shieldFull.shield).toBe(0);
    expect(r.shieldFull.el).toBeNull();
    expect(r.shieldFull.hp).toBeCloseTo(120, 5);
    expect(r.shieldFast.hp).toBe(1000);
    expect(r.shieldFast.shield).toBeGreaterThan(0);
    expect(r.all[0]).toBeCloseTo(120, 5);
    expect(r.all[1]).toBeCloseTo(120, 5);
    expect(r.all[2]).toBe(0); // Mitte 30 px darunter: Box beginnt 15 px unter dem Fadenkreuz, ausserhalb von 9
    expect(r.fast[0]).toBeGreaterThan(30);
    expect(r.fast[1]).toBe(0);
  });

  test('Energie: Tippen kostet 6, voll geladen 25; waehrend des Ladens keine Regeneration', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state, shipModels } = window.__game;
      const T = window.__sn;
      T.empty();
      const regen = shipModels.sniper.energyRegen;
      shipModels.sniper.energyRegen = 1e-9; // 0 wuerde auf den Standard 0,4 zurueckfallen
      const out = {};
      T.enemy(200, 180);
      T.tap();
      out.tapping = 50 - state.energy;
      T.empty();
      T.enemy(200, 180);
      T.tap(9);
      out.nine = 50 - state.energy;
      T.empty();
      T.enemy(200, 180);
      state.keysPressed.l = true;
      T.steps(10);
      out.afterTen = 50 - state.energy;
      T.steps(40);
      out.afterFifty = 50 - state.energy; // 40 Ladeschritte x 19/80
      T.steps(40);
      out.afterFull = 50 - state.energy;
      T.steps(30);
      out.furtherHeld = 50 - state.energy;
      state.keysPressed.l = false;
      T.steps(1);
      out.full = 50 - state.energy;

      // Regeneration: waehrend des Haltens keine, im Loslass-Schritt wieder
      shipModels.sniper.energyRegen = 0.45;
      T.empty();
      state.energy = 30;
      state.keysPressed.l = true;
      T.steps(30);
      out.regenHold = state.energy;
      state.keysPressed.l = false;
      T.steps(1);
      out.regenRelease = state.energy;
      shipModels.sniper.energyRegen = regen;
      return out;
    });
    expect(r.tapping).toBeCloseTo(6, 5);
    expect(r.nine).toBeCloseTo(6, 5);
    expect(r.afterTen).toBeCloseTo(0, 5);
    expect(r.afterFifty).toBeCloseTo(9.5, 5);
    expect(r.afterFull).toBeCloseTo(19, 5);
    expect(r.furtherHeld).toBeCloseTo(19, 5);
    expect(r.full).toBeCloseTo(25, 5);
    expect(r.regenHold).toBeCloseTo(30 - (19 * 20) / 80, 5);
    expect(r.regenRelease).toBeGreaterThan(r.regenHold - 6 + 0.4);
  });

  test('bei wenig Energie bleibt die Ladung stehen; unter 6 Energie beim Loslassen faellt kein Schuss', async ({
    page,
  }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state, shipModels } = window.__game;
      const T = window.__sn;
      shipModels.sniper.energyRegen = 1e-9; // 0 wuerde auf den Standard 0,4 zurueckfallen
      const out = {};
      T.empty();
      const f = T.enemy(200, 180);
      state.energy = 12;
      state.keysPressed.l = true;
      T.steps(50);
      out.charge50 = state.sniperCharge;
      T.steps(40);
      out.charge90 = state.sniperCharge;
      out.energyHeld = state.energy;
      state.keysPressed.l = false;
      T.steps(1);
      out.damage = 1000 - f.hp;
      out.energyAfterShot = state.energy;
      out.factor = out.damage / 30;

      // Knapp unter 6 Energie: Ladung ueber 10 Schritte geht nicht, Loslassen = kein Schuss
      T.empty();
      const g = T.enemy(200, 180);
      state.energy = 5;
      T.tap(30);
      out.tooFew = { hp: g.hp, energy: state.energy, charge: state.sniperCharge };
      shipModels.sniper.energyRegen = 0.45;
      return out;
    });
    expect(r.charge50).toBeGreaterThanOrEqual(10);
    expect(r.charge50).toBeLessThan(90);
    expect(r.charge90).toBe(r.charge50);
    expect(r.energyHeld).toBeGreaterThanOrEqual(6);
    expect(r.damage).toBeGreaterThan(30);
    expect(r.damage).toBeLessThan(120);
    expect(r.factor).toBeCloseTo(1 + (3 * r.charge50) / 90, 5);
    expect(r.energyAfterShot).toBeCloseTo(r.energyHeld - 6, 5);
    expect(r.tooFew.hp).toBe(1000);
    expect(r.tooFew.energy).toBeCloseTo(5, 5);
    expect(r.tooFew.charge).toBe(0);
  });

  test('Tippen in der Schussabstand-Sperre wird vorgemerkt und feuert, sobald die Sperre abläuft', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state, shipModels } = window.__game;
      const T = window.__sn;
      shipModels.sniper.energyRegen = 1e-9; // 0 wuerde auf den Standard 0,4 zurueckfallen
      T.empty();
      const f = T.enemy(200, 180);
      T.tap();
      const afterFirst = { hp: f.hp, energy: state.energy };
      T.tap();
      // Zweiter Tipp in der Sperre: noch kein Schuss, keine Energie verbraucht
      const second = { hp: f.hp, energy: state.energy, lock: state.sniperCooldown };
      T.steps(second.lock);
      const afterLock = { hp: f.hp, energy: state.energy };
      shipModels.sniper.energyRegen = 0.45;
      return { afterFirst, second, afterLock };
    });
    expect(r.afterFirst.hp).toBe(970);
    expect(r.second.lock).toBeGreaterThan(0);
    expect(r.second.hp).toBe(970);
    expect(r.second.energy).toBeCloseTo(r.afterFirst.energy, 5);
    // Mit Ablauf der Sperre faellt der vorgemerkte Schuss und kostet dann Energie
    expect(r.afterLock.hp).toBe(940);
    expect(r.afterLock.energy).toBeCloseTo(r.afterFirst.energy - 6, 5);
  });

  test('Ladering waechst mit der Ladung und wird bei voller Ladung hervorgehoben; Ton genau einmal', async ({
    page,
  }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const T = window.__sn;
      T.empty();
      Audio.clearAudioHistory();
      const ring = () => document.querySelector('.sniper-ladering');
      const payload = () => {
        const el = ring();
        return el
          ? { an: el.style.display !== 'none', width: parseFloat(el.style.width), full: el.classList.contains('voll') }
          : null;
      };
      const out = {};
      state.keysPressed.l = true;
      T.steps(5);
      out.five = payload();
      T.steps(25);
      out.thirty = payload();
      T.steps(40);
      out.seventy = payload();
      out.toneBeforeFull = Audio.audioHistory.filter(e => e.name === 'sniperFull').length;
      T.steps(20);
      out.ninety = payload();
      T.steps(60);
      out.toneFull = Audio.audioHistory.filter(e => e.name === 'sniperFull').length;
      state.keysPressed.l = false;
      T.steps(1);
      out.afterShot = payload();
      const shot = Audio.audioHistory.filter(e => e.name === 'sniperSchuss');
      out.shotCharge = shot.length ? shot[shot.length - 1].details.charge : null;
      // zweiter Ladevorgang: wieder ein Ton
      T.steps(30);
      state.unlimitedEnergy = true;
      T.tap(100);
      out.toneSecondary = Audio.audioHistory.filter(e => e.name === 'sniperFull').length;
      // Normalschuss ohne Ton
      Audio.clearAudioHistory();
      T.steps(30);
      T.tap(5);
      out.toneTapping = Audio.audioHistory.filter(e => e.name === 'sniperFull').length;
      out.tappingCharge = Audio.audioHistory.filter(e => e.name === 'sniperSchuss').map(e => e.details.charge);
      return out;
    });
    expect(r.five.an).toBe(false);
    expect(r.thirty.an).toBe(true);
    expect(r.seventy.width).toBeGreaterThan(r.thirty.width);
    expect(r.seventy.full).toBe(false);
    expect(r.toneBeforeFull).toBe(0);
    expect(r.ninety.full).toBe(true);
    expect(r.ninety.width).toBeCloseTo(18, 5); // Radius 6 x 1,5 x 2
    expect(r.toneFull).toBe(1);
    expect(r.afterShot.an).toBe(false);
    expect(r.shotCharge).toBe(1);
    expect(r.toneSecondary).toBe(2);
    expect(r.toneTapping).toBe(0);
    expect(r.tappingCharge).toEqual([0]);
  });

  test('Tod und Neustart setzen die Ladung zurueck', async ({ page }) => {
    await startSniper(page);
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      const T = window.__sn;
      T.empty();
      state.keysPressed.l = true;
      T.steps(40);
      const loaded = state.sniperCharge;
      state.isDead = true;
      T.steps(1);
      const afterDeath = { charge: state.sniperCharge, held: state.sniperHeld };
      state.isDead = false;
      T.steps(1);
      const fresh = state.sniperCharge; // Taste noch gehalten: Ladevorgang beginnt von vorn
      Utils.restartGame();
      return {
        loaded,
        afterDeath,
        fresh,
        afterRestart: { charge: state.sniperCharge, full: state.sniperFull, p2: state.p2.sniperCharge },
      };
    });
    expect(r.loaded).toBe(40);
    expect(r.afterDeath).toEqual({ charge: 0, held: false });
    expect(r.fresh).toBe(1);
    expect(r.afterRestart).toEqual({ charge: 0, full: false, p2: 0 });
  });

  test('Coop: P2 laedt unabhaengig mit eigener Taste', async ({ page }) => {
    await startSniper(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.empty();
      const f = T.enemy(400, 180);
      T.tap(45, 'ä');
      return { hp: 1000 - f.hp, p1Charge: state.sniperCharge };
    });
    expect(r.hp).toBeCloseTo(75, 5);
    expect(r.p1Charge).toBe(0);
  });
});

test.describe('Spectre-SR Aufladen mobil', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  async function startMobile(page, model) {
    await page.locator('.hangar-model-btn[data-model="' + model + '"]').click();
    await page.tap('#start-text');
    await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  }

  test('Joystick-Feuer laedt nicht: Dauerfeuer aus Normalschuessen im Schussabstand', async ({ page }) => {
    await startMobile(page, 'sniper');
    await expect(page.locator('#mobile-controls')).toBeVisible();
    const r = await page.evaluate(() => {
      const { state, arrays, Loop, Audio } = window.__game;
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
      state.godMode = true;
      state.maxEnergy = 50;
      state.energy = 50;
      state.laserTier = 1;
      state.sniperCooldown = 0;
      state.x = 185;
      state.y = 400;
      window.__game.Entities.createEnemy(185, 165, 'normal', 0, false);
      const f = arrays.enemies[arrays.enemies.length - 1];
      Object.assign(f, { vx: 0, vy: 0, hp: 1000, maxHp: 1000, shotTimer: 999999 });
      const fixedX = f.x,
        fixedY = f.y;
      Audio.clearAudioHistory();
      const zone = document.getElementById('joystick-zone');
      const t = new Touch({ identifier: 1, target: zone, clientX: 100, clientY: 800 });
      zone.dispatchEvent(
        new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }),
      );
      const times = [];
      let hp = f.hp;
      let maxCharge = 0;
      for (let i = 1; i <= 100; i++) {
        Loop.simulationStep();
        f.x = fixedX;
        f.y = fixedY;
        maxCharge = Math.max(maxCharge, state.sniperCharge);
        if (f.hp < hp) {
          times.push({ i, damage: hp - f.hp });
          hp = f.hp;
        }
      }
      zone.dispatchEvent(
        new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }),
      );
      return {
        times,
        maxCharge,
        full: Audio.audioHistory.filter(e => e.name === 'sniperFull').length,
        fires: state.joystick.fires,
      };
    });
    expect(r.times.length).toBeGreaterThanOrEqual(4);
    expect(r.times.every(z => z.damage === 30)).toBe(true);
    const distances = r.times.slice(1).map((z, i) => z.i - r.times[i].i);
    expect(new Set(distances)).toEqual(new Set([24]));
    expect(r.maxCharge).toBe(0);
    expect(r.full).toBe(0);
    expect(r.fires).toBe(false);
  });

  test('#btn-laden ist nur beim Sniper sichtbar; Halten laedt, Loslassen feuert', async ({ page }) => {
    await expect(page.locator('#btn-laden')).toBeHidden();
    await startMobile(page, 'sniper');
    await expect(page.locator('#btn-laden')).toBeVisible();
    const sitsBesideMissile = await page.evaluate(() => {
      const a = document.getElementById('btn-laden').getBoundingClientRect();
      const b = document.getElementById('btn-rakete').getBoundingClientRect();
      const c = document.getElementById('btn-bombe').getBoundingClientRect();
      const width = window.innerWidth;
      return a.right <= b.left && a.left >= 0 && b.right <= width && c.left >= 0 && Math.abs(a.top - b.top) < 1;
    });
    expect(sitsBesideMissile).toBe(true);

    const r = await page.evaluate(() => {
      const { state, arrays, Loop, Audio } = window.__game;
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
      state.godMode = true;
      state.maxEnergy = 50;
      state.energy = 50;
      state.laserTier = 1;
      state.sniperCooldown = 0;
      state.x = 185;
      state.y = 400;
      window.__game.Entities.createEnemy(185, 165, 'normal', 0, false);
      const f = arrays.enemies[arrays.enemies.length - 1];
      Object.assign(f, { vx: 0, vy: 0, hp: 1000, maxHp: 1000, shotTimer: 999999 });
      const fixedX = f.x,
        fixedY = f.y;
      Audio.clearAudioHistory();
      const btn = document.getElementById('btn-laden');
      const touch = typ => {
        const t = new Touch({
          identifier: 3,
          target: btn,
          clientX: btn.getBoundingClientRect().left + 20,
          clientY: btn.getBoundingClientRect().top + 20,
        });
        btn.dispatchEvent(
          new TouchEvent(typ, {
            touches: typ === 'touchstart' ? [t] : [],
            changedTouches: [t],
            bubbles: true,
            cancelable: true,
          }),
        );
      };
      const steps = n => {
        for (let i = 0; i < n; i++) {
          Loop.simulationStep();
          f.x = fixedX;
          f.y = fixedY;
        }
      };
      touch('touchstart');
      const pressed = state.sniperChargingButton;
      steps(90);
      const duringHold = { hp: f.hp, charge: state.sniperCharge };
      touch('touchend');
      const released = state.sniperChargingButton;
      steps(1);
      const damage = 1000 - f.hp;

      // touchcancel feuert ebenfalls
      state.sniperCooldown = 0;
      touch('touchstart');
      steps(30);
      const hpBeforehand = f.hp;
      touch('touchcancel');
      steps(1);
      const cancel = hpBeforehand - f.hp;
      return {
        pressed,
        duringHold,
        released,
        damage,
        cancel,
        full: Audio.audioHistory.filter(e => e.name === 'sniperFull').length,
      };
    });
    expect(r.pressed).toBe(true);
    expect(r.duringHold).toEqual({ hp: 1000, charge: 90 });
    expect(r.released).toBe(false);
    expect(r.damage).toBeCloseTo(120, 5);
    expect(r.cancel).toBeGreaterThan(30);
    expect(r.full).toBe(1);

    // Viper: Knopf wieder weg
    await page.evaluate(() => {
      window.__game.state.selectedShipModel = 'viper';
      window.__game.Utils.updatePlayerShipVisuals();
    });
    await expect(page.locator('#btn-laden')).toBeHidden();
  });
});

// ---------------------------------------------------------------------------------------------
// Granate + Betaeubung (S4). Raketen-Taste (V bei P1, Oe bei P2 im Coop) wirft eine Granate zum Fadenkreuz.
// Testfeinde sind 'swoop' mit vx = vy = 0 (stehen still, kein Pendeln); die Schritte laufen frei (ohne Zuruecksetzen).

async function prepareGrenade(page, options = {}) {
  await startSniper(page, options);
  await page.evaluate(() => {
    const { state, Loop } = window.__game;
    const T = window.__sn;
    window.__gr = {
      free(n) {
        for (let i = 0; i < n; i++) Loop.simulationStep();
      },
      // Stehender Feind mit Mitte (cx|cy), ohne Pendeln und ohne Schuesse
      enemy(cx, cy) {
        const f = T.enemy(cx, cy);
        delete f.fixedX;
        delete f.fixedY;
        f.pattern = 'swoop';
        f.vx = 0;
        f.vy = 0;
        return f;
      },
      middle(z) {
        const g = z.size;
        return { x: z.x + g / 2, y: z.y + g / 2 };
      },
      distance(z, cx, cy) {
        const m = this.middle(z);
        return Math.hypot(m.x - cx, m.y - cy);
      },
      // Raketen-Taste antippen: einen Schritt gedrueckt, Loslassen im Folgeschritt loest Granate + EMP aus
      thrown(key = 'v') {
        state.keysPressed[key] = true;
        Loop.simulationStep();
        state.keysPressed[key] = false;
        Loop.simulationStep();
      },
      // Raketen-Taste n Schritte halten (ohne Loslassen)
      hold(n, key = 'v') {
        state.keysPressed[key] = true;
        for (let i = 0; i < n; i++) Loop.simulationStep();
      },
      release(key = 'v') {
        state.keysPressed[key] = false;
        Loop.simulationStep();
      },
    };
    T.empty();
    for (const s of [state, state.p2]) {
      s.missileTier = 1;
      s.missileCooldown = 0;
      s.sniperGrenadeCharges = 2;
    }
  });
}

test.describe('Spectre-SR Granate', () => {
  test('fliegt zum Fadenkreuz beim Wurf (nicht dorthin, wohin es sich danach bewegt) und explodiert nach ca. 30 Schritten mit Druckwelle und Ton', async ({
    page,
  }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const T = window.__sn;
      const G = window.__gr;
      const target = G.enemy(240, 180); // im Radius um (200|180)
      const adjacent = G.enemy(100, 130); // liegt am Fadenkreuz NACH dem Verschieben des Schiffs (100|130), aber ausserhalb des Radius um (200|180)
      T.steps(1);
      G.thrown();
      const afterThrow = {
        grenades: document.querySelectorAll('.sniper-granate').length,
        cd: state.missileCooldown,
        missiles: window.__game.arrays.missileArray.length,
      };
      state.x = 85; // Fadenkreuz wandert nach (100|130)
      let steps = 1;
      const middle = [];
      while (document.querySelector('.sniper-granate') && steps < 60) {
        G.free(1);
        steps++;
        if (steps === 15) {
          const e = document.querySelector('.sniper-granate');
          middle.push(parseFloat(e.style.left) + 7, parseFloat(e.style.top) + 7, e.style.transform);
        }
      }
      const wave1 = document.querySelector('.sniper-druckwelle');
      const width1 = wave1 ? parseFloat(wave1.style.width) : -1;
      G.free(6);
      const width2 = wave1 ? parseFloat(wave1.style.width) : -1;
      G.free(12);
      return {
        afterThrow,
        steps,
        middle,
        width1,
        width2,
        waveGone: document.querySelectorAll('.sniper-druckwelle').length,
        target: target.stunned,
        adjacent: adjacent.stunned,
        targetX: G.middle(target).x,
        adjacentX: G.middle(adjacent).x,
        tone: Audio.audioHistory.filter(e => e.name === 'grenade').length,
      };
    });
    expect(r.afterThrow).toEqual({ grenades: 1, cd: 240, missiles: 0 });
    expect(r.steps).toBeGreaterThanOrEqual(30);
    expect(r.steps).toBeLessThanOrEqual(32);
    // Mitte des Flugs: Bogen (Linie waere y = 290), x wie beim Wurf (Fadenkreuz stand bei x = 200)
    expect(r.middle[0]).toBeGreaterThan(190);
    expect(r.middle[0]).toBeLessThan(215);
    expect(r.middle[1]).toBeLessThan(260);
    expect(r.middle[1]).toBeGreaterThan(180);
    expect(r.middle[2]).toContain('rotate');
    expect(r.width1).toBeGreaterThan(0);
    expect(r.width2).toBeGreaterThan(r.width1);
    expect(r.waveGone).toBe(0);
    expect(r.tone).toBe(1);
    expect(r.target).toBeGreaterThanOrEqual(0); // wurde betaeubt (Zaehler laeuft ab)
    expect(r.targetX).toBeGreaterThan(280); // weggestossen
    expect(r.adjacent === undefined).toBe(true); // unberuehrt
    expect(r.adjacentX).toBe(100);
  });

  test('Stufe 1: kein Schaden, Wegstossen um ca. 60 px (gleitend), Betaeubung 60 Schritte (steht still, schiesst nicht), danach wieder aktiv; ausserhalb unberuehrt', async ({
    page,
  }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(() => {
      const { arrays } = window.__game;
      const G = window.__gr;
      const f = G.enemy(240, 180); // 40 px rechts vom Einschlag (200|180)
      const outside = G.enemy(200 + 70 + 15 + 10, 180); // Box beginnt 80 px neben dem Zentrum (Radius 70)
      G.thrown();
      let n = 1;
      while (!f.stunned && n < 60) {
        G.free(1);
        n++;
      }
      const start = { x: G.middle(f).x, hp: f.hp, cls: f.el.classList.contains('betaeubt'), stunned: f.stunned };
      f.vx = 2; // wuerde sich bewegen, wenn nicht betaeubt
      f.shotTimer = 1; // wuerde sofort schiessen
      const xs = [];
      const laserDuring = [];
      let stepsStunned = 0;
      while (f.stunned > 0 && stepsStunned < 200) {
        G.free(1);
        stepsStunned++;
        xs.push(G.middle(f).x);
        laserDuring.push(arrays.enemyLaserArray.length);
      }
      const span = G.distance(f, 200, 180) - 40;
      const classThereafter = f.el.classList.contains('betaeubt');
      const xEnd = G.middle(f).x;
      G.free(5);
      return {
        start,
        span,
        stepsStunned,
        classThereafter,
        movedDuring: Math.max(...xs.slice(10)) - Math.min(...xs.slice(10)), // nach dem Wegstossen (10 Schritte) keine Bewegung
        gliding: xs[0] > start.x,
        laserDuring: Math.max(...laserDuring),
        xAfterwards: G.middle(f).x - xEnd,
        laserAfterwards: arrays.enemyLaserArray.length,
        outsideStunned: outside.stunned,
        outsideX: G.middle(outside).x,
        outsideHp: outside.hp,
      };
    });
    expect(r.start.hp).toBe(1000);
    expect(r.start.cls).toBe(true);
    expect(r.stepsStunned).toBeGreaterThanOrEqual(55);
    expect(r.stepsStunned).toBeLessThanOrEqual(61);
    expect(r.span).toBeGreaterThan(55);
    expect(r.span).toBeLessThan(65);
    expect(r.gliding).toBe(true);
    expect(r.movedDuring).toBe(0);
    expect(r.laserDuring).toBe(0);
    expect(r.classThereafter).toBe(false);
    expect(r.xAfterwards).toBeGreaterThan(0); // wieder aktiv: bewegt sich
    expect(r.laserAfterwards).toBeGreaterThan(0); // und schiesst
    expect(r.outsideStunned).toBeUndefined();
    expect(r.outsideX).toBe(295);
    expect(r.outsideHp).toBe(1000);
  });

  test('Schaden je Stufe (1: 0, 3: 25) ueber Schild zuerst; Wegstossen am Feld begrenzt', async ({ page }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const G = window.__gr;
      const run = (tier, prep) => {
        T.empty();
        state.missileTier = tier;
        state.missileCooldown = 0;
        state.sniperGrenadeCharges = 3;
        const f = G.enemy(240, 180);
        if (prep) prep(f);
        G.thrown();
        G.free(45);
        return f;
      };
      const s1 = run(1).hp;
      const s3 = run(3).hp;
      const s2 = run(2).hp;
      const shield = run(3, f => {
        f.shieldHp = 20;
        f.maxShieldHp = 20;
      });
      // Am Rand: Feind 5 px vom rechten Feldrand, wird nach rechts gestossen -> bleibt im Feld
      const width = window.__game.config.playfieldWidth;
      const edge = run(1, f => {
        state.x = width - 60;
        f.x = width - 30;
        f.y = 165;
        f.el.style.left = f.x + 'px';
        G.free(1);
      });
      const edgeX = edge.x;
      return { s1, s3, s2, shieldHp: shield.shieldHp, shieldHpLives: shield.hp, edgeX, width };
    });
    expect(r.s1).toBe(1000);
    expect(r.s2).toBe(985);
    expect(r.s3).toBe(975);
    expect(r.shieldHp).toBe(0); // Schild 20 durch 25 weg, kein Durchschlag auf die HP
    expect(r.shieldHpLives).toBe(1000);
    expect(r.edgeX).toBe(r.width - 30); // wuerde nach rechts hinaus gestossen, bleibt am Feldrand
  });

  test('Boss: kein Wegstossen, halbe Betaeubung, greift waehrend der Betaeubung nicht an (Schuss, Bombe, Rakete)', async ({
    page,
  }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const G = window.__gr;
      state.level = 1;
      Entities.createBoss();
      const b = arrays.bosses[0];
      b.phase = 'kampf';
      b.x = 150;
      b.y = 40; // Box ohne Rand (165..235|55..125) schneidet den Kreis um (200|180) (Abstand 55 < 70)
      b.hp = b.maxHp = 100000;
      b.vx = 0; // schwebt (Bewegung wird getrennt geprueft)
      b.shotTimer = 99999;
      b.bombTimer = 99999;
      b.missileTimer = 99999;
      G.thrown();
      let n = 1;
      while (!b.stunned && n < 60) {
        G.free(1);
        n++;
      }
      const stunned = b.stunned;
      const pos = { x: b.x, y: b.y };
      b.vx = 2;
      b.shotTimer = 1;
      b.bombTimer = 1;
      b.missileTimer = 1;
      const beforehand = arrays.bossLaserArray.length + arrays.bossBombArray.length + arrays.bossMissileArray.length;
      let fresh = 0;
      let steps = 0;
      while (b.stunned > 0 && steps < 100) {
        G.free(1);
        steps++;
        fresh = Math.max(
          fresh,
          arrays.bossLaserArray.length + arrays.bossBombArray.length + arrays.bossMissileArray.length - beforehand,
        );
      }
      const movedDuring = b.x - pos.x;
      G.free(3);
      return {
        stunned,
        pos,
        movedDuring,
        steps,
        fresh,
        cls: b.el.classList.contains('betaeubt'),
        thereafterAttacks:
          arrays.bossLaserArray.length + arrays.bossBombArray.length + arrays.bossMissileArray.length - beforehand,
        thereafterX: b.x - pos.x,
      };
    });
    expect(r.stunned).toBeGreaterThanOrEqual(29);
    expect(r.stunned).toBeLessThanOrEqual(30); // halbe Dauer von 60
    expect(r.pos).toEqual({ x: 150, y: 40 }); // nicht weggestossen
    expect(r.movedDuring).toBe(0);
    expect(r.fresh).toBe(0);
    expect(r.cls).toBe(false);
    expect(r.thereafterAttacks).toBeGreaterThan(0);
    expect(r.thereafterX).toBeGreaterThan(0);
  });

  test('Asteroid wird weggestossen, aber nicht betaeubt; Magma bleibt unversehrt', async ({ page }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const G = window.__gr;
      state.missileTier = 3;
      const a = T.asteroid(240, 180);
      delete a.fixedX;
      delete a.fixedY;
      const m = T.asteroid(160, 180, 30, true);
      delete m.fixedX;
      delete m.fixedY;
      const ax = a.x;
      G.thrown();
      G.free(45);
      return {
        stunned: a.stunned,
        cls: a.el.classList.contains('betaeubt'),
        span: a.x - ax,
        hp: a.hp,
        magmaHp: m.hp,
        magmaStunned: m.stunned,
      };
    });
    expect(r.stunned).toBeUndefined();
    expect(r.cls).toBe(false);
    expect(r.span).toBeGreaterThan(70); // Stufe 3: 80 px
    expect(r.hp).toBe(975);
    expect(r.magmaHp).toBe(1000);
    expect(r.magmaStunned).toBeUndefined();
  });

  test('Stufe 5 loescht feindliche Geschosse im Radius (Feind-, Boss-, Hack-Projektile); Stufe 4 nicht', async ({
    page,
  }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__sn;
      const G = window.__gr;
      const run = tier => {
        T.empty();
        state.missileTier = tier;
        state.missileCooldown = 0;
        state.sniperGrenadeCharges = 3;
        G.thrown();
        // Ruhende Geschosse: je eines im Radius um (200|180) und eines weit ausserhalb
        Entities.createEnemyLaser(200, 170);
        Entities.createBossLaser(180, 170);
        Entities.createHackProjectile(210, 170, 210, 400, null);
        Entities.createEnemyLaser(340, 170);
        Entities.createBossLaser(340, 170);
        Entities.createHackProjectile(340, 170, 340, 400, null);
        [...arrays.enemyLaserArray, ...arrays.bossLaserArray, ...arrays.hackProjectileArray].forEach(p => {
          p.vx = 0;
          p.vy = 0;
          p.steerTime = 0;
        });
        G.free(35);
        return {
          enemy: arrays.enemyLaserArray.length,
          boss: arrays.bossLaserArray.length,
          hack: arrays.hackProjectileArray.length,
        };
      };
      return { s4: run(4), s5: run(5) };
    });
    expect(r.s4).toEqual({ enemy: 2, boss: 2, hack: 2 });
    expect(r.s5).toEqual({ enemy: 1, boss: 1, hack: 1 });
  });

  test('Ladezeit je Stufe (240/210/180/180/150), keine dritte Granate ohne Ladung; waffenOffline blockiert; keine Raketen', async ({
    page,
  }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(async () => {
      const { state, arrays } = window.__game;
      const Hack = await import('./js/hack.js');
      const T = window.__sn;
      const G = window.__gr;
      const cds = [];
      for (let tier = 1; tier <= 5; tier++) {
        T.empty();
        state.missileTier = tier;
        state.missileCooldown = 0;
        state.sniperGrenadeCharges = 3;
        G.thrown();
        cds.push(state.missileCooldown);
      }
      T.empty();
      document.querySelectorAll('.sniper-granate').forEach(e => e.remove());
      G.free(1);
      state.missileTier = 1;
      state.missileCooldown = 0;
      state.sniperGrenadeCharges = 3;
      G.thrown();
      G.thrown();
      G.thrown();
      const grenades = document.querySelectorAll('.sniper-granate').length;
      const charges = state.sniperGrenadeCharges;
      const bar = parseFloat(document.getElementById('raketen-cd-balken').style.width);
      state.missileCooldown = 0;
      state.sniperGrenadeCharges = 3;
      Hack.hackPlayer(state, 'weaponOffline');
      const beforehand = document.querySelectorAll('.sniper-granate').length;
      G.thrown();
      return {
        cds,
        grenades,
        charges,
        bar,
        blocked: document.querySelectorAll('.sniper-granate').length === beforehand,
        missiles: arrays.missileArray.length,
      };
    });
    expect(r.cds).toEqual([240, 210, 180, 180, 150]);
    expect(r.grenades).toBe(2); // zwei Ladungen: zwei Granaten direkt nacheinander, die dritte nicht
    expect(r.charges).toBe(0);
    expect(r.bar).toBeLessThan(10); // HUD-Balken zeigt den Ladefortschritt
    expect(r.blocked).toBe(true);
    expect(r.missiles).toBe(0);
  });

  test('Coop: Spieler 2 (Sniper) wirft mit Oe zu seinem Fadenkreuz', async ({ page }) => {
    await prepareGrenade(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      G.free(1);
      const cx = state.p2.x + 15; // Fadenkreuz-Mitte von P2
      const f = G.enemy(cx - 40, 180); // im Radius links davon
      const x0 = G.middle(f).x;
      G.thrown('ö');
      const grenades = document.querySelectorAll('.sniper-granate').length;
      G.free(45);
      return {
        grenades,
        cdP2: state.p2.missileCooldown,
        cdP1: state.missileCooldown,
        stunned: f.stunned,
        span: G.middle(f).x - x0,
        bar: document.getElementById('raketen-cd-balken-p2').style.width,
      };
    });
    expect(r.grenades).toBe(1);
    expect(r.cdP2).toBeGreaterThan(190);
    expect(r.cdP1).toBe(0);
    expect(r.stunned).toBeGreaterThanOrEqual(0);
    expect(r.span).toBeLessThan(-30); // weg vom Fadenkreuz (Wegstossen nach links)
  });

  test('Neustart und Game Over raeumen Granaten, Druckwellen und Wegstossen ab', async ({ page }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(() => {
      const { Utils } = window.__game;
      const G = window.__gr;
      const f = G.enemy(240, 180);
      G.thrown();
      G.free(10);
      const inFlight = document.querySelectorAll('.sniper-granate').length;
      Utils.triggerGameOver();
      const gameOver = document.querySelectorAll('.sniper-granate, .sniper-druckwelle').length;
      Utils.restartGame();
      return {
        inFlight,
        gameOver,
        restart: document.querySelectorAll('.sniper-granate, .sniper-druckwelle').length,
        f: !!f,
      };
    });
    expect(r.inFlight).toBe(1);
    expect(r.gameOver).toBe(0);
    expect(r.restart).toBe(0);
  });

  test('Neustart mitten im Flug und waehrend der Druckwelle laesst nichts zurueck', async ({ page }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(() => {
      const { Utils } = window.__game;
      const G = window.__gr;
      G.thrown();
      G.free(33); // Explosion ist durch, Druckwelle laeuft
      const wave = document.querySelectorAll('.sniper-druckwelle').length;
      Utils.restartGame();
      return { wave, thereafter: document.querySelectorAll('.sniper-granate, .sniper-druckwelle').length };
    });
    expect(r.wave).toBe(1);
    expect(r.thereafter).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Online-Host (S5a): Client-Sniper als P2 laedt, feuert und wirft ueber die Eingabe-Pakete.

async function prepareOnlineHost(page) {
  await prepareGrenade(page, { coop: true });
  await page.evaluate(() => {
    const { state, Network } = window.__game;
    const T = window.__sn;
    state.gameMode = 'online';
    Object.assign(state.network, { isOnline: true, isHost: true, isClient: false, connected: false });
    T.empty();
    state.p2.selectedShipModel = 'sniper';
    state.p2.missileTier = 1;
    state.p2.missileCooldown = 0;
    state.p2.sniperGrenadeCharges = 3;
    state.p2.laserInputRequested = false;
    state.p2.missileHeld = false;
    state.p2.networkLaserRequest = false;
    state.p2.sniperAutoInput = false;
    state.p2.networkFireMissile = false;
    // Client-Eingabe wie aus einem Paket (Position des Clients: P2-Schiff bei (385|400) -> Fadenkreuz (400|180))
    window.__input = e =>
      Network.applyPlayerInput(
        Object.assign({ x: 385, y: 400, rotate: 0, laser: false, missile: false, bomb: false }, e),
      );
  });
}

test.describe('Spectre-SR online (Host)', () => {
  test('kurzer Tipp des Clients (Druck und Loslassen vor demselben Host-Schritt) wird zu genau einem Schuss', async ({
    page,
  }) => {
    await prepareOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const T = window.__sn;
      const E = window.__input;
      const target = T.enemy(400, 180, 1000);
      Audio.clearAudioHistory();
      E({ laser: true });
      E({ laser: false });
      T.steps(1);
      T.steps(5);
      const shots = () => Audio.audioHistory.filter(a => a.name === 'sniperSchuss').length;
      const tap = { hp: target.hp, shots: shots(), energy: state.p2.energy, cd: state.p2.sniperCooldown > 0 };
      // Zweiter Tipp nach der Sperre: wieder genau ein Schuss
      T.steps(30);
      E({ laser: true });
      E({ laser: false });
      T.steps(6);
      const secondary = { hp: target.hp, shots: shots() };
      // Normal gehalten ueber mehrere Pakete: kein Dauerfeuer, ein Schuss beim Loslassen
      T.steps(30);
      E({ laser: true });
      T.steps(3);
      const during = shots();
      E({ laser: false });
      T.steps(3);
      return { tap, secondary, during, afterHold: shots(), hpEnd: target.hp };
    });
    expect(r.tap.hp).toBe(970);
    expect(r.tap.shots).toBe(1);
    expect(r.tap.cd).toBe(true);
    expect(r.secondary).toEqual({ hp: 940, shots: 2 });
    expect(r.during).toBe(2);
    expect(r.afterHold).toBe(3);
    expect(r.hpEnd).toBe(910);
  });

  test('gehaltene Laser-Eingabe laedt bis voll (Ton, kein Schuss beim Halten), Loslassen feuert den Ladeschuss', async ({
    page,
  }) => {
    await prepareOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const T = window.__sn;
      const E = window.__input;
      const target = T.enemy(400, 180, 1000);
      Audio.clearAudioHistory();
      E({ laser: true });
      T.steps(100);
      const loaded = {
        charge: state.p2.sniperCharge,
        full: state.p2.sniperFull,
        tone: Audio.audioHistory.filter(a => a.name === 'sniperFull').length,
        hp: target.hp,
      };
      E({ laser: false });
      T.steps(2);
      return { loaded, hp: target.hp, chargeThereafter: state.p2.sniperCharge };
    });
    expect(r.loaded).toEqual({ charge: 90, full: true, tone: 1, hp: 1000 });
    expect(r.hp).toBe(880); // voll geladen: Schaden x4
    expect(r.chargeThereafter).toBe(0);
  });

  test('Autofeuer des Clients (Joystick) schiesst Normalschuesse im Schussabstand ohne Laden', async ({ page }) => {
    await prepareOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const T = window.__sn;
      const E = window.__input;
      const target = T.enemy(400, 180, 1000);
      Audio.clearAudioHistory();
      E({ laser: true, auto: true });
      T.steps(50);
      const maxCharge = state.p2.sniperCharge;
      const held = state.p2.sniperHeld;
      E({ laser: false });
      T.steps(2);
      return {
        shots: Audio.audioHistory.filter(a => a.name === 'sniperSchuss').length,
        hp: target.hp,
        maxCharge,
        held,
        tone: Audio.audioHistory.filter(a => a.name === 'sniperFull').length,
      };
    });
    // Stufe 1: Schussabstand 24 Schritte -> Schuesse in den Schritten 1, 25, 49
    expect(r.shots).toBe(3);
    expect(r.hp).toBe(910);
    expect(r.maxCharge).toBe(0);
    expect(r.held).toBe(false);
    expect(r.tone).toBe(0);
  });

  test('Granate ueber die Raketen-Eingabe (auch kurzer Tipp) fliegt zum Fadenkreuz des Clients und betaeubt dort', async ({
    page,
  }) => {
    await prepareOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const G = window.__gr;
      const E = window.__input;
      const target = G.enemy(430, 190); // im Radius 70 um das Fadenkreuz des Clients (400|180)
      const remote = G.enemy(100, 180); // am Fadenkreuz des Hosts (200|180) - darf nichts abbekommen
      E({ missile: true });
      E({ missile: false });
      T.steps(2); // Schritt 1 zaehlt den Druck, Schritt 2 das Loslassen (Tippen)
      const afterThrow = {
        grenades: document.querySelectorAll('.sniper-granate').length,
        cd: state.p2.missileCooldown,
        host: state.missileCooldown,
      };
      // Das Schiff des Clients zieht weiter: die Granate zielt trotzdem auf die Position beim Wurf
      E({ x: 285, y: 400 });
      G.free(31);
      return {
        afterThrow,
        target: target.stunned > 0,
        remote: remote.stunned || 0,
        wave: document.querySelectorAll('.sniper-druckwelle').length,
      };
    });
    expect(r.afterThrow).toEqual({ grenades: 1, cd: 240, host: 0 });
    expect(r.target).toBe(true);
    expect(r.remote).toBe(0);
    expect(r.wave).toBe(1);
  });

  test('Host sendet fuer die Druckwelle ein Ereignis und die Granate im Snapshot; Betaeubung steht am Feind im Snapshot', async ({
    page,
  }) => {
    await prepareOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state, Network } = window.__game;
      const G = window.__gr;
      const E = window.__input;
      const target = G.enemy(430, 190);
      E({ missile: true });
      E({ missile: false });
      G.free(2);
      const inFlight = Network.serializeGameState().sniperGrenades.map(g => ({ owner: g.owner, rest: g.rest }));
      state.network.lastSentEvent = null;
      G.free(31);
      const event = state.network.lastSentEvent;
      const enemySnap = Network.serializeGameState().enemies.find(f => f.id === target.id);
      return { inFlight, event, stunned: enemySnap.stunned > 0 };
    });
    expect(r.inFlight).toHaveLength(1);
    expect(r.inFlight[0].owner).toBe('p2');
    expect(r.event).toMatchObject({ type: 'granate_detonated', x: 400, y: 180, radius: 70, owner: 'p2' });
    expect(r.stunned).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Bot (S5b): Spieler 2 als KI fliegt die Spectre-SR

test.describe('Spectre-SR Bot', () => {
  async function prepareBot(page) {
    await prepareGrenade(page, { coop: true });
    await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      const { state } = window.__game;
      window.__bot = {
        start() {
          window.__sn.empty();
          state.p2IsBot = true;
          state.p2BotDifficulty = 'hard';
          Bot.resetBot();
          state.p2.x = 285;
          state.p2.y = 480;
          state.p2.botFireLaser = false;
          state.p2.botFireMissile = false;
          state.p2.missileCooldown = 0;
          state.p2.sniperGrenadeCharges = 3;
          state.x = 40;
          state.y = 540; // P1 aus dem Weg
        },
      };
    });
  }

  test('bringt das Fadenkreuz auf einen stehenden Feind und zerstoert ihn mit Normalschuessen', async ({ page }) => {
    await prepareBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      window.__bot.start();
      const f = window.__gr.enemy(420, 150);
      f.hp = f.maxHp = 100;
      let maxCharge = 0;
      let distance = null;
      for (let i = 0; i < 400 && arrays.enemies.includes(f) && f.hp > 0; i++) {
        window.__gr.free(1);
        maxCharge = Math.max(maxCharge, state.p2.sniperCharge || 0);
        if (i === 100) distance = Math.hypot(state.p2.sniperTargetX - 420, state.p2.sniperTargetY - 150);
      }
      return { dead: !arrays.enemies.includes(f) || f.hp <= 0, distance, maxCharge };
    });
    expect(r.dead).toBe(true);
    expect(r.distance).toBeLessThan(15);
    expect(r.maxCharge).toBeLessThan(10);
  });

  test('gegen einen Boss laedt er voll und schiesst mit Faktor 4', async ({ page }) => {
    await prepareBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      window.__bot.start();
      Entities.createBoss();
      const b = arrays.bosses[0];
      Object.assign(b, {
        phase: 'kampf',
        x: 250,
        y: 20,
        vx: 0,
        vy: 0,
        hp: 1e6,
        maxHp: 1e6,
        shotTimer: 9999,
        bombTimer: 9999,
        missileTimer: 9999,
      });
      let full = 0;
      let beforehand = 0;
      for (let i = 0; i < 600; i++) {
        window.__gr.free(1);
        if (state.p2.sniperFull && !beforehand) full++;
        beforehand = state.p2.sniperFull ? 1 : 0;
        b.x = 250;
        b.y = 20;
        b.phase = 'kampf';
      }
      return { full, bossHp: b.hp };
    });
    expect(r.full).toBeGreaterThanOrEqual(1);
    expect(r.bossHp).toBeLessThan(1e6 - 150);
  });

  test('wirft eine Granate bei einer Feindgruppe', async ({ page }) => {
    await prepareBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      window.__bot.start();
      const G = window.__gr;
      G.enemy(300, 150);
      G.enemy(340, 160);
      G.enemy(320, 190);
      let grenades = 0;
      let cd = 0;
      for (let i = 0; i < 200; i++) {
        G.free(1);
        grenades = Math.max(grenades, document.querySelectorAll('.sniper-granate').length);
        cd = Math.max(cd, state.p2.missileCooldown);
        arrays.enemies.forEach(f => {
          f.hp = f.maxHp = 1e6;
        });
        if (grenades) break;
      }
      return { grenades, cd };
    });
    expect(r.grenades).toBe(1);
    expect(r.cd).toBeGreaterThan(150);
  });

  test('tippt nicht ohne Ziel: Energie bleibt bei leerem Feld voll, kein Schuss', async ({ page }) => {
    await prepareBot(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      window.__bot.start();
      let shots = 0;
      let minE = 50;
      for (let i = 0; i < 300; i++) {
        state.frameCounter = 1; // keine natuerlichen Spawns
        const cd = state.p2.sniperCooldown;
        window.__gr.free(1);
        if (state.p2.sniperCooldown > cd) shots++;
        minE = Math.min(minE, state.p2.energy);
      }
      return { shots, minE, grenades: document.querySelectorAll('.sniper-granate').length };
    });
    expect(r.shots).toBe(0);
    expect(r.minE).toBeGreaterThan(49);
    expect(r.grenades).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// E1: Granaten-Taste als Tipp/Halte-Modell, EMP beim Tippen

async function prepareEmp(page, options = {}) {
  await prepareGrenade(page, options);
  await page.evaluate(async () => {
    const Sn = await import('./js/sniper.js');
    const { Entities, arrays, state, config } = window.__game;
    const Middle = () => ({ x: state.x + config.playerSize / 2, y: state.y + config.playerSize / 2 });
    window.__emp = {
      Sn,
      middle: Middle,
      // Geschoss im Abstand dx/dy von der Schiffsmitte (stehend, damit nichts weiterfliegt)
      projectile(kind, dx, dy) {
        const m = Middle();
        const x = m.x + dx;
        const y = m.y + dy;
        if (kind === 'enemyLaser') Entities.createEnemyLaser(x, y);
        else if (kind === 'bossLaser') Entities.createBossLaser(x, y);
        else if (kind === 'hack') Entities.createHackProjectile(x, y, x, y + 100);
        else if (kind === 'bossMissile') Entities.createBossMissile(x, y, 1);
        const list = {
          enemyLaser: arrays.enemyLaserArray,
          bossLaser: arrays.bossLaserArray,
          hack: arrays.hackProjectileArray,
          bossMissile: arrays.bossMissileArray,
        }[kind];
        const g = list[list.length - 1];
        g.x = x;
        g.y = y;
        g.vx = 0;
        g.vy = 0;
        return g;
      },
      count() {
        return (
          arrays.enemyLaserArray.length +
          arrays.bossLaserArray.length +
          arrays.hackProjectileArray.length +
          arrays.bossMissileArray.length
        );
      },
    };
  });
}

test.describe('Spectre-SR Granaten-Taste und EMP', () => {
  test('Tippen wirft die Granate und loest das EMP aus (Ring, Ton, Cooldown); der Wurf faellt erst beim Loslassen', async ({
    page,
  }) => {
    await prepareEmp(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const G = window.__gr;
      Audio.clearAudioHistory();
      G.hold(1);
      const duringPressure = {
        grenades: document.querySelectorAll('.sniper-granate').length,
        emp: document.querySelectorAll('.sniper-emp').length,
        cd: state.missileCooldown,
      };
      G.release();
      const thereafter = {
        grenades: document.querySelectorAll('.sniper-granate').length,
        emp: document.querySelectorAll('.sniper-emp').length,
        cd: state.missileCooldown,
      };
      G.free(4);
      const width = parseFloat(document.querySelector('.sniper-emp').style.width);
      G.free(10);
      return {
        duringPressure,
        thereafter,
        width,
        empGone: document.querySelectorAll('.sniper-emp').length,
        tone: Audio.audioHistory.filter(e => e.name === 'emp').length,
      };
    });
    expect(r.duringPressure).toEqual({ grenades: 0, emp: 0, cd: 0 });
    expect(r.thereafter).toEqual({ grenades: 1, emp: 1, cd: 240 });
    expect(r.width).toBeGreaterThan(0);
    expect(r.width).toBeLessThan(140);
    expect(r.empGone).toBe(0);
    expect(r.tone).toBe(1);
  });

  test('Halten ab 10 Schritten (20 Schritte) wirft nichts und loest kein EMP aus; die erste Mine verbraucht genau eine Ladung und startet das Nachladen', async ({
    page,
  }) => {
    await prepareEmp(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      G.hold(20);
      const during = {
        grenades: document.querySelectorAll('.sniper-granate').length,
        emp: document.querySelectorAll('.sniper-emp').length,
        charges: state.sniperGrenadeCharges,
        cd: state.missileCooldown,
      };
      G.release();
      G.free(3);
      return {
        during,
        thereafter: {
          grenades: document.querySelectorAll('.sniper-granate').length,
          emp: document.querySelectorAll('.sniper-emp').length,
          charges: state.sniperGrenadeCharges,
          cd: state.missileCooldown,
        },
      };
    });
    expect(r.during).toMatchObject({ grenades: 0, emp: 0, charges: 1 });
    expect(r.during.cd).toBeGreaterThan(220); // Nachladen laeuft seit der ersten Mine
    expect(r.thereafter).toMatchObject({ grenades: 0, emp: 0, charges: 1 });
    expect(r.thereafter.cd).toBeGreaterThan(210);
  });

  test('Grenze: 9 Schritte gehalten ist noch ein Tipp, 10 Schritte ist ein Halten', async ({ page }) => {
    await prepareEmp(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      G.hold(9);
      G.release();
      const nine = state.missileCooldown;
      G.free(1);
      state.missileCooldown = 0;
      state.sniperGrenadeCharges = 3;
      document.querySelectorAll('.sniper-granate, .sniper-emp').forEach(e => e.remove());
      G.hold(10);
      G.release();
      return { nine, ten: state.missileCooldown, charges: state.sniperGrenadeCharges };
    });
    expect(r.nine).toBe(240);
    expect(r.ten).toBeGreaterThan(230); // Halten legt eine Mine -> Nachladen, aber keine Granate
    expect(r.charges).toBe(1);
  });

  test('Tippen ohne Ladung wirft nichts; waffenOffline blockiert Granate und EMP', async ({ page }) => {
    await prepareEmp(page);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Hack = await import('./js/hack.js');
      const G = window.__gr;
      state.missileCooldown = 100;
      state.sniperGrenadeCharges = 0;
      G.thrown();
      const inCooldown = {
        grenades: document.querySelectorAll('.sniper-granate').length,
        emp: document.querySelectorAll('.sniper-emp').length,
      };
      state.missileCooldown = 0;
      state.sniperGrenadeCharges = 3;
      Hack.hackPlayer(state, 'weaponOffline');
      G.thrown();
      return {
        inCooldown,
        offline: {
          grenades: document.querySelectorAll('.sniper-granate').length,
          emp: document.querySelectorAll('.sniper-emp').length,
        },
      };
    });
    expect(r.inCooldown).toEqual({ grenades: 0, emp: 0 });
    expect(r.offline).toEqual({ grenades: 0, emp: 0 });
  });

  test('EMP zerstoert Feindlaser, Boss-Laser, Hack-Projektil und Boss-Rakete im Radius, nicht ausserhalb', async ({
    page,
  }) => {
    await prepareEmp(page);
    const r = await page.evaluate(() => {
      const { arrays, state } = window.__game;
      const E = window.__emp;
      for (const a of ['enemyLaser', 'bossLaser', 'hack', 'bossMissile']) {
        E.projectile(a, 40, -30);
        E.projectile(a, 150, 0);
      }
      const beforehand = E.count();
      E.Sn.triggerEmp(state, 'p1');
      const mx = E.middle().x;
      return {
        beforehand,
        afterwards: E.count(),
        enemyLaser: arrays.enemyLaserArray.map(g => Math.round(g.x - mx)),
        bossMissile: arrays.bossMissileArray.map(g => Math.round(g.x - mx)),
        els: document.querySelectorAll('.feind-laser').length,
      };
    });
    expect(r.beforehand).toBe(8);
    expect(r.afterwards).toBe(4); // nur die entfernten (150 px) bleiben
    expect(r.enemyLaser).toEqual([150]);
    expect(r.bossMissile).toEqual([150]);
    expect(r.els).toBe(1);
  });

  test('EMP entfernt Boss-Bomben im Radius ohne Detonation', async ({ page }) => {
    await prepareEmp(page);
    const r = await page.evaluate(() => {
      const { Entities, arrays, state } = window.__game;
      const E = window.__emp;
      const m = E.middle();
      Entities.createBossBomb(m.x + 20, m.y - 40);
      Entities.createBossBomb(m.x + 160, m.y);
      const b = arrays.bossBombArray;
      b[0].x = m.x + 20;
      b[0].y = m.y - 40;
      b[1].x = m.x + 160;
      b[1].y = m.y;
      E.Sn.triggerEmp(state, 'p1');
      return { rest: b.length, x: Math.round(b[0].x - m.x) };
    });
    expect(r.rest).toBe(1);
    expect(r.x).toBe(160);
  });

  test('EMP betaeubt Feinde im Radius 30 Schritte (Maximum, keine Verkuerzung), Boss und Asteroid nicht, kein Schaden', async ({
    page,
  }) => {
    await prepareEmp(page);
    const r = await page.evaluate(async () => {
      const Display = await import('./js/display.js');
      const { state, arrays, Entities } = window.__game;
      const E = window.__emp;
      const T = window.__sn;
      const G = window.__gr;
      const m = E.middle();
      const near = G.enemy(m.x + 30, m.y - 30);
      const lang = G.enemy(m.x - 30, m.y - 30);
      lang.stunned = 100;
      const remote = G.enemy(m.x + 200, m.y - 30);
      const ast = T.asteroid(m.x, m.y - 40, 30);
      Entities.createBoss();
      const boss = arrays.bosses[0];
      Object.assign(boss, { x: m.x - 40, y: m.y - 80, hp: 1e6, maxHp: 1e6 });
      const hp = [near.hp, lang.hp, ast.hp, boss.hp];
      E.Sn.triggerEmp(state, 'p1');
      Display.drawWorld(); // die Klasse 'betaeubt' setzt die Anzeige aus dem Feld betaeubt
      return {
        near: near.stunned,
        lang: lang.stunned,
        remote: remote.stunned || 0,
        ast: ast.stunned || 0,
        boss: boss.stunned || 0,
        cls: near.el.classList.contains('betaeubt'),
        hpEqual: [near.hp, lang.hp, ast.hp, boss.hp].every((h, i) => h === hp[i]),
      };
    });
    expect(r.near).toBe(30);
    expect(r.lang).toBe(100);
    expect(r.remote).toBe(0);
    expect(r.ast).toBe(0);
    expect(r.boss).toBe(0);
    expect(r.cls).toBe(true);
    expect(r.hpEqual).toBe(true);
  });

  test('EMP-Radius je Raketen-Stufe 70/80/90/100/110: Geschoss knapp innerhalb wird zerstoert, knapp ausserhalb nicht', async ({
    page,
  }) => {
    await prepareEmp(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const E = window.__emp;
      const radii = [];
      const effect = [];
      for (let tier = 1; tier <= 5; tier++) {
        state.missileTier = tier;
        radii.push(E.Sn.empRadius(state));
        const should = 60 + tier * 10;
        // Der Laser misst 4 px Breite ab seiner linken Kante: innen = soll - 6 (rechte Kante weiter innen), aussen = soll + 6
        const inside = E.projectile('enemyLaser', should - 6, 0);
        const outside = E.projectile('enemyLaser', should + 6, 0);
        E.Sn.triggerEmp(state, 'p1');
        effect.push([!arrays.enemyLaserArray.includes(inside), arrays.enemyLaserArray.includes(outside)]);
        arrays.enemyLaserArray.forEach(g => g.el.remove());
        arrays.enemyLaserArray.length = 0;
      }
      return { radii, effect, rings: document.querySelectorAll('.sniper-emp').length };
    });
    expect(r.radii).toEqual([70, 80, 90, 100, 110]);
    expect(r.effect).toEqual([
      [true, true],
      [true, true],
      [true, true],
      [true, true],
      [true, true],
    ]);
    expect(r.rings).toBe(5);
  });

  test('EMP-Ring waechst in 10 Schritten und verschwindet', async ({ page }) => {
    await prepareEmp(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      state.missileTier = 3;
      G.thrown();
      const b1 = parseFloat(document.querySelector('.sniper-emp').style.width);
      G.free(6);
      const b2 = parseFloat(document.querySelector('.sniper-emp').style.width);
      G.free(6);
      return { b1, b2, gone: document.querySelectorAll('.sniper-emp').length };
    });
    expect(r.b2).toBeGreaterThan(r.b1);
    expect(r.b2).toBeLessThanOrEqual(180);
    expect(r.gone).toBe(0);
  });

  test('Neustart raeumt EMP-Ringe ab', async ({ page }) => {
    await prepareEmp(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      window.__gr.thrown();
      const beforehand = document.querySelectorAll('.sniper-emp').length;
      window.__emp.Sn.reset(state);
      return { beforehand, thereafter: document.querySelectorAll('.sniper-emp').length };
    });
    expect(r.beforehand).toBe(1);
    expect(r.thereafter).toBe(0);
  });

  test('Coop: Spieler 2 (Sniper) tippt mit Oe und das EMP kommt von seinem Schiff', async ({ page }) => {
    await prepareEmp(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, config } = window.__game;
      const G = window.__gr;
      G.thrown('ö');
      const ring = document.querySelector('.sniper-emp');
      const rad = parseFloat(ring.style.width) / 2;
      return {
        cdP2: state.p2.missileCooldown,
        cdP1: state.missileCooldown,
        rings: document.querySelectorAll('.sniper-emp').length,
        distanceX: Math.abs(parseFloat(ring.style.left) + rad - (state.p2.x + config.playerSize / 2)),
      };
    });
    expect(r.cdP2).toBeGreaterThan(0);
    expect(r.cdP1).toBe(0);
    expect(r.rings).toBe(1);
    expect(r.distanceX).toBeLessThan(2);
  });
});

test.describe('Spectre-SR EMP online', () => {
  test('Host: Client-Tipp zwischen zwei Host-Schritten ergibt genau einen Wurf samt EMP-Ereignis; Halten wirft nichts', async ({
    page,
  }) => {
    await prepareOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      const E = window.__input;
      state.network.lastSentEvent = null;
      E({ missile: true });
      E({ missile: false });
      G.free(2);
      const tap = {
        grenades: document.querySelectorAll('.sniper-granate').length,
        emp: document.querySelectorAll('.sniper-emp').length,
        cd: state.p2.missileCooldown,
        event: state.network.lastSentEvent,
      };
      G.free(40);
      state.p2.missileCooldown = 0;
      state.p2.sniperGrenadeCharges = 3;
      document.querySelectorAll('.sniper-granate, .sniper-emp').forEach(e => e.remove());
      E({ missile: true });
      G.free(20);
      const hold = {
        grenades: document.querySelectorAll('.sniper-granate').length,
        emp: document.querySelectorAll('.sniper-emp').length,
        cd: state.p2.missileCooldown,
        charges: state.p2.sniperGrenadeCharges,
      };
      E({ missile: false });
      G.free(3);
      return {
        tap,
        hold,
        afterHold: { grenades: document.querySelectorAll('.sniper-granate').length, cd: state.p2.missileCooldown },
      };
    });
    expect(r.tap.grenades).toBe(1);
    expect(r.tap.emp).toBe(1);
    expect(r.tap.cd).toBeGreaterThan(200);
    expect(r.tap.event).toMatchObject({ type: 'emp_ausgeloest', owner: 'p2', radius: 70 });
    expect(r.hold).toMatchObject({ grenades: 0, emp: 0, charges: 1 });
    expect(r.afterHold.grenades).toBe(0);
    expect(r.afterHold.cd).toBeGreaterThan(200); // eine Mine wurde gelegt -> Cooldown nach dem Loslassen
  });

  test('Client zeigt den EMP-Ring aus dem Ereignis (Ton, wachsender Ring, danach weg); ungueltige Daten werden ignoriert', async ({
    page,
  }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(async () => {
      const Sn = await import('./js/sniper.js');
      const { updateEffects } = await import('./js/effects.js');
      const Display = await import('./js/display.js');
      const { Audio } = window.__game;
      Audio.clearAudioHistory();
      Sn.showEmp({ x: 300, y: 300, radius: 90, owner: 'p1' });
      Sn.showEmp({ x: NaN, y: 1, radius: 90 });
      Sn.showEmp(null);
      const ring = document.querySelectorAll('.sniper-emp').length;
      for (let i = 0; i < 6; i++) {
        updateEffects();
        Display.drawWorld();
      }
      const width = parseFloat(document.querySelector('.sniper-emp').style.width);
      for (let i = 0; i < 6; i++) {
        updateEffects();
        Display.drawWorld();
      }
      return {
        ring,
        width,
        gone: document.querySelectorAll('.sniper-emp').length,
        tone: Audio.audioHistory.filter(e => e.name === 'emp').length,
      };
    });
    expect(r.ring).toBe(1);
    expect(r.width).toBeGreaterThan(0);
    expect(r.gone).toBe(0);
    expect(r.tone).toBe(1);
  });

  test('Protokollversion enthaelt das EMP-Ereignis (ab 11)', async ({ page }) => {
    await prepareGrenade(page);
    const v = await page.evaluate(async () => (await import('./js/net-encoding.js')).PROTOCOL_VERSION);
    expect(v).toBeGreaterThanOrEqual(11);
  });
});

test.describe('Spectre-SR Bot: EMP', () => {
  test('Bot tippt kurz (wenige Schritte true, dann false) bei naher Boss-Rakete; die Rakete verschwindet, Cooldown startet', async ({
    page,
  }) => {
    await prepareEmp(page, { coop: true });
    const r = await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      const { state, arrays, Entities } = window.__game;
      const G = window.__gr;
      window.__sn.empty();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      Bot.resetBot();
      state.p2.x = 285;
      state.p2.y = 480;
      state.p2.botFireLaser = false;
      state.p2.botFireMissile = false;
      state.p2.missileCooldown = 0;
      state.p2.sniperGrenadeCharges = 3;
      state.x = 40;
      state.y = 540;
      const mx = state.p2.x + 15;
      const my = state.p2.y + 15;
      Entities.createBossMissile(mx, my - 50, 1);
      const rk = arrays.bossMissileArray[0];
      rk.x = mx;
      rk.y = my - 50;
      rk.vx = 0;
      rk.vy = 0;
      const sequence = [];
      let gone = -1;
      for (let i = 0; i < 12; i++) {
        G.free(1);
        sequence.push(Boolean(state.p2.botFireMissile));
        if (gone < 0 && !arrays.bossMissileArray.includes(rk)) gone = i;
      }
      return { sequence, gone, cd: state.p2.missileCooldown };
    });
    expect(r.sequence[0]).toBe(true);
    expect(r.sequence.indexOf(false)).toBeGreaterThan(0);
    expect(r.sequence.indexOf(false)).toBeLessThanOrEqual(3);
    expect(r.sequence.filter(Boolean).length).toBeLessThanOrEqual(3);
    expect(r.gone).toBeGreaterThanOrEqual(0);
    expect(r.cd).toBeGreaterThan(150);
  });

  test('Bot tippt nicht, wenn das Geschoss weit weg ist', async ({ page }) => {
    await prepareEmp(page, { coop: true });
    const r = await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      const { state, arrays, Entities } = window.__game;
      const G = window.__gr;
      window.__sn.empty();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      Bot.resetBot();
      state.p2.x = 285;
      state.p2.y = 480;
      state.p2.missileCooldown = 0;
      state.p2.sniperGrenadeCharges = 3;
      state.x = 40;
      state.y = 540;
      Entities.createBossMissile(state.p2.x + 15, state.p2.y - 200, 1);
      const rk = arrays.bossMissileArray[0];
      rk.vx = 0;
      rk.vy = 0;
      let tapped = 0;
      for (let i = 0; i < 20; i++) {
        G.free(1);
        if (state.p2.botFireMissile) tapped++;
      }
      return { tapped, missile: arrays.bossMissileArray.length };
    });
    expect(r.tapped).toBe(0);
    expect(r.missile).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Haftminen (E2): Halten der Granaten-Taste legt Minen

// Mine legen: Raketen-Taste n Schritte halten und loslassen, Schiff danach aus dem Weg (Mine bleibt bei (200|430))
async function prepareMines(page, options = {}) {
  await prepareGrenade(page, options);
  await page.evaluate(() => {
    const { state, arrays } = window.__game;
    const G = window.__gr;
    window.__mi = {
      mines: () => arrays.sniperMines,
      // Eine Mine am Schiff legen und das Schiff wegsetzen
      oneOfMine() {
        G.hold(12);
        G.release();
        state.missileCooldown = 0;
        state.sniperGrenadeCharges = 3;
        state.x = 0;
        state.y = 100;
        return arrays.sniperMines[arrays.sniperMines.length - 1];
      },
      setEnemy(cx, cy, hp = 1000) {
        const f = G.enemy(cx, cy);
        f.hp = f.maxHp = hp;
        return f;
      },
      // Ziel pro Schritt um (dx|dy) bewegen, bis die Mine haftet (max. n Schritte)
      untilSticks(z, dx, dy, n = 40) {
        const m = arrays.sniperMines[0];
        for (let i = 0; i < n && !m.target; i++) {
          z.x += dx;
          z.y += dy;
          z.el.style.left = z.x + 'px';
          z.el.style.top = z.y + 'px';
          G.free(1);
        }
        return m;
      },
    };
  });
}

test.describe('Spectre-SR Haftminen', () => {
  test('Halten 70 Schritte legt 5 Minen im 12er-Takt an den jeweiligen Schiffspositionen, ohne Granate und EMP; danach Cooldown', async ({
    page,
  }) => {
    await prepareMines(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Audio } = window.__game;
      Audio.clearAudioHistory();
      state.keysPressed.v = true;
      const count = [];
      for (let i = 0; i < 70; i++) {
        state.x = 100 + i * 2; // Schiff wandert
        window.__game.Loop.simulationStep();
        count.push(arrays.sniperMines.length);
      }
      const during = {
        grenades: document.querySelectorAll('.sniper-granate').length,
        emp: document.querySelectorAll('.sniper-emp').length,
        charges: state.sniperGrenadeCharges,
      };
      state.keysPressed.v = false;
      window.__game.Loop.simulationStep();
      return {
        count,
        during,
        cd: state.missileCooldown,
        xs: arrays.sniperMines.map(m => m.x),
        ys: arrays.sniperMines.map(m => m.y),
        owner: arrays.sniperMines.map(m => m.pKey),
        els: document.querySelectorAll('.sniper-mine').length,
        tones: Audio.audioHistory.filter(e => e.name === 'mine_legen').length,
        emp: Audio.audioHistory.filter(e => e.name === 'emp').length,
      };
    });
    // Mine k (k = 0..4) faellt in Schritt 10 + 12k (Index 9 + 12k): Schiff steht dann bei x = 100 + (9 + 12k) * 2
    expect(r.count[8]).toBe(0);
    expect(r.count[9]).toBe(1);
    expect(r.count[20]).toBe(1);
    expect(r.count[21]).toBe(2);
    expect(r.count[69]).toBe(5);
    expect(r.count.filter((n, i) => i > 0 && n > r.count[i - 1])).toHaveLength(5);
    expect(r.xs).toEqual([0, 1, 2, 3, 4].map(k => 100 + (9 + 12 * k) * 2 + 15));
    // Gelegt unter dem Schiff (y 430), seitdem nach oben gedriftet: aeltere Minen stehen hoeher
    expect(r.ys.every(y => y <= 430 && y > 430 - 0.6 * 70)).toBe(true);
    expect(r.ys.every((y, i) => i === 0 || y > r.ys[i - 1])).toBe(true);
    expect(r.owner.every(o => o === 'p1')).toBe(true);
    expect(r.els).toBe(5);
    expect(r.tones).toBe(5);
    expect(r.during).toEqual({ grenades: 0, emp: 0, charges: 1 }); // fuenf Minen kosten zusammen genau eine Ladung
    expect(r.emp).toBe(0);
    expect(r.cd).toBeGreaterThan(150); // Nachladen laeuft seit der ersten Mine
    expect(r.cd).toBeLessThan(240);
  });

  test('Halten nur 12 Schritte legt 1 Mine (1 Ladung); Halten ohne Ladung legt keine', async ({ page }) => {
    await prepareMines(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      G.hold(12);
      G.release();
      const one = {
        mines: arrays.sniperMines.length,
        charges: state.sniperGrenadeCharges,
        cd: state.missileCooldown,
      };
      state.sniperGrenadeCharges = 0;
      G.hold(40);
      G.release();
      return {
        one,
        withoutCharge: {
          mines: arrays.sniperMines.length,
          charges: state.sniperGrenadeCharges,
          cd: state.missileCooldown,
        },
      };
    });
    expect(r.one).toMatchObject({ mines: 1, charges: 1 });
    expect(r.one.cd).toBeGreaterThan(230);
    expect(r.withoutCharge.mines).toBe(1);
    expect(r.withoutCharge.charges).toBe(0);
    expect(r.withoutCharge.cd).toBeLessThan(r.one.cd); // das laufende Nachladen wird nicht neu gestartet
  });

  test('maximal 8 aktive Minen pro Spieler, die aelteste faellt weg', async ({ page }) => {
    await prepareMines(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      const ids = [];
      for (let i = 0; i < 2; i++) {
        state.missileCooldown = 0;
        state.sniperGrenadeCharges = 3;
        G.hold(70);
        G.release();
        ids.push(...arrays.sniperMines.map(m => m.id));
      }
      const first = ids[0];
      return {
        count: arrays.sniperMines.length,
        els: document.querySelectorAll('.sniper-mine').length,
        firstStillThere: arrays.sniperMines.some(m => m.id === first),
        total: new Set(ids).size,
      };
    });
    expect(r.count).toBe(8);
    expect(r.els).toBe(8);
    expect(r.firstStillThere).toBe(false);
    expect(r.total).toBeGreaterThanOrEqual(10);
  });

  test('Mine driftet langsam nach oben; Lebensdauer 360 Schritte, ab 300 blinkend, danach weg ohne Explosion', async ({
    page,
  }) => {
    await prepareMines(page);
    const r = await page.evaluate(() => {
      const { state, Loop } = window.__game;
      const M = window.__mi;
      // Ohne natuerliche Spawns: die nach oben driftende Mine soll keinen zufaellig erscheinenden Gegner treffen
      const free = n => {
        for (let i = 0; i < n; i++) {
          state.frameCounter = 1;
          Loop.simulationStep();
        }
      };
      const m = M.oneOfMine();
      const x0 = m.x;
      const y0 = m.y;
      free(100);
      const drift = { x: m.x - x0, y: m.y - y0 };
      free(190); // gesamt 290 Schritte nach dem Legen
      const at290 = m.el.classList.contains('blinkt');
      free(15);
      const at305 = m.el.classList.contains('blinkt');
      free(50);
      const at355 = M.mines().includes(m);
      free(10);
      return {
        drift,
        at290,
        at305,
        at355,
        gone: !M.mines().includes(m),
        elGone: !m.el.isConnected,
        explosion: document.querySelectorAll('.sniper-mine-explosion').length,
      };
    });
    // 100 Schritte zu je 0,6 px nach oben, seitlich keine Bewegung
    expect(r.drift.x).toBe(0);
    expect(r.drift.y).toBeCloseTo(-60, 5);
    expect(r.at290).toBe(false);
    expect(r.at305).toBe(true);
    expect(r.at355).toBe(true);
    expect(r.gone).toBe(true);
    expect(r.elGone).toBe(true);
    expect(r.explosion).toBe(0);
  });

  test('Boss-Rakete beruehrt die Mine: Mine explodiert sofort und zerstoert Rakete und Boss-Bombe im Radius', async ({
    page,
  }) => {
    await prepareMines(page);
    const r = await page.evaluate(() => {
      const { arrays, Entities } = window.__game;
      const G = window.__gr;
      const M = window.__mi;
      const m = M.oneOfMine();
      // Boss-Bombe neben der Mine (im Radius 30, aber ohne Kontakt) – loest allein nicht aus
      Entities.createBossBomb(m.x + 12, m.y - 40);
      const bomb = arrays.bossBombArray[arrays.bossBombArray.length - 1];
      Object.assign(bomb, { x: m.x + 12, y: m.y - 30, vx: 0, vy: 0, timer: 9999 });
      G.free(1);
      const afterBomb = { mineThere: M.mines().includes(m), bombThere: arrays.bossBombArray.includes(bomb) };
      // Boss-Rakete direkt auf der Mine
      Entities.createBossMissile(m.x - 5, m.y - 8, 1);
      const missile = arrays.bossMissileArray[arrays.bossMissileArray.length - 1];
      Object.assign(missile, { x: m.x - 5, y: m.y - 8, vx: 0, vy: 0 });
      G.free(1);
      return {
        afterBomb,
        mineGone: !M.mines().includes(m),
        missileGone: !arrays.bossMissileArray.includes(missile),
        bombGone: !arrays.bossBombArray.includes(bomb),
        explosion: document.querySelectorAll('.sniper-mine-explosion').length,
      };
    });
    expect(r.afterBomb).toEqual({ mineThere: true, bombThere: true });
    expect(r.mineGone).toBe(true);
    expect(r.missileGone).toBe(true);
    expect(r.bombGone).toBe(true);
    expect(r.explosion).toBeGreaterThanOrEqual(1);
  });

  test('Feind beruehrt die Mine: haftet, folgt dem Feind, piept; Magma loest nicht aus', async ({ page }) => {
    await prepareMines(page);
    const r = await page.evaluate(() => {
      const { Audio } = window.__game;
      const G = window.__gr;
      const M = window.__mi;
      const m = M.oneOfMine();
      // Magma-Asteroid direkt auf der Mine: keine Reaktion
      const magma = window.__sn.asteroid(m.x, m.y, 30, true);
      delete magma.fixedX;
      delete magma.fixedY;
      G.free(5);
      const magmaSticks = !!m.target;
      magma.el.remove();
      window.__game.arrays.asteroids.splice(window.__game.arrays.asteroids.indexOf(magma), 1);
      Audio.clearAudioHistory();
      const f = M.setEnemy(200, 480);
      M.untilSticks(f, 0, -3);
      const sticks = !!m.target && m.target === f;
      const offX = m.x - (f.x + 15);
      const offY = m.y - (f.y + 15);
      const cls = m.el.classList.contains('haftet');
      const beeps = Audio.audioHistory.filter(e => e.name === 'mine_piep').length;
      // Feind wandert: Mine folgt
      for (let i = 0; i < 5; i++) {
        f.x += 2;
        f.y -= 1;
        f.el.style.left = f.x + 'px';
        f.el.style.top = f.y + 'px';
        G.free(1);
      }
      return {
        magmaSticks,
        sticks,
        cls,
        beeps,
        sequenceX: m.x - (f.x + 15) - offX,
        sequenceY: m.y - (f.y + 15) - offY,
        fuse: m.fuse,
      };
    });
    expect(r.magmaSticks).toBe(false);
    expect(r.sticks).toBe(true);
    expect(r.cls).toBe(true);
    expect(r.beeps).toBeGreaterThanOrEqual(1);
    expect(Math.abs(r.sequenceX)).toBeLessThan(0.01);
    expect(Math.abs(r.sequenceY)).toBeLessThan(0.01);
    expect(r.fuse).toBeLessThan(30);
  });

  test('haftet am Ziel und explodiert nach 30 Schritten: Schaden der Stufe im Radius 30, Nachbar im Radius auch, Ziel ausserhalb nicht', async ({
    page,
  }) => {
    await prepareMines(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Audio } = window.__game;
      const G = window.__gr;
      const M = window.__mi;
      state.missileTier = 3; // 30 Schaden
      const m = M.oneOfMine();
      const a = M.setEnemy(200, 480);
      const near = M.setEnemy(240, 430); // Mitte 40 px entfernt, Box-Kante bei 25 px -> im Radius
      const remote = M.setEnemy(320, 430);
      M.untilSticks(a, 0, -3);
      Audio.clearAudioHistory();
      G.free(28);
      const beforeEntry = { hp: a.hp, near: near.hp, there: arrays.sniperMines.includes(m) };
      G.free(1); // 29. Schritt nach dem Haften
      const before30 = arrays.sniperMines.includes(m);
      G.free(1); // 30.
      return {
        beforeEntry,
        before30,
        afterEntry: arrays.sniperMines.includes(m),
        a: a.hp,
        near: near.hp,
        remote: remote.hp,
        wave: document.querySelectorAll('.sniper-mine-explosion').length,
        tone: Audio.audioHistory.filter(e => e.name === 'mine_explosion').length,
      };
    });
    expect(r.beforeEntry).toEqual({ hp: 1000, near: 1000, there: true });
    expect(r.before30).toBe(true);
    expect(r.afterEntry).toBe(false);
    expect(r.a).toBe(970);
    expect(r.near).toBe(970);
    expect(r.remote).toBe(1000);
    expect(r.wave).toBe(1);
    expect(r.tone).toBe(1);
  });

  test('Schaden je Raketen-Stufe 20/25/30/35/40; Schild nimmt den Schaden zuerst', async ({ page }) => {
    await prepareMines(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      const M = window.__mi;
      const hp = [];
      for (let tier = 1; tier <= 5; tier++) {
        window.__sn.empty();
        state.missileTier = tier;
        state.missileCooldown = 0;
        state.sniperGrenadeCharges = 3;
        const m = M.oneOfMine();
        const f = M.setEnemy(m.x, m.y + 40);
        M.untilSticks(f, 0, -3);
        G.free(31);
        hp.push(f.hp);
      }
      window.__sn.empty();
      state.missileTier = 1;
      const m = M.oneOfMine();
      const f = M.setEnemy(m.x, m.y + 40);
      f.shieldHp = 50;
      f.hasShield = true;
      M.untilSticks(f, 0, -3);
      G.free(31);
      return { hp, shield: f.shieldHp, hpShield: f.hp };
    });
    expect(r.hp).toEqual([980, 975, 970, 965, 960]);
    expect(r.shield).toBe(30);
    expect(r.hpShield).toBe(1000);
  });

  test('Ziel stirbt vorher: Explosion an der letzten Position, Nachbar dort bekommt Schaden', async ({ page }) => {
    await prepareMines(page);
    const r = await page.evaluate(() => {
      const { arrays, Utils } = window.__game;
      const G = window.__gr;
      const M = window.__mi;
      const m = M.oneOfMine();
      const a = M.setEnemy(200, 480);
      const near = M.setEnemy(225, 430);
      M.untilSticks(a, 0, -3);
      G.free(10);
      const px = m.x;
      const py = m.y;
      Utils.destroyTarget(a, 'p1');
      G.free(1);
      const w = document.querySelector('.sniper-mine-explosion');
      return {
        gone: !arrays.sniperMines.includes(m),
        near: near.hp,
        waveX: w ? parseFloat(w.style.left) + parseFloat(w.style.width) / 2 : null,
        px,
        py,
      };
    });
    expect(r.gone).toBe(true);
    expect(r.near).toBe(980);
    expect(r.waveX).not.toBeNull();
  });

  test('Coop-P2 legt eigene Minen an der Position von P2; Reset und Game Over raeumen alles ab', async ({ page }) => {
    await prepareMines(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      G.hold(23, 'ö');
      G.release('ö');
      const p2 = {
        mines: arrays.sniperMines.map(m => [m.pKey, m.x, m.y]),
        cd: state.p2.missileCooldown,
        cdP1: state.missileCooldown,
      };
      const el = document.querySelectorAll('.sniper-mine-p2').length;
      return { p2, el };
    });
    // An der Position von P2 gelegt (x 400, y 430), seitdem leicht nach oben gedriftet
    expect(r.p2.mines.map(m => [m[0], m[1]])).toEqual([
      ['p2', 400],
      ['p2', 400],
    ]);
    expect(r.p2.mines.every(m => m[2] <= 430 && m[2] > 430 - 0.6 * 30)).toBe(true);
    expect(r.p2.cd).toBeGreaterThan(200); // Nachladen seit der ersten Mine
    expect(r.p2.cdP1).toBe(0);
    expect(r.el).toBe(2);
    const reset = await page.evaluate(async () => {
      const Sn = await import('./js/sniper.js');
      const { state, arrays } = window.__game;
      Sn.reset(state.p2);
      const afterP2 = arrays.sniperMines.length;
      window.__gr.hold(12);
      window.__gr.release();
      const withP1 = arrays.sniperMines.length;
      Sn.removeEffects();
      return { afterP2, withP1, end: arrays.sniperMines.length, els: document.querySelectorAll('.sniper-mine').length };
    });
    expect(reset).toEqual({ afterP2: 0, withP1: 1, end: 0, els: 0 });
  });
});

test.describe('Spectre-SR Bot: Minen', () => {
  async function prepareBotMines(page) {
    await prepareEmp(page, { coop: true });
    await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      const { state } = window.__game;
      window.__sn.empty();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      Bot.resetBot();
      state.p2.x = 285;
      state.p2.y = 480;
      state.p2.missileCooldown = 0;
      state.p2.sniperGrenadeCharges = 3;
      state.x = 40;
      state.y = 540;
    });
  }

  test('Bot haelt die Raketen-Taste und legt Minen, wenn ein Feind heranfliegt (max. 5), dann loslassen und Cooldown', async ({
    page,
  }) => {
    await prepareBotMines(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      const f = G.enemy(300, 480 + 15 - 148 - 15);
      state.p2.sniperGrenadeCharges = 1; // eine Ladung: ein Halten (max. 5 Minen), danach ohne Ladung kein weiteres
      let maxMines = 0;
      let held = 0;
      let grenades = 0;
      for (let i = 0; i < 80; i++) {
        // Schiff fest, Feind naehert sich jeden Schritt um 1,2 px von 148 auf etwa 60 px Abstand
        state.p2.x = 285;
        state.p2.y = 480;
        f.x = 285;
        f.y = 480 - 148 + Math.min(i, 73) * 1.2;
        f.el.style.left = f.x + 'px';
        f.el.style.top = f.y + 'px';
        G.free(1);
        if (state.p2.botFireMissile) held++;
        maxMines = Math.max(maxMines, arrays.sniperMines.filter(m => m.pKey === 'p2').length);
        grenades = Math.max(grenades, document.querySelectorAll('.sniper-granate').length);
      }
      return {
        maxMines,
        held,
        grenades,
        cd: state.p2.missileCooldown,
        other: arrays.sniperMines.filter(m => m.pKey !== 'p2').length,
      };
    });
    expect(r.maxMines).toBe(5);
    expect(r.held).toBeGreaterThanOrEqual(55);
    expect(r.held).toBeLessThanOrEqual(62);
    expect(r.cd).toBeGreaterThan(150);
    expect(r.grenades).toBe(0);
    expect(r.other).toBe(0);
  });

  test('Bot legt keine Minen ohne heranfliegenden Feind (stehender Feind, weit weg)', async ({ page }) => {
    await prepareBotMines(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      G.enemy(300, 480 + 15 - 100); // nah, aber ruhend: naehert sich nicht
      G.enemy(100, 100);
      let held = 0;
      for (let i = 0; i < 40; i++) {
        G.free(1);
        if (state.p2.botFireMissile) held++;
      }
      return { held, mines: arrays.sniperMines.length };
    });
    expect(r.held).toBe(0);
    expect(r.mines).toBe(0);
  });
});

test.describe('Spectre-SR Haftminen online (Host)', () => {
  test('Host: Snapshot enthaelt die Minen (id, x, y, owner, haftet, Timer, blinkt) und ein Ereignis bei der Explosion', async ({
    page,
  }) => {
    await prepareOnlineHost(page);
    const r = await page.evaluate(async () => {
      const { state, Network, arrays } = window.__game;
      const G = window.__gr;
      const E = window.__input;
      const NK = await import('./js/net-encoding.js');
      E({ missile: true });
      G.free(25);
      E({ missile: false });
      G.free(2);
      const snap = Network.serializeGameState();
      const list = snap.sniperMines.map(m => ({
        id: typeof m.id,
        x: m.x,
        y: m.y,
        owner: m.owner,
        sticks: m.sticks,
        rest: m.rest > 300,
        blinks: m.blinks,
      }));
      const k = new NK.SnapshotEncoder();
      const dek = new NK.SnapshotDecoder().decode(JSON.parse(JSON.stringify(k.encode(snap, 0))));
      // Schiff zur Seite, damit der Feind es nicht rammt; Feind mittig auf die erste Mine (Minen driften) -> haftet
      E({ x: 100, y: 400 });
      const m0 = arrays.sniperMines[0];
      const f = G.enemy(m0.x, m0.y);
      G.free(2);
      const sticks = Network.serializeGameState().sniperMines.find(m => m.id === m0.id);
      state.network.lastSentEvent = null;
      G.free(32);
      return {
        list,
        decoded: dek.sniperMines.length,
        sticks: sticks && [sticks.sticks, sticks.fuse > 0],
        event: state.network.lastSentEvent,
        hp: f.hp,
      };
    });
    expect(r.list).toHaveLength(2);
    // y: unter P2 gelegt (430) und seitdem nach oben gedriftet
    expect({ ...r.list[0], y: undefined }).toEqual({
      id: 'string',
      x: 400,
      y: undefined,
      owner: 'p2',
      sticks: false,
      rest: true,
      blinks: false,
    });
    expect(r.list[0].y).toBeLessThanOrEqual(430);
    expect(r.list[0].y).toBeGreaterThan(430 - 0.6 * 30);
    expect(r.decoded).toBe(2);
    expect(r.sticks).toEqual([true, true]);
    expect(r.event).toMatchObject({ type: 'mine_explodiert', owner: 'p2', radius: 30 });
    expect(r.hp).toBe(960); // beide Minen (an derselben Stelle) haften und explodieren
  });
});

// ---------------------------------------------------------------------------------------------
// Granaten-Ladungen: 2 (Raketen-Stufe 1-3) bzw. 3 (Stufe 4-5), raketenCooldown = Ladezeit der naechsten Ladung

test.describe('Spectre-SR Granaten-Ladungen', () => {
  test('Start/Reset: voll (2); zwei Granaten direkt nacheinander, die dritte nicht', async ({ page }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Sniper = await import('./js/sniper.js');
      const G = window.__gr;
      state.sniperGrenadeCharges = 0;
      state.missileCooldown = 99;
      Sniper.reset(state);
      const start = {
        charges: state.sniperGrenadeCharges,
        cd: state.missileCooldown,
        p2: state.p2.sniperGrenadeCharges,
      };
      G.thrown();
      const afterOne = {
        grenades: document.querySelectorAll('.sniper-granate').length,
        charges: state.sniperGrenadeCharges,
      };
      G.thrown();
      const afterTwo = {
        grenades: document.querySelectorAll('.sniper-granate').length,
        emp: document.querySelectorAll('.sniper-emp').length,
        charges: state.sniperGrenadeCharges,
      };
      G.thrown();
      return {
        start,
        afterOne,
        afterTwo,
        afterThree: {
          grenades: document.querySelectorAll('.sniper-granate').length,
          charges: state.sniperGrenadeCharges,
        },
      };
    });
    expect(r.start).toEqual({ charges: 2, cd: 0, p2: 2 });
    expect(r.afterOne).toEqual({ grenades: 1, charges: 1 });
    expect(r.afterTwo).toEqual({ grenades: 2, emp: 2, charges: 0 });
    expect(r.afterThree).toEqual({ grenades: 2, charges: 0 });
  });

  test('Nachladen nacheinander: je Ladezeit der Stufe (240 auf Stufe 1, 210 auf Stufe 2), nur eine Ladezeit laeuft', async ({
    page,
  }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      const measure = tier => {
        state.missileTier = tier;
        state.missileCooldown = 0;
        state.sniperGrenadeCharges = 2;
        G.free(1);
        G.thrown();
        G.thrown();
        let steps = 0;
        const times = [];
        let last = state.sniperGrenadeCharges;
        while (state.sniperGrenadeCharges < 2 && steps < 600) {
          G.free(1);
          steps++;
          if (state.sniperGrenadeCharges !== last) {
            times.push(steps);
            last = state.sniperGrenadeCharges;
          }
        }
        return { times, charges: state.sniperGrenadeCharges, cd: state.missileCooldown };
      };
      return { s1: measure(1), s2: measure(2) };
    });
    for (const [s, chargeTime] of [
      [r.s1, 240],
      [r.s2, 210],
    ]) {
      expect(s.times).toHaveLength(2);
      expect(s.times[0]).toBeGreaterThan(chargeTime - 6);
      expect(s.times[0]).toBeLessThanOrEqual(chargeTime);
      expect(s.times[1] - s.times[0]).toBe(chargeTime);
      expect(s.charges).toBe(2);
      expect(s.cd).toBe(0);
    }
  });

  test('Stufe 4 hat Max 3: nach dem Upgrade laedt die dritte Ladung von selbst', async ({ page }) => {
    await prepareGrenade(page);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Sniper = await import('./js/sniper.js');
      const G = window.__gr;
      const max = s => {
        state.missileTier = s;
        return Sniper.grenadeMax(state);
      };
      const maxe = [1, 2, 3, 4, 5].map(max);
      state.missileTier = 1;
      G.free(2);
      const beforehand = state.sniperGrenadeCharges;
      state.missileTier = 4;
      G.free(1);
      const cdStart = state.missileCooldown;
      G.free(200);
      return { maxe, beforehand, cdStart, charges: state.sniperGrenadeCharges, cd: state.missileCooldown };
    });
    expect(r.maxe).toEqual([2, 2, 2, 3, 3]);
    expect(r.beforehand).toBe(2);
    expect(r.cdStart).toBeGreaterThan(170);
    expect(r.cdStart).toBeLessThanOrEqual(180);
    expect(r.charges).toBe(3);
    expect(r.cd).toBe(0);
  });

  test('Halten verbraucht genau 1 Ladung (weitere Minen kosten nichts); ohne Ladung keine Minen', async ({ page }) => {
    await prepareMines(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      G.hold(70);
      const during = { mines: arrays.sniperMines.length, charges: state.sniperGrenadeCharges };
      G.release();
      const thereafter = { charges: state.sniperGrenadeCharges, cd: state.missileCooldown };
      state.sniperGrenadeCharges = 0;
      arrays.sniperMines.forEach(m => m.el.remove());
      arrays.sniperMines.length = 0;
      G.hold(70);
      const without = { mines: arrays.sniperMines.length, charges: state.sniperGrenadeCharges };
      G.release();
      return { during, thereafter, without };
    });
    expect(r.during).toEqual({ mines: 5, charges: 1 });
    expect(r.thereafter.charges).toBe(1);
    expect(r.thereafter.cd).toBeGreaterThan(150);
    expect(r.without).toEqual({ mines: 0, charges: 0 });
  });

  test('HUD: Punkte neben dem GRANATE-Balken (P1 und P2), Balken zeigt den Ladefortschritt, Mobil-Knopf zeigt die Anzahl', async ({
    page,
  }) => {
    await prepareGrenade(page, { coop: true });
    const r = await page.evaluate(() => {
      const G = window.__gr;
      const points = id => {
        const el = document.getElementById(id);
        return {
          visible: getComputedStyle(el).display !== 'none',
          total: el.querySelectorAll('.dash-ladung').length,
          full: el.querySelectorAll('.dash-ladung.voll').length,
        };
      };
      const number = document.getElementById('btn-rakete-ladungen');
      const read = () => ({
        p1: points('dash-ladungen'),
        p2: points('dash-ladungen-p2'),
        number: number.textContent,
        numberVisible: getComputedStyle(number).display !== 'none',
        bar: parseFloat(document.getElementById('raketen-cd-balken').style.width),
      });
      G.free(2);
      const full = read();
      G.thrown();
      const oneOf = read();
      G.thrown();
      const no = read();
      G.thrown('ö');
      const p2OneOf = read();
      return { full, oneOf, no, p2OneOf };
    });
    expect(r.full).toMatchObject({
      p1: { visible: true, total: 2, full: 2 },
      p2: { visible: true, total: 2, full: 2 },
      number: '2',
      numberVisible: true,
      bar: 100,
    });
    expect(r.oneOf).toMatchObject({ p1: { total: 2, full: 1 }, p2: { full: 2 }, number: '1' });
    expect(r.oneOf.bar).toBeLessThan(5);
    expect(r.no).toMatchObject({ p1: { full: 0 }, number: '0' });
    expect(r.p2OneOf.p2.full).toBe(1);
    expect(r.p2OneOf.p1.full).toBe(0);
  });

  test('Host: Snapshot traegt sniperGranatenLadungen (nur Sniper, ganzzahlig, gerundet)', async ({ page }) => {
    await prepareOnlineHost(page);
    const r = await page.evaluate(async () => {
      const { state, Network } = window.__game;
      const NK = await import('./js/net-encoding.js');
      state.p2.sniperGrenadeCharges = 1;
      const full = Network.serializeGameState();
      const out = { p2: full.p2.sniperGrenadeCharges, p1: full.p1.sniperGrenadeCharges };
      state.p2.sniperGrenadeCharges = 1.6;
      const packet = new NK.SnapshotEncoder().encode(Network.serializeGameState(), 0);
      const dek = new NK.SnapshotDecoder().decode(JSON.parse(JSON.stringify(packet)));
      out.decoded = dek.p2.sniperGrenadeCharges;
      state.p2.selectedShipModel = 'viper';
      out.viper = 'sniperGrenadeCharges' in Network.serializeGameState().p2;
      return out;
    });
    expect(r.p2).toBe(1);
    expect(r.p1).toBe(2);
    expect(r.decoded).toBe(2);
    expect(r.viper).toBe(false);
  });
});

test.describe('Spectre-SR Bot: Granaten-Ladungen', () => {
  test('Bot tippt EMP bei naher Boss-Rakete nur mit Ladung', async ({ page }) => {
    await prepareEmp(page, { coop: true });
    const r = await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      const { state, arrays, Entities } = window.__game;
      const G = window.__gr;
      window.__sn.empty();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      Bot.resetBot();
      state.p2.x = 285;
      state.p2.y = 480;
      state.x = 40;
      state.y = 540;
      const mx = state.p2.x + 15;
      const my = state.p2.y + 15;
      Entities.createBossMissile(mx, my - 50, 1);
      const rk = arrays.bossMissileArray[0];
      rk.vx = 0;
      rk.vy = 0;
      state.p2.sniperGrenadeCharges = 0;
      state.p2.missileCooldown = 100;
      let without = 0;
      for (let i = 0; i < 12; i++) {
        rk.x = state.p2.x + 15;
        rk.y = state.p2.y - 35;
        G.free(1);
        if (state.p2.botFireMissile) without++;
      }
      const stillThere = arrays.bossMissileArray.includes(rk);
      state.p2.sniperGrenadeCharges = 1;
      let withEntry = 0;
      for (let i = 0; i < 6; i++) {
        rk.x = state.p2.x + 15;
        rk.y = state.p2.y - 35;
        G.free(1);
        if (state.p2.botFireMissile) withEntry++;
      }
      return {
        without,
        stillThere,
        withEntry,
        gone: !arrays.bossMissileArray.includes(rk),
        charges: state.p2.sniperGrenadeCharges,
      };
    });
    expect(r.without).toBe(0);
    expect(r.stillThere).toBe(true);
    expect(r.withEntry).toBeGreaterThan(0);
    expect(r.gone).toBe(true);
    expect(r.charges).toBe(0);
  });
});
