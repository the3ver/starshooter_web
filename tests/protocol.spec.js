// Protocol consistency: the field shape of serializeGameState() is pinned per PROTOCOL_VERSION
// (tests/fixtures/protocol.json), and the online client reads every field that is sent.
// Evidence: repeated online sync fixes (b024ce4, 1def39a, 3e326cc, f108641).
// After an intended format change: raise PROTOCOL_VERSION, then
//   PROTOCOL_FIXTURE=1 npx playwright test tests/protocol.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { setGameState } = require('./helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'protocol.json');

// Fields the host sends but the client deliberately does not read from the snapshot.
// A new entry needs a reason; a field no client needs is better not sent.
const ONLY_SENT = {
  '.p2.x': 'the client predicts its own ship',
  '.p2.y': 'the client predicts its own ship',
  '.p2.rotate': 'the client computes its own tilt',
  '.p2.gleveDashTimer': 'the client predicts its own dash',
  '.p2.viperRollDirection': 'the client predicts its own roll',
  '.p1.laserShoots': 'unused, candidate for removal',
  '.p2.laserShoots': 'unused, candidate for removal',
  '.bossActive': 'unused, candidate for removal',
  '.sniperMines[].fuse': 'unused, candidate for removal',
  '.bossLaser[].width': 'unused, candidate for removal',
  '.bossLaser[].height': 'unused, candidate for removal',
};

// Every ship kind once as P1 and as P2, so all ship-specific fields appear
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
      const Display = await import('./js/display.js');
      const { arrays, state } = await import('./js/state.js');
      const Network = await import('./js/network.js');
      const { PROTOCOL_VERSION } = await import('./js/net-encoding.js');
      Display.setBackend({
        create() {},
        drawWorld() {},
        drawPlayer() {},
        remove() {},
        flash() {},
        flashPlayfield() {},
      });

      // Host: one object in every list, all conditional fields active
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

      // Client: apply the snapshot through a proxy and record the fields it reads
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

test('Snapshot format matches PROTOCOL_VERSION, the client reads every field sent', async ({ page }) => {
  const fields = new Set();
  const notRead = new Set();
  let version;
  for (const [p1, p2] of SCENARIOS) {
    const r = await inspect(page, p1, p2);
    version = r.version;
    r.fields.forEach(f => fields.add(f));
    r.notRead.forEach(f => notRead.add(f));
  }
  // Every scenario is a possible game state: a field left unread in any of them counts
  const current = { version, fields: [...fields].sort() };

  if (process.env.PROTOCOL_FIXTURE) {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(current, null, 2) + '\n');
  }
  const saved = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  if (saved.version === version) {
    expect(
      current.fields,
      'Snapshot format changed: raise PROTOCOL_VERSION, then rewrite the fixture (header of tests/protocol.spec.js)',
    ).toEqual(saved.fields);
  } else {
    expect(saved.version, 'PROTOCOL_VERSION raised: rewrite the fixture (header of tests/protocol.spec.js)').toBe(
      version,
    );
  }

  const unexpected = [...notRead].filter(f => !ONLY_SENT[f]).sort();
  expect(unexpected, 'Host sends fields that applyGameStateSnapshot never reads').toEqual([]);
  const stale = Object.keys(ONLY_SENT).filter(f => !notRead.has(f));
  expect(stale, 'Client reads these fields by now: remove them from ONLY_SENT').toEqual([]);
});
