const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

// Spectre-SR (sniper): Grundlage (Auswahl, Anzeige, HUD) und Fadenkreuz-Schuss (S2).

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.route('**/api/turn*', route => route.fulfill({ status: 503, body: '' }));
  await setzeSpielstand(page);
  await page.goto('/');
});

async function startePerTaste(page) {
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
  await page.keyboard.up('KeyW');
}

test('Spectre-SR: im Hangar waehlbar, Name und Perks aus shipModels, Railgun-SVG, Werfer-Pods aus, HUD GRANATE', async ({ page }) => {
  const btn = page.locator('.hangar-model-btn[data-model="sniper"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(btn).toHaveClass(/active/);

  const werte = await page.evaluate(() => {
    const { state, shipModels } = window.__game;
    const m = shipModels.sniper;
    return { model: state.selectedShipModel, name: m.name, speed: m.speed, regen: m.energyRegen, perks: m.perks.map(p => p.label) };
  });
  expect(werte.model).toBe('sniper');
  expect(werte.speed).toBe(4.5);
  expect(werte.regen).toBe(0.45);
  expect(werte.perks).toHaveLength(5);
  await expect(page.locator('#hangar-ship-name')).toContainText(werte.name);
  await expect(page.locator('#hangar-ship-perks .hangar-perk-chip')).toHaveCount(werte.perks.length);
  for (let i = 0; i < werte.perks.length; i++) {
    await page.locator('#hangar-ship-perks .hangar-perk-chip').nth(i).click();
    await expect(page.locator('#hangar-perk-detail')).toContainText(werte.perks[i]);
  }
  expect(await page.locator('#hangar-preview-svg').evaluate(el => el.innerHTML)).toContain('Railgun');

  await startePerTaste(page);

  expect(await page.locator('#spieler svg').evaluate(el => el.innerHTML)).toContain('Railgun');
  await expect(page.locator('#energie-cd-container .cooldown-letter')).toHaveText('E');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('GRANATE');
  await expect(page.locator('#btn-rakete span')).toHaveText('G');

  // Pods bleiben auch bei hoher Raketenstufe aus, ohne Abwurf-Effekt
  const abwurf = await page.evaluate(() => {
    const { state, Utils } = window.__game;
    state.raketenStufe = 5;
    Utils.updateAktivePowerupsUI();
    state.raketenStufe = 1;
    Utils.updateAktivePowerupsUI();
    return document.querySelectorAll('.werfer-abgeworfen').length;
  });
  expect(abwurf).toBe(0);
  for (const pod of ['links', 'rechts', 'center']) {
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
  const modelle = await page.evaluate(() => ({ p1: window.__game.state.selectedShipModel, p2: window.__game.state.p2.selectedShipModel }));
  expect(modelle).toEqual({ p1: 'viper', p2: 'sniper' });
  await expect(page.locator('#raketen-cd-container-p2 .cooldown-letter')).toHaveText('GRANATE');
  await expect(page.locator('#energie-cd-container-p2 .cooldown-letter')).toHaveText('E');
  await expect(page.locator('#raketen-cd-container .cooldown-letter')).toHaveText('R');
  expect(await page.locator('#spieler-2 svg').evaluate(el => el.innerHTML)).toContain('Railgun');

  const badge = await page.evaluate(() => {
    window.__game.Utils.renderHighscoresTable('single', [{ name: 'AAA', score: 100, level: 1, shipP1: 'sniper', country: '', city: '' }]);
    const b = document.querySelector('#highscore-body [class*="hs-ship-"]');
    return b ? { klasse: b.className, text: b.textContent } : null;
  });
  expect(badge).not.toBeNull();
  expect(badge.klasse).toContain('hs-ship-sniper');
  expect(badge.klasse).not.toContain('hs-ship-viper');
});

test('Spectre-SR: Coop mit Bot und Dauerfeuer laeuft ohne Fehler und ohne normale Laserprojektile', async ({ page }) => {
  const fehler = [];
  page.on('pageerror', e => fehler.push(e.message));
  await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
  await page.locator('.hangar-player-tab[data-player="p2"]').click();
  await page.locator('.hangar-model-btn[data-model="sniper"]').click();
  await page.locator('.hangar-player-tab[data-player="p1"]').click();
  await page.locator('.hangar-model-btn[data-model="sniper"]').click();
  await page.evaluate(() => { window.__game.state.p2IsBot = true; });
  await startePerTaste(page);
  const ergebnis = await page.evaluate(() => {
    const { state, arrays, Loop } = window.__game;
    state.godMode = true;
    state.tastenGedrueckt.l = true;
    state.tastenGedrueckt.k = true;
    let laser = 0;
    for (let i = 0; i < 900; i++) {
      Loop.simulationsSchritt();
      laser = Math.max(laser, arrays.laserArray.length);
    }
    return { laser, p1: state.selectedShipModel, p2: state.p2.selectedShipModel };
  });
  expect(ergebnis.laser).toBe(0);
  expect(ergebnis.p1).toBe('sniper');
  expect(ergebnis.p2).toBe('sniper');
  expect(fehler).toEqual([]);
});

test('Spectre-SR: Menue bleibt mit vier Hangar-Knoepfen einzeilig und ohne Scrollen', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  const m = await page.evaluate(() => {
    const start = document.getElementById('start-screen');
    const knoepfe = [...document.querySelectorAll('.hangar-model-btn')].map(b => ({
      top: Math.round(b.getBoundingClientRect().top), ueberlaeuft: b.scrollWidth > b.clientWidth
    }));
    return { anzahl: knoepfe.length, tops: new Set(knoepfe.map(k => k.top)).size, ueberlaeuft: knoepfe.some(k => k.ueberlaeuft), scroll: start.scrollHeight - start.clientHeight };
  });
  expect(m.anzahl).toBe(4);
  expect(m.tops).toBe(1);
  expect(m.ueberlaeuft).toBe(false);
  expect(m.scroll).toBeLessThanOrEqual(0);
});

// ---------------------------------------------------------------------------------------------
// Fadenkreuz + Schuss (S2). Aufbau, simulationsSchritt()-Aufrufe und Auswertung laufen je Test in
// einem synchronen page.evaluate-Block, damit nichts zwischendurch dazwischenfunkt.

async function starteSniper(page, { coop = false } = {}) {
  if (coop) {
    await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
    await page.locator('.hangar-player-tab[data-player="p2"]').click();
    await page.locator('.hangar-model-btn[data-model="sniper"]').click();
    await page.locator('.hangar-player-tab[data-player="p1"]').click();
  }
  await page.locator('.hangar-model-btn[data-model="sniper"]').click();
  await startePerTaste(page);
  await page.evaluate(() => {
    const { Entities, arrays, state } = window.__game;
    window.__sn = {
      // Ausgangslage: leeres Feld, Schiff bei (185|400) -> Fadenkreuz-Mitte (200|180); P2 bei (385|400) -> (400|180)
      leeren() {
        ['feinde', 'asteroiden', 'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bossBombenArray',
          'bossRaketenArray', 'bosses', 'powerups', 'laserArray', 'raketenArray'].forEach(name => {
          arrays[name].forEach(o => o.el && o.el.remove());
          arrays[name].length = 0;
        });
        Object.keys(state.tastenGedrueckt).forEach(k => { state.tastenGedrueckt[k] = false; });
        state.frameZaehler = 1;
        state.level = 1;
        state.bossAktiv = false;
        state.hacks = [];
        state.godMode = true;
        state.p2IsBot = false;
        for (const s of [state, state.p2]) {
          s.maxEnergie = 50;
          s.energie = 50;
          s.laserStufe = 1;
          s.schildStufe = 0;
          s.leben = 3;
          s.isDead = false;
          s.invulnerableTimer = 0;
          s.unbegrenzteEnergie = false;
          s.sniperZielX = null;
          s.sniperZielY = null;
          s.sniperCooldown = 0;
          s.hacks = [];
        }
        state.x = 185; state.y = 400;
        state.p2.x = 385; state.p2.y = 400;
      },
      // Feind mit Mitte (cx|cy), ruhend, schiesst nicht, viel Leben
      feind(cx, cy, hp = 1000) {
        Entities.erzeugeFeind(cx - 15, cy - 15, 'normal', 0, false);
        const f = arrays.feinde[arrays.feinde.length - 1];
        Object.assign(f, { vx: 0, vy: 0, hp, maxHp: hp, schussTimer: 999999, festX: f.x, festY: f.y });
        return f;
      },
      asteroid(cx, cy, groesse = 30, magma = false) {
        Entities.erzeugeAsteroid(cx - groesse / 2, cy - groesse / 2, groesse, 0, 0, 0, true);
        const a = arrays.asteroiden[arrays.asteroiden.length - 1];
        a.hp = a.maxHp = 1000;
        a.vRot = 0;
        a.festX = a.x;
        a.festY = a.y;
        if (magma) { a.istUnzerstoerbar = true; a.istMagma = true; }
        return a;
      },
      // Feinde und Asteroiden werden nach jedem Schritt an ihren Platz zurueckgesetzt (Pendeln/Fallen stoert die Messung)
      schritte(n) {
        for (let i = 0; i < n; i++) {
          window.__game.Loop.simulationsSchritt();
          [...arrays.feinde, ...arrays.asteroiden].forEach(o => {
            if (o.festX === undefined) return;
            o.x = o.festX; o.y = o.festY;
            o.el.style.left = o.x + 'px'; o.el.style.top = o.y + 'px';
          });
        }
      }
    };
  });
}

test.describe('Spectre-SR Fadenkreuz', () => {
  test('Fadenkreuz steht 220 px ueber dem Schiff, folgt ihm und ist am oberen Rand begrenzt', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      T.schritte(1);
      const a = { x: state.sniperZielX, y: state.sniperZielY, el: document.querySelectorAll('.sniper-fadenkreuz').length };
      state.x = 85; state.y = 350;
      T.schritte(1);
      const b = { x: state.sniperZielX, y: state.sniperZielY };
      state.y = 100;
      T.schritte(1);
      const c = { y: state.sniperZielY };
      state.y = 400; state.x = 185;
      T.schritte(1);
      const k = document.querySelector('.sniper-fadenkreuz');
      const rad = parseFloat(k.style.width) / 2;
      return { a, b, c, mitteX: parseFloat(k.style.left) + rad, mitteY: parseFloat(k.style.top) + rad, rad, farbe: k.style.borderColor, striche: k.querySelectorAll('.sniper-strich').length };
    });
    expect(r.a).toEqual({ x: 200, y: 180, el: 1 });
    expect(r.b).toEqual({ x: 100, y: 130 });
    expect(r.c.y).toBe(0);
    expect(r.mitteX).toBe(200);
    expect(r.mitteY).toBe(180);
    expect(r.rad).toBe(6); // Stufe 1
    expect(r.farbe).not.toBe('');
    expect(r.striche).toBe(4);
  });

  test('Radius waechst mit der Laser-Stufe (6/14/22/22/30)', async ({ page }) => {
    await starteSniper(page);
    const radien = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      const out = [];
      for (let stufe = 1; stufe <= 5; stufe++) {
        state.laserStufe = stufe;
        T.schritte(1);
        out.push(parseFloat(document.querySelector('.sniper-fadenkreuz').style.width) / 2);
      }
      return out;
    });
    expect(radien).toEqual([6, 14, 22, 22, 30]);
  });

  test('Fadenkreuz verschwindet bei Tod, Game Over und Neustart; Nicht-Sniper hat keins', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      const T = window.__sn;
      T.leeren();
      T.schritte(2);
      const da = document.querySelectorAll('.sniper-fadenkreuz').length;
      state.isDead = true;
      T.schritte(1);
      const tot = document.querySelectorAll('.sniper-fadenkreuz').length;
      state.isDead = false;
      T.schritte(1);
      const wieder = document.querySelectorAll('.sniper-fadenkreuz').length;
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      const strahl = document.querySelectorAll('.sniper-strahl').length;
      Utils.triggerGameOver();
      const gameOver = document.querySelectorAll('.sniper-fadenkreuz, .sniper-strahl').length;
      Utils.restartGame();
      const neustart = document.querySelectorAll('.sniper-fadenkreuz, .sniper-strahl').length;
      return { da, tot, wieder, strahl, gameOver, neustart, zielX: state.sniperZielX };
    });
    expect(r).toEqual({ da: 1, tot: 0, wieder: 1, strahl: 1, gameOver: 0, neustart: 0, zielX: null });
  });
});

