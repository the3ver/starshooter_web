const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // Standardmäßig als bereits gesehen markieren, damit die Tests direkt interagieren können
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.6.8');
  });
  await page.goto('/');
});

test.describe('Space Shooter', () => {

  test('Das Spiel lädt und der Start-Text wird angezeigt', async ({ page }) => {
    const startText = page.locator('#start-text');
    await expect(startText).toBeVisible();
    await expect(startText).toContainText('TAP OR PRESS ANY KEY TO START');
  });

  test('Spielerschiff ist im DOM vorhanden', async ({ page }) => {
    const spieler = page.locator('#spieler');
    await expect(spieler).toBeAttached();
  });

  test('Lebensanzeige ist beim Start sichtbar und zeigt 3 Herzen', async ({ page }) => {
    const lebenAnzeige = page.locator('#leben-anzeige');
    await expect(lebenAnzeige).toBeVisible();
    const herzen = page.locator('#leben-anzeige .leben-herz');
    await expect(herzen).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(herzen.nth(i)).toHaveText('♥');
    }
  });

  test('Energie- und Cooldown-Balken zeigen kreisfoermige Powerup-Buchstaben E, R und B', async ({ page }) => {
    const energieLetter = page.locator('#energie-cd-container .cooldown-letter-e');
    await expect(energieLetter).toBeVisible();
    await expect(energieLetter).toHaveText('E');

    const raketenLetter = page.locator('#raketen-cd-container .cooldown-letter-r');
    await expect(raketenLetter).toBeVisible();
    await expect(raketenLetter).toHaveText('R');

    const bombenLetter = page.locator('#bomben-cd-container .cooldown-letter-b');
    await expect(bombenLetter).toBeVisible();
    await expect(bombenLetter).toHaveText('B');

    // Prüfen, dass die Badges kreisförmig sind (border-radius 50%)
    const borderRadius = await energieLetter.evaluate(el => window.getComputedStyle(el).borderRadius);
    expect(borderRadius).toBe('50%');
  });
  
  test('Spiel startet nach Tastendruck und Sterne fliegen', async ({ page }) => {
    // Vorher ist spielLaeuft false
    const startText = page.locator('#start-text');
    await expect(startText).toBeVisible();

    // Tastendruck simulieren (gedrückt halten, damit der Game-Loop es im nächsten Frame registriert)
    await page.keyboard.down('w');

    // Start-Text verschwindet
    await expect(startText).toBeHidden();
    
    // Taste wieder loslassen
    await page.keyboard.up('w');
  });

  test('Bombe besitzt Level-spezifische Aura (Lvl 1)', async ({ page }) => {
    // Spiel starten
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(50);

    // Bombe abfeuern mit Leertaste
    await page.keyboard.down('Space');
    const bombeAura = page.locator('.bomben-projektil.bombe-lvl-1 .bombe-aura');
    await expect(bombeAura).toBeAttached();
    await page.keyboard.up('Space');
  });

  test('Stufe 5 Jericho-Bombe teilt sich in 4 Mini-Bomben auf', async ({ page }) => {
    // Spiel starten und Bombenstufe 5 setzen
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.bombenStufe = 5;
      stateMod.state.bombenCooldown = 0;
    });

    // Bombe abfeuern
    await page.keyboard.down('Space');
    const bombeLvl5 = page.locator('.bomben-projektil.bombe-lvl-5').first();
    await expect(bombeLvl5).toBeAttached();
    await page.keyboard.up('Space');

    // Warten auf den Jericho-Split (Mini-Bomben)
    const miniBomben = page.locator('.bomben-projektil.bombe-mini');
    await expect(miniBomben.first()).toBeAttached({ timeout: 5000 });
  });

  test('Stufe 4 Bombe loescht feindliche Laser ohne Exception (EMP-Effekt)', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // Spiel starten
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Feindlaser und Stufe 4 Bombe erzeugen
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      stateMod.state.bombenStufe = 4;
      stateMod.state.bombenCooldown = 0;
      entitiesMod.erzeugeFeindLaser(150, 100);
      entitiesMod.erzeugeBossLaser(200, 100);
    });

    // Bombe abfeuern mit Leertaste
    await page.keyboard.down('Space');
    await page.waitForTimeout(200);
    await page.keyboard.up('Space');

    // Pruefen, dass keine Exception geworfen wurde
    expect(pageErrors).toEqual([]);

    // Pruefen, dass Feindlaser durch EMP entfernt wurden
    const laserCount = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.feindLaserArray.length + stateMod.arrays.bossLaserArray.length;
    });
    expect(laserCount).toBe(0);
  });

  test('Cheatcodes idkf1 bis idkf5 setzen alle Waffenstufen (1 bis 5), resetten Cooldowns und zeigen Overlay', async ({ page }) => {
    // Spiel starten
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    for (let lvl = 1; lvl <= 5; lvl++) {
      // Cooldowns künstlich hochsetzen
      await page.evaluate(async () => {
        const stateMod = await import('./js/state.js');
        stateMod.state.bombenCooldown = 500;
        stateMod.state.raketenCooldown = 200;
        stateMod.state.energie = 5;
      });

      const cheat = `idkf${lvl}`;
      for (const char of cheat) {
        await page.keyboard.press(char);
        await page.waitForTimeout(20);
      }

      const stufen = await page.evaluate(async () => {
        const stateMod = await import('./js/state.js');
        return {
          laser: stateMod.state.laserStufe,
          raketen: stateMod.state.raketenStufe,
          bomben: stateMod.state.bombenStufe,
          cheatUsed: stateMod.state.cheatUsed,
          bombenCooldown: stateMod.state.bombenCooldown,
          raketenCooldown: stateMod.state.raketenCooldown,
          energie: stateMod.state.energie,
          maxEnergie: stateMod.state.maxEnergie
        };
      });

      expect(stufen.laser).toBe(lvl);
      expect(stufen.raketen).toBe(lvl);
      expect(stufen.bomben).toBe(lvl);
      expect(stufen.cheatUsed).toBe(true);
      expect(stufen.bombenCooldown).toBe(0);
      expect(stufen.raketenCooldown).toBe(0);
      expect(stufen.energie).toBe(stufen.maxEnergie);

      const overlay = page.locator('#warning-overlay');
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText(`IDKF${lvl}`);
    }
  });

  test('Cheatcodes idkfl1 bis idkfl9 springen direkt in das entsprechende Level und aktualisieren das UI', async ({ page }) => {
    // Spiel starten
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    for (const lvl of [1, 3, 5, 9]) {
      const cheat = `idkfl${lvl}`;
      for (const char of cheat) {
        await page.keyboard.press(char);
        await page.waitForTimeout(20);
      }

      const stateInfo = await page.evaluate(async () => {
        const stateMod = await import('./js/state.js');
        return {
          level: stateMod.state.level,
          cheatUsed: stateMod.state.cheatUsed
        };
      });

      expect(stateInfo.level).toBe(lvl);
      expect(stateInfo.cheatUsed).toBe(true);

      const levelAnzeige = page.locator('#level-anzeige');
      await expect(levelAnzeige).toHaveText(`LEVEL ${lvl}`);

      const overlay = page.locator('#warning-overlay');
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText(`IDKFL${lvl}`);
    }
  });

  test('Highscore-Eingabefeld wird bei Game Over automatisch fokussiert', async ({ page }) => {
    // Spiel starten
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // GameOver über State & spielerGetroffen simulieren
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.leben = 1;
      stateMod.state.score = 500;
      utilsMod.spielerGetroffen({ x: 0, y: 0, el: document.createElement('div') }, false);
    });

    const hsForm = page.locator('#highscore-form');
    await expect(hsForm).toBeVisible();

    const hsInput = page.locator('#highscore-name');
    await expect(hsInput).toBeFocused();

    // Direkt lostippen und mit Enter speichern
    await page.keyboard.type('XYZ');
    await page.keyboard.press('Enter');

    await expect(hsForm).toBeHidden();
    const table = page.locator('#highscore-tabelle');
    await expect(table).toContainText('XYZ');
  });

  test('Highscore-Tabelle speichert und zeigt den verwendeten Schiffstyp hinter jedem Highscore an', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    await page.evaluate(async () => {
      const utilsMod = await import('./js/utils.js');
      localStorage.removeItem('spaceShooterHighscores');
      utilsMod.saveHighscore('VIP', 800, 'viper');
      utilsMod.saveHighscore('PHA', 1200, 'phantom');
      utilsMod.renderHighscores();
    });

    const rows = page.locator('#highscore-body tr');
    await expect(rows).toHaveCount(2);

    // Erste Zeile: PHA mit 1200 und Phantom-NX
    const row1 = rows.nth(0);
    await expect(row1).toContainText('PHA');
    await expect(row1).toContainText('1200');
    await expect(row1).toContainText('Phantom-NX');

    // Zweite Zeile: VIP mit 800 und Viper-X
    const row2 = rows.nth(1);
    await expect(row2).toContainText('VIP');
    await expect(row2).toContainText('800');
    await expect(row2).toContainText('Viper-X');
  });

  test('Ab Stufe 2 besitzen Raketen ein Heavy-Warhead-Design mit Canards', async ({ page }) => {
    // Spiel starten und Raketenstufe 2 setzen
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.raketenStufe = 2;
      stateMod.state.raketenCooldown = 0;
    });

    // Raketen mit Taste K abfeuern
    await page.keyboard.down('k');
    const heavyRocket = page.locator('.raketen-projektil.rakete-lvl-2');
    await expect(heavyRocket).toBeAttached();
    const canards = page.locator('.raketen-projektil.rakete-lvl-2 .rakete-canards');
    await expect(canards).toBeAttached();
    await page.keyboard.up('k');
  });

  test('Ab Stufe 3 ist eine Rakete zielsuchend (Homing) gegen Feinde', async ({ page }) => {
    // Spiel starten und Raketenstufe 3 setzen
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      stateMod.state.raketenStufe = 3;
      stateMod.state.raketenCooldown = 0;
      // Feind rechts oben platzieren
      entitiesMod.erzeugeFeind(300, 50, 'normal', 0);
    });

    // Raketen mit Taste K abfeuern
    await page.keyboard.down('k');
    const homingRocket = page.locator('.raketen-projektil.rakete-homing');
    await expect(homingRocket).toBeAttached();
    await page.keyboard.up('k');

    // Kurz warten (über die Ejektions- & Stallphase hinweg) und prüfen, dass die Homing-Rakete ihren X-Wert nach rechts lenkt
    await page.waitForTimeout(400);
    const homingX = await page.evaluate(() => {
      const el = document.querySelector('.raketen-projektil.rakete-homing');
      return el ? parseFloat(el.style.left) : null;
    });

    // Ursprung war ~205px (state.x + 20), sollte sich nach rechts bewegt haben (> 205px)
    expect(homingX).toBeGreaterThan(205);
  });

  test('Auf Stufe 5 sind 2 von 3 Raketen zielsuchend (Dual-Homing Flanken)', async ({ page }) => {
    // Spiel starten und Raketenstufe 5 setzen
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.raketenStufe = 5;
      stateMod.state.raketenCooldown = 0;
    });

    // Raketen mit Taste K abfeuern
    await page.keyboard.down('k');
    const homingRockets = page.locator('.raketen-projektil.rakete-homing');
    await expect(homingRockets).toHaveCount(2);
    const allRockets = page.locator('.raketen-projektil');
    await expect(allRockets).toHaveCount(3);
    await page.keyboard.up('k');
  });

  test('Auf Laser-Stufe 4 feuert das Schiff 4 parallele, gebündelte Laser ohne diagonale Streuung (vx = 0)', async ({ page }) => {
    // Spiel starten und Laserstufe 4 setzen
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.laserStufe = 4;
      stateMod.state.energie = 100;
      stateMod.state.spielerSchussCooldown = 0;
    });

    // Laser mit Taste L abfeuern
    await page.keyboard.down('KeyL');
    await page.waitForTimeout(100);

    const laserInfo = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.laserArray.map(l => ({
        vx: l.vx,
        vy: l.vy,
        width: l.width
      }));
    });

    await page.keyboard.up('KeyL');

    expect(laserInfo.length).toBeGreaterThanOrEqual(4);
    const batch = laserInfo.slice(-4);
    expect(batch.length).toBe(4);
    for (const l of batch) {
      expect(l.vx).toBe(0);
    }
  });

  test('Automatischer Laser zielt nicht auf unzerstoerbare Asteroiden, sondern waehlt zerstoerbare Ziele', async ({ page }) => {
    // Spiel starten
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Unzerstörbaren Asteroiden nahe am Spieler und zerstörbaren Feind weiter oben platzieren
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      stateMod.state.autolaserAktiv = true;
      stateMod.state.autolaserTimer = 600;
      stateMod.state.x = 200;
      stateMod.state.y = 400;

      // 1. Unzerstörbarer Asteroid sehr nah über dem Spieler (y: 350, direkt über dem Schiff)
      entitiesMod.erzeugeAsteroid(200, 350, 30, 0, 0, false, 0);
      const unzerstoerbarAst = stateMod.arrays.asteroiden[stateMod.arrays.asteroiden.length - 1];
      unzerstoerbarAst.istUnzerstoerbar = true;

      // 2. Zerstörbarer Feind weiter weg (y: 200, x: 250)
      entitiesMod.erzeugeFeind(250, 200, 'normal', 0);
    });

    // Kurz warten, damit Autolaser im Loop zielen und feuern kann
    await page.waitForTimeout(200);

    const enemyHp = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.feinde[0]?.hp;
    });

    // Feind muss Schaden genommen haben (< 20 HP)
    expect(enemyHp).toBeLessThan(20);
  });

  test('Spielerschiff bleibt innerhalb der 4 Spielfeldbegrenzungen (oben, unten, links, rechts)', async ({ page }) => {
    // Spiel starten
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Extrem nach rechts und unten setzen / steuern
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.x = 1000;
      stateMod.state.y = 1000;
    });

    await page.waitForTimeout(50);

    const pos1 = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return { x: stateMod.state.x, y: stateMod.state.y };
    });

    // Spielfeld 400x600, Spieler 30x30 -> max x: 370, max y: 570
    expect(pos1.x).toBe(370);
    expect(pos1.y).toBe(570);

    // Extrem nach links und oben setzen / steuern
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.x = -500;
      stateMod.state.y = -500;
    });

    await page.waitForTimeout(50);

    const pos2 = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return { x: stateMod.state.x, y: stateMod.state.y };
    });

    expect(pos2.x).toBe(0);
    expect(pos2.y).toBe(0);
  });

  test('Hangar: Schiffs-Modell kann zwischen Viper-X und Phantom-NX gewechselt werden', async ({ page }) => {
    const hangar = page.locator('#hangar-container');
    await expect(hangar).toBeVisible();

    const nameDisplay = page.locator('#hangar-ship-name');
    await expect(nameDisplay).toContainText('VIPER-X');

    // Wechsel auf Phantom-NX
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    await expect(nameDisplay).toContainText('PHANTOM-NX');
    await expect(phantomBtn).toHaveClass(/active/);

    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await expect(viperBtn).not.toHaveClass(/active/);

    const modelPhantom = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.state.selectedShipModel;
    });
    expect(modelPhantom).toBe('phantom');

    // Prüfen, dass das Spielerschiff-SVG die Phantom-Geometrie enthält
    const spielerSvg = page.locator('#spieler svg');
    const svgHtml1 = await spielerSvg.evaluate(el => el.innerHTML);
    expect(svgHtml1).toContain('Phantom-NX');

    // Wechsel zurück auf Viper-X
    await viperBtn.click();
    await expect(nameDisplay).toContainText('VIPER-X');
    const modelViper = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.state.selectedShipModel;
    });
    expect(modelViper).toBe('viper');
    const svgHtml2 = await spielerSvg.evaluate(el => el.innerHTML);
    expect(svgHtml2).toContain('Viper-X');
  });

  test('Hangar: Farbauswahl wechselt alle 5 Farbvarianten durch', async ({ page }) => {
    const colors = ['blue', 'green', 'yellow', 'purple', 'red'];
    for (const c of colors) {
      const colorBtn = page.locator(`.hangar-color-btn[data-color="${c}"]`);
      await colorBtn.click();
      await expect(colorBtn).toHaveClass(/active/);

      const stateColor = await page.evaluate(async () => {
        const stateMod = await import('./js/state.js');
        return stateMod.state.selectedShipColor;
      });
      expect(stateColor).toBe(c);
    }
  });

  test('Schiff-Eigenschaften: Viper-X bewegt sich spürbar schneller als Phantom-NX', async ({ page }) => {
    // 1. Test mit Viper-X (Standard)
    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await viperBtn.click();

    // Start-Position prüfen
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.x = 100;
      stateMod.state.y = 100;
    });

    // W-Taste drücken, um Spiel zu starten und für 100ms nach oben/rechts zu fliegen
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(100);
    await page.keyboard.up('KeyD');

    const viperEndX = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.state.x;
    });
    const viperDelta = viperEndX - 100;

    // Spiel neustarten und Phantom-NX wählen
    await page.goto('/');
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.x = 100;
      stateMod.state.y = 100;
    });

    await page.keyboard.down('KeyD');
    await page.waitForTimeout(100);
    await page.keyboard.up('KeyD');

    const phantomEndX = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.state.x;
    });
    const phantomDelta = phantomEndX - 100;

    // Geschwindigkeitswerte im State / Config prüfen
    const shipSpeeds = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return {
        viper: stateMod.shipModels.viper.speed,
        phantom: stateMod.shipModels.phantom.speed
      };
    });

    expect(shipSpeeds.viper).toBe(6.0);
    expect(shipSpeeds.phantom).toBe(3.8);
    expect(viperDelta).toBeGreaterThan(phantomDelta);
  });

  test('Schiff-Eigenschaften: Phantom-NX regeneriert Schild Stufe 1 nach Treffer und zeigt Uhr-Ladeanimation (O1)', async ({ page }) => {
    // 1. Phantom-NX wählen
    await page.goto('/');
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    // Spiel starten
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Schild auf 0 setzen (Treffer simulieren) und 50% Regeneration setzen
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.schildStufe = 0;
      stateMod.state.phantomSchildRegenTimer = 450; // 50% geladen
      document.getElementById('spieler').classList.remove('schild-aktiv-1');
      utilsMod.updateAktivePowerupsUI();
    });

    // Prüfen, dass das O1-Icon während der Regeneration angezeigt wird und einen conic-gradient Hintergrund besitzt
    const o1Recharge = page.locator('#aktive-powerups .pu-recharging-shield');
    await expect(o1Recharge).toBeVisible();
    await expect(o1Recharge).toContainText('O1');

    const background = await o1Recharge.evaluate(el => el.style.background);
    expect(background).toContain('conic-gradient');

    // Timer fast vollenden (899 Frames)
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.phantomSchildRegenTimer = 899;
    });

    // Kurz warten, damit der Game-Loop den Frame tickt und den Schild auf Stufe 1 regeneriert
    await page.waitForTimeout(100);

    const shieldState = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const spielerEl = document.getElementById('spieler');
      return {
        stufe: stateMod.state.schildStufe,
        hasShieldClass: spielerEl.classList.contains('schild-aktiv-1'),
        timer: stateMod.state.phantomSchildRegenTimer
      };
    });

    expect(shieldState.stufe).toBe(1);
    expect(shieldState.hasShieldClass).toBe(true);
    expect(shieldState.timer).toBe(0);
  });

  test('Schiff-Eigenschaften: Phantom-NX startet mit Schild Stufe 1, Viper-X ohne Schild', async ({ page }) => {
    // 1. Mit Phantom-NX starten
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    // Spiel starten mit W-Taste
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Prüfen, ob Schildstufe 1 aktiv ist
    const phantomSchild = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const spielerEl = document.getElementById('spieler');
      return {
        stufe: stateMod.state.schildStufe,
        hasShieldClass: spielerEl.classList.contains('schild-aktiv-1')
      };
    });

    expect(phantomSchild.stufe).toBe(1);
    expect(phantomSchild.hasShieldClass).toBe(true);

    // 2. Seite neu laden und mit Viper-X starten
    await page.goto('/');
    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await viperBtn.click();

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    const viperSchild = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const spielerEl = document.getElementById('spieler');
      return {
        stufe: stateMod.state.schildStufe,
        hasShieldClass: spielerEl.classList.contains('schild-aktiv-1')
      };
    });

    expect(viperSchild.stufe).toBe(0);
    expect(viperSchild.hasShieldClass).toBe(false);
  });

  test('Schiff-Eigenschaften: Phantom-NX verliert bei Treffern keine Upgrades, Viper-X verliert Upgrades', async ({ page }) => {
    // 1. Test mit Phantom-NX: Verliert KEINE Upgrades bei Treffer
    await page.goto('/');
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.laserStufe = 3;
      stateMod.state.raketenStufe = 3;
      stateMod.state.bombenStufe = 3;
      stateMod.state.schildStufe = 0; // Kein Schild, damit Treffer direkt HP trifft
      stateMod.state.leben = 3;
      stateMod.state.invulnerableTimer = 0;
      
      // Treffer simulieren
      utilsMod.spielerGetroffen({ x: 0, y: 0, el: document.createElement('div'), istFeind: true }, false);
    });

    const phantomUpgrades = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return {
        laser: stateMod.state.laserStufe,
        raketen: stateMod.state.raketenStufe,
        bomben: stateMod.state.bombenStufe,
        leben: stateMod.state.leben
      };
    });

    // Leben wurde reduziert (3 -> 2), aber alle Waffenstufen blieben unverändert auf 3
    expect(phantomUpgrades.leben).toBe(2);
    expect(phantomUpgrades.laser).toBe(3);
    expect(phantomUpgrades.raketen).toBe(3);
    expect(phantomUpgrades.bomben).toBe(3);

    // 2. Test mit Viper-X: Verliert 1 Upgrade bei Treffer
    await page.goto('/');
    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await viperBtn.click();

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.laserStufe = 3;
      stateMod.state.raketenStufe = 3;
      stateMod.state.bombenStufe = 3;
      stateMod.state.schildStufe = 0;
      stateMod.state.leben = 3;
      stateMod.state.invulnerableTimer = 0;

      // Treffer simulieren
      utilsMod.spielerGetroffen({ x: 0, y: 0, el: document.createElement('div'), istFeind: true }, false);
    });

    const viperUpgrades = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return {
        laser: stateMod.state.laserStufe,
        raketen: stateMod.state.raketenStufe,
        bomben: stateMod.state.bombenStufe,
        leben: stateMod.state.leben,
        summe: stateMod.state.laserStufe + stateMod.state.raketenStufe + stateMod.state.bombenStufe
      };
    });

    // Leben wurde reduziert (3 -> 2) und Summe der Waffenstufen sank von 9 auf 8
    expect(viperUpgrades.leben).toBe(2);
    expect(viperUpgrades.summe).toBe(8);
  });

  test('Schiff-Eigenschaften: Viper-X regeneriert Laser-Energie 25% schneller als Phantom-NX', async ({ page }) => {
    // 1. Viper-X wählen
    await page.goto('/');
    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await viperBtn.click();

    // Spiel starten und Energie auf 0 setzen
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    const viperRegen = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.energie = 0;
      stateMod.state.laserSchiesst = false;
      
      // 100ms warten damit der Game-Loop Energie regeneriert
      await new Promise(r => setTimeout(r, 100));
      return {
        energie: stateMod.state.energie,
        configRegen: stateMod.shipModels.viper.energyRegen
      };
    });

    // 2. Phantom-NX wählen
    await page.goto('/');
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    const phantomRegen = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.energie = 0;
      stateMod.state.laserSchiesst = false;

      await new Promise(r => setTimeout(r, 100));
      return {
        energie: stateMod.state.energie,
        configRegen: stateMod.shipModels.phantom.energyRegen
      };
    });

    expect(viperRegen.configRegen).toBe(0.5);
    expect(phantomRegen.configRegen).toBe(0.4);
    expect(viperRegen.energie).toBeGreaterThan(phantomRegen.energie);
  });

  test('Schiff-Eigenschaften: Viper-X erhaelt bei Zerstoerung kleiner Gegner Energie zurueck (+5 Energie)', async ({ page }) => {
    // 1. Viper-X wählen (Standard)
    await page.goto('/');
    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await viperBtn.click();

    // Spiel starten und Energie auf 20 setzen
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      const utilsMod = await import('./js/utils.js');

      stateMod.state.energie = 20;
      // Kleinen Feind erzeugen und zerstören
      entitiesMod.erzeugeFeind(200, 100, 'normal', 0);
      const feind = stateMod.arrays.feinde[0];
      utilsMod.zerstoereZiel(feind);
    });

    const energyAfterKill = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.state.energie;
    });

    // Energie muss von 20 auf 25 gestiegen sein
    expect(energyAfterKill).toBe(25);
  });

  test('Hangar: Zeigt beim Umschalten dynamisch die Perk-Badges der Schiffe an', async ({ page }) => {
    await page.goto('/');

    const perksContainer = page.locator('#hangar-ship-perks');
    await expect(perksContainer).toBeVisible();

    // 1. Initial mit Viper-X
    const viperBadges = perksContainer.locator('.hangar-perk-badge');
    await expect(viperBadges).toHaveCount(4);
    await expect(perksContainer).toContainText('+20% TEMPO');
    await expect(perksContainer).toContainText('+25% REGEN');
    await expect(perksContainer).toContainText('+5 ENERGIE BEI KILL');
    await expect(perksContainer).toContainText('TREFFER: -1 UPGRADE');

    // 2. Wechsel auf Phantom-NX
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    const phantomBadges = perksContainer.locator('.hangar-perk-badge');
    await expect(phantomBadges).toHaveCount(3);
    await expect(perksContainer).toContainText('SCHWERE PANZERUNG');
    await expect(perksContainer).toContainText('REGEN-SCHILD LVL 1');
    await expect(perksContainer).toContainText('-35% TEMPO');

    // 3. Zurück auf Viper-X
    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await viperBtn.click();

    await expect(perksContainer).toContainText('+20% TEMPO');
    await expect(perksContainer).not.toContainText('SCHWERE PANZERUNG');
  });

  test('Spielfeld skaliert dynamisch je nach Fenstergröße', async ({ page }) => {
    const spielfeld = page.locator('#spielfeld');
    const container = page.locator('#spielfeld-container');
    
    await expect(container).toBeAttached();

    // Initiale Transformation prüfen
    let transform = await spielfeld.evaluate((el) => el.style.transform);
    expect(transform).toContain('scale');

    // Fenstergröße extrem ändern
    await page.setViewportSize({ width: 1920, height: 1080 });
    // Kurz warten bis Event Listener triggert
    await page.waitForTimeout(100);
    
    let newTransform = await spielfeld.evaluate((el) => el.style.transform);
    expect(newTransform).toContain('scale');
    expect(newTransform).not.toEqual(transform); // Scale factor sollte sich geändert haben
  });
});

