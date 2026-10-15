# Plan: Restliche Effekte in die Anzeige-Schicht verlagern

> Erledigt am 2026-10-15 (A1 bis A9 umgesetzt, nicht committet). Der Plan bleibt als Dokumentation stehen; der aktuelle Stand steht in `.agents/AGENTS.md`, Abschnitt "Anzeige-Schicht".

Stand: v1.15.4 (Commit `7b03faa`). Dieser Plan beschreibt die letzten Schritte, damit die Spiellogik nichts mehr in `#spielfeld` zeichnet. Er ist für einen Agenten geschrieben, der die Codebasis nicht kennt. Jede Aufgabe ist einzeln umsetzbar und endet mit grünen Tests.

## 1. Was schon erledigt ist (lesen vor dem Start)

- `.agents/AGENTS.md`, Abschnitt "Anzeige-Schicht (Vorbereitung fuer eine andere Engine)": Regeln, Modellfelder, Wächtertests.
- `src/js/anzeige.js`: Schnittstelle. Pflichtfunktionen eines Backends: `erzeuge(obj, art)`, `zeichneWelt()`, `zeichneSpieler()`, `entferne(obj)`, `blitze(obj, staerke)`.
- `src/js/anzeige-dom.js`: DOM-Backend. Tabellen `ZEICHNER` (je Liste in `arrays`) und `ZEICHNER_JE_ART` (je Objektart), `zeichneSchiff`, `zeichneStrahlen`.
- `src/js/anzeige-dom-objekte.js`: Elementbau je Art (`ERZEUGER`), SVG-Vorlagen.
- `src/js/loop.js`: `simulationsSchritt()` = `simuliere()` + `Anzeige.zeichneWelt()`. Der Online-Client läuft über `clientSchritt()` innerhalb von `simuliere()`, gezeichnet wird danach genauso.
- `tests/anzeige.spec.js`: Test-Backend, Zustandstests, Wächter (Regex über Quelltexte).

Grundregel: Logik ändert nur Modellfelder und ruft `Anzeige.*` auf. Elemente, `style`, `classList`, `createElement` und `appendChild` gibt es nur in `anzeige-dom.js` und `anzeige-dom-objekte.js`. HUD, Menüs, Cutszene, Lobby und mobile Steuerung bleiben bewusst HTML und sind nicht Teil dieses Plans.

## 2. Arbeitsregeln

1. Vor dem Start Baseline prüfen: `npx playwright test --reporter=line --retries=0` (erwartet: 441 passed, rund 30 s).
2. Nach jeder Aufgabe die volle Suite. Rot bleibt nicht liegen.
3. Bugfixes: erst einen Test, der ohne Fix rot ist, dann der Fix. Rot einmal nachweisen (Fix kurz zurücknehmen, Test laufen lassen, Fix wiederherstellen).
4. Bestehende Tests nicht aufweichen. Prüft ein Test das DOM direkt nach einem Logikaufruf ohne Simulationsschritt, gibt es zwei erlaubte Wege:
   - Das Ereignis zeichnet sofort (Muster: `Anzeige.zeichneSpieler()` nach `spielerGetroffen`), wenn das Spiel es bisher sofort gezeigt hat.
   - Der Test ruft vor dem Lesen `Anzeige.zeichneWelt()` auf und erklärt das im Kommentar (Muster: EMP-Test in `tests/sniper.spec.js`).
   Erwartungswerte nur ändern, wenn sich das Verhalten bewusst ändert, und das im Testkommentar begründen.
