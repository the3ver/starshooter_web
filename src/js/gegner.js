
import { state, config, arrays, isCoopMode } from './state.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Hack from './hack.js';


export function verwalteFeindSpawns() {
  // Hacker: Spezialeinheit ab Level 2, höchstens einer gleichzeitig
  const hackerAktiv = arrays.feinde.some(f => f.muster === 'hacker');
  if (state.level >= 2 && !hackerAktiv && Math.random() < 0.1) {
    Entities.erzeugeFeind(30 + Math.random() * (config.spielfeldBreite - 90), -30, 'hacker', 0);
    return;
  }

  let pV = state.level >= 2 ? Math.min(0.25, 0.05 + (state.level - 2) * 0.05) : 0;
  let pCross = state.level >= 1 ? Math.min(0.20, 0.05 + (state.level - 1) * 0.05) : 0;
  let pSwoop = state.level >= 1 ? Math.min(0.20, 0.05 + (state.level - 1) * 0.05) : 0;
  let pClingOn = state.level >= 1 ? Math.min(0.20, 0.05 + (state.level - 1) * 0.05) : 0;
  
  let r = Math.random();
  
  if (r < pV) {
    // V-Formation (3 oder 5 Jäger)
    let count = Math.random() < 0.5 ? 3 : 5;
    let spacingX = 40;
    let spacingY = 30;
    let centerX = config.spielfeldBreite / 2 - 15;
    for (let i = 0; i < count; i++) {
      let offset = Math.ceil(i / 2);
      let side = i % 2 === 0 && i !== 0 ? -1 : 1;
      if (i === 0) {
        offset = 0;
        side = 0;
      }
      Entities.erzeugeFeind(centerX + offset * spacingX * side, -30 - offset * spacingY, 'normal', 0);
    }
  } else if (r < pV + pCross) {
    // Crossfire (2 Jäger überkreuz)
    Entities.erzeugeFeind(10, -30, 'crossfire', 2.5);
    Entities.erzeugeFeind(config.spielfeldBreite - 40, -30, 'crossfire', -2.5);
  } else if (r < pV + pCross + pSwoop) {
    // Swoop (1 Jäger von der Seite)
    let spawnLeft = Math.random() < 0.5;
    Entities.erzeugeFeind(spawnLeft ? -30 : config.spielfeldBreite, 20 + Math.random() * 50, 'swoop', spawnLeft ? 3.5 : -3.5);
  } else if (r < pV + pCross + pSwoop + pClingOn) {
    // Cling-on Feind an neuem Asteroid
    Entities.erzeugeClingOnFeind();
  } else {
    // Einzelner Jäger (Normal oder Stop&Go)
    Entities.erzeugeFeind();
  }
}

// Nächster lebender Spieler (state oder state.p2). Abstand von der Spieler-Ecke
// (x/y) zum Referenzpunkt; P2 nur im Coop, wenn er lebt. Toter P1 oder
// kleinerer Abstand wählt P2, bei Gleichstand bleibt es P1.
export function naechsterSpieler(refX, refY) {
  if (isCoopMode() && state.p2 && !state.p2.isDead) {
    let distP1 = Math.hypot(state.x - refX, state.y - refY);
    let distP2 = Math.hypot(state.p2.x - refX, state.p2.y - refY);
    if (state.isDead || distP2 < distP1) return state.p2;
  }
  return state;
}

// Position (Mitte) des nächsten lebenden Spielers, gemessen ab der Ecke von f
export function naechsterSpielerMitte(f) {
  const s = naechsterSpieler(f.x, f.y);
  return { x: s.x + config.spielerGroesse / 2, y: s.y + config.spielerGroesse / 2 };
}

const HACKER_LAUERZEIT = 600; // 10 s
const HACK_MAX_DREHUNG = 0.025; // rad pro Frame (~1,5°), damit man ausweichen kann
const HACKER_SCHUSSINTERVALL = 120; // 2 s

