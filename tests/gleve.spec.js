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

test('Gleve-MR: im Hangar wählbar, Perks, Manta-SVG, keine Werfer-Pods, HUD SWEEP/DASH', async ({ page }) => {
  const gleveBtn = page.locator('.hangar-model-btn[data-model="gleve"]');
  await expect(gleveBtn).toBeVisible();
  await gleveBtn.click();
  await expect(gleveBtn).toHaveClass(/active/);

  // Name und Perks kommen aus dem Schiffsmodell; Balancing-Werte prueft das Verhalten in den Dash-/Sweep-Tests
  const values = await page.evaluate(async () => {
    const { state, shipModels } = await import('./js/state.js');
    return {
      model: state.selectedShipModel,
      name: shipModels.gleve.name,
      perks: shipModels.gleve.perks.map(p => p.label),
    };
  });
  expect(values.model).toBe('gleve');
  await expect(page.locator('#hangar-ship-name')).toContainText(values.name);
  await expect(page.locator('#hangar-ship-perks .hangar-perk-chip')).toHaveCount(values.perks.length);
  for (let i = 0; i < values.perks.length; i++) {
    await page.locator('#hangar-ship-perks .hangar-perk-chip').nth(i).click();
    await expect(page.locator('#hangar-perk-detail')).toContainText(values.perks[i]);
  }

  // Spiel starten
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(50);
  await page.keyboard.up('KeyW');
  await expect(page.locator('#spieler')).toBeVisible();

  // Manta-SVG wird gerendert
  const svgHtml = await page.locator('#spieler svg').evaluate(el => el.innerHTML);
  expect(svgHtml).toContain('Gleve-MR');
  expect(await page.locator('#spieler svg path').count()).toBeGreaterThanOrEqual(5);

  // HUD-Beschriftungen: Energie = Sweep, Raketen-Cooldown = Dash
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('SWEEP');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('DASH');

  // Werfer-Pods auch bei Raketenstufe 5 ausgeblendet, ohne Abwurf-Effekt
  await expect(page.locator('#spieler .werfer-links')).toBeHidden();
  await expect(page.locator('#spieler .werfer-rechts')).toBeHidden();
  await expect(page.locator('#spieler .werfer-center')).toBeHidden();
  const drop = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    state.missileTier = 5;
    Utils.updateActivePowerupsUi();
    state.missileTier = 1;
    Utils.updateActivePowerupsUi();
    return document.querySelectorAll('.werfer-abgeworfen').length;
  });
  expect(drop).toBe(0);
  await expect(page.locator('#spieler .werfer-center')).toBeHidden();

  // Zurück zur Viper: Originaltexte und Werfer
  await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    state.selectedShipModel = 'viper';
    Utils.updatePlayerShipVisuals();
  });
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('E');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('R');
  await expect(page.locator('#spieler .werfer-links')).toBeVisible();
});

// Gleve im Hangar wählen (optional als P2 im lokalen Coop), Spiel starten und Feld leeren.
// Danach stellt window.__gleveTest.leeren() einen deterministischen Ausgangszustand her;
// Aufbau, simulationsSchritt()-Aufrufe und Auswertung laufen je Test in einem synchronen Block.
async function startGleve(page, { coop = false } = {}) {
  if (coop) {
    await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
    await page.locator('.hangar-player-tab[data-player="p2"]').click();
  }
  await page.locator('.hangar-model-btn[data-model="gleve"]').click();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    window.__gleveTest = {
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
          'gleveWaves',
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
        for (const s of [state, state.p2]) {
          s.maxEnergy = 50;
          s.energy = 50;
          s.laserTier = 1;
          s.shieldTier = 0;
          s.lives = 3;
          s.invulnerableTimer = 0;
          s.unlimitedEnergy = false;
          s.gleveDashTimer = 0;
          s.gleveBounceTimer = 0;
          s.gleveInvulnerable = 0;
          s.gleveDashKeyHeld = false;
          s.missileTier = 1;
          s.missileCooldown = 0;
          s.gleveDashCharges = 2;
          s.gleveSweepTimer = 0;
          s.gleveSweepDirection = 0;
          s.gleveSweepHit = [];
          s.gleveSweepCadence = 0;
        }
        document.querySelectorAll('.gleve-klinge').forEach(el => el.remove());
        state.x = 185;
        state.y = 400;
      },
      steps(n) {
        for (let i = 0; i < n; i++) window.__game.Loop.simulationStep();
      },
    };
  });
}

