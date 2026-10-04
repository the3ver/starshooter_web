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

export const PROTOKOLL_VERSION = 6;
export const KEYFRAME_INTERVALL = 30;   // jedes 30. Paket ist ein Keyframe (~1 s)
export const DR_TOLERANZ = 0.5;         // px, ab dieser Abweichung wird x/y mitgesendet

// Id-Praefix je Liste (siehe Entities.neueId); andere Ids gehen als Text
const LISTEN_PRAEFIX = {
    feinde: 'f', asteroiden: 'a', bosses: 'boss', laser: 'l', raketen: 'r', bomben: 'b',
    hackProjektile: 'hp', feindLaser: 'fl', bossLaser: 'bl', bossRaketen: 'br', bossBomben: 'bb', powerups: 'pu', gleveWellen: 'gw'
};
export const LISTEN = Object.keys(LISTEN_PRAEFIX);

// Bewegungsregel wie auf dem Host und in client.js: x += vx, y += Richtung * vy pro Schritt.
// Spielerlaser fliegen mit y -= vy. Listen ohne gesendete Geschwindigkeit fehlen hier.
const BEWEGUNG = { laser: -1, feindLaser: 1, bossLaser: 1, bossRaketen: 1 };

const runde1 = (v) => (Math.round(v * 10) / 10) || 0;
const runde0 = (v) => Math.round(v) || 0;
const runde2 = (v) => (Math.round(v * 100) / 100) || 0;

// Rundung je Feldname. Ids, Typen, Besitzer, Texte und Booleans werden nie gerundet.
export const RUNDUNG = {
    x: runde1, y: runde1, vx: runde1, vy: runde1,
    energie: runde1, maxEnergie: runde1,
    rot: runde0, rotate: runde0,
    hp: runde0, maxHp: runde0, schildHp: runde0,
    raketenCooldown: runde0, bombenCooldown: runde0,
    phantomSchildRegenTimer: runde0,
    // Gleve: Restframes ganzzahlig, Strahlwinkel (Grad, Schritte von 4,5) mit 1 Nachkommastelle
    gleveDashLadungen: runde0, gleveDashTimer: runde0, gleveAbprallTimer: runde0, gleveUnverwundbar: runde0,
    gleveSweepTimer: runde0, gleveSweepWinkel: runde1, gleveSweepRichtung: runde0
};

function rundungsErsetzer(schluessel, wert) {
    if (typeof wert === 'number' && Number.isFinite(wert) && RUNDUNG[schluessel]) {
        return RUNDUNG[schluessel](wert);
    }
    return wert;
}

// Gerundete Kopie, so wie sie nach JSON beim Empfaenger ankommt (undefined faellt weg, NaN wird null)
export function rundeSnapshot(voll) {
    return JSON.parse(JSON.stringify(voll, rundungsErsetzer));
}

function istObjekt(w) {
    return w !== null && typeof w === 'object' && !Array.isArray(w);
}

function kopie(w) {
    return (w === null || typeof w !== 'object') ? w : JSON.parse(JSON.stringify(w));
}

function gleich(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!gleich(a[i], b[i])) return false;
        return true;
    }
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (!(k in b) || !gleich(a[k], b[k])) return false;
    return true;
}

// Delta von alt nach neu (null = keine Aenderung). Felder in 'ohne' werden nicht verglichen.
function objektDelta(alt, neu, ohne) {
    let delta = null;
    for (const k of Object.keys(neu)) {
        if (ohne && ohne.has(k)) continue;
        const vorhanden = k in alt;
        if (vorhanden && gleich(alt[k], neu[k])) continue;
        let wert = neu[k];
        if (istObjekt(wert)) {
            wert = (vorhanden && istObjekt(alt[k])) ? objektDelta(alt[k], wert, null) : { _r: wert };
        }
        (delta || (delta = {}))[k] = wert;
    }
    const weg = Object.keys(alt).filter(k => !(k in neu));
    if (weg.length) (delta || (delta = {}))._d = weg;
    return delta;
}

function wendeObjektDeltaAn(ziel, delta) {
    for (const k of Object.keys(delta)) {
        if (k === '_d') continue;
        const d = delta[k];
        if (istObjekt(d)) {
            if ('_r' in d) {
                ziel[k] = kopie(d._r);
            } else {
                if (!istObjekt(ziel[k])) ziel[k] = {};
                wendeObjektDeltaAn(ziel[k], d);
            }
        } else {
            ziel[k] = kopie(d);
        }
    }
    if (delta._d) delta._d.forEach(k => { delete ziel[k]; });
}

function kodiereId(liste, id) {
    const praefix = LISTEN_PRAEFIX[liste] + '_';
    if (id.startsWith(praefix)) {
        const rest = id.slice(praefix.length);
        if (/^[1-9]\d{0,14}$/.test(rest)) return Number(rest);
    }
    return id;
}

function dekodiereId(liste, code) {
    return typeof code === 'number' ? LISTEN_PRAEFIX[liste] + '_' + code : code;
}

