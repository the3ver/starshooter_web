# Projekt: DOM-basierter Space Shooter (Starshooter)

Browser-Space-Shooter ohne HTML5-Canvas: Weltobjekte sind DOM-Elemente (`position: absolute`, `transform`, Inline-SVG). ES-Module in `src/js/`, Web-Root `src/`, Tests mit Playwright in `tests/`, Cloudflare-Worker in `worker/`.

## Zielplattformen
- **Desktop-Browser** (Tastatur) und **Tablets** mit und ohne Tastatur. Jedes neue Feature braucht eine Bedienung per Tastatur und per Touch (Joystick, Knoepfe in `#mobile-controls`).
- **Handys** sind keine Zielplattform; Leistungsgrenze ist ein aktuelles Tablet.

## Pruefen und Release
- **Pruefen:** `npm run check` (ESLint, `tsc --checkJs`, alle Tests; gruen eine Zeile). Der Stop-Hook ruft ihn bei geaenderten Dateien auf, ein Edit-Hook laesst ESLint `--fix` auf jede geaenderte JS-Datei laufen. Vor jedem Push gruen. Typfehler mit JSDoc-Casts beheben, Browser-Erweiterungen in `types/globals.d.ts`.
- **Version:** bei Aenderungen an Spiel-Logik/UI `npm run release -- X.Y.Z` (setzt alle Versionsstellen und ein Changelog-Geruest), danach die Highlights statt `TODO` in `src/js/changelog.js` eintragen. `tests/version.spec.js` prueft alle Stellen.
- **Tests sind deterministisch:** Zeit vergeht ueber `simulationsSchritt()` in einem `page.evaluate` oder ueber die Fake-Uhr aus `tests/helfer.js` (`installiereUhr`, `spuleVor`). `tests/regeln.spec.js` laesst die Zahl der Echtzeit-Wartezeiten je Datei nur sinken.
- **Testhelfer:** `setzeSpielstand(page)` aus `tests/helfer.js` vor `page.goto`; Versions-, Changelog- und Protokollwerte im Test aus dem Spielcode lesen (`GAME_VERSION`, `changelogData`, `PROTOKOLL_VERSION`).
- **README-Screenshot** nur ueber `npm run screenshot`. **Balancing-Messstand** `npm run balancing` (Bot-P2 je Schiff, geseedet, Ergebnisse git-ignoriert; Messlogik in `balancing/messung.js`, Rauchtest in `tests/messstand.spec.js`).

## Architektur
- **Game-Loop** (`loop.js`): feste 60-Hz-Schritte; `simulationsSchritt()` = `simuliere()` + `Anzeige.zeichneWelt()`, plant keinen Frame ein (Tests rufen ihn direkt). Weltlisten in `arrays` (`state.js`); `restartGame()` (`utils.js`) leert jede Liste, `tests/neustart.spec.js` prueft das fuer neue Listen.
- **Spielmodi:** `single` (400 px Feld, 1 Schiff), `coop` (600 px, 2 Schiffe, lokal oder Bot `state.p2IsBot`), `online` (600 px, WebRTC, Host simuliert).
- Modulliste, Kollisionen, Spielmodi im Detail: [docs/architektur.md](../docs/architektur.md).

## Anzeige-Schicht (vor jeder Aenderung an Weltobjekten, Effekten oder Zeichencode lesen: [docs/anzeige-schicht.md](../docs/anzeige-schicht.md))
- Spiellogik aendert bei Weltobjekten nur Modellfelder (`x`/`y` = linke obere Ecke, `rot` in Grad, Optik-Felder). Erzeugen ueber `arrays.X.push(Anzeige.erzeuge({...}, 'art'))`, entfernen ueber `Anzeige.entferne(obj)` vor dem `splice`.
- Nur das Backend (`anzeige-dom.js`, Elementbau in `anzeige-dom-objekte.js`) schreibt Position, Drehung, Deckkraft und Zustandsklassen ins DOM. Neue Weltlisten bekommen einen Eintrag in `ZEICHNER` (`anzeige-dom.js`).
- Spielerschiffe zeichnet `Anzeige.zeichneSpieler()` aus `state`/`state.p2`; Partikel nur ueber `erzeugePartikel({...})` (`partikel.js`); Effekte mit Lebensdauer ueber `erzeugeEffekt` (`effekte.js`).
- HUD, Menues, Hangar, Cutszene, Lobby und mobile Steuerung bleiben bewusst HTML.
- Waechtertests in `tests/anzeige.spec.js` pruefen die Trennung je Modul.

## Multiplayer (vor jeder Aenderung an `network.js`, `netzkodierung.js`, `client.js` oder am Snapshot lesen: [docs/multiplayer.md](../docs/multiplayer.md))
- Host ist autoritativ (Gegner, Bosse, Kollisionen, Powerups); der Client sagt nur das eigene Schiff voraus und sendet Eingaben.
- **Snapshot-Format:** `tests/protokoll.spec.js` haelt die Feldform von `serializeGameState()` je `PROTOKOLL_VERSION` in `tests/fixtures/protokoll.json` fest und prueft, dass `applyGameStateSnapshot()` jedes gesendete Feld liest. Bei einer Formataenderung `PROTOKOLL_VERSION` (`netzkodierung.js`) erhoehen und die Fixture neu schreiben (Befehl im Kopf des Tests).
- Ereignisse, die nur einen Spieler betreffen (Treffer-Flash, Sound), gehen nur an diesen Spieler. Cheatcodes sind online gesperrt.

## Waffen und Schiffe (vor jeder Aenderung an Waffen, Schiffen oder Bot-Verhalten lesen: [docs/schiffe.md](../docs/schiffe.md))
- Waffen leveln getrennt bis Stufe 5: Laser (L/B, Energie, Stufe 5 Hitscan), Raketen (K/V), Bombe (Leertaste/C, einzige Waffe gegen Magma), Superwaffe (S).
- Schiffe: `viper` (Viper-X, Rolle/Overdrive/Kill-Kombo, `viper.js`), `phantom` (Phantom-NX), `gleve` (Gleve-MR, Sweep und Dash, `gleve.js`), `sniper` (Spectre-SR, Fadenkreuz, Granaten, Minen, `sniper.js`). Sonderschiffe belegen dieselben Tasten und Stufen mit eigenen Waffen.
- Jede Schiffsfunktion braucht Bot-Logik (`bot.js`), Online-Sync (Snapshot + Client-Darstellung) und Tests fuer beide.

## Agent Bridge
Wenn der Sandboxed-Modus aktiv ist und `run_command` an Berechtigungen scheitert, laeuft die Kommunikation ueber `.agents/cmd_request.json` (`{"id": <increment>, "command": "..."}`) und `.agents/cmd_response.json`: Befehl schreiben, kurz warten, Antwort lesen.
