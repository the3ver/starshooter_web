// Gleve-MR: Laser-Sweep als Hauptwaffe (Laser-Taste, laserStufe, kostet Energie), Dash als Zweitwaffe
// (Raketen-Taste, raketenStufe, Cooldown ueber raketenCooldown). pState ist `state` (P1) oder `state.p2`, pKey 'p1' / 'p2'.
// Zustand pro Spieler: gleveDashTimer, gleveDashVx/Vy (Schritt pro Frame, auch fuer den Abprall),
// gleveAbprallTimer, gleveUnverwundbar, gleveDashTasteGehalten (Flanke), gleveDashTreffer (Ziele dieses Dashs).
// Sweep: gleveSweepTimer (Restframes), gleveSweepWinkel (aktueller Strahlwinkel in Grad, 0 = senkrecht nach oben,
// positiv = rechts), gleveSweepRichtung (+1 links->rechts, -1 rechts->links; wechselt bei jedem Start),
// gleveSweepTreffer (Ziele dieses Sweeps), gleveSweepTakt (Frames bis zum naechsten moeglichen Start).

import { state, config, arrays, shipModels, shipColors } from './state.js';
import * as Utils from './utils.js';
import * as Audio from './audio.js';
import * as Hack from './hack.js';
import * as Entities from './entities.js';
import * as Display from './anzeige.js';
import { createParticles } from './partikel.js';

export const DASH_FRAMES = 8;
export const DASH_TRAIL_FRAMES = 10; // Unverwundbar nach dem Dash
export const BOUNCE_FRAMES = 8;
export const BOUNCE_TRAIL_FRAMES = 30; // Unverwundbar nach dem Abprall
const BOUNCE_DEEPER = 30;

// Werte pro Stufe (raketenStufe 1-5)
const DASH_RANGE = [100, 110, 120, 135, 150];
const DASH_DAMAGE = [60, 70, 80, 90, 100];
const DASH_COOLDOWN = [180, 165, 150, 135, 120];

function dashTierIndex(pState) {
  return Math.max(1, Math.min(5, pState.missileTier || 1)) - 1;
}

export function dashRange(pState) {
  return DASH_RANGE[dashTierIndex(pState)];
}
export function dashDamage(pState) {
  return DASH_DAMAGE[dashTierIndex(pState)];
}
export function dashCooldown(pState) {
  return DASH_COOLDOWN[dashTierIndex(pState)];
}
// Dash-Ladungen: Stufe 1-3 -> 2, Stufe 4-5 -> 3. raketenCooldown ist die Ladezeit der naechsten Ladung.
export function dashMaxCharges(pState) {
  return (pState.missileTier || 1) >= 4 ? 3 : 2;
}

// Ladungen voll, kein laufendes Nachladen (Spielstart, Neustart, Schiffswechsel)
export function setDashChargeFull(pState) {
  pState.gleveDashCharges = dashMaxCharges(pState);
  pState.missileCooldown = 0;
}

// Eine Ladung ist fertig geladen: +1, danach weiter nachladen, bis voll
function finishReload(pState) {
  const max = dashMaxCharges(pState);
  pState.gleveDashCharges = Math.min(max, (pState.gleveDashCharges || 0) + 1);
  pState.missileCooldown = pState.gleveDashCharges < max ? dashCooldown(pState) : 0;
}

// Pro Schritt (waffen.js): Nachladen der Dash-Ladungen
export function updateDashCharges(pState) {
  const max = dashMaxCharges(pState);
  if (pState.gleveDashCharges === undefined) pState.gleveDashCharges = max;
  if (pState.gleveDashCharges > max) pState.gleveDashCharges = max;
  if (pState.missileCooldown > 0) {
    pState.missileCooldown--;
    if (pState.missileCooldown <= 0) {
      if (pState.gleveDashCharges < max) finishReload(pState);
      else pState.missileCooldown = 0;
    }
  } else if (pState.gleveDashCharges < max) {
    // z. B. nach Upgrade auf Stufe 4: Nachladen starten
    pState.missileCooldown = dashCooldown(pState);
  }
}

// HUD der Dash-Ladungen: Balken = Fortschritt der naechsten Ladung (voll/gruen bei vollen Ladungen),
// Punkte = Ladungen (gefuellt = vorhanden), mobil Ladungszahl und Fuellung am Raketen-Button des lokalen Schiffs.
export function showDashHud(pKey, pState) {
  if (!pState || !isGleve(pState)) return;
  const max = dashMaxCharges(pState);
  showChargeHud(
    pKey,
    pState,
    pState.gleveDashCharges === undefined ? max : pState.gleveDashCharges,
    max,
    dashCooldown(pState),
  );
}

