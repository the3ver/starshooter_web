const { test, expect } = require('@playwright/test');
const { setzeSpielstand, starteSpiel } = require('./helfer');

// Hauptmenue: Layout darf beim Moduswechsel nicht springen (feste Breite, feste Hoehe der Optionen)
const MODI = ['single', 'coop', 'online'];
const ANSICHTEN = [
  { name: 'Desktop 800x600', viewport: { width: 800, height: 600 } },
  { name: 'Handy 412x915', viewport: { width: 412, height: 915 } }
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.route('**/api/turn*', route => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ success: false, error: 'TURN nicht konfiguriert' })
  }));
  await setzeSpielstand(page);
});

async function oeffneMenue(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
}

// Messwerte des Menues im aktuellen Modus (Rects im Seitenkoordinatensystem)
async function miss(page) {
  // Breiten-Transition des Spielfelds (0,25 s) abwarten
  await page.waitForFunction(() => document.getElementById('spielfeld').getAnimations().length === 0);
  return page.evaluate(() => {
    const r = (sel) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { top: b.top, left: b.left, width: b.width, height: b.height };
    };
    const menue = document.getElementById('start-screen');
    return {
      titel: r('.start-title'),
      hangarName: r('#hangar-ship-name'),
      startText: r('#start-text'),
      optionen: r('#modus-optionen'),
      menue: r('#start-screen'),
      scrollHoehe: menue.scrollHeight,
      clientHoehe: menue.clientHeight,
      feldBreite: document.getElementById('spielfeld').clientWidth,
      feldStyleBreite: document.getElementById('spielfeld').style.width,
      configBreite: window.__game.config.spielfeldBreite
    };
  });
}

for (const ansicht of ANSICHTEN) {
  test.describe(`Hauptmenue ${ansicht.name}`, () => {
    test('Titel, Hangar und Start-Text liegen in allen Modi an derselben Stelle', async ({ page }) => {
      await oeffneMenue(page, ansicht.viewport);
      const werte = {};
      for (const modus of MODI) {
        await page.click(`#gamemode-btn-${modus}`);
        werte[modus] = await miss(page);
      }
      for (const modus of ['coop', 'online']) {
        for (const teil of ['titel', 'hangarName', 'startText', 'optionen', 'menue']) {
          for (const achse of ['top', 'left']) {
            expect(Math.abs(werte[modus][teil][achse] - werte.single[teil][achse]),
              `${teil}.${achse} ${modus} vs single`).toBeLessThanOrEqual(1);
          }
        }
        expect(Math.abs(werte[modus].menue.height - werte.single.menue.height)).toBeLessThanOrEqual(1);
      }
    });

    test('Menue scrollt nicht, passt in die Spielfeldhoehe und Titel bleibt sichtbar', async ({ page }) => {
      await oeffneMenue(page, ansicht.viewport);
      for (const modus of MODI) {
        await page.click(`#gamemode-btn-${modus}`);
        const w = await miss(page);
        expect(w.scrollHoehe, `scrollHeight ${modus}`).toBeLessThanOrEqual(w.clientHoehe);
        const feld = await page.evaluate(() => document.getElementById('spielfeld').getBoundingClientRect().toJSON());
        expect(w.menue.height, `Menuehoehe ${modus}`).toBeLessThanOrEqual(feld.height);
        expect(w.titel.top, `Titel oben ${modus}`).toBeGreaterThanOrEqual(feld.top);
        expect(w.startText.top + w.startText.height, `Start-Text unten ${modus}`).toBeLessThanOrEqual(feld.top + feld.height);
      }
    });

    test('Spielfeldbreite im Menue ist in allen Modi gleich (Einzelspieler-Breite)', async ({ page }) => {
      await oeffneMenue(page, ansicht.viewport);
      for (const modus of MODI) {
        await page.click(`#gamemode-btn-${modus}`);
        const w = await miss(page);
        expect(w.configBreite, `config ${modus}`).toBe(400);
        expect(w.feldStyleBreite, `style ${modus}`).toBe('400px');
        expect(w.feldBreite, `offsetWidth ${modus}`).toBe(400);
      }
    });
  });
}

