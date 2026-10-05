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
        arrays.sniperMinen.forEach(m => m.el && m.el.remove());
        arrays.sniperMinen.length = 0;
        document.querySelectorAll('.sniper-mine, .sniper-mine-explosion').forEach(e => e.remove());
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
          s.sniperGehalten = false;
          s.sniperLadung = 0;
          s.sniperVoll = false;
          s.hacks = [];
        }
        state.joystick.feuert = false;
        state.joystick.active = false;
        state.sniperLadeKnopf = false;
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
      // Taste n Schritte halten, loslassen und einen Schritt weiter (der Schuss faellt beim Loslassen)
      tippe(n = 1, taste = 'l') {
        state.tastenGedrueckt[taste] = true;
        this.schritte(n);
        state.tastenGedrueckt[taste] = false;
        this.schritte(1);
      },
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
      T.tippe();
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
        T.tippe();
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
      T.tippe();
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
        T.tippe();
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
        T.tippe();
        out.push(1000 - f.hp);
      }
      return out;
    });
    expect(schaden).toEqual([30, 35, 40, 45, 50]);
  });

  test('Schussabstand je Stufe 24/21/21/18/18 Schritte (Sperre zwischen den Schuessen)', async ({ page }) => {
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
        const zeiten = [];
        let hp = f.hp;
        for (let i = 1; i <= 90; i++) {
          // Halten (laden), im ersten Schritt ohne Sperre loslassen, im naechsten gleich wieder druecken
          state.tastenGedrueckt.l = !(state.sniperGehalten && state.sniperCooldown <= 1);
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
      T.tippe();
      const nachSchuss = state.energie; // 50 - 6 + Regeneration 0,45 (nur im Loslass-Schritt, waehrend des Haltens keine)
      // zu wenig Energie
      T.leeren();
      const g = T.feind(200, 180);
      state.energie = 5.3;
      T.tippe();
      const zuWenig = { hp: g.hp, energie: state.energie };
      let tipper = 1;
      while (g.hp === 1000 && tipper < 10) { T.tippe(); tipper++; }
      return { nachSchuss, hp: f.hp, zuWenig, tipper };
    });
    expect(r.hp).toBe(970);
    expect(r.nachSchuss).toBeCloseTo(44.45, 5);
    expect(r.zuWenig.hp).toBe(1000);
    expect(r.zuWenig.energie).toBeCloseTo(5.75, 5); // nur normale Regeneration (im Loslass-Schritt)
    expect(r.tipper).toBe(3); // 5,3 -> 5,75 -> 6,2 -> Schuss beim 3. Tippen
  });

  test('Schild zuerst, Magma unversehrt (und zieht den Schuss nicht an), Kill gibt Punkte', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__sn;
      T.leeren();
      const f = T.feind(200, 180);
      f.schildHp = f.maxSchildHp = 100;
      T.tippe();
      const schild = { schild: f.schildHp, hp: f.hp };

      // Magma genau im Fadenkreuz, Feind am Rand des Kreises (Stufe 3): beide Ziele zaehlen, nur der Feind wird getroffen
      T.leeren();
      state.laserStufe = 3;
      const magma = T.asteroid(200, 180, 30, true);
      const ziel = T.feind(200 + 17, 180);
      T.tippe();
      const mag = { magma: magma.hp, ziel: ziel.hp };

      // Stufe 1 mit Magma genau im Fadenkreuz und Feind am Rand: Feind wird trotzdem getroffen
      T.leeren();
      const magma1 = T.asteroid(200, 180, 30, true);
      const ziel1 = T.feind(200 + 15 + 5, 180);
      T.tippe();
      const mag1 = { magma: magma1.hp, ziel: ziel1.hp };

      // Kill
      T.leeren();
      const opfer = T.feind(200, 180, 20);
      const punkte = state.score;
      T.tippe();
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
      T.tippe();
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
      T.schritte(40);
      T.tippe();
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
      T.tippe(1, 'ä');
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
      T.tippe(1, 'b');
      const nurP1 = { f1: f1.hp, f2: f2.hp, anzahl: document.querySelectorAll('.sniper-fadenkreuz').length };
      T.tippe(1, '.');
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

// ---------------------------------------------------------------------------------------------
// Aufladen (S3): Druck startet Laden, Loslassen feuert. Haltedauer unter 10 Schritten = Normalschuss, sonst Ladeschuss
// (Schaden x1..x4, Radius x1..x1,5 bei 90 Schritten; voll: alle Ziele im Kreis, Schild ignoriert).

test.describe('Spectre-SR Aufladen', () => {
  test('Tippen (5 Schritte) ist ein Normalschuss; ein gehaltener Schuss faellt erst beim Loslassen', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      const f = T.feind(200, 180);
      state.tastenGedrueckt.l = true;
      T.schritte(5);
      const waehrendHalten = f.hp;
      state.tastenGedrueckt.l = false;
      T.schritte(1);
      const normal = 1000 - f.hp;
      const strahlBreite = parseFloat(document.querySelector('.sniper-strahl').style.width);

      // Genau 9 Schritte gehalten = noch Normalschuss, 10 Schritte = schon geladen
      T.leeren();
      const g = T.feind(200, 180);
      T.tippe(9);
      const neun = 1000 - g.hp;
      T.leeren();
      const h = T.feind(200, 180);
      T.tippe(10);
      const zehn = 1000 - h.hp;
      return { waehrendHalten, normal, strahlBreite, neun, zehn };
    });
    expect(r.waehrendHalten).toBe(1000);
    expect(r.normal).toBe(30);
    expect(r.strahlBreite).toBe(3);
    expect(r.neun).toBe(30);
    expect(r.zehn).toBeGreaterThan(30);
  });

  test('Halten 45 Schritte: Schaden Faktor 2,5, Radius noch kaum groesser', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      const f = T.feind(200, 180);
      T.tippe(45);
      const schaden = 1000 - f.hp;
      // Stufe 3 (Schaden 40): ebenfalls Faktor 2,5
      T.leeren();
      state.laserStufe = 3;
      const g = T.feind(200, 180);
      T.tippe(45);
      const stufe3 = 1000 - g.hp;
      // Radius bei 45 Schritten: 6 x 1,25 = 7,5 -> Feind mit Kante 8 px neben der Mitte wird (noch) nicht getroffen
      T.leeren();
      const h = T.feind(200 + 15 + 8, 180);
      T.tippe(45);
      return { schaden, stufe3, aussen: h.hp, breite: parseFloat(document.querySelector('.sniper-strahl').style.width) };
    });
    expect(r.schaden).toBeCloseTo(75, 5);
    expect(r.stufe3).toBeCloseTo(100, 5);
    expect(r.aussen).toBe(1000);
    expect(r.breite).toBeGreaterThan(3);
    expect(r.breite).toBeLessThan(12);
  });

  test('Halten 90 Schritte: Faktor 4, Radius 1,5x, Schild wird ignoriert, alle Ziele im Kreis auch auf Stufe 1', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const out = {};
      T.leeren();
      const f = T.feind(200, 180);
      T.tippe(90);
      out.schaden = 1000 - f.hp;
      out.breite = parseFloat(document.querySelector('.sniper-strahl').style.width);

      // Ziel knapp ausserhalb des normalen Radius 6 (Kante 8 px neben der Mitte), innerhalb von 9
      T.leeren();
      const knapp = T.feind(200 + 15 + 8, 180);
      T.tippe(90);
      out.knapp = 1000 - knapp.hp;
      T.leeren();
      const knapp2 = T.feind(200 + 15 + 8, 180);
      T.tippe(1);
      out.knappNormal = 1000 - knapp2.hp;
      // ausserhalb von 9: nicht getroffen
      T.leeren();
      const weit = T.feind(200 + 15 + 11, 180);
      T.tippe(90);
      out.weit = 1000 - weit.hp;

      // Schild ignorieren: Schild weg, volle Schadenswirkung auf hp
      T.leeren();
      const g = T.feind(200, 180);
      g.schildHp = g.maxSchildHp = 100;
      T.tippe(90);
      out.schildVoll = { schild: g.schildHp, hp: 1000 - g.hp, el: g.schildEl };
      // fast voll (89 Schritte): Schild zuerst
      T.leeren();
      const g2 = T.feind(200, 180);
      g2.schildHp = g2.maxSchildHp = 300;
      T.tippe(89);
      out.schildFast = { schild: g2.schildHp, hp: g2.hp };

      // Stufe 1: alle Ziele im Kreis; 89 Schritte nur das naechste
      T.leeren();
      const a = T.feind(200 - 6, 180);
      const b = T.feind(200 + 6, 180);
      const c = T.feind(200, 180 + 30);
      T.tippe(90);
      out.alle = [a, b, c].map(z => 1000 - z.hp);
      T.leeren();
      const a2 = T.feind(200 - 3, 180);
      const b2 = T.feind(200 + 8, 180);
      T.tippe(89);
      out.fast = [a2, b2].map(z => 1000 - z.hp);
      return out;
    });
    expect(r.schaden).toBeCloseTo(120, 5);
    expect(r.breite).toBeGreaterThan(10);
    expect(r.knapp).toBeCloseTo(120, 5);
    expect(r.knappNormal).toBe(0);
    expect(r.weit).toBe(0);
    expect(r.schildVoll.schild).toBe(0);
    expect(r.schildVoll.el).toBeNull();
    expect(r.schildVoll.hp).toBeCloseTo(120, 5);
    expect(r.schildFast.hp).toBe(1000);
    expect(r.schildFast.schild).toBeGreaterThan(0);
    expect(r.alle[0]).toBeCloseTo(120, 5);
    expect(r.alle[1]).toBeCloseTo(120, 5);
    expect(r.alle[2]).toBe(0); // Mitte 30 px darunter: Box beginnt 15 px unter dem Fadenkreuz, ausserhalb von 9
    expect(r.fast[0]).toBeGreaterThan(30);
    expect(r.fast[1]).toBe(0);
  });

  test('Energie: Tippen kostet 6, voll geladen 25; waehrend des Ladens keine Regeneration', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state, shipModels } = window.__game;
      const T = window.__sn;
      T.leeren();
      const regen = shipModels.sniper.energyRegen;
      shipModels.sniper.energyRegen = 1e-9; // 0 wuerde auf den Standard 0,4 zurueckfallen
      const out = {};
      T.feind(200, 180);
      T.tippe();
      out.tippen = 50 - state.energie;
      T.leeren();
      T.feind(200, 180);
      T.tippe(9);
      out.neun = 50 - state.energie;
      T.leeren();
      T.feind(200, 180);
      state.tastenGedrueckt.l = true;
      T.schritte(10);
      out.nachZehn = 50 - state.energie;
      T.schritte(40);
      out.nachFuenfzig = 50 - state.energie; // 40 Ladeschritte x 19/80
      T.schritte(40);
      out.nachVoll = 50 - state.energie;
      T.schritte(30);
      out.weiterGehalten = 50 - state.energie;
      state.tastenGedrueckt.l = false;
      T.schritte(1);
      out.voll = 50 - state.energie;

      // Regeneration: waehrend des Haltens keine, im Loslass-Schritt wieder
      shipModels.sniper.energyRegen = 0.45;
      T.leeren();
      state.energie = 30;
      state.tastenGedrueckt.l = true;
      T.schritte(30);
      out.regenHalten = state.energie;
      state.tastenGedrueckt.l = false;
      T.schritte(1);
      out.regenLoslassen = state.energie;
      shipModels.sniper.energyRegen = regen;
      return out;
    });
    expect(r.tippen).toBeCloseTo(6, 5);
    expect(r.neun).toBeCloseTo(6, 5);
    expect(r.nachZehn).toBeCloseTo(0, 5);
    expect(r.nachFuenfzig).toBeCloseTo(9.5, 5);
    expect(r.nachVoll).toBeCloseTo(19, 5);
    expect(r.weiterGehalten).toBeCloseTo(19, 5);
    expect(r.voll).toBeCloseTo(25, 5);
    expect(r.regenHalten).toBeCloseTo(30 - 19 * 20 / 80, 5);
    expect(r.regenLoslassen).toBeGreaterThan(r.regenHalten - 6 + 0.4);
  });

  test('bei wenig Energie bleibt die Ladung stehen; unter 6 Energie beim Loslassen faellt kein Schuss', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state, shipModels } = window.__game;
      const T = window.__sn;
      shipModels.sniper.energyRegen = 1e-9; // 0 wuerde auf den Standard 0,4 zurueckfallen
      const out = {};
      T.leeren();
      const f = T.feind(200, 180);
      state.energie = 12;
      state.tastenGedrueckt.l = true;
      T.schritte(50);
      out.ladung50 = state.sniperLadung;
      T.schritte(40);
      out.ladung90 = state.sniperLadung;
      out.energieGehalten = state.energie;
      state.tastenGedrueckt.l = false;
      T.schritte(1);
      out.schaden = 1000 - f.hp;
      out.energieNachSchuss = state.energie;
      out.faktor = out.schaden / 30;

      // Knapp unter 6 Energie: Ladung ueber 10 Schritte geht nicht, Loslassen = kein Schuss
      T.leeren();
      const g = T.feind(200, 180);
      state.energie = 5;
      T.tippe(30);
      out.zuWenig = { hp: g.hp, energie: state.energie, ladung: state.sniperLadung };
      shipModels.sniper.energyRegen = 0.45;
      return out;
    });
    expect(r.ladung50).toBeGreaterThanOrEqual(10);
    expect(r.ladung50).toBeLessThan(90);
    expect(r.ladung90).toBe(r.ladung50);
    expect(r.energieGehalten).toBeGreaterThanOrEqual(6);
    expect(r.schaden).toBeGreaterThan(30);
    expect(r.schaden).toBeLessThan(120);
    expect(r.faktor).toBeCloseTo(1 + 3 * r.ladung50 / 90, 5);
    expect(r.energieNachSchuss).toBeCloseTo(r.energieGehalten - 6, 5);
    expect(r.zuWenig.hp).toBe(1000);
    expect(r.zuWenig.energie).toBeCloseTo(5, 5);
    expect(r.zuWenig.ladung).toBe(0);
  });

  test('Tippen in der Schussabstand-Sperre wird vorgemerkt und feuert, sobald die Sperre abläuft', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state, shipModels } = window.__game;
      const T = window.__sn;
      shipModels.sniper.energyRegen = 1e-9; // 0 wuerde auf den Standard 0,4 zurueckfallen
      T.leeren();
      const f = T.feind(200, 180);
      T.tippe();
      const nachErstem = { hp: f.hp, energie: state.energie };
      T.tippe();
      // Zweiter Tipp in der Sperre: noch kein Schuss, keine Energie verbraucht
      const zweites = { hp: f.hp, energie: state.energie, sperre: state.sniperCooldown };
      T.schritte(zweites.sperre);
      const nachSperre = { hp: f.hp, energie: state.energie };
      shipModels.sniper.energyRegen = 0.45;
      return { nachErstem, zweites, nachSperre };
    });
    expect(r.nachErstem.hp).toBe(970);
    expect(r.zweites.sperre).toBeGreaterThan(0);
    expect(r.zweites.hp).toBe(970);
    expect(r.zweites.energie).toBeCloseTo(r.nachErstem.energie, 5);
    // Mit Ablauf der Sperre faellt der vorgemerkte Schuss und kostet dann Energie
    expect(r.nachSperre.hp).toBe(940);
    expect(r.nachSperre.energie).toBeCloseTo(r.nachErstem.energie - 6, 5);
  });

  test('Ladering waechst mit der Ladung und wird bei voller Ladung hervorgehoben; Ton genau einmal', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const T = window.__sn;
      T.leeren();
      Audio.clearAudioHistory();
      const ring = () => document.querySelector('.sniper-ladering');
      const daten = () => {
        const el = ring();
        return el ? { an: el.style.display !== 'none', breite: parseFloat(el.style.width), voll: el.classList.contains('voll') } : null;
      };
      const out = {};
      state.tastenGedrueckt.l = true;
      T.schritte(5);
      out.fuenf = daten();
      T.schritte(25);
      out.dreissig = daten();
      T.schritte(40);
      out.siebzig = daten();
      out.tonVorVoll = Audio.audioHistory.filter(e => e.name === 'sniperVoll').length;
      T.schritte(20);
      out.neunzig = daten();
      T.schritte(60);
      out.tonVoll = Audio.audioHistory.filter(e => e.name === 'sniperVoll').length;
      state.tastenGedrueckt.l = false;
      T.schritte(1);
      out.nachSchuss = daten();
      const schuss = Audio.audioHistory.filter(e => e.name === 'sniperSchuss');
      out.schussLadung = schuss.length ? schuss[schuss.length - 1].details.ladung : null;
      // zweiter Ladevorgang: wieder ein Ton
      T.schritte(30);
      state.unbegrenzteEnergie = true;
      T.tippe(100);
      out.tonZweiter = Audio.audioHistory.filter(e => e.name === 'sniperVoll').length;
      // Normalschuss ohne Ton
      Audio.clearAudioHistory();
      T.schritte(30);
      T.tippe(5);
      out.tonTippen = Audio.audioHistory.filter(e => e.name === 'sniperVoll').length;
      out.tippenLadung = Audio.audioHistory.filter(e => e.name === 'sniperSchuss').map(e => e.details.ladung);
      return out;
    });
    expect(r.fuenf.an).toBe(false);
    expect(r.dreissig.an).toBe(true);
    expect(r.siebzig.breite).toBeGreaterThan(r.dreissig.breite);
    expect(r.siebzig.voll).toBe(false);
    expect(r.tonVorVoll).toBe(0);
    expect(r.neunzig.voll).toBe(true);
    expect(r.neunzig.breite).toBeCloseTo(18, 5); // Radius 6 x 1,5 x 2
    expect(r.tonVoll).toBe(1);
    expect(r.nachSchuss.an).toBe(false);
    expect(r.schussLadung).toBe(1);
    expect(r.tonZweiter).toBe(2);
    expect(r.tonTippen).toBe(0);
    expect(r.tippenLadung).toEqual([0]);
  });

  test('Tod und Neustart setzen die Ladung zurueck', async ({ page }) => {
    await starteSniper(page);
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      const T = window.__sn;
      T.leeren();
      state.tastenGedrueckt.l = true;
      T.schritte(40);
      const geladen = state.sniperLadung;
      state.isDead = true;
      T.schritte(1);
      const nachTod = { ladung: state.sniperLadung, gehalten: state.sniperGehalten };
      state.isDead = false;
      T.schritte(1);
      const neu = state.sniperLadung; // Taste noch gehalten: Ladevorgang beginnt von vorn
      Utils.restartGame();
      return { geladen, nachTod, neu, nachNeustart: { ladung: state.sniperLadung, voll: state.sniperVoll, p2: state.p2.sniperLadung } };
    });
    expect(r.geladen).toBe(40);
    expect(r.nachTod).toEqual({ ladung: 0, gehalten: false });
    expect(r.neu).toBe(1);
    expect(r.nachNeustart).toEqual({ ladung: 0, voll: false, p2: 0 });
  });

  test('Coop: P2 laedt unabhaengig mit eigener Taste', async ({ page }) => {
    await starteSniper(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      T.leeren();
      const f = T.feind(400, 180);
      T.tippe(45, 'ä');
      return { hp: 1000 - f.hp, p1Ladung: state.sniperLadung };
    });
    expect(r.hp).toBeCloseTo(75, 5);
    expect(r.p1Ladung).toBe(0);
  });
});

