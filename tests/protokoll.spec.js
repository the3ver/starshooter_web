// Protokoll-Konsistenz: Die Feldform von serializeGameState() ist je PROTOKOLL_VERSION festgehalten
// (tests/fixtures/protokoll.json), und der Online-Client liest jedes gesendete Feld.
// Belege: wiederholte Online-Sync-Fixes (b024ce4, 1def39a, 3e326cc, f108641).
// Nach einer gewollten Formataenderung: PROTOKOLL_VERSION erhoehen, dann
//   PROTOKOLL_FIXTURE=1 npx playwright test tests/protokoll.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { setGameState } = require('./helfer');

const FIXTURE = path.join(__dirname, 'fixtures', 'protokoll.json');

// Felder, die der Host sendet, der Client aber bewusst nicht aus dem Snapshot liest.
// Ein neuer Eintrag braucht einen Grund; ein Feld, das kein Client braucht, besser nicht senden.
const ONLY_SENT = {
  '.p2.x': 'Client sagt das eigene Schiff voraus',
  '.p2.y': 'Client sagt das eigene Schiff voraus',
  '.p2.rotate': 'Client berechnet die eigene Neigung',
  '.p2.gleveDashTimer': 'Client sagt den eigenen Dash voraus',
  '.p2.viperRollDirection': 'Client sagt die eigene Rolle voraus',
  '.p1.laserShoots': 'ungenutzt, Kandidat zum Entfernen',
  '.p2.laserShoots': 'ungenutzt, Kandidat zum Entfernen',
  '.bossActive': 'ungenutzt, Kandidat zum Entfernen',
  '.sniperMines[].fuse': 'ungenutzt, Kandidat zum Entfernen',
  '.bossLaser[].width': 'ungenutzt, Kandidat zum Entfernen',
  '.bossLaser[].height': 'ungenutzt, Kandidat zum Entfernen',
};

// Jede Schiffsart einmal als P1 und als P2, damit alle schiffsabhaengigen Felder vorkommen
const SCENARIOS = [
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
  await setGameState(page);
});

async function inspect(page, p1, p2) {
  await page.goto('/');
  return page.evaluate(
    async ({ p1, p2 }) => {
      const Display = await import('./js/anzeige.js');
      const { arrays, state } = await import('./js/state.js');
      const Network = await import('./js/network.js');
      const { PROTOCOL_VERSION } = await import('./js/netzkodierung.js');
      Display.setBackend({
        create() {},
        drawWorld() {},
        drawPlayer() {},
        remove() {},
        flash() {},
        flashPlayfield() {},
      });

      // Host: in jeder Liste ein Objekt, alle bedingten Felder aktiv
      state.gameMode = 'coop';
      state.selectedShipModel = p1;
      state.p2.selectedShipModel = p2;
      state.laserPierce = true;
      state.autolaserActive = true;
      state.bossWarningActive = true;
      state.p2.laserPierce = true;
      state.p2.autolaserActive = true;
      for (const k of Object.keys(arrays)) {
        if (k !== 'stars')
          arrays[k].push({
            id: k + '_1',
            x: 1,
            y: 1,
            stunned: 3,
            hp: 1,
            maxHp: 1,
            owner: 'p1',
            pKey: 'p1',
            rest: 5,
            tier: 1,
            type: 'energy',
            form: null,
            rot: 0,
            open: true,
            spore: true,
            top: { l: 1, r: 1, inner: 1, ib: 0 },
            bottom: { l: 1, r: 1, inner: 1, ib: 0 },
          });
      }
      const snapshot = Network.serializeGameState();

      const fields = new Set();
      const collect = (value, fieldPath) => {
        if (Array.isArray(value)) {
          value.forEach(e => collect(e, fieldPath + '[]'));
          return;
        }
        if (value && typeof value === 'object')
          for (const k of Object.keys(value)) {
            fields.add(fieldPath + '.' + k);
            collect(value[k], fieldPath + '.' + k);
          }
      };
      collect(snapshot, '');

      // Client: Snapshot ueber einen Proxy uebernehmen und gelesene Felder mitschreiben
      const read = new Set();
      const hull = (value, fieldPath) => {
        if (!value || typeof value !== 'object') return value;
        const handler = {
          get(target, k) {
            if (typeof k === 'symbol') return target[k];
            const isList = Array.isArray(target);
            if (isList && !/^\d+$/.test(k))
              return typeof target[k] === 'function' ? target[k].bind(new Proxy(target, handler)) : target[k];
            const newFilePath = isList ? fieldPath + '[]' : fieldPath + '.' + k;
            if (!isList) read.add(newFilePath);
            return hull(target[k], newFilePath);
          },
        };
        return new Proxy(value, handler);
      };
      for (const k of Object.keys(arrays)) if (k !== 'stars') arrays[k].length = 0;
      state.network = { isOnline: true, isHost: false, connected: true };
      state.gameMode = 'online';
      Network.applyGameStateSnapshot(hull(snapshot, ''));

      return {
        version: PROTOCOL_VERSION,
        fields: [...fields],
        notRead: [...fields].filter(f => !read.has(f)),
      };
    },
    { p1, p2 },
  );
}

test('Snapshot-Format passt zur PROTOKOLL_VERSION, Client liest jedes gesendete Feld', async ({ page }) => {
  const fields = new Set();
  const notRead = new Set();
  let version;
  for (const [p1, p2] of SCENARIOS) {
    const r = await inspect(page, p1, p2);
    version = r.version;
    r.fields.forEach(f => fields.add(f));
    r.notRead.forEach(f => notRead.add(f));
  }
  // Jedes Szenario ist ein moeglicher Spielstand: ein Feld, das in einem davon ungelesen bleibt, zaehlt
  const current = { version, fields: [...fields].sort() };

  if (process.env.PROTOCOL_FIXTURE) {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(current, null, 2) + '\n');
  }
  const saved = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  if (saved.version === version) {
    expect(
      current.fields,
      'Snapshot-Format geaendert: PROTOKOLL_VERSION erhoehen, dann Fixture neu schreiben (Kopf von tests/protokoll.spec.js)',
    ).toEqual(saved.fields);
  } else {
    expect(saved.version, 'PROTOKOLL_VERSION erhoeht: Fixture neu schreiben (Kopf von tests/protokoll.spec.js)').toBe(
      version,
    );
  }

  const unexpected = [...notRead].filter(f => !ONLY_SENT[f]).sort();
  expect(unexpected, 'Host sendet Felder, die applyGameStateSnapshot nie liest').toEqual([]);
  const stale = Object.keys(ONLY_SENT).filter(f => !notRead.has(f));
  expect(stale, 'Client liest diese Felder inzwischen: aus NUR_GESENDET streichen').toEqual([]);
});
