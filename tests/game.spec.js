const { test, expect } = require('@playwright/test');

test.describe('Space Shooter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Das Spiel lädt und der Start-Text wird angezeigt', async ({ page }) => {
    const startText = page.locator('#start-text');
    await expect(startText).toBeVisible();
    await expect(startText).toContainText('TAP OR PRESS ANY KEY TO START');
  });

  test('Spielerschiff ist im DOM vorhanden', async ({ page }) => {
    const spieler = page.locator('#spieler');
    await expect(spieler).toBeAttached();
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

test.describe('Mobile UI Positionierung - Handy (Pixel)', () => {
  test.use({ hasTouch: true, viewport: { width: 412, height: 915 } });

  test('Buttons sind relativ zum Spielfeld korrekt platziert und ragen nicht unschön rein', async ({ page }) => {
    await page.goto('/');
    // Tippen um das Spiel zu starten
    await page.locator('#start-text').click();
    
    // Warten bis Controls da sind
    await expect(page.locator('#mobile-controls')).toBeVisible();
    
    const raketeBtn = page.locator('#btn-rakete');
    const spielfeld = page.locator('#spielfeld');
    
    const raketeBox = await raketeBtn.boundingBox();
    const feldBox = await spielfeld.boundingBox();
    
    // Der Abstand vom rechten Button-Rand zum rechten Spielfeld-Rand sollte gering sein.
    // Falls das Spielfeld skaliert wird, sollten die Buttons sich daran orientieren, nicht am Viewport.
    const distanceToRightEdge = raketeBox.x + raketeBox.width - (feldBox.x + feldBox.width);
    expect(Math.abs(distanceToRightEdge)).toBeLessThan(50);
    
    // Auf dem Handy ragt der Button von unten in die Spielfläche
    // Wenn die Spielfläche sehr hoch ist, sollte der Button sich vielleicht innerhalb des Feldes unten rechts befinden
    // oder darunter (falls Platz ist). Hier testen wir einfach, dass er nicht out of bounds oder komplett falsch liegt.
  });
});

test.describe('Mobile UI Positionierung - Tablet (iPad)', () => {
  // iPad Pro Format / typisches Tablet quer/hoch
  test.use({ hasTouch: true, viewport: { width: 1024, height: 1366 } });

  test('Buttons kleben nicht am rechten Bildschirmrand, sondern am Spielfeld', async ({ page }) => {
    await page.goto('/');
    await page.locator('#start-text').click();
    
    await expect(page.locator('#mobile-controls')).toBeVisible();
    
    const raketeBtn = page.locator('#btn-rakete');
    const spielfeld = page.locator('#spielfeld');
    
    const raketeBox = await raketeBtn.boundingBox();
    const feldBox = await spielfeld.boundingBox();
    
    // Der Button sollte nah am Spielfeld liegen. Beim aktuellen Bug (right: 20px am viewport)
    // wäre der Button beim iPad hunderte Pixel weit weg vom zentrierten Spielfeld.
    const distanceToRightEdge = (raketeBox.x + raketeBox.width) - (feldBox.x + feldBox.width);
    
    // Test sollte rot sein, da der Abstand beim iPad extrem groß ist
    expect(Math.abs(distanceToRightEdge)).toBeLessThan(50);
  });
});

