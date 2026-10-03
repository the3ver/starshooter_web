
import { state, dom, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import { naechsterSpielerMitte } from './gegner.js';


const BOSS_HACK_AB_LEVEL = 5;
const BOSS_HACK_INTERVALL = 300; // 5 s
const BOSS_HACK_INTERVALL_ENRAGE = 180; // 3 s

export function aktualisiereBosse() {
  for (let i = arrays.bosses.length - 1; i >= 0; i--) {
    let b = arrays.bosses[i];
    if (!b) break;
    if (b.phase === 'einzug') {
      if (!b.el.classList.contains('repulsor-aktiv')) b.el.classList.add('repulsor-aktiv');
      b.y += b.vy;
      if (b.y >= 20) {
        b.y = 20;
        b.phase = 'kampf';
        b.el.classList.remove('repulsor-aktiv');
      }

      // Repulsor auf Projektile anwenden
      arrays.laserArray.forEach(l => {
        let cx = b.x + b.groesse / 2;
        let cy = b.y + b.groesse / 2;
        let lx = l.x + l.width / 2;
        let ly = l.y;
        let dx = lx - cx;
        let dy = ly - cy;
        let dist = Math.hypot(dx, dy);
        if (dist < b.groesse * 1.5 && dy > 0) {
          // Wirkt am besten nach unten abwehrend
          let kraft = (b.groesse * 1.5 - dist) * 0.15;
          l.vx += dx > 0 ? kraft : -kraft;
        }
      });
      b.el.style.left = b.x + 'px';
      b.el.style.top = b.y + 'px';
      dom.bossHpBalken.style.width = Math.max(0, b.hp / b.maxHp * 100) + '%';
      continue; // Überspringt Kampf-Bewegungen und Schießen
    } else {
      // Enrage Check für alle Typen
      if (!b.enragePhaseAktiv && b.hp < b.maxHp * 0.5) {
        b.enragePhaseAktiv = true;
        b.baseSchussRate = Math.max(15, Math.floor(b.baseSchussRate / 2));
        dom.bossHpBalken.style.backgroundColor = '#8e44ad'; // Visualisiert Enrage im Balken
        if (b.bossTyp === 2) b.vx *= 1.5; // Jäger wird im Enrage schneller
      }

      // Hack-Projektile ab Level 5 (Quelle null, damit der Boss mehrfach hacken kann)
      if (state.level >= BOSS_HACK_AB_LEVEL) {
        b.hackTimer--;
        if (b.hackTimer <= 0) {
          const ziel = naechsterSpielerMitte(b);
          Entities.erzeugeHackProjektil(b.x + b.groesse / 2 - 6, b.y + b.groesse, ziel.x, ziel.y, null);
          b.hackTimer = b.enragePhaseAktiv ? BOSS_HACK_INTERVALL_ENRAGE : BOSS_HACK_INTERVALL;
        }
      }

      // Bewegung
      if (b.bossTyp === 1) {
        // Kreuzer
        b.x += b.vx;
        if (b.x <= 10 || b.x >= config.spielfeldBreite - b.groesse - 10) b.vx *= -1;
      } else if (b.bossTyp === 2) {
        // Jäger - verfolgt den näheren lebenden Spieler
        let zielX = naechsterSpielerMitte(b).x - b.groesse / 2;
        if (b.x < zielX - 5) b.x += b.vx;else if (b.x > zielX + 5) b.x -= b.vx;
      } else if (b.bossTyp === 3) {
        // Träger
        b.zeit = (b.zeit || 0) + 0.02 * (b.enragePhaseAktiv ? 1.5 : 1);
        b.x = config.spielfeldBreite / 2 - b.groesse / 2 + Math.sin(b.zeit) * (config.spielfeldBreite / 2 - b.groesse / 2 - 10);
      } else if (b.bossTyp === 4) {
        // Festung
        b.x += b.vx * 0.5; // Bewegt sich sehr langsam
        if (b.x <= 10 || b.x >= config.spielfeldBreite - b.groesse - 10) b.vx *= -1;
      }

      // Update HP Balken Breite
      dom.bossHpBalken.style.width = Math.max(0, b.hp / b.maxHp * 100) + '%';
      if (b.enragePhaseAktiv) {
        Utils.erzeugeRauchFunken(b.x, b.y, b.groesse);
      }
      if (b.bossTyp === 1) {
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.3, b.y - b.groesse * 0.05, -2);
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.7, b.y - b.groesse * 0.05, -2);
      } else if (b.bossTyp === 2) {
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.35, b.y - b.groesse * 0.05, -2);
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.65, b.y - b.groesse * 0.05, -2);
      } else if (b.bossTyp === 3) {
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.5, b.y - b.groesse * 0.05, -2);
      } else if (b.bossTyp === 4) {
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.25, b.y - b.groesse * 0.05, -2);
        Utils.erzeugeAntriebsRauch(b.x + b.groesse * 0.75, b.y - b.groesse * 0.05, -2);
      }
      b.schussTimer--;
      if (b.schussTimer <= 0) {
        if (b.bossTyp === 1) {
          Entities.erzeugeBossLaser(b.x + b.groesse * 0.2, b.y + b.groesse * 0.7);
          Entities.erzeugeBossLaser(b.x + b.groesse * 0.46, b.y + b.groesse * 0.9);
          Entities.erzeugeBossLaser(b.x + b.groesse * 0.72, b.y + b.groesse * 0.7);
          if (b.enragePhaseAktiv) {
            Entities.erzeugeBossLaser(b.x + b.groesse * 0.1, b.y + b.groesse * 0.5);
            Entities.erzeugeBossLaser(b.x + b.groesse * 0.82, b.y + b.groesse * 0.5);
          }
        } else if (b.bossTyp === 2) {
          // Gezielter Schuss auf den näheren lebenden Spieler
          const ziel = naechsterSpielerMitte(b);
          let startX = b.x + b.groesse / 2 - 4;
          let startY = b.y + b.groesse;
          let winkel = Math.atan2(ziel.y - startY, ziel.x - startX);
          Entities.erzeugeBossLaser(startX, startY, Math.cos(winkel) * 8, Math.sin(winkel) * 8);
          if (b.enragePhaseAktiv) {
            Entities.erzeugeBossLaser(startX, startY, Math.cos(winkel - 0.2) * 8, Math.sin(winkel - 0.2) * 8);
            Entities.erzeugeBossLaser(startX, startY, Math.cos(winkel + 0.2) * 8, Math.sin(winkel + 0.2) * 8);
          }
        } else if (b.bossTyp === 3) {
          // Spawnt einen Feind
          Entities.erzeugeFeind(b.x + b.groesse / 2 - 15, b.y + b.groesse);
          if (Math.random() < 0.5 || b.enragePhaseAktiv) Entities.erzeugeBossLaser(b.x + b.groesse / 2 - 4, b.y + b.groesse);
        } else if (b.bossTyp === 4) {
          // Fächerschuss (Spread)
          let anzahl = b.enragePhaseAktiv ? 7 : 5;
          let startX = b.x + b.groesse / 2 - 4;
          let startY = b.y + b.groesse - 10;
          for (let j = 0; j < anzahl; j++) {
            let winkel = Math.PI / 2 - 0.5 + j * (1.0 / (anzahl - 1));
            Entities.erzeugeBossLaser(startX, startY, Math.cos(winkel) * 6, Math.sin(winkel) * 6);
          }
        }
        b.schussTimer = b.baseSchussRate;
      }

      // Boss-Bomben Abwurf
      b.bombenTimer = (b.bombenTimer !== undefined ? b.bombenTimer : (Math.random() * 120 + 240)) - 1;
      if (b.bombenTimer <= 0) {
        Entities.erzeugeBossBombe(b.x + b.groesse / 2 - 13, b.y + b.groesse * 0.7);
        b.bombenTimer = Math.max(160, 360 - (state.level - 1) * 30);
      }

      // Boss-Raketen Abwurf (seitlich zielsuchend)
      b.raketenTimer = (b.raketenTimer !== undefined ? b.raketenTimer : (Math.random() * 140 + 200)) - 1;
      if (b.raketenTimer <= 0) {
        let side = Math.random() < 0.5 ? -1 : 1;
        Entities.erzeugeBossRakete(b.x + (side < 0 ? 0 : b.groesse - 14), b.y + b.groesse * 0.5, side);
        if (b.enragePhaseAktiv || state.level >= 4) {
          Entities.erzeugeBossRakete(b.x + (-side < 0 ? 0 : b.groesse - 14), b.y + b.groesse * 0.5, -side);
        }
        b.raketenTimer = Math.max(180, 360 - (state.level - 1) * 25);
      }
    }
    b.el.style.left = b.x + 'px';
    b.el.style.top = b.y + 'px';
    let bossPadding = b.groesse * 0.15;
    if (!state.isDead && !Utils.istDashUnverwundbar(state) && state.x < b.x + b.groesse - bossPadding && state.x + config.spielerGroesse > b.x + bossPadding && state.y < b.y + b.groesse - bossPadding && state.y + config.spielerGroesse > b.y + bossPadding) {
      Utils.spielerGetroffen(b, false, 'p1');
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && !Utils.istDashUnverwundbar(state.p2) && state.p2.x < b.x + b.groesse - bossPadding && state.p2.x + config.spielerGroesse > b.x + bossPadding && state.p2.y < b.y + b.groesse - bossPadding && state.p2.y + config.spielerGroesse > b.y + bossPadding) {
      Utils.spielerGetroffen(b, false, 'p2');
    }
  }
  for (let i = arrays.bossLaserArray.length - 1; i >= 0; i--) {
    let bl = arrays.bossLaserArray[i];
    if (!bl) break;
    bl.x += bl.vx || 0;
    bl.y += bl.vy;
    bl.el.style.left = bl.x + 'px';
    bl.el.style.top = bl.y + 'px';
    if (bl.y > config.spielfeldHoehe || bl.y < -bl.height || bl.x < -10 || bl.x > config.spielfeldBreite + 10) {
      bl.el.remove();
      arrays.bossLaserArray.splice(i, 1);
      continue;
    }
    // Von der Gleve seitlich weggeschleudert: trifft keine Spieler mehr
    if (bl.harmlos) continue;
    if (!state.isDead && !Utils.istDashUnverwundbar(state) && state.x < bl.x + bl.width && state.x + config.spielerGroesse > bl.x && state.y < bl.y + bl.height && state.y + config.spielerGroesse > bl.y) {
      Utils.spielerGetroffen(bl, false, 'p1');
      bl.el.remove();
      arrays.bossLaserArray.splice(i, 1);
      continue;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && !Utils.istDashUnverwundbar(state.p2) && state.p2.x < bl.x + bl.width && state.p2.x + config.spielerGroesse > bl.x && state.p2.y < bl.y + bl.height && state.p2.y + config.spielerGroesse > bl.y) {
      Utils.spielerGetroffen(bl, false, 'p2');
      bl.el.remove();
      arrays.bossLaserArray.splice(i, 1);
      continue;
    }
  }
}