test.describe('Gleve-MR Dash (Raketen-Taste)', () => {
  test('Dash bewegt das Schiff um die Reichweite in Steuerrichtung, kostet keine Energie und startet den Cooldown', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Diagonal rechts oben, Stufe 1: 100 px, 180 Frames Cooldown
      state.keysPressed.d = true;
      state.keysPressed.w = true;
      state.keysPressed.k = true;
      T.steps(1);
      const afterStart = { energy: state.energy, timer: state.gleveDashTimer, cd: state.missileCooldown };
      T.steps(2);
      const classDuring = document.getElementById('spieler').classList.contains('gleve-dash');
      T.steps(5);
      const end = { x: state.x, y: state.y, energy: state.energy, cd: state.missileCooldown };
      const bar = parseFloat(document.getElementById('raketen-cd-balken').style.width);
      const classThereafter = document.getElementById('spieler').classList.contains('gleve-dash');
      const effects = document.querySelectorAll('.gleve-nachbild').length;
      Object.keys(state.keysPressed).forEach(k => {
        state.keysPressed[k] = false;
      });
      return {
        afterStart,
        classDuring,
        end,
        bar,
        classThereafter,
        effects,
        dashSounds: window.__game.Audio.audioHistory.filter(a => a.name === 'dash').length,
      };
    });
    // Der Cooldown laeuft im selben Schritt schon einen Frame herunter
    expect(r.afterStart).toEqual({ energy: 50, timer: 7, cd: 179 });
    expect(r.classDuring).toBe(true);
    expect(r.classThereafter).toBe(false);
    expect(r.end.x).toBeCloseTo(185 + 100 / Math.SQRT2, 1);
    expect(r.end.y).toBeCloseTo(400 - 100 / Math.SQRT2, 1);
    // Der Dash selbst ist kostenlos (nachStart), am Ende folgt der Combo-Sweep (Stufe 1: 8 Energie)
    expect(r.end.energy).toBe(42);
    expect(r.end.cd).toBe(172);
    // HUD-Raketenbalken zeigt den Dash-Cooldown
    expect(r.bar).toBeCloseTo(100 - (172 / 180) * 100, 3);
    expect(r.effects).toBeGreaterThan(0);
    expect(r.dashSounds).toBe(1);
  });

  test('Nur ein Dash pro Tastendruck, Ladungen und Reichweite nach Raketen-Stufe, waffenOffline blockiert, keine Raketen', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(async () => {
      const { state, arrays, Audio } = window.__game;
      const Hack = await import('./js/hack.js');
      const T = window.__gleveTest;
      T.empty();
      // Taste 30 Schritte gehalten: nur ein Dash nach oben
      state.keysPressed.k = true;
      T.steps(30);
      const held = { y: state.y, charges: state.gleveDashCharges };
      // Loslassen und erneut druecken: zweite Ladung, zweiter Dash
      state.keysPressed.k = false;
      T.steps(1);
      state.keysPressed.k = true;
      T.steps(10);
      const secondary = { y: state.y, charges: state.gleveDashCharges, cd: state.missileCooldown };
      state.keysPressed.k = false;
      T.steps(1);
      // Keine Ladung mehr: kein Dash
      state.keysPressed.k = true;
      T.steps(10);
      const withoutCharge = { y: state.y, charges: state.gleveDashCharges };
      state.keysPressed.k = false;
      T.steps(1);
      // Wieder eine Ladung: Dash
      state.gleveDashCharges = 1;
      state.keysPressed.k = true;
      T.steps(10);
      const third = state.y;
      state.keysPressed.k = false;
      T.steps(1);

      // waffenOffline-Hack blockiert den Dash
      state.y = 400;
      state.missileCooldown = 0;
      state.gleveDashCharges = 2;
      Hack.hackPlayer(state, 'weaponOffline');
      state.keysPressed.k = true;
      T.steps(10);
      const hacked = { y: state.y, cd: state.missileCooldown, charges: state.gleveDashCharges };
      state.keysPressed.k = false;
      state.hacks = [];
      T.steps(1);

      // Reichweite und Cooldown je Raketen-Stufe (nach 8 Schritten)
      const tiers = [];
      for (let s = 1; s <= 5; s++) {
        state.missileTier = s;
        state.missileCooldown = 0;
        state.gleveDashCharges = 2;
        state.y = 500;
        state.keysPressed.k = true;
        T.steps(8);
        tiers.push({ gone: Math.round((500 - state.y) * 1000) / 1000, cd: state.missileCooldown });
        state.keysPressed.k = false;
        T.steps(1);
      }
      return {
        held,
        secondary,
        withoutCharge,
        third,
        hacked,
        tiers,
        energy: state.energy,
        lasers: arrays.laserArray.length,
        missiles: arrays.missileArray.length,
        missileSounds: Audio.audioHistory.filter(a => a.name === 'missile').length,
      };
    });
    // Gehaltene Taste: nur ein Dash, eine Ladung verbraucht
    expect(r.held.y).toBeCloseTo(300, 5);
    expect(r.held.charges).toBe(1);
    // Zweiter Druck nutzt die zweite Ladung; das laufende Nachladen wird nicht neu gestartet
    expect(r.secondary.y).toBeCloseTo(200, 5);
    expect(r.secondary.charges).toBe(0);
    expect(r.secondary.cd).toBe(139);
    expect(r.withoutCharge.y).toBeCloseTo(200, 5);
    expect(r.withoutCharge.charges).toBe(0);
    expect(r.third).toBeCloseTo(100, 5);
    expect(r.hacked.y).toBeCloseTo(400, 5);
    expect(r.hacked.cd).toBe(0);
    expect(r.hacked.charges).toBe(2);
    expect(r.tiers).toEqual([
      { gone: 100, cd: 172 },
      { gone: 110, cd: 157 },
      { gone: 120, cd: 142 },
      { gone: 135, cd: 127 },
      { gone: 150, cd: 112 },
    ]);
    // Die Gleve feuert weder Laser-Projektile noch Raketen
    expect(r.lasers).toBe(0);
    expect(r.missiles).toBe(0);
    expect(r.missileSounds).toBe(0);
  });

  test('Normale Feinde auf der Strecke werden zerstört, Kill-Kette verkürzt das Nachladen um 30 Frames pro Kill', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Zwei Feinde (einer mit Schild) direkt ueber dem Schiff, kein Schuss
      Entities.createEnemy(185, 350, 'normal', 0, true);
      Entities.createEnemy(185, 315, 'normal', 0, false);
      arrays.enemies.forEach(f => {
        f.shotTimer = 9999;
        f.carriesPowerup = false;
      });
      const scoreBeforehand = state.score;
      state.keysPressed.k = true;
      T.steps(8);
      state.keysPressed.k = false;
      return {
        enemies: arrays.enemies.length,
        energy: state.energy,
        cd: state.missileCooldown,
        charges: state.gleveDashCharges,
        lives: state.lives,
        points: state.score - scoreBeforehand,
        y: state.y,
      };
    });
    expect(r.enemies).toBe(0);
    expect(r.lives).toBe(3);
    expect(r.points).toBeGreaterThanOrEqual(200);
    // 180 (Nachladen) - 2 * 30 (Kill-Kette) - 8 Schritte
    expect(r.cd).toBe(112);
    expect(r.charges).toBe(1);
    expect(r.energy).toBe(42); // nur der Combo-Sweep kostet Energie
    expect(r.y).toBeCloseTo(300, 5);
  });

  test('Boss bekommt Dash-Schaden, Schiff prallt schräg zur Seite ab', async ({ page }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      Entities.createBoss();
      const b = arrays.bosses[0];
      Object.assign(b, {
        phase: 'kampf',
        x: 150,
        y: 20,
        vx: 0,
        shotTimer: 9999,
        bombTimer: 9999,
        missileTimer: 9999,
      });
      // Schiff links der Bossmitte, Dash nach oben in den Boss
      state.x = 170;
      state.y = 160;
      state.keysPressed.k = true;
      T.steps(5);
      const impact = { hp: b.hp, maxHp: b.maxHp, dash: state.gleveDashTimer, bounce: state.gleveBounceTimer };
      T.steps(8);
      state.keysPressed.k = false;
      return {
        impact,
        x: state.x,
        y: state.y,
        bossX: b.x,
        size: b.size,
        invulnerable: state.gleveInvulnerable,
        lives: state.lives,
        bossThere: arrays.bosses.length,
      };
    });
    expect(r.bossThere).toBe(1);
    expect(r.impact.hp).toBe(r.impact.maxHp - 60);
    expect(r.impact.dash).toBe(0);
    expect(r.impact.bounce).toBe(8);
    // Landepunkt: halbe Bossbreite links neben der Bosskante, 30 px tiefer als der Aufprallpunkt (y 110)
    expect(r.x).toBeCloseTo(r.bossX - r.size / 2 - 30, 5);
    expect(r.y).toBeCloseTo(140, 5);
    expect(r.lives).toBe(3);
    // Unverwundbarkeit laeuft nach dem Abprall noch 30 Frames
    expect(r.invulnerable).toBe(31);
  });

  test('Unverwundbar während des Dashs und kurz danach: Feindlaser trifft nicht', async ({ page }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Stehende Feindlaser auf der Strecke und am Zielpunkt
      Entities.createEnemyLaser(198, 350);
      Entities.createEnemyLaser(198, 310);
      arrays.enemyLaserArray.forEach(fl => {
        fl.vy = 0;
        fl.vx = 0;
      });
      state.keysPressed.k = true;
      T.steps(12); // 8 Dash-Frames + 4 Nachlauf
      const during = { lives: state.lives, laser: arrays.enemyLaserArray.length, blink: state.invulnerableTimer };
      T.steps(10); // Nachlauf vorbei: der Laser am Zielpunkt trifft jetzt
      state.keysPressed.k = false;
      return { during, thereafter: state.lives, y: state.y };
    });
    expect(r.y).toBeCloseTo(300, 5);
    expect(r.during.lives).toBe(3);
    expect(r.during.laser).toBe(2);
    expect(r.during.blink).toBe(0);
    expect(r.thereafter).toBe(2);
  });

  test('Magma: unter Raketen-Stufe 5 Abprall, auf Stufe 5 wird es geknackt und zerstört', async ({ page }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      const createMagma = () => {
        Entities.createAsteroid(185, 330, 30, 0, 0, 0, true);
        const m = arrays.asteroids[arrays.asteroids.length - 1];
        m.isIndestructible = true;
        m.isMagma = true;
        m.vRot = 0;
        m.el.classList.add('unzerstoerbar');
        if (m.crackEl) {
          m.crackEl.remove();
          m.crackEl = null;
        }
        return m;
      };

      // Stufe 1 (Laser-Stufe 5 aendert daran nichts): Abprall, Magma bleibt heil
      T.empty();
      state.laserTier = 5;
      const m1 = createMagma();
      state.keysPressed.k = true;
      T.steps(14);
      state.keysPressed.k = false;
      const tier1 = {
        there: arrays.asteroids.includes(m1),
        indestructible: m1.isIndestructible,
        x: state.x,
        y: state.y,
      };

      // Raketen-Stufe 5: knacken und durchschneiden
      T.empty();
      state.missileTier = 5;
      const m5 = createMagma();
      state.keysPressed.k = true;
      T.steps(8);
      state.keysPressed.k = false;
      return {
        tier1,
        tier5: {
          there: arrays.asteroids.includes(m5),
          indestructible: m5.isIndestructible,
          carriesPowerup: m5.carriesPowerup,
          y: state.y,
        },
      };
    });
    expect(r.tier1.there).toBe(true);
    expect(r.tier1.indestructible).toBe(true);
    // Seitlich neben dem Magma gelandet (halbe Breite Abstand zur Kante)
    expect(r.tier1.x <= 185 - 15 - 30 + 0.01 || r.tier1.x >= 185 + 30 + 15 - 0.01).toBe(true);
    expect(r.tier1.y).toBeGreaterThan(330);
    expect(r.tier5.indestructible).toBe(false);
    expect(r.tier5.carriesPowerup).toBe(true);
    expect(r.tier5.there).toBe(false);
    expect(r.tier5.y).toBeCloseTo(250, 5);
  });

  test('Coop: Spieler 2 dasht mit Ö, eigener Cooldown', async ({ page }) => {
    await startGleve(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      state.p2.x = 400;
      state.p2.y = 400;
      state.keysPressed['ö'] = true;
      state.keysPressed.arrowleft = true;
      T.steps(8);
      state.keysPressed['ö'] = false;
      state.keysPressed.arrowleft = false;
      return {
        x: state.p2.x,
        y: state.p2.y,
        energy: state.p2.energy,
        cdP2: state.p2.missileCooldown,
        cdP1: state.missileCooldown,
        p1y: state.y,
        barP2: parseFloat(document.getElementById('raketen-cd-balken-p2').style.width),
      };
    });
    expect(r.x).toBeCloseTo(300, 5);
    expect(r.y).toBeCloseTo(400, 5);
    expect(r.energy).toBe(42); // nur der Combo-Sweep kostet Energie
    expect(r.cdP2).toBe(172);
    expect(r.cdP1).toBe(0);
    expect(r.p1y).toBeCloseTo(400, 5);
    expect(r.barP2).toBeCloseTo(100 - (172 / 180) * 100, 3);
  });
});

