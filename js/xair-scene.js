// ─── Behringer X Air / Midas MR scene parser ───────────────────────────────
// Reads an X AIR Edit .scn scene (XR12/16/18, MR12/16/18) into the same
// console-independent IR the X32 parser produces, so both existing emitters
// take an X Air show without modification.
//
// Field positions were derived empirically from a real scene file, the same
// way the X32 ones were. The format is the X32's on-disk shape — one
// OSC-style path per line, right-aligned arguments — but almost every node
// differs in the detail:
//
//   * No header line. The X32 opens with #4.0# "Scene name"; an X Air file
//     starts straight at /config/chlink, so the show name lives only in the
//     filename and the IR takes it from there.
//   * /ch/NN/config is "name" COLOUR analogSrc usbSrc. There is no icon
//     field at all, and the colour is the palette INDEX where the X32 writes
//     the mnemonic (1 not RD) — see console-map.js.
//   * Input patch is PER CHANNEL ("In10" on channel 9), not per block of
//     eight. This is the one place the smaller desk is more expressive than
//     the X32, and it is why there is no routing-block code here.
//   * 16 channels, 6 buses, 4 FX sends, no matrices, 4 DCAs, 4 mute groups.
//   * Headamps are 1-based and indexed by INPUT number, with no AES50 offsets.

import { colorFrom } from './console-map.js';
import { INF, num, bool, bits, parseNodes } from './scene-text.js';
import { loss, render } from './losses.js';

const MAX_CH = 16;
const BUSES = 6;
const FX_SENDS = 4;

// X Air EQ band tokens -> neutral band types. Same spellings as the X32.
const EQ_TYPE = {
  LCUT: 'lowcut', LSHV: 'lowshelf', PEQ: 'bell', VEQ: 'bell',
  HSHV: 'highshelf', HCUT: 'highcut',
};
const eqType = (t) => EQ_TYPE[String(t || 'PEQ').toUpperCase()] || 'bell';

// The X Air high-pass is fixed at 12 dB/oct — there is no slope field to read.
const HPF_SLOPE = 12;

// "In01" is a local XLR, "U01" a USB return. The neutral groups describe the
// physical thing, so USB lands on 'card' the same way the X32's expansion
// card does.
function parseSource(tok) {
  const s = String(tok || '').trim();
  let m = /^In(\d+)$/i.exec(s);
  if (m) return { group: 'local', input: parseInt(m[1], 10) };
  m = /^U(\d+)$/i.exec(s);
  if (m) return { group: 'card', input: parseInt(m[1], 10) };
  if (/^Aux/i.test(s)) return { group: 'aux', input: /R$/i.test(s) ? 2 : 1 };
  return null;
}

