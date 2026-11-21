// Anzeige-Schnittstelle (src/js/display.js): Die Spiellogik aendert nur Modellfelder, ein austauschbares
// Backend zeichnet die Weltobjekte. Diese Tests setzen ein Test-Backend statt des DOM-Backends ein.
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

test('Test-Backend: zeichneWelt einmal pro Schritt, Logik schreibt keine Positionen ins DOM, entferne beim Verlassen des Felds', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const { simulationStep } = await import('./js/loop.js');
    const { state, arrays, config } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');

    state.gameRunning = true;
    state.godMode = true;
    Entities.createEnemy(100, 50, 'normal', 0);
    const f = arrays.enemies[arrays.enemies.length - 1];
    const topBeforehand = f.el.style.top;
    const yBeforehand = f.y;

    const protocol = { draw: 0, removed: [] };
    const domBackend = Display.getBackend();
    Display.setBackend({
      create() {},
      flash() {},
      flashPlayfield() {},
      drawPlayer() {},
      drawWorld() {
        protocol.draw++;
      },
      remove(o) {
        protocol.removed.push(o.id);
      },
    });
    try {
      for (let i = 0; i < 3; i++) simulationStep();
      const afterSteps = {
        draw: protocol.draw,
        yMoved: f.y > yBeforehand,
        topEqual: f.el.style.top === topBeforehand,
      };
      f.y = config.playfieldHeight + 10;
      simulationStep();
      return {
        ...afterSteps,
        removedEnemy: protocol.removed.includes(f.id),
        offList: !arrays.enemies.includes(f),
        elementStillThere: f.el.isConnected,
      };
    } finally {
      Display.setBackend(domBackend);
    }
  });
  expect(r.draw).toBe(3);
  expect(r.yMoved).toBe(true);
  expect(r.topEqual).toBe(true);
  expect(r.removedEnemy).toBe(true);
  expect(r.offList).toBe(true);
  // Das Test-Backend entfernt nichts aus dem DOM: das Entfernen laeuft nur ueber die Anzeige
  expect(r.elementStillThere).toBe(true);
});

test('DOM-Backend zeichnet aus dem Modell: Position, Drehung, Anzeigeposition des Online-Clients', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const { arrays } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    Entities.createEnemy(100, 50, 'normal', 0);
    const f = arrays.enemies[arrays.enemies.length - 1];
    f.x = 12;
    f.y = 34;
    f.rot = 45;
    Display.drawWorld();
    const model = [f.el.style.left, f.el.style.top, f.el.style.transform];
    f.displayX = 56;
    f.displayY = 78;
    Display.drawWorld();
    const display = [f.el.style.left, f.el.style.top];
    Display.remove(f);
    return { model, display, removed: !f.el.isConnected };
  });
  expect(r.model).toEqual(['12px', '34px', 'rotate(45deg)']);
  expect(r.display).toEqual(['56px', '78px']);
  expect(r.removed).toBe(true);
});

test('setzeBackend lehnt ein Backend ohne Pflichtfunktionen ab', async ({ page }) => {
  const error = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const messages = [];
    const f = () => {};
    const full = { create: f, drawWorld: f, drawPlayer: f, remove: f, flash: f, flashPlayfield: f };
    const without = name => {
      const b = { ...full };
      delete b[name];
      return b;
    };
    for (const b of [null, {}, ...Object.keys(full).map(without)]) {
      try {
        Display.setBackend(b);
        messages.push(null);
      } catch (e) {
        messages.push(e.message);
      }
    }
    return messages;
  });
  expect(error.every(m => typeof m === 'string' && m.startsWith('Anzeige-Backend ohne'))).toBe(true);
});

test('Spiellogik erzeugt Weltobjekte nur ueber die Anzeige: Test-Backend bekommt Objekt und Art, kein DOM-Element', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const { state, arrays } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const domBackend = Display.getBackend();
    const created = [];
    Display.setBackend({
      create(o, kind) {
        created.push(kind);
      },
      drawWorld() {},
      drawPlayer() {},
      remove() {},
      flash() {},
      flashPlayfield() {},
    });
    const beforehand = document.querySelectorAll('#spielfeld *').length;
    try {
      state.level = 1;
      Entities.createEnemy(100, 50, 'normal', 0);
      Entities.createAsteroid(50, 50, 30, 0, 1, 0, true);
      Entities.createPowerup(10, 10, 'shield');
      Entities.createEnemyLaser(100, 100, 200, 300);
      Entities.createHackProjectile(100, 100, 200, 300);
      Entities.createBossLaser(100, 100, 2, 6);
      Entities.createBossBomb(100, 100);
      Entities.createBossMissile(100, 100, 1);
      Entities.createBoss();
      const fresh = [
        arrays.enemies,
        arrays.asteroids,
        arrays.powerups,
        arrays.enemyLaserArray,
        arrays.hackProjectileArray,
        arrays.bossLaserArray,
        arrays.bossBombArray,
        arrays.bossMissileArray,
        arrays.bosses,
      ].map(l => l[l.length - 1]);
      const ast = arrays.asteroids[arrays.asteroids.length - 1];
      return {
        created,
        withoutEl: fresh.every(o => o.el === undefined),
        domEqual: document.querySelectorAll('#spielfeld *').length === beforehand,
        asteroid: {
          color: typeof ast.color,
          color2: typeof ast.color2,
          formPoints: Array.isArray(ast.form) && ast.form.length >= 6,
          crack: typeof ast.crack,
        },
      };
    } finally {
      Display.setBackend(domBackend);
    }
  });
  expect(r.created).toEqual([
    'enemy',
    'asteroid',
    'powerup',
    'enemyLaser',
    'hackProjectile',
    'bossLaser',
    'bossBomb',
    'bossMissile',
    'boss',
  ]);
  expect(r.withoutEl).toBe(true);
  expect(r.domEqual).toBe(true);
  expect(r.asteroid).toEqual({ color: 'string', color2: 'string', formPoints: true, crack: 'number' });
});

