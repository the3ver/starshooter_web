import { state, dom, config, arrays, shipModels } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Network from './network.js';

let cutsceneContainer = null;
let cutsceneAnimationId = null;
let cutsceneTimeouts = [];
let cutsceneIntervals = [];
let cutsceneDebrisArray = [];
let cutsceneActive = false;
let onCompleteCallback = null;

export function isCutsceneActive() {
    return cutsceneActive;
}

function clearAllTimers() {
    cutsceneTimeouts.forEach(t => clearTimeout(t));
    cutsceneTimeouts = [];
    cutsceneIntervals.forEach(i => clearInterval(i));
    cutsceneIntervals = [];
    cutsceneDebrisArray.forEach(d => { if (d.el) d.el.remove(); });
    cutsceneDebrisArray = [];
    if (cutsceneAnimationId) {
        cancelAnimationFrame(cutsceneAnimationId);
        cutsceneAnimationId = null;
    }
}

export function getFreighterSVG() {
    return `
      <!-- Main armored hull -->
      <rect x="6" y="6" width="36" height="22" rx="4" fill="#34495e" stroke="#2c3e50" stroke-width="1.5"/>
      <!-- Cargo Containers -->
      <rect x="10" y="9" width="10" height="7" rx="1" fill="#e67e22" stroke="#d35400"/>
      <rect x="22" y="9" width="10" height="7" rx="1" fill="#27ae60" stroke="#2ecc71"/>
      <rect x="10" y="18" width="10" height="7" rx="1" fill="#f39c12" stroke="#d35400"/>
      <rect x="22" y="18" width="10" height="7" rx="1" fill="#e67e22" stroke="#d35400"/>
      <!-- Bridge / Cockpit -->
      <polygon points="42,10 52,14 52,20 42,24" fill="#7f8c8d"/>
      <polygon points="45,13 50,15 50,19 45,21" fill="#87CEEB"/>
      <!-- Engines -->
      <rect x="1" y="8" width="5" height="6" rx="1" fill="#95a5a6"/>
      <rect x="1" y="20" width="5" height="6" rx="1" fill="#95a5a6"/>
      <line x1="10" y1="17" x2="38" y2="17" stroke="#1abc9c" stroke-width="1" stroke-dasharray="2 2"/>
    `;
}

export function getHospitalShipSVG() {
    return `
      <!-- Medical Hull -->
      <path d="M6 10 Q24 4 44 10 L48 15 L44 20 Q24 26 6 20 Z" fill="#ecf0f1" stroke="#bdc3c7" stroke-width="1.5"/>
      <!-- Command Bridge -->
      <path d="M40 11 L48 15 L40 19 Z" fill="#1abc9c"/>
      <!-- Glowing Red Cross -->
      <rect x="23" y="9" width="6" height="12" fill="#e74c3c" rx="1"/>
      <rect x="20" y="12" width="12" height="6" fill="#e74c3c" rx="1"/>
      <!-- Bio-shield domes -->
      <circle cx="12" cy="15" r="4" fill="#3498db" opacity="0.8"/>
      <circle cx="34" cy="15" r="4" fill="#3498db" opacity="0.8"/>
      <!-- Engines -->
      <rect x="1" y="11" width="5" height="8" rx="1" fill="#7f8c8d"/>
    `;
}

export function getDestroyerSVG() {
    return `
      <!-- Heavy Destroyer Battle Prow & Hull -->
      <path d="M6 9 L40 5 L64 16 L40 27 L6 23 Z" fill="#2c3e50" stroke="#1a252f" stroke-width="1.5"/>
      <!-- Forward Armor Plates -->
      <polygon points="35,8 58,16 35,24 25,16" fill="#34495e"/>
      <!-- Command Bridge -->
      <polygon points="30,13 42,16 30,19" fill="#e74c3c"/>
      <polygon points="32,14 38,16 32,18" fill="#f39c12"/>
      <!-- Turrets -->
      <circle cx="20" cy="11" r="3" fill="#7f8c8d"/>
      <line x1="20" y1="11" x2="28" y2="9" stroke="#95a5a6" stroke-width="2"/>
      <circle cx="20" cy="21" r="3" fill="#7f8c8d"/>
      <line x1="20" y1="21" x2="28" y2="23" stroke="#95a5a6" stroke-width="2"/>
      <!-- Engines -->
      <rect x="1" y="8" width="5" height="4" fill="#95a5a6"/>
      <rect x="0" y="14" width="6" height="4" fill="#e67e22"/>
      <rect x="1" y="20" width="5" height="4" fill="#95a5a6"/>
    `;
}

