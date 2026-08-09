# DOM-basierter Space Shooter

Ein klassisches "Space Shooter"-Browserspiel, das komplett **ohne HTML5-Canvas** auskommt und stattdessen die Positionierung von DOM-Elementen (via `CSS position: absolute` und `transform`) nutzt.

## Features
- **Modulare Architektur:** Die Spielelogik ist sauber in verschiedene ES6-Module (JS) aufgeteilt, und das Styling befindet sich in einer separaten CSS-Datei.
- **Waffensysteme (Getrenntes Leveln):**
  - **Laser (L):** Primärwaffe. Kostet Energie. Level 1-5.
  - **Raketen (R - Taste 'K'):** Proximity-Zünder, Flächenschaden. Level 1-5.
  - **Bombe (B - Taste 'Leertaste'):** Extreme AoE-Waffe. Einzige Waffe, die Magma-Asteroiden aufbrechen kann. Level 1-5.
- **Bosskämpfe:** Ab einem bestimmten Score erscheinen Bosse mit eigenen Angriffsmustern und Enrage-Phase.
- **Highscore:** Speichert die Top 10 im `localStorage`.

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

## Spielanleitung
- Steuerung:
  - **W, A, S, D** - Bewegen
  - **L** - Laser feuern
  - **K** - Raketen abfeuern
  - **Leertaste** - Bombe abwerfen

## GitHub Pages
[https://the3ver.github.io/starshooter_web/](https://the3ver.github.io/starshooter_web/)