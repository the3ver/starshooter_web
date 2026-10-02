const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.7.1');
    localStorage.setItem('starshooter_skip_cutscene', 'true');
  });
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

// Vor dem Zusammenlegen der P1/P2-Funktionen mit dem alten Code aufgezeichnet
const ERWARTETER_UI_VERLAUF = [
    {"tag": "start", "leben": "<span class=\"leben-herz \">♥</span><span class=\"leben-herz \">♥</span><span class=\"leben-herz \">♥</span>", "lebenP2": "<span class=\"leben-herz \" style=\"color: #3498db;\">♥</span><span class=\"leben-herz \" style=\"color: #3498db;\">♥</span><span class=\"leben-herz \" style=\"color: #3498db;\">♥</span>", "pu": "", "puP2": "<div class=\"active-pu-icon \" style=\"background:rgba(52,152,219,0.2); border:1px solid #3498db; color:#3498db;\">O1</div>", "marker": "50%", "markerP2": "50%", "splitter": ["flex", "0", "0"], "splitterP2": ["none", "0", "0"]},
    {"tag": "schritt1", "leben": "<span class=\"leben-herz \">♥</span><span class=\"leben-herz pu-anim-lost\">♥</span><span class=\"leben-herz pu-anim-lost\">♥</span>", "lebenP2": "<span class=\"leben-herz \" style=\"color: #3498db;\">♥</span><span class=\"leben-herz \" style=\"color: #3498db;\">♥</span><span class=\"leben-herz \" style=\"color: #3498db;\">♥</span><span class=\"leben-herz pu-anim-new\" style=\"color: #3498db;\">♥</span><span class=\"leben-herz pu-anim-new\" style=\"color: #3498db;\">♥</span>", "pu": "<div class=\"active-pu-icon pu-anim-new\" style=\"background:rgba(155,89,182,0.2); border:1px solid #9b59b6; color:#9b59b6;\">L3</div><div class=\"active-pu-icon pu-anim-new\" style=\"background:rgba(0,255,255,0.2); border:1px solid #00ffff; color:#00ffff;\">↑</div><div class=\"active-pu-icon pu-anim-new\" style=\"background:rgba(52,152,219,0.2); border:1px solid #3498db; color:#3498db;\">O2</div>", "puP2": "<div class=\"active-pu-icon pu-anim-new\" style=\"background:rgba(230,126,34,0.2); border:1px solid #f39c12; color:#f39c12;\">R5</div><div class=\"active-pu-icon pu-anim-new\" style=\"background:rgba(192,57,43,0.2); border:1px solid #c0392b; color:#c0392b;\">B2</div><div class=\"active-pu-icon pu-anim-new\" style=\"background:rgba(230,126,34,0.2); border:1px solid #e67e22; color:#e67e22;\">A</div><div class=\"active-pu-icon pu-anim-lost\" style=\"background:rgba(52,152,219,0.2); border:1px solid #3498db; color:#3498db;\">O1</div>", "marker": "75%", "markerP2": "30%", "splitter": ["flex", "4", "7"], "splitterP2": ["flex", "2", "1"]},
    {"tag": "schritt2", "leben": "<span class=\"leben-herz \">♥</span><span class=\"leben-herz pu-anim-new\">♥</span><span class=\"leben-herz pu-anim-new\">♥</span><span class=\"leben-herz pu-anim-new\">♥</span>", "lebenP2": "<span class=\"leben-herz \" style=\"color: #3498db;\">♥</span><span class=\"leben-herz \" style=\"color: #3498db;\">♥</span><span class=\"leben-herz pu-anim-lost\" style=\"color: #3498db;\">♥</span><span class=\"leben-herz pu-anim-lost\" style=\"color: #3498db;\">♥</span><span class=\"leben-herz pu-anim-lost\" style=\"color: #3498db;\">♥</span>", "pu": "<div class=\"active-pu-icon pu-anim-upgrade\" style=\"background:rgba(155,89,182,0.2); border:1px solid #e056fd; color:#e056fd;\">L5</div><div class=\"active-pu-icon pu-recharging-shield\" style=\"background: conic-gradient(#3498db 120deg, rgba(52,152,219,0.15) 0deg); border:1px solid #3498db; color:#3498db;\" title=\"Schild Stufe 1 lädt auf (33%)\">O1</div><div class=\"active-pu-icon pu-anim-lost\" style=\"background:rgba(0,255,255,0.2); border:1px solid #00ffff; color:#00ffff;\">↑</div>", "puP2": "<div class=\"active-pu-icon pu-anim-downgrade\" style=\"background:rgba(230,126,34,0.2); border:1px solid #e67e22; color:#e67e22;\">R2</div><div class=\"active-pu-icon pu-recharging-shield\" style=\"background: conic-gradient(#3498db 270deg, rgba(52,152,219,0.15) 0deg); border:1px solid #3498db; color:#3498db;\" title=\"Schild Stufe 1 lädt auf (75%)\">O1</div><div class=\"active-pu-icon pu-anim-lost\" style=\"background:rgba(192,57,43,0.2); border:1px solid #c0392b; color:#c0392b;\">B2</div><div class=\"active-pu-icon pu-anim-lost\" style=\"background:rgba(230,126,34,0.2); border:1px solid #e67e22; color:#e67e22;\">A</div>", "marker": "75%", "markerP2": "30%", "splitter": ["none", "4", "7"], "splitterP2": ["none", "2", "1"]},
    {"tag": "schritt3", "leben": "<span class=\"leben-herz \">♥</span><span class=\"leben-herz \">♥</span><span class=\"leben-herz \">♥</span><span class=\"leben-herz \">♥</span>", "lebenP2": "<span class=\"leben-herz \" style=\"color: #3498db;\">♥</span><span class=\"leben-herz \" style=\"color: #3498db;\">♥</span>", "pu": "<div class=\"active-pu-icon \" style=\"background:rgba(155,89,182,0.2); border:1px solid #e056fd; color:#e056fd;\">L5</div>", "puP2": "<div class=\"active-pu-icon \" style=\"background:rgba(230,126,34,0.2); border:1px solid #e67e22; color:#e67e22;\">R2</div>", "marker": "75%", "markerP2": "30%", "splitter": ["flex", "0", "0"], "splitterP2": ["none", "2", "1"]}
];