test.describe('Spectre-SR Aufladen mobil', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  async function starteMobil(page, model) {
    await page.locator('.hangar-model-btn[data-model="' + model + '"]').click();
    await page.tap('#start-text');
    await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
  }

  test('Joystick-Feuer laedt nicht: Dauerfeuer aus Normalschuessen im Schussabstand', async ({ page }) => {
    await starteMobil(page, 'sniper');
    await expect(page.locator('#mobile-controls')).toBeVisible();
    const r = await page.evaluate(() => {
      const { state, arrays, Loop, Audio } = window.__game;
      ['feinde', 'asteroiden', 'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bosses', 'powerups'].forEach(name => {
        arrays[name].forEach(o => o.el && o.el.remove());
        arrays[name].length = 0;
      });
      state.frameZaehler = 1;
      state.godMode = true;
      state.maxEnergie = 50;
      state.energie = 50;
      state.laserStufe = 1;
      state.sniperCooldown = 0;
      state.x = 185;
      state.y = 400;
      window.__game.Entities.erzeugeFeind(185, 165, 'normal', 0, false);
      const f = arrays.feinde[arrays.feinde.length - 1];
      Object.assign(f, { vx: 0, vy: 0, hp: 1000, maxHp: 1000, schussTimer: 999999 });
      const festX = f.x, festY = f.y;
      Audio.clearAudioHistory();
      const zone = document.getElementById('joystick-zone');
      const t = new Touch({ identifier: 1, target: zone, clientX: 100, clientY: 800 });
      zone.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
      const zeiten = [];
      let hp = f.hp;
      let maxLadung = 0;
      for (let i = 1; i <= 100; i++) {
        Loop.simulationsSchritt();
        f.x = festX; f.y = festY;
        maxLadung = Math.max(maxLadung, state.sniperLadung);
        if (f.hp < hp) { zeiten.push({ i, schaden: hp - f.hp }); hp = f.hp; }
      }
      zone.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }));
      return { zeiten, maxLadung, voll: Audio.audioHistory.filter(e => e.name === 'sniperVoll').length, feuert: state.joystick.feuert };
    });
    expect(r.zeiten.length).toBeGreaterThanOrEqual(4);
    expect(r.zeiten.every(z => z.schaden === 30)).toBe(true);
    const abstaende = r.zeiten.slice(1).map((z, i) => z.i - r.zeiten[i].i);
    expect(new Set(abstaende)).toEqual(new Set([24]));
    expect(r.maxLadung).toBe(0);
    expect(r.voll).toBe(0);
    expect(r.feuert).toBe(false);
  });

  test('#btn-laden ist nur beim Sniper sichtbar; Halten laedt, Loslassen feuert', async ({ page }) => {
    await expect(page.locator('#btn-laden')).toBeHidden();
    await starteMobil(page, 'sniper');
    await expect(page.locator('#btn-laden')).toBeVisible();
    const sitztNebenRakete = await page.evaluate(() => {
      const a = document.getElementById('btn-laden').getBoundingClientRect();
      const b = document.getElementById('btn-rakete').getBoundingClientRect();
      const c = document.getElementById('btn-bombe').getBoundingClientRect();
      const breite = window.innerWidth;
      return a.right <= b.left && a.left >= 0 && b.right <= breite && c.left >= 0 && Math.abs(a.top - b.top) < 1;
    });
    expect(sitztNebenRakete).toBe(true);

    const r = await page.evaluate(() => {
      const { state, arrays, Loop, Audio } = window.__game;
      ['feinde', 'asteroiden', 'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bosses', 'powerups'].forEach(name => {
        arrays[name].forEach(o => o.el && o.el.remove());
        arrays[name].length = 0;
      });
      state.frameZaehler = 1;
      state.godMode = true;
      state.maxEnergie = 50;
      state.energie = 50;
      state.laserStufe = 1;
      state.sniperCooldown = 0;
      state.x = 185;
      state.y = 400;
      window.__game.Entities.erzeugeFeind(185, 165, 'normal', 0, false);
      const f = arrays.feinde[arrays.feinde.length - 1];
      Object.assign(f, { vx: 0, vy: 0, hp: 1000, maxHp: 1000, schussTimer: 999999 });
      const festX = f.x, festY = f.y;
      Audio.clearAudioHistory();
      const btn = document.getElementById('btn-laden');
      const beruehre = (typ) => {
        const t = new Touch({ identifier: 3, target: btn, clientX: btn.getBoundingClientRect().left + 20, clientY: btn.getBoundingClientRect().top + 20 });
        btn.dispatchEvent(new TouchEvent(typ, { touches: typ === 'touchstart' ? [t] : [], changedTouches: [t], bubbles: true, cancelable: true }));
      };
      const schritte = (n) => { for (let i = 0; i < n; i++) { Loop.simulationsSchritt(); f.x = festX; f.y = festY; } };
      beruehre('touchstart');
      const gedrueckt = state.sniperLadeKnopf;
      schritte(90);
      const waehrendHalten = { hp: f.hp, ladung: state.sniperLadung };
      beruehre('touchend');
      const losgelassen = state.sniperLadeKnopf;
      schritte(1);
      const schaden = 1000 - f.hp;

      // touchcancel feuert ebenfalls
      state.sniperCooldown = 0;
      beruehre('touchstart');
      schritte(30);
      const hpVorher = f.hp;
      beruehre('touchcancel');
      schritte(1);
      const cancel = hpVorher - f.hp;
      return { gedrueckt, waehrendHalten, losgelassen, schaden, cancel, voll: Audio.audioHistory.filter(e => e.name === 'sniperVoll').length };
    });
    expect(r.gedrueckt).toBe(true);
    expect(r.waehrendHalten).toEqual({ hp: 1000, ladung: 90 });
    expect(r.losgelassen).toBe(false);
    expect(r.schaden).toBeCloseTo(120, 5);
    expect(r.cancel).toBeGreaterThan(30);
    expect(r.voll).toBe(1);

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

async function bereiteGranate(page, optionen = {}) {
  await starteSniper(page, optionen);
  await page.evaluate(() => {
    const { state, arrays, Loop } = window.__game;
    const T = window.__sn;
    window.__gr = {
      frei(n) { for (let i = 0; i < n; i++) Loop.simulationsSchritt(); },
      // Stehender Feind mit Mitte (cx|cy), ohne Pendeln und ohne Schuesse
      feind(cx, cy) {
        const f = T.feind(cx, cy);
        delete f.festX; delete f.festY;
        f.muster = 'swoop'; f.vx = 0; f.vy = 0;
        return f;
      },
      mitte(z) { const g = z.groesse; return { x: z.x + g / 2, y: z.y + g / 2 }; },
      abstand(z, cx, cy) { const m = this.mitte(z); return Math.hypot(m.x - cx, m.y - cy); },
      // Raketen-Taste antippen: einen Schritt gedrueckt, Loslassen im Folgeschritt loest Granate + EMP aus
      wirf(taste = 'v') {
        state.tastenGedrueckt[taste] = true;
        Loop.simulationsSchritt();
        state.tastenGedrueckt[taste] = false;
        Loop.simulationsSchritt();
      },
      // Raketen-Taste n Schritte halten (ohne Loslassen)
      halte(n, taste = 'v') {
        state.tastenGedrueckt[taste] = true;
        for (let i = 0; i < n; i++) Loop.simulationsSchritt();
      },
      loslassen(taste = 'v') {
        state.tastenGedrueckt[taste] = false;
        Loop.simulationsSchritt();
      }
    };
    T.leeren();
    for (const s of [state, state.p2]) { s.raketenStufe = 1; s.raketenCooldown = 0; }
  });
}

test.describe('Spectre-SR Granate', () => {
  test('fliegt zum Fadenkreuz beim Wurf (nicht dorthin, wohin es sich danach bewegt) und explodiert nach ca. 30 Schritten mit Druckwelle und Ton', async ({ page }) => {
    await bereiteGranate(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const T = window.__sn;
      const G = window.__gr;
      const ziel = G.feind(240, 180); // im Radius um (200|180)
      const nebenan = G.feind(100, 130); // liegt am Fadenkreuz NACH dem Verschieben des Schiffs (100|130), aber ausserhalb des Radius um (200|180)
      T.schritte(1);
      G.wirf();
      const nachWurf = { granaten: document.querySelectorAll('.sniper-granate').length, cd: state.raketenCooldown, raketen: window.__game.arrays.raketenArray.length };
      state.x = 85; // Fadenkreuz wandert nach (100|130)
      let schritte = 1;
      const mitte = [];
      while (document.querySelector('.sniper-granate') && schritte < 60) {
        G.frei(1);
        schritte++;
        if (schritte === 15) {
          const e = document.querySelector('.sniper-granate');
          mitte.push(parseFloat(e.style.left) + 7, parseFloat(e.style.top) + 7, e.style.transform);
        }
      }
      const welle1 = document.querySelector('.sniper-druckwelle');
      const breite1 = welle1 ? parseFloat(welle1.style.width) : -1;
      G.frei(6);
      const breite2 = welle1 ? parseFloat(welle1.style.width) : -1;
      G.frei(12);
      return {
        nachWurf, schritte, mitte, breite1, breite2, welleWeg: document.querySelectorAll('.sniper-druckwelle').length,
        ziel: ziel.betaeubt, nebenan: nebenan.betaeubt, zielX: G.mitte(ziel).x, nebenanX: G.mitte(nebenan).x,
        ton: Audio.audioHistory.filter(e => e.name === 'granate').length
      };
    });
    expect(r.nachWurf).toEqual({ granaten: 1, cd: 240, raketen: 0 });
    expect(r.schritte).toBeGreaterThanOrEqual(30);
    expect(r.schritte).toBeLessThanOrEqual(32);
    // Mitte des Flugs: Bogen (Linie waere y = 290), x wie beim Wurf (Fadenkreuz stand bei x = 200)
    expect(r.mitte[0]).toBeGreaterThan(190);
    expect(r.mitte[0]).toBeLessThan(215);
    expect(r.mitte[1]).toBeLessThan(260);
    expect(r.mitte[1]).toBeGreaterThan(180);
    expect(r.mitte[2]).toContain('rotate');
    expect(r.breite1).toBeGreaterThan(0);
    expect(r.breite2).toBeGreaterThan(r.breite1);
    expect(r.welleWeg).toBe(0);
    expect(r.ton).toBe(1);
    expect(r.ziel).toBeGreaterThanOrEqual(0); // wurde betaeubt (Zaehler laeuft ab)
    expect(r.zielX).toBeGreaterThan(280); // weggestossen
    expect(r.nebenan === undefined).toBe(true); // unberuehrt
    expect(r.nebenanX).toBe(100);
  });

  test('Stufe 1: kein Schaden, Wegstossen um ca. 60 px (gleitend), Betaeubung 60 Schritte (steht still, schiesst nicht), danach wieder aktiv; ausserhalb unberuehrt', async ({ page }) => {
    await bereiteGranate(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      const f = G.feind(240, 180); // 40 px rechts vom Einschlag (200|180)
      const aussen = G.feind(200 + 70 + 15 + 10, 180); // Box beginnt 80 px neben dem Zentrum (Radius 70)
      G.wirf();
      let n = 1;
      while (!f.betaeubt && n < 60) { G.frei(1); n++; }
      const start = { x: G.mitte(f).x, hp: f.hp, klasse: f.el.classList.contains('betaeubt'), betaeubt: f.betaeubt };
      f.vx = 2; // wuerde sich bewegen, wenn nicht betaeubt
      f.schussTimer = 1; // wuerde sofort schiessen
      const xs = [];
      const laserWaehrend = [];
      let schritteBetaeubt = 0;
      while (f.betaeubt > 0 && schritteBetaeubt < 200) {
        G.frei(1);
        schritteBetaeubt++;
        xs.push(G.mitte(f).x);
        laserWaehrend.push(arrays.feindLaserArray.length);
      }
      const weite = G.abstand(f, 200, 180) - 40;
      const klasseDanach = f.el.classList.contains('betaeubt');
      const xEnde = G.mitte(f).x;
      G.frei(5);
      return {
        start, weite, schritteBetaeubt, klasseDanach,
        bewegtWaehrend: Math.max(...xs.slice(10)) - Math.min(...xs.slice(10)), // nach dem Wegstossen (10 Schritte) keine Bewegung
        gleitend: xs[0] > start.x,
        laserWaehrend: Math.max(...laserWaehrend),
        xNachher: G.mitte(f).x - xEnde, laserNachher: arrays.feindLaserArray.length,
        aussenBetaeubt: aussen.betaeubt, aussenX: G.mitte(aussen).x, aussenHp: aussen.hp
      };
    });
    expect(r.start.hp).toBe(1000);
    expect(r.start.klasse).toBe(true);
    expect(r.schritteBetaeubt).toBeGreaterThanOrEqual(55);
    expect(r.schritteBetaeubt).toBeLessThanOrEqual(61);
    expect(r.weite).toBeGreaterThan(55);
    expect(r.weite).toBeLessThan(65);
    expect(r.gleitend).toBe(true);
    expect(r.bewegtWaehrend).toBe(0);
    expect(r.laserWaehrend).toBe(0);
    expect(r.klasseDanach).toBe(false);
    expect(r.xNachher).toBeGreaterThan(0); // wieder aktiv: bewegt sich
    expect(r.laserNachher).toBeGreaterThan(0); // und schiesst
    expect(r.aussenBetaeubt).toBeUndefined();
    expect(r.aussenX).toBe(295);
    expect(r.aussenHp).toBe(1000);
  });

  test('Schaden je Stufe (1: 0, 3: 25) ueber Schild zuerst; Wegstossen am Feld begrenzt', async ({ page }) => {
    await bereiteGranate(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const G = window.__gr;
      const lauf = (stufe, praep) => {
        T.leeren();
        state.raketenStufe = stufe;
        state.raketenCooldown = 0;
        const f = G.feind(240, 180);
        if (praep) praep(f);
        G.wirf();
        G.frei(45);
        return f;
      };
      const s1 = lauf(1).hp;
      const s3 = lauf(3).hp;
      const s2 = lauf(2).hp;
      const schild = lauf(3, f => { f.schildHp = 20; f.maxSchildHp = 20; });
      // Am Rand: Feind 5 px vom rechten Feldrand, wird nach rechts gestossen -> bleibt im Feld
      const breite = window.__game.config.spielfeldBreite;
      const rand = lauf(1, f => { state.x = breite - 60; f.x = breite - 30; f.y = 165; f.el.style.left = f.x + 'px'; G.frei(1); });
      const randX = rand.x;
      return { s1, s3, s2, schildHp: schild.schildHp, schildHpLeben: schild.hp, randX, breite };
    });
    expect(r.s1).toBe(1000);
    expect(r.s2).toBe(985);
    expect(r.s3).toBe(975);
    expect(r.schildHp).toBe(0); // Schild 20 durch 25 weg, kein Durchschlag auf die HP
    expect(r.schildHpLeben).toBe(1000);
    expect(r.randX).toBe(r.breite - 30); // wuerde nach rechts hinaus gestossen, bleibt am Feldrand
  });

  test('Boss: kein Wegstossen, halbe Betaeubung, greift waehrend der Betaeubung nicht an (Schuss, Bombe, Rakete)', async ({ page }) => {
    await bereiteGranate(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const G = window.__gr;
      state.level = 1;
      Entities.erzeugeBoss();
      const b = arrays.bosses[0];
      b.phase = 'kampf';
      b.x = 150; b.y = 40; // Box ohne Rand (165..235|55..125) schneidet den Kreis um (200|180) (Abstand 55 < 70)
      b.hp = b.maxHp = 100000;
      b.vx = 0; // schwebt (Bewegung wird getrennt geprueft)
      b.schussTimer = 99999; b.bombenTimer = 99999; b.raketenTimer = 99999;
      G.wirf();
      let n = 1;
      while (!b.betaeubt && n < 60) { G.frei(1); n++; }
      const betaeubt = b.betaeubt;
      const pos = { x: b.x, y: b.y };
      b.vx = 2;
      b.schussTimer = 1; b.bombenTimer = 1; b.raketenTimer = 1;
      const vorher = arrays.bossLaserArray.length + arrays.bossBombenArray.length + arrays.bossRaketenArray.length;
      let neu = 0;
      let schritte = 0;
      while (b.betaeubt > 0 && schritte < 100) {
        G.frei(1);
        schritte++;
        neu = Math.max(neu, arrays.bossLaserArray.length + arrays.bossBombenArray.length + arrays.bossRaketenArray.length - vorher);
      }
      const bewegtWaehrend = b.x - pos.x;
      G.frei(3);
      return {
        betaeubt, pos, bewegtWaehrend, schritte, neu, klasse: b.el.classList.contains('betaeubt'),
        danachAngriffe: arrays.bossLaserArray.length + arrays.bossBombenArray.length + arrays.bossRaketenArray.length - vorher,
        danachX: b.x - pos.x
      };
    });
    expect(r.betaeubt).toBeGreaterThanOrEqual(29);
    expect(r.betaeubt).toBeLessThanOrEqual(30); // halbe Dauer von 60
    expect(r.pos).toEqual({ x: 150, y: 40 }); // nicht weggestossen
    expect(r.bewegtWaehrend).toBe(0);
    expect(r.neu).toBe(0);
    expect(r.klasse).toBe(false);
    expect(r.danachAngriffe).toBeGreaterThan(0);
    expect(r.danachX).toBeGreaterThan(0);
  });

  test('Asteroid wird weggestossen, aber nicht betaeubt; Magma bleibt unversehrt', async ({ page }) => {
    await bereiteGranate(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const G = window.__gr;
      state.raketenStufe = 3;
      const a = T.asteroid(240, 180);
      delete a.festX; delete a.festY;
      const m = T.asteroid(160, 180, 30, true);
      delete m.festX; delete m.festY;
      const ax = a.x;
      G.wirf();
      G.frei(45);
      return { betaeubt: a.betaeubt, klasse: a.el.classList.contains('betaeubt'), weite: a.x - ax, hp: a.hp, magmaHp: m.hp, magmaBetaeubt: m.betaeubt };
    });
    expect(r.betaeubt).toBeUndefined();
    expect(r.klasse).toBe(false);
    expect(r.weite).toBeGreaterThan(70); // Stufe 3: 80 px
    expect(r.hp).toBe(975);
    expect(r.magmaHp).toBe(1000);
    expect(r.magmaBetaeubt).toBeUndefined();
  });

  test('Stufe 5 loescht feindliche Geschosse im Radius (Feind-, Boss-, Hack-Projektile); Stufe 4 nicht', async ({ page }) => {
    await bereiteGranate(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__sn;
      const G = window.__gr;
      const lauf = (stufe) => {
        T.leeren();
        state.raketenStufe = stufe;
        state.raketenCooldown = 0;
        G.wirf();
        // Ruhende Geschosse: je eines im Radius um (200|180) und eines weit ausserhalb
        Entities.erzeugeFeindLaser(200, 170);
        Entities.erzeugeBossLaser(180, 170);
        Entities.erzeugeHackProjektil(210, 170, 210, 400, null);
        Entities.erzeugeFeindLaser(340, 170);
        Entities.erzeugeBossLaser(340, 170);
        Entities.erzeugeHackProjektil(340, 170, 340, 400, null);
        [...arrays.feindLaserArray, ...arrays.bossLaserArray, ...arrays.hackProjektilArray].forEach(p => { p.vx = 0; p.vy = 0; p.lenkZeit = 0; });
        G.frei(35);
        return { feind: arrays.feindLaserArray.length, boss: arrays.bossLaserArray.length, hack: arrays.hackProjektilArray.length };
      };
      return { s4: lauf(4), s5: lauf(5) };
    });
    expect(r.s4).toEqual({ feind: 2, boss: 2, hack: 2 });
    expect(r.s5).toEqual({ feind: 1, boss: 1, hack: 1 });
  });

  test('Cooldown je Stufe (240/210/180/180/150), keine zweite Granate waehrend des Cooldowns; waffenOffline blockiert; keine Raketen', async ({ page }) => {
    await bereiteGranate(page);
    const r = await page.evaluate(async () => {
      const { state, arrays } = window.__game;
      const Hack = await import('./js/hack.js');
      const T = window.__sn;
      const G = window.__gr;
      const cds = [];
      for (let stufe = 1; stufe <= 5; stufe++) {
        T.leeren();
        state.raketenStufe = stufe;
        state.raketenCooldown = 0;
        G.wirf();
        cds.push(state.raketenCooldown);
      }
      T.leeren();
      document.querySelectorAll('.sniper-granate').forEach(e => e.remove());
      G.frei(1);
      state.raketenStufe = 1;
      state.raketenCooldown = 0;
      G.wirf();
      G.wirf();
      G.wirf();
      const granaten = document.querySelectorAll('.sniper-granate').length;
      const balken = parseFloat(document.getElementById('raketen-cd-balken').style.width);
      state.raketenCooldown = 0;
      Hack.hackeSpieler(state, 'waffenOffline');
      const vorher = document.querySelectorAll('.sniper-granate').length;
      G.wirf();
      return { cds, granaten, balken, blockiert: document.querySelectorAll('.sniper-granate').length === vorher, raketen: arrays.raketenArray.length };
    });
    expect(r.cds).toEqual([240, 210, 180, 180, 150]);
    expect(r.granaten).toBe(1);
    expect(r.balken).toBeLessThan(10); // HUD-Balken zeigt den Cooldown
    expect(r.blockiert).toBe(true);
    expect(r.raketen).toBe(0);
  });

  test('Coop: Spieler 2 (Sniper) wirft mit Oe zu seinem Fadenkreuz', async ({ page }) => {
    await bereiteGranate(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      G.frei(1);
      const cx = state.p2.x + 15; // Fadenkreuz-Mitte von P2
      const f = G.feind(cx - 40, 180); // im Radius links davon
      const x0 = G.mitte(f).x;
      G.wirf('ö');
      const granaten = document.querySelectorAll('.sniper-granate').length;
      G.frei(45);
      return { granaten, cdP2: state.p2.raketenCooldown, cdP1: state.raketenCooldown, betaeubt: f.betaeubt, weite: G.mitte(f).x - x0, balken: document.getElementById('raketen-cd-balken-p2').style.width };
    });
    expect(r.granaten).toBe(1);
    expect(r.cdP2).toBeGreaterThan(190);
    expect(r.cdP1).toBe(0);
    expect(r.betaeubt).toBeGreaterThanOrEqual(0);
    expect(r.weite).toBeLessThan(-30); // weg vom Fadenkreuz (Wegstossen nach links)
  });

  test('Neustart und Game Over raeumen Granaten, Druckwellen und Wegstossen ab', async ({ page }) => {
    await bereiteGranate(page);
    const r = await page.evaluate(() => {
      const { Utils } = window.__game;
      const G = window.__gr;
      const f = G.feind(240, 180);
      G.wirf();
      G.frei(10);
      const imFlug = document.querySelectorAll('.sniper-granate').length;
      Utils.triggerGameOver();
      const gameOver = document.querySelectorAll('.sniper-granate, .sniper-druckwelle').length;
      Utils.restartGame();
      return { imFlug, gameOver, neustart: document.querySelectorAll('.sniper-granate, .sniper-druckwelle').length, f: !!f };
    });
    expect(r.imFlug).toBe(1);
    expect(r.gameOver).toBe(0);
    expect(r.neustart).toBe(0);
  });

  test('Neustart mitten im Flug und waehrend der Druckwelle laesst nichts zurueck', async ({ page }) => {
    await bereiteGranate(page);
    const r = await page.evaluate(() => {
      const { Utils } = window.__game;
      const G = window.__gr;
      G.wirf();
      G.frei(33); // Explosion ist durch, Druckwelle laeuft
      const welle = document.querySelectorAll('.sniper-druckwelle').length;
      Utils.restartGame();
      return { welle, danach: document.querySelectorAll('.sniper-granate, .sniper-druckwelle').length };
    });
    expect(r.welle).toBe(1);
    expect(r.danach).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Online-Host (S5a): Client-Sniper als P2 laedt, feuert und wirft ueber die Eingabe-Pakete.

async function bereiteOnlineHost(page) {
  await bereiteGranate(page, { coop: true });
  await page.evaluate(() => {
    const { state, Network } = window.__game;
    const T = window.__sn;
    state.gameMode = 'online';
    Object.assign(state.network, { isOnline: true, isHost: true, isClient: false, connected: false });
    T.leeren();
    state.p2.selectedShipModel = 'sniper';
    state.p2.raketenStufe = 1;
    state.p2.raketenCooldown = 0;
    state.p2.laserInputRequested = false;
    state.p2.raketeGehalten = false;
    state.p2.netzLaserAnfrage = false;
    state.p2.sniperAutoInput = false;
    state.p2.networkFireRakete = false;
    // Client-Eingabe wie aus einem Paket (Position des Clients: P2-Schiff bei (385|400) -> Fadenkreuz (400|180))
    window.__eingabe = (e) => Network.applyPlayerInput(Object.assign({ x: 385, y: 400, rotate: 0, laser: false, rakete: false, bombe: false }, e));
  });
}

test.describe('Spectre-SR online (Host)', () => {
  test('kurzer Tipp des Clients (Druck und Loslassen vor demselben Host-Schritt) wird zu genau einem Schuss', async ({ page }) => {
    await bereiteOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const T = window.__sn;
      const E = window.__eingabe;
      const ziel = T.feind(400, 180, 1000);
      Audio.clearAudioHistory();
      E({ laser: true });
      E({ laser: false });
      T.schritte(1);
      T.schritte(5);
      const schuesse = () => Audio.audioHistory.filter(a => a.name === 'sniperSchuss').length;
      const tipp = { hp: ziel.hp, schuesse: schuesse(), energie: state.p2.energie, cd: state.p2.sniperCooldown > 0 };
      // Zweiter Tipp nach der Sperre: wieder genau ein Schuss
      T.schritte(30);
      E({ laser: true });
      E({ laser: false });
      T.schritte(6);
      const zweiter = { hp: ziel.hp, schuesse: schuesse() };
      // Normal gehalten ueber mehrere Pakete: kein Dauerfeuer, ein Schuss beim Loslassen
      T.schritte(30);
      E({ laser: true });
      T.schritte(3);
      const waehrend = schuesse();
      E({ laser: false });
      T.schritte(3);
      return { tipp, zweiter, waehrend, nachHalten: schuesse(), hpEnde: ziel.hp };
    });
    expect(r.tipp.hp).toBe(970);
    expect(r.tipp.schuesse).toBe(1);
    expect(r.tipp.cd).toBe(true);
    expect(r.zweiter).toEqual({ hp: 940, schuesse: 2 });
    expect(r.waehrend).toBe(2);
    expect(r.nachHalten).toBe(3);
    expect(r.hpEnde).toBe(910);
  });

  test('gehaltene Laser-Eingabe laedt bis voll (Ton, kein Schuss beim Halten), Loslassen feuert den Ladeschuss', async ({ page }) => {
    await bereiteOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const T = window.__sn;
      const E = window.__eingabe;
      const ziel = T.feind(400, 180, 1000);
      Audio.clearAudioHistory();
      E({ laser: true });
      T.schritte(100);
      const geladen = { ladung: state.p2.sniperLadung, voll: state.p2.sniperVoll, ton: Audio.audioHistory.filter(a => a.name === 'sniperVoll').length, hp: ziel.hp };
      E({ laser: false });
      T.schritte(2);
      return { geladen, hp: ziel.hp, ladungDanach: state.p2.sniperLadung };
    });
    expect(r.geladen).toEqual({ ladung: 90, voll: true, ton: 1, hp: 1000 });
    expect(r.hp).toBe(880); // voll geladen: Schaden x4
    expect(r.ladungDanach).toBe(0);
  });

  test('Autofeuer des Clients (Joystick) schiesst Normalschuesse im Schussabstand ohne Laden', async ({ page }) => {
    await bereiteOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const T = window.__sn;
      const E = window.__eingabe;
      const ziel = T.feind(400, 180, 1000);
      Audio.clearAudioHistory();
      E({ laser: true, auto: true });
      T.schritte(50);
      const maxLadung = state.p2.sniperLadung;
      const gehalten = state.p2.sniperGehalten;
      E({ laser: false });
      T.schritte(2);
      return { schuesse: Audio.audioHistory.filter(a => a.name === 'sniperSchuss').length, hp: ziel.hp, maxLadung, gehalten, ton: Audio.audioHistory.filter(a => a.name === 'sniperVoll').length };
    });
    // Stufe 1: Schussabstand 24 Schritte -> Schuesse in den Schritten 1, 25, 49
    expect(r.schuesse).toBe(3);
    expect(r.hp).toBe(910);
    expect(r.maxLadung).toBe(0);
    expect(r.gehalten).toBe(false);
    expect(r.ton).toBe(0);
  });

  test('Granate ueber die Raketen-Eingabe (auch kurzer Tipp) fliegt zum Fadenkreuz des Clients und betaeubt dort', async ({ page }) => {
    await bereiteOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__sn;
      const G = window.__gr;
      const E = window.__eingabe;
      const ziel = G.feind(430, 190); // im Radius 70 um das Fadenkreuz des Clients (400|180)
      const fern = G.feind(100, 180); // am Fadenkreuz des Hosts (200|180) - darf nichts abbekommen
      E({ rakete: true });
      E({ rakete: false });
      T.schritte(2); // Schritt 1 zaehlt den Druck, Schritt 2 das Loslassen (Tippen)
      const nachWurf = { granaten: document.querySelectorAll('.sniper-granate').length, cd: state.p2.raketenCooldown, host: state.raketenCooldown };
      // Das Schiff des Clients zieht weiter: die Granate zielt trotzdem auf die Position beim Wurf
      E({ x: 285, y: 400 });
      G.frei(31);
      return { nachWurf, ziel: ziel.betaeubt > 0, fern: fern.betaeubt || 0, welle: document.querySelectorAll('.sniper-druckwelle').length };
    });
    expect(r.nachWurf).toEqual({ granaten: 1, cd: 240, host: 0 });
    expect(r.ziel).toBe(true);
    expect(r.fern).toBe(0);
    expect(r.welle).toBe(1);
  });

  test('Host sendet fuer die Druckwelle ein Ereignis und die Granate im Snapshot; Betaeubung steht am Feind im Snapshot', async ({ page }) => {
    await bereiteOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state, Network } = window.__game;
      const G = window.__gr;
      const E = window.__eingabe;
      const ziel = G.feind(430, 190);
      E({ rakete: true });
      E({ rakete: false });
      G.frei(2);
      const imFlug = Network.serializeGameState().sniperGranaten.map(g => ({ owner: g.owner, rest: g.rest }));
      state.network.lastSentEvent = null;
      G.frei(31);
      const ereignis = state.network.lastSentEvent;
      const feindSnap = Network.serializeGameState().feinde.find(f => f.id === ziel.id);
      return { imFlug, ereignis, betaeubt: feindSnap.betaeubt > 0 };
    });
    expect(r.imFlug).toHaveLength(1);
    expect(r.imFlug[0].owner).toBe('p2');
    expect(r.ereignis).toMatchObject({ type: 'granate_detonated', x: 400, y: 180, radius: 70, owner: 'p2' });
    expect(r.betaeubt).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Bot (S5b): Spieler 2 als KI fliegt die Spectre-SR