5. CSS-Klassen und Pixel-Positionierung der Elemente bleiben gleich. Viele Tests lesen `.sniper-fadenkreuz`, `.sniper-granate`, `.sniper-mine`, `.gleve-klinge`, `.schockwelle` (75 Treffer in `tests/sniper.spec.js`, 23 in `tests/online-client.spec.js`).
6. Zufallsreihenfolge (`Math.random`) nicht verändern. Der Balancing-Messstand (`npm run balancing`) seedet den Zufall.
7. Zeilenenden: `src/js/utils.js` liegt im Repo mit CRLF und endet ohne Zeilenumbruch auf `}\r`. Beim Stagen: `git add -u` und danach `git -c core.autocrlf=false add src/js/utils.js`. Vor dem Commit `git diff --cached --stat` prüfen. Mehr als ein paar hundert Zeilen pro Datei bedeuten ein Zeilenenden-Problem.
8. Version je Commit mit Funktionsänderung um eine Patch-Stufe erhöhen: `package.json`, `src/index.html` (`#version-anzeige`), `README.md` (Badge), `src/js/changelog.js` (`GAME_VERSION` plus neuer Eintrag in `changelogData`, kurz und für Spieler verständlich).
9. Online-Protokoll: Ändert sich ein Feld im Snapshot oder in einem Netz-Ereignis, `PROTOKOLL_VERSION` in `src/js/netzkodierung.js` erhöhen und die zwei fest prüfenden Tests anpassen (`tests/sniper.spec.js` "Protokollversion ist 14", `tests/online-client.spec.js` `expect(r.protokoll)`). Ziel dieses Plans ist, das Protokoll nicht zu ändern.
10. `.agents/AGENTS.md` nach jeder Aufgabe nachziehen (Abschnitt "Anzeige-Schicht", Liste "Noch direkt im DOM").
11. Commit und Push nur nach Freigabe durch den Nutzer.

## 3. Bestandsaufnahme (was noch direkt zeichnet)

| Stelle | Datei, Funktion | Art | Takt heute |
|---|---|---|---|
| Bomben-Schockwelle (plus zweite bei Stufe 3) | `utils.js` `erzeugeBombenDetonation` | Effekt | CSS-Transition und `setTimeout` (0,5 s / 0,4 s) |
| Raketen-Schockwelle | `utils.js` `erzeugeRaketenDetonation` | Effekt | CSS-Transition und `setTimeout` (0,3 s) |
| Boss-Bomben-Schockwelle | `boss.js` `aktualisiereBossBomben` (Element `boss-shockwave`) | Effekt | CSS und `setTimeout` (0,4 s) |
| Sniper-Strahl | `sniper.js` `erzeugeStrahl`, `aktualisiereStrahlen` (Liste `strahlen`) | Effekt | Schritte (`STRAHL_SCHRITTE` 8) |
| Granaten-Druckwelle, Minen-Explosion | `sniper.js` `erzeugeDruckwelle`, `aktualisiereWellen` (Liste `wellen`) | Effekt | Schritte (`WELLE_SCHRITTE` 14) |
| EMP-Ring | `sniper.js` `erzeugeEmpRing`, `aktualisiereEmps` (Liste `emps`) | Effekt | Schritte (`EMP_SCHRITTE`) |
| Granaten im Flug | `sniper.js` `werfeGranate`, `aktualisiereGranaten` (Liste `granaten`), Client `synchronisiereGranaten` (Liste `netzGranaten`) | Weltobjekt mit Spiellogik | Schritte |
| Haftminen | `sniper.js` `legeMine`, `zeigeMine`, `entferneMine` (`arrays.sniperMinen`), Client `synchronisiereMinen` (Liste `netzMinen`) | Weltobjekt mit Spiellogik | Schritte |
| Fadenkreuz und Ladering | `sniper.js` `holeFadenkreuz`, `zeigeFadenkreuz`, `zeigeLadering`, `entferneFadenkreuz` | Anzeige am Spieler | jeder Schritt |
| Gleve-Klinge | `gleve.js` `zeigeKlinge`, `entferneKlinge` (Objekt `klingen`) | Anzeige am Spieler | jeder Schritt |
| Bildschirm-Blitz | `utils.js` `spielerGetroffen` (4 Stellen), `powerups.js` `wendePowerupAn`, `network.js` Ereignisse `player_hit` und `powerup_collected` | Ereignis | `setTimeout` |
| Sterne erzeugen | `main.js` (Schleife um Zeile 50, `dom.spielfeld.appendChild(stern)`) | Weltobjekt | einmalig |

Wichtig: `sniper.js` prüft an vier Stellen `!el.isConnected`, um Effekte zu beenden, wenn ihr Element von außen entfernt wurde. Diese Abhängigkeit der Logik vom DOM fällt mit dem Umbau weg (Ablauf nur über `rest`).