// Gemeinsam fuer Gleve-Dash und Sniper-Granaten: Balken (Ladefortschritt aus raketenCooldown), Punkte und Mobil-Zahl
export function showChargeHud(pKey, pState, count, max, chargeTime) {
  const sfx = pKey === 'p2' ? '-p2' : '';
  const charges = Math.max(0, Math.min(max, Math.round(count)));
  const full = charges >= max;
  const pct = full ? 100 : Math.max(0, Math.min(100, 100 - ((pState.missileCooldown || 0) / chargeTime) * 100));

  const bar = document.getElementById('raketen-cd-balken' + sfx);
  if (bar) {
    bar.style.width = pct + '%';
    bar.style.backgroundColor = full ? '#2ecc71' : '#e74c3c';
  }
  const container = document.getElementById('dash-ladungen' + sfx);
  if (container) {
    while (container.children.length < max) {
      const point = document.createElement('div');
      point.className = 'dash-ladung';
      container.appendChild(point);
    }
    while (container.children.length > max) container.lastChild.remove();
    for (let i = 0; i < max; i++) container.children[i].classList.toggle('voll', i < charges);
  }

  const isClient = state.gameMode === 'online' && state.network && state.network.isClient;
  if ((pKey === 'p2') === !!isClient) {
    const number = document.getElementById('btn-rakete-ladungen');
    if (number) {
      number.style.display = '';
      number.textContent = String(charges);
    }
    const fill = document.getElementById('btn-rakete-cd');
    if (fill) {
      fill.style.height = pct + '%';
      fill.style.backgroundColor = full ? 'rgba(46, 204, 113, 0.5)' : 'rgba(231, 76, 60, 0.5)';
    }
  }
}

// Ab Raketen-Stufe 5 knackt der Dash Magma
export function dashCracksMagma(pState) {
  return (pState.missileTier || 1) >= 5;
}

export function isGleve(pState) {
  return !!pState && pState.selectedShipModel === 'gleve';
}

// Dash oder Abprall laeuft (keine normale Steuerung, keine Energie-Regeneration)
export function isDashActive(pState) {
  return (pState.gleveDashTimer || 0) > 0 || (pState.gleveBounceTimer || 0) > 0;
}

function shipColor(pState) {
  const c = shipColors[pState.selectedShipColor];
  return c ? c.prim : '#ffffff';
}

function canDash(pState) {
  if (pState.isDead || isDashActive(pState)) return false;
  if (Hack.hasHack(pState, 'weaponOffline')) return false;
  return (pState.gleveDashCharges || 0) >= 1;
}

function startDash(pState, pKey, direction) {
  let dx = direction ? direction.dx : 0;
  let dy = direction ? direction.dy : 0;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) {
    // Ohne Eingabe nach oben
    dx = 0;
    dy = -1;
  } else {
    dx /= length;
    dy /= length;
  }
  pState.gleveDashCharges = Math.max(0, (pState.gleveDashCharges || 0) - 1);
  if ((pState.missileCooldown || 0) <= 0) pState.missileCooldown = dashCooldown(pState);
  pState.gleveDashDirection = { dx, dy };
  const step = dashRange(pState) / DASH_FRAMES;
  pState.gleveDashVx = dx * step;
  pState.gleveDashVy = dy * step;
  pState.gleveDashTimer = DASH_FRAMES;
  pState.gleveBounceTimer = 0;
  pState.gleveDashHit = [];
  pState.gleveInvulnerable = Math.max(pState.gleveInvulnerable || 0, DASH_FRAMES + DASH_TRAIL_FRAMES);
  Audio.playDash(pState.missileTier);
  createStartFlash(pState);
}

function clampOnPlayfield(pState) {
  pState.x = Math.max(0, Math.min(config.playfieldWidth - config.playerSize, pState.x));
  pState.y = Math.max(0, Math.min(config.playfieldHeight - config.playerSize, pState.y));
}

// Schaden wie bei den anderen Waffen: Schild zuerst, dann HP. Liefert true, wenn das Ziel zerstoert wurde.
export function damageTarget(z, damage, pKey) {
  if (z.isBoss && z.isIndestructible) return false; // geschlossenes Auge (Insel-Boss)
  if ((z.shieldHp || 0) > 0) {
    z.shieldHp -= damage;
    if (z.shieldHp <= 0) {
      z.shieldHp = 0;
    }
    return false;
  }
  z.hp -= damage;
  Display.flash(z, 2.5);
  // Boss-Raketen und -Bomben raeumen sich bei hp <= 0 in boss.js selbst ab
  if (z.hp <= 0 && (arrays.enemies.includes(z) || arrays.asteroids.includes(z) || arrays.bosses.includes(z))) {
    Utils.destroyTarget(z, pKey);
    return true;
  }
  return false;
}

// Kill-Kette: jeder durch einen Dash zerstoerte Gegner verkuerzt das laufende Nachladen
function rewardKill(pState, z) {
  if (!z.isEnemy && !z.isBoss) return;
  const bonus = (shipModels.gleve && shipModels.gleve.dashKillCooldown) || 0;
  if ((pState.missileCooldown || 0) <= 0) return; // nichts am Laden
  pState.missileCooldown = Math.max(0, pState.missileCooldown - bonus);
  if (pState.missileCooldown <= 0) finishReload(pState);
}

