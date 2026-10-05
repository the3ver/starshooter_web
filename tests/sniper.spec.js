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