test('Gleve-MR Dash-Combo: am Ende eines regulären Dashs folgt sofort ein Sweep (normale Kosten), ohne Energie nicht', async ({
  page,
}) => {
  await startGleve(page);
  const r = await page.evaluate(() => {
    const { state, arrays, Entities } = window.__game;
    const T = window.__gleveTest;
    // Dash nach oben (Stufe 1: 100 px, 8 Schritte) endet bei y 300; der Feind liegt danach in Sweep-, aber nicht in Dash-Reichweite
    const dashOnEnemy = energy => {
      T.empty();
      state.energy = energy;
      Entities.createEnemy(185, 230, 'normal', 0, false);
      const enemy = arrays.enemies[0];
      Object.assign(enemy, { vy: 0, shotTimer: 9999, carriesPowerup: false });
      state.keysPressed.k = true;
      T.steps(8);
      state.keysPressed.k = false;
      const afterDash = { y: state.y, sweep: state.gleveSweepTimer, energy: state.energy };
      T.steps(10);
      return { afterDash, enemyThere: arrays.enemies.includes(enemy) };
    };
    return { full: dashOnEnemy(50), empty: dashOnEnemy(5) };
  });
  expect(r.full.afterDash.y).toBeCloseTo(300, 5);
  expect(r.full.afterDash.sweep).toBeGreaterThan(0);
  expect(r.full.afterDash.energy).toBe(42);
  expect(r.full.enemyThere).toBe(false);
  // Zu wenig Energie fuer einen Sweep: kein Combo-Sweep, der Feind bleibt
  expect(r.empty.afterDash.sweep).toBe(0);
  expect(r.empty.enemyThere).toBe(true);
});

test.describe('Gleve-MR Dash-Ladungen', () => {
  test('Start mit 2 Ladungen: zwei Dashs direkt hintereinander, der dritte nicht; Nachladen je dashCooldown Schritte', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Gleve = await import('./js/gleve.js');
      const T = window.__gleveTest;
      // Ein Dash pro Druck: Taste druecken, Dash-Dauer abwarten, loslassen (11 Schritte)
      const dash = () => {
        state.keysPressed.k = true;
        T.steps(10);
        state.keysPressed.k = false;
        T.steps(1);
      };
      const dashCd = Gleve.dashCooldown(state);
      T.empty();
      const start = { charges: state.gleveDashCharges, max: Gleve.dashMaxCharges(state), cd: state.missileCooldown };
      state.y = 500;
      dash();
      const afterOne = { charges: state.gleveDashCharges, y: state.y };
      dash();
      const afterTwo = { charges: state.gleveDashCharges, y: state.y };
      dash();
      const afterThree = { charges: state.gleveDashCharges, y: state.y };
      // Das Nachladen laeuft seit dem ersten Dash (33 Schritte vergangen)
      T.steps(dashCd - 33 - 1);
      const beforeOne = state.gleveDashCharges;
      T.steps(1);
      const afterOneLoaded = state.gleveDashCharges;
      T.steps(dashCd - 1);
      const beforeFull = state.gleveDashCharges;
      T.steps(1);
      const full = { charges: state.gleveDashCharges, cd: state.missileCooldown };
      T.steps(dashCd * 2);
      const permanent = state.gleveDashCharges;
      return { start, afterOne, afterTwo, afterThree, beforeOne, afterOneLoaded, beforeFull, full, permanent };
    });
    expect(r.start).toEqual({ charges: 2, max: 2, cd: 0 });
    expect(r.afterOne.charges).toBe(1);
    expect(r.afterOne.y).toBeLessThan(500);
    expect(r.afterTwo.charges).toBe(0);
    expect(r.afterTwo.y).toBeLessThan(r.afterOne.y);
    expect(r.afterThree).toEqual(r.afterTwo);
    expect(r.beforeOne).toBe(0);
    expect(r.afterOneLoaded).toBe(1);
    expect(r.beforeFull).toBe(1);
    expect(r.full).toEqual({ charges: 2, cd: 0 });
    expect(r.permanent).toBe(2);
  });

  test('HUD: DASH-Balken zeigt das Nachladen, Punkte zeigen die Ladungen (2, Stufe 4: 3), Viper ohne Punkte', async ({
    page,
  }) => {
    await startGleve(page);
    const points = (sfx = '') =>
      page.evaluate(id => {
        const el = document.getElementById(id);
        return {
          total: el.querySelectorAll('.dash-ladung').length,
          full: el.querySelectorAll('.dash-ladung.voll').length,
          visible: getComputedStyle(el).display !== 'none',
        };
      }, 'dash-ladungen' + sfx);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Gleve = await import('./js/gleve.js');
      const T = window.__gleveTest;
      const bar = () => document.getElementById('raketen-cd-balken');
      const read = () => ({ pct: parseFloat(bar().style.width), color: bar().style.backgroundColor });
      T.empty();
      T.steps(1);
      const start = read();
      state.y = 500;
      state.keysPressed.k = true;
      T.steps(10);
      state.keysPressed.k = false;
      T.steps(1);
      const afterDash = { ...read(), charges: state.gleveDashCharges };
      return { start, afterDash, max: Gleve.dashMaxCharges(state) };
    });
    expect(r.start).toEqual({ pct: 100, color: 'rgb(46, 204, 113)' });
    expect(r.afterDash.charges).toBe(1);
    expect(r.afterDash.pct).toBeLessThan(100);
    expect(r.afterDash.color).not.toBe('rgb(46, 204, 113)');
    expect(await points()).toEqual({ total: r.max, full: 1, visible: true });

    // Voll geladen: alle Punkte gefuellt
    await page.evaluate(() => {
      window.__gleveTest.empty();
      window.__gleveTest.steps(1);
    });
    expect(await points()).toEqual({ total: 2, full: 2, visible: true });

    // Stufe 4: drei Punkte, der dritte fehlt bis zum Nachladen
    await page.evaluate(() => {
      const { state } = window.__game;
      state.missileTier = 4;
      window.__gleveTest.steps(1);
    });
    expect(await points()).toEqual({ total: 3, full: 2, visible: true });

    // Viper: keine Punkte
    await page.evaluate(() => {
      const { state, Utils } = window.__game;
      state.selectedShipModel = 'viper';
      Utils.updateShipHudLabels();
      window.__gleveTest.steps(1);
    });
    expect(await points()).toEqual({ total: 0, full: 0, visible: false });
  });

  test('Max-Ladungen nach Raketen-Stufe: 1-3 -> 2, 4-5 -> 3; Upgrade lädt von selbst nach, Ladungen nie über Max', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Gleve = await import('./js/gleve.js');
      const T = window.__gleveTest;
      T.empty();
      const max = [1, 2, 3, 4, 5].map(s => {
        state.missileTier = s;
        return Gleve.dashMaxCharges(state);
      });
      // Upgrade auf Stufe 4: 2 von 3 Ladungen, Nachladen startet und fuellt auf 3
      state.missileTier = 4;
      T.steps(1);
      const afterUpgrade = { charges: state.gleveDashCharges, cd: state.missileCooldown };
      T.steps(Gleve.dashCooldown(state));
      const charged = { charges: state.gleveDashCharges, cd: state.missileCooldown };
      T.steps(Gleve.dashCooldown(state) * 3);
      const neverOverMax = state.gleveDashCharges;
      // Zu viele Ladungen werden geklemmt
      state.gleveDashCharges = 9;
      T.steps(1);
      const clamped = state.gleveDashCharges;
      return { max, afterUpgrade, charged, neverOverMax, clamped };
    });
    expect(r.max).toEqual([2, 2, 2, 3, 3]);
    expect(r.afterUpgrade.charges).toBe(2);
    expect(r.afterUpgrade.cd).toBeGreaterThan(100);
    expect(r.charged).toEqual({ charges: 3, cd: 0 });
    expect(r.neverOverMax).toBe(3);
    expect(r.clamped).toBe(3);
  });

  test('Kill-Kette verkürzt das Nachladen; erreicht es 0, kommt die Ladung sofort und es wird weitergeladen', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Eine Ladung ist bereits unterwegs (40 Frames Rest): der Dash-Kill (-30) verkuerzt, zweiter Kill beendet es
      state.gleveDashCharges = 1;
      state.missileCooldown = 40;
      Entities.createEnemy(185, 350, 'normal', 0, false);
      Entities.createEnemy(185, 315, 'normal', 0, false);
      arrays.enemies.forEach(f => {
        f.shotTimer = 9999;
        f.carriesPowerup = false;
      });
      state.keysPressed.k = true;
      T.steps(8);
      state.keysPressed.k = false;
      return { enemies: arrays.enemies.length, charges: state.gleveDashCharges, cd: state.missileCooldown };
    });
    expect(r.enemies).toBe(0);
    // Dash 1 -> 0 Ladungen; Kill 1: 40 -> 10; Kill 2: Nachladen fertig, +1 Ladung, neues Nachladen (180), davon bis Schrittende abgezogen
    expect(r.charges).toBe(1);
    expect(r.cd).toBeGreaterThan(100);
    expect(r.cd).toBeLessThan(180);
  });
});

