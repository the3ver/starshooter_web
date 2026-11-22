const { test, expect } = require('@playwright/test');
const { setGameState, startGame } = require('./helpers');

// Main menu: the layout must not jump on a mode switch (fixed width, fixed height of the options)
const MODES = ['single', 'coop', 'online'];
const VIEWS = [
  { name: 'Desktop 800x600', viewport: { width: 800, height: 600 } },
  { name: 'Handy 412x915', viewport: { width: 412, height: 915 } },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await page.route('**/api/turn*', route =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'TURN nicht konfiguriert' }),
    }),
  );
  await setGameState(page);
});

async function openUpMenu(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
}

// Menu measurements in the current mode (rects in page coordinates)
async function miss(page) {
  // Wait for finite transitions: playfield width (0.25 s) and menu content (e.g. font size of the start text);
  // infinite animations (blinking) do not count. Without this the test measures mid-transition depending on machine load.
  await page.waitForFunction(() =>
    ['spielfeld', 'start-screen'].every(id =>
      document
        .getElementById(id)
        .getAnimations({ subtree: true })
        .every(a => a.effect.getComputedTiming().iterations === Infinity),
    ),
  );
  return page.evaluate(() => {
    const r = sel => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { top: b.top, left: b.left, width: b.width, height: b.height };
    };
    const menu = document.getElementById('start-screen');
    return {
      title: r('.start-title'),
      hangarName: r('#hangar-ship-name'),
      startText: r('#start-text'),
      options: r('#modus-optionen'),
      menu: r('#start-screen'),
      scrollHeight: menu.scrollHeight,
      clientHeight: menu.clientHeight,
      fieldWidth: document.getElementById('spielfeld').clientWidth,
      fieldStyleWidth: document.getElementById('spielfeld').style.width,
      configWidth: window.__game.config.playfieldWidth,
    };
  });
}

for (const view of VIEWS) {
  test.describe(`main menu ${view.name}`, () => {
    test('Title, hangar and start text sit at the same place in all modes', async ({ page }) => {
      await openUpMenu(page, view.viewport);
      const values = {};
      for (const mode of MODES) {
        await page.click(`#gamemode-btn-${mode}`);
        values[mode] = await miss(page);
      }
      for (const mode of ['coop', 'online']) {
        for (const part of ['title', 'hangarName', 'startText', 'options', 'menu']) {
          for (const axis of ['top', 'left']) {
            expect(
              Math.abs(values[mode][part][axis] - values.single[part][axis]),
              `${part}.${axis} ${mode} vs single`,
            ).toBeLessThanOrEqual(1);
          }
        }
        expect(Math.abs(values[mode].menu.height - values.single.menu.height)).toBeLessThanOrEqual(1);
      }
    });

    test('Menu does not scroll, fits the playfield height and the title stays visible', async ({ page }) => {
      await openUpMenu(page, view.viewport);
      for (const mode of MODES) {
        await page.click(`#gamemode-btn-${mode}`);
        const w = await miss(page);
        expect(w.scrollHeight, `scrollHeight ${mode}`).toBeLessThanOrEqual(w.clientHeight);
        const field = await page.evaluate(() => document.getElementById('spielfeld').getBoundingClientRect().toJSON());
        expect(w.menu.height, `Menuehoehe ${mode}`).toBeLessThanOrEqual(field.height);
        expect(w.title.top, `title top ${mode}`).toBeGreaterThanOrEqual(field.top);
        expect(w.startText.top + w.startText.height, `start text bottom ${mode}`).toBeLessThanOrEqual(
          field.top + field.height,
        );
      }
    });

    test('Playfield width in the menu is the same in all modes (single player width)', async ({ page }) => {
      await openUpMenu(page, view.viewport);
      for (const mode of MODES) {
        await page.click(`#gamemode-btn-${mode}`);
        const w = await miss(page);
        expect(w.configWidth, `config ${mode}`).toBe(400);
        expect(w.fieldStyleWidth, `style ${mode}`).toBe('400px');
        expect(w.fieldWidth, `offsetWidth ${mode}`).toBe(400);
      }
    });
  });
}

