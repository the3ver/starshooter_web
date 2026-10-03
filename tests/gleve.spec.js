const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.7.1');
    localStorage.setItem('starshooter_skip_cutscene', 'true');
  });
  await page.goto('/');
});

test('Gleve-MR: im Hangar wählbar, Werte, Manta-SVG, keine Werfer-Pods, HUD ANTRIEB/SWEEP', async ({ page }) => {
  const gleveBtn = page.locator('.hangar-model-btn[data-model="gleve"]');
  await expect(gleveBtn).toBeVisible();
  await gleveBtn.click();
  await expect(gleveBtn).toHaveClass(/active/);
  await expect(page.locator('#hangar-ship-name')).toContainText('GLEVE-MR REAVER');
  await expect(page.locator('#hangar-ship-perks .hangar-perk-badge')).toHaveCount(5);

  const werte = await page.evaluate(async () => {
    const { state, shipModels } = await import('./js/state.js');
    return { model: state.selectedShipModel, gleve: shipModels.gleve };
  });
  expect(werte.model).toBe('gleve');
  expect(werte.gleve).toBeTruthy();
  expect(werte.gleve.speed).toBe(5.0);
  expect(werte.gleve.energyRegen).toBe(0.3);
  expect(werte.gleve.startShield).toBe(0);
  expect(werte.gleve.loseUpgradesOnHit).toBe(false);
  expect(werte.gleve.shieldRegen).toBeFalsy();

  // Spiel starten
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(50);
  await page.keyboard.up('KeyW');
  await expect(page.locator('#spieler')).toBeVisible();

  // Manta-SVG wird gerendert
  const svgHtml = await page.locator('#spieler svg').evaluate(el => el.innerHTML);
  expect(svgHtml).toContain('Gleve-MR');
  expect(await page.locator('#spieler svg path').count()).toBeGreaterThanOrEqual(5);

  // HUD-Beschriftungen
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('ANTRIEB');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('SWEEP');

  // Werfer-Pods auch bei Raketenstufe 5 ausgeblendet, ohne Abwurf-Effekt
  await expect(page.locator('#spieler .werfer-links')).toBeHidden();
  await expect(page.locator('#spieler .werfer-rechts')).toBeHidden();
  await expect(page.locator('#spieler .werfer-center')).toBeHidden();
  const abwurf = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    state.raketenStufe = 5;
    Utils.updateAktivePowerupsUI();
    state.raketenStufe = 1;
    Utils.updateAktivePowerupsUI();
    return document.querySelectorAll('.werfer-abgeworfen').length;
  });
  expect(abwurf).toBe(0);
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
async function starteGleve(page, { coop = false } = {}) {
  if (coop) {
    await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
    await page.locator('.hangar-player-tab[data-player="p2"]').click();
  }
  await page.locator('.hangar-model-btn[data-model="gleve"]').click();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    window.__gleveTest = {
      leeren() {
        const { state, arrays } = window.__game;
        ['feinde', 'asteroiden', 'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bossBombenArray',
          'bossRaketenArray', 'bosses', 'powerups', 'laserArray'].forEach(name => {
          arrays[name].forEach(o => o.el && o.el.remove());
          arrays[name].length = 0;
        });
        Object.keys(state.tastenGedrueckt).forEach(k => { state.tastenGedrueckt[k] = false; });
        state.frameZaehler = 1; // keine Spawns in den naechsten 100 Schritten
        state.level = 1;
        state.bossAktiv = false;
        state.hacks = [];
        for (const s of [state, state.p2]) {
          s.maxEnergie = 50;
          s.energie = 50;
          s.laserStufe = 1;
          s.schildStufe = 0;
          s.leben = 3;
          s.invulnerableTimer = 0;
          s.unbegrenzteEnergie = false;
          s.gleveDashTimer = 0;
          s.gleveAbprallTimer = 0;
          s.gleveUnverwundbar = 0;
          s.gleveDashTasteGehalten = false;
        }
        state.x = 185;
        state.y = 400;
      },
      schritte(n) {
        for (let i = 0; i < n; i++) window.__game.Loop.simulationsSchritt();
      }
    };
  });
}

