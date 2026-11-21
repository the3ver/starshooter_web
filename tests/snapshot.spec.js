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

// Shared setup: the host creates objects in all lists, the client is simulated
const LISTEN = {
  enemies: 'enemies',
  asteroids: 'asteroids',
  bosses: 'bosses',
  powerups: 'powerups',
  laser: 'laserArray',
  missiles: 'missileArray',
  bombs: 'bombArray',
  enemyLaser: 'enemyLaserArray',
  hackProjectiles: 'hackProjectileArray',
  bossLaser: 'bossLaserArray',
  bossMissiles: 'bossMissileArray',
  bossBombs: 'bossBombArray',
};

async function prepareHostAndClient(page) {
  return page.evaluate(LISTEN => {
    const g = window.__game;
    const { state, arrays, dom } = g;
    state.paused = true;

    // Clear the playfield and lists
    Object.values(LISTEN).forEach(name => {
      arrays[name].forEach(o => {
        if (o.el) o.el.remove();
      });
      arrays[name].length = 0;
    });

    // Create host objects
    g.Entities.createEnemy(100, 50, 'normal');
    g.Entities.createAsteroid(200, 60, 40, 0, 1);
    g.Entities.createBoss();
    g.Entities.createPowerup(150, 120, 'shield');
    g.Entities.createEnemyLaser(120, 200, 300, 400);
    g.Entities.createHackProjectile(130, 210, 300, 400);
    g.Entities.createBossLaser(140, 220, 2, 6);
    g.Entities.createBossMissile(160, 230, 1);
    g.Entities.createBossBomb(170, 240);

    // Create player weapons directly (as in loop.js, with id)
    const mkEl = cls => {
      const el = document.createElement('div');
      el.className = cls;
      dom.playfield.appendChild(el);
      return el;
    };
    arrays.laserArray.push({
      id: g.Entities.newId('l'),
      el: mkEl('laser-projektil'),
      x: 50,
      y: 300,
      vx: 3,
      vy: 15,
      owner: 'p1',
      width: 4,
      height: 20,
    });
    arrays.missileArray.push({
      id: g.Entities.newId('r'),
      el: mkEl('raketen-projektil'),
      x: 60,
      y: 310,
      vx: 0,
      vy: -5,
      rot: 10,
      owner: 'p1',
    });
    arrays.bombArray.push({
      id: g.Entities.newId('b'),
      el: mkEl('bomben-projektil'),
      x: 70,
      y: 320,
      rot: 0,
      owner: 'p1',
      tier: 1,
    });

    // Host snapshot 1, then move everything a bit, snapshot 2
    const snap1 = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
    Object.values(LISTEN).forEach(name =>
      arrays[name].forEach(o => {
        o.x += 5;
        o.y += 7;
      }),
    );
    const snap2 = JSON.parse(JSON.stringify(g.Network.serializeGameState()));

    // Remove the host world, simulate the client
    Object.values(LISTEN).forEach(name => {
      arrays[name].forEach(o => {
        if (o.el) o.el.remove();
      });
      arrays[name].length = 0;
    });
    state.network.isHost = false;
    state.network.isClient = true;

    window.__snaps = { snap1, snap2 };
    return {
      ids1: Object.fromEntries(Object.keys(LISTEN).map(k => [k, snap1[k].map(o => o.id)])),
      ids2: Object.fromEntries(Object.keys(LISTEN).map(k => [k, snap2[k].map(o => o.id)])),
      count: Object.fromEntries(Object.keys(LISTEN).map(k => [k, snap1[k].length])),
    };
  }, LISTEN);
}

test('Host assigns stable ids: ids stay the same between snapshots and are unique', async ({ page }) => {
  const r = await prepareHostAndClient(page);
  for (const k of Object.keys(LISTEN)) {
    expect(r.count[k], `list ${k} has objects`).toBeGreaterThan(0);
    expect(
      r.ids1[k].every(id => typeof id === 'string' && id.length > 0),
      `Ids ${k}`,
    ).toBe(true);
    expect(r.ids2[k], `ids ${k} stable despite movement`).toEqual(r.ids1[k]);
    expect(new Set(r.ids1[k]).size).toBe(r.ids1[k].length);
  }
});