test('Online lobby is as wide as the hangar and centered; lobby states do not exceed the fixed height', async ({
  page,
}) => {
  await openUpMenu(page, { width: 800, height: 600 });
  await page.click('#gamemode-btn-online');
  const measure = () =>
    page.evaluate(() => {
      const l = document.getElementById('online-lobby-container').getBoundingClientRect();
      const h = document.getElementById('hangar-container').getBoundingClientRect();
      const o = document.getElementById('modus-optionen').getBoundingClientRect();
      const lobby = document.getElementById('online-lobby-container');
      return {
        lobbyWidth: l.width,
        hangarWidth: h.width,
        lobbyLeft: l.left,
        hangarLeft: h.left,
        lobbyHeight: l.height,
        optionsHeight: o.height,
        lobbyScrolls: lobby.scrollHeight > lobby.clientHeight,
      };
    });
  let m = await measure();
  expect(Math.abs(m.lobbyWidth - m.hangarWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.lobbyLeft - m.hangarLeft)).toBeLessThanOrEqual(1);
  expect(m.lobbyHeight).toBeLessThanOrEqual(m.optionsHeight);
  expect(m.lobbyScrolls).toBe(false);

  // Connection setup (room code, step, progress bar), join/create still visible
  await page.evaluate(() => {
    const s = document.getElementById('online-status');
    s.style.display = 'block';
    s.innerHTML =
      '<div class="vp-kopf">RAUM-CODE: ABCDE</div><div class="vp-schritt">3/5 WARTE AUF MITSPIELER (0:12)</div>' +
      '<div class="vp-balken"><span class="aktiv"></span><span class="aktiv"></span><span class="aktiv"></span><span></span><span></span></div>';
  });
  m = await measure();
  expect(m.lobbyHeight).toBeLessThanOrEqual(m.optionsHeight);
  expect(m.lobbyScrolls).toBe(false);
  await expect(page.locator('#btn-online-host')).toBeVisible();
  await expect(page.locator('#btn-online-join')).toBeVisible();

  // Connected as host (start button, leave button, status line)
  await page.evaluate(() => {
    document.getElementById('online-lobby-actions').style.display = 'none';
    document.getElementById('online-connected-controls').style.display = 'flex';
    document.getElementById('btn-online-start').style.display = 'block';
    const s = document.getElementById('online-status');
    s.style.display = 'block';
    s.textContent = 'VERBUNDEN MIT MITSPIELER - BEREIT';
  });
  m = await measure();
  expect(m.lobbyHeight).toBeLessThanOrEqual(m.optionsHeight);
  expect(m.lobbyScrolls).toBe(false);
});

test('Menu fits the playfield height for every ship and every mode', async ({ page }) => {
  await openUpMenu(page, { width: 800, height: 600 });
  for (const model of ['viper', 'phantom', 'gleve', 'sniper']) {
    await page.click(`.hangar-model-btn[data-model="${model}"]`);
    for (const mode of MODES) {
      await page.click(`#gamemode-btn-${mode}`);
      const w = await miss(page);
      expect(w.scrollHeight, `${model} ${mode}`).toBeLessThanOrEqual(w.clientHeight);
      expect(w.menu.height, `${model} ${mode}`).toBeLessThanOrEqual((600 * 0.95 * 600) / 600 + 1);
    }
  }
});

test('Co-op: bot controls (player 2 tab, difficulty) do not exceed the fixed height', async ({ page }) => {
  await openUpMenu(page, { width: 800, height: 600 });
  await page.click('#gamemode-btn-coop');
  await page.click('.hangar-player-tab[data-player="p2"]');
  await page.click('#btn-p2-bot-toggle');
  await expect(page.locator('#bot-difficulty-panel')).toBeVisible();
  const w = await miss(page);
  const content = await page.evaluate(() => {
    const o = document.getElementById('modus-optionen');
    return { scroll: o.scrollHeight, client: o.clientHeight };
  });
  expect(content.scroll).toBeLessThanOrEqual(content.client);
  expect(w.scrollHeight).toBeLessThanOrEqual(w.clientHeight);
});

test('Co-op controls: two columns with four rows "key -> action" each, without wrapping', async ({ page }) => {
  await openUpMenu(page, { width: 800, height: 600 });
  await page.click('#gamemode-btn-coop');
  await page.click('#btn-open-steuerung');
  const columns = await page.evaluate(() => {
    return [...document.querySelectorAll('#steuerung-info-coop .steuerung-col')].map(col =>
      [...col.querySelectorAll('.steuerung-zeile')].map(z => {
        const b = z.getBoundingClientRect();
        const k = z.querySelector('b').getBoundingClientRect();
        const a = z.querySelector('span').getBoundingClientRect();
        const column = col.getBoundingClientRect();
        return {
          text: z.textContent.replace(/\s+/g, ' ').trim(),
          singleLine: b.height < 18 && Math.abs(k.top - a.top) < 2,
          fits: b.right <= column.right + 0.5 && z.scrollWidth <= z.clientWidth,
        };
      }),
    );
  });
  expect(columns).toHaveLength(2);
  for (const column of columns) {
    expect(column).toHaveLength(4);
    for (const z of column) {
      expect(z.singleLine, z.text).toBe(true);
      expect(z.fits, z.text).toBe(true);
    }
  }
  expect(columns[0][1].text).toContain('Laser');
  expect(columns[1][0].text).toContain('Bewegen');
});

