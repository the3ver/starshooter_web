// Netzkodierung fuer den Online-Modus (reine Funktionen, kein DOM).
//
// Host -> Client: Der SnapshotKodierer verwandelt volle Snapshots aus serializeGameState()
// in kleine Pakete, der SnapshotDekodierer baut daraus wieder volle Snapshots in derselben
// Form fuer applyGameStateSnapshot(). Gesendet werden nur gerundete Werte, die sich seit dem
// letzten Paket geaendert haben; Projektile mit Geschwindigkeit sagen beide Seiten voraus.
//
// Paketformat:
//   { v: PROTOKOLL_VERSION, n: Laufnummer, t: Weltschritt, k: 1 (nur Keyframe),
//     o: Delta der Felder ausserhalb der Listen (p1, p2, score, level, ...),
//     l: { <liste>: { i: [Ids, Zahl = Praefix der Liste + '_' + Zahl], d: [0 | Delta | volles Objekt] } } }
//   Delta eines Objekts: geaenderte Felder, '_d' = entfernte Felder, '_r' = Wert ersetzt.
//   Fehlt 'i', bleiben die Ids wie im letzten Paket; fehlt eine Liste, ist sie unveraendert.

export const PROTOCOL_VERSION = 20;
export const KEYFRAME_INTERVAL = 30; // jedes 30. Paket ist ein Keyframe (~1 s)
export const DR_TOLERANCE = 0.5; // px, ab dieser Abweichung wird x/y mitgesendet

// Id-Praefix je Liste (siehe Entities.neueId); andere Ids gehen als Text
const LISTEN_PREFIX = {
  enemies: 'f',
  asteroids: 'a',
  bosses: 'boss',
  laser: 'l',
  missiles: 'r',
  bombs: 'b',
  hackProjectiles: 'hp',
  enemyLaser: 'fl',
  bossLaser: 'bl',
  bossMissiles: 'br',
  bossBombs: 'bb',
  powerups: 'pu',
  gleveWaves: 'gw',
  sniperGrenades: 'sg',
  sniperMines: 'sm',
  rock: 'fe',
};
export const LISTEN = Object.keys(LISTEN_PREFIX);

// Bewegungsregel wie auf dem Host und in client.js: x += vx, y += Richtung * vy pro Schritt.
// Spielerlaser fliegen mit y -= vy. Listen ohne gesendete Geschwindigkeit fehlen hier.
const MOVEMENT = { laser: -1, enemyLaser: 1, bossLaser: 1, bossMissiles: 1 };

const round1 = v => Math.round(v * 10) / 10 || 0;
const round0 = v => Math.round(v) || 0;
const round2 = v => Math.round(v * 100) / 100 || 0;

// Rundung je Feldname. Ids, Typen, Besitzer, Texte und Booleans werden nie gerundet.
export const ROUNDING = {
  x: round1,
  y: round1,
  vx: round1,
  vy: round1,
  energy: round1,
  maxEnergy: round1,
  rot: round0,
  rotate: round0,
  hp: round0,
  maxHp: round0,
  shieldHp: round0,
  missileCooldown: round0,
  bombCooldown: round0,
  phantomShieldRegenTimer: round0,
  // Gleve: Restframes ganzzahlig, Strahlwinkel (Grad, Schritte von 4,5) mit 1 Nachkommastelle
  gleveDashCharges: round0,
  sniperGrenadeCharges: round0,
  gleveDashTimer: round0,
  gleveBounceTimer: round0,
  gleveInvulnerable: round0,
  gleveSweepTimer: round0,
  gleveSweepAngle: round1,
  gleveSweepDirection: round0,
  // Viper-Rolle: Restschritte, Richtung und Cooldown ganzzahlig
  viperRollTimer: round0,
  viperRollDirection: round0,
  viperRollCooldown: round0,
  // Viper-Overdrive: Leiste (0..100) und Restschritte ganzzahlig
  viperOverdriveStrip: round0,
  viperOverdriveTimer: round0,
  // Viper-Kill-Kombo: Kills und Restschritte des Fensters ganzzahlig
  viperCombo: round0,
  viperComboTimer: round0,
  // Sniper: Fadenkreuz (x/y 1 Nachkommastelle), Ladung, Schussabstand, Granatenflug und Betaeubung ganzzahlig
  sniperTargetX: round1,
  sniperTargetY: round1,
  sniperCharge: round0,
  sniperCooldown: round0,
  rest: round0,
  fuse: round0,
  stunned: round0,
};