// Liste per Id verfolgbar? Sonst geht sie als normales Feld (ganz) ueber 'o'.
function istVerfolgbar(liste) {
    if (!Array.isArray(liste)) return false;
    const ids = new Set();
    for (const obj of liste) {
        if (!istObjekt(obj) || typeof obj.id !== 'string' || ids.has(obj.id)) return false;
        ids.add(obj.id);
    }
    return true;
}

// Vorhergesagte Position nach dt Schritten (null = keine Vorhersage fuer diese Liste)
function sageVorher(liste, obj, dt) {
    const richtung = BEWEGUNG[liste];
    if (!richtung || !(dt > 0)) return null;
    if (![obj.x, obj.y, obj.vx, obj.vy].every(Number.isFinite)) return null;
    return { x: runde1(obj.x + obj.vx * dt), y: runde1(obj.y + richtung * obj.vy * dt) };
}

export class SnapshotDekodierer {
    constructor() {
        this.zustand = null;
    }

    reset() {
        this.zustand = null;
    }

    // True, solange kein Keyframe angewendet ist (Deltas werden dann ignoriert)
    get brauchtKeyframe() {
        return this.zustand === null;
    }

    // Liefert den vollen Snapshot oder null (kein Keyframe, Luecke in der Laufnummer, Fehler).
    // Bei Luecken wartet der Dekodierer auf den naechsten Keyframe: Ohne das verlorene
    // Paket waeren Ids und Felder nicht sicher, also lieber kurz nichts als etwas Falsches.
    dekodiere(paket, mitAusgabe = true) {
        if (!istObjekt(paket) || paket.v !== PROTOKOLL_VERSION || !Number.isInteger(paket.n)) return null;
        let z = this.zustand;
        if (paket.k) {
            z = { n: paket.n, t: paket.t, oben: {}, listen: {} };
        } else if (!z || paket.n !== z.n + 1) {
            this.zustand = null;
            return null;
        }
        try {
            const neu = this._wendeAn(z, paket);
            this.zustand = neu;
        } catch (e) {
            this.zustand = null;
            return null;
        }
        return mitAusgabe ? this.snapshot() : true;
    }

    _wendeAn(alt, paket) {
        const dt = (Number.isFinite(paket.t) && Number.isFinite(alt.t)) ? paket.t - alt.t : 0;
        const oben = paket.k ? {} : kopie(alt.oben);
        if (paket.o) wendeObjektDeltaAn(oben, paket.o);
        const listenPaket = paket.l || {};
        const listen = {};
        const namen = new Set([...Object.keys(alt.listen), ...Object.keys(listenPaket)]);
        for (const name of namen) {
            if (!LISTEN_PRAEFIX[name]) throw new Error('Unbekannte Liste ' + name);
            const eintrag = listenPaket[name];
            if (eintrag === null) continue; // Liste wird nicht mehr verfolgt
            const vorher = alt.listen[name];
            const ids = (eintrag && eintrag.i) ? eintrag.i.map(c => dekodiereId(name, c)) : (vorher ? vorher.ids : []);
            const objekte = new Map();
            ids.forEach((id, idx) => {
                const d = (eintrag && eintrag.d && eintrag.d[idx]) || 0;
                const altObj = vorher && vorher.objekte.get(id);
                let obj;
                if (!altObj) {
                    if (!istObjekt(d)) throw new Error('Neues Objekt ohne Daten ' + id);
                    obj = Object.assign({ id }, kopie(d));
                } else {
                    obj = Object.assign({}, altObj);
                    const vorhersage = sageVorher(name, obj, dt);
                    if (vorhersage) Object.assign(obj, vorhersage);
                    if (d) wendeObjektDeltaAn(obj, d);
                }
                objekte.set(id, obj);
            });
            listen[name] = { ids, objekte };
        }
        return { n: paket.n, t: paket.t, oben, listen };
    }

    // Voller Snapshot als frische Kopie (applyGameStateSnapshot darf ihn behalten)
    snapshot() {
        const z = this.zustand;
        if (!z) return null;
        const s = kopie(z.oben);
        for (const name of Object.keys(z.listen)) {
            const l = z.listen[name];
            s[name] = l.ids.map(id => kopie(l.objekte.get(id)));
        }
        return s;
    }
}

export class SnapshotKodierer {
    constructor() {
        // Spiegel: derselbe Dekodierer wie beim Client, damit beide Seiten denselben Stand kennen
        this.spiegel = new SnapshotDekodierer();
        this.n = 0;
        this.seitKeyframe = 0;
        this.keyframeErzwingen = true;
    }

    reset() {
        this.spiegel.reset();
        this.keyframeErzwingen = true;
    }

    erzwingeKeyframe() {
        this.keyframeErzwingen = true;
    }