test('Online-Lobby ist so breit wie der Hangar und zentriert; Lobby-Zustaende sprengen die feste Hoehe nicht', async ({ page }) => {
  await oeffneMenue(page, { width: 800, height: 600 });
  await page.click('#gamemode-btn-online');
  const mass = () => page.evaluate(() => {
    const l = document.getElementById('online-lobby-container').getBoundingClientRect();
    const h = document.getElementById('hangar-container').getBoundingClientRect();
    const o = document.getElementById('modus-optionen').getBoundingClientRect();
    const lobby = document.getElementById('online-lobby-container');
    return {
      lobbyBreite: l.width, hangarBreite: h.width, lobbyLinks: l.left, hangarLinks: h.left, lobbyHoehe: l.height, optionenHoehe: o.height,
      lobbyScrollt: lobby.scrollHeight > lobby.clientHeight
    };
  });
  let m = await mass();
  expect(Math.abs(m.lobbyBreite - m.hangarBreite)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.lobbyLinks - m.hangarLinks)).toBeLessThanOrEqual(1);
  expect(m.lobbyHoehe).toBeLessThanOrEqual(m.optionenHoehe);
  expect(m.lobbyScrollt).toBe(false);

  // Verbindungsaufbau (Raum-Code, Schritt, Fortschrittsbalken), Beitreten/Erstellen weiterhin sichtbar
  await page.evaluate(() => {
    const s = document.getElementById('online-status');
    s.style.display = 'block';
    s.innerHTML = '<div class="vp-kopf">RAUM-CODE: ABCDE</div><div class="vp-schritt">3/5 WARTE AUF MITSPIELER (0:12)</div>'
      + '<div class="vp-balken"><span class="aktiv"></span><span class="aktiv"></span><span class="aktiv"></span><span></span><span></span></div>';
  });
  m = await mass();
  expect(m.lobbyHoehe).toBeLessThanOrEqual(m.optionenHoehe);
  expect(m.lobbyScrollt).toBe(false);
  await expect(page.locator('#btn-online-host')).toBeVisible();
  await expect(page.locator('#btn-online-join')).toBeVisible();

  // Verbunden als Host (Start-Knopf, Verlassen-Knopf, Statuszeile)
  await page.evaluate(() => {
    document.getElementById('online-lobby-actions').style.display = 'none';
    document.getElementById('online-connected-controls').style.display = 'flex';
    document.getElementById('btn-online-start').style.display = 'block';
    const s = document.getElementById('online-status');
    s.style.display = 'block';
    s.textContent = 'VERBUNDEN MIT MITSPIELER - BEREIT';
  });
  m = await mass();
  expect(m.lobbyHoehe).toBeLessThanOrEqual(m.optionenHoehe);
  expect(m.lobbyScrollt).toBe(false);
});

test('Menue passt fuer jedes Schiff und jeden Modus in die Spielfeldhoehe', async ({ page }) => {
  await oeffneMenue(page, { width: 800, height: 600 });
  for (const modell of ['viper', 'phantom', 'gleve']) {
    await page.click(`.hangar-model-btn[data-model="${modell}"]`);
    for (const modus of MODI) {
      await page.click(`#gamemode-btn-${modus}`);
      const w = await miss(page);
      expect(w.scrollHoehe, `${modell} ${modus}`).toBeLessThanOrEqual(w.clientHoehe);
      expect(w.menue.height, `${modell} ${modus}`).toBeLessThanOrEqual(600 * 0.95 * 600 / 600 + 1);
    }
  }
});

test('Co-op: Bot-Steuerung (Spieler-2-Reiter, Schwierigkeit) sprengt die feste Hoehe nicht', async ({ page }) => {
  await oeffneMenue(page, { width: 800, height: 600 });
  await page.click('#gamemode-btn-coop');
  await page.click('.hangar-player-tab[data-player="p2"]');
  await page.click('#btn-p2-bot-toggle');
  await expect(page.locator('#bot-difficulty-panel')).toBeVisible();
  const w = await miss(page);
  const inhalt = await page.evaluate(() => {
    const o = document.getElementById('modus-optionen');
    return { scroll: o.scrollHeight, client: o.clientHeight };
  });
  expect(inhalt.scroll).toBeLessThanOrEqual(inhalt.client);
  expect(w.scrollHoehe).toBeLessThanOrEqual(w.clientHoehe);
});