test.describe('Was gibt es Neues Modal (Changelog)', () => {
  test('Wird bei neuer Version automatisch angezeigt und kann geschlossen werden', async ({ page }) => {
    // Altes Release simulieren
    await page.addInitScript(() => {
      localStorage.setItem('starshooter_last_seen_version', '1.2.0');
    });
    await page.goto('/');

    const modal = page.locator('#whats-new-overlay');
    await expect(modal).toBeVisible();

    const title = page.locator('#whats-new-title');
    await expect(title).toContainText("WAS GIBT'S NEUES");

    const intro = page.locator('#whats-new-intro');
    await expect(intro).toContainText('1.6.8');

    const items = page.locator('#whats-new-list li');
    await expect(items).toHaveCount(3);

    // Schließen
    const closeBtn = page.locator('#btn-close-whats-new');
    await closeBtn.click();

    await expect(modal).toBeHidden();

    // Prüfen, dass localStorage aktualisiert wurde
    const storedVersion = await page.evaluate(() => localStorage.getItem('starshooter_last_seen_version'));
    expect(storedVersion).toBe('1.6.8');

    // Erneut öffnen über Start-Screen Button
    const openBtn = page.locator('#btn-open-whats-new');
    await openBtn.click();
    await expect(modal).toBeVisible();
  });
});

