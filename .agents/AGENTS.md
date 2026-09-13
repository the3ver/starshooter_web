# Projekt: DOM-basierter Space Shooter (Starshooter)

Dieses Projekt ist ein "Space Shooter"-Browserspiel, das komplett **ohne HTML5-Canvas** auskommt und stattdessen die Positionierung und Transformation von DOM-Elementen (via `CSS position: absolute`, `transform` und Inline-SVGs) nutzt.

## Architektur & Projektstruktur
Das Projekt ist in modular gegliederte ES-Module strukturiert:
- **Toplevel / Infrastruktur:** Konfigurationsdateien (`package.json`, `playwright.config.js`), CI/CD-Pipelines (`.github/workflows/deploy.yml`) und E2E-Tests (`tests/game.spec.js`).
- **`src/` (Web-Root):** Ausführbarer Web-Code (`index.html`, `style.css`).
- **`src/js/` (Logik & ES-Module):**
  - `main.js`: Einstiegspunkt, Event-Listener & Initialisierung.
  - `state.js`: Zentraler State (Spieler-Stats, P2-State, Arrays, Config, `godMode`, Network-State etc.).
  - `loop.js`: Der zentrale Game-Loop (`requestAnimationFrame`), Spawns, Bewegung & Kollisionsabfragen.
  - `entities.js`: Spawnen und Verhalten von Feinden, Bossen (Typ 1–4), Asteroiden, Magma-Brocken und Powerups.
  - `input.js`: Tastatur- & Touch-Steuerung (Joystick, Buttons), Cheatcode-Erkennung.
  - `utils.js`: Hilfsfunktionen (UI-Updates, Kollisionen, Partikel, Highscores, Spielmodi).
  - `cutscene.js`: Intro-Cutszene mit Konvoi, Angriff, Explosionen und synchronem Skip.
  - `audio.js`: Sound-Synthesizer via Web Audio API (Laser, Raketen, Bomben, Treffer, Boss-Warnung, BGM).
  - `bot.js`: KI-Partner für 2-Spieler Co-op (Ausweichen, Zielen, Powerup-Sammeln, Schwierigkeitsgrade).
  - `network.js`: Serverloser P2P-Multiplayer via WebRTC/Trystero (State-Serialisierung, Input-Handling, Event-Broadcasts).
  - `changelog.js`: In-Game Versionsanzeige und Dialog für neue Features ("Was gibt's Neues?").

## Game-Loop, Kollisionen & Spielmodi
- **Game-Loop:** Gesteuert über `gameLoop()` via `requestAnimationFrame`.
- **Entitäten-Arrays:** Verwaltet im `arrays`-Objekt in `state.js` (`asteroiden`, `feinde`, `bosses`, `powerups`, `laserArray`, `raketenArray`, `bombenArray`, `partikel`, `sterne`).
- **Kollisionserkennung:** Bounding-Box Checks (`x < targetX + width ...`) im `gameLoop`.
- **Spielmodi:**
  - `single`: 400px Spielfeldbreite, 1 Spielerschiff.
  - `coop` (Lokal / Bot): 600px Spielfeldbreite, 2 Spielerschiffe, geteilte Tastatur oder KI-Bot-Partner (`state.p2IsBot`).
  - `online` (WebRTC P2P): 600px Spielfeldbreite, Host simuliert Welt, Client empfängt Snapshot & sendet Inputs.

## Multiplayer & WebRTC Architektur (`network.js`)
- **P2P Broker:** Verwendet `@trystero-p2p/torrent` (mit dynamischem Fallback).
- **Host-Autorität:** Host berechnet Gegner, Bosse, Kollisionen, Powerups und sendet Snapshots.
- **Client-Prediction:** Client berechnet seine eigene Schiffsbewegung lokal ohne Input-Lag.
- **Zielgerichtete Events:** Schadens-Flashes, Treffer-Sounds und Powerup-Flashes werden nur für den betroffenen Spieler getriggert.
- **Synchrone Aktionen:** Cutszenen-Skip (ESC), synchrone Bomben- & Raketen-Detonationen (`bomb_detonated`, `missile_detonated`, `target_destroyed`) und Highscore-Eingabe (Kombination `AAA+BBB`) werden über DataChannels abgeglichen.
- **Rematch-Workflow:** Nach Spielende und Neustart bleibt die Verbindung bestehen; Host startet nächste Runde via `#btn-online-start` oder verlässt den Raum via `#btn-online-leave`.
- **Cheat-Sperre:** Im Online-Modus sind Cheatcodes für alle Peers deaktiviert.

## Waffensysteme (Getrenntes Leveln bis Stufe 5)
1. **Laser (L / B):** Primärwaffe, verbraucht Energie (Balken regeneriert automatisch). Stufe 5: Hitscan-Laser.
2. **Raketen (K / V):** Proximity-Zünder, Flächenschaden, 3-Phasen Homing-Physik.
3. **Bombe (Leertaste / C):** AoE-Waffe, zündet im Zentrum. Einzige Waffe gegen unzerstörbare Magma-Asteroiden.
4. **Super-Waffe (S / 10 weiße Splitter):** Max-Waffen, Schild 3, Infinite Energy, Laser-Durchschlag.

## Projektspezifische Agent-Hinweise
- **Agent Bridge:** Wenn der Sandboxed-Modus aktiv ist und `run_command` aufgrund von Berechtigungen fehlschlägt, MUSS die Kommunikation über die Agent Bridge (`.agents/cmd_request.json` und `.agents/cmd_response.json`) erfolgen. Schreibe den Befehl als JSON (`{"id": <increment>, "command": "..."}`) in die Request-Datei, warte kurz (z.B. per `schedule`) und lese das Ergebnis aus der Response-Datei.
- **Versionsanzeige:** Bei Änderungen an Spiel-Logik/UI sowohl `package.json` als auch die Versionsanzeige in `index.html` anpassen.