test.describe('Spectre-SR Bot', () => {
  async function bereiteBot(page) {
    await bereiteGranate(page, { coop: true });
    await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      const { state } = window.__game;
      window.__bot = {
        start() {
          window.__sn.leeren();
          state.p2IsBot = true;
          state.p2BotDifficulty = 'hard';
          Bot.resetBot();
          state.p2.x = 285; state.p2.y = 480;
          state.p2.botFireLaser = false; state.p2.botFireRakete = false;
          state.p2.raketenCooldown = 0;
          state.x = 40; state.y = 540; // P1 aus dem Weg
        }
      };
    });
  }

  test('bringt das Fadenkreuz auf einen stehenden Feind und zerstoert ihn mit Normalschuessen', async ({ page }) => {
    await bereiteBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      window.__bot.start();
      const f = window.__gr.feind(420, 150);
      f.hp = f.maxHp = 100;
      let maxLadung = 0;
      let abstand = null;
      for (let i = 0; i < 400 && arrays.feinde.includes(f) && f.hp > 0; i++) {
        window.__gr.frei(1);
        maxLadung = Math.max(maxLadung, state.p2.sniperLadung || 0);
        if (i === 100) abstand = Math.hypot(state.p2.sniperZielX - 420, state.p2.sniperZielY - 150);
      }
      return { tot: !arrays.feinde.includes(f) || f.hp <= 0, abstand, maxLadung };
    });
    expect(r.tot).toBe(true);
    expect(r.abstand).toBeLessThan(15);
    expect(r.maxLadung).toBeLessThan(10);
  });

  test('gegen einen Boss laedt er voll und schiesst mit Faktor 4', async ({ page }) => {
    await bereiteBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      window.__bot.start();
      Entities.erzeugeBoss();
      const b = arrays.bosses[0];
      Object.assign(b, { phase: 'kampf', x: 250, y: 20, vx: 0, vy: 0, hp: 1e6, maxHp: 1e6, schussTimer: 9999, bombenTimer: 9999, raketenTimer: 9999 });
      let voll = 0;
      let vorher = 0;
      for (let i = 0; i < 600; i++) {
        window.__gr.frei(1);
        if (state.p2.sniperVoll && !vorher) voll++;
        vorher = state.p2.sniperVoll ? 1 : 0;
        b.x = 250; b.y = 20; b.phase = 'kampf';
      }
      return { voll, bossHp: b.hp };
    });
    expect(r.voll).toBeGreaterThanOrEqual(1);
    expect(r.bossHp).toBeLessThan(1e6 - 150);
  });

  test('wirft eine Granate bei einer Feindgruppe', async ({ page }) => {
    await bereiteBot(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      window.__bot.start();
      const G = window.__gr;
      G.feind(300, 150); G.feind(340, 160); G.feind(320, 190);
      let granaten = 0;
      let cd = 0;
      for (let i = 0; i < 200; i++) {
        G.frei(1);
        granaten = Math.max(granaten, document.querySelectorAll('.sniper-granate').length);
        cd = Math.max(cd, state.p2.raketenCooldown);
        arrays.feinde.forEach(f => { f.hp = f.maxHp = 1e6; });
        if (granaten) break;
      }
      return { granaten, cd };
    });
    expect(r.granaten).toBe(1);
    expect(r.cd).toBeGreaterThan(150);
  });

  test('tippt nicht ohne Ziel: Energie bleibt bei leerem Feld voll, kein Schuss', async ({ page }) => {
    await bereiteBot(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      window.__bot.start();
      let schuesse = 0;
      let minE = 50;
      for (let i = 0; i < 300; i++) {
        state.frameZaehler = 1; // keine natuerlichen Spawns
        const cd = state.p2.sniperCooldown;
        window.__gr.frei(1);
        if (state.p2.sniperCooldown > cd) schuesse++;
        minE = Math.min(minE, state.p2.energie);
      }
      return { schuesse, minE, granaten: document.querySelectorAll('.sniper-granate').length };
    });
    expect(r.schuesse).toBe(0);
    expect(r.minE).toBeGreaterThan(49);
    expect(r.granaten).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// E1: Granaten-Taste als Tipp/Halte-Modell, EMP beim Tippen

async function bereiteEmp(page, optionen = {}) {
  await bereiteGranate(page, optionen);
  await page.evaluate(async () => {
    const Sn = await import('./js/sniper.js');
    const { Entities, arrays, state, config } = window.__game;
    const Mitte = () => ({ x: state.x + config.spielerGroesse / 2, y: state.y + config.spielerGroesse / 2 });
    window.__emp = {
      Sn,
      mitte: Mitte,
      // Geschoss im Abstand dx/dy von der Schiffsmitte (stehend, damit nichts weiterfliegt)
      geschoss(art, dx, dy) {
        const m = Mitte();
        const x = m.x + dx;
        const y = m.y + dy;
        if (art === 'feindLaser') Entities.erzeugeFeindLaser(x, y);
        else if (art === 'bossLaser') Entities.erzeugeBossLaser(x, y);
        else if (art === 'hack') Entities.erzeugeHackProjektil(x, y, x, y + 100);
        else if (art === 'bossRakete') Entities.erzeugeBossRakete(x, y, 1);
        const liste = { feindLaser: arrays.feindLaserArray, bossLaser: arrays.bossLaserArray, hack: arrays.hackProjektilArray, bossRakete: arrays.bossRaketenArray }[art];
        const g = liste[liste.length - 1];
        g.x = x; g.y = y; g.vx = 0; g.vy = 0;
        return g;
      },
      anzahl() {
        return arrays.feindLaserArray.length + arrays.bossLaserArray.length + arrays.hackProjektilArray.length + arrays.bossRaketenArray.length;
      }
    };
  });
}

test.describe('Spectre-SR Granaten-Taste und EMP', () => {
  test('Tippen wirft die Granate und loest das EMP aus (Ring, Ton, Cooldown); der Wurf faellt erst beim Loslassen', async ({ page }) => {
    await bereiteEmp(page);
    const r = await page.evaluate(() => {
      const { state, Audio } = window.__game;
      const G = window.__gr;
      Audio.clearAudioHistory();
      G.halte(1);
      const waehrendDruck = { granaten: document.querySelectorAll('.sniper-granate').length, emp: document.querySelectorAll('.sniper-emp').length, cd: state.raketenCooldown };
      G.loslassen();
      const danach = { granaten: document.querySelectorAll('.sniper-granate').length, emp: document.querySelectorAll('.sniper-emp').length, cd: state.raketenCooldown };
      G.frei(4);
      const breite = parseFloat(document.querySelector('.sniper-emp').style.width);
      G.frei(10);
      return { waehrendDruck, danach, breite, empWeg: document.querySelectorAll('.sniper-emp').length, ton: Audio.audioHistory.filter(e => e.name === 'emp').length };
    });
    expect(r.waehrendDruck).toEqual({ granaten: 0, emp: 0, cd: 0 });
    expect(r.danach).toEqual({ granaten: 1, emp: 1, cd: 240 });
    expect(r.breite).toBeGreaterThan(0);
    expect(r.breite).toBeLessThan(140);
    expect(r.empWeg).toBe(0);
    expect(r.ton).toBe(1);
  });

  test('Halten ab 10 Schritten (20 Schritte) wirft nichts und loest kein EMP aus; der Cooldown startet erst beim Loslassen (Mine gelegt)', async ({ page }) => {
    await bereiteEmp(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      G.halte(20);
      const waehrend = { granaten: document.querySelectorAll('.sniper-granate').length, emp: document.querySelectorAll('.sniper-emp').length, cd: state.raketenCooldown };
      G.loslassen();
      G.frei(3);
      return { waehrend, danach: { granaten: document.querySelectorAll('.sniper-granate').length, emp: document.querySelectorAll('.sniper-emp').length, cd: state.raketenCooldown } };
    });
    expect(r.waehrend).toEqual({ granaten: 0, emp: 0, cd: 0 });
    expect(r.danach.cd).toBeGreaterThan(230); // Cooldown laeuft nach dem Loslassen (3 Schritte spaeter)
    expect({ ...r.danach, cd: 0 }).toEqual({ granaten: 0, emp: 0, cd: 0 });
  });

  test('Grenze: 9 Schritte gehalten ist noch ein Tipp, 10 Schritte ist ein Halten', async ({ page }) => {
    await bereiteEmp(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      G.halte(9);
      G.loslassen();
      const neun = state.raketenCooldown;
      G.frei(1);
      state.raketenCooldown = 0;
      document.querySelectorAll('.sniper-granate, .sniper-emp').forEach(e => e.remove());
      G.halte(10);
      G.loslassen();
      return { neun, zehn: state.raketenCooldown };
    });
    expect(r.neun).toBe(240);
    expect(r.zehn).toBe(240); // Halten legt eine Mine -> Cooldown, aber keine Granate
  });

  test('Tippen im Cooldown wirft nichts; waffenOffline blockiert Granate und EMP', async ({ page }) => {
    await bereiteEmp(page);
    const r = await page.evaluate(async () => {
      const { state } = window.__game;
      const Hack = await import('./js/hack.js');
      const G = window.__gr;
      state.raketenCooldown = 100;
      G.wirf();
      const imCooldown = { granaten: document.querySelectorAll('.sniper-granate').length, emp: document.querySelectorAll('.sniper-emp').length };
      state.raketenCooldown = 0;
      Hack.hackeSpieler(state, 'waffenOffline');
      G.wirf();
      return { imCooldown, offline: { granaten: document.querySelectorAll('.sniper-granate').length, emp: document.querySelectorAll('.sniper-emp').length } };
    });
    expect(r.imCooldown).toEqual({ granaten: 0, emp: 0 });
    expect(r.offline).toEqual({ granaten: 0, emp: 0 });
  });

  test('EMP zerstoert Feindlaser, Boss-Laser, Hack-Projektil und Boss-Rakete im Radius, nicht ausserhalb', async ({ page }) => {
    await bereiteEmp(page);
    const r = await page.evaluate(() => {
      const { arrays, state } = window.__game;
      const E = window.__emp;
      for (const a of ['feindLaser', 'bossLaser', 'hack', 'bossRakete']) { E.geschoss(a, 40, -30); E.geschoss(a, 150, 0); }
      const vorher = E.anzahl();
      E.Sn.loeseEmpAus(state, 'p1');
      const mx = E.mitte().x;
      return {
        vorher, nachher: E.anzahl(),
        feindLaser: arrays.feindLaserArray.map(g => Math.round(g.x - mx)),
        bossRakete: arrays.bossRaketenArray.map(g => Math.round(g.x - mx)),
        els: document.querySelectorAll('.feind-laser').length
      };
    });
    expect(r.vorher).toBe(8);
    expect(r.nachher).toBe(4); // nur die entfernten (150 px) bleiben
    expect(r.feindLaser).toEqual([150]);
    expect(r.bossRakete).toEqual([150]);
    expect(r.els).toBe(1);
  });

  test('EMP entfernt Boss-Bomben im Radius ohne Detonation', async ({ page }) => {
    await bereiteEmp(page);
    const r = await page.evaluate(() => {
      const { Entities, arrays, state } = window.__game;
      const E = window.__emp;
      const m = E.mitte();
      Entities.erzeugeBossBombe(m.x + 20, m.y - 40);
      Entities.erzeugeBossBombe(m.x + 160, m.y);
      const b = arrays.bossBombenArray;
      b[0].x = m.x + 20; b[0].y = m.y - 40;
      b[1].x = m.x + 160; b[1].y = m.y;
      E.Sn.loeseEmpAus(state, 'p1');
      return { rest: b.length, x: Math.round(b[0].x - m.x) };
    });
    expect(r.rest).toBe(1);
    expect(r.x).toBe(160);
  });

  test('EMP betaeubt Feinde im Radius 30 Schritte (Maximum, keine Verkuerzung), Boss und Asteroid nicht, kein Schaden', async ({ page }) => {
    await bereiteEmp(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const E = window.__emp;
      const T = window.__sn;
      const G = window.__gr;
      const m = E.mitte();
      const nah = G.feind(m.x + 30, m.y - 30);
      const lang = G.feind(m.x - 30, m.y - 30);
      lang.betaeubt = 100;
      const fern = G.feind(m.x + 200, m.y - 30);
      const ast = T.asteroid(m.x, m.y - 40, 30);
      Entities.erzeugeBoss();
      const boss = arrays.bosses[0];
      Object.assign(boss, { x: m.x - 40, y: m.y - 80, hp: 1e6, maxHp: 1e6 });
      const hp = [nah.hp, lang.hp, ast.hp, boss.hp];
      E.Sn.loeseEmpAus(state, 'p1');
      return {
        nah: nah.betaeubt, lang: lang.betaeubt, fern: fern.betaeubt || 0, ast: ast.betaeubt || 0, boss: boss.betaeubt || 0,
        klasse: nah.el.classList.contains('betaeubt'), hpGleich: [nah.hp, lang.hp, ast.hp, boss.hp].every((h, i) => h === hp[i])
      };
    });
    expect(r.nah).toBe(30);
    expect(r.lang).toBe(100);
    expect(r.fern).toBe(0);
    expect(r.ast).toBe(0);
    expect(r.boss).toBe(0);
    expect(r.klasse).toBe(true);
    expect(r.hpGleich).toBe(true);
  });

  test('EMP-Radius je Raketen-Stufe 70/80/90/100/110: Geschoss knapp innerhalb wird zerstoert, knapp ausserhalb nicht', async ({ page }) => {
    await bereiteEmp(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const E = window.__emp;
      const radien = [];
      const wirkung = [];
      for (let stufe = 1; stufe <= 5; stufe++) {
        state.raketenStufe = stufe;
        radien.push(E.Sn.empRadius(state));
        const soll = 60 + stufe * 10;
        // Der Laser misst 4 px Breite ab seiner linken Kante: innen = soll - 6 (rechte Kante weiter innen), aussen = soll + 6
        const innen = E.geschoss('feindLaser', soll - 6, 0);
        const aussen = E.geschoss('feindLaser', soll + 6, 0);
        E.Sn.loeseEmpAus(state, 'p1');
        wirkung.push([!arrays.feindLaserArray.includes(innen), arrays.feindLaserArray.includes(aussen)]);
        arrays.feindLaserArray.forEach(g => g.el.remove());
        arrays.feindLaserArray.length = 0;
      }
      return { radien, wirkung, ringe: document.querySelectorAll('.sniper-emp').length };
    });
    expect(r.radien).toEqual([70, 80, 90, 100, 110]);
    expect(r.wirkung).toEqual([[true, true], [true, true], [true, true], [true, true], [true, true]]);
    expect(r.ringe).toBe(5);
  });

  test('EMP-Ring waechst in 10 Schritten und verschwindet', async ({ page }) => {
    await bereiteEmp(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      state.raketenStufe = 3;
      G.wirf();
      const b1 = parseFloat(document.querySelector('.sniper-emp').style.width);
      G.frei(6);
      const b2 = parseFloat(document.querySelector('.sniper-emp').style.width);
      G.frei(6);
      return { b1, b2, weg: document.querySelectorAll('.sniper-emp').length };
    });
    expect(r.b2).toBeGreaterThan(r.b1);
    expect(r.b2).toBeLessThanOrEqual(180);
    expect(r.weg).toBe(0);
  });

  test('Neustart raeumt EMP-Ringe ab', async ({ page }) => {
    await bereiteEmp(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      window.__gr.wirf();
      const vorher = document.querySelectorAll('.sniper-emp').length;
      window.__emp.Sn.setzeZurueck(state);
      return { vorher, danach: document.querySelectorAll('.sniper-emp').length };
    });
    expect(r.vorher).toBe(1);
    expect(r.danach).toBe(0);
  });

  test('Coop: Spieler 2 (Sniper) tippt mit Oe und das EMP kommt von seinem Schiff', async ({ page }) => {
    await bereiteEmp(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, config } = window.__game;
      const G = window.__gr;
      G.wirf('ö');
      const ring = document.querySelector('.sniper-emp');
      const rad = parseFloat(ring.style.width) / 2;
      return {
        cdP2: state.p2.raketenCooldown, cdP1: state.raketenCooldown, ringe: document.querySelectorAll('.sniper-emp').length,
        abstandX: Math.abs(parseFloat(ring.style.left) + rad - (state.p2.x + config.spielerGroesse / 2))
      };
    });
    expect(r.cdP2).toBeGreaterThan(0);
    expect(r.cdP1).toBe(0);
    expect(r.ringe).toBe(1);
    expect(r.abstandX).toBeLessThan(2);
  });
});