// Charakterisierung der P1/P2-UI-Funktionen: Ablauf mehrerer Zustaende, HTML wird mitgeschrieben
async function uiVerlauf(page) {
  return page.evaluate(async () => {
    const { state, dom } = await import('./js/state.js');
    const Utils = await import('./js/utils.js');
    const log = [];
    const lese = (tag) => log.push({
      tag,
      leben: dom.lebenAnzeige.innerHTML,
      lebenP2: dom.lebenAnzeigeP2.innerHTML,
      pu: dom.aktivePowerupsContainer.innerHTML,
      puP2: dom.aktivePowerupsContainerP2.innerHTML,
      marker: dom.maxEnergieMarker.style.left,
      markerP2: dom.maxEnergieMarkerP2.style.left,
      splitter: [dom.splitterHudP1.style.display, dom.splitterRotCountP1.textContent, dom.splitterWeissCountP1.textContent],
      splitterP2: [dom.splitterHudP2.style.display, dom.splitterRotCountP2.textContent, dom.splitterWeissCountP2.textContent]
    });
    const alle = () => {
      Utils.updateLebenUI(); Utils.updateLebenP2UI();
      Utils.updateAktivePowerupsUI(); Utils.updateAktivePowerupsP2UI();
      Utils.updateMaxEnergieMarker(); Utils.updateMaxEnergieMarkerP2();
      Utils.updateSplitterUI(); Utils.updateSplitterP2UI();
    };
    const p1 = state, p2 = state.p2;
    state.gameMode = 'coop';
    alle(); lese('start');

    // Leben: Verlust und Zugewinn; Powerups: Upgrade, neu, Boolean
    p1.leben = 1; p2.leben = 5;
    p1.laserStufe = 3; p2.raketenStufe = 5; p2.bombenStufe = 2;
    p1.laserDurchschlag = true; p2.autolaserAktiv = true;
    p1.schildStufe = 2; p2.schildStufe = 0;
    p1.maxEnergie = 75; p2.maxEnergie = 30;
    p1.splitterRot = 4; p1.splitterWeiss = 7; p2.splitterRot = 2; p2.splitterWeiss = 1;
    p2.selectedShipModel = 'viper';
    alle(); lese('schritt1');

    // Downgrade, Verlust von Boolean-Powerups, Phantom-Schild laedt
    p1.leben = 4; p2.leben = 2;
    p1.laserStufe = 5; p2.raketenStufe = 2; p2.bombenStufe = 1;
    p1.laserDurchschlag = false; p2.autolaserAktiv = false;
    p1.schildStufe = 0; p1.selectedShipModel = 'phantom'; p1.phantomSchildRegenTimer = 300;
    p2.schildStufe = 0; p2.selectedShipModel = 'phantom'; p2.phantomSchildRegenTimer = 450; p2.phantomSchildRegenMax = 600;
    alle(); lese('schritt2');

    // Einzelspieler: P2-Splitter verschwindet; P1 wieder Viper
    state.gameMode = 'single';
    p1.selectedShipModel = 'viper'; p2.selectedShipModel = 'viper';
    p1.splitterRot = 0; p1.splitterWeiss = 0;
    alle(); lese('schritt3');
    return log;
  });
}

