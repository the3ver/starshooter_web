// Viper-X: Ausweichrolle. Doppeltipp auf links/rechts (Tasten) bzw. schnelles seitliches Wischen auf der
// Joystick-Zone startet eine Rolle: ROLLE_FRAMES Schritte lang wird das Schiff gleichmaessig um ROLLE_DISTANZ px
// zur Seite versetzt, die normale Steuerung ruht und das Schiff ist unverwundbar (Utils.istDashUnverwundbar
// wertet viperRolleTimer mit aus). Danach ROLLE_COOLDOWN Schritte Pause (ab Rollenstart).
// pState ist `state` (P1) oder `state.p2`, pKey 'p1' / 'p2'.
// Zustand pro Spieler: viperRolleTimer (Rest-Schritte inkl. aktuellem), viperRolleRichtung (+1 rechts / -1 links),
// viperRolleCooldown, Erkennung: viperLinksGehalten/viperRechtsGehalten (Tasten-Flanken), viperTapRichtung/
// viperTapAlter (letzter Tipp und Schritte seitdem), viperJoyRuhe/viperJoyVorher (Wischen).

import { state, config, arrays, shipColors, isCoopMode } from './state.js';
import * as Audio from './audio.js';
import * as Hack from './hack.js';
import { createParticles } from './partikel.js';

export const ROLL_FRAMES = 12;
export const ROLL_DISTANCE = 70;
export const ROLL_COOLDOWN = 90;
export const DOUBLE_TAP_WINDOW = 15; // Schritte zwischen zwei Druck-Flanken (250 ms bei 60 Hz)
export const SWIPE_WINDOW = 8; // Schritte vom Ruhebereich (|x| < 0.2) bis |x| > 0.8
const SWIPE_REST = 0.2;
const SWIPE_THRESHOLD = 0.8;

// Near-Miss + Overdrive: Ein feindliches Geschoss, das dem Schiff auf <= NEAR_MISS_ABSTAND px nahe kommt, ohne zu
// treffen, und sich dann wieder entfernt, laedt die Leiste (0..100) um NEAR_MISS_LADUNG. Bei 100 startet der
// Overdrive fuer OVERDRIVE_DAUER Schritte (Leiste leert sich sichtbar): doppelte Feuerrate des Projektil-Lasers und
// Durchschlag. Erkennung nur auf dem Host/Solo (pruefeNearMiss, einmal pro Schritt ueber alle Geschosslisten).
export const NEAR_MISS_DISTANCE = 18;
export const NEAR_MISS_CHARGE = 10;
export const OVERDRIVE_DURATION = 300;

// Kill-Kombo (V3, ersetzt den Upgrade-Verlust): Jeder Kill des Spielers (Utils.zerstoereZiel) binnen KOMBO_FENSTER
// Schritten nach dem letzten Kill erhoeht viperKombo um 1; laeuft das Fenster ab, faellt sie auf 0, jeder Treffer
// am Schiff (auch vom Schild abgefangen) setzt sie auf 0. Punkte aus Kills x (1 + 0.1 * Kombo), hoechstens x3;
// Projektil-Laser-Cooldown ab Kombo 5 -> 5, ab Kombo 10 -> 4 (Overdrive = 3 bleibt das Minimum).
export const COMBO_WINDOW = 120;
export const COMBO_STEP = 0.1;
export const COMBO_MAX_FACTOR = 3;
export const COMBO_SOUND_TIERS = [5, 10, 20];

export function isViper(pState) {
  return !!pState && pState.selectedShipModel === 'viper';
}

export function isRollActive(pState) {
  return !!pState && (pState.viperRollTimer || 0) > 0;
}

export function isOverdrive(pState) {
  return !!pState && pState.selectedShipModel === 'viper' && (pState.viperOverdriveTimer || 0) > 0;
}

// Punkte-Multiplikator fuer Kills dieses Spielers (nur Viper; 1 + 0.1 * Kombo, max 3)
export function comboFactor(pState) {
  if (!isViper(pState)) return 1;
  return Math.min(COMBO_MAX_FACTOR, 1 + COMBO_STEP * (pState.viperCombo || 0));
}