test.describe('Spectre-SR EMP online', () => {
  test('Host: Client-Tipp zwischen zwei Host-Schritten ergibt genau einen Wurf samt EMP-Ereignis; Halten wirft nichts', async ({ page }) => {
    await bereiteOnlineHost(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      const E = window.__eingabe;
      state.network.lastSentEvent = null;
      E({ rakete: true });
      E({ rakete: false });
      G.frei(2);
      const tipp = { granaten: document.querySelectorAll('.sniper-granate').length, emp: document.querySelectorAll('.sniper-emp').length, cd: state.p2.raketenCooldown, ereignis: state.network.lastSentEvent };
      G.frei(40);
      state.p2.raketenCooldown = 0;
      document.querySelectorAll('.sniper-granate, .sniper-emp').forEach(e => e.remove());
      E({ rakete: true });
      G.frei(20);
      const halten = { granaten: document.querySelectorAll('.sniper-granate').length, emp: document.querySelectorAll('.sniper-emp').length, cd: state.p2.raketenCooldown };
      E({ rakete: false });
      G.frei(3);
      return { tipp, halten, nachHalten: { granaten: document.querySelectorAll('.sniper-granate').length, cd: state.p2.raketenCooldown } };
    });
    expect(r.tipp.granaten).toBe(1);
    expect(r.tipp.emp).toBe(1);
    expect(r.tipp.cd).toBeGreaterThan(200);
    expect(r.tipp.ereignis).toMatchObject({ type: 'emp_ausgeloest', owner: 'p2', radius: 70 });
    expect(r.halten).toEqual({ granaten: 0, emp: 0, cd: 0 });
    expect(r.nachHalten.granaten).toBe(0);
    expect(r.nachHalten.cd).toBeGreaterThan(200); // eine Mine wurde gelegt -> Cooldown nach dem Loslassen
  });

  test('Client zeigt den EMP-Ring aus dem Ereignis (Ton, wachsender Ring, danach weg); ungueltige Daten werden ignoriert', async ({ page }) => {
    await bereiteGranate(page);
    const r = await page.evaluate(async () => {
      const Sn = await import('./js/sniper.js');
      const { Audio } = window.__game;
      Audio.clearAudioHistory();
      Sn.zeigeEmp({ x: 300, y: 300, radius: 90, owner: 'p1' });
      Sn.zeigeEmp({ x: NaN, y: 1, radius: 90 });
      Sn.zeigeEmp(null);
      const ring = document.querySelectorAll('.sniper-emp').length;
      for (let i = 0; i < 6; i++) Sn.clientSchritt();
      const breite = parseFloat(document.querySelector('.sniper-emp').style.width);
      for (let i = 0; i < 6; i++) Sn.clientSchritt();
      return { ring, breite, weg: document.querySelectorAll('.sniper-emp').length, ton: Audio.audioHistory.filter(e => e.name === 'emp').length };
    });
    expect(r.ring).toBe(1);
    expect(r.breite).toBeGreaterThan(0);
    expect(r.weg).toBe(0);
    expect(r.ton).toBe(1);
  });

  test('Protokollversion ist 12', async ({ page }) => {
    await bereiteGranate(page);
    const v = await page.evaluate(async () => (await import('./js/netzkodierung.js')).PROTOKOLL_VERSION);
    expect(v).toBe(12);
  });
});

