const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.6.59');
    localStorage.setItem('starshooter_skip_cutscene', 'true');
  });
  await page.goto('/');
});

// Gemeinsamer Aufbau: Host erzeugt Objekte in allen Listen, Client wird simuliert
const LISTEN = {
  feinde: 'feinde',
  asteroiden: 'asteroiden',
  bosses: 'bosses',
  powerups: 'powerups',
  laser: 'laserArray',
  raketen: 'raketenArray',
  bomben: 'bombenArray',
  feindLaser: 'feindLaserArray',
  hackProjektile: 'hackProjektilArray',
  bossLaser: 'bossLaserArray',
  bossRaketen: 'bossRaketenArray',
  bossBomben: 'bossBombenArray'
};

async function bereiteHostUndClientVor(page) {
  return page.evaluate((LISTEN) => {
    const g = window.__game;
    const { state, arrays, dom } = g;
    state.pausiert = true;

    // Spielfeld und Listen leeren
    Object.values(LISTEN).forEach(name => {
      arrays[name].forEach(o => { if (o.el) o.el.remove(); });
      arrays[name].length = 0;
    });

    // Host-Objekte erzeugen
    g.Entities.erzeugeFeind(100, 50, 'normal');
    g.Entities.erzeugeAsteroid(200, 60, 40, 0, 1);
    g.Entities.erzeugeBoss();
    g.Entities.erzeugePowerup(150, 120, 'schild');
    g.Entities.erzeugeFeindLaser(120, 200, 300, 400);
    g.Entities.erzeugeHackProjektil(130, 210, 300, 400);
    g.Entities.erzeugeBossLaser(140, 220, 2, 6);
    g.Entities.erzeugeBossRakete(160, 230, 1);
    g.Entities.erzeugeBossBombe(170, 240);

    // Spielerwaffen direkt anlegen (wie loop.js, mit Id)
    const mkEl = (klasse) => {
      const el = document.createElement('div');
      el.className = klasse;
      dom.spielfeld.appendChild(el);
      return el;
    };
    arrays.laserArray.push({ id: g.Entities.neueId('l'), el: mkEl('laser-projektil'), x: 50, y: 300, vx: 3, vy: 15, owner: 'p1', width: 4, height: 20 });
    arrays.raketenArray.push({ id: g.Entities.neueId('r'), el: mkEl('raketen-projektil'), x: 60, y: 310, vx: 0, vy: -5, rot: 10, owner: 'p1' });
    arrays.bombenArray.push({ id: g.Entities.neueId('b'), el: mkEl('bomben-projektil'), x: 70, y: 320, rot: 0, owner: 'p1', stufe: 1 });

    // Host-Schnappschuss 1, danach alles ein Stück bewegen, Schnappschuss 2
    const snap1 = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
    Object.values(LISTEN).forEach(name => arrays[name].forEach(o => { o.x += 5; o.y += 7; }));
    const snap2 = JSON.parse(JSON.stringify(g.Network.serializeGameState()));

    // Host-Welt entfernen, Client simulieren
    Object.values(LISTEN).forEach(name => {
      arrays[name].forEach(o => { if (o.el) o.el.remove(); });
      arrays[name].length = 0;
    });
    state.network.isHost = false;
    state.network.isClient = true;

    window.__snaps = { snap1, snap2 };
    return {
      ids1: Object.fromEntries(Object.keys(LISTEN).map(k => [k, snap1[k].map(o => o.id)])),
      ids2: Object.fromEntries(Object.keys(LISTEN).map(k => [k, snap2[k].map(o => o.id)])),
      anzahl: Object.fromEntries(Object.keys(LISTEN).map(k => [k, snap1[k].length]))
    };
  }, LISTEN);
}

test('Host vergibt stabile Ids: Ids bleiben zwischen Snapshots gleich und sind eindeutig', async ({ page }) => {
  const r = await bereiteHostUndClientVor(page);
  for (const k of Object.keys(LISTEN)) {
    expect(r.anzahl[k], `Liste ${k} hat Objekte`).toBeGreaterThan(0);
    expect(r.ids1[k].every(id => typeof id === 'string' && id.length > 0), `Ids ${k}`).toBe(true);
    expect(r.ids2[k], `Ids ${k} stabil trotz Bewegung`).toEqual(r.ids1[k]);
    expect(new Set(r.ids1[k]).size).toBe(r.ids1[k].length);
  }
});