function aktualisiereHacker(f) {
  if (f.phase === 'anflug') {
    f.y += f.vy * 2;
    if (f.y >= f.stopY) {
      f.y = f.stopY;
      f.phase = 'lauern';
      f.lauerTimer = HACKER_LAUERZEIT;
      f.hackTimer = 30;
    }
  } else if (f.phase === 'lauern') {
    f.hackTimer--;
    if (f.hackTimer <= 0) {
      const ziel = naechsterSpielerMitte(f);
      Entities.erzeugeHackProjektil(f.x + f.groesse / 2 - 6, f.y + f.groesse, ziel.x, ziel.y, f);
      f.hackSchuesse++;
      f.hackTimer = HACKER_SCHUSSINTERVALL;
    }
    f.lauerTimer--;
    if (f.lauerTimer <= 0 || f.hackGelandet) f.phase = 'flucht';
  } else if (f.phase === 'flucht') {
    f.y -= 5;
  }
}

export function aktualisiereAsteroiden() {
  for (let i = arrays.asteroiden.length - 1; i >= 0; i--) {
    let ast = arrays.asteroiden[i];
    if (!ast) break;
    if (ast.immune > 0) ast.immune--;
    ast.x += ast.vx;
    ast.y += ast.vy;
    if (ast.vRot) {
      ast.rot += ast.vRot;
      ast.el.style.transform = `rotate(${ast.rot}deg)`;
    }
    ast.el.style.left = ast.x + 'px';
    ast.el.style.top = ast.y + 'px';
    if (ast.y > config.spielfeldHoehe || ast.x < -ast.groesse || ast.x > config.spielfeldBreite) {
      ast.el.remove();
      arrays.asteroiden.splice(i, 1);
      continue;
    }
    if (!state.isDead && !Utils.istDashUnverwundbar(state) && state.x < ast.x + ast.groesse && state.x + config.spielerGroesse > ast.x && state.y < ast.y + ast.groesse && state.y + config.spielerGroesse > ast.y) {
      Utils.spielerGetroffen(ast, true, 'p1');
      ast.el.remove();
      arrays.asteroiden.splice(i, 1);
      continue;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && !Utils.istDashUnverwundbar(state.p2) && state.p2.x < ast.x + ast.groesse && state.p2.x + config.spielerGroesse > ast.x && state.p2.y < ast.y + ast.groesse && state.p2.y + config.spielerGroesse > ast.y) {
      Utils.spielerGetroffen(ast, true, 'p2');
      ast.el.remove();
      arrays.asteroiden.splice(i, 1);
      continue;
    }
  }
}

