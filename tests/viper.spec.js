const { test, expect } = require('@playwright/test');
const { setzeSpielstand } = require('./helfer');

// Viper-X Ausweichrolle: Doppeltipp links/rechts (mobil: Wisch auf dem Joystick) rollt 70 px in 12 Schritten,
// unverwundbar, Cooldown 90 Schritte ab Rollenstart. Alles deterministisch ueber simulationsSchritt().

test.beforeEach(async ({ page }) => {
  await page.route('**/api/highscores*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
  }));
  await page.route('**/api/turn*', route => route.fulfill({ status: 503, body: '' }));
  await setzeSpielstand(page);
  await page.goto('/');
});

// Spiel mit gewaehlten Schiffen starten und Feld leeren. window.__viperTest.leeren() stellt einen
// deterministischen Ausgangszustand her, tippe() fuehrt einen Doppeltipp aus (3 Schritte, Taste am Ende gehalten).
async function starteSpiel(page, { coop = false, p1 = 'viper', p2 = 'viper' } = {}) {
  if (coop) {
    await page.evaluate(() => window.__game.Utils.setGameMode('coop'));
    await page.locator('.hangar-player-tab[data-player="p2"]').click();
    await page.locator(`.hangar-model-btn[data-model="${p2}"]`).click();
    await page.locator('.hangar-player-tab[data-player="p1"]').click();
  }
  await page.locator(`.hangar-model-btn[data-model="${p1}"]`).click();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.state.spielLaeuft && !window.__game.state.cutsceneAktiv);
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    window.__viperTest = {
      leeren() {
        const { state, arrays } = window.__game;
        ['feinde', 'asteroiden', 'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bossBombenArray',
          'bossRaketenArray', 'bosses', 'powerups', 'laserArray', 'raketenArray'].forEach(name => {
          arrays[name].forEach(o => o.el && o.el.remove());
          arrays[name].length = 0;
        });
        Object.keys(state.tastenGedrueckt).forEach(k => { state.tastenGedrueckt[k] = false; });
        state.frameZaehler = 1; // keine Spawns in den naechsten 100 Schritten
        state.level = 1;
        state.bossAktiv = false;
        state.hacks = [];
        state.joystick.active = false;
        state.joystick.x = 0;
        state.joystick.y = 0;
        for (const s of [state, state.p2]) {
          s.hacks = [];
          s.leben = 3;
          s.schildStufe = 0;
          s.invulnerableTimer = 0;
          s.isDead = false;
          s.viperRolleTimer = 0;
          s.viperRolleRichtung = 0;
          s.viperRolleCooldown = 0;
          s.viperLinksGehalten = false;
          s.viperRechtsGehalten = false;
          s.viperTapRichtung = 0;
          s.viperTapAlter = 999;
          s.viperJoyRuhe = 0;
          s.viperJoyVorher = 0;
        }
        state.x = 150;
        state.y = 400;
        state.p2.x = 250;
        state.p2.y = 400;
        window.__game.Audio.clearAudioHistory();
      },
      schritte(n) {
        for (let i = 0; i < n; i++) window.__game.Loop.simulationsSchritt();
      },
      // Zwei Druck-Flanken im Abstand abstand Schritten; Rueckgabe nach dem zweiten Druck-Schritt (Taste gehalten)
      tippe(taste, abstand = 2) {
        const t = window.__game.state.tastenGedrueckt;
        t[taste] = true;
        this.schritte(1);
        t[taste] = false;
        this.schritte(abstand - 1);
        t[taste] = true;
        this.schritte(1);
      },
      rollen() {
        return window.__game.Audio.audioHistory.filter(a => a.name === 'rolle').length;
      }
    };
  });
}