test('Host und Online-Client bauen gleiche Elemente; der Snapshot traegt Modelldaten statt CSS-Text', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { arrays, state } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const Network = await import('./js/network.js');
    const Display = await import('./js/display.js');
    state.level = 1;
    Entities.createAsteroid(50, 60, 40, 0, 1, 0, true);
    Entities.createEnemy(120, 40, 'swoop', 2, true);
    Entities.createPowerup(10, 20, 'laser');
    const host = {
      asteroid: arrays.asteroids[0].el.outerHTML,
      enemy: arrays.enemies[0].el.outerHTML,
      powerup: arrays.powerups[0].el.outerHTML,
    };
    const snapshot = Network.serializeGameState();
    // Host-Objekte entfernen, damit der Client sie aus dem Snapshot neu baut
    for (const list of [arrays.asteroids, arrays.enemies, arrays.powerups]) {
      list.forEach(Display.remove);
      list.length = 0;
    }
    Network.applyGameStateSnapshot(snapshot);
    const sa = snapshot.asteroids[0];
    // transform (Drehung) haengt vom Zeitpunkt ab, der Rest muss gleich sein
    const withoutRotation = html => html.replace(/ ?transform: [^;]*;/g, '');
    return {
      equal: {
        asteroid: withoutRotation(arrays.asteroids[0].el.outerHTML) === withoutRotation(host.asteroid),
        enemy: withoutRotation(arrays.enemies[0].el.outerHTML) === withoutRotation(host.enemy),
        powerup: arrays.powerups[0].el.outerHTML === host.powerup,
      },
      snapshotFields: Object.keys(sa).filter(k => ['background', 'clipPath', 'baseColor'].includes(k)),
      formText: typeof sa.form,
    };
  });
  expect(r.equal).toEqual({ asteroid: true, enemy: true, powerup: true });
  expect(r.snapshotFields).toEqual([]);
  expect(r.formText).toBe('string');
});

// Bugfix: Der Snapshot schickte immer Boss-Typ 1 (Host speichert bossTyp), der Client zeigte daher immer den ersten Boss
test('Snapshot traegt den Boss-Typ des Hosts', async ({ page }) => {
  const typ = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const Network = await import('./js/network.js');
    state.level = 3;
    Entities.createBoss();
    return Network.serializeGameState().bosses[0].typ;
  });
  expect(typ).toBe(3);
});

// Bugfix: Der Client uebernahm schildHp nicht, das Feind-Schild blieb nach dem Brechen beim Host sichtbar
test('Online-Client: Feind-Schild verschwindet, wenn der Host es bricht', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, state } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const Network = await import('./js/network.js');
    const Display = await import('./js/display.js');
    state.level = 1;
    Entities.createEnemy(100, 40, 'normal', 0, true);
    const host = arrays.enemies[0];
    const withShield = Network.serializeGameState();
    host.shieldHp = 0;
    const withoutShield = Network.serializeGameState();
    arrays.enemies.forEach(Display.remove);
    arrays.enemies.length = 0;
    Network.applyGameStateSnapshot(withShield);
    const beforehand = !!arrays.enemies[0].el.querySelector('.feind-schild');
    Network.applyGameStateSnapshot(withoutShield);
    return { beforehand, afterwards: !!arrays.enemies[0].el.querySelector('.feind-schild') };
  });
  expect(r).toEqual({ beforehand: true, afterwards: false });
});

test('DOM-Backend zeigt Zustand aus Modellfeldern: Schild, Risse, Magma, Betaeubung, Repulsor, Schlepp-Strahl, Parade', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { arrays, state } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const Display = await import('./js/display.js');
    state.level = 1;
    Entities.createEnemy(100, 40, 'normal', 0, true);
    Entities.createAsteroid(50, 60, 40, 0, 1, 0, true);
    Entities.createBoss();
    Entities.createPowerup(10, 20, 'shield', 'p2');
    Entities.createEnemyLaser(100, 100, 100, 300);
    const [f, a, b, p, fl] = [
      arrays.enemies[0],
      arrays.asteroids[0],
      arrays.bosses[0],
      arrays.powerups[0],
      arrays.enemyLaserArray[0],
    ];
    f.shieldHp = 0;
    f.stunned = 5;
    a.hp = a.maxHp / 2;
    b.repulsorActive = true;
    p.towedBy = 'p1';
    p.beamX = 30;
    p.beamY = 40;
    fl.harmless = true;
    Display.drawWorld();
    const beam = p.beamEl && p.beamEl.querySelector('line');
    const status = {
      shieldGone: !f.el.querySelector('.feind-schild'),
      stunned: f.el.classList.contains('betaeubt'),
      crack: parseFloat(a.crackEl.style.opacity),
      repulsor: b.el.classList.contains('repulsor-aktiv'),
      towed: p.el.classList.contains('powerup-towed-p1'),
      beam: beam ? [beam.getAttribute('x1'), beam.getAttribute('y1')] : null,
      parried: fl.el.classList.contains('gleve-pariert'),
    };
    // Zustand zurueck: Klassen und Strahl verschwinden wieder; Magma-Brocken bekommt seine Klasse
    f.stunned = 0;
    b.repulsorActive = false;
    p.towedBy = null;
    a.isIndestructible = true;
    Display.drawWorld();
    const beamEl = p.beamEl;
    return {
      status,
      back: {
        stunned: f.el.classList.contains('betaeubt'),
        repulsor: b.el.classList.contains('repulsor-aktiv'),
        towed: p.el.classList.contains('powerup-towed'),
        beam: beamEl,
        magma: a.el.classList.contains('unzerstoerbar'),
      },
    };
  });
  expect(r.status).toEqual({
    shieldGone: true,
    stunned: true,
    crack: 0.5,
    repulsor: true,
    towed: true,
    beam: ['30', '40'],
    parried: true,
  });
  expect(r.back).toEqual({ stunned: false, repulsor: false, towed: false, beam: null, magma: true });
});

