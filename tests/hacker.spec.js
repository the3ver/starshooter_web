const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
    });
  });
  await setzeSpielstand(page);
  await page.goto('/');
});

// Spiel starten und Spielfeld von zufälligen Spawns befreien
async function starteSpiel(page) {
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.spielLaeuft);
  await page.keyboard.up('KeyW');
  await page.evaluate(async () => {
    const { state, arrays } = await import('./js/state.js');
    state.frameZaehler = 0;
    arrays.feinde.forEach(f => f.el.remove());
    arrays.feinde.length = 0;
    arrays.asteroiden.forEach(a => a.el.remove());
    arrays.asteroiden.length = 0;
  });
}

test.describe('Hacker-Gegner', () => {

  test('erzeugeFeind mit Muster hacker erzeugt gruenen Hacker ohne Schild mit 20 HP', async ({ page }) => {
    await starteSpiel(page);
    const f = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.level = 5;
      Entities.erzeugeFeind(100, 50, 'hacker', 0);
      const f = arrays.feinde[arrays.feinde.length - 1];
      return { muster: f.muster, hp: f.hp, schildHp: f.schildHp, color: f.el.dataset.baseColor, hatSvg: !!f.el.querySelector('svg') };
    });
    expect(f).toEqual({ muster: 'hacker', hp: 20, schildHp: 0, color: '#39ff14', hatSvg: true });
  });

  test('Hacker traegt mit 40 % Chance ein Powerup (normaler Feind 20 %)', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(async () => {
      const { arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      const orig = Math.random;
      Math.random = () => 0.3;
      Entities.erzeugeFeind(100, 50, 'hacker', 0);
      Entities.erzeugeFeind(200, 50, 'normal', 0);
      Math.random = orig;
      return arrays.feinde.map(f => f.traegtPowerup);
    });
    expect(r).toEqual([true, false]);
  });


  test('Abschuss eines Hackers gibt doppelte Punkte (200)', async ({ page }) => {
    await starteSpiel(page);
    const diff = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      const Utils = await import('./js/utils.js');
      Entities.erzeugeFeind(100, 50, 'hacker', 0);
      const f = arrays.feinde[arrays.feinde.length - 1];
      f.traegtPowerup = false;
      const vorher = state.score;
      Utils.zerstoereZiel(f, 'p1');
      return state.score - vorher;
    });
    expect(diff).toBe(200);
  });


  test('Hacker stoppt zwischen y 100 und 200 und feuert Hack-Projektile statt Laser', async ({ page }) => {
    await starteSpiel(page);
    // Anflug, Stopp und erster Schuss in 180 festen Simulationsschritten (~3 s), synchron ausgewertet
    const r = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      const { simulationsSchritt } = await import('./js/loop.js');
      state.godMode = true;
      state.x = 0; state.y = 560;
      Entities.erzeugeFeind(200, -30, 'hacker', 0);
      for (let i = 0; i < 180; i++) simulationsSchritt();
      const f = arrays.feinde.find(f => f.muster === 'hacker');
      return { y: f.y, phase: f.phase, schuesse: f.hackSchuesse, laser: arrays.feindLaserArray.length };
    });
    expect(r.phase).toBe('lauern');
    expect(r.y).toBeGreaterThanOrEqual(100);
    expect(r.y).toBeLessThanOrEqual(200);
    expect(r.schuesse).toBeGreaterThanOrEqual(1);
    expect(r.laser).toBe(0);
    await expect(page.locator('.hack-projektil').first()).toBeAttached();
  });


  test('Hack-Projektil hackt den Spieler ohne Schaden und ignoriert den Schild', async ({ page }) => {
    await starteSpiel(page);
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.x = 185; state.y = 400;
      state.schildStufe = 2;
      Entities.erzeugeFeind(185, 50, 'hacker', 0);
      const f = arrays.feinde[arrays.feinde.length - 1];
      f.phase = 'lauern'; f.lauerTimer = 9999; f.hackTimer = 9999; f.y = 100; f.stopY = 100;
      Entities.erzeugeHackProjektil(194, 360, 200, 415, f);
    });
    await page.waitForFunction(() => window.__game.arrays.hackProjektilArray.length === 0);
    const r = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const f = arrays.feinde.find(f => f.muster === 'hacker');
      return { hacks: state.hacks.length, leben: state.leben, schild: state.schildStufe, gelandet: f.hackGelandet };
    });
    expect(r).toEqual({ hacks: 1, leben: 3, schild: 2, gelandet: true });
  });


  test('Hacker flieht nach Treffer oder nach 10 s nach oben aus dem Bild', async ({ page }) => {
    await starteSpiel(page);
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      Entities.erzeugeFeind(100, 150, 'hacker', 0);
      Entities.erzeugeFeind(250, 150, 'hacker', 0);
      const [a, b] = arrays.feinde;
      a.id = 'treffer'; a.phase = 'lauern'; a.lauerTimer = 9999; a.hackTimer = 9999; a.hackGelandet = true;
      b.id = 'timeout'; b.phase = 'lauern'; b.lauerTimer = 1; b.hackTimer = 9999;
    });
    // Feste Simulationsschritte statt Echtzeit: erst Phasenwechsel, dann Flucht aus dem Bild
    const r = await page.evaluate(() => {
      const { arrays, Loop } = window.__game;
      for (let i = 0; i < 6; i++) Loop.simulationsSchritt();
      const phasen = arrays.feinde.map(f => f.phase);
      let schritte = 0;
      while (arrays.feinde.length > 0 && schritte < 600) { Loop.simulationsSchritt(); schritte++; }
      return { phasen, uebrig: arrays.feinde.length };
    });
    expect(r.phasen).toEqual(['flucht', 'flucht']);
    expect(r.uebrig).toBe(0);
  });

  test('Ein Hacker kann nur einen Treffer landen', async ({ page }) => {
    await starteSpiel(page);
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.x = 185; state.y = 400;
      Entities.erzeugeFeind(185, 50, 'hacker', 0);
      const f = arrays.feinde[0];
      f.phase = 'lauern'; f.lauerTimer = 9999; f.hackTimer = 9999; f.y = 100;
      Entities.erzeugeHackProjektil(194, 360, 200, 415, f);
      Entities.erzeugeHackProjektil(194, 330, 200, 415, f);
    });
    await page.waitForFunction(() => window.__game.arrays.hackProjektilArray.length === 0);
    const hacks = await page.evaluate(() => window.__game.state.hacks.length);
    expect(hacks).toBe(1);
  });


  test('Hack-Effekte stapeln sich und laufen nach 3 s ab (P1 und P2)', async ({ page }) => {
    await starteSpiel(page);
    // Ablauf ueber HACK_DAUER feste Simulationsschritte statt bis zu 3 s Echtzeit
    const r = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const { simulationsSchritt } = await import('./js/loop.js');
      Hack.hackeSpieler(state, 'hudGlitch');
      Hack.hackeSpieler(state, 'invertiert');
      Hack.hackeSpieler(state.p2, 'waffenOffline');
      const vorher = state.hacks.map(h => h.typ);
      const p2Vorher = state.p2.hacks.map(h => h.typ);
      for (let i = 0; i < Hack.HACK_DAUER - 1; i++) simulationsSchritt();
      const kurzVorEnde = [state.hacks.length, state.p2.hacks.length];
      simulationsSchritt();
      return { vorher, p2Vorher, kurzVorEnde, nachher: [state.hacks.length, state.p2.hacks.length] };
    });
    expect(r.vorher).toEqual(['hudGlitch', 'invertiert']);
    expect(r.p2Vorher).toEqual(['waffenOffline']);
    expect(r.kurzVorEnde).toEqual([2, 1]);
    expect(r.nachher).toEqual([0, 0]);
  });


  test('Effekt invertiert: D bewegt das Schiff nach links', async ({ page }) => {
    await starteSpiel(page);
    const startX = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      state.godMode = true;
      state.x = 185;
      Hack.hackeSpieler(state, 'invertiert');
      return state.x;
    });
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyD');
    const x = await page.evaluate(() => window.__game.state.x);
    expect(x).toBeLessThan(startX - 20);
  });


  test('Effekt tastenVertauscht: jede Richtung wird auf eine andere Richtung abgebildet', async ({ page }) => {
    await starteSpiel(page);
    for (let lauf = 0; lauf < 5; lauf++) {
      const r = await page.evaluate(async () => {
        const { state } = await import('./js/state.js');
        const Hack = await import('./js/hack.js');
        Hack.entferneHacks(state);
        Hack.hackeSpieler(state, 'tastenVertauscht');
        const richtungen = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        return richtungen.map(([dx, dy]) => {
          const b = Hack.hackeBewegung(state, dx, dy);
          return { gleich: b.dx === dx && b.dy === dy, ziel: `${b.dx},${b.dy}` };
        });
      });
      expect(r.some(x => x.gleich)).toBe(false);
      expect(new Set(r.map(x => x.ziel)).size).toBe(4);
    }
  });


  test('Effekt waffenOffline: Laser, Raketen und Bomben feuern nicht', async ({ page }) => {
    await starteSpiel(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      state.godMode = true;
      state.energie = 50;
      state.raketenCooldown = 0;
      state.bombenCooldown = 0;
      Hack.hackeSpieler(state, 'waffenOffline');
    });
    await page.keyboard.down('KeyL');
    await page.keyboard.down('KeyK');
    await page.keyboard.down('Space');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyL');
    await page.keyboard.up('KeyK');
    await page.keyboard.up('Space');
    const r = await page.evaluate(async () => {
      const { arrays } = await import('./js/state.js');
      return { laser: arrays.laserArray.length, raketen: arrays.raketenArray.length, bomben: arrays.bombenArray.length };
    });
    expect(r).toEqual({ laser: 0, raketen: 0, bomben: 0 });
  });


  test('Effekt hudGlitch: HUD bekommt Glitch-Klasse, solange der Effekt aktiv ist', async ({ page }) => {
    await starteSpiel(page);
    // Feste Simulationsschritte: Klasse ist bis zum letzten Schritt der Hack-Dauer gesetzt, danach weg
    const r = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const { simulationsSchritt } = await import('./js/loop.js');
      const glitch = () => document.getElementById('ui-container').classList.contains('hud-glitch');
      Hack.hackeSpieler(state, 'hudGlitch');
      simulationsSchritt();
      const amAnfang = glitch();
      for (let i = 1; i < Hack.HACK_DAUER - 1; i++) simulationsSchritt();
      const kurzVorEnde = glitch();
      simulationsSchritt();
      return { amAnfang, kurzVorEnde, nachEnde: glitch() };
    });
    expect(r).toEqual({ amAnfang: true, kurzVorEnde: true, nachEnde: false });
    await expect(page.locator('#ui-container')).not.toHaveClass(/hud-glitch/);
  });


  test('Gehackter Spieler zeigt Label mit Effektnamen, Restzeit-Balken und Glitch am Schiff', async ({ page }) => {
    await starteSpiel(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      state.godMode = true;
      Hack.hackeSpieler(state, 'invertiert');
      Hack.hackeSpieler(state, 'waffenOffline');
    });
    const label = page.locator('#hack-label-p1');
    await expect(label).toBeVisible();
    await expect(label).toContainText('INVERTED');
    await expect(label).toContainText('WEAPONS OFFLINE');
    await expect(label.locator('.hack-restzeit')).toHaveCount(1);
    await expect(page.locator('#spieler')).toHaveClass(/spieler-gehackt/);
    // Rest der Hack-Dauer in festen Simulationsschritten statt bis zu 3 s Echtzeit
    const schritte = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const { simulationsSchritt } = await import('./js/loop.js');
      let n = 0;
      while (state.hacks.length > 0 && n <= Hack.HACK_DAUER) { simulationsSchritt(); n++; }
      return n;
    });
    expect(schritte).toBeLessThanOrEqual(180);
    await expect(label).toBeHidden();
    await expect(page.locator('#spieler')).not.toHaveClass(/spieler-gehackt/);
  });


  test('Spawn: Hacker erst ab Level 2 und hoechstens einer gleichzeitig', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Loop = await import('./js/loop.js');
      const anzahl = () => arrays.feinde.filter(f => f.muster === 'hacker').length;
      const orig = Math.random;
      Math.random = () => 0.05;
      state.level = 1;
      Loop.verwalteFeindSpawns();
      const level1 = anzahl();
      state.level = 2;
      Loop.verwalteFeindSpawns();
      const level2 = anzahl();
      Loop.verwalteFeindSpawns();
      const nochmal = anzahl();
      Math.random = orig;
      return { level1, level2, nochmal };
    });
    expect(r).toEqual({ level1: 0, level2: 1, nochmal: 1 });
  });


  test('Koop: invertiert wirkt auch auf die Pfeiltasten von Spieler 2', async ({ page }) => {
    await starteSpiel(page);
    await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      config.spielfeldBreite = 600;
      state.godMode = true;
      state.gameMode = 'coop';
      state.p2IsBot = false;
      state.p2.isDead = false;
      state.p2.x = 300;
      state.p2.y = 400;
      Hack.hackeSpieler(state.p2, 'invertiert');
    });
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowRight');
    const r = await page.evaluate(() => ({ p1: window.__game.state.x, p2: window.__game.state.p2.x }));
    expect(r.p2).toBeLessThan(280);
  });


  test('Koop: Bot-Partner wird ebenfalls gehackt (invertiert kehrt seine Bewegung um)', async ({ page }) => {
    await starteSpiel(page);
    const setup = async (mitHack) => page.evaluate(async (mitHack) => {
      const { state, config } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      config.spielfeldBreite = 600;
      state.godMode = true;
      state.gameMode = 'coop';
      state.p2IsBot = true;
      state.p2.isDead = false;
      state.x = 50; state.y = 400;
      state.p2.x = 450; state.p2.y = 400;
      Hack.entferneHacks(state.p2);
      if (mitHack) Hack.hackeSpieler(state.p2, 'invertiert');
    }, mitHack);
    await setup(false);
    await page.waitForTimeout(300);
    const ohne = await page.evaluate(() => window.__game.state.p2.x);
    await setup(true);
    await page.waitForTimeout(300);
    const mit = await page.evaluate(() => window.__game.state.p2.x);
    expect(ohne).toBeLessThan(450);
    expect(mit).toBeGreaterThan(450);
  });


  test('Online: Snapshot uebertraegt Hacks beider Spieler und Hack-Projektile', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const Entities = await import('./js/entities.js');
      const Network = await import('./js/network.js');
      state.pausiert = true;
      Hack.hackeSpieler(state, 'invertiert');
      Hack.hackeSpieler(state.p2, 'tastenVertauscht');
      Entities.erzeugeHackProjektil(100, 100, 100, 300);
      const snap = JSON.parse(JSON.stringify(Network.serializeGameState()));
      const perm = state.p2.hacks[0].perm;
      // Client-Seite simulieren: lokalen Zustand leeren und Snapshot anwenden
      Hack.entferneHacks(state);
      Hack.entferneHacks(state.p2);
      arrays.hackProjektilArray.forEach(h => h.el.remove());
      arrays.hackProjektilArray.length = 0;
      Network.applyGameStateSnapshot(snap);
      return {
        p1: state.hacks.map(h => h.typ),
        p2: state.p2.hacks.map(h => h.typ),
        permGleich: JSON.stringify(state.p2.hacks[0].perm) === JSON.stringify(perm),
        projektile: arrays.hackProjektilArray.length,
        dom: document.querySelectorAll('.hack-projektil').length
      };
    });
    expect(r).toEqual({ p1: ['invertiert'], p2: ['tastenVertauscht'], permGleich: true, projektile: 1, dom: 1 });
  });


  test('Online-Client: Hack wirkt auf die lokale Steuerung und zeigt das Label', async ({ page }) => {
    await starteSpiel(page);
    await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      config.spielfeldBreite = 600;
      state.gameMode = 'online';
      state.network.isClient = true;
      state.network.connected = true;
      state.p2.isDead = false;
      state.p2.x = 300; state.p2.y = 400;
      Hack.hackeSpieler(state.p2, 'invertiert');
    });
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyD');
    const x = await page.evaluate(() => window.__game.state.p2.x);
    expect(x).toBeLessThan(280);
    await expect(page.locator('#hack-label-p2')).toContainText('INVERTED');
  });


  test('restartGame entfernt aktive Hacks beider Spieler', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const Utils = await import('./js/utils.js');
      Hack.hackeSpieler(state, 'invertiert');
      Hack.hackeSpieler(state.p2, 'hudGlitch');
      Utils.restartGame();
      return [state.hacks.length, state.p2.hacks.length];
    });
    expect(r).toEqual([0, 0]);
  });


  test('Neuer Hack spielt den Glitch-Sound', async ({ page }) => {
    await starteSpiel(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Hack = await import('./js/hack.js');
      const Audio = await import('./js/audio.js');
      Audio.clearAudioHistory();
      Hack.hackeSpieler(state, 'invertiert');
    });
    await page.waitForFunction(async () => {
      const Audio = await import('./js/audio.js');
      return Audio.audioHistory.filter(a => a.name === 'hack').length === 1;
    });
    await page.waitForTimeout(200);
    const anzahl = await page.evaluate(async () => {
      const Audio = await import('./js/audio.js');
      return Audio.audioHistory.filter(a => a.name === 'hack').length;
    });
    expect(anzahl).toBe(1);
  });


  test('Hack-Projektil lenkt in Richtung des Spielers', async ({ page }) => {
    await starteSpiel(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      state.x = 330; state.y = 500;
      // Startet senkrecht nach unten, Spieler steht weit rechts
      Entities.erzeugeHackProjektil(50, 100, 50, 500);
    });
    await page.waitForTimeout(500);
    const vx = await page.evaluate(() => window.__game.arrays.hackProjektilArray[0].vx);
    expect(vx).toBeGreaterThan(0.5);
  });


  test('Hack-Projektil kann durch seitliches Ausweichen verfehlt werden', async ({ page }) => {
    await starteSpiel(page);
    // Feste Simulationsschritte; Taste D ueber state.tastenGedrueckt (wie der keydown-Handler) gehalten.
    // Gegenprobe ohne Ausweichen: derselbe Orb trifft.
    const lauf = (ausweichen) => page.evaluate(async (ausweichen) => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      const Hack = await import('./js/hack.js');
      const { simulationsSchritt } = await import('./js/loop.js');
      Hack.entferneHacks(state);
      arrays.hackProjektilArray.forEach(h => h.el.remove());
      arrays.hackProjektilArray.length = 0;
      state.godMode = true;
      state.x = 185; state.y = 450;
      Entities.erzeugeHackProjektil(194, 250, 200, 465);
      // Spaet ausweichen, wenn der Orb ca. 80 px entfernt ist
      let n = 0;
      while (arrays.hackProjektilArray[0] && arrays.hackProjektilArray[0].y <= 370 && n < 300) { simulationsSchritt(); n++; }
      const orbVorAusweichen = !!arrays.hackProjektilArray[0];
      if (ausweichen) state.tastenGedrueckt.d = true;
      for (let i = 0; i < 120; i++) simulationsSchritt();
      state.tastenGedrueckt.d = false;
      return { orbVorAusweichen, hacks: state.hacks.length };
    }, ausweichen);
    const mit = await lauf(true);
    expect(mit).toEqual({ orbVorAusweichen: true, hacks: 0 });
    const ohne = await lauf(false);
    expect(ohne).toEqual({ orbVorAusweichen: true, hacks: 1 });
  });


  test('Hack-Projektil kehrt nach dem Vorbeiflug nicht um', async ({ page }) => {
    await starteSpiel(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      state.x = 185; state.y = 200;
      // Orb ist bereits unter dem Spieler und fliegt nach unten
      Entities.erzeugeHackProjektil(194, 300, 194, 600);
    });
    // 72 feste Simulationsschritte (~1,2 s); vy wird in jedem Schritt geprueft, solange der Orb existiert
    const r = await page.evaluate(() => {
      const { arrays, Loop } = window.__game;
      const vys = [];
      for (let i = 0; i < 72; i++) {
        Loop.simulationsSchritt();
        const hp = arrays.hackProjektilArray[0];
        if (hp) vys.push(hp.vy);
      }
      return { schritteMitOrb: vys.length, minVy: Math.min(...vys) };
    });
    expect(r.schritteMitOrb).toBeGreaterThan(0);
    expect(r.minVy).toBeGreaterThan(0);
  });

  async function bossKampf(page, level, enrage) {
    await starteSpiel(page);
    await page.evaluate(async ({ level, enrage }) => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      state.level = level;
      state.x = 185; state.y = 500;
      Entities.erzeugeBoss();
      const b = arrays.bosses[arrays.bosses.length - 1];
      b.phase = 'kampf'; b.y = 20;
      b.schussTimer = 999999; b.baseSchussRate = 999999;
      b.enragePhaseAktiv = enrage;
      b.hackTimer = 2;
    }, { level, enrage });
  }

  test('Boss feuert ab Level 5 Hack-Projektile, Reset auf 300 Frames', async ({ page }) => {
    await bossKampf(page, 5, false);
    await page.waitForFunction(() => window.__game.arrays.hackProjektilArray.length > 0);
    const r = await page.evaluate(() => {
      const b = window.__game.arrays.bosses[0];
      return { timer: b.hackTimer, quelle: window.__game.arrays.hackProjektilArray[0].quelle };
    });
    expect(r.timer).toBeGreaterThan(280);
    expect(r.timer).toBeLessThanOrEqual(300);
    expect(r.quelle).toBeNull();
  });

  test('Boss unter Level 5 feuert keine Hack-Projektile', async ({ page }) => {
    await bossKampf(page, 4, false);
    await page.waitForTimeout(500);
    const n = await page.evaluate(() => window.__game.arrays.hackProjektilArray.length);
    expect(n).toBe(0);
  });

  test('Boss im Enrage feuert alle 180 Frames', async ({ page }) => {
    await bossKampf(page, 5, true);
    await page.waitForFunction(() => window.__game.arrays.hackProjektilArray.length > 0);
    const timer = await page.evaluate(() => window.__game.arrays.bosses[0].hackTimer);
    expect(timer).toBeGreaterThan(160);
    expect(timer).toBeLessThanOrEqual(180);
  });

  test('Boss kann den Spieler mehrfach hacken (Quelle null blockiert nicht)', async ({ page }) => {
    await starteSpiel(page);
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.godMode = true;
      state.x = 185; state.y = 400;
      Entities.erzeugeHackProjektil(194, 395, 194, 415, null);
    });
    await page.waitForFunction(() => window.__game.arrays.hackProjektilArray.length === 0);
    await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      Entities.erzeugeHackProjektil(194, 395, 194, 415, null);
    });
    await page.waitForFunction(() => window.__game.arrays.hackProjektilArray.length === 0);
    const n = await page.evaluate(() => window.__game.state.hacks.length);
    expect(n).toBe(2);
  });

});