// Projektil-Laser-Cooldown in Schritten: normal 6, Kombo >= 5 -> 5, >= 10 -> 4, Overdrive 3 (Minimum)
export function shotCooldown(pState) {
  if (isOverdrive(pState)) return 3;
  const combo = isViper(pState) ? pState.viperCombo || 0 : 0;
  return combo >= 10 ? 4 : combo >= 5 ? 5 : 6;
}

// Ein Kill dieses Spielers (nach der Punktevergabe): Kombo +1, Fenster neu starten, Sound bei 5/10/20
export function registerKill(pState) {
  if (!isViper(pState)) return;
  pState.viperCombo = (pState.viperCombo || 0) + 1;
  pState.viperComboTimer = COMBO_WINDOW;
  const tier = COMBO_SOUND_TIERS.indexOf(pState.viperCombo) + 1;
  if (tier > 0) Audio.playCombo(tier);
}

export function resetCombo(pState) {
  if (!pState) return;
  pState.viperCombo = 0;
  pState.viperComboTimer = 0;
}

// Fenster herunterzaehlen (nur Host/Solo/Bot; der Online-Client uebernimmt den Stand aus dem Snapshot)
function tickCombo(p) {
  if ((p.viperComboTimer || 0) > 0) {
    p.viperComboTimer--;
    if (p.viperComboTimer <= 0) p.viperCombo = 0;
  }
}

function shipColor(pState) {
  const c = shipColors[pState.selectedShipColor];
  return c ? c.prim : '#ffffff';
}

// Doppeltipp (zwei Druck-Flanken derselben Richtung binnen DOPPELTIPP_FENSTER Schritten) oder Wisch-Flick des
// Joysticks. Liefert die physische Richtung (+1 rechts, -1 links, 0 keine). Laeuft jeden Schritt, auch waehrend
// Rolle und Cooldown, damit die Flanken nie verloren gehen.
function detectDirection(p, e) {
  let direction = 0;
  p.viperTapAlter = Math.min((p.viperTapAlter || 0) + 1, 999);
  const flankL = Boolean(e.left) && !p.viperLeftHeld;
  const flankR = Boolean(e.right) && !p.viperRightHeld;
  p.viperLeftHeld = Boolean(e.left);
  p.viperRightHeld = Boolean(e.right);
  const flank = flankL === flankR ? 0 : flankR ? 1 : -1;
  if (flank) {
    if (flank === p.viperTapDirection && p.viperTapAlter <= DOUBLE_TAP_WINDOW) {
      direction = flank;
      p.viperTapDirection = 0;
    } else {
      p.viperTapDirection = flank;
    }
    p.viperTapAlter = 0;
  }

  // Mobil: Joystick-x springt binnen WISCH_FENSTER Schritten aus der Ruhe ueber die Schwelle. Eine Fingerbewegung
  // von der Mitte zum Rand ist damit ein Wisch, langsames Hineinziehen oder Halten am Rand loest nichts aus.
  if (e.joyX !== undefined) {
    const amount = Math.abs(e.joyX);
    p.viperJoyRest = amount < SWIPE_REST ? 0 : Math.min((p.viperJoyRest || 0) + 1, 99);
    if (amount > SWIPE_THRESHOLD && (p.viperJoyBeforehand || 0) <= SWIPE_THRESHOLD && p.viperJoyRest <= SWIPE_WINDOW) {
      direction = e.joyX > 0 ? 1 : -1;
    }
    p.viperJoyBeforehand = amount;
  }
  return direction;
}

// Steuerungs-Hacks lenken die Rolle wie eine normale Seitwaertsbewegung um (0 = nicht seitlich, keine Rolle)
export function directionAfterHack(pState, direction) {
  if (!direction) return 0;
  return Math.sign(Hack.hackMovement(pState, direction, 0).dx);
}

function canRoll(p) {
  return !p.isDead && !isRollActive(p) && (p.viperRollCooldown || 0) <= 0;
}

function startRoll(p, direction) {
  p.viperRollTimer = ROLL_FRAMES;
  p.viperRollDirection = direction;
  p.viperRollCooldown = ROLL_COOLDOWN;
  // Online-Client: Startposition und Richtung gehen im Eingabe-Paket zum Host (siehe netzEingabe)
  p.viperNetworkStart = { x: p.x, y: p.y, ro: direction };
  Audio.playRoll();
}

function rollStep(p) {
  p.x = Math.max(
    0,
    Math.min(config.playfieldWidth - config.playerSize, p.x + (p.viperRollDirection * ROLL_DISTANCE) / ROLL_FRAMES),
  );
  createAfterimage(p);
}

