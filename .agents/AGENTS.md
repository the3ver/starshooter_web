# Projekt: DOM-basierter Space Shooter

Dieses Projekt ist ein "Space Shooter"-Browserspiel, das komplett **ohne HTML5-Canvas** auskommt und stattdessen die Positionierung von DOM-Elementen (via `CSS position: absolute` und `transform`) nutzt.

## Architektur & Projektstruktur
Das Projekt wurde von einer monolithischen Struktur auf eine saubere Ordnerstruktur und ES-Module umgestellt:
- **Toplevel / Infrastruktur:** Konfigurationsdateien (`package.json`, `playwright.config.js`), CI/CD-Pipelines (`.github/workflows/deploy.yml`) und E2E-Tests (`tests/game.spec.js`).
- **`src/` (Web-Root):** Hier liegt der gesamte ausführbare Web-Code (`index.html`, `style.css`).
- **`src/js/` (Logik):** Aufgeteilt in ES-Module:
  - `main.js`: Einstiegspunkt und Initialisierung.
  - `state.js`: Zentraler State (Spieler-Stats, Arrays, Config, `godMode`, etc.).
  - `loop.js`: Der Game-Loop (`requestAnimationFrame`).
  - `entities.js`: Logik für Gegner, Bosse, Asteroiden und Powerups.
  - `input.js`: Tastatursteuerung.
  - `utils.js`: Hilfsfunktionen (z. B. UI-Updates, Kollisionen).

## Game-Loop & Kollisionen
- **Game-Loop:** Das Spiel wird über eine zentrale Funktion `gameLoop()` gesteuert, die durch `requestAnimationFrame` aufgerufen wird. 
- **Entitäten-Arrays:** Spielobjekte werden im `arrays`-Objekt (in `state.js`) verwaltet (z.B. `asteroiden`, `feinde`, `bosses`, `powerups`). Jedes Element enthält Referenzen auf sein DOM-Element (`el`), sowie Position (`x`, `y`) und weitere spielmechanische Werte.
- **Kollisionserkennung:** Basiert durchgehend auf simplen Bounding-Box Checks (`x < targetX + width ...`) innerhalb des `gameLoop`.

## Waffensysteme (Getrenntes Leveln)
Das Spielerschiff kann drei Waffentypen sammeln und auf Stufe 5 hochleveln. Powerup-Drops der Bosse und Asteroiden (L, R, B) erhöhen die jeweilige Stufe.
1. **Laser (L):** Primärwaffe. Kostet "Energie".
   - Stufe 1-4: Mehrere Projektile parallel/seitlich geschossen.
   - Stufe 5: Zusätzlicher, automatischer "Hitscan"-Laser, der direkt das nächste Ziel über dem Schiff sofort trifft.
2. **Raketen (R - Taste 'K'):** 
   - Proximity-Zünder. Flächenschaden. 
   - Stufe 5 feuert 3 Raketen gefächert. Cooldown (kurz, sinkt pro Level).
3. **Bombe (B - Taste 'Leertaste'):** 
   - Extreme AoE-Waffe mit langem Cooldown (max. 40s auf Stufe 1, 20s auf Stufe 5). 
   - Die Bombe trudelt in die absolute Bildschirmmitte und zündet dort eine massive, raumgreifende Schockwelle. 
   - Einzige Waffe, die Magma-Asteroiden aufbrechen kann.

## Besondere Features & Mechanics
- **Energie-System:** Laser verbrauchen Energie (Balken regeneriert sich automatisch).
- **Magma-Asteroiden:** Normalerweise unzerstörbar, prallen Laser-Schüsse ab. Nur durch Bomben zu knacken (werden dann zu Powerup-Drops).
- **Bosskämpfe:** Ab einem bestimmten Score/Level erscheinen Bosse (Typ 1-4) mit eigenen Angriffsmustern und einer "Enrage"-Phase ab 30% HP.
- **Cheats:** Eingabe von `idkfa` für volle Bewaffnung oder `idgod` für Unverwundbarkeit (God Mode).
- **Highscore:** Speichert die Top 10 im `localStorage` (`spaceShooterHighscores`).
- **Grafik:** Inline-SVGs und dynamische CSS-Transformationen (Neigung bei Bewegung, dynamischer Flammen-Ausstoß).
- **Mobile Support:** Touch-Steuerung mit virtuellem Joystick (Richtungseingabe) auf der linken Hälfte, dynamisches UI-Ausblenden in Menüs und anpassbare Layout-Skalierung (`100dvh`).

## Agent Verhalten
- Keine Entschuldigungen für Fehler. Halte Antworten kurz, fokussiert und lösungsorientiert.
- **Test-First / TDD (Inkrementell, 1 Test nach dem anderen):** Neue Features und Verhaltensänderungen müssen immer streng inkrementell testgetrieben implementiert werden: Schreibe und fixe immer genau EINEN Test (Rot -> Grün -> Refactor), bevor der nächste Test angelegt wird. Ein Test muss komplett fertig und grün sein, bevor der nächste angegangen wird. Falls unterwegs auffällt, dass weitere Tests sinnvoll sind, werden diese nach und nach auf dieselbe Weise ergänzt.
- Vor einem Git Push müssen immer alle Tests erfolgreich durchlaufen (grün sein).
- Wenn der Sandboxed-Modus aktiv ist und `run_command` aufgrund von Berechtigungen fehlschlägt, MUSS die Kommunikation über die Agent Bridge (`.agents/cmd_request.json` und `.agents/cmd_response.json`) erfolgen. Schreibe den Befehl als JSON (`{"id": <increment>, "command": "..."}`) in die Request-Datei, warte kurz (z.B. per `schedule`) und lese das Ergebnis aus der Response-Datei.
- Bei jedem Commit, der nicht nur die Infrastruktur des Projekts betrifft (z. B. Spiel-Logik, UI, CSS), muss das Patch-Level der Version erhöht werden (z. B. `0.12.0` -> `0.12.1`). Denke daran, sowohl die `package.json` als auch die Versionsanzeige im `index.html` anzupassen.