// Magma-Asteroid knacken wie bei der Bombe (wird zum Powerup-Traeger)
function crackMagma(z) {
  z.isIndestructible = false;
  z.carriesPowerup = true;
}

function overlaps(pState, z, padding = 0) {
  const g = z.size || 20;
  const w = z.width || g;
  const h = z.height || g;
  return (
    pState.x < z.x + w - padding &&
    pState.x + config.playerSize > z.x + padding &&
    pState.y < z.y + h - padding &&
    pState.y + config.playerSize > z.y + padding
  );
}

// Abprall schraeg zur Seite: auf die Seite, auf der die Gleve relativ zur Zielmitte ist,
// mindestens halbe Zielbreite neben der Zielkante und etwas tiefer (raus aus der Schusslinie)
function startBounce(pState, z) {
  const g = z.size || 30;
  const shipMiddle = pState.x + config.playerSize / 2;
  const targetMiddle = z.x + g / 2;
  let side = Math.sign(shipMiddle - targetMiddle);
  if (side === 0) side = Math.random() < 0.5 ? -1 : 1;

  const maxX = config.playfieldWidth - config.playerSize;
  const maxY = config.playfieldHeight - config.playerSize;
  const landX = s => Math.max(0, Math.min(maxX, s > 0 ? z.x + g + g / 2 : z.x - g / 2 - config.playerSize));
  const belowTarget = x => x < z.x + g && x + config.playerSize > z.x;
  let targetX = landX(side);
  // Am Spielfeldrand kein Platz: andere Seite versuchen
  if (belowTarget(targetX) && !belowTarget(landX(-side))) targetX = landX(-side);
  const targetY = Math.max(0, Math.min(maxY, pState.y + BOUNCE_DEEPER));

  pState.gleveDashTimer = 0;
  pState.gleveBounceTimer = BOUNCE_FRAMES;
  pState.gleveDashVx = (targetX - pState.x) / BOUNCE_FRAMES;
  pState.gleveDashVy = (targetY - pState.y) / BOUNCE_FRAMES;
  pState.gleveInvulnerable = Math.max(pState.gleveInvulnerable || 0, BOUNCE_FRAMES + BOUNCE_TRAIL_FRAMES + 1);
  Audio.playHit('magma');
  Utils.createExplosion(shipMiddle, pState.y, '#ffffff', 12);
}

// Ein Dash-Frame: bewegen und alle beruehrten Ziele (je einmal pro Dash) behandeln
function dashStep(pState, pKey) {
  const oldX = pState.x;
  const oldY = pState.y;
  pState.x += pState.gleveDashVx;
  pState.y += pState.gleveDashVy;
  clampOnPlayfield(pState);
  pState.gleveDashTimer--;
  createAfterimage(pState);

  const damage = dashDamage(pState);
  const tier5 = dashCracksMagma(pState);
  const hit = pState.gleveDashHit || (pState.gleveDashHit = []);
  let obstacle = null;

  const targets = [
    ...arrays.enemies,
    ...arrays.asteroids,
    ...arrays.bosses,
    ...arrays.bossMissileArray,
    ...arrays.bossBombArray,
  ];
  for (const z of targets) {
    if (hit.includes(z) || (z.immune || 0) > 0) continue;
    if (!overlaps(pState, z, z.isBoss ? z.size * 0.15 : 0)) continue;
    hit.push(z);
    createSparks(pState, z);

    if (z.isBoss) {
      // Boss bekommt Schaden und haelt den Dash auf
      if (damageTarget(z, damage, pKey)) rewardKill(pState, z);
      else if (!obstacle) obstacle = z;
    } else if (z.isIndestructible) {
      if (tier5) {
        crackMagma(z);
        damageTarget(z, damage, pKey);
      } else if (!obstacle) {
        obstacle = z;
      }
    } else if (z.isEnemy || (arrays.asteroids.includes(z) && !z.carriesPowerup)) {
      // Kleine Ziele werden durchschnitten
      Utils.destroyTarget(z, pKey);
      rewardKill(pState, z);
    } else {
      // Powerup-Asteroiden, Boss-Raketen und -Bomben
      damageTarget(z, damage, pKey);
    }
  }

  if (obstacle) {
    // Dash endet am Hindernis
    pState.x = oldX;
    pState.y = oldY;
    startBounce(pState, obstacle);
  } else if (pState.gleveDashTimer === 0) {
    startComboSweep(pState, pKey);
  }
}

// Dash-Combo: Endet der Dash regulaer, folgt sofort ein Sweep (normale Energiekosten, ohne auf den Takt zu warten)
function startComboSweep(pState, pKey) {
  const cost = pState.unlimitedEnergy ? 0 : sweepCost(pState);
  if ((pState.energy || 0) < cost || !startSweep(pState, pKey)) return;
  pState.energy -= cost;
  pState.gleveSweepCadence = sweepCadence(pState);
}

