const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.8.0');
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
          'bossRaketenArray', 'bosses', 'powerups', 'laserArray', 'raketenArray'].forEach(name => {
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
          s.raketenStufe = 1;
          s.raketenCooldown = 0;
          s.gleveSweepTimer = 0;
          s.gleveSweepRichtung = 0;
          s.gleveSweepTreffer = [];
        }
        document.querySelectorAll('.gleve-klinge').forEach(el => el.remove());
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

test.describe('Gleve-MR Laser-Sweep', () => {
  test('Sweep trifft Ziele im Bogen genau einmal, nicht seitlich, dahinter oder zu weit weg; Magma bleibt heil', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      // Ursprung des Strahls: (200, 405), Stufe 1: Länge 90, Schaden 25
      const asteroid = (x, y, g = 30) => {
        Entities.erzeugeAsteroid(x, y, g, 0, 0, 0, true);
        const a = arrays.asteroiden[arrays.asteroiden.length - 1];
        a.vRot = 0;
        return a;
      };
      // Feind mit Schild direkt voraus: Schild fängt den Schaden ab
      Entities.erzeugeFeind(185, 340, 'normal', 0, true);
      const feind = arrays.feinde[0];
      Object.assign(feind, { vy: 0, schussTimer: 9999 });
      const imBogen = asteroid(167, 322); // ca. -15 Grad, 70 px
      const seitlich = asteroid(240, 390);
      const schraeg = asteroid(228, 363, 20); // ca. 50 Grad, ausserhalb des 45-Grad-Bogens
      const dahinter = asteroid(185, 440);
      const zuWeit = asteroid(185, 275); // naechster Punkt 100 px entfernt
      Entities.erzeugeAsteroid(250, 330, 30, 0, 0, 0, true);
      const magma = arrays.asteroiden[arrays.asteroiden.length - 1];
      Object.assign(magma, { x: 205, y: 340, istUnzerstoerbar: true, istMagma: true, traegtPowerup: false, vRot: 0 });
      magma.el.classList.add('unzerstoerbar');
      const hpVorher = [imBogen, seitlich, schraeg, dahinter, zuWeit, magma].map(a => a.hp);

      state.tastenGedrueckt.k = true;
      T.schritte(5);
      const klinge = document.querySelector('.gleve-klinge');
      const klingeWaehrend = klinge ? { transform: klinge.style.transform, origin: getComputedStyle(klinge).transformOrigin } : null;
      T.schritte(5);
      state.tastenGedrueckt.k = false;
      const nachSweep = {
        klinge: document.querySelectorAll('.gleve-klinge').length,
        faecher: document.querySelectorAll('.gleve-faecher').length
      };
      // Weitere Schritte: kein zweiter Schaden
      T.schritte(20);
      return {
        feind: { da: arrays.feinde.includes(feind), schild: feind.schildHp, hp: feind.hp },
        hp: [imBogen, seitlich, schraeg, dahinter, zuWeit, magma].map((a, i) => hpVorher[i] - a.hp),
        magma: { da: arrays.asteroiden.includes(magma), unzerstoerbar: magma.istUnzerstoerbar },
        klingeWaehrend,
        nachSweep,
        timer: state.gleveSweepTimer,
        sounds: window.__game.Audio.audioHistory.filter(a => a.name === 'sweep').length
      };
    });
    expect(r.feind.da).toBe(true);
    expect(r.feind.schild).toBe(0);
    expect(r.feind.hp).toBe(20);
    // im Bogen: genau einmal 25 Schaden; seitlich, schräg ausserhalb, dahinter, zu weit, Magma: nichts
    expect(r.hp).toEqual([25, 0, 0, 0, 0, 0]);
    expect(r.magma.da).toBe(true);
    expect(r.magma.unzerstoerbar).toBe(true);
    // Klinge rotiert um den Schiffsbug (nach 5 von 10 Frames senkrecht)
    expect(r.klingeWaehrend).not.toBeNull();
    expect(r.klingeWaehrend.transform).toBe('rotate(0deg)');
    expect(r.klingeWaehrend.origin).toMatch(/ 90px$/);
    expect(r.nachSweep.klinge).toBe(0);
    expect(r.nachSweep.faecher).toBe(1);
    expect(r.timer).toBe(0);
    expect(r.sounds).toBe(1);
  });

  test('Cooldown nach Stufe, Richtung wechselt, waffenOffline blockiert, keine Raketen', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(async () => {
      const { state, arrays } = window.__game;
      const Hack = await import('./js/hack.js');
      const T = window.__gleveTest;
      T.leeren();
      const balken = () => parseFloat(document.getElementById('raketen-cd-balken').style.width);

      // Erster Sweep: links -> rechts, Stufe 1: 120 Frames Cooldown
      state.tastenGedrueckt.k = true;
      T.schritte(1);
      const erster = { richtung: state.gleveSweepRichtung, winkel: state.gleveSweepWinkel, cd: state.raketenCooldown, timer: state.gleveSweepTimer };
      T.schritte(9);
      const ersterEnde = { winkel: state.gleveSweepWinkel, timer: state.gleveSweepTimer, balken: balken() };
      // Taste gehalten: erst nach Ablauf des Cooldowns der zweite Sweep
      T.schritte(110);
      const vorAblauf = { richtung: state.gleveSweepRichtung, timer: state.gleveSweepTimer };
      T.schritte(1);
      const zweiter = { richtung: state.gleveSweepRichtung, winkel: state.gleveSweepWinkel, cd: state.raketenCooldown };
      state.tastenGedrueckt.k = false;
      T.schritte(10);

      // Stufe 5: 60 Frames Cooldown, HUD-Balken danach
      state.raketenStufe = 5;
      state.raketenCooldown = 0;
      state.tastenGedrueckt.k = true;
      T.schritte(1);
      state.tastenGedrueckt.k = false;
      const stufe5 = { cd: state.raketenCooldown, richtung: state.gleveSweepRichtung };
      T.schritte(30);
      const stufe5Balken = balken();
      T.schritte(40);

      // waffenOffline blockiert den Sweep
      Hack.hackeSpieler(state, 'waffenOffline');
      state.raketenCooldown = 0;
      state.tastenGedrueckt.k = true;
      T.schritte(5);
      state.tastenGedrueckt.k = false;
      const gehackt = { timer: state.gleveSweepTimer, cd: state.raketenCooldown };
      state.hacks = [];

      return {
        erster, ersterEnde, vorAblauf, zweiter, stufe5, stufe5Balken, gehackt,
        raketen: arrays.raketenArray.length,
        raketenSounds: window.__game.Audio.audioHistory.filter(a => a.name === 'missile').length
      };
    });
    expect(r.erster.richtung).toBe(1);
    expect(r.erster.winkel).toBeCloseTo(-18, 5);
    expect(r.erster.cd).toBe(120);
    expect(r.erster.timer).toBe(9);
    expect(r.ersterEnde.winkel).toBeCloseTo(22.5, 5);
    expect(r.ersterEnde.timer).toBe(0);
    expect(r.ersterEnde.balken).toBeCloseTo(100 - 111 / 120 * 100, 3);
    expect(r.vorAblauf.richtung).toBe(1);
    expect(r.vorAblauf.timer).toBe(0);
    // Zweiter Sweep rechts -> links
    expect(r.zweiter.richtung).toBe(-1);
    expect(r.zweiter.winkel).toBeCloseTo(18, 5);
    expect(r.zweiter.cd).toBe(120);
    expect(r.stufe5.cd).toBe(60);
    expect(r.stufe5.richtung).toBe(1);
    expect(r.stufe5Balken).toBeCloseTo(50, 3);
    expect(r.gehackt.timer).toBe(0);
    expect(r.gehackt.cd).toBe(0);
    expect(r.raketen).toBe(0);
    expect(r.raketenSounds).toBe(0);
  });

  test('Parade Stufe 1: Feindlaser wird seitlich weggeschleudert, ist harmlos und verlässt das Feld', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      // Feindlaser fliegt von oben auf das Schiff zu (leicht rechts der Mitte)
      Entities.erzeugeFeindLaser(201, 320);
      const fl = arrays.feindLaserArray[0];
      // Hack-Projektil links davon, ohne Zielsuche
      Entities.erzeugeHackProjektil(186, 330, 186, 600);
      const hp = arrays.hackProjektilArray[0];
      hp.lenkZeit = 0;
      hp.vx = 0;
      hp.vy = 3;
      state.tastenGedrueckt.k = true;
      T.schritte(10);
      state.tastenGedrueckt.k = false;
      const pariert = {
        harmlos: fl.harmlos, vx: fl.vx, farbe: fl.el.style.backgroundColor,
        hackHarmlos: hp.harmlos, hackVx: hp.vx, hackLenkZeit: hp.lenkZeit
      };
      // Schiff direkt in die Flugbahn stellen: kein Treffer
      state.x = fl.x + fl.vx - 10;
      state.y = fl.y + fl.vy - 10;
      T.schritte(1);
      const imWeg = { leben: state.leben, laserDa: arrays.feindLaserArray.includes(fl), hacks: state.hacks.length };
      state.x = 185;
      state.y = 400;
      T.schritte(60);
      return { pariert, imWeg, laserRest: arrays.feindLaserArray.length, hackRest: arrays.hackProjektilArray.length, leben: state.leben, hacks: state.hacks.length, spielerLaser: arrays.laserArray.length };
    });
    expect(r.pariert.harmlos).toBe(true);
    expect(r.pariert.vx).toBeGreaterThan(0);
    expect(r.pariert.farbe).toBe('rgb(230, 126, 34)');
    expect(r.pariert.hackHarmlos).toBe(true);
    expect(r.pariert.hackVx).toBeLessThan(0);
    expect(r.pariert.hackLenkZeit).toBe(0);
    expect(r.imWeg.leben).toBe(3);
    expect(r.imWeg.laserDa).toBe(true);
    expect(r.imWeg.hacks).toBe(0);
    expect(r.laserRest).toBe(0);
    expect(r.hackRest).toBe(0);
    expect(r.leben).toBe(3);
    expect(r.hacks).toBe(0);
    // Stufe 1 wirft nichts zurück
    expect(r.spielerLaser).toBe(0);
  });

  test('Parade Stufe 5: Boss-Laser wird zurückgeworfen und trifft; Stufe 3 mit 50 % Chance', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      state.raketenStufe = 5;
      // Ziel weit oberhalb der Sweep-Länge (130 px), direkt über dem Schiff
      Entities.erzeugeAsteroid(185, 150, 30, 0, 0, 0, true);
      const ziel = arrays.asteroiden[0];
      ziel.vRot = 0;
      const hpVorher = ziel.hp;
      Entities.erzeugeBossLaser(196, 320, 0, 6);
      const bl = arrays.bossLaserArray[0];
      state.tastenGedrueckt.k = true;
      T.schritte(10);
      state.tastenGedrueckt.k = false;
      const l = arrays.laserArray[0];
      const zurueck = {
        bossLaser: arrays.bossLaserArray.length,
        spielerLaser: arrays.laserArray.length,
        owner: l && l.owner, schaden: l && l.schaden, vy: l && l.vy, vx: l && l.vx,
        farbe: l && l.el.style.backgroundColor, gleichesEl: l && l.el === bl.el
      };
      T.schritte(30);
      const ergebnis = { schaden: hpVorher - ziel.hp, spielerLaser: arrays.laserArray.length, leben: state.leben };

      // Stufe 3: Zufall entscheidet (Math.random gestubbt)
      const original = Math.random;
      const parade = (zufall) => {
        T.leeren();
        state.raketenStufe = 3;
        Entities.erzeugeFeindLaser(201, 320);
        const fl = arrays.feindLaserArray[0];
        Math.random = () => zufall;
        try {
          state.tastenGedrueckt.k = true;
          T.schritte(10);
          state.tastenGedrueckt.k = false;
        } finally {
          Math.random = original;
        }
        return { feindLaser: arrays.feindLaserArray.length, harmlos: !!fl.harmlos, spielerLaser: arrays.laserArray.length };
      };
      return { zurueck, ergebnis, stufe3Zurueck: parade(0.1), stufe3Weg: parade(0.9) };
    });
    expect(r.zurueck.bossLaser).toBe(0);
    expect(r.zurueck.spielerLaser).toBe(1);
    expect(r.zurueck.owner).toBe('p1');
    expect(r.zurueck.schaden).toBe(15);
    expect(r.zurueck.vy).toBe(10);
    expect(r.zurueck.vx).toBe(0);
    expect(r.zurueck.farbe).toBe('rgb(230, 126, 34)');
    expect(r.zurueck.gleichesEl).toBe(true);
    expect(r.ergebnis.schaden).toBe(15);
    expect(r.ergebnis.spielerLaser).toBe(0);
    expect(r.ergebnis.leben).toBe(3);
    expect(r.stufe3Zurueck).toEqual({ feindLaser: 0, harmlos: false, spielerLaser: 1 });
    expect(r.stufe3Weg).toEqual({ feindLaser: 1, harmlos: true, spielerLaser: 0 });
  });

  test('Coop: Spieler 2 sweept mit Ö, eigener HUD-Balken', async ({ page }) => {
    await starteGleve(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      state.p2.x = 400;
      state.p2.y = 400;
      Entities.erzeugeAsteroid(400, 330, 30, 0, 0, 0, true);
      const a = arrays.asteroiden[0];
      a.vRot = 0;
      const hpVorher = a.hp;
      state.tastenGedrueckt['ö'] = true;
      T.schritte(10);
      state.tastenGedrueckt['ö'] = false;
      return {
        schaden: hpVorher - a.hp,
        cdP2: state.p2.raketenCooldown,
        cdP1: state.raketenCooldown,
        richtungP1: state.gleveSweepRichtung,
        balkenP2: parseFloat(document.getElementById('raketen-cd-balken-p2').style.width)
      };
    });
    expect(r.schaden).toBe(25);
    expect(r.cdP2).toBe(111);
    expect(r.cdP1).toBe(0);
    expect(r.richtungP1).toBe(0);
    expect(r.balkenP2).toBeCloseTo(100 - 111 / 120 * 100, 3);
  });
});