test.describe('Spectre-SR Schuss', () => {
  test('trifft den Feind im Kreis, NICHT den zwischen Schiff und Fadenkreuz, NICHT einen knapp ausserhalb des Radius', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      // Jeder Fall einzeln (Stufe 1 trifft sonst nur das naechste Ziel und verdeckt die anderen)
      const trifft = (cx, cy) => {
        T.leeren();
        const f = T.feind(cx, cy);
        state.tastenGedrueckt.l = true;
        T.schritte(1);
        return f.hp;
      };
      const zwischen = trifft(200, 300); // direkt auf der Schusslinie, aber nicht im Kreis
      const aussen = trifft(200 + 15 + 6 + 2, 180); // Box beginnt 8 px neben der Mitte (Radius 6)
      const innen = trifft(200 - 15 - 6 + 2, 180); // Box endet 4 px neben der Mitte
      return { zwischen, aussen, innen, laser: window.__game.arrays.laserArray.length };
    });
    expect(r.zwischen).toBe(1000);
    expect(r.aussen).toBe(1000);
    expect(r.innen).toBe(970);
    expect(r.laser).toBe(0);
  });

  test('Schuss erzeugt einen Strahl zum Fadenkreuz, der in wenigen Schritten verblasst', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      state.tastenGedrueckt.l = false;
      const strahl = document.querySelector('.sniper-strahl');
      const hoehe = parseFloat(strahl.style.height);
      let schritte = 0;
      while (document.querySelector('.sniper-strahl') && schritte < 30) { T.schritte(1); schritte++; }
      return { hoehe, schritte };
    });
    expect(r.hoehe).toBeCloseTo(220, 5);
    expect(r.schritte).toBeGreaterThan(2);
    expect(r.schritte).toBeLessThanOrEqual(12);
  });

  test('Stufe 1-2 treffen nur das Ziel mit der Mitte am naechsten am Fadenkreuz, Stufe 3 beide', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const out = {};
      for (const stufe of [1, 2, 3]) {
        T.leeren();
        state.laserStufe = stufe;
        const naher = T.feind(200 - 14, 180);
        const ferner = T.feind(200 + 20, 180);
        state.tastenGedrueckt.l = true;
        T.schritte(1);
        out[stufe] = { naher: naher.hp, ferner: ferner.hp };
      }
      return out;
    });
    expect(r[1]).toEqual({ naher: 970, ferner: 1000 });
    expect(r[2]).toEqual({ naher: 965, ferner: 1000 });
    expect(r[3]).toEqual({ naher: 960, ferner: 960 });
  });

  test('Schaden je Stufe 30/35/40/45/50', async ({ page }) => {
    await starteSniper(page);
    const schaden = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const out = [];
      for (let stufe = 1; stufe <= 5; stufe++) {
        T.leeren();
        state.laserStufe = stufe;
        const f = T.feind(200, 180);
        state.tastenGedrueckt.l = true;
        T.schritte(1);
        out.push(1000 - f.hp);
      }
      return out;
    });
    expect(schaden).toEqual([30, 35, 40, 45, 50]);
  });

  test('Schussabstand je Stufe 24/21/21/18/18 Schritte bei gehaltener Taste', async ({ page }) => {
    await starteSniper(page);
    const abstaende = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const out = [];
      for (let stufe = 1; stufe <= 5; stufe++) {
        T.leeren();
        state.laserStufe = stufe;
        state.unbegrenzteEnergie = true;
        const f = T.feind(200, 180);
        state.tastenGedrueckt.l = true;
        const zeiten = [];
        let hp = f.hp;
        for (let i = 1; i <= 90; i++) {
          T.schritte(1);
          if (f.hp < hp) { zeiten.push(i); hp = f.hp; }
        }
        out.push(zeiten.slice(1).map((z, i) => z - zeiten[i]));
      }
      return out;
    });
    const erwartet = [24, 21, 21, 18, 18];
    abstaende.forEach((liste, i) => {
      expect(liste.length).toBeGreaterThanOrEqual(2);
      expect(new Set(liste)).toEqual(new Set([erwartet[i]]));
    });
  });

  test('Energie: 6 pro Schuss, ohne genug Energie kein Schuss', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      const f = T.feind(200, 180);
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      const nachSchuss = state.energie; // 50 - 6 + Regeneration 0,45
      // zu wenig Energie
      T.leeren();
      const g = T.feind(200, 180);
      state.energie = 5.3;
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      const zuWenig = { hp: g.hp, energie: state.energie };
      let schritteBisSchuss = 1;
      while (g.hp === 1000 && schritteBisSchuss < 10) { T.schritte(1); schritteBisSchuss++; }
      return { nachSchuss, hp: f.hp, zuWenig, schritteBisSchuss };
    });
    expect(r.hp).toBe(970);
    expect(r.nachSchuss).toBeCloseTo(44.45, 5);
    expect(r.zuWenig.hp).toBe(1000);
    expect(r.zuWenig.energie).toBeCloseTo(5.75, 5); // nur normale Regeneration
    expect(r.schritteBisSchuss).toBe(3); // 5,3 -> 5,75 -> 6,2 -> Schuss im 3. Schritt
  });

  test('Schild zuerst, Magma unversehrt (und zieht den Schuss nicht an), Kill gibt Punkte', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__sn;
      T.leeren();
      const f = T.feind(200, 180);
      f.schildHp = f.maxSchildHp = 100;
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      const schild = { schild: f.schildHp, hp: f.hp };

      // Magma genau im Fadenkreuz, Feind am Rand des Kreises (Stufe 3): beide Ziele zaehlen, nur der Feind wird getroffen
      T.leeren();
      state.laserStufe = 3;
      const magma = T.asteroid(200, 180, 30, true);
      const ziel = T.feind(200 + 17, 180);
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      const mag = { magma: magma.hp, ziel: ziel.hp };

      // Stufe 1 mit Magma genau im Fadenkreuz und Feind am Rand: Feind wird trotzdem getroffen
      T.leeren();
      const magma1 = T.asteroid(200, 180, 30, true);
      const ziel1 = T.feind(200 + 15 + 5, 180);
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      const mag1 = { magma: magma1.hp, ziel: ziel1.hp };

      // Kill
      T.leeren();
      const opfer = T.feind(200, 180, 20);
      const punkte = state.score;
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      return { schild, mag, mag1, tot: !arrays.feinde.includes(opfer), punkte: state.score - punkte };
    });
    expect(r.schild).toEqual({ schild: 70, hp: 1000 });
    expect(r.mag).toEqual({ magma: 1000, ziel: 960 });
    expect(r.mag1).toEqual({ magma: 1000, ziel: 970 });
    expect(r.tot).toBe(true);
    expect(r.punkte).toBeGreaterThan(0);
  });

  test('Asteroiden im Kreis werden getroffen', async ({ page }) => {
    await starteSniper(page);
    const hp = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      const a = T.asteroid(200, 180);
      state.tastenGedrueckt.l = true;
      T.schritte(1);
      return a.hp;
    });
    expect(hp).toBe(970);
  });

  test('keine normalen Laserprojektile und kein Hitscan, auch auf Stufe 5', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__sn;
      T.leeren();
      state.laserStufe = 5;
      state.tastenGedrueckt.l = true;
      let max = 0;
      for (let i = 0; i < 120; i++) { T.schritte(1); max = Math.max(max, arrays.laserArray.length); }
      return { max, hitscan: getComputedStyle(document.getElementById('hitscan-laser')).display };
    });
    expect(r.max).toBe(0);
    expect(r.hitscan).toBe('none');
  });
});

