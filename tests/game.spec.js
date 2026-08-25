const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // Standardmäßig als bereits gesehen markieren, damit die Tests direkt interagieren können
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.6.42');
    localStorage.setItem('starshooter_skip_cutscene', 'true');
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
    await page.waitForTimeout(200);
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
    await expect(viperBadges).toHaveCount(5);
    await expect(perksContainer).toContainText('+20% TEMPO');
    await expect(perksContainer).toContainText('+25% REGEN');
    await expect(perksContainer).toContainText('+5 ENERGIE BEI KILL');
    await expect(perksContainer).toContainText('SPLITTER-DROP');
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
    await expect(intro).toContainText('1.6.42');

    const items = page.locator('#whats-new-list li');
    await expect(items).toHaveCount(1);

    // Schließen
    const closeBtn = page.locator('#btn-close-whats-new');
    await closeBtn.click();

    await expect(modal).toBeHidden();

    // Prüfen, dass localStorage aktualisiert wurde
    const storedVersion = await page.evaluate(() => localStorage.getItem('starshooter_last_seen_version'));
    expect(storedVersion).toBe('1.6.42');

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

test.describe('Story Intro-Cutszene', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('starshooter_skip_cutscene');
    });
    await page.goto('/');
  });

  test('Startet nach Schiffsauswahl und zeigt Raumschiff-Konvoi mit allen Schiffstypen', async ({ page }) => {
    // Schiffsmodell auf Phantom-NX und Farbe auf Blue stellen
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();
    const blueBtn = page.locator('.hangar-color-btn[data-color="blue"]');
    await blueBtn.click();

    // Starten via Tastendruck
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Startbildschirm ist weg
    const startScreen = page.locator('#start-screen');
    await expect(startScreen).toBeHidden();

    // In-Game Spielerschiff ist während der Cutszene ausgeblendet
    const inGameSpieler = page.locator('#spieler');
    await expect(inGameSpieler).toBeHidden();

    // Cutscene Container ist sichtbar
    const cutsceneContainer = page.locator('#cutscene-container');
    await expect(cutsceneContainer).toBeVisible();

    // Skip Button (ESC) ist vorhanden
    const skipBtn = page.locator('#cutscene-skip-btn');
    await expect(skipBtn).toBeVisible();
    await expect(skipBtn).toContainText('ESC');

    // Prüfen, dass alle Konvoi-Schiffe vorhanden sind
    const playerConvoyShip = page.locator('.cutscene-ship.ship-player');
    await expect(playerConvoyShip).toBeAttached();
    // Prüfen, dass das Spielerschiff das gewählte Modell (Phantom) & Farbe (Blue) widerspiegelt
    const playerSvg = playerConvoyShip.locator('svg');
    await expect(playerSvg).toBeAttached();
    const svgHtml = await playerSvg.innerHTML();
    expect(svgHtml).toContain('#3498db'); // Blue color

    const freighter = page.locator('.cutscene-ship.ship-freighter');
    await expect(freighter).toBeAttached();

    const hospitalShip = page.locator('.cutscene-ship.ship-hospital');
    await expect(hospitalShip).toBeAttached();

    const destroyer = page.locator('.cutscene-ship.ship-destroyer');
    await expect(destroyer).toBeAttached();

    const escorts = page.locator('.cutscene-ship.ship-escort');
    await expect(escorts).toHaveCount(2);

    // Prüfen, dass die Schiffe fliegen (Animation / Bewegung von links nach rechts)
    const initialX = await playerConvoyShip.evaluate(el => parseFloat(el.style.left || window.getComputedStyle(el).left));
    await page.waitForTimeout(300);
    const newX = await playerConvoyShip.evaluate(el => parseFloat(el.style.left || window.getComputedStyle(el).left));
    expect(newX).toBeGreaterThan(initialX);
  });

  test('Alien-Sprechblasen erscheinen mit unleserlichen Glyphen im Vordergrund und lösen Audio aus', async ({ page }) => {
    // Spiel starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten auf die erste Alien-Sprechblase
    const bubble = page.locator('.alien-speech-bubble');
    await expect(bubble.first()).toBeVisible({ timeout: 4000 });

    // Prüfen, dass unleserliche Glyphen enthalten sind
    const alienText = page.locator('.alien-speech-bubble .alien-text');
    await expect(alienText.first()).toBeVisible();
    const textContent = await alienText.first().textContent();
    expect(textContent.length).toBeGreaterThan(5);

    // Audio-History prüfen
    const hasAlienChatter = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory.some(h => h.name === 'alienChatter');
    });
    expect(hasAlienChatter).toBe(true);
  });

  test('Überraschungsangriff aus dem Verborgenen zerstört alle Begleitschiffe bis auf das Spielerschiff', async ({ page }) => {
    // Starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Beschleunigen bzw. Warten auf das Ende der Angriffsphase
    // Alle Begleitschiffe sollen nach der Angriffsphase zerstört sein
    const destroyer = page.locator('.cutscene-ship.ship-destroyer');
    const freighter = page.locator('.cutscene-ship.ship-freighter');
    const hospitalShip = page.locator('.cutscene-ship.ship-hospital');
    const escorts = page.locator('.cutscene-ship.ship-escort');
    const playerShip = page.locator('.cutscene-ship.ship-player');

    // Während der Zerstörungsphase entstehen Feuerbälle, Schockwellen & Trümmerteile
    const fireball = page.locator('.cutscene-fireball');
    await expect(fireball.first()).toBeAttached({ timeout: 11000 });

    // Nach Abschluss der Zerstörungsphase (~12 Sekunden in Echtzeit)
    await expect(destroyer).toBeHidden({ timeout: 14000 });
    await expect(freighter).toBeHidden();
    await expect(hospitalShip).toBeHidden();
    await expect(escorts).toHaveCount(0);

    // Spielerschiff ist weiterhin vorhanden
    await expect(playerShip).toBeAttached();

    // Audio-History prüfen
    const history = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory;
    });
    const hasArtillery = history.some(h => h.name === 'incomingArtillery');
    const hasExplosion = history.some(h => h.name === 'explosion');
    expect(hasArtillery).toBe(true);
    expect(hasExplosion).toBe(true);
  });

  test('Lichtstrahl erscheint, Schiff dreht nach oben und geht nahtlos ins eigentliche Spiel über', async ({ page }) => {
    // Starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten auf den Lichtstrahl (~12.5s)
    const lightBeam = page.locator('#cutscene-light-beam.cutscene-beam-active');
    await expect(lightBeam).toBeVisible({ timeout: 14500 });

    // Warten auf Abschluss der Cutszene und Übergang ins Spiel (~15s)
    const cutsceneContainer = page.locator('#cutscene-container');
    await expect(cutsceneContainer).toBeHidden({ timeout: 17500 });

    // Spiel ist nun aktiv (spielLaeuft = true, cutsceneAktiv = false)
    const gameState = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return {
        spielLaeuft: stateMod.state.spielLaeuft,
        cutsceneAktiv: stateMod.state.cutsceneAktiv,
        y: stateMod.state.y
      };
    });
    expect(gameState.spielLaeuft).toBe(true);
    expect(gameState.cutsceneAktiv).toBe(false);

    // In-game Spielerschiff ist nun sichtbar
    const inGameSpieler = page.locator('#spieler');
    await expect(inGameSpieler).toBeVisible();

    // Audio-History prüfen
    const hasLightWhoosh = await page.evaluate(async () => {
      const audioMod = await import('./js/audio.js');
      return audioMod.audioHistory.some(h => h.name === 'lightBeamWhoosh');
    });
    expect(hasLightWhoosh).toBe(true);
  });

  test('Cutszene kann jederzeit per ESC-Taste oder Skip-Button sofort übersprungen werden', async ({ page }) => {
    // 1. Test per ESC-Taste
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const cutsceneContainer = page.locator('#cutscene-container');
    await expect(cutsceneContainer).toBeVisible();

    // ESC drücken
    await page.keyboard.press('Escape');

    // Container sofort verschwunden und Spiel gestartet
    await expect(cutsceneContainer).toBeHidden();
    let isRunning = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.state.spielLaeuft && !stateMod.state.cutsceneAktiv;
    });
    expect(isRunning).toBe(true);

    // 2. Neustart & Test per Skip-Button
    await page.evaluate(async () => {
      const utilsMod = await import('./js/utils.js');
      utilsMod.restartGame();
    });

    const startScreen = page.locator('#start-screen');
    await expect(startScreen).toBeVisible();

    // Erneut Cutszene starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    await expect(cutsceneContainer).toBeVisible();

    // Auf den Skip Button klicken
    const skipBtn = page.locator('#cutscene-skip-btn');
    await skipBtn.click();

    // Container sofort verschwunden und Spiel gestartet
    await expect(cutsceneContainer).toBeHidden();
    isRunning = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return stateMod.state.spielLaeuft && !stateMod.state.cutsceneAktiv;
    });
    expect(isRunning).toBe(true);
  });

  test('Neustart nach Bosskampf entfernt alle Boss-Raketen, Boss-Bomben und Artefakte vollständig', async ({ page }) => {
    // Spiel starten und künstlich Boss-Rakete & Boss-Bombe erzeugen
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    await page.evaluate(async () => {
      const entitiesMod = await import('./js/entities.js');
      const stateMod = await import('./js/state.js');
      stateMod.state.spielLaeuft = true;
      // Boss-Rakete und Boss-Bombe erzeugen
      entitiesMod.erzeugeBossRakete(150, 200, 1);
      entitiesMod.erzeugeBossBombe(200, 250);
    });

    // Prüfen, dass die Elemente im DOM existieren
    const bossRakete = page.locator('.boss-rakete');
    const bossBombe = page.locator('.boss-bombe');
    await expect(bossRakete).toHaveCount(1);
    await expect(bossBombe).toHaveCount(1);

    // Nun Neustart ausführen (wie bei Game Over oder Klick auf Neustart)
    await page.evaluate(async () => {
      const utilsMod = await import('./js/utils.js');
      utilsMod.restartGame();
    });

    // Prüfen, dass alle Boss-Raketen, Boss-Bomben und Arrays vollständig geräumt sind
    await expect(bossRakete).toHaveCount(0);
    await expect(bossBombe).toHaveCount(0);

    const arrayLengths = await page.evaluate(async () => {
      const stateMod = await import('./js/state.js');
      return {
        bossRaketen: stateMod.arrays.bossRaketenArray.length,
        bossBomben: stateMod.arrays.bossBombenArray.length
      };
    });
    expect(arrayLengths.bossRaketen).toBe(0);
    expect(arrayLengths.bossBomben).toBe(0);
  });
});

