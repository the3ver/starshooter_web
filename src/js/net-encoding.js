// Net encoding for online mode (pure functions, no DOM).
//
// Host -> client: the SnapshotEncoder turns full snapshots from serializeGameState()
// into small packets, the SnapshotDecoder rebuilds full snapshots from them in the same
// shape for applyGameStateSnapshot(). Only rounded values that changed since the
// last packet are sent; both sides predict projectiles with a velocity.
//
// Paketformat:
//   { v: PROTOCOL_VERSION, n: sequence number, t: world step, k: 1 (keyframe only),
//     o: delta of the fields outside the lists (p1, p2, score, level, ...),
//     l: { <list>: { i: [ids, number = list prefix + '_' + number], d: [0 | delta | full object] } } }
//   Delta of an object: changed fields, '_d' = removed fields, '_r' = value replaced.
//   If 'i' is missing, the ids stay as in the last packet; if a list is missing, it is unchanged.

export const PROTOCOL_VERSION = 20;
export const KEYFRAME_INTERVAL = 30; // every 30th packet is a keyframe (~1 s)
export const DR_TOLERANCE = 0.5; // px, from this deviation on x/y is sent along

// Id prefix per list (see Entities.newId); other ids go as text
const LIST_PREFIX = {
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
export const LISTS = Object.keys(LIST_PREFIX);

// Movement rule as on the host and in client.js: x += vx, y += direction * vy per step.
// Player lasers fly with y -= vy. Lists without a sent velocity are missing here.
const MOVEMENT = { laser: -1, enemyLaser: 1, bossLaser: 1, bossMissiles: 1 };

const round1 = v => Math.round(v * 10) / 10 || 0;
const round0 = v => Math.round(v) || 0;
const round2 = v => Math.round(v * 100) / 100 || 0;

// Rounding per field name. Ids, types, owners, texts and booleans are never rounded.
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
  // Gleve: remaining frames as integers, beam angle (degrees, steps of 4.5) with 1 decimal place
  gleveDashCharges: round0,
  sniperGrenadeCharges: round0,
  gleveDashTimer: round0,
  gleveBounceTimer: round0,
  gleveInvulnerable: round0,
  gleveSweepTimer: round0,
  gleveSweepAngle: round1,
  gleveSweepDirection: round0,
  // Viper roll: remaining steps, direction and cooldown as integers
  viperRollTimer: round0,
  viperRollDirection: round0,
  viperRollCooldown: round0,
  // Viper overdrive: strip (0..100) and remaining steps as integers
  viperOverdriveStrip: round0,
  viperOverdriveTimer: round0,
  // Viper kill combo: kills and remaining steps of the window as integers
  viperCombo: round0,
  viperComboTimer: round0,
  // Sniper: crosshair (x/y 1 decimal place), charge, shot distance, grenade flight and stun as integers
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

// Rounded copy, as it arrives at the receiver after JSON (undefined drops out, NaN becomes null)
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

// Delta from old to new (null = no change). Fields in 'without' are not compared.
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
  const prefix = LIST_PREFIX[list] + '_';
  if (id.startsWith(prefix)) {
    const rest = id.slice(prefix.length);
    if (/^[1-9]\d{0,14}$/.test(rest)) return Number(rest);
  }
  return id;
}

function decodeId(list, code) {
  return typeof code === 'number' ? LIST_PREFIX[list] + '_' + code : code;
}

// Is the list trackable by id? Otherwise it goes as a normal field (whole) via 'o'.
function isTrackable(list) {
  if (!Array.isArray(list)) return false;
  const ids = new Set();
  for (const obj of list) {
    if (!isObject(obj) || typeof obj.id !== 'string' || ids.has(obj.id)) return false;
    ids.add(obj.id);
  }
  return true;
}