test.describe('Viper-X Ausweichrolle', () => {
  test('Doppeltipp rechts: 70 px gleichmaessig in 12 Schritten, Klasse, Sound, danach wieder normale Steuerung', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const el = document.getElementById('spieler');
      T.leeren();
      T.schritte(1); // Ausgangszustand setzen lassen
      const t = state.tastenGedrueckt;
      t.d = true; T.schritte(1);
      t.d = false; T.schritte(1);
      const x0 = state.x;
      t.d = true; T.schritte(1); // Start der Rolle (zweite Druck-Flanke)
      t.d = false;
      const xs = [state.x - x0];
      const nachStart = { timer: state.viperRolleTimer, klasse: el.classList.contains('viper-rolle'), cd: state.viperRolleCooldown, sounds: T.rollen() };
      for (let i = 0; i < 11; i++) { T.schritte(1); xs.push(state.x - x0); }
      const amEnde = { x: state.x - x0, klasse: el.classList.contains('viper-rolle'), nachbilder: document.querySelectorAll('.viper-nachbild').length };
      T.schritte(1);
      const danach = { x: state.x - x0, klasse: el.classList.contains('viper-rolle'), timer: state.viperRolleTimer };
      // Normale Steuerung wieder aktiv
      t.a = true; T.schritte(3); t.a = false;
      const links = state.x - x0;
      return { xs, nachStart, amEnde, danach, links };
    });
    expect(r.nachStart).toEqual({ timer: 12, klasse: true, cd: 90, sounds: 1 });
    expect(r.xs).toHaveLength(12);
    r.xs.forEach((x, i) => expect(x).toBeCloseTo(70 / 12 * (i + 1), 3));
    expect(r.amEnde.x).toBeCloseTo(70, 3);
    expect(r.amEnde.klasse).toBe(true);
    expect(r.amEnde.nachbilder).toBeGreaterThan(0);
    expect(r.danach.x).toBeCloseTo(70, 3);
    expect(r.danach.klasse).toBe(false);
    expect(r.danach.timer).toBe(0);
    expect(r.links).toBeLessThan(70);
  });

  test('Doppeltipp links (A und Pfeil links): 70 px nach links', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const out = [];
      for (const taste of ['a', 'arrowleft']) {
        T.leeren();
        state.x = 250;
        const t = state.tastenGedrueckt;
        t[taste] = true; T.schritte(1);
        t[taste] = false; T.schritte(1);
        const x0 = state.x;
        t[taste] = true; T.schritte(1);
        t[taste] = false; T.schritte(11);
        out.push(state.x - x0);
      }
      return out;
    });
    r.forEach(d => expect(d).toBeCloseTo(-70, 3));
  });

  test('Einzeltipp und zu langsamer Doppeltipp (mehr als 15 Schritte) rollen nicht', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      T.leeren();
      const t = state.tastenGedrueckt;
      const timer = [];
      t.d = true; T.schritte(1); timer.push(state.viperRolleTimer);
      t.d = false; T.schritte(40); timer.push(state.viperRolleTimer);
      const einzel = { timer: [...timer], sounds: T.rollen() };
      // Zwei Tipps mit 16 Schritten Abstand
      T.leeren();
      T.tippe('d', 16);
      const zuLangsam = { timer: state.viperRolleTimer, sounds: T.rollen() };
      t.d = false; T.schritte(3);
      // Genau 15 Schritte Abstand zaehlt noch
      T.leeren();
      T.tippe('d', 15);
      const grenze = { timer: state.viperRolleTimer, sounds: T.rollen() };
      // Links und rechts im Wechsel ist kein Doppeltipp
      t.d = false; T.schritte(14);
      T.leeren();
      t.a = true; T.schritte(1); t.a = false; T.schritte(1);
      t.d = true; T.schritte(1); t.d = false; T.schritte(1);
      const gemischt = { timer: state.viperRolleTimer, sounds: T.rollen() };
      return { einzel, zuLangsam, grenze, gemischt };
    });
    expect(r.einzel).toEqual({ timer: [0, 0], sounds: 0 });
    expect(r.zuLangsam).toEqual({ timer: 0, sounds: 0 });
    expect(r.grenze).toEqual({ timer: 12, sounds: 1 });
    expect(r.gemischt).toEqual({ timer: 0, sounds: 0 });
  });

  test('Cooldown: zweiter Doppeltipp waehrend der 90 Schritte rollt nicht, danach wieder', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const t = state.tastenGedrueckt;
      T.leeren();
      state.x = 100;
      T.tippe('d'); // Rollenstart in diesem Schritt (Schritt 0 des Cooldowns)
      t.d = false;
      T.schritte(11); // Rolle vorbei bei Schritt 12
      T.schritte(1);
      const nachRolle = { timer: state.viperRolleTimer, cd: state.viperRolleCooldown };
      // Doppeltipp links mitten im Cooldown (um Schritt 30)
      T.schritte(15);
      T.tippe('a');
      t.a = false;
      T.schritte(2);
      const imCooldown = { timer: state.viperRolleTimer, sounds: T.rollen(), cd: state.viperRolleCooldown };
      // Cooldown laeuft ab: der letzte Tipp liegt kurz vor Ende, zaehlt also nicht; neuer Doppeltipp rollt
      T.schritte(100);
      const frei = state.viperRolleCooldown;
      const x0 = state.x;
      T.tippe('a');
      t.a = false;
      T.schritte(11);
      return { nachRolle, imCooldown, frei, nachZweiterRolle: { sounds: T.rollen(), dx: state.x - x0 } };
    });
    expect(r.nachRolle.timer).toBe(0);
    expect(r.nachRolle.cd).toBeGreaterThan(70);
    expect(r.imCooldown.timer).toBe(0);
    expect(r.imCooldown.sounds).toBe(1);
    expect(r.imCooldown.cd).toBeGreaterThan(0);
    expect(r.frei).toBe(0);
    expect(r.nachZweiterRolle.sounds).toBe(2);
    expect(r.nachZweiterRolle.dx).toBeLessThan(-60);
  });

  test('Cooldown endet genau 90 Schritte nach dem Rollenstart', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      T.leeren();
      state.x = 100;
      T.tippe('d');
      state.tastenGedrueckt.d = false;
      const werte = [state.viperRolleCooldown];
      T.schritte(89);
      werte.push(state.viperRolleCooldown);
      T.schritte(1);
      werte.push(state.viperRolleCooldown);
      return werte;
    });
    expect(r).toEqual([90, 1, 0]);
  });

  test('Unverwundbar waehrend der Rolle (stehender Feindlaser trifft nicht), danach trifft er', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__viperTest;
      const t = state.tastenGedrueckt;
      T.leeren();
      state.x = 100;
      t.d = true; T.schritte(1);
      t.d = false; T.schritte(1);
      // Stehender Laser mitten im Schiff (die Rolle beginnt im naechsten Schritt)
      Entities.erzeugeFeindLaser(state.x + 14, state.y + 10);
      Object.assign(arrays.feindLaserArray[0], { vx: 0, vy: 0 });
      t.d = true; T.schritte(1);
      t.d = false;
      const beiStart = { leben: state.leben, laser: arrays.feindLaserArray.length, unverwundbar: window.__game.Utils.istDashUnverwundbar(state) };
      T.schritte(11);
      const waehrendRolle = { leben: state.leben, laser: arrays.feindLaserArray.length };
      // Rolle ist vorbei: ein neuer stehender Laser am Schiff trifft
      T.schritte(1);
      const nachRolle = window.__game.Utils.istDashUnverwundbar(state);
      Entities.erzeugeFeindLaser(state.x + 14, state.y + 10);
      Object.assign(arrays.feindLaserArray[arrays.feindLaserArray.length - 1], { vx: 0, vy: 0 });
      T.schritte(1);
      return { beiStart, waehrendRolle, nachRolle, danach: { leben: state.leben } };
    });
    expect(r.beiStart).toEqual({ leben: 3, laser: 1, unverwundbar: true });
    expect(r.waehrendRolle).toEqual({ leben: 3, laser: 1 });
    expect(r.nachRolle).toBe(false);
    expect(r.danach.leben).toBe(2);
  });

  test('Am Spielfeldrand begrenzt, auch links', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state, config } = window.__game;
      const T = window.__viperTest;
      const t = state.tastenGedrueckt;
      const out = {};
      T.leeren();
      state.x = config.spielfeldBreite - config.spielerGroesse - 20;
      T.tippe('d'); t.d = false; T.schritte(11);
      out.rechts = state.x;
      out.rechtsMax = config.spielfeldBreite - config.spielerGroesse;
      T.leeren();
      state.x = 20;
      T.tippe('a'); t.a = false; T.schritte(11);
      out.links = state.x;
      return out;
    });
    expect(r.rechts).toBe(r.rechtsMax);
    expect(r.links).toBe(0);
  });

  test('Nur die Viper rollt: Phantom (P1) und Gleve ignorieren den Doppeltipp', async ({ page }) => {
    await starteSpiel(page, { p1: 'phantom' });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      T.leeren();
      state.x = 100;
      const t = state.tastenGedrueckt;
      t.d = true; T.schritte(1);
      t.d = false; T.schritte(1);
      const x0 = state.x;
      t.d = true; T.schritte(1);
      t.d = false; T.schritte(11);
      return { dx: state.x - x0, timer: state.viperRolleTimer, sounds: T.rollen(), klasse: document.getElementById('spieler').classList.contains('viper-rolle'),
        hud: document.getElementById('viper-rolle-hud').style.display };
    });
    // Normale Fahrt: hoechstens ein Schritt Geschwindigkeit, nie 70 px
    expect(Math.abs(r.dx)).toBeLessThan(20);
    expect(r.timer).toBe(0);
    expect(r.sounds).toBe(0);
    expect(r.klasse).toBe(false);
    expect(r.hud).toBe('none');
  });

  test('Steuerungs-Hack (invertiert) lenkt die Rolle um, waffenOffline blockiert sie nicht', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const out = {};
      T.leeren();
      state.x = 200;
      state.hacks = [{ typ: 'invertiert', timer: 999 }];
      const x0 = state.x;
      T.tippe('d'); state.tastenGedrueckt.d = false; T.schritte(11);
      out.invertiert = state.x - x0;
      T.leeren();
      state.x = 200;
      state.hacks = [{ typ: 'waffenOffline', timer: 999 }];
      const x1 = state.x;
      T.tippe('d'); state.tastenGedrueckt.d = false; T.schritte(11);
      out.waffenOffline = state.x - x1;
      return out;
    });
    // Der Tipp-Schritt selbst bewegt noch (invertiert: nach links) und zaehlt zur Differenz
    expect(r.invertiert).toBeLessThan(-60);
    expect(r.waffenOffline).toBeGreaterThan(60);
  });

  test('Mobil: schneller Wisch auf dem Joystick rollt, langsames Hineinziehen nicht', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const j = state.joystick;
      const out = {};
      T.leeren();
      state.x = 150;
      j.active = true;
      j.x = 0; T.schritte(2);
      const x0 = state.x;
      j.x = 1; T.schritte(1);
      out.wisch = { timer: state.viperRolleTimer, sounds: T.rollen() };
      T.schritte(11);
      out.wischDx = state.x - x0;
      j.active = false; j.x = 0; T.schritte(1);

      // Langsam: 0.05 pro Schritt bis 1.0
      T.leeren();
      state.x = 150;
      j.active = true;
      for (let k = 0; k <= 30; k++) { j.x = Math.min(1, k * 0.05); T.schritte(1); }
      out.langsam = { sounds: T.rollen(), timer: state.viperRolleTimer };
      j.active = false; j.x = 0;
      // Nach links
      T.leeren();
      state.x = 250;
      j.active = true;
      j.x = 0; T.schritte(2);
      const x1 = state.x;
      j.x = -1; T.schritte(12);
      out.linksDx = state.x - x1;
      j.active = false; j.x = 0;
      return out;
    });
    expect(r.wisch).toEqual({ timer: 12, sounds: 1 });
    // Der Joystick steht in diesem Schritt voll rechts; die Rolle ersetzt die Fahrt, es bleiben genau 70 px
    expect(r.wischDx).toBeCloseTo(70, 3);
    expect(r.langsam).toEqual({ sounds: 0, timer: 0 });
    expect(r.linksDx).toBeCloseTo(-70, 3);
  });

  test('Lokaler Coop: P2 rollt mit den Pfeiltasten, P1 mit A/D, unabhaengig voneinander', async ({ page }) => {
    await starteSpiel(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const t = state.tastenGedrueckt;
      T.leeren();
      state.p2IsBot = false;
      state.x = 100;
      state.p2.x = 200;
      // P2: Pfeil rechts doppelt
      t.arrowright = true; T.schritte(1);
      t.arrowright = false; T.schritte(1);
      const p2x0 = state.p2.x;
      const p1x0 = state.x;
      t.arrowright = true; T.schritte(1);
      t.arrowright = false; T.schritte(11);
      const p2 = { dx: state.p2.x - p2x0, timer: state.viperRolleTimer, cd: state.p2.viperRolleCooldown, p1dx: state.x - p1x0, p1cd: state.viperRolleCooldown };
      // P1: A doppelt (P1-Cooldown unabhaengig)
      T.leeren();
      state.p2IsBot = false;
      state.x = 200;
      state.p2.x = 100;
      t.a = true; T.schritte(1);
      t.a = false; T.schritte(1);
      const q1x0 = state.x;
      t.a = true; T.schritte(1);
      t.a = false; T.schritte(11);
      const p1 = { dx: state.x - q1x0, p2cd: state.p2.viperRolleCooldown, p2timer: state.p2.viperRolleTimer };
      return { p2, p1, klasse2: document.getElementById('spieler-2').classList.contains('viper-rolle'), hud2: document.getElementById('viper-rolle-hud-p2').style.display };
    });
    expect(r.p2.dx).toBeCloseTo(70, 3);
    expect(r.p2.timer).toBe(0);
    expect(r.p2.cd).toBeGreaterThan(70);
    expect(r.p2.p1dx).toBe(0);
    expect(r.p2.p1cd).toBe(0);
    expect(r.p1.dx).toBeCloseTo(-70, 3);
    expect(r.p1.p2cd).toBe(0);
    expect(r.p1.p2timer).toBe(0);
    expect(r.klasse2).toBe(false);
    expect(r.hud2).toBe('block');
  });

  test('HUD: Bereitschaftsanzeige nur bei Viper, gruen wenn bereit, fuellt sich im Cooldown', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state } = window.__game;
      const T = window.__viperTest;
      const hud = document.getElementById('viper-rolle-hud');
      T.leeren();
      T.schritte(2);
      const bereit = { anzeige: hud.style.display, bereit: hud.classList.contains('bereit') };
      T.tippe('d'); state.tastenGedrueckt.d = false;
      T.schritte(1);
      const laedt = { bereit: hud.classList.contains('bereit'), breite: parseFloat(hud.firstElementChild.style.width) };
      T.schritte(100);
      const wieder = { bereit: hud.classList.contains('bereit'), breite: parseFloat(hud.firstElementChild.style.width) };
      return { bereit, laedt, wieder };
    });
    expect(r.bereit).toEqual({ anzeige: 'block', bereit: true });
    expect(r.laedt.bereit).toBe(false);
    expect(r.laedt.breite).toBeLessThan(10);
    expect(r.wieder).toEqual({ bereit: true, breite: 100 });
  });
});

