// Anzeige-Schnittstelle (src/js/anzeige.js): Die Spiellogik aendert nur Modellfelder, ein austauschbares
// Backend zeichnet die Weltobjekte. Diese Tests setzen ein Test-Backend statt des DOM-Backends ein.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await setzeSpielstand(page);
  await page.goto('/');
});

test('Test-Backend: zeichneWelt einmal pro Schritt, Logik schreibt keine Positionen ins DOM, entferne beim Verlassen des Felds', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    const { state, arrays, config } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');

    state.spielLaeuft = true;
    state.godMode = true;
    Entities.erzeugeFeind(100, 50, 'normal', 0);
    const f = arrays.feinde[arrays.feinde.length - 1];
    const topVorher = f.el.style.top;
    const yVorher = f.y;

    const protokoll = { zeichne: 0, entfernt: [] };
    const domBackend = Anzeige.holeBackend();
    Anzeige.setzeBackend({
      erzeuge() {},
      blitze() {}, blitzeSpielfeld() {},
      zeichneSpieler() {},
      zeichneWelt() { protokoll.zeichne++; },
      entferne(o) { protokoll.entfernt.push(o.id); }
    });
    try {
      for (let i = 0; i < 3; i++) simulationsSchritt();
      const nachSchritten = { zeichne: protokoll.zeichne, yBewegt: f.y > yVorher, topGleich: f.el.style.top === topVorher };
      f.y = config.spielfeldHoehe + 10;
      simulationsSchritt();
      return {
        ...nachSchritten,
        entferntFeind: protokoll.entfernt.includes(f.id),
        ausListe: !arrays.feinde.includes(f),
        elementNochDa: f.el.isConnected
      };
    } finally {
      Anzeige.setzeBackend(domBackend);
    }
  });
  expect(r.zeichne).toBe(3);
  expect(r.yBewegt).toBe(true);
  expect(r.topGleich).toBe(true);
  expect(r.entferntFeind).toBe(true);
  expect(r.ausListe).toBe(true);
  // Das Test-Backend entfernt nichts aus dem DOM: das Entfernen laeuft nur ueber die Anzeige
  expect(r.elementNochDa).toBe(true);
});

test('DOM-Backend zeichnet aus dem Modell: Position, Drehung, Anzeigeposition des Online-Clients', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const { arrays } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    Entities.erzeugeFeind(100, 50, 'normal', 0);
    const f = arrays.feinde[arrays.feinde.length - 1];
    f.x = 12; f.y = 34; f.rot = 45;
    Anzeige.zeichneWelt();
    const modell = [f.el.style.left, f.el.style.top, f.el.style.transform];
    f.anzeigeX = 56; f.anzeigeY = 78;
    Anzeige.zeichneWelt();
    const anzeige = [f.el.style.left, f.el.style.top];
    Anzeige.entferne(f);
    return { modell, anzeige, entfernt: !f.el.isConnected };
  });
  expect(r.modell).toEqual(['12px', '34px', 'rotate(45deg)']);
  expect(r.anzeige).toEqual(['56px', '78px']);
  expect(r.entfernt).toBe(true);
});

test('setzeBackend lehnt ein Backend ohne Pflichtfunktionen ab', async ({ page }) => {
  const fehler = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const meldungen = [];
    const f = () => {};
    const voll = { erzeuge: f, zeichneWelt: f, zeichneSpieler: f, entferne: f, blitze: f, blitzeSpielfeld: f };
    const ohne = name => { const b = { ...voll }; delete b[name]; return b; };
    for (const b of [null, {}, ...Object.keys(voll).map(ohne)]) {
      try { Anzeige.setzeBackend(b); meldungen.push(null); } catch (e) { meldungen.push(e.message); }
    }
    return meldungen;
  });
  expect(fehler.every(m => typeof m === 'string' && m.startsWith('Anzeige-Backend ohne'))).toBe(true);
});

test('Spiellogik erzeugt Weltobjekte nur ueber die Anzeige: Test-Backend bekommt Objekt und Art, kein DOM-Element', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const { state, arrays } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const domBackend = Anzeige.holeBackend();
    const erzeugt = [];
    Anzeige.setzeBackend({ erzeuge(o, art) { erzeugt.push(art); }, zeichneWelt() {}, zeichneSpieler() {}, entferne() {}, blitze() {}, blitzeSpielfeld() {} });
    const vorher = document.querySelectorAll('#spielfeld *').length;
    try {
      state.level = 1;
      Entities.erzeugeFeind(100, 50, 'normal', 0);
      Entities.erzeugeAsteroid(50, 50, 30, 0, 1, 0, true);
      Entities.erzeugePowerup(10, 10, 'schild');
      Entities.erzeugeFeindLaser(100, 100, 200, 300);
      Entities.erzeugeHackProjektil(100, 100, 200, 300);
      Entities.erzeugeBossLaser(100, 100, 2, 6);
      Entities.erzeugeBossBombe(100, 100);
      Entities.erzeugeBossRakete(100, 100, 1);
      Entities.erzeugeBoss();
      const neu = [arrays.feinde, arrays.asteroiden, arrays.powerups, arrays.feindLaserArray, arrays.hackProjektilArray,
        arrays.bossLaserArray, arrays.bossBombenArray, arrays.bossRaketenArray, arrays.bosses].map(l => l[l.length - 1]);
      const ast = arrays.asteroiden[arrays.asteroiden.length - 1];
      return {
        erzeugt,
        ohneEl: neu.every(o => o.el === undefined),
        domGleich: document.querySelectorAll('#spielfeld *').length === vorher,
        asteroid: { farbe: typeof ast.farbe, farbe2: typeof ast.farbe2, formPunkte: Array.isArray(ast.form) && ast.form.length >= 6, riss: typeof ast.riss }
      };
    } finally {
      Anzeige.setzeBackend(domBackend);
    }
  });
  expect(r.erzeugt).toEqual(['feind', 'asteroid', 'powerup', 'feindLaser', 'hackProjektil', 'bossLaser', 'bossBombe', 'bossRakete', 'boss']);
  expect(r.ohneEl).toBe(true);
  expect(r.domGleich).toBe(true);
  expect(r.asteroid).toEqual({ farbe: 'string', farbe2: 'string', formPunkte: true, riss: 'number' });
});

