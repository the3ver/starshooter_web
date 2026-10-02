const { test, expect } = require('@playwright/test');

// Netzkodierung im Online-Modus: Delta-Snapshots, Keyframes, Eingaben und Protokollversion

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.route('**/api/turn*', route => route.fulfill({ status: 503, body: '' }));
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.7.1');
    localStorage.setItem('starshooter_skip_cutscene', 'true');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.state);
});

const LISTEN_ARRAYS = ['feinde', 'asteroiden', 'bosses', 'powerups', 'laserArray', 'raketenArray', 'bombenArray',
  'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bossRaketenArray', 'bossBombenArray'];

// Host-Spiel im Online-Modus herstellen (ohne echte Verbindung)
async function alsHost(page) {
  await page.evaluate((LISTEN_ARRAYS) => {
    const { state, arrays, Utils } = window.__game;
    Utils.setGameMode('online');
    state.spielLaeuft = true;
    state.pausiert = false;
    state.cutsceneAktiv = false;
    state.gameOverAktiv = false;
    state.bossWarningAktiv = false;
    state.network.isOnline = true;
    state.network.isHost = true;
    state.network.isClient = false;
    state.network.connected = true;
    LISTEN_ARRAYS.forEach(n => {
      arrays[n].forEach(o => { if (o.el) o.el.remove(); });
      arrays[n].length = 0;
    });
  }, LISTEN_ARRAYS);
}

test('Carry-over: Splitter-Zaehler und Phantom-Schildladung kommen beim Online-Client an', async ({ page }) => {
  await alsHost(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const { state } = g;
    // Host-Zustand
    state.selectedShipModel = 'viper';
    state.p2.selectedShipModel = 'phantom';
    state.splitterRot = 3;
    state.splitterWeiss = 7;
    state.p2.splitterRot = 2;
    state.p2.splitterWeiss = 5;
    state.p2.schildStufe = 0;
    state.p2.phantomSchildRegenTimer = 450;
    state.p2.phantomSchildRegenMax = 900;
    const snapshot = JSON.parse(JSON.stringify(g.Network.serializeGameState()));

    // Client-Zustand vor dem Snapshot
    state.splitterRot = 0;
    state.splitterWeiss = 0;
    state.p2.splitterRot = 0;
    state.p2.splitterWeiss = 0;
    state.p2.phantomSchildRegenTimer = 0;
    state.network.isHost = false;
    state.network.isClient = true;
    g.Network.applyGameStateSnapshot(snapshot);
    return {
      p1: [state.splitterRot, state.splitterWeiss],
      p2: [state.p2.splitterRot, state.p2.splitterWeiss],
      regen: state.p2.phantomSchildRegenTimer,
      hudRot: document.getElementById('splitter-rot-count').textContent,
      hudWeiss: document.getElementById('splitter-weiss-count').textContent,
      ladeIcon: Boolean(document.querySelector('#aktive-powerups-p2 .pu-recharging-shield'))
    };
  });
  expect(r).toEqual({ p1: [3, 7], p2: [2, 5], regen: 450, hudRot: '3', hudWeiss: '7', ladeIcon: true });
});

test('Carry-over: Host sendet auch waehrend der Boss-Warnung Snapshots', async ({ page }) => {
  await alsHost(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const { simulationsSchritt } = await import('./js/loop.js');
    state.godMode = true;
    state.frameZaehler = 100;
    state.bossWarningAktiv = true;
    state.bossWarningTimer = 120;
    g.dom.warningOverlay.style.display = 'flex';
    const vorher = state.network.snapshotPakete || 0;
    for (let i = 0; i < 119; i++) simulationsSchritt();
    const waehrend = (state.network.snapshotPakete || 0) - vorher;
    const nochWarnung = state.bossWarningAktiv;
    simulationsSchritt();
    return { waehrend, nochWarnung, danach: state.bossWarningAktiv };
  });
  expect(r.nochWarnung).toBe(true);
  expect(r.danach).toBe(false);
  expect(r.waehrend).toBeGreaterThanOrEqual(55);
});

