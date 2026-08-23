# 🚀 DOM-basierter Space Shooter (Starshooter)

Ein klassisches "Space Shooter"-Browserspiel, das komplett **ohne HTML5-Canvas** auskommt und stattdessen die performante Positionierung und Transformation von DOM-Elementen (via `CSS position: absolute`, `transform` und inline SVG-Grafiken) nutzt.

![Version](https://img.shields.io/badge/version-1.6.38-blue.svg)
![Playwright Tests](https://img.shields.io/badge/tests-111%20passing-brightgreen.svg)
![WebRTC Multiplayer](https://img.shields.io/badge/multiplayer-WebRTC%20P2P-orange.svg)

---

## 🎮 Spielmodi

### 1. Einzelspieler (1 SPIELER)
Kämpfe dich alleine durch endlose Wellen feindlicher Jäger, Asteroiden und gewaltiger Bosse. Weiche gegnerischem Beschuss aus, sammle Powerups und Splitter und sichere dir einen Platz in der Solo-Bestenliste.

### 2. Lokaler Koop (2 SPIELER CO-OP) & KI-Bot
- **Geteilte Tastatur:** Spiele gemeinsam mit einem Freund an einer Tastatur im verbreiterten 600px-Spielfeld.
- **KI-Bot Partner:** Kein Mitspieler zur Hand? Schalte im Hangar den intelligenten Bot-Partner (mit Schwierigkeitsgraden *Easy*, *Normal*, *Hard*) ein. Der Bot weicht eigenständig Gefahren aus, sammelt Powerups, unterstützt beim Bosskampf und hält Formation.
- **Dedicated Loot & Traktorstrahl:** Powerups spawnen spielergebunden. Sammelt ein Spieler das Powerup des Partners auf, wird es per Traktorstrahl hinterhergezogen und kann übergeben werden.
- **Revive-System:** Stirbt ein Spieler, kann der überlebende Partner durch das Besiegen eines Bosses den gefallenen Gefährten wiederbeleben.

### 3. Online-Multiplayer (2 SPIELER ONLINE - WebRTC P2P)
- **Serverlos & Dezentral:** Nutzt WebRTC DataChannels über dezentrale Broker (via Trystero). Keine Registrierung, kein Server nötig.
- **Raum-Code System:** Ein Spieler erstellt einen Raum und erhält einen 5-stelligen Raum-Code. Der Mitspieler gibt diesen Code ein und beide sind sofort verbunden.
- **Host/Client-Architektur:** Der Host simuliert Physik, Kollisionen und Gegner-Spawns, während der Client mit lokaler Client-Prediction verzögerungsfrei gesteuert wird.
- **Volle Solo-Steuerung:** Jeder Spieler nutzt an seinem eigenen PC oder Mobilgerät die vertraute Solo-Steuerung.
- **Synchronisation:**
  - Synchroner Cutszenen-Abbruch mit `ESC`.
  - Zielgerichtetes visuelles und akustisches Feedback (Schadens-Flash & Sound nur auf dem Rechner des getroffenen Spielers).
  - Gemeinsame Highscore-Eingabe (`AAA+BBB`) in die lokale 2-Spieler-Bestenliste beider Rechner.

---

## 🛸 Hangar: Schiffe, Farben & Perks

Im Hangar vor Spielbeginn wählt jeder Spieler sein Schiffsmodell und seine individuelle Farbvariante:

| Schiff | Rolle | Spezialfähigkeiten & Perks |
| :--- | :--- | :--- |
| **VIPER-X Interceptor** | Offensiver Abfangjäger | <ul><li>⚡ **Energie-Rückgewinnung:** +5 Energie bei jedem Feind-Abschuss</li><li>💎 **Splitter-Drops:** Jeder 10. Kill droppt Splitter für Extra-Leben oder Super-Waffen</li><li>⚠️ Verliert bei Hüllentreffern Waffen-Upgrades</li></ul> |
| **PHANTOM-NX Striker** | Taktischer Schildträger | <ul><li>🛡️ **Start-Schild:** Startet mit Schildstufe 2</li><li>🔄 **Schild-Regeneration:** Regeneriert automatisch Schild nach 15s ohne Treffer</li><li>🔒 **Upgrade-Sicherung:** Behält Waffenstufen auch bei Treffern</li></ul> |

---

## ⚔️ Waffensysteme (Getrenntes Leveln bis Stufe 5)

Das Schiff verfügt über drei unabhängige Waffensysteme, die durch Powerups (L, R, B) hochgelevelt werden:

1. **Laser (Taste 'L' / 'B'):** Primärwaffe mit automatischem Energiemanagement.
   - *Stufe 1–4:* Erhöht Projektilanzahl und Streuung (Parallel- und Diagonalschüsse).
   - *Stufe 5:* Automatischer, sofort treffender "Hitscan"-Laser auf das nächste Ziel über dem Schiff.
2. **Raketen (Taste 'K' / 'V'):** 
   - Proximity-Zünder mit Flächenschaden und 3-Phasen-Flugphysik samt Homing-Zielerfassung.
   - *Stufe 5:* Feuert 3 Raketen gefächert ab; Cooldown sinkt mit jedem Level.
3. **Bombe (Leertaste / Taste 'C'):** 
   - Strategische Waffe mit langer Abklingzeit.
   - Trudelt in die Bildschirmmitte und entfesselt eine massive, raumgreifende Schockwelle.
   - **Einzige Waffe**, die unzerstörbare Magma-Asteroiden aufbrechen kann.
4. **Super-Waffe (Powerup 'S' oder 10 weiße Splitter):**
   - Maxed alle Waffen sofort auf Stufe 5, gewährt Schild 3, unbegrenzte Energie und Laser-Durchschlag.

---

## 🕹️ Steuerung

### Desktop (Tastatur)

| Aktion | Solo & Online-Multiplayer | Koop: Spieler 1 | Koop: Spieler 2 |
| :--- | :--- | :--- | :--- |
| **Bewegung** | `W`, `A`, `S`, `D` oder Pfeiltasten | `W`, `A`, `S`, `D` | `↑`, `←`, `↓`, `→` |
| **Laser** | `L` oder `B` | `B` | `Ä` |
| **Raketen** | `K` oder `V` | `V` | `Ö` |
| **Bombe** | `Leertaste` oder `C` | `C` | `L` / `Enter` |
| **Pause** | `P` | `P` | `P` |
| **Sound Mute** | `M` | `M` | `M` |

### Mobilgeräte (Touch & Tablet)
- **Virtueller Joystick (linke Display-Hälfte):** Schiff steuern (Laser feuert bei Bewegung automatisch).
- **Aktions-Buttons (rechts unten):** Raketen und Bomben abfeuern.
- **Oberes Drittel des Spielfelds:** Spiel pausieren.

---

## 🛠️ Lokale Entwicklung & Ausführung

Da das Spiel modular auf ES6-Modulen (`<script type="module">`) basiert, wird ein lokaler Webserver benötigt:

```bash
# 1. Repository klonen
git clone https://github.com/the3ver/starshooter_web.git
cd starshooter_web

# 2. Lokalen Server starten
npx http-server src -p 8080 -c-1

# 3. Spiel im Browser öffnen
# http://localhost:8080
```

### Automatisierte Tests (Playwright)
```bash
# Alle 111 E2E-Tests ausführen
npx playwright test
```

---

## 🌐 Live-Demo
Das Spiel ist live spielbar unter: **[https://the3ver.github.io/starshooter_web/](https://the3ver.github.io/starshooter_web/)**