test.describe('Gleve-MR Laser-Sweep (Laser-Taste)', () => {
  test('Klingenwelle: ein Sweep sendet genau eine Welle, die Ziele jenseits der Reichweite einmal mit halbem Schaden trifft; Magma heil, Welle verschwindet, Neustart raeumt auf', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities, Utils } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Ursprung (200, 405), Laenge 100: Spitze bei y = 305; Welle 70 px breit (x 165-235), startet bei y = 298
      const enemy = (x, y) => {
        Entities.createEnemy(x, y, 'normal', 0, false);
        const f = arrays.enemies[arrays.enemies.length - 1];
        Object.assign(f, { vy: 0, shotTimer: 9999, carriesPowerup: false });
        return f;
      };
      const top = enemy(185, 220); // ca. 60 px ueber der Sweep-Reichweite
      const lateral = enemy(330, 220);
      Entities.createAsteroid(185, 230, 30, 0, 0, 0, true);
      const magma = arrays.asteroids[arrays.asteroids.length - 1];
      Object.assign(magma, { isIndestructible: true, isMagma: true, carriesPowerup: false, vRot: 0 });
      const hp0 = [top.hp, lateral.hp, magma.hp];
      const out = {};
      state.keysPressed.l = true;
      T.steps(10);
      state.keysPressed.l = false;
      out.waves = arrays.gleveWaves.length;
      out.dom = document.querySelectorAll('.gleve-welle').length;
      out.width = arrays.gleveWaves[0] && arrays.gleveWaves[0].width;
      out.owner = arrays.gleveWaves[0] && arrays.gleveWaves[0].owner;
      T.steps(12);
      out.afterFlight = [hp0[0] - top.hp, hp0[1] - lateral.hp, hp0[2] - magma.hp];
      T.steps(8);
      out.endWaves = arrays.gleveWaves.length;
      out.endDom = document.querySelectorAll('.gleve-welle').length;
      out.endDamage = hp0[0] - top.hp;
      out.magmaThere = arrays.asteroids.includes(magma);
      // Neustart entfernt Wellen
      state.keysPressed.l = true;
      T.steps(10);
      state.keysPressed.l = false;
      out.beforeRestart = arrays.gleveWaves.length;
      Utils.restartGame();
      out.afterRestart = [arrays.gleveWaves.length, document.querySelectorAll('.gleve-welle').length];
      return out;
    });
    expect(r.waves).toBe(1);
    expect(r.dom).toBe(1);
    expect(r.owner).toBe('p1');
    expect(r.width).toBeGreaterThanOrEqual(50);
    // Feind oben: genau einmal halber Sweep-Schaden (15); seitlich und Magma nichts
    expect(r.afterFlight).toEqual([15, 0, 0]);
    expect(r.endDamage).toBe(15);
    expect(r.magmaThere).toBe(true);
    expect(r.endWaves).toBe(0);
    expect(r.endDom).toBe(0);
    expect(r.beforeRestart).toBe(1);
    expect(r.afterRestart).toEqual([0, 0]);
  });

  test('Sweep trifft Ziele im Bogen genau einmal, nicht seitlich, dahinter oder zu weit weg; Magma bleibt heil', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Ursprung des Strahls: (200, 405), Stufe 1: 90-Grad-Bogen, Länge 100, Schaden 30
      const asteroid = (x, y, g = 30) => {
        Entities.createAsteroid(x, y, g, 0, 0, 0, true);
        const a = arrays.asteroids[arrays.asteroids.length - 1];
        a.vRot = 0;
        return a;
      };
      // Feind mit Schild direkt voraus: Schild fängt den Schaden ab
      Entities.createEnemy(185, 340, 'normal', 0, true);
      const enemy = arrays.enemies[0];
      Object.assign(enemy, { vy: 0, shotTimer: 9999 });
      const inArc = asteroid(167, 322); // ca. -15 Grad, 70 px
      const lateral = asteroid(240, 390); // 90 Grad
      const behind = asteroid(185, 440);
      const tooFar = asteroid(185, 265); // naechster Punkt 110 px entfernt
      Entities.createAsteroid(250, 330, 30, 0, 0, 0, true);
      const magma = arrays.asteroids[arrays.asteroids.length - 1];
      Object.assign(magma, { x: 205, y: 340, isIndestructible: true, isMagma: true, carriesPowerup: false, vRot: 0 });
      magma.el.classList.add('unzerstoerbar');
      const hpBeforehand = [inArc, lateral, behind, tooFar, magma].map(a => a.hp);

      state.keysPressed.l = true;
      T.steps(5);
      const blade = document.querySelector('.gleve-klinge');
      const bladeDuring = blade
        ? { transform: blade.style.transform, origin: getComputedStyle(blade).transformOrigin }
        : null;
      T.steps(5);
      state.keysPressed.l = false;
      const afterSweep = {
        blade: document.querySelectorAll('.gleve-klinge').length,
        fan: document.querySelectorAll('.gleve-faecher').length,
        energy: state.energy,
      };
      // Weitere Schritte ohne Taste: kein zweiter Sweep, kein zweiter Schaden
      T.steps(20);
      return {
        enemy: { there: arrays.enemies.includes(enemy), shield: enemy.shieldHp, hp: enemy.hp },
        hp: [inArc, lateral, behind, tooFar, magma].map((a, i) => hpBeforehand[i] - a.hp),
        magma: { there: arrays.asteroids.includes(magma), indestructible: magma.isIndestructible },
        bladeDuring,
        afterSweep,
        timer: state.gleveSweepTimer,
        sounds: window.__game.Audio.audioHistory.filter(a => a.name === 'sweep').length,
      };
    });
    expect(r.enemy.there).toBe(true);
    expect(r.enemy.shield).toBe(0);
    expect(r.enemy.hp).toBe(20);
    // im Bogen: genau einmal 30 Schaden; seitlich, dahinter, Magma: nichts;
    // zu weit fuer den Sweep: nur die Klingenwelle trifft (halber Schaden, einmal)
    expect(r.hp).toEqual([30, 0, 0, 15, 0]);
    expect(r.magma.there).toBe(true);
    expect(r.magma.indestructible).toBe(true);
    // Klinge rotiert um den Schiffsbug (nach 5 von 10 Frames senkrecht)
    expect(r.bladeDuring).not.toBeNull();
    expect(r.bladeDuring.transform).toBe('rotate(0deg)');
    expect(r.bladeDuring.origin).toMatch(/ 100px$/);
    expect(r.afterSweep.blade).toBe(0);
    expect(r.afterSweep.fan).toBe(1);
    // 8 Energie pro Sweep, beim Halten keine Regeneration
    expect(r.afterSweep.energy).toBe(42);
    expect(r.timer).toBe(0);
    expect(r.sounds).toBe(1);
  });

  test('Bogen nach Laser-Stufe: Stufe 1 (90 Grad) trifft bei 40, nicht bei 60 Grad; Stufe 5 (150 Grad) trifft bei 70 Grad', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      // Kleines Ziel (10 px) mit Mitte 70 px vom Strahlursprung (200, 405) unter dem Winkel (Grad, 0 = oben)
      const target = angle => {
        const rad = (angle * Math.PI) / 180;
        Entities.createAsteroid(200 + Math.sin(rad) * 70 - 5, 405 - Math.cos(rad) * 70 - 5, 10, 0, 0, 0, true);
        const a = arrays.asteroids[arrays.asteroids.length - 1];
        a.vRot = 0;
        a.carriesPowerup = false;
        return { a, hp: a.hp };
      };
      const damage = z => z.hp - z.a.hp;
      const sweep = () => {
        state.keysPressed.l = true;
        T.steps(10);
        state.keysPressed.l = false;
        T.steps(1);
      };

      T.empty();
      const tier1 = [target(40), target(-40), target(60), target(-60)];
      sweep();

      T.empty();
      state.laserTier = 5;
      const tier5 = [target(70), target(-70), target(85)];
      sweep();
      return { tier1: tier1.map(damage), tier5: tier5.map(damage) };
    });
    expect(r.tier1).toEqual([30, 30, 0, 0]);
    expect(r.tier5).toEqual([50, 50, 0]);
  });

  test('Gehalten pendelt der Sweep im Takt, verbraucht Energie ohne Regeneration; Takt nach Stufe, Energie-Grenze, Superwaffe, waffenOffline', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(async () => {
      const { state, arrays, Audio } = window.__game;
      const Hack = await import('./js/hack.js');
      const T = window.__gleveTest;
      const color = () => document.getElementById('energie-balken').style.backgroundColor;
      const z = () => ({
        direction: state.gleveSweepDirection,
        angle: state.gleveSweepAngle,
        timer: state.gleveSweepTimer,
        energy: state.energy,
      });

      // Stufe 1: Takt 20, 8 Energie pro Sweep
      T.empty();
      Audio.clearAudioHistory();
      state.keysPressed.l = true;
      T.steps(1);
      const first = z();
      T.steps(19);
      const beforeSecond = z();
      T.steps(1);
      const secondary = z();
      T.steps(20);
      const third = z();
      const colorFull = color();
      state.keysPressed.l = false;
      T.steps(9);
      const released = z(); // letzter Sweep laeuft noch: keine Regeneration
      T.steps(10);
      const loaded = state.energy;
      const sounds = Audio.audioHistory.filter(a => a.name === 'sweep').length;

      // Stufe 5: Takt 16, 6 Energie, 150-Grad-Bogen
      T.empty();
      state.laserTier = 5;
      state.keysPressed.l = true;
      T.steps(1);
      const s5erster = z();
      T.steps(15);
      const s5vor = z();
      T.steps(1);
      const s5zweiter = z();
      state.keysPressed.l = false;
      T.steps(1);

      // Zu wenig Energie: kein Sweep, gehalten auch keine Regeneration, Balken orange
      T.empty();
      state.energy = 7;
      state.keysPressed.l = true;
      T.steps(5);
      const withoutEnergy = { ...z(), color: color() };
      state.keysPressed.l = false;
      T.steps(1);

      // Superwaffe: Sweep ohne Kosten
      T.empty();
      state.unlimitedEnergy = true;
      state.energy = 0;
      state.keysPressed.l = true;
      T.steps(1);
      const superweapon = z();
      state.keysPressed.l = false;
      T.steps(1);

      // waffenOffline blockiert den Sweep
      T.empty();
      Hack.hackPlayer(state, 'weaponOffline');
      state.keysPressed.l = true;
      T.steps(5);
      const hacked = z();
      state.keysPressed.l = false;
      state.hacks = [];

      return {
        first,
        beforeSecond,
        secondary,
        third,
        colorFull,
        released,
        loaded,
        sounds,
        s5erster,
        s5vor,
        s5zweiter,
        withoutEnergy,
        superweapon,
        hacked,
        lasers: arrays.laserArray.length,
        missiles: arrays.missileArray.length,
      };
    });
    // Erster Sweep links -> rechts: Start bei -45 Grad, 9 Grad pro Schritt
    expect(r.first).toEqual({ direction: 1, angle: -36, timer: 9, energy: 42 });
    expect(r.beforeSecond).toEqual({ direction: 1, angle: 45, timer: 0, energy: 42 });
    // Zweiter Sweep nach 20 Frames rechts -> links
    expect(r.secondary).toEqual({ direction: -1, angle: 36, timer: 9, energy: 34 });
    expect(r.third.direction).toBe(1);
    expect(r.third.energy).toBe(26);
    expect(r.colorFull).toBe('rgb(26, 188, 156)');
    expect(r.released.timer).toBe(0);
    expect(r.released.energy).toBe(26);
    // Danach 0,4 pro Schritt
    expect(r.loaded).toBeCloseTo(30, 5);
    expect(r.sounds).toBe(3);
    expect(r.s5erster).toEqual({ direction: 1, angle: -60, timer: 9, energy: 44 });
    expect(r.s5vor.direction).toBe(1);
    expect(r.s5zweiter.direction).toBe(-1);
    expect(r.s5zweiter.energy).toBe(38);
    expect(r.withoutEnergy).toEqual({
      direction: 0,
      angle: expect.any(Number),
      timer: 0,
      energy: 7,
      color: 'rgb(230, 126, 34)',
    });
    expect(r.superweapon.timer).toBe(9);
    expect(r.superweapon.energy).toBe(0);
    expect(r.hacked.timer).toBe(0);
    expect(r.hacked.energy).toBe(50);
    expect(r.lasers).toBe(0);
    expect(r.missiles).toBe(0);
  });

  test('Parade Laser-Stufe 1: Feindlaser wird seitlich weggeschleudert, ist harmlos und verlässt das Feld', async ({
    page,
  }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      // Feindlaser fliegt von oben auf das Schiff zu (leicht rechts der Mitte)
      Entities.createEnemyLaser(201, 320);
      const fl = arrays.enemyLaserArray[0];
      // Hack-Projektil links davon, ohne Zielsuche
      Entities.createHackProjectile(186, 330, 186, 600);
      const hp = arrays.hackProjectileArray[0];
      hp.steerTime = 0;
      hp.vx = 0;
      hp.vy = 3;
      state.keysPressed.l = true;
      T.steps(10);
      state.keysPressed.l = false;
      const parried = {
        harmless: fl.harmless,
        vx: fl.vx,
        color: fl.el.style.backgroundColor,
        hackHarmless: hp.harmless,
        hackVx: hp.vx,
        hackSteerTime: hp.steerTime,
      };
      // Schiff direkt in die Flugbahn stellen: kein Treffer
      state.x = fl.x + fl.vx - 10;
      state.y = fl.y + fl.vy - 10;
      T.steps(1);
      const inGone = { lives: state.lives, laserThere: arrays.enemyLaserArray.includes(fl), hacks: state.hacks.length };
      state.x = 185;
      state.y = 400;
      T.steps(60);
      return {
        parried,
        inGone,
        laserRest: arrays.enemyLaserArray.length,
        hackRest: arrays.hackProjectileArray.length,
        lives: state.lives,
        hacks: state.hacks.length,
        playerLaser: arrays.laserArray.length,
      };
    });
    expect(r.parried.harmless).toBe(true);
    expect(r.parried.vx).toBeGreaterThan(0);
    expect(r.parried.color).toBe('rgb(230, 126, 34)');
    expect(r.parried.hackHarmless).toBe(true);
    expect(r.parried.hackVx).toBeLessThan(0);
    expect(r.parried.hackSteerTime).toBe(0);
    expect(r.inGone.lives).toBe(3);
    expect(r.inGone.laserThere).toBe(true);
    expect(r.inGone.hacks).toBe(0);
    expect(r.laserRest).toBe(0);
    expect(r.hackRest).toBe(0);
    expect(r.lives).toBe(3);
    expect(r.hacks).toBe(0);
    // Stufe 1 wirft nichts zurück
    expect(r.playerLaser).toBe(0);
  });

  test('Parade Laser-Stufe 5: Boss-Laser wird zurückgeworfen und trifft; Stufe 3 mit 50 % Chance', async ({ page }) => {
    await startGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      state.laserTier = 5;
      // Ziel weit oberhalb der Sweep-Länge (140 px) und der Klingenwelle (+120 px), direkt über dem Schiff
      Entities.createAsteroid(185, 100, 30, 0, 0, 0, true);
      const target = arrays.asteroids[0];
      target.vRot = 0;
      const hpBeforehand = target.hp;
      Entities.createBossLaser(196, 320, 0, 6);
      const bl = arrays.bossLaserArray[0];
      state.keysPressed.l = true;
      T.steps(10);
      state.keysPressed.l = false;
      const l = arrays.laserArray[0];
      const back = {
        bossLaser: arrays.bossLaserArray.length,
        playerLaser: arrays.laserArray.length,
        owner: l && l.owner,
        damage: l && l.damage,
        vy: l && l.vy,
        vx: l && l.vx,
        color: l && l.el.style.backgroundColor,
        // Der Boss-Laser verschwindet, an seiner Stelle entsteht ein zurueckgeworfener Spielerlaser
        reflectedEl: l && l.el.classList.contains('gleve-reflektiert') && !bl.el.isConnected,
      };
      T.steps(30);
      const result = { damage: hpBeforehand - target.hp, playerLaser: arrays.laserArray.length, lives: state.lives };

      // Stufe 3: Zufall entscheidet (Math.random gestubbt)
      const original = Math.random;
      const parry = random => {
        T.empty();
        state.laserTier = 3;
        Entities.createEnemyLaser(201, 320);
        const fl = arrays.enemyLaserArray[0];
        Math.random = () => random;
        try {
          state.keysPressed.l = true;
          T.steps(10);
          state.keysPressed.l = false;
        } finally {
          Math.random = original;
        }
        return {
          enemyLaser: arrays.enemyLaserArray.length,
          harmless: !!fl.harmless,
          playerLaser: arrays.laserArray.length,
        };
      };
      return { back, result, tier3Back: parry(0.1), tier3Gone: parry(0.9) };
    });
    expect(r.back.bossLaser).toBe(0);
    expect(r.back.playerLaser).toBe(1);
    expect(r.back.owner).toBe('p1');
    expect(r.back.damage).toBe(15);
    expect(r.back.vy).toBe(10);
    expect(r.back.vx).toBe(0);
    expect(r.back.color).toBe('rgb(230, 126, 34)');
    expect(r.back.reflectedEl).toBe(true);
    expect(r.result.damage).toBe(15);
    expect(r.result.playerLaser).toBe(0);
    expect(r.result.lives).toBe(3);
    expect(r.tier3Back).toEqual({ enemyLaser: 0, harmless: false, playerLaser: 1 });
    expect(r.tier3Gone).toEqual({ enemyLaser: 1, harmless: true, playerLaser: 0 });
  });

  test('Coop: Spieler 2 sweept mit Ä und eigener Energie', async ({ page }) => {
    await startGleve(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      state.p2.x = 400;
      state.p2.y = 400;
      Entities.createAsteroid(400, 330, 30, 0, 0, 0, true);
      const a = arrays.asteroids[0];
      a.vRot = 0;
      const hpBeforehand = a.hp;
      state.keysPressed['ä'] = true;
      T.steps(10);
      state.keysPressed['ä'] = false;
      return {
        damage: hpBeforehand - a.hp,
        energyP2: state.p2.energy,
        energyP1: state.energy,
        cdP2: state.p2.missileCooldown,
        directionP1: state.gleveSweepDirection,
      };
    });
    expect(r.damage).toBe(30);
    expect(r.energyP2).toBe(42);
    expect(r.energyP1).toBe(50);
    expect(r.cdP2).toBe(0);
    expect(r.directionP1).toBe(0);
  });
});

