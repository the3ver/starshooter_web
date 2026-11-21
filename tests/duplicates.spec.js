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

// Ermittelt, welchen Spieler naechsterSpieler() fuer die Positionen liefert
async function choosePlayer(page, opts) {
  return page.evaluate(async o => {
    const { state } = await import('./js/state.js');
    const { nextPlayer, nextPlayerMiddle } = await import('./js/opponents.js');
    state.gameMode = o.mode;
    state.isDead = !!o.p1Dead;
    state.x = o.p1[0];
    state.y = o.p1[1];
    state.p2.x = o.p2[0];
    state.p2.y = o.p2[1];
    state.p2.isDead = !!o.p2Dead;
    const target = nextPlayer(o.ref[0], o.ref[1]);
    const middle = nextPlayerMiddle({ x: o.ref[0], y: o.ref[1] });
    return { who: target === state ? 'p1' : target === state.p2 ? 'p2' : '?', middle };
  }, opts);
}

test.describe('nextPlayer', () => {
  test('Einzelspieler liefert immer P1, auch wenn P2 naeher waere', async ({ page }) => {
    const r = await choosePlayer(page, { mode: 'single', p1: [300, 500], p2: [100, 100], ref: [100, 100] });
    expect(r.who).toBe('p1');
  });

  test('Coop: naeherer P2 wird gewaehlt', async ({ page }) => {
    const r = await choosePlayer(page, { mode: 'coop', p1: [300, 500], p2: [100, 100], ref: [110, 90] });
    expect(r.who).toBe('p2');
  });

  test('Online zaehlt als Coop', async ({ page }) => {
    const r = await choosePlayer(page, { mode: 'online', p1: [300, 500], p2: [100, 100], ref: [110, 90] });
    expect(r.who).toBe('p2');
  });

  test('Coop: toter P1 fuehrt zu P2, auch wenn P1 naeher ist', async ({ page }) => {
    const r = await choosePlayer(page, {
      mode: 'coop',
      p1: [100, 100],
      p2: [400, 500],
      ref: [100, 100],
      p1Dead: true,
    });
    expect(r.who).toBe('p2');
  });

  test('Coop: toter P2 wird nie gewaehlt', async ({ page }) => {
    const r = await choosePlayer(page, {
      mode: 'coop',
      p1: [400, 500],
      p2: [100, 100],
      ref: [100, 100],
      p2Dead: true,
    });
    expect(r.who).toBe('p1');
  });

  test('Coop: gleicher Abstand behaelt P1', async ({ page }) => {
    const r = await choosePlayer(page, { mode: 'coop', p1: [100, 200], p2: [300, 200], ref: [200, 50] });
    expect(r.who).toBe('p1');
  });

  test('Abstand zaehlt von Spieler-Ecke zum Referenzpunkt, Mitte liefert Schiffsmitte', async ({ page }) => {
    const h = await page.evaluate(async () => (await import('./js/state.js')).config.playerSize / 2);
    // Von der Spieler-Mitte aus waere P2 naeher, von der Spieler-Ecke aus ist P1 naeher
    const r = await choosePlayer(page, {
      mode: 'coop',
      p1: [100, 100],
      p2: [100 - 2 * h - 2, 100],
      ref: [100 - h, 100],
    });
    expect(r.who).toBe('p1');
    expect(r.middle).toEqual({ x: 100 + h, y: 100 + h });
    // Gegenprobe: P2 knapp naeher an der Ecke
    const r2 = await choosePlayer(page, {
      mode: 'coop',
      p1: [100, 100],
      p2: [100 - 2 * h + 2, 100],
      ref: [100 - h, 100],
    });
    expect(r2.who).toBe('p2');
    expect(r2.middle).toEqual({ x: 100 - 2 * h + 2 + h, y: 100 + h });
  });
});