test.describe('Spectre-SR Bot: EMP', () => {
  test('Bot tippt kurz (wenige Schritte true, dann false) bei naher Boss-Rakete; die Rakete verschwindet, Cooldown startet', async ({ page }) => {
    await bereiteEmp(page, { coop: true });
    const r = await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      const { state, arrays, Entities } = window.__game;
      const G = window.__gr;
      window.__sn.leeren();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      Bot.resetBot();
      state.p2.x = 285; state.p2.y = 480;
      state.p2.botFireLaser = false; state.p2.botFireRakete = false;
      state.p2.raketenCooldown = 0;
      state.x = 40; state.y = 540;
      const mx = state.p2.x + 15;
      const my = state.p2.y + 15;
      Entities.erzeugeBossRakete(mx, my - 50, 1);
      const rk = arrays.bossRaketenArray[0];
      rk.x = mx; rk.y = my - 50; rk.vx = 0; rk.vy = 0;
      const folge = [];
      let weg = -1;
      for (let i = 0; i < 12; i++) {
        G.frei(1);
        folge.push(Boolean(state.p2.botFireRakete));
        if (weg < 0 && !arrays.bossRaketenArray.includes(rk)) weg = i;
      }
      return { folge, weg, cd: state.p2.raketenCooldown };
    });
    expect(r.folge[0]).toBe(true);
    expect(r.folge.indexOf(false)).toBeGreaterThan(0);
    expect(r.folge.indexOf(false)).toBeLessThanOrEqual(3);
    expect(r.folge.filter(Boolean).length).toBeLessThanOrEqual(3);
    expect(r.weg).toBeGreaterThanOrEqual(0);
    expect(r.cd).toBeGreaterThan(150);
  });

  test('Bot tippt nicht, wenn das Geschoss weit weg ist', async ({ page }) => {
    await bereiteEmp(page, { coop: true });
    const r = await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      const { state, arrays, Entities } = window.__game;
      const G = window.__gr;
      window.__sn.leeren();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      Bot.resetBot();
      state.p2.x = 285; state.p2.y = 480;
      state.p2.raketenCooldown = 0;
      state.x = 40; state.y = 540;
      Entities.erzeugeBossRakete(state.p2.x + 15, state.p2.y - 200, 1);
      const rk = arrays.bossRaketenArray[0];
      rk.vx = 0; rk.vy = 0;
      let getippt = 0;
      for (let i = 0; i < 20; i++) { G.frei(1); if (state.p2.botFireRakete) getippt++; }
      return { getippt, rakete: arrays.bossRaketenArray.length };
    });
    expect(r.getippt).toBe(0);
    expect(r.rakete).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Haftminen (E2): Halten der Granaten-Taste legt Minen

