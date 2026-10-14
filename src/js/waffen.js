
import { state, dom, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Audio from './audio.js';
import * as Network from './network.js';
import * as Hack from './hack.js';
import * as Gleve from './gleve.js';
import * as Viper from './viper.js';
import * as Sniper from './sniper.js';
import * as Anzeige from './anzeige.js';
import { erzeugePartikel } from './partikel.js';


export function versteckeAlleLaser() {
  dom.laser1.style.display = 'none';
  dom.laser2.style.display = 'none';
  dom.laserDiagLinks.style.display = 'none';
  dom.laserDiagRechts.style.display = 'none';
}

// --- 9.10 MANUELLE LASER (Projektile) ---
function feuerLaserFuerSpieler(pKey, pState, isFiring) {
  if (!pState || pState.isDead) return;
  if (pState.spielerSchussCooldown > 0) pState.spielerSchussCooldown--;
  if (isFiring && pState.spielerSchussCooldown <= 0) {
    pState.spielerSchussCooldown = Viper.schussCooldown(pState); // Schussrate (Viper: Overdrive doppelt, Kombo schneller)
    Audio.playLaser(pState.laserStufe);

    // Schaden pro Projektil (skaliert umgekehrt zur Projektilanzahl, damit Gesamt-DPS kontrolliert wächst)
    let grundSchaden = 16; // 1 Projektil = 160 DPS (Stufe 1)
    if (pState.laserStufe === 2) grundSchaden = 10; // 2 Projektile = 200 DPS
    else if (pState.laserStufe === 3) grundSchaden = 12; // 2 Projektile = 240 DPS
    else if (pState.laserStufe >= 4) grundSchaden = 8; // 4 Projektile = 320 DPS

    let strahlenDef = [];
    const primaryColor = pKey === 'p2' ? '#3498db' : '#00ffff';
    const quadColor = pKey === 'p2' ? '#00d2d3' : '#a000ff';
    if (pState.laserStufe === 1) {
      strahlenDef.push({
        offsetX: 11,
        width: 8,
        vx: 0,
        color: primaryColor
      });
    } else if (pState.laserStufe === 2) {
      strahlenDef.push({
        offsetX: 5,
        width: 4,
        vx: 0,
        color: primaryColor
      });
      strahlenDef.push({
        offsetX: 21,
        width: 4,
        vx: 0,
        color: primaryColor
      });
    } else if (pState.laserStufe >= 3) {
      strahlenDef.push({
        offsetX: 5,
        width: 5,
        vx: 0,
        color: '#ffffff'
      });
      strahlenDef.push({
        offsetX: 20,
        width: 5,
        vx: 0,
        color: '#ffffff'
      });
      if (pState.laserStufe >= 4) {
        strahlenDef.push({
          offsetX: 0,
          width: 4,
          vx: 0,
          color: quadColor
        });
        strahlenDef.push({
          offsetX: 26,
          width: 4,
          vx: 0,
          color: quadColor
        });
      }
    }
    strahlenDef.forEach(st => {
      arrays.laserArray.push(Anzeige.erzeuge({
        id: Entities.neueId('l'),
        // Seitlich fliegende Laser leicht gedreht
        rot: st.vx !== 0 ? Math.atan2(-15, st.vx) * 180 / Math.PI + 90 : undefined,
        farbe: st.color,
        x: pState.x + st.offsetX,
        y: pState.y,
        vx: st.vx,
        vy: 15,
        width: st.width,
        height: 20,
        schaden: grundSchaden,
        owner: pKey,
        durchschlag: pState.laserDurchschlag || Viper.istOverdrive(pState)
      }, 'laser'));
    });
  }
}

// --- 9.13 RAKETEN ---
// Gleve: gleicher Cooldown-Zaehler und HUD-Balken, aber fuer den Dash (ausgeloest in spieler.js / gleve.js)
function feuerRaketenFuerSpieler(pKey, pState) {
  if (!pState || pState.isDead) return;
  const istGleve = Gleve.istGleve(pState);
  if (istGleve) Gleve.aktualisiereDashLadungen(pState);
  else if (Sniper.istSniper(pState)) Sniper.aktualisiereGranatenLadungen(pKey, pState);
  else if (pState.raketenCooldown > 0) pState.raketenCooldown--;

  let maxRaketenCd = 180;
  if (pState.raketenStufe >= 2 && pState.raketenStufe <= 3) maxRaketenCd = 150;
  if (pState.raketenStufe >= 4) maxRaketenCd = 120;
  if (istGleve) maxRaketenCd = Gleve.dashCooldown(pState);
  if (Sniper.istSniper(pState)) maxRaketenCd = Sniper.granatenCooldown(pState);

  if (istGleve) {
    Gleve.zeigeDashHud(pKey, pState);
  } else if (Sniper.istSniper(pState)) {
    // HUD pflegt Sniper.aktualisiereGranatenLadungen
  } else if (pKey === 'p1') {
    const raketenCdBalken = document.getElementById('raketen-cd-balken');
    if (raketenCdBalken) {
      let pctR = Math.max(0, 100 - pState.raketenCooldown / maxRaketenCd * 100);
      raketenCdBalken.style.width = pctR + '%';
      raketenCdBalken.style.backgroundColor = pState.raketenCooldown <= 0 ? '#2ecc71' : '#e74c3c';
    }
    const mobileBtnRaketeCd = document.getElementById('btn-rakete-cd');
    if (mobileBtnRaketeCd) {
      let pctR = Math.max(0, 100 - pState.raketenCooldown / maxRaketenCd * 100);
      mobileBtnRaketeCd.style.height = pctR + '%';
      mobileBtnRaketeCd.style.backgroundColor = pState.raketenCooldown <= 0 ? 'rgba(46, 204, 113, 0.5)' : 'rgba(231, 76, 60, 0.5)';
    }
  } else {
    const raketenCdBalkenP2 = document.getElementById('raketen-cd-balken-p2');
    if (raketenCdBalkenP2) {
      let pctR = Math.max(0, 100 - pState.raketenCooldown / maxRaketenCd * 100);
      raketenCdBalkenP2.style.width = pctR + '%';
      raketenCdBalkenP2.style.backgroundColor = pState.raketenCooldown <= 0 ? '#2ecc71' : '#e74c3c';
    }
  }

  if (istGleve) {
    // Keine Raketen; ein gemerkter Online-Feuerbefehl darf nicht liegen bleiben
    if (pKey === 'p2' && state.p2) state.p2.networkFireRakete = false;
    return;
  }

  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  // Online-Host: gehaltene Raketentaste des Clients wirkt wie ein true in jedem Schritt
  if (pKey === 'p2' && state.p2 && state.p2.raketeGehalten && state.network && state.network.isOnline && state.network.isHost) {
    state.p2.networkFireRakete = true;
  }
  // Sniper: Tippen = Granate + EMP, Halten = Minen (Haken); der Online-Host merkt sich einen Druck, auch wenn das Loslassen im selben Schritt ankommt
  if (Sniper.istSniper(pState)) {
    let gehalten;
    if (pKey === 'p1') {
      gehalten = isDualHumanCoop ? state.tastenGedrueckt.v : (state.tastenGedrueckt.k || state.tastenGedrueckt.v);
    } else if (state.network && state.network.isOnline && state.network.isHost) {
      gehalten = Boolean(state.p2.raketeGehalten || state.p2.netzGranatenAnfrage);
      state.p2.netzGranatenAnfrage = false;
      state.p2.networkFireRakete = false;
    } else {
      gehalten = state.p2IsBot ? (state.p2.botFireRakete || false) : (state.tastenGedrueckt.ö || state.tastenGedrueckt.numpad2 || state.tastenGedrueckt[',']);
    }
    Sniper.aktualisiereGranatenTaste(pState, pKey, Boolean(gehalten));
    Sniper.zeigeGranatenHud(pKey, pState);
    return;
  }
  const isTriggered = pKey === 'p1'
    ? (isDualHumanCoop ? state.tastenGedrueckt.v : (state.tastenGedrueckt.k || state.tastenGedrueckt.v))
    : ((state.network && state.network.isOnline && state.network.isHost)
        ? Boolean(state.p2 && state.p2.networkFireRakete)
        : (state.p2IsBot ? (state.p2.botFireRakete || false) : (state.tastenGedrueckt.ö || state.tastenGedrueckt.numpad2 || state.tastenGedrueckt[','])));

  if (isTriggered && pState.raketenCooldown <= 0 && !Hack.hatHack(pState, 'waffenOffline')) {
    if (pKey === 'p2' && state.p2) state.p2.networkFireRakete = false;
    pState.raketenCooldown = maxRaketenCd;
    Audio.playMissile();
    let rSchaden = 25;
    let rRadius = 80;
    let anzahl = 1;
    if (pState.raketenStufe >= 2) rSchaden = 30;
    if (pState.raketenStufe >= 3) anzahl = 2;
    if (pState.raketenStufe >= 4) {
      rRadius = 100;
      rSchaden = 35;
    }
    if (pState.raketenStufe >= 5) anzahl = 3;

    let shipVx = pState.spielerVx || 0;
    let shipVy = pState.spielerVy || 0;
    let initVy = Math.max(0.5, 2.0 + shipVy * 0.6);

    let offsets = [];
    if (anzahl === 1) {
      const isPhantom = pState.selectedShipModel === 'phantom';
      offsets = [{
        ox: isPhantom ? 29 : -9,
        ejectVx: 0,
        homing: false
      }];
    } else if (anzahl === 2) {
      offsets = [{
        ox: -9,
        ejectVx: 0,
        homing: false
      }, {
        ox: 29,
        ejectVx: 0,
        homing: pState.raketenStufe >= 3
      }];
    } else if (anzahl === 3) {
      offsets = [{
        ox: -9,
        ejectVx: 0,
        homing: true
      }, {
        ox: 10,
        ejectVx: 0,
        homing: false
      }, {
        ox: 29,
        ejectVx: 0,
        homing: true
      }];
    }
    offsets.forEach(off => {
      let vx = off.ejectVx + shipVx * 0.4;
      arrays.raketenArray.push(Anzeige.erzeuge({
        id: Entities.neueId('r'),
        rot: Math.atan2(-initVy, vx) * 180 / Math.PI + 90,
        stufe: pState.raketenStufe,
        x: pState.x + off.ox,
        y: pState.y,
        vx: vx,
        vy: initVy,
        schaden: rSchaden,
        radius: rRadius,
        homing: off.homing,
        owner: pKey,
        age: 0,
        detoniert: false
      }, 'rakete'));
    });
  }
}

// --- 9.14 BOMBEN ---
function wirfBombeFuerSpieler(pKey, pState) {
  if (!pState || pState.isDead) return;
  if (pState.bombenCooldown > 0) pState.bombenCooldown--;
  let maxBombenCd = 2400 - pState.bombenStufe * 240; // 40s - 4s per level

  if (pKey === 'p1') {
    const bombenCdBalken = document.getElementById('bomben-cd-balken');
    if (bombenCdBalken) {
      let pctB = Math.max(0, 100 - pState.bombenCooldown / maxBombenCd * 100);
      bombenCdBalken.style.width = pctB + '%';
      bombenCdBalken.style.backgroundColor = pState.bombenCooldown <= 0 ? '#2ecc71' : '#f39c12';
    }
    const mobileBtnBombeCd = document.getElementById('btn-bombe-cd');
    if (mobileBtnBombeCd) {
      let pctB = Math.max(0, 100 - pState.bombenCooldown / maxBombenCd * 100);
      mobileBtnBombeCd.style.height = pctB + '%';
      mobileBtnBombeCd.style.backgroundColor = pState.bombenCooldown <= 0 ? 'rgba(46, 204, 113, 0.5)' : 'rgba(243, 156, 18, 0.5)';
    }
  } else {
    const bombenCdBalkenP2 = document.getElementById('bomben-cd-balken-p2');
    if (bombenCdBalkenP2) {
      let pctB = Math.max(0, 100 - pState.bombenCooldown / maxBombenCd * 100);
      bombenCdBalkenP2.style.width = pctB + '%';
      bombenCdBalkenP2.style.backgroundColor = pState.bombenCooldown <= 0 ? '#2ecc71' : '#f39c12';
    }
  }

  const isDualHumanCoop = state.gameMode === 'coop' && !state.p2IsBot;
  // Online-Host: gehaltene Bombentaste des Clients wirkt wie ein true in jedem Schritt
  if (pKey === 'p2' && state.p2 && state.p2.bombeGehalten && state.network && state.network.isOnline && state.network.isHost) {
    state.p2.networkFireBombe = true;
  }
  const isTriggered = pKey === 'p1'
    ? (isDualHumanCoop ? state.tastenGedrueckt.c : (state.tastenGedrueckt[' '] || state.tastenGedrueckt.c))
    : ((state.network && state.network.isOnline && state.network.isHost)
        ? Boolean(state.p2 && state.p2.networkFireBombe)
        : (state.p2IsBot ? (state.p2.botFireBombe || false) : (state.tastenGedrueckt.l || state.tastenGedrueckt.enter || state.tastenGedrueckt.numpad3 || state.tastenGedrueckt.numpad0)));

  if (isTriggered && pState.bombenCooldown <= 0 && !Hack.hatHack(pState, 'waffenOffline')) {
    if (pKey === 'p2' && state.p2) state.p2.networkFireBombe = false;
    pState.bombenCooldown = maxBombenCd;
    Audio.playBomb();
    let bSchaden = 100 + pState.bombenStufe * 50;
    let bRadius = 150 + pState.bombenStufe * 50;
    const stufeColors = { 1: '#e74c3c', 2: '#f39c12', 3: '#9b59b6', 4: '#00ffff', 5: '#f1c40f' };
    const stufeSpeeds = { 1: 1.5, 2: 1.8, 3: 2.0, 4: 2.3, 5: 2.6 };
    arrays.bombenArray.push(Anzeige.erzeuge({
      id: Entities.neueId('b'),
      x: pState.x + 8,
      y: pState.y,
      targetX: config.spielfeldBreite / 2 - 7,
      targetY: 285,
      startDist: 0,
      speed: stufeSpeeds[pState.bombenStufe] || 1.5,
      rot: 0,
      schaden: bSchaden,
      radius: bRadius,
      stufe: pState.bombenStufe,
      color: stufeColors[pState.bombenStufe] || '#f39c12',
      owner: pKey,
      isMini: false,
      beepTimer: 999,
      delayFrames: 0
    }, 'bombe'));
  }
}

export function aktualisiereWaffen(laserAktiv, laserAktivP2) {
  // Gleve hat statt Laser den Sweep (gleve.js): weder Projektil- noch Hitscan-Laser
  if (state.selectedShipModel === 'gleve') laserAktiv = false;
  if (state.p2 && state.p2.selectedShipModel === 'gleve') laserAktivP2 = false;
  // Sniper hat statt Laser den Fadenkreuz-Schuss (sniper.js, aufgerufen aus spieler.js)
  if (state.selectedShipModel === 'sniper') laserAktiv = false;
  if (state.p2 && state.p2.selectedShipModel === 'sniper') laserAktivP2 = false;
  const alleZiele = [...arrays.asteroiden, ...arrays.feinde, ...arrays.bosses, ...arrays.bossBombenArray, ...arrays.bossRaketenArray];

  // --- 9.9 AUTOLASER ---
  if (state.autolaserTimer > 0) {
    state.autolaserTimer--;
    if (state.autolaserTimer <= 0) {
      state.autolaserAktiv = false;
      Utils.updateAktivePowerupsUI();
    }
  }
  if (state.autolaserAktiv && !Hack.hatHack(state, 'waffenOffline')) {
    let target = null;
    let minDist = Infinity;
    let sx = state.x + 15;
    let sy = state.y;
    for (let i = 0; i < alleZiele.length; i++) {
      let z = alleZiele[i];
      if (z.istUnzerstoerbar) continue;
      if (z.y + z.groesse < sy) {
        let tx = z.x + z.groesse / 2;
        let ty = z.y + z.groesse / 2;
        let dist = Math.hypot(tx - sx, ty - sy);
        if (dist < minDist) {
          minDist = dist;
          target = z;
        }
      }
    }
    if (target) {
      if (state.autolaserTimer % 10 === 0) {
        Audio.playAutolaser();
      }
      let tx = target.x + target.groesse / 2;
      let ty = target.y + target.groesse / 2;
      let dx = tx - sx;
      let dy = ty - sy;
      let dist = Math.hypot(dx, dy);
      let angle = Math.atan2(dx, -dy) * 180 / Math.PI;
      dom.autolaserEl.style.display = 'block';
      dom.autolaserEl.style.height = dist + 'px';
      dom.autolaserEl.style.top = sy - dist + 'px';
      dom.autolaserEl.style.left = sx - 2 + 'px';
      dom.autolaserEl.style.transform = `rotate(${angle}deg)`;
      if (!target.istUnzerstoerbar) {
        if ((target.schildHp || 0) > 0) {
          target.schildHp -= 1.5;
          if (target.schildHp <= 0) {
            target.schildHp = 0;
          }
        } else {
          target.hp -= 1.5;
          Anzeige.blitze(target, 2.5);
          if (target.hp <= 0) Utils.zerstoereZiel(target, 'p1');
        }
      }
    } else {
      dom.autolaserEl.style.display = 'none';
    }
  } else {
    dom.autolaserEl.style.display = 'none';
  }

  // --- 9.12 HITSCAN LASER (Level 5) ---
  const hitscanLaserEl = document.getElementById('hitscan-laser');
  if (laserAktiv && state.laserStufe >= 5) {
    let target = null;
    let closestDist = Infinity;
    let sx = state.x + 15;
    let sy = state.y;
    // Finde tiefstes Ziel direkt über dem Spieler
    for (let i = 0; i < alleZiele.length; i++) {
      let z = alleZiele[i];
      if (z.y + z.groesse < sy && z.x < sx + 10 && z.x + z.groesse > sx - 10) {
        let dist = sy - (z.y + z.groesse);
        if (dist < closestDist) {
          closestDist = dist;
          target = z;
        }
      }
    }
    if (target) {
      hitscanLaserEl.style.display = 'block';
      hitscanLaserEl.style.height = closestDist + 'px';
      hitscanLaserEl.style.top = (sy - closestDist) + 'px';
      hitscanLaserEl.style.left = (sx - 3) + 'px';
      if (!target.istUnzerstoerbar) {
        if ((target.schildHp || 0) > 0) {
          target.schildHp -= 5;
          if (target.schildHp <= 0) {
            target.schildHp = 0;
          }
        } else {
          target.hp -= 5;
          Anzeige.blitze(target, 3);
          if (target.hp <= 0) Utils.zerstoereZiel(target, 'p1');
        }
      }
    } else {
      hitscanLaserEl.style.display = 'block';
      hitscanLaserEl.style.height = sy + 'px'; // Bis ganz nach oben
      hitscanLaserEl.style.top = '0px';
      hitscanLaserEl.style.left = sx - 3 + 'px';
    }
  } else {
    hitscanLaserEl.style.display = 'none';
  }

  // --- 9.10 MANUELLE LASER (Projektile) ---
  feuerLaserFuerSpieler('p1', state, laserAktiv);
  if (isCoopMode() && state.p2) {
    feuerLaserFuerSpieler('p2', state.p2, laserAktivP2);
  }

  // --- 9.10b LASER UPDATE & KOLLISION ---
  for (let i = arrays.laserArray.length - 1; i >= 0; i--) {
    let l = arrays.laserArray[i];
    l.x += l.vx;
    l.y -= l.vy;
    l.rot = l.vx !== 0 ? Math.atan2(-l.vy, l.vx) * 180 / Math.PI + 90 : 0;
    if (l.y < -30 || l.x < -30 || l.x > config.spielfeldBreite + 30) {
      Anzeige.entferne(l);
      arrays.laserArray.splice(i, 1);
      continue;
    }

    // Kollision
    let getroffenZiel = null;
    for (let j = 0; j < alleZiele.length; j++) {
      let z = alleZiele[j];
      if (z === l.ignoreTarget) continue; // Ignoriere Ziel nach Abpraller
      if ((z.immune || 0) <= 0) {
        let padding = z.istBoss ? z.groesse * 0.15 : 0;
        if (l.x < z.x + z.groesse - padding && l.x + l.width > z.x + padding && l.y < z.y + z.groesse - padding && l.y + l.height > z.y + padding) {
          getroffenZiel = z;
          break; // Erstes Ziel treffen
        }
      }
    }
    if (getroffenZiel) {
      if (!getroffenZiel.istUnzerstoerbar) {
        if ((getroffenZiel.schildHp || 0) > 0) {
          getroffenZiel.schildHp -= l.schaden;
          if (getroffenZiel.schildHp <= 0) {
            getroffenZiel.schildHp = 0;
            for (let k = 0; k < 5; k++) {
              Utils.erzeugeRauchFunken(getroffenZiel.x + 15, getroffenZiel.y + 15, 10);
            }
          }
          Anzeige.blitze(getroffenZiel, 2.2);
        } else {
          getroffenZiel.hp -= l.schaden;
          Anzeige.blitze(getroffenZiel, 2.5);
          if (getroffenZiel.hp <= 0) Utils.zerstoereZiel(getroffenZiel, l.owner || 'p1');
        }
        // Durchschlag: Flag des Projektils (Powerup oder Viper-Overdrive), sonst wie bisher das globale Powerup (z. B. Gleve-Rueckwurf)
        if (!l.durchschlag && !state.laserDurchschlag) {
          Anzeige.entferne(l);
          arrays.laserArray.splice(i, 1);
        }
      } else {
        // Abpraller-Logik (Magma-Asteroiden etc.)
        Audio.playHit('magma');
        // Querschläger fliegen nun vorwiegend weiter nach oben, 
        // mit einer leichten bis mittleren Ablenkung nach links oder rechts.
        l.vy = 8 + Math.random() * 7; // vy zwischen 8 und 15 (aufwärts)
        l.vx = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 6); // vx leicht zur Seite (2 bis 8)

        l.isDeflected = true;
        l.ignoreTarget = getroffenZiel; // Verhindert endloses Kollidieren im selben Frame
        l.schaden = Math.max(1, l.schaden / 2); // Schaden wird halbiert
        l.farbe = '#e67e22'; // Orange/Rötlich einfärben
      }
    } else if (l.isDeflected) {
      // Kollision mit Spieler, falls abgelenkt: nur der Schuetze selbst, kein Friendly Fire im Coop
      const schuetze = l.owner === 'p2' ? state.p2 : state;
      const trifftSchuetzen = (l.owner !== 'p2' || isCoopMode()) && schuetze && !schuetze.isDead;
      if (trifftSchuetzen && !Utils.istDashUnverwundbar(schuetze) && l.x < schuetze.x + config.spielerGroesse && l.x + l.width > schuetze.x && l.y < schuetze.y + config.spielerGroesse && l.y + l.height > schuetze.y) {
        Utils.spielerGetroffen(l, false, l.owner === 'p2' ? 'p2' : 'p1');
        Anzeige.entferne(l);
        arrays.laserArray.splice(i, 1);
      }
    }
  }

  // Gleve: laufende Sweeps (Treffer, Parade; gestartet in spieler.js)
  if (Gleve.istGleve(state)) Gleve.aktualisiereSweep(state, 'p1');
  if (isCoopMode() && state.p2 && Gleve.istGleve(state.p2)) Gleve.aktualisiereSweep(state.p2, 'p2');
  Gleve.aktualisiereWellen();

  // --- 9.13 RAKETEN ---
  feuerRaketenFuerSpieler('p1', state);
  if (isCoopMode() && state.p2) {
    feuerRaketenFuerSpieler('p2', state.p2);
  }

  // Raketen Update & Kollision (3-Phasen-Flugdynamik, Näherungszünder & Zielsuche)
  for (let i = arrays.raketenArray.length - 1; i >= 0; i--) {
    let r = arrays.raketenArray[i];
    r.age = (r.age || 0) + 1;

    // 3-Phasen-Flugdynamik:
    // Phase 1 (Frames 1-10): Seitliches Lösen / Ausklinken, erbt Schiffsgeschwindigkeit
    if (r.age <= 10) {
      r.x += r.vx;
      r.y -= r.vy;
      r.vx *= 0.95;
    }
    // Phase 2 (Frames 11-18): Kurzes Verlangsamen ("Anlauf nehmen" & Triebwerkszündung)
    else if (r.age <= 18) {
      r.vx *= 0.82;
      r.vy = Math.max(0.3, r.vy * 0.85);
      r.x += r.vx;
      r.y -= r.vy;
    }
    // Phase 3 (Frames 19+): Starke, lineare Beschleunigung (Triebwerks-Vollschub)
    else {
      // Im Co-op (600px Feld) beschleunigen Raketen stärker, um das breitere Feld zu kompensieren
      const rMaxVy = isCoopMode() ? 15 : 13;
      const rAccel = isCoopMode() ? 0.5 : 0.45;
      r.vy = Math.min(rMaxVy, r.vy + rAccel);
      r.vx *= 0.92;

      // Zielsuchende Lenkung (nur gegen Feinde und Bosse) ab Phase 3 aktiv
      if (r.homing) {
        let bestDist = Infinity;
        let target = null;
        const feindZiele = [...arrays.feinde, ...arrays.bosses];
        for (let f of feindZiele) {
          if (!f.istUnzerstoerbar && (f.immune || 0) <= 0) {
            let zcx = f.x + (f.groesse || 20) / 2;
            let zcy = f.y + (f.groesse || 20) / 2;
            let d = Math.hypot(zcx - (r.x + 3), zcy - (r.y + 8));
            // Feinde vor oder auf Höhe der Rakete erfassen
            // Im Co-op (600px) größeren Suchbereich nutzen, damit Feinde am breiten Rand gefunden werden
            const homingYRange = isCoopMode() ? 200 : 140;
            if (d < bestDist && zcy < r.y + homingYRange) {
              bestDist = d;
              target = f;
            }
          }
        }

        if (target) {
          let zcx = target.x + (target.groesse || 20) / 2;
          let zcy = target.y + (target.groesse || 20) / 2;
          let targetAngle = Math.atan2(zcy - (r.y + 8), zcx - (r.x + 3));
          let currentAngle = Math.atan2(-r.vy, r.vx || 0.0001);
          let diff = targetAngle - currentAngle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;

          // Im Co-op stärkere Lenkrate, damit Raketen den größeren horizontalen Abstand ausgleichen können
          let maxTurn = isCoopMode() ? 0.26 : 0.22;
          let newAngle = currentAngle + Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
          let currentSpeed = Math.hypot(r.vx, r.vy) || r.vy;
          r.vx = Math.cos(newAngle) * currentSpeed;
          r.vy = -Math.sin(newAngle) * currentSpeed;
        }
      }

      r.x += r.vx;
      r.y -= r.vy;
    }

    // Raketenausrichtung (Flugrichtung)
    r.rot = Math.atan2(-r.vy, r.vx || 0.0001) * 180 / Math.PI + 90;

    // Partikelschweif (Rauch beim Ausklinken, Vollfeuer in Phase 3)
    let flameProb = r.age > 18 ? 0.85 : (r.age > 10 ? 0.45 : 0.2);
    if (Math.random() < flameProb) {
      let farbe;
      if (r.homing && r.age > 18) {
        farbe = Math.random() < 0.5 ? '#00ffff' : '#3498db';
      } else if (r.age > 18) {
        farbe = Math.random() < 0.6 ? '#f1c40f' : '#e74c3c';
      } else {
        farbe = '#7f8c8d'; // Rauch beim Abwurf
      }
      erzeugePartikel({
        farbe,
        x: r.x + 2 + Math.random() * 4,
        y: r.y + 20,
        vx: (Math.random() - 0.5) * 0.5,
        vy: 0.5 + Math.random(),
        leben: 1.0,
        zerfall: 0.04
      });
    }

    if (r.y < -40 || r.x < -50 || r.x > config.spielfeldBreite + 50 || r.y > config.spielfeldHoehe + 50) {
      Anzeige.entferne(r);
      arrays.raketenArray.splice(i, 1);
      continue;
    }

    // Näherungszünder & Direkttreffer prüfen
    let detoniert = false;
    let rcx = r.x + 3;
    let rcy = r.y + 8;

    for (let j = 0; j < alleZiele.length; j++) {
      let z = alleZiele[j];
      if ((z.immune || 0) <= 0) {
        let zcx = z.x + (z.groesse || 20) / 2;
        let zcy = z.y + (z.groesse || 20) / 2;
        let dist = Math.hypot(zcx - rcx, zcy - rcy);
        // Näherungszündung bei Annäherung
        if (dist < (z.groesse || 20) / 2 + 18) {
          detoniert = true;
          break;
        }
      }
    }

    if (detoniert) {
      Utils.erzeugeRaketenDetonation(rcx, rcy, r.radius);
      if (state.gameMode === 'online') {
        Network.sendNetworkEvent({
          type: 'missile_detonated',
          x: rcx,
          y: rcy,
          radius: r.radius
        });
      }

      // Flächenschaden
      for (let j = 0; j < alleZiele.length; j++) {
        let z = alleZiele[j];
        if ((z.immune || 0) <= 0) {
          let zcx = z.x + (z.groesse || 20) / 2;
          let zcy = z.y + (z.groesse || 20) / 2;
          if (Math.hypot(zcx - rcx, zcy - rcy) <= r.radius) {
            if (!z.istUnzerstoerbar) {
              if ((z.schildHp || 0) > 0) {
                z.schildHp -= r.schaden;
                if (z.schildHp <= 0) {
                  z.schildHp = 0;
                  for (let k = 0; k < 5; k++) Utils.erzeugeRauchFunken(z.x + 15, z.y + 15, 10);
                }
                Anzeige.blitze(z, 2.2);
              } else {
                z.hp -= r.schaden;
                Anzeige.blitze(z, 2.5);
                if (z.hp <= 0) Utils.zerstoereZiel(z, r.owner || 'p1');
              }
            }
          }
        }
      }
      Anzeige.entferne(r);
      arrays.raketenArray.splice(i, 1);
    }
  }

  // --- 9.14 BOMBEN ---
  wirfBombeFuerSpieler('p1', state);
  if (isCoopMode() && state.p2) {
    wirfBombeFuerSpieler('p2', state.p2);
  }
  for (let i = arrays.bombenArray.length - 1; i >= 0; i--) {
    let b = arrays.bombenArray[i];

    // Mini-Bomben können eine Verzögerung haben
    if (b.delayFrames > 0) {
      b.delayFrames--;
    }

    // EMP-Effekt für Level 4 und 5: Löscht gegnerische Laser sofort aus
    if (b.stufe >= 4) {
      for (let l = arrays.feindLaserArray.length - 1; l >= 0; l--) {
        let fl = arrays.feindLaserArray[l];
        Utils.erzeugeExplosion(fl.x, fl.y, b.color, 2);
        Anzeige.entferne(fl);
        arrays.feindLaserArray.splice(l, 1);
      }
      for (let l = arrays.bossLaserArray.length - 1; l >= 0; l--) {
        let bl = arrays.bossLaserArray[l];
        Utils.erzeugeExplosion(bl.x, bl.y, b.color, 2);
        Anzeige.entferne(bl);
        arrays.bossLaserArray.splice(l, 1);
      }
    }

    let dx = b.targetX - (b.x + (b.isMini ? 5 : 7));
    let dy = b.targetY - (b.y + (b.isMini ? 10 : 15));
    let dist = Math.hypot(dx, dy);
    if (b.startDist === 0) b.startDist = dist;

    // Stufe 3: Vortex Gravitations-Sog vor der Explosion
    if (b.stufe === 3 && dist < 80) {
      let bcx = b.x + 7;
      let bcy = b.y + 15;
      alleZiele.forEach(z => {
        let zcx = z.x + (z.groesse || 20) / 2;
        let zcy = z.y + (z.groesse || 20) / 2;
        let pullDx = bcx - zcx;
        let pullDy = bcy - zcy;
        let pullDist = Math.hypot(pullDx, pullDy);
        if (pullDist > 5 && pullDist < 160) {
          z.x += (pullDx / pullDist) * 1.5;
          z.y += (pullDy / pullDist) * 1.5;
        }
      });
    }

    if (dist > 5 && (!b.isMini || b.delayFrames > 0)) {
      b.x += dx / dist * b.speed;
      b.y += dy / dist * b.speed;
      b.rot += b.isMini ? 5 : 2;

      // Blink- & Aura-Puls-Geschwindigkeit erhöhen je näher am Ziel
      // Fortschritt 1 -> 0 zum Ziel (Bombenpuls in der Anzeige, Beep-Takt)
      const progress = b.fortschritt = dist / (b.startDist || 1);

      // Beep-Takt beschleunigen je näher am Ziel
      let urgency = 1.0 - progress;
      b.beepTimer = (b.beepTimer || 0) + 1;
      let beepInterval = Math.max(3, Math.floor(progress * 22));
      if (b.beepTimer >= beepInterval) {
        b.beepTimer = 0;
        Audio.playBombBeep(urgency, false);
      }
    } else {
      // Level 5 Jericho-Split: Hauptbombe teilt sich in 4 Sub-Bomben auf
      if (b.stufe === 5 && !b.isMini) {
        let bcx = b.x + 7;
        let bcy = b.y + 15;
        Utils.erzeugeExplosion(bcx, bcy, '#ffffff', 40);

        // 4 Jericho Mini-Bomben fächern diagonal aus
        const offsets = [
          { ox: -75, oy: -65, delay: 10 },
          { ox: 75, oy: -65, delay: 16 },
          { ox: -75, oy: 65, delay: 22 },
          { ox: 75, oy: 65, delay: 28 }
        ];

        offsets.forEach(off => {
          arrays.bombenArray.push(Anzeige.erzeuge({
            id: Entities.neueId('b'),
            x: bcx - 5,
            y: bcy - 10,
            targetX: Math.max(20, Math.min(config.spielfeldBreite - 20, bcx + off.ox)),
            targetY: Math.max(20, Math.min(config.spielfeldHoehe - 20, bcy + off.oy)),
            startDist: 0,
            speed: 3.5,
            rot: Math.random() * 360,
            schaden: 220,
            radius: 200,
            stufe: 5,
            color: '#f1c40f',
            isMini: true,
            delayFrames: off.delay
          }, 'bombe'));
        });

        Anzeige.entferne(b);
        arrays.bombenArray.splice(i, 1);
        continue;
      }

      // Detonation
      let bcx = b.x + (b.isMini ? 5 : 7);
      let bcy = b.y + (b.isMini ? 10 : 15);
      Utils.erzeugeBombenDetonation(bcx, bcy, b.color || '#f39c12', b.radius, b.stufe, b.isMini);
      if (state.gameMode === 'online') {
        Network.sendNetworkEvent({
          type: 'bomb_detonated',
          x: bcx,
          y: bcy,
          color: b.color || '#f39c12',
          radius: b.radius,
          stufe: b.stufe,
          isMini: b.isMini
        });
      }

      for (let j = 0; j < alleZiele.length; j++) {
        let z = alleZiele[j];
        if ((z.immune || 0) <= 0) {
          let zcx = z.x + z.groesse / 2;
          let zcy = z.y + z.groesse / 2;
          if (Math.hypot(zcx - bcx, zcy - bcy) <= b.radius) {
            if (z.istUnzerstoerbar && z.hp !== undefined && !z.istBoss) {
              // Bomben zerstören Magma-Asteroiden (werden zu Powerup-Trägern)
              z.istUnzerstoerbar = false;
              z.traegtPowerup = true;
            }
            if (!z.istUnzerstoerbar) {
              if ((z.schildHp || 0) > 0) {
                z.schildHp = 0;
              }
              z.hp -= b.schaden;
              Anzeige.blitze(z, 3);
              if (z.hp <= 0) Utils.zerstoereZiel(z, b.owner || 'p1');
            }
          }
        }
      }
      Anzeige.entferne(b);
      arrays.bombenArray.splice(i, 1);
    }
  }
}