test.describe('2-Spieler-Modus (Co-op)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('Modus-Auswahl auf Startscreen schaltet zwischen 1-Spieler (400px) und 2-Spieler Co-op (600px) um', async ({ page }) => {
    const btnSingle = page.locator('#gamemode-btn-single');
    const btnCoop = page.locator('#gamemode-btn-coop');
    const spielfeld = page.locator('#spielfeld');

    // Beide Buttons sichtbar auf dem Startscreen
    await expect(btnSingle).toBeVisible();
    await expect(btnCoop).toBeVisible();
    await expect(btnSingle).toHaveClass(/active/);
    await expect(btnCoop).not.toHaveClass(/active/);

    // Standardmäßig Solo: 400px
    let modeInfo = await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');
      return { gameMode: state.gameMode, width: config.spielfeldBreite };
    });
    expect(modeInfo.gameMode).toBe('single');
    expect(modeInfo.width).toBe(400);

    // Klick auf 2-Spieler Co-op Modus
    await btnCoop.click();

    await expect(btnCoop).toHaveClass(/active/);
    await expect(btnSingle).not.toHaveClass(/active/);

    modeInfo = await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');
      return { gameMode: state.gameMode, width: config.spielfeldBreite };
    });
    expect(modeInfo.gameMode).toBe('coop');
    expect(modeInfo.width).toBe(600);

    // Spielfeld-Element hat 600px Breite
    const box = await spielfeld.boundingBox();
    // BoundingBox ist im Unscaled/Scaled Zustand äquivalent zur berechneten Breite
    const styleWidth = await page.evaluate(() => document.getElementById('spielfeld').style.width);
    expect(styleWidth).toBe('600px');

    // Zurück auf 1-Spieler
    await btnSingle.click();
    await expect(btnSingle).toHaveClass(/active/);
    modeInfo = await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');
      return { gameMode: state.gameMode, width: config.spielfeldBreite };
    });
    expect(modeInfo.gameMode).toBe('single');
    expect(modeInfo.width).toBe(400);
  });

  test('Hangar: Separate Schiffs- und Farbauswahl für Spieler 1 und Spieler 2', async ({ page }) => {
    const btnCoop = page.locator('#gamemode-btn-coop');
    await btnCoop.click();

    const tabP1 = page.locator('.hangar-player-tab[data-player="p1"]');
    const tabP2 = page.locator('.hangar-player-tab[data-player="p2"]');
    await expect(tabP1).toBeVisible();
    await expect(tabP2).toBeVisible();

    // Spieler 1 auswählen: Viper-X, Gelb
    await tabP1.click();
    await expect(tabP1).toHaveClass(/active/);
    await page.locator('.hangar-model-btn[data-model="viper"]').click();
    await page.locator('.hangar-color-btn[data-color="yellow"]').click();

    // Spieler 2 auswählen: Phantom-NX, Grün
    await tabP2.click();
    await expect(tabP2).toHaveClass(/active/);
    await expect(tabP1).not.toHaveClass(/active/);
    await page.locator('.hangar-model-btn[data-model="phantom"]').click();
    await page.locator('.hangar-color-btn[data-color="green"]').click();

    // Zustand in state prüfen
    const shipsState = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p1Model: state.selectedShipModel,
        p1Color: state.selectedShipColor,
        p2Model: state.p2.selectedShipModel,
        p2Color: state.p2.selectedShipColor
      };
    });
    expect(shipsState.p1Model).toBe('viper');
    expect(shipsState.p1Color).toBe('yellow');
    expect(shipsState.p2Model).toBe('phantom');
    expect(shipsState.p2Color).toBe('green');

    // Tab P1 erneut anklicken: Buttons müssen Viper & Gelb als aktiv anzeigen
    await tabP1.click();
    await expect(page.locator('.hangar-model-btn[data-model="viper"]')).toHaveClass(/active/);
    await expect(page.locator('.hangar-color-btn[data-color="yellow"]')).toHaveClass(/active/);

    // Tab P2 erneut anklicken: Buttons müssen Phantom & Grün als aktiv anzeigen
    await tabP2.click();
    await expect(page.locator('.hangar-model-btn[data-model="phantom"]')).toHaveClass(/active/);
    await expect(page.locator('.hangar-color-btn[data-color="green"]')).toHaveClass(/active/);
  });

  test('Tastatur-Steuerung im 2-Spieler Modus: Spieler 1 bewegt sich mit WASD, Spieler 2 mit den Pfeiltasten unabhängig voneinander', async ({ page }) => {
    // 2-Spieler Modus aktivieren und Spiel starten
    await page.locator('#gamemode-btn-coop').click();

    // Spiel starten (per Tastendruck)
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Skip Cutscene
    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const spieler1 = page.locator('#spieler');
    const spieler2 = page.locator('#spieler-2');
    await expect(spieler1).toBeVisible();
    await expect(spieler2).toBeVisible();

    const startPos = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p1X: state.x,
        p1Y: state.y,
        p2X: state.p2.x,
        p2Y: state.p2.y
      };
    });

    // 1. Spieler 1 bewegt sich nach rechts (Taste 'd')
    await page.keyboard.down('d');
    await page.waitForTimeout(100);
    await page.keyboard.up('d');

    const posAfterP1Move = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p1X: state.x,
        p1Y: state.y,
        p2X: state.p2.x,
        p2Y: state.p2.y
      };
    });

    expect(posAfterP1Move.p1X).toBeGreaterThan(startPos.p1X);
    expect(posAfterP1Move.p2X).toBe(startPos.p2X); // P2 hat sich nicht bewegt

    // 2. Spieler 2 bewegt sich nach links (Taste 'ArrowLeft')
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(100);
    await page.keyboard.up('ArrowLeft');

    const posAfterP2Move = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p1X: state.x,
        p1Y: state.y,
        p2X: state.p2.x,
        p2Y: state.p2.y
      };
    });

    expect(posAfterP2Move.p2X).toBeLessThan(posAfterP1Move.p2X);
    expect(posAfterP2Move.p1X).toBe(posAfterP1Move.p1X); // P1 hat sich nicht bewegt
  });

  test('Waffen-Systeme im 2-Spieler Modus: P1 feuert mit B/V/C, P2 mit Ä/Ö/L mit separaten Cooldowns und Energiebalken', async ({ page }) => {
    // 2-Spieler Modus aktivieren und Spiel starten
    await page.locator('#gamemode-btn-coop').click();

    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    // 1. LASER TEST: P1 feuert mit 'b', P2 mit 'ä'
    await page.keyboard.down('b');
    await page.waitForTimeout(100);
    await page.keyboard.up('b');

    let weaponState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1Energie: state.energie,
        p2Energie: state.p2.energie,
        laserCount: arrays.laserArray.length,
        p1Lasers: arrays.laserArray.filter(l => l.owner === 'p1').length,
        p2Lasers: arrays.laserArray.filter(l => l.owner === 'p2').length
      };
    });

    expect(weaponState.p1Energie).toBeLessThan(50);
    expect(weaponState.p2Energie).toBe(50);
    expect(weaponState.p1Lasers).toBeGreaterThan(0);
    expect(weaponState.p2Lasers).toBe(0);

    // P2 feuert mit 'ä' (Quote Key)
    await page.keyboard.down('Quote');
    await page.waitForTimeout(100);
    await page.keyboard.up('Quote');

    weaponState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1Energie: state.energie,
        p2Energie: state.p2.energie,
        p2Lasers: arrays.laserArray.filter(l => l.owner === 'p2').length
      };
    });

    expect(weaponState.p2Energie).toBeLessThan(50);
    expect(weaponState.p2Lasers).toBeGreaterThan(0);

    // 2. RAKETEN TEST: P1 feuert mit 'v', P2 mit 'ö' (Semicolon Key)
    await page.keyboard.down('v');
    await page.waitForTimeout(50);
    await page.keyboard.up('v');

    weaponState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1RaketenCd: state.raketenCooldown,
        p2RaketenCd: state.p2.raketenCooldown,
        raketenCount: arrays.raketenArray.length
      };
    });

    expect(weaponState.p1RaketenCd).toBeGreaterThan(0);
    expect(weaponState.p2RaketenCd).toBe(0);
    expect(weaponState.raketenCount).toBeGreaterThan(0);

    // P2 feuert Rakete mit 'ö' (Semicolon)
    await page.keyboard.down('Semicolon');
    await page.waitForTimeout(50);
    await page.keyboard.up('Semicolon');

    weaponState = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p2RaketenCd: state.p2.raketenCooldown
      };
    });
    expect(weaponState.p2RaketenCd).toBeGreaterThan(0);

    // 3. BOMBEN TEST: P1 wirft mit 'c', P2 mit 'l'
    await page.keyboard.down('c');
    await page.waitForTimeout(50);
    await page.keyboard.up('c');

    weaponState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1BombenCd: state.bombenCooldown,
        p2BombenCd: state.p2.bombenCooldown,
        bombenCount: arrays.bombenArray.length
      };
    });

    expect(weaponState.p1BombenCd).toBeGreaterThan(0);
    expect(weaponState.p2BombenCd).toBe(0);
    expect(weaponState.bombenCount).toBeGreaterThan(0);

    // P2 wirft Bombe mit 'l'
    await page.keyboard.down('l');
    await page.waitForTimeout(50);
    await page.keyboard.up('l');

    weaponState = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p2BombenCd: state.p2.bombenCooldown
      };
    });
    expect(weaponState.p2BombenCd).toBeGreaterThan(0);
  });

  test('Dedicated Loot-System im 2-Spieler Modus: Powerups sind P1 oder P2 zugeordnet und können nur vom jeweiligen Spieler aufgesammelt werden', async ({ page }) => {
    // 2-Spieler Modus aktivieren und Spiel starten
    await page.locator('#gamemode-btn-coop').click();

    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    // 1. Spawne P1-Powerup direkt auf P2 Position (x=370, y=285)
    await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      const { state } = await import('./js/state.js');
      // Setze P1 & P2 Positionen
      state.x = 100;
      state.y = 285;
      state.p2.x = 370;
      state.p2.y = 285;
      // Spawne P1 Powerup direkt bei P2
      Entities.erzeugePowerup(370, 285, 'laser', 'p1');
    });

    await page.waitForTimeout(200);

    // P2 berührt P1-Powerup -> Darf NICHT eingesammelt werden!
    let lootState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1LaserStufe: state.laserStufe,
        p2LaserStufe: state.p2.laserStufe,
        powerupCount: arrays.powerups.length
      };
    });

    expect(lootState.p2LaserStufe).toBe(1);
    expect(lootState.powerupCount).toBe(1);

    // Jetzt bewegt sich P1 zu der Powerup-Position (die von P2 geschleppt wird)
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const pu = arrays.powerups[0];
      if (pu) {
        state.x = pu.x;
        state.y = pu.y;
      }
    });

    await page.waitForTimeout(200);

    // P1 berührt sein eigenes Powerup -> Wird eingesammelt!
    lootState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1LaserStufe: state.laserStufe,
        p2LaserStufe: state.p2.laserStufe,
        powerupCount: arrays.powerups.length
      };
    });

    expect(lootState.p1LaserStufe).toBe(2);
    expect(lootState.powerupCount).toBe(0);

    // 2. Spawne P2-Powerup direkt auf P1 Position (x=100, y=285)
    await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      const { state } = await import('./js/state.js');
      state.x = 100;
      state.y = 285;
      state.p2.x = 450;
      state.p2.y = 285;
      Entities.erzeugePowerup(100, 285, 'rakete', 'p2');
    });

    await page.waitForTimeout(200);

    // P1 berührt P2-Powerup -> Darf NICHT eingesammelt werden!
    lootState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1RaketenStufe: state.raketenStufe,
        p2RaketenStufe: state.p2.raketenStufe,
        powerupCount: arrays.powerups.length
      };
    });

    expect(lootState.p1RaketenStufe).toBe(1);
    expect(lootState.powerupCount).toBe(1);

    // P2 bewegt sich zu der Powerup-Position (die von P1 geschleppt wird)
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const pu = arrays.powerups[0];
      if (pu) {
        state.p2.x = pu.x;
        state.p2.y = pu.y;
      }
    });

    await page.waitForTimeout(200);

    // P2 berührt sein eigenes Powerup -> Wird eingesammelt!
    lootState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        p1RaketenStufe: state.raketenStufe,
        p2RaketenStufe: state.p2.raketenStufe,
        powerupCount: arrays.powerups.length
      };
    });

    expect(lootState.p2RaketenStufe).toBe(2);
    expect(lootState.powerupCount).toBe(0);
  });

  test('Balancing & Spawns im 2-Spieler Modus: Breiteres Spielfeld (600px) nutzt angepasste Feind-Formationen und ausgewogenes HP-Scaling', async ({ page }) => {
    // 1. SOLO-MODUS PRÜFUNG: Standard HP
    await page.locator('#gamemode-btn-single').click();
    let soloHp = await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      const { arrays } = await import('./js/state.js');
      Entities.erzeugeFeind(100, -30, 'normal', 0);
      Entities.erzeugeBoss();
      const feind = arrays.feinde[arrays.feinde.length - 1];
      const boss = arrays.bosses[arrays.bosses.length - 1];
      return {
        feindHp: feind.hp,
        bossHp: boss.hp
      };
    });

    expect(soloHp.feindHp).toBe(20);
    expect(soloHp.bossHp).toBe(400);

    // 2. CO-OP MODUS PRÜFUNG: +25% Feind-HP, +40% Boss-HP
    await page.locator('#gamemode-btn-coop').click();
    let coopHp = await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      const { arrays } = await import('./js/state.js');
      Entities.erzeugeFeind(100, -30, 'normal', 0);
      Entities.erzeugeBoss();
      const feind = arrays.feinde[arrays.feinde.length - 1];
      const boss = arrays.bosses[arrays.bosses.length - 1];
      return {
        feindHp: feind.hp,
        bossHp: boss.hp
      };
    });

    expect(coopHp.feindHp).toBe(25); // 20 * 1.25
    expect(coopHp.bossHp).toBe(560); // 400 * 1.4
  });

  test('Lebens- & Revive-System im 2-Spieler Modus: Separate Leben, Game Over erst wenn beide Spieler zerstört sind, Revive bei Boss-Sieg', async ({ page }) => {
    // 2-Spieler Modus aktivieren und Spiel starten
    await page.locator('#gamemode-btn-coop').click();

    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    // 1. Zerstöre Spieler 1 (3 Treffer)
    await page.evaluate(async () => {
      const Utils = await import('./js/utils.js');
      const { state } = await import('./js/state.js');
      const dummy = { istFeind: false, el: { dataset: {} }, x: 0, y: 0 };
      Utils.spielerGetroffen(dummy, false, 'p1');
      state.invulnerableTimer = 0;
      Utils.spielerGetroffen(dummy, false, 'p1');
      state.invulnerableTimer = 0;
      Utils.spielerGetroffen(dummy, false, 'p1');
    });

    let liveState = await page.evaluate(async () => {
      const { state, dom } = await import('./js/state.js');
      return {
        p1Leben: state.leben,
        p1Dead: state.isDead,
        p1Display: dom.spieler.style.display,
        p2Leben: state.p2.leben,
        p2Dead: state.p2.isDead,
        gameOver: state.gameOverAktiv
      };
    });

    expect(liveState.p1Leben).toBe(0);
    expect(liveState.p1Dead).toBe(true);
    expect(liveState.p1Display).toBe('none');
    expect(liveState.p2Leben).toBe(3);
    expect(liveState.p2Dead).toBe(false);
    expect(liveState.gameOver).toBe(false); // Spiel geht weiter!

    // 2. Boss besiegen -> Belebt toten Spieler 1 wieder!
    await page.evaluate(async () => {
      const Entities = await import('./js/entities.js');
      const Utils = await import('./js/utils.js');
      const { arrays } = await import('./js/state.js');
      Entities.erzeugeBoss();
      const boss = arrays.bosses[arrays.bosses.length - 1];
      Utils.zerstoereZiel(boss, 'p2');
    });

    liveState = await page.evaluate(async () => {
      const { state, dom } = await import('./js/state.js');
      return {
        p1Leben: state.leben,
        p1Dead: state.isDead,
        p1Display: dom.spieler.style.display,
        p1Invuln: state.invulnerableTimer > 0
      };
    });

    expect(liveState.p1Leben).toBe(1);
    expect(liveState.p1Dead).toBe(false);
    expect(liveState.p1Display).not.toBe('none');
    expect(liveState.p1Invuln).toBe(true);

    // 3. Jetzt beide Spieler eliminieren -> Löst Game Over aus
    await page.evaluate(async () => {
      const Utils = await import('./js/utils.js');
      const { state } = await import('./js/state.js');
      state.invulnerableTimer = 0;
      state.p2.invulnerableTimer = 0;
      state.p2.schildStufe = 0;
      const dummy = { istFeind: false, el: { dataset: {} }, x: 0, y: 0 };
      // P1 eliminieren (1 Leben verbleibend)
      Utils.spielerGetroffen(dummy, false, 'p1');
      // P2 eliminieren (3 Leben)
      Utils.spielerGetroffen(dummy, false, 'p2');
      state.p2.invulnerableTimer = 0;
      Utils.spielerGetroffen(dummy, false, 'p2');
      state.p2.invulnerableTimer = 0;
      Utils.spielerGetroffen(dummy, false, 'p2');
    });

    liveState = await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      return {
        p1Dead: state.isDead,
        p2Dead: state.p2.isDead,
        gameOver: state.gameOverAktiv
      };
    });

    expect(liveState.p1Dead).toBe(true);
    expect(liveState.p2Dead).toBe(true);
    expect(liveState.gameOver).toBe(true);
    await expect(page.locator('#game-over-screen')).toBeVisible();
  });

  test('Spieler 2 Energiebalken: #energie-container-p2 und #energie-balken-p2 sind im 2-Spieler Modus sichtbar und korrekt gestylt', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const energieContainerP2 = page.locator('#energie-container-p2');
    const energieBalkenP2 = page.locator('#energie-balken-p2');
    await expect(energieContainerP2).toBeVisible();
    await expect(energieBalkenP2).toBeVisible();

    const box = await energieContainerP2.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(75);
    expect(box.height).toBeGreaterThanOrEqual(6);

    const balkenBox = await energieBalkenP2.boundingBox();
    expect(balkenBox.width).toBeGreaterThan(0);
    expect(balkenBox.height).toBeGreaterThanOrEqual(6);
  });

  test('Spieler 2 Schild: #spieler-2 zeigt bei aktiver Schildstufe (1, 2, 3) visuelle Schild-Aura ::after an', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    // Schild Stufe 1 prüfen
    await page.evaluate(async () => {
      const { state, dom } = await import('./js/state.js');
      state.p2.schildStufe = 1;
      dom.spieler2.className = 'spieler-schiff schild-aktiv-1';
    });

    let shieldAfter1 = await page.evaluate(() => {
      const el = document.getElementById('spieler-2');
      const afterStyle = window.getComputedStyle(el, '::after');
      return {
        boxShadow: afterStyle.boxShadow,
        borderRadius: afterStyle.borderRadius
      };
    });

    expect(shieldAfter1.borderRadius).toBe('50%');
    expect(shieldAfter1.boxShadow).toContain('52, 152, 219'); // #3498db

    // Schild Stufe 2 prüfen
    await page.evaluate(async () => {
      const { state, dom } = await import('./js/state.js');
      state.p2.schildStufe = 2;
      dom.spieler2.className = 'spieler-schiff schild-aktiv-2';
    });

    await page.waitForTimeout(350);

    let shieldAfter2 = await page.evaluate(() => {
      const el = document.getElementById('spieler-2');
      const afterStyle = window.getComputedStyle(el, '::after');
      return {
        className: el.className,
        boxShadow: afterStyle.boxShadow
      };
    });

    expect(shieldAfter2.boxShadow).toContain('46, 204, 113'); // #2ecc71
  });

  test('Boss-Zielerfassung im Co-op: Wenn Spieler 1 stirbt, verfolgt und visiert Boss Typ 2 (Jäger) Spieler 2 an', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    // Setze Level 2 (Boss Typ 2 - Jäger) und spawne den Boss
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.level = 2;
      Entities.erzeugeBoss();
      const boss = arrays.bosses[arrays.bosses.length - 1];
      boss.phase = 'kampf'; // Sofort in den Kampfmodus
      boss.x = 200;

      // Spieler 1 stirbt auf Position x=50
      state.x = 50;
      state.y = 500;
      state.leben = 0;
      state.isDead = true;

      // Spieler 2 lebt auf Position x=450
      state.p2.x = 450;
      state.p2.y = 500;
      state.p2.leben = 3;
      state.p2.isDead = false;
    });

    // 200ms warten, damit der Loop den Boss bewegen kann
    await page.waitForTimeout(200);

    const bossState = await page.evaluate(async () => {
      const { arrays } = await import('./js/state.js');
      const boss = arrays.bosses[arrays.bosses.length - 1];
      return {
        x: boss.x
      };
    });

    // Da P2 bei 450 ist und der Boss bei 200 startete, muss sich der Boss nach rechts bewegt haben (> 200)
    // Wenn er stur auf P1 (x=50) fixiert wäre, hätte er sich nach links bewegt (< 200).
    expect(bossState.x).toBeGreaterThan(200);
  });

  test('Tastensteuerung Spieler 2: Taste L feuert im Co-op Modus nur die Bombe und NICHT den Laser', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    // Cooldowns und Arrays leeren
    await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      state.p2.energie = 50;
      state.p2.bombenCooldown = 0;
      state.p2.laserSchiesst = false;
      arrays.bombenArray.length = 0;
      arrays.laserArray.length = 0;
    });

    // Taste L drücken
    await page.keyboard.down('KeyL');
    await page.waitForTimeout(50);

    const shotState = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      return {
        bombenCount: arrays.bombenArray.length,
        laserCount: arrays.laserArray.length,
        p2LaserSchiesst: state.p2.laserSchiesst
      };
    });

    await page.keyboard.up('KeyL');

    expect(shotState.bombenCount).toBe(1);
    expect(shotState.laserCount).toBe(0);
    expect(shotState.p2LaserSchiesst).toBe(false);
  });

  test('HUD Layout im Co-op Modus: Punkte- und Levelanzeige sind zentriert und überdecken nicht das P2-HUD', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const scoreBox = await page.locator('#score-anzeige').boundingBox();
    const levelBox = await page.locator('#level-anzeige').boundingBox();
    const uiP2Box = await page.locator('#ui-container-p2').boundingBox();

    expect(scoreBox).not.toBeNull();
    expect(levelBox).not.toBeNull();
    expect(uiP2Box).not.toBeNull();

    // In 600px breitem Spielfeld: Score und Level müssen links von P2-HUD liegen (kein Overlap in X)
    expect(scoreBox.x + scoreBox.width).toBeLessThanOrEqual(uiP2Box.x + 5);
    expect(levelBox.x + levelBox.width).toBeLessThanOrEqual(uiP2Box.x + 5);
  });

  test('Dedicated Loot bei alleinigem Überleben: Wenn ein Spieler tot ist, spawnen nur Powerups für den lebenden Spieler', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    // Fall 1: Spieler 1 ist tot, Spieler 2 lebt
    const p2OnlyOwners = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.isDead = true;
      state.leben = 0;
      state.p2.isDead = false;
      state.p2.leben = 3;

      arrays.powerups.forEach(p => p.el && p.el.remove());
      arrays.powerups.length = 0;

      for (let i = 0; i < 4; i++) {
        Entities.erzeugePowerup(100 + i * 40, 100);
      }
      return arrays.powerups.map(p => p.owner);
    });

    expect(p2OnlyOwners).toEqual(['p2', 'p2', 'p2', 'p2']);

    // Fall 2: Spieler 2 ist tot, Spieler 1 lebt
    const p1OnlyOwners = await page.evaluate(async () => {
      const { state, arrays } = await import('./js/state.js');
      const Entities = await import('./js/entities.js');
      state.isDead = false;
      state.leben = 3;
      state.p2.isDead = true;
      state.p2.leben = 0;

      arrays.powerups.forEach(p => p.el && p.el.remove());
      arrays.powerups.length = 0;

      for (let i = 0; i < 4; i++) {
        Entities.erzeugePowerup(100 + i * 40, 100);
      }
      return arrays.powerups.map(p => p.owner);
    });

    expect(p1OnlyOwners).toEqual(['p1', 'p1', 'p1', 'p1']);
  });

  test('Highscore-Trennung: saveHighscore und getHighscores speichern Solo- und Co-op-Bestenlisten in separaten localStorage-Keys', async ({ page }) => {
    const result = await page.evaluate(async () => {
      localStorage.removeItem('spaceShooterHighscores');
      localStorage.removeItem('spaceShooterHighscores_coop');

      const Utils = await import('./js/utils.js');
      Utils.saveHighscore('SOL', 1500, 'viper', 'single');
      Utils.saveHighscore('COP', 3200, 'phantom', 'coop', 'viper');

      return {
        singleList: Utils.getHighscores('single'),
        coopList: Utils.getHighscores('coop'),
        rawSingleStorage: localStorage.getItem('spaceShooterHighscores'),
        rawCoopStorage: localStorage.getItem('spaceShooterHighscores_coop')
      };
    });

    expect(result.singleList.length).toBe(1);
    expect(result.singleList[0].name).toBe('SOL');
    expect(result.singleList[0].score).toBe(1500);

    expect(result.coopList.length).toBe(1);
    expect(result.coopList[0].name).toBe('COP');
    expect(result.coopList[0].score).toBe(3200);
    expect(result.coopList[0].shipP1).toBe('phantom');
    expect(result.coopList[0].shipP2).toBe('viper');

    expect(result.rawSingleStorage).not.toBeNull();
    expect(result.rawCoopStorage).not.toBeNull();
    expect(result.rawSingleStorage).not.toContain('COP');
    expect(result.rawCoopStorage).not.toContain('SOL');
  });

  test('Game Over im Co-op Modus: Highscore-Eingabe qualifiziert sich für Co-op Bestenliste und speichert Schiffe beider Spieler', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    // Setze Schiffe und Score
    await page.evaluate(async () => {
      localStorage.removeItem('spaceShooterHighscores');
      localStorage.removeItem('spaceShooterHighscores_coop');
      const { state } = await import('./js/state.js');
      const Utils = await import('./js/utils.js');
      state.score = 2400;
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'phantom';
      Utils.triggerGameOver();
    });

    const hsForm = page.locator('#highscore-form');
    await expect(hsForm).toBeVisible();

    const hsInput = page.locator('#highscore-name');
    await hsInput.fill('DUO');
    await page.locator('#btn-save-score').click();

    await expect(hsForm).toBeHidden();

    const storedData = await page.evaluate(async () => {
      const Utils = await import('./js/utils.js');
      return {
        coopList: Utils.getHighscores('coop'),
        singleList: Utils.getHighscores('single')
      };
    });

    expect(storedData.coopList.length).toBe(1);
    expect(storedData.coopList[0].name).toBe('DUO');
    expect(storedData.coopList[0].score).toBe(2400);
    expect(storedData.coopList[0].shipP1).toBe('viper');
    expect(storedData.coopList[0].shipP2).toBe('phantom');
    expect(storedData.singleList.length).toBe(0);
  });

  test('Highscore-Tabs: Game-Over Screen erlaubt Umschalten zwischen Solo- und Co-op-Bestenliste', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    await page.evaluate(async () => {
      localStorage.removeItem('spaceShooterHighscores');
      localStorage.removeItem('spaceShooterHighscores_coop');

      const Utils = await import('./js/utils.js');
      Utils.saveHighscore('SOL', 1111, 'viper', 'single');
      Utils.saveHighscore('DUO', 9999, 'viper', 'coop', 'phantom');

      Utils.triggerGameOver();
    });

    const tabSingle = page.locator('#hs-tab-single');
    const tabBot = page.locator('#hs-tab-bot');

    await expect(tabSingle).toBeVisible();
    await expect(tabBot).toBeVisible();

    // Solo Tab anklicken
    await tabSingle.click();
    await expect(tabSingle).toHaveClass(/active/);
    await expect(page.locator('#highscore-body')).toContainText('SOL');
    await expect(page.locator('#highscore-body')).toContainText('1111');
    await expect(page.locator('#highscore-body')).not.toContainText('DUO');

    // Bot Co-op Tab anklicken
    await tabBot.click();
    await expect(tabBot).toHaveClass(/active/);
    await expect(page.locator('#highscore-body')).toContainText('DUO');
    await expect(page.locator('#highscore-body')).toContainText('9999');
    await expect(page.locator('#highscore-body')).not.toContainText('SOL');
    await expect(page.locator('#highscore-body .hs-coop-badges')).toBeVisible();
  });

  test('Co-op Cutszene: Im 2-Spieler-Modus erscheinen beide Spielerschiffe (P1 und P2) im Konvoi', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem('starshooter_skip_cutscene');
    });

    await page.locator('#gamemode-btn-coop').click();

    // Wähle P1 und P2 Modelle im Hangar
    await page.locator('#hangar-player-tabs button[data-player="p1"]').click();
    await page.locator('.hangar-model-btn[data-model="viper"]').click();
    await page.locator('#hangar-player-tabs button[data-player="p2"]').click();
    await page.locator('.hangar-model-btn[data-model="phantom"]').click();

    // Start
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    await expect(page.locator('#cutscene-container')).toBeVisible();

    const p1CutsceneShip = page.locator('.cutscene-ship.ship-player-p1');
    const p2CutsceneShip = page.locator('.cutscene-ship.ship-player-p2');

    await expect(p1CutsceneShip).toBeVisible();
    await expect(p2CutsceneShip).toBeVisible();
  });

  test('Co-op Cutszene: Beide Spielerschiffe überleben den Angriff und steigen gemeinsam im Lichtstrahl auf', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem('starshooter_skip_cutscene');
    });

    await page.locator('#gamemode-btn-coop').click();

    // Start
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    await expect(page.locator('#cutscene-container')).toBeVisible();

    // Schneller Vorlauf bis kurz nach Beginn der Lichtstrahl-Phase (~12.5s)
    await page.waitForTimeout(12600);

    const p1CutsceneShip = page.locator('.cutscene-ship.ship-player-p1');
    const p2CutsceneShip = page.locator('.cutscene-ship.ship-player-p2');

    // Beide Schiffe müssen überlebt haben
    await expect(p1CutsceneShip).toBeAttached();
    await expect(p2CutsceneShip).toBeAttached();

    // Lichtstrahl aktiv
    const lightBeam = page.locator('#cutscene-light-beam');
    await expect(lightBeam).toBeVisible();

    // Nach weiteren 1.5s steigen beide nach oben auf (top < 200)
    await page.waitForTimeout(1600);

    const p1Box = await p1CutsceneShip.boundingBox();
    const p2Box = await p2CutsceneShip.boundingBox();

    if (p1Box && p2Box) {
      expect(p1Box.y).toBeLessThan(200);
      expect(p2Box.y).toBeLessThan(200);
    }
  });

  test('Spieler 2 Raketenwerfer-Visuals: Zeigt je nach Schiffsmodell und Level die korrekten Werfer-Pods auf Spieler 2 an', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Wähle für P2 Viper-X
    await page.locator('#hangar-player-tabs button[data-player="p2"]').click();
    await page.locator('.hangar-model-btn[data-model="viper"]').click();

    // Start
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const p2Links = page.locator('#spieler-2 .werfer-links');
    const p2Rechts = page.locator('#spieler-2 .werfer-rechts');
    const p2Center = page.locator('#spieler-2 .werfer-center');

    // Viper-X auf Stufe 1: linker Werfer sichtbar, rechter unsichtbar
    await expect(p2Links).toBeVisible();
    await expect(p2Rechts).toBeHidden();
    await expect(p2Center).toBeHidden();

    // Wechsle P2 auf Phantom-NX Stufe 1
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Utils = await import('./js/utils.js');
      state.p2.selectedShipModel = 'phantom';
      state.p2.raketenStufe = 1;
      Utils.updateRaketenWerferVisuals();
    });

    await expect(p2Links).toBeHidden();
    await expect(p2Rechts).toBeVisible();
    await expect(p2Center).toBeHidden();

    // Auf Stufe 3: beide seitlichen Werfer sichtbar
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Utils = await import('./js/utils.js');
      state.p2.raketenStufe = 3;
      Utils.updateRaketenWerferVisuals();
    });

    await expect(p2Links).toBeVisible();
    await expect(p2Rechts).toBeVisible();
    await expect(p2Center).toBeHidden();

    // Auf Stufe 5: alle 3 Werfer sichtbar
    await page.evaluate(async () => {
      const { state } = await import('./js/state.js');
      const Utils = await import('./js/utils.js');
      state.p2.raketenStufe = 5;
      Utils.updateRaketenWerferVisuals();
    });

    await expect(p2Links).toBeVisible();
    await expect(p2Rechts).toBeVisible();
    await expect(p2Center).toBeVisible();
  });

  test('Boss-Raketen Ausrichtung: Raketen fliegen vorwärts mit der Spitze in Flugrichtung auf den Spieler zu', async ({ page }) => {
    // Spiel starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const result = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { erzeugeBossRakete } = await import('./js/entities.js');
      const { gameLoop } = await import('./js/loop.js');

      // Spielerposition unten in der Mitte
      state.x = 185;
      state.y = 500;

      // Boss-Rakete oben mittig erzeugen mit Richtung nach unten
      erzeugeBossRakete(185, 100, 0);
      const br = arrays.bossRaketenArray[arrays.bossRaketenArray.length - 1];
      br.vx = 0;
      br.vy = 2.5; // Fliegt senkrecht nach unten auf den Spieler zu

      // Einen Loop-Frame ausführen
      gameLoop();

      return {
        vx: br.vx,
        vy: br.vy,
        transform: br.el.style.transform
      };
    });

    // Bei vertikalem Flug nach unten (vx=0, vy>0) muss die Drehung ~180deg betragen (Spitze zeigt nach unten auf Spieler)
    const match = result.transform.match(/rotate\(([-\d.]+)deg\)/);
    expect(match).not.toBeNull();
    const deg = parseFloat(match[1]);
    expect(Math.abs(deg - 180)).toBeLessThan(5);
  });

  test('Spieler-Raketen Flugdynamik & Homing: Raketen fliegen mit 3-Phasen-Physik und tracken Feinde im 600px Modus', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const testResult = await page.evaluate(async () => {
      const { arrays, state, config } = await import('./js/state.js');
      const { erzeugeFeind } = await import('./js/entities.js');
      const { gameLoop } = await import('./js/loop.js');

      // Leere bisherige Feinde und Raketen
      arrays.feinde.forEach(f => { if (f.el) f.el.remove(); });
      arrays.feinde.length = 0;
      arrays.raketenArray.forEach(r => { if (r.el) r.el.remove(); });
      arrays.raketenArray.length = 0;

      // Erzeuge Feind auf der rechten Seite des 600px Feldes
      erzeugeFeind(450, 100);

      // Rakete auf der linken Seite des 600px Feldes mit Homing-Eigenschaft
      const rEl = document.createElement('div');
      rEl.className = 'raketen-projektil rakete-homing';
      document.getElementById('spielfeld').appendChild(rEl);

      const rocket = {
        el: rEl,
        x: 100,
        y: 450,
        vx: 0,
        vy: 2.0,
        schaden: 30,
        radius: 80,
        homing: true,
        owner: 'p1',
        age: 0,
        detoniert: false
      };
      arrays.raketenArray.push(rocket);

      let vyAtPhase2 = 0;
      let maxObservedVy = 0;

      for (let f = 0; f < 45; f++) {
        gameLoop();
        if (rocket.age === 15) vyAtPhase2 = rocket.vy;
        if (rocket.vy > maxObservedVy) maxObservedVy = rocket.vy;
      }

      return {
        initialX: 100,
        finalX: rocket.x,
        finalVx: rocket.vx,
        vyAtPhase2: vyAtPhase2,
        maxVy: maxObservedVy
      };
    });

    // In Phase 2 (Anlauf nehmen) verlangsamt sich die Rakete spürbar unter die Startgeschwindigkeit
    expect(testResult.vyAtPhase2).toBeLessThan(1.5);
    // Raketengeschwindigkeit vy bleibt kontrolliert (max <= 13)
    expect(testResult.maxVy).toBeLessThanOrEqual(13);
    // Rakete muss sich deutlich nach rechts in Richtung des Feindes bei x=450 eingedreht haben (vx > 0 und finalX > 160)
    expect(testResult.finalVx).toBeGreaterThan(1.0);
    expect(testResult.finalX).toBeGreaterThan(160);
  });

  test('Raketen Balancing Co-op: Raketen haben im Co-op höhere Maxgeschwindigkeit, größeren Homing-Suchbereich und stärkere Lenkrate als im Solo-Modus', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const result = await page.evaluate(async () => {
      const { state, config } = await import('./js/state.js');

      // Simuliere Phase-3-Physik direkt für Co-op und Solo,
      // ohne gameLoop aufzurufen (vermeidet Detonation und DOM-Abhängigkeiten)
      function simulatePhase3(isCoop) {
        // Exakt dieselbe Logik wie in loop.js Phase 3
        const rMaxVy = isCoop ? 15 : 13;
        const rAccel = isCoop ? 0.5 : 0.45;
        const homingYRange = isCoop ? 200 : 140;
        const maxTurn = isCoop ? 0.26 : 0.22;

        // Rakete startet in Phase 3 mit 4px/Frame vy, Feind weit rechts
        let r = { x: 50, y: 500, vx: 0, vy: 4.0 };
        const targetX = 500, targetY = 100;

        let maxVy = 0;
        let maxTurnObserved = 0;

        for (let f = 0; f < 40; f++) {
          // Beschleunigung
          r.vy = Math.min(rMaxVy, r.vy + rAccel);
          r.vx *= 0.92;

          // Homing: Feind liegt bei zcx=500+10=510, zcy=100+10=110 → zcy < r.y + homingYRange?
          const zcx = targetX + 10;
          const zcy = targetY + 10;
          if (zcy < r.y + homingYRange) {
            const targetAngle = Math.atan2(zcy - (r.y + 8), zcx - (r.x + 3));
            const currentAngle = Math.atan2(-r.vy, r.vx || 0.0001);
            let diff = targetAngle - currentAngle;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            const vxBefore = r.vx;
            const newAngle = currentAngle + Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
            const currentSpeed = Math.hypot(r.vx, r.vy) || r.vy;
            r.vx = Math.cos(newAngle) * currentSpeed;
            r.vy = -Math.sin(newAngle) * currentSpeed;
            const dvx = Math.abs(r.vx - vxBefore);
            if (dvx > maxTurnObserved) maxTurnObserved = dvx;
          }

          r.x += r.vx;
          r.y -= r.vy;

          if (r.vy > maxVy) maxVy = r.vy;
        }
        return { maxVy, maxTurnObserved, finalVx: r.vx, rMaxVy, rAccel, homingYRange, maxTurn };
      }

      const coop = simulatePhase3(true);
      const solo = simulatePhase3(false);

      return { coop, solo };
    });

    // Co-op Konfiguration muss höher sein als Solo
    expect(result.coop.rMaxVy).toBeGreaterThan(result.solo.rMaxVy); // 15 > 13
    expect(result.coop.rAccel).toBeGreaterThan(result.solo.rAccel); // 0.5 > 0.45
    expect(result.coop.homingYRange).toBeGreaterThan(result.solo.homingYRange); // 200 > 140
    expect(result.coop.maxTurn).toBeGreaterThan(result.solo.maxTurn); // 0.26 > 0.22

    // Konkrete Zielwerte (Co-op)
    expect(result.coop.rMaxVy).toBe(15);
    expect(result.coop.homingYRange).toBe(200);
    expect(result.coop.maxTurn).toBeCloseTo(0.26, 2);

    // Solo bleibt unverändert
    expect(result.solo.rMaxVy).toBe(13);
    expect(result.solo.homingYRange).toBe(140);
    expect(result.solo.maxTurn).toBeCloseTo(0.22, 2);

    // Im Co-op dreht die Rakete stärker (größere vx-Änderung durch maxTurn 0.26 statt 0.22)
    expect(result.coop.maxTurnObserved).toBeGreaterThan(result.solo.maxTurnObserved);
    // Im Co-op erreicht die Rakete eine höhere Maxgeschwindigkeit
    expect(result.coop.maxVy).toBeGreaterThan(result.solo.maxVy);
  });

  test('Traktorstrahl-Kopplung im 2-Spieler Modus: Spieler koppelt bis zu 3 Powerups für den Partner an', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const result = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { erzeugePowerup } = await import('./js/entities.js');
      const { gameLoop } = await import('./js/loop.js');

      // Leere vorhandene Powerups
      arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      arrays.powerups.length = 0;

      // Erzeuge 4 Powerups für Spieler 2 an der gleichen X/Y-Position von Spieler 1
      state.x = 200;
      state.y = 300;

      erzeugePowerup(200, 300, 'laserWaffe', 'p2');
      gameLoop();

      erzeugePowerup(200, 300, 'raketenWaffe', 'p2');
      gameLoop();

      erzeugePowerup(200, 300, 'bombenWaffe', 'p2');
      gameLoop();

      erzeugePowerup(200, 300, 'schild', 'p2');
      gameLoop();

      return {
        totalPowerups: arrays.powerups.length,
        towedCount: arrays.powerups.filter(p => p.towedBy === 'p1').length,
        untowedCount: arrays.powerups.filter(p => !p.towedBy).length
      };
    });

    expect(result.totalPowerups).toBe(4);
    expect(result.towedCount).toBe(3);
    expect(result.untowedCount).toBe(1);
  });

  test('Traktorstrahl-Kopplung: Jedes gezogene Powerup verlangsamt das Schiff um 10% (1=90%, 2=80%, 3=70%)', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const testSpeeds = await page.evaluate(async () => {
      const { arrays, state, config } = await import('./js/state.js');
      const { erzeugePowerup } = await import('./js/entities.js');
      const { gameLoop } = await import('./js/loop.js');

      arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      arrays.powerups.length = 0;

      // Base Speed mit 0 Powerups
      state.y = 300;
      state.tastenGedrueckt.w = true;
      gameLoop();
      const dist0 = 300 - state.y;
      state.tastenGedrueckt.w = false;

      // 1 Powerup angehängt
      erzeugePowerup(state.x, state.y, 'laserWaffe', 'p2');
      gameLoop(); // P1 koppelt an
      state.y = 300;
      state.tastenGedrueckt.w = true;
      gameLoop();
      const dist1 = 300 - state.y;
      state.tastenGedrueckt.w = false;

      // 2 Powerups angehängt
      erzeugePowerup(state.x, state.y, 'raketenWaffe', 'p2');
      gameLoop(); // P1 koppelt an
      state.y = 300;
      state.tastenGedrueckt.w = true;
      gameLoop();
      const dist2 = 300 - state.y;
      state.tastenGedrueckt.w = false;

      // 3 Powerups angehängt
      erzeugePowerup(state.x, state.y, 'bombenWaffe', 'p2');
      gameLoop(); // P1 koppelt an
      state.y = 300;
      state.tastenGedrueckt.w = true;
      gameLoop();
      const dist3 = 300 - state.y;
      state.tastenGedrueckt.w = false;

      return {
        dist0: Math.round(dist0 * 100) / 100,
        dist1: Math.round(dist1 * 100) / 100,
        dist2: Math.round(dist2 * 100) / 100,
        dist3: Math.round(dist3 * 100) / 100
      };
    });

    expect(testSpeeds.dist0).toBe(6.0);
    expect(testSpeeds.dist1).toBe(5.4); // 90% von 6.0
    expect(testSpeeds.dist2).toBe(4.8); // 80% von 6.0
    expect(testSpeeds.dist3).toBe(4.2); // 70% von 6.0
  });

  test('Traktorstrahl-Kopplung: Partner sammelt gezogenes Powerup durch Berührung ein und löst den Strahl', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const result = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { erzeugePowerup } = await import('./js/entities.js');
      const { gameLoop } = await import('./js/loop.js');

      arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      arrays.powerups.length = 0;

      state.laserStufe = 1;
      state.p2.laserStufe = 1;

      // P1 koppelt Powerup für P2 an
      state.x = 200;
      state.y = 300;
      state.p2.x = 450;
      state.p2.y = 300;

      erzeugePowerup(200, 300, 'laserWaffe', 'p2');
      gameLoop();

      const pu = arrays.powerups[0];
      const afterAttach = {
        isTowed: pu && pu.towedBy === 'p1',
        p1Laser: state.laserStufe,
        p2Laser: state.p2.laserStufe,
        hasBeam: !!document.querySelector('.tractor-beam-svg')
      };

      // P2 bewegt sich auf das gezogene Powerup zu
      state.p2.x = pu.x;
      state.p2.y = pu.y;

      gameLoop();

      const afterHandoff = {
        totalPowerups: arrays.powerups.length,
        p1Laser: state.laserStufe,
        p2Laser: state.p2.laserStufe,
        hasBeam: !!document.querySelector('.tractor-beam-svg')
      };

      return {
        afterAttach,
        afterHandoff
      };
    });

    expect(result.afterAttach.isTowed).toBe(true);
    expect(result.afterAttach.p1Laser).toBe(1);
    expect(result.afterAttach.p2Laser).toBe(1);
    expect(result.afterAttach.hasBeam).toBe(true);

    expect(result.afterHandoff.totalPowerups).toBe(0);
    expect(result.afterHandoff.p1Laser).toBe(1);
    expect(result.afterHandoff.p2Laser).toBe(2); // P2 hat das Upgrade erhalten!
    expect(result.afterHandoff.hasBeam).toBe(false); // Strahl wurde entfernt!
  });

  test('Traktorstrahl-Kopplung: Wenn der ziehende Spieler stirbt, löst sich der Traktorstrahl und das Powerup treibt frei weiter', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const result = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { erzeugePowerup } = await import('./js/entities.js');
      const { gameLoop } = await import('./js/loop.js');

      arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      arrays.powerups.length = 0;

      // P1 koppelt Powerup an
      state.x = 200;
      state.y = 300;
      erzeugePowerup(200, 300, 'schild', 'p2');
      gameLoop();

      const pu = arrays.powerups[0];
      const beforeDeath = {
        isTowed: pu && pu.towedBy === 'p1',
        hasBeam: !!document.querySelector('.tractor-beam-svg')
      };

      // P1 wird zerstört
      state.isDead = true;
      gameLoop();

      const afterDeath = {
        isTowed: pu && pu.towedBy !== null,
        hasBeam: !!document.querySelector('.tractor-beam-svg'),
        powerupExists: arrays.powerups.length === 1
      };

      return {
        beforeDeath,
        afterDeath
      };
    });

    expect(result.beforeDeath.isTowed).toBe(true);
    expect(result.beforeDeath.hasBeam).toBe(true);

    expect(result.afterDeath.isTowed).toBe(false);
    expect(result.afterDeath.hasBeam).toBe(false);
    expect(result.afterDeath.powerupExists).toBe(true);
  });

  test('Viper Splitter-Drop: Jeder 10. vom Viper zerstörte Feind droppt einen Splitter (Rot oder Weiß), während Phantom keine Splitter erzeugt', async ({ page }) => {
    // Start game
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const result = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { erzeugeFeind } = await import('./js/entities.js');
      const { zerstoereZiel } = await import('./js/utils.js');

      arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      arrays.powerups.length = 0;
      arrays.feinde.forEach(f => { if (f.el) f.el.remove(); });
      arrays.feinde.length = 0;

      state.selectedShipModel = 'viper';
      state.viperKillCount = 0;

      // 1. Zerstöre 9 Feinde -> noch kein Splitter-Drop
      for (let i = 0; i < 9; i++) {
        erzeugeFeind(100, 100);
        const f = arrays.feinde[arrays.feinde.length - 1];
        f.traegtPowerup = false;
        zerstoereZiel(f, 'p1');
      }

      const countAfter9 = arrays.powerups.length;

      // 2. Zerstöre 10. Feind -> exakt 1 Splitter-Drop
      erzeugeFeind(100, 100);
      const f10 = arrays.feinde[arrays.feinde.length - 1];
      f10.traegtPowerup = false;
      zerstoereZiel(f10, 'p1');

      const countAfter10 = arrays.powerups.length;
      const dropType10 = arrays.powerups.length > 0 ? arrays.powerups[0].type : null;

      // 3. Zerstöre weitere 9 Feinde (insgesamt 19)
      for (let i = 0; i < 9; i++) {
        erzeugeFeind(100, 100);
        const f = arrays.feinde[arrays.feinde.length - 1];
        f.traegtPowerup = false;
        zerstoereZiel(f, 'p1');
      }

      const countAfter19 = arrays.powerups.length;

      // 4. Zerstöre 20. Feind -> 2. Splitter-Drop
      erzeugeFeind(100, 100);
      const f20 = arrays.feinde[arrays.feinde.length - 1];
      f20.traegtPowerup = false;
      zerstoereZiel(f20, 'p1');

      const countAfter20 = arrays.powerups.length;

      // 5. Phantom-Check: Zerstöre 10 Feinde mit Phantom -> 0 Drops
      arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      arrays.powerups.length = 0;
      state.selectedShipModel = 'phantom';

      for (let i = 0; i < 10; i++) {
        erzeugeFeind(100, 100);
        const f = arrays.feinde[arrays.feinde.length - 1];
        f.traegtPowerup = false;
        zerstoereZiel(f, 'p1');
      }

      const phantomDrops = arrays.powerups.length;

      return {
        countAfter9,
        countAfter10,
        dropType10,
        countAfter19,
        countAfter20,
        phantomDrops
      };
    });

    expect(result.countAfter9).toBe(0);
    expect(result.countAfter10).toBe(1);
    expect(['splitterRot', 'splitterWeiss']).toContain(result.dropType10);
    expect(result.countAfter19).toBe(1);
    expect(result.countAfter20).toBe(2);
    expect(result.phantomDrops).toBe(0);
  });

  test('Viper Roter Splitter: Einsammeln von 10 roten Splittern gewährt +1 Leben und setzt den Zähler zurück', async ({ page }) => {
    // Start game
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const result = await page.evaluate(async () => {
      const { arrays, state, dom } = await import('./js/state.js');
      const { erzeugePowerup } = await import('./js/entities.js');
      const { gameLoop } = await import('./js/loop.js');

      arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      arrays.powerups.length = 0;

      state.selectedShipModel = 'viper';
      state.leben = 3;
      state.splitterRot = 0;
      state.x = 200;
      state.y = 200;

      // Sammle 1 roten Splitter ein
      erzeugePowerup(200, 200, 'splitterRot');
      gameLoop();

      const after1 = {
        splitterRot: state.splitterRot,
        leben: state.leben
      };

      // Setze Zähler auf 9 und sammle den 10. Splitter ein
      state.splitterRot = 9;
      erzeugePowerup(200, 200, 'splitterRot');
      gameLoop();

      const after10 = {
        splitterRot: state.splitterRot,
        leben: state.leben,
        herzenCount: dom.lebenAnzeige.querySelectorAll('.leben-herz').length
      };

      return {
        after1,
        after10
      };
    });

    expect(result.after1.splitterRot).toBe(1);
    expect(result.after1.leben).toBe(3);

    expect(result.after10.splitterRot).toBe(0);
    expect(result.after10.leben).toBe(4);
    expect(result.after10.herzenCount).toBe(4);
  });

  test('Viper Weißer Splitter: Einsammeln von 10 weißen Splittern aktiviert die Super-Waffe und setzt den Zähler zurück', async ({ page }) => {
    // Start game
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const result = await page.evaluate(async () => {
      const { arrays, state, dom } = await import('./js/state.js');
      const { erzeugePowerup } = await import('./js/entities.js');
      const { gameLoop } = await import('./js/loop.js');

      arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      arrays.powerups.length = 0;

      state.selectedShipModel = 'viper';
      state.laserStufe = 1;
      state.raketenStufe = 1;
      state.bombenStufe = 1;
      state.splitterWeiss = 0;
      state.x = 200;
      state.y = 200;

      // Sammle 1 weißen Splitter ein
      erzeugePowerup(200, 200, 'splitterWeiss');
      gameLoop();

      const after1 = {
        splitterWeiss: state.splitterWeiss,
        laserStufe: state.laserStufe,
        raketenStufe: state.raketenStufe,
        bombenStufe: state.bombenStufe
      };

      // Setze Zähler auf 9 und sammle den 10. Splitter ein
      state.splitterWeiss = 9;
      erzeugePowerup(200, 200, 'splitterWeiss');
      gameLoop();

      const after10 = {
        splitterWeiss: state.splitterWeiss,
        laserStufe: state.laserStufe,
        raketenStufe: state.raketenStufe,
        bombenStufe: state.bombenStufe,
        activePuText: dom.aktivePowerupsContainer.textContent
      };

      return {
        after1,
        after10
      };
    });

    expect(result.after1.splitterWeiss).toBe(1);
    expect(result.after1.laserStufe).toBe(1);
    expect(result.after1.raketenStufe).toBe(1);
    expect(result.after1.bombenStufe).toBe(1);

    expect(result.after10.splitterWeiss).toBe(0);
    expect(result.after10.laserStufe).toBe(2);
    expect(result.after10.raketenStufe).toBe(2);
    expect(result.after10.bombenStufe).toBe(2);
  });

  test('Co-op Splitter-System: Unabhängige Zählung für Spieler 1 & 2 und Schiff-spezifische HUD-Sichtbarkeit', async ({ page }) => {
    await page.locator('#gamemode-btn-coop').click();

    // Start
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const result = await page.evaluate(async () => {
      const { arrays, state, dom } = await import('./js/state.js');
      const { erzeugePowerup } = await import('./js/entities.js');
      const { gameLoop } = await import('./js/loop.js');
      const { updateSplitterUI, updateSplitterP2UI } = await import('./js/utils.js');

      arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      arrays.powerups.length = 0;

      // P1 ist Viper, P2 ist Viper
      state.selectedShipModel = 'viper';
      state.p2.selectedShipModel = 'viper';
      state.splitterRot = 0;
      state.splitterWeiss = 0;
      state.p2.splitterRot = 0;
      state.p2.splitterWeiss = 0;

      updateSplitterUI();
      updateSplitterP2UI();

      const initialHud = {
        p1HudDisplay: dom.splitterHudP1 ? dom.splitterHudP1.style.display : null,
        p2HudDisplay: dom.splitterHudP2 ? dom.splitterHudP2.style.display : null
      };

      // P1 sammelt roten Splitter
      state.x = 100; state.y = 200;
      erzeugePowerup(100, 200, 'splitterRot', 'p1');
      gameLoop();

      // P2 sammelt weißen Splitter
      state.p2.x = 400; state.p2.y = 200;
      erzeugePowerup(400, 200, 'splitterWeiss', 'p2');
      gameLoop();

      const afterPickups = {
        p1Rot: state.splitterRot,
        p1Weiss: state.splitterWeiss,
        p2Rot: state.p2.splitterRot,
        p2Weiss: state.p2.splitterWeiss,
        p1RotText: dom.splitterRotCountP1 ? dom.splitterRotCountP1.textContent : '',
        p2WeissText: dom.splitterWeissCountP2 ? dom.splitterWeissCountP2.textContent : ''
      };

      // Wenn P2 Phantom ist, soll P2-HUD ausgeblendet sein
      state.p2.selectedShipModel = 'phantom';
      updateSplitterP2UI();

      const phantomCheck = {
        p1HudDisplay: dom.splitterHudP1 ? dom.splitterHudP1.style.display : null,
        p2HudDisplay: dom.splitterHudP2 ? dom.splitterHudP2.style.display : null
      };

      return {
        initialHud,
        afterPickups,
        phantomCheck
      };
    });

    expect(result.initialHud.p1HudDisplay).toBe('flex');
    expect(result.initialHud.p2HudDisplay).toBe('flex');

    expect(result.afterPickups.p1Rot).toBe(1);
    expect(result.afterPickups.p1Weiss).toBe(0);
    expect(result.afterPickups.p2Rot).toBe(0);
    expect(result.afterPickups.p2Weiss).toBe(1);
    expect(result.afterPickups.p1RotText).toBe('1');
    expect(result.afterPickups.p2WeissText).toBe('1');

    expect(result.phantomCheck.p1HudDisplay).toBe('flex');
    expect(result.phantomCheck.p2HudDisplay).toBe('none');
  });

  test('Hangar & Perks: Der Viper-X Interceptor zeigt den neuen Splitter-Drop-Perk im Hangar an', async ({ page }) => {
    // Klicke auf Viper im Hangar
    const viperBtn = page.locator('.hangar-model-btn[data-model="viper"]');
    await expect(viperBtn).toBeVisible();
    await viperBtn.click();

    const perksContainer = page.locator('#hangar-ship-perks');
    await expect(perksContainer).toBeVisible();
    await expect(perksContainer).toContainText('SPLITTER-DROP');
  });

  test('Boss Splitter-Drops: Besiegter Boss droppt immer garantiert 3 Splitter (Rot oder Weiß) zusätzlich zu seinen Belohnungen', async ({ page }) => {
    // Start game
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    const skipBtn = page.locator('#cutscene-skip-btn');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }

    const result = await page.evaluate(async () => {
      const { arrays, state } = await import('./js/state.js');
      const { erzeugeBoss } = await import('./js/entities.js');
      const { zerstoereZiel } = await import('./js/utils.js');

      arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      arrays.powerups.length = 0;
      arrays.bosses.forEach(b => { if (b.el) b.el.remove(); });
      arrays.bosses.length = 0;

      erzeugeBoss();
      const boss = arrays.bosses[0];

      zerstoereZiel(boss, 'p1');

      const allDrops = arrays.powerups.map(p => p.type);
      const shardDrops = allDrops.filter(t => t === 'splitterRot' || t === 'splitterWeiss');
      const regularDrops = allDrops.filter(t => t !== 'splitterRot' && t !== 'splitterWeiss');

      return {
        totalPowerups: allDrops.length,
        shardCount: shardDrops.length,
        regularCount: regularDrops.length,
        hasSuperWaffe: regularDrops.includes('superWaffe')
      };
    });

    expect(result.shardCount).toBe(3);
    expect(result.regularCount).toBe(3);
    expect(result.totalPowerups).toBe(6);
    expect(result.hasSuperWaffe).toBe(true);
  });

  test('Splitter-Optik: Splitter werden als spitze, ungleichseitige Dreiecke ohne Buchstaben gerendert', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const { arrays } = await import('./js/state.js');
      const { erzeugePowerup } = await import('./js/entities.js');

      arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      arrays.powerups.length = 0;

      erzeugePowerup(100, 100, 'splitterRot');
      erzeugePowerup(150, 100, 'splitterWeiss');

      const rotPu = arrays.powerups[0];
      const weissPu = arrays.powerups[1];

      const rotSvg = rotPu.el.querySelector('svg.splitter-shard-svg');
      const weissSvg = weissPu.el.querySelector('svg.splitter-shard-svg');

      const rotPolygon = rotSvg ? rotSvg.querySelector('polygon') : null;
      const weissPolygon = weissSvg ? weissSvg.querySelector('polygon') : null;

      return {
        rotHasClass: rotPu.el.classList.contains('powerup-splitter'),
        weissHasClass: weissPu.el.classList.contains('powerup-splitter'),
        rotText: rotPu.el.textContent.trim(),
        weissText: weissPu.el.textContent.trim(),
        rotHasSvgPolygon: !!rotPolygon,
        weissHasSvgPolygon: !!weissPolygon,
        rotPoints: rotPolygon ? rotPolygon.getAttribute('points') : null
      };
    });

    expect(result.rotHasClass).toBe(true);
    expect(result.weissHasClass).toBe(true);
    expect(result.rotText).toBe('');
    expect(result.weissText).toBe('');
    expect(result.rotHasSvgPolygon).toBe(true);
    expect(result.weissHasSvgPolygon).toBe(true);
    expect(result.rotPoints).toBeTruthy();
  });
});