## 4. Zielbild

Drei Muster, alle schon im Code vorhanden oder direkt daraus abgeleitet:

1. **Effekte mit Lebensdauer** (Schockwellen, Druckwellen, EMP, Sniper-Strahl): eine neue Liste `arrays.effekte`. Jeder Eintrag ist ein reines Modell `{ art, x, y, rest, dauer, ... }`. Die Logik zählt `rest` pro Schritt herunter und entfernt den Eintrag bei 0. Das Backend berechnet Größe und Deckkraft aus `t = 1 - rest / dauer`. Damit laufen alle Effekte im Simulationstakt: Sie frieren in Pause und Game Over ein, wie die übrige Welt, und sind in Tests deterministisch.
2. **Weltobjekte mit Spiellogik** (Granaten, Minen): Listen in `arrays` wie Feinde oder Laser, Erzeugen über `Anzeige.erzeuge(obj, art)`, Zeichnen über `ZEICHNER`. Der Online-Client legt dieselben Modelle aus dem Snapshot an (Muster `synchronisiereListe` in `network.js`).
3. **Anzeigen am Spieler** (Fadenkreuz, Gleve-Klinge): kommen in `zeichneSchiff` in `anzeige-dom.js` dazu, wie das Hack-Label. Sichtbarkeit und Maße leitet das Backend aus dem Spielerzustand ab.

Einmalige Ereignisse ohne Modell (Bildschirm-Blitz) bekommen eine Funktion in der Schnittstelle, wie `Anzeige.blitze`.

## 5. Aufgaben

Reihenfolge einhalten: A1 legt das Effekt-Muster an, A2 bis A4 bauen darauf auf.

### A1: Effekt-Liste und Detonations-Schockwellen

Ziel: `arrays.effekte`, Taktung im Spielschritt, Bomben-, Raketen- und Boss-Schockwellen als Effekte.

Schritte:
1. `src/js/state.js`: in `arrays` die Liste `effekte: []` ergänzen.
2. Neues Modul `src/js/effekte.js` (kein DOM):
   - `erzeugeEffekt(daten)`: setzt `dauer = daten.rest`, legt den Eintrag über `Anzeige.erzeuge(eintrag, 'effekt')` an und hängt ihn an `arrays.effekte`.
   - `aktualisiereEffekte()`: für jeden Eintrag `rest--`, bei `rest <= 0` `Anzeige.entferne(e)` und aus der Liste nehmen.
   - `entferneEffekte(filter)`: alle oder nach `pKey` entfernen (für Game Over und `Sniper.setzeZurueck`).
3. `src/js/loop.js` `simuliere()`: `aktualisiereEffekte()` im Hauptzweig direkt nach `animierenPartikel()`. Zusätzlich im Zweig `state.gameOverAktiv` nicht aufrufen (Effekte frieren ein, siehe 4). `src/js/client.js` `clientSchritt()`: `aktualisiereEffekte()` nach `animierenPartikel()`.
4. `src/js/utils.js` `restartGame`: `arrays.effekte` über die vorhandene `clearArray`-Hilfe leeren (Zeile mit `clearArray(arrays.partikelArray)`). `entferneGleveEffekte` (Game Over): `entferneEffekte()` aufrufen, damit keine eingefrorenen Ringe stehen bleiben.
5. Arten und Felder festlegen (in `anzeige.js` dokumentieren):
   - `bombenWelle`: `x`, `y` (Mitte), `radius`, `farbe`; Dauer 30 Schritte (entspricht 0,5 s). Aussehen wie bisher: Kreis `radius * 2`, Hintergrund nach Farbe (die vier `rgba`-Werte aus `erzeugeBombenDetonation` übernehmen), `box-shadow 0 0 45px farbe`, `z-index 9`. Animation: Skalierung 1 bis 1,2 und Deckkraft 1 bis 0 über `t`.
   - `bombenWelle2` (Stufe 3, nicht Mini): `radius * 0.75`, Farbe `rgba(155, 89, 182, 0.3)`, Schatten `#9b59b6`, Dauer 24 Schritte, Skalierung bis 1,3. Bisher startet sie 150 ms später: als Effekt mit `verzoegerung: 9` Schritten anlegen (unsichtbar, solange `dauer - rest < verzoegerung`), damit kein `setTimeout` bleibt.
   - `raketenWelle`: Klasse `schockwelle` (Test `tests/raketen.spec.js` sucht sie), `rgba(231, 76, 60, 0.4)`, Schatten `0 0 20px #e74c3c`, Dauer 18 Schritte, Skalierung bis 1,2.
   - `bossWelle`: Klasse `boss-shockwave`, Werte aus `boss.js` übernehmen, Dauer 24 Schritte.