export function aktualisiereFeinde() {
  for (let i = arrays.feinde.length - 1; i >= 0; i--) {
    let f = arrays.feinde[i];
    if (!f) break;
    if (f.muster === 'stopAndGo') {
      if (f.phase === 'anflug') {
        f.y += f.vy * 2.5; // Schneller Anflug
        if (f.y >= f.stopY) {
          f.phase = 'stop';
          f.stopTimer = 40;
        }
      } else if (f.phase === 'stop') {
        f.stopTimer--;
        if (f.stopTimer === 10) {
          // Gezielter Schuss auf den näheren Spieler
          const ziel = naechsterSpielerMitte(f);
          Entities.erzeugeFeindLaser(f.x + f.groesse / 2 - 2, f.y + f.groesse, ziel.x, ziel.y);
        }
        if (f.stopTimer <= 0) {
          f.phase = 'abflug';
          f.schussTimer = 9999;
        }
      } else if (f.phase === 'abflug') {
        f.y += f.vy * 3.5; // Sehr schneller Abflug
      }
      f.zeit += 0.05;
      f.x = f.basisX + Math.sin(f.zeit) * 20;
    } else if (f.muster === 'swoop' || f.muster === 'crossfire') {
      f.x += f.vx;
      f.y += f.vy * 1.5;
      f.el.style.transform = `rotate(${Math.atan2(f.vy * 1.5, f.vx) * 180 / Math.PI - 90}deg)`;
    } else if (f.muster === 'clingOn') {
      if (f.phase === 'attached') {
        let asteroidExists = arrays.asteroiden.includes(f.attachedAsteroid);
        if (!asteroidExists || f.attachedAsteroid.y >= 150) {
          f.phase = 'attack';
          f.vy = 2;
          f.schussTimer = 9999;
          
          let flames = f.el.querySelectorAll('.feind-flame');
          flames.forEach(fl => fl.style.display = 'block');
          
          const ziel = naechsterSpielerMitte(f);
          Entities.erzeugeFeindLaser(f.x + f.groesse / 2 - 2, f.y + f.groesse, ziel.x, ziel.y);
        } else {
          f.x = f.attachedAsteroid.x + f.attachedAsteroid.groesse / 2 - f.groesse / 2;
          f.y = f.attachedAsteroid.y + f.attachedAsteroid.groesse / 2 - f.groesse / 2;
        }
      }
      if (f.phase === 'attack') {
        const ziel = naechsterSpielerMitte(f);
        let dx = ziel.x - (f.x + f.groesse / 2);
        let dy = ziel.y - (f.y + f.groesse / 2);
        let dist = Math.hypot(dx, dy);
        if (dist > 5) {
          f.vx = dx / dist * 3;
          f.vy = dy / dist * 3;
        }
        f.x += f.vx;
        f.y += f.vy;
        f.el.style.transform = `rotate(${Math.atan2(f.vy, f.vx) * 180 / Math.PI - 90}deg)`;
      }
    } else if (f.muster === 'hacker') {
      aktualisiereHacker(f);
    } else {
      f.y += f.vy;
      f.zeit += 0.05;
      f.x = f.basisX + Math.sin(f.zeit) * 30;
    }
    f.el.style.left = f.x + 'px';
    f.el.style.top = f.y + 'px';
    if (f.y > config.spielfeldHoehe || f.x < -f.groesse - 50 || f.x > config.spielfeldBreite + 50 || (f.phase === 'flucht' && f.y < -f.groesse - 10)) {
      f.el.remove();
      arrays.feinde.splice(i, 1);
      continue;
    }

    if (f.muster !== 'hacker' && (f.muster !== 'clingOn' || f.phase !== 'attached')) {
      if (f.burstCount > 0) {
        f.burstTimer--;
        if (f.burstTimer <= 0) {
          Entities.erzeugeFeindLaser(f.x + f.groesse / 2 - 2, f.y + f.groesse);
          f.burstCount--;
          f.burstTimer = 8;
        }
      }

      f.schussTimer--;
      if (f.schussTimer <= 0) {
        Entities.erzeugeFeindLaser(f.x + f.groesse / 2 - 2, f.y + f.groesse);
        let schussBasis = Math.max(25, 60 - (state.level - 1) * 8);
        f.schussTimer = Math.random() * schussBasis + schussBasis;

        if (state.level >= 3 && (Math.random() < Math.min(0.9, 0.5 + (state.level - 3) * 0.2) || f.forceBurst)) {
          f.burstCount = 1;
          f.burstTimer = 8;
        }
      }
    }
    if (!state.isDead && !Utils.istDashUnverwundbar(state) && state.x < f.x + f.groesse && state.x + config.spielerGroesse > f.x && state.y < f.y + f.groesse && state.y + config.spielerGroesse > f.y) {
      Utils.spielerGetroffen(f, true, 'p1');
      f.el.remove();
      arrays.feinde.splice(i, 1);
      continue;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && !Utils.istDashUnverwundbar(state.p2) && state.p2.x < f.x + f.groesse && state.p2.x + config.spielerGroesse > f.x && state.p2.y < f.y + f.groesse && state.p2.y + config.spielerGroesse > f.y) {
      Utils.spielerGetroffen(f, true, 'p2');
      f.el.remove();
      arrays.feinde.splice(i, 1);
      continue;
    }
  }
}