// Struktur eines Anzeige-Containers: Kindelemente mit Klassen und sichtbarem Text (ohne Farben/Styles)
async function uiHistory(page) {
  return page.evaluate(async () => {
    const { state, dom } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const structure = el =>
      Array.from(el.children).map(c => ({
        cls: c.className.trim().split(/\s+/).sort(),
        text: c.textContent,
        title: c.getAttribute('title'),
      }));
    const normal = el => el.innerHTML.replace(/ (style|title)="[^"]*"/g, '');
    const read = (p1, p2) => ({
      p1: {
        lives: structure(dom.livesDisplay),
        livesN: normal(dom.livesDisplay),
        pu: structure(dom.activePowerupsContainer),
        pu_n: normal(dom.activePowerupsContainer),
        marker: dom.maxEnergyMarker.style.left,
        hud: [
          dom.splitterHudP1.style.display,
          dom.splitterRedCountP1.textContent,
          dom.splitterWhiteCountP1.textContent,
        ],
      },
      p2: {
        lives: structure(dom.livesDisplayP2),
        livesN: normal(dom.livesDisplayP2),
        pu: structure(dom.activePowerupsContainerP2),
        pu_n: normal(dom.activePowerupsContainerP2),
        marker: dom.maxEnergyMarkerP2.style.left,
        hud: [
          dom.splitterHudP2.style.display,
          dom.splitterRedCountP2.textContent,
          dom.splitterWhiteCountP2.textContent,
        ],
      },
      erwMarker: [(p1.maxEnergy / p1.absMaxEnergy) * 100 + '%', (p2.maxEnergy / p2.absMaxEnergy) * 100 + '%'],
    });
    const all = () => {
      Utils.updateLivesUi();
      Utils.updateLivesP2Ui();
      Utils.updateActivePowerupsUi();
      Utils.updateActivePowerupsP2Ui();
      Utils.updateMaxEnergyMarker();
      Utils.updateMaxEnergyMarkerP2();
      Utils.updateSplitterUI();
      Utils.updateSplitterP2UI();
    };
    const p1 = state,
      p2 = state.p2;
    // Beide Spieler bekommen in jedem Schritt exakt denselben Zustand
    const set = z => {
      for (const s of [p1, p2]) Object.assign(s, z);
    };
    const log = [];
    state.gameMode = 'coop';
    set({
      lives: 3,
      laserTier: 1,
      missileTier: 1,
      bombTier: 1,
      laserPierce: false,
      autolaserActive: false,
      shieldTier: 0,
      selectedShipModel: 'viper',
      maxEnergy: 50,
      splitterRed: 0,
      splitterWhite: 0,
      phantomShieldRegenTimer: 0,
    });
    all();
    log.push(read(p1, p2));

    set({
      lives: 1,
      laserTier: 3,
      missileTier: 5,
      bombTier: 2,
      laserPierce: true,
      autolaserActive: true,
      shieldTier: 2,
      maxEnergy: 75,
      splitterRed: 4,
      splitterWhite: 7,
    });
    all();
    log.push(read(p1, p2));

    set({
      lives: 4,
      laserTier: 5,
      missileTier: 2,
      bombTier: 1,
      laserPierce: false,
      autolaserActive: false,
      shieldTier: 0,
      selectedShipModel: 'phantom',
      phantomShieldRegenTimer: 300,
      phantomShieldRegenMax: 600,
    });
    all();
    log.push(read(p1, p2));

    state.gameMode = 'single';
    set({ selectedShipModel: 'viper', splitterRed: 0, splitterWhite: 0, phantomShieldRegenTimer: 0 });
    all();
    log.push(read(p1, p2));
    return log;
  });
}

