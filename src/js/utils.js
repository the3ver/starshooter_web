
import { state, dom, config, arrays } from './state.js';
import * as Entities from './entities.js';
import * as Input from './input.js';
import * as Loop from './loop.js';


export function addScore(punkte) {
  state.score += punkte;
  dom.scoreAnzeige.innerText = state.score.toString().padStart(5, '0');
}
export function updateLebenUI() {
  let herzen = "";
  for (let i = 0; i < state.leben; i++) herzen += "&hearts;";
  dom.lebenAnzeige.innerHTML = herzen;
}
export function updateLevelUI() {
  dom.levelAnzeige.innerText = 'LEVEL ' + state.level;
}
export function updateMaxEnergieMarker() {
  dom.maxEnergieMarker.style.left = state.maxEnergie / state.absMaxEnergie * 100 + '%';
}
export function updateAktivePowerupsUI() {
  dom.aktivePowerupsContainer.innerHTML = '';
  if (state.laserStufe > 1) {
    let color = state.laserStufe === 5 ? '#e056fd' : '#9b59b6';
    dom.aktivePowerupsContainer.innerHTML += `<div class="active-pu-icon" style="background:rgba(155,89,182,0.2); border:1px solid ${color}; color:${color};">L${state.laserStufe}</div>`;
  }
  if (state.raketenStufe > 1) {
    let color = state.raketenStufe === 5 ? '#f39c12' : '#e67e22';
    dom.aktivePowerupsContainer.innerHTML += `<div class="active-pu-icon" style="background:rgba(230,126,34,0.2); border:1px solid ${color}; color:${color};">R${state.raketenStufe}</div>`;
  }
  if (state.bombenStufe > 1) {
    let color = state.bombenStufe === 5 ? '#e74c3c' : '#c0392b';
    dom.aktivePowerupsContainer.innerHTML += `<div class="active-pu-icon" style="background:rgba(192,57,43,0.2); border:1px solid ${color}; color:${color};">B${state.bombenStufe}</div>`;
  }
  if (state.laserDurchschlag) dom.aktivePowerupsContainer.innerHTML += '<div class="active-pu-icon" style="background:rgba(0,255,255,0.2); border:1px solid #00ffff; color:#00ffff;">&uarr;</div>';
  if (state.schildStufe > 0) dom.aktivePowerupsContainer.innerHTML += `<div class="active-pu-icon" style="background:rgba(52,152,219,0.2); border:1px solid #3498db; color:#3498db;">O${state.schildStufe}</div>`;
  if (state.autolaserAktiv) dom.aktivePowerupsContainer.innerHTML += '<div class="active-pu-icon" style="background:rgba(230,126,34,0.2); border:1px solid #e67e22; color:#e67e22;">A</div>';
}
export function zerstoereZiel(ziel) {
  let fIndex = arrays.feinde.indexOf(ziel);
  let aIndex = arrays.asteroiden.indexOf(ziel);
  let bIndex = arrays.bosses.indexOf(ziel);
  if (fIndex === -1 && aIndex === -1 && bIndex === -1) return;

  // Boss Logik beim Zerstören
  if (ziel.istBoss) {
    addScore(1000 * state.level);
    erzeugeExplosion(ziel.x + ziel.groesse / 2, ziel.y + ziel.groesse / 2, '#f1c40f', 50);

    // 3 Belohnungen fallen lassen (1 Waffe + 2 zufällige verschiedene)
    const moeglicheDrops = ['leben', 'energie', 'durchschlag', 'schild'];
    let drops = ['superWaffe']; // Super-Waffe ist immer garantiert beim Boss
    let randomIndex = Math.floor(Math.random() * moeglicheDrops.length);
    drops.push(moeglicheDrops.splice(randomIndex, 1)[0]); // Typ entfernen, damit er nicht doppelt kommt
    randomIndex = Math.floor(Math.random() * moeglicheDrops.length);
    drops.push(moeglicheDrops[randomIndex]); // Zweiter Typ

    // Positionen mischen, damit Waffe nicht immer links spawnt
    drops.sort(() => Math.random() - 0.5);
    Entities.erzeugePowerup(ziel.x + ziel.groesse * 0.2, ziel.y + ziel.groesse * 0.5, drops[0]);
    Entities.erzeugePowerup(ziel.x + ziel.groesse * 0.5, ziel.y + ziel.groesse * 0.5, drops[1]);
    Entities.erzeugePowerup(ziel.x + ziel.groesse * 0.8, ziel.y + ziel.groesse * 0.5, drops[2]);
    state.bossAktiv = false;
    dom.bossHpContainer.style.display = 'none';
    state.level++;
    updateLevelUI();
    state.frameZaehler = 0;
  } else {
    addScore(ziel.istFeind ? 100 : ziel.traegtPowerup ? 50 : ziel.groesse >= 35 ? 20 : 10);
    let farbe = ziel.istFeind ? '#9b59b6' : ziel.el.dataset.baseColor || ziel.el.style.backgroundColor || '#ffffff';
    erzeugeExplosion(ziel.x + ziel.groesse / 2, ziel.y + ziel.groesse / 2, farbe, 25);
    if (ziel.traegtPowerup) {
      Entities.erzeugePowerup(ziel.x + ziel.groesse / 2 - 12, ziel.y + ziel.groesse / 2 - 12);
    } else if (!ziel.istFeind && ziel.groesse >= 35) {
      let neueGroesse = ziel.groesse * 0.6;
      Entities.erzeugeAsteroid(ziel.x, ziel.y, neueGroesse, -3, ziel.vy, 15, true);
      Entities.erzeugeAsteroid(ziel.x + ziel.groesse - neueGroesse, ziel.y, neueGroesse, 3, ziel.vy, 15, true);
      erzeugeExplosion(ziel.x + ziel.groesse / 2, ziel.y + ziel.groesse / 2, farbe, 20); // Extra split particles
    }
  }
  ziel.el.remove();
  if (fIndex > -1) arrays.feinde.splice(fIndex, 1);
  if (aIndex > -1) arrays.asteroiden.splice(aIndex, 1);
  if (bIndex > -1) arrays.bosses.splice(bIndex, 1);
}
export function spielerGetroffen(kollisionsObjekt, explodiert = true) {
  if (state.godMode) return;
  if (state.schildStufe > 0) {
    dom.spieler.classList.remove(`schild-aktiv-${state.schildStufe}`);
    state.schildStufe--;
    if (state.schildStufe > 0) dom.spieler.classList.add(`schild-aktiv-${state.schildStufe}`);
    updateAktivePowerupsUI();
    if (explodiert) {
      let c = kollisionsObjekt.istFeind ? '#9b59b6' : kollisionsObjekt.el.dataset.baseColor || kollisionsObjekt.el.style.backgroundColor || '#7f8c8d';
      erzeugeExplosion(kollisionsObjekt.x + (kollisionsObjekt.groesse || 4) / 2, kollisionsObjekt.y + (kollisionsObjekt.groesse || 15) / 2, c, 10);
    }
    addScore(10);
    dom.spielfeld.style.backgroundColor = 'rgba(52, 152, 219, 0.3)';
    setTimeout(() => {
      dom.spielfeld.style.backgroundColor = '#0b1319';
    }, 150);
    return;
  }
  state.leben--;
  let moeglicheDowngrades = [];
  if (state.laserStufe > 1) moeglicheDowngrades.push('laser');
  if (state.raketenStufe > 1) moeglicheDowngrades.push('raketen');
  if (state.bombenStufe > 1) moeglicheDowngrades.push('bomben');
  if (moeglicheDowngrades.length > 0) {
    let wahl = moeglicheDowngrades[Math.floor(Math.random() * moeglicheDowngrades.length)];
    if (wahl === 'laser') state.laserStufe--;else if (wahl === 'raketen') state.raketenStufe--;else if (wahl === 'bomben') state.bombenStufe--;
  }
  updateLebenUI();
  updateAktivePowerupsUI();
  dom.spielfeld.style.backgroundColor = '#900';
  setTimeout(() => {
    dom.spielfeld.style.backgroundColor = '#0b1319';
  }, 150);
  if (explodiert && !kollisionsObjekt.istBoss) {
    let c = kollisionsObjekt.istFeind ? '#9b59b6' : kollisionsObjekt.el.dataset.baseColor || kollisionsObjekt.el.style.backgroundColor || '#7f8c8d';
    erzeugeExplosion(kollisionsObjekt.x + (kollisionsObjekt.groesse || 4) / 2, kollisionsObjekt.y + (kollisionsObjekt.groesse || 15) / 2, c, 10);
  }
  if (state.leben <= 0) {
    state.gameOverAktiv = true;
    state.finalerScore = state.cheatUsed ? 0 : state.score;
    document.getElementById('final-score').innerText = state.finalerScore;
    document.getElementById('game-over-screen').style.display = 'flex';
    let hs = getHighscores();
    if (hs.length < 10 || state.finalerScore > hs[hs.length - 1].score) {
      document.getElementById('highscore-form').style.display = 'block';
      document.getElementById('highscore-name').value = '';
    } else {
      document.getElementById('highscore-form').style.display = 'none';
    }
    renderHighscores();
  }
}
export function restartGame() {
  state.gameOverAktiv = false;
  document.getElementById('game-over-screen').style.display = 'none';
  state.leben = 3;
  state.maxEnergie = 50;
  state.energie = state.maxEnergie;
  waffenStufe = 0;
  state.laserStufe = 1;
  state.raketenStufe = 1;
  state.bombenStufe = 1;
  state.cheatUsed = false;
  state.godMode = false;
  state.laserDurchschlag = false;
  state.durchschlagTimer = 0;
  state.schildStufe = 0;
  dom.spieler.classList.remove('schild-aktiv-1', 'schild-aktiv-2', 'schild-aktiv-3');
  state.score = 0;
  addScore(0);
  state.level = 1;
  updateLebenUI();
  updateMaxEnergieMarker();
  updateAktivePowerupsUI();
  updateLevelUI();
  state.x = 185;
  state.y = 285;
  arrays.asteroiden.forEach(a => a.el.remove());
  arrays.asteroiden.length = 0;
  arrays.feinde.forEach(f => f.el.remove());
  arrays.feinde.length = 0;
  arrays.feindLaserArray.forEach(l => l.el.remove());
  arrays.feindLaserArray.length = 0;
  arrays.bosses.forEach(b => b.el.remove());
  arrays.bosses.length = 0;
  arrays.bossLaserArray.forEach(l => l.el.remove());
  arrays.bossLaserArray.length = 0;
  arrays.powerups.forEach(p => p.el.remove());
  arrays.powerups.length = 0;
  arrays.partikelArray.forEach(p => p.el.remove());
  arrays.partikelArray.length = 0;
  arrays.laserArray.forEach(l => l.el.remove());
  arrays.laserArray.length = 0;
  arrays.raketenArray.forEach(r => r.el.remove());
  arrays.raketenArray.length = 0;
  arrays.bombenArray.forEach(b => b.el.remove());
  arrays.bombenArray.length = 0;
  state.bossAktiv = false;
  dom.bossHpContainer.style.display = 'none';
  state.frameZaehler = 0;
}
export
// --- HIGHSCORE LOGIK ---
function getHighscores() {
  let hs = localStorage.getItem('spaceShooterHighscores');
  return hs ? JSON.parse(hs) : [];
}
export function saveHighscore(name, scoreValue) {
  let hs = getHighscores();
  hs.push({
    name: name.toUpperCase(),
    score: scoreValue
  });
  hs.sort((a, b) => b.score - a.score);
  hs = hs.slice(0, 10);
  localStorage.setItem('spaceShooterHighscores', JSON.stringify(hs));
  return hs;
}
export function renderHighscores() {
  let hs = getHighscores();
  const tbody = document.getElementById('highscore-body');
  tbody.innerHTML = '';
  if (hs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2">- Keine Einträge -</td></tr>';
  } else {
    hs.forEach(entry => {
      tbody.innerHTML += `<tr><td>${entry.name}</td><td>${entry.score}</td></tr>`;
    });
  }
}
export function erzeugeExplosion(x, y, farbe, anzahl = 15) {
  for (let i = 0; i < anzahl; i++) {
    const el = document.createElement('div');
    el.classList.add('partikel');
    el.style.backgroundColor = farbe;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    dom.spielfeld.appendChild(el);
    const winkel = Math.random() * Math.PI * 2;
    const tempo = Math.random() * 4 + 2;
    arrays.partikelArray.push({
      el: el,
      x: x,
      y: y,
      vx: Math.cos(winkel) * tempo,
      vy: Math.sin(winkel) * tempo,
      leben: 1.0,
      zerfall: Math.random() * 0.03 + 0.02
    });
  }
}
export function erzeugeRauchFunken(x, y, groesse) {
  // Rauch
  if (Math.random() < 0.5) {
    const el = document.createElement('div');
    el.classList.add('partikel');
    el.style.backgroundColor = '#555';
    el.style.width = '6px';
    el.style.height = '6px';
    el.style.left = x + Math.random() * groesse + 'px';
    el.style.top = y + Math.random() * groesse + 'px';
    dom.spielfeld.appendChild(el);
    arrays.partikelArray.push({
      el: el,
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      vx: (Math.random() - 0.5) * 2,
      vy: -Math.random() * 2 - 1,
      leben: 1.0,
      zerfall: 0.02
    });
  }
  // Funken
  if (Math.random() < 0.3) {
    const el = document.createElement('div');
    el.classList.add('partikel');
    el.style.backgroundColor = '#f1c40f';
    el.style.boxShadow = '0 0 5px #f1c40f';
    el.style.left = x + Math.random() * groesse + 'px';
    el.style.top = y + Math.random() * groesse + 'px';
    dom.spielfeld.appendChild(el);
    arrays.partikelArray.push({
      el: el,
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      vx: (Math.random() - 0.5) * 4,
      vy: -Math.random() * 4,
      leben: 1.0,
      zerfall: 0.05
    });
  }
}
export function erzeugeAntriebsRauch(x, y, vy = -1.5) {
  if (Math.random() < 0.6) {
    const el = document.createElement('div');
    el.classList.add('partikel');
    el.style.backgroundColor = Math.random() < 0.3 ? '#e74c3c' : '#7f8c8d';
    el.style.width = '4px';
    el.style.height = '4px';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    dom.spielfeld.appendChild(el);
    arrays.partikelArray.push({
      el: el,
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 1,
      vy: vy + (Math.random() - 0.5) * 0.5,
      leben: 1.0,
      zerfall: 0.05
    });
  }
}