// Mine legen: Raketen-Taste n Schritte halten und loslassen, Schiff danach aus dem Weg (Mine bleibt bei (200|430))
async function bereiteMinen(page, optionen = {}) {
  await bereiteGranate(page, optionen);
  await page.evaluate(() => {
    const { state, arrays, Entities } = window.__game;
    const G = window.__gr;
    window.__mi = {
      minen: () => arrays.sniperMinen,
      // Eine Mine am Schiff legen und das Schiff wegsetzen
      eineMine() {
        G.halte(12);
        G.loslassen();
        state.raketenCooldown = 0;
        state.x = 0; state.y = 100;
        return arrays.sniperMinen[arrays.sniperMinen.length - 1];
      },
      setzeFeind(cx, cy, hp = 1000) {
        const f = G.feind(cx, cy);
        f.hp = f.maxHp = hp;
        return f;
      },
      // Ziel pro Schritt um (dx|dy) bewegen, bis die Mine haftet (max. n Schritte)
      bisHaftet(z, dx, dy, n = 40) {
        const m = arrays.sniperMinen[0];
        for (let i = 0; i < n && !m.ziel; i++) {
          z.x += dx; z.y += dy;
          z.el.style.left = z.x + 'px'; z.el.style.top = z.y + 'px';
          G.frei(1);
        }
        return m;
      }
    };
  });
}

