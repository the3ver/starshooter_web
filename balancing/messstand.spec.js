// Balancing-Messstand (nicht Teil von npm test/CI): npm run balancing
// Misst je Schiff (Bot als P2, hard) und Szenario, wie schnell und verlustreich Gegner besiegt werden.
// Vollstaendig deterministisch: geseedetes Math.random, Simulation synchron ueber simulationsSchritt().
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { setzeSpielstand } = require('../tests/helfer');

const SCHIFFE = ['viper', 'phantom', 'gleve'];
const SEEDS = [1, 2, 3, 4, 5];
const SZENARIEN = [
  { id: 'A_welle', name: 'Welle (8 Feinde, Lvl 1)', maxSchritte: 3600 },
  { id: 'B_boss1', name: 'Boss Level 1', maxSchritte: 5400 },
  { id: 'C_boss2', name: 'Boss Level 2', maxSchritte: 5400 },
];

const ergebnisse = [];

// Laeuft im Browser vor jedem Seitenskript: Math.random durch mulberry32 ersetzen
function installiereSeed() {
  window.__setzeSeed = (seed) => {
    let a = seed >>> 0;
    Math.random = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  window.__setzeSeed(1);
}

// Aufbau und Lauf passieren synchron nach den Imports, damit die echte rAF-Schleife nicht dazwischenfunkt
async function messe(page, { schiff, szenario, seed, maxSchritte }) {
  return page.evaluate(async ({ schiff, szenario, seed, maxSchritte }) => {
    const Gleve = await import('./js/gleve.js');
    const Bot = await import('./js/bot.js');
    const { state, arrays, Entities, Loop, shipModels, config } = window.__game;
    window.__setzeSeed(seed);

    // Sauberer Ausgangszustand wie beim Spielstart (die echte Schleife hat vorher beliebig viele Schritte gemacht)
    window.__game.Utils.restartGame();
    state.spielLaeuft = true;
    window.__game.dom.spieler.style.display = 'block';
    window.__game.dom.spieler2.style.display = 'block';
    state.frameZaehler = 1;
    // Sterne verbrauchen beim Umbruch Zufallswerte; ihre Lage haengt von den echten Schritten davor ab
    arrays.sterne.forEach((stern, i) => { stern.y = (i * 47) % config.spielfeldHoehe; stern.x = (i * 83) % config.spielfeldBreite; });

    // Feld leeren
    ['feinde', 'asteroiden', 'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bossBombenArray',
      'bossRaketenArray', 'bosses', 'powerups', 'laserArray', 'raketenArray', 'bombenArray'].forEach(name => {
      arrays[name].forEach(o => o.el && o.el.remove());
      arrays[name].length = 0;
    });
    Object.keys(state.tastenGedrueckt).forEach(k => { state.tastenGedrueckt[k] = false; });
    state.bossAktiv = false;
    state.bossWarningAktiv = false;
    state.hacks = [];

    // P1: nur Zuschauer
    // godMode schuetzt auch P2, deshalb P1 ueber Dauer-I-Frames unverwundbar halten
    state.godMode = false;
    state.autolaserAktiv = false;

    // P2-Bot mit dem Schiff wie beim echten Start (Werte analog restartGame)
    const p2 = state.p2;
    state.p2IsBot = true;
    state.p2BotDifficulty = 'hard';
    p2.selectedShipModel = schiff;
    p2.leben = 3;
    p2.maxEnergie = 50;
    p2.energie = 50;
    p2.laserStufe = 1;
    p2.raketenStufe = 1;
    p2.bombenStufe = 1;
    p2.laserDurchschlag = false;
    p2.durchschlagTimer = 0;
    p2.phantomSchildRegenTimer = 0;
    p2.autolaserAktiv = false;
    p2.autolaserTimer = 0;
    p2.raketenCooldown = 0;
    p2.bombenCooldown = 0;
    p2.spielerSchussCooldown = 0;
    p2.invulnerableTimer = 0;
    p2.isDead = false;
    p2.hacks = [];
    p2.splitterRot = 0;
    p2.splitterWeiss = 0;
    p2.viperKillCount = 0;
    p2.schildStufe = (shipModels[schiff] && shipModels[schiff].startShield) || 0;
    p2.x = 370;
    p2.y = 285;
    Gleve.setzeDashLadungenVoll(p2);
    Bot.resetBot();
    const schildStart = p2.schildStufe;

    // Szenario aufbauen
    state.level = szenario === 'C_boss2' ? 2 : 1;
    state.frameZaehler = 1;
    const istBoss = szenario !== 'A_welle';
    if (istBoss) {
      Entities.erzeugeBoss();
    } else {
      const muster = ['normal', 'normal', 'normal', 'stopAndGo', 'stopAndGo', 'stopAndGo', 'normal', 'normal'];
      const xs = [40, 110, 180, 250, 320, 390, 470, 540];
      const ys = [-30, -60, -30, -90, -30, -60, -30, -90];
      for (let i = 0; i < 8; i++) {
        Entities.erzeugeFeind(xs[i], ys[i], muster[i], 0, i >= 6);
      }
    }

    let schritte = 0;
    let sieg = false;
    let treffer = 0;
    let kills = 0;
    let entkommen = 0;
    let bossHpRest = null;
    while (schritte < maxSchritte) {
      state.frameZaehler = 1; // keine natuerlichen Spawns
      state.x = 560;
      state.y = 560;
      state.invulnerableTimer = 1e9;
      state.isDead = false;
      state.autolaserAktiv = false;
      state.autolaserTimer = 0;
      const vorherFeinde = arrays.feinde.slice();
      Loop.simulationsSchritt();
      schritte++;
      if (state.gameOverAktiv) throw new Error('Game Over im Messlauf');
      // Feind-Abgaenge: im Feld = besiegt (oder Rammstoss), ausserhalb = entkommen
      for (const f of vorherFeinde) {
        if (!arrays.feinde.includes(f)) {
          if (f.y > config.spielfeldHoehe || f.x < -f.groesse - 50 || f.x > config.spielfeldBreite + 50 || f.y < -f.groesse - 10) entkommen++;
          else kills++;
        }
      }
      if (p2.leben * 10 + p2.schildStufe < 3 * 10 + schildStart) treffer++;
      p2.leben = 3;
      p2.schildStufe = schildStart;
      p2.isDead = false;
      if (istBoss ? arrays.bosses.length === 0 : arrays.feinde.length === 0) { sieg = true; break; }
    }
    if (istBoss && arrays.bosses[0]) bossHpRest = Math.round(arrays.bosses[0].hp);
    return { schritte, sieg, treffer, kills, entkommen, bossHpRest };
  }, { schiff, szenario, seed, maxSchritte });
}

for (const schiff of SCHIFFE) {
  for (const sz of SZENARIEN) {
    for (const seed of SEEDS) {
      test(`${schiff} / ${sz.id} / Seed ${seed}`, async ({ page }) => {
        await page.route('**/api/highscores*', route => route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
        }));
        await setzeSpielstand(page);
        await page.addInitScript(installiereSeed);
        await page.goto('/');
        await page.evaluate((s) => {
          window.__game.Utils.setGameMode('coop');
          window.__game.state.p2IsBot = true;
          window.__game.state.p2BotDifficulty = 'hard';
          window.__game.state.p2.selectedShipModel = s;
        }, schiff);
        await page.keyboard.down('KeyW');
        await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
        await page.keyboard.up('KeyW');
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