test('Co-op-Steuerung: zwei Spalten mit je vier Zeilen "Taste -> Aktion", ohne Umbruch', async ({ page }) => {
  await oeffneMenue(page, { width: 800, height: 600 });
  await page.click('#gamemode-btn-coop');
  await page.click('#btn-open-steuerung');
  const spalten = await page.evaluate(() => {
    return [...document.querySelectorAll('#steuerung-info-coop .steuerung-col')].map(col =>
      [...col.querySelectorAll('.steuerung-zeile')].map(z => {
        const b = z.getBoundingClientRect();
        const k = z.querySelector('b').getBoundingClientRect();
        const a = z.querySelector('span').getBoundingClientRect();
        const spalte = col.getBoundingClientRect();
        return {
          text: z.textContent.replace(/\s+/g, ' ').trim(),
          einzeilig: b.height < 18 && Math.abs(k.top - a.top) < 2,
          passt: b.right <= spalte.right + 0.5 && z.scrollWidth <= z.clientWidth
        };
      }));
  });
  expect(spalten).toHaveLength(2);
  for (const spalte of spalten) {
    expect(spalte).toHaveLength(4);
    for (const z of spalte) {
      expect(z.einzeilig, z.text).toBe(true);
      expect(z.passt, z.text).toBe(true);
    }
  }
  expect(spalten[0][1].text).toContain('Laser');
  expect(spalten[1][0].text).toContain('Bewegen');
});

test('Co-op: Spielfeld wird erst beim Spielstart 600 px breit, nach Pause -> Hauptmenue wieder Menuebreite', async ({ page }) => {
  await oeffneMenue(page, { width: 800, height: 600 });
  await page.click('#gamemode-btn-coop');
  expect((await miss(page)).configBreite).toBe(400);

  await starteSpiel(page);
  await page.waitForFunction(() => window.__game.state.spielLaeuft);
  const imSpiel = await miss(page);
  expect(imSpiel.configBreite).toBe(600);
  expect(imSpiel.feldStyleBreite).toBe('600px');
  expect(imSpiel.feldBreite).toBe(600);
  expect(await page.evaluate(() => document.getElementById('spielfeld').classList.contains('mode-coop'))).toBe(true);

  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__game.state.pausiert);
  await page.click('#btn-pause-hauptmenue');
  await page.click('#btn-pause-ja');
  await expect(page.locator('#start-screen')).toBeVisible();
  const imMenue = await miss(page);
  expect(imMenue.configBreite).toBe(400);
  expect(imMenue.feldStyleBreite).toBe('400px');
  expect(imMenue.feldBreite).toBe(400);
  expect(imMenue.scrollHoehe).toBeLessThanOrEqual(imMenue.clientHoehe);
});

test('Co-op: Neustart (Game Over) stellt die Menuebreite wieder her', async ({ page }) => {
  await oeffneMenue(page, { width: 800, height: 600 });
  await page.click('#gamemode-btn-coop');
  await starteSpiel(page);
  await page.waitForFunction(() => window.__game.state.spielLaeuft);
  expect((await miss(page)).configBreite).toBe(600);
  await page.evaluate(() => window.__game.Utils.restartGame());
  const w = await miss(page);
  expect(w.configBreite).toBe(400);
  expect(w.feldBreite).toBe(400);
});

test('Einzelspieler bleibt beim Spielstart bei 400 px', async ({ page }) => {
  await oeffneMenue(page, { width: 800, height: 600 });
  await starteSpiel(page);
  await page.waitForFunction(() => window.__game.state.spielLaeuft);
  const w = await miss(page);
  expect(w.configBreite).toBe(400);
  expect(w.feldBreite).toBe(400);
});