// Ein Schritt fuer ein Viper-Schiff, vor der normalen Steuerung. eingabe: { links, rechts, joyX } (physische Tasten
// bzw. Joystick, Hacks wendet diese Funktion an) oder null; anfrage: fertige Richtung von Bot bzw. Online-Host
// (Hacks schon angewendet). Liefert true, wenn die Rolle in diesem Schritt die Bewegung uebernimmt.
export function updateViper(pState, pKey, input, request = 0) {
  if ((pState.viperRollTimer || 0) > 0) pState.viperRollTimer--;
  if ((pState.viperRollCooldown || 0) > 0) pState.viperRollCooldown--;
  pState.viperNetworkStart = null;
  tickOverdrive(pState);
  if (!(state.network && state.network.isOnline && !state.network.isHost)) tickCombo(pState);

  if (pState.isDead) {
    pState.viperRollTimer = 0;
    pState.viperOverdriveTimer = 0;
    pState.viperOverdriveStrip = 0;
    resetCombo(pState);
    return false;
  }

  let wish = request || 0;
  if (input) wish = directionAfterHack(pState, detectDirection(pState, input)) || wish;
  if (wish && canRoll(pState)) startRoll(pState, wish);

  const rolls = isRollActive(pState);
  if (rolls) rollStep(pState);
  return rolls;
}

// Overdrive-Restzeit herunterzaehlen, die Leiste folgt (ganzzahlig, 100 -> 0 ueber die Dauer)
function tickOverdrive(p) {
  if ((p.viperOverdriveTimer || 0) > 0) {
    p.viperOverdriveTimer--;
    p.viperOverdriveStrip = Math.ceil((p.viperOverdriveTimer * 100) / OVERDRIVE_DURATION);
  }
}

// Abstand zweier Rechtecke (0 bei Ueberlappung): Luecken in x und y als Euklid
function rectDistance(ax, ay, aw, ah, bx, by, bw, bh) {
  const dx = Math.max(bx - (ax + aw), ax - (bx + bw), 0);
  const dy = Math.max(by - (ay + ah), ay - (by + bh), 0);
  return Math.hypot(dx, dy);
}

// Marke am Geschoss: undefined = nie nah, Zahl = kleinster Abstand bisher (nah dran), true = schon gezaehlt
function nearMissFor(p, markKey, projectiles) {
  const g = config.playerSize;
  for (const list of projectiles) {
    for (const s of list) {
      if (s.harmless || s[markKey] === true) continue;
      const distance = rectDistance(p.x, p.y, g, g, s.x, s.y, s.width, s.height);
      if (distance <= NEAR_MISS_DISTANCE) {
        if (typeof s[markKey] !== 'number' || distance < s[markKey]) s[markKey] = distance;
        else if (distance > s[markKey]) {
          s[markKey] = true;
          tallyNearMiss(p);
        } // entfernt sich wieder
      } else if (typeof s[markKey] === 'number') {
        s[markKey] = true; // war nah dran und ist jetzt weiter weg
        tallyNearMiss(p);
      }
    }
  }
}

function tallyNearMiss(p) {
  if ((p.viperOverdriveTimer || 0) > 0) return; // waehrend des Overdrives laedt nichts nach
  p.viperOverdriveStrip = Math.min(100, (p.viperOverdriveStrip || 0) + NEAR_MISS_CHARGE);
  if (p.viperOverdriveStrip >= 100) {
    p.viperOverdriveTimer = OVERDRIVE_DURATION;
    Audio.playOverdrive();
  } else {
    Audio.playNearMiss();
  }
  showNearMissPlus(p);
}

// Einmal pro Simulationsschritt (loop.js, nach allen Geschoss-Bewegungen und Treffern); nur Host bzw. Solo.
// Zentral statt in gegner.js/boss.js: eine Stelle fuer alle vier Listen, Treffer haben das Geschoss schon entfernt.
export function checkNearMiss() {
  const listen = [arrays.enemyLaserArray, arrays.bossLaserArray, arrays.hackProjectileArray, arrays.bossMissileArray];
  if (isViper(state) && !state.isDead) nearMissFor(state, 'nearMissP1', listen);
  if (isCoopMode() && state.p2 && isViper(state.p2) && !state.p2.isDead) nearMissFor(state.p2, 'nearMissP2', listen);
}

