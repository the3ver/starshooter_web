export const GAME_VERSION = '1.4.4';

export const changelogData = {
  '1.4.4': {
    version: '1.4.4',
    intro: 'Hey, es ist jetzt Version 1.4.4 rausgekommen, folgendes wurde geändert oder ist neu:',
    highlights: [
      '🚀 Dual-Homing auf Stufe 5: 2 von 3 Raketen visieren nun selbstständig Ziele an',
      '🛡️ Fix: Spielfeld-Begrenzung für das Spielerschiff unten und rechts korrigiert',
      '🚀 Dynamische Raketen-Kinematik: Seitlicher Abwurf, kurzer Stall & linearer Turbo-Schub',
      '🛡️ Heavy Warhead: Neues, gepanzertes Raketen-Design mit Front-Canards ab Stufe 2',
      '💣 Bomben-Evolution: 5 Stufen mit eigenen Auren, EMP & Vortex-Sog'
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