test('Host und Online-Client bauen gleiche Elemente; der Snapshot traegt Modelldaten statt CSS-Text', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, state } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const Network = await import('./js/network.js');
    const Anzeige = await import('./js/anzeige.js');
    state.level = 1;
    Entities.erzeugeAsteroid(50, 60, 40, 0, 1, 0, true);
    Entities.erzeugeFeind(120, 40, 'swoop', 2, true);
    Entities.erzeugePowerup(10, 20, 'laser');
    const host = {
      asteroid: arrays.asteroiden[0].el.outerHTML,
      feind: arrays.feinde[0].el.outerHTML,
      powerup: arrays.powerups[0].el.outerHTML
    };
    const snapshot = Network.serializeGameState();
    // Host-Objekte entfernen, damit der Client sie aus dem Snapshot neu baut
    for (const liste of [arrays.asteroiden, arrays.feinde, arrays.powerups]) {
      liste.forEach(Anzeige.entferne);
      liste.length = 0;
    }
    Network.applyGameStateSnapshot(snapshot);
    const sa = snapshot.asteroiden[0];
    // transform (Drehung) haengt vom Zeitpunkt ab, der Rest muss gleich sein
    const ohneDrehung = html => html.replace(/ ?transform: [^;]*;/g, '');
    return {
      gleich: {
        asteroid: ohneDrehung(arrays.asteroiden[0].el.outerHTML) === ohneDrehung(host.asteroid),
        feind: ohneDrehung(arrays.feinde[0].el.outerHTML) === ohneDrehung(host.feind),
        powerup: arrays.powerups[0].el.outerHTML === host.powerup
      },
      snapshotFelder: Object.keys(sa).filter(k => ['background', 'clipPath', 'baseColor'].includes(k)),
      formText: typeof sa.form
    };
  });
  expect(r.gleich).toEqual({ asteroid: true, feind: true, powerup: true });
  expect(r.snapshotFelder).toEqual([]);
  expect(r.formText).toBe('string');
});

// Bugfix: Der Snapshot schickte immer Boss-Typ 1 (Host speichert bossTyp), der Client zeigte daher immer den ersten Boss
test('Snapshot traegt den Boss-Typ des Hosts', async ({ page }) => {
  const typ = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const Network = await import('./js/network.js');
    state.level = 3;
    Entities.erzeugeBoss();
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
    const Anzeige = await import('./js/anzeige.js');
    state.level = 1;
    Entities.erzeugeFeind(100, 40, 'normal', 0, true);
    const host = arrays.feinde[0];
    const mitSchild = Network.serializeGameState();
    host.schildHp = 0;
    const ohneSchild = Network.serializeGameState();
    arrays.feinde.forEach(Anzeige.entferne);
    arrays.feinde.length = 0;
    Network.applyGameStateSnapshot(mitSchild);
    const vorher = !!arrays.feinde[0].el.querySelector('.feind-schild');
    Network.applyGameStateSnapshot(ohneSchild);
    return { vorher, nachher: !!arrays.feinde[0].el.querySelector('.feind-schild') };
  });
  expect(r).toEqual({ vorher: true, nachher: false });
});

test('DOM-Backend zeigt Zustand aus Modellfeldern: Schild, Risse, Magma, Betaeubung, Repulsor, Schlepp-Strahl, Parade', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, state } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const Anzeige = await import('./js/anzeige.js');
    state.level = 1;
    Entities.erzeugeFeind(100, 40, 'normal', 0, true);
    Entities.erzeugeAsteroid(50, 60, 40, 0, 1, 0, true);
    Entities.erzeugeBoss();
    Entities.erzeugePowerup(10, 20, 'schild', 'p2');
    Entities.erzeugeFeindLaser(100, 100, 100, 300);
    const [f, a, b, p, fl] = [arrays.feinde[0], arrays.asteroiden[0], arrays.bosses[0], arrays.powerups[0], arrays.feindLaserArray[0]];
    f.schildHp = 0; f.betaeubt = 5;
    a.hp = a.maxHp / 2;
    b.repulsorAktiv = true;
    p.towedBy = 'p1'; p.strahlX = 30; p.strahlY = 40;
    fl.harmlos = true;
    Anzeige.zeichneWelt();
    const strahl = p.beamEl && p.beamEl.querySelector('line');
    const zustand = {
      schildWeg: !f.el.querySelector('.feind-schild'),
      betaeubt: f.el.classList.contains('betaeubt'),
      riss: parseFloat(a.rissEl.style.opacity),
      repulsor: b.el.classList.contains('repulsor-aktiv'),
      towed: p.el.classList.contains('powerup-towed-p1'),
      strahl: strahl ? [strahl.getAttribute('x1'), strahl.getAttribute('y1')] : null,
      pariert: fl.el.classList.contains('gleve-pariert')
    };
    // Zustand zurueck: Klassen und Strahl verschwinden wieder; Magma-Brocken bekommt seine Klasse
    f.betaeubt = 0; b.repulsorAktiv = false; p.towedBy = null; a.istUnzerstoerbar = true;
    Anzeige.zeichneWelt();
    const strahlEl = p.beamEl;
    return {
      zustand,
      zurueck: { betaeubt: f.el.classList.contains('betaeubt'), repulsor: b.el.classList.contains('repulsor-aktiv'),
        towed: p.el.classList.contains('powerup-towed'), strahl: strahlEl, magma: a.el.classList.contains('unzerstoerbar') }
    };
  });
  expect(r.zustand).toEqual({ schildWeg: true, betaeubt: true, riss: 0.5, repulsor: true, towed: true, strahl: ['30', '40'], pariert: true });
  expect(r.zurueck).toEqual({ betaeubt: false, repulsor: false, towed: false, strahl: null, magma: true });
});

test('Treffer melden einen Blitz an die Anzeige, ohne Element-Zugriff der Logik', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, state } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const Anzeige = await import('./js/anzeige.js');
    const Gleve = await import('./js/gleve.js');
    state.level = 1;
    Entities.erzeugeAsteroid(50, 60, 40, 0, 1, 0, true);
    const a = arrays.asteroiden[0];
    const domBackend = Anzeige.holeBackend();
    const blitze = [];
    Anzeige.setzeBackend({ ...domBackend, blitze(o, staerke) { blitze.push([o.id, staerke]); } });
    try {
      Gleve.schadeZiel(a, 1, 'p1');
    } finally {
      Anzeige.setzeBackend(domBackend);
    }
    return { blitze, id: a.id };
  });
  expect(r.blitze).toEqual([[r.id, 2.5]]);
});

// Bugfix: Der Snapshot schickte state.rotate, das nie gesetzt wurde (die Neigung lag nur im DOM), der
// Online-Client sah P1 daher nie geneigt
test('Snapshot traegt die angezeigte Neigung von P1', async ({ page }) => {
  const rotate = await page.evaluate(async () => {
    const { state } = await import('./js/state.js');
    const { bewegeSpieler } = await import('./js/spieler.js');
    const Network = await import('./js/network.js');
    state.spielLaeuft = true;
    state.isDead = false;
    state.tastenGedrueckt.d = true;
    for (let i = 0; i < 20; i++) bewegeSpieler();
    state.tastenGedrueckt.d = false;
    return Network.serializeGameState().p1.rotate;
  });
  expect(rotate).toBeGreaterThan(10);
});

