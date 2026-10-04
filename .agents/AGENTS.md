# Projekt: DOM-basierter Space Shooter (Starshooter)

Dieses Projekt ist ein "Space Shooter"-Browserspiel, das komplett **ohne HTML5-Canvas** auskommt und stattdessen die Positionierung und Transformation von DOM-Elementen (via `CSS position: absolute`, `transform` und Inline-SVGs) nutzt.

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
  - `waffen.js`: Spielerwaffen (Autolaser, Hitscan, Laser, Raketen, Bomben) samt Treffer-Logik und `versteckeAlleLaser`.
  - `gleve.js`: Schiff Gleve-MR: Laser-Sweep als Hauptwaffe (`steuereSweep`/`starteSweep`/`aktualisiereSweep`, Parade von Feind-/Boss-Lasern und Hack-Projektilen), Dash als Zweitwaffe (`aktualisiereGleve`, Abprall an Bossen/Magma, Unverwundbarkeit) sowie die Online-Client-Teile (`sageDashVorher`, `uebernehmeSnapshot`, `zeigeGleveZustand`).
  - `partikel.js`: `animierenPartikel()` für Partikel-Bewegung und -Zerfall.
  - `entities.js`: Spawnen und Verhalten von Feinden, Bossen (Typ 1–4), Asteroiden, Magma-Brocken und Powerups.
  - `input.js`: Tastatur- & Touch-Steuerung (Joystick, Buttons), Cheatcode-Erkennung.
  - `utils.js`: Hilfsfunktionen (UI-Updates, Kollisionen, Partikel, Highscores, Spielmodi).
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

## Multiplayer & WebRTC Architektur (`network.js`)
- **P2P Broker:** Verwendet `@trystero-p2p/torrent` (mit dynamischem Fallback).
- **TURN-Relay:** Vor dem Raumbeitritt holt `holeTurnConfig()` kurzlebige Cloudflare-TURN-Zugangsdaten vom Worker-Endpoint `GET /api/turn` (3 s Timeout) und reicht sie als `turnConfig` an Trystero. Schlägt das fehl (503, Timeout, ungültige Antwort), läuft die Verbindung wie bisher nur mit STUN. Secrets `TURN_KEY_ID` und `TURN_KEY_API_TOKEN` liegen im Worker. **Kostenbremse:** Der Worker fragt den TURN-Egress des laufenden Monats über die Cloudflare-GraphQL-API ab (`callsTurnUsageAdaptiveGroups`, Secret `CF_ANALYTICS_TOKEN` mit Recht "Account Analytics: Read", Var `CF_ACCOUNT_ID`), speichert ihn 10 Minuten zwischen und gibt ab `TURN_MONATSLIMIT_GB` (Standard 800 von 1.000 GB Free Tier) keine Zugangsdaten mehr aus. Ist der Verbrauch nicht abfragbar, gibt er ebenfalls keine aus. Zugangsdaten gelten 2 Stunden.
- **Host-Autorität:** Host berechnet Gegner, Bosse, Kollisionen, Powerups und sendet Snapshots.
- **Client-Prediction:** Client berechnet seine eigene Schiffsbewegung lokal ohne Input-Lag.
- **Netzkodierung (`netzkodierung.js`):** `serializeGameState()` und `applyGameStateSnapshot()` arbeiten weiter mit vollen Snapshots. Dazwischen kodiert der Host per `SnapshotKodierer` jeden 2. Schritt ein Paket `{ v, n, t, k?, o?, l? }`: Werte werden vorher pro Feld gerundet (`RUNDUNG`: x/y/vx/vy/Energie 1 Nachkommastelle, rot/rotate/hp/Cooldowns ganzzahlig, Ids/Typen/Besitzer/Booleans nie), neue Objekte gehen einmal komplett, danach nur geaenderte Felder (`_d` = entfernt, `_r` = ersetzt). Listen tragen ihre Id-Folge kompakt (`i`, Zahl = Listenpraefix + Zahl) nur bei Aenderung. Spieler-, Feind-, Boss-Laser und Boss-Raketen nutzen Dead Reckoning: Beide Seiten rechnen `x += vx`, `y += vy` (Spielerlaser `y -= vy`) fuer `t`-Differenz Weltschritte (`weltSchritt` in `loop.js`, steht in der Boss-Warnung still); x/y gehen nur bei mehr als 0,5 px Abweichung mit. Der Kodierer fuehrt intern denselben Dekodierer als Spiegel. Client: `empfangeSnapshotPaket()` dekodiert und ruft `applyGameStateSnapshot()`.
- **Keyframes & Laufnummer:** Jedes 30. Paket (~1 s), das erste nach Verbindung und nach Spielstart (`startOnlineGame`) sowie auf Anforderung (`keyframe_anfordern`) ist ein Keyframe (`k: 1`). Der Dekodierer ignoriert Deltas ohne Keyframe und bei einer Luecke in `n` und wartet auf den naechsten Keyframe (fordert ihn per Event an).
- **Eingaben (Client -> Host):** `sendeEingabe()` in `clientSchritt()` sendet ueber `EingabeSender` sofort bei Tastenwechsel, die Position (1 Nachkommastelle) hoechstens jeden 2. Schritt und nur bei Bewegung, sonst alle 30 Schritte einen Heartbeat. Gleve-Schiffe senden zusaetzlich `rx`/`ry` (Steuerrichtung fuer den Dash auf der Raketen-Taste, 2 Nachkommastellen). `laser`/`rakete`/`bombe` sind gehaltene Zustaende: Der Host merkt sie (`laserInputRequested`, `raketeGehalten`, `bombeGehalten`) bis zum naechsten Paket, `waffen.js` setzt daraus jeden Schritt `networkFireRakete`/`networkFireBombe` wie frueher ein `true` pro Bild. Bei Spielstart und Verbindungsende werden sie zurueckgesetzt.
- **Protokollversion:** Nach dem Verbinden schicken beide Peers `{ type: 'hallo', protokoll: PROTOKOLL_VERSION, version: GAME_VERSION }`. Andere Version, Pakete ohne passendes `v` oder kein `hallo` binnen `HALLO_TIMEOUT_MS` (10 s) beenden die Sitzung (`brecheWegenVersionAb`) mit dem Hinweis `Unterschiedliche Spielversionen, bitte Seite neu laden (Strg+F5)`. Bei Formataenderungen `PROTOKOLL_VERSION` erhoehen.
- **Boss-Warnung online:** Der Host sendet auch waehrend der 2-s-Warnung jeden 2. Schritt einen Snapshot.
- **Zielgerichtete Events:** Schadens-Flashes, Treffer-Sounds und Powerup-Flashes werden nur für den betroffenen Spieler getriggert.
- **Synchrone Aktionen:** Cutszenen-Skip (ESC), synchrone Bomben- & Raketen-Detonationen (`bomb_detonated`, `missile_detonated`, `target_destroyed`) und Highscore-Eingabe (Kombination `AAA+BBB`) werden über DataChannels abgeglichen.
- **Rematch-Workflow:** Nach Spielende und Neustart bleibt die Verbindung bestehen; Host startet nächste Runde via `#btn-online-start` oder verlässt den Raum via `#btn-online-leave`.
- **Gemeinsame Pause:** `pause.js` pausiert im Online-Modus beide Spieler (`pause_start` mit `von` und `dauerMs`, `pause_ende`); nur der Besitzer (`state.pauseVon`, Host `p1`, Client `p2`) beendet sie, nach 60 s endet sie automatisch (Host sendet `pause_ende`, Client beendet lokal als Fallback), bei `peer_left` bzw. Verbindungsabbruch ebenfalls. Single/Coop pausieren weiter lokal ohne Limit.
- **Cheat-Sperre:** Im Online-Modus sind Cheatcodes für alle Peers deaktiviert.