// Predicted position after dt steps (null = no prediction for this list)
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

  // True as long as no keyframe has been applied (deltas are ignored then)
  get needsKeyframe() {
    return this.status === null;
  }

  // Returns the full snapshot or null (no keyframe, gap in the sequence number, error).
  // On gaps the decoder waits for the next keyframe: without the lost
  // packet ids and fields would not be certain, so better nothing for a moment than something wrong.
  decode(packet, withOutput = true) {
    if (!isObject(packet) || packet.v !== PROTOCOL_VERSION || !Number.isInteger(packet.n)) return null;
    let z = this.status;
    if (packet.k) {
      z = { n: packet.n, t: packet.t, top: {}, lists: {} };
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
    const listsPacket = packet.l || {};
    const lists = {};
    const names = new Set([...Object.keys(old.lists), ...Object.keys(listsPacket)]);
    for (const name of names) {
      if (!LIST_PREFIX[name]) throw new Error('unknown list ' + name);
      const entry = listsPacket[name];
      if (entry === null) continue; // List is no longer tracked
      const beforehand = old.lists[name];
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
      lists[name] = { ids, objects };
    }
    return { n: packet.n, t: packet.t, top, lists };
  }

  // Full snapshot as a fresh copy (applyGameStateSnapshot may keep it)
  snapshot() {
    const z = this.status;
    if (!z) return null;
    const s = copy(z.top);
    for (const name of Object.keys(z.lists)) {
      const l = z.lists[name];
      s[name] = l.ids.map(id => copy(l.objects.get(id)));
    }
    return s;
  }
}

export class SnapshotEncoder {
  constructor() {
    // Mirror: the same decoder as on the client, so both sides know the same state
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

  // full: result of serializeGameState(); worldStep: counter of the moving simulation steps
  encode(full, worldStep) {
    const rounded = roundSnapshot(full);
    const basis = this.mirror.status;
    const t = Number.isFinite(worldStep) ? worldStep : basis ? basis.t + 2 : 0;
    const keyframe = this.keyframeForce || !basis || this.sinceKeyframe + 1 >= KEYFRAME_INTERVAL;
    this.n++;
    const packet = { v: PROTOCOL_VERSION, n: this.n, t };
    if (keyframe) packet.k = 1;

    const oldTop = keyframe ? {} : basis.top;
    const oldLists = keyframe ? {} : basis.lists;
    const dt = keyframe ? 0 : t - basis.t;

    // Fields outside the tracked lists (including non-trackable lists)
    const top = {};
    const lists = {};
    for (const k of Object.keys(rounded)) {
      if (LIST_PREFIX[k] && isTrackable(rounded[k])) lists[k] = rounded[k];
      else top[k] = rounded[k];
    }
    const o = objectDelta(oldTop, top, null);
    if (o) packet.o = o;

    const l = {};
    for (const name of Object.keys(oldLists)) {
      if (!lists[name]) l[name] = null;
    }
    for (const name of Object.keys(lists)) {
      const entry = this._listEntry(name, lists[name], oldLists[name], dt);
      if (entry) l[name] = entry;
    }
    if (Object.keys(l).length) packet.l = l;

    // Keep the mirror up to date; if that fails, send a keyframe next time
    if (!this.mirror.decode(packet, false)) this.keyframeForce = true;
    else this.keyframeForce = false;
    this.sinceKeyframe = keyframe ? 0 : this.sinceKeyframe + 1;
    return packet;
  }

  _listEntry(name, newList, beforehand, dt) {
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

// Client -> host: send inputs only on change.
// Keys immediately on every change, position at most every 2nd step and only when moved,
// otherwise a full packet every HEARTBEAT_STEPS. The host holds the keys until the next packet.
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

  // Call once per client step; returns the packet to send or null
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
    // Gleve: steering direction for the dash (2 decimal places), goes along with every packet
    if (Number.isFinite(input.rx) && Number.isFinite(input.ry)) {
      e.rx = round2(input.rx);
      e.ry = round2(input.ry);
    }
    // Viper: roll start (direction -1/+1) goes out immediately, set only in the start step
    if (input.ro === 1 || input.ro === -1) e.ro = input.ro;
    // Sniper: joystick auto-fire (normal shots without charging), only when set
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