test.describe('Gleve-MR Bot und Online-Host', () => {
  // Bot (schwer: entscheidet jeden Schritt) fliegt die Gleve als Spieler 2
  async function starteBot(page) {
    await starteGleve(page, { coop: true });
    await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      window.__gleveTest.botLeeren = () => {
        const { state } = window.__game;
        window.__gleveTest.leeren();
        state.p2IsBot = true;
        state.p2BotDifficulty = 'hard';
        Bot.resetBot();
        state.p2.x = 400;
        state.p2.y = 400;
        state.p2.botFireLaser = false;
        state.p2.botFireRakete = false;
        state.p2.botDashRichtung = null;
        window.__game.Audio.clearAudioHistory();
      };
    });
  }

  test('Bot dasht gezielt auf einen nahen Feind, aber nicht ohne Ziel, ohne Energie oder in einen Boss', async ({ page }) => {
    await starteBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities, Audio } = window.__game;
      const T = window.__gleveTest;
      const dashs = () => Audio.audioHistory.filter(a => a.name === 'dash').length;
      const feind = (x, y) => {
        Entities.erzeugeFeind(x, y, 'normal', 0, false);
        const f = arrays.feinde[arrays.feinde.length - 1];
        f.schussTimer = 9999;
        f.traegtPowerup = false;
        return f;
      };
      const out = {};

      // Leeres Feld: kein Dash
      T.botLeeren();
      T.schritte(60);
      out.leer = dashs();

      // Feind schraeg rechts oben in Reichweite (Sweep auf Cooldown, damit nur der Dash trifft)
      T.botLeeren();
      state.p2.raketenCooldown = 999;
      feind(440, 330);
      T.schritte(12);
      out.nah = { dashs: dashs(), feinde: arrays.feinde.length, energie: state.p2.energie, x: state.p2.x, y: state.p2.y };
      // Danach kein weiterer Dash ohne Ziel
      T.schritte(60);
      out.nahDanach = dashs();

      // Zu wenig Energie: kein Dash
      T.botLeeren();
      state.p2.raketenCooldown = 999;
      state.p2.energie = 10;
      feind(440, 330);
      T.schritte(12);
      out.ohneEnergie = { dashs: dashs(), feinde: arrays.feinde.length };

      // Feind hinter einem Boss: kein Dash in den Boss
      T.botLeeren();
      state.p2.raketenCooldown = 999;
      Entities.erzeugeBoss();
      const b = arrays.bosses[0];
      Object.assign(b, { phase: 'kampf', x: 360, y: 280, vx: 0, schussTimer: 9999, bombenTimer: 9999, raketenTimer: 9999 });
      state.p2.y = 420;
      feind(400, 330);
      T.schritte(4);
      out.boss = { dashs: dashs(), bossHp: b.hp, maxHp: b.maxHp };
      return out;
    });
    expect(r.leer).toBe(0);
    expect(r.nah.dashs).toBe(1);
    expect(r.nah.feinde).toBe(0);
    expect(r.nah.x).toBeGreaterThan(400);
    expect(r.nah.y).toBeLessThan(400);
    expect(r.nahDanach).toBe(1);
    expect(r.ohneEnergie).toEqual({ dashs: 0, feinde: 1 });
    expect(r.boss.dashs).toBe(0);
    expect(r.boss.bossHp).toBe(r.boss.maxHp);
  });

  test('Bot sweept bei einem Feindlaser vor sich und pariert ihn', async ({ page }) => {
    await starteBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities, Audio } = window.__game;
      const T = window.__gleveTest;
      T.botLeeren();
      // Feindlaser seitlich daneben: kein Sweep
      Entities.erzeugeFeindLaser(300, 330);
      T.schritte(3);
      const seitlich = { sweeps: Audio.audioHistory.filter(a => a.name === 'sweep').length, cd: state.p2.raketenCooldown };
      T.botLeeren();
      // Feindlaser direkt vor dem Schiff
      Entities.erzeugeFeindLaser(state.p2.x + 13, 330);
      const fl = arrays.feindLaserArray[0];
      T.schritte(10);
      return {
        seitlich,
        sweeps: Audio.audioHistory.filter(a => a.name === 'sweep').length,
        cd: state.p2.raketenCooldown,
        harmlos: !!fl.harmlos,
        leben: state.p2.leben,
        dashs: Audio.audioHistory.filter(a => a.name === 'dash').length
      };
    });
    expect(r.seitlich).toEqual({ sweeps: 0, cd: 0 });
    expect(r.sweeps).toBe(1);
    expect(r.cd).toBeGreaterThan(100);
    expect(r.harmlos).toBe(true);
    expect(r.leben).toBe(3);
    expect(r.dashs).toBe(0);
  });

  test('Online-Host: Dash des Clients mit gemeldeter Richtung, auch bei kurzem Druck; Client-Positionen ruhen waehrend des Dashs', async ({ page }) => {
    await starteGleve(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, Network } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      state.gameMode = 'online';
      Object.assign(state.network, { isOnline: true, isHost: true, isClient: false, connected: false });
      state.p2.laserInputRequested = false;
      state.p2.netzDashAnfrage = false;
      const eingabe = (e) => Network.applyPlayerInput(Object.assign({ x: 300, y: 400, rotate: 0, laser: false, rakete: false, bombe: false, rx: 0, ry: 0 }, e));

      // Druck und Loslassen kommen vor demselben Host-Schritt an
      eingabe({ laser: true, rx: 1, ry: 0 });
      eingabe({ laser: false, rx: 1, ry: 0 });
      T.schritte(1);
      const erster = { x: state.p2.x, energie: state.p2.energie };
      // Position des Clients waehrend des Dashs wird ignoriert
      eingabe({ x: 500, y: 300 });
      T.schritte(7);
      const ende = { x: state.p2.x, y: state.p2.y };
      // Danach gilt wieder die Client-Position
      eingabe({ x: 410, y: 390 });
      const danach = { x: state.p2.x, y: state.p2.y };
      Object.assign(state.network, { isOnline: false, isHost: false });
      return { erster, ende, danach };
    });
    expect(r.erster.x).toBeCloseTo(312.5, 5);
    expect(r.erster.energie).toBeCloseTo(25, 5);
    expect(r.ende.x).toBeCloseTo(400, 5);
    expect(r.ende.y).toBeCloseTo(400, 5);
    expect(r.danach).toEqual({ x: 410, y: 390 });
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