export function aktualisiereBossBomben() {
  for (let i = arrays.bossBombenArray.length - 1; i >= 0; i--) {
    let bb = arrays.bossBombenArray[i];
    if (!bb) break;
    bb.x += bb.vx;
    bb.y += bb.vy;
    bb.el.style.left = bb.x + 'px';
    bb.el.style.top = bb.y + 'px';
    bb.timer--;

    // Beep-Takt beschleunigen je näher an der Detonation
    let bbProgress = Math.max(0, bb.timer / (bb.maxTimer || 180));
    let bbUrgency = 1.0 - bbProgress;
    bb.beepTimer = (bb.beepTimer || 0) + 1;
    let bbBeepInterval = Math.max(3, Math.floor(bbProgress * 20));
    if (bb.beepTimer >= bbBeepInterval) {
      bb.beepTimer = 0;
      Audio.playBombBeep(bbUrgency, true);
    }

    if (bb.hp <= 0) {
      Utils.addScore(150);
      Utils.erzeugeExplosion(bb.x + 13, bb.y + 13, '#2ecc71', 25);
      bb.el.remove();
      arrays.bossBombenArray.splice(i, 1);
      continue;
    }

    if (bb.y > config.spielfeldHoehe + 40 || bb.x < -40 || bb.x > config.spielfeldBreite + 40) {
      bb.el.remove();
      arrays.bossBombenArray.splice(i, 1);
      continue;
    }

    if (bb.timer <= 0 || bb.y >= config.spielfeldHoehe - 60) {
      let cx = bb.x + 13;
      let cy = bb.y + 13;
      Utils.erzeugeExplosion(cx, cy, '#e74c3c', 40);

      const sw = document.createElement('div');
      sw.classList.add('boss-shockwave');
      sw.style.position = 'absolute';
      sw.style.width = bb.radius * 2 + 'px';
      sw.style.height = bb.radius * 2 + 'px';
      sw.style.left = cx - bb.radius + 'px';
      sw.style.top = cy - bb.radius + 'px';
      sw.style.borderRadius = '50%';
      sw.style.backgroundColor = 'rgba(231, 76, 60, 0.45)';
      sw.style.boxShadow = '0 0 30px #e74c3c';
      sw.style.zIndex = '9';
      sw.style.pointerEvents = 'none';
      sw.style.transition = 'all 0.4s ease-out';
      dom.spielfeld.appendChild(sw);
      setTimeout(() => {
        sw.style.opacity = '0';
        sw.style.transform = 'scale(1.25)';
      }, 10);
      setTimeout(() => sw.remove(), 400);

      let distP1 = Math.hypot((state.x + config.spielerGroesse / 2) - cx, (state.y + config.spielerGroesse / 2) - cy);
      if (!state.isDead && distP1 <= bb.radius) {
        Utils.spielerGetroffen(bb, false, 'p1');
      }
      if (isCoopMode() && state.p2 && !state.p2.isDead) {
        let distP2 = Math.hypot((state.p2.x + config.spielerGroesse / 2) - cx, (state.p2.y + config.spielerGroesse / 2) - cy);
        if (distP2 <= bb.radius) {
          Utils.spielerGetroffen(bb, false, 'p2');
        }
      }

      bb.el.remove();
      arrays.bossBombenArray.splice(i, 1);
      continue;
    }

    if (!state.isDead && !Utils.istDashUnverwundbar(state) && state.x < bb.x + bb.groesse && state.x + config.spielerGroesse > bb.x && state.y < bb.y + bb.groesse && state.y + config.spielerGroesse > bb.y) {
      Utils.spielerGetroffen(bb, false, 'p1');
      bb.hp = 0;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && !Utils.istDashUnverwundbar(state.p2) && state.p2.x < bb.x + bb.groesse && state.p2.x + config.spielerGroesse > bb.x && state.p2.y < bb.y + bb.groesse && state.p2.y + config.spielerGroesse > bb.y) {
      Utils.spielerGetroffen(bb, false, 'p2');
      bb.hp = 0;
    }
  }
}