test.describe('Viper-X Ausweichrolle: Bot', () => {
  test('Bot-Viper rollt bei sehr nahem Geschoss zur freieren Seite und nicht im Cooldown', async ({ page }) => {
    await starteSpiel(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__viperTest;
      const out = {};
      const stehendesGeschoss = (p) => {
        Entities.erzeugeFeindLaser(p.x + 13, p.y - 17);
        Object.assign(arrays.feindLaserArray[arrays.feindLaserArray.length - 1], { vx: 0, vy: 0 });
      };
      const vorbereiten = (x) => {
        T.leeren();
        state.p2IsBot = true;
        state.p2BotDifficulty = 'hard';
        state.x = 340;
        state.p2.x = x;
        state.p2.y = 500;
      };

      // Nahe am linken Rand: die rechte Seite ist freier
      vorbereiten(30);
      stehendesGeschoss(state.p2);
      T.schritte(3);
      out.links = { timer: state.p2.viperRolleTimer, richtung: state.p2.viperRolleRichtung, sounds: T.rollen() };
      T.schritte(12);
      out.linksX = state.p2.x;

      // Nahe am rechten Rand: die linke Seite ist freier
      vorbereiten(window.__game.config.spielfeldBreite - 60);
      state.x = 20;
      stehendesGeschoss(state.p2);
      T.schritte(3);
      out.rechts = { richtung: state.p2.viperRolleRichtung, sounds: T.rollen() };

      // Cooldown frei, aber keine Gefahr: keine Rolle
      vorbereiten(200);
      T.schritte(20);
      out.ohneGefahr = T.rollen();

      // Im Cooldown rollt der Bot nicht, auch bei Gefahr
      vorbereiten(200);
      state.p2.viperRolleCooldown = 50;
      stehendesGeschoss(state.p2);
      T.schritte(3);
      out.imCooldown = T.rollen();
      return out;
    });
    expect(r.links.timer).toBeGreaterThan(0);
    expect(r.links.richtung).toBe(1);
    expect(r.links.sounds).toBe(1);
    expect(r.linksX).toBeGreaterThan(80);
    expect(r.rechts).toEqual({ richtung: -1, sounds: 1 });
    expect(r.ohneGefahr).toBe(0);
    expect(r.imCooldown).toBe(0);
  });

  test('Bot-Phantom rollt nie', async ({ page }) => {
    await starteSpiel(page, { coop: true, p2: 'phantom' });
    const r = await page.evaluate(() => {
      const { state, arrays, Entities } = window.__game;
      const T = window.__viperTest;
      T.leeren();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      state.p2.x = 200;
      state.p2.y = 500;
      Entities.erzeugeFeindLaser(213, 483);
      Object.assign(arrays.feindLaserArray[0], { vx: 0, vy: 0 });
      T.schritte(5);
      return { sounds: T.rollen(), timer: state.p2.viperRolleTimer };
    });
    expect(r).toEqual({ sounds: 0, timer: 0 });
  });
});