test('Treffer melden einen Blitz an die Anzeige, ohne Element-Zugriff der Logik', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, state } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const Display = await import('./js/display.js');
    const Gleve = await import('./js/gleve.js');
    state.level = 1;
    Entities.createAsteroid(50, 60, 40, 0, 1, 0, true);
    const a = arrays.asteroids[0];
    const domBackend = Display.getBackend();
    const flash = [];
    Display.setBackend({
      ...domBackend,
      flash(o, strength) {
        flash.push([o.id, strength]);
      },
    });
    try {
      Gleve.damageTarget(a, 1, 'p1');
    } finally {
      Display.setBackend(domBackend);
    }
    return { flash, id: a.id };
  });
  expect(r.flash).toEqual([[r.id, 2.5]]);
});

// Bugfix: Der Snapshot schickte state.rotate, das nie gesetzt wurde (die Neigung lag nur im DOM), der
// Online-Client sah P1 daher nie geneigt
test('Snapshot traegt die angezeigte Neigung von P1', async ({ page }) => {
  const rotate = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { movePlayer } = await import('./js/player.js');
    const Network = await import('./js/network.js');
    state.gameRunning = true;
    state.isDead = false;
    state.keysPressed.d = true;
    for (let i = 0; i < 20; i++) movePlayer();
    state.keysPressed.d = false;
    return Network.serializeGameState().p1.rotate;
  });
  expect(rotate).toBeGreaterThan(10);
});

test('Spielerschiff aus dem Zustand: Position, Neigung, Flammen, Sichtbarkeit, Blinken, Schild', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state, dom } = await import('./js/state.js');
    const Display = await import('./js/display.js');
    Object.assign(state, {
      x: 40,
      y: 50,
      rotation: 12,
      flameScale: 1.8,
      shipVisible: true,
      invulnerableTimer: 10,
      shieldTier: 2,
    });
    Display.drawPlayer();
    const el = dom.player;
    const an = {
      pos: [el.style.left, el.style.top],
      transform: el.style.transform,
      display: el.style.display,
      flame: document.getElementById('flame-left').style.transform,
      blink: el.classList.contains('spieler-blink'),
      shield: Array.from(el.classList).filter(k => k.startsWith('schild-aktiv-')),
    };
    // Online-Client: P1 an der interpolierten Anzeigeposition
    Object.assign(state, { displayX: 70, displayY: 80, shipVisible: false, invulnerableTimer: 0, shieldTier: 0 });
    Display.drawPlayer();
    const off = {
      pos: [el.style.left, el.style.top],
      display: el.style.display,
      blink: el.classList.contains('spieler-blink'),
      shield: Array.from(el.classList).filter(k => k.startsWith('schild-aktiv-')),
    };
    delete state.displayX;
    delete state.displayY;
    return { an, off };
  });
  expect(r.an).toEqual({
    pos: ['40px', '50px'],
    transform: 'rotate(12deg)',
    display: 'block',
    flame: 'scaleY(1.8)',
    blink: true,
    shield: ['schild-aktiv-2'],
  });
  expect(r.off).toEqual({ pos: ['70px', '80px'], display: 'none', blink: false, shield: [] });
});

test('Schiffsaussehen und -zustand aus dem Modell: SVG, Werfer-Pods, Dash/Rolle/Overdrive/Hack, Strahlen', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { state, dom } = await import('./js/state.js');
    const Display = await import('./js/display.js');
    const el = dom.player;
    const pods = () =>
      ['.werfer-links', '.werfer-rechts', '.werfer-center'].map(sel => el.querySelector(sel).style.display);
    Object.assign(state, {
      isDead: false,
      selectedShipModel: 'gleve',
      selectedShipColor: 'green',
      missileTier: 5,
      gleveDashTimer: 4,
    });
    Display.drawPlayer();
    const gleve = {
      cls: el.classList.contains('schiff-gleve'),
      dash: el.classList.contains('gleve-dash'),
      pods: pods(),
      svgGreen: el.querySelector('svg').innerHTML.includes('#2ecc71'),
    };
    Object.assign(state, {
      selectedShipModel: 'viper',
      selectedShipColor: 'red',
      missileTier: 5,
      gleveDashTimer: 0,
      viperRollTimer: 3,
      viperOverdriveTimer: 10,
      hacks: [{ typ: 'inverted', timer: 90 }],
      autolaserBeam: { x: 100, y: 300, length: 50, angle: 20 },
      hitscanBeam: { x: 100, y: 300, length: 300 },
    });
    Display.drawPlayer();
    const label = document.getElementById('hack-label-p1');
    const auto = dom.autolaserEl;
    const hitscan = document.getElementById('hitscan-laser');
    const viper = {
      cls: el.classList.contains('schiff-gleve'),
      dash: el.classList.contains('gleve-dash'),
      pods: pods(),
      roll: el.classList.contains('viper-rolle'),
      overdrive: el.classList.contains('viper-overdrive'),
      hacked: el.classList.contains('spieler-gehackt'),
      label: label && label.style.display,
      labelText: label && label.textContent,
      auto: [auto.style.display, auto.style.top, auto.style.transform],
      hitscan: [hitscan.style.display, hitscan.style.top],
    };
    Object.assign(state, {
      missileTier: 1,
      viperRollTimer: 0,
      viperOverdriveTimer: 0,
      hacks: [],
      autolaserBeam: null,
      hitscanBeam: null,
    });
    Display.drawPlayer();
    const off = {
      pods: pods(),
      roll: el.classList.contains('viper-rolle'),
      hacked: el.classList.contains('spieler-gehackt'),
      label: label.style.display,
      auto: auto.style.display,
      hitscan: hitscan.style.display,
    };
    return { gleve, viper, off };
  });
  expect(r.gleve).toEqual({ cls: true, dash: true, pods: ['none', 'none', 'none'], svgGreen: true });
  expect(r.viper).toEqual({
    cls: false,
    dash: false,
    pods: ['block', 'block', 'block'],
    roll: true,
    overdrive: true,
    hacked: true,
    label: 'block',
    labelText: 'INVERTED',
    auto: ['block', '250px', 'rotate(20deg)'],
    hitscan: ['block', '0px'],
  });
  expect(r.off).toEqual({
    pods: ['block', 'none', 'none'],
    roll: false,
    hacked: false,
    label: 'none',
    auto: 'none',
    hitscan: 'none',
  });
});

