# Review-Regeln

Regeln fuer den Review-Subagenten (`.claude/agents/reviewer.md`). Er liest den Diff erst, wenn `npm run check` gruen ist: Format, Lint, Typen, Tests und die Waechtertests sind dann schon erledigt. Jede Regel nennt, was nur ein Urteil pruefen kann, und den Beleg aus der Historie.

## R1 Code auf Englisch
Bezeichner, Dateinamen, Kommentare, Testtitel, `expect`-Meldungen, Konsolen-, Fehler-, Skript- und Hook-Ausgaben sind englisch, ebenso Datenwerte, die nur als String vorkommen (Phasen, Ereignistypen, Sound-Namen, Partikelsorten).
Deutsch bleiben: Spieltexte (UI, Changelog-Highlights), DOM-IDs und CSS-Klassen samt ihrer Selektoren, localStorage-Schluessel, Fehlertexte und Felder der Worker-API/D1 samt ihren Test-Mocks, Cloudflare-Variablen (`TURN_MONATSLIMIT_GB` u. a.), das Handschlag-Ereignis `'hallo'`, die Doku in `docs/`, `AGENTS.md` und die Agent-Definitionen in `.claude/agents/`.
Beleg: Umstellung 2026-11-21 (`b2d8808`, `81928a8`, `bddfd05`, `134d294`).

## R2 Anzeige-Schicht
Spiellogik aendert nur Modellfelder; DOM schreibt nur das Backend (`display-dom.js`, `display-dom-objects.js`). Ein neues Logikmodul steht in der Waechterliste von `tests/display-rules.spec.js`, eine neue Weltliste hat einen `DRAWER`-Eintrag. Details: `docs/anzeige-schicht.md`.

## R3 Online-Vollstaendigkeit
Jedes neue Zustandsfeld oder Ereignis hat: Senden (Snapshot oder Event), Uebernehmen und Darstellen beim Client, `PROTOCOL_VERSION` erhoeht und Fixture neu (wenn die Snapshot-Form sich aendert). Ereignisse, die einen Spieler betreffen (Treffer-Flash, Sound), gehen nur an diesen. Details: `docs/multiplayer.md`.
Beleg: Fix-Kette in `network.js` (`b024ce4`, `1def39a`, `3e326cc`, `f108641`).

## R4 Co-op-Spiegel
Spielerlogik arbeitet mit `pState`/`pKey`. P2 hat jede Spielerfunktion mit eigener Taste, eigenem HUD und eigenem Cooldown; Zaehler und Timer liegen je Spieler.
Beleg: `58397c5`, `32e5b76`, `e89ba6f`.

## R5 Schiffsfunktion komplett
Eine neue oder geaenderte Schiffsfunktion hat Bot-Logik (`bot.js`), Online-Sync, Tests fuer beides und eine Bedienung per Tastatur und per Touch (`#mobile-controls`). Details: `docs/schiffe.md`.

## R6 Neustart raeumt auf
Neuer Zustand ausserhalb von `state`/`arrays` wird in `restartGame()` zurueckgesetzt; ein Eintrag in `MODULE_STATUS` (`tests/rules.spec.js`) traegt einen Grund, der stimmt. Klassen, die das Spiel auf Elementen ausser `body` und `#spielfeld` setzt, verschwinden beim Neustart.
Beleg: `afd5d90`, `5522e68`, `b6a55cb`, `642b082`.

## R7 Tests pruefen Verhalten
Neue Tests liegen mit ihren Werten nah an der Grenze, die sie behaupten (0,5 px innen/aussen statt "weit drin"), lesen Ergebnisse des Spielcodes statt selbst gesetzter Werte, und neue Waechter oder Regeln haben eine dokumentierte Gegenprobe (Commit-Text oder Kommentar: mit dem Fehler rot).
Beleg: Hitbox-Test mit 22 % Spielraum, Co-op-Beutewechsel ungetestet (Mutationsstichprobe 2026-11-21).

## R8 Tests deterministisch
Zeit vergeht nur ueber `simulationStep()` oder die Fake-Uhr, Zufall ist geseedet, Layout wird im eingeschwungenen Zustand gemessen (endliche Animationen abgewartet), und ein Test leert alle Listen, die zwischen `beforeEach` und Test in Echtzeit gefuellt werden.
Beleg: Flakes 2026-11-21 (`bc98602`, `1631b00`, `182b259`, `c11fa53`).

## R9 Externe Strings escapen
Werte aus API oder Netz gehen nur escaped in `innerHTML`.
Beleg: Review-Funde `257e4f8`.

## R10 Version und Changelog
Eine Aenderung an Spiel-Logik oder UI hat einen Versionssprung (`npm run release`) und Highlights auf Deutsch fuer Spieler, ohne interne Details; eine Protokollaenderung nennt das Highlight (gemeinsames Spielen nur mit gleicher Version).

## R11 Commits getrennt
Refactor ohne Verhaltensaenderung und Verhaltensaenderung liegen in getrennten Commits; ein Bugfix-Commit enthaelt den Test, der vorher rot war.