export function parseXAirScene(text, fileName = '') {
  const { nodes } = parseNodes(text);
  if (!nodes.size) throw new Error('No scene data found — is this an X Air .scn file?');
  if (!nodes.has('/config/chlink') && !nodes.has('/ch/01/config')) {
    throw new Error('This does not look like an X Air scene — no /config/chlink or /ch/01 node.');
  }
  // Same extension, same node names — see the mirror of this check in
  // x32-scene.js. Matrices and 16 link pairs only exist on the bigger desk.
  if (nodes.has('/mtx/01/config') || nodes.get('/config/chlink')?.length === 16) {
    throw new Error('This is an X32/M32 scene, not an X Air one. Pick Behringer X32 / Midas M32 as the source console.');
  }

  const get = (p) => nodes.get(p) || [];
  const warnings = [];

  // 8 booleans, one per adjacent pair (1-2, 3-4 ... 15-16).
  const chlink = get('/config/chlink').map(bool);

  // /headamp/NN  gain phantom — indexed by input number, 1-based, 2-digit.
  const headamps = {};
  for (const [path, args] of nodes) {
    const m = /^\/headamp\/(\d+)$/.exec(path);
    if (m) headamps[parseInt(m[1], 10)] = { gain: num(args[0]), phantom: bool(args[1]) };
  }
  const headampFor = (patch) =>
    (patch && patch.group === 'local' && headamps[patch.input]) || null;

  const strips = [];
  let fxSendsInUse = 0;

  for (let n = 1; n <= MAX_CH; n++) {
    const id = String(n).padStart(2, '0');
    const cfg = get(`/ch/${id}/config`);
    if (!cfg.length) continue;

    const pre  = get(`/ch/${id}/preamp`);
    const gate = get(`/ch/${id}/gate`);
    const dyn  = get(`/ch/${id}/dyn`);
    const mix  = get(`/ch/${id}/mix`);
    const grp  = get(`/ch/${id}/grp`);

    const bands = [];
    for (let b = 1; b <= 4; b++) {
      const e = get(`/ch/${id}/eq/${b}`);
      if (e.length) bands.push({ type: eqType(e[0]), f: num(e[1]), g: num(e[2]), q: num(e[3]) });
    }

    // /ch/NN/mix/01..10 — level on tap [pan]. The X32 writes on BEFORE level;
    // the X Air writes level first, and the trailing pan only appears on the
    // odd send of a linked bus pair.
    //
    // Sends 7-10 are the FX engines, which have no counterpart on either
    // target desk, so they are counted for a warning rather than carried onto
    // buses 7-10 — those are real monitor sends on an X32 and quietly feeding
    // them would put signal in someone's wedge.
    const sends = [];
    for (let b = 1; b <= BUSES + FX_SENDS; b++) {
      const s = get(`/ch/${id}/mix/${String(b).padStart(2, '0')}`);
      if (!s.length) continue;
      const on = bool(s[1]);
      if (b > BUSES) { if (on) fxSendsInUse++; continue; }
      sends.push({
        bus: b,
        on,
        level: num(s[0], INF),
        // POSTEQ is post-EQ but PRE-fader, so it normalises to a pre-fader
        // send at the emitters, not a post-fader one.
        tap: String(s[2] || 'POSTEQ').toUpperCase() === 'POST' ? 'POST' : 'PRE',
        pan: s.length > 3 ? num(s[3]) : 0,
      });
    }

    const patch = parseSource(cfg[2]);

    strips.push({
      ch: n,
      name:  cfg[0] || '',
      icon:  null,                                   // the X Air has no icon field
      color: colorFrom('xair', num(cfg[1], 0)),
      source: num(cfg[1], 0),
      patch,

      // preamp: trim rpdgt invert hpon hpf. The two flags are adjacent and a
      // channel with both set cannot tell them apart; confirmed against a pair
      // of scenes that set exactly one each.
      trim:   num(pre[0]),
      invert: bool(pre[2]),
      hpf:    { on: bool(pre[3]), slope: HPF_SLOPE, freq: num(pre[4], 20) },

      // mix: on fader lrAssign pan
      fader: num(mix[1], INF),
      muted: mix.length ? !bool(mix[0]) : false,
      toMain: mix.length > 2 ? bool(mix[2]) : true,
      pan:   num(mix[3]),

      gate: gate.length ? {
        on: bool(gate[0]), thr: num(gate[2]), range: num(gate[3]),
        att: num(gate[4]), hold: num(gate[5]), rel: num(gate[6]),
      } : null,

      // dyn: on mode det env thr ratio knee gain att hold rel mix keysrc auto
      // The X32 carries a pre/post position token here; the X Air does not.
      dyn: dyn.length ? {
        on: bool(dyn[0]), det: dyn[2] || 'PEAK', env: dyn[3] || 'LOG',
        thr: num(dyn[4]), ratio: num(dyn[5], 3), knee: num(dyn[6]),
        gain: num(dyn[7]), att: num(dyn[8]), hold: num(dyn[9]),
        rel: num(dyn[10]), mix: num(dyn[11], 100),
      } : null,

      eq: { on: bool(get(`/ch/${id}/eq`)[0]), bands },
      sends,
      dcas:       bits(grp[0]),
      muteGroups: bits(grp[1]),
    });
  }

  if (!strips.length) throw new Error('No channels found — is this an X Air .scn file?');

  if (fxSendsInUse) {
    warnings.push(render(loss('fx.engine-unsupported', { count: fxSendsInUse, desk: 'X Air' })));
  }

  // Collapse linked mono pairs into single stereo channels, exactly as the
  // X32 reader does; the pair bit covers channels 2n-1 and 2n.
  const channels = [];
  for (let i = 0; i < strips.length; ) {
    const s = strips[i];
    const pairIdx = Math.ceil(s.ch / 2) - 1;
    const linked = s.ch % 2 === 1 && chlink[pairIdx] === true && strips[i + 1]?.ch === s.ch + 1;
    channels.push({
      ...s,
      index: channels.length + 1,
      stereo: linked,
      srcChannels: linked ? [s.ch, s.ch + 1] : [s.ch],
      headamp: headampFor(s.patch),
    });
    i += linked ? 2 : 1;
  }

  // /bus/N and /dca/N are single-digit here, and their config is name +
  // colour with no icon.
  const named = (prefix, count) => {
    const out = [];
    for (let n = 1; n <= count; n++) {
      const cfg = get(`${prefix}/${n}/config`);
      const mix = get(`${prefix}/${n}/mix`);
      if (!cfg.length) continue;
      out.push({ n, name: cfg[0] || '', icon: null, color: colorFrom('xair', num(cfg[1], 0)),
                 fader: num(mix[1], INF), muted: mix.length ? !bool(mix[0]) : false });
    }
    return out;
  };

  const dcas = [];
  for (let n = 1; n <= 4; n++) {
    const cfg = get(`/dca/${n}/config`);
    const st  = get(`/dca/${n}`);
    if (!cfg.length && !st.length) continue;
    dcas.push({ n, name: cfg[0] || '', color: colorFrom('xair', num(cfg[1], 0)), icon: null,
                fader: num(st[1], 0), muted: st.length ? !bool(st[0]) : false });
  }

  // No header line to read a name out of, so the filename is the show name.
  const name = String(fileName).replace(/\.[^.]+$/, '').trim();

  return {
    format: 'xair',
    name,
    channels,
    buses:    named('/bus', BUSES),
    matrices: [],                                   // the X Air has none
    dcas,
    muteGroups: get('/config/mute').map(bool),
    warnings,
    raw: nodes,
  };
}