test('Detonationen erzeugen Effekte ueber die Anzeige: Test-Backend bekommt Art effekt, kein Element im Spielfeld', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const Utils = await import('./js/utils.js');
    const { arrays } = await import('./js/state.js');
    const domBackend = Display.getBackend();
    const kinds = [];
    Display.setBackend({
      create(o, kind) {
        if (kind === 'effect') kinds.push(o.kind);
      },
      drawWorld() {},
      drawPlayer() {},
      remove() {},
      flash() {},
      flashPlayfield() {},
    });
    const beforehand = document.querySelector('#spielfeld').children.length;
    try {
      Utils.createBombDetonation(100, 100, '#f39c12', 80, 1, false);
      Utils.createMissileDetonation(200, 200, 70);
      return {
        kinds,
        effects: arrays.effects.length,
        children: document.querySelector('#spielfeld').children.length - beforehand,
      };
    } finally {
      Display.setBackend(domBackend);
      arrays.effects.length = 0;
    }
  });
  expect(r.kinds).toEqual(['bombWave', 'missileWave']);
  expect(r.effects).toBe(2);
  expect(r.children).toBe(0);
});

test('Effekt laeuft nach dauer Schritten ab (Element weg), in der Pause nicht', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    const { simulationStep } = await import('./js/loop.js');
    const { state, arrays } = await import('./js/state.js');
    state.gameRunning = true;
    state.godMode = true;
    state.frameCounter = 1;
    Utils.createMissileDetonation(200, 200, 70);
    const e = arrays.effects[0];
    const duration = e.duration;
    const t0 = e.el.style.transform;
    state.paused = true;
    for (let i = 0; i < 5; i++) simulationStep();
    const pause = { rest: e.rest, there: e.el.isConnected };
    state.paused = false;
    for (let i = 0; i < 5; i++) simulationStep();
    const middle = { rest: e.rest, scale: e.el.style.transform !== t0, opacity: Number(e.el.style.opacity) };
    for (let i = 0; i < duration; i++) simulationStep();
    return { duration, pause, middle, empty: arrays.effects.length, gone: !e.el.isConnected };
  });
  expect(r.duration).toBe(18);
  expect(r.pause).toEqual({ rest: 18, there: true });
  expect(r.middle.rest).toBe(13);
  expect(r.middle.scale).toBe(true);
  expect(r.middle.opacity).toBeLessThan(1);
  expect(r.empty).toBe(0);
  expect(r.gone).toBe(true);
});

test('Stufe-3-Bombe erzeugt zwei Effekte, der zweite ist in den ersten 9 Schritten unsichtbar', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    const { simulationStep } = await import('./js/loop.js');
    const { state, arrays } = await import('./js/state.js');
    state.gameRunning = true;
    state.godMode = true;
    state.frameCounter = 1;
    Utils.createBombDetonation(200, 200, '#9b59b6', 100, 3, false);
    const [a, b] = arrays.effects;
    const invisible = [];
    for (let i = 0; i < 12; i++) {
      invisible.push(b.el.style.opacity === '0');
      simulationStep();
    }
    const mini = arrays.effects.length;
    Utils.createBombDetonation(200, 200, '#9b59b6', 100, 3, true);
    return {
      kinds: [a.kind, b.kind],
      invisible,
      firstVisible: a.el.style.opacity !== '0',
      mini,
      afterMini: arrays.effects.length - mini,
    };
  });
  expect(r.kinds).toEqual(['bombWave', 'bombWave2']);
  expect(r.invisible).toEqual([true, true, true, true, true, true, true, true, true, false, false, false]);
  expect(r.firstVisible).toBe(true);
  // Mini-Bomben (Stufe 3) bekommen keine zweite Welle
  expect(r.afterMini).toBe(1);
});

test('Boss-Bombe erzeugt eine Boss-Welle als Effekt, Game Over und Neustart raeumen Effekte ab', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    const { updateBossBombs } = await import('./js/boss.js');
    const { state, arrays } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    state.gameRunning = true;
    state.godMode = true;
    Entities.createBossBomb(185, 100);
    arrays.bossBombArray[0].timer = 0;
    updateBossBombs();
    const boss = arrays.effects.map(e => e.kind);
    const cls = arrays.effects[0].el.classList.contains('boss-shockwave');
    Utils.triggerGameOver(0);
    const afterGameOver = arrays.effects.length;
    Utils.createMissileDetonation(100, 100, 70);
    const el = arrays.effects[0].el;
    Utils.restartGame();
    return { boss, cls, afterGameOver, afterRestart: arrays.effects.length, elGone: !el.isConnected };
  });
  expect(r.boss).toEqual(['bossWave']);
  expect(r.cls).toBe(true);
  expect(r.afterGameOver).toBe(0);
  expect(r.afterRestart).toBe(0);
  expect(r.elGone).toBe(true);
});