// Echtes Host-Spiel (Coop mit Bot, Level 6, alle Waffen, Boss-Kampf) ueber simulationsSchritt laufen
// lassen und jeden 2. Schritt kodieren und dekodieren. verlust: Laufnummern, die nicht ankommen.
async function laufeSzenario(page, { schritte, verlust }) {
  return page.evaluate(async ({ schritte, verlust }) => {
    const g = window.__game;
    const { state, arrays } = g;
    const NK = await import('./js/netzkodierung.js');
    const { simulationsSchritt } = await import('./js/loop.js');

    g.Utils.setGameMode('coop');
    state.p2IsBot = true;
    g.Cutscene.startCutscene();
    state.godMode = true;
    state.level = 6;
    state.laserStufe = 4; state.raketenStufe = 3; state.bombenStufe = 2;
    state.p2.laserStufe = 4; state.p2.raketenStufe = 3; state.p2.bombenStufe = 2;
    state.frameZaehler = 3400; // Boss-Warnung nach 200 Schritten, danach Boss-Kampf

    const kodierer = new NK.SnapshotKodierer();
    const dekodierer = new NK.SnapshotDekodierer();
    const verloren = new Set(verlust || []);
    const fehler = [];
    const stat = { voll: [], paket: [], keyframes: 0, nullNachVerlust: 0, angewendet: 0, maxListen: {}, geschleppt: 0, bossSchritte: 0 };

    // x/y in Listen duerfen per Dead Reckoning bis 0,5 px abweichen, alles andere exakt
    function vergleiche(soll, ist, pfad, inListe) {
      if (fehler.length > 20) return;
      if (typeof soll === 'number' && typeof ist === 'number' && inListe && /\.(x|y)$/.test(pfad)) {
        if (Math.abs(soll - ist) > 0.5 + 1e-9) fehler.push(pfad + ': ' + soll + ' != ' + ist);
        return;
      }
      if (soll === null || ist === null || typeof soll !== 'object' || typeof ist !== 'object') {
        if (soll !== ist) fehler.push(pfad + ': ' + JSON.stringify(soll) + ' != ' + JSON.stringify(ist));
        return;
      }
      if (Array.isArray(soll) !== Array.isArray(ist)) { fehler.push(pfad + ': Typ'); return; }
      const schluessel = new Set([...Object.keys(soll), ...Object.keys(ist)]);
      for (const k of schluessel) {
        const liste = inListe || (pfad === '' && NK.LISTEN.includes(k));
        vergleiche(soll[k], ist[k], pfad + '.' + k, liste);
      }
    }

    let wartetAufKeyframe = false;
    for (let i = 1; i <= schritte; i++) {
      const keys = state.tastenGedrueckt;
      keys.l = true;
      keys.k = (i % 90) < 45;
      keys[' '] = i % 250 === 0;
      keys.a = (i % 80) < 40;
      keys.d = !keys.a;
      if (i % 45 === 0) g.Entities.erzeugeFeind(80 + (i * 7) % 400, 20, i % 90 === 0 ? 'hacker' : 'normal');
      if (i % 30 === 0) g.Entities.erzeugeAsteroid();
      if (i % 70 === 0) g.Entities.erzeugePowerup(state.x, state.y, 'energie', 'p2'); // wird von P1 geschleppt
      if (i % 110 === 0) g.Entities.erzeugePowerup(200, 40);
      if (i % 60 === 0) { g.Entities.erzeugeBossRakete(150 + i % 300, 120, 1); g.Entities.erzeugeBossBombe(250, 100); }
      if (i % 50 === 0) { g.Entities.erzeugeHackProjektil(130, 210, 300, 400); g.Entities.erzeugeBossLaser(140, 220, 2, 6); g.Entities.erzeugeFeindLaser(120, 200, 300, 400); }
      simulationsSchritt();
      if (arrays.powerups.some(p => p.towedBy)) stat.geschleppt++;
      if (arrays.bosses.length) stat.bossSchritte++;

      if (i % 2 !== 0) continue;
      const voll = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
      const paket = kodierer.kodiere(voll, i);
      const text = JSON.stringify(paket);
      stat.voll.push(JSON.stringify(voll).length);
      stat.paket.push(text.length);
      if (paket.k) stat.keyframes++;
      NK.LISTEN.forEach(n => { stat.maxListen[n] = Math.max(stat.maxListen[n] || 0, voll[n].length); });
      if (verloren.has(paket.n)) { wartetAufKeyframe = true; continue; }
      const rekon = dekodierer.dekodiere(JSON.parse(text));
      if (paket.k) wartetAufKeyframe = false;
      if (wartetAufKeyframe) {
        if (rekon !== null) fehler.push('Paket ' + paket.n + ' nach Verlust angewendet');
        stat.nullNachVerlust++;
        continue;
      }
      if (!rekon) { fehler.push('Paket ' + paket.n + ' nicht dekodiert'); continue; }
      stat.angewendet++;
      vergleiche(NK.rundeSnapshot(voll), rekon, '', false);
    }
    const summe = a => a.reduce((s, v) => s + v, 0);
    return {
      fehler,
      keyframes: stat.keyframes,
      angewendet: stat.angewendet,
      nullNachVerlust: stat.nullNachVerlust,
      maxListen: stat.maxListen,
      geschleppt: stat.geschleppt,
      bossSchritte: stat.bossSchritte,
      vollSchnitt: Math.round(summe(stat.voll) / stat.voll.length),
      vollMax: Math.max(...stat.voll),
      paketSchnitt: Math.round(summe(stat.paket) / stat.paket.length),
      paketMax: Math.max(...stat.paket),
      pakete: stat.paket.length
    };
  }, { schritte, verlust });
}