test.describe('Spectre-SR Auto-Zielen', () => {
  test('Stufe 4 gleitet zum naechsten Feind (nicht zum naeheren Asteroiden), ohne Ziel zurueck', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      state.laserStufe = 4;
      T.schritte(1);
      const start = { x: state.sniperZielX, y: state.sniperZielY };
      T.asteroid(200, 175); // nah am Fadenkreuz, aber ein Asteroid
      const f = T.feind(110, 160);
      T.schritte(1);
      const schritt1 = Math.hypot(state.sniperZielX - start.x, state.sniperZielY - start.y);
      T.schritte(30);
      const erreicht = { x: state.sniperZielX, y: state.sniperZielY };
      // Feind weg: zurueck zur Grundposition
      f.el.remove();
      window.__game.arrays.feinde.length = 0;
      T.schritte(60);
      const zurueck = { x: state.sniperZielX, y: state.sniperZielY };
      return { start, schritt1, erreicht, zurueck };
    });
    expect(r.start).toEqual({ x: 200, y: 180 });
    expect(r.schritt1).toBeCloseTo(6, 5);
    expect(r.erreicht.x).toBeCloseTo(110, 5);
    expect(r.erreicht.y).toBeCloseTo(160, 5);
    expect(r.zurueck.x).toBeCloseTo(200, 5);
    expect(r.zurueck.y).toBeCloseTo(180, 5);
  });

  test('Stufe 5 gleitet mit 10 px/Schritt; Stufe 3 nicht; Ziele ausser Reichweite oder unter dem Schiff zaehlen nicht', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const out = {};
      T.leeren();
      state.laserStufe = 5;
      T.schritte(1);
      T.feind(110, 160);
      T.schritte(1);
      out.stufe5 = Math.hypot(state.sniperZielX - 200, state.sniperZielY - 180);

      T.leeren();
      state.laserStufe = 3;
      T.schritte(1);
      T.feind(110, 160);
      T.schritte(10);
      out.stufe3 = { x: state.sniperZielX, y: state.sniperZielY };

      T.leeren();
      state.laserStufe = 4;
      T.schritte(1);
      T.feind(185, 60); // 340 px entfernt: ausser Reichweite
      T.feind(100, 450); // unter dem Schiff
      T.schritte(10);
      out.keinZiel = { x: state.sniperZielX, y: state.sniperZielY };
      return out;
    });
    expect(r.stufe5).toBeCloseTo(10, 5);
    expect(r.stufe3).toEqual({ x: 200, y: 180 });
    expect(r.keinZiel).toEqual({ x: 200, y: 180 });
  });

  test('Stufe 4 nimmt den seitlich versetzten Feind unter Feuer', async ({ page }) => {
    await starteSniper(page);
    const hp = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      state.laserStufe = 4;
      state.unbegrenzteEnergie = true;
      const f = T.feind(110, 160);
      state.tastenGedrueckt.l = true;
      T.schritte(40);
      return f.hp;
    });
    expect(hp).toBeLessThan(1000);
  });
});