test('Sniper-Effekte (Strahl, Druckwelle, Minen-Explosion, EMP) laufen als Effekt ueber die Anzeige, Rest und Aufraeumen nach pKey', async ({
  page,
}) => {
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  await page.keyboard.up('KeyW');
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const Sniper = await import('./js/sniper.js');
    const { state, arrays } = await import('./js/state.js');
    const domBackend = Display.getBackend();
    const kinds = [];
    const removed = [];
    state.selectedShipModel = 'sniper';
    state.energy = 100;
    try {
      Display.setBackend({
        create(o, kind) {
          if (kind === 'effect') kinds.push(o.kind);
        },
        drawWorld() {},
        drawPlayer() {},
        remove(o) {
          removed.push(o.kind);
        },
        flash() {},
        flashPlayfield() {},
      });
      Sniper.updateSniper(state, 'p1', true);
      Sniper.updateSniper(state, 'p1', false);
      Sniper.showDetonation({ x: 100, y: 100, radius: 70, owner: 'p1' });
      Sniper.showMineExplosion({ x: 150, y: 150, radius: 30, owner: 'p2' });
      Sniper.showEmp({ x: 200, y: 200, radius: 80, owner: 'p1' });
      // das Fadenkreuz bleibt vorerst direkt im DOM, die Effekte nicht
      const children = document.querySelectorAll(
        '.sniper-strahl, .sniper-druckwelle, .sniper-mine-explosion, .sniper-emp',
      ).length;
      const beam = arrays.effects.find(e => e.kind === 'sniperBeam');
      const modelFields = beam
        ? ['x', 'y', 'length', 'angle', 'width', 'glow', 'color', 'pKey'].every(k => beam[k] !== undefined)
        : false;
      const total = arrays.effects.length;
      Sniper.reset(state);
      const afterP1 = arrays.effects.map(e => e.pKey);
      Sniper.removeEffects();
      return {
        kinds,
        children,
        modelFields,
        total,
        afterP1,
        afterAll: arrays.effects.length,
        removed: removed.length,
      };
    } finally {
      Display.setBackend(domBackend);
      state.selectedShipModel = 'viper';
      arrays.effects.length = 0;
    }
  });
  expect(r.kinds.sort()).toEqual(['sniperBeam', 'sniperBlastWave', 'sniperEmp', 'sniperMineExplosion']);
  expect(r.children).toBe(0);
  expect(r.modelFields).toBe(true);
  expect(r.total).toBe(4);
  expect(r.afterP1).toEqual(['p2']);
  expect(r.afterAll).toBe(0);
  expect(r.removed).toBe(4);
});

test('Sniper-Granate: entsteht ueber Anzeige.erzeuge (sniperGranate), fliegt im Modell, wird nach dem Flug entfernt', async ({
  page,
}) => {
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  await page.keyboard.up('KeyW');
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const Sniper = await import('./js/sniper.js');
    const { state, arrays } = await import('./js/state.js');
    const domBackend = Display.getBackend();
    const created = [];
    const removed = [];
    state.selectedShipModel = 'sniper';
    state.sniperTargetX = 200;
    state.sniperTargetY = 100;
    try {
      Display.setBackend({
        create(o, kind) {
          if (kind === 'sniperGrenade') created.push(kind);
        }, // die Explosion erzeugt auch Partikel
        drawWorld() {},
        drawPlayer() {},
        remove(o) {
          removed.push(o.id);
        },
        flash() {},
        flashPlayfield() {},
      });
      const childrenBeforehand = document.querySelectorAll('.sniper-granate').length;
      Sniper.throwGrenade(state, 'p1');
      const g = arrays.sniperGrenades[0];
      const start = { x: g.x, y: g.y, rest: g.rest, el: g.el };
      Sniper.updateSniper(state, 'p1', false);
      const afterOne = { x: g.x, y: g.y, rot: g.rot, rest: g.rest };
      for (let i = 1; i < Sniper.GRENADE_FLIGHT - 1; i++) Sniper.updateSniper(state, 'p1', false);
      const beforeEnd = { length: arrays.sniperGrenades.length, removed: removed.length };
      Sniper.updateSniper(state, 'p1', false);
      return {
        created,
        start,
        afterOne,
        beforeEnd,
        children: document.querySelectorAll('.sniper-granate').length - childrenBeforehand,
        afterEnd: arrays.sniperGrenades.length,
        removed,
        id: g.id,
        flight: Sniper.GRENADE_FLIGHT,
      };
    } finally {
      Display.setBackend(domBackend);
      state.selectedShipModel = 'viper';
      arrays.sniperGrenades.length = 0;
      arrays.effects.length = 0;
    }
  });
  expect(r.created).toEqual(['sniperGrenade']);
  expect(r.start.el).toBeUndefined();
  expect(r.start.rest).toBe(r.flight);
  expect(r.children).toBe(0);
  expect(r.afterOne.rest).toBe(r.flight - 1);
  expect(r.afterOne.rot).toBe(24);
  expect(r.afterOne.y).not.toBe(r.start.y);
  expect(r.beforeEnd).toEqual({ length: 1, removed: 0 });
  expect(r.afterEnd).toBe(0);
  expect(r.removed).toEqual([r.id]);
});