test.describe('Gleve-MR Dash', () => {
  test('Dash bewegt das Schiff um die Reichweite in Steuerrichtung und kostet Energie', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      // Diagonal rechts oben, Stufe 1: 100 px, 25 Energie
      state.tastenGedrueckt.d = true;
      state.tastenGedrueckt.w = true;
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      const nachStart = { energie: state.energie, timer: state.gleveDashTimer };
      T.schritte(2);
      const klasseWaehrend = document.getElementById('spieler').classList.contains('gleve-dash');
      T.schritte(5);
      const ende = { x: state.x, y: state.y, energie: state.energie };
      const klasseDanach = document.getElementById('spieler').classList.contains('gleve-dash');
      const effekte = document.querySelectorAll('.gleve-nachbild').length;
      Object.keys(state.tastenGedrueckt).forEach(k => { state.tastenGedrueckt[k] = false; });
      return { nachStart, klasseWaehrend, ende, klasseDanach, effekte, dashSounds: window.__game.Audio.audioHistory.filter(a => a.name === 'dash').length };
    });
    expect(r.nachStart.energie).toBeCloseTo(25, 5);
    expect(r.nachStart.timer).toBe(7);
    expect(r.klasseWaehrend).toBe(true);
    expect(r.klasseDanach).toBe(false);
    expect(r.ende.x).toBeCloseTo(185 + 100 / Math.SQRT2, 1);
    expect(r.ende.y).toBeCloseTo(400 - 100 / Math.SQRT2, 1);
    // Im letzten Dash-Frame laedt die Energie wieder (0,3 pro Schritt)
    expect(r.ende.energie).toBeCloseTo(25.3, 5);
    expect(r.effekte).toBeGreaterThan(0);
    expect(r.dashSounds).toBe(1);
  });

  test('Nur ein Dash pro Tastendruck; Hack "waffenOffline" blockiert, Superwaffe kostet nichts, Stufe 5 reicht weiter', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Hack = await import('./js/hack.js');
      const T = window.__gleveTest;
      T.leeren();
      // Taste 30 Schritte gehalten: nur ein Dash nach oben
      state.tastenGedrueckt.l = true;
      T.schritte(30);
      const gehalten = state.y;
      // Loslassen und erneut druecken: zweiter Dash
      state.tastenGedrueckt.l = false;
      T.schritte(1);
      state.tastenGedrueckt.l = true;
      T.schritte(10);
      const zweiter = state.y;
      state.tastenGedrueckt.l = false;
      T.schritte(1);

      // Zu wenig Energie: kein Dash
      state.y = 400;
      state.energie = 20;
      state.tastenGedrueckt.l = true;
      T.schritte(10);
      const ohneEnergie = state.y;
      state.tastenGedrueckt.l = false;
      T.schritte(1);

      // waffenOffline-Hack blockiert den Dash
      state.energie = 50;
      Hack.hackeSpieler(state, 'waffenOffline');
      state.tastenGedrueckt.l = true;
      T.schritte(10);
      const gehackt = state.y;
      state.tastenGedrueckt.l = false;
      state.hacks = [];
      T.schritte(1);

      // Superwaffe (unbegrenzte Energie): Dash ohne Kosten; Stufe 5: 150 px
      state.unbegrenzteEnergie = true;
      state.laserStufe = 5;
      state.energie = 50;
      state.y = 500;
      state.tastenGedrueckt.l = true;
      T.schritte(8);
      const superwaffe = { y: state.y, energie: state.energie };
      state.tastenGedrueckt.l = false;
      return { gehalten, zweiter, ohneEnergie, gehackt, superwaffe, lasers: window.__game.arrays.laserArray.length };
    });
    expect(r.gehalten).toBeCloseTo(300, 5);
    expect(r.zweiter).toBeCloseTo(200, 5);
    expect(r.ohneEnergie).toBeCloseTo(400, 5);
    expect(r.gehackt).toBeCloseTo(400, 5);
    expect(r.superwaffe.y).toBeCloseTo(350, 5);
    expect(r.superwaffe.energie).toBeGreaterThanOrEqual(50);
    // Die Gleve feuert keine Laser-Projektile
    expect(r.lasers).toBe(0);
  });

  test('Normale Feinde auf der Strecke werden zerstört, Kill-Kette gibt +8 Energie pro Kill', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      // Zwei Feinde (einer mit Schild) direkt ueber dem Schiff, kein Schuss
      Entities.erzeugeFeind(185, 350, 'normal', 0, true);
      Entities.erzeugeFeind(185, 315, 'normal', 0, false);
      arrays.feinde.forEach(f => { f.schussTimer = 9999; f.traegtPowerup = false; });
      const scoreVorher = state.score;
      state.tastenGedrueckt.l = true;
      T.schritte(8);
      state.tastenGedrueckt.l = false;
      return { feinde: arrays.feinde.length, energie: state.energie, leben: state.leben, punkte: state.score - scoreVorher, y: state.y };
    });
    expect(r.feinde).toBe(0);
    expect(r.leben).toBe(3);
    expect(r.punkte).toBeGreaterThanOrEqual(200);
    // 50 - 25 (Dash) + 2 * 8 (Kill-Kette) + 0,3 (Regeneration im letzten Frame)
    expect(r.energie).toBeCloseTo(41.3, 5);
    expect(r.y).toBeCloseTo(300, 5);
  });

  test('Boss bekommt Dash-Schaden, Schiff prallt schräg zur Seite ab', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      Entities.erzeugeBoss();
      const b = arrays.bosses[0];
      Object.assign(b, { phase: 'kampf', x: 150, y: 20, vx: 0, schussTimer: 9999, bombenTimer: 9999, raketenTimer: 9999 });
      // Schiff links der Bossmitte, Dash nach oben in den Boss
      state.x = 170;
      state.y = 160;
      state.tastenGedrueckt.l = true;
      T.schritte(5);
      const aufprall = { hp: b.hp, maxHp: b.maxHp, dash: state.gleveDashTimer, abprall: state.gleveAbprallTimer };
      T.schritte(8);
      state.tastenGedrueckt.l = false;
      return { aufprall, x: state.x, y: state.y, bossX: b.x, groesse: b.groesse, unverwundbar: state.gleveUnverwundbar, leben: state.leben, bossDa: arrays.bosses.length };
    });
    expect(r.bossDa).toBe(1);
    expect(r.aufprall.hp).toBe(r.aufprall.maxHp - 60);
    expect(r.aufprall.dash).toBe(0);
    expect(r.aufprall.abprall).toBe(8);
    // Landepunkt: halbe Bossbreite links neben der Bosskante, 30 px tiefer als der Aufprallpunkt (y 110)
    expect(r.x).toBeCloseTo(r.bossX - r.groesse / 2 - 30, 5);
    expect(r.y).toBeCloseTo(140, 5);
    expect(r.leben).toBe(3);
    // Unverwundbarkeit laeuft nach dem Abprall noch 30 Frames
    expect(r.unverwundbar).toBe(31);
  });

  test('Unverwundbar während des Dashs und kurz danach: Feindlaser trifft nicht', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      // Stehende Feindlaser auf der Strecke und am Zielpunkt
      Entities.erzeugeFeindLaser(198, 350);
      Entities.erzeugeFeindLaser(198, 310);
      arrays.feindLaserArray.forEach(fl => { fl.vy = 0; fl.vx = 0; });
      state.tastenGedrueckt.l = true;
      T.schritte(12); // 8 Dash-Frames + 4 Nachlauf
      const waehrend = { leben: state.leben, laser: arrays.feindLaserArray.length, blink: state.invulnerableTimer };
      T.schritte(10); // Nachlauf vorbei: der Laser am Zielpunkt trifft jetzt
      state.tastenGedrueckt.l = false;
      return { waehrend, danach: state.leben, y: state.y };
    });
    expect(r.y).toBeCloseTo(300, 5);
    expect(r.waehrend.leben).toBe(3);
    expect(r.waehrend.laser).toBe(2);
    expect(r.waehrend.blink).toBe(0);
    expect(r.danach).toBe(2);
  });

  test('Magma: unter Stufe 5 Abprall, auf Stufe 5 wird es geknackt und zerstört', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      const erzeugeMagma = () => {
        Entities.erzeugeAsteroid(185, 330, 30, 0, 0, 0, true);
        const m = arrays.asteroiden[arrays.asteroiden.length - 1];
        m.istUnzerstoerbar = true;
        m.istMagma = true;
        m.vRot = 0;
        m.el.classList.add('unzerstoerbar');
        if (m.rissEl) { m.rissEl.remove(); m.rissEl = null; }
        return m;
      };

      // Stufe 1: Abprall, Magma bleibt heil
      T.leeren();
      const m1 = erzeugeMagma();
      state.tastenGedrueckt.l = true;
      T.schritte(14);
      state.tastenGedrueckt.l = false;
      const stufe1 = { da: arrays.asteroiden.includes(m1), unzerstoerbar: m1.istUnzerstoerbar, x: state.x, y: state.y };

      // Stufe 5: knacken und durchschneiden
      T.leeren();
      state.laserStufe = 5;
      const m5 = erzeugeMagma();
      state.tastenGedrueckt.l = true;
      T.schritte(8);
      state.tastenGedrueckt.l = false;
      return {
        stufe1,
        stufe5: { da: arrays.asteroiden.includes(m5), unzerstoerbar: m5.istUnzerstoerbar, traegtPowerup: m5.traegtPowerup, y: state.y }
      };
    });
    expect(r.stufe1.da).toBe(true);
    expect(r.stufe1.unzerstoerbar).toBe(true);
    // Seitlich neben dem Magma gelandet (halbe Breite Abstand zur Kante)
    expect(r.stufe1.x <= 185 - 15 - 30 + 0.01 || r.stufe1.x >= 185 + 30 + 15 - 0.01).toBe(true);
    expect(r.stufe1.y).toBeGreaterThan(330);
    expect(r.stufe5.unzerstoerbar).toBe(false);
    expect(r.stufe5.traegtPowerup).toBe(true);
    expect(r.stufe5.da).toBe(false);
    expect(r.stufe5.y).toBeCloseTo(250, 5);
  });

  test('Coop: Spieler 2 dasht mit Ä', async ({ page }) => {
    await starteGleve(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      state.p2.x = 400;
      state.p2.y = 400;
      state.tastenGedrueckt['ä'] = true;
      state.tastenGedrueckt.arrowleft = true;
      T.schritte(8);
      state.tastenGedrueckt['ä'] = false;
      state.tastenGedrueckt.arrowleft = false;
      return { x: state.p2.x, y: state.p2.y, energie: state.p2.energie, p1y: state.y };
    });
    expect(r.x).toBeCloseTo(300, 5);
    expect(r.y).toBeCloseTo(400, 5);
    expect(r.energie).toBeCloseTo(25.3, 5);
    expect(r.p1y).toBeCloseTo(400, 5);
  });
});

test('Gleve-MR: im Coop für Spieler 2 wählbar, P2-HUD und Highscore-Badge G', async ({ page }) => {
  await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    Utils.setGameMode('coop');
  });
  await page.locator('.hangar-player-tab[data-player="p2"]').click();
  await page.locator('.hangar-model-btn[data-model="gleve"]').click();

  const modelle = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    return { p1: state.selectedShipModel, p2: state.p2.selectedShipModel };
  });
  expect(modelle.p1).toBe('viper');
  expect(modelle.p2).toBe('gleve');
  await expect(page.locator('#energie-cd-container-p2 .cooldown-letter')).toHaveText('ANTRIEB');
  await expect(page.locator('#raketen-cd-container-p2 .cooldown-letter')).toHaveText('SWEEP');
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