function bounceStep(pState) {
  pState.x += pState.gleveDashVx;
  pState.y += pState.gleveDashVy;
  clampOnPlayfield(pState);
  pState.gleveBounceTimer--;
  createAfterimage(pState);
}

// Pro Simulationsschritt fuer eine Gleve aufrufen (vor der normalen Bewegung).
// tasteGedrueckt: Raketen-Taste dieses Spielers, richtung: { dx, dy } aus der Steuerung (Hacks bereits angewendet).
// Liefert true, wenn Dash/Abprall die Bewegung in diesem Schritt uebernommen hat.
export function updateGleve(pState, pKey, keyPressed, direction) {
  if ((pState.gleveInvulnerable || 0) > 0) pState.gleveInvulnerable--;
  const flank = !!keyPressed && !pState.gleveDashKeyHeld;
  pState.gleveDashKeyHeld = !!keyPressed;

  if (pState.isDead) {
    pState.gleveDashTimer = 0;
    pState.gleveBounceTimer = 0;
    return false;
  }

  if (flank && canDash(pState)) startDash(pState, pKey, direction);

  let applied = false;
  if ((pState.gleveDashTimer || 0) > 0) {
    dashStep(pState, pKey);
    applied = true;
  } else if ((pState.gleveBounceTimer || 0) > 0) {
    bounceStep(pState);
    applied = true;
  }
  return applied;
}

// --- ONLINE-CLIENT ---
// Der Client steuert sein Schiff selbst und schickt die Position an den Host. Den eigenen Dash sagt er
// mit derselben Bewegung voraus: Im Schritt des Tastendrucks bleibt das Schiff stehen und das Eingabe-Paket
// traegt Startposition und Richtung zum Host, der von genau dort aus dasht (und solange Client-Positionen
// ignoriert). Ab dem naechsten Schritt laufen beide Dashs gleich. Treffer, Schaden und der Abprall bleiben
// beim Host: An Bossen/Magma haelt die Vorhersage nur an, den Abprall uebernimmt der Client aus dem Snapshot.

// Steht das Schiff im naechsten Dash-Schritt in einem Hindernis (Boss, Magma unter Stufe 5)?
function obstacleOnClient(pState) {
  const tier5 = dashCracksMagma(pState);
  for (const b of arrays.bosses) {
    if (overlaps(pState, b, (b.size || 100) * 0.15)) return true;
  }
  if (!tier5) {
    for (const a of arrays.asteroids) {
      if (a.isIndestructible && overlaps(pState, a)) return true;
    }
  }
  return false;
}

// Pro Client-Schritt fuer das eigene Schiff (vor der normalen Steuerung). Liefert true, wenn
// Dash/Abprall die Bewegung in diesem Schritt uebernimmt.
export function predictDash(pState, keyPressed, direction) {
  const flank = !!keyPressed && !pState.gleveDashKeyHeld;
  pState.gleveDashKeyHeld = !!keyPressed;
  if (pState.isDead) {
    pState.gleveDashTimer = 0;
    pState.gleveNetworkBounce = null;
    return false;
  }

  // Abprall vom Host: zur gemeldeten Host-Position gleiten
  if (pState.gleveNetworkBounce) {
    const target = pState.gleveNetworkBounce;
    pState.x += (target.x - pState.x) / 2;
    pState.y += (target.y - pState.y) / 2;
    clampOnPlayfield(pState);
    // Sicherheitsnetz, falls kein Snapshot mehr kommt
    if (++target.steps > BOUNCE_FRAMES + BOUNCE_TRAIL_FRAMES) {
      pState.gleveNetworkBounce = null;
      pState.gleveBounceTimer = 0;
    }
    return true;
  }

  if ((pState.gleveDashTimer || 0) > 0) {
    const oldX = pState.x;
    const oldY = pState.y;
    pState.x += pState.gleveDashVx;
    pState.y += pState.gleveDashVy;
    clampOnPlayfield(pState);
    pState.gleveDashTimer--;
    if (obstacleOnClient(pState)) {
      // Am Hindernis stehen bleiben, der Host meldet den Abprall
      pState.x = oldX;
      pState.y = oldY;
      pState.gleveDashTimer = 0;
    }
    return true;
  }

  // Ohne Ladung laut letztem Snapshot kein Dash (kannDashen prueft gleveDashLadungen)
  if (flank && canDash(pState)) {
    startDash(pState, 'p2', direction);
    pState.gleveDashStartX = pState.x;
    pState.gleveDashStartY = pState.y;
    return true; // Startschritt ohne Bewegung (siehe oben)
  }
  return false;
}

