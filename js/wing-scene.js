// ─── Behringer Wing snapshot parser ────────────────────────────────────────
// Reads a .snap snapshot (JSON) into the same console-independent IR that
// x32-scene.js produces, so any writer can consume either source.
//
// A snapshot off a desk is a much looser input than an X32 scene: it can be a
// near-complete console state or a partial that touches a handful of keys, and
// the key set varies with firmware. So every read here is defensive — a missing
// section yields a missing IR field rather than a throw, and anything actively
// surprising becomes a warning the user sees rather than a silent default.

import { colorFrom, wingIconToX32, tapFrom } from './console-map.js';
import { loss, render } from './losses.js';
import { makeChannel } from './scene.js';

const INF = -Infinity;
const NEG_INF = -144;                  // the Wing's -oo sentinel

// Wing source groups -> neutral groups. C is the Wing's third AES50 port, USB its
// computer audio, BUS an internal bus used as a channel source (a sidechain key).
const IN_GROUP = { LCL: 'local', A: 'aes50a', B: 'aes50b', C: 'aes50c', CRD: 'card', USR: 'user', AUX: 'aux',
                   USB: 'usb', BUS: 'bus' };
const WING_MODELS = ['wing', 'wing-edit'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const numOr = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const dB    = (v) => (typeof v === 'number' ? (v <= NEG_INF ? INF : v) : INF);

// "#D5#M1" -> { dcas: [5], muteGroups: [1] }
function parseTags(tags) {
  const s = String(tags || '');
  const grab = (letter) => [...s.matchAll(new RegExp(`#${letter}(\\d+)`, 'g'))]
    .map(m => parseInt(m[1], 10)).filter(n => n > 0);
  return { dcas: grab('D'), muteGroups: grab('M') };
}

// The Wing's six bands -> neutral bands. The outer two are a shelf (SHV) or a
// bell (PEQ); the channel EQ has no cut, since a channel's cuts live in its
// filter block (flt). The four mids are always bells. A band with no gain and
// no frequency was never set, so it is dropped rather than emitted as a flat
// 0 dB bell that a target desk would then write.
// The Wing's high cut lives in the filter block, not the EQ. Every other desk
// here keeps it as an EQ band, so it joins the bands as one.
function withHighCut(eq, flt) {
  if (!isObj(flt) || flt.hc !== true) return eq;
  const band = { type: 'highcut', f: numOr(flt.hcf, 20000), g: 0, q: 1 };
  return eq ? { ...eq, bands: [...eq.bands, band] } : { on: true, bands: [band] };
}

function readEq(eq) {
  if (!isObj(eq)) return null;
  const bands = [];
  // A band at 0 dB is audibly absent, and the writer fills every one of the
  // Wing's six slots — flat where the source had nothing — so a converted
  // channel cannot inherit the last show's curve. Reading those back as real
  // bands would fill the next desk's four slots with no-ops.
  const live = (f, g) => typeof f === 'number' && typeof g === 'number' && g !== 0;

  if (live(eq.lf, eq.lg)) {
    bands.push({ type: eq.leq === 'SHV' ? 'lowshelf' : 'bell',
                 f: numOr(eq.lf), g: numOr(eq.lg), q: numOr(eq.lq, 1) });
  }
  for (let i = 1; i <= 4; i++) {
    const f = eq[`${i}f`], g = eq[`${i}g`];
    if (!live(f, g)) continue;
    bands.push({ type: 'bell', f: numOr(f), g: numOr(g), q: numOr(eq[`${i}q`], 1) });
  }
  if (live(eq.hf, eq.hg)) {
    bands.push({ type: eq.heq === 'SHV' ? 'highshelf' : 'bell',
                 f: numOr(eq.hf), g: numOr(eq.hg), q: numOr(eq.hq, 1) });
  }
  if (!bands.length) return null;
  return { on: eq.on !== false, bands };
}

function readSends(send) {
  if (!isObj(send)) return [];
  const out = [];
  for (const [key, s] of Object.entries(send)) {
    const bus = parseInt(key, 10);
    if (!bus || !isObj(s)) continue;
    out.push({
      bus,
      on: s.on !== false,
      level: dB(s.lvl),
      pan: numOr(s.pan, 0),
      tap: tapFrom('wing', s.mode),
    });
  }
  return out.sort((a, b) => a.bus - b.bus);
}

// A snapshot may be the bare snapshot object or wrapped; find ae_data either way.
function findAeData(root) {
  if (!isObj(root)) return null;
  if (isObj(root.ae_data)) return root.ae_data;
  if (isObj(root.snapshot?.ae_data)) return root.snapshot.ae_data;
  return null;
}

function named(store, count) {
  const out = [];
  if (!isObj(store)) return out;
  for (let n = 1; n <= count; n++) {
    const e = store[String(n)];
    if (!isObj(e)) continue;
    if (!e.name && e.fdr === undefined) continue;
    out.push({
      n, name: String(e.name || ''), icon: wingIconToX32(e.icon),
      color: colorFrom('wing', e.col), fader: dB(e.fdr), muted: e.mute === true,
    });
  }
  return out;
}

export function parseWingSnapshot(text) {
  let root;
  try {
    root = JSON.parse(String(text));
  } catch {
    throw new Error('That file is not valid JSON — is this a Wing .snap snapshot?');
  }

  const ae = findAeData(root);
  if (!ae) throw new Error('No ae_data section found — is this a Wing .snap snapshot?');
  if (!isObj(ae.ch)) throw new Error('The snapshot has no channel data to convert.');

  const warnings = [];
  const model = String(root.creator_model || root.snapshot?.creator_model || '');
  // Snapshots saved on the desk say "wing"; ones exported from the editor say
  // "WING-EDIT". Both are Wing files.
  if (model && !WING_MODELS.includes(model.toLowerCase())) {
    warnings.push(render(loss('file.model-mismatch', { model, expected: 'wing' })));
  }

  // Preamp gain and phantom live on the physical input, not the strip.
  const io = isObj(ae.io?.in) ? ae.io.in : {};
  function headampFor(conn) {
    if (!conn || !conn.grp || conn.grp === 'OFF') return null;
    const store = io[conn.grp];
    const e = isObj(store) ? store[String(conn.in)] : null;
    if (!isObj(e)) return null;
    return { gain: numOr(e.g, 0), phantom: e.vph === true, mode: e.mode || null };
  }

  const keys = Object.keys(ae.ch)
    .map(k => parseInt(k, 10))
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const channels = [];
  for (const n of keys) {
    const c = ae.ch[String(n)];
    if (!isObj(c)) continue;

    // A channel written only to CLEAR it — no name, muted, fader at the
    // Wing's -oo, and nothing else — is our writer blanking the rest of the
    // desk so a converted show lands the same way every time. Reading those
    // back as real channels would overflow the next desk down.
    if (!c.name && c.mute === true && c.fdr === NEG_INF
        && !c.in && !c.eq && !c.gate && !c.dyn && !c.flt) continue;

    const conn = isObj(c.in?.conn) ? c.in.conn : null;
    const ha = headampFor(conn);
    const patch = conn && conn.grp && conn.grp !== 'OFF'
      ? { group: IN_GROUP[conn.grp] || null, input: numOr(conn.in, 1) }
      : null;
    if (conn && conn.grp && conn.grp !== 'OFF' && !IN_GROUP[conn.grp]) {
      warnings.push(render(loss('patch.group-unknown', { label: `ch ${n} "${c.name || ''}"`, group: conn.grp })));
    }

    // Stereo is flagged in more than one place depending on where the snapshot
    // came from, so accept any of them rather than trusting a single key.
    const stereo = c.stereo === true || c.st === true ||
                   String(c.mode || '').toUpperCase() === 'ST' ||
                   String(conn?.mode || '').toUpperCase() === 'ST' ||
                   String(ha?.mode || '').toUpperCase() === 'ST';

    const { dcas, muteGroups } = parseTags(c.tags);
    const mainOn = isObj(c.main?.['1']) ? c.main['1'].on !== false : true;

    channels.push(makeChannel({
      index: channels.length + 1,
      ch: n,
      name: String(c.name || ''),
      icon: wingIconToX32(c.icon),
      color: colorFrom('wing', c.col),
      patch,
      headamp: ha ? { gain: ha.gain, phantom: ha.phantom } : null,
      pairing: stereo ? 'native' : 'mono',
      srcChannels: [n],

      trim: numOr(c.in?.set?.trim, 0),
      invert: c.in?.set?.inv === true,
      hpf: isObj(c.flt)
        ? { on: c.flt.lc === true, slope: numOr(parseInt(c.flt.lcs, 10), 24), freq: numOr(c.flt.lcf, 20) }
        : null,

      fader: dB(c.fdr),
      muted: c.mute === true,
      pan: numOr(c.pan, 0),
      toMain: mainOn,

      gate: isObj(c.gate) ? {
        on: c.gate.on !== false, thr: numOr(c.gate.thr, -40), range: numOr(c.gate.range, 20),
        att: numOr(c.gate.att, 10), hold: numOr(c.gate.hld, 20), rel: numOr(c.gate.rel, 250),
      } : null,

      dyn: isObj(c.dyn) ? {
        on: c.dyn.on !== false, det: c.dyn.det === 'RMS' ? 'RMS' : 'PEAK',
        env: c.dyn.env === 'LIN' ? 'LIN' : 'LOG',
        thr: numOr(c.dyn.thr, -20), ratio: numOr(c.dyn.ratio, 3), knee: numOr(c.dyn.knee, 0),
        gain: numOr(c.dyn.gain, 0), att: numOr(c.dyn.att, 10), hold: numOr(c.dyn.hld, 20),
        rel: numOr(c.dyn.rel, 250), pos: 'POST', mix: numOr(c.dyn.mix, 100),
      } : null,

      eq: withHighCut(readEq(c.eq), c.flt),
      sends: readSends(c.send),
      dcas,
      muteGroups,
    }));
  }

  if (!channels.length) throw new Error('The snapshot has no channel data to convert.');

  return {
    format: 'wing',
    name: String(root.creator_name || root.snapshot?.creator_name || ''),
    channels,
    buses: named(ae.bus, 16),
    matrices: named(ae.mtx, 8),
    dcas: named(ae.dca, 16),
    muteGroups: [],
    warnings,
    raw: ae,
  };
}