test('Gleve-MR: Sweep-Kill an einem Feindschiff gibt Energie zurück, an Asteroiden nicht', async ({ page }) => {
  await startGleve(page);
  const r = await page.evaluate(() => {
    const { state, arrays, Entities, shipModels } = window.__game;
    const T = window.__gleveTest;
    // Ein Sweep (Stufe 1: 30 Schaden, 8 Energie) auf ein Ziel direkt voraus; Energie messen, solange der Sweep noch laeuft
    const sweepOn = create => {
      T.empty();
      const target = create();
      state.keysPressed.l = true;
      T.steps(10);
      const energy = state.energy;
      state.keysPressed.l = false;
      return { energy, destroyed: !arrays.enemies.includes(target) && !arrays.asteroids.includes(target) };
    };
    const enemy = sweepOn(() => {
      Entities.createEnemy(185, 340, 'normal', 0, false);
      const f = arrays.enemies[0];
      Object.assign(f, { vy: 0, shotTimer: 9999, carriesPowerup: false });
      return f;
    });
    const asteroid = sweepOn(() => {
      Entities.createAsteroid(185, 340, 20, 0, 0, 0, true);
      const a = arrays.asteroids[0];
      a.carriesPowerup = false;
      return a;
    });
    return { enemy, asteroid, bonus: shipModels.gleve.sweepKillEnergy, start: 50 };
  });
  expect(r.bonus).toBeGreaterThan(0);
  expect(r.enemy.destroyed).toBe(true);
  expect(r.asteroid.destroyed).toBe(true);
  // Beide Sweeps kosten gleich viel; nur der Feind-Kill gibt den Bonus zurueck
  expect(r.enemy.energy - r.asteroid.energy).toBeCloseTo(r.bonus, 5);
  expect(r.asteroid.energy).toBeLessThan(r.start);
});