// Was der Client dem Host meldet: waehrend des vorhergesagten Dashs Startposition und Dash-Richtung
export function networkInput(pState, direction) {
  if (isGleve(pState) && (pState.gleveDashTimer || 0) > 0 && pState.gleveDashDirection) {
    return {
      x: pState.gleveDashStartX,
      y: pState.gleveDashStartY,
      rx: pState.gleveDashDirection.dx,
      ry: pState.gleveDashDirection.dy,
    };
  }
  return { x: pState.x, y: pState.y, rx: direction ? direction.dx : 0, ry: direction ? direction.dy : 0 };
}

// Gleve-Zustand eines Spielers aus dem Host-Snapshot uebernehmen. eigenes: Schiff des Clients
// (Dash lokal vorhergesagt, vom Host kommen nur Abprall, Sweep und Unverwundbarkeit).
export function applySnapshot(pState, payload, ownOne) {
  if (!payload || payload.gleveSweepTimer === undefined) return;
  if (payload.gleveDashCharges !== undefined) pState.gleveDashCharges = payload.gleveDashCharges;
  const sweepTimer = payload.gleveSweepTimer || 0;
  const sweepDirection = payload.gleveSweepDirection || 0;
  // Neuer Sweep: Richtung wechselt bei jedem Einsatz
  if (sweepTimer > 0 && sweepDirection !== (pState.gleveSweepDirection || 0)) Audio.playSweep(pState.laserTier);
  pState.gleveSweepTimer = sweepTimer;
  pState.gleveSweepAngle = payload.gleveSweepAngle || 0;
  pState.gleveSweepDirection = sweepDirection;
  pState.gleveInvulnerable = payload.gleveInvulnerable || 0;

  const bounce = payload.gleveBounceTimer || 0;
  if (ownOne) {
    if (bounce > 0) {
      pState.gleveDashTimer = 0;
      pState.gleveBounceTimer = bounce;
      pState.gleveNetworkBounce = { x: payload.x, y: payload.y, steps: 0 };
    } else if (pState.gleveNetworkBounce) {
      // Abprall auf dem Host beendet: Landepunkt uebernehmen, danach steuert wieder der Client
      if (Number.isFinite(payload.x)) pState.x = payload.x;
      if (Number.isFinite(payload.y)) pState.y = payload.y;
      pState.gleveNetworkBounce = null;
      pState.gleveBounceTimer = 0;
    }
  } else {
    const dash = payload.gleveDashTimer || 0;
    if (dash > 0 && !isDashActive(pState)) Audio.playDash(pState.missileTier);
    pState.gleveDashTimer = dash;
    pState.gleveBounceTimer = bounce;
  }
}

// Pro Client-Schritt fuer beide Schiffe: Dash-Nachbilder und Sweep-Klinge zwischen den Snapshots
// (Klasse gleve-dash leitet die Anzeige aus dem Zustand ab)
export function showGleveStatus(pState, pKey) {
  const gleve = isGleve(pState) && !pState.isDead;
  const dash = gleve && isDashActive(pState);
  if (dash) createAfterimage(pState);

  if (gleve && isSweepActive(pState)) {
    // Strahl bis zum naechsten Snapshot weiterdrehen
    pState.gleveSweepAngle += ((pState.gleveSweepDirection || 1) * sweepArc(pState)) / SWEEP_FRAMES;
    pState.gleveSweepTimer--;
    if (pState.gleveSweepTimer <= 0) {
      pState.gleveSweepTimer = 0;
      createFanTrail(pState);
    }
  }
}

// --- LASER-SWEEP ---

export const SWEEP_FRAMES = 10;
const SWEEP_REVERSAL_SPEED = 10; // zurueckgeworfene Geschosse fliegen mit vy 10 nach oben
const SWEEP_REVERSAL_DAMAGE = 15;
export const SWEEP_PARRY_COLOR = '#e67e22';

// Werte pro Stufe (laserStufe 1-5). Bogen in Grad, symmetrisch um die Senkrechte;
// Takt = Frames von einem Sweep-Start bis zum naechsten, solange die Taste gehalten wird
const SWEEP_ARC = [90, 105, 120, 135, 150];
const SWEEP_LENGTH = [100, 110, 120, 130, 140];
const SWEEP_DAMAGE = [30, 35, 40, 45, 50];
const SWEEP_CADENCE = [20, 19, 18, 17, 16];
const SWEEP_COST = [8, 8, 7, 7, 6];

function sweepTierIndex(pState) {
  return Math.max(1, Math.min(5, pState.laserTier || 1)) - 1;
}

export function sweepArc(pState) {
  return SWEEP_ARC[sweepTierIndex(pState)];
}
export function sweepLength(pState) {
  return SWEEP_LENGTH[sweepTierIndex(pState)];
}
export function sweepDamage(pState) {
  return SWEEP_DAMAGE[sweepTierIndex(pState)];
}
export function sweepCadence(pState) {
  return SWEEP_CADENCE[sweepTierIndex(pState)];
}
export function sweepCost(pState) {
  return SWEEP_COST[sweepTierIndex(pState)];
}