    // voll: Ergebnis von serializeGameState(); weltSchritt: Zaehler der bewegten Simulationsschritte
    kodiere(voll, weltSchritt) {
        const gerundet = rundeSnapshot(voll);
        const basis = this.spiegel.zustand;
        const t = Number.isFinite(weltSchritt) ? weltSchritt : (basis ? basis.t + 2 : 0);
        const keyframe = this.keyframeErzwingen || !basis || this.seitKeyframe + 1 >= KEYFRAME_INTERVALL;
        this.n++;
        const paket = { v: PROTOKOLL_VERSION, n: this.n, t };
        if (keyframe) paket.k = 1;

        const altOben = keyframe ? {} : basis.oben;
        const altListen = keyframe ? {} : basis.listen;
        const dt = keyframe ? 0 : t - basis.t;

        // Felder ausserhalb der verfolgten Listen (auch nicht verfolgbare Listen)
        const oben = {};
        const listen = {};
        for (const k of Object.keys(gerundet)) {
            if (LISTEN_PRAEFIX[k] && istVerfolgbar(gerundet[k])) listen[k] = gerundet[k];
            else oben[k] = gerundet[k];
        }
        const o = objektDelta(altOben, oben, null);
        if (o) paket.o = o;

        const l = {};
        for (const name of Object.keys(altListen)) {
            if (!listen[name]) l[name] = null;
        }
        for (const name of Object.keys(listen)) {
            const eintrag = this._listenEintrag(name, listen[name], altListen[name], dt);
            if (eintrag) l[name] = eintrag;
        }
        if (Object.keys(l).length) paket.l = l;

        // Spiegel nachfuehren; scheitert das, beim naechsten Mal Keyframe
        if (!this.spiegel.dekodiere(paket, false)) this.keyframeErzwingen = true;
        else this.keyframeErzwingen = false;
        this.seitKeyframe = keyframe ? 0 : this.seitKeyframe + 1;
        return paket;
    }

    _listenEintrag(name, neuListe, vorher, dt) {
        const ids = neuListe.map(o => o.id);
        const idsGleich = vorher && vorher.ids.length === ids.length && vorher.ids.every((id, i) => id === ids[i]);
        const d = neuListe.map(neu => {
            const alt = vorher && vorher.objekte.get(neu.id);
            if (!alt) {
                const voll = Object.assign({}, neu);
                delete voll.id;
                return voll;
            }
            let vergleich = alt;
            let ohne = null;
            const vorhersage = sageVorher(name, alt, dt);
            if (vorhersage) {
                vergleich = Object.assign({}, alt, vorhersage);
                ohne = new Set();
                if (Number.isFinite(neu.x) && Math.abs(vorhersage.x - neu.x) <= DR_TOLERANZ) ohne.add('x');
                if (Number.isFinite(neu.y) && Math.abs(vorhersage.y - neu.y) <= DR_TOLERANZ) ohne.add('y');
            }
            return objektDelta(vergleich, neu, ohne) || 0;
        });
        while (d.length && d[d.length - 1] === 0) d.pop();
        if (idsGleich && d.length === 0) return undefined;
        const eintrag = {};
        if (!idsGleich) eintrag.i = ids.map(id => kodiereId(name, id));
        if (d.length) eintrag.d = d;
        return eintrag;
    }
}

// Client -> Host: Eingaben nur bei Aenderung senden.
// Tasten sofort bei jeder Aenderung, Position hoechstens jeden 2. Schritt und nur wenn bewegt,
// sonst alle HEARTBEAT_SCHRITTE ein volles Paket. Der Host haelt die Tasten bis zum naechsten Paket.
export const HEARTBEAT_SCHRITTE = 30;
export const POSITIONS_INTERVALL = 2;

export class EingabeSender {
    constructor() {
        this.reset();
    }

    reset() {
        this.schritt = 0;
        this.letzterVersand = -Infinity;
        this.letzte = null;
    }

    // Einmal pro Client-Schritt aufrufen; liefert das zu sendende Paket oder null
    naechstes(eingabe) {
        this.schritt++;
        const e = {
            v: PROTOKOLL_VERSION,
            x: Number.isFinite(eingabe.x) ? runde1(eingabe.x) : eingabe.x,
            y: Number.isFinite(eingabe.y) ? runde1(eingabe.y) : eingabe.y,
            rotate: eingabe.rotate || 0,
            laser: Boolean(eingabe.laser),
            rakete: Boolean(eingabe.rakete),
            bombe: Boolean(eingabe.bombe)
        };
        // Gleve: Steuerrichtung fuer den Dash (2 Nachkommastellen), geht mit jedem Paket mit
        if (Number.isFinite(eingabe.rx) && Number.isFinite(eingabe.ry)) {
            e.rx = runde2(eingabe.rx);
            e.ry = runde2(eingabe.ry);
        }
        const l = this.letzte;
        const seit = this.schritt - this.letzterVersand;
        const tastenGeaendert = !l || l.laser !== e.laser || l.rakete !== e.rakete || l.bombe !== e.bombe;
        const bewegt = !l || l.x !== e.x || l.y !== e.y || l.rotate !== e.rotate;
        const faellig = tastenGeaendert || (bewegt && seit >= POSITIONS_INTERVALL) || seit >= HEARTBEAT_SCHRITTE;
        if (!faellig) return null;
        this.letzte = e;
        this.letzterVersand = this.schritt;
        return e;
    }
}