test.describe('Spectre-SR Coop', () => {
  test('P2 hat eigenes Fadenkreuz, schiesst mit seiner Taste; P1 (Viper) bleibt ohne Fadenkreuz', async ({ page }) => {
    await starteSniper(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__sn;
      T.leeren();
      state.selectedShipModel = 'viper';
      window.__game.Utils.updatePlayerShipVisuals();
      state.p2.selectedShipModel = 'sniper';
      document.querySelectorAll('.sniper-fadenkreuz').forEach(el => el.remove()); // Rest von P1 vor dem Modellwechsel
      const f = T.feind(400, 180);
      const g = T.feind(200, 180);
      T.schritte(1);
      const ohneTaste = f.hp;
      state.tastenGedrueckt['ä'] = true;
      T.schritte(1);
      const p2 = { x: state.p2.sniperZielX, y: state.p2.sniperZielY, hp: f.hp, energie: state.p2.energie, anzahl: document.querySelectorAll('.sniper-fadenkreuz').length };
      return { ohneTaste, p2, gHp: g.hp, laser: arrays.laserArray.length, p1Ziel: state.sniperZielX };
    });
    expect(r.ohneTaste).toBe(1000);
    expect(r.p2.x).toBe(400);
    expect(r.p2.y).toBe(180);
    expect(r.p2.hp).toBe(970);
    expect(r.p2.energie).toBeCloseTo(44.45, 5);
    expect(r.p2.anzahl).toBe(1);
    expect(r.gHp).toBe(1000);
    expect(r.laser).toBe(0);
    expect(r.p1Ziel).toBeNull();
  });

  test('beide Sniper: zwei Fadenkreuze, P1 mit B, P2 mit Punkt; P2-Tod entfernt nur sein Fadenkreuz', async ({ page }) => {
    await starteSniper(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      const f1 = T.feind(200, 180);
      const f2 = T.feind(400, 180);
      state.tastenGedrueckt.b = true;
      T.schritte(1);
      const nurP1 = { f1: f1.hp, f2: f2.hp, anzahl: document.querySelectorAll('.sniper-fadenkreuz').length };
      state.tastenGedrueckt.b = false;
      state.tastenGedrueckt['.'] = true;
      T.schritte(1);
      const dannP2 = { f1: f1.hp, f2: f2.hp };
      state.p2.isDead = true;
      T.schritte(1);
      return { nurP1, dannP2, nachTod: document.querySelectorAll('.sniper-fadenkreuz').length };
    });
    expect(r.nurP1).toEqual({ f1: 970, f2: 1000, anzahl: 2 });
    expect(r.dannP2).toEqual({ f1: 970, f2: 970 });
    expect(r.nachTod).toBe(1);
  });
});