export function isSweepActive(pState) {
  return (pState.gleveSweepTimer || 0) > 0;
}

// Ursprung des Strahls: Schiffsmitte oben
export function sweepOrigin(pState) {
  return { x: pState.x + config.playerSize / 2, y: pState.y + 5 };
}

// Box eines Ziels oder Geschosses (Bosse wie bei den anderen Waffen etwas verkleinert)
function targetBox(z) {
  const g = z.size || 20;
  const w = z.width || g;
  const h = z.height || g;
  const pad = z.isBoss ? g * 0.15 : 0;
  return { x1: z.x + pad, y1: z.y + pad, x2: z.x + w - pad, y2: z.y + h - pad };
}

// Liegt der Punkt im Kreissektor [winkelA, winkelB] (Grad, 0 = oben) bis zur Laenge?
function inSector(o, px, py, angleA, angleB, length) {
  const dx = px - o.x;
  const dy = py - o.y;
  const dist = Math.hypot(dx, dy);
  if (dist > length) return false;
  if (dist < 0.5) return true;
  const phi = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return phi >= Math.min(angleA, angleB) - 0.001 && phi <= Math.max(angleA, angleB) + 0.001;
}

// Schneidet die Strahl-Strecke (Ursprung, Winkel, Laenge) die Box? (Slab-Verfahren)
function beamHitsBox(o, angle, length, b) {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad) * length;
  const dy = -Math.cos(rad) * length;
  let tMin = 0;
  let tMax = 1;
  for (const [start, d, lo, hi] of [
    [o.x, dx, b.x1, b.x2],
    [o.y, dy, b.y1, b.y2],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (start < lo || start > hi) return false;
    } else {
      let t1 = (lo - start) / d;
      let t2 = (hi - start) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
  }
  return true;
}

// Wird die Box in diesem Frame vom Strahl ueberstrichen (Teilsektor winkelA -> winkelB)?
function inSweep(o, b, angleA, angleB, length) {
  // Naechster Punkt der Box zum Ursprung und Mittelpunkt
  const nx = Math.max(b.x1, Math.min(o.x, b.x2));
  const ny = Math.max(b.y1, Math.min(o.y, b.y2));
  if (inSector(o, nx, ny, angleA, angleB, length)) return true;
  if (inSector(o, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, angleA, angleB, length)) return true;
  // Breite Ziele, deren naechster Punkt ausserhalb des Bogens liegt, aber vom Strahl geschnitten werden
  return beamHitsBox(o, angleA, length, b) || beamHitsBox(o, angleB, length, b);
}

function canSweepen(pState) {
  if (pState.isDead || isSweepActive(pState)) return false;
  return !Hack.hasHack(pState, 'weaponOffline');
}

// Startet einen Sweep (Kosten und Takt regelt steuereSweep). Liefert true, wenn der Sweep gestartet wurde.
export function startSweep(pState, pKey) {
  if (!canSweepen(pState)) return false;
  pState.gleveSweepDirection = (pState.gleveSweepDirection || -1) > 0 ? -1 : 1;
  pState.gleveSweepAngle = (-pState.gleveSweepDirection * sweepArc(pState)) / 2;
  pState.gleveSweepTimer = SWEEP_FRAMES;
  pState.gleveSweepHit = [];
  Audio.playSweep(pState.laserTier);
  return true;
}

// Pro Simulationsschritt aus spieler.js (Energie-Phase): Takt herunterzaehlen und, solange die Laser-Taste
// gehalten wird, im Takt pendelnde Sweeps starten (Kosten beim Start, Superwaffe kostenlos).
// Liefert true, wenn in diesem Schritt ein Sweep gestartet wurde.
export function controlSweep(pState, pKey, held) {
  if ((pState.gleveSweepCadence || 0) > 0) pState.gleveSweepCadence--;
  if (!held || (pState.gleveSweepCadence || 0) > 0) return false;
  const cost = pState.unlimitedEnergy ? 0 : sweepCost(pState);
  if ((pState.energy || 0) < cost || !startSweep(pState, pKey)) return false;
  pState.energy -= cost;
  pState.gleveSweepCadence = sweepCadence(pState);
  return true;
}

// Sweep abbrechen (Tod, Neustart): die Anzeige blendet die Klinge ueber den Timer aus
export function endSweep(pState, pKey) {
  pState.gleveSweepTimer = 0;
  pState.gleveSweepHit = [];
}