test('Spielerschiff aus dem Zustand: Position, Neigung, Flammen, Sichtbarkeit, Blinken, Schild', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state, dom } = await import('./js/state.js');
    const Anzeige = await import('./js/anzeige.js');
    Object.assign(state, { x: 40, y: 50, drehung: 12, flammenSkala: 1.8, schiffSichtbar: true, invulnerableTimer: 10, schildStufe: 2 });
    Anzeige.zeichneSpieler();
    const el = dom.spieler;
    const an = {
      pos: [el.style.left, el.style.top], transform: el.style.transform, display: el.style.display,
      flamme: document.getElementById('flame-left').style.transform,
      blink: el.classList.contains('spieler-blink'),
      schild: Array.from(el.classList).filter(k => k.startsWith('schild-aktiv-'))
    };
    // Online-Client: P1 an der interpolierten Anzeigeposition
    Object.assign(state, { anzeigeX: 70, anzeigeY: 80, schiffSichtbar: false, invulnerableTimer: 0, schildStufe: 0 });
    Anzeige.zeichneSpieler();
    const aus = { pos: [el.style.left, el.style.top], display: el.style.display, blink: el.classList.contains('spieler-blink'),
      schild: Array.from(el.classList).filter(k => k.startsWith('schild-aktiv-')) };
    delete state.anzeigeX;
    delete state.anzeigeY;
    return { an, aus };
  });
  expect(r.an).toEqual({ pos: ['40px', '50px'], transform: 'rotate(12deg)', display: 'block', flamme: 'scaleY(1.8)', blink: true, schild: ['schild-aktiv-2'] });
  expect(r.aus).toEqual({ pos: ['70px', '80px'], display: 'none', blink: false, schild: [] });
});

test('Schiffsaussehen und -zustand aus dem Modell: SVG, Werfer-Pods, Dash/Rolle/Overdrive/Hack, Strahlen', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { state, dom } = await import('./js/state.js');
    const Anzeige = await import('./js/anzeige.js');
    const el = dom.spieler;
    const pods = () => ['.werfer-links', '.werfer-rechts', '.werfer-center'].map(sel => el.querySelector(sel).style.display);
    Object.assign(state, { isDead: false, selectedShipModel: 'gleve', selectedShipColor: 'green', raketenStufe: 5, gleveDashTimer: 4 });
    Anzeige.zeichneSpieler();
    const gleve = { klasse: el.classList.contains('schiff-gleve'), dash: el.classList.contains('gleve-dash'), pods: pods(),
      svgGruen: el.querySelector('svg').innerHTML.includes('#2ecc71') };
    Object.assign(state, { selectedShipModel: 'viper', selectedShipColor: 'red', raketenStufe: 5, gleveDashTimer: 0,
      viperRolleTimer: 3, viperOverdriveTimer: 10, hacks: [{ typ: 'invertiert', timer: 90 }],
      autolaserStrahl: { x: 100, y: 300, laenge: 50, winkel: 20 }, hitscanStrahl: { x: 100, y: 300, laenge: 300 } });
    Anzeige.zeichneSpieler();
    const label = document.getElementById('hack-label-p1');
    const auto = dom.autolaserEl;
    const hitscan = document.getElementById('hitscan-laser');
    const viper = { klasse: el.classList.contains('schiff-gleve'), dash: el.classList.contains('gleve-dash'), pods: pods(),
      rolle: el.classList.contains('viper-rolle'), overdrive: el.classList.contains('viper-overdrive'),
      gehackt: el.classList.contains('spieler-gehackt'), label: label && label.style.display, labelText: label && label.textContent,
      auto: [auto.style.display, auto.style.top, auto.style.transform], hitscan: [hitscan.style.display, hitscan.style.top] };
    Object.assign(state, { raketenStufe: 1, viperRolleTimer: 0, viperOverdriveTimer: 0, hacks: [], autolaserStrahl: null, hitscanStrahl: null });
    Anzeige.zeichneSpieler();
    const aus = { pods: pods(), rolle: el.classList.contains('viper-rolle'), gehackt: el.classList.contains('spieler-gehackt'),
      label: label.style.display, auto: auto.style.display, hitscan: hitscan.style.display };
    return { gleve, viper, aus };
  });
  expect(r.gleve).toEqual({ klasse: true, dash: true, pods: ['none', 'none', 'none'], svgGruen: true });
  expect(r.viper).toEqual({ klasse: false, dash: false, pods: ['block', 'block', 'block'], rolle: true, overdrive: true,
    gehackt: true, label: 'block', labelText: 'INVERTED', auto: ['block', '250px', 'rotate(20deg)'], hitscan: ['block', '0px'] });
  expect(r.aus).toEqual({ pods: ['block', 'none', 'none'], rolle: false, gehackt: false, label: 'none', auto: 'none', hitscan: 'none' });
});

test('Spielerschiffe: Logik schreibt nicht in #spieler / #spieler-2', () => {
  const module = ['spieler.js', 'client.js', 'network.js', 'powerups.js', 'input.js', 'main.js', 'cutscene.js', 'loop.js',
    'utils.js', 'gleve.js', 'viper.js', 'hack.js', 'waffen.js'];
  const verboten = /dom\.spieler2?\.(style|classList|setAttribute|querySelector)|flame-(left|right)|autolaserEl|hitscan-laser|schiffElement/;
  const funde = [];
  for (const datei of module) {
    const zeilen = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', datei), 'utf8').split('\n');
    zeilen.forEach((zeile, i) => { if (verboten.test(zeile)) funde.push(`${datei}:${i + 1}: ${zeile.trim()}`); });
  }
  expect(funde).toEqual([]);
});

// Waechter: Diese Module laufen ueber die Anzeige-Schnittstelle. Positionen und Entfernen von Weltobjekten
// gehoeren ins Backend (anzeige-dom.js), nicht in die Spiellogik.
test('Spiellogik fasst die Elemente der Weltobjekte nicht an (Position, Zustand, Entfernen)', () => {
  const module = ['loop.js', 'client.js', 'gegner.js', 'boss.js', 'waffen.js', 'powerups.js', 'partikel.js',
    'gleve.js', 'input.js', 'utils.js', 'network.js', 'entities.js'];
  const verboten = /\.el\.style\.|\.el\.remove\(\)|\.el\.classList|\.el\.querySelector|schildEl|rissEl|beamEl/;
  const funde = [];
  for (const datei of module) {
    const zeilen = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', datei), 'utf8').split('\n');
    zeilen.forEach((zeile, i) => { if (verboten.test(zeile)) funde.push(`${datei}:${i + 1}: ${zeile.trim()}`); });
  }
  expect(funde).toEqual([]);
});