test.describe('Gleve-MR Bot und Online-Host', () => {
  // Bot (schwer: entscheidet jeden Schritt) fliegt die Gleve als Spieler 2
  async function startBot(page) {
    await startGleve(page, { coop: true });
    await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      window.__gleveTest.botEmpty = () => {
        const { state } = window.__game;
        window.__gleveTest.empty();
        state.p2IsBot = true;
        state.p2BotDifficulty = 'hard';
        Bot.resetBot();
        state.p2.x = 400;
        state.p2.y = 400;
        state.p2.botFireLaser = false;
        state.p2.botFireMissile = false;
        state.p2.botDashDirection = null;
        window.__game.Audio.clearAudioHistory();
      };
    });
  }

  test('Bot dasht gezielt auf einen nahen Feind, aber nicht ohne Ziel, ohne Ladung oder in einen Boss', async ({
    page,
  }) => {
    await startBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities, Audio } = window.__game;
      const T = window.__gleveTest;
      const dashes = () => Audio.audioHistory.filter(a => a.name === 'dash').length;
      const enemy = (x, y) => {
        Entities.createEnemy(x, y, 'normal', 0, false);
        const f = arrays.enemies[arrays.enemies.length - 1];
        f.shotTimer = 9999;
        f.carriesPowerup = false;
        return f;
      };
      const out = {};

      // Leeres Feld: kein Dash
      T.botEmpty();
      T.steps(60);
      out.empty = dashes();

      // Feind schraeg rechts oben in Reichweite (ohne Energie fuer den Sweep, damit nur der Dash trifft)
      T.botEmpty();
      state.p2.energy = 0;
      enemy(440, 330);
      T.steps(12);
      out.near = {
        dashes: dashes(),
        enemies: arrays.enemies.length,
        cd: state.p2.missileCooldown,
        x: state.p2.x,
        y: state.p2.y,
        pressure: state.p2.botFireMissile,
      };
      // Danach kein weiterer Dash ohne Ziel
      T.steps(60);
      out.nearThereafter = dashes();

      // Keine Dash-Ladung: kein Dash
      T.botEmpty();
      state.p2.energy = 0;
      state.p2.gleveDashCharges = 0;
      state.p2.missileCooldown = 999;
      enemy(440, 330);
      T.steps(12);
      out.withoutCharge = { dashes: dashes(), enemies: arrays.enemies.length };

      // Feind hinter einem Boss: kein Dash in den Boss
      T.botEmpty();
      state.p2.energy = 0;
      Entities.createBoss();
      const b = arrays.bosses[0];
      Object.assign(b, {
        phase: 'kampf',
        x: 360,
        y: 280,
        vx: 0,
        shotTimer: 9999,
        bombTimer: 9999,
        missileTimer: 9999,
      });
      state.p2.y = 420;
      enemy(400, 330);
      T.steps(4);
      out.boss = { dashes: dashes(), bossHp: b.hp, maxHp: b.maxHp };
      return out;
    });
    expect(r.empty).toBe(0);
    expect(r.near.dashes).toBe(1);
    expect(r.near.enemies).toBe(0);
    expect(r.near.cd).toBeGreaterThan(100);
    expect(r.near.x).toBeGreaterThan(400);
    expect(r.near.y).toBeLessThan(400);
    // Der Dash-Druck ist eine Flanke und bleibt nicht stehen
    expect(r.near.pressure).toBe(false);
    expect(r.nearThereafter).toBe(1);
    expect(r.withoutCharge).toEqual({ dashes: 0, enemies: 1 });
    expect(r.boss.dashes).toBe(0);
    expect(r.boss.bossHp).toBe(r.boss.maxHp);
  });

  test('Bot sweept bei einem Feindlaser vor sich und pariert ihn', async ({ page }) => {
    await startBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities, Audio } = window.__game;
      const T = window.__gleveTest;
      T.botEmpty();
      // Feindlaser seitlich daneben (ausserhalb von Bogen und Laenge): kein Sweep, keine Energie verbraucht
      Entities.createEnemyLaser(300, 330);
      T.steps(3);
      const lateral = { sweeps: Audio.audioHistory.filter(a => a.name === 'sweep').length, energy: state.p2.energy };
      T.botEmpty();
      // Feindlaser direkt vor dem Schiff
      Entities.createEnemyLaser(state.p2.x + 13, 330);
      const fl = arrays.enemyLaserArray[0];
      T.steps(10);
      return {
        lateral,
        sweeps: Audio.audioHistory.filter(a => a.name === 'sweep').length,
        energy: state.p2.energy,
        harmless: !!fl.harmless,
        lives: state.p2.lives,
        dashes: Audio.audioHistory.filter(a => a.name === 'dash').length,
      };
    });
    expect(r.lateral).toEqual({ sweeps: 0, energy: 50 });
    expect(r.sweeps).toBe(1);
    expect(r.energy).toBe(42);
    expect(r.harmless).toBe(true);
    expect(r.lives).toBe(3);
    expect(r.dashes).toBe(0);
  });

  test('Online-Host: Dash des Clients ueber die Raketen-Eingabe mit gemeldeter Richtung, auch bei kurzem Druck; Sweep ueber gehaltene Laser-Eingabe', async ({
    page,
  }) => {
    await startGleve(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, Network, Audio } = window.__game;
      const T = window.__gleveTest;
      T.empty();
      state.gameMode = 'online';
      Object.assign(state.network, { isOnline: true, isHost: true, isClient: false, connected: false });
      state.p2.laserInputRequested = false;
      state.p2.missileHeld = false;
      state.p2.networkDashRequest = false;
      Audio.clearAudioHistory();
      const input = e =>
        Network.applyPlayerInput(
          Object.assign({ x: 300, y: 400, rotate: 0, laser: false, missile: false, bomb: false, rx: 0, ry: 0 }, e),
        );

      // Druck und Loslassen kommen vor demselben Host-Schritt an
      input({ missile: true, rx: 1, ry: 0 });
      input({ missile: false, rx: 1, ry: 0 });
      T.steps(1);
      const first = {
        x: state.p2.x,
        energy: state.p2.energy,
        cd: state.p2.missileCooldown,
        sweep: state.p2.gleveSweepTimer,
      };
      // Position des Clients waehrend des Dashs wird ignoriert
      input({ x: 500, y: 300 });
      T.steps(7);
      const end = { x: state.p2.x, y: state.p2.y };
      // Danach gilt wieder die Client-Position
      input({ x: 410, y: 390 });
      const thereafter = { x: state.p2.x, y: state.p2.y };

      // Gehaltene Laser-Eingabe: pendelnde Sweeps, kein Dash
      input({ x: 410, y: 390, laser: true });
      T.steps(21);
      const sweep = {
        direction: state.p2.gleveSweepDirection,
        energy: state.p2.energy,
        sweeps: Audio.audioHistory.filter(a => a.name === 'sweep').length,
        dashes: Audio.audioHistory.filter(a => a.name === 'dash').length,
      };
      input({ x: 410, y: 390, laser: false });
      Object.assign(state.network, { isOnline: false, isHost: false });
      return { first, end, thereafter, sweep };
    });
    expect(r.first.x).toBeCloseTo(312.5, 5);
    expect(r.first.energy).toBe(50);
    expect(r.first.cd).toBe(179);
    expect(r.first.sweep).toBe(0);
    expect(r.end.x).toBeCloseTo(400, 5);
    expect(r.end.y).toBeCloseTo(400, 5);
    expect(r.thereafter).toEqual({ x: 410, y: 390 });
    expect(r.sweep).toEqual({ direction: -1, energy: 34, sweeps: 2, dashes: 1 });
  });
});

