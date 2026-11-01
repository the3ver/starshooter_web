// Protokoll-Konsistenz: Die Feldform von serializeGameState() ist je PROTOKOLL_VERSION festgehalten
// (tests/fixtures/protokoll.json), und der Online-Client liest jedes gesendete Feld.
// Belege: wiederholte Online-Sync-Fixes (b024ce4, 1def39a, 3e326cc, f108641).
// Nach einer gewollten Formataenderung: PROTOKOLL_VERSION erhoehen, dann
//   PROTOKOLL_FIXTURE=1 npx playwright test tests/protokoll.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { setzeSpielstand } = require('./helfer');

const FIXTURE = path.join(__dirname, 'fixtures', 'protokoll.json');

// Felder, die der Host sendet, der Client aber bewusst nicht aus dem Snapshot liest.
// Ein neuer Eintrag braucht einen Grund; ein Feld, das kein Client braucht, besser nicht senden.
const NUR_GESENDET = {
  '.p2.x': 'Client sagt das eigene Schiff voraus',
  '.p2.y': 'Client sagt das eigene Schiff voraus',
  '.p2.rotate': 'Client berechnet die eigene Neigung',
  '.p2.gleveDashTimer': 'Client sagt den eigenen Dash voraus',
  '.p2.viperRolleRichtung': 'Client sagt die eigene Rolle voraus',
  '.p1.laserSchiesst': 'ungenutzt, Kandidat zum Entfernen',
  '.p2.laserSchiesst': 'ungenutzt, Kandidat zum Entfernen',
  '.bossAktiv': 'ungenutzt, Kandidat zum Entfernen',
  '.sniperMinen[].zuender': 'ungenutzt, Kandidat zum Entfernen',
  '.bossLaser[].width': 'ungenutzt, Kandidat zum Entfernen',
  '.bossLaser[].height': 'ungenutzt, Kandidat zum Entfernen',
};

// Jede Schiffsart einmal als P1 und als P2, damit alle schiffsabhaengigen Felder vorkommen
const SZENARIEN = [
  ['sniper', 'gleve'],
  ['gleve', 'viper'],
  ['viper', 'sniper'],
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] }),
    }),
  );
  await setzeSpielstand(page);
});

async function untersuche(page, p1, p2) {
  await page.goto('/');
  return page.evaluate(
    async ({ p1, p2 }) => {
      const Anzeige = await import('./js/anzeige.js');
      const { arrays, state } = await import('./js/state.js');
      const Network = await import('./js/network.js');
      const { PROTOKOLL_VERSION } = await import('./js/netzkodierung.js');
      Anzeige.setzeBackend({
        erzeuge() {},
        zeichneWelt() {},
        zeichneSpieler() {},
        entferne() {},
        blitze() {},
        blitzeSpielfeld() {},
      });

      // Host: in jeder Liste ein Objekt, alle bedingten Felder aktiv
      state.gameMode = 'coop';
      state.selectedShipModel = p1;
      state.p2.selectedShipModel = p2;
      state.laserDurchschlag = true;
      state.autolaserAktiv = true;
      state.bossWarningAktiv = true;
      state.p2.laserDurchschlag = true;
      state.p2.autolaserAktiv = true;
      for (const k of Object.keys(arrays)) {
        if (k !== 'sterne')
          arrays[k].push({
            id: k + '_1',
            x: 1,
            y: 1,
            betaeubt: 3,
            hp: 1,
            maxHp: 1,
            owner: 'p1',
            pKey: 'p1',
            rest: 5,
            stufe: 1,
            type: 'energy',
            form: null,
          });
      }
      const snapshot = Network.serializeGameState();

      const felder = new Set();
      const sammle = (wert, pfad) => {
        if (Array.isArray(wert)) {
          wert.forEach(e => sammle(e, pfad + '[]'));
          return;
        }
        if (wert && typeof wert === 'object')
          for (const k of Object.keys(wert)) {
            felder.add(pfad + '.' + k);
            sammle(wert[k], pfad + '.' + k);
          }
      };
      sammle(snapshot, '');

      // Client: Snapshot ueber einen Proxy uebernehmen und gelesene Felder mitschreiben
      const gelesen = new Set();
      const huelle = (wert, pfad) => {
        if (!wert || typeof wert !== 'object') return wert;
        const handler = {
          get(ziel, k) {
            if (typeof k === 'symbol') return ziel[k];
            const istListe = Array.isArray(ziel);
            if (istListe && !/^\d+$/.test(k))
              return typeof ziel[k] === 'function' ? ziel[k].bind(new Proxy(ziel, handler)) : ziel[k];
            const neuerPfad = istListe ? pfad + '[]' : pfad + '.' + k;
            if (!istListe) gelesen.add(neuerPfad);
            return huelle(ziel[k], neuerPfad);
          },
        };
        return new Proxy(wert, handler);
      };
      for (const k of Object.keys(arrays)) if (k !== 'sterne') arrays[k].length = 0;
      state.network = { isOnline: true, isHost: false, connected: true };
      state.gameMode = 'online';
      Network.applyGameStateSnapshot(huelle(snapshot, ''));

      return {
        version: PROTOKOLL_VERSION,
        felder: [...felder],
        nichtGelesen: [...felder].filter(f => !gelesen.has(f)),
      };
    },
    { p1, p2 },
  );
}

test('Snapshot-Format passt zur PROTOKOLL_VERSION, Client liest jedes gesendete Feld', async ({ page }) => {
  const felder = new Set();
  const nichtGelesen = new Set();
  let version;
  for (const [p1, p2] of SZENARIEN) {
    const r = await untersuche(page, p1, p2);
    version = r.version;
    r.felder.forEach(f => felder.add(f));
    r.nichtGelesen.forEach(f => nichtGelesen.add(f));
  }
  // Jedes Szenario ist ein moeglicher Spielstand: ein Feld, das in einem davon ungelesen bleibt, zaehlt
  const aktuell = { version, felder: [...felder].sort() };

  if (process.env.PROTOKOLL_FIXTURE) {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(aktuell, null, 2) + '\n');
  }
  const gespeichert = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  if (gespeichert.version === version) {
    expect(
      aktuell.felder,
      'Snapshot-Format geaendert: PROTOKOLL_VERSION erhoehen, dann Fixture neu schreiben (Kopf von tests/protokoll.spec.js)',
    ).toEqual(gespeichert.felder);
  } else {
    expect(
      gespeichert.version,
      'PROTOKOLL_VERSION erhoeht: Fixture neu schreiben (Kopf von tests/protokoll.spec.js)',
    ).toBe(version);
  }

  const unerwartet = [...nichtGelesen].filter(f => !NUR_GESENDET[f]).sort();
  expect(unerwartet, 'Host sendet Felder, die applyGameStateSnapshot nie liest').toEqual([]);
  const veraltet = Object.keys(NUR_GESENDET).filter(f => !nichtGelesen.has(f));
  expect(veraltet, 'Client liest diese Felder inzwischen: aus NUR_GESENDET streichen').toEqual([]);
});