test('entities.js baut keine DOM-Elemente (Erzeugen nur ueber Anzeige.erzeuge)', () => {
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'entities.js'), 'utf8');
  expect(quelle.match(/document\.\w+|\.el\.(style|innerHTML|classList|appendChild)/g)).toBeNull();
});

test('Partikel entstehen nur ueber erzeugePartikel (partikel.js)', () => {
  const ordner = path.join(__dirname, '..', 'src', 'js');
  const funde = fs.readdirSync(ordner).filter(d => d.endsWith('.js') && d !== 'partikel.js')
    .filter(d => fs.readFileSync(path.join(ordner, d), 'utf8').includes('partikelArray.push'));
  expect(funde).toEqual([]);
});

test('Detonationen erzeugen Effekte ueber die Anzeige: Test-Backend bekommt Art effekt, kein Element im Spielfeld', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const Utils = await import('./js/utils.js');
    const { arrays } = await import('./js/state.js');
    const domBackend = Anzeige.holeBackend();
    const arten = [];
    Anzeige.setzeBackend({ erzeuge(o, art) { if (art === 'effekt') arten.push(o.art); }, zeichneWelt() {}, zeichneSpieler() {}, entferne() {}, blitze() {}, blitzeSpielfeld() {} });
    const vorher = document.querySelector('#spielfeld').children.length;
    try {
      Utils.erzeugeBombenDetonation(100, 100, '#f39c12', 80, 1, false);
      Utils.erzeugeRaketenDetonation(200, 200, 70);
      return { arten, effekte: arrays.effekte.length, kinder: document.querySelector('#spielfeld').children.length - vorher };
    } finally {
      Anzeige.setzeBackend(domBackend);
      arrays.effekte.length = 0;
    }
  });
  expect(r.arten).toEqual(['bombenWelle', 'raketenWelle']);
  expect(r.effekte).toBe(2);
  expect(r.kinder).toBe(0);
});

test('Effekt laeuft nach dauer Schritten ab (Element weg), in der Pause nicht', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    const { state, arrays } = await import('./js/state.js');
    state.spielLaeuft = true;
    state.godMode = true;
    state.frameZaehler = 1;
    Utils.erzeugeRaketenDetonation(200, 200, 70);
    const e = arrays.effekte[0];
    const dauer = e.dauer;
    const t0 = e.el.style.transform;
    state.pausiert = true;
    for (let i = 0; i < 5; i++) simulationsSchritt();
    const pause = { rest: e.rest, da: e.el.isConnected };
    state.pausiert = false;
    for (let i = 0; i < 5; i++) simulationsSchritt();
    const mitte = { rest: e.rest, skala: e.el.style.transform !== t0, deckkraft: Number(e.el.style.opacity) };
    for (let i = 0; i < dauer; i++) simulationsSchritt();
    return { dauer, pause, mitte, leer: arrays.effekte.length, weg: !e.el.isConnected };
  });
  expect(r.dauer).toBe(18);
  expect(r.pause).toEqual({ rest: 18, da: true });
  expect(r.mitte.rest).toBe(13);
  expect(r.mitte.skala).toBe(true);
  expect(r.mitte.deckkraft).toBeLessThan(1);
  expect(r.leer).toBe(0);
  expect(r.weg).toBe(true);
});

test('Stufe-3-Bombe erzeugt zwei Effekte, der zweite ist in den ersten 9 Schritten unsichtbar', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Utils = await import('./js/utils.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    const { state, arrays } = await import('./js/state.js');
    state.spielLaeuft = true;
    state.godMode = true;
    state.frameZaehler = 1;
    Utils.erzeugeBombenDetonation(200, 200, '#9b59b6', 100, 3, false);
    const [a, b] = arrays.effekte;
    const unsichtbar = [];
    for (let i = 0; i < 12; i++) {
      unsichtbar.push(b.el.style.opacity === '0');
      simulationsSchritt();
    }
    const mini = arrays.effekte.length;
    Utils.erzeugeBombenDetonation(200, 200, '#9b59b6', 100, 3, true);
    return { arten: [a.art, b.art], unsichtbar, ersteSichtbar: a.el.style.opacity !== '0', mini, nachMini: arrays.effekte.length - mini };
  });
  expect(r.arten).toEqual(['bombenWelle', 'bombenWelle2']);
  expect(r.unsichtbar).toEqual([true, true, true, true, true, true, true, true, true, false, false, false]);
  expect(r.ersteSichtbar).toBe(true);
  // Mini-Bomben (Stufe 3) bekommen keine zweite Welle
  expect(r.nachMini).toBe(1);
});

test('Boss-Bombe erzeugt eine Boss-Welle als Effekt, Game Over und Neustart raeumen Effekte ab', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const Utils = await import('./js/utils.js');
    const { aktualisiereBossBomben } = await import('./js/boss.js');
    const { state, arrays } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    state.spielLaeuft = true;
    state.godMode = true;
    Entities.erzeugeBossBombe(185, 100);
    arrays.bossBombenArray[0].timer = 0;
    aktualisiereBossBomben();
    const boss = arrays.effekte.map(e => e.art);
    const klasse = arrays.effekte[0].el.classList.contains('boss-shockwave');
    Utils.triggerGameOver(0);
    const nachGameOver = arrays.effekte.length;
    Utils.erzeugeRaketenDetonation(100, 100, 70);
    const el = arrays.effekte[0].el;
    Utils.restartGame();
    return { boss, klasse, nachGameOver, nachNeustart: arrays.effekte.length, elWeg: !el.isConnected };
  });
  expect(r.boss).toEqual(['bossWelle']);
  expect(r.klasse).toBe(true);
  expect(r.nachGameOver).toBe(0);
  expect(r.nachNeustart).toBe(0);
  expect(r.elWeg).toBe(true);
});

