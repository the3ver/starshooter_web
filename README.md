# DOM-basierter Space Shooter

Ein klassisches "Space Shooter"-Browserspiel, das komplett **ohne HTML5-Canvas** auskommt und stattdessen die Positionierung von DOM-Elementen (via `CSS position: absolute` und `transform`) nutzt.

## Spielmechanik & Features

Das Spiel bietet eine dynamische Spielumgebung mit verschiedenen Gegnern, Hindernissen und einem tiefgehenden Upgrade-System für dein Raumschiff. 

### Waffensysteme (Getrenntes Leveln)
Das Schiff verfügt über drei unterschiedliche Waffentypen, die durch das Aufsammeln von Powerups (geliefert von zerstörten Bossen oder Asteroiden) bis auf **Stufe 5** hochgelevelt werden können.
- **Laser (L-Taste):** Deine primäre Angriffswaffe. Verbraucht Energie aus dem blauen Energiebalken, welcher sich automatisch regeneriert. Auf den Stufen 1 bis 4 feuerst du immer mehr Projektile gleichzeitig (teils auch seitlich) ab. Auf Stufe 5 erhältst du zusätzlich einen automatischen "Hitscan"-Laser, der den nächsten Gegner über dem Schiff sofort trifft.
- **Raketen (K-Taste):** Besitzen einen Proximity-Zünder (Näherungszünder) und verursachen massiven Flächenschaden. Auf Stufe 5 feuerst du 3 Raketen gefächert ab. Raketen haben eine kurze Abklingzeit (Cooldown), die mit jedem Level sinkt.
- **Bombe (Leertaste):** Eine extreme Area-of-Effect (AoE) Waffe mit einer langen Abklingzeit (40 Sekunden auf Stufe 1, 20 Sekunden auf Stufe 5). Die Bombe trudelt in die absolute Bildschirmmitte und zündet dort eine massive, raumgreifende Schockwelle. Sie ist außerdem die **einzige Waffe**, die unzerstörbare Magma-Asteroiden aufbrechen kann.

### Hindernisse & Gegner
- **Feindliche Jäger:** Verschiedene Gegnertypen schwärmen aus und schießen auf dein Schiff.
- **Asteroiden:** Zerspringen bei Beschuss in kleinere Teile.
- **Magma-Asteroiden:** Diese glühenden Brocken sind extrem gefährlich. Normale Laserschüsse prallen an ihnen ab! Sie lassen sich nur mit einer strategisch platzierten Bombe knacken. Wenn sie zerstört werden, hinterlassen sie wertvolle Powerups.
- **Bosskämpfe:** Ab einem bestimmten Score erscheinen mächtige Bosse mit eigenen Angriffsmustern. Fällt ihre Lebensenergie unter 30 %, wechseln sie in eine "Enrage"-Phase und werden deutlich aggressiver. Ein besiegter Boss hinterlässt immer wertvolle Powerup-Drops (darunter oft 1-3 Upgrades).

### Benutzeroberfläche (UI) & Visuelles Feedback
- **Energie- und Cooldown-Balken:** Zeigen dir jederzeit an, ob deine Waffen einsatzbereit sind.
- **Dynamische Powerup-Anzeige:** Oben links siehst du deine aktiven Waffenstufen. Änderungen an deinen Upgrades werden dir sofort visuell kommuniziert:
  - **Neues Upgrade gesammelt:** Das Symbol ploppt auf und blinkt grün.
  - **Bestehende Waffe aufgewertet:** Das Symbol blinkt kurz grün auf.
  - **Treffer kassiert (Waffe verliert ein Level):** Das betroffene Upgrade-Symbol blinkt rot auf.
  - **Treffer kassiert (Waffe wird komplett verloren):** Das Symbol blinkt rot, schrumpft in sich zusammen und verschwindet aus der UI.

## Steuerung
- **W, A, S, D** - Schiff bewegen
- **L** - Laser feuern
- **K** - Raketen abfeuern
- **Leertaste** - Bombe abwerfen
- **P** - Spiel pausieren

## Lokale Entwicklung & Ausführung
Da das Projekt nun ES6-Module (`<script type="module">`) nutzt, blockieren moderne Browser das Laden aus Sicherheitsgründen (CORS), wenn du die `index.html` direkt als Datei (`file://`) öffnest. 

**So startest du das Spiel lokal:**
1. Öffne das Terminal im Projektverzeichnis.
2. Führe den lokalen Server aus:
   ```bash
   npx http-server src -p 8080 -c-1
   ```
3. Öffne `http://localhost:8080` in deinem Webbrowser.

**Tests ausführen:**
Das Projekt beinhaltet automatisierte E2E-Tests via Playwright. Um diese auszuführen:
```bash
npx playwright test
```

## GitHub Pages
[https://the3ver.github.io/starshooter_web/](https://the3ver.github.io/starshooter_web/)