test('Client reuses DOM elements, creates no new nodes on the second snapshot and updates positions', async ({
  page,
}) => {
  await prepareHostAndClient(page);
  const r = await page.evaluate(LISTEN => {
    const g = window.__game;
    const { arrays, dom } = g;
    const { snap1, snap2 } = window.__snaps;

    g.Network.applyGameStateSnapshot(snap1);
    const beforehand = {};
    Object.entries(LISTEN).forEach(([k, name]) => {
      beforehand[k] = arrays[name].map(o => o.el);
    });

    const obs = new MutationObserver(() => {});
    obs.observe(dom.playfield, { childList: true, subtree: true });
    g.Network.applyGameStateSnapshot(snap2);
    const added = [];
    obs.takeRecords().forEach(m =>
      m.addedNodes.forEach(n => {
        if (n.nodeType === 1) added.push(n.className);
      }),
    );
    obs.disconnect();

    const out = { added, listen: {} };
    Object.entries(LISTEN).forEach(([k, name]) => {
      const afterwards = arrays[name];
      out.listen[k] = {
        count: afterwards.length,
        expected: snap2[k].length,
        sameElements:
          afterwards.length === beforehand[k].length && afterwards.every((o, i) => o.el === beforehand[k][i]),
        inDom: afterwards.every(o => o.el.isConnected),
        // Position in the object and in the DOM matches snapshot 2
        positions: afterwards.every(
          (o, i) =>
            o.x === snap2[k][i].x &&
            o.y === snap2[k][i].y &&
            o.el.style.left === snap2[k][i].x + 'px' &&
            o.el.style.top === snap2[k][i].y + 'px',
        ),
        idsReceived: afterwards.every((o, i) => o.id === snap2[k][i].id),
      };
    });
    return out;
  }, LISTEN);

  expect(r.added).toEqual([]);
  for (const k of Object.keys(LISTEN)) {
    const l = r.listen[k];
    expect(l.count, `${k} count`).toBe(l.expected);
    expect(l.sameElements, `${k} elements reused`).toBe(true);
    expect(l.inDom, `${k} im DOM`).toBe(true);
    expect(l.positions, `${k} positions`).toBe(true);
    expect(l.idsReceived, `${k} Ids`).toBe(true);
  }
});

test('Client updates the rotation of missiles and boss missiles and the angle of slanted lasers', async ({ page }) => {
  await prepareHostAndClient(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const { arrays } = g;
    const { snap1, snap2 } = window.__snaps;
    g.Network.applyGameStateSnapshot(snap1);
    const s3 = JSON.parse(JSON.stringify(snap2));
    s3.missiles[0].rot = 45;
    s3.bossMissiles[0].rot = 120;
    s3.enemyLaser[0].vx = -4;
    s3.enemyLaser[0].vy = 7;
    s3.bossLaser[0].vx = -3;
    s3.laser[0].vx = -2;
    g.Network.applyGameStateSnapshot(s3);
    return {
      missile: arrays.missileArray[0].el.style.transform,
      bossMissile: arrays.bossMissileArray[0].el.style.transform,
      enemyLaser: arrays.enemyLaserArray[0].el.style.transform,
      bossLaser: arrays.bossLaserArray[0].el.style.transform,
      laser: arrays.laserArray[0].el.style.transform,
      enemyLaserBeforehand: snap1.enemyLaser[0].vx,
    };
  });
  expect(r.missile).toBe('rotate(45deg)');
  expect(r.bossMissile).toBe('rotate(120deg)');
  const angle = t => parseFloat(/rotate\((-?[\d.]+)deg\)/.exec(t)[1]);
  const fl = (Math.atan2(7, -4) * 180) / Math.PI - 90;
  expect(angle(r.enemyLaser)).toBeCloseTo(fl, 3);
  const bl = (Math.atan2(6, -3) * 180) / Math.PI - 90;
  expect(angle(r.bossLaser)).toBeCloseTo(bl, 3);
  const l = (Math.atan2(-15, -2) * 180) / Math.PI + 90;
  expect(angle(r.laser)).toBeCloseTo(l, 3);
});

test('Client removes vanished objects from DOM and array and creates new ones', async ({ page }) => {
  await prepareHostAndClient(page);
  const r = await page.evaluate(LISTEN => {
    const g = window.__game;
    const { arrays } = g;
    const { snap1, snap2 } = window.__snaps;
    g.Network.applyGameStateSnapshot(snap1);

    const projectileListen = [
      'laser',
      'missiles',
      'bombs',
      'enemyLaser',
      'hackProjectiles',
      'bossLaser',
      'bossMissiles',
      'bossBombs',
    ];
    const s3 = JSON.parse(JSON.stringify(snap2));
    const removed = {};
    const fresh = {};
    projectileListen.forEach(k => {
      const oldEl = arrays[LISTEN[k]][0].el;
      removed[k] = { id: s3[k][0].id, el: oldEl };
      const copy = Object.assign({}, s3[k][0], { id: 'new_' + k, x: 11, y: 22 });
      s3[k] = [copy];
      fresh[k] = 'new_' + k;
    });
    g.Network.applyGameStateSnapshot(s3);

    const out = {};
    projectileListen.forEach(k => {
      const list = arrays[LISTEN[k]];
      out[k] = {
        length: list.length,
        oldIdGone: !list.some(o => o.id === removed[k].id),
        oldElGone: !removed[k].el.isConnected,
        newId: list[0].id === fresh[k],
        newElInDom: list[0].el.isConnected,
        newPos: list[0].el.style.left === '11px' && list[0].el.style.top === '22px',
      };
    });
    return out;
  }, LISTEN);
  for (const k of Object.keys(r)) {
    expect(r[k], k).toEqual({
      length: 1,
      oldIdGone: true,
      oldElGone: true,
      newId: true,
      newElInDom: true,
      newPos: true,
    });
  }
});