test('Sniper-Effekte (Strahl, Druckwelle, Minen-Explosion, EMP) laufen als Effekt ueber die Anzeige, Rest und Aufraeumen nach pKey', async ({ page }) => {
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
  await page.keyboard.up('KeyW');
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const Sniper = await import('./js/sniper.js');
    const { aktualisiereEffekte } = await import('./js/effekte.js');
    const { state, arrays } = await import('./js/state.js');
    const domBackend = Anzeige.holeBackend();
    const arten = [];
    const entfernt = [];
    state.selectedShipModel = 'sniper';
    state.energie = 100;
    try {
      Anzeige.setzeBackend({
        erzeuge(o, art) { if (art === 'effekt') arten.push(o.art); },
        zeichneWelt() {}, zeichneSpieler() {}, entferne(o) { entfernt.push(o.art); }, blitze() {}, blitzeSpielfeld() {}
      });
      Sniper.aktualisiereSniper(state, 'p1', true);
      Sniper.aktualisiereSniper(state, 'p1', false);
      Sniper.zeigeDetonation({ x: 100, y: 100, radius: 70, owner: 'p1' });
      Sniper.zeigeMinenExplosion({ x: 150, y: 150, radius: 30, owner: 'p2' });
      Sniper.zeigeEmp({ x: 200, y: 200, radius: 80, owner: 'p1' });
      // das Fadenkreuz bleibt vorerst direkt im DOM, die Effekte nicht
      const kinder = document.querySelectorAll('.sniper-strahl, .sniper-druckwelle, .sniper-mine-explosion, .sniper-emp').length;
      const strahl = arrays.effekte.find(e => e.art === 'sniperStrahl');
      const modellfelder = strahl ? ['x', 'y', 'laenge', 'winkel', 'breite', 'glow', 'farbe', 'pKey'].every(k => strahl[k] !== undefined) : false;
      const gesamt = arrays.effekte.length;
      Sniper.setzeZurueck(state);
      const nachP1 = arrays.effekte.map(e => e.pKey);
      Sniper.entferneEffekte();
      return { arten, kinder, modellfelder, gesamt, nachP1, nachAlle: arrays.effekte.length, entfernt: entfernt.length };
    } finally {
      Anzeige.setzeBackend(domBackend);
      state.selectedShipModel = 'viper';
      arrays.effekte.length = 0;
    }
  });
  expect(r.arten.sort()).toEqual(['sniperDruckwelle', 'sniperEmp', 'sniperMinenExplosion', 'sniperStrahl']);
  expect(r.kinder).toBe(0);
  expect(r.modellfelder).toBe(true);
  expect(r.gesamt).toBe(4);
  expect(r.nachP1).toEqual(['p2']);
  expect(r.nachAlle).toBe(0);
  expect(r.entfernt).toBe(4);
});

test('Sniper-Granate: entsteht ueber Anzeige.erzeuge (sniperGranate), fliegt im Modell, wird nach dem Flug entfernt', async ({ page }) => {
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
  await page.keyboard.up('KeyW');
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const Sniper = await import('./js/sniper.js');
    const { state, arrays } = await import('./js/state.js');
    const domBackend = Anzeige.holeBackend();
    const erzeugt = [];
    const entfernt = [];
    state.selectedShipModel = 'sniper';
    state.sniperZielX = 200;
    state.sniperZielY = 100;
    try {
      Anzeige.setzeBackend({
        erzeuge(o, art) { if (art === 'sniperGranate') erzeugt.push(art); }, // die Explosion erzeugt auch Partikel
        zeichneWelt() {}, zeichneSpieler() {}, entferne(o) { entfernt.push(o.id); }, blitze() {}, blitzeSpielfeld() {}
      });
      const kinderVorher = document.querySelectorAll('.sniper-granate').length;
      Sniper.werfeGranate(state, 'p1');
      const g = arrays.sniperGranaten[0];
      const start = { x: g.x, y: g.y, rest: g.rest, el: g.el };
      Sniper.aktualisiereSniper(state, 'p1', false);
      const nachEins = { x: g.x, y: g.y, rot: g.rot, rest: g.rest };
      for (let i = 1; i < Sniper.GRANATE_FLUG - 1; i++) Sniper.aktualisiereSniper(state, 'p1', false);
      const vorEnde = { laenge: arrays.sniperGranaten.length, entfernt: entfernt.length };
      Sniper.aktualisiereSniper(state, 'p1', false);
      return {
        erzeugt, start, nachEins, vorEnde, kinder: document.querySelectorAll('.sniper-granate').length - kinderVorher,
        nachEnde: arrays.sniperGranaten.length, entfernt, id: g.id, flug: Sniper.GRANATE_FLUG
      };
    } finally {
      Anzeige.setzeBackend(domBackend);
      state.selectedShipModel = 'viper';
      arrays.sniperGranaten.length = 0;
      arrays.effekte.length = 0;
    }
  });
  expect(r.erzeugt).toEqual(['sniperGranate']);
  expect(r.start.el).toBeUndefined();
  expect(r.start.rest).toBe(r.flug);
  expect(r.kinder).toBe(0);
  expect(r.nachEins.rest).toBe(r.flug - 1);
  expect(r.nachEins.rot).toBe(24);
  expect(r.nachEins.y).not.toBe(r.start.y);
  expect(r.vorEnde).toEqual({ laenge: 1, entfernt: 0 });
  expect(r.nachEnde).toBe(0);
  expect(r.entfernt).toEqual([r.id]);
});

test('Online-Client baut aus dem Snapshot-Listeneintrag ein Granaten-Modell in arrays.sniperGranaten', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Sniper = await import('./js/sniper.js');
    const { arrays } = await import('./js/state.js');
    try {
      Sniper.synchronisiereGranaten([{ id: 'sg_7', x: 120, y: 300, owner: 'p2', rest: 20 }]);
      const g = arrays.sniperGranaten[0];
      const modell = { id: g.id, pKey: g.pKey, x: g.x, y: g.y, rest: g.rest, rot: g.rot };
      const el = g.el;
      const pos = { left: el.style.left, top: el.style.top, transform: el.style.transform, klasse: el.classList.contains('sniper-granate') };
      Sniper.synchronisiereGranaten([{ id: 'sg_7', x: 130, y: 280, owner: 'p2', rest: 19 }]);
      const gleich = arrays.sniperGranaten[0] === g && g.x === 130 && g.rot === (Sniper.GRANATE_FLUG - 19) * 24;
      const liste = Sniper.netzGranatenListe();
      Sniper.synchronisiereGranaten([]);
      return { modell, pos, gleich, liste, leer: arrays.sniperGranaten.length, weg: !el.isConnected };
    } finally {
      arrays.sniperGranaten.length = 0;
    }
  });
  expect(r.modell).toEqual({ id: 'sg_7', pKey: 'p2', x: 120, y: 300, rest: 20, rot: (30 - 20) * 24 });
  expect(r.pos).toEqual({ left: '113px', top: '293px', transform: 'rotate(240deg)', klasse: true });
  expect(r.gleich).toBe(true);
  expect(r.liste).toEqual([{ id: 'sg_7', x: 130, y: 280, owner: 'p2', rest: 19 }]);
  expect(r.leer).toBe(0);
  expect(r.weg).toBe(true);
});

test('sniper.js baut keine Granaten-Elemente (Erzeugen ueber Anzeige.erzeuge)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(/sniper-granate/);
  expect(text).not.toMatch(/netzGranaten\b|const granaten\b/);
});

