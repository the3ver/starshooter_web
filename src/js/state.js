
export const dom = {
    spielfeld: document.getElementById('spielfeld'),
    spieler: document.getElementById('spieler'),
    lebenAnzeige: document.getElementById('leben-anzeige'),
    energieBalken: document.getElementById('energie-balken'),
    maxEnergieMarker: document.getElementById('max-energie-marker'),
    aktivePowerupsContainer: document.getElementById('aktive-powerups'),
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
    pauseOverlay: document.getElementById('pause-overlay')
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

export const state = {
    x: 185, y: 285, leben: 3, score: 0, level: 1, absMaxEnergie: 100, maxEnergie: 50,
    energie: 50, minZuendEnergie: 15, energieTimer: 0, laserSchiesst: false,
    laserDurchschlag: false, durchschlagTimer: 0, schildStufe: 0, laserStufe: 1,
    autolaserAktiv: false, autolaserTimer: 0, raketenStufe: 1, raketenCooldown: 0,
    bombenStufe: 1, bombenCooldown: 0, frameZaehler: 0, spielLaeuft: false,
    feindSpawnZeit: 1200, bossKampfAktiv: false, tastenGedrueckt: {w: false, a: false, s: false, d: false, l: false, k: false, ' ': false}, mausGedrueckt: false,
    bossAktiv: false, bossWarningAktiv: false, bossWarningTimer: 0, gameOverAktiv: false,
    spielerSchussCooldown: 0, finalerScore: 0, cheatUsed: false, typedCheatKeys: '',
    godMode: false, pausiert: false, unbegrenzteEnergie: false,
    joystick: { x: 0, y: 0, active: false }
};

export const arrays = {
    laserArray: [], raketenArray: [], bombenArray: [], feinde: [], asteroiden: [],
    bosses: [], partikelArray: [], explosionenArray: [], powerups: [], feindLaserArray: [], bossLaserArray: [], sterne: []
};