export function getEscortFighterSVG() {
    return `
      <!-- Sleek Wingman Fighter -->
      <path d="M22 12 L4 2 L8 12 L4 22 Z" fill="#2980b9"/>
      <path d="M24 12 L10 6 L14 12 L10 18 Z" fill="#3498db"/>
      <polygon points="16,10 20,12 16,14" fill="#00ffff"/>
      <rect x="2" y="5" width="4" height="3" fill="#7f8c8d"/>
      <rect x="2" y="16" width="4" height="3" fill="#7f8c8d"/>
    `;
}

export function startCutscene(callback) {
    if (cutsceneActive) return;
    onCompleteCallback = callback;

    try {
        if (typeof window !== 'undefined' && localStorage.getItem('starshooter_skip_cutscene') === 'true') {
            endCutsceneAndStartGame(true);
            return;
        }
    } catch (e) {}

    cutsceneActive = true;
    state.cutsceneAktiv = true;
    state.spielLaeuft = false;

    const spielfeld = dom.spielfeld || document.getElementById('spielfeld');
    if (!spielfeld) return;

    if (dom.spieler) dom.spieler.style.display = 'none';
    const orphanSelectors = '.boss-rakete, .boss-bombe, .boss-laser, .feind-laser, .laser, .rakete, .bombe, .powerup, .feind, .asteroid, .boss, .partikel, .werfer-abgeworfen, .shockwave, .schockwelle, .cutscene-fireball, .cutscene-shockwave, .cutscene-debris';
    spielfeld.querySelectorAll(orphanSelectors).forEach(el => el.remove());

    // Cutscene DOM Container
    cutsceneContainer = document.getElementById('cutscene-container');
    if (!cutsceneContainer) {
        cutsceneContainer = document.createElement('div');
        cutsceneContainer.id = 'cutscene-container';
        spielfeld.appendChild(cutsceneContainer);
    }
    cutsceneContainer.innerHTML = '';
    cutsceneContainer.style.display = 'block';

    // Skip Button
    const skipBtn = document.createElement('button');
    skipBtn.id = 'cutscene-skip-btn';
    skipBtn.className = 'cutscene-skip-btn';
    skipBtn.innerHTML = 'ESC &bull; ÜBERSPRINGEN';
    skipBtn.setAttribute('title', 'Cutszene mit ESC überspringen');
    skipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        skipCutscene();
    });
    skipBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        skipCutscene();
    }, { passive: false });
    cutsceneContainer.appendChild(skipBtn);

    // Light Beam Element
    const lightBeam = document.createElement('div');
    lightBeam.id = 'cutscene-light-beam';
    lightBeam.className = 'cutscene-light-beam';
    lightBeam.style.display = 'none';
    cutsceneContainer.appendChild(lightBeam);

    // Alien Transmission Overlay Container
    const dialogueContainer = document.createElement('div');
    dialogueContainer.id = 'cutscene-dialogue-container';
    cutsceneContainer.appendChild(dialogueContainer);

    // Convoy ships setup
    const ships = [];

    function createShipElement(type, className, w, h, startX, targetX, baseY, svgContent, isPlayer = false) {
        const el = document.createElement('div');
        el.className = `cutscene-ship ${className}`;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        el.style.left = `${startX}px`;
        el.style.top = `${baseY}px`;
        
        let flameHtml = '';
        if (type === 'freighter') {
            flameHtml = `
              <div class="ship-flame" style="position:absolute; left:-8px; top:8px; transform:rotate(-90deg);"></div>
              <div class="ship-flame" style="position:absolute; left:-8px; top:20px; transform:rotate(-90deg);"></div>
            `;
        } else if (type === 'hospital') {
            flameHtml = `<div class="ship-flame" style="position:absolute; left:-8px; top:11px; transform:rotate(-90deg);"></div>`;
        } else if (type === 'destroyer') {
            flameHtml = `
              <div class="ship-flame" style="position:absolute; left:-8px; top:7px; transform:rotate(-90deg);"></div>
              <div class="ship-flame" style="position:absolute; left:-10px; top:13px; transform:rotate(-90deg);"></div>
              <div class="ship-flame" style="position:absolute; left:-8px; top:19px; transform:rotate(-90deg);"></div>
            `;
        } else if (type === 'player') {
            flameHtml = `
              <div class="ship-flame cutscene-player-flame-1" style="position:absolute; left:-6px; top:6px; transform:rotate(-90deg);"></div>
              <div class="ship-flame cutscene-player-flame-2" style="position:absolute; left:-6px; top:18px; transform:rotate(-90deg);"></div>
            `;
        } else {
            flameHtml = `<div class="ship-flame" style="position:absolute; left:-6px; top:8px; transform:rotate(-90deg);"></div>`;
        }

        el.innerHTML = `
          <svg viewBox="0 0 ${w} ${h}" style="position:absolute; width:100%; height:100%; z-index:2; ${isPlayer ? 'transform:rotate(90deg);' : ''}">
            ${svgContent}
          </svg>
          ${flameHtml}
        `;
        cutsceneContainer.appendChild(el);

        const shipObj = {
            el,
            type,
            x: startX,
            y: baseY,
            targetX,
            baseY,
            w,
            h,
            isPlayer,
            destroyed: false,
            phase: 'flying'
        };
        ships.push(shipObj);
        return shipObj;
    }

    // Convoy formation inside visible viewport:
    const isCoop = state.gameMode === 'coop' || state.gameMode === 'online';
    const targetOffset = isCoop ? 80 : 0;

    // 1. Destroyer (Center-Rear / Heavy)
    createShipElement('destroyer', 'ship-destroyer', 66, 32, -190, 110 + targetOffset, 250, getDestroyerSVG());

    // 2. Freighter (Upper Convoy)
    createShipElement('freighter', 'ship-freighter', 54, 34, -140, 160 + targetOffset, 155, getFreighterSVG());

    // 3. Hospital Ship (Lower Convoy)
    createShipElement('hospital', 'ship-hospital', 50, 30, -150, 150 + targetOffset, 345, getHospitalShipSVG());

    // 4. Escort Fighter 1 (Top flank)
    createShipElement('escort', 'ship-escort', 24, 24, -90, 220 + targetOffset, 95, getEscortFighterSVG());

    // 5. Escort Fighter 2 (Bottom flank)
    createShipElement('escort', 'ship-escort', 24, 24, -100, 210 + targetOffset, 415, getEscortFighterSVG());

    // Player Ships (Center Escort/Lead position)
    const playerShips = [];
    const playerModel = state.selectedShipModel || 'viper';
    const playerColor = state.selectedShipColor || 'red';
    const playerSvg = Utils.getShipSVGContent(playerModel, playerColor);

    if (isCoop) {
        // Spieler 1 (Upper Center Lead)
        const p1Ship = createShipElement('player', 'ship-player ship-player-p1', 30, 30, -80, 215 + targetOffset, 220, playerSvg, true);
        playerShips.push(p1Ship);

        // Spieler 2 (Lower Center Lead)
        const p2Model = (state.p2 && state.p2.selectedShipModel) || 'phantom';
        const p2Color = (state.p2 && state.p2.selectedShipColor) || 'blue';
        const p2Svg = Utils.getShipSVGContent(p2Model, p2Color);
        const p2Ship = createShipElement('player', 'ship-player ship-player-p2', 30, 30, -70, 215 + targetOffset, 280, p2Svg, true);
        playerShips.push(p2Ship);
    } else {
        const p1Ship = createShipElement('player', 'ship-player ship-player-p1', 30, 30, -70, 215, 250, playerSvg, true);
        playerShips.push(p1Ship);
    }

    // Animation Loop: Camera tracks convoy while stars stream rapidly by
    let lastTime = performance.now();
    let cutsceneStartTime = performance.now();
    function animateConvoy(time) {
        if (!cutsceneActive) return;
        const dt = Math.min(32, time - lastTime);
        lastTime = time;
        const elapsed = time - cutsceneStartTime;

        ships.forEach((ship, idx) => {
            if (!ship.destroyed) {
                if (ship.phase === 'flying') {
                    // Smooth approach into cruising formation
                    if (ship.x < ship.targetX - 1) {
                        const dist = ship.targetX - ship.x;
                        const step = Math.max(0.8, Math.min(4.0, dist * 0.05)) * (dt / 16.6);
                        ship.x += step;
                    } else {
                        // Cruising in formation (subtle station keeping drift)
                        ship.x = ship.targetX + Math.sin(time / 800 + idx) * 3;
                    }
                    
                    // Organic formation bobbing
                    const bobY = Math.sin(time / 650 + idx * 1.4) * 3.5;
                    ship.y = ship.baseY + bobY;

                    ship.el.style.left = `${ship.x}px`;
                    ship.el.style.top = `${ship.y}px`;
                }
            }
        });

        // Fast horizontal star movement simulates high-speed camera tracking alongside convoy
        arrays.sterne.forEach(stern => {
            stern.x -= (stern.speed * 2.5) * (dt / 16.6);
            if (stern.x < -10) {
                stern.x = config.spielfeldBreite + 10;
                stern.y = Math.random() * config.spielfeldHoehe;
            }
            stern.el.style.left = stern.x + 'px';
            stern.el.style.top = stern.y + 'px';
        });

        // Update cutscene flying debris fragments
        for (let i = cutsceneDebrisArray.length - 1; i >= 0; i--) {
            const debris = cutsceneDebrisArray[i];
            debris.x += debris.vx * (dt / 16.6);
            debris.y += debris.vy * (dt / 16.6);
            debris.rot += debris.rotSpeed * (dt / 16.6);
            debris.life -= debris.decay * (dt / 16.6);

            debris.el.style.left = `${debris.x}px`;
            debris.el.style.top = `${debris.y}px`;
            debris.el.style.transform = `rotate(${debris.rot}deg) scale(${debris.life})`;
            debris.el.style.opacity = Math.max(0, debris.life);

            if (debris.life <= 0) {
                debris.el.remove();
                cutsceneDebrisArray.splice(i, 1);
            }
        }

        cutsceneAnimationId = requestAnimationFrame(animateConvoy);
    }
    cutsceneAnimationId = requestAnimationFrame(animateConvoy);

    // --- TIMELINE SEQUENCES ---

    // Phase 2: Alien Dialogue Bubbles (Start at ~2.2s)
    const alienMessages = [
        {
            avatar: '👽',
            sender: 'UNBEKANNTE TRANSMISSION',
            text: '⍙⟒ ⏁⍀⏃⎐⟒⌰ ⏁⊑⍀ᚑ⎍☌⊑ ⏁⊑⟒ ⎐ᚑ⟟⎅...',
            delay: 2200,
            duration: 2000
        },
        {
            avatar: '⚡',
            sender: 'FREMDKÖRPER-SIGNAL',
            text: '⍟⍭ ⍎⍑⍕ ⍞⍡! ⍝⍜⍯ ⏁⏃⍀☌⟒⏁ ⌰ᚑ⠉☍⟒⎅!',
            delay: 4400,
            duration: 2000
        },
        {
            avatar: '⚠️',
            sender: 'ALARM: SCHWERE ANOMALIE',
            text: '⚠ ⏁⊑⟒⊬ ⏃⍀⟒ ⊑⟒⍀⟒... ⍀⎍⋏! ⚠',
            delay: 6600,
            duration: 1800
        }
    ];

    alienMessages.forEach((msg, idx) => {
        const timeout = setTimeout(() => {
            if (!cutsceneActive) return;
            showAlienSpeechBubble(msg.avatar, msg.sender, msg.text, msg.duration);
            Audio.playAlienChatter();
        }, msg.delay);
        cutsceneTimeouts.push(timeout);
    });

    // Phase 3: Sudden Heavy Artillery Barrage (Start at ~8.5s while all ships are in visible center)
    const attackStrikes = [
        { type: 'escort', index: 0, delay: 8600 },
        { type: 'hospital', delay: 9200 },
        { type: 'freighter', delay: 9900 },
        { type: 'destroyer', delay: 10600 },
        { type: 'escort', index: 1, delay: 11300 }
    ];

    attackStrikes.forEach(strike => {
        const timeout = setTimeout(() => {
            if (!cutsceneActive) return;
            let targetShip = null;
            if (strike.type === 'escort') {
                const escorts = ships.filter(s => s.type === 'escort' && !s.destroyed);
                targetShip = escorts[0];
            } else {
                targetShip = ships.find(s => s.type === strike.type && !s.destroyed);
            }

            if (targetShip) {
                fireInvisibleCannonAt(targetShip);
            }
        }, strike.delay);
        cutsceneTimeouts.push(timeout);
    });

    // Phase 4: Light Beam from above & Player Ascension (Start at ~12.2s)
    const lightTimeout = setTimeout(() => {
        if (!cutsceneActive) return;
        
        // Switch player ships to ascending phase and glide to center
        playerShips.forEach((pShip, pIdx) => {
            pShip.phase = 'ascending';
            pShip.el.style.transition = 'left 0.8s ease, top 0.8s ease';
            if (isCoop) {
                pShip.x = (pIdx === 0) ? 270 : 330;
                pShip.y = 260;
            } else {
                pShip.x = 185;
                pShip.y = 260;
            }
            pShip.el.style.left = `${pShip.x}px`;
            pShip.el.style.top = `${pShip.y}px`;
        });

        // Beam of light from top
        lightBeam.style.display = 'block';
        lightBeam.classList.add('cutscene-beam-active');
        if (isCoop) {
            lightBeam.style.width = '240px';
        }
        Audio.playLightBeamWhoosh();

        // Screen subtle flash
        if (dom.spielfeld) {
            dom.spielfeld.style.boxShadow = 'inset 0 0 50px rgba(52, 152, 219, 0.6)';
        }

        // Rotate player ships upwards
        setTimeout(() => {
            if (!cutsceneActive) return;
            playerShips.forEach(pShip => {
                const playerSvgEl = pShip.el.querySelector('svg');
                if (playerSvgEl) {
                    playerSvgEl.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
                    playerSvgEl.style.transform = 'rotate(0deg)';
                }
                const flames = pShip.el.querySelectorAll('.ship-flame');
                flames.forEach(f => {
                    f.style.transform = 'rotate(0deg)';
                });
                const flame1 = pShip.el.querySelector('.cutscene-player-flame-1');
                const flame2 = pShip.el.querySelector('.cutscene-player-flame-2');
                if (flame1) { flame1.style.left = '7.5px'; flame1.style.top = '27px'; }
                if (flame2) { flame2.style.left = '19.5px'; flame2.style.top = '27px'; }
            });
        }, 600);

        // Accelerate into the light (upwards)
        setTimeout(() => {
            if (!cutsceneActive) return;
            playerShips.forEach(pShip => {
                pShip.el.style.transition = 'top 0.8s cubic-bezier(0.55, 0.055, 0.675, 0.19), transform 0.8s ease';
                pShip.el.style.top = '-80px';

                // Boost particles
                for (let i = 0; i < 15; i++) {
                    Utils.erzeugeAntriebsRauch(pShip.x + 15, pShip.y + 30, 4);
                }
            });
        }, 1300);

        // Phase 5: Smooth Transition into the Game (~2.2s after light)
        setTimeout(() => {
            if (!cutsceneActive) return;
            endCutsceneAndStartGame();
        }, 2200);

    }, 12200);
    cutsceneTimeouts.push(lightTimeout);
}