test.describe('Viper-X Ausweichrolle: Online', () => {
  // Online-Zustand ohne echte Verbindung: host = true Host, sonst Client (P2)
  async function alsOnline(page, host) {
    await page.evaluate((host) => {
      const { state, arrays, Utils } = window.__game;
      Utils.setGameMode('online');
      state.spielLaeuft = true;
      state.pausiert = false;
      state.cutsceneAktiv = false;
      state.gameOverAktiv = false;
      state.bossWarningAktiv = false;
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'viper';
      state.network.isOnline = true;
      state.network.isHost = host;
      state.network.isClient = !host;
      state.network.connected = true;
      state.frameZaehler = 1;
      ['feinde', 'asteroiden', 'bosses', 'powerups', 'laserArray', 'raketenArray', 'bombenArray',
        'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bossRaketenArray', 'bossBombenArray'].forEach(n => {
        arrays[n].forEach(o => { if (o.el) o.el.remove(); });
        arrays[n].length = 0;
      });
      Object.keys(state.tastenGedrueckt).forEach(k => { state.tastenGedrueckt[k] = false; });
    }, host);
  }

  test('Host serialisiert den Rollen-Zustand beider Schiffe, er ueberlebt die Netzkodierung und der Client zeigt die Klasse', async ({ page }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await alsOnline(page, true);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const { state } = g;
      const NK = await import('./js/netzkodierung.js');
      const out = {};
      state.viperRolleTimer = 7;
      state.viperRolleRichtung = -1;
      state.viperRolleCooldown = 61.4;
      state.p2.viperRolleTimer = 0;
      state.p2.viperRolleCooldown = 33;
      const voll = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
      out.p1 = [voll.p1.viperRolleTimer, voll.p1.viperRolleRichtung, voll.p1.viperRolleCooldown];
      out.p2 = [voll.p2.viperRolleTimer, voll.p2.viperRolleCooldown];

      // Nicht-Viper traegt keine Rollenfelder
      state.p2.selectedShipModel = 'phantom';
      out.phantomFelder = 'viperRolleTimer' in g.Network.serializeGameState().p2;
      state.p2.selectedShipModel = 'viper';

      // Kodieren und dekodieren wie auf dem Draht (Rundung ganzzahlig)
      const kodierer = new NK.SnapshotKodierer();
      const dekodierer = new NK.SnapshotDekodierer();
      const rekon = dekodierer.dekodiere(JSON.parse(JSON.stringify(kodierer.kodiere(voll, 0))));
      out.draht = [rekon.p1.viperRolleTimer, rekon.p1.viperRolleRichtung, rekon.p1.viperRolleCooldown, rekon.p2.viperRolleCooldown];

      // Client uebernimmt: Host-P1 rollt noch 7 Schritte
      state.network.isHost = false;
      state.network.isClient = true;
      state.viperRolleTimer = 0;
      state.viperRolleCooldown = 0;
      g.Network.applyGameStateSnapshot(rekon);
      g.Audio.clearAudioHistory();
      out.cooldownClient = state.p2.viperRolleCooldown;
      const el = document.getElementById('spieler');
      const klassen = [];
      for (let i = 0; i < 9; i++) {
        g.Loop.simulationsSchritt();
        klassen.push(el.classList.contains('viper-rolle'));
      }
      out.klassen = klassen;
      out.cooldownNachSchritten = state.p2.viperRolleCooldown;
      return out;
    });
    // Serialisiert wird der Rohwert, gerundet wird erst beim Kodieren
    expect(r.p1).toEqual([7, -1, 61.4]);
    expect(r.p2).toEqual([0, 33]);
    expect(r.phantomFelder).toBe(false);
    expect(r.draht).toEqual([7, -1, 61, 33]);
    // 7 Restschritte aus dem Snapshot: Klasse in den ersten 7 Client-Schritten, dann weg
    expect(r.klassen).toEqual([true, true, true, true, true, true, true, false, false]);
    expect(r.cooldownClient).toBe(33);
    // Der Client zaehlt den uebernommenen Cooldown selbst weiter herunter
    expect(r.cooldownNachSchritten).toBe(24);
  });

  test('Client sagt die eigene Rolle voraus und meldet Start und Richtung; der Host rollt von dort aus', async ({ page }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await alsOnline(page, false);
    const paket = await page.evaluate(() => {
      const g = window.__game;
      const { state } = g;
      const t = state.tastenGedrueckt;
      const el = document.getElementById('spieler-2');
      state.p2.x = 150;
      state.p2.y = 400;
      state.p2.viperRolleCooldown = 0;
      const pakete = [];
      const schritt = () => { g.Loop.simulationsSchritt(); pakete.push(g.Network.serializePlayerInput()); };
      t.d = true; schritt();
      t.d = false; schritt();
      const x0 = state.p2.x;
      t.d = true; schritt();
      t.d = false;
      const klasseNachStart = el.classList.contains('viper-rolle');
      for (let i = 0; i < 11; i++) schritt();
      return { pakete: pakete.map(p => ({ x: p.x, ro: p.ro })), x0, xEnde: state.p2.x, klasseNachStart };
    });
    // Start-Paket traegt die Position vor der Rolle und die Richtung, nur dieses
    expect(paket.pakete[2]).toEqual({ x: paket.x0, ro: 1 });
    expect(paket.pakete.filter(p => p.ro !== undefined)).toHaveLength(1);
    expect(paket.klasseNachStart).toBe(true);
    expect(paket.xEnde - paket.x0).toBeCloseTo(70, 3);

    // Host: Start-Paket empfangen, danach rollt P2 dort 12 Schritte, ignoriert Client-Positionen und ist unverwundbar
    await alsOnline(page, true);
    const host = await page.evaluate(async (p) => {
      const g = window.__game;
      const { state, arrays, Entities } = g;
      const NK = await import('./js/netzkodierung.js');
      const out = {};
      state.p2.viperRolleTimer = 0;
      state.p2.viperRolleCooldown = 0;
      state.p2.isDead = false;
      state.p2.leben = 3;
      state.p2.y = 400;
      // Der Sender schickt das Start-Paket sofort
      const sender = new NK.EingabeSender();
      const eingabe = { x: p.x0, y: 400, rotate: 0, laser: false, rakete: false, bombe: false };
      sender.naechstes(eingabe);
      const startPaket = sender.naechstes({ ...eingabe, ro: 1 });
      out.senderPaket = startPaket ? startPaket.ro : null;
      g.Network.applyPlayerInput({ ...eingabe, ro: 1 });
      // Falsche Richtungswerte werden ignoriert
      out.mitRo = state.p2.netzRolleAnfrage;
      // Nachfolgendes Client-Paket mit weiterer Position darf den Startpunkt nicht verschieben
      g.Network.applyPlayerInput({ ...eingabe, x: p.x0 + 12 });
      out.xVorStart = state.p2.x;
      Entities.erzeugeFeindLaser(p.x0 + 14, 410);
      Object.assign(arrays.feindLaserArray[0], { vx: 0, vy: 0 });
      g.Loop.simulationsSchritt();
      out.nachStart = { timer: state.p2.viperRolleTimer, klasse: document.getElementById('spieler-2').classList.contains('viper-rolle'), leben: state.p2.leben, cd: state.p2.viperRolleCooldown };
      // Client-Positionen waehrend der Rolle werden ignoriert
      g.Network.applyPlayerInput({ ...eingabe, x: 5 });
      for (let i = 0; i < 11; i++) g.Loop.simulationsSchritt();
      out.dx = state.p2.x - p.x0;
      out.leben = state.p2.leben;
      out.snapshot = [g.Network.serializeGameState().p2.viperRolleTimer, g.Network.serializeGameState().p2.viperRolleCooldown];
      g.Loop.simulationsSchritt();
      out.danach = state.p2.viperRolleTimer;
      // Eine zweite Anfrage im Cooldown wird abgelehnt
      g.Network.applyPlayerInput({ ...eingabe, x: state.p2.x, ro: -1 });
      g.Loop.simulationsSchritt();
      out.zweite = state.p2.viperRolleTimer;
      return out;
    }, paket);
    expect(host.senderPaket).toBe(1);
    expect(host.mitRo).toBe(1);
    expect(host.xVorStart).toBeCloseTo(paket.x0, 3);
    expect(host.nachStart.timer).toBe(12);
    expect(host.nachStart.klasse).toBe(true);
    expect(host.nachStart.leben).toBe(3);
    expect(host.nachStart.cd).toBe(90);
    expect(host.dx).toBeCloseTo(70, 3);
    expect(host.leben).toBe(3);
    expect(host.snapshot[0]).toBe(1);
    expect(host.snapshot[1]).toBeGreaterThan(70);
    expect(host.danach).toBe(0);
    expect(host.zweite).toBe(0);
  });
});