test('Haftmine: entsteht ueber Anzeige.erzeuge (sniperMine) ohne DOM-Element, wird ueber Anzeige.entferne abgeraeumt', async ({ page }) => {
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
  await page.keyboard.up('KeyW');
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const Sniper = await import('./js/sniper.js');
    const { state, arrays } = await import('./js/state.js');
    const domBackend = Anzeige.holeBackend();
    const erzeugt = [];
    const entfernt = [];
    state.selectedShipModel = 'sniper';
    try {
      Anzeige.setzeBackend({
        erzeuge(o, art) { if (art === 'sniperMine') erzeugt.push(art); },
        zeichneWelt() {}, zeichneSpieler() {}, entferne(o) { entfernt.push(o.id); }, blitze() {}, blitzeSpielfeld() {}
      });
      const kinderVorher = document.querySelectorAll('.sniper-mine').length;
      Sniper.haltenSchritt(state, 'p1', 10);
      const m = arrays.sniperMinen[0];
      const modell = { pKey: m.pKey, haftet: m.haftet, blinkt: m.blinkt, el: m.el };
      const kinder = document.querySelectorAll('.sniper-mine').length - kinderVorher;
      m.rest = 61;
      Sniper.aktualisiereSniper(state, 'p1', false);
      const blinkt = m.blinkt;
      Sniper.aktualisiereSniper(state, 'p1', false);
      return { erzeugt, modell, kinder, blinkt, blinktSpaeter: m.blinkt, id: m.id, entfernt, laenge: arrays.sniperMinen.length };
    } finally {
      Anzeige.setzeBackend(domBackend);
      state.selectedShipModel = 'viper';
      arrays.sniperMinen.length = 0;
    }
  });
  expect(r.erzeugt).toEqual(['sniperMine']);
  expect(r.modell).toEqual({ pKey: 'p1', haftet: false, blinkt: false, el: undefined });
  expect(r.kinder).toBe(0);
  expect(r.blinkt).toBe(true);
  expect(r.blinktSpaeter).toBe(true);
  expect(r.laenge).toBe(1);
});

test('Haftmine: Klassen haftet und blinkt kommen aus den Modellfeldern (DOM-Backend)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const { arrays } = await import('./js/state.js');
    try {
      const m = Anzeige.erzeuge({ id: 'sm_t', pKey: 'p2', x: 100, y: 200, rest: 300, haftet: false, blinkt: false }, 'sniperMine');
      arrays.sniperMinen.push(m);
      const lies = () => ({ klassen: [...m.el.classList].sort(), left: m.el.style.left, top: m.el.style.top });
      const frei = lies();
      m.blinkt = true;
      m.x = 150;
      Anzeige.zeichneWelt();
      const blinkend = lies();
      m.blinkt = false;
      m.haftet = true;
      Anzeige.zeichneWelt();
      const haftend = lies();
      Anzeige.entferne(m);
      return { frei, blinkend, haftend, weg: !m.el.isConnected };
    } finally {
      arrays.sniperMinen.length = 0;
    }
  });
  expect(r.frei).toEqual({ klassen: ['sniper-mine', 'sniper-mine-p2'], left: '94px', top: '194px' });
  expect(r.blinkend).toEqual({ klassen: ['blinkt', 'sniper-mine', 'sniper-mine-p2'], left: '144px', top: '194px' });
  expect(r.haftend.klassen).toEqual(['haftet', 'sniper-mine', 'sniper-mine-p2']);
  expect(r.weg).toBe(true);
});

test('Online-Client baut aus dem Snapshot-Listeneintrag ein Minen-Modell in arrays.sniperMinen', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Sniper = await import('./js/sniper.js');
    const { arrays } = await import('./js/state.js');
    try {
      Sniper.synchronisiereMinen([{ id: 'sm_7', x: 120, y: 300, owner: 'p2', haftet: false, zuender: 0, rest: 50, blinkt: true }]);
      const m = arrays.sniperMinen[0];
      const modell = { id: m.id, pKey: m.pKey, x: m.x, y: m.y, rest: m.rest, haftet: m.haftet, blinkt: m.blinkt };
      const el = m.el;
      const klassen = [...el.classList].sort();
      Sniper.synchronisiereMinen([{ id: 'sm_7', x: 130, y: 280, owner: 'p2', haftet: true, zuender: 20, rest: 49, blinkt: false }]);
      const gleich = arrays.sniperMinen[0] === m && m.x === 130 && m.haftet === true && m.blinkt === false;
      Sniper.synchronisiereMinen([]);
      return { modell, klassen, gleich, leer: arrays.sniperMinen.length, weg: !el.isConnected };
    } finally {
      arrays.sniperMinen.length = 0;
    }
  });
  expect(r.modell).toEqual({ id: 'sm_7', pKey: 'p2', x: 120, y: 300, rest: 50, haftet: false, blinkt: true });
  expect(r.klassen).toEqual(['blinkt', 'sniper-mine', 'sniper-mine-p2']);
  expect(r.gleich).toBe(true);
  expect(r.leer).toBe(0);
  expect(r.weg).toBe(true);
});

test('sniper.js baut keine Minen-Elemente (Erzeugen ueber Anzeige.erzeuge)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(/sniper-mine'|netzMinen\b|zeigeMine\b/);
});