test('Netzkodierung: Rekonstruktion entspricht dem gerundeten vollen Snapshot (600 Schritte, Boss-Kampf)', async ({ page }) => {
  const r = await laufeSzenario(page, { schritte: 600 });
  console.log(`Snapshot voll: Schnitt ${r.vollSchnitt} B, max ${r.vollMax} B | kodiert: Schnitt ${r.paketSchnitt} B, max ${r.paketMax} B | ` +
    `${Math.round(r.paketSchnitt / r.vollSchnitt * 100)} % | Pakete ${r.pakete}, Keyframes ${r.keyframes} | max. Listen ${JSON.stringify(r.maxListen)} | ` +
    `geschleppt ${r.geschleppt} Schritte, Boss ${r.bossSchritte} Schritte`);
  expect(r.fehler).toEqual([]);
  expect(r.angewendet).toBe(300);
  expect(r.keyframes).toBe(10);
  // Szenario deckt die wichtigen Listen ab
  expect(r.bossSchritte).toBeGreaterThan(100);
  expect(r.geschleppt).toBeGreaterThan(0);
  for (const liste of ['feinde', 'asteroiden', 'bosses', 'laser', 'raketen', 'bomben', 'hackProjektile', 'feindLaser', 'bossLaser', 'bossRaketen', 'bossBomben', 'powerups']) {
    expect(r.maxListen[liste], liste).toBeGreaterThan(0);
  }
  // Groessen-Waechter: kodiert hoechstens 35 % des vollen Snapshots
  expect(r.paketSchnitt).toBeLessThanOrEqual(r.vollSchnitt * 0.35);
});

test('Netzkodierung: nach Paketverlust wartet der Client auf den naechsten Keyframe und ist dann wieder exakt', async ({ page }) => {
  const r = await laufeSzenario(page, { schritte: 300, verlust: [5, 40, 41, 75, 89] });
  expect(r.fehler).toEqual([]);
  // Verlust bei 5 -> 6..30 verworfen, 31 Keyframe; 40/41 -> 42..60; 75 -> 76..90 (89 verloren) -> 91 Keyframe
  expect(r.keyframes).toBe(5);
  expect(r.nullNachVerlust).toBe(25 + 19 + 14);
  expect(r.angewendet).toBe(150 - 5 - 25 - 19 - 14);
});