// --- Near-Miss + Overdrive ---
// Ein feindliches Geschoss, das dem Schiff auf <= 18 px nahe kommt, ohne zu treffen, und sich dann entfernt,
// laedt die Overdrive-Leiste um 10. Bei 100 startet der Overdrive fuer 300 Schritte (doppelte Feuerrate, Durchschlag).

// Feindlichen Laser (kein Zielen, gerade nach unten) mit linker Kante x ueber dem Schiff erzeugen
async function nearMissBahn(page, { x, liste = 'feindLaserArray', harmlos = false, ys = [300], schritte = 60 }) {
  return page.evaluate(({ x, liste, harmlos, ys, schritte }) => {
    const { state, arrays } = window.__game;
    const T = window.__viperTest;
    T.leeren();
    state.viperOverdriveLeiste = 0;
    state.viperOverdriveTimer = 0;
    state.x = 150;
    state.y = 400;
    ys.forEach((y, i) => {
      const el = document.createElement('div');
      el.classList.add('feind-laser');
      document.getElementById('spielfeld').appendChild(el);
      arrays[liste].push({ id: 'nm' + i, el, x, y, vx: 0, vy: 5, width: 4, height: 15, harmlos: harmlos || undefined });
    });
    const leben = state.leben;
    T.schritte(schritte);
    return {
      leiste: state.viperOverdriveLeiste,
      timer: state.viperOverdriveTimer,
      leben: state.leben,
      verloren: leben - state.leben,
      ticks: window.__game.Audio.audioHistory.filter(a => a.name === 'nearMiss').length,
      plus: document.querySelectorAll('.viper-nearmiss-plus').length
    };
  }, { x, liste, harmlos, ys, schritte });
}