test('Client verwendet DOM-Elemente wieder, erzeugt beim zweiten Snapshot keine neuen Knoten und aktualisiert Positionen', async ({ page }) => {
  await bereiteHostUndClientVor(page);
  const r = await page.evaluate((LISTEN) => {
    const g = window.__game;
    const { arrays, dom } = g;
    const { snap1, snap2 } = window.__snaps;

    g.Network.applyGameStateSnapshot(snap1);
    const vorher = {};
    Object.entries(LISTEN).forEach(([k, name]) => { vorher[k] = arrays[name].map(o => o.el); });

    const obs = new MutationObserver(() => {});
    obs.observe(dom.spielfeld, { childList: true, subtree: true });
    g.Network.applyGameStateSnapshot(snap2);
    const hinzugefuegt = [];
    obs.takeRecords().forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) hinzugefuegt.push(n.className); }));
    obs.disconnect();

    const out = { hinzugefuegt, listen: {} };
    Object.entries(LISTEN).forEach(([k, name]) => {
      const nachher = arrays[name];
      out.listen[k] = {
        anzahl: nachher.length,
        erwartet: snap2[k].length,
        gleicheElemente: nachher.length === vorher[k].length && nachher.every((o, i) => o.el === vorher[k][i]),
        imDom: nachher.every(o => o.el.isConnected),
        // Position im Objekt und im DOM entspricht Snapshot 2
        positionen: nachher.every((o, i) => o.x === snap2[k][i].x && o.y === snap2[k][i].y &&
          o.el.style.left === snap2[k][i].x + 'px' && o.el.style.top === snap2[k][i].y + 'px'),
        idsErhalten: nachher.every((o, i) => o.id === snap2[k][i].id)
      };
    });
    return out;
  }, LISTEN);

  expect(r.hinzugefuegt).toEqual([]);
  for (const k of Object.keys(LISTEN)) {
    const l = r.listen[k];
    expect(l.anzahl, `${k} Anzahl`).toBe(l.erwartet);
    expect(l.gleicheElemente, `${k} Elemente wiederverwendet`).toBe(true);
    expect(l.imDom, `${k} im DOM`).toBe(true);
    expect(l.positionen, `${k} Positionen`).toBe(true);
    expect(l.idsErhalten, `${k} Ids`).toBe(true);
  }
});

test('Client aktualisiert Rotation von Raketen und Boss-Raketen sowie Winkel schraeger Laser', async ({ page }) => {
  await bereiteHostUndClientVor(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const { arrays } = g;
    const { snap1, snap2 } = window.__snaps;
    g.Network.applyGameStateSnapshot(snap1);
    const s3 = JSON.parse(JSON.stringify(snap2));
    s3.raketen[0].rot = 45;
    s3.bossRaketen[0].rot = 120;
    s3.feindLaser[0].vx = -4;
    s3.feindLaser[0].vy = 7;
    s3.bossLaser[0].vx = -3;
    s3.laser[0].vx = -2;
    g.Network.applyGameStateSnapshot(s3);
    return {
      rakete: arrays.raketenArray[0].el.style.transform,
      bossRakete: arrays.bossRaketenArray[0].el.style.transform,
      feindLaser: arrays.feindLaserArray[0].el.style.transform,
      bossLaser: arrays.bossLaserArray[0].el.style.transform,
      laser: arrays.laserArray[0].el.style.transform,
      feindLaserVorher: snap1.feindLaser[0].vx
    };
  });
  expect(r.rakete).toBe('rotate(45deg)');
  expect(r.bossRakete).toBe('rotate(120deg)');
  const winkel = (t) => parseFloat(/rotate\((-?[\d.]+)deg\)/.exec(t)[1]);
  const fl = Math.atan2(7, -4) * 180 / Math.PI - 90;
  expect(winkel(r.feindLaser)).toBeCloseTo(fl, 3);
  const bl = Math.atan2(6, -3) * 180 / Math.PI - 90;
  expect(winkel(r.bossLaser)).toBeCloseTo(bl, 3);
  const l = Math.atan2(-15, -2) * 180 / Math.PI + 90;
  expect(winkel(r.laser)).toBeCloseTo(l, 3);
});

test('Client entfernt verschwundene Objekte aus DOM und Array und legt neue an', async ({ page }) => {
  await bereiteHostUndClientVor(page);
  const r = await page.evaluate((LISTEN) => {
    const g = window.__game;
    const { arrays } = g;
    const { snap1, snap2 } = window.__snaps;
    g.Network.applyGameStateSnapshot(snap1);

    const projektilListen = ['laser', 'raketen', 'bomben', 'feindLaser', 'hackProjektile', 'bossLaser', 'bossRaketen', 'bossBomben'];
    const s3 = JSON.parse(JSON.stringify(snap2));
    const entfernt = {};
    const neu = {};
    projektilListen.forEach(k => {
      const altesEl = arrays[LISTEN[k]][0].el;
      entfernt[k] = { id: s3[k][0].id, el: altesEl };
      const kopie = Object.assign({}, s3[k][0], { id: 'neu_' + k, x: 11, y: 22 });
      s3[k] = [kopie];
      neu[k] = 'neu_' + k;
    });
    g.Network.applyGameStateSnapshot(s3);

    const out = {};
    projektilListen.forEach(k => {
      const liste = arrays[LISTEN[k]];
      out[k] = {
        laenge: liste.length,
        alteIdWeg: !liste.some(o => o.id === entfernt[k].id),
        altesElWeg: !entfernt[k].el.isConnected,
        neueId: liste[0].id === neu[k],
        neuesElImDom: liste[0].el.isConnected,
        neuePos: liste[0].el.style.left === '11px' && liste[0].el.style.top === '22px'
      };
    });
    return out;
  }, LISTEN);
  for (const k of Object.keys(r)) {
    expect(r[k], k).toEqual({ laenge: 1, alteIdWeg: true, altesElWeg: true, neueId: true, neuesElImDom: true, neuePos: true });
  }
});