test('Netzkodierung: Ids, Rundung und Dead Reckoning im Detail', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const NK = await import('./js/netzkodierung.js');
    const leer = { feinde: [], asteroiden: [], bosses: [], laser: [], raketen: [], bomben: [], hackProjektile: [],
      feindLaser: [], bossLaser: [], bossRaketen: [], bossBomben: [], powerups: [] };
    const snap = (laser, extra) => Object.assign({}, leer, { p1: { x: 1.26, hacks: [] }, p2: null, score: 0, level: 1, bossAktiv: false, laser }, extra || {});
    const k = new NK.SnapshotKodierer();
    const d = new NK.SnapshotDekodierer();
    const out = {};
    const rund = (s, t) => { const p = k.kodiere(s, t); return { p, r: d.dekodiere(JSON.parse(JSON.stringify(p))) }; };

    // Ohne Keyframe nimmt der Dekodierer keine Deltas an
    const fremd = new NK.SnapshotKodierer();
    fremd.kodiere(snap([]), 0);
    out.ohneKeyframe = new NK.SnapshotDekodierer().dekodiere(JSON.parse(JSON.stringify(fremd.kodiere(snap([]), 2))));

    const a = rund(snap([{ id: 'l_404', x: 100.04, y: 500.123456, vx: 2, vy: 15, owner: 'p2', color: 'x' }, { id: 'sonder_7', x: 5, y: 500.1, vx: 0, vy: 15 }]), 0);
    out.keyframe = a.p.k;
    out.ids = a.r.laser.map(l => l.id);
    out.idCodes = a.p.l.laser.i;
    out.x = a.r.laser[0].x;
    out.p1x = a.r.p1.x;
    // 4 Schritte spaeter genau auf der vorhergesagten Bahn (Spielerlaser: y -= vy): kein x/y im Paket
    const b = rund(snap([{ id: 'l_404', x: 108, y: 440.1, vx: 2, vy: 15, owner: 'p2', color: 'x' }, { id: 'sonder_7', x: 5, y: 440.3, vx: 0, vy: 15 }]), 4);
    out.deltaB = b.p.l && b.p.l.laser;
    out.rekonB = b.r.laser.map(l => [l.x, l.y]);
    // Abgelenkt (vx geaendert, Position weicht ab): x wird gesendet
    const c = rund(snap([{ id: 'l_404', x: 100, y: 410.1, vx: -3, vy: 15, owner: 'p2', color: 'x' }], { bossWarningAktiv: true }), 6);
    out.deltaC = c.p.l.laser;
    out.obenC = c.p.o;
    out.rekonC = c.r.laser;
    out.warnungC = c.r.bossWarningAktiv;
    // Optionales Feld verschwindet wieder
    const e = rund(snap([], {}), 8);
    out.obenE = e.p.o;
    out.warnungE = 'bossWarningAktiv' in e.r;
    return out;
  });
  expect(r.ohneKeyframe).toBeNull();
  expect(r.keyframe).toBe(1);
  expect(r.ids).toEqual(['l_404', 'sonder_7']);
  expect(r.idCodes).toEqual([404, 'sonder_7']);
  expect(r.x).toBe(100);
  expect(r.p1x).toBe(1.3);
  expect(r.deltaB).toBeUndefined();
  // sonder_7 weicht 0,2 px ab und bleibt auf der Vorhersage
  expect(r.rekonB).toEqual([[108, 440.1], [5, 440.1]]);
  expect(r.deltaC).toEqual({ i: [404], d: [{ x: 100, vx: -3 }] });
  expect(r.obenC).toEqual({ bossWarningAktiv: true });
  expect(r.rekonC).toEqual([{ id: 'l_404', x: 100, y: 410.1, vx: -3, vy: 15, owner: 'p2', color: 'x' }]);
  expect(r.warnungC).toBe(true);
  expect(r.obenE).toEqual({ _d: ['bossWarningAktiv'] });
  expect(r.warnungE).toBe(false);
});

