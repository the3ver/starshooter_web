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

// Ermittelt, welchen Spieler naechsterSpieler() fuer die Positionen liefert
async function waehleSpieler(page, opts) {
  return page.evaluate(async (o) => {
    const { state } = await import('./js/state.js');
    const { naechsterSpieler, naechsterSpielerMitte } = await import('./js/gegner.js');
    state.gameMode = o.modus;
    state.isDead = !!o.p1Tot;
    state.x = o.p1[0]; state.y = o.p1[1];
    state.p2.x = o.p2[0]; state.p2.y = o.p2[1];
    state.p2.isDead = !!o.p2Tot;
    const ziel = naechsterSpieler(o.ref[0], o.ref[1]);
    const mitte = naechsterSpielerMitte({ x: o.ref[0], y: o.ref[1] });
    return { wer: ziel === state ? 'p1' : (ziel === state.p2 ? 'p2' : '?'), mitte };
  }, opts);
}

test.describe('naechsterSpieler', () => {
  test('Einzelspieler liefert immer P1, auch wenn P2 naeher waere', async ({ page }) => {
    const r = await waehleSpieler(page, { modus: 'single', p1: [300, 500], p2: [100, 100], ref: [100, 100] });
    expect(r.wer).toBe('p1');
  });

  test('Coop: naeherer P2 wird gewaehlt', async ({ page }) => {
    const r = await waehleSpieler(page, { modus: 'coop', p1: [300, 500], p2: [100, 100], ref: [110, 90] });
    expect(r.wer).toBe('p2');
  });

  test('Online zaehlt als Coop', async ({ page }) => {
    const r = await waehleSpieler(page, { modus: 'online', p1: [300, 500], p2: [100, 100], ref: [110, 90] });
    expect(r.wer).toBe('p2');
  });

  test('Coop: toter P1 fuehrt zu P2, auch wenn P1 naeher ist', async ({ page }) => {
    const r = await waehleSpieler(page, { modus: 'coop', p1: [100, 100], p2: [400, 500], ref: [100, 100], p1Tot: true });
    expect(r.wer).toBe('p2');
  });

  test('Coop: toter P2 wird nie gewaehlt', async ({ page }) => {
    const r = await waehleSpieler(page, { modus: 'coop', p1: [400, 500], p2: [100, 100], ref: [100, 100], p2Tot: true });
    expect(r.wer).toBe('p1');
  });

  test('Coop: gleicher Abstand behaelt P1', async ({ page }) => {
    const r = await waehleSpieler(page, { modus: 'coop', p1: [100, 200], p2: [300, 200], ref: [200, 50] });
    expect(r.wer).toBe('p1');
  });

  test('Abstand zaehlt von Spieler-Ecke zum Referenzpunkt, Mitte liefert Schiffsmitte', async ({ page }) => {
    const h = await page.evaluate(async () => (await import('./js/state.js')).config.spielerGroesse / 2);
    // Von der Spieler-Mitte aus waere P2 naeher, von der Spieler-Ecke aus ist P1 naeher
    const r = await waehleSpieler(page, { modus: 'coop', p1: [100, 100], p2: [100 - 2 * h - 2, 100], ref: [100 - h, 100] });
    expect(r.wer).toBe('p1');
    expect(r.mitte).toEqual({ x: 100 + h, y: 100 + h });
    // Gegenprobe: P2 knapp naeher an der Ecke
    const r2 = await waehleSpieler(page, { modus: 'coop', p1: [100, 100], p2: [100 - 2 * h + 2, 100], ref: [100 - h, 100] });
    expect(r2.wer).toBe('p2');
    expect(r2.mitte).toEqual({ x: 100 - 2 * h + 2 + h, y: 100 + h });
  });
});