test('Online-Client baut aus dem Snapshot-Listeneintrag ein Granaten-Modell in arrays.sniperGranaten', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const Sniper = await import('./js/sniper.js');
    const { arrays } = await import('./js/state.js');
    try {
      Sniper.syncGrenades([{ id: 'sg_7', x: 120, y: 300, owner: 'p2', rest: 20 }]);
      const g = arrays.sniperGrenades[0];
      const model = { id: g.id, pKey: g.pKey, x: g.x, y: g.y, rest: g.rest, rot: g.rot };
      const el = g.el;
      const pos = {
        left: el.style.left,
        top: el.style.top,
        transform: el.style.transform,
        cls: el.classList.contains('sniper-granate'),
      };
      Sniper.syncGrenades([{ id: 'sg_7', x: 130, y: 280, owner: 'p2', rest: 19 }]);
      const equal = arrays.sniperGrenades[0] === g && g.x === 130 && g.rot === (Sniper.GRENADE_FLIGHT - 19) * 24;
      const list = Sniper.networkGrenadeList();
      Sniper.syncGrenades([]);
      return { model, pos, equal, list, empty: arrays.sniperGrenades.length, gone: !el.isConnected };
    } finally {
      arrays.sniperGrenades.length = 0;
    }
  });
  expect(r.model).toEqual({ id: 'sg_7', pKey: 'p2', x: 120, y: 300, rest: 20, rot: (30 - 20) * 24 });
  expect(r.pos).toEqual({ left: '113px', top: '293px', transform: 'rotate(240deg)', cls: true });
  expect(r.equal).toBe(true);
  expect(r.list).toEqual([{ id: 'sg_7', x: 130, y: 280, owner: 'p2', rest: 19 }]);
  expect(r.empty).toBe(0);
  expect(r.gone).toBe(true);
});

test('Haftmine: entsteht ueber Anzeige.erzeuge (sniperMine) ohne DOM-Element, wird ueber Anzeige.entferne abgeraeumt', async ({
  page,
}) => {
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.gameRunning && !window.__game.state.cutsceneActive);
  await page.keyboard.up('KeyW');
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const Sniper = await import('./js/sniper.js');
    const { state, arrays } = await import('./js/state.js');
    const domBackend = Display.getBackend();
    const created = [];
    const removed = [];
    state.selectedShipModel = 'sniper';
    try {
      Display.setBackend({
        create(o, kind) {
          if (kind === 'sniperMine') created.push(kind);
        },
        drawWorld() {},
        drawPlayer() {},
        remove(o) {
          removed.push(o.id);
        },
        flash() {},
        flashPlayfield() {},
      });
      const childrenBeforehand = document.querySelectorAll('.sniper-mine').length;
      Sniper.holdStep(state, 'p1', 10);
      const m = arrays.sniperMines[0];
      const model = { pKey: m.pKey, sticks: m.sticks, blinks: m.blinks, el: m.el };
      const children = document.querySelectorAll('.sniper-mine').length - childrenBeforehand;
      m.rest = 61;
      Sniper.updateSniper(state, 'p1', false);
      const blinks = m.blinks;
      Sniper.updateSniper(state, 'p1', false);
      return {
        created,
        model,
        children,
        blinks,
        blinksLater: m.blinks,
        id: m.id,
        removed,
        length: arrays.sniperMines.length,
      };
    } finally {
      Display.setBackend(domBackend);
      state.selectedShipModel = 'viper';
      arrays.sniperMines.length = 0;
    }
  });
  expect(r.created).toEqual(['sniperMine']);
  expect(r.model).toEqual({ pKey: 'p1', sticks: false, blinks: false, el: undefined });
  expect(r.children).toBe(0);
  expect(r.blinks).toBe(true);
  expect(r.blinksLater).toBe(true);
  expect(r.length).toBe(1);
});

test('Haftmine: Klassen haftet und blinkt kommen aus den Modellfeldern (DOM-Backend)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const { arrays } = await import('./js/state.js');
    try {
      const m = Display.create(
        { id: 'sm_t', pKey: 'p2', x: 100, y: 200, rest: 300, sticks: false, blinks: false },
        'sniperMine',
      );
      arrays.sniperMines.push(m);
      const read = () => ({ classes: [...m.el.classList].sort(), left: m.el.style.left, top: m.el.style.top });
      const free = read();
      m.blinks = true;
      m.x = 150;
      Display.drawWorld();
      const blinking = read();
      m.blinks = false;
      m.sticks = true;
      Display.drawWorld();
      const sticky = read();
      Display.remove(m);
      return { free, blinking, sticky, gone: !m.el.isConnected };
    } finally {
      arrays.sniperMines.length = 0;
    }
  });
  expect(r.free).toEqual({ classes: ['sniper-mine', 'sniper-mine-p2'], left: '94px', top: '194px' });
  expect(r.blinking).toEqual({ classes: ['blinkt', 'sniper-mine', 'sniper-mine-p2'], left: '144px', top: '194px' });
  expect(r.sticky.classes).toEqual(['haftet', 'sniper-mine', 'sniper-mine-p2']);
  expect(r.gone).toBe(true);
});

test('Online-Client baut aus dem Snapshot-Listeneintrag ein Minen-Modell in arrays.sniperMinen', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Sniper = await import('./js/sniper.js');
    const { arrays } = await import('./js/state.js');
    try {
      Sniper.syncMines([{ id: 'sm_7', x: 120, y: 300, owner: 'p2', sticks: false, fuse: 0, rest: 50, blinks: true }]);
      const m = arrays.sniperMines[0];
      const model = { id: m.id, pKey: m.pKey, x: m.x, y: m.y, rest: m.rest, sticks: m.sticks, blinks: m.blinks };
      const el = m.el;
      const classes = [...el.classList].sort();
      Sniper.syncMines([{ id: 'sm_7', x: 130, y: 280, owner: 'p2', sticks: true, fuse: 20, rest: 49, blinks: false }]);
      const equal = arrays.sniperMines[0] === m && m.x === 130 && m.sticks === true && m.blinks === false;
      Sniper.syncMines([]);
      return { model, classes, equal, empty: arrays.sniperMines.length, gone: !el.isConnected };
    } finally {
      arrays.sniperMines.length = 0;
    }
  });
  expect(r.model).toEqual({ id: 'sm_7', pKey: 'p2', x: 120, y: 300, rest: 50, sticks: false, blinks: true });
  expect(r.classes).toEqual(['blinkt', 'sniper-mine', 'sniper-mine-p2']);
  expect(r.equal).toBe(true);
  expect(r.empty).toBe(0);
  expect(r.gone).toBe(true);
});