// Client-Modus herstellen (ohne echte Verbindung)
async function alsClient(page) {
  await page.evaluate((LISTEN_ARRAYS) => {
    const { state, arrays, Utils } = window.__game;
    Utils.setGameMode('online');
    state.spielLaeuft = true;
    state.pausiert = false;
    state.cutsceneAktiv = false;
    state.gameOverAktiv = false;
    state.bossWarningAktiv = false;
    state.network.isOnline = true;
    state.network.isHost = false;
    state.network.isClient = true;
    state.network.connected = true;
    LISTEN_ARRAYS.forEach(n => {
      arrays[n].forEach(o => { if (o.el) o.el.remove(); });
      arrays[n].length = 0;
    });
    window.__snapshot = (extra) => Object.assign({
      p1: { x: 200, y: 400, rotate: 0, leben: 3, energie: 50, maxEnergie: 50, isDead: false, hacks: [] },
      p2: { x: 350, y: 400, rotate: 0, leben: 3, energie: 50, maxEnergie: 50, isDead: false, hacks: [] },
      score: 0, level: 1, bossAktiv: false,
      feinde: [], asteroiden: [], bosses: [], laser: [], raketen: [], bomben: [],
      hackProjektile: [], feindLaser: [], bossLaser: [], bossRaketen: [], bossBomben: [], powerups: []
    }, extra || {});
  }, LISTEN_ARRAYS);
}

test('Eingaben: gehaltene Raketen- und Bombentaste feuern auf dem Host genau wie bisher', async ({ page }) => {
  await alsHost(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, arrays } = g;
    const NK = await import('./js/netzkodierung.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    state.godMode = true;
    // Lange halten, loslassen, kurz tippen (1 Schritt), erneut halten
    const muster = i => ({
      rakete: (i >= 10 && i < 400) || i === 470 || (i >= 520 && i < 560),
      bombe: (i >= 5 && i < 120) || i === 300 || (i >= 400 && i < 410)
    });
    function lauf(neu) {
      ['laserArray', 'raketenArray', 'bombenArray', 'feinde', 'asteroiden'].forEach(n => {
        arrays[n].forEach(o => { if (o.el) o.el.remove(); });
        arrays[n].length = 0;
      });
      Object.assign(state.p2, {
        raketenCooldown: 0, bombenCooldown: 0, networkFireRakete: false, networkFireBombe: false,
        raketeGehalten: false, bombeGehalten: false, laserInputRequested: false, isDead: false,
        raketenStufe: 1, bombenStufe: 1, hacks: []
      });
      state.frameZaehler = 10;
      const sender = new NK.EingabeSender();
      let raketen = 0, bomben = 0, pakete = 0;
      for (let i = 0; i < 700; i++) {
        const m = muster(i);
        const eingabe = { x: 370, y: 400, rotate: 0, laser: false, rakete: m.rakete, bombe: m.bombe };
        if (neu) {
          const p = sender.naechstes(eingabe);
          if (p) { pakete++; g.Network.empfangeEingabePaket(JSON.parse(JSON.stringify(p))); }
        } else {
          // Bisher: jedes Client-Bild ein volles Paket
          pakete++;
          g.Network.applyPlayerInput(eingabe);
        }
        state.p2.invulnerableTimer = 1000;
        const rcd = state.p2.raketenCooldown;
        const bcd = state.p2.bombenCooldown;
        simulationsSchritt();
        if (state.p2.raketenCooldown > rcd) raketen++;
        if (state.p2.bombenCooldown > bcd) bomben++;
        // Kurze Bomben-Abklingzeit, damit Halten mehrfach zaehlt (in beiden Laeufen gleich)
        if (state.p2.bombenCooldown > 50) state.p2.bombenCooldown = 50;
        arrays.asteroiden.forEach(o => o.el && o.el.remove()); arrays.asteroiden.length = 0;
        arrays.feinde.forEach(o => o.el && o.el.remove()); arrays.feinde.length = 0;
      }
      return { raketen, bomben, pakete };
    }
    return { alt: lauf(false), neu: lauf(true), online: state.network.isOnline };
  });
  console.log(`Eingabe-Pakete in 700 Schritten: bisher ${r.alt.pakete}, neu ${r.neu.pakete} | Raketen ${r.alt.raketen}/${r.neu.raketen}, Bomben ${r.alt.bomben}/${r.neu.bomben}`);
  expect(r.online).toBe(true);
  expect(r.alt.raketen).toBeGreaterThanOrEqual(4);
  expect(r.alt.bomben).toBeGreaterThanOrEqual(4);
  expect(r.neu.raketen).toBe(r.alt.raketen);
  expect(r.neu.bomben).toBe(r.alt.bomben);
  expect(r.neu.pakete).toBeLessThan(r.alt.pakete / 10);
});