function createCutsceneFireball(x, y, size = 90, colorGlow = '#f39c12') {
    if (!cutsceneContainer) return;
    const fb = document.createElement('div');
    fb.className = 'cutscene-fireball';
    fb.style.left = `${x}px`;
    fb.style.top = `${y}px`;
    fb.style.setProperty('--fireball-size', `${size}px`);
    fb.style.boxShadow = `0 0 40px ${colorGlow}, 0 0 70px #e74c3c`;
    cutsceneContainer.appendChild(fb);
    setTimeout(() => fb.remove(), 600);
}

function createCutsceneShockwave(x, y, size = 130) {
    if (!cutsceneContainer) return;
    const sw = document.createElement('div');
    sw.className = 'cutscene-shockwave';
    sw.style.left = `${x}px`;
    sw.style.top = `${y}px`;
    sw.style.setProperty('--shockwave-size', `${size}px`);
    cutsceneContainer.appendChild(sw);
    setTimeout(() => sw.remove(), 500);
}

function spawnCutsceneDebris(x, y, count = 12, colors = ['#2c3e50', '#7f8c8d', '#e67e22', '#e74c3c', '#f1c40f']) {
    if (!cutsceneContainer) return;
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'cutscene-debris';
        const w = 4 + Math.random() * 8;
        const h = 4 + Math.random() * 8;
        const col = colors[Math.floor(Math.random() * colors.length)];
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        el.style.backgroundColor = col;
        el.style.borderRadius = Math.random() < 0.5 ? '2px' : '0px';
        el.style.boxShadow = Math.random() < 0.6 ? `0 0 6px ${col}` : 'none';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        cutsceneContainer.appendChild(el);

        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 4.5;
        cutsceneDebrisArray.push({
            el,
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            rot: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 25,
            life: 1.0,
            decay: 0.02 + Math.random() * 0.015
        });
    }
}