// Kleines Plus am Schiff (sparsam: ein Zeichen, steigt kurz auf)
function showNearMissPlus(p) {
  createParticles({
    sort: 'nearMissPlus',
    x: p.x + config.playerSize / 2 - 4,
    y: p.y - 6,
    vx: 0,
    vy: -1.5,
    lives: 0.8,
    decay: 0.06,
  });
}

// Tastenzustand eines Spielers fuer aktualisiereViper (Joystick nur, wenn er aktiv ist)
export function inputFromKeys(left, right, joystick) {
  return { left, right, joyX: joystick && joystick.active ? joystick.x : 0 };
}

// --- ONLINE ---
// Der Client sagt seine eigene Rolle mit derselben Funktion voraus (aktualisiereViper). Im Startschritt traegt das
// Eingabe-Paket Startposition und Richtung (ro); der Host startet von dort dieselbe Rolle, ignoriert waehrenddessen
// Client-Positionen und ist fuer Treffer massgeblich. Der Snapshot bringt Timer/Richtung/Cooldown fuer die Anzeige
// (P1 des Hosts) und gleicht den Cooldown des Clients nach oben ab.

export function networkInput(pState) {
  return pState.viperNetworkStart || null;
}

export function applySnapshot(pState, payload, ownOne) {
  if (!payload || payload.viperRollTimer === undefined) return;
  // Kombo: Host ist massgeblich; Sound fuer das eigene Schiff beim Erreichen von 5/10/20
  const combo = payload.viperCombo || 0;
  if (ownOne) {
    const tier = COMBO_SOUND_TIERS.filter(s => combo >= s).length;
    const old = COMBO_SOUND_TIERS.filter(s => (pState.viperCombo || 0) >= s).length;
    if (tier > old) Audio.playCombo(tier);
  }
  pState.viperCombo = combo;
  pState.viperComboTimer = payload.viperComboTimer || 0;
  // Overdrive: Host ist massgeblich; Sounds nur fuer das eigene Schiff, bei Aenderung
  const strip = payload.viperOverdriveStrip || 0;
  const odTimer = payload.viperOverdriveTimer || 0;
  if (ownOne) {
    if (odTimer > 0 && !((pState.viperOverdriveTimer || 0) > 0)) Audio.playOverdrive();
    else if (strip > (pState.viperOverdriveStrip || 0) && odTimer <= 0) Audio.playNearMiss();
  }
  pState.viperOverdriveStrip = strip;
  pState.viperOverdriveTimer = odTimer;
  const cooldown = payload.viperRollCooldown || 0;
  if (ownOne) {
    // Rolle laeuft lokal vorhergesagt; der Cooldown des Hosts gilt, wenn er laenger ist
    if (cooldown > (pState.viperRollCooldown || 0)) pState.viperRollCooldown = cooldown;
    return;
  }
  const timer = payload.viperRollTimer || 0;
  if (timer > 0 && !isRollActive(pState)) Audio.playRoll();
  pState.viperRollTimer = timer;
  pState.viperRollDirection = payload.viperRollDirection || 0;
  pState.viperRollCooldown = cooldown;
}

// Pro Client-Schritt: Nachbilder und Bereitschaftsanzeige (Klassen viper-rolle/-overdrive leitet die Anzeige ab).
// Fremde Schiffe (P1 des Hosts) zaehlen den Timer zwischen den Snapshots selbst herunter, das eigene Schiff macht
// aktualisiereViper.
export function showViperStatus(pState, pKey, ownOne) {
  const viper = isViper(pState) && !pState.isDead;
  const rolls = viper && isRollActive(pState);
  // Fremdes Schiff (P1 des Hosts): Overdrive-Zeit zwischen den Snapshots selbst herunterzaehlen
  if (!ownOne && viper) tickOverdrive(pState);
  if (rolls && !ownOne) {
    createAfterimage(pState);
    pState.viperRollTimer--;
    if ((pState.viperRollCooldown || 0) > 0) pState.viperRollCooldown--;
  }
  showRollHud(pKey, pState);
}

// --- HUD ---

const hudStatus = { p1: '', p2: '' };

