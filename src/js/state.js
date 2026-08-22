
export const dom = {
    spielfeld: document.getElementById('spielfeld'),
    spieler: document.getElementById('spieler'),
    spieler2: document.getElementById('spieler-2'),
    lebenAnzeige: document.getElementById('leben-anzeige'),
    lebenAnzeigeP2: document.getElementById('leben-anzeige-p2'),
    energieBalken: document.getElementById('energie-balken'),
    energieBalkenP2: document.getElementById('energie-balken-p2'),
    maxEnergieMarker: document.getElementById('max-energie-marker'),
    maxEnergieMarkerP2: document.getElementById('max-energie-marker-p2'),
    aktivePowerupsContainer: document.getElementById('aktive-powerups'),
    aktivePowerupsContainerP2: document.getElementById('aktive-powerups-p2'),
    scoreAnzeige: document.getElementById('score-anzeige'),
    levelAnzeige: document.getElementById('level-anzeige'),
    bossHpContainer: document.getElementById('boss-hp-container'),
    bossHpBalken: document.getElementById('boss-hp-balken'),
    warningOverlay: document.getElementById('warning-overlay'),
    laser1: document.getElementById('laser1'),
    laser2: document.getElementById('laser2'),
    laserDiagLinks: document.getElementById('laser-diag-links'),
    laserDiagRechts: document.getElementById('laser-diag-rechts'),
    autolaserEl: document.getElementById('autolaser'),
    pauseOverlay: document.getElementById('pause-overlay'),
    uiContainerP1: document.getElementById('ui-container'),
    uiContainerP2: document.getElementById('ui-container-p2'),
    splitterHudP1: document.getElementById('splitter-hud-p1'),
    splitterRotCountP1: document.getElementById('splitter-rot-count'),
    splitterWeissCountP1: document.getElementById('splitter-weiss-count'),
    splitterHudP2: document.getElementById('splitter-hud-p2'),
    splitterRotCountP2: document.getElementById('splitter-rot-count-p2'),
    splitterWeissCountP2: document.getElementById('splitter-weiss-count-p2')
};

export const config = {
    spielfeldBreite: 400,
    spielfeldHoehe: 600,
    spielerGroesse: 30,
    geschwindigkeit: 5,
    bossFarben: ['#c0392b', '#8e44ad', '#2980b9', '#d35400', '#27ae60'],
    asteroidenBasisFarben: ['#7f8c8d', '#95a5a6', '#bdc3c7', '#34495e'],
    magmaBasisFarben: [
        {a: '#e74c3c', b: '#c0392b'},
        {a: '#d35400', b: '#e67e22'},
        {a: '#e67e22', b: '#d35400'},
        {a: '#f1c40f', b: '#f39c12'}
    ],
    rissMuster: [
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M30,0 L40,30 L20,50 L45,65 L35,100 M70,0 L50,25 L75,40 L55,70 L65,100 M0,40 L30,30 L45,50' stroke='%23000' stroke-width='4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M10,10 L30,40 L15,80 M80,20 L60,50 L85,90 M40,20 L50,50 L30,90' stroke='%23000' stroke-width='4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M50,0 L45,30 L60,45 L40,65 L50,100 M0,50 L30,45 L50,60 L75,45 L100,55' stroke='%23000' stroke-width='4' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"
    ]
};

export const shipColors = {
    red: { name: 'Crimson Red', prim: '#e74c3c', sec: '#c0392b', accent: '#ff7675', glow: 'rgba(231, 76, 60, 0.8)' },
    blue: { name: 'Cobalt Blue', prim: '#3498db', sec: '#2980b9', accent: '#74b9ff', glow: 'rgba(52, 152, 219, 0.8)' },
    green: { name: 'Emerald Green', prim: '#2ecc71', sec: '#27ae60', accent: '#55efc4', glow: 'rgba(46, 204, 113, 0.8)' },
    yellow: { name: 'Cyber Gold', prim: '#f1c40f', sec: '#d35400', accent: '#ffeaa7', glow: 'rgba(241, 196, 15, 0.8)' },
    purple: { name: 'Void Violet', prim: '#9b59b6', sec: '#8e44ad', accent: '#a29bfe', glow: 'rgba(155, 89, 182, 0.8)' }
};