test('Co-op: playfield becomes 600 px wide only at game start, after pause -> main menu menu width again', async ({
  page,
}) => {
  await openUpMenu(page, { width: 800, height: 600 });
  await page.click('#gamemode-btn-coop');
  expect((await miss(page)).configWidth).toBe(400);

  await startGame(page);
  await page.waitForFunction(() => window.__game.state.gameRunning);
  const inGame = await miss(page);
  expect(inGame.configWidth).toBe(600);
  expect(inGame.fieldStyleWidth).toBe('600px');
  expect(inGame.fieldWidth).toBe(600);
  expect(await page.evaluate(() => document.getElementById('spielfeld').classList.contains('mode-coop'))).toBe(true);

  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__game.state.paused);
  await page.click('#btn-pause-hauptmenue');
  await page.click('#btn-pause-ja');
  await expect(page.locator('#start-screen')).toBeVisible();
  const inMenu = await miss(page);
  expect(inMenu.configWidth).toBe(400);
  expect(inMenu.fieldStyleWidth).toBe('400px');
  expect(inMenu.fieldWidth).toBe(400);
  expect(inMenu.scrollHeight).toBeLessThanOrEqual(inMenu.clientHeight);
});

test('Co-op: restart (game over) restores the menu width', async ({ page }) => {
  await openUpMenu(page, { width: 800, height: 600 });
  await page.click('#gamemode-btn-coop');
  await startGame(page);
  await page.waitForFunction(() => window.__game.state.gameRunning);
  expect((await miss(page)).configWidth).toBe(600);
  await page.evaluate(() => window.__game.Utils.restartGame());
  const w = await miss(page);
  expect(w.configWidth).toBe(400);
  expect(w.fieldWidth).toBe(400);
});

test('Single player stays at 400 px at game start', async ({ page }) => {
  await openUpMenu(page, { width: 800, height: 600 });
  await startGame(page);
  await page.waitForFunction(() => window.__game.state.gameRunning);
  const w = await miss(page);
  expect(w.configWidth).toBe(400);
  expect(w.fieldWidth).toBe(400);
});