6. `src/js/anzeige-dom-objekte.js`: `ERZEUGER.effekt` baut das Element je `art` (Klassen und feste Styles). `src/js/anzeige-dom.js`: Zeichner `zeichneEffekt` (Position aus Mitte und aktueller Größe, `transform: scale(...)`, `opacity`), in `ZEICHNER` unter `effekte` und in `ZEICHNER_JE_ART` unter `effekt` eintragen.
7. `utils.js` `erzeugeBombenDetonation` und `erzeugeRaketenDetonation`: Element- und `setTimeout`-Teile durch `erzeugeEffekt(...)` ersetzen. Partikel und Sound bleiben. Die Funktionen werden auch beim Online-Client über Netz-Ereignisse aufgerufen (`network.js`, Ereignisse `bomb_detonated` und `missile_detonated`), das funktioniert danach ohne Änderung, weil `clientSchritt` die Effekte taktet.
8. `boss.js` `aktualisiereBossBomben`: Element `sw` durch `erzeugeEffekt({ art: 'bossWelle', ... })` ersetzen.

Tests (in `tests/anzeige.spec.js`):
- Test-Backend: `erzeugeBombenDetonation` ruft `erzeuge(..., 'effekt')` auf, kein neues Kind in `#spielfeld`.
- Effekt läuft nach `dauer` Schritten ab (`arrays.effekte` leer, Element weg), in Pause nicht.
- Stufe-3-Bombe erzeugt zwei Effekte, der zweite ist in den ersten 9 Schritten unsichtbar.
- Bestehende Tests zu `.schockwelle` müssen grün bleiben; prüft einer die Transition-Zeit, Erwartung auf Schritte umstellen und begründen.

Risiko: Schockwellen frieren jetzt in der Pause ein (bisher liefen sie per CSS weiter). Das ist gewollt, im Changelog nicht erwähnen.

### A2: Sniper-Effekte (Strahl, Druckwelle, EMP-Ring, Minen-Explosion)

Ziel: Listen `strahlen`, `wellen`, `emps` in `sniper.js` entfallen, alles über `arrays.effekte`.

Schritte:
1. Arten anlegen:
   - `sniperStrahl`: `x`, `y` (Schiffsnase), `laenge`, `winkel` (Grad), `breite`, `glow` (0..1 = Ladeanteil), `farbe`, Dauer `STRAHL_SCHRITTE`. Element: Klasse `sniper-strahl`, Styles wie in `erzeugeStrahl` (Höhe = Länge, `top = y - laenge`, `left = x - breite / 2`, `rotate(winkel)`, dreifacher `box-shadow` aus `glow`). Deckkraft `rest / dauer` wie in `aktualisiereStrahlen`.
   - `sniperDruckwelle` und `sniperMinenExplosion` (gleiche Mathematik, Klassen `sniper-druckwelle` bzw. `sniper-mine-explosion`): `x`, `y`, `radius`, Dauer `WELLE_SCHRITTE`, Durchmesser `radius * 2 * Math.sqrt(t)`, Deckkraft `1 - t * 0.85`.
   - `sniperEmp`: Klasse `sniper-emp`, Durchmesser `radius * 2 * t`, Deckkraft `1 - t * 0.8`, Dauer `EMP_SCHRITTE`.
   - Alle mit `pKey`, damit `Sniper.setzeZurueck(pState)` nur die Effekte dieses Spielers entfernt.
