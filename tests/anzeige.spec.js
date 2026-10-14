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
      blitze() {},
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
    for (const b of [null, {}, { zeichneWelt: f, entferne: f, blitze: f }, { erzeuge: f, entferne: f, blitze: f },
      { erzeuge: f, zeichneWelt: f, blitze: f }, { erzeuge: f, zeichneWelt: f, entferne: f }]) {
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
    Anzeige.setzeBackend({ erzeuge(o, art) { erzeugt.push(art); }, zeichneWelt() {}, entferne() {}, blitze() {} });
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
