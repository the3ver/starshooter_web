export const GAME_VERSION = '1.6.38';

export const changelogData = {
  '1.6.38': {
    version: '1.6.38',
    intro: 'Hey, es ist jetzt Version 1.6.38 rausgekommen, folgendes wurde behoben:',
    highlights: [
      '📱 Touch-Steuerung im Menü gefixt: Beim Antippen von Modus-Buttons (Co-op / Online), Hangar-Schiffswahl oder Farb-Buttons auf Tablets und Smartphones startet das Spiel nicht mehr versehentlich'
    ]
  },
  '1.6.37': {
    version: '1.6.37',
    intro: 'Hey, es ist jetzt Version 1.6.37 rausgekommen, folgendes wurde behoben:',
    highlights: [
      '🎨 Online-Lobby Layout optimiert: Das Raumcode-Eingabefeld wurde kompakt auf 5 Zeichen angepasst und der Beitreten-Button schließt sauber bündig ohne Überstand ab'
    ]
  },
  '1.6.36': {
    version: '1.6.36',
    intro: 'Hey, es ist jetzt Version 1.6.36 rausgekommen, folgendes wurde behoben:',
    highlights: [
      '🛡️ Cheatcodes im Online-Coop deaktiviert: Cheatcodes wie idkfa oder idgod sind im Online-Multiplayer-Modus für fairen Wettkampf komplett deaktiviert'
    ]
  },
  '1.6.35': {
    version: '1.6.35',
    intro: 'Hey, es ist jetzt Version 1.6.35 rausgekommen, folgendes wurde behoben:',
    highlights: [
      '🏆 Gemeinsame Online-Highscores: Nach einem Remote-Coop geben beide Spieler ihr Kürzel ein – sobald beide bestätigt haben, wird das Team (z. B. AAA+BBB) automatisch in die Coop-Bestenliste auf beiden Rechnern eingetragen'
    ]
  },
  '1.6.34': {
    version: '1.6.34',
    intro: 'Hey, es ist jetzt Version 1.6.34 rausgekommen, folgendes wurde behoben:',
    highlights: [
      '⚡ Zielgerichteter Schadens-Flash im Online-Modus: Der rote Treffer-Flash (und blaue Schild-Flash) wird jetzt nur noch auf dem Bildschirm des Spielers angezeigt, der tatsächlich getroffen wurde',
      '🎬 Synchrones Überspringen der Cutszene: Wenn einer der beiden Spieler im Online-Raum ESC oder Überspringen drückt, wird die Intro-Cutszene für beide Spieler nahtlos beendet und das Spiel startet synchron'
    ]
  },
  '1.6.33': {
    version: '1.6.33',
    intro: 'Hey, es ist jetzt Version 1.6.33 rausgekommen, folgendes wurde behoben:',
    highlights: [
      '🎮 Einheitliche Solo-Steuerung im Online-Modus: Jeder Spieler (Host & Client) nutzt an seinem eigenen PC die vertraute Solo-Steuerung (WASD/Pfeile, L/B für Laser, K/V für Raketen, Leertaste/C für Bomben)',
      '🌐 Getrennte Tastatur-Zuweisung: Die geteilte Tastaturbelegung (Ä/Ö) bleibt exklusiv für den lokalen Couch-Koop erhalten'
    ]
  },
  '1.6.32': {
    version: '1.6.32',
    intro: 'Hey, es ist jetzt Version 1.6.32 rausgekommen, folgendes wurde behoben:',
    highlights: [
      '🔥 Boss-Projektile synchronisiert: Boss-Laser, zielsuchende Boss-Raketen und pulsierende Boss-Bomben werden nun vollständig und in Echtzeit auf dem Client gerendert',
      '💎 Powerup-Optik & Owner-Tags: Powerups von Spieler 1 & 2 besitzen auf allen Clients die volle Farbbrillanz, Glow-Effekte und Fraktions-Badges',
      '🌋 Magma-Asteroiden Synchronisation: Zerstörbare und unzerstörbare Magma-Asteroiden werden mit ihren exakten Texturen, Rissen und Schutzklassen auf Clients übertragen'
    ]
  },
  '1.6.31': {
    version: '1.6.31',
    intro: 'Hey, es ist jetzt Version 1.6.31 rausgekommen, folgendes wurde behoben:',
    highlights: [
      '🚀 Vollständiges Online-Visual-Sync: Asteroiden (mit Polygon-Clips), Gegner (mit Schiff-SVGs), Bosse, Laserstrahlen und Projektile werden nun vollständig und in Echtzeit auf allen Clients gerendert',
      '🎮 Lokale Client-Prädiktion: Spieler 2 steuert sein Schiff auf dem Client sofort latenzfrei via Tastatur oder Joystick'
    ]
  },
  '1.6.30': {
    version: '1.6.30',
    intro: 'Hey, es ist jetzt Version 1.6.30 rausgekommen, folgendes wurde behoben:',
    highlights: [
      '🛠️ Trystero API-Kompatibilität: Action- und Event-Handling für moderne und abwärtskompatible WebRTC-Objektstrukturen optimiert'
    ]
  },
  '1.6.29': {
    version: '1.6.29',
    intro: 'Hey, es ist jetzt Version 1.6.29 rausgekommen, folgendes wurde behoben:',
    highlights: [
      '🔌 Modernes WebRTC CDN: Trystero-Import auf das moderne @trystero-p2p/torrent & nostr Scope aktualisiert, um CDN-Deprecation-Warnungen zu beheben'
    ]
  },
  '1.6.28': {
    version: '1.6.28',
    intro: 'Hey, es ist jetzt Version 1.6.28 rausgekommen, folgendes wurde hinzugefügt:',
    highlights: [
      '🌐 Serverless Online-Multiplayer: Spiele remote zu zweit per WebRTC (P2P) — erstelle einfach einen Raumcode oder trete einem bestehenden Raum bei!',
      '📡 Echtes P2P-Netcode: Direkte Browser-zu-Browser Kommunikation mit minimaler Latenz und stabiler Synchronisation von Gegnern, Bossen und Drops'
    ]
  },
  '1.6.27': {
    version: '1.6.27',
    intro: 'Hey, es ist jetzt Version 1.6.27 rausgekommen, folgendes wurde verbessert:',
    highlights: [
      '🎯 Menschlichere Bot-Taktik: Der Bot hält nun diszipliniert die Grundlinie im unteren Viertel des Spielfelds und beschießt Feinde sowie Bosse gezielt und sicher aus der Distanz',
      '🚀 Weitreichendes Raketenfeuer: Der Bot zündet zielsuchende Raketen auf Bosse und Feinde auch über größere Entfernungen'
    ]
  },
  '1.6.26': {
    version: '1.6.26',
    intro: 'Hey, es ist jetzt Version 1.6.26 rausgekommen, folgendes wurde behoben:',
    highlights: [
      '🕹️ Fix für Spieler 1 Steuerung: Nach einem Game Over im 2-Spieler Modus lässt sich Spieler 1 nach dem Neustart nun wieder wie gewohnt mit voller Kontrolle steuern'
    ]
  },
  '1.6.25': {
    version: '1.6.25',
    intro: 'Hey, es ist jetzt Version 1.6.25 rausgekommen, folgendes wurde hinzugefügt und verbessert:',
    highlights: [
      '🤖 KI Bot-Partner im 2-Spieler Co-op: Spieler 2 kann nun komplett vom Computer gesteuert werden — inklusive eigenständigem Ausweichen, Powerup-Sammeln und Angreifen!',
      '⚙️ 3 Bot-Schwierigkeitsgrade: Wähle im Hangar zwischen EASY, NORMAL und HARD für feinjustierte Reaktionszeiten und Zielpräzision',
      '💥 Taktischer Waffen-Einsatz: Der Bot feuert Laser und Raketen zielsicher ab und zündet Bomben bei großen Feindansammlungen'
    ]
  },
  '1.6.24': {
    version: '1.6.24',
    intro: 'Hey, es ist jetzt Version 1.6.24 rausgekommen, folgendes wurde verbessert:',
    highlights: [
      '🚀 Raketen-Balancing im 2-Spieler Co-op: Höhere Maximalgeschwindigkeit (15 statt 13), stärkere Beschleunigung und präziseres Homing auf dem breiterem 600px-Spielfeld',
      '🎯 Größerer Homing-Suchbereich im Co-op: Zielsuchende Raketen erfassen Feinde mit einem 200px-Radius (statt 140px im Solo-Modus)',
      '↩️ Stärkere Lenkrate im Co-op: Raketen kurven flotter und treffen Ziele auch am weit entfernten Rand des Spielfelds'
    ]
  },
  '1.6.23': {
    version: '1.6.23',
    intro: 'Hey, es ist jetzt Version 1.6.23 rausgekommen, folgendes wurde verbessert:',
    highlights: [
      '💎 Kristalline Splitter-Optik: Splitter erscheinen nun als spitze, leuchtend pulsierende Dreieckskristalle ohne Buchstaben',
      '🎯 Garantierte Droprate: Exakt jeder 10. vom Viper zerstörte Feind hinterlässt einen garantierten Splitter-Drop (Rot oder Weiß)',
      '✨ Wunderschöne Glüh- und Schwebereffekte im Weltraum'
    ]
  },
  '1.6.22': {
    version: '1.6.22',
    intro: 'Hey, es ist jetzt Version 1.6.22 rausgekommen, folgendes wurde hinzugefügt und verbessert:',
    highlights: [
      '👑 Garantierte Boss-Splitter: Jeder besiegte Boss droppt nun garantiert 3 zusätzliche Kristall-Splitter (Rot oder Weiß)',
      '💎 Schnellerer Viper-Aufbau: Durch die Boss-Splitter erhalten Viper-Piloten deutlich zügiger Extra-Leben und Super-Waffen',
      '✨ Feingeschliffene Drop-Verteilung im Solo- und 2-Spieler-Modus'
    ]
  },
  '1.6.21': {
    version: '1.6.21',
    intro: 'Hey, es ist jetzt Version 1.6.21 rausgekommen, folgendes wurde hinzugefügt und verbessert:',
    highlights: [
      '💎 Viper Kristall-Splitter Drop-System: 10% Chance bei jedem Feind-Abschuss durch den Viper auf einen Splitter-Drop (Solo & 2-Spieler Co-op)',
      '❤️ Roter Splitter (♦): 10 gesammelte rote Splitter gewähren dem Viper ein zusätzliches Leben',
      '⭐ Weißer Splitter (✦): 10 gesammelte weiße Splitter lösen ein mächtiges Super-Waffen-Upgrade aus',
      '📊 Neues Splitter-HUD: Dedizierte Zähler-Anzeige für Viper-Piloten im Cockpit'
    ]
  },
  '1.6.20': {
    version: '1.6.20',
    intro: 'Hey, es ist jetzt Version 1.6.20 rausgekommen, folgendes wurde verbessert:',
    highlights: [
      '🚀 Authentische Raketen-Flugdynamik: Wiederherstellung der 3-Phasen-Flugphysik mit charakteristischem Anlaufnehmen in Phase 2',
      '🎯 Präzise Zielsuch-Vektorlenkung: Zielsucher-Raketen drehen ihre Flugbahn exakt auf Feinde ein und treffen Ziele zuverlässig',
      '💥 Proximity-Zünder: Ausgewogener Zündradius für verlässliche Trefferwirkung'
    ]
  },
  '1.6.19': {
    version: '1.6.19',
    intro: 'Hey, es ist jetzt Version 1.6.19 rausgekommen, folgendes wurde hinzugefügt und verbessert:',
    highlights: [
      '🔗 Traktorstrahl Powerup-Kopplung: Spieler können bis zu 3 Powerups für ihren Partner im Schlepptau mitziehen',
      '⚖️ Dynamischer Gewichts-Debuff: Für jedes gezogene Powerup sinkt das Schiffstempo um 10%',
      '🤝 Partner-Übergabe: Gezogene Powerups werden sofort aktiviert, sobald der Partner sie berührt'
    ]
  },
  '1.6.18': {
    version: '1.6.18',
    intro: 'Hey, es ist jetzt Version 1.6.18 rausgekommen, folgendes wurde behoben und verbessert:',
    highlights: [
      '🚀 Raketenwerfer Spieler 2: Korrekte Pod-Anzeige auf dem Schiff passend zum Modell (Viper links, Phantom rechts) und Level',
      '🎯 Boss-Raketen Ausrichtung: Raketen fliegen nun vorwärts mit der Spitze in Flugrichtung auf die Spieler zu',
      '✨ Optimierte Raketendynamik: Ausgewogene Fluggeschwindigkeit und präzises Homing-Tracking im Solo- und 2-Spieler-Modus'
    ]
  },
  '1.6.17': {
    version: '1.6.17',
    intro: 'Hey, es ist jetzt Version 1.6.17 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🎬 Co-op Story Cutszene: Beide Spielerschiffe fliegen im 2-Spieler-Modus gemeinsam im Raumschiff-Konvoi',
      '🛡️ Gemeinsames Überleben: Beide Spieler überstehen den Überraschungsangriff und steigen parallel im Lichtstrahl auf'
    ]
  },
  '1.6.16': {
    version: '1.6.16',
    intro: 'Hey, es ist jetzt Version 1.6.16 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🏆 Getrennte Bestenliste: Separate Highscore-Ranglisten für Solo- und 2-Spieler-Modus (Co-op)',
      '👥 Team-Highscores: Speicherung und Anzeige von Team-Namen und den Schiffstypen beider Co-op-Piloten',
      '📑 Interaktive Highscore-Tabs: Bequemes Umschalten zwischen Solo- und Co-op-Bestenliste auf dem Game-Over-Screen'
    ]
  },
  '1.6.15': {
    version: '1.6.15',
    intro: 'Hey, es ist jetzt Version 1.6.15 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🎯 Spieler 2 Tastenbelegung entkoppelt: Taste L feuert nur die Bombe und nicht mehr zusätzlich den Laser',
      '📊 Optimiertes Co-op HUD: Punkte- und Levelanzeige sind im 2-Spieler-Modus zentriert und überdecken nicht mehr das P2-HUD',
      '💎 Intelligentes Loot-System: Wenn ein Spieler zerstört ist, spawnen Powerup-Drops ausschließlich für den überlebenden Spieler'
    ]
  },
  '1.6.14': {
    version: '1.6.14',
    intro: 'Hey, es ist jetzt Version 1.6.14 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '⚡ Spieler 2 Energiebalken: Sichtbarkeit und Design des P2-Energiebalkens im HUD korrigiert',
      '🛡️ Spieler 2 Schild-Aura: Schild-Effekt wird nun auch auf Spieler 2 bei aktiver Schildstufe visuell angezeigt',
      '🎯 Boss-Zielerfassung im Co-op: Boss Typ 2 (Jäger) wechselt nach dem Ableben von Spieler 1 dynamisch auf Spieler 2'
    ]
  },
  '1.6.13': {
    version: '1.6.13',
    intro: 'Hey, es ist jetzt Version 1.6.13 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🚀 2-Spieler-Modus (PC Co-op): Spiele gemeinsam mit einem Freund an einer Tastatur (P1: WASD + B/V/C, P2: Pfeiltasten + Ä/Ö/L)',
      '🌌 Erweitertes Spielfeld & Balancing: 600px breites Kampfareal mit angepassten Feind- und Boss-Werten',
      '💎 Dedicated Loot & Revive-System: Getrennte Powerups für P1 & P2 und Wiederbelebung gefallener Teammitglieder bei Boss-Sieg oder Herz-Powerups'
    ]
  },
  '1.6.12': {
    version: '1.6.12',
    intro: 'Hey, es ist jetzt Version 1.6.12 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🧹 Saubere Rundenübergänge: Boss-Raketen, Boss-Bomben und alle Projektile werden beim Neustart restlos bereinigt',
      '🛸 Fehlerfreie Cutszenen nach Neustart: Keine Artefakte aus vorherigen Runden mehr im Spielfeld',
      '🛡️ Optimierte Entitäten-Verwaltung beim Neustart & Game Over'
    ]
  },
  '1.6.11': {
    version: '1.6.11',
    intro: 'Hey, es ist jetzt Version 1.6.11 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '💥 Spektakuläre Schiffsexplosionen: Konvoi-Schiffe detonieren mit Feuerbällen, Schockwellen & Trümmerteilen',
      '🛸 Sauberes Hangar-UI: Keine störenden Raketenwerfer-Geister mehr im Bildschirmzentrum',
      '🔥 Mehrstufige Zerstörung: Große Schiffe erleiden Sekundärexplosionen und brechen in Trümmer'
    ]
  },
  '1.6.10': {
    version: '1.6.10',
    intro: 'Hey, es ist jetzt Version 1.6.10 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🎥 Kameraverfolgung im Konvoi: Der Raumschiff-Konvoi fliegt ins Zentrum und wird von der Kamera begleitet',
      '💥 Sichtbare Zerstörung im Bild: Der feindliche Hinterhalt und alle Schiffsexplosionen finden direkt im Sichtfeld statt',
      '🛸 Saubere Hangar- & Cutszenen-Darstellung: Spielerschiff wird erst beim Spielstart aktiv eingeblendet'
    ]
  },
  '1.6.9': {
    version: '1.6.9',
    intro: 'Hey, es ist jetzt Version 1.6.9 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🎬 Story Intro-Cutszene: Epische DOM-Cutszene nach dem Hangar mit Schiffskonvoi, Alien-Funkspruch & Überraschungsangriff',
      '⚡ Nahtloser Übergang: Mysteriöser Lichtstrahl und automatischer Einflug ins Spielfeld',
      '⏩ Schnelles Überspringen: Cutszene jederzeit per ESC-Taste oder Touch-Button abbrechbar'
    ]
  },
  '1.6.8': {
    version: '1.6.8',
    intro: 'Hey, es ist jetzt Version 1.6.8 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '💥 Zischender Raketen-Knall: Neue wuchtige Detonations-SFX mit Rausch-Zischen für Spieler- und Boss-Raketen',
      '⏱️ Beschleunigendes Bomben-Piepsen: Fliegende Bomben (Spieler & Boss) geben ein dynamisch schneller werdendes Warn-Piepsen bis zur Detonation ab',
      '🚀 Boss-Raketen Fluggeräusch: Seitliche Boss-Raketen erzeugen während des Flugs ein bedrohliches Triebwerks-Fauchen'
    ]
  },
  '1.6.7': {
    version: '1.6.7',
    intro: 'Hey, es ist jetzt Version 1.6.7 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '⚡ Zero-Latency Audio-Engine: Vorab generierte Noise-Buffer und optimierte AudioContext-Latenz für lag-freies Feedback in Chrome und Firefox',
      '🎆 Silvester-Raketen-Zischen: Neuer authentischer Zisch- und Pfeif-Synthesizer mit Resonanzfilter für das Abfeuern von Raketen',
      '👾 Boss- & Gegner-Vertonung: Eigene Soundeffekte für feindliche Laser, Boss-Laser, Boss-Plasma-Bomben und zielsuchende Boss-Raketen'
    ]
  },
  '1.6.6': {
    version: '1.6.6',
    intro: 'Hey, es ist jetzt Version 1.6.6 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🔊 Synthetische Retro-Sounds (Web Audio API): Dynamische Audio-Effekte für Laser, Autolaser, Raketen, Bomben, Explosionen, Powerups und Boss-Warnungen ohne externe Ladezeiten',
      '🔇 Sound-Mute Steuerung: Schnelles Stummschalten per Tastenkürzel M oder Button in der Benutzeroberfläche (mit Speicher-Persistenz)'
    ]
  },
  '1.6.5': {
    version: '1.6.5',
    intro: 'Hey, es ist jetzt Version 1.6.5 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '⏱️ Kürzere Unverwundbarkeit: Die i-Frames nach einem Treffer wurden halbiert (von 1.5s auf 0.75s) für ein knackigeres Gameplay-Gefühl',
      '⚡ Höhere Herausforderung bei feindlichen Salven'
    ]
  },
  '1.6.4': {
    version: '1.6.4',
    intro: 'Hey, es ist jetzt Version 1.6.4 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🏆 Schiffstyp in Highscores: Hinter jedem Highscore-Eintrag wird nun mit stilvollem Badge angezeigt, mit welchem Schiff (Viper-X oder Phantom-NX) der Rekord erzielt wurde',
      '📊 Detaillierte Rekord-Übersicht in der Bestenliste'
    ]
  },
  '1.6.3': {
    version: '1.6.3',
    intro: 'Hey, es ist jetzt Version 1.6.3 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🚀 Seitliche Boss-Raketen: Bosse feuern zielsuchende Raketen seitlich ab, um dem Frontal-Sperrfeuer auszuweichen',
      '🎯 Zerstörbare Bedrohung: Schieße die langsamen Raketen mit dem Laser ab, bevor sie dich treffen',
      '💥 Taktischer Bonus: +100 Punkte für jede im Flug zerstörte Boss-Rakete'
    ]
  },
  '1.6.2': {
    version: '1.6.2',
    intro: 'Hey, es ist jetzt Version 1.6.2 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🚀 Seitliche Boss-Raketen: Bosse feuern zielsuchende Raketen seitlich ab, um dem Frontal-Sperrfeuer auszuweichen',
      '🎯 Zerstörbare Bedrohung: Schieße die langsamen Raketen mit dem Laser ab, bevor sie dich treffen',
      '💥 Taktischer Bonus: +100 Punkte für jede im Flug zerstörte Boss-Rakete'
    ]
  },
  '1.6.1': {
    version: '1.6.1',
    intro: 'Hey, es ist jetzt Version 1.6.1 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🔥 Feind-Schussrate & 2er-Salven: Gegner schießen mit steigendem Level schneller und feuern ab Level 3 gefährliche 2er-Salven (Burst)',
      '🛡️ Schild-Gegner (Level 3+): Einige Gegner besitzen jetzt einen pulsierenden Energieschild, der erst zerschossen werden muss',
      '💣 Boss-Bombe: Bosse werfen schwere Plasma-Bomben ab – schieße sie ab, bevor ihre rote Schockwelle detoniert!'
    ]
  },
  '1.6.0': {
    version: '1.6.0',
    intro: 'Hey, es ist jetzt Version 1.6.0 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🚀 Sichtbare Raketenwerfer am Schiff: Dynamische Werfer-Pods mit animierter Plasma-Energiekopplung',
      '🎯 Geradeaus-Abschuss: Raketen starten jetzt direkt und präzise geradeaus aus den Rohren (Viper links, Phantom rechts)',
      '💥 Level-Skalierung & Pod-Abwurf: Zusätzliche Werfer auf Lvl 3-5 und spektakuläre Wegschleuder-Animation bei Upgrade-Verlust'
    ]
  },
  '1.5.6': {
    version: '1.5.6',
    intro: 'Hey, es ist jetzt Version 1.5.6 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '⚡ Viper-X Kill-Energie: Zerstörte feindliche Schiffe stellen der Viper sofort +5 Laser-Energie wieder her',
      '🏷️ Hangar-Perks aktualisiert: Neuer Perk "+5 ENERGIE BEI KILL" für Viper-X sichtbar'
    ]
  },
  '1.5.5': {
    version: '1.5.5',
    intro: 'Hey, es ist jetzt Version 1.5.5 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🛡️ Phantom-NX Schild-Regeneration: Schild Stufe 1 lädt sich nach Treffern automatisch wieder auf',
      '⏱️ Radialer Uhr-Ladebalken: Das O1-Icon zeigt den Ladefortschritt als kreisförmige Uhr-Animation an',
      '🛸 Feinere Schiffs-Balance: Phantom-NX Geschwindigkeit auf 3.8 angepasst für spürbare Panzer-Trägheit'
    ]
  },
  '1.5.4': {
    version: '1.5.4',
    intro: 'Hey, es ist jetzt Version 1.5.4 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🎯 Smarte Autolaser-Zielerfassung: Ignoriert unzerstörbare Magma-Asteroiden und visiert nur zerstörbare Feinde & Asteroiden an',
      '⚡ Optimierte Zielpriorisierung für das "A"-Powerup'
    ]
  },
  '1.5.3': {
    version: '1.5.3',
    intro: 'Hey, es ist jetzt Version 1.5.3 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🏷️ Klarere Hangar-Perks: Deutlicher Hinweis "TREFFER: -1 UPGRADE" bei der Viper-X',
      '🛸 Bessere Transparenz: Alle Vor- und Nachteile beider Schiffe auf einen Blick'
    ]
  },
  '1.5.2': {
    version: '1.5.2',
    intro: 'Hey, es ist jetzt Version 1.5.2 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '⚡ Gebündeltes Laser-Feuer (Stufe 4): Quad-Core-Formation feuert 4 Laser parallel nach vorne',
      '🎯 Mehr Präzision: Keine ungenaue diagonale Streuung mehr bei den lila Lasern',
      '💥 Konzentrierter Einzelschaden: Maximale Feuerkraft auf engstem Raum gegen Bosse & Asteroiden'
    ]
  },
  '1.5.1': {
    version: '1.5.1',
    intro: 'Hey, es ist jetzt Version 1.5.1 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '⚡ Viper-X Interceptor: +20% Tempo & +25% schnellere Laser-Regeneration',
      '🛡️ Phantom-NX Striker: Schwere Panzerung (kein Upgrade-Verlust) & Start-Schild Lvl 1',
      '🏷️ Hangar-Perks: Anzeige aller Vor- und Nachteile direkt im Hangar',
      '🛸 Ausbalanciertes Schiffsgefühl: Asymmetrische Eigenschaften für beide Modelle'
    ]
  },
  '1.5.0': {
    version: '1.5.0',
    intro: 'Hey, es ist jetzt Version 1.5.0 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🛸 Neuer Hangar: Wähle vor jedem Start zwischen "Viper-X" und "Phantom-NX"',
      '🎨 5 Schiffs-Farben: Crimson, Cobalt, Emerald, Cyber Gold & Void Violet',
      '🚀 Dual-Homing auf Stufe 5: 2 von 3 Raketen visieren Ziele an',
      '🚀 Dynamische Raketen-Kinematik mit 3 Flugphasen',
      '💣 Bomben-Evolution: 5 Stufen mit Auren, EMP & Jericho-Cluster'
    ]
  }
};