test('P1/P2-UI-Funktionen erzeugen unveraendertes HTML (Charakterisierung)', async ({ page }) => {
  const log = await uiVerlauf(page);
  expect(log).toEqual(ERWARTETER_UI_VERLAUF);
});

// Mit dem alten spieler.js aufgezeichnet (Math.random fest vorgegeben)
const ERWARTETER_SPIELER_VERLAUF = [
  {"p1": [0, 0, -4, 6, 19.1, true], "p2": [303.8, 200, 3.8000000000000114, 0, 15.1, true], "el": ["0px", "0px", "rotate(-2.25deg)", "303.8px", "200px", "rotate(2.25deg)"], "flammen": ["scaleY(1.8)", "scaleY(1.8)", "scaleY(1)", "scaleY(1)"], "balken": ["19.1%", "rgb(26, 188, 156)", "15.1%", "rgb(52, 152, 219)"], "e": {"laserAktiv": true, "laserAktivP2": true}, "neu": [[13.4, 28, 0.2, 1.9, "rgb(231, 76, 60)"], [317.2, 228, 0.2, 1.5, "rgb(9, 132, 227)"]]},
  {"p1": [0, 6, 0, -6, 18.200000000000003, true], "p2": [300, 203.8, -3.8000000000000114, -3.8000000000000114, 14.2, true], "el": ["0px", "6px", "rotate(-4.1625deg)", "300px", "203.8px", "rotate(-0.3375deg)"], "flammen": ["scaleY(0.4)", "scaleY(0.4)", "scaleY(0.4)", "scaleY(0.4)"], "balken": ["18.2%", "rgb(26, 188, 156)", "14.2%", "rgb(52, 152, 219)"], "e": {"laserAktiv": true, "laserAktivP2": true}, "neu": []},
  {"p1": [6, 6, 6, 0, 18.700000000000003, false], "p2": [300, 200, 0, 3.8000000000000114, 14.6, false], "el": ["6px", "6px", "rotate(-1.28812deg)", "300px", "200px", "rotate(-0.286875deg)"], "flammen": ["scaleY(1)", "scaleY(1)", "scaleY(1.8)", "scaleY(1.8)"], "balken": ["18.7%", "rgb(26, 188, 156)", "14.6%", "rgb(230, 126, 34)"], "e": {"laserAktiv": false, "laserAktivP2": false}, "neu": [[19.4, 34, 0.2, 1.5, "rgb(231, 76, 60)"], [313.4, 228, 0.2, 1.9, "rgb(9, 132, 227)"]]},
  {"p1": [6, 6, 0, 0, 19.200000000000003, false], "p2": [300, 200, 0, 0, 15, false], "el": ["6px", "6px", "rotate(-1.09491deg)", "300px", "200px", "rotate(-0.243844deg)"], "flammen": ["scaleY(1)", "scaleY(1)", "scaleY(1)", "scaleY(1)"], "balken": ["19.2%", "rgb(26, 188, 156)", "15%", "rgb(52, 152, 219)"], "e": {"laserAktiv": false, "laserAktivP2": false}, "neu": [[19.4, 34, 0.2, 1.5, "rgb(231, 76, 60)"], [313.4, 228, 0.2, 1.5, "rgb(9, 132, 227)"]]}
];