test('Fadenkreuz und Ladering kommen aus den Zustandsfeldern (DOM-Backend), verschwinden bei isDead', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const { state, arrays } = await import('./js/state.js');
    const alt = { modell: state.selectedShipModel, lauf: state.spielLaeuft, stufe: state.laserStufe, tot: state.isDead, farbe: state.selectedShipColor };
    try {
      state.selectedShipModel = 'sniper';
      state.selectedShipColor = 'red';
      state.spielLaeuft = true;
      state.isDead = false;
      state.laserStufe = 3;
      state.sniperZielX = 200;
      state.sniperZielY = 100;
      state.sniperGehalten = false;
      state.sniperLadung = 0;
      Anzeige.zeichneWelt();
      const lies = () => {
        const el = document.querySelector('.sniper-fadenkreuz-p1');
        if (!el) return null;
        const ring = el.querySelector('.sniper-ladering');
        return {
          left: el.style.left, top: el.style.top, breite: el.style.width, striche: el.querySelectorAll('i.sniper-strich').length,
          ring: ring ? { anzeige: ring.style.display, breite: ring.style.width, voll: ring.classList.contains('voll') } : null
        };
      };
      const grund = lies();
      const anzahl = document.querySelectorAll('.sniper-fadenkreuz').length;
      state.sniperGehalten = true;
      state.sniperLadung = 45;
      Anzeige.zeichneWelt();
      const laden = lies();
      state.sniperLadung = 90;
      Anzeige.zeichneWelt();
      const voll = lies();
      state.sniperZielX = 250;
      Anzeige.zeichneWelt();
      const verschoben = lies();
      state.isDead = true;
      Anzeige.zeichneWelt();
      const tot = lies();
      state.isDead = false;
      Anzeige.zeichneWelt();
      const wieder = lies();
      state.sniperZielX = null;
      Anzeige.zeichneWelt();
      const ohneZiel = lies();
      state.sniperZielX = 200;
      state.selectedShipModel = 'viper';
      Anzeige.zeichneWelt();
      const keinSniper = lies();
      return { grund, anzahl, laden, voll, verschoben, tot, wieder, ohneZiel, keinSniper };
    } finally {
      state.selectedShipModel = alt.modell;
      state.selectedShipColor = alt.farbe;
      state.spielLaeuft = alt.lauf;
      state.laserStufe = alt.stufe;
      state.isDead = alt.tot;
      state.sniperZielX = null;
      state.sniperZielY = null;
      state.sniperGehalten = false;
      state.sniperLadung = 0;
      document.querySelectorAll('.sniper-fadenkreuz').forEach(e => e.remove());
    }
  });
  expect(r.grund).toEqual({ left: '178px', top: '78px', breite: '44px', striche: 4, ring: { anzeige: 'none', breite: '', voll: false } });
  expect(r.anzahl).toBe(1);
  expect(r.laden.ring.anzeige).toBe('block');
  expect(r.laden.ring.voll).toBe(false);
  expect(parseFloat(r.laden.ring.breite)).toBeCloseTo(44 * (1 + 0.5 * 0.5), 5);
  expect(r.voll.ring.voll).toBe(true);
  expect(parseFloat(r.voll.ring.breite)).toBeCloseTo(66, 5);
  expect(r.verschoben.left).toBe('228px');
  expect(r.tot).toBeNull();
  expect(r.wieder).not.toBeNull();
  expect(r.ohneZiel).toBeNull();
  expect(r.keinSniper).toBeNull();
});

test('sniper.js fasst das DOM nicht an (kein createElement, kein dom.spielfeld, kein isConnected, kein el.remove)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'sniper.js'), 'utf8');
  expect(text).not.toMatch(/createElement|dom.spielfeld|isConnected|.el.remove|fadenkreuze|holeFadenkreuz|zeigeFadenkreuz|entferneFadenkreuz/);
});

test('Gleve-Klinge kommt aus den Zustandsfeldern (DOM-Backend), verschwindet bei Sweep-Ende und isDead', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const Gleve = await import('./js/gleve.js');
    const { state } = await import('./js/state.js');
    const alt = { modell: state.selectedShipModel, farbe: state.selectedShipColor, tot: state.isDead, stufe: state.laserStufe, x: state.x, y: state.y };
    try {
      state.selectedShipModel = 'gleve';
      state.selectedShipColor = 'red';
      state.isDead = false;
      state.laserStufe = 3;
      state.x = 100;
      state.y = 400;
      state.gleveSweepTimer = 5;
      state.gleveSweepWinkel = -18;
      state.gleveSweepRichtung = 1;
      Anzeige.zeichneWelt();
      const lies = () => {
        const el = document.querySelector('.gleve-klinge');
        return el ? { anzahl: document.querySelectorAll('.gleve-klinge').length, hoehe: el.style.height, left: el.style.left, top: el.style.top, transform: el.style.transform, radius: el.style.borderRadius } : null;
      };
      const laenge = Gleve.sweepLaenge(state);
      const o = Gleve.sweepUrsprung(state);
      const aktiv = lies();
      state.gleveSweepRichtung = -1;
      state.gleveSweepWinkel = 30;
      Anzeige.zeichneWelt();
      const umgekehrt = lies();
      state.isDead = true;
      Anzeige.zeichneWelt();
      const tot = lies();
      state.isDead = false;
      Anzeige.zeichneWelt();
      const wieder = lies();
      state.gleveSweepTimer = 0;
      Anzeige.zeichneWelt();
      const ende = lies();
      state.gleveSweepTimer = 5;
      state.selectedShipModel = 'viper';
      Anzeige.zeichneWelt();
      const keineGleve = lies();
      return { laenge, o, aktiv, umgekehrt, tot, wieder, ende, keineGleve };
    } finally {
      state.selectedShipModel = alt.modell;
      state.selectedShipColor = alt.farbe;
      state.isDead = alt.tot;
      state.laserStufe = alt.stufe;
      state.x = alt.x;
      state.y = alt.y;
      state.gleveSweepTimer = 0;
      document.querySelectorAll('.gleve-klinge').forEach(e => e.remove());
    }
  });
  expect(r.aktiv.anzahl).toBe(1);
  expect(r.aktiv.hoehe).toBe(r.laenge + 'px');
  expect(r.aktiv.left).toBe((r.o.x - 2) + 'px');
  expect(r.aktiv.top).toBe((r.o.y - r.laenge) + 'px');
  expect(r.aktiv.transform).toBe('rotate(-18deg)');
  // Richtung +1: Rundung oben rechts, Richtung -1: oben links (Browser serialisiert die Kurzform)
  expect(r.aktiv.radius).toMatch(/^0px 100% 0px 0px/);
  expect(r.umgekehrt.transform).toBe('rotate(30deg)');
  expect(r.umgekehrt.radius).toMatch(/^100% 0px 0px/);
  expect(r.tot).toBeNull();
  expect(r.wieder).not.toBeNull();
  expect(r.ende).toBeNull();
  expect(r.keineGleve).toBeNull();
});

test('gleve.js legt keine Klinge im DOM an (kein gleve-klinge, kein dom.spielfeld, kein isConnected, kein el.remove)', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'gleve.js'), 'utf8');
  // createElement bleibt nur fuer die HUD-Punkte der Dash-Ladungen (zeigeLadungenHud) erlaubt
  expect((text.match(/createElement/g) || []).length).toBe(1);
  expect(text).toMatch(/const punkt = document\.createElement/);
  expect(text).not.toMatch(/gleve-klinge|dom\.spielfeld|isConnected|\.el\.remove|zeigeKlinge|entferneKlinge|klingen\[/);
});