test.describe('Viper-X Near-Miss und Overdrive', () => {
  test('Geschoss 10 px neben dem Schiff: +10, nur einmal; 30 px daneben: 0; Treffer: 0; harmlos: 0', async ({ page }) => {
    await starteSpiel(page);
    // Schiff x 150..180; Laser-Kante bei 190 = 10 px Abstand
    const nah = await nearMissBahn(page, { x: 190 });
    expect(nah.leiste).toBe(10);
    expect(nah.ticks).toBe(1);
    expect(nah.verloren).toBe(0);
    // weitere Schritte zaehlen dasselbe Geschoss nicht noch einmal (ist laengst aus dem Feld, Leiste bleibt)
    const ueberlappt = await page.evaluate(() => { window.__viperTest.schritte(30); return window.__game.state.viperOverdriveLeiste; });
    expect(ueberlappt).toBe(10);
    // Linke Seite: Laser rechts der Kante 150: Mitte 142 -> Abstand 150 - (142 + 4) = 4
    expect((await nearMissBahn(page, { x: 142 })).leiste).toBe(10);
    // 30 px daneben
    const fern = await nearMissBahn(page, { x: 210 });
    expect(fern.leiste).toBe(0);
    expect(fern.ticks).toBe(0);
    // genau 18 px zaehlt, 19 px nicht
    expect((await nearMissBahn(page, { x: 198 })).leiste).toBe(10);
    expect((await nearMissBahn(page, { x: 199 })).leiste).toBe(0);
    // Treffer zaehlt nicht
    const treffer = await nearMissBahn(page, { x: 165 });
    expect(treffer.leiste).toBe(0);
    expect(treffer.verloren).toBe(1);
    // harmlos (von der Gleve weggeschleudert) zaehlt nicht
    expect((await nearMissBahn(page, { x: 190, harmlos: true })).leiste).toBe(0);
    // Boss-Laser zaehlt wie Feind-Laser
    expect((await nearMissBahn(page, { x: 190, liste: 'bossLaserArray' })).leiste).toBe(10);
    // Zwei Geschosse nacheinander: +20
    expect((await nearMissBahn(page, { x: 190, ys: [300, 330] })).leiste).toBe(20);
  });

  test('waehrend der Ausweichrolle zaehlt ein Near-Miss ebenfalls; mehrere Geschosse mit Hack-Projektil und Rakete', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.leeren();
      state.viperOverdriveLeiste = 0;
      state.viperOverdriveTimer = 0;
      // Rolle laeuft (Richtung 0: das Schiff bleibt stehen), unverwundbar
      state.viperRolleTimer = 200;
      state.viperRolleRichtung = 0;
      const neu = (liste, extra) => {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays[liste].push({ id: 'x' + liste, el, x: 190, y: 300, vx: 0, vy: 5, width: 4, height: 15, ...extra });
      };
      neu('feindLaserArray', {});
      neu('hackProjektilArray', { y: 280, lenkZeit: 0, width: 6, height: 6 });
      neu('bossRaketenArray', { y: 260, hp: 5, width: 10, height: 20, speed: 5, turnRate: 0 });
      T.schritte(40);
      return state.viperOverdriveLeiste;
    });
    expect(r).toBe(30);
  });

  test('10 Near-Misses starten den Overdrive fuer 300 Schritte, die Leiste leert sich, danach aus', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      const out = {};
      T.leeren();
      state.viperOverdriveLeiste = 0;
      state.viperOverdriveTimer = 0;
      for (let i = 0; i < 10; i++) {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays.feindLaserArray.push({ id: 'od' + i, el, x: 190, y: 100 + i * 20, vx: 0, vy: 5, width: 4, height: 15 });
      }
      T.schritte(100);
      const klasse = () => document.getElementById('spieler').classList.contains('viper-overdrive');
      out.start = [state.viperOverdriveLeiste, state.viperOverdriveTimer, klasse()];
      out.sounds = [
        window.__game.Audio.audioHistory.filter(a => a.name === 'overdrive').length,
        window.__game.Audio.audioHistory.filter(a => a.name === 'nearMiss').length
      ];
      const timerNachStart = state.viperOverdriveTimer;
      // weitere Near-Misses laden waehrend des Overdrives nicht nach
      const el = document.createElement('div');
      document.getElementById('spielfeld').appendChild(el);
      arrays.feindLaserArray.push({ id: 'extra', el, x: 190, y: 300, vx: 0, vy: 5, width: 4, height: 15 });
      const t0 = timerNachStart;
      T.schritte(60);
      out.mitte = [state.viperOverdriveLeiste, state.viperOverdriveTimer, t0 - state.viperOverdriveTimer, klasse()];
      out.hud = document.getElementById('viper-overdrive-hud').classList.contains('aktiv');
      T.schritte(timerNachStart - 60 - 1);
      out.fast = [state.viperOverdriveTimer, klasse()];
      T.schritte(1);
      out.aus = [state.viperOverdriveLeiste, state.viperOverdriveTimer, klasse()];
      out.hudAus = document.getElementById('viper-overdrive-hud').classList.contains('aktiv');
      return out;
    });
    expect(r.start[0]).toBeGreaterThan(50);
    expect(r.start[1]).toBeGreaterThan(0);
    expect(r.start[2]).toBe(true);
    expect(r.sounds).toEqual([1, 9]);
    expect(r.mitte[2]).toBe(60);
    expect(r.mitte[0]).toBeLessThan(r.start[0]);
    expect(r.mitte[3]).toBe(true);
    expect(r.hud).toBe(true);
    expect(r.fast).toEqual([1, true]);
    expect(r.aus).toEqual([0, 0, false]);
    expect(r.hudAus).toBe(false);
  });

  test('Overdrive dauert genau 300 Schritte ab Start', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.leeren();
      state.viperOverdriveLeiste = 90;
      state.viperOverdriveTimer = 0;
      const el = document.createElement('div');
      document.getElementById('spielfeld').appendChild(el);
      arrays.feindLaserArray.push({ id: 'z', el, x: 190, y: 380, vx: 0, vy: 5, width: 4, height: 15 });
      let start = null;
      for (let i = 1; i <= 20 && start === null; i++) {
        T.schritte(1);
        if (state.viperOverdriveTimer > 0) start = i;
      }
      const t = state.viperOverdriveTimer;
      let dauer = 0;
      while (state.viperOverdriveTimer > 0 && dauer < 400) { T.schritte(1); dauer++; }
      return { t, leiste: state.viperOverdriveLeiste, dauer };
    });
    expect(r.t).toBe(300);
    expect(r.dauer).toBe(300);
    expect(r.leiste).toBe(0);
  });

  test('im Overdrive halbe Schussabstaende und Durchschlag, ausserhalb nicht', async ({ page }) => {
    await starteSpiel(page);
    const messe = (overdrive) => page.evaluate((overdrive) => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.leeren();
      state.laserStufe = 1;
      state.laserDurchschlag = false;
      state.energie = 50;
      state.maxEnergie = 50;
      state.unbegrenzteEnergie = true;
      state.spielerSchussCooldown = 0;
      state.viperOverdriveLeiste = overdrive ? 100 : 0;
      state.viperOverdriveTimer = overdrive ? 300 : 0;
      // zwei hintereinander stehende, ruhende Ziele ueber dem Schiff
      const ziele = [300, 200].map((y, i) => {
        const el = document.createElement('div');
        el.classList.add('asteroid');
        document.getElementById('spielfeld').appendChild(el);
        const a = { id: 'ziel' + i, el, x: 140, y, groesse: 50, vx: 0, vy: 0, immune: 0, hp: 100000, maxHp: 100000,
          istMagma: false, istUnzerstoerbar: false, traegtPowerup: false, rissEl: null, istFeind: false, rot: 0, vRot: 0 };
        arrays.asteroiden.push(a);
        return a;
      });
      const ids = new Set();
      state.tastenGedrueckt.l = true;
      for (let i = 0; i < 30; i++) {
        T.schritte(1);
        arrays.laserArray.forEach(l => ids.add(l.id));
      }
      state.tastenGedrueckt.l = false;
      return { schuesse: ids.size, hp: ziele.map(z => z.hp) };
    }, overdrive);
    const normal = await messe(false);
    const od = await messe(true);
    expect(normal.hp[0]).toBeLessThan(100000);
    expect(normal.hp[1]).toBe(100000);
    expect(od.hp[0]).toBeLessThan(100000);
    expect(od.hp[1]).toBeLessThan(100000);
    expect(normal.schuesse).toBe(5);
    expect(od.schuesse).toBe(10);
  });

  test('Phantom bekommt keinen Overdrive und keine Leiste im HUD', async ({ page }) => {
    await starteSpiel(page, { p1: 'phantom' });
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.leeren();
      state.viperOverdriveLeiste = 0;
      state.viperOverdriveTimer = 0;
      for (let i = 0; i < 12; i++) {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays.feindLaserArray.push({ id: 'ph' + i, el, x: 190, y: 100 + i * 20, vx: 0, vy: 5, width: 4, height: 15 });
      }
      T.schritte(100);
      return {
        leiste: state.viperOverdriveLeiste,
        timer: state.viperOverdriveTimer,
        hud: document.getElementById('viper-overdrive-hud').style.display,
        klasse: document.getElementById('spieler').classList.contains('viper-overdrive')
      };
    });
    expect(r).toEqual({ leiste: 0, timer: 0, hud: 'none', klasse: false });
  });

  test('Neustart setzt Leiste und Overdrive zurueck', async ({ page }) => {
    await starteSpiel(page);
    const r = await page.evaluate(() => {
      const { state, Utils } = window.__game;
      state.viperOverdriveLeiste = 70;
      state.viperOverdriveTimer = 120;
      state.p2.viperOverdriveLeiste = 30;
      Utils.restartGame();
      return [state.viperOverdriveLeiste, state.viperOverdriveTimer, state.p2.viperOverdriveLeiste];
    });
    expect(r).toEqual([0, 0, 0]);
  });

  test('Bot-Viper sammelt Near-Misses ohne Fehler', async ({ page }) => {
    await starteSpiel(page, { coop: true });
    const r = await page.evaluate(() => {
      const { state, arrays } = window.__game;
      const T = window.__viperTest;
      T.leeren();
      state.p2IsBot = true;
      state.p2BotDifficulty = 'hard';
      state.p2.viperOverdriveLeiste = 0;
      state.p2.viperOverdriveTimer = 0;
      state.x = 340;
      state.p2.x = 150;
      state.p2.y = 400;
      const fehler = [];
      window.addEventListener('error', e => fehler.push(e.message));
      for (let i = 0; i < 6; i++) {
        const el = document.createElement('div');
        document.getElementById('spielfeld').appendChild(el);
        arrays.feindLaserArray.push({ id: 'b' + i, el, x: 192, y: 100 + i * 25, vx: 0, vy: 5, width: 4, height: 15 });
      }
      T.schritte(120);
      return { fehler, leistePlausibel: state.p2.viperOverdriveLeiste >= 0 && state.p2.viperOverdriveLeiste <= 100, leben: state.p2.leben };
    });
    expect(r.fehler).toEqual([]);
    expect(r.leistePlausibel).toBe(true);
  });
});