// Charakterisierung von bewegeSpieler/aktualisiereEnergie fuer P1 und P2 (lokaler Coop)
async function spielerVerlauf(page) {
  return page.evaluate(async () => {
    const { state, dom, arrays } = await import('./js/state.js');
    const Spieler = await import('./js/spieler.js');
    const origRandom = Math.random;
    let zz = 0;
    Math.random = () => [0.1, 0.7, 0.3, 0.9, 0.5][zz++ % 5];
    try {
      state.gameMode = 'coop';
      state.p2IsBot = false;
      state.isDead = false;
      state.p2.isDead = false;
      state.x = 4; state.y = 6; state.prevX = 4; state.prevY = 6;
      state.p2.x = 300; state.p2.y = 200; state.p2.prevX = 300; state.p2.prevY = 200;
      state.energie = 20; state.p2.energie = 16;
      const log = [];
      const t = state.tastenGedrueckt;
      const schritt = (tasten) => {
        Object.keys(t).forEach(k => { t[k] = false; });
        Object.assign(t, tasten);
        const vorher = arrays.partikelArray.length;
        Spieler.bewegeSpieler();
        const e = Spieler.aktualisiereEnergie();
        const neu = arrays.partikelArray.slice(vorher).map(p => [p.x, p.y, p.vx, p.vy, p.el.style.backgroundColor]);
        const fl = id => document.getElementById(id)?.style.transform;
        log.push({
          p1: [state.x, state.y, state.spielerVx, state.spielerVy, state.energie, state.laserSchiesst],
          p2: [state.p2.x, state.p2.y, state.p2.spielerVx, state.p2.spielerVy, state.p2.energie, state.p2.laserSchiesst],
          el: [dom.spieler.style.left, dom.spieler.style.top, dom.spieler.style.transform, dom.spieler2.style.left, dom.spieler2.style.top, dom.spieler2.style.transform],
          flammen: [fl('flame-left'), fl('flame-right'), fl('flame-left-p2'), fl('flame-right-p2')],
          balken: [dom.energieBalken.style.width, dom.energieBalken.style.backgroundColor, dom.energieBalkenP2.style.width, dom.energieBalkenP2.style.backgroundColor],
          e, neu
        });
      };
      schritt({ a: true, w: true, b: true, arrowright: true, 'ä': true });
      schritt({ a: true, s: true, b: true, arrowleft: true, arrowdown: true, 'ä': true });
      schritt({ d: true, arrowup: true });
      schritt({});
      return log;
    } finally {
      Math.random = origRandom;
    }
  });
}

test('bewegeSpieler/aktualisiereEnergie bleiben unveraendert (Charakterisierung)', async ({ page }) => {
  const log = await spielerVerlauf(page);
  expect(log).toEqual(ERWARTETER_SPIELER_VERLAUF);
});
