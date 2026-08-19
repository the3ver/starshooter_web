const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // Standardmäßig als bereits gesehen markieren, damit die Tests direkt interagieren können
  await page.addInitScript(() => {
    localStorage.setItem('starshooter_last_seen_version', '1.3.3');
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
    const bombeLvl5 = page.locator('.bomben-projektil.bombe-lvl-5');
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

  test('Cheatcodes idkf1 bis idkf5 setzen alle Waffenstufen (1 bis 5) und zeigen Overlay', async ({ page }) => {
    // Spiel starten
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyW');

    for (let lvl = 1; lvl <= 5; lvl++) {
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
          cheatUsed: stateMod.state.cheatUsed
        };
      });

      expect(stufen.laser).toBe(lvl);
      expect(stufen.raketen).toBe(lvl);
      expect(stufen.bomben).toBe(lvl);
      expect(stufen.cheatUsed).toBe(true);

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
    await expect(intro).toContainText('1.3.3');

    const items = page.locator('#whats-new-list li');
    await expect(items).toHaveCount(5);

    // Schließen
    const closeBtn = page.locator('#btn-close-whats-new');
    await closeBtn.click();

    await expect(modal).toBeHidden();

    // Prüfen, dass localStorage aktualisiert wurde
    const storedVersion = await page.evaluate(() => localStorage.getItem('starshooter_last_seen_version'));
    expect(storedVersion).toBe('1.3.3');

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
    // Echten Tap ausführen
    await page.tap('#spielfeld-container');
    
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
    await page.tap('#spielfeld-container');
    
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