test('P1/P2-UI-Funktionen zeigen Leben, Powerup-Stufen, Marker und Splitter-HUD fuer beide Spieler gleich', async ({
  page,
}) => {
  const [start, s1, s2, s3] = await uiHistory(page);
  const active = list => list.filter(e => !e.cls.includes('pu-anim-lost'));
  const lost = list => list.filter(e => e.cls.includes('pu-anim-lost'));
  const texts = list => list.map(e => e.text);

  for (const k of ['p1', 'p2']) {
    // Start: 3 Herzen, keine Powerup-Icons, kein Splitter-HUD ohne Splitter
    expect(start[k].lives.length).toBe(3);
    expect(start[k].pu).toEqual([]);

    // Schritt 1: Leben 1 (2 Verlust-Herzen), alle Powerups mit Stufen-Text in fester Reihenfolge
    expect(active(s1[k].lives).length).toBe(1);
    expect(lost(s1[k].lives).length).toBe(2);
    expect(texts(active(s1[k].pu))).toEqual(['L3', 'R5', 'B2', '↑', 'O2', 'A']);
    expect(active(s1[k].pu).every(e => e.cls.includes('active-pu-icon') && e.cls.includes('pu-anim-new'))).toBe(true);
    expect(s1[k].hud).toEqual(['flex', '4', '7']);

    // Schritt 2: mehr Leben, Upgrade/Downgrade/Verlust, Phantom-Schild laedt auf
    expect(active(s2[k].lives).length).toBe(4);
    expect(s2[k].pu.find(e => e.text === 'L5').cls).toContain('pu-anim-upgrade');
    expect(s2[k].pu.find(e => e.text === 'R2').cls).toContain('pu-anim-downgrade');
    const shield = s2[k].pu.find(e => e.cls.includes('pu-recharging-shield'));
    expect(shield.text).toBe('O1');
    expect(shield.title).toMatch(/\d+%/);
    expect(texts(lost(s2[k].pu)).sort()).toEqual(['A', 'B2', '↑'].sort());
    expect(s2[k].hud[0]).toBe('none'); // Phantom hat kein Splitter-HUD

    // Schritt 3: unveraenderte Lebenszahl, keine neuen Icons
    expect(active(s3[k].lives).length).toBe(4);
  }
  // Einzelspieler: nur P1 (Viper) zeigt das Splitter-HUD
  expect(s3.p1.hud[0]).toBe('flex');
  expect(s3.p2.hud[0]).toBe('none');

  // Marker = maxEnergie / absMaxEnergie in Prozent, fuer beide Spieler
  for (const s of [start, s1, s2, s3]) {
    expect(parseFloat(s.p1.marker)).toBeCloseTo(parseFloat(s.erwMarker[0]), 5);
    expect(parseFloat(s.p2.marker)).toBeCloseTo(parseFloat(s.erwMarker[1]), 5);
  }
  expect(parseFloat(s1.p1.marker)).toBeGreaterThan(parseFloat(start.p1.marker));

  // Doppelungs-Abbau: bei gleichem Zustand liefern P1 und P2 dieselbe Struktur (ohne Styles/Titel)
  for (const s of [start, s1, s2]) {
    expect(s.p2.livesN).toBe(s.p1.livesN);
    expect(s.p2.pu_n).toBe(s.p1.pu_n);
    expect(s.p2.hud).toEqual(s.p1.hud);
    expect(s.p2.marker).toBe(s.p1.marker);
  }
});