// Struktur eines Anzeige-Containers: Kindelemente mit Klassen und sichtbarem Text (ohne Farben/Styles)
async function uiVerlauf(page) {
  return page.evaluate(async () => {
    const { state, dom } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const struktur = (el) => Array.from(el.children).map(c => ({ cls: c.className.trim().split(/\s+/).sort(), text: c.textContent, titel: c.getAttribute('title') }));
    const normal = (el) => el.innerHTML.replace(/ (style|title)="[^"]*"/g, '');
    const lese = (p1, p2) => ({
      p1: { leben: struktur(dom.lebenAnzeige), leben_n: normal(dom.lebenAnzeige), pu: struktur(dom.aktivePowerupsContainer), pu_n: normal(dom.aktivePowerupsContainer), marker: dom.maxEnergieMarker.style.left, hud: [dom.splitterHudP1.style.display, dom.splitterRotCountP1.textContent, dom.splitterWeissCountP1.textContent] },
      p2: { leben: struktur(dom.lebenAnzeigeP2), leben_n: normal(dom.lebenAnzeigeP2), pu: struktur(dom.aktivePowerupsContainerP2), pu_n: normal(dom.aktivePowerupsContainerP2), marker: dom.maxEnergieMarkerP2.style.left, hud: [dom.splitterHudP2.style.display, dom.splitterRotCountP2.textContent, dom.splitterWeissCountP2.textContent] },
      erwMarker: [p1.maxEnergie / p1.absMaxEnergie * 100 + '%', p2.maxEnergie / p2.absMaxEnergie * 100 + '%']
    });
    const alle = () => {
      Utils.updateLebenUI(); Utils.updateLebenP2UI();
      Utils.updateAktivePowerupsUI(); Utils.updateAktivePowerupsP2UI();
      Utils.updateMaxEnergieMarker(); Utils.updateMaxEnergieMarkerP2();
      Utils.updateSplitterUI(); Utils.updateSplitterP2UI();
    };
    const p1 = state, p2 = state.p2;
    // Beide Spieler bekommen in jedem Schritt exakt denselben Zustand
    const setze = (z) => {
      for (const s of [p1, p2]) Object.assign(s, z);
    };
    const log = [];
    state.gameMode = 'coop';
    setze({ leben: 3, laserStufe: 1, raketenStufe: 1, bombenStufe: 1, laserDurchschlag: false, autolaserAktiv: false, schildStufe: 0, selectedShipModel: 'viper', maxEnergie: 50, splitterRot: 0, splitterWeiss: 0, phantomSchildRegenTimer: 0 });
    alle(); log.push(lese(p1, p2));

    setze({ leben: 1, laserStufe: 3, raketenStufe: 5, bombenStufe: 2, laserDurchschlag: true, autolaserAktiv: true, schildStufe: 2, maxEnergie: 75, splitterRot: 4, splitterWeiss: 7 });
    alle(); log.push(lese(p1, p2));

    setze({ leben: 4, laserStufe: 5, raketenStufe: 2, bombenStufe: 1, laserDurchschlag: false, autolaserAktiv: false, schildStufe: 0, selectedShipModel: 'phantom', phantomSchildRegenTimer: 300, phantomSchildRegenMax: 600 });
    alle(); log.push(lese(p1, p2));

    state.gameMode = 'single';
    setze({ selectedShipModel: 'viper', splitterRot: 0, splitterWeiss: 0, phantomSchildRegenTimer: 0 });
    alle(); log.push(lese(p1, p2));
    return log;
  });
}

test('P1/P2-UI-Funktionen zeigen Leben, Powerup-Stufen, Marker und Splitter-HUD fuer beide Spieler gleich', async ({ page }) => {
  const [start, s1, s2, s3] = await uiVerlauf(page);
  const aktiv = (liste) => liste.filter(e => !e.cls.includes('pu-anim-lost'));
  const verloren = (liste) => liste.filter(e => e.cls.includes('pu-anim-lost'));
  const texte = (liste) => liste.map(e => e.text);

  for (const k of ['p1', 'p2']) {
    // Start: 3 Herzen, keine Powerup-Icons, kein Splitter-HUD ohne Splitter
    expect(start[k].leben.length).toBe(3);
    expect(start[k].pu).toEqual([]);

    // Schritt 1: Leben 1 (2 Verlust-Herzen), alle Powerups mit Stufen-Text in fester Reihenfolge
    expect(aktiv(s1[k].leben).length).toBe(1);
    expect(verloren(s1[k].leben).length).toBe(2);
    expect(texte(aktiv(s1[k].pu))).toEqual(['L3', 'R5', 'B2', '↑', 'O2', 'A']);
    expect(aktiv(s1[k].pu).every(e => e.cls.includes('active-pu-icon') && e.cls.includes('pu-anim-new'))).toBe(true);
    expect(s1[k].hud).toEqual(['flex', '4', '7']);

    // Schritt 2: mehr Leben, Upgrade/Downgrade/Verlust, Phantom-Schild laedt auf
    expect(aktiv(s2[k].leben).length).toBe(4);
    expect(s2[k].pu.find(e => e.text === 'L5').cls).toContain('pu-anim-upgrade');
    expect(s2[k].pu.find(e => e.text === 'R2').cls).toContain('pu-anim-downgrade');
    const schild = s2[k].pu.find(e => e.cls.includes('pu-recharging-shield'));
    expect(schild.text).toBe('O1');
    expect(schild.titel).toMatch(/\d+%/);
    expect(texte(verloren(s2[k].pu)).sort()).toEqual(['A', 'B2', '↑'].sort());
    expect(s2[k].hud[0]).toBe('none'); // Phantom hat kein Splitter-HUD

    // Schritt 3: unveraenderte Lebenszahl, keine neuen Icons
    expect(aktiv(s3[k].leben).length).toBe(4);
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
    expect(s.p2.leben_n).toBe(s.p1.leben_n);
    expect(s.p2.pu_n).toBe(s.p1.pu_n);
    expect(s.p2.hud).toEqual(s.p1.hud);
    expect(s.p2.marker).toBe(s.p1.marker);
  }
});