test('Fadenkreuz und Ladering kommen aus den Zustandsfeldern (DOM-Backend), verschwinden bei isDead', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const { state } = await import('./js/state.js');
    const old = {
      model: state.selectedShipModel,
      run: state.gameRunning,
      tier: state.laserTier,
      dead: state.isDead,
      color: state.selectedShipColor,
    };
    try {
      state.selectedShipModel = 'sniper';
      state.selectedShipColor = 'red';
      state.gameRunning = true;
      state.isDead = false;
      state.laserTier = 3;
      state.sniperTargetX = 200;
      state.sniperTargetY = 100;
      state.sniperHeld = false;
      state.sniperCharge = 0;
      Display.drawWorld();
      const read = () => {
        const el = document.querySelector('.sniper-fadenkreuz-p1');
        if (!el) return null;
        const ring = el.querySelector('.sniper-ladering');
        return {
          left: el.style.left,
          top: el.style.top,
          width: el.style.width,
          strokes: el.querySelectorAll('i.sniper-strich').length,
          ring: ring
            ? { display: ring.style.display, width: ring.style.width, full: ring.classList.contains('voll') }
            : null,
        };
      };
      const reason = read();
      const count = document.querySelectorAll('.sniper-fadenkreuz').length;
      state.sniperHeld = true;
      state.sniperCharge = 45;
      Display.drawWorld();
      const charge = read();
      state.sniperCharge = 90;
      Display.drawWorld();
      const full = read();
      state.sniperTargetX = 250;
      Display.drawWorld();
      const shifted = read();
      state.isDead = true;
      Display.drawWorld();
      const dead = read();
      state.isDead = false;
      Display.drawWorld();
      const again = read();
      state.sniperTargetX = null;
      Display.drawWorld();
      const withoutTarget = read();
      state.sniperTargetX = 200;
      state.selectedShipModel = 'viper';
      Display.drawWorld();
      const noSniper = read();
      return { reason, count, charge, full, shifted, dead, again, withoutTarget, noSniper };
    } finally {
      state.selectedShipModel = old.model;
      state.selectedShipColor = old.color;
      state.gameRunning = old.run;
      state.laserTier = old.tier;
      state.isDead = old.dead;
      state.sniperTargetX = null;
      state.sniperTargetY = null;
      state.sniperHeld = false;
      state.sniperCharge = 0;
      document.querySelectorAll('.sniper-fadenkreuz').forEach(e => e.remove());
    }
  });
  expect(r.reason).toEqual({
    left: '178px',
    top: '78px',
    width: '44px',
    strokes: 4,
    ring: { display: 'none', width: '', full: false },
  });
  expect(r.count).toBe(1);
  expect(r.charge.ring.display).toBe('block');
  expect(r.charge.ring.full).toBe(false);
  expect(parseFloat(r.charge.ring.width)).toBeCloseTo(44 * (1 + 0.5 * 0.5), 5);
  expect(r.full.ring.full).toBe(true);
  expect(parseFloat(r.full.ring.width)).toBeCloseTo(66, 5);
  expect(r.shifted.left).toBe('228px');
  expect(r.dead).toBeNull();
  expect(r.again).not.toBeNull();
  expect(r.withoutTarget).toBeNull();
  expect(r.noSniper).toBeNull();
});

test('Gleve-Klinge kommt aus den Zustandsfeldern (DOM-Backend), verschwindet bei Sweep-Ende und isDead', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const Gleve = await import('./js/gleve.js');
    const { state } = await import('./js/state.js');
    const old = {
      model: state.selectedShipModel,
      color: state.selectedShipColor,
      dead: state.isDead,
      tier: state.laserTier,
      x: state.x,
      y: state.y,
    };
    try {
      state.selectedShipModel = 'gleve';
      state.selectedShipColor = 'red';
      state.isDead = false;
      state.laserTier = 3;
      state.x = 100;
      state.y = 400;
      state.gleveSweepTimer = 5;
      state.gleveSweepAngle = -18;
      state.gleveSweepDirection = 1;
      Display.drawWorld();
      const read = () => {
        const el = document.querySelector('.gleve-klinge');
        return el
          ? {
              count: document.querySelectorAll('.gleve-klinge').length,
              height: el.style.height,
              left: el.style.left,
              top: el.style.top,
              transform: el.style.transform,
              radius: el.style.borderRadius,
            }
          : null;
      };
      const length = Gleve.sweepLength(state);
      const o = Gleve.sweepOrigin(state);
      const active = read();
      state.gleveSweepDirection = -1;
      state.gleveSweepAngle = 30;
      Display.drawWorld();
      const reversed = read();
      state.isDead = true;
      Display.drawWorld();
      const dead = read();
      state.isDead = false;
      Display.drawWorld();
      const again = read();
      state.gleveSweepTimer = 0;
      Display.drawWorld();
      const end = read();
      state.gleveSweepTimer = 5;
      state.selectedShipModel = 'viper';
      Display.drawWorld();
      const noGleve = read();
      return { length, o, active, reversed, dead, again, end, noGleve };
    } finally {
      state.selectedShipModel = old.model;
      state.selectedShipColor = old.color;
      state.isDead = old.dead;
      state.laserTier = old.tier;
      state.x = old.x;
      state.y = old.y;
      state.gleveSweepTimer = 0;
      document.querySelectorAll('.gleve-klinge').forEach(e => e.remove());
    }
  });
  expect(r.active.count).toBe(1);
  expect(r.active.height).toBe(r.length + 'px');
  expect(r.active.left).toBe(r.o.x - 2 + 'px');
  expect(r.active.top).toBe(r.o.y - r.length + 'px');
  expect(r.active.transform).toBe('rotate(-18deg)');
  // Richtung +1: Rundung oben rechts, Richtung -1: oben links (Browser serialisiert die Kurzform)
  expect(r.active.radius).toMatch(/^0px 100% 0px 0px/);
  expect(r.reversed.transform).toBe('rotate(30deg)');
  expect(r.reversed.radius).toMatch(/^100% 0px 0px/);
  expect(r.dead).toBeNull();
  expect(r.again).not.toBeNull();
  expect(r.end).toBeNull();
  expect(r.noGleve).toBeNull();
});