test.describe('Viper-X Near-Miss und Overdrive: Online', () => {
  async function alsOnline(page, host) {
    await page.evaluate((host) => {
      const { state, arrays, Utils } = window.__game;
      Utils.setGameMode('online');
      state.spielLaeuft = true;
      state.pausiert = false;
      state.cutsceneAktiv = false;
      state.gameOverAktiv = false;
      state.bossWarningAktiv = false;
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'viper';
      state.network.isOnline = true;
      state.network.isHost = host;
      state.network.isClient = !host;
      state.network.connected = true;
      state.frameZaehler = 1;
      ['feinde', 'asteroiden', 'bosses', 'powerups', 'laserArray', 'raketenArray', 'bombenArray',
        'feindLaserArray', 'hackProjektilArray', 'bossLaserArray', 'bossRaketenArray', 'bossBombenArray'].forEach(n => {
        arrays[n].forEach(o => { if (o.el) o.el.remove(); });
        arrays[n].length = 0;
      });
      Object.keys(state.tastenGedrueckt).forEach(k => { state.tastenGedrueckt[k] = false; });
    }, host);
  }

  test('Snapshot enthaelt Leiste und Overdrive-Timer (ganzzahlig), der Client zeigt die Klasse und spielt die Sounds fuer das eigene Schiff', async ({ page }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await alsOnline(page, true);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const { state } = g;
      const NK = await import('./js/netzkodierung.js');
      const out = {};
      state.viperOverdriveLeiste = 50;
      state.viperOverdriveTimer = 150.4;
      state.p2.viperOverdriveLeiste = 40;
      state.p2.viperOverdriveTimer = 0;
      const voll = JSON.parse(JSON.stringify(g.Network.serializeGameState()));
      out.roh = [voll.p1.viperOverdriveLeiste, voll.p1.viperOverdriveTimer, voll.p2.viperOverdriveLeiste, voll.p2.viperOverdriveTimer];
      state.p2.selectedShipModel = 'phantom';
      out.phantomFelder = 'viperOverdriveLeiste' in g.Network.serializeGameState().p2;
      state.p2.selectedShipModel = 'viper';
      const kodierer = new NK.SnapshotKodierer();
      const dekodierer = new NK.SnapshotDekodierer();
      const rekon = dekodierer.dekodiere(JSON.parse(JSON.stringify(kodierer.kodiere(voll, 0))));
      out.draht = [rekon.p1.viperOverdriveLeiste, rekon.p1.viperOverdriveTimer, rekon.p2.viperOverdriveLeiste, rekon.p2.viperOverdriveTimer];

      // Client: Host-P1 im Overdrive, eigenes Schiff (P2) lernt einen Near-Miss kennen
      state.network.isHost = false;
      state.network.isClient = true;
      state.viperOverdriveLeiste = 0;
      state.viperOverdriveTimer = 0;
      state.p2.viperOverdriveLeiste = 30;
      state.p2.viperOverdriveTimer = 0;
      g.Audio.clearAudioHistory();
      g.Network.applyGameStateSnapshot(rekon);
      g.Loop.simulationsSchritt();
      out.klasseP1 = document.getElementById('spieler').classList.contains('viper-overdrive');
      out.hudP1 = document.getElementById('viper-overdrive-hud').classList.contains('aktiv');
      out.klasseP2 = document.getElementById('spieler-2').classList.contains('viper-overdrive');
      out.leisteClientP2 = state.p2.viperOverdriveLeiste;
      out.tickAudio = g.Audio.audioHistory.filter(a => a.name === 'nearMiss').length;
      // eigener Overdrive startet
      const kopie = JSON.parse(JSON.stringify(rekon));
      kopie.p2.viperOverdriveLeiste = 100;
      kopie.p2.viperOverdriveTimer = 300;
      g.Network.applyGameStateSnapshot(kopie);
      g.Loop.simulationsSchritt();
      out.klasseP2Danach = document.getElementById('spieler-2').classList.contains('viper-overdrive');
      out.overdriveAudio = g.Audio.audioHistory.filter(a => a.name === 'overdrive').length;
      return out;
    });
    expect(r.roh).toEqual([50, 150.4, 40, 0]);
    expect(r.phantomFelder).toBe(false);
    expect(r.draht).toEqual([50, 150, 40, 0]);
    expect(r.klasseP1).toBe(true);
    expect(r.hudP1).toBe(true);
    expect(r.klasseP2).toBe(false);
    expect(r.leisteClientP2).toBe(40);
    expect(r.tickAudio).toBe(1);
    expect(r.klasseP2Danach).toBe(true);
    expect(r.overdriveAudio).toBe(1);
  });

  test('Host erkennt Near-Miss des Client-Schiffs (P2) und serialisiert die Leiste', async ({ page }) => {
    await page.waitForFunction(() => window.__game && window.__game.state);
    await alsOnline(page, true);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const { state, arrays } = g;
      state.p2.x = 250;
      state.p2.y = 400;
      state.p2.isDead = false;
      state.p2.viperOverdriveLeiste = 0;
      state.p2.viperOverdriveTimer = 0;
      const el = document.createElement('div');
      document.getElementById('spielfeld').appendChild(el);
      arrays.feindLaserArray.push({ id: 'h', el, x: 290, y: 300, vx: 0, vy: 5, width: 4, height: 15 });
      for (let i = 0; i < 40; i++) g.Loop.simulationsSchritt();
      return [state.p2.viperOverdriveLeiste, g.Network.serializeGameState().p2.viperOverdriveLeiste];
    });
    expect(r).toEqual([10, 10]);
  });
});