## Waffensysteme (Getrenntes Leveln bis Stufe 5)
1. **Laser (L / B):** Primärwaffe, verbraucht Energie (Balken regeneriert automatisch). Stufe 5: Hitscan-Laser.
2. **Raketen (K / V):** Proximity-Zünder, Flächenschaden, 3-Phasen Homing-Physik.
3. **Bombe (Leertaste / C):** AoE-Waffe, zündet im Zentrum. Einzige Waffe gegen unzerstörbare Magma-Asteroiden.
4. **Super-Waffe (S / 10 weiße Splitter):** Max-Waffen, Schild 3, Infinite Energy, Laser-Durchschlag.

**Schiffe:** `viper` (Viper-X), `phantom` (Phantom-NX), `gleve` (Gleve-MR, `gleve.js`). Die Gleve ersetzt Waffen auf denselben Tasten und Stufen:
- **Laser-Sweep (Hauptwaffe, Laser-Taste, `laserStufe`):** Gehalten startet `steuereSweep` (aus `spieler.js`, Energie-Phase) im Takt pendelnde Sweeps (Richtung wechselt bei jedem Start, `gleveSweepTakt`); Strahl über 10 Frames (`aktualisiereSweep` aus `waffen.js`), Treffer einmal pro Sweep und Ziel. Je Stufe 1-5: Bogen 90-150°, Länge 100-140 px, Schaden 30-50, Takt 20-16 Frames, Kosten 8/8/7/7/6 Energie (beim Start abgezogen, Superwaffe kostenlos). Solange die Taste gehalten wird oder ein Sweep läuft, keine Energie-Regeneration; Energiebalken (HUD "SWEEP") orange unter den Sweep-Kosten. Pariert Feind-/Boss-Laser und Hack-Projektile (`harmlos: true`, orange; Stufe 3-4 zu 50 %, Stufe 5 immer zurückgeworfen in `laserArray`). Mobil feuert der Joystick wie bei allen Schiffen automatisch (Dauer-Sweep).
- **Dash (Zweitwaffe, Raketen-Taste, `raketenStufe`):** ein Dash pro Tastendruck (Flanke) in Steuerrichtung (ohne Eingabe nach oben), 8 Frames, Reichweite 100-150 px und Schaden 60-100 je Stufe; keine Energiekosten, Cooldown über `raketenCooldown` (180/165/150/135/120 Frames, HUD "DASH", mobil `#btn-rakete` mit "D"). Zerschneidet normale Feinde und Asteroiden, jeder Kill verkürzt den Cooldown um `shipModels.gleve.dashKillCooldown` (30) Frames; Bosse/Magma unter Raketen-Stufe 5 stoppen ihn mit seitlichem Abprall (`dashKnacktMagma`); unverwundbar während Dash und kurz danach (`Utils.istDashUnverwundbar`). Keine Raketenwerfer-Pods.
- **Bot:** hält den Sweep (`botFireLaser`), solange Geschosse/Gegner im Bogen der Stufe liegen, und dasht per Flanke (`botFireRakete` einen Schritt) ohne Cooldown auf Feinde in Reichweite (Richtung `state.p2.botDashRichtung`, nicht in Bosse, Pause zwischen Dashs).
- **Online:** Client sendet `rx`/`ry` (Steuerrichtung); ein neuer Raketen-Druck wird auf dem Host als `netzDashAnfrage` gemerkt (kurzer Druck geht nicht verloren), sonst gilt `raketeGehalten`; der Sweep folgt `laserInputRequested`. Der Client sagt den eigenen Dash (Raketen-Taste) voraus (Startschritt ohne Bewegung, Paket trägt Startposition), der Host ignoriert Client-Positionen während Dash/Abprall. Snapshot trägt `gleveDashTimer`, `gleveAbprallTimer`, `gleveUnverwundbar`, `gleveSweepTimer`, `gleveSweepWinkel`, `gleveSweepRichtung` (nur bei Gleve); den Abprall übernimmt der Client vom Host. Dazu `gleveDashLadungen` (ganzzahlig; HUD-Punkte und Mobil-Zahl am Client aus dem Snapshot, kein vorhergesagter Dash ohne Ladung). Protokoll 6. Klingenwelle: Am Ende jedes Sweeps (`aktualisiereSweep`) entsteht in `arrays.gleveWellen` eine Sichel (Breite = Sehne des Bogens auf halber Laenge, mind. 50 px, Hoehe 14 px; `WELLE_TEMPO` 8 px/Schritt, `WELLE_SCHRITTE` 15 = 120 px), die in `aktualisiereWellen` (aus `waffen.js`) Ziele jenseits der Sweep-Reichweite einmal pro Welle mit halbem Sweep-Schaden trifft (wie `sweepTreffer`, Kills geben Energie, keine Parade, keine Zusatzkosten). Snapshot-Liste `gleveWellen` (id, x, y, breite, owner), Client zeichnet `.gleve-welle`.