export function aktualisiereFeindLaser() {
  for (let i = arrays.feindLaserArray.length - 1; i >= 0; i--) {
    let fl = arrays.feindLaserArray[i];
    if (!fl) break;
    fl.y += fl.vy;
    if (fl.vx) fl.x += fl.vx;
    fl.el.style.top = fl.y + 'px';
    fl.el.style.left = fl.x + 'px';
    if (fl.y > config.spielfeldHoehe || fl.y < -fl.height || fl.x < -fl.width || fl.x > config.spielfeldBreite) {
      fl.el.remove();
      arrays.feindLaserArray.splice(i, 1);
      continue;
    }
    // Von der Gleve seitlich weggeschleudert: trifft keine Spieler mehr
    if (fl.harmlos) continue;
    if (!state.isDead && !Utils.istDashUnverwundbar(state) && state.x < fl.x + fl.width && state.x + config.spielerGroesse > fl.x && state.y < fl.y + fl.height && state.y + config.spielerGroesse > fl.y) {
      Utils.spielerGetroffen(fl, false, 'p1');
      fl.el.remove();
      arrays.feindLaserArray.splice(i, 1);
      continue;
    }
    if (isCoopMode() && state.p2 && !state.p2.isDead && !Utils.istDashUnverwundbar(state.p2) && state.p2.x < fl.x + fl.width && state.p2.x + config.spielerGroesse > fl.x && state.p2.y < fl.y + fl.height && state.p2.y + config.spielerGroesse > fl.y) {
      Utils.spielerGetroffen(fl, false, 'p2');
      fl.el.remove();
      arrays.feindLaserArray.splice(i, 1);
      continue;
    }
  }
}

export function aktualisiereHackProjektile() {
  for (let i = arrays.hackProjektilArray.length - 1; i >= 0; i--) {
    let hp = arrays.hackProjektilArray[i];
    if (hp.lenkZeit > 0) {
      hp.lenkZeit--;
      const ziel = naechsterSpielerMitte(hp);
      // Nach dem Vorbeiflug nicht mehr nachlenken
      if (hp.y + hp.height / 2 > ziel.y) hp.lenkZeit = 0;
      const ist = Math.atan2(hp.vy, hp.vx);
      const soll = Math.atan2(ziel.y - (hp.y + hp.height / 2), ziel.x - (hp.x + hp.width / 2));
      let diff = Math.atan2(Math.sin(soll - ist), Math.cos(soll - ist));
      diff = Math.max(-HACK_MAX_DREHUNG, Math.min(HACK_MAX_DREHUNG, diff));
      const tempo = Math.hypot(hp.vx, hp.vy);
      hp.vx = Math.cos(ist + diff) * tempo;
      hp.vy = Math.sin(ist + diff) * tempo;
    }
    hp.x += hp.vx;
    hp.y += hp.vy;
    hp.el.style.left = hp.x + 'px';
    hp.el.style.top = hp.y + 'px';
    if (hp.y > config.spielfeldHoehe || hp.y < -hp.height || hp.x < -hp.width || hp.x > config.spielfeldBreite) {
      hp.el.remove();
      arrays.hackProjektilArray.splice(i, 1);
      continue;
    }
    // Von der Gleve seitlich weggeschleudert: trifft keine Spieler mehr
    if (hp.harmlos) continue;
    let getroffen = null;
    if (!state.isDead && !Utils.istDashUnverwundbar(state) && state.x < hp.x + hp.width && state.x + config.spielerGroesse > hp.x && state.y < hp.y + hp.height && state.y + config.spielerGroesse > hp.y) {
      getroffen = state;
    } else if (isCoopMode() && state.p2 && !state.p2.isDead && !Utils.istDashUnverwundbar(state.p2) && state.p2.x < hp.x + hp.width && state.p2.x + config.spielerGroesse > hp.x && state.p2.y < hp.y + hp.height && state.p2.y + config.spielerGroesse > hp.y) {
      getroffen = state.p2;
    }
    if (getroffen) {
      // Ein Hacker kann nur einen Treffer landen
      if (!hp.quelle || !hp.quelle.hackGelandet) {
        Hack.hackeSpieler(getroffen);
        if (hp.quelle) hp.quelle.hackGelandet = true;
      }
      hp.el.remove();
      arrays.hackProjektilArray.splice(i, 1);
    }
  }
}