test('Gleve-MR: im Coop für Spieler 2 wählbar, P2-HUD und Highscore-Badge G', async ({ page }) => {
  await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    Utils.setGameMode('coop');
  });
  await page.locator('.hangar-player-tab[data-player="p2"]').click();
  await page.locator('.hangar-model-btn[data-model="gleve"]').click();

  const models = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    return { p1: state.selectedShipModel, p2: state.p2.selectedShipModel };
  });
  expect(models.p1).toBe('viper');
  expect(models.p2).toBe('gleve');
  await expect(page.locator('#energie-cd-container-p2 .cooldown-letter')).toHaveText('SWEEP');
  await expect(page.locator('#raketen-cd-container-p2 .cooldown-letter')).toHaveText('DASH');
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('E');
  const p2Svg = await page.locator('#spieler-2 svg').evaluate(el => el.innerHTML);
  expect(p2Svg).toContain('Gleve-MR');

  // Highscore-Badges: Solo "Gleve-MR", Coop-Mini "G" mit eigener Klasse
  const badges = await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    Utils.renderHighscoresTable('single', [{ name: 'GLV', score: 500, shipP1: 'gleve' }]);
    const solo = document.querySelector('#highscore-body .hs-ship-gleve');
    const soloText = solo ? solo.textContent : null;
    Utils.renderHighscoresTable('coop_bot', [{ name: 'A+B', score: 500, shipP1: 'phantom', shipP2: 'gleve' }]);
    const mini = document.querySelector('#highscore-body .hs-badge-mini.hs-ship-gleve');
    return { soloText, miniText: mini ? mini.textContent : null };
  });
  expect(badges.soloText).toBe('Gleve-MR');
  expect(badges.miniText).toBe('P2:G');
});

