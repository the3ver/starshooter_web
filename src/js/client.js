
import { state, dom, config, arrays, shipModels } from './state.js';
import * as Network from './network.js';
import * as Hack from './hack.js';
import { animierenPartikel } from './partikel.js';


export function clientSchritt() {
  // I-Frames / Blink-Timer auf Client dekrementieren
  if (state.invulnerableTimer > 0) {
    state.invulnerableTimer--;
    if (state.invulnerableTimer === 0 && dom.spieler) {
      dom.spieler.classList.remove('spieler-blink');
    }
  }
  if (state.p2 && state.p2.invulnerableTimer > 0) {
    state.p2.invulnerableTimer--;
    if (state.p2.invulnerableTimer === 0 && dom.spieler2) {
      dom.spieler2.classList.remove('spieler-blink');
    }
  }

  arrays.sterne.forEach(stern => {
    stern.y += stern.speed;
    if (stern.y > config.spielfeldHoehe) {
      stern.y = -5;
      stern.x = Math.random() * config.spielfeldBreite;
    }
    stern.el.style.top = stern.y + 'px';
    stern.el.style.left = stern.x + 'px';
  });

  if (state.p2 && dom.spieler2 && !state.p2.isDead) {
    let baseFlameScaleP2 = 1.0;
    let targetRotateP2 = 0;
    const p2Speed = (shipModels && shipModels[state.p2.selectedShipModel]?.speed) || config.geschwindigkeit;
    const keys = state.tastenGedrueckt;

    if (state.joystick && state.joystick.active) {
      let mag = Math.sqrt(state.joystick.x * state.joystick.x + state.joystick.y * state.joystick.y);
      if (mag > 0.1) {
        const b = Hack.hackeBewegung(state.p2, state.joystick.x / mag, state.joystick.y / mag);
        state.p2.x += b.dx * p2Speed;
        state.p2.y += b.dy * p2Speed;
      }
      if (state.joystick.y < -0.2) baseFlameScaleP2 = 1.8;
      else if (state.joystick.y > 0.2) baseFlameScaleP2 = 0.4;
      if (state.joystick.x < -0.2) targetRotateP2 = -15;
      else if (state.joystick.x > 0.2) targetRotateP2 = 15;
    } else {
      const b = Hack.hackeBewegung(state.p2,
        ((keys.d || keys.arrowright) ? 1 : 0) - ((keys.a || keys.arrowleft) ? 1 : 0),
        ((keys.s || keys.arrowdown) ? 1 : 0) - ((keys.w || keys.arrowup) ? 1 : 0));
      if (b.dy < 0) {
        state.p2.y -= p2Speed;
        baseFlameScaleP2 = 1.8;
      }
      if (b.dy > 0) {
        state.p2.y += p2Speed;
        baseFlameScaleP2 = 0.4;
      }
      if (b.dx < 0) {
        state.p2.x -= p2Speed;
        targetRotateP2 = -15;
      }
      if (b.dx > 0) {
        state.p2.x += p2Speed;
        targetRotateP2 = 15;
      }
    }

    if (state.p2.x < 0) state.p2.x = 0;
    if (state.p2.y < 0) state.p2.y = 0;
    if (state.p2.x > config.spielfeldBreite - config.spielerGroesse) state.p2.x = config.spielfeldBreite - config.spielerGroesse;
    if (state.p2.y > config.spielfeldHoehe - config.spielerGroesse) state.p2.y = config.spielfeldHoehe - config.spielerGroesse;

    state.p2.rotate = targetRotateP2;
    dom.spieler2.style.left = state.p2.x + 'px';
    dom.spieler2.style.top = state.p2.y + 'px';
    dom.spieler2.style.transform = `rotate(${targetRotateP2}deg)`;

    const fLeftP2 = document.getElementById('flame-left-p2');
    const fRightP2 = document.getElementById('flame-right-p2');
    if (fLeftP2) fLeftP2.style.transform = `scaleY(${baseFlameScaleP2})`;
    if (fRightP2) fRightP2.style.transform = `scaleY(${baseFlameScaleP2})`;
  }

  // Partikel auf dem Client animieren und löschen
  animierenPartikel();
  Hack.zeigeHackStatus();

  Network.sendNetworkInput(Network.serializePlayerInput());
}
