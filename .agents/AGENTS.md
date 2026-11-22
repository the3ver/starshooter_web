# Projekt: DOM-basierter Space Shooter (Starshooter)

Browser-Space-Shooter ohne HTML5-Canvas: Weltobjekte sind DOM-Elemente (`position: absolute`, `transform`, Inline-SVG). ES-Module in `src/js/`, Web-Root `src/`, Tests mit Playwright in `tests/`, Cloudflare-Worker in `worker/`.

## Zielplattformen
- **Desktop-Browser** (Tastatur) und **Tablets** mit und ohne Tastatur. Jedes neue Feature braucht eine Bedienung per Tastatur und per Touch (Joystick, Knoepfe in `#mobile-controls`).
- **Handys** sind keine Zielplattform; Leistungsgrenze ist ein aktuelles Tablet.

## Pruefen und Release
- **Pruefen:** `npm run check` (Prettier, ESLint, `tsc --checkJs`, alle Tests; gruen eine Zeile). Der Stop-Hook und ein Hook vor jedem `git commit` rufen ihn bei geaenderten Dateien auf (Commit bei Rot blockiert), ein Edit-Hook laesst ESLint `--fix` und Prettier auf jede geaenderte Datei laufen; `npm run fmt` formatiert alles. Vor jedem Push gruen. Typfehler mit JSDoc-Casts beheben, Browser-Erweiterungen in `types/globals.d.ts`.
- **Review:** vor jedem Push den Subagenten `reviewer` mit dem Commit-Bereich aufrufen (Regeln in `docs/review.md`) und seine Befunde beheben oder begruenden.
- **Version:** bei Aenderungen an Spiel-Logik/UI `npm run release -- X.Y.Z` (setzt alle Versionsstellen und ein Changelog-Geruest), danach die Highlights statt `TODO` in `src/js/changelog.js` eintragen. `tests/version.spec.js` prueft alle Stellen.
- **Tests sind deterministisch:** Zeit vergeht ueber `simulationStep()` in einem `page.evaluate` oder ueber die Fake-Uhr aus `tests/helpers.js` (`installClock`, `advanceClock`). `tests/rules.spec.js` laesst die Zahl der Echtzeit-Wartezeiten je Datei nur sinken.
- **Testhelfer:** `setGameState(page)` aus `tests/helpers.js` vor `page.goto`; Versions-, Changelog- und Protokollwerte im Test aus dem Spielcode lesen (`GAME_VERSION`, `changelogData`, `PROTOCOL_VERSION`).
- **Testserver:** Port je Arbeitsbaum aus `webserver.config.js` (8100-8999, `PORT` ueberschreibt); `npm run dev` bleibt auf 8080.
- **README-Screenshot** nur ueber `npm run screenshot`. **Balancing-Messstand** `npm run balancing` (Bot-P2 je Schiff, geseedet, Ergebnisse git-ignoriert; Messlogik in `balancing/measurement.js`, Rauchtest in `tests/bench.spec.js`).

## Architektur
- **Game-Loop** (`loop.js`): feste 60-Hz-Schritte; `simulationStep()` = `simulate()` + `Display.drawWorld()`, plant keinen Frame ein (Tests rufen ihn direkt). Weltlisten in `arrays` (`state.js`); `restartGame()` (`utils.js`) leert jede Liste und stellt die Klassen von `body`/`#spielfeld` her, `tests/restart.spec.js` prueft beides. Jede neue Modulvariable (`let` auf oberster Ebene in `src/js`) braucht einen Reset in `restartGame` oder einen Grund in `MODULE_STATUS` (`tests/rules.spec.js`).
- **Spielmodi:** `single` (400 px Feld, 1 Schiff), `coop` (600 px, 2 Schiffe, lokal oder Bot `state.p2IsBot`), `online` (600 px, WebRTC, Host simuliert).
- Modulliste, Kollisionen, Spielmodi im Detail: [docs/architektur.md](../docs/architektur.md).

## Anzeige-Schicht (vor jeder Aenderung an Weltobjekten, Effekten oder Zeichencode lesen: [docs/anzeige-schicht.md](../docs/anzeige-schicht.md))
- Spiellogik aendert bei Weltobjekten nur Modellfelder (`x`/`y` = linke obere Ecke, `rot` in Grad, Optik-Felder). Erzeugen ueber `arrays.X.push(Display.create({...}, 'kind'))`, entfernen ueber `Display.remove(obj)` vor dem `splice`.
- Nur das Backend (`display-dom.js`, Elementbau in `display-dom-objects.js`) schreibt Position, Drehung, Deckkraft und Zustandsklassen ins DOM. Neue Weltlisten bekommen einen Eintrag in `DRAWER` (`display-dom.js`).
- Spielerschiffe zeichnet `Display.drawPlayer()` aus `state`/`state.p2`; Partikel nur ueber `createParticles({...})` (`particles.js`); Effekte mit Lebensdauer ueber `createEffect` (`effects.js`).
- HUD, Menues, Hangar, Cutszene, Lobby und mobile Steuerung bleiben bewusst HTML.
- Waechtertests in `tests/display-rules.spec.js` (nur Quelltext, ohne Seite) pruefen die Trennung je Modul.

## Multiplayer (vor jeder Aenderung an `network.js`, `net-encoding.js`, `client.js` oder am Snapshot lesen: [docs/multiplayer.md](../docs/multiplayer.md))
- Host ist autoritativ (Gegner, Bosse, Kollisionen, Powerups); der Client sagt nur das eigene Schiff voraus und sendet Eingaben.
- **Snapshot-Format:** `tests/protocol.spec.js` haelt die Feldform von `serializeGameState()` je `PROTOCOL_VERSION` in `tests/fixtures/protocol.json` fest und prueft, dass `applyGameStateSnapshot()` jedes gesendete Feld liest. Bei einer Formataenderung `PROTOCOL_VERSION` (`net-encoding.js`) erhoehen und die Fixture neu schreiben (Befehl im Kopf des Tests).
- Ereignisse, die nur einen Spieler betreffen (Treffer-Flash, Sound), gehen nur an diesen Spieler. Cheatcodes sind online gesperrt.

## Waffen und Schiffe (vor jeder Aenderung an Waffen, Schiffen oder Bot-Verhalten lesen: [docs/schiffe.md](../docs/schiffe.md))
- Waffen leveln getrennt bis Stufe 5: Laser (L/B, Energie, Stufe 5 Hitscan), Raketen (K/V), Bombe (Leertaste/C, einzige Waffe gegen Magma), Superwaffe (S).
- Schiffe: `viper` (Viper-X, Rolle/Overdrive/Kill-Kombo, `viper.js`), `phantom` (Phantom-NX), `gleve` (Gleve-MR, Sweep und Dash, `gleve.js`), `sniper` (Spectre-SR, Fadenkreuz, Granaten, Minen, `sniper.js`). Sonderschiffe belegen dieselben Tasten und Stufen mit eigenen Waffen.
- Jede Schiffsfunktion braucht Bot-Logik (`bot.js`), Online-Sync (Snapshot + Client-Darstellung) und Tests fuer beide.

## Agent Bridge
Wenn der Sandboxed-Modus aktiv ist und `run_command` an Berechtigungen scheitert, laeuft die Kommunikation ueber `.agents/cmd_request.json` (`{"id": <increment>, "command": "..."}`) und `.agents/cmd_response.json`: Befehl schreiben, kurz warten, Antwort lesen.
