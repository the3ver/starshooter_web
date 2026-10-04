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

test('Gleve-MR: im Hangar wählbar, Perks, Manta-SVG, keine Werfer-Pods, HUD SWEEP/DASH', async ({ page }) => {
  const gleveBtn = page.locator('.hangar-model-btn[data-model="gleve"]');
  await expect(gleveBtn).toBeVisible();
  await gleveBtn.click();
  await expect(gleveBtn).toHaveClass(/active/);

  // Name und Perks kommen aus dem Schiffsmodell; Balancing-Werte prueft das Verhalten in den Dash-/Sweep-Tests
  const werte = await page.evaluate(async () => {
    const { state, shipModels } = await import('./js/state.js');
    return { model: state.selectedShipModel, name: shipModels.gleve.name, perks: shipModels.gleve.perks.map(p => p.label) };
  });
  expect(werte.model).toBe('gleve');
  await expect(page.locator('#hangar-ship-name')).toContainText(werte.name);
  await expect(page.locator('#hangar-ship-perks .hangar-perk-badge')).toHaveCount(werte.perks.length);
  await expect(page.locator('#hangar-ship-perks .perk-label')).toHaveText(werte.perks);

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
          s.gleveDashLadungen = 2;
          s.gleveSweepTimer = 0;
          s.gleveSweepRichtung = 0;
          s.gleveSweepTreffer = [];
          s.gleveSweepTakt = 0;
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

test.describe('Gleve-MR Dash (Raketen-Taste)', () => {
  test('Dash bewegt das Schiff um die Reichweite in Steuerrichtung, kostet keine Energie und startet den Cooldown', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      // Diagonal rechts oben, Stufe 1: 100 px, 180 Frames Cooldown
      state.tastenGedrueckt.d = true;
      state.tastenGedrueckt.w = true;
      state.tastenGedrueckt.k = true;
      T.schritte(1);
      const nachStart = { energie: state.energie, timer: state.gleveDashTimer, cd: state.raketenCooldown };
      T.schritte(2);
      const klasseWaehrend = document.getElementById('spieler').classList.contains('gleve-dash');
      T.schritte(5);
      const ende = { x: state.x, y: state.y, energie: state.energie, cd: state.raketenCooldown };
      const balken = parseFloat(document.getElementById('raketen-cd-balken').style.width);
      const klasseDanach = document.getElementById('spieler').classList.contains('gleve-dash');
      const effekte = document.querySelectorAll('.gleve-nachbild').length;
      Object.keys(state.tastenGedrueckt).forEach(k => { state.tastenGedrueckt[k] = false; });
      return { nachStart, klasseWaehrend, ende, balken, klasseDanach, effekte, dashSounds: window.__game.Audio.audioHistory.filter(a => a.name === 'dash').length };
    });
    // Der Cooldown laeuft im selben Schritt schon einen Frame herunter
    expect(r.nachStart).toEqual({ energie: 50, timer: 7, cd: 179 });
    expect(r.klasseWaehrend).toBe(true);
    expect(r.klasseDanach).toBe(false);
    expect(r.ende.x).toBeCloseTo(185 + 100 / Math.SQRT2, 1);
    expect(r.ende.y).toBeCloseTo(400 - 100 / Math.SQRT2, 1);
    expect(r.ende.energie).toBe(50);
    expect(r.ende.cd).toBe(172);
    // HUD-Raketenbalken zeigt den Dash-Cooldown
    expect(r.balken).toBeCloseTo(100 - 172 / 180 * 100, 3);
    expect(r.effekte).toBeGreaterThan(0);
    expect(r.dashSounds).toBe(1);
  });

  test('Nur ein Dash pro Tastendruck, Ladungen und Reichweite nach Raketen-Stufe, waffenOffline blockiert, keine Raketen', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(async () => {
      const { state, arrays, Audio } = window.__game;
      const Hack = await import('./js/hack.js');
      const T = window.__gleveTest;
      T.leeren();
      // Taste 30 Schritte gehalten: nur ein Dash nach oben
      state.tastenGedrueckt.k = true;
      T.schritte(30);
      const gehalten = { y: state.y, ladungen: state.gleveDashLadungen };
      // Loslassen und erneut druecken: zweite Ladung, zweiter Dash
      state.tastenGedrueckt.k = false;
      T.schritte(1);
      state.tastenGedrueckt.k = true;
      T.schritte(10);
      const zweiter = { y: state.y, ladungen: state.gleveDashLadungen, cd: state.raketenCooldown };
      state.tastenGedrueckt.k = false;
      T.schritte(1);
      // Keine Ladung mehr: kein Dash
      state.tastenGedrueckt.k = true;
      T.schritte(10);
      const ohneLadung = { y: state.y, ladungen: state.gleveDashLadungen };
      state.tastenGedrueckt.k = false;
      T.schritte(1);
      // Wieder eine Ladung: Dash
      state.gleveDashLadungen = 1;
      state.tastenGedrueckt.k = true;
      T.schritte(10);
      const dritter = state.y;
      state.tastenGedrueckt.k = false;
      T.schritte(1);

      // waffenOffline-Hack blockiert den Dash
      state.y = 400;
      state.raketenCooldown = 0;
      state.gleveDashLadungen = 2;
      Hack.hackeSpieler(state, 'waffenOffline');
      state.tastenGedrueckt.k = true;
      T.schritte(10);
      const gehackt = { y: state.y, cd: state.raketenCooldown, ladungen: state.gleveDashLadungen };
      state.tastenGedrueckt.k = false;
      state.hacks = [];
      T.schritte(1);

      // Reichweite und Cooldown je Raketen-Stufe (nach 8 Schritten)
      const stufen = [];
      for (let s = 1; s <= 5; s++) {
        state.raketenStufe = s;
        state.raketenCooldown = 0;
        state.gleveDashLadungen = 2;
        state.y = 500;
        state.tastenGedrueckt.k = true;
        T.schritte(8);
        stufen.push({ weg: Math.round((500 - state.y) * 1000) / 1000, cd: state.raketenCooldown });
        state.tastenGedrueckt.k = false;
        T.schritte(1);
      }
      return {
        gehalten, zweiter, ohneLadung, dritter, gehackt, stufen,
        energie: state.energie,
        lasers: arrays.laserArray.length,
        raketen: arrays.raketenArray.length,
        raketenSounds: Audio.audioHistory.filter(a => a.name === 'missile').length
      };
    });
    // Gehaltene Taste: nur ein Dash, eine Ladung verbraucht
    expect(r.gehalten.y).toBeCloseTo(300, 5);
    expect(r.gehalten.ladungen).toBe(1);
    // Zweiter Druck nutzt die zweite Ladung; das laufende Nachladen wird nicht neu gestartet
    expect(r.zweiter.y).toBeCloseTo(200, 5);
    expect(r.zweiter.ladungen).toBe(0);
    expect(r.zweiter.cd).toBe(139);
    expect(r.ohneLadung.y).toBeCloseTo(200, 5);
    expect(r.ohneLadung.ladungen).toBe(0);
    expect(r.dritter).toBeCloseTo(100, 5);
    expect(r.gehackt.y).toBeCloseTo(400, 5);
    expect(r.gehackt.cd).toBe(0);
    expect(r.gehackt.ladungen).toBe(2);
    expect(r.stufen).toEqual([
      { weg: 100, cd: 172 }, { weg: 110, cd: 157 }, { weg: 120, cd: 142 }, { weg: 135, cd: 127 }, { weg: 150, cd: 112 }
    ]);
    expect(r.energie).toBe(50);
    // Die Gleve feuert weder Laser-Projektile noch Raketen
    expect(r.lasers).toBe(0);
    expect(r.raketen).toBe(0);
    expect(r.raketenSounds).toBe(0);
  });

  test('Normale Feinde auf der Strecke werden zerstört, Kill-Kette verkürzt das Nachladen um 30 Frames pro Kill', async ({ page }) => {
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
      state.tastenGedrueckt.k = true;
      T.schritte(8);
      state.tastenGedrueckt.k = false;
      return { feinde: arrays.feinde.length, energie: state.energie, cd: state.raketenCooldown, ladungen: state.gleveDashLadungen, leben: state.leben, punkte: state.score - scoreVorher, y: state.y };
    });
    expect(r.feinde).toBe(0);
    expect(r.leben).toBe(3);
    expect(r.punkte).toBeGreaterThanOrEqual(200);
    // 180 (Nachladen) - 2 * 30 (Kill-Kette) - 8 Schritte
    expect(r.cd).toBe(112);
    expect(r.ladungen).toBe(1);
    expect(r.energie).toBe(50);
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
      state.tastenGedrueckt.k = true;
      T.schritte(5);
      const aufprall = { hp: b.hp, maxHp: b.maxHp, dash: state.gleveDashTimer, abprall: state.gleveAbprallTimer };
      T.schritte(8);
      state.tastenGedrueckt.k = false;
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
      state.tastenGedrueckt.k = true;
      T.schritte(12); // 8 Dash-Frames + 4 Nachlauf
      const waehrend = { leben: state.leben, laser: arrays.feindLaserArray.length, blink: state.invulnerableTimer };
      T.schritte(10); // Nachlauf vorbei: der Laser am Zielpunkt trifft jetzt
      state.tastenGedrueckt.k = false;
      return { waehrend, danach: state.leben, y: state.y };
    });
    expect(r.y).toBeCloseTo(300, 5);
    expect(r.waehrend.leben).toBe(3);
    expect(r.waehrend.laser).toBe(2);
    expect(r.waehrend.blink).toBe(0);
    expect(r.danach).toBe(2);
  });

  test('Magma: unter Raketen-Stufe 5 Abprall, auf Stufe 5 wird es geknackt und zerstört', async ({ page }) => {
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

      // Stufe 1 (Laser-Stufe 5 aendert daran nichts): Abprall, Magma bleibt heil
      T.leeren();
      state.laserStufe = 5;
      const m1 = erzeugeMagma();
      state.tastenGedrueckt.k = true;
      T.schritte(14);
      state.tastenGedrueckt.k = false;
      const stufe1 = { da: arrays.asteroiden.includes(m1), unzerstoerbar: m1.istUnzerstoerbar, x: state.x, y: state.y };

      // Raketen-Stufe 5: knacken und durchschneiden
      T.leeren();
      state.raketenStufe = 5;
      const m5 = erzeugeMagma();
      state.tastenGedrueckt.k = true;
      T.schritte(8);
      state.tastenGedrueckt.k = false;
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

  test('Coop: Spieler 2 dasht mit Ö, eigener Cooldown', async ({ page }) => {
    await starteGleve(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      state.p2.x = 400;
      state.p2.y = 400;
      state.tastenGedrueckt['ö'] = true;
      state.tastenGedrueckt.arrowleft = true;
      T.schritte(8);
      state.tastenGedrueckt['ö'] = false;
      state.tastenGedrueckt.arrowleft = false;
      return {
        x: state.p2.x, y: state.p2.y, energie: state.p2.energie, cdP2: state.p2.raketenCooldown, cdP1: state.raketenCooldown, p1y: state.y,
        balkenP2: parseFloat(document.getElementById('raketen-cd-balken-p2').style.width)
      };
    });
    expect(r.x).toBeCloseTo(300, 5);
    expect(r.y).toBeCloseTo(400, 5);
    expect(r.energie).toBe(50);
    expect(r.cdP2).toBe(172);
    expect(r.cdP1).toBe(0);
    expect(r.p1y).toBeCloseTo(400, 5);
    expect(r.balkenP2).toBeCloseTo(100 - 172 / 180 * 100, 3);
  });
});