test('Spielertreffer und Powerup melden den Bildschirm-Blitz (Farbe, Dauer) an die Anzeige, ohne dass die Logik das Spielfeld anfasst', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const { arrays, state, dom } = await import('./js/state.js');
    const Display = await import('./js/display.js');
    const Utils = await import('./js/utils.js');
    const Entities = await import('./js/entities.js');
    const Powerups = await import('./js/powerups.js');
    state.level = 1;
    state.isDead = false;
    state.invulnerableTimer = 0;
    state.shieldTier = 0;
    state.lives = 5;
    const domBackend = Display.getBackend();
    const flash = [];
    const beforehand = dom.playfield.style.backgroundColor;
    Display.setBackend({
      ...domBackend,
      flashPlayfield(color, ms) {
        flash.push([color, ms]);
      },
    });
    try {
      Utils.playerHit({ x: 0, y: 0, el: document.createElement('div') }, false);
      state.invulnerableTimer = 0;
      state.shieldTier = 1;
      Utils.playerHit({ x: 0, y: 0, el: document.createElement('div') }, false);
      Entities.createPowerup(state.x, state.y, 'laserWeapon', 'p1');
      const p = arrays.powerups[arrays.powerups.length - 1];
      p.x = state.x;
      p.y = state.y;
      p.vy = 0;
      Powerups.updatePowerups();
      return { flash, color: p.color, beforehand, afterwards: dom.playfield.style.backgroundColor };
    } finally {
      Display.setBackend(domBackend);
    }
  });
  expect(r.flash[0]).toEqual(['#900', 150]);
  expect(r.flash[1]).toEqual(['rgba(52, 152, 219, 0.3)', 150]);
  expect(r.flash[2]).toEqual([r.color, 100]);
  expect(r.flash.length).toBe(3);
  expect(r.afterwards).toBe(r.beforehand);
});

test('Sterne entstehen ueber die Anzeige (Art stern, Modell mit groesse statt Element-Styles)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const Display = await import('./js/display.js');
    Display.drawWorld();
    const s = arrays.stars[0];
    return {
      count: arrays.stars.length,
      size: typeof s.size,
      width: s.el.style.width,
      cls: s.el.className,
      left: Math.abs(parseFloat(s.el.style.left) - s.x) < 0.001,
    };
  });
  expect(r.count).toBe(60);
  expect(r.size).toBe('number');
  expect(r.cls).toBe('stern'); // CSS-Klasse bleibt
  expect(r.left).toBe(true);
  expect(r.width).toMatch(/px$/);
});

test('Null-Backend: Coop mit Bot, Gleve gegen Boss, Bomben, Granaten, Minen und Raketen laufen ohne Fehler und ohne neue Kinder in #spielfeld', async ({
  page,
}) => {
  const error = [];
  page.on('pageerror', e => error.push(e.message));
  const r = await page.evaluate(async () => {
    const Display = await import('./js/display.js');
    const Sniper = await import('./js/sniper.js');
    const { simulationStep } = await import('./js/loop.js');
    const { state, arrays } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const Utils = await import('./js/utils.js');
    Utils.setGameMode('coop');
    state.selectedShipModel = 'gleve';
    state.p2.selectedShipModel = 'sniper';
    state.p2IsBot = true;
    state.level = 3;
    state.godMode = true;
    state.gameRunning = true;
    Sniper.reset(state.p2);
    Sniper.setGrenadeChargeFull(state.p2);
    const beforehand = document.getElementById('spielfeld').children.length;
    const domBackend = Display.getBackend();
    const f = () => {};
    Display.setBackend({ create: f, drawWorld: f, drawPlayer: f, remove: f, flash: f, flashPlayfield: f });
    const seen = { effect: 0, grenade: 0, mine: 0, missile: 0 };
    try {
      state.keysPressed.l = true;
      state.keysPressed.k = true;
      state.keysPressed[' '] = true;
      for (let i = 0; i < 600; i++) {
        if (i === 20) Entities.createBoss();
        if (i === 40) Utils.createBombDetonation(200, 200, '#f39c12', 150, 3, false);
        if (i === 60) Utils.createMissileDetonation(300, 200, 70);
        if (i === 80) Sniper.throwGrenade(state.p2, 'p2');
        if (i < 12) Sniper.holdStep(state.p2, 'p2', 10 + i);
        if (i === 140) Sniper.triggerEmp(state.p2, 'p2');
        simulationStep();
        seen.effect = Math.max(seen.effect, arrays.effects.length);
        seen.grenade = Math.max(seen.grenade, arrays.sniperGrenades.length);
        seen.mine = Math.max(seen.mine, arrays.sniperMines.length);
        seen.missile = Math.max(seen.missile, arrays.missileArray.length);
      }
      return {
        beforehand,
        afterwards: document.getElementById('spielfeld').children.length,
        seen,
        boss: arrays.bosses.length,
      };
    } finally {
      state.keysPressed.l = false;
      state.keysPressed.k = false;
      state.keysPressed[' '] = false;
      Display.setBackend(domBackend);
    }
  });
  expect(error).toEqual([]);
  expect(r.afterwards).toBe(r.beforehand);
  expect(r.seen.effect).toBeGreaterThan(0);
  expect(r.seen.grenade).toBeGreaterThan(0);
  expect(r.seen.mine).toBeGreaterThan(0);
});