function roundingReplacer(key, value) {
  if (typeof value === 'number' && Number.isFinite(value) && ROUNDING[key]) {
    return ROUNDING[key](value);
  }
  return value;
}

// Gerundete Kopie, so wie sie nach JSON beim Empfaenger ankommt (undefined faellt weg, NaN wird null)
export function roundSnapshot(full) {
  return JSON.parse(JSON.stringify(full, roundingReplacer));
}

function isObject(w) {
  return w !== null && typeof w === 'object' && !Array.isArray(w);
}

function copy(w) {
  return w === null || typeof w !== 'object' ? w : JSON.parse(JSON.stringify(w));
}

function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!(k in b) || !equal(a[k], b[k])) return false;
  return true;
}

// Delta von alt nach neu (null = keine Aenderung). Felder in 'ohne' werden nicht verglichen.
function objectDelta(old, fresh, without) {
  /** @type {any} */
  let delta = null;
  for (const k of Object.keys(fresh)) {
    if (without && without.has(k)) continue;
    const present = k in old;
    if (present && equal(old[k], fresh[k])) continue;
    let value = fresh[k];
    if (isObject(value)) {
      value = present && isObject(old[k]) ? objectDelta(old[k], value, null) : { _r: value };
    }
    (delta || (delta = {}))[k] = value;
  }
  const gone = Object.keys(old).filter(k => !(k in fresh));
  if (gone.length) (delta || (delta = {}))._d = gone;
  return delta;
}

function applyObjectDelta(target, delta) {
  for (const k of Object.keys(delta)) {
    if (k === '_d') continue;
    const d = delta[k];
    if (isObject(d)) {
      if ('_r' in d) {
        target[k] = copy(d._r);
      } else {
        if (!isObject(target[k])) target[k] = {};
        applyObjectDelta(target[k], d);
      }
    } else {
      target[k] = copy(d);
    }
  }
  if (delta._d)
    delta._d.forEach(k => {
      delete target[k];
    });
}

function encodeId(list, id) {
  const prefix = LISTEN_PREFIX[list] + '_';
  if (id.startsWith(prefix)) {
    const rest = id.slice(prefix.length);
    if (/^[1-9]\d{0,14}$/.test(rest)) return Number(rest);
  }
  return id;
}

function decodeId(list, code) {
  return typeof code === 'number' ? LISTEN_PREFIX[list] + '_' + code : code;
}

// Liste per Id verfolgbar? Sonst geht sie als normales Feld (ganz) ueber 'o'.
function isTrackable(list) {
  if (!Array.isArray(list)) return false;
  const ids = new Set();
  for (const obj of list) {
    if (!isObject(obj) || typeof obj.id !== 'string' || ids.has(obj.id)) return false;
    ids.add(obj.id);
  }
  return true;
}

// Vorhergesagte Position nach dt Schritten (null = keine Vorhersage fuer diese Liste)
function sayBeforehand(list, obj, dt) {
  const direction = MOVEMENT[list];
  if (!direction || !(dt > 0)) return null;
  if (![obj.x, obj.y, obj.vx, obj.vy].every(Number.isFinite)) return null;
  return { x: round1(obj.x + obj.vx * dt), y: round1(obj.y + direction * obj.vy * dt) };
}

export class SnapshotDecoder {
  constructor() {
    this.status = null;
  }

  reset() {
    this.status = null;
  }

  // True, solange kein Keyframe angewendet ist (Deltas werden dann ignoriert)
  get needsKeyframe() {
    return this.status === null;
  }