test.describe('Gleve-MR Dash-Ladungen', () => {
  test('Start mit 2 Ladungen: zwei Dashs direkt hintereinander, der dritte nicht; Nachladen je dashCooldown Schritte', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Gleve = await import('./js/gleve.js');
      const T = window.__gleveTest;
      // Ein Dash pro Druck: Taste druecken, Dash-Dauer abwarten, loslassen (11 Schritte)
      const dashe = () => {
        state.tastenGedrueckt.k = true;
        T.schritte(10);
        state.tastenGedrueckt.k = false;
        T.schritte(1);
      };
      const dashCd = Gleve.dashCooldown(state);
      T.leeren();
      const start = { ladungen: state.gleveDashLadungen, max: Gleve.dashMaxLadungen(state), cd: state.raketenCooldown };
      state.y = 500;
      dashe();
      const nachEins = { ladungen: state.gleveDashLadungen, y: state.y };
      dashe();
      const nachZwei = { ladungen: state.gleveDashLadungen, y: state.y };
      dashe();
      const nachDrei = { ladungen: state.gleveDashLadungen, y: state.y };
      // Das Nachladen laeuft seit dem ersten Dash (33 Schritte vergangen)
      T.schritte(dashCd - 33 - 1);
      const vorEins = state.gleveDashLadungen;
      T.schritte(1);
      const nachEinsGeladen = state.gleveDashLadungen;
      T.schritte(dashCd - 1);
      const vorVoll = state.gleveDashLadungen;
      T.schritte(1);
      const voll = { ladungen: state.gleveDashLadungen, cd: state.raketenCooldown };
      T.schritte(dashCd * 2);
      const dauerhaft = state.gleveDashLadungen;
      return { start, nachEins, nachZwei, nachDrei, vorEins, nachEinsGeladen, vorVoll, voll, dauerhaft };
    });
    expect(r.start).toEqual({ ladungen: 2, max: 2, cd: 0 });
    expect(r.nachEins.ladungen).toBe(1);
    expect(r.nachEins.y).toBeLessThan(500);
    expect(r.nachZwei.ladungen).toBe(0);
    expect(r.nachZwei.y).toBeLessThan(r.nachEins.y);
    expect(r.nachDrei).toEqual(r.nachZwei);
    expect(r.vorEins).toBe(0);
    expect(r.nachEinsGeladen).toBe(1);
    expect(r.vorVoll).toBe(1);
    expect(r.voll).toEqual({ ladungen: 2, cd: 0 });
    expect(r.dauerhaft).toBe(2);
  });

  test('HUD: DASH-Balken zeigt das Nachladen, Punkte zeigen die Ladungen (2, Stufe 4: 3), Viper ohne Punkte', async ({ page }) => {
    await starteGleve(page);
    const punkte = (sfx = '') => page.evaluate((id) => {
      const el = document.getElementById(id);
      return { gesamt: el.querySelectorAll('.dash-ladung').length, voll: el.querySelectorAll('.dash-ladung.voll').length, sichtbar: getComputedStyle(el).display !== 'none' };
    }, 'dash-ladungen' + sfx);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Gleve = await import('./js/gleve.js');
      const T = window.__gleveTest;
      const balken = () => document.getElementById('raketen-cd-balken');
      const lies = () => ({ pct: parseFloat(balken().style.width), farbe: balken().style.backgroundColor });
      T.leeren();
      T.schritte(1);
      const start = lies();
      state.y = 500;
      state.tastenGedrueckt.k = true;
      T.schritte(10);
      state.tastenGedrueckt.k = false;
      T.schritte(1);
      const nachDash = { ...lies(), ladungen: state.gleveDashLadungen };
      return { start, nachDash, max: Gleve.dashMaxLadungen(state) };
    });
    expect(r.start).toEqual({ pct: 100, farbe: 'rgb(46, 204, 113)' });
    expect(r.nachDash.ladungen).toBe(1);
    expect(r.nachDash.pct).toBeLessThan(100);
    expect(r.nachDash.farbe).not.toBe('rgb(46, 204, 113)');
    expect(await punkte()).toEqual({ gesamt: r.max, voll: 1, sichtbar: true });

    // Voll geladen: alle Punkte gefuellt
    await page.evaluate(() => {
      const { state } = window.__game;
      window.__gleveTest.leeren();
      window.__gleveTest.schritte(1);
    });
    expect(await punkte()).toEqual({ gesamt: 2, voll: 2, sichtbar: true });

    // Stufe 4: drei Punkte, der dritte fehlt bis zum Nachladen
    await page.evaluate(() => {
      const { state } = window.__game;
      state.raketenStufe = 4;
      window.__gleveTest.schritte(1);
    });
    expect(await punkte()).toEqual({ gesamt: 3, voll: 2, sichtbar: true });

    // Viper: keine Punkte
    await page.evaluate(() => {
      const { state, Utils } = window.__game;
      state.selectedShipModel = 'viper';
      Utils.updateSchiffHudLabels();
      window.__gleveTest.schritte(1);
    });
    expect(await punkte()).toEqual({ gesamt: 0, voll: 0, sichtbar: false });
  });

  test('Max-Ladungen nach Raketen-Stufe: 1-3 -> 2, 4-5 -> 3; Upgrade lädt von selbst nach, Ladungen nie über Max', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Gleve = await import('./js/gleve.js');
      const T = window.__gleveTest;
      T.leeren();
      const max = [1, 2, 3, 4, 5].map(s => { state.raketenStufe = s; return Gleve.dashMaxLadungen(state); });
      // Upgrade auf Stufe 4: 2 von 3 Ladungen, Nachladen startet und fuellt auf 3
      state.raketenStufe = 4;
      T.schritte(1);
      const nachUpgrade = { ladungen: state.gleveDashLadungen, cd: state.raketenCooldown };
      T.schritte(Gleve.dashCooldown(state));
      const aufgeladen = { ladungen: state.gleveDashLadungen, cd: state.raketenCooldown };
      T.schritte(Gleve.dashCooldown(state) * 3);
      const nieUeberMax = state.gleveDashLadungen;
      // Zu viele Ladungen werden geklemmt
      state.gleveDashLadungen = 9;
      T.schritte(1);
      const geklemmt = state.gleveDashLadungen;
      return { max, nachUpgrade, aufgeladen, nieUeberMax, geklemmt };
    });
    expect(r.max).toEqual([2, 2, 2, 3, 3]);
    expect(r.nachUpgrade.ladungen).toBe(2);
    expect(r.nachUpgrade.cd).toBeGreaterThan(100);
    expect(r.aufgeladen).toEqual({ ladungen: 3, cd: 0 });
    expect(r.nieUeberMax).toBe(3);
    expect(r.geklemmt).toBe(3);
  });

  test('Kill-Kette verkürzt das Nachladen; erreicht es 0, kommt die Ladung sofort und es wird weitergeladen', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      // Eine Ladung ist bereits unterwegs (40 Frames Rest): der Dash-Kill (-30) verkuerzt, zweiter Kill beendet es
      state.gleveDashLadungen = 1;
      state.raketenCooldown = 40;
      Entities.erzeugeFeind(185, 350, 'normal', 0, false);
      Entities.erzeugeFeind(185, 315, 'normal', 0, false);
      arrays.feinde.forEach(f => { f.schussTimer = 9999; f.traegtPowerup = false; });
      state.tastenGedrueckt.k = true;
      T.schritte(8);
      state.tastenGedrueckt.k = false;
      return { feinde: arrays.feinde.length, ladungen: state.gleveDashLadungen, cd: state.raketenCooldown };
    });
    expect(r.feinde).toBe(0);
    // Dash 1 -> 0 Ladungen; Kill 1: 40 -> 10; Kill 2: Nachladen fertig, +1 Ladung, neues Nachladen (180), davon bis Schrittende abgezogen
    expect(r.ladungen).toBe(1);
    expect(r.cd).toBeGreaterThan(100);
    expect(r.cd).toBeLessThan(180);
  });
});