test('Eingaben: Client sendet nur bei Tastenwechsel sofort, Bewegung jeden 2. Schritt, sonst Heartbeat', async ({ page }) => {
  await alsClient(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const { simulationsSchritt } = await import('./js/loop.js');
    const keys = state.tastenGedrueckt;
    Object.keys(keys).forEach(k => { keys[k] = false; });
    const zaehle = (n) => {
      const vorher = state.network.eingabePakete || 0;
      for (let i = 0; i < n; i++) simulationsSchritt();
      return (state.network.eingabePakete || 0) - vorher;
    };
    const out = {};
    zaehle(1);
    out.ruhe90 = zaehle(90);
    keys.k = true;
    out.druck = zaehle(1);
    out.druckWert = state.network.lastSentInput.rakete;
    out.halten = zaehle(10);
    keys.k = false;
    out.loslassen = zaehle(1);
    out.loslassenWert = state.network.lastSentInput.rakete;
    keys.d = true;
    out.bewegung20 = zaehle(20);
    out.xGerundet = state.network.lastSentInput.x === Math.round(state.network.lastSentInput.x * 10) / 10;
    out.version = state.network.lastSentInput.v;
    keys.d = false;
    return out;
  });
  expect(r).toEqual({
    ruhe90: 3, druck: 1, druckWert: true, halten: 0, loslassen: 1, loslassenWert: false,
    bewegung20: 10, xGerundet: true, version: 2
  });
});

test('Client wendet kodierte Pakete an und fordert nach einer Luecke einen Keyframe an', async ({ page }) => {
  await alsClient(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state, arrays } = g;
    const NK = await import('./js/netzkodierung.js');
    const k = new NK.SnapshotKodierer();
    const feind = (x, hp) => ({ id: 'f_7', x, y: 50, hp, maxHp: 30, groesse: 30, typ: 1, muster: 'normal', hatSchild: false, schildHp: 0 });
    const sende = (snap, t) => JSON.parse(JSON.stringify(k.kodiere(snap, t)));
    const out = {};
    g.Network.empfangeSnapshotPaket(sende(window.__snapshot({ feinde: [feind(100, 30)], score: 10 }), 0));
    out.nachKeyframe = [arrays.feinde.length, arrays.feinde[0].x, state.score];
    g.Network.empfangeSnapshotPaket(sende(window.__snapshot({ feinde: [feind(103.33, 20)], score: 20 }), 2));
    out.nachDelta = [arrays.feinde[0].x, arrays.feinde[0].hp, state.score];
    state.network.lastSentEvent = null;
    sende(window.__snapshot({ feinde: [feind(106, 20)], score: 30 }), 4); // geht verloren
    g.Network.empfangeSnapshotPaket(sende(window.__snapshot({ feinde: [feind(109, 20)], score: 40 }), 6));
    out.nachLuecke = [arrays.feinde[0].x, state.score];
    out.anforderung = state.network.lastSentEvent && state.network.lastSentEvent.type;
    k.erzwingeKeyframe();
    g.Network.empfangeSnapshotPaket(sende(window.__snapshot({ feinde: [], score: 50 }), 8));
    out.nachNeuemKeyframe = [arrays.feinde.length, state.score];
    out.online = state.network.isOnline;
    return out;
  });
  expect(r).toEqual({
    nachKeyframe: [1, 100, 10],
    nachDelta: [103.3, 20, 20],
    nachLuecke: [103.3, 20],
    anforderung: 'keyframe_anfordern',
    nachNeuemKeyframe: [0, 50],
    online: true
  });
});

