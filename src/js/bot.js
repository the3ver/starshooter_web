
import { state, config, arrays, shipModels } from './state.js';

// --- Bot-Schwierigkeitsstufen ---
const BOT_DIFFICULTY = {
  easy:   { reactionFrames: 8, aimCorridor: 60, dodgeRadius: 60,  powerupRange: 120 },
  normal: { reactionFrames: 3, aimCorridor: 30, dodgeRadius: 80,  powerupRange: 180 },
  hard:   { reactionFrames: 0, aimCorridor: 15, dodgeRadius: 100, powerupRange: 250 }
};

let reactionCounter = 0;
let lastDecision = { moveX: 0, moveY: 0 };

// --- Hilfsfunktionen ---

function distanceSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function findNearestDanger(p2, diff) {
  const dangers = [];
  const halfSize = config.spielerGroesse / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  const dodgeRadiusSq = diff.dodgeRadius * diff.dodgeRadius;

  // Asteroiden
  for (const ast of arrays.asteroiden) {
    const ax = ast.x + (ast.groesse || 30) / 2;
    const ay = ast.y + (ast.groesse || 30) / 2;
    const dSq = distanceSq(cx, cy, ax, ay);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: ax, y: ay, dSq, vy: ast.geschwindigkeit || 2 });
    }
  }

  // Feindliche Projektile (Laser + Bomben + Raketen)
  for (const fl of arrays.feindLaserArray) {
    const fx = fl.x + 2;
    const fy = fl.y + 5;
    const dSq = distanceSq(cx, cy, fx, fy);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: fx, y: fy, dSq, vy: fl.vy || 4 });
    }
  }
  for (const bl of arrays.bossLaserArray) {
    const bx = bl.x + 3;
    const by = bl.y + 5;
    const dSq = distanceSq(cx, cy, bx, by);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: bx, y: by, dSq, vy: bl.vy || 4 });
    }
  }
  for (const bb of arrays.bossBombenArray) {
    const bx = bb.x + 8;
    const by = bb.y + 8;
    const dSq = distanceSq(cx, cy, bx, by);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: bx, y: by, dSq, vy: bb.vy || 2 });
    }
  }
  for (const br of arrays.bossRaketenArray) {
    const bx = br.x + 5;
    const by = br.y + 8;
    const dSq = distanceSq(cx, cy, bx, by);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: bx, y: by, dSq, vy: br.vy || 3 });
    }
  }

  // Feinde direkt
  for (const feind of arrays.feinde) {
    const fx = feind.x + 15;
    const fy = feind.y + 15;
    const dSq = distanceSq(cx, cy, fx, fy);
    if (dSq < dodgeRadiusSq) {
      dangers.push({ x: fx, y: fy, dSq, vy: feind.geschwindigkeit || 2 });
    }
  }

  if (dangers.length === 0) return null;
  dangers.sort((a, b) => a.dSq - b.dSq);
  return dangers[0];
}

function findNearestPowerup(p2, diff) {
  const halfSize = config.spielerGroesse / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  const rangeSq = diff.powerupRange * diff.powerupRange;
  let nearest = null;
  let nearestDSq = Infinity;

  for (const p of arrays.powerups) {
    if (p.towedBy) continue; // Schon gezogen
    const px = p.x + (p.groesse || 16) / 2;
    const py = p.y + (p.groesse || 16) / 2;
    const dSq = distanceSq(cx, cy, px, py);
    if (dSq < rangeSq && dSq < nearestDSq) {
      nearest = { x: px, y: py, dSq };
      nearestDSq = dSq;
    }
  }
  return nearest;
}

function findBestTarget(p2, diff) {
  const halfSize = config.spielerGroesse / 2;
  const cx = p2.x + halfSize;
  let bestTarget = null;
  let bestDSq = Infinity;

  // Bosse haben höchste Priorität
  for (const boss of arrays.bosses) {
    if (boss.hp <= 0) continue;
    const bx = boss.x + (boss.breite || 60) / 2;
    const by = boss.y + (boss.hoehe || 60) / 2;
    const dSq = distanceSq(cx, p2.y, bx, by);
    if (by < p2.y && dSq < bestDSq) { // Nur Ziele über dem Bot
      bestTarget = { x: bx, y: by, dSq, isBoss: true };
      bestDSq = dSq;
    }
  }

  // Feinde
  for (const feind of arrays.feinde) {
    const fx = feind.x + 15;
    const fy = feind.y + 15;
    const dSq = distanceSq(cx, p2.y, fx, fy);
    if (fy < p2.y && dSq < bestDSq) {
      bestTarget = { x: fx, y: fy, dSq, isBoss: false };
      bestDSq = dSq;
    }
  }

  // Asteroiden (niedrigste Priorität)
  for (const ast of arrays.asteroiden) {
    const ax = ast.x + (ast.groesse || 30) / 2;
    const ay = ast.y + (ast.groesse || 30) / 2;
    const dSq = distanceSq(cx, p2.y, ax, ay);
    if (ay < p2.y && dSq < bestDSq) {
      bestTarget = { x: ax, y: ay, dSq, isBoss: false };
      bestDSq = dSq;
    }
  }

  return bestTarget;
}

function computeMovement(p2, target, danger, powerup, diff) {
  const halfSize = config.spielerGroesse / 2;
  const cx = p2.x + halfSize;
  const cy = p2.y + halfSize;
  let moveX = 0;
  let moveY = 0;

  // Menschliche Taktik: Basis-Position im unteren Viertel (y: 480-520 auf 600px Feld)
  const baselineY = config.spielfeldHoehe - 90;

  // Priorität 1: Gefahren ausweichen
  if (danger) {
    const dx = cx - danger.x;
    const dy = cy - danger.y;
    const dist = Math.sqrt(danger.dSq) || 1;
    // Weg von der Gefahr bewegen
    moveX = (dx / dist) * 1.5;
    moveY = (dy / dist) * 1.2;
    return { moveX, moveY };
  }

  // Priorität 2: Powerup einsammeln
  if (powerup) {
    const dx = powerup.x - cx;
    const dy = powerup.y - cy;
    const dist = Math.sqrt(powerup.dSq) || 1;
    moveX = (dx / dist) * 1.0;
    moveY = (dy / dist) * 1.0;
    return { moveX, moveY };
  }

  // Priorität 3: Auf Ziel ausrichten (horizontal) und aus der Distanz (unteres Viertel) beschießen
  if (target) {
    const dx = target.x - cx;
    if (Math.abs(dx) > diff.aimCorridor / 2) {
      moveX = dx > 0 ? 0.8 : -0.8;
    }
    // Vertikal: Bleibe im unteren Viertel (Grundlinie), um Feinde/Bosse aus sicherer Distanz zu beschießen
    const idealY = target.isBoss ? baselineY : Math.max(baselineY, target.y + 250);
    const dy = idealY - cy;
    if (Math.abs(dy) > 15) {
      moveY = dy > 0 ? 0.5 : -0.5;
    }
    return { moveX, moveY };
  }

  // Priorität 4: Formation mit P1 halten (bevorzuge unteres Spielfeldviertel)
  const p1x = state.x + halfSize;
  const p1y = state.y + halfSize;
  const formationTargetX = p1x + 50; // Rechts versetzt
  const formationTargetY = Math.max(baselineY - 40, Math.min(config.spielfeldHoehe - 60, p1y));
  const fdx = formationTargetX - cx;
  const fdy = formationTargetY - cy;
  if (Math.abs(fdx) > 15) moveX = fdx > 0 ? 0.4 : -0.4;
  if (Math.abs(fdy) > 15) moveY = fdy > 0 ? 0.4 : -0.4;

  return { moveX, moveY };
}

function updateBotWeapons(p2, diff, target) {
  const halfSize = config.spielerGroesse / 2;
  const cx = p2.x + halfSize;

  // Laser: Feuern wenn Ziel im Aim-Korridor
  p2.botFireLaser = false;
  if (target && Math.abs(target.x - cx) <= diff.aimCorridor) {
    p2.botFireLaser = true;
  }

  // Raketen: Feuern wenn Ziel im Schussfeld (bei Bossen immer wenn grob ausgerichtet, bei Feinden bis 350px)
  p2.botFireRakete = false;
  if (target && p2.raketenCooldown <= 0) {
    const isAligned = Math.abs(target.x - cx) <= (diff.aimCorridor * 1.5);
    if (target.isBoss && isAligned) {
      p2.botFireRakete = true;
    } else if (isAligned && target.dSq < 350 * 350) {
      p2.botFireRakete = true;
    }
  }

  // Bomben: Sehr selektiv — nur wenn ≥3 Feinde sichtbar + Cooldown voll abgelaufen
  p2.botFireBombe = false;
  if (p2.bombenCooldown <= 0) {
    const sichtbareFeinde = arrays.feinde.length + arrays.bosses.filter(b => b.hp > 0).length;
    if (sichtbareFeinde >= 3) {
      p2.botFireBombe = true;
    }
  }
}

// --- Haupt-Update-Funktion (1x pro Frame) ---
export function updateBot() {
  const p2 = state.p2;
  if (!p2 || p2.isDead) return;

  const diff = BOT_DIFFICULTY[state.p2BotDifficulty || 'normal'];

  // Reaktionszeit: Entscheidung nur alle N Frames aktualisieren
  reactionCounter++;
  if (reactionCounter >= diff.reactionFrames) {
    reactionCounter = 0;

    const danger = findNearestDanger(p2, diff);
    const powerup = findNearestPowerup(p2, diff);
    const target = findBestTarget(p2, diff);

    lastDecision = computeMovement(p2, target, danger, powerup, diff);
    updateBotWeapons(p2, diff, target);
  }

  // Smooth Bewegung anwenden
  const p2Ship = shipModels && shipModels[p2.selectedShipModel || 'phantom'];
  const speed = (p2Ship?.speed || config.geschwindigkeit);

  p2.x += lastDecision.moveX * speed;
  p2.y += lastDecision.moveY * speed;

  // Bounds-Clamping
  if (p2.x < 0) p2.x = 0;
  if (p2.y < 0) p2.y = 0;
  if (p2.x > config.spielfeldBreite - config.spielerGroesse) p2.x = config.spielfeldBreite - config.spielerGroesse;
  if (p2.y > config.spielfeldHoehe - config.spielerGroesse) p2.y = config.spielfeldHoehe - config.spielerGroesse;
}

// Reset bei Neustart
export function resetBot() {
  reactionCounter = 0;
  lastDecision = { moveX: 0, moveY: 0 };
}