test.describe('Spectre-SR Haftminen', () => {
  test('Halten 70 Schritte legt 5 Minen im 12er-Takt an den jeweiligen Schiffspositionen, ohne Granate und EMP; danach Cooldown', async ({ page }) => {
    await bereiteMinen(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Audio } = window.__game;
      Audio.clearAudioHistory();
      state.tastenGedrueckt.v = true;
      const anzahl = [];
      for (let i = 0; i < 70; i++) {
        state.x = 100 + i * 2; // Schiff wandert
        window.__game.Loop.simulationsSchritt();
        anzahl.push(arrays.sniperMinen.length);
      }
      const waehrend = { granaten: document.querySelectorAll('.sniper-granate').length, emp: document.querySelectorAll('.sniper-emp').length, cd: state.raketenCooldown };
      state.tastenGedrueckt.v = false;
      window.__game.Loop.simulationsSchritt();
      return {
        anzahl, waehrend, cd: state.raketenCooldown, xs: arrays.sniperMinen.map(m => m.x), ys: arrays.sniperMinen.map(m => m.y),
        owner: arrays.sniperMinen.map(m => m.pKey), els: document.querySelectorAll('.sniper-mine').length,
        toene: Audio.audioHistory.filter(e => e.name === 'mine_legen').length, emp: Audio.audioHistory.filter(e => e.name === 'emp').length
      };
    });
    // Mine k (k = 0..4) faellt in Schritt 10 + 12k (Index 9 + 12k): Schiff steht dann bei x = 100 + (9 + 12k) * 2
    expect(r.anzahl[8]).toBe(0);
    expect(r.anzahl[9]).toBe(1);
    expect(r.anzahl[20]).toBe(1);
    expect(r.anzahl[21]).toBe(2);
    expect(r.anzahl[69]).toBe(5);
    expect(r.anzahl.filter((n, i) => i > 0 && n > r.anzahl[i - 1])).toHaveLength(5);
    expect(r.xs).toEqual([0, 1, 2, 3, 4].map(k => 100 + (9 + 12 * k) * 2 + 15));
    expect(r.ys.every(y => y === 430)).toBe(true);
    expect(r.owner.every(o => o === 'p1')).toBe(true);
    expect(r.els).toBe(5);
    expect(r.toene).toBe(5);
    expect(r.waehrend).toEqual({ granaten: 0, emp: 0, cd: 0 });
    expect(r.emp).toBe(0);
    expect(r.cd).toBe(240);
  });

  test('Halten nur 12 Schritte legt 1 Mine; Halten im Cooldown legt keine und startet keinen neuen', async ({ page }) => {
    await bereiteMinen(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      G.halte(12);
      G.loslassen();
      const eins = { minen: arrays.sniperMinen.length, cd: state.raketenCooldown };
      G.halte(40);
      G.loslassen();
      return { eins, imCooldown: { minen: arrays.sniperMinen.length, cd: state.raketenCooldown } };
    });
    expect(r.eins).toEqual({ minen: 1, cd: 240 });
    expect(r.imCooldown.minen).toBe(1);
    expect(r.imCooldown.cd).toBeLessThan(240);
  });

  test('maximal 8 aktive Minen pro Spieler, die aelteste faellt weg', async ({ page }) => {
    await bereiteMinen(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      const ids = [];
      for (let i = 0; i < 2; i++) {
        state.raketenCooldown = 0;
        G.halte(70);
        G.loslassen();
        ids.push(...arrays.sniperMinen.map(m => m.id));
      }
      const erste = ids[0];
      return { anzahl: arrays.sniperMinen.length, els: document.querySelectorAll('.sniper-mine').length, ersteNochDa: arrays.sniperMinen.some(m => m.id === erste), gesamt: new Set(ids).size };
    });
    expect(r.anzahl).toBe(8);
    expect(r.els).toBe(8);
    expect(r.ersteNochDa).toBe(false);
    expect(r.gesamt).toBeGreaterThanOrEqual(10);
  });

  test('Mine bleibt stehen; Lebensdauer 360 Schritte, ab 300 blinkend, danach weg ohne Explosion', async ({ page }) => {
    await bereiteMinen(page);
    const r = await page.evaluate(() => {
      const G = window.__gr;
      const M = window.__mi;
      const m = M.eineMine();
      const x0 = m.x; const y0 = m.y;
      G.frei(100);
      const stehen = [m.x === x0, m.y === y0];
      G.frei(190); // gesamt 290 Schritte nach dem Legen
      const bei290 = m.el.classList.contains('blinkt');
      G.frei(15);
      const bei305 = m.el.classList.contains('blinkt');
      G.frei(50);
      const bei355 = M.minen().includes(m);
      G.frei(10);
      return { stehen, bei290, bei305, bei355, weg: !M.minen().includes(m), elWeg: !m.el.isConnected, explosion: document.querySelectorAll('.sniper-mine-explosion').length };
    });
    expect(r.stehen).toEqual([true, true]);
    expect(r.bei290).toBe(false);
    expect(r.bei305).toBe(true);
    expect(r.bei355).toBe(true);
    expect(r.weg).toBe(true);
    expect(r.elWeg).toBe(true);
    expect(r.explosion).toBe(0);
  });

  test('Boss-Rakete beruehrt die Mine: Mine explodiert sofort und zerstoert Rakete und Boss-Bombe im Radius', async ({ page }) => {
    await bereiteMinen(page);
    const r = await page.evaluate(() => {
      const { arrays, Entities } = window.__game;
      const G = window.__gr;
      const M = window.__mi;
      const m = M.eineMine();
      // Boss-Bombe neben der Mine (im Radius 30, aber ohne Kontakt) – loest allein nicht aus
      Entities.erzeugeBossBombe(m.x + 12, m.y - 40);
      const bombe = arrays.bossBombenArray[arrays.bossBombenArray.length - 1];
      Object.assign(bombe, { x: m.x + 12, y: m.y - 30, vx: 0, vy: 0, timer: 9999 });
      G.frei(1);
      const nachBombe = { mineDa: M.minen().includes(m), bombeDa: arrays.bossBombenArray.includes(bombe) };
      // Boss-Rakete direkt auf der Mine
      Entities.erzeugeBossRakete(m.x - 5, m.y - 8, 1);
      const rakete = arrays.bossRaketenArray[arrays.bossRaketenArray.length - 1];
      Object.assign(rakete, { x: m.x - 5, y: m.y - 8, vx: 0, vy: 0 });
      G.frei(1);
      return {
        nachBombe, mineWeg: !M.minen().includes(m), raketeWeg: !arrays.bossRaketenArray.includes(rakete),
        bombeWeg: !arrays.bossBombenArray.includes(bombe), explosion: document.querySelectorAll('.sniper-mine-explosion').length
      };
    });
    expect(r.nachBombe).toEqual({ mineDa: true, bombeDa: true });
    expect(r.mineWeg).toBe(true);
    expect(r.raketeWeg).toBe(true);
    expect(r.bombeWeg).toBe(true);
    expect(r.explosion).toBeGreaterThanOrEqual(1);
  });

  test('Feind beruehrt die Mine: haftet, folgt dem Feind, piept; Magma loest nicht aus', async ({ page }) => {
    await bereiteMinen(page);
    const r = await page.evaluate(() => {
      const { Audio } = window.__game;
      const G = window.__gr;
      const M = window.__mi;
      const m = M.eineMine();
      // Magma-Asteroid direkt auf der Mine: keine Reaktion
      const magma = window.__sn.asteroid(m.x, m.y, 30, true);
      delete magma.festX; delete magma.festY;
      G.frei(5);
      const magmaHaftet = !!m.ziel;
      magma.el.remove();
      window.__game.arrays.asteroiden.splice(window.__game.arrays.asteroiden.indexOf(magma), 1);
      Audio.clearAudioHistory();
      const f = M.setzeFeind(200, 480);
      M.bisHaftet(f, 0, -3);
      const haftet = !!m.ziel && m.ziel === f;
      const offX = m.x - (f.x + 15);
      const offY = m.y - (f.y + 15);
      const klasse = m.el.classList.contains('haftet');
      const piept = Audio.audioHistory.filter(e => e.name === 'mine_piep').length;
      // Feind wandert: Mine folgt
      for (let i = 0; i < 5; i++) { f.x += 2; f.y -= 1; f.el.style.left = f.x + 'px'; f.el.style.top = f.y + 'px'; G.frei(1); }
      return { magmaHaftet, haftet, klasse, piept, folgeX: m.x - (f.x + 15) - offX, folgeY: m.y - (f.y + 15) - offY, zuender: m.zuender };
    });
    expect(r.magmaHaftet).toBe(false);
    expect(r.haftet).toBe(true);
    expect(r.klasse).toBe(true);
    expect(r.piept).toBeGreaterThanOrEqual(1);
    expect(Math.abs(r.folgeX)).toBeLessThan(0.01);
    expect(Math.abs(r.folgeY)).toBeLessThan(0.01);
    expect(r.zuender).toBeLessThan(30);
  });

  test('haftet am Ziel und explodiert nach 30 Schritten: Schaden der Stufe im Radius 30, Nachbar im Radius auch, Ziel ausserhalb nicht', async ({ page }) => {
    await bereiteMinen(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Audio } = window.__game;
      const G = window.__gr;
      const M = window.__mi;
      state.raketenStufe = 3; // 30 Schaden
      const m = M.eineMine();
      const a = M.setzeFeind(200, 480);
      const nah = M.setzeFeind(240, 430); // Mitte 40 px entfernt, Box-Kante bei 25 px -> im Radius
      const fern = M.setzeFeind(320, 430);
      M.bisHaftet(a, 0, -3);
      Audio.clearAudioHistory();
      G.frei(28);
      const vor = { hp: a.hp, nah: nah.hp, da: arrays.sniperMinen.includes(m) };
      G.frei(1); // 29. Schritt nach dem Haften
      const vor30 = arrays.sniperMinen.includes(m);
      G.frei(1); // 30.
      return {
        vor, vor30, nach: arrays.sniperMinen.includes(m), a: a.hp, nah: nah.hp, fern: fern.hp,
        welle: document.querySelectorAll('.sniper-mine-explosion').length,
        ton: Audio.audioHistory.filter(e => e.name === 'mine_explosion').length
      };
    });
    expect(r.vor).toEqual({ hp: 1000, nah: 1000, da: true });
    expect(r.vor30).toBe(true);
    expect(r.nach).toBe(false);
    expect(r.a).toBe(970);
    expect(r.nah).toBe(970);
    expect(r.fern).toBe(1000);
    expect(r.welle).toBe(1);
    expect(r.ton).toBe(1);
  });

  test('Schaden je Raketen-Stufe 20/25/30/35/40; Schild nimmt den Schaden zuerst', async ({ page }) => {
    await bereiteMinen(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const G = window.__gr;
      const M = window.__mi;
      const hp = [];
      for (let stufe = 1; stufe <= 5; stufe++) {
        window.__sn.leeren();
        state.raketenStufe = stufe;
        state.raketenCooldown = 0;
        const m = M.eineMine();
        const f = M.setzeFeind(m.x, m.y + 40);
        M.bisHaftet(f, 0, -3);
        G.frei(31);
        hp.push(f.hp);
      }
      window.__sn.leeren();
      state.raketenStufe = 1;
      const m = M.eineMine();
      const f = M.setzeFeind(m.x, m.y + 40);
      f.schildHp = 50; f.hatSchild = true;
      M.bisHaftet(f, 0, -3);
      G.frei(31);
      return { hp, schild: f.schildHp, hpSchild: f.hp };
    });
    expect(r.hp).toEqual([980, 975, 970, 965, 960]);
    expect(r.schild).toBe(30);
    expect(r.hpSchild).toBe(1000);
  });

  test('Ziel stirbt vorher: Explosion an der letzten Position, Nachbar dort bekommt Schaden', async ({ page }) => {
    await bereiteMinen(page);
    const r = await page.evaluate(() => {
      const { arrays, Utils } = window.__game;
      const G = window.__gr;
      const M = window.__mi;
      const m = M.eineMine();
      const a = M.setzeFeind(200, 480);
      const nah = M.setzeFeind(225, 430);
      M.bisHaftet(a, 0, -3);
      G.frei(10);
      const px = m.x; const py = m.y;
      Utils.zerstoereZiel(a, 'p1');
      G.frei(1);
      const w = document.querySelector('.sniper-mine-explosion');
      return {
        weg: !arrays.sniperMinen.includes(m), nah: nah.hp,
        welleX: w ? parseFloat(w.style.left) + parseFloat(w.style.width) / 2 : null, px, py
      };
    });
    expect(r.weg).toBe(true);
    expect(r.nah).toBe(980);
    expect(r.welleX).not.toBeNull();
  });

  test('Coop-P2 legt eigene Minen an der Position von P2; Reset und Game Over raeumen alles ab', async ({ page }) => {
    await bereiteMinen(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      G.halte(23, 'ö');
      G.loslassen('ö');
      const p2 = { minen: arrays.sniperMinen.map(m => [m.pKey, m.x, m.y]), cd: state.p2.raketenCooldown, cdP1: state.raketenCooldown };
      const el = document.querySelectorAll('.sniper-mine-p2').length;
      return { p2, el };
    });
    expect(r.p2.minen).toEqual([['p2', 400, 430], ['p2', 400, 430]]);
    expect(r.p2.cd).toBe(240);
    expect(r.p2.cdP1).toBe(0);
    expect(r.el).toBe(2);
    const reset = await page.evaluate(async () => {
      const Sn = await import('./js/sniper.js');
      const { state, arrays } = window.__game;
      Sn.setzeZurueck(state.p2);
      const nachP2 = arrays.sniperMinen.length;
      window.__gr.halte(12);
      window.__gr.loslassen();
      const mitP1 = arrays.sniperMinen.length;
      Sn.entferneEffekte();
      return { nachP2, mitP1, ende: arrays.sniperMinen.length, els: document.querySelectorAll('.sniper-mine').length };
    });
    expect(reset).toEqual({ nachP2: 0, mitP1: 1, ende: 0, els: 0 });
  });
});