  // Liefert den vollen Snapshot oder null (kein Keyframe, Luecke in der Laufnummer, Fehler).
  // Bei Luecken wartet der Dekodierer auf den naechsten Keyframe: Ohne das verlorene
  // Paket waeren Ids und Felder nicht sicher, also lieber kurz nichts als etwas Falsches.
  decode(packet, withOutput = true) {
    if (!isObject(packet) || packet.v !== PROTOCOL_VERSION || !Number.isInteger(packet.n)) return null;
    let z = this.status;
    if (packet.k) {
      z = { n: packet.n, t: packet.t, top: {}, listen: {} };
    } else if (!z || packet.n !== z.n + 1) {
      this.status = null;
      return null;
    }
    try {
      const fresh = this._turnAn(z, packet);
      this.status = fresh;
    } catch (e) {
      this.status = null;
      return null;
    }
    return withOutput ? this.snapshot() : true;
  }

  _turnAn(old, packet) {
    const dt = Number.isFinite(packet.t) && Number.isFinite(old.t) ? packet.t - old.t : 0;
    const top = packet.k ? {} : copy(old.top);
    if (packet.o) applyObjectDelta(top, packet.o);
    const listenPacket = packet.l || {};
    const listen = {};
    const names = new Set([...Object.keys(old.listen), ...Object.keys(listenPacket)]);
    for (const name of names) {
      if (!LISTEN_PREFIX[name]) throw new Error('Unbekannte Liste ' + name);
      const entry = listenPacket[name];
      if (entry === null) continue; // Liste wird nicht mehr verfolgt
      const beforehand = old.listen[name];
      const ids = entry && entry.i ? entry.i.map(c => decodeId(name, c)) : beforehand ? beforehand.ids : [];
      const objects = new Map();
      ids.forEach((id, idx) => {
        const d = (entry && entry.d && entry.d[idx]) || 0;
        const oldObj = beforehand && beforehand.objects.get(id);
        let obj;
        if (!oldObj) {
          if (!isObject(d)) throw new Error('Neues Objekt ohne Daten ' + id);
          obj = Object.assign({ id }, copy(d));
        } else {
          obj = Object.assign({}, oldObj);
          const prediction = sayBeforehand(name, obj, dt);
          if (prediction) Object.assign(obj, prediction);
          if (d) applyObjectDelta(obj, d);
        }
        objects.set(id, obj);
      });
      listen[name] = { ids, objects };
    }
    return { n: packet.n, t: packet.t, top, listen };
  }

  // Voller Snapshot als frische Kopie (applyGameStateSnapshot darf ihn behalten)
  snapshot() {
    const z = this.status;
    if (!z) return null;
    const s = copy(z.top);
    for (const name of Object.keys(z.listen)) {
      const l = z.listen[name];
      s[name] = l.ids.map(id => copy(l.objects.get(id)));
    }
    return s;
  }
}

export class SnapshotEncoder {
  constructor() {
    // Spiegel: derselbe Dekodierer wie beim Client, damit beide Seiten denselben Stand kennen
    this.mirror = new SnapshotDecoder();
    this.n = 0;
    this.sinceKeyframe = 0;
    this.keyframeForce = true;
  }

  reset() {
    this.mirror.reset();
    this.keyframeForce = true;
  }

  forceKeyframe() {
    this.keyframeForce = true;
  }

  // voll: Ergebnis von serializeGameState(); weltSchritt: Zaehler der bewegten Simulationsschritte
  encode(full, worldStep) {
    const rounded = roundSnapshot(full);
    const basis = this.mirror.status;
    const t = Number.isFinite(worldStep) ? worldStep : basis ? basis.t + 2 : 0;
    const keyframe = this.keyframeForce || !basis || this.sinceKeyframe + 1 >= KEYFRAME_INTERVAL;
    this.n++;
    const packet = { v: PROTOCOL_VERSION, n: this.n, t };
    if (keyframe) packet.k = 1;

    const oldTop = keyframe ? {} : basis.top;
    const oldListen = keyframe ? {} : basis.listen;
    const dt = keyframe ? 0 : t - basis.t;

    // Felder ausserhalb der verfolgten Listen (auch nicht verfolgbare Listen)
    const top = {};
    const listen = {};
    for (const k of Object.keys(rounded)) {
      if (LISTEN_PREFIX[k] && isTrackable(rounded[k])) listen[k] = rounded[k];
      else top[k] = rounded[k];
    }
    const o = objectDelta(oldTop, top, null);
    if (o) packet.o = o;

    const l = {};
    for (const name of Object.keys(oldListen)) {
      if (!listen[name]) l[name] = null;
    }
    for (const name of Object.keys(listen)) {
      const entry = this._listenEntry(name, listen[name], oldListen[name], dt);
      if (entry) l[name] = entry;
    }
    if (Object.keys(l).length) packet.l = l;

    // Spiegel nachfuehren; scheitert das, beim naechsten Mal Keyframe
    if (!this.mirror.decode(packet, false)) this.keyframeForce = true;
    else this.keyframeForce = false;
    this.sinceKeyframe = keyframe ? 0 : this.sinceKeyframe + 1;
    return packet;
  }

