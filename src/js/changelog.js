export const GAME_VERSION = '1.6.8';

export const changelogData = {
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