function showAlienSpeechBubble(avatar, sender, text, duration) {
    const container = document.getElementById('cutscene-dialogue-container');
    if (!container) return;

    const bubble = document.createElement('div');
    bubble.className = 'alien-speech-bubble';
    bubble.innerHTML = `
      <div class="alien-bubble-header">
        <span class="alien-avatar">${avatar}</span>
        <span class="alien-sender">${sender}</span>
      </div>
      <div class="alien-text">${text}</div>
    `;
    container.appendChild(bubble);

    // Auto remove after duration
    const t = setTimeout(() => {
        bubble.classList.add('alien-bubble-fadeout');
        setTimeout(() => bubble.remove(), 400);
    }, duration);
    cutsceneTimeouts.push(t);
}

function fireInvisibleCannonAt(ship) {
    Audio.playIncomingArtillery();

    // Red/purple heavy tracer blast line
    const tracer = document.createElement('div');
    tracer.className = 'cutscene-cannon-blast';
    const startX = Math.random() < 0.5 ? -30 : config.spielfeldBreite + 30;
    const startY = Math.random() * 200;
    tracer.style.left = `${startX}px`;
    tracer.style.top = `${startY}px`;

    const dx = (ship.x + ship.w / 2) - startX;
    const dy = (ship.y + ship.h / 2) - startY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    tracer.style.width = `${length}px`;
    tracer.style.transform = `rotate(${angle}deg)`;
    if (cutsceneContainer) cutsceneContainer.appendChild(tracer);

    setTimeout(() => {
        tracer.remove();
        if (!cutsceneActive) return;

        // Flash ship hull white
        ship.el.classList.add('ship-hit-flash');
        Audio.playHit('enemy');

        // Pre-hit spark
        const centerX = ship.x + ship.w / 2;
        const centerY = ship.y + ship.h / 2;
        createCutsceneFireball(centerX + 8, centerY - 4, 45, '#f1c40f');

        setTimeout(() => {
            if (!cutsceneActive) return;

            // Destroy target ship
            ship.destroyed = true;
            ship.el.style.opacity = '0';
            ship.el.style.pointerEvents = 'none';

            const fireballSize = ship.type === 'destroyer' ? 125 : ship.type === 'freighter' ? 100 : ship.type === 'hospital' ? 90 : 70;
            const shockwaveSize = ship.type === 'destroyer' ? 170 : ship.type === 'freighter' ? 145 : ship.type === 'hospital' ? 130 : 105;
            const debrisCount = ship.type === 'destroyer' ? 20 : ship.type === 'freighter' ? 16 : 12;

            // Trigger massive cinematic fireball & shockwave
            createCutsceneFireball(centerX, centerY, fireballSize, ship.type === 'hospital' ? '#3498db' : '#f39c12');
            createCutsceneShockwave(centerX, centerY, shockwaveSize);
            spawnCutsceneDebris(centerX, centerY, debrisCount);

            // Audio explosions
            Audio.playExplosion(ship.type === 'destroyer' ? 'boss' : 'medium');
            if (ship.type === 'destroyer' || ship.type === 'freighter') {
                setTimeout(() => {
                    if (cutsceneActive) {
                        createCutsceneFireball(centerX - 15, centerY + 10, 60, '#e74c3c');
                        Audio.playExplosion('small');
                    }
                }, 120);
            }

            // Screen shake
            if (dom.spielfeld) {
                dom.spielfeld.classList.add('screen-shake');
                setTimeout(() => dom.spielfeld.classList.remove('screen-shake'), 300);
            }

            setTimeout(() => ship.el.remove(), 100);
        }, 90);
    }, 100);
}

