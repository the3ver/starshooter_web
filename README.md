# DOM-basierter Space Shooter

Ein klassisches "Space Shooter"-Browserspiel, das komplett **ohne HTML5-Canvas** auskommt und stattdessen die Positionierung von DOM-Elementen (via `CSS position: absolute` und `transform`) nutzt.

## Features
- **Alles in einer Datei:** Die gesamte Struktur, das CSS (inkl. Keyframes-Animationen) und das JavaScript befinden sich in der `index.html`.
- **Waffensysteme (Getrenntes Leveln):**
  - **Laser (L):** Primärwaffe. Kostet Energie. Level 1-5.
  - **Raketen (R - Taste 'K'):** Proximity-Zünder, Flächenschaden. Level 1-5.
  - **Bombe (B - Taste 'Leertaste'):** Extreme AoE-Waffe. Einzige Waffe, die Magma-Asteroiden aufbrechen kann. Level 1-5.
- **Bosskämpfe:** Ab einem bestimmten Score erscheinen Bosse mit eigenen Angriffsmustern und Enrage-Phase.
- **Highscore:** Speichert die Top 10 im `localStorage`.

## Spielanleitung
- Öffne einfach die Datei `index.html` im Browser oder besuche die GitHub Pages Seite.
- Steuerung:
  - **W, A, S, D** - Bewegen
  - **L** - Laser feuern
  - **K** - Raketen abfeuern
  - **Leertaste** - Bombe abwerfen

## GitHub Pages
[https://the3ver.github.io/starshooter_web/](https://the3ver.github.io/starshooter_web/)