// Schaden fuer alle in diesem Frame ueberstrichenen Ziele (je einmal pro Sweep)
function sweepHit(pState, pKey, o, angleA, angleB, length) {
  const damage = sweepDamage(pState);
  const hit = pState.gleveSweepHit || (pState.gleveSweepHit = []);
  const targets = [
    ...arrays.enemies,
    ...arrays.asteroids,
    ...arrays.bosses,
    ...arrays.bossMissileArray,
    ...arrays.bossBombArray,
  ];
  for (const z of targets) {
    // Magma bleibt unversehrt
    if (z.isIndestructible || hit.includes(z) || (z.immune || 0) > 0) continue;
    if (!inSweep(o, targetBox(z), angleA, angleB, length)) continue;
    hit.push(z);
    createSparks(pState, z);
    if (damageTarget(z, damage, pKey)) rewardSweepKill(pState, z);
  }
}

// Sweep-Kills an Feindschiffen geben Energie zurueck (Bosse ausgenommen), damit der Sweep im Kampf weiterlaeuft
function rewardSweepKill(pState, z) {
  if (!z.isEnemy || z.isBoss) return;
  const bonus = (shipModels.gleve && shipModels.gleve.sweepKillEnergy) || 0;
  pState.energy = Math.min(pState.maxEnergy, (pState.energy || 0) + bonus);
}

// Parade: Feind-, Hack- und Boss-Geschosse, die der Strahl beruehrt, werden weggeschleudert oder zurueckgeworfen
function sweepParry(pState, pKey, o, angleA, angleB, length) {
  const tier = pState.laserTier || 1;
  const listen = [arrays.enemyLaserArray, arrays.hackProjectileArray, arrays.bossLaserArray];
  for (const list of listen) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.harmless || !inSweep(o, targetBox(p), angleA, angleB, length)) continue;
      const back = tier >= 5 || (tier >= 3 && Math.random() < 0.5);
      createParrySparks(p);
      if (back) {
        list.splice(i, 1);
        throwBack(p, pKey);
      } else {
        flingAway(p, o);
      }
    }
  }
}

// Seitlich weg von der Schiffsmitte, harmlos (gegner.js / boss.js pruefen `harmlos`), verlaesst das Feld
function flingAway(p, o) {
  const b = targetBox(p);
  let side = Math.sign((b.x1 + b.x2) / 2 - o.x);
  if (side === 0) side = Math.random() < 0.5 ? -1 : 1;
  p.harmless = true;
  p.steerTime = 0; // Hack-Projektile lenken nicht mehr nach
  p.vx = side * 9;
  p.vy = -1.5;
  showParried(p, p.vx, p.vy);
}

// Weggeschleudertes Geschoss (auch beim Online-Client aus dem harmlos-Flag): in Flugrichtung drehen.
// Die Anzeige faerbt Geschosse mit harmlos orange.
export function showParried(p, vx, vy) {
  if (Number.isFinite(vx) && Number.isFinite(vy) && (vx || vy)) {
    p.rot = (Math.atan2(vy, vx) * 180) / Math.PI - 90;
  }
}

// Zurueckgeworfen: wird zum Spieler-Projektil in arrays.laserArray (Bewegung y -= vy)
function throwBack(p, pKey) {
  Display.remove(p);
  arrays.laserArray.push(
    Display.create(
      {
        id: Entities.newId('l'),
        color: SWEEP_PARRY_COLOR,
        rot: 0,
        x: p.x,
        y: p.y,
        vx: 0,
        vy: SWEEP_REVERSAL_SPEED,
        width: p.width || 4,
        height: p.height || 15,
        damage: SWEEP_REVERSAL_DAMAGE,
        owner: pKey,
        reflected: true,
      },
      'laser',
    ),
  );
}

// Pro Simulationsschritt fuer eine Gleve aufrufen (aus waffen.js; gestartet wird in steuereSweep)
export function updateSweep(pState, pKey) {
  if (pState.isDead) {
    if (isSweepActive(pState)) endSweep(pState, pKey);
    return;
  }
  if (!isSweepActive(pState)) return;

  const direction = pState.gleveSweepDirection || 1;
  const angleA = pState.gleveSweepAngle;
  const angleB = angleA + (direction * sweepArc(pState)) / SWEEP_FRAMES;
  const o = sweepOrigin(pState);
  const length = sweepLength(pState);

  sweepHit(pState, pKey, o, angleA, angleB, length);
  sweepParry(pState, pKey, o, angleA, angleB, length);

  pState.gleveSweepAngle = angleB;
  pState.gleveSweepTimer--;
  if (pState.gleveSweepTimer <= 0) {
    pState.gleveSweepTimer = 0;
    pState.gleveSweepHit = [];
    createFanTrail(pState);
    startWave(pState, pKey, o, length);
  }
}

// --- KLINGENWELLE ---
// Am Ende jedes Sweeps fliegt eine Sichel nach oben und trifft Ziele jenseits der Sweep-Reichweite.

export const WAVE_SPEED = 8; // px pro Schritt nach oben
export const WAVE_STEPS = 15; // Lebensdauer: 15 * 8 = 120 px
export const WAVE_MIN_WIDTH = 50;
export const WAVE_HEIGHT = 14;
const WAVE_DAMAGE_SHARE = 0.5;

// Sehne des Sweep-Bogens auf halber Laenge, mind. WELLE_MIN_BREITE
export function waveWidth(pState) {
  const chord = sweepLength(pState) * Math.sin(((sweepArc(pState) / 2) * Math.PI) / 180);
  return Math.round(Math.max(WAVE_MIN_WIDTH, chord));
}

function startWave(pState, pKey, o, length) {
  const width = waveWidth(pState);
  const w = {
    id: Entities.newId('gw'),
    x: o.x - width / 2,
    y: o.y - length - WAVE_HEIGHT / 2,
    width,
    height: WAVE_HEIGHT,
    owner: pKey,
    startY: o.y - length - WAVE_HEIGHT / 2,
    steps: 0,
    damage: sweepDamage(pState) * WAVE_DAMAGE_SHARE,
    hit: [],
    color: shipColor(pState),
  };
  arrays.gleveWaves.push(Display.create(w, 'gleveWave'));
}

// Glow-Farbe einer Klingenwelle (Schiffsfarbe des Besitzers, auch fuer den Online-Client)
export function waveColor(pKey) {
  return shipColor(pKey === 'p2' ? state.p2 : state);
}

// Pro Simulationsschritt (Host/lokal, aus waffen.js): Wellen bewegen, Ziele einmal treffen, am Ende entfernen.
export function updateWaves() {
  for (let i = arrays.gleveWaves.length - 1; i >= 0; i--) {
    const w = arrays.gleveWaves[i];
    const pState = w.owner === 'p2' ? state.p2 : state;
    w.y -= WAVE_SPEED;
    w.steps++;
    const box = { x1: w.x, y1: w.y, x2: w.x + w.width, y2: w.y + w.height };
    const targets = [
      ...arrays.enemies,
      ...arrays.asteroids,
      ...arrays.bosses,
      ...arrays.bossMissileArray,
      ...arrays.bossBombArray,
    ];
    for (const z of targets) {
      if (z.isIndestructible || w.hit.includes(z) || (z.immune || 0) > 0) continue;
      const b = targetBox(z);
      if (b.x2 < box.x1 || b.x1 > box.x2 || b.y2 < box.y1 || b.y1 > box.y2) continue;
      w.hit.push(z);
      createSparks(pState, z);
      if (damageTarget(z, w.damage, w.owner)) rewardSweepKill(pState, z);
    }
    if (w.steps >= WAVE_STEPS) {
      Display.remove(w);
      arrays.gleveWaves.splice(i, 1);
    }
  }
}

// --- EFFEKTE ---

// Kurz verblassende Faecher-Spur ueber den ganzen Bogen (Kreissektor ueber dem Ursprung)
function createFanTrail(pState) {
  const o = sweepOrigin(pState);
  const length = sweepLength(pState);
  const color = shipColor(pState);
  const arc = sweepArc(pState);
  createParticles({
    sort: 'gleveFaecher',
    color,
    length,
    arc,
    x: o.x - length,
    y: o.y - length,
    vx: 0,
    vy: 0,
    lives: 0.8,
    decay: 0.08,
  });
}

function createParrySparks(p) {
  const b = targetBox(p);
  const cx = (b.x1 + b.x2) / 2;
  const cy = (b.y1 + b.y2) / 2;
  Utils.createExplosion(cx, cy, '#ffffff', 5);
  Utils.createExplosion(cx, cy, SWEEP_PARRY_COLOR, 5);
}

function createStartFlash(pState) {
  const cx = pState.x + config.playerSize / 2;
  const cy = pState.y + config.playerSize / 2;
  createParticles({ sort: 'gleveFlash', x: cx - 20, y: cy - 20, vx: 0, vy: 0, lives: 1.0, decay: 0.2 });
  Utils.createExplosion(cx, cy, '#ffffff', 6);
}

// Nachbild in Schiffsfarbe plus Streifen-Partikel entlang der Strecke
function createAfterimage(pState) {
  const color = shipColor(pState);
  createParticles({ sort: 'gleveAfterimage', color, x: pState.x, y: pState.y, vx: 0, vy: 0, lives: 0.7, decay: 0.08 });

  for (let i = 0; i < 2; i++) {
    createParticles({
      color: i === 0 ? color : '#ffffff',
      x: pState.x + 15 + (Math.random() * 16 - 8),
      y: pState.y + 15 + (Math.random() * 16 - 8),
      vx: -pState.gleveDashVx * 0.15,
      vy: -pState.gleveDashVy * 0.15,
      lives: 1.0,
      decay: 0.07,
    });
  }
}

// Funken und Schnitt-Effekt am getroffenen Ziel
function createSparks(pState, z) {
  const g = z.size || 20;
  const cx = z.x + (z.width || g) / 2;
  const cy = z.y + (z.height || g) / 2;
  Utils.createExplosion(cx, cy, '#ffffff', 8);
  Utils.createExplosion(cx, cy, shipColor(pState), 4);
}