export function aktualisiereBossRaketen() {
  for (let i = arrays.bossRaketenArray.length - 1; i >= 0; i--) {
    let br = arrays.bossRaketenArray[i];
    if (!br) break;
    br.age = (br.age || 0) + 1;

    if (br.age % 8 === 0) {
      Audio.playBossRocketFlight();
    }

    // Homing Richtung näherer lebender Spieler
    const ziel = naechsterSpielerMitte(br);
    let dx = ziel.x - (br.x + br.width / 2);
    let dy = ziel.y - (br.y + br.height / 2);
    let targetAngle = Math.atan2(dy, dx);

    let currentAngle = Math.atan2(br.vy, br.vx);
    let angleDiff = targetAngle - currentAngle;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

    let turnSpeed = br.turnRate || 0.045;
    let newAngle = currentAngle + Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turnSpeed);

    let currentSpeed = br.speed || 2.3;
    br.vx = Math.cos(newAngle) * currentSpeed;
    br.vy = Math.sin(newAngle) * currentSpeed;

    br.x += br.vx;
    br.y += br.vy;
    br.el.style.left = br.x + 'px';
    br.el.style.top = br.y + 'px';
    let rotDeg = Math.atan2(br.vy, br.vx) * 180 / Math.PI + 90;
    br.el.style.transform = `rotate(${rotDeg}deg)`;

    // Partikel-Schweif
    if (Math.random() < 0.4) {
      const pEl = document.createElement('div');
      pEl.classList.add('partikel');
      pEl.style.backgroundColor = Math.random() < 0.6 ? '#e74c3c' : '#f39c12';
      let px = br.x + br.width / 2;
      let py = br.y + br.height;
      pEl.style.left = px + 'px';
      pEl.style.top = py + 'px';
      dom.spielfeld.appendChild(pEl);
      arrays.partikelArray.push({
        el: pEl,
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 0.4,
        vy: 0.5 + Math.random() * 0.5,
        leben: 0.8,
        zerfall: 0.05
      });
    }

    // Wenn vom Spieler zerstört
    if (br.hp <= 0) {
      Utils.addScore(100);
      Audio.playMissileExplosion();
      Utils.erzeugeExplosion(br.x + br.width / 2, br.y + br.height / 2, '#e67e22', 20);
      br.el.remove();
      arrays.bossRaketenArray.splice(i, 1);
      continue;
    }

    // Bildschirm weit verlassen
    if (br.y > config.spielfeldHoehe + 60 || br.x < -80 || br.x > config.spielfeldBreite + 80 || br.y < -100) {
      br.el.remove();
      arrays.bossRaketenArray.splice(i, 1);
      continue;
    }

    // Kollision mit Spieler
    if (!state.isDead && !Utils.istDashUnverwundbar(state) && state.x < br.x + br.width && state.x + config.spielerGroesse > br.x && state.y < br.y + br.height && state.y + config.spielerGroesse > br.y) {
      Utils.spielerGetroffen(br, false, 'p1');
      Audio.playMissileExplosion();
      Utils.erzeugeExplosion(br.x + br.width / 2, br.y + br.height / 2, '#e74c3c', 25);
      br.el.remove();
      arrays.bossRaketenArray.splice(i, 1);
      continue;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && !Utils.istDashUnverwundbar(state.p2) && state.p2.x < br.x + br.width && state.p2.x + config.spielerGroesse > br.x && state.p2.y < br.y + br.height && state.p2.y + config.spielerGroesse > br.y) {
      Utils.spielerGetroffen(br, false, 'p2');
      Audio.playMissileExplosion();
      Utils.erzeugeExplosion(br.x + br.width / 2, br.y + br.height / 2, '#e74c3c', 25);
      br.el.remove();
      arrays.bossRaketenArray.splice(i, 1);
      continue;
    }
  }
}