// Bewegung und Energie fachlich pruefen: Richtung/Betrag aus dem Schiffsmodell, Randbegrenzung, Regeneration
async function playerBehavior(page, model) {
  return page.evaluate(async m => {
    const { state, config, arrays } = await import('./js/state.js');
    const Player = await import('./js/player.js');
    const mod = window.__game.shipModels[m];
    const t = state.keysPressed;
    state.gameMode = 'coop';
    state.p2IsBot = false;
    state.isDead = false;
    state.p2.isDead = false;
    state.unlimitedEnergy = false;
    state.p2.unlimitedEnergy = false;
    arrays.powerups.length = 0;
    const player = {
      p1: { s: state, keys: { left: 'a', right: 'd', top: 'w', bottom: 's', fire: 'b' } },
      p2: {
        s: state.p2,
        keys: { left: 'arrowleft', right: 'arrowright', top: 'arrowup', bottom: 'arrowdown', fire: 'ä' },
      },
    };
    state.selectedShipModel = m;
    state.p2.selectedShipModel = m;
    const maxX = config.playfieldWidth - config.playerSize;
    const maxY = config.playfieldHeight - config.playerSize;
    const step = key => {
      Object.keys(t).forEach(k => {
        t[k] = false;
      });
      if (key) t[key] = true;
      Player.movePlayer();
      Player.updateEnergy();
    };
    const setPos = (s, x, y) => {
      s.x = x;
      s.y = y;
      s.prevX = x;
      s.prevY = y;
    };
    const out = { speed: mod.speed, regen: mod.energyRegen, maxX, maxY };
    for (const [name, { s, keys }] of Object.entries(player)) {
      const r = {};
      for (const direction of ['left', 'right', 'top', 'bottom']) {
        setPos(state, 300, 300);
        setPos(state.p2, 300, 300);
        step(keys[direction]);
        r[direction] = { dx: s.x - 300, dy: s.y - 300 };
      }
      setPos(s, 300, 300);
      step(null);
      r.rest = { dx: s.x - 300, dy: s.y - 300 };
      // Randbegrenzung
      setPos(s, 1, 1);
      step(keys.left);
      r.edgeLeft = s.x;
      setPos(s, 1, 1);
      step(keys.top);
      r.edgeTop = s.y;
      setPos(s, maxX - 1, 300);
      step(keys.right);
      r.edgeRight = s.x;
      setPos(s, 300, maxY - 1);
      step(keys.bottom);
      r.edgeBottom = s.y;
      // Energie: Feuern verbraucht, Nicht-Feuern laedt um energyRegen
      s.maxEnergy = 100;
      s.laserTier = 1;
      s.laserShoots = false;
      s.energy = 50;
      setPos(s, 300, 300);
      step(keys.fire);
      r.fire = { beforehand: 50, afterwards: s.energy, shoots: s.laserShoots };
      s.energy = 20;
      s.laserShoots = false;
      step(null);
      r.regen = { beforehand: 20, afterwards: s.energy, shoots: s.laserShoots };
      s.energy = s.maxEnergy;
      step(null);
      r.full = s.energy;
      out[name] = r;
    }
    return out;
  }, model);
}

for (const model of ['viper', 'phantom']) {
  test(`bewegeSpieler/aktualisiereEnergie: Richtung, Randbegrenzung und Energie fuer P1 und P2 (${model})`, async ({
    page,
  }) => {
    const o = await playerBehavior(page, model);
    expect(o.speed).toBeGreaterThan(0);
    for (const k of ['p1', 'p2']) {
      const r = o[k];
      // Bewegung: richtige Richtung um die Geschwindigkeit des Schiffsmodells
      expect(r.left.dx).toBeCloseTo(-o.speed, 5);
      expect(r.left.dy).toBeCloseTo(0, 5);
      expect(r.right.dx).toBeCloseTo(o.speed, 5);
      expect(r.right.dy).toBeCloseTo(0, 5);
      expect(r.top.dy).toBeCloseTo(-o.speed, 5);
      expect(r.top.dx).toBeCloseTo(0, 5);
      expect(r.bottom.dy).toBeCloseTo(o.speed, 5);
      expect(r.bottom.dx).toBeCloseTo(0, 5);
      expect(r.rest.dx).toBeCloseTo(0, 5);
      expect(r.rest.dy).toBeCloseTo(0, 5);
      // Randbegrenzung
      expect(r.edgeLeft).toBe(0);
      expect(r.edgeTop).toBe(0);
      expect(r.edgeRight).toBeCloseTo(o.maxX, 5);
      expect(r.edgeBottom).toBeCloseTo(o.maxY, 5);
      // Energie
      expect(r.fire.shoots).toBe(true);
      expect(r.fire.afterwards).toBeLessThan(r.fire.beforehand);
      expect(r.regen.shoots).toBe(false);
      expect(r.regen.afterwards).toBeCloseTo(r.regen.beforehand + o.regen, 5);
      expect(r.full).toBeCloseTo(100, 5); // nie ueber maxEnergie
    }
    // P1 und P2 verhalten sich gleich
    expect(o.p2.fire.afterwards).toBeCloseTo(o.p1.fire.afterwards, 5);
    expect(o.p2.regen.afterwards).toBeCloseTo(o.p1.regen.afterwards, 5);
  });
}