export function checkAndShowWhatsNew(currentVersion = GAME_VERSION) {
  const storageKey = 'starshooter_last_seen_version';
  const lastSeen = localStorage.getItem(storageKey);

  if (!lastSeen || lastSeen !== currentVersion) {
    showWhatsNewModal(currentVersion);
  }
}

export function showWhatsNewModal(version = GAME_VERSION) {
  const modal = document.getElementById('whats-new-overlay');
  if (!modal) return;

  const data = changelogData[version] || {
    version: version,
    intro: `Hey, es ist jetzt Version ${version} rausgekommen, folgendes wurde geändert oder ist neu:`,
    highlights: ['🛠️ Einige Bugfixes und Verbesserungen']
  };

  const titleEl = document.getElementById('whats-new-title');
  const introEl = document.getElementById('whats-new-intro');
  const listEl = document.getElementById('whats-new-list');

  if (titleEl) titleEl.innerText = `WAS GIBT'S NEUES`;
  if (introEl) introEl.innerText = data.intro;
  if (listEl) {
    listEl.innerHTML = data.highlights.map(item => `<li>${item}</li>`).join('');
  }

  modal.style.display = 'flex';
}

export function closeWhatsNewModal(currentVersion = GAME_VERSION) {
  const modal = document.getElementById('whats-new-overlay');
  if (modal) modal.style.display = 'none';
  localStorage.setItem('starshooter_last_seen_version', currentVersion);
}
