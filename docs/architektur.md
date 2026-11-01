# Architektur und Module

Referenz zu .agents/AGENTS.md (dort stehen die Regeln, hier die Details).

## Architektur & Projektstruktur
Das Projekt ist in modular gegliederte ES-Module strukturiert:
- **Toplevel / Infrastruktur:** Konfigurationsdateien (`package.json`, `playwright.config.js`), CI/CD-Pipelines (`.github/workflows/deploy.yml`) und E2E-Tests (`tests/game.spec.js`).
- **`src/` (Web-Root):** Ausführbarer Web-Code (`index.html`, `style.css`).
- **`src/js/` (Logik & ES-Module):**
  - `main.js`: Einstiegspunkt, Event-Listener & Initialisierung.
  - `state.js`: Zentraler State (Spieler-Stats, P2-State, Arrays, Config, `godMode`, Network-State etc.).
  - `loop.js`: Der zentrale Game-Loop (`requestAnimationFrame`, feste 60-Hz-Schritte) und `simulationsSchritt()` als kurzer Orchestrator (Early-Exits, Sterne, Spawns, Score, Netzwerk-Sync), der die Teilmodule in fester Reihenfolge aufruft.
  - `client.js`: `clientSchritt()` für den Online-Client (lokale P2-Steuerung, Sterne, Partikel, Input senden).
  - `spieler.js`: I-Frames, Bewegung von P1/P2 inkl. Bot, Energie (liefert `laserAktiv`/`laserAktivP2`) und Schild-Regeneration.
  - `powerups.js`: Powerup-Bewegung, Einsammeln, Traktorstrahl-Schleppen und Powerup-Effekte (`wendePowerupAn`).
  - `gegner.js`: Feind-Spawns, Hacker-Verhalten, Update & Kollision von Asteroiden, Feinden, Feind-Lasern und Hack-Projektilen.
  - `boss.js`: Boss-Logik (Bewegung, Angriffe, Boss-Hacks), Boss-Laser, Boss-Bomben und Boss-Raketen.
  - `waffen.js`: Spielerwaffen (Autolaser, Hitscan, Laser, Raketen, Bomben) samt Treffer-Logik; Auto-/Hitscan-Strahl als `state.autolaserStrahl`/`state.hitscanStrahl` (`{ x, y, laenge, winkel }` bzw. null).
  - `gleve.js`: Schiff Gleve-MR: Laser-Sweep als Hauptwaffe (`steuereSweep`/`starteSweep`/`aktualisiereSweep`, Parade von Feind-/Boss-Lasern und Hack-Projektilen), Dash als Zweitwaffe (`aktualisiereGleve`, Abprall an Bossen/Magma, Unverwundbarkeit) sowie die Online-Client-Teile (`sageDashVorher`, `uebernehmeSnapshot`, `zeigeGleveZustand`).
  - `viper.js`: Schiff Viper-X: Ausweichrolle (`aktualisiereViper` aus `spieler.js`/`client.js`, Doppeltipp-/Wisch-Erkennung, Unverwundbarkeit, Online-Vorhersage `netzEingabe`/`uebernehmeSnapshot`/`zeigeViperZustand`, Bereitschafts-HUD).
  - `sniper.js`: Schiff Spectre-SR (`sniper`): Fadenkreuz-Laser, Aufladen und Betaeubungsgranate (komplett: Fadenkreuz, Schuss, Aufladen, Granate, Online, Bot).
  - `partikel.js`: `animierenPartikel()` für Partikel-Bewegung und -Zerfall.
  - `anzeige.js`: Anzeige-Schnittstelle (engine-neutral): `erzeuge(obj, art)`, `zeichneWelt()`, `entferne(obj)`, `setzeBackend()`/`holeBackend()`. Siehe Abschnitt "Anzeige-Schicht".
  - `anzeige-dom.js`: DOM-Backend der Anzeige; einzige Stelle, die Position, Drehung und Deckkraft der Weltobjekte ins DOM schreibt.
  - `anzeige-dom-objekte.js`: Elementbau je Objektart (`ERZEUGER`, SVG-Vorlagen fuer Feinde/Bosse, Powerup-Optik), fuer Host und Online-Client gleich.
  - `entities.js`: Spawnen und Verhalten von Feinden, Bossen (Typ 1–4), Asteroiden, Magma-Brocken und Powerups.
  - `input.js`: Tastatur- & Touch-Steuerung (Joystick, Buttons), Cheatcode-Erkennung.
  - `utils.js`: Hilfsfunktionen (UI-Updates, Kollisionen, Partikel, Highscores, Spielmodi).
  - `effekte.js`: Effekte mit Lebensdauer (`erzeugeEffekt`, `aktualisiereEffekte`, `entferneEffekte`), siehe Abschnitt "Anzeige-Schicht".
  - `cutscene.js`: Intro-Cutszene mit Konvoi, Angriff, Explosionen und synchronem Skip.
  - `audio.js`: Sound-Synthesizer via Web Audio API (Laser, Raketen, Bomben, Treffer, Boss-Warnung, BGM).
  - `bot.js`: KI-Partner für 2-Spieler Co-op (Ausweichen, Zielen, Powerup-Sammeln, Schwierigkeitsgrade).
  - `pause.js`: Pause-Logik inkl. gemeinsamer Online-Pause mit 60-s-Limit.
  - `network.js`: Serverloser P2P-Multiplayer via WebRTC/Trystero (State-Serialisierung, Input-Handling, Event-Broadcasts).
  - `netzkodierung.js`: Reine Kodierung ohne DOM: `SnapshotKodierer`/`SnapshotDekodierer` (Delta-Snapshots mit Rundung, Dead Reckoning, Keyframes), `EingabeSender` (Client-Eingaben nur bei Aenderung) und `PROTOKOLL_VERSION`.
  - `changelog.js`: In-Game Versionsanzeige und Dialog für neue Features ("Was gibt's Neues?").

## Game-Loop, Kollisionen & Spielmodi
- **Game-Loop:** `gameLoop(zeitstempel)` läuft per `requestAnimationFrame` und führt über einen Zeit-Akkumulator (`berechneSchritte`) feste 60-Hz-Simulationsschritte (`simulationsSchritt()`) aus, maximal 5 pro Frame (Rückstand nach Tab-Wechsel wird verworfen). Das Spieltempo ist dadurch unabhängig von der Monitor-Bildrate. `simulationsSchritt()` plant selbst keinen Frame ein; Tests rufen ihn direkt auf.
- **Entitäten-Arrays:** Verwaltet im `arrays`-Objekt in `state.js` (`asteroiden`, `feinde`, `bosses`, `powerups`, `laserArray`, `raketenArray`, `bombenArray`, `partikel`, `sterne`).
- **Kollisionserkennung:** Bounding-Box Checks (`x < targetX + width ...`) im `gameLoop`.
- **Spielmodi:**
  - `single`: 400px Spielfeldbreite, 1 Spielerschiff.
  - `coop` (Lokal / Bot): 600px Spielfeldbreite, 2 Spielerschiffe, geteilte Tastatur oder KI-Bot-Partner (`state.p2IsBot`).
  - `online` (WebRTC P2P): 600px Spielfeldbreite, Host simuliert Welt, Client empfängt Snapshot & sendet Inputs.