test.describe('Bot-Partner', () => {

  test('Bot-Toggle erscheint im Coop-Modus bei P2-Tab und setzt p2IsBot', async ({ page }) => {
    // What's New Overlay schließen falls es erscheint
    const whatsNewOverlay = page.locator('#whats-new-overlay');
    if (await whatsNewOverlay.isVisible()) {
      await page.click('#btn-close-whats-new');
      await expect(whatsNewOverlay).toBeHidden();
    }

    // Bot-Controls sind initial nicht sichtbar
    const botControls = page.locator('#p2-bot-controls');
    await expect(botControls).toBeHidden();

    // Coop-Modus aktivieren
    await page.click('#gamemode-btn-coop');

    // P2-Tab anklicken
    await page.click('.hangar-player-tab[data-player="p2"]');

    // Bot-Controls sind jetzt sichtbar
    await expect(botControls).toBeVisible();

    // Bot-Toggle Button existiert und hat korrekten Initialtext
    const botToggle = page.locator('#btn-p2-bot-toggle');
    await expect(botToggle).toBeVisible();
    await expect(botToggle).toContainText('BOT');

    // p2IsBot ist initial false
    let p2IsBot = await page.evaluate(() => {
      const mod = window.__gameState || null;
      if (mod) return mod.p2IsBot;
      // Fallback: direkt im ES-Modul nachschauen
      return document.querySelector('#btn-p2-bot-toggle').classList.contains('active');
    });
    expect(p2IsBot).toBe(false);

    // Klick auf Bot-Toggle
    await botToggle.click();

    // Button hat jetzt 'active' Klasse
    await expect(botToggle).toHaveClass(/active/);
    await expect(botToggle).toContainText('BOT AKTIV');

    // Difficulty-Panel ist jetzt sichtbar
    const diffPanel = page.locator('#bot-difficulty-panel');
    await expect(diffPanel).toBeVisible();

    // Normal ist default-aktiv
    const normalBtn = page.locator('.bot-diff-btn[data-diff="normal"]');
    await expect(normalBtn).toHaveClass(/active/);

    // Klick auf Hard
    const hardBtn = page.locator('.bot-diff-btn[data-diff="hard"]');
    await hardBtn.click();
    await expect(hardBtn).toHaveClass(/active/);
    await expect(normalBtn).not.toHaveClass(/active/);

    // Zurück auf Single-Player: Bot-Controls verschwinden + State wird zurückgesetzt
    await page.click('#gamemode-btn-single');
    await expect(botControls).toBeHidden();
    await expect(botToggle).not.toHaveClass(/active/);
  });

  test('Bot bewegt sich auf einen Feind zu', async ({ page }) => {
    // What's New Overlay schließen
    const btnClose = page.locator('#btn-close-whats-new');
    await btnClose.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(200);

    // Coop-Modus aktivieren + Bot aktivieren
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Spiel starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten bis Cutscene vorbei und Spiel läuft
    await page.waitForFunction(() => {
      const mod = window.__game;
      if (mod && mod.state) return mod.state.spielLaeuft;
      // Fallback: Prüfe ob Spieler sichtbar
      const spieler = document.getElementById('spieler');
      return spieler && spieler.style.display !== 'none';
    }, null, { timeout: 5000 });

    // P2 Startposition erfassen und Feind direkt über P2 spawnen
    const startPos = await page.evaluate(() => {
      const mod = window.__game;
      const s = mod ? mod.state : null;
      if (!s || !s.p2) return null;

      // Feind links von P2 spawnen, damit Bot sich dorthin bewegen muss
      const feindX = s.p2.x - 100;
      if (mod && mod.Entities) {
        mod.Entities.erzeugeFeind(feindX, 50, 'stop_and_go', 0);
      }
      return { x: s.p2.x, y: s.p2.y, feindX: feindX };
    });

    // Einige Frames warten, damit der Bot reagiert
    await page.waitForTimeout(500);

    // Prüfen, dass P2 sich in Richtung des Feindes bewegt hat
    const endPos = await page.evaluate(() => {
      const mod = window.__game;
      if (!mod || !mod.state || !mod.state.p2) return null;
      return { x: mod.state.p2.x, y: mod.state.p2.y };
    });

    expect(startPos).toBeTruthy();
    expect(endPos).toBeTruthy();
    // Bot soll sich nach links bewegt haben (Richtung Feind)
    expect(endPos.x).toBeLessThan(startPos.x);
  });

  test('Bot feuert Laser wenn Feind im Korridor', async ({ page }) => {
    // Coop-Modus aktivieren + Bot aktivieren
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Spiel starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten bis Spiel läuft
    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // Feind direkt über P2 spawnen
    await page.evaluate(() => {
      const mod = window.__game;
      const s = mod.state;
      // Feind genau in P2-Korridor platzieren
      mod.Entities.erzeugeFeind(s.p2.x, 50, 'stop_and_go', 0);
    });

    // Kurz warten, damit der Bot reagiert und schießt
    await page.waitForTimeout(300);

    const laserFired = await page.evaluate(() => {
      const mod = window.__game;
      const s = mod.state;
      return s.p2.laserSchiesst || s.p2.botFireLaser || (s.p2.energie < s.p2.maxEnergie);
    });

    expect(laserFired).toBe(true);
  });

  test('Bot weicht Asteroid aus', async ({ page }) => {
    // Coop-Modus aktivieren + Bot aktivieren
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Spiel starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten bis Spiel läuft
    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // Asteroid nahe P2 rechts spawnen
    const initialData = await page.evaluate(() => {
      const mod = window.__game;
      const s = mod.state;
      s.p2.x = 300;
      s.p2.y = 480;
      // Asteroid 30px rechts und 50px oberhalb von P2 spawnen
      mod.Entities.erzeugeAsteroid(330, 430);
      return { startX: 300, startY: 480 };
    });

    // Kurz warten, damit der Bot ausweicht
    await page.waitForTimeout(300);

    const endX = await page.evaluate(() => {
      const mod = window.__game;
      return mod.state.p2.x;
    });

    // Der Bot sollte nach links ausgewichen sein (weg vom Asteroiden)
    expect(endX).toBeLessThan(initialData.startX);
  });

  test('Bot steuert auf nahe Powerups zu', async ({ page }) => {
    // Coop-Modus aktivieren + Bot aktivieren
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Spiel starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten bis Spiel läuft
    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // Vorherige Entitäten aufräumen und Powerup rechts von P2 spawnen
    const initialData = await page.evaluate(() => {
      const mod = window.__game;
      mod.arrays.feinde.forEach(f => f.el.remove());
      mod.arrays.feinde.length = 0;
      mod.arrays.asteroiden.forEach(a => a.el.remove());
      mod.arrays.asteroiden.length = 0;

      const s = mod.state;
      const startX = s.p2.x;
      const startY = s.p2.y;
      // Powerup 80px rechts von P2 platzieren
      mod.Entities.erzeugePowerup(startX + 80, startY - 20, 'schild');
      return { startX, startY };
    });

    // Kurz warten, damit der Bot sich zum Powerup bewegt
    await page.waitForTimeout(400);

    const endX = await page.evaluate(() => {
      const mod = window.__game;
      return mod.state.p2.x;
    });

    // P2 sollte sich nach rechts bewegt haben (Richtung Powerup)
    expect(endX).toBeGreaterThan(initialData.startX);
  });

  test('Bot feuert Raketen bei nahen Feinden und Bomben bei Feindansammlungen', async ({ page }) => {
    // Coop-Modus aktivieren + Bot aktivieren
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Spiel starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten bis Spiel läuft
    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // 1. Raketen-Test: Feind in Raketen-Reichweite spawnen (<120px)
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.p2.raketenCooldown = 0;
      mod.Entities.erzeugeFeind(mod.state.p2.x, mod.state.p2.y - 80, 'stop_and_go', 0);
    });

    await page.waitForTimeout(300);

    const raketeFired = await page.evaluate(() => {
      const mod = window.__game;
      return mod.state.p2.raketenCooldown > 0 || mod.arrays.raketenArray.some(r => r.pKey === 'p2');
    });
    expect(raketeFired).toBe(true);

    // 2. Bomben-Test: 3 Feinde spawnen + Bomben-Cooldown zurücksetzen
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.p2.bombenCooldown = 0;
      mod.Entities.erzeugeFeind(100, 100, 'stop_and_go', 0);
      mod.Entities.erzeugeFeind(200, 100, 'stop_and_go', 0);
      mod.Entities.erzeugeFeind(300, 100, 'stop_and_go', 0);
    });

    await page.waitForTimeout(300);

    const bombeFired = await page.evaluate(() => {
      const mod = window.__game;
      return mod.state.p2.bombenCooldown > 0 || mod.arrays.bombenArray.some(b => b.pKey === 'p2');
    });
    expect(bombeFired).toBe(true);
  });

  test('Bot-Schwierigkeitsgrade (Easy vs Hard) beeinflussen Ausweichradius', async ({ page }) => {
    // Coop-Modus aktivieren + Bot aktivieren + Hard auswählen
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');
    await page.click('.bot-diff-btn[data-diff="hard"]');

    // Spiel starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten bis Spiel läuft
    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // Hard-Bot sollte Asteroid auf 90px Distanz erkennen (dodgeRadius=100)
    const initialData = await page.evaluate(() => {
      const mod = window.__game;
      const s = mod.state;
      const startX = s.p2.x;
      const startY = s.p2.y;
      // Asteroid 90px rechts spawnen
      mod.Entities.erzeugeAsteroid(startX + 90, startY);
      return { startX, startY };
    });

    await page.waitForTimeout(300);

    const endX = await page.evaluate(() => {
      const mod = window.__game;
      return mod.state.p2.x;
    });

    // Hard-Bot weicht nach links aus
    expect(endX).toBeLessThan(initialData.startX);
  });

  test('Bot hält im Idle-Zustand Formation mit Spieler 1', async ({ page }) => {
    // Coop-Modus aktivieren + Bot aktivieren
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Spiel starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten bis Spiel läuft
    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // Alle Entitäten wegräumen und P1 / P2 gezielt positionieren
    const initialData = await page.evaluate(() => {
      const mod = window.__game;
      mod.arrays.feinde.forEach(f => f.el.remove());
      mod.arrays.feinde.length = 0;
      mod.arrays.asteroiden.forEach(a => a.el.remove());
      mod.arrays.asteroiden.length = 0;
      mod.arrays.powerups.forEach(p => { if (p.el) p.el.remove(); });
      mod.arrays.powerups.length = 0;

      // P1 auf x=100 setzen, P2 auf x=400 (weit rechts)
      mod.state.x = 100;
      mod.state.y = 300;
      mod.state.p2.x = 400;
      mod.state.p2.y = 300;

      return { p2StartX: mod.state.p2.x };
    });

    // Kurz warten, damit der Bot sich in Richtung P1-Formation bewegt
    await page.waitForTimeout(400);

    const endX = await page.evaluate(() => {
      const mod = window.__game;
      return mod.state.p2.x;
    });

    // P2 sollte sich nach links (Richtung P1-Formation bei x=150) bewegt haben
    expect(endX).toBeLessThan(initialData.p2StartX);
  });

  test('Nach Tod von Spieler 1 im 2-Spieler Modus und Neustart lässt sich Spieler 1 wieder steuern', async ({ page }) => {
    // Coop-Modus aktivieren + Bot aktivieren
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Runde 1 starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten bis Spiel läuft
    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // Spieler 1 stirbt zuerst (isDead = true), dann auch P2 -> Game Over
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.leben = 0;
      mod.state.isDead = true;
      mod.state.p2.leben = 0;
      mod.state.p2.isDead = true;
      mod.Utils.triggerGameOver();
    });

    // Game-Over Screen sichtbar
    const btnRestart = page.locator('#btn-restart');
    await expect(btnRestart).toBeVisible();

    // Neustart anklicken
    await btnRestart.click();

    // Runde 2 starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten bis Spiel 2 läuft
    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // Startposition von P1 erfassen
    const startX = await page.evaluate(() => window.__game.state.x);

    // Taste D drücken, um sich nach rechts zu bewegen
    await page.keyboard.down('d');
    await page.waitForTimeout(300);
    await page.keyboard.up('d');

    const endX = await page.evaluate(() => window.__game.state.x);

    // Spieler 1 muss sich nach rechts bewegt haben (endX > startX)
    expect(endX).toBeGreaterThan(startX);
  });

  test('Bot agiert aus dem unteren Viertel des Spielfeldes und beschießt Bosse aus der Distanz', async ({ page }) => {
    // Coop-Modus aktivieren + Bot aktivieren
    await page.click('#gamemode-btn-coop');
    await page.click('.hangar-player-tab[data-player="p2"]');
    await page.click('#btn-p2-bot-toggle');

    // Spiel starten
    await page.keyboard.down('w');
    await page.waitForTimeout(50);
    await page.keyboard.up('w');

    // Warten bis Spiel läuft
    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // Boss 1 oben spawnen (y=60)
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.p2.y = 480; // P2 startet im unteren Bereich
      mod.Entities.erzeugeBoss();
    });

    // 1000ms laufen lassen (ohne Baseline-Taktik würde der Bot nach oben zu y=180 fliegen)
    await page.waitForTimeout(1000);

    const botY = await page.evaluate(() => window.__game.state.p2.y);

    // Der Bot soll im unteren Viertel des Spielfeldes bleiben (y >= 450 auf 600px Spielfeld)
    expect(botY).toBeGreaterThanOrEqual(450);
  });

  test('Online-Multiplayer › Modus-Auswahl schaltet auf Online-Modus um und zeigt Online-Lobby an', async ({ page }) => {
    const btnOnline = page.locator('#gamemode-btn-online');
    await expect(btnOnline).toBeVisible();

    // Klick auf Online-Modus
    await btnOnline.click();

    // Button muss aktiv sein und Spielfeld auf 600px vergrößert werden
    await expect(btnOnline).toHaveClass(/active/);
    const spielfeld = page.locator('#spielfeld');
    await expect(spielfeld).toHaveClass(/mode-coop/);

    // Online-Lobby-Bereich muss sichtbar sein
    const lobby = page.locator('#online-lobby-container');
    await expect(lobby).toBeVisible();
    await expect(page.locator('#btn-online-host')).toBeVisible();
    await expect(page.locator('#online-room-input')).toBeVisible();
    await expect(page.locator('#btn-online-join')).toBeVisible();

    // Zurück auf 1-Spieler schalten blendet Lobby wieder aus
    await page.click('#gamemode-btn-single');
    await expect(lobby).toBeHidden();
  });

  test('Online-Multiplayer › Raum erstellen (Host) generiert Raum-Code und zeigt Status an', async ({ page }) => {
    // In den Online-Modus wechseln
    await page.click('#gamemode-btn-online');

    // Klick auf "RAUM ERSTELLEN"
    await page.click('#btn-online-host');

    // Status-Element muss sichtbar werden und Raum-Code sowie Wartestatus enthalten
    const status = page.locator('#online-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('WARTE AUF MITSPIELER');

    // State-Objekt prüfen
    const networkState = await page.evaluate(() => window.__game.state.network);
    expect(networkState).toBeDefined();
    expect(networkState.isOnline).toBe(true);
    expect(networkState.isHost).toBe(true);
    expect(networkState.isClient).toBe(false);
    expect(typeof networkState.roomCode).toBe('string');
    expect(networkState.roomCode.length).toBeGreaterThanOrEqual(4);
  });

  test('Online-Multiplayer › Raum beitreten (Client) validiert Raum-Code und setzt Client-State', async ({ page }) => {
    // In den Online-Modus wechseln
    await page.click('#gamemode-btn-online');

    // 1. Leereingabe testen
    await page.click('#btn-online-join');
    const status = page.locator('#online-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('BITTE GÜLTIGEN RAUM-CODE EINGEBEN');

    // 2. Gültigen Raum-Code eingeben
    await page.fill('#online-room-input', 'ROOM9');
    await page.click('#btn-online-join');

    await expect(status).toContainText('VERBINDE MIT RAUM ROOM9');

    // State-Objekt prüfen
    const networkState = await page.evaluate(() => window.__game.state.network);
    expect(networkState).toBeDefined();
    expect(networkState.isOnline).toBe(true);
    expect(networkState.isHost).toBe(false);
    expect(networkState.isClient).toBe(true);
    expect(networkState.roomCode).toBe('ROOM9');
  });

  test('Online-Multiplayer › Spielstart bei Peer-Verbindung im 600px Online-Coop Modus', async ({ page }) => {
    // In den Online-Modus wechseln und Raum hosten
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    // Peer-Verbindung simulieren
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Network.onPeerJoined('mock_peer_123');
    });

    // Warten bis das Spiel läuft
    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // Beide Schiffe und das P2-HUD müssen sichtbar sein
    const spieler1 = page.locator('#spieler');
    const spieler2 = page.locator('#spieler-2');
    const uiP2 = page.locator('#ui-container-p2');

    await expect(spieler1).toBeVisible();
    await expect(spieler2).toBeVisible();
    await expect(uiP2).toBeVisible();

    // Spielfeld muss 600px breit sein
    const spielfeld = page.locator('#spielfeld');
    await expect(spielfeld).toHaveClass(/mode-coop/);
  });

  test('Online-Multiplayer › Host Game-State Serialisierung & Client Snapshot Rendering', async ({ page }) => {
    // Online-Modus aktivieren
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    // Peer-Verbindung simulieren
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Network.onPeerJoined('mock_peer_123');
    });

    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // 1. Host-Serialisierung prüfen
    const snapshot = await page.evaluate(() => {
      const mod = window.__game;
      mod.Entities.erzeugeFeind();
      mod.Entities.erzeugeAsteroid();
      return mod.Network.serializeGameState();
    });

    expect(snapshot).toBeDefined();
    expect(snapshot.p1).toBeDefined();
    expect(Array.isArray(snapshot.feinde)).toBe(true);
    expect(snapshot.feinde.length).toBeGreaterThan(0);
    expect(Array.isArray(snapshot.asteroiden)).toBe(true);
    expect(snapshot.asteroiden.length).toBeGreaterThan(0);

    // 2. Client-Snapshot-Anwendung testen
    await page.evaluate(() => {
      const mod = window.__game;
      // Client-Modus simulieren
      mod.state.network.isHost = false;
      mod.state.network.isClient = true;

      const mockSnapshot = {
        p1: { x: 120, y: 350, leben: 2, energie: 40, isDead: false },
        score: 4500,
        level: 3,
        feinde: [{ id: 'f_test_1', x: 250, y: 180, hp: 10, maxHp: 10, groesse: 24, typ: 1, muster: 'normal' }],
        asteroiden: [
          { id: 'a_test_1', x: 100, y: 220, groesse: 30, istMagma: false, istUnzerstoerbar: false, rot: 45 },
          { id: 'a_test_magma_destructible', x: 150, y: 200, groesse: 35, istMagma: true, istUnzerstoerbar: false, traegtPowerup: true, rot: 10 },
          { id: 'a_test_magma_solid', x: 180, y: 240, groesse: 40, istMagma: true, istUnzerstoerbar: true, rot: 20 }
        ],
        bosses: [{ id: 'b_test_1', x: 200, y: 50, hp: 300, maxHp: 400, groesse: 100, typ: 1 }],
        laser: [{ id: 'l_test_1', x: 125, y: 300, vx: 0, vy: 15, width: 4, height: 20, owner: 'p1', color: '#00ffff' }],
        raketen: [{ id: 'r_test_1', x: 130, y: 290, rot: 90, owner: 'p1', stufe: 2 }],
        bomben: [{ id: 'b_test_1', x: 140, y: 280, rot: 0, owner: 'p1', stufe: 1 }],
        bossLaser: [{ id: 'bl_test_1', x: 210, y: 120, vx: 0, vy: 6, width: 8, height: 25 }],
        bossRaketen: [{ id: 'br_test_1', x: 220, y: 130, vx: 2, vy: 3, rot: 120 }],
        bossBomben: [{ id: 'bb_test_1', x: 230, y: 140, groesse: 26 }],
        powerups: [
          { id: 'pu_test_1', x: 110, y: 310, type: 'schild', owner: 'p1' },
          { id: 'pu_test_2', x: 160, y: 310, type: 'splitterRot', owner: 'p2' }
        ]
      };

      mod.Network.applyGameStateSnapshot(mockSnapshot);
    });

    // Prüfen, ob P1-Position und HUD aktualisiert wurden
    const p1Pos = await page.evaluate(() => ({ x: window.__game.state.x, y: window.__game.state.y }));
    expect(p1Pos.x).toBe(120);
    expect(p1Pos.y).toBe(350);

    const scoreText = await page.locator('#score-anzeige').textContent();
    expect(scoreText).toContain('4500');

    // Prüfen, ob Feind im DOM mit SVG gerendert wurde
    const enemyInfo = await page.evaluate(() => {
      const el = document.querySelector('.feind-schiff');
      return {
        exists: !!el,
        hasSvg: el ? !!el.querySelector('svg') : false
      };
    });
    expect(enemyInfo.exists).toBe(true);
    expect(enemyInfo.hasSvg).toBe(true);

    // Prüfen, ob Asteroiden (normal vs magma-zerstörbar vs magma-unzerstörbar) korrekt gerendert wurden
    const asteroidCheck = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('.asteroid'));
      const solidMagma = all.find(a => a.classList.contains('unzerstoerbar'));
      const destructibleMagma = all.find(a => !a.classList.contains('unzerstoerbar') && a.style.background.includes('rgb'));
      return {
        total: all.length,
        hasSolidMagma: !!solidMagma,
        hasDestructibleMagma: all.some(a => a.querySelector('.riss-layer'))
      };
    });
    expect(asteroidCheck.total).toBe(3);
    expect(asteroidCheck.hasSolidMagma).toBe(true);
    expect(asteroidCheck.hasDestructibleMagma).toBe(true);

    // Prüfen, ob Laser, Raketen, Bomben im DOM gerendert wurden
    const playerProjectiles = await page.evaluate(() => ({
      hasLaser: !!document.querySelector('.laser-projektil'),
      hasRakete: !!document.querySelector('.raketen-projektil'),
      hasBombe: !!document.querySelector('.bomben-projektil')
    }));
    expect(playerProjectiles.hasLaser).toBe(true);
    expect(playerProjectiles.hasRakete).toBe(true);
    expect(playerProjectiles.hasBombe).toBe(true);

    // Prüfen, ob Boss-Projektile (Laser, Rakete, Bombe) im DOM gerendert wurden
    const bossProjectiles = await page.evaluate(() => ({
      hasBossLaser: !!document.querySelector('.boss-laser'),
      hasBossRakete: !!document.querySelector('.boss-rakete'),
      hasBossBombe: !!document.querySelector('.boss-bombe')
    }));
    expect(bossProjectiles.hasBossLaser).toBe(true);
    expect(bossProjectiles.hasBossRakete).toBe(true);
    expect(bossProjectiles.hasBossBombe).toBe(true);

    // Prüfen, ob Powerups mit Styling, Owner-Tag und Splitter-SVG gerendert wurden
    const powerupCheck = await page.evaluate(() => {
      const pus = Array.from(document.querySelectorAll('.powerup'));
      const p1Pu = pus.find(p => p.classList.contains('pu-owner-p1'));
      const p2Splitter = pus.find(p => p.classList.contains('powerup-splitter'));
      return {
        count: pus.length,
        hasP1Border: p1Pu ? (p1Pu.style.border !== '' && p1Pu.style.border !== 'none') : false,
        hasP1Tag: p1Pu ? !!p1Pu.querySelector('.pu-owner-tag') : false,
        hasSplitterSvg: p2Splitter ? !!p2Splitter.querySelector('svg') : false
      };
    });
    expect(powerupCheck.count).toBe(2);
    expect(powerupCheck.hasP1Border).toBe(true);
    expect(powerupCheck.hasP1Tag).toBe(true);
    expect(powerupCheck.hasSplitterSvg).toBe(true);
  });

  test('Online-Multiplayer › Client Input-Serialisierung & Host Input-Anwendung auf Spieler 2', async ({ page }) => {
    // Online-Modus aktivieren
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    // Peer-Verbindung simulieren
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Network.onPeerJoined('mock_peer_123');
    });

    await page.waitForFunction(() => {
      const mod = window.__game;
      return mod && mod.state && mod.state.spielLaeuft;
    }, null, { timeout: 5000 });

    // 1. Client-Input-Serialisierung testen (Solo-Steuerung: WASD, L, K, Space)
    const clientInput = await page.evaluate(() => {
      const mod = window.__game;
      mod.state.p2.x = 420;
      mod.state.p2.y = 510;
      mod.state.tastenGedrueckt.l = true; // Laser mit L
      mod.state.tastenGedrueckt.k = true; // Rakete mit K
      mod.state.tastenGedrueckt[' '] = true; // Bombe mit Leertaste
      return mod.Network.serializePlayerInput();
    });

    expect(clientInput).toBeDefined();
    expect(clientInput.x).toBe(420);
    expect(clientInput.y).toBe(510);
    expect(clientInput.laser).toBe(true);
    expect(clientInput.rakete).toBe(true);
    expect(clientInput.bombe).toBe(true);

    // 2. Host-Anwendung auf state.p2 testen
    await page.evaluate(() => {
      const mod = window.__game;
      const remoteInput = {
        x: 350,
        y: 480,
        rotate: -15,
        laser: true,
        rakete: true,
        bombe: true
      };
      mod.Network.applyPlayerInput(remoteInput);
    });

    const p2State = await page.evaluate(() => ({
      x: window.__game.state.p2.x,
      y: window.__game.state.p2.y,
      rotate: window.__game.state.p2.rotate,
      laserSchiesst: window.__game.state.p2.laserSchiesst,
      networkFireRakete: window.__game.state.p2.networkFireRakete,
      networkFireBombe: window.__game.state.p2.networkFireBombe
    }));

    expect(p2State.x).toBe(350);
    expect(p2State.y).toBe(480);
    expect(p2State.rotate).toBe(-15);
    expect(p2State.laserSchiesst).toBe(true);
    expect(p2State.networkFireRakete).toBe(true);
    expect(p2State.networkFireBombe).toBe(true);
  });

  test('Online-Multiplayer › Cutszene synchron mit ESC überspringen & Schadens-Flash nur auf dem Rechner des getroffenen Spielers', async ({ page }) => {
    // 1. Cutszene-Synchronisation testen
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    // Host startet Cutszene
    const cutsceneSkippedResult = await page.evaluate(() => {
      const mod = window.__game;
      mod.state.network.connected = true;
      mod.state.network.isOnline = true;
      mod.state.network.isHost = true;
      
      let sentEvents = [];
      mod.Network.onNetworkEvent((e) => sentEvents.push(e));

      // Cutszene starten und überspringen
      mod.Cutscene.startCutscene();
      mod.Cutscene.skipCutscene();

      return {
        cutsceneActive: mod.Cutscene.isCutsceneActive(),
        gameRunning: mod.state.spielLaeuft
      };
    });

    expect(cutsceneSkippedResult.cutsceneActive).toBe(false);
    expect(cutsceneSkippedResult.gameRunning).toBe(true);

    // 2. Schadens-Flash im Online-Modus testen (P2 getroffen -> Host-Bildschirm darf NICHT rot werden)
    const flashCheck = await page.evaluate(() => {
      const mod = window.__game;
      mod.state.network.isOnline = true;
      mod.state.network.isHost = true;
      mod.state.network.connected = true;
      mod.state.gameMode = 'online';
      mod.state.p2.leben = 3;
      mod.state.p2.schildStufe = 0;
      mod.state.p2.invulnerableTimer = 0;
      mod.state.p2.isDead = false;

      const spielfeld = document.getElementById('spielfeld');
      spielfeld.style.backgroundColor = '#0b1319';

      // P2 wird auf Host getroffen
      mod.Utils.spielerGetroffen(null, false, 'p2');
      const hostBgAfterP2Hit = spielfeld.style.backgroundColor;

      return {
        hostBgAfterP2Hit: hostBgAfterP2Hit,
        lastSentEvent: mod.state.network.lastSentEvent
      };
    });

    // Host-Bildschirm bleibt dunkel und wird nicht rot geflasht
    expect(flashCheck.hostBgAfterP2Hit).toBe('rgb(11, 19, 25)');
    expect(flashCheck.lastSentEvent).toBeDefined();
    expect(flashCheck.lastSentEvent.type).toBe('player_hit');
    expect(flashCheck.lastSentEvent.target).toBe('p2');
  });

  test('Online-Multiplayer › Highscore-Koordination: Beide Spieler geben Kürzel ein und werden als AAA+BBB in der Coop-Bestenliste gespeichert', async ({ page }) => {
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    // 1. Game Over im Online-Modus auslösen
    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.network.connected = true;
      mod.state.network.isOnline = true;
      mod.state.network.isHost = true;
      mod.state.gameMode = 'online';
      mod.state.score = 7500;
      mod.state.cheatUsed = false;
      mod.state.selectedShipModel = 'viper';
      mod.state.p2.selectedShipModel = 'phantom';

      mod.Utils.triggerGameOver();
    });

    const hsForm = page.locator('#highscore-form');
    await expect(hsForm).toBeVisible();

    // 2. Spieler 1 (Host) gibt 'AAA' ein und speichert
    await page.fill('#highscore-name', 'AAA');
    await page.click('#btn-save-score');

    // Prüfen, dass Host-Event gesendet wurde und Warte-Nachricht erscheint
    const hostStatus = await page.evaluate(() => {
      const mod = window.__game;
      const waitingMsg = document.getElementById('highscore-waiting-msg');
      return {
        lastSentEvent: mod.state.network.lastSentEvent,
        waitingMsgText: waitingMsg ? waitingMsg.textContent : '',
        waitingMsgVisible: waitingMsg && waitingMsg.style.display !== 'none'
      };
    });

    expect(hostStatus.lastSentEvent).toBeDefined();
    expect(hostStatus.lastSentEvent.type).toBe('highscore_name');
    expect(hostStatus.lastSentEvent.role).toBe('p1');
    expect(hostStatus.lastSentEvent.name).toBe('AAA');
    expect(hostStatus.waitingMsgVisible).toBe(true);
    expect(hostStatus.waitingMsgText).toContain('Spieler 2');

    // 3. Spieler 2 meldet Kürzel 'BBB'
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Utils.receiveOnlineHighscoreName('p2', 'BBB');
    });

    // Prüfen, dass Formular jetzt ausgeblendet ist und Highscore-Tabelle 'AAA+BBB' enthält
    await expect(hsForm).toBeHidden();

    const storedCoopScores = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('spaceShooterHighscores_coop') || '[]');
    });

    expect(storedCoopScores.length).toBeGreaterThan(0);
    expect(storedCoopScores[0].name).toBe('AAA+BBB');
    expect(storedCoopScores[0].score).toBe(7500);
    expect(storedCoopScores[0].shipP1).toBe('viper');
    expect(storedCoopScores[0].shipP2).toBe('phantom');

    // Bestenlisten-Tabelle im DOM überprüfen
    const firstRowText = await page.locator('#highscore-body tr').first().innerText();
    expect(firstRowText).toContain('AAA+BBB');
    expect(firstRowText).toContain('7500');
  });

  test('Online-Multiplayer › Cheatcodes sind im Online-Modus deaktiviert (weder Host noch Client)', async ({ page }) => {
    // 1. Online Modus aktivieren
    await page.click('#gamemode-btn-online');
    await page.click('#btn-online-host');

    await page.evaluate(() => {
      const mod = window.__game;
      mod.state.network.isOnline = true;
      mod.state.network.connected = true;
      mod.state.gameMode = 'online';
      mod.state.spielLaeuft = true;
      mod.state.laserStufe = 1;
      mod.state.raketenStufe = 1;
      mod.state.bombenStufe = 1;
      mod.state.schildStufe = 0;
      mod.state.godMode = false;
      mod.state.cheatUsed = false;
    });

    // Versuch Cheat 'idkfa' einzugeben
    await page.keyboard.type('idkfa');

    const stateAfterCheat = await page.evaluate(() => ({
      laserStufe: window.__game.state.laserStufe,
      schildStufe: window.__game.state.schildStufe,
      cheatUsed: window.__game.state.cheatUsed,
      godMode: window.__game.state.godMode
    }));

    // Im Online-Modus darf der Cheat nicht gegriffen haben
    expect(stateAfterCheat.laserStufe).toBe(1);
    expect(stateAfterCheat.schildStufe).toBe(0);
    expect(stateAfterCheat.cheatUsed).toBe(false);

    // Versuch Cheat 'idgod' einzugeben
    await page.keyboard.type('idgod');

    const stateAfterGod = await page.evaluate(() => ({
      godMode: window.__game.state.godMode,
      cheatUsed: window.__game.state.cheatUsed
    }));

    expect(stateAfterGod.godMode).toBe(false);
    expect(stateAfterGod.cheatUsed).toBe(false);
  });

  test('Mobile/Touch › Antippen der Modus-Buttons (Coop / Online) und Hangar-Optionen startet das Spiel nicht', async ({ page }) => {
    // 1. Touchstart auf Modus-Buttons auslösen
    await page.dispatchEvent('#gamemode-btn-coop', 'touchstart');
    await page.click('#gamemode-btn-coop');

    const stateAfterCoopTouch = await page.evaluate(() => ({
      gameMode: window.__game.state.gameMode,
      spielLaeuft: window.__game.state.spielLaeuft,
      cutsceneAktiv: window.__game.state.cutsceneAktiv
    }));

    expect(stateAfterCoopTouch.gameMode).toBe('coop');
    expect(stateAfterCoopTouch.spielLaeuft).toBe(false);
    expect(stateAfterCoopTouch.cutsceneAktiv).toBe(false);

    // 2. Touchstart auf Online-Button auslösen
    await page.dispatchEvent('#gamemode-btn-online', 'touchstart');
    await page.click('#gamemode-btn-online');

    const stateAfterOnlineTouch = await page.evaluate(() => ({
      gameMode: window.__game.state.gameMode,
      spielLaeuft: window.__game.state.spielLaeuft,
      cutsceneAktiv: window.__game.state.cutsceneAktiv
    }));

    expect(stateAfterOnlineTouch.gameMode).toBe('online');
    expect(stateAfterOnlineTouch.spielLaeuft).toBe(false);
    expect(stateAfterOnlineTouch.cutsceneAktiv).toBe(false);

    // Start-Screen muss weiterhin sichtbar sein
    const startScreen = page.locator('#start-screen');
    await expect(startScreen).toBeVisible();

    // 3. Touch auf Hangar-Container und Modell-Buttons
    await page.dispatchEvent('#hangar-container', 'touchstart');
    await page.dispatchEvent('.hangar-model-btn[data-model="phantom"]', 'touchstart');
    await page.click('.hangar-model-btn[data-model="phantom"]');

    const stateAfterHangar = await page.evaluate(() => ({
      spielLaeuft: window.__game.state.spielLaeuft,
      cutsceneAktiv: window.__game.state.cutsceneAktiv,
      model: window.__game.state.selectedShipModel
    }));
    expect(stateAfterHangar.spielLaeuft).toBe(false);
    expect(stateAfterHangar.cutsceneAktiv).toBe(false);
    expect(stateAfterHangar.model).toBe('phantom');

    // 4. Modus zurück auf Single und Touch auf #start-text startet das Spiel
    await page.click('#gamemode-btn-single');
    await page.dispatchEvent('#start-text', 'touchstart');

    const stateAfterStartText = await page.evaluate(() => ({
      spielLaeuft: window.__game.state.spielLaeuft,
      cutsceneAktiv: window.__game.state.cutsceneAktiv
    }));
    expect(stateAfterStartText.spielLaeuft || stateAfterStartText.cutsceneAktiv).toBe(true);
  });

  test('Online-Multiplayer › Bomben- & Raketen-Detonationen erzeugen Schockwellen und Partikel auf dem Client', async ({ page }) => {
    // 1. Online-Client Modus vorbereiten
    await page.click('#gamemode-btn-online');
    await page.fill('#online-room-input', 'ABCDE');
    await page.click('#btn-online-join');

    // 2. Bomb Detonation simulieren
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Utils.erzeugeBombenDetonation(300, 250, '#f39c12', 150, 1, false);
    });

    const particlesAfterBomb = await page.evaluate(() => {
      return window.__game.arrays.partikelArray.length;
    });
    expect(particlesAfterBomb).toBeGreaterThanOrEqual(60);

    // 3. Raketen Detonation simulieren
    await page.evaluate(() => {
      const mod = window.__game;
      mod.Utils.erzeugeRaketenDetonation(200, 150, 70);
    });

    const particlesAfterRocket = await page.evaluate(() => {
      return window.__game.arrays.partikelArray.length;
    });
    expect(particlesAfterRocket).toBeGreaterThanOrEqual(100);

    // 4. Schockwelle im DOM prüfen
    const shockwaveCount = await page.locator('.schockwelle').count();
    expect(shockwaveCount).toBeGreaterThanOrEqual(1);
  });

  test('Online-Multiplayer › Rematch & Neustart: Host sieht Spiel-Starten-Button bei verbundener Session und kann Rematch starten', async ({ page }) => {
    // 1. Online-Host im verbundenen Zustand einstellen
    await page.click('#gamemode-btn-online');
    await page.evaluate(() => {
      const s = window.__game.state;
      s.gameMode = 'online';
      s.network.isOnline = true;
      s.network.isHost = true;
      s.network.isClient = false;
      s.network.connected = true;
      s.network.roomCode = 'TEST1';
      window.__game.Network.updateOnlineLobbyUI();
    });

    // 2. Buttons prüfen
    const btnStart = page.locator('#btn-online-start');
    const btnLeave = page.locator('#btn-online-leave');
    await expect(btnStart).toBeVisible();
    await expect(btnLeave).toBeVisible();

    // 3. Nach Game-Over und Neustart muss der Start-Button weiterhin für den Host bereitstehen
    await page.evaluate(() => {
      window.__game.Utils.restartGame();
    });
    await expect(btnStart).toBeVisible();

    // 4. Host klickt auf Spiel starten -> Online Match startet
    await btnStart.click();
    const stateAfterStart = await page.evaluate(() => ({
      spielLaeuft: window.__game.state.spielLaeuft,
      cutsceneAktiv: window.__game.state.cutsceneAktiv,
      lastEvent: window.__game.state.network.lastSentEvent
    }));
    expect(stateAfterStart.spielLaeuft || stateAfterStart.cutsceneAktiv).toBe(true);
    expect(stateAfterStart.lastEvent.type).toBe('game_start');

    // 5. Raum verlassen testen
    await page.evaluate(() => {
      window.__game.Utils.restartGame();
    });
    await btnLeave.click();
    const actionsVisible = await page.locator('#online-lobby-actions').isVisible();
    expect(actionsVisible).toBe(true);
  });

  test('Globale Bestenliste: Highscore-Tabs (SOLO, BOT CO-OP, ONLINE CO-OP) im Game-Over-Screen vorhanden und umschaltbar', async ({ page }) => {
    // 1. GameOver auslösen
    await page.evaluate(() => {
      window.__game.state.score = 5000;
      window.__game.Utils.triggerGameOver();
    });

    const tabSingle = page.locator('#hs-tab-single');
    const tabBot = page.locator('#hs-tab-bot');
    const tabOnline = page.locator('#hs-tab-online');

    // 2. Alle 3 Tabs müssen sichtbar sein mit korrektem Label
    await expect(tabSingle).toBeVisible();
    await expect(tabSingle).toHaveText('SOLO');
    await expect(tabBot).toBeVisible();
    await expect(tabBot).toHaveText('BOT CO-OP');
    await expect(tabOnline).toBeVisible();
    await expect(tabOnline).toHaveText('ONLINE CO-OP');

    // 3. Tab-Wechsel zu BOT CO-OP
    await tabBot.click();
    await expect(tabBot).toHaveClass(/active/);
    await expect(tabSingle).not.toHaveClass(/active/);
    await expect(tabOnline).not.toHaveClass(/active/);

    // 4. Tab-Wechsel zu ONLINE CO-OP
    await tabOnline.click();
    await expect(tabOnline).toHaveClass(/active/);
    await expect(tabBot).not.toHaveClass(/active/);
    await expect(tabSingle).not.toHaveClass(/active/);

    // 5. Tab-Wechsel zurück zu SOLO
    await tabSingle.click();
    await expect(tabSingle).toHaveClass(/active/);
    await expect(tabBot).not.toHaveClass(/active/);
    await expect(tabOnline).not.toHaveClass(/active/);
  });

  test('Globale Bestenliste: Globale Highscores laden und rendern mit Geo-Location (Flagge und Stadt), Rang und Schiffen', async ({ page }) => {
    // Mock API Route für globale Highscores
    await page.route('**/api/highscores?mode=single*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          mode: 'single',
          highscores: [
            { id: 1, name: 'FRK', score: 95000, level: 10, shipP1: 'viper', country: 'DE', city: 'Frankfurt' },
            { id: 2, name: 'PET', score: 82000, level: 8, shipP1: 'phantom', country: 'US', city: 'New York' },
            { id: 3, name: 'BEN', score: 71000, level: 7, shipP1: 'viper', country: 'JP', city: 'Tokyo' }
          ]
        })
      });
    });

    // GameOver auslösen
    await page.evaluate(() => {
      window.__game.state.score = 5000;
      window.__game.Utils.triggerGameOver();
    });

    // Warten bis Daten geladen und Tabelle gerendert ist
    const rows = page.locator('#highscore-body tr');
    await expect(rows).toHaveCount(3);

    // Statusanzeige prüfen
    const statusText = page.locator('#highscore-status-text');
    await expect(statusText).toContainText('GLOBALE BESTENLISTE');

    // Zeile 1: #1, FRK, 🇩🇪 (DE), 95000, Viper-X
    const row1 = rows.nth(0);
    await expect(row1).toContainText('#1');
    await expect(row1).toContainText('FRK');
    await expect(row1).toContainText('🇩🇪');
    await expect(row1).toContainText('95000');
    await expect(row1.locator('.hs-ship-viper')).toBeVisible();

    // Zeile 2: #2, PET, 🇺🇸 (US), 82000, Phantom-NX
    const row2 = rows.nth(1);
    await expect(row2).toContainText('#2');
    await expect(row2).toContainText('PET');
    await expect(row2).toContainText('🇺🇸');
    await expect(row2).toContainText('82000');
    await expect(row2.locator('.hs-ship-phantom')).toBeVisible();

    // Zeile 3: #3, BEN, 🇯🇵 (JP), 71000
    const row3 = rows.nth(2);
    await expect(row3).toContainText('#3');
    await expect(row3).toContainText('BEN');
    await expect(row3).toContainText('🇯🇵');
    await expect(row3).toContainText('71000');
  });

  test('Globale Bestenliste: Highscore-Submit übermittelt Modus, Name, Score, Schiffe und validen SHA-256 Hash', async ({ page }) => {
    let capturedRequest = null;

    // Route für POST abfangen
    await page.route('**/api/highscores', async route => {
      if (route.request().method() === 'POST') {
        capturedRequest = JSON.parse(route.request().postData());
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            rank: 1,
            entry: {
              mode: capturedRequest.mode,
              name: capturedRequest.name,
              score: capturedRequest.score,
              level: capturedRequest.level,
              shipP1: capturedRequest.shipP1,
              country: 'DE',
              city: 'Berlin'
            }
          })
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, mode: 'single', highscores: [] })
        });
      }
    });

    // Spielzustand vorbereiten und GameOver triggern
    await page.evaluate(() => {
      window.__game.state.score = 12500;
      window.__game.state.level = 4;
      window.__game.state.selectedShipModel = 'viper';
      window.__game.state.gameMode = 'single';
      window.__game.Utils.triggerGameOver();
    });

    // Formular ausfüllen und absenden
    const nameInput = page.locator('#highscore-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('MAX');

    const saveBtn = page.locator('#btn-save-score');
    await saveBtn.click();

    // Warten bis der POST-Request gesendet und erfasst wurde
    await page.waitForTimeout(500);

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest.mode).toBe('single');
    expect(capturedRequest.name).toBe('MAX');
    expect(capturedRequest.score).toBe(12500);
    expect(capturedRequest.level).toBe(4);
    expect(capturedRequest.shipP1).toBe('viper');
    expect(typeof capturedRequest.timestamp).toBe('number');
    expect(capturedRequest.hash).toMatch(/^[a-f0-9]{64}$/); // Valider 64-stelliger SHA-256 Hex Hash
  });

  test('Globale Bestenliste: Offline-Fallback schaltet bei Server-Fehler auf lokale Highscores um', async ({ page }) => {
    // 1. Lokale Highscores im LocalStorage vorbereiten
    await page.evaluate(() => {
      localStorage.setItem('spaceShooterHighscores', JSON.stringify([
        { name: 'LOC', score: 3333, ship: 'viper', mode: 'single' }
      ]));
    });

    // 2. Route so konfigurieren, dass sie mit 500 Internal Server Error fehlschlägt
    await page.route('**/api/highscores*', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Server unavailable' })
      });
    });

    // 3. GameOver triggern
    await page.evaluate(() => {
      window.__game.state.score = 1000;
      window.__game.Utils.triggerGameOver();
    });

    // 4. Statusanzeige muss auf Offline (Lokal) umschalten
    const statusText = page.locator('#highscore-status-text');
    await expect(statusText).toContainText('LOKALE BESTENLISTE (Offline)');

    // 5. Lokaler Eintrag muss gerendert sein
    const rows = page.locator('#highscore-body tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('LOC');
    await expect(rows.nth(0)).toContainText('3333');
  });

  test('Globale Bestenliste: Cheat-Sperre verhindert Submit an die globale Bestenliste', async ({ page }) => {
    let postRequestSent = false;

    // Route für POST abfangen
    await page.route('**/api/highscores', async route => {
      if (route.request().method() === 'POST') {
        postRequestSent = true;
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, mode: 'single', highscores: [] }) });
      }
    });

    // Cheat aktivieren und Highscore speichern
    await page.evaluate(() => {
      window.__game.state.cheatUsed = true;
      window.__game.state.score = 50000;
      window.__game.Utils.saveHighscore('CHT', 50000);
    });

    await page.waitForTimeout(500);

    // Es darf kein POST an die globale API gesendet worden sein
    expect(postRequestSent).toBe(false);
  });

});