// Kleiner Bereitschaftsbalken neben dem Energiebalken, nur bei Viper (P2 nur, wenn P2 mitspielt)
export function showRollHud(pKey, pState, visible = true) {
  const el = document.getElementById(pKey === 'p2' ? 'viper-rolle-hud-p2' : 'viper-rolle-hud');
  if (!el) return;
  const show = visible && isViper(pState);
  const cd = pState ? pState.viperRollCooldown || 0 : 0;
  const ready = show && cd <= 0 && !isRollActive(pState);
  const fill = show ? Math.round((1 - cd / ROLL_COOLDOWN) * 100) : 0;
  showOverdriveHud(pKey, pState, show);
  showComboHud(pKey, pState, show);
  const signature = `${show}|${ready}|${fill}`;
  if (hudStatus[pKey] === signature) return;
  hudStatus[pKey] = signature;
  el.style.display = show ? 'block' : 'none';
  el.classList.toggle('bereit', ready);
  const bar = /** @type {HTMLElement} */ (el.firstElementChild);
  if (bar) bar.style.width = Math.max(0, Math.min(100, fill)) + '%';
}

const comboHudValue = { p1: 0, p2: 0 };

// Kombo-Anzeige unter dem Score ("KOMBO 7 · x1.7"), ausgeblendet bei 0; kurzer Puls bei Erhoehung
function showComboHud(pKey, pState, show) {
  const el = document.getElementById(pKey === 'p2' ? 'viper-kombo-hud-p2' : 'viper-kombo-hud');
  if (!el) return;
  const combo = show && pState ? Math.max(0, Math.round(pState.viperCombo || 0)) : 0;
  if (combo === comboHudValue[pKey]) return;
  const rose = combo > comboHudValue[pKey];
  comboHudValue[pKey] = combo;
  el.style.display = combo > 0 ? 'block' : 'none';
  if (combo > 0)
    el.textContent = 'KOMBO ' + combo + ' · x' + Math.min(COMBO_MAX_FACTOR, 1 + COMBO_STEP * combo).toFixed(1);
  el.classList.remove('puls');
  if (rose) {
    void el.offsetWidth; // Animation neu starten
    el.classList.add('puls');
  }
}

const odHudStatus = { p1: '', p2: '' };

// Overdrive-Leiste neben dem Rollenbalken (gelb waehrend des Overdrives)
function showOverdriveHud(pKey, pState, show) {
  const el = document.getElementById(pKey === 'p2' ? 'viper-overdrive-hud-p2' : 'viper-overdrive-hud');
  if (!el) return;
  const strip = show && pState ? Math.max(0, Math.min(100, Math.round(pState.viperOverdriveStrip || 0))) : 0;
  const active = show && isOverdrive(pState);
  const signature = `${show}|${active}|${strip}`;
  if (odHudStatus[pKey] === signature) return;
  odHudStatus[pKey] = signature;
  el.style.display = show ? 'block' : 'none';
  el.classList.toggle('aktiv', active);
  const bar = /** @type {HTMLElement} */ (el.firstElementChild);
  if (bar) bar.style.width = strip + '%';
}

export function reset(pState) {
  pState.viperOverdriveStrip = 0;
  pState.viperOverdriveTimer = 0;
  resetCombo(pState);
  pState.viperRollTimer = 0;
  pState.viperRollDirection = 0;
  pState.viperRollCooldown = 0;
  pState.viperLeftHeld = false;
  pState.viperRightHeld = false;
  pState.viperTapDirection = 0;
  pState.viperTapAlter = 999;
  pState.viperJoyRest = 0;
  pState.viperJoyBeforehand = 0;
  pState.viperNetworkStart = null;
  // Bot und Online-Host: gemerkte Rollenwuensche
  pState.botRollRequest = 0;
  pState.networkRollRequest = 0;
}

// Nachbild in Schiffsfarbe plus ein Funken-Partikel am Schiff
function createAfterimage(pState) {
  const color = shipColor(pState);
  createParticles({ sort: 'viperAfterimage', color, x: pState.x, y: pState.y, vx: 0, vy: 0, lives: 0.6, decay: 0.08 });

  createParticles({
    color: '#ffffff',
    x: pState.x + 15 + (Math.random() * 12 - 6),
    y: pState.y + 15 + (Math.random() * 12 - 6),
    vx: -(pState.viperRollDirection || 0) * 1.2,
    vy: 0,
    lives: 1.0,
    decay: 0.07,
  });
}