test('Spielertreffer und Powerup melden den Bildschirm-Blitz (Farbe, Dauer) an die Anzeige, ohne dass die Logik das Spielfeld anfasst', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays, state, dom } = await import('./js/state.js');
    const Anzeige = await import('./js/anzeige.js');
    const Utils = await import('./js/utils.js');
    const Entities = await import('./js/entities.js');
    const Powerups = await import('./js/powerups.js');
    state.level = 1;
    state.isDead = false;
    state.invulnerableTimer = 0;
    state.schildStufe = 0;
    state.leben = 5;
    const domBackend = Anzeige.holeBackend();
    const blitze = [];
    const vorher = dom.spielfeld.style.backgroundColor;
    Anzeige.setzeBackend({ ...domBackend, blitzeSpielfeld(farbe, ms) { blitze.push([farbe, ms]); } });
    try {
      Utils.spielerGetroffen({ x: 0, y: 0, el: document.createElement('div') }, false);
      state.invulnerableTimer = 0;
      state.schildStufe = 1;
      Utils.spielerGetroffen({ x: 0, y: 0, el: document.createElement('div') }, false);
      Entities.erzeugePowerup(state.x, state.y, 'laserWaffe', 'p1');
      const p = arrays.powerups[arrays.powerups.length - 1];
      p.x = state.x; p.y = state.y; p.vy = 0;
      Powerups.aktualisierePowerups();
      return { blitze, farbe: p.farbe, vorher, nachher: dom.spielfeld.style.backgroundColor };
    } finally {
      Anzeige.setzeBackend(domBackend);
    }
  });
  expect(r.blitze[0]).toEqual(['#900', 150]);
  expect(r.blitze[1]).toEqual(['rgba(52, 152, 219, 0.3)', 150]);
  expect(r.blitze[2]).toEqual([r.farbe, 100]);
  expect(r.blitze.length).toBe(3);
  expect(r.nachher).toBe(r.vorher);
});

test('Logik setzt den Spielfeld-Hintergrund nicht selbst (utils, powerups, network: kein spielfeld.style.backgroundColor)', () => {
  for (const datei of ['utils', 'powerups', 'network']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', datei + '.js'), 'utf8');
    expect(text, datei).not.toMatch(/spielfeld\.style\.backgroundColor/);
  }
});

// Globaler Waechter: Diese Module bauen nichts im Spielfeld und fragen das DOM nicht nach ihren Elementen.
// Einzige Ausnahme: gleve.js baut in zeigeLadungenHud die HUD-Punkte (.dash-ladung) per createElement in den
// HUD-Container #dash-ladungen. Der liegt ausserhalb von #spielfeld und bleibt bewusst HTML.
test('Spiellogik-Module enthalten kein document.createElement, kein dom.spielfeld und kein isConnected', () => {
  const module = ['gegner', 'boss', 'waffen', 'powerups', 'partikel', 'gleve', 'sniper', 'viper', 'hack', 'entities', 'spieler', 'client', 'loop', 'effekte'];
  for (const datei of module) {
    let text = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', datei + '.js'), 'utf8');
    if (datei === 'gleve') text = text.replace(/const punkt = document\.createElement\('div'\);/, '');
    expect(text, datei).not.toMatch(/document\.createElement|dom\.spielfeld|\.isConnected/);
  }
});

test('Sterne entstehen ueber die Anzeige (Art stern, Modell mit groesse statt Element-Styles)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { arrays } = await import('./js/state.js');
    const Anzeige = await import('./js/anzeige.js');
    Anzeige.zeichneWelt();
    const s = arrays.sterne[0];
    return {
      anzahl: arrays.sterne.length,
      groesse: typeof s.groesse,
      breite: s.el.style.width,
      klasse: s.el.className,
      links: Math.abs(parseFloat(s.el.style.left) - s.x) < 0.001
    };
  });
  expect(r.anzahl).toBe(60);
  expect(r.groesse).toBe('number');
  expect(r.klasse).toBe('stern');
  expect(r.links).toBe(true);
  expect(r.breite).toMatch(/px$/);
});

test('Null-Backend: Coop mit Bot, Gleve gegen Boss, Bomben, Granaten, Minen und Raketen laufen ohne Fehler und ohne neue Kinder in #spielfeld', async ({ page }) => {
  const fehler = [];
  page.on('pageerror', e => fehler.push(e.message));
  const r = await page.evaluate(async () => {
    const Anzeige = await import('./js/anzeige.js');
    const Sniper = await import('./js/sniper.js');
    const { simulationsSchritt } = await import('./js/loop.js');
    const { state, arrays } = await import('./js/state.js');
    const Entities = await import('./js/entities.js');
    const Utils = await import('./js/utils.js');
    Utils.setGameMode('coop');
    state.selectedShipModel = 'gleve';
    state.p2.selectedShipModel = 'sniper';
    state.p2IsBot = true;
    state.level = 3;
    state.godMode = true;
    state.spielLaeuft = true;
    Sniper.setzeZurueck(state.p2);
    Sniper.setzeGranatenLadungenVoll(state.p2);
    const vorher = document.getElementById('spielfeld').children.length;
    const domBackend = Anzeige.holeBackend();
    const f = () => {};
    Anzeige.setzeBackend({ erzeuge: f, zeichneWelt: f, zeichneSpieler: f, entferne: f, blitze: f, blitzeSpielfeld: f });
    const gesehen = { effekt: 0, granate: 0, mine: 0, rakete: 0 };
    try {
      state.tastenGedrueckt.l = true;
      state.tastenGedrueckt.k = true;
      state.tastenGedrueckt[' '] = true;
      for (let i = 0; i < 600; i++) {
        if (i === 20) Entities.erzeugeBoss();
        if (i === 40) Utils.erzeugeBombenDetonation(200, 200, '#f39c12', 150, 3, false);
        if (i === 60) Utils.erzeugeRaketenDetonation(300, 200, 70);
        if (i === 80) Sniper.werfeGranate(state.p2, 'p2');
        if (i < 12) Sniper.haltenSchritt(state.p2, 'p2', 10 + i);
        if (i === 140) Sniper.loeseEmpAus(state.p2, 'p2');
        simulationsSchritt();
        gesehen.effekt = Math.max(gesehen.effekt, arrays.effekte.length);
        gesehen.granate = Math.max(gesehen.granate, arrays.sniperGranaten.length);
        gesehen.mine = Math.max(gesehen.mine, arrays.sniperMinen.length);
        gesehen.rakete = Math.max(gesehen.rakete, arrays.raketenArray.length);
      }
      return { vorher, nachher: document.getElementById('spielfeld').children.length, gesehen, boss: arrays.bosses.length };
    } finally {
      state.tastenGedrueckt.l = false;
      state.tastenGedrueckt.k = false;
      state.tastenGedrueckt[' '] = false;
      Anzeige.setzeBackend(domBackend);
    }
  });
  expect(fehler).toEqual([]);
  expect(r.nachher).toBe(r.vorher);
  expect(r.gesehen.effekt).toBeGreaterThan(0);
  expect(r.gesehen.granate).toBeGreaterThan(0);
  expect(r.gesehen.mine).toBeGreaterThan(0);
});
