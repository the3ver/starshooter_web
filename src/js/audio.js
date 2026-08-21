/**
 * Retro Procedural Sound Synthesizer via Web Audio API
 */

let audioCtx = null;
let masterGain = null;
let isMuted = false;
let sharedNoiseBuffer = null;

export const audioHistory = [];

function recordSound(name, details = {}) {
    audioHistory.push({ name, details, time: Date.now() });
    if (audioHistory.length > 50) audioHistory.shift();
}

export function clearAudioHistory() {
    audioHistory.length = 0;
}

export function getAudioContext() {
    if (!audioCtx && (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext)) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
        masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(isMuted ? 0 : 0.3, audioCtx.currentTime);
        masterGain.connect(audioCtx.destination);
    }
    return audioCtx;
}

export function getNoiseBuffer(ctx) {
    if (!sharedNoiseBuffer && ctx) {
        try {
            const sampleRate = ctx.sampleRate || 44100;
            const bufferSize = sampleRate * 2;
            sharedNoiseBuffer = ctx.createBuffer(1, bufferSize, sampleRate);
            const output = sharedNoiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
        } catch (e) {}
    }
    return sharedNoiseBuffer;
}

export function initAudio() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
    }
}

if (typeof window !== 'undefined') {
    const unlock = () => {
        initAudio();
    };
    window.addEventListener('pointerdown', unlock, { passive: true, once: true });
    window.addEventListener('touchstart', unlock, { passive: true, once: true });
    window.addEventListener('keydown', unlock, { passive: true, once: true });
}

export function isSoundMuted() {
    return isMuted;
}

export function setMuted(muted) {
    isMuted = !!muted;
    try {
        localStorage.setItem('starshooter_muted', isMuted ? 'true' : 'false');
    } catch (e) {}

    if (audioCtx && masterGain) {
        masterGain.gain.setValueAtTime(isMuted ? 0 : 0.3, audioCtx.currentTime);
    }
    updateSoundButtonUI();
}

export function toggleMute() {
    setMuted(!isMuted);
    return isMuted;
}

export function updateSoundButtonUI() {
    const btn = document.getElementById('btn-sound-toggle');
    if (btn) {
        btn.textContent = isMuted ? '🔇' : '🔊';
        btn.setAttribute('title', isMuted ? 'Sound aktivieren (M)' : 'Sound stummschalten (M)');
        btn.setAttribute('aria-label', isMuted ? 'Sound aktivieren (M)' : 'Sound stummschalten (M)');
    }
}

export function initSoundState() {
    try {
        const saved = localStorage.getItem('starshooter_muted');
        if (saved !== null) {
            isMuted = (saved === 'true');
        }
    } catch (e) {}
    updateSoundButtonUI();
}

export function playLaser(level = 1) {
    recordSound('laser', { level });
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const baseFreq = 600 + (level * 100);
    osc.type = level >= 4 ? 'square' : 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.12);
}

export function playAutolaser() {
    recordSound('autolaser');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.06);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
}

export function playMissile() {
    recordSound('missile');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const duration = 0.32;

    // 1. Silvester-Raketen Rausch-Zischen (Resonant Bandpass Sweep über Noise-Buffer)
    try {
        const noiseBuf = getNoiseBuffer(ctx);
        if (noiseBuf) {
            const noiseSource = ctx.createBufferSource();
            noiseSource.buffer = noiseBuf;
            noiseSource.loop = true;

            const bandpass = ctx.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.Q.setValueAtTime(4.0, now);
            bandpass.frequency.setValueAtTime(800, now);
            bandpass.frequency.exponentialRampToValueAtTime(3800, now + duration * 0.7);
            bandpass.frequency.exponentialRampToValueAtTime(1200, now + duration);

            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.35, now);
            noiseGain.gain.linearRampToValueAtTime(0.4, now + duration * 0.4);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            noiseSource.connect(bandpass);
            bandpass.connect(noiseGain);
            noiseGain.connect(masterGain);

            noiseSource.start(now);
            noiseSource.stop(now + duration);
        }
    } catch (e) {}

    // 2. Aufsteigender Pfeifton ("Wiiieeeep")
    const whistleOsc = ctx.createOscillator();
    const whistleGain = ctx.createGain();
    whistleOsc.type = 'sine';
    whistleOsc.frequency.setValueAtTime(450, now);
    whistleOsc.frequency.exponentialRampToValueAtTime(2400, now + duration * 0.85);

    whistleGain.gain.setValueAtTime(0.18, now);
    whistleGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    whistleOsc.connect(whistleGain);
    whistleGain.connect(masterGain);
    whistleOsc.start(now);
    whistleOsc.stop(now + duration);

    // 3. Kurzer Abschuss-Poff (Druckwelle am Rohr)
    const popOsc = ctx.createOscillator();
    const popGain = ctx.createGain();
    popOsc.type = 'triangle';
    popOsc.frequency.setValueAtTime(200, now);
    popOsc.frequency.exponentialRampToValueAtTime(50, now + 0.08);

    popGain.gain.setValueAtTime(0.25, now);
    popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    popOsc.connect(popGain);
    popGain.connect(masterGain);
    popOsc.start(now);
    popOsc.stop(now + 0.08);
}