test('Protokoll: passende Version wird akzeptiert, andere Version beendet die Sitzung mit Hinweis', async ({ page }) => {
  await alsHost(page);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const { state } = g;
    const NK = await import('./js/netzkodierung.js');
    g.Network.handleNetworkEvent({ type: 'hallo', protokoll: NK.PROTOKOLL_VERSION, version: '1.7.0' }, 'peer');
    const passend = { online: state.network.isOnline, ok: state.network.protokollOk };
    g.Network.handleNetworkEvent({ type: 'hallo', protokoll: NK.PROTOKOLL_VERSION - 1, version: '1.6.60' }, 'peer');
    const status = document.getElementById('online-status');
    return {
      passend,
      online: state.network.isOnline,
      connected: state.network.connected,
      spiel: state.spielLaeuft,
      text: status.textContent,
      sichtbar: status.style.display,
      farbe: status.style.color,
      letztesEvent: state.network.lastSentEvent && state.network.lastSentEvent.type
    };
  });
  expect(r).toEqual({
    passend: { online: true, ok: true },
    online: false,
    connected: false,
    spiel: false,
    text: 'Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)',
    sichtbar: 'block',
    farbe: 'rgb(231, 76, 60)',
    letztesEvent: 'peer_left'
  });
});

test('Protokoll: Client verwirft alte Snapshots und Host alte Eingaben (Sitzung endet mit Hinweis)', async ({ page }) => {
  await alsClient(page);
  const client = await page.evaluate(() => {
    const g = window.__game;
    g.Network.empfangeSnapshotPaket(window.__snapshot({ feinde: [{ id: 'f_1', x: 10, y: 10, hp: 1, maxHp: 1 }] }));
    return { online: g.state.network.isOnline, feinde: g.arrays.feinde.length, text: document.getElementById('online-status').textContent };
  });
  expect(client).toEqual({ online: false, feinde: 0, text: 'Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)' });

  await alsHost(page);
  const host = await page.evaluate(() => {
    const g = window.__game;
    g.Network.empfangeEingabePaket({ x: 100, y: 100, rotate: 0, laser: true, rakete: false, bombe: false });
    return { online: g.state.network.isOnline, angewendet: g.state.p2.x === 100, text: document.getElementById('online-status').textContent };
  });
  expect(host).toEqual({ online: false, angewendet: false, text: 'Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)' });
});

test('Protokoll: ohne hallo vom Mitspieler endet die Sitzung nach dem Timeout', async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.state);
  await page.evaluate(() => {
    const g = window.__game;
    g.Utils.setGameMode('online');
    g.state.network.isOnline = true;
    g.state.network.isHost = true;
    g.Network.onPeerJoined('alter_peer');
  });
  expect(await page.evaluate(() => window.__game.state.network.connected)).toBe(true);
  await page.clock.runFor(10000 + 100); // HALLO_TIMEOUT_MS
  const r = await page.evaluate(() => ({
    online: window.__game.state.network.isOnline,
    text: document.getElementById('online-status').textContent
  }));
  expect(r).toEqual({ online: false, text: 'Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)' });
});