test.describe('Mobile UI Positionierung - Handy (Pixel)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  test('Buttons sind relativ zum Spielfeld korrekt platziert und ragen nicht unschön rein', async ({ page }) => {
    await page.goto('/');
    // Echten Tap auf Start-Text ausführen
    await page.tap('#start-text');
    
    // Warten bis Controls da sind
    await expect(page.locator('#mobile-controls')).toBeVisible();
    
    const raketeBtn = page.locator('#btn-rakete');
    const spielfeld = page.locator('#spielfeld');
    
    const raketeBox = await raketeBtn.boundingBox();
    const feldBox = await spielfeld.boundingBox();
    
    // Der Abstand vom rechten Button-Rand zum rechten Spielfeld-Rand sollte gering sein (unter 60px)
    const distanceToRightEdge = raketeBox.x + raketeBox.width - (feldBox.x + feldBox.width);
    expect(Math.abs(distanceToRightEdge)).toBeLessThan(60);
    
    // Prüfen, dass der Button im unteren Bereich / unterhalb der Spielfläche liegt
    expect(raketeBox.y).toBeGreaterThanOrEqual(feldBox.y + feldBox.height - 50);
  });
});

test.describe('Mobile UI Positionierung - Tablet (iPad)', () => {
  // iPad Pro Format / typisches Tablet quer/hoch
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 1366 } });

  test('Buttons kleben nicht am rechten Bildschirmrand, sondern am Spielfeld', async ({ page }) => {
    await page.goto('/');
    await page.tap('#start-text');
    
    await expect(page.locator('#mobile-controls')).toBeVisible();
    
    const raketeBtn = page.locator('#btn-rakete');
    const spielfeld = page.locator('#spielfeld');
    
    const raketeBox = await raketeBtn.boundingBox();
    const feldBox = await spielfeld.boundingBox();
    
    const distanceToRightEdge = (raketeBox.x + raketeBox.width) - (feldBox.x + feldBox.width);
    expect(Math.abs(distanceToRightEdge)).toBeLessThan(60);
    
    // Prüfen, dass der Button im unteren Bereich / unterhalb der Spielfläche liegt
    expect(raketeBox.y).toBeGreaterThanOrEqual(feldBox.y + feldBox.height - 50);
  });
});