2. `sniper.js`: `erzeugeStrahl`, `erzeugeDruckwelle`, `erzeugeEmpRing` rufen `erzeugeEffekt` auf. `aktualisiereStrahlen`, `aktualisiereWellen`, `aktualisiereEmps` und die Listen `strahlen`, `wellen`, `emps` löschen, ebenso ihre Aufrufe in `aktualisiereSniper` und `Sniper.clientSchritt`. `entferneGranatenEffekte` und `entferneEffekte` nutzen `entferneEffekte(pKey)` aus `effekte.js`.
3. Achtung Takt: Heute laufen diese Effekte nur, solange `aktualisiereSniper` für ein Sniper-Schiff aufgerufen wird. Mit `arrays.effekte` laufen sie immer. Das ist korrekt, kann aber Tests betreffen, die Schritte zählen. Die Reihenfolge im Schritt beachten: bisher wurde in `aktualisiereSniper` (Energie-Phase in `spieler.js`) heruntergezählt, künftig nach den Partikeln. Weicht ein Test um einen Schritt ab, prüfen, ob die neue Reihenfolge stimmt (ein Effekt, der im Schritt N entsteht, zeigt im selben Schritt `t = 0`), und nur dann die Erwartung anpassen.

Tests: `tests/sniper.spec.js` und `tests/online-client.spec.js` müssen ohne Änderung grün bleiben, Ausnahmen nach Regel 4. Neuer Test in `tests/anzeige.spec.js`: Strahl, Druckwelle und EMP erscheinen über das Test-Backend als `effekt`.

### A3: Sniper-Granaten als Weltobjekte

Ziel: `granaten` und `netzGranaten` werden `arrays.sniperGranaten`.

Schritte:
1. `state.js`: `sniperGranaten: []` in `arrays`.
2. `sniper.js` `werfeGranate`: Modell wie heute (`id`, `pKey`, `x`, `y`, `startX`, `startY`, `zielX`, `zielY`, `rest`, `rot`, `werte`), anlegen mit `arrays.sniperGranaten.push(Anzeige.erzeuge(g, 'sniperGranate'))`.
3. `aktualisiereGranaten`: nur Modell (`x`, `y`, `rot`), Ablauf nur über `rest` (kein `isConnected`). Entfernen mit `Anzeige.entferne(g)`.
4. Zeichner `sniperGranate`: Klasse `sniper-granate`, `left = x - 7`, `top = y - 7`, `rotate(rot)`. In `ZEICHNER` (`sniperGranaten`) und `ZEICHNER_JE_ART` eintragen.
5. Snapshot unverändert lassen: `netzGranatenListe()` liest aus `arrays.sniperGranaten` und liefert dieselben Felder (`id`, `x`, `y`, `owner`, `rest`).
6. Client `synchronisiereGranaten`: Modelle in `arrays.sniperGranaten` anlegen, aktualisieren und entfernen (wie `synchronisiereListe` in `network.js`), `rot = (GRANATE_FLUG - rest) * 24`. Die Liste `netzGranaten` entfällt. Auf dem Client läuft `aktualisiereGranaten` nicht, die Liste gehört dort allein dem Snapshot.
7. `entferneGranatenEffekte` und `restartGame`: `arrays.sniperGranaten` leeren (nach `pKey` gefiltert, wo nötig).

Tests: Block "Spectre-SR Granate" in `tests/sniper.spec.js` und Granaten-Tests in `tests/online-client.spec.js` müssen grün bleiben. Wächter erweitern: `sniper.js` enthält kein `createElement` mehr für Granaten.

### A4: Haftminen über die Anzeige

Ziel: `arrays.sniperMinen` wird wie andere Listen gezeichnet, `netzMinen` entfällt.

Schritte:
1. Modellfelder `haftet` (Boolean) und `blinkt` (Boolean) auf Host und Client gleich: Host setzt sie in `aktualisiereMinen` aus `!!m.ziel` und `!m.ziel && m.rest <= MINE_BLINK`, Client übernimmt sie aus dem Snapshot.
2. `legeMine`: `Anzeige.erzeuge(m, 'sniperMine')`. `zeigeMine` löschen. `entferneMine` mit `Anzeige.entferne(m)`.
3. Zeichner `sniperMine`: Klassen `sniper-mine` und `sniper-mine-<pKey>`, Position `x - MINE_GROESSE / 2`, `y - MINE_GROESSE / 2`, Klassen `haftet` und `blinkt` aus dem Modell. `MINE_GROESSE` aus `sniper.js` exportieren.
4. Client `synchronisiereMinen`: Modelle direkt in `arrays.sniperMinen` (der Host-Teil von `aktualisiereMinen` läuft auf dem Client nicht). Töne (`playMineLegen`, `playMinePiep`) bleiben in der Logik.
5. `netzMinenListe()` liefert dieselben Felder wie heute.