test('Gleve-MR: Game Over während Sweep und Dash räumt Klinge und Dash-Darstellung ab', async ({ page }) => {
  await starteGleve(page);
  const r = await page.evaluate(() => {
    const { state, Utils } = window.__game;
    const T = window.__gleveTest;
    T.leeren();
    state.tastenGedrueckt.k = true;
    state.tastenGedrueckt.l = true;
    T.schritte(3);
    const vorher = {
      klingen: document.querySelectorAll('.gleve-klinge').length,
      dash: document.getElementById('spieler').classList.contains('gleve-dash')
    };
    Object.keys(state.tastenGedrueckt).forEach(k => { state.tastenGedrueckt[k] = false; });
    Utils.triggerGameOver();
    // Nach dem Game Over laeuft die Simulation nicht weiter
    T.schritte(5);
    return {
      vorher,
      klingen: document.querySelectorAll('.gleve-klinge').length,
      dash: document.getElementById('spieler').classList.contains('gleve-dash')
    };
  });
  expect(r.vorher.klingen).toBe(1);
  expect(r.vorher.dash).toBe(true);
  expect(r.klingen).toBe(0);
  expect(r.dash).toBe(false);
});

test.describe('Gleve-MR Mobile-Steuerung', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  test('Joystick feuert bei der Gleve nicht automatisch, eigener Dash-Button löst genau einen Dash aus', async ({ page }) => {
    await page.locator('.hangar-model-btn[data-model="gleve"]').click();
    await page.tap('#start-text');
    await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
    await expect(page.locator('#mobile-controls')).toBeVisible();
    await expect(page.locator('#btn-dash')).toBeVisible();

    const r = await page.evaluate(() => {
      const { state, arrays, Loop } = window.__game;
      ['feinde', 'asteroiden', 'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bosses', 'powerups'].forEach(name => {
        arrays[name].forEach(o => o.el && o.el.remove());
        arrays[name].length = 0;
      });
      state.frameZaehler = 1;
      state.energie = 30;
      state.maxEnergie = 50;
      state.gleveDashTasteGehalten = false;
      state.x = 185;
      state.y = 400;
      const beruehre = (el, typ) => {
        const t = new Touch({ identifier: 1, target: el, clientX: el.getBoundingClientRect().left + 20, clientY: el.getBoundingClientRect().top + 20 });
        el.dispatchEvent(new TouchEvent(typ, { touches: typ === 'touchstart' ? [t] : [], changedTouches: [t], bubbles: true, cancelable: true }));
      };
      const zone = document.getElementById('joystick-zone');
      const btn = document.getElementById('btn-dash');

      // Joystick-Berührung: kein Auto-Fire, also kein Dash
      beruehre(zone, 'touchstart');
      const laserNachJoystick = state.tastenGedrueckt.l;
      Loop.simulationsSchritt();
      const dashNachJoystick = state.gleveDashTimer;
      beruehre(zone, 'touchend');

      // Dash-Button: hält die Laser-Taste, ein Dash trotz gehaltenem Button
      beruehre(btn, 'touchstart');
      const laserGedrueckt = state.tastenGedrueckt.l;
      for (let i = 0; i < 20; i++) Loop.simulationsSchritt();
      const yNachDash = state.y;
      const energieNachDash = state.energie;
      beruehre(btn, 'touchend');
      const laserLosgelassen = state.tastenGedrueckt.l;
      const cdHoehe = document.getElementById('btn-dash-cd').style.height;
      return { laserNachJoystick, dashNachJoystick, laserGedrueckt, yNachDash, energieNachDash, laserLosgelassen, cdHoehe };
    });
    expect(r.laserNachJoystick).toBe(false);
    expect(r.dashNachJoystick).toBe(0);
    expect(r.laserGedrueckt).toBe(true);
    // Genau ein Dash nach oben (Stufe 1: 100 px)
    expect(r.yNachDash).toBeCloseTo(300, 5);
    expect(r.laserLosgelassen).toBe(false);
    // 25 Energie verbraucht: Rest reicht nicht für den nächsten Dash, Ladeanzeige unter 100 %
    expect(r.energieNachDash).toBeLessThan(25);
    expect(parseFloat(r.cdHoehe)).toBeLessThan(100);

    // Viper: Dash-Button verschwindet, Joystick feuert wieder automatisch
    const viper = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      state.selectedShipModel = 'viper';
      Utils.updatePlayerShipVisuals();
      const zone = document.getElementById('joystick-zone');
      const t = new Touch({ identifier: 2, target: zone, clientX: 50, clientY: 850 });
      zone.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
      const anBeiBeruehrung = state.tastenGedrueckt.l;
      zone.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }));
      return { anBeiBeruehrung, ausDanach: state.tastenGedrueckt.l, btnDisplay: document.getElementById('btn-dash').style.display };
    });
    expect(viper.anBeiBeruehrung).toBe(true);
    expect(viper.ausDanach).toBe(false);
    expect(viper.btnDisplay).toBe('none');
  });

  test('Online-Client: Dash-Button folgt dem eigenen Schiff (P2)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      const alt = { mode: state.gameMode, isClient: state.network.isClient, p2: state.p2.selectedShipModel };
      state.selectedShipModel = 'viper';
      state.gameMode = 'online';
      state.network.isClient = true;
      state.p2.selectedShipModel = 'gleve';
      Utils.updateSchiffHudLabels();
      const clientGleve = { modell: Utils.lokalesSchiffModell(), display: document.getElementById('btn-dash').style.display };
      state.p2.selectedShipModel = 'phantom';
      Utils.updateSchiffHudLabels();
      const clientPhantom = document.getElementById('btn-dash').style.display;
      state.gameMode = alt.mode;
      state.network.isClient = alt.isClient;
      state.p2.selectedShipModel = alt.p2;
      return { clientGleve, clientPhantom };
    });
    expect(r.clientGleve.modell).toBe('gleve');
    expect(r.clientGleve.display).toBe('');
    expect(r.clientPhantom).toBe('none');
  });
});