test.describe('Menu tidied up: controls overlay and perk chips', () => {
  test('Controls button opens the overlay, CLOSE and ESC close it', async ({ page }) => {
    await openUpMenu(page, { width: 800, height: 600 });
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
    expect(await page.evaluate(() => window.__game.state.gameRunning)).toBe(false);
  });

  test('Overlay shows the controls of the current mode (single vs co-op)', async ({ page }) => {
    await openUpMenu(page, { width: 800, height: 600 });
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

  test('A key press with the overlay open does not start a game, afterwards it does', async ({ page }) => {
    await openUpMenu(page, { width: 800, height: 600 });
    await page.click('#btn-open-steuerung');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyW');
    expect(
      await page.evaluate(() => window.__game.state.gameRunning || window.__game.state.cutsceneActive),
    ).toBeFalsy();
    await expect(page.locator('#start-screen')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.down('KeyW');
    await expect
      .poll(() => page.evaluate(() => window.__game.state.cutsceneActive || window.__game.state.gameRunning))
      .toBeTruthy();
    await page.keyboard.up('KeyW');
  });

  test('Short line with the most important keys per mode', async ({ page }) => {
    await openUpMenu(page, { width: 800, height: 600 });
    const short = page.locator('#steuerung-kurz');
    await expect(short).toContainText('L Laser');
    await page.click('#gamemode-btn-coop');
    await expect(short).toContainText('P1: WASD');
    await expect(short).toContainText('P2: Pfeile');
    await page.click('#gamemode-btn-online');
    await expect(short).toContainText('L Laser');
    await expect(short).toBeVisible();
  });

  test('Perk chips: count matches the ship, tapping shows label and description', async ({ page }) => {
    await openUpMenu(page, { width: 800, height: 600 });
    for (const model of ['viper', 'phantom', 'gleve', 'sniper']) {
      await page.click(`.hangar-model-btn[data-model="${model}"]`);
      const perks = await page.evaluate(
        m => window.__game.shipModels[m].perks.map(p => ({ label: p.label, desc: p.desc })),
        model,
      );
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

  test('Hangar height and perk row are the same for all ships (one row)', async ({ page }) => {
    await openUpMenu(page, { width: 800, height: 600 });
    const heights = [];
    for (const model of ['viper', 'phantom', 'gleve', 'sniper']) {
      await page.click(`.hangar-model-btn[data-model="${model}"]`);
      await page.locator('#hangar-ship-perks .hangar-perk-chip').last().click();
      heights.push(
        await page.evaluate(() => ({
          hangar: document.getElementById('hangar-container').getBoundingClientRect().height,
          perks: document.getElementById('hangar-ship-perks').getBoundingClientRect().height,
          detail:
            document.getElementById('hangar-perk-detail').scrollHeight -
            document.getElementById('hangar-perk-detail').clientHeight,
          scroll:
            document.getElementById('start-screen').scrollHeight - document.getElementById('start-screen').clientHeight,
        })),
      );
    }
    for (const h of heights) {
      expect(Math.abs(h.hangar - heights[0].hangar)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(h.perks - heights[0].perks)).toBeLessThanOrEqual(0.5);
      expect(h.perks).toBeLessThan(36);
      expect(h.detail).toBeLessThanOrEqual(0);
      expect(h.scroll).toBeLessThanOrEqual(0);
    }
  });
});

// Issue #23: switching away from online mode while hosting a room closed nothing; the connection ticker
// (updateOnlineLobbyUI) kept the lobby and its start hint on screen.
test('switching from online to 1 player closes a waiting room and restores the start hint', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
  await page.click('#gamemode-btn-online');
  await page.evaluate(() => {
    const { state, Network } = window.__game;
    state.network.isOnline = true;
    state.network.isHost = true;
    state.network.roomCode = 'ABCDE';
    Network.updateOnlineLobbyUI();
  });
  await page.click('#gamemode-btn-single');
  const r = await page.evaluate(() => {
    const { state, Network } = window.__game;
    Network.updateOnlineLobbyUI(); // what the connection ticker does every second
    return {
      lobby: getComputedStyle(document.getElementById('online-lobby-container')).display,
      startText: document.getElementById('start-text').textContent.trim(),
      online: state.network.isOnline,
      host: state.network.isHost,
      mode: state.gameMode,
    };
  });
  expect(r).toEqual({
    lobby: 'none',
    startText: 'TAP OR PRESS ANY KEY TO START',
    online: false,
    host: false,
    mode: 'single',
  });
});

// Issue #33: the 1 player area shows the personal best (local solo list) and a short mode hint
test('1 player area shows the local best score, updates on menu return and mode switch, fits its area', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem(
      'spaceShooterHighscores',
      JSON.stringify([
        { name: 'ABC', score: 4321 },
        { name: 'XYZ', score: 1200 },
      ]),
    );
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
  const area = page.locator('#modus-optionen-single');
  await expect(area).toContainText('ALLEIN GEGEN DIE FLOTTE');
  await expect(area).toContainText('4321');
  await page.evaluate(() => {
    localStorage.setItem('spaceShooterHighscores', JSON.stringify([{ name: 'NEW', score: 9000 }]));
    window.__game.Utils.restartGame();
  });
  await expect(area).toContainText('9000');
  // the best score line fits the fixed options area (no overflow into the hangar)
  const fits = await page.evaluate(() => {
    const area = document.getElementById('modus-optionen');
    const best = document.getElementById('bestleistung-single').getBoundingClientRect();
    return area.scrollHeight <= area.clientHeight && best.bottom <= area.getBoundingClientRect().bottom;
  });
  expect(fits).toBe(true);
  // switching the mode back to 1 player reads the list again
  await page.evaluate(() =>
    localStorage.setItem('spaceShooterHighscores', JSON.stringify([{ name: 'TOP', score: 12000 }])),
  );
  await page.click('#gamemode-btn-coop');
  await page.click('#gamemode-btn-single');
  await expect(area).toContainText('12000');
});

test('1 player area without a local score shows no number', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
  await expect(page.locator('#modus-optionen-single')).toContainText('NOCH KEINE BESTLEISTUNG');
});