Tests: Blöcke "Spectre-SR Haftminen", "Bot: Minen", "Haftminen online (Host)" in `tests/sniper.spec.js` und die Minen-Darstellung in `tests/online-client.spec.js`.

### A5: Fadenkreuz und Ladering in `zeichneSchiff`

Ziel: Fadenkreuz kommt aus dem Spielerzustand, `fadenkreuze`, `holeFadenkreuz`, `zeigeFadenkreuz`, `zeigeLadering`, `entferneFadenkreuz` entfallen in `sniper.js`.

Schritte:
1. In `sniper.js` exportieren, was das Backend braucht: `ladeAnteil` (bisher nicht exportiert). `trefferRadius`, `radiusFaktor`, `istVoll`, `istSniper` und `LADEN_AB` sind schon exportiert.
2. `anzeige-dom.js`: `zeichneFadenkreuz(s, pKey)` in `zeichneSchiff` aufrufen. Sichtbar, wenn `istSniper(s) && !s.isDead && state.spielLaeuft && s.sniperZielX != null`, sonst Element entfernen oder ausblenden. Aufbau und Styles 1:1 aus `holeFadenkreuz`, `zeigeFadenkreuz` und `zeigeLadering` übernehmen (Klassen `sniper-fadenkreuz`, `sniper-fadenkreuz-<pKey>`, vier `i.sniper-strich`, `.sniper-ladering` mit Klasse `voll`).
3. `sniper.js`: Aufrufe von `zeigeFadenkreuz` und `entferneFadenkreuz` entfernen. In `uebernehmeSnapshot` (Client) bleiben nur die Felder. `setzeZurueck` setzt `sniperZielX = null`, das blendet das Fadenkreuz aus.
4. Sofort sichtbar machen, wo Tests es ohne Schritt prüfen: nach Regel 4 vorgehen.

Tests: Fadenkreuz-Tests in `tests/sniper.spec.js` (Position, Radius je Stufe, Auto-Zielen, Ladering) und `tests/online-client.spec.js`. Neuer Test in `tests/anzeige.spec.js`: Fadenkreuz aus Zustandsfeldern, verschwindet bei `isDead`.

### A6: Gleve-Klinge in `zeichneSchiff`

Ziel: `klingen`, `zeigeKlinge`, `entferneKlinge` in `gleve.js` entfallen.

Schritte:
1. In `gleve.js` `sweepUrsprung` exportieren (bisher intern). `istSweepAktiv` und `sweepLaenge` sind schon exportiert.
2. `anzeige-dom.js`: `zeichneKlinge(s, pKey)` in `zeichneSchiff`. Sichtbar bei `istGleve(s) && !s.isDead && istSweepAktiv(s)`. Styles 1:1 aus `zeigeKlinge` (Klasse `gleve-klinge`, Höhe, Position, `box-shadow`, `border-color`, `border-radius` nach `gleveSweepRichtung`, `rotate(gleveSweepWinkel)`). Schiffsfarbe über `shipColors[s.selectedShipColor].prim`.
3. `gleve.js`: alle Aufrufe von `zeigeKlinge` und `entferneKlinge` entfernen (Zeilen um 459, 465, 469, 573, 594, 700, 704). Game Over: `entferneGleveEffekte` in `utils.js` entfernt heute `.gleve-klinge` per `querySelectorAll`. Stattdessen `gleveSweepTimer = 0` für beide Spieler setzen (wie dort schon für Dash und Rolle) und `Anzeige.zeichneSpieler()` aufrufen.

Tests: Sweep-Tests in `tests/gleve.spec.js` (u. a. "Game Over während Sweep und Dash räumt Klinge und Dash-Darstellung ab") und der Klingen-Test in `tests/online-client.spec.js`.