test('Gleve-MR: Game Over während Sweep und Dash räumt Klinge und Dash-Darstellung ab', async ({ page }) => {
  await startGleve(page);
  const r = await page.evaluate(() => {
    const { state, Utils } = window.__game;
    const T = window.__gleveTest;
    T.empty();
    state.keysPressed.k = true;
    state.keysPressed.l = true;
    T.steps(3);
    const beforehand = {
      blades: document.querySelectorAll('.gleve-klinge').length,
      dash: document.getElementById('spieler').classList.contains('gleve-dash'),
    };
    Object.keys(state.keysPressed).forEach(k => {
      state.keysPressed[k] = false;
    });
    Utils.triggerGameOver();
    // Nach dem Game Over laeuft die Simulation nicht weiter
    T.steps(5);
    return {
      beforehand,
      blades: document.querySelectorAll('.gleve-klinge').length,
      dash: document.getElementById('spieler').classList.contains('gleve-dash'),
    };
  });
  expect(r.beforehand.blades).toBe(1);
  expect(r.beforehand.dash).toBe(true);
  expect(r.blades).toBe(0);
  expect(r.dash).toBe(false);
});

test.describe('Gleve-MR Mobile-Steuerung', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  test('Joystick sweept bei der Gleve automatisch, Raketen-Button "D" löst genau einen Dash aus, kein eigener Dash-Button', async ({
    page,
  }) => {
    await page.locator('.hangar-model-btn[data-model="gleve"]').click();
    await page.tap('#start-text');
    await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
    await expect(page.locator('#mobile-controls')).toBeVisible();
    await expect(page.locator('#btn-dash')).toHaveCount(0);
    await expect(page.locator('#btn-rakete span')).toHaveText('D');

    const r = await page.evaluate(() => {
      const { state, arrays, Loop } = window.__game;
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
      state.energy = 50;
      state.maxEnergy = 50;
      state.laserTier = 1;
      state.missileTier = 1;
      state.missileCooldown = 0;
      state.gleveDashKeyHeld = false;
      state.gleveSweepCadence = 0;
      state.x = 185;
      state.y = 400;
      const touch = (el, typ) => {
        const t = new Touch({
          identifier: 1,
          target: el,
          clientX: el.getBoundingClientRect().left + 20,
          clientY: el.getBoundingClientRect().top + 20,
        });
        el.dispatchEvent(
          new TouchEvent(typ, {
            touches: typ === 'touchstart' ? [t] : [],
            changedTouches: [t],
            bubbles: true,
            cancelable: true,
          }),
        );
      };
      const zone = document.getElementById('joystick-zone');
      const btn = document.getElementById('btn-rakete');

      // Joystick-Berührung: Auto-Fire, also Sweep (ohne Ausschlag keine Bewegung)
      touch(zone, 'touchstart');
      const laserAfterJoystick = state.keysPressed.l;
      Loop.simulationStep();
      const sweepAfterJoystick = { timer: state.gleveSweepTimer, energy: state.energy, dash: state.gleveDashTimer };
      touch(zone, 'touchend');
      const laserReleased = state.keysPressed.l;

      // Raketen-Button: ein Dash nach oben, solange der kurze Druck anliegt
      touch(btn, 'touchstart');
      const missilePressed = state.keysPressed.k;
      for (let i = 0; i < 20; i++) Loop.simulationStep();
      const yAfterDash = state.y;
      const cd = state.missileCooldown;
      const cdHeight = parseFloat(document.getElementById('btn-rakete-cd').style.height);
      return { laserAfterJoystick, sweepAfterJoystick, laserReleased, missilePressed, yAfterDash, cd, cdHeight };
    });
    expect(r.laserAfterJoystick).toBe(true);
    expect(r.sweepAfterJoystick).toEqual({ timer: 9, energy: 42, dash: 0 });
    expect(r.laserReleased).toBe(false);
    expect(r.missilePressed).toBe(true);
    // Genau ein Dash nach oben (Stufe 1: 100 px), Button-Füllstand = Dash-Cooldown
    expect(r.yAfterDash).toBeCloseTo(300, 5);
    expect(r.cd).toBe(160);
    expect(r.cdHeight).toBeCloseTo(100 - (160 / 180) * 100, 3);

    // Viper: Joystick feuert weiter automatisch, Button heißt wieder R
    const viper = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      state.selectedShipModel = 'viper';
      Utils.updatePlayerShipVisuals();
      const zone = document.getElementById('joystick-zone');
      const t = new Touch({ identifier: 2, target: zone, clientX: 50, clientY: 850 });
      zone.dispatchEvent(
        new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }),
      );
      const anAtContact = state.keysPressed.l;
      zone.dispatchEvent(
        new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }),
      );
      return {
        anAtContact,
        offThereafter: state.keysPressed.l,
        label: document.querySelector('#btn-rakete span').textContent,
      };
    });
    expect(viper).toEqual({ anAtContact: true, offThereafter: false, label: 'R' });
  });

  test('Raketen-Button zeigt die Anzahl der Dash-Ladungen und den Ladefortschritt, nur bei der Gleve', async ({
    page,
  }) => {
    await page.locator('.hangar-model-btn[data-model="gleve"]').click();
    await page.tap('#start-text');
    await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
    const r = await page.evaluate(() => {
      const { state, arrays, Loop, Utils } = window.__game;
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
      state.missileTier = 1;
      state.missileCooldown = 0;
      state.gleveDashCharges = 2;
      state.gleveDashKeyHeld = false;
      state.y = 500;
      const number = document.getElementById('btn-rakete-ladungen');
      const fill = document.getElementById('btn-rakete-cd');
      const read = () => ({
        text: number.textContent,
        visible: getComputedStyle(number).display !== 'none',
        height: parseFloat(fill.style.height),
      });
      Loop.simulationStep();
      const full = read();
      state.keysPressed.k = true;
      for (let i = 0; i < 12; i++) Loop.simulationStep();
      state.keysPressed.k = false;
      Loop.simulationStep();
      const afterDash = read();
      state.selectedShipModel = 'viper';
      Utils.updateShipHudLabels();
      const viper = read();
      return { full, afterDash, viper };
    });
    expect(r.full).toEqual({ text: '2', visible: true, height: 100 });
    expect(r.afterDash.text).toBe('1');
    expect(r.afterDash.height).toBeLessThan(100);
    expect(r.viper).toMatchObject({ text: '', visible: false });
  });

  test('Online-Client: Raketen-Button-Beschriftung folgt dem eigenen Schiff (P2)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      const old = { mode: state.gameMode, isClient: state.network.isClient, p2: state.p2.selectedShipModel };
      const label = () => document.querySelector('#btn-rakete span').textContent;
      state.selectedShipModel = 'viper';
      state.gameMode = 'online';
      state.network.isClient = true;
      state.p2.selectedShipModel = 'gleve';
      Utils.updateShipHudLabels();
      const clientGleve = { model: Utils.localShipModel(), label: label() };
      state.p2.selectedShipModel = 'phantom';
      Utils.updateShipHudLabels();
      const clientPhantom = label();
      state.gameMode = old.mode;
      state.network.isClient = old.isClient;
      state.p2.selectedShipModel = old.p2;
      return { clientGleve, clientPhantom };
    });
    expect(r.clientGleve).toEqual({ model: 'gleve', label: 'D' });
    expect(r.clientPhantom).toBe('R');
  });
});