test.describe('Menue aufgeraeumt: Steuerung-Overlay und Perk-Chips', () => {
  test('Steuerungsknopf oeffnet das Overlay, SCHLIESSEN und ESC schliessen es', async ({ page }) => {
    await oeffneMenue(page, { width: 800, height: 600 });
    const overlay = page.locator('#steuerung-overlay');
    await expect(overlay).toBeHidden();
    await page.click('#btn-open-steuerung');
    await expect(overlay).toBeVisible();
    await page.click('#btn-close-steuerung');
    await expect(overlay).toBeHidden();
    await page.click('#btn-open-steuerung');
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    expect(await page.evaluate(() => window.__game.state.spielLaeuft)).toBe(false);
  });

  test('Overlay zeigt die Steuerung des aktuellen Modus (Single vs Co-op)', async ({ page }) => {
    await oeffneMenue(page, { width: 800, height: 600 });
    await page.click('#btn-open-steuerung');
    await expect(page.locator('#steuerung-info-single')).toBeVisible();
    await expect(page.locator('#steuerung-info-coop')).toBeHidden();
    await page.click('#btn-close-steuerung');
    await page.click('#gamemode-btn-coop');
    await page.click('#btn-open-steuerung');
    await expect(page.locator('#steuerung-info-coop')).toBeVisible();
    await expect(page.locator('#steuerung-info-single')).toBeHidden();
    await expect(page.locator('#steuerung-info-coop')).toContainText('SPIELER 2');
  });

  test('Tastendruck bei offenem Overlay startet kein Spiel, danach schon', async ({ page }) => {
    await oeffneMenue(page, { width: 800, height: 600 });
    await page.click('#btn-open-steuerung');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyW');
    expect(await page.evaluate(() => window.__game.state.spielLaeuft || window.__game.state.cutsceneAktiv)).toBeFalsy();
    await expect(page.locator('#start-screen')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.down('KeyW');
    await expect.poll(() => page.evaluate(() => window.__game.state.cutsceneAktiv || window.__game.state.spielLaeuft)).toBeTruthy();
    await page.keyboard.up('KeyW');
  });

  test('Kurzzeile mit den wichtigsten Tasten je Modus', async ({ page }) => {
    await oeffneMenue(page, { width: 800, height: 600 });
    const kurz = page.locator('#steuerung-kurz');
    await expect(kurz).toContainText('L Laser');
    await page.click('#gamemode-btn-coop');
    await expect(kurz).toContainText('P1: WASD');
    await expect(kurz).toContainText('P2: Pfeile');
    await page.click('#gamemode-btn-online');
    await expect(kurz).toContainText('L Laser');
    await expect(kurz).toBeVisible();
  });

  test('Perk-Chips: Anzahl passt zum Schiff, Antippen zeigt Label und Beschreibung', async ({ page }) => {
    await oeffneMenue(page, { width: 800, height: 600 });
    for (const modell of ['viper', 'phantom', 'gleve']) {
      await page.click(`.hangar-model-btn[data-model="${modell}"]`);
      const perks = await page.evaluate((m) => window.__game.shipModels[m].perks.map(p => ({ label: p.label, desc: p.desc })), modell);
      const chips = page.locator('#hangar-ship-perks .hangar-perk-chip');
      await expect(chips).toHaveCount(perks.length);
      await expect(page.locator('#hangar-perk-detail')).toContainText('antippen');
      for (let i = 0; i < perks.length; i++) {
        await chips.nth(i).click();
        await expect(page.locator('#hangar-perk-detail')).toContainText(perks[i].label);
        await expect(page.locator('#hangar-perk-detail')).toContainText(perks[i].desc);
      }
    }
  });

  test('Hangar-Hoehe und Perk-Zeile sind fuer alle Schiffe gleich (eine Zeile)', async ({ page }) => {
    await oeffneMenue(page, { width: 800, height: 600 });
    const hoehen = [];
    for (const modell of ['viper', 'phantom', 'gleve']) {
      await page.click(`.hangar-model-btn[data-model="${modell}"]`);
      await page.locator('#hangar-ship-perks .hangar-perk-chip').last().click();
      hoehen.push(await page.evaluate(() => ({
        hangar: document.getElementById('hangar-container').getBoundingClientRect().height,
        perks: document.getElementById('hangar-ship-perks').getBoundingClientRect().height,
        detail: document.getElementById('hangar-perk-detail').scrollHeight - document.getElementById('hangar-perk-detail').clientHeight,
        scroll: document.getElementById('start-screen').scrollHeight - document.getElementById('start-screen').clientHeight
      })));
    }
    for (const h of hoehen) {
      expect(Math.abs(h.hangar - hoehen[0].hangar)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(h.perks - hoehen[0].perks)).toBeLessThanOrEqual(0.5);
      expect(h.perks).toBeLessThan(36);
      expect(h.detail).toBeLessThanOrEqual(0);
      expect(h.scroll).toBeLessThanOrEqual(0);
    }
  });
});