export const shipModels = {
    viper: {
        name: 'VIPER-X INTERCEPTOR',
        shortName: 'VIPER-X',
        speed: 6.0,
        energyRegen: 0.5,
        startShield: 0,
        energyPerKill: 5,
        loseUpgradesOnHit: true,
        perks: [
            { icon: '⚡', label: '+20% TEMPO', desc: 'Höchste Wendigkeit & Fluggeschwindigkeit', type: 'buff' },
            { icon: '🔋', label: '+25% REGEN', desc: 'Laser lädt deutlich schneller wieder auf', type: 'buff' },
            { icon: '💥', label: '+5 ENERGIE BEI KILL', desc: 'Stellt für jeden zerstörten Feind 5 Laser-Energie wieder her', type: 'buff' },
            { icon: '💎', label: 'SPLITTER-DROP', desc: 'Jeder 10. zerstörte Feind hinterlässt einen Roten (10=Leben) oder Weißen (10=Super-Waffe) Splitter', type: 'buff' },
            { icon: '⚠️', label: 'TREFFER: -1 UPGRADE', desc: 'Verliert bei Treffern ohne Schild ein Waffen-Upgrade', type: 'nerf' }
        ]
    },
    phantom: {
        name: 'PHANTOM-NX STRIKER',
        shortName: 'PHANTOM-NX',
        speed: 3.8,
        energyRegen: 0.4,
        startShield: 1,
        shieldRegen: true,
        shieldRegenMax: 900,
        loseUpgradesOnHit: false,
        perks: [
            { icon: '🛡️', label: 'SCHWERE PANZERUNG', desc: 'Behält alle Waffen-Upgrades bei Treffern', type: 'buff' },
            { icon: '🔄', label: 'REGEN-SCHILD LVL 1', desc: 'Schild Stufe 1 lädt sich nach Treffern automatisch wieder auf', type: 'buff' },
            { icon: '⏳', label: '-35% TEMPO', desc: 'Schwere Masse, spürbar langsamere Fluggeschwindigkeit', type: 'nerf' }
        ]
    }
};

export const state = {
    x: 185, y: 285, leben: 3, score: 0, level: 1, absMaxEnergie: 100, maxEnergie: 50,
    energie: 50, minZuendEnergie: 15, energieTimer: 0, laserSchiesst: false,
    laserDurchschlag: false, durchschlagTimer: 0, schildStufe: 0, laserStufe: 1,
    autolaserAktiv: false, autolaserTimer: 0, raketenStufe: 1, raketenCooldown: 0,
    bombenStufe: 1, bombenCooldown: 0, frameZaehler: 0, spielLaeuft: false, cutsceneAktiv: false,
    feindSpawnZeit: 1200, bossKampfAktiv: false,
    splitterRot: 0, splitterWeiss: 0, viperKillCount: 0,
    tastenGedrueckt: {
        w: false, a: false, s: false, d: false,
        l: false, k: false, ' ': false,
        b: false, v: false, c: false,
        ä: false, ö: false,
        arrowup: false, arrowdown: false, arrowleft: false, arrowright: false,
        numpad1: false, numpad2: false, numpad3: false, numpad0: false, enter: false
    },
    mausGedrueckt: false,
    bossAktiv: false, bossWarningAktiv: false, bossWarningTimer: 0, gameOverAktiv: false,
    spielerSchussCooldown: 0, finalerScore: 0, cheatUsed: false, typedCheatKeys: '',
    godMode: false, pausiert: false, unbegrenzteEnergie: false, invulnerableTimer: 0,
    phantomSchildRegenTimer: 0, phantomSchildRegenMax: 900,
    joystick: { x: 0, y: 0, active: false },
    gameMode: 'single', // 'single' | 'coop'
    activeHangarPlayer: 'p1', // 'p1' | 'p2'
    selectedShipModel: 'viper',
    selectedShipColor: 'red',
    p2: {
        x: 370, y: 285, prevX: 370, prevY: 285, spielerVx: 0, spielerVy: 0,
        leben: 3, absMaxEnergie: 100, maxEnergie: 50, energie: 50, minZuendEnergie: 15,
        laserStufe: 1, raketenStufe: 1, bombenStufe: 1, schildStufe: 1,
        laserSchiesst: false, laserDurchschlag: false, durchschlagTimer: 0,
        autolaserAktiv: false, autolaserTimer: 0, raketenCooldown: 0, bombenCooldown: 0,
        spielerSchussCooldown: 0, invulnerableTimer: 0,
        phantomSchildRegenTimer: 0, phantomSchildRegenMax: 900,
        splitterRot: 0, splitterWeiss: 0, viperKillCount: 0,
        selectedShipModel: 'phantom', selectedShipColor: 'blue',
        isDead: false, rotate: 0
    }
};

export const arrays = {
    laserArray: [], raketenArray: [], bombenArray: [], feinde: [], asteroiden: [],
    bosses: [], bossBombenArray: [], bossRaketenArray: [], partikelArray: [], explosionenArray: [], powerups: [], feindLaserArray: [], bossLaserArray: [], sterne: []
};