test.describe('Raketenwerfer am Schiff', () => {
  test('Zeigt auf Stufe 1 bei Viper-X nur den linken Werfer, bei Phantom-NX nur den rechten Werfer', async ({ page }) => {
    // Spiel starten mit Viper-X (Standard)
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    const werferLinks = page.locator('#spieler .werfer-links');
    const werferRechts = page.locator('#spieler .werfer-rechts');
    const werferCenter = page.locator('#spieler .werfer-center');

    await expect(werferLinks).toBeVisible();
    await expect(werferRechts).toBeHidden();
    await expect(werferCenter).toBeHidden();

    // Zu Phantom-NX wechseln
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.selectedShipModel = 'phantom';
      utilsMod.updatePlayerShipVisuals();
    });

    await expect(werferLinks).toBeHidden();
    await expect(werferRechts).toBeVisible();
    await expect(werferCenter).toBeHidden();
  });

  test('Auf Stufe 3 und 4 erscheinen beide seitlichen Werfer, auf Stufe 5 der dritte mittlere Werfer', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    const werferLinks = page.locator('#spieler .werfer-links');
    const werferRechts = page.locator('#spieler .werfer-rechts');
    const werferCenter = page.locator('#spieler .werfer-center');

    // Stufe 3
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.raketenStufe = 3;
      utilsMod.updateAktivePowerupsUI();
    });

    await expect(werferLinks).toBeVisible();
    await expect(werferRechts).toBeVisible();
    await expect(werferCenter).toBeHidden();

    // Stufe 4
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.raketenStufe = 4;
      utilsMod.updateAktivePowerupsUI();
    });

    await expect(werferLinks).toBeVisible();
    await expect(werferRechts).toBeVisible();
    await expect(werferCenter).toBeHidden();

    // Stufe 5
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.raketenStufe = 5;
      utilsMod.updateAktivePowerupsUI();
    });

    await expect(werferLinks).toBeVisible();
    await expect(werferRechts).toBeVisible();
    await expect(werferCenter).toBeVisible();
  });

  test('Raketen starten geradeaus direkt aus den aktiven Werfern (Viper links, Phantom rechts)', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // 1. Viper-X: Feuern auf Stufe 1 -> Rakete startet links vom Schiff und fliegt geradeaus (kein schräger Auswurf)
    await page.keyboard.down('KeyK');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyK');

    const raketeViper = page.locator('.raketen-projektil').first();
    await expect(raketeViper).toBeAttached();

    const viperX = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const r = stateMod.arrays.raketenArray[0];
      return { shipX: stateMod.state.x, rocketX: r.x, vx: r.vx };
    });

    // Rakete muss links vom Rumpf starten
    expect(viperX.rocketX).toBeLessThan(viperX.shipX + 5);
    // Rakete startet geradeaus nach vorne (vx = 0)
    expect(viperX.vx).toBe(0);

    // 2. Zweiter Schuss mit Viper -> muss IMMER noch links starten (nicht mehr alternierend)
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.arrays.raketenArray.forEach(r => r.el.remove());
      stateMod.arrays.raketenArray.length = 0;
      stateMod.state.raketenCooldown = 0;
    });

    await page.keyboard.down('KeyK');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyK');

    const viperX2 = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const r = stateMod.arrays.raketenArray[0];
      return { shipX: stateMod.state.x, rocketX: r.x, vx: r.vx };
    });
    expect(viperX2.rocketX).toBeLessThan(viperX2.shipX + 5);
    expect(viperX2.vx).toBe(0);

    // 3. Phantom-NX: Auf Stufe 1 startet Rakete rechts vom Schiff und geradeaus
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.arrays.raketenArray.forEach(r => r.el.remove());
      stateMod.arrays.raketenArray.length = 0;
      stateMod.state.raketenCooldown = 0;
      stateMod.state.selectedShipModel = 'phantom';
      utilsMod.updatePlayerShipVisuals();
    });

    await page.keyboard.down('KeyK');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyK');

    const phantomX = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const r = stateMod.arrays.raketenArray[0];
      return { shipX: stateMod.state.x, rocketX: r.x, vx: r.vx };
    });

    // Rakete muss rechts vom Rumpf starten
    expect(phantomX.rocketX).toBeGreaterThan(phantomX.shipX + 20);
    expect(phantomX.vx).toBe(0);
  });

  test('Beim Downgrade löst sich der verlorene Werfer mit Wegschleuder-Animation', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Auf Stufe 5 setzen
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.raketenStufe = 5;
      utilsMod.updateAktivePowerupsUI();
    });

    // Downgrade von Stufe 5 auf Stufe 3 (mittlerer Werfer geht verloren)
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const utilsMod = await import('./js/utils.js');
      stateMod.state.raketenStufe = 3;
      utilsMod.updateAktivePowerupsUI();
    });

    const ejectedPod = page.locator('.werfer-abgeworfen');
    await expect(ejectedPod).toBeAttached();
  });
});

