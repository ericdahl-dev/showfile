// ─── X32 / M32 scene file parser ───────────────────────────────────────────
// Reads a .scn scene (plain text, one OSC-style path + args per line) into a
// console-independent intermediate representation.
//
// Field positions below were derived empirically from real scene files rather
// than from any existing converter's source.

import { colorFrom, tapFrom } from './console-map.js';
import { makeChannel } from './scene.js';
import { INF, num, bool, bits, parseNodes } from './scene-text.js';

// X32 input classes -> the IR's neutral groups. The neutral names describe the
// physical thing (a local XLR, an AES50 port) rather than any desk's spelling.
const IN_GROUP = { AN: 'local', A: 'aes50a', B: 'aes50b', CARD: 'card', UIN: 'user', AUX: 'aux' };

// X32 EQ band tokens -> neutral band types.
const EQ_TYPE = {
  LCUT: 'lowcut', LSHV: 'lowshelf', PEQ: 'bell', VEQ: 'bell',
  HSHV: 'highshelf', HCUT: 'highcut',
};
const eqType = (t) => EQ_TYPE[String(t || 'PEQ').toUpperCase()] || 'bell';


export function parseX32Scene(text) {
  const { nodes, header: sceneName } = parseNodes(text);

  if (!nodes.size) throw new Error('No scene data found — is this an X32/M32 .scn file?');

  // The X Air series writes .scn too, and its channel nodes are named the
  // same, so an X Air file parses here into plausible nonsense — colours and
  // the patch both read as empty rather than failing. Two markers separate
  // them: the X Air has FX send masters, and its chlink is 8 pairs to the
  // X32's 16.
  if (nodes.has('/fxsend/1/config') || nodes.get('/config/chlink')?.length === 8) {
    throw new Error('This is an X Air scene, not an X32/M32 one. Pick Behringer X Air / Midas MR as the source console.');
  }

  const get = (p) => nodes.get(p) || [];
  const warnings = [];

  // /config/chlink is 16 booleans, one per adjacent pair (1-2, 3-4 ... 31-32).
  const chlink = get('/config/chlink').map(bool);

  // /config/routing/IN assigns physical inputs to channels in blocks of eight:
  // "A1-8 A9-16 CARD17-24 UIN25-32 B1-2" means ch1-8 come from AES50-A inputs
  // 1-8, ch9-16 from AES50-A 9-16, ch17-24 from the card, and so on. The
  // per-channel `source` field in /ch/NN/config is NOT the patch.
  const routeBlocks = get('/config/routing/IN');
  const BLOCK_RE = /^(AN|CARD|UIN|AUX|A|B)(\d+)-(\d+)$/;
  function patchFor(slot) {
    const blockIdx = Math.floor((slot - 1) / 8);
    const offset   = (slot - 1) % 8;
    const tok = routeBlocks[blockIdx];
    if (!tok) return null;
    const m = BLOCK_RE.exec(tok);
    if (!m) return null;
    return { group: IN_GROUP[m[1]] || null, input: parseInt(m[2], 10) + offset };
  }

  // A channel plays whatever its /ch/NN/config source names, which is not
  // always its own number: 0 OFF, 1-32 a routing slot (In01-32), 33-38 Aux
  // 1-6, 39-40 USB L/R, 41-48 FX returns 1L-4R, 49-64 Bus 01-16.
  function sourcePatch(s) {
    if (s >= 1 && s <= 32) return patchFor(s);
    if (s >= 33 && s <= 38) return { group: 'aux', input: s - 32 };
    if (s >= 39 && s <= 40) return { group: 'usb', input: s - 38 };
    if (s >= 41 && s <= 48) return { group: 'fx', input: s - 40 };
    if (s >= 49 && s <= 64) return { group: 'bus', input: s - 48 };
    return null;
  }

  // Headamps carry the real preamp gain and phantom; channels reference them
  // through their source index.
  const headamps = {};
  for (const [path, args] of nodes) {
    const m = /^\/headamp\/(\d+)$/.exec(path);
    if (m) headamps[parseInt(m[1], 10)] = { gain: num(args[0]), phantom: bool(args[1]) };
  }

  // X32 headamp indexes: 0-31 local, 32-79 AES50-A, 80-127 AES50-B.
  function headampFor(patch) {
    if (!patch) return null;
    const base = patch.group === 'local' ? 0 : patch.group === 'aes50a' ? 32 : patch.group === 'aes50b' ? 80 : null;
    if (base === null) return null;                 // card/USB inputs have no preamp
    return headamps[base + patch.input - 1] || null;
  }

  const strips = [];
  for (let n = 1; n <= 32; n++) {
    const id = String(n).padStart(2, '0');
    const cfg = get(`/ch/${id}/config`);
    if (!cfg.length) continue;

    // A slot written only to CLEAR it — a config line and nothing else — is
    // padding, not a channel. Our own writer emits those so a converted scene
    // does not leave channels 17-32 holding the last show; reading them back
    // as real channels would then overflow the next desk down. A scene off an
    // actual desk always carries the preamp and EQ nodes too.
    if (!cfg[0] && !get(`/ch/${id}/preamp`).length && !get(`/ch/${id}/eq`).length) continue;

    const pre  = get(`/ch/${id}/preamp`);
    const gate = get(`/ch/${id}/gate`);
    const dyn  = get(`/ch/${id}/dyn`);
    const mix  = get(`/ch/${id}/mix`);
    const grp  = get(`/ch/${id}/grp`);

    // /ch/NN/eq/B  =  type freq gain q
    const bands = [];
    for (let b = 1; b <= 4; b++) {
      const e = get(`/ch/${id}/eq/${b}`);
      if (e.length) bands.push({ type: eqType(e[0]), f: num(e[1]), g: num(e[2]), q: num(e[3]) });
    }

    // Bus sends live at /ch/NN/mix/01..16. Odd buses carry the full argument
    // list; even buses of a linked pair carry only on+level.
    const sends = [];
    for (let b = 1; b <= 16; b++) {
      const s = get(`/ch/${id}/mix/${String(b).padStart(2, '0')}`);
      if (!s.length) continue;
      sends.push({
        bus: b,
        on: bool(s[0]),
        level: num(s[1], INF),
        pan: s.length > 2 ? num(s[2]) : 0,
        tap: s.length > 3 ? tapFrom('x32', s[3]) : null,   // even buses take the odd bus's
      });
    }
    // An even bus carries only on and level; its tap is its odd partner's.
    for (const s of sends) if (s.tap === null) s.tap = sends.find(o => o.bus === s.bus - 1)?.tap || 'pre';

    // /ch/NN/grp  %00000000 %000000  — 8 DCA bits then 6 mute-group bits.
    // bits() reads them least-significant-bit first; see scene-text.js.
    strips.push({
      ch: n,
      name:  cfg[0] || '',
      icon:  num(cfg[1]),
      color: colorFrom('x32', cfg[2] || 'OFF'),
      patch: sourcePatch(num(cfg[3])),

      trim:   num(pre[0]),
      invert: bool(pre[1]),
      hpf:    { on: bool(pre[2]), slope: num(pre[3], 24), freq: num(pre[4], 20) },

      fader: num(mix[1], INF),
      muted: mix.length ? !bool(mix[0]) : false,
      pan:   num(mix[3]),
      toMain: mix.length > 2 ? bool(mix[2]) : true,

      gate: gate.length ? {
        on: bool(gate[0]), thr: num(gate[2]), range: num(gate[3]),
        att: num(gate[4]), hold: num(gate[5]), rel: num(gate[6]),
      } : null,

      dyn: dyn.length ? {
        on: bool(dyn[0]), det: dyn[2] || 'PEAK', env: dyn[3] || 'LOG',
        thr: num(dyn[4]), ratio: num(dyn[5], 3), knee: num(dyn[6]),
        gain: num(dyn[7]), att: num(dyn[8]), hold: num(dyn[9]),
        rel: num(dyn[10]), pos: dyn[11] || 'POST', mix: num(dyn[13], 100),
      } : null,

      eq: { on: bool(get(`/ch/${id}/eq`)[0]), bands },
      sends,
      dcas:       bits(grp[0]),
      muteGroups: bits(grp[1]),
    });
  }

  // Collapse X32 mono pairs into single Wing stereo channels. Every linked pair
  // swallows one channel index, which is why numbering drifts down the file.
  const channels = [];
  for (let i = 0; i < strips.length; ) {
    const s = strips[i];
    const pairIdx = Math.ceil(s.ch / 2) - 1;
    const linked = s.ch % 2 === 1 && chlink[pairIdx] === true && strips[i + 1]?.ch === s.ch + 1;
    channels.push(makeChannel({
      ...s,
      index: channels.length + 1,
      pairing: linked ? 'linked' : 'mono',
      srcChannels: linked ? [s.ch, s.ch + 1] : [s.ch],
      headamp: headampFor(s.patch),
    }));
    i += linked ? 2 : 1;
  }

  const named = (prefix, count, pad = 2) => {
    const out = [];
    for (let n = 1; n <= count; n++) {
      const id = String(n).padStart(pad, '0');
      const cfg = get(`${prefix}/${id}/config`);
      const mix = get(`${prefix}/${id}/mix`);
      if (!cfg.length) continue;
      out.push({ n, name: cfg[0] || '', icon: num(cfg[1]), color: colorFrom('x32', cfg[2] || 'OFF'),
                 fader: num(mix[1], INF), muted: mix.length ? !bool(mix[0]) : false });
    }
    return out;
  };

  const dcas = [];
  for (let n = 1; n <= 8; n++) {
    const cfg = get(`/dca/${n}/config`);
    const st  = get(`/dca/${n}`);
    if (!cfg.length && !st.length) continue;
    dcas.push({ n, name: cfg[0] || '', color: colorFrom('x32', cfg[2] || 'OFF'), icon: num(cfg[1]),
                fader: num(st[1], 0), muted: st.length ? !bool(st[0]) : false });
  }

  return {
    format: 'x32',
    name: sceneName,
    channels,
    buses:    named('/bus', 16),
    matrices: named('/mtx', 6),
    dcas,
    muteGroups: get('/config/mute').map(bool),
    losses: warnings,
    warnings: [],
    raw: nodes,
  };
}

export { INF, num };
