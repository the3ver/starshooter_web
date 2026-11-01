// Balancing-Messstand (nicht Teil von npm test/CI): npm run balancing
// Misst je Schiff (Bot als P2, hard) und Szenario, wie schnell und verlustreich Gegner besiegt werden.
// Vollstaendig deterministisch: geseedetes Math.random, Simulation synchron ueber simulationsSchritt().
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { messe, bereiteMessungVor } = require('./messung');

const SCHIFFE = ['viper', 'phantom', 'gleve', 'sniper'];
const SEEDS = [1, 2, 3, 4, 5];
const SZENARIEN = [
  { id: 'A_welle', name: 'Welle (8 Feinde, Lvl 1)', maxSchritte: 3600 },
  { id: 'B_boss1', name: 'Boss Level 1', maxSchritte: 5400 },
  { id: 'C_boss2', name: 'Boss Level 2', maxSchritte: 5400 },
];

const ergebnisse = [];

for (const schiff of SCHIFFE) {
  for (const sz of SZENARIEN) {
    for (const seed of SEEDS) {
      test(`${schiff} / ${sz.id} / Seed ${seed}`, async ({ page }) => {
        await bereiteMessungVor(page, schiff);
        const r = await messe(page, { schiff, szenario: sz.id, seed, maxSchritte: sz.maxSchritte });
        ergebnisse.push({ schiff, szenario: sz.id, seed, ...r });
        console.log(`${schiff} ${sz.id} seed ${seed}: ${JSON.stringify(r)}`);
      });
    }
  }
}

function median(werte) {
  const s = [...werte].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

test.afterAll(() => {
  const zusammenfassung = [];
  for (const sz of SZENARIEN) {
    for (const schiff of SCHIFFE) {
      const l = ergebnisse.filter(e => e.schiff === schiff && e.szenario === sz.id);
      if (!l.length) continue;
      const st = l.map(e => e.schritte);
      const tr = l.map(e => e.treffer);
      zusammenfassung.push({
        szenario: sz.id, schiff, laeufe: l.length, siege: l.filter(e => e.sieg).length,
        schritteMedian: median(st), schritteMin: Math.min(...st), schritteMax: Math.max(...st),
        trefferMedian: median(tr), trefferMin: Math.min(...tr), trefferMax: Math.max(...tr),
        killsMedian: median(l.map(e => e.kills)), entkommenMedian: median(l.map(e => e.entkommen)),
      });
    }
  }
  const zeilen = ['', 'Szenario  Schiff   Siege  Schritte med (min-max)   Treffer med (min-max)  Kills med  Entkommen med'];
  for (const z of zusammenfassung) {
    zeilen.push([
      z.szenario.padEnd(9), z.schiff.padEnd(8), `${z.siege}/${z.laeufe}`.padEnd(6),
      `${z.schritteMedian} (${z.schritteMin}-${z.schritteMax})`.padEnd(24),
      `${z.trefferMedian} (${z.trefferMin}-${z.trefferMax})`.padEnd(22),
      String(z.killsMedian).padEnd(10), String(z.entkommenMedian),
    ].join(' '));
  }
  console.log(zeilen.join('\n'));
  const ordner = path.join(__dirname, 'ergebnisse');
  fs.mkdirSync(ordner, { recursive: true });
  const stempel = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(ordner, `${stempel}.json`), JSON.stringify({ zeit: new Date().toISOString(), seeds: SEEDS, zusammenfassung, laeufe: ergebnisse }, null, 2));
});