test.describe('Late-Game Difficulty & Gegner-Mechaniken', () => {
  test('Gegner-Schussrate skaliert mit Level und feuert ab Level 3 2er-Salven (Burst)', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // 1. Schussintervall auf Level 1 vs Level 5 prüfen
    const timers = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');

      stateMod.state.level = 1;
      entitiesMod.erzeugeFeind(100, 50, 'normal', 0);
      const f1 = stateMod.arrays.feinde[stateMod.arrays.feinde.length - 1];

      stateMod.state.level = 5;
      entitiesMod.erzeugeFeind(200, 50, 'normal', 0);
      const f5 = stateMod.arrays.feinde[stateMod.arrays.feinde.length - 1];

      return { f1Timer: f1.schussTimer, f5Timer: f5.schussTimer };
    });

    expect(timers.f5Timer).toBeLessThan(timers.f1Timer);

    // 2. Auf Level 3+ 2er-Burst-Salven prüfen
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      stateMod.arrays.feinde.forEach(f => f.el.remove());
      stateMod.arrays.feinde.length = 0;
      stateMod.arrays.feindLaserArray.forEach(l => l.el.remove());
      stateMod.arrays.feindLaserArray.length = 0;

      stateMod.state.level = 3;
      entitiesMod.erzeugeFeind(150, 50, 'normal', 0);
      const f = stateMod.arrays.feinde[0];
      f.forceBurst = true;
      f.schussTimer = 1; // Unmittelbar feuern
    });

    // Nach kurzem Warten sollten durch den Burst 2 Feind-Laser abgefeuert worden sein
    await page.waitForTimeout(250);
    const laserCount = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.feindLaserArray.length;
    });

    expect(laserCount).toBeGreaterThanOrEqual(2);
  });

  test('Schild-Gegner besitzen ab Level 3 einen schützenden Energieschild, der erst zerstört werden muss', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Feind mit Schild spawnen
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      stateMod.arrays.feinde.forEach(f => f.el.remove());
      stateMod.arrays.feinde.length = 0;

      stateMod.state.level = 4;
      // Mit forceShield = true und muster crossfire spawnen
      entitiesMod.erzeugeFeind(185, 100, 'crossfire', 0, true);
      const f = stateMod.arrays.feinde[0];
      f.vy = 0; // Stationär für präzisen Treffertest
      f.hp = 50;
      f.maxHp = 50;
    });

    const schildEl = page.locator('.feind-schiff .feind-schild');
    await expect(schildEl).toBeVisible();

    // Laserschuss abfeuern
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.x = 185;
      stateMod.state.y = 250;
      stateMod.state.energie = 50;
      stateMod.state.laserStufe = 2;
      stateMod.state.spielerSchussCooldown = 0;
    });

    await page.keyboard.down('KeyL');
    await page.waitForTimeout(80);
    await page.keyboard.up('KeyL');

    // Warten bis die Laser-Projektile das Ziel bei y=100 erreicht und getroffen haben
    await page.waitForTimeout(300);

    // Schild sollte zerstört sein, aber Feind lebt noch
    const feindStatus = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const f = stateMod.arrays.feinde[0];
      return f ? { alive: true, schildHp: f.schildHp, hp: f.hp } : { alive: false };
    });

    expect(feindStatus.alive).toBe(true);
    expect(feindStatus.schildHp).toBeLessThanOrEqual(0);
    expect(feindStatus.hp).toBeGreaterThan(0);
    await expect(schildEl).toBeHidden();
  });

  test('Boss kann eine zerstörbare Boss-Bombe abwerfen, die vor der Detonation abgeschossen werden kann', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Boss-Bombe erzeugen
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');

      stateMod.arrays.bossBombenArray.forEach(b => b.el.remove());
      stateMod.arrays.bossBombenArray.length = 0;

      // Erzeuge Boss-Bombe bei (185, 100)
      entitiesMod.erzeugeBossBombe(185, 100);
    });

    const bombeEl = page.locator('.boss-bombe');
    await expect(bombeEl).toBeVisible();

    // Laserschuss auf die Boss-Bombe abfeuern
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      stateMod.state.x = 185;
      stateMod.state.y = 250;
      stateMod.state.energie = 50;
      stateMod.state.laserStufe = 2;
      stateMod.state.spielerSchussCooldown = 0;
    });

    await page.keyboard.down('KeyL');
    await page.waitForTimeout(100);
    await page.keyboard.up('KeyL');

    // Warten bis Laser die Bombe zerstört
    await page.waitForTimeout(300);

    // Bombe sollte zerstört und entfernt sein
    await expect(bombeEl).toBeHidden();
    const bombenCount = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.bossBombenArray.length;
    });
    expect(bombenCount).toBe(0);
  });

  test('Boss feuert seitlich startende, zielsuchende Raketen ab, die vom Spieler im Flug abgeschossen werden können', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // 1. Boss-Rakete seitlich ausklinken
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');

      if (stateMod.arrays.bossRaketenArray) {
        stateMod.arrays.bossRaketenArray.forEach(r => r.el.remove());
        stateMod.arrays.bossRaketenArray.length = 0;
      }

      stateMod.state.x = 200;
      stateMod.state.y = 350;

      // Boss-Rakete links ausklinken (dir = -1)
      entitiesMod.erzeugeBossRakete(150, 100, -1);
    });

    const raketeEl = page.locator('.boss-rakete');
    await expect(raketeEl).toBeVisible();

    // 2. Anfangsgeschwindigkeit prüfen: nach links startend (vx < 0)
    const initialVx = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.bossRaketenArray[0].vx;
    });
    expect(initialVx).toBeLessThan(0);

    // 3. Nach kurzer Zeit sollte sich die Rakete Richtung Spieler ausrichten (Homing)
    await page.waitForTimeout(200);
    const trackingInfo = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const r = stateMod.arrays.bossRaketenArray[0];
      return r ? { x: r.x, y: r.y, vy: r.vy } : null;
    });
    expect(trackingInfo).not.toBeNull();
    expect(trackingInfo.vy).toBeGreaterThan(0); // Fliegt nach unten Richtung Spieler

    // 4. Zerstörbarkeit durch Spielerschuss testen
    await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      const r = stateMod.arrays.bossRaketenArray[0];
      // Spieler direkt vor die Flugbahn positionieren
      stateMod.state.x = r.x - 10;
      stateMod.state.y = r.y + 120;
      stateMod.state.energie = 50;
      stateMod.state.laserStufe = 2;
      stateMod.state.spielerSchussCooldown = 0;
    });

    await page.keyboard.down('KeyL');
    await page.waitForTimeout(100);
    await page.keyboard.up('KeyL');

    await page.waitForTimeout(250);

    // Boss-Rakete sollte abgeschossen worden sein
    await expect(raketeEl).toBeHidden();
    const remainingCount = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.arrays.bossRaketenArray.length;
    });
    expect(remainingCount).toBe(0);
  });

  test('Unverwundbarkeitsdauer nach Treffer ist halbiert (45 Frames / ca. 0.75s)', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Treffer simulieren
    const timerVal = await page.evaluate(async () => {
      const utilsMod = await import('./js/utils.js');
      const stateMod = await import('./js/state.js');
      stateMod.state.invulnerableTimer = 0;
      stateMod.state.godMode = false;
      utilsMod.spielerGetroffen({ x: 0, y: 0, el: document.createElement('div') }, false);
      return stateMod.state.invulnerableTimer;
    });

    expect(timerVal).toBe(45);
  });
  test('Sound-Mute Toggle: M-Taste und Sound-Button schalten Sound um und synchronisieren mit localStorage', async ({ page }) => {
    const soundBtn = page.locator('#btn-sound-toggle');
    await expect(soundBtn).toBeVisible();
    await expect(soundBtn).toHaveText('🔊');

    // Klick auf den Button mutet den Sound
    await soundBtn.click();
    await expect(soundBtn).toHaveText('🔇');

    let isMutedInStorage = await page.evaluate(() => localStorage.getItem('starshooter_muted'));
    expect(isMutedInStorage).toBe('true');

    // Drücken von Taste 'M' unmutet den Sound wieder
    await page.keyboard.press('KeyM');
    await expect(soundBtn).toHaveText('🔊');

    isMutedInStorage = await page.evaluate(() => localStorage.getItem('starshooter_muted'));
    expect(isMutedInStorage).toBe('false');
  });

  test('Sound-Trigger: Laser- und Autolaser-Schüsse lösen playLaser bzw. playAutolaser aus', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Laserstufe 3 und Energie setzen, History leeren
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.laserStufe = 3;
      stateMod.state.energie = 50;
      stateMod.state.laserSchiesst = false;
      stateMod.state.spielerSchussCooldown = 0;
    });

    // Laser abfeuern
    await page.keyboard.down('KeyL');
    await page.waitForTimeout(100);
    await page.keyboard.up('KeyL');

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });

    const laserEvents = history.filter(h => h.name === 'laser');
    expect(laserEvents.length).toBeGreaterThan(0);
    expect(laserEvents[0].details.level).toBe(3);

    // Autolaser aktivieren und mit Ziel testen (vorherige Laser aufräumen)
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      stateMod.arrays.laserArray.forEach(l => l.el.remove());
      stateMod.arrays.laserArray.length = 0;
      stateMod.state.spielLaeuft = true;
      stateMod.state.pausiert = false;
      stateMod.state.laserSchiesst = false;
      stateMod.state.tastenGedrueckt.l = false;
      stateMod.state.y = 400; // Positioniere Spieler weiter unten
      stateMod.state.autolaserAktiv = true;
      stateMod.state.autolaserTimer = 100;
      entitiesMod.erzeugeAsteroid(185, 100, 30, 0, 0, 0, true);
    });

    await page.waitForTimeout(400);

    const historyAfter = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });

    const autolaserEvents = historyAfter.filter(h => h.name === 'autolaser');
    expect(autolaserEvents.length).toBeGreaterThan(0);
  });

  test('Sound-Trigger: Raketen- und Bomben-Abwurf lösen playMissile bzw. playBomb aus', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Raketen feuern
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.raketenCooldown = 0;
      stateMod.state.raketenStufe = 2;
    });

    await page.keyboard.down('KeyK');
    await page.waitForTimeout(100);
    await page.keyboard.up('KeyK');

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const missileEvents = history.filter(h => h.name === 'missile');
    expect(missileEvents.length).toBeGreaterThan(0);

    // Bombe abwerfen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.bombenCooldown = 0;
      stateMod.state.bombenStufe = 1;
    });

    await page.keyboard.down('Space');
    await page.waitForTimeout(100);
    await page.keyboard.up('Space');

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const bombEvents = history.filter(h => h.name === 'bomb');
    expect(bombEvents.length).toBeGreaterThan(0);
  });

  test('Sound-Trigger: Zerstörung, Treffer und Magma-Abpraller lösen playExplosion bzw. playHit aus', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // 1. Ziel-Zerstörung testen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const utilsMod = await import('./js/utils.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();

      const dummyTarget = {
        x: 100, y: 100, groesse: 30, maxHp: 30, hp: 0,
        el: document.createElement('div'),
        istBoss: false, istFeind: true
      };
      stateMod.arrays.feinde.push(dummyTarget);
      utilsMod.zerstoereZiel(dummyTarget);
    });

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const explosionEvents = history.filter(h => h.name === 'explosion');
    expect(explosionEvents.length).toBeGreaterThan(0);

    // 2. Spieler-Treffer testen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const utilsMod = await import('./js/utils.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.invulnerableTimer = 0;
      stateMod.state.godMode = false;
      const dummyLaser = { x: 185, y: 285, width: 4, height: 10, el: document.createElement('div') };
      utilsMod.spielerGetroffen(dummyLaser, false);
    });

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const hitEvents = history.filter(h => h.name === 'hit' && h.details.type === 'player');
    expect(hitEvents.length).toBeGreaterThan(0);
  });

  test('Sound-Trigger: Powerup-Einsammeln und Schild-Regeneration lösen playPowerup bzw. playShieldRegen aus', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // 1. Powerup einsammeln testen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      stateMod.state.spielLaeuft = true;
      stateMod.state.x = 185;
      stateMod.state.y = 285;
      // Powerup direkt auf Spielerschiff spawnen
      entitiesMod.erzeugePowerup(185, 285, 'laserWaffe');
    });

    await page.waitForTimeout(100);

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const powerupEvents = history.filter(h => h.name === 'powerup');
    expect(powerupEvents.length).toBeGreaterThan(0);

    // 2. Phantom-NX Schild-Regeneration testen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.selectedShipModel = 'phantom';
      stateMod.state.schildStufe = 0;
      stateMod.state.phantomSchildRegenTimer = (stateMod.state.phantomSchildRegenMax || 900) - 2;
    });

    await page.waitForTimeout(100);

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const shieldEvents = history.filter(h => h.name === 'shieldRegen');
    expect(shieldEvents.length).toBeGreaterThan(0);
  });

  test('Sound-Trigger: Boss Warning und Game Over lösen playBossAlert bzw. playGameOver aus', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // 1. Boss Warning Alert Sound testen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.bossAktiv = false;
      stateMod.state.bossWarningAktiv = false;
      stateMod.state.frameZaehler = 3599; // Frame vor dem Boss-Warning Trigger
    });

    await page.waitForTimeout(100);

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const bossAlertEvents = history.filter(h => h.name === 'bossAlert');
    expect(bossAlertEvents.length).toBeGreaterThan(0);

    // 2. Game Over Sound testen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const utilsMod = await import('./js/utils.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.leben = 1;
      stateMod.state.schildStufe = 0;
      stateMod.state.invulnerableTimer = 0;
      stateMod.state.godMode = false;
      const dummyLaser = { x: 185, y: 285, width: 4, height: 10, el: document.createElement('div') };
      utilsMod.spielerGetroffen(dummyLaser, false);
    });

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const gameOverEvents = history.filter(h => h.name === 'gameOver');
    expect(gameOverEvents.length).toBeGreaterThan(0);
  });

  test('Sound-Trigger: Gegner- und Boss-Laser lösen playEnemyLaser bzw. playBossLaser aus', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // 1. Feind-Laser feuern
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      entitiesMod.erzeugeFeindLaser(100, 100);
    });

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const enemyLaserEvents = history.filter(h => h.name === 'enemyLaser');
    expect(enemyLaserEvents.length).toBeGreaterThan(0);

    // 2. Boss-Laser feuern
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      entitiesMod.erzeugeBossLaser(150, 50, 0, 6);
    });

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const bossLaserEvents = history.filter(h => h.name === 'bossLaser');
    expect(bossLaserEvents.length).toBeGreaterThan(0);
  });

  test('Sound-Trigger: Boss-Bomben und Boss-Raketen lösen playBossBombLaunch bzw. playBossRocketLaunch aus', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // 1. Boss-Bombe spawnen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      entitiesMod.erzeugeBossBombe(180, 100);
    });

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const bombLaunchEvents = history.filter(h => h.name === 'bossBombLaunch');
    expect(bombLaunchEvents.length).toBeGreaterThan(0);

    // 2. Boss-Rakete spawnen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      entitiesMod.erzeugeBossRakete(150, 100, 1);
    });

    history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const rocketLaunchEvents = history.filter(h => h.name === 'bossRocketLaunch');
    expect(rocketLaunchEvents.length).toBeGreaterThan(0);
  });

  test('Sound-Synthesizer: playMissile erzeugt ein realistisches Silvester-Raketen-Zischen mit Rauschfilter', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    const result = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      audioMod.clearAudioHistory();
      audioMod.initAudio();

      // playMissile direkt aufrufen und prüfen, dass keine Exception fliegt
      let threwError = false;
      try {
        audioMod.playMissile();
      } catch (err) {
        threwError = true;
      }

      return {
        threwError,
        history: audioMod.audioHistory,
        hasNoiseBuffer: !!audioMod.getNoiseBuffer(audioMod.getAudioContext())
      };
    });

    expect(result.threwError).toBe(false);
    expect(result.hasNoiseBuffer).toBe(true);
    const missileEvent = result.history.find(h => h.name === 'missile');
    expect(missileEvent).toBeDefined();
  });

  test('Sound-Trigger: Raketen-Detonation löst playMissileExplosion aus', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // 1. Spieler-Rakete spawnen und Ziel in Zündnähe platzieren
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      audioMod.clearAudioHistory();
      stateMod.state.spielLaeuft = true;

      const rEl = document.createElement('div');
      rEl.classList.add('rakete');
      document.getElementById('spielfeld').appendChild(rEl);

      // Rakete spawnen
      stateMod.arrays.raketenArray.push({
        el: rEl,
        x: 200,
        y: 200,
        vx: 0,
        vy: -8,
        stufe: 1,
        radius: 60,
        schaden: 50,
        isHoming: false
      });

      // Feind in Zündnähe
      const entitiesMod = await import('./js/entities.js');
      entitiesMod.erzeugeFeind(200, 180);
    });

    await page.waitForTimeout(100);

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const missileExpEvents = history.filter(h => h.name === 'missileExplosion');
    expect(missileExpEvents.length).toBeGreaterThan(0);
  });

  test('Sound-Trigger: Fliegende Bomben (Spieler & Boss) erzeugen ein beschleunigendes Piepsen (playBombBeep)', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // 1. Boss-Bombe spawnen und fliegen lassen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      stateMod.state.spielLaeuft = true;
      entitiesMod.erzeugeBossBombe(200, 100);
    });

    await page.waitForTimeout(200);

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const bombBeepEvents = history.filter(h => h.name === 'bombBeep');
    expect(bombBeepEvents.length).toBeGreaterThan(0);
  });

  test('Sound-Trigger: Boss-Raketen erzeugen im Flug periodisch Triebwerksgeräusche (playBossRocketFlight)', async ({ page }) => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    // Boss-Rakete spawnen und fliegen lassen
    await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      const stateMod = await import('./js/state.js');
      const entitiesMod = await import('./js/entities.js');
      audioMod.clearAudioHistory();
      stateMod.state.spielLaeuft = true;
      entitiesMod.erzeugeBossRakete(150, 100, 1);
    });

    await page.waitForTimeout(200);

    let history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const rocketFlightEvents = history.filter(h => h.name === 'bossRocketFlight');
    expect(rocketFlightEvents.length).toBeGreaterThan(0);
  });
});