## Projektspezifische Agent-Hinweise
- **Agent Bridge:** Wenn der Sandboxed-Modus aktiv ist und `run_command` aufgrund von Berechtigungen fehlschlägt, MUSS die Kommunikation über die Agent Bridge (`.agents/cmd_request.json` und `.agents/cmd_response.json`) erfolgen. Schreibe den Befehl als JSON (`{"id": <increment>, "command": "..."}`) in die Request-Datei, warte kurz (z.B. per `schedule`) und lese das Ergebnis aus der Response-Datei.
- **Versionsanzeige:** Bei Änderungen an Spiel-Logik/UI sowohl `package.json` als auch die Versionsanzeige in `index.html` anpassen.
- **Testhelfer (`tests/helfer.js`):** `setzeSpielstand(page, { skipCutscene })` setzt per `addInitScript` `starshooter_last_seen_version` (aktuelle `GAME_VERSION`, gelesen aus `src/js/changelog.js`) und standardmäßig `starshooter_skip_cutscene`. Neue Specs nutzen ihn statt eigener Versions-Literale; Versions-, Changelog- und Protokollwerte in Tests aus dem Spielcode lesen (`GAME_VERSION`, `changelogData`, `PROTOKOLL_VERSION`). Bei einem Release müssen die Tests deshalb nicht mehr angepasst werden (nur ein `changelogData`-Eintrag für die neue Version ist Pflicht).
- **README-Screenshot:** `docs/gameplay.png` wird nur mit `npm run screenshot` (`playwright.screenshot.config.js`, `tests/screenshot.spec.js`) neu erzeugt; `npm test` und CI ignorieren diese Datei.


- **Balancing-Messstand:** `npm run balancing` (`balancing/messstand.spec.js`, `playwright.balancing.config.js`, nicht in `npm test`/CI) misst deterministisch (geseedetes `Math.random`, synchrone `simulationsSchritt()`-Schleifen) je Schiff als Bot-P2 (hard) Schritte bis Sieg und Treffer am Bot in Welle/Boss 1/Boss 2 (5 Seeds, Ergebnisse in `balancing/ergebnisse/*.json`, git-ignoriert); die Zahlen spiegeln auch die Bot-Qualitaet pro Schiff wider, nicht nur die Schiffsstaerke.