export function skipCutscene(isRemote = false) {
    if (!cutsceneActive) return;
    endCutsceneAndStartGame(true);
    if (!isRemote && state.network && state.network.isOnline && state.network.connected) {
        Network.sendNetworkEvent({ type: 'skip_cutscene' });
    }
}

function endCutsceneAndStartGame(instant = false) {
    clearAllTimers();
    cutsceneActive = false;
    state.cutsceneAktiv = false;

    // Reset styles
    if (dom.spielfeld) {
        dom.spielfeld.style.boxShadow = '';
        dom.spielfeld.classList.remove('screen-shake');
    }

    // Clean up cutscene DOM container
    if (cutsceneContainer) {
        cutsceneContainer.innerHTML = '';
        cutsceneContainer.style.display = 'none';
    }

    // Handover to actual game
    state.spielLaeuft = true;
    let startScreen = document.getElementById('start-screen');
    if (startScreen) startScreen.style.display = 'none';
    Utils.updateMobileControlsVisibility();

    const isCoop = state.gameMode === 'coop' || state.gameMode === 'online';

    // Apply ship model perks
    const currentShip = shipModels && shipModels[state.selectedShipModel || 'viper'];
    if (currentShip && currentShip.startShield > 0) {
        state.schildStufe = currentShip.startShield;
        dom.spieler.classList.add(`schild-aktiv-${state.schildStufe}`);
        Utils.updateAktivePowerupsUI();
    }

    state.isDead = false;
    state.x = isCoop ? 200 : 185;
    dom.spieler.style.left = state.x + 'px';
    dom.spieler.style.display = 'block';
    dom.spieler.style.transform = 'rotate(0deg)';
    dom.spieler.setAttribute('data-rotate', '0');

    // P2 Setup
    if (isCoop && dom.spieler2 && state.p2) {
        state.p2.isDead = false;
        const p2Ship = shipModels && shipModels[state.p2.selectedShipModel || 'phantom'];
        if (p2Ship && p2Ship.startShield > 0) {
            state.p2.schildStufe = p2Ship.startShield;
            dom.spieler2.classList.add(`schild-aktiv-${state.p2.schildStufe}`);
        }
        state.p2.x = 370;
        state.p2.y = instant ? 285 : config.spielfeldHoehe + 40;
        dom.spieler2.style.left = state.p2.x + 'px';
        dom.spieler2.style.top = state.p2.y + 'px';
        dom.spieler2.style.display = 'block';
        dom.spieler2.style.transform = 'rotate(0deg)';
        dom.spieler2.setAttribute('data-rotate', '0');

        const tagP1 = document.querySelector('.tag-p1');
        if (tagP1) tagP1.style.display = 'block';

        if (dom.uiContainerP2) dom.uiContainerP2.style.display = 'flex';
        Utils.updateP2UI();
    } else {
        if (dom.spieler2) dom.spieler2.style.display = 'none';
        if (dom.uiContainerP2) dom.uiContainerP2.style.display = 'none';
        const tagP1 = document.querySelector('.tag-p1');
        if (tagP1) tagP1.style.display = 'none';
    }

    if (instant) {
        state.y = 285;
        dom.spieler.style.top = state.y + 'px';
        if (isCoop && state.p2 && dom.spieler2) {
            state.p2.y = 285;
            dom.spieler2.style.top = state.p2.y + 'px';
        }
    } else {
        // Smooth entry: Player ship enters from bottom into play position
        state.y = config.spielfeldHoehe + 40;
        dom.spieler.style.top = state.y + 'px';
        if (isCoop && state.p2 && dom.spieler2) {
            state.p2.y = config.spielfeldHoehe + 40;
            dom.spieler2.style.top = state.p2.y + 'px';
        }

        let entryY = config.spielfeldHoehe + 40;
        const targetY = 285;
        function flyInStep() {
            if (!state.spielLaeuft || state.gameOverAktiv) return;
            if (entryY > targetY) {
                entryY -= 6;
                if (entryY < targetY) entryY = targetY;
                state.y = entryY;
                dom.spieler.style.top = state.y + 'px';
                Utils.erzeugeAntriebsRauch(state.x + 15, state.y + 30, 2);
                if (isCoop && state.p2 && dom.spieler2 && !state.p2.isDead) {
                    state.p2.y = entryY;
                    dom.spieler2.style.top = state.p2.y + 'px';
                    Utils.erzeugeAntriebsRauch(state.p2.x + 15, state.p2.y + 30, 2);
                }
                requestAnimationFrame(flyInStep);
            }
        }
        requestAnimationFrame(flyInStep);
    }

    // Clear initial keypresses
    state.tastenGedrueckt[' '] = false;
    state.tastenGedrueckt.k = false;
    state.tastenGedrueckt.l = false;
    state.tastenGedrueckt.b = false;
    state.tastenGedrueckt.v = false;
    state.tastenGedrueckt.c = false;
    state.tastenGedrueckt.ä = false;
    state.tastenGedrueckt.ö = false;

    if (typeof onCompleteCallback === 'function') {
        onCompleteCallback();
        onCompleteCallback = null;
    }
}