test.describe('Spectre-SR Bot: Minen', () => {
  async function bereiteBotMinen(page) {
    await bereiteEmp(page, { coop: true });
    await page.evaluate(async () => {
      const Bot = await import('./js/bot.js');
      const { state } = window.__game;
      window.__sn.leeren();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      Bot.resetBot();
      state.p2.x = 285; state.p2.y = 480;
      state.p2.raketenCooldown = 0;
      state.x = 40; state.y = 540;
    });
  }

  test('Bot haelt die Raketen-Taste und legt Minen, wenn ein Feind heranfliegt (max. 5), dann loslassen und Cooldown', async ({ page }) => {
    await bereiteBotMinen(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      const f = G.feind(300, 480 + 15 - 148 - 15);
      let maxMinen = 0;
      let gehalten = 0;
      let granaten = 0;
      for (let i = 0; i < 80; i++) {
        // Schiff fest, Feind naehert sich jeden Schritt um 1,2 px von 148 auf etwa 60 px Abstand
        state.p2.x = 285; state.p2.y = 480;
        f.x = 285; f.y = 480 - 148 + Math.min(i, 73) * 1.2;
        f.el.style.left = f.x + 'px'; f.el.style.top = f.y + 'px';
        G.frei(1);
        if (state.p2.botFireRakete) gehalten++;
        maxMinen = Math.max(maxMinen, arrays.sniperMinen.filter(m => m.pKey === 'p2').length);
        granaten = Math.max(granaten, document.querySelectorAll('.sniper-granate').length);
      }
      return { maxMinen, gehalten, granaten, cd: state.p2.raketenCooldown, andere: arrays.sniperMinen.filter(m => m.pKey !== 'p2').length };
    });
    expect(r.maxMinen).toBe(5);
    expect(r.gehalten).toBeGreaterThanOrEqual(55);
    expect(r.gehalten).toBeLessThanOrEqual(62);
    expect(r.cd).toBeGreaterThan(150);
    expect(r.granaten).toBe(0);
    expect(r.andere).toBe(0);
  });

  test('Bot legt keine Minen ohne heranfliegenden Feind (stehender Feind, weit weg)', async ({ page }) => {
    await bereiteBotMinen(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const G = window.__gr;
      G.feind(300, 480 + 15 - 100); // nah, aber ruhend: naehert sich nicht
      G.feind(100, 100);
      let gehalten = 0;
      for (let i = 0; i < 40; i++) { G.frei(1); if (state.p2.botFireRakete) gehalten++; }
      return { gehalten, minen: arrays.sniperMinen.length };
    });
    expect(r.gehalten).toBe(0);
    expect(r.minen).toBe(0);
  });
});

test.describe('Spectre-SR Haftminen online (Host)', () => {
  test('Host: Snapshot enthaelt die Minen (id, x, y, owner, haftet, Timer, blinkt) und ein Ereignis bei der Explosion', async ({ page }) => {
    await bereiteOnlineHost(page);
    const r = await page.evaluate(async () => {
      const { state, Network, arrays } = window.__game;
      const G = window.__gr;
      const E = window.__eingabe;
      const NK = await import('./js/netzkodierung.js');
      E({ rakete: true });
      G.frei(25);
      E({ rakete: false });
      G.frei(2);
      const snap = Network.serializeGameState();
      const liste = snap.sniperMinen.map(m => ({ id: typeof m.id, x: m.x, y: m.y, owner: m.owner, haftet: m.haftet, rest: m.rest > 300, blinkt: m.blinkt }));
      const k = new NK.SnapshotKodierer();
      const dek = new NK.SnapshotDekodierer().dekodiere(JSON.parse(JSON.stringify(k.kodiere(snap, 0))));
      // Feind an die erste Mine -> haftet
      const m0 = arrays.sniperMinen[0];
      const f = G.feind(m0.x, m0.y + 20);
      G.frei(2);
      const haftet = Network.serializeGameState().sniperMinen.find(m => m.id === m0.id);
      state.network.lastSentEvent = null;
      G.frei(32);
      return { liste, dekodiert: dek.sniperMinen.length, haftet: haftet && [haftet.haftet, haftet.zuender > 0], ereignis: state.network.lastSentEvent, hp: f.hp };
    });
    expect(r.liste).toHaveLength(2);
    expect(r.liste[0]).toEqual({ id: 'string', x: 400, y: 430, owner: 'p2', haftet: false, rest: true, blinkt: false });
    expect(r.dekodiert).toBe(2);
    expect(r.haftet).toEqual([true, true]);
    expect(r.ereignis).toMatchObject({ type: 'mine_explodiert', owner: 'p2', radius: 30 });
    expect(r.hp).toBe(960); // beide Minen (an derselben Stelle) haften und explodieren
  });
});