### A7: Bildschirm-Blitz

Ziel: kein `dom.spielfeld.style.backgroundColor` mehr in der Logik.

Schritte:
1. Schnittstelle `Anzeige.blitzeSpielfeld(farbe, ms)` (Pflichtfunktion im Backend, in `setzeBackend` prüfen). DOM-Backend: Hintergrundfarbe setzen, nach `ms` auf `#0b1319` zurück.
2. Ersetzen: `utils.js` `spielerGetroffen` (vier Stellen: Schildtreffer `rgba(52, 152, 219, 0.3)`, Treffer `#900`, je P1 und P2, Dauer wie im jeweiligen `setTimeout`), `powerups.js` `wendePowerupAn`, `network.js` Ereignisse `player_hit` und `powerup_collected`.
3. Test-Backends in `tests/anzeige.spec.js` um `blitzeSpielfeld` ergänzen. Der Test "setzeBackend lehnt ein Backend ohne Pflichtfunktionen ab" prüft die Liste automatisch über das Objekt `voll`, dort den Namen ergänzen.

Tests: `tests/game.spec.js` liest `spielfeld.style.backgroundColor` (Suche nach `hostBgAfterP2Hit`), muss grün bleiben.

### A8: Sterne über die Anzeige erzeugen

Schritte:
1. `main.js`: Stern-Modell `{ x, y, groesse, speed }` (Zufallsreihenfolge wie heute: `x`, `y`, `size`, `speed`), anlegen mit `arrays.sterne.push(Anzeige.erzeuge(stern, 'stern'))`.
2. `ERZEUGER.stern`: Klasse `stern`, Breite und Höhe aus `groesse`. `ZEICHNER_JE_ART.stern = setzePosition`.

### A9: Abnahme

1. Globaler Wächter in `tests/anzeige.spec.js`: In `gegner.js`, `boss.js`, `waffen.js`, `powerups.js`, `partikel.js`, `gleve.js`, `sniper.js`, `viper.js`, `hack.js`, `entities.js`, `spieler.js`, `client.js`, `loop.js`, `effekte.js` kommen `document.createElement`, `dom.spielfeld` und `.isConnected` nicht vor. HUD-Zugriffe über `document.getElementById` auf HUD-Elemente bleiben erlaubt.
2. Null-Backend-Test: ein Backend, das alle Pflichtfunktionen als leere Funktionen hat. Damit ein Spiel starten (`state.spielLaeuft = true`, Level 3, Gleve als P1, Sniper als Bot-P2 im Coop) und 600 Schritte mit `simulationsSchritt()` laufen lassen, dazu Boss, Granaten, Minen und Bomben auslösen. Erwartung: keine Exception, und `#spielfeld` hat danach keine neuen Kinder gegenüber dem Start (Kinder vorher zählen, nachher vergleichen). Das ist der Nachweis, dass ein anderes Backend genügt.
3. `.agents/AGENTS.md`: Liste "Noch direkt im DOM" auf das reduzieren, was bewusst HTML bleibt (HUD, Menüs, Cutszene, Lobby, mobile Steuerung). Abschnitt um `arrays.effekte`, `effekte.js`, die neuen Arten und `blitzeSpielfeld` ergänzen. Diese Plan-Datei danach löschen oder als erledigt markieren.

## 6. Prüfliste je Aufgabe

- Volle Suite grün, ohne Wiederholungen (`--retries=0`).
- Kein `createElement`, `appendChild`, `.style.` oder `classList` in den geänderten Logikmodulen für Weltinhalte (HUD ausgenommen).
- `git diff --stat` ohne Zeilenenden-Ausreißer.
- Version, Changelog, `AGENTS.md` nachgezogen.
- Kurz selbst spielen: `npm run dev`, http://localhost:8080, je Aufgabe den betroffenen Effekt ansehen (Sniper: Hangar `SPECTRE-SR`; Gleve: `GLEVE-MR`; Bomben: Leertaste; Cheatcodes für schnelle Stufen siehe `src/js/input.js`, Abschnitt Cheat-Erkennung).