export function playMissileExplosion() {
    recordSound('missileExplosion');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const duration = 0.35;

    // 1. Zischendes Knall-Rauschen (High-frequency Bandpass Sizzle & Crackle)
    try {
        const noiseBuf = getNoiseBuffer(ctx);
        if (noiseBuf) {
            const noiseSource = ctx.createBufferSource();
            noiseSource.buffer = noiseBuf;
            noiseSource.loop = true;

            const bandpass = ctx.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.Q.setValueAtTime(2.5, now);
            bandpass.frequency.setValueAtTime(2800, now);
            bandpass.frequency.exponentialRampToValueAtTime(450, now + duration);

            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.45, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            noiseSource.connect(bandpass);
            bandpass.connect(noiseGain);
            noiseGain.connect(masterGain);

            noiseSource.start(now);
            noiseSource.stop(now + duration);
        }
    } catch (e) {}

    // 2. Knallender Mid-Bass Druckimpuls ("Paff/Bum")
    const popOsc = ctx.createOscillator();
    const popGain = ctx.createGain();
    popOsc.type = 'triangle';
    popOsc.frequency.setValueAtTime(260, now);
    popOsc.frequency.exponentialRampToValueAtTime(45, now + 0.18);

    popGain.gain.setValueAtTime(0.35, now);
    popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    popOsc.connect(popGain);
    popGain.connect(masterGain);
    popOsc.start(now);
    popOsc.stop(now + 0.18);
}

export function playBomb() {
    recordSound('bomb');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.35);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.4);
}

export function playBombBeep(urgency = 0, isBoss = false) {
    recordSound('bombBeep', { urgency, isBoss });
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const clampedUrgency = Math.max(0, Math.min(1, urgency));
    // Frequenz steigt mit Dringlichkeit
    const baseFreq = isBoss ? 500 : 900;
    const maxFreq = isBoss ? 1500 : 2600;
    const freq = baseFreq + clampedUrgency * (maxFreq - baseFreq);

    osc.type = isBoss ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(freq, now);

    const dur = isBoss ? 0.05 : 0.035;
    const vol = isBoss ? 0.22 : 0.16;

    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + dur);
}

export function playBossRocketFlight() {
    recordSound('bossRocketFlight');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const dur = 0.12;

    try {
        const noiseBuf = getNoiseBuffer(ctx);
        if (noiseBuf) {
            const noiseSource = ctx.createBufferSource();
            noiseSource.buffer = noiseBuf;
            noiseSource.loop = true;

            const bandpass = ctx.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.Q.setValueAtTime(3.0, now);
            bandpass.frequency.setValueAtTime(1200, now);
            bandpass.frequency.linearRampToValueAtTime(1800, now + dur);

            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.2, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

            noiseSource.connect(bandpass);
            bandpass.connect(noiseGain);
            noiseGain.connect(masterGain);

            noiseSource.start(now);
            noiseSource.stop(now + dur);
        }
    } catch (e) {}
}

export function playEnemyLaser() {
    recordSound('enemyLaser');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(750, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.1);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.1);
}

export function playBossLaser() {
    recordSound('bossLaser');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.18);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.18);
}

export function playBossBombLaunch() {
    recordSound('bossBombLaunch');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.3);
}

export function playBossRocketLaunch() {
    recordSound('bossRocketLaunch');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(250, now);
    osc.frequency.linearRampToValueAtTime(600, now + 0.15);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.15);
}

export function playExplosion(type = 'small') {
    recordSound('explosion', { type });
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    let duration = 0.25;
    let startFreq = 400;
    let vol = 0.25;
    if (type === 'medium') { duration = 0.45; startFreq = 300; vol = 0.35; }
    else if (type === 'large' || type === 'boss') { duration = 0.8; startFreq = 200; vol = 0.5; }

    try {
        const noiseBuf = getNoiseBuffer(ctx);
        if (noiseBuf) {
            const whiteNoise = ctx.createBufferSource();
            whiteNoise.buffer = noiseBuf;
            whiteNoise.loop = true;

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(startFreq, now);
            filter.frequency.exponentialRampToValueAtTime(40, now + duration);

            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(vol, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            whiteNoise.connect(filter);
            filter.connect(noiseGain);
            noiseGain.connect(masterGain);
            whiteNoise.start(now);
            whiteNoise.stop(now + duration);
        }
    } catch (e) {}

    const bassOsc = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bassOsc.type = 'sine';
    bassOsc.frequency.setValueAtTime(140, now);
    bassOsc.frequency.exponentialRampToValueAtTime(30, now + duration * 0.7);
    bassGain.gain.setValueAtTime(vol * 0.8, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.7);
    bassOsc.connect(bassGain);
    bassGain.connect(masterGain);
    bassOsc.start(now);
    bassOsc.stop(now + duration * 0.7);
}

export function playHit(type = 'normal') {
    recordSound('hit', { type });
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    if (type === 'magma') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.15);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(250, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.08);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    }
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + (type === 'magma' ? 0.15 : 0.08));
}

export function playPowerup(type = '') {
    recordSound('powerup', { type });
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);
        gain.gain.setValueAtTime(0, now);
        gain.gain.setValueAtTime(0.18, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.15);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + idx * 0.05);
        osc.stop(now + idx * 0.05 + 0.15);
    });
}

export function playShieldRegen() {
    recordSound('shieldRegen');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
}

export function playBossAlert() {
    recordSound('bossAlert');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.25);
    osc.frequency.linearRampToValueAtTime(220, now + 0.5);
    osc.frequency.linearRampToValueAtTime(110, now + 0.75);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.8);
}

export function playGameOver() {
    recordSound('gameOver');
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const notes = [392.00, 349.23, 311.13, 261.63]; // G4, F4, Eb4, C4
    notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.15);
        gain.gain.setValueAtTime(0, now);
        gain.gain.setValueAtTime(0.25, now + idx * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.15 + 0.25);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + idx * 0.15);
        osc.stop(now + idx * 0.15 + 0.25);
    });
}