test.describe('Gleve-MR Laser-Sweep (Laser-Taste)', () => {
  test('Sweep trifft Ziele im Bogen genau einmal, nicht seitlich, dahinter oder zu weit weg; Magma bleibt heil', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      // Ursprung des Strahls: (200, 405), Stufe 1: 90-Grad-Bogen, Länge 100, Schaden 30
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
      const seitlich = asteroid(240, 390); // 90 Grad
      const dahinter = asteroid(185, 440);
      const zuWeit = asteroid(185, 265); // naechster Punkt 110 px entfernt
      Entities.erzeugeAsteroid(250, 330, 30, 0, 0, 0, true);
      const magma = arrays.asteroiden[arrays.asteroiden.length - 1];
      Object.assign(magma, { x: 205, y: 340, istUnzerstoerbar: true, istMagma: true, traegtPowerup: false, vRot: 0 });
      magma.el.classList.add('unzerstoerbar');
      const hpVorher = [imBogen, seitlich, dahinter, zuWeit, magma].map(a => a.hp);

      state.tastenGedrueckt.l = true;
      T.schritte(5);
      const klinge = document.querySelector('.gleve-klinge');
      const klingeWaehrend = klinge ? { transform: klinge.style.transform, origin: getComputedStyle(klinge).transformOrigin } : null;
      T.schritte(5);
      state.tastenGedrueckt.l = false;
      const nachSweep = {
        klinge: document.querySelectorAll('.gleve-klinge').length,
        faecher: document.querySelectorAll('.gleve-faecher').length,
        energie: state.energie
      };
      // Weitere Schritte ohne Taste: kein zweiter Sweep, kein zweiter Schaden
      T.schritte(20);
      return {
        feind: { da: arrays.feinde.includes(feind), schild: feind.schildHp, hp: feind.hp },
        hp: [imBogen, seitlich, dahinter, zuWeit, magma].map((a, i) => hpVorher[i] - a.hp),
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
    // im Bogen: genau einmal 30 Schaden; seitlich, dahinter, zu weit, Magma: nichts
    expect(r.hp).toEqual([30, 0, 0, 0, 0]);
    expect(r.magma.da).toBe(true);
    expect(r.magma.unzerstoerbar).toBe(true);
    // Klinge rotiert um den Schiffsbug (nach 5 von 10 Frames senkrecht)
    expect(r.klingeWaehrend).not.toBeNull();
    expect(r.klingeWaehrend.transform).toBe('rotate(0deg)');
    expect(r.klingeWaehrend.origin).toMatch(/ 100px$/);
    expect(r.nachSweep.klinge).toBe(0);
    expect(r.nachSweep.faecher).toBe(1);
    // 8 Energie pro Sweep, beim Halten keine Regeneration
    expect(r.nachSweep.energie).toBe(42);
    expect(r.timer).toBe(0);
    expect(r.sounds).toBe(1);
  });

  test('Bogen nach Laser-Stufe: Stufe 1 (90 Grad) trifft bei 40, nicht bei 60 Grad; Stufe 5 (150 Grad) trifft bei 70 Grad', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      // Kleines Ziel (10 px) mit Mitte 70 px vom Strahlursprung (200, 405) unter dem Winkel (Grad, 0 = oben)
      const ziel = (winkel) => {
        const rad = winkel * Math.PI / 180;
        Entities.erzeugeAsteroid(200 + Math.sin(rad) * 70 - 5, 405 - Math.cos(rad) * 70 - 5, 10, 0, 0, 0, true);
        const a = arrays.asteroiden[arrays.asteroiden.length - 1];
        a.vRot = 0;
        a.traegtPowerup = false;
        return { a, hp: a.hp };
      };
      const schaden = z => z.hp - z.a.hp;
      const sweep = () => {
        state.tastenGedrueckt.l = true;
        T.schritte(10);
        state.tastenGedrueckt.l = false;
        T.schritte(1);
      };

      T.leeren();
      const stufe1 = [ziel(40), ziel(-40), ziel(60), ziel(-60)];
      sweep();

      T.leeren();
      state.laserStufe = 5;
      const stufe5 = [ziel(70), ziel(-70), ziel(85)];
      sweep();
      return { stufe1: stufe1.map(schaden), stufe5: stufe5.map(schaden) };
    });
    expect(r.stufe1).toEqual([30, 30, 0, 0]);
    expect(r.stufe5).toEqual([50, 50, 0]);
  });

  test('Gehalten pendelt der Sweep im Takt, verbraucht Energie ohne Regeneration; Takt nach Stufe, Energie-Grenze, Superwaffe, waffenOffline', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(async () => {
      const { state, arrays, Audio } = window.__game;
      const Hack = await import('./js/hack.js');
      const T = window.__gleveTest;
      const farbe = () => document.getElementById('energie-balken').style.backgroundColor;
      const z = () => ({ richtung: state.gleveSweepRichtung, winkel: state.gleveSweepWinkel, timer: state.gleveSweepTimer, energie: state.energie });

      // Stufe 1: Takt 20, 8 Energie pro Sweep
      T.leeren();
      Audio.clearAudioHistory();
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      const erster = z();
      T.schritte(19);
      const vorZweitem = z();
      T.schritte(1);
      const zweiter = z();
      T.schritte(20);
      const dritter = z();
      const farbeVoll = farbe();
      state.tastenGedrueckt.l = false;
      T.schritte(9);
      const losgelassen = z(); // letzter Sweep laeuft noch: keine Regeneration
      T.schritte(10);
      const geladen = state.energie;
      const sounds = Audio.audioHistory.filter(a => a.name === 'sweep').length;

      // Stufe 5: Takt 16, 6 Energie, 150-Grad-Bogen
      T.leeren();
      state.laserStufe = 5;
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      const s5erster = z();
      T.schritte(15);
      const s5vor = z();
      T.schritte(1);
      const s5zweiter = z();
      state.tastenGedrueckt.l = false;
      T.schritte(1);

      // Zu wenig Energie: kein Sweep, gehalten auch keine Regeneration, Balken orange
      T.leeren();
      state.energie = 7;
      state.tastenGedrueckt.l = true;
      T.schritte(5);
      const ohneEnergie = { ...z(), farbe: farbe() };
      state.tastenGedrueckt.l = false;
      T.schritte(1);

      // Superwaffe: Sweep ohne Kosten
      T.leeren();
      state.unbegrenzteEnergie = true;
      state.energie = 0;
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      const superwaffe = z();
      state.tastenGedrueckt.l = false;
      T.schritte(1);

      // waffenOffline blockiert den Sweep
      T.leeren();
      Hack.hackeSpieler(state, 'waffenOffline');
      state.tastenGedrueckt.l = true;
      T.schritte(5);
      const gehackt = z();
      state.tastenGedrueckt.l = false;
      state.hacks = [];

      return {
        erster, vorZweitem, zweiter, dritter, farbeVoll, losgelassen, geladen, sounds,
        s5erster, s5vor, s5zweiter, ohneEnergie, superwaffe, gehackt,
        lasers: arrays.laserArray.length, raketen: arrays.raketenArray.length
      };
    });
    // Erster Sweep links -> rechts: Start bei -45 Grad, 9 Grad pro Schritt
    expect(r.erster).toEqual({ richtung: 1, winkel: -36, timer: 9, energie: 42 });
    expect(r.vorZweitem).toEqual({ richtung: 1, winkel: 45, timer: 0, energie: 42 });
    // Zweiter Sweep nach 20 Frames rechts -> links
    expect(r.zweiter).toEqual({ richtung: -1, winkel: 36, timer: 9, energie: 34 });
    expect(r.dritter.richtung).toBe(1);
    expect(r.dritter.energie).toBe(26);
    expect(r.farbeVoll).toBe('rgb(26, 188, 156)');
    expect(r.losgelassen.timer).toBe(0);
    expect(r.losgelassen.energie).toBe(26);
    // Danach 0,4 pro Schritt
    expect(r.geladen).toBeCloseTo(30, 5);
    expect(r.sounds).toBe(3);
    expect(r.s5erster).toEqual({ richtung: 1, winkel: -60, timer: 9, energie: 44 });
    expect(r.s5vor.richtung).toBe(1);
    expect(r.s5zweiter.richtung).toBe(-1);
    expect(r.s5zweiter.energie).toBe(38);
    expect(r.ohneEnergie).toEqual({ richtung: 0, winkel: expect.any(Number), timer: 0, energie: 7, farbe: 'rgb(230, 126, 34)' });
    expect(r.superwaffe.timer).toBe(9);
    expect(r.superwaffe.energie).toBe(0);
    expect(r.gehackt.timer).toBe(0);
    expect(r.gehackt.energie).toBe(50);
    expect(r.lasers).toBe(0);
    expect(r.raketen).toBe(0);
  });

  test('Parade Laser-Stufe 1: Feindlaser wird seitlich weggeschleudert, ist harmlos und verlässt das Feld', async ({ page }) => {
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
      state.tastenGedrueckt.l = true;
      T.schritte(10);
      state.tastenGedrueckt.l = false;
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

  test('Parade Laser-Stufe 5: Boss-Laser wird zurückgeworfen und trifft; Stufe 3 mit 50 % Chance', async ({ page }) => {
    await starteGleve(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      state.laserStufe = 5;
      // Ziel weit oberhalb der Sweep-Länge (140 px), direkt über dem Schiff
      Entities.erzeugeAsteroid(185, 150, 30, 0, 0, 0, true);
      const ziel = arrays.asteroiden[0];
      ziel.vRot = 0;
      const hpVorher = ziel.hp;
      Entities.erzeugeBossLaser(196, 320, 0, 6);
      const bl = arrays.bossLaserArray[0];
      state.tastenGedrueckt.l = true;
      T.schritte(10);
      state.tastenGedrueckt.l = false;
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
        state.laserStufe = 3;
        Entities.erzeugeFeindLaser(201, 320);
        const fl = arrays.feindLaserArray[0];
        Math.random = () => zufall;
        try {
          state.tastenGedrueckt.l = true;
          T.schritte(10);
          state.tastenGedrueckt.l = false;
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

  test('Coop: Spieler 2 sweept mit Ä und eigener Energie', async ({ page }) => {
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
      state.tastenGedrueckt['ä'] = true;
      T.schritte(10);
      state.tastenGedrueckt['ä'] = false;
      return {
        schaden: hpVorher - a.hp,
        energieP2: state.p2.energie,
        energieP1: state.energie,
        cdP2: state.p2.raketenCooldown,
        richtungP1: state.gleveSweepRichtung
      };
    });
    expect(r.schaden).toBe(30);
    expect(r.energieP2).toBe(42);
    expect(r.energieP1).toBe(50);
    expect(r.cdP2).toBe(0);
    expect(r.richtungP1).toBe(0);
  });
});

test('Gleve-MR: Sweep-Kill an einem Feindschiff gibt Energie zurück, an Asteroiden nicht', async ({ page }) => {
  await starteGleve(page);
  const r = await page.evaluate(() => {
    const { state, arrays, Entities, shipModels } = window.__game;
    const T = window.__gleveTest;
    // Ein Sweep (Stufe 1: 30 Schaden, 8 Energie) auf ein Ziel direkt voraus; Energie messen, solange der Sweep noch laeuft
    const sweepAuf = erzeuge => {
      T.leeren();
      const ziel = erzeuge();
      state.tastenGedrueckt.l = true;
      T.schritte(10);
      const energie = state.energie;
      state.tastenGedrueckt.l = false;
      return { energie, zerstoert: !arrays.feinde.includes(ziel) && !arrays.asteroiden.includes(ziel) };
    };
    const feind = sweepAuf(() => {
      Entities.erzeugeFeind(185, 340, 'normal', 0, false);
      const f = arrays.feinde[0];
      Object.assign(f, { vy: 0, schussTimer: 9999, traegtPowerup: false });
      return f;
    });
    const asteroid = sweepAuf(() => {
      Entities.erzeugeAsteroid(185, 340, 20, 0, 0, 0, true);
      const a = arrays.asteroiden[0];
      a.traegtPowerup = false;
      return a;
    });
    return { feind, asteroid, bonus: shipModels.gleve.sweepKillEnergie, start: 50 };
  });
  expect(r.bonus).toBeGreaterThan(0);
  expect(r.feind.zerstoert).toBe(true);
  expect(r.asteroid.zerstoert).toBe(true);
  // Beide Sweeps kosten gleich viel; nur der Feind-Kill gibt den Bonus zurueck
  expect(r.feind.energie - r.asteroid.energie).toBeCloseTo(r.bonus, 5);
  expect(r.asteroid.energie).toBeLessThan(r.start);
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

  test('Bot dasht gezielt auf einen nahen Feind, aber nicht ohne Ziel, ohne Ladung oder in einen Boss', async ({ page }) => {
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

      // Feind schraeg rechts oben in Reichweite (ohne Energie fuer den Sweep, damit nur der Dash trifft)
      T.botLeeren();
      state.p2.energie = 0;
      feind(440, 330);
      T.schritte(12);
      out.nah = { dashs: dashs(), feinde: arrays.feinde.length, cd: state.p2.raketenCooldown, x: state.p2.x, y: state.p2.y, druck: state.p2.botFireRakete };
      // Danach kein weiterer Dash ohne Ziel
      T.schritte(60);
      out.nahDanach = dashs();

      // Keine Dash-Ladung: kein Dash
      T.botLeeren();
      state.p2.energie = 0;
      state.p2.gleveDashLadungen = 0;
      state.p2.raketenCooldown = 999;
      feind(440, 330);
      T.schritte(12);
      out.ohneLadung = { dashs: dashs(), feinde: arrays.feinde.length };

      // Feind hinter einem Boss: kein Dash in den Boss
      T.botLeeren();
      state.p2.energie = 0;
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
    expect(r.nah.cd).toBeGreaterThan(100);
    expect(r.nah.x).toBeGreaterThan(400);
    expect(r.nah.y).toBeLessThan(400);
    // Der Dash-Druck ist eine Flanke und bleibt nicht stehen
    expect(r.nah.druck).toBe(false);
    expect(r.nahDanach).toBe(1);
    expect(r.ohneLadung).toEqual({ dashs: 0, feinde: 1 });
    expect(r.boss.dashs).toBe(0);
    expect(r.boss.bossHp).toBe(r.boss.maxHp);
  });

  test('Bot sweept bei einem Feindlaser vor sich und pariert ihn', async ({ page }) => {
    await starteBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities, Audio } = window.__game;
      const T = window.__gleveTest;
      T.botLeeren();
      // Feindlaser seitlich daneben (ausserhalb von Bogen und Laenge): kein Sweep, keine Energie verbraucht
      Entities.erzeugeFeindLaser(300, 330);
      T.schritte(3);
      const seitlich = { sweeps: Audio.audioHistory.filter(a => a.name === 'sweep').length, energie: state.p2.energie };
      T.botLeeren();
      // Feindlaser direkt vor dem Schiff
      Entities.erzeugeFeindLaser(state.p2.x + 13, 330);
      const fl = arrays.feindLaserArray[0];
      T.schritte(10);
      return {
        seitlich,
        sweeps: Audio.audioHistory.filter(a => a.name === 'sweep').length,
        energie: state.p2.energie,
        harmlos: !!fl.harmlos,
        leben: state.p2.leben,
        dashs: Audio.audioHistory.filter(a => a.name === 'dash').length
      };
    });
    expect(r.seitlich).toEqual({ sweeps: 0, energie: 50 });
    expect(r.sweeps).toBe(1);
    expect(r.energie).toBe(42);
    expect(r.harmlos).toBe(true);
    expect(r.leben).toBe(3);
    expect(r.dashs).toBe(0);
  });

  test('Online-Host: Dash des Clients ueber die Raketen-Eingabe mit gemeldeter Richtung, auch bei kurzem Druck; Sweep ueber gehaltene Laser-Eingabe', async ({ page }) => {
    await starteGleve(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, Network, Audio } = window.__game;
      const T = window.__gleveTest;
      T.leeren();
      state.gameMode = 'online';
      Object.assign(state.network, { isOnline: true, isHost: true, isClient: false, connected: false });
      state.p2.laserInputRequested = false;
      state.p2.raketeGehalten = false;
      state.p2.netzDashAnfrage = false;
      Audio.clearAudioHistory();
      const eingabe = (e) => Network.applyPlayerInput(Object.assign({ x: 300, y: 400, rotate: 0, laser: false, rakete: false, bombe: false, rx: 0, ry: 0 }, e));

      // Druck und Loslassen kommen vor demselben Host-Schritt an
      eingabe({ rakete: true, rx: 1, ry: 0 });
      eingabe({ rakete: false, rx: 1, ry: 0 });
      T.schritte(1);
      const erster = { x: state.p2.x, energie: state.p2.energie, cd: state.p2.raketenCooldown, sweep: state.p2.gleveSweepTimer };
      // Position des Clients waehrend des Dashs wird ignoriert
      eingabe({ x: 500, y: 300 });
      T.schritte(7);
      const ende = { x: state.p2.x, y: state.p2.y };
      // Danach gilt wieder die Client-Position
      eingabe({ x: 410, y: 390 });
      const danach = { x: state.p2.x, y: state.p2.y };

      // Gehaltene Laser-Eingabe: pendelnde Sweeps, kein Dash
      eingabe({ x: 410, y: 390, laser: true });
      T.schritte(21);
      const sweep = {
        richtung: state.p2.gleveSweepRichtung, energie: state.p2.energie,
        sweeps: Audio.audioHistory.filter(a => a.name === 'sweep').length,
        dashs: Audio.audioHistory.filter(a => a.name === 'dash').length
      };
      eingabe({ x: 410, y: 390, laser: false });
      Object.assign(state.network, { isOnline: false, isHost: false });
      return { erster, ende, danach, sweep };
    });
    expect(r.erster.x).toBeCloseTo(312.5, 5);
    expect(r.erster.energie).toBe(50);
    expect(r.erster.cd).toBe(179);
    expect(r.erster.sweep).toBe(0);
    expect(r.ende.x).toBeCloseTo(400, 5);
    expect(r.ende.y).toBeCloseTo(400, 5);
    expect(r.danach).toEqual({ x: 410, y: 390 });
    expect(r.sweep).toEqual({ richtung: -1, energie: 34, sweeps: 2, dashs: 1 });
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

  test('Joystick sweept bei der Gleve automatisch, Raketen-Button "D" löst genau einen Dash aus, kein eigener Dash-Button', async ({ page }) => {
    await page.locator('.hangar-model-btn[data-model="gleve"]').click();
    await page.tap('#start-text');
    await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
    await expect(page.locator('#mobile-controls')).toBeVisible();
    await expect(page.locator('#btn-dash')).toHaveCount(0);
    await expect(page.locator('#btn-rakete span')).toHaveText('D');

    const r = await page.evaluate(() => {
      const { state, arrays, Loop } = window.__game;
      ['feinde', 'asteroiden', 'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bosses', 'powerups'].forEach(name => {
        arrays[name].forEach(o => o.el && o.el.remove());
        arrays[name].length = 0;
      });
      state.frameZaehler = 1;
      state.energie = 50;
      state.maxEnergie = 50;
      state.laserStufe = 1;
      state.raketenStufe = 1;
      state.raketenCooldown = 0;
      state.gleveDashTasteGehalten = false;
      state.gleveSweepTakt = 0;
      state.x = 185;
      state.y = 400;
      const beruehre = (el, typ) => {
        const t = new Touch({ identifier: 1, target: el, clientX: el.getBoundingClientRect().left + 20, clientY: el.getBoundingClientRect().top + 20 });
        el.dispatchEvent(new TouchEvent(typ, { touches: typ === 'touchstart' ? [t] : [], changedTouches: [t], bubbles: true, cancelable: true }));
      };
      const zone = document.getElementById('joystick-zone');
      const btn = document.getElementById('btn-rakete');

      // Joystick-Berührung: Auto-Fire, also Sweep (ohne Ausschlag keine Bewegung)
      beruehre(zone, 'touchstart');
      const laserNachJoystick = state.tastenGedrueckt.l;
      Loop.simulationsSchritt();
      const sweepNachJoystick = { timer: state.gleveSweepTimer, energie: state.energie, dash: state.gleveDashTimer };
      beruehre(zone, 'touchend');
      const laserLosgelassen = state.tastenGedrueckt.l;

      // Raketen-Button: ein Dash nach oben, solange der kurze Druck anliegt
      beruehre(btn, 'touchstart');
      const raketeGedrueckt = state.tastenGedrueckt.k;
      for (let i = 0; i < 20; i++) Loop.simulationsSchritt();
      const yNachDash = state.y;
      const cd = state.raketenCooldown;
      const cdHoehe = parseFloat(document.getElementById('btn-rakete-cd').style.height);
      return { laserNachJoystick, sweepNachJoystick, laserLosgelassen, raketeGedrueckt, yNachDash, cd, cdHoehe };
    });
    expect(r.laserNachJoystick).toBe(true);
    expect(r.sweepNachJoystick).toEqual({ timer: 9, energie: 42, dash: 0 });
    expect(r.laserLosgelassen).toBe(false);
    expect(r.raketeGedrueckt).toBe(true);
    // Genau ein Dash nach oben (Stufe 1: 100 px), Button-Füllstand = Dash-Cooldown
    expect(r.yNachDash).toBeCloseTo(300, 5);
    expect(r.cd).toBe(160);
    expect(r.cdHoehe).toBeCloseTo(100 - 160 / 180 * 100, 3);

    // Viper: Joystick feuert weiter automatisch, Button heißt wieder R
    const viper = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      state.selectedShipModel = 'viper';
      Utils.updatePlayerShipVisuals();
      const zone = document.getElementById('joystick-zone');
      const t = new Touch({ identifier: 2, target: zone, clientX: 50, clientY: 850 });
      zone.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
      const anBeiBeruehrung = state.tastenGedrueckt.l;
      zone.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }));
      return { anBeiBeruehrung, ausDanach: state.tastenGedrueckt.l, label: document.querySelector('#btn-rakete span').textContent };
    });
    expect(viper).toEqual({ anBeiBeruehrung: true, ausDanach: false, label: 'R' });
  });

  test('Raketen-Button zeigt die Anzahl der Dash-Ladungen und den Ladefortschritt, nur bei der Gleve', async ({ page }) => {
    await page.locator('.hangar-model-btn[data-model="gleve"]').click();
    await page.tap('#start-text');
    await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
    const r = await page.evaluate(() => {
      const { state, arrays, Loop, Utils } = window.__game;
      ['feinde', 'asteroiden', 'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bosses', 'powerups'].forEach(name => {
        arrays[name].forEach(o => o.el && o.el.remove());
        arrays[name].length = 0;
      });
      state.frameZaehler = 1;
      state.raketenStufe = 1;
      state.raketenCooldown = 0;
      state.gleveDashLadungen = 2;
      state.gleveDashTasteGehalten = false;
      state.y = 500;
      const zahl = document.getElementById('btn-rakete-ladungen');
      const fuellung = document.getElementById('btn-rakete-cd');
      const lies = () => ({ text: zahl.textContent, sichtbar: getComputedStyle(zahl).display !== 'none', hoehe: parseFloat(fuellung.style.height) });
      Loop.simulationsSchritt();
      const voll = lies();
      state.tastenGedrueckt.k = true;
      for (let i = 0; i < 12; i++) Loop.simulationsSchritt();
      state.tastenGedrueckt.k = false;
      Loop.simulationsSchritt();
      const nachDash = lies();
      state.selectedShipModel = 'viper';
      Utils.updateSchiffHudLabels();
      const viper = lies();
      return { voll, nachDash, viper };
    });
    expect(r.voll).toEqual({ text: '2', sichtbar: true, hoehe: 100 });
    expect(r.nachDash.text).toBe('1');
    expect(r.nachDash.hoehe).toBeLessThan(100);
    expect(r.viper).toMatchObject({ text: '', sichtbar: false });
  });

  test('Online-Client: Raketen-Button-Beschriftung folgt dem eigenen Schiff (P2)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      const alt = { mode: state.gameMode, isClient: state.network.isClient, p2: state.p2.selectedShipModel };
      const label = () => document.querySelector('#btn-rakete span').textContent;
      state.selectedShipModel = 'viper';
      state.gameMode = 'online';
      state.network.isClient = true;
      state.p2.selectedShipModel = 'gleve';
      Utils.updateSchiffHudLabels();
      const clientGleve = { modell: Utils.lokalesSchiffModell(), label: label() };
      state.p2.selectedShipModel = 'phantom';
      Utils.updateSchiffHudLabels();
      const clientPhantom = label();
      state.gameMode = alt.mode;
      state.network.isClient = alt.isClient;
      state.p2.selectedShipModel = alt.p2;
      return { clientGleve, clientPhantom };
    });
    expect(r.clientGleve).toEqual({ modell: 'gleve', label: 'D' });
    expect(r.clientPhantom).toBe('R');
  });
});
