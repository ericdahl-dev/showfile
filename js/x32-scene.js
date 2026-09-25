// ─── X32 / M32 scene file parser ───────────────────────────────────────────
// Reads a .scn scene (plain text, one OSC-style path + args per line) into a
// console-independent intermediate representation.
//
// Field positions below were derived empirically from real scene files rather
// than from any existing converter's source.

import { colorFrom, tapFrom } from './console-map.js';
import { makeChannel } from './scene.js';
import { loss } from './losses.js';
import { INF, num, bool, parseNodes, collapsePairs } from './scene-text.js';
import { membership, eqLine } from './scn-codec.js';
import { routingBlock, channelSource, headampIndex, spareSlot, gateLine, dynLine } from './x32-codec.js';


export function parseX32Scene(text) {
  const { nodes, header: sceneName } = parseNodes(text);

  if (!nodes.size) throw new Error('No scene data found — is this an X32/M32 .scn file?');

  // The X Air series writes .scn too, and its channel nodes are named the
  // same, so an X Air file parses here into plausible nonsense — colors and
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
  function patchFor(slot) {
    const block = routingBlock.read(routeBlocks[Math.floor((slot - 1) / 8)]);
    if (!block) return null;
    const input = block.start + (slot - 1) % 8;
    return block.group === 'user' ? userPatch(input) : { group: block.group, input };
  }

  // A UIN block is not an input: it points into the user routing table, whose
  // 32 slots each name a real one (0 OFF, 1-32 local, 33-80 AES50-A,
  // 81-128 AES50-B, 129-160 card, 161-166 aux, 167-168 talkback).
  const userTable = get('/config/userrout/in').map(v => parseInt(v, 10) || 0);
  function userPatch(slot) {
    const v = userTable[slot - 1] || 0;
    if (v >= 1 && v <= 32) return { group: 'local', input: v };
    if (v >= 33 && v <= 80) return { group: 'aes50a', input: v - 32 };
    if (v >= 81 && v <= 128) return { group: 'aes50b', input: v - 80 };
    if (v >= 129 && v <= 160) return { group: 'card', input: v - 128 };
    if (v >= 161 && v <= 166) return { group: 'aux', input: v - 160 };
    if (v === 167 || v === 168) return { group: 'talkback', input: v - 166 };
    return null;
  }

  // A channel plays whatever its /ch/NN/config source names, which is not
  // always its own number (see channelSource in x32-codec.js).
  function sourcePatch(s) {
    const src = channelSource.read(s);
    return src?.slot ? patchFor(src.slot) : src;
  }

  // Headamps carry the real preamp gain and phantom; channels reference them
  // through their source index.
  const headamps = {};
  for (const [path, args] of nodes) {
    const m = /^\/headamp\/(\d+)$/.exec(path);
    if (m) headamps[parseInt(m[1], 10)] = { gain: num(args[0]), phantom: bool(args[1]) };
  }

  function headampFor(patch) {
    const idx = headampIndex(patch);
    return idx === null ? null : headamps[idx] || null;
  }

  const strips = [];
  for (let n = 1; n <= 32; n++) {
    const id = String(n).padStart(2, '0');
    const cfg = get(`/ch/${id}/config`);
    if (!cfg.length) continue;

    // Our writer's blank slots (spareSlot) are padding, not channels; read
    // back as channels they would overflow the next desk down.
    if (spareSlot.is(cfg, get(`/ch/${id}/preamp`), get(`/ch/${id}/eq`))) continue;

    const pre  = get(`/ch/${id}/preamp`);
    const gate = get(`/ch/${id}/gate`);
    const dyn  = get(`/ch/${id}/dyn`);
    const mix  = get(`/ch/${id}/mix`);
    const grp  = get(`/ch/${id}/grp`);

    // /ch/NN/eq/B  =  type freq gain q
    const bands = [];
    for (let b = 1; b <= 4; b++) {
      const e = get(`/ch/${id}/eq/${b}`);
      if (e.length) bands.push(eqLine.read(e));
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

    // Talkback can be routed to a channel but is no input another desk can
    // be patched to, so the channel is left unpatched and says why.
    let patch = sourcePatch(num(cfg[3]));
    if (patch?.group === 'talkback') {
      warnings.push(loss('patch.group-unknown', { label: `ch ${n} "${cfg[0] || ''}"`, group: 'talkback' }));
      patch = null;
    }

    // /ch/NN/grp  %00000000 %000000  — 8 DCA bits then 6 mute-group bits.
    // Least-significant-bit first; see membership in scn-codec.js.
    strips.push({
      ch: n,
      name:  cfg[0] || '',
      icon:  num(cfg[1]),
      color: colorFrom('x32', cfg[2] || 'OFF'),
      patch,

      trim:   num(pre[0]),
      invert: bool(pre[1]),
      hpf:    { on: bool(pre[2]), slope: num(pre[3], 24), freq: num(pre[4], 20) },

      fader: num(mix[1], INF),
      muted: mix.length ? !bool(mix[0]) : false,
      pan:   num(mix[3]),
      toMain: mix.length > 2 ? bool(mix[2]) : true,

      gate: gate.length ? gateLine.read(gate) : null,

      dyn: dyn.length ? dynLine.read(dyn) : null,

      eq: { on: bool(get(`/ch/${id}/eq`)[0]), bands },
      sends,
      dcas:       membership.read(grp[0]),
      muteGroups: membership.read(grp[1]),
    });
  }

  const channels = collapsePairs(strips, chlink, (s, pair) =>
    makeChannel({ ...s, ...pair, headamp: headampFor(s.patch) }));

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
