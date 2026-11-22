// Balancing bench (not part of npm test/CI): npm run balancing
// Measures per ship (bot as P2, hard) and scenario how fast and at what cost enemies are defeated.
// Fully deterministic: seeded Math.random, simulation runs synchronously via simulationStep().
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { measure, prepareMeasurement } = require('./measurement');

const SHIPS = ['viper', 'phantom', 'gleve', 'sniper'];
const SEEDS = [1, 2, 3, 4, 5];
const SCENARIOS = [
  { id: 'A_wave', name: 'Wave (8 enemies, lvl 1)', maxSteps: 3600 },
  { id: 'B_boss1', name: 'Boss Level 1', maxSteps: 5400 },
  { id: 'C_boss2', name: 'Boss Level 2', maxSteps: 5400 },
];

const results = [];

for (const ship of SHIPS) {
  for (const sz of SCENARIOS) {
    for (const seed of SEEDS) {
      test(`${ship} / ${sz.id} / Seed ${seed}`, async ({ page }) => {
        await prepareMeasurement(page, ship);
        const r = await measure(page, { ship, scenario: sz.id, seed, maxSteps: sz.maxSteps });
        results.push({ ship, scenario: sz.id, seed, ...r });
        console.log(`${ship} ${sz.id} seed ${seed}: ${JSON.stringify(r)}`);
      });
    }
  }
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

test.afterAll(() => {
  const summary = [];
  for (const sz of SCENARIOS) {
    for (const ship of SHIPS) {
      const l = results.filter(e => e.ship === ship && e.scenario === sz.id);
      if (!l.length) continue;
      const st = l.map(e => e.steps);
      const tr = l.map(e => e.hit);
      summary.push({
        scenario: sz.id,
        ship,
        runs: l.length,
        victories: l.filter(e => e.victory).length,
        stepsMedian: median(st),
        stepsMin: Math.min(...st),
        stepsMax: Math.max(...st),
        hitMedian: median(tr),
        hitMin: Math.min(...tr),
        hitMax: Math.max(...tr),
        killsMedian: median(l.map(e => e.kills)),
        escapedMedian: median(l.map(e => e.escaped)),
      });
    }
  }
  const lines = [
    '',
    'Scenario  Ship     Wins   Steps med (min-max)      Hits med (min-max)     Kills med  Escaped med',
  ];
  for (const z of summary) {
    lines.push(
      [
        z.scenario.padEnd(9),
        z.ship.padEnd(8),
        `${z.victories}/${z.runs}`.padEnd(6),
        `${z.stepsMedian} (${z.stepsMin}-${z.stepsMax})`.padEnd(24),
        `${z.hitMedian} (${z.hitMin}-${z.hitMax})`.padEnd(22),
        String(z.killsMedian).padEnd(10),
        String(z.escapedMedian),
      ].join(' '),
    );
  }
  console.log(lines.join('\n'));
  const folder = path.join(__dirname, 'ergebnisse');
  fs.mkdirSync(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(
    path.join(folder, `${stamp}.json`),
    JSON.stringify({ time: new Date().toISOString(), seeds: SEEDS, summary, runs: results }, null, 2),
  );
});