// Bewegung und Energie fachlich pruefen: Richtung/Betrag aus dem Schiffsmodell, Randbegrenzung, Regeneration
async function spielerVerhalten(page, modell) {
  return page.evaluate(async (m) => {
    const { state, config, arrays } = await import('./js/state.js');
    const Spieler = await import('./js/spieler.js');
    const mod = window.__game.shipModels[m];
    const t = state.tastenGedrueckt;
    state.gameMode = 'coop'; state.p2IsBot = false; state.isDead = false; state.p2.isDead = false;
    state.unbegrenzteEnergie = false; state.p2.unbegrenzteEnergie = false;
    arrays.powerups.length = 0;
    const spieler = {
      p1: { s: state, tasten: { links: 'a', rechts: 'd', oben: 'w', unten: 's', feuer: 'b' } },
      p2: { s: state.p2, tasten: { links: 'arrowleft', rechts: 'arrowright', oben: 'arrowup', unten: 'arrowdown', feuer: 'ä' } }
    };
    state.selectedShipModel = m; state.p2.selectedShipModel = m;
    const maxX = config.spielfeldBreite - config.spielerGroesse;
    const maxY = config.spielfeldHoehe - config.spielerGroesse;
    const schritt = (taste) => {
      Object.keys(t).forEach(k => { t[k] = false; });
      if (taste) t[taste] = true;
      Spieler.bewegeSpieler();
      Spieler.aktualisiereEnergie();
    };
    const setzePos = (s, x, y) => { s.x = x; s.y = y; s.prevX = x; s.prevY = y; };
    const out = { speed: mod.speed, regen: mod.energyRegen, maxX, maxY };
    for (const [name, { s, tasten }] of Object.entries(spieler)) {
      const r = {};
      for (const richtung of ['links', 'rechts', 'oben', 'unten']) {
        setzePos(state, 300, 300); setzePos(state.p2, 300, 300);
        schritt(tasten[richtung]);
        r[richtung] = { dx: s.x - 300, dy: s.y - 300 };
      }
      setzePos(s, 300, 300); schritt(null); r.ruhe = { dx: s.x - 300, dy: s.y - 300 };
      // Randbegrenzung
      setzePos(s, 1, 1); schritt(tasten.links); r.randLinks = s.x;
      setzePos(s, 1, 1); schritt(tasten.oben); r.randOben = s.y;
      setzePos(s, maxX - 1, 300); schritt(tasten.rechts); r.randRechts = s.x;
      setzePos(s, 300, maxY - 1); schritt(tasten.unten); r.randUnten = s.y;
      // Energie: Feuern verbraucht, Nicht-Feuern laedt um energyRegen
      s.maxEnergie = 100; s.laserStufe = 1; s.laserSchiesst = false;
      s.energie = 50; setzePos(s, 300, 300);
      schritt(tasten.feuer); r.feuer = { vorher: 50, nachher: s.energie, schiesst: s.laserSchiesst };
      s.energie = 20; s.laserSchiesst = false; schritt(null); r.regen = { vorher: 20, nachher: s.energie, schiesst: s.laserSchiesst };
      s.energie = s.maxEnergie; schritt(null); r.voll = s.energie;
      out[name] = r;
    }
    return out;
  }, modell);
}

for (const modell of ['viper', 'phantom']) {
  test(`bewegeSpieler/aktualisiereEnergie: Richtung, Randbegrenzung und Energie fuer P1 und P2 (${modell})`, async ({ page }) => {
    const o = await spielerVerhalten(page, modell);
    expect(o.speed).toBeGreaterThan(0);
    for (const k of ['p1', 'p2']) {
      const r = o[k];
      // Bewegung: richtige Richtung um die Geschwindigkeit des Schiffsmodells
      expect(r.links.dx).toBeCloseTo(-o.speed, 5); expect(r.links.dy).toBeCloseTo(0, 5);
      expect(r.rechts.dx).toBeCloseTo(o.speed, 5); expect(r.rechts.dy).toBeCloseTo(0, 5);
      expect(r.oben.dy).toBeCloseTo(-o.speed, 5); expect(r.oben.dx).toBeCloseTo(0, 5);
      expect(r.unten.dy).toBeCloseTo(o.speed, 5); expect(r.unten.dx).toBeCloseTo(0, 5);
      expect(r.ruhe.dx).toBeCloseTo(0, 5); expect(r.ruhe.dy).toBeCloseTo(0, 5);
      // Randbegrenzung
      expect(r.randLinks).toBe(0);
      expect(r.randOben).toBe(0);
      expect(r.randRechts).toBeCloseTo(o.maxX, 5);
      expect(r.randUnten).toBeCloseTo(o.maxY, 5);
      // Energie
      expect(r.feuer.schiesst).toBe(true);
      expect(r.feuer.nachher).toBeLessThan(r.feuer.vorher);
      expect(r.regen.schiesst).toBe(false);
      expect(r.regen.nachher).toBeCloseTo(r.regen.vorher + o.regen, 5);
      expect(r.voll).toBeCloseTo(100, 5); // nie ueber maxEnergie
    }
    // P1 und P2 verhalten sich gleich
    expect(o.p2.feuer.nachher).toBeCloseTo(o.p1.feuer.nachher, 5);
    expect(o.p2.regen.nachher).toBeCloseTo(o.p1.regen.nachher, 5);
  });
}
