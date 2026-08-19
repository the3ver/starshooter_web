const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // Standardmäßig als bereits gesehen markieren, damit die Tests direkt interagieren können
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.5.1');
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
    expect(shipSpeeds.phantom).toBe(4.5);
    expect(viperDelta).toBeGreaterThan(phantomDelta);
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

  test('Hangar: Zeigt beim Umschalten dynamisch die Perk-Badges der Schiffe an', async ({ page }) => {
    await page.goto('/');

    const perksContainer = page.locator('#hangar-ship-perks');
    await expect(perksContainer).toBeVisible();

    // 1. Initial mit Viper-X
    const viperBadges = perksContainer.locator('.hangar-perk-badge');
    await expect(viperBadges).toHaveCount(3);
    await expect(perksContainer).toContainText('+20% TEMPO');
    await expect(perksContainer).toContainText('+25% REGEN');

    // 2. Wechsel auf Phantom-NX
    const phantomBtn = page.locator('.hangar-model-btn[data-model="phantom"]');
    await phantomBtn.click();

    const phantomBadges = perksContainer.locator('.hangar-perk-badge');
    await expect(phantomBadges).toHaveCount(3);
    await expect(perksContainer).toContainText('SCHWERE PANZERUNG');
    await expect(perksContainer).toContainText('START-SCHILD');

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
    await expect(intro).toContainText('1.5.1');

    const items = page.locator('#whats-new-list li');
    await expect(items).toHaveCount(4);

    // Schließen
    const closeBtn = page.locator('#btn-close-whats-new');
    await closeBtn.click();

    await expect(modal).toBeHidden();

    // Prüfen, dass localStorage aktualisiert wurde
    const storedVersion = await page.evaluate(() => localStorage.getItem('starshooter_last_seen_version'));
    expect(storedVersion).toBe('1.5.1');

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