  _listenEntry(name, newList, beforehand, dt) {
    const ids = newList.map(o => o.id);
    const idsEqual =
      beforehand && beforehand.ids.length === ids.length && beforehand.ids.every((id, i) => id === ids[i]);
    const d = newList.map(fresh => {
      const old = beforehand && beforehand.objects.get(fresh.id);
      if (!old) {
        const full = Object.assign({}, fresh);
        delete full.id;
        return full;
      }
      let comparison = old;
      let without = null;
      const prediction = sayBeforehand(name, old, dt);
      if (prediction) {
        comparison = Object.assign({}, old, prediction);
        without = new Set();
        if (Number.isFinite(fresh.x) && Math.abs(prediction.x - fresh.x) <= DR_TOLERANCE) without.add('x');
        if (Number.isFinite(fresh.y) && Math.abs(prediction.y - fresh.y) <= DR_TOLERANCE) without.add('y');
      }
      return objectDelta(comparison, fresh, without) || 0;
    });
    while (d.length && d[d.length - 1] === 0) d.pop();
    if (idsEqual && d.length === 0) return undefined;
    const entry = {};
    if (!idsEqual) entry.i = ids.map(id => encodeId(name, id));
    if (d.length) entry.d = d;
    return entry;
  }
}

// Client -> Host: Eingaben nur bei Aenderung senden.
// Tasten sofort bei jeder Aenderung, Position hoechstens jeden 2. Schritt und nur wenn bewegt,
// sonst alle HEARTBEAT_SCHRITTE ein volles Paket. Der Host haelt die Tasten bis zum naechsten Paket.
export const HEARTBEAT_STEPS = 30;
export const POSITIONS_INTERVAL = 2;

export class InputSender {
  constructor() {
    this.reset();
  }

  reset() {
    this.step = 0;
    this.lastDispatch = -Infinity;
    this.last = null;
  }

  // Einmal pro Client-Schritt aufrufen; liefert das zu sendende Paket oder null
  next(input) {
    this.step++;
    const e = {
      v: PROTOCOL_VERSION,
      x: Number.isFinite(input.x) ? round1(input.x) : input.x,
      y: Number.isFinite(input.y) ? round1(input.y) : input.y,
      rotate: input.rotate || 0,
      laser: Boolean(input.laser),
      missile: Boolean(input.missile),
      bomb: Boolean(input.bomb),
    };
    // Gleve: Steuerrichtung fuer den Dash (2 Nachkommastellen), geht mit jedem Paket mit
    if (Number.isFinite(input.rx) && Number.isFinite(input.ry)) {
      e.rx = round2(input.rx);
      e.ry = round2(input.ry);
    }
    // Viper: Rollenstart (Richtung -1/+1) geht sofort raus, nur im Startschritt gesetzt
    if (input.ro === 1 || input.ro === -1) e.ro = input.ro;
    // Sniper: Joystick-Autofeuer (Normalschuesse ohne Laden), nur wenn gesetzt
    if (input.auto) e.auto = true;
    const l = this.last;
    const since = this.step - this.lastDispatch;
    const keyChanged =
      !l || l.laser !== e.laser || l.missile !== e.missile || l.bomb !== e.bomb || l.ro !== e.ro || l.auto !== e.auto;
    const moved = !l || l.x !== e.x || l.y !== e.y || l.rotate !== e.rotate;
    const due = keyChanged || (moved && since >= POSITIONS_INTERVAL) || since >= HEARTBEAT_STEPS;
    if (!due) return null;
    this.last = e;
    this.lastDispatch = this.step;
    return e;
  }
}
