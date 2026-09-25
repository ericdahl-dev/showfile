// ─── X32 / M32 scene emitter ───────────────────────────────────────────────
// Turns the console-independent IR into a .scn scene file.
//
// Writing an X32 is a narrower target than reading one, and three of its limits
// change the shape of the show rather than just trimming values:
//
//   * No native stereo channel. A stereo source becomes two linked mono
//     channels, and /config/chlink only links ODD-ALIGNED adjacent pairs
//     (1-2, 3-4 — never 2-3), so a stereo channel landing on an even slot
//     leaves a one-channel gap. Order is preserved and the gap is reported;
//     shuffling later channels forward to fill it would silently renumber the
//     show against the source, which is worse on a dark stage.
//   * Input patching is per BLOCK OF EIGHT, not per channel. A source with a
//     scattered patch cannot be represented; the dominant group per block wins
//     and every channel that disagrees is named in a warning.
//   * 32 channels, 4 EQ bands, 6 matrices, 8 strip colours.
//
// Everything that does not fit is reported. Nothing is dropped silently.

import { mapColor, mapIcon, codeToHex, snapRatio, ratioToken, tapTo } from './console-map.js';
import {
  q, pad2, onOff, dec, sign1, sign2, EQ_TOKEN, mask, allocate, fitBands, stripName,
  reportColourCollapse, reportLostBuses, reportBalanceLost, snapRatioReported, fitBandsReported,
} from './scn-core.js';
import { loss, renderAll, reportLostMembership } from './losses.js';

const DESK = 'X32';
const MAX_CH = 32;
const MAX_EQ_BANDS = 4;
const MAX_MATRIX = 6;
const BLOCK = 8;

// The X32's own flat channel EQ, used for any band the source did not carry.
const FLAT_BANDS = [
  { type: 'bell',      f: 124.7, g: 0, q: 2 },
  { type: 'bell',      f: 496.6, g: 0, q: 2 },
  { type: 'bell',      f: 1970,  g: 0, q: 2 },
  { type: 'highshelf', f: 10020, g: 0, q: 2 },
];

// Neutral groups -> X32 routing-block prefixes. Groups with no preamp behind
// them (card, user, aux) still patch; they just have no /headamp node.
const BLOCK_PREFIX = { local: 'AN', aes50a: 'A', aes50b: 'B', card: 'CARD', user: 'UIN' };

// Inputs the X32 reaches through a channel's own source rather than a routing
// block: /ch/NN/config source = base + input (33-38 Aux, 39-40 USB, 41-48 FX
// returns, 49-64 buses), up to each group's size.
const SOURCE_GROUP = {
  aux: { base: 32, size: 6, label: 'AUX' },
  usb: { base: 38, size: 2, label: 'USB' },
  fx:  { base: 40, size: 8, label: 'FX' },
  bus: { base: 48, size: 16, label: 'BUS' },
};
const bySource = (patch) => {
  const g = patch && SOURCE_GROUP[patch.group];
  return g && patch.input >= 1 && patch.input <= g.size ? g : null;
};
const HEADAMP_BASE = { local: 0, aes50a: 32, aes50b: 80 };

// The X32 writes signed one-decimal values and uses "-oo" for silence.
function lvl(v) {
  if (v === -Infinity || v === null || v === undefined) return '-oo';
  return (v >= 0 ? '+' : '') + Number(v).toFixed(1);
}

// One routing token per block of eight. The block's start input is inferred
// from the first patched channel in it; any channel that does not fall on
// start+offset cannot be expressed and is named.
function routingBlocks(placed, warnings) {
  const byCh = new Map(placed.map(p => [p.ch, p]));
  const tokens = [];

  for (let b = 0; b < MAX_CH / BLOCK; b++) {
    const first = b * BLOCK + 1;
    const members = [];
    for (let i = 0; i < BLOCK; i++) {
      const p = byCh.get(first + i);
      if (BLOCK_PREFIX[p?.c.patch?.group]) members.push({ offset: i, ch: first + i, patch: p.c.patch, name: p.c.name });
    }
    if (!members.length) { tokens.push(`AN${first}-${first + BLOCK - 1}`); continue; }

    // Dominant group wins the block.
    const counts = {};
    for (const m of members) counts[m.patch.group] = (counts[m.patch.group] || 0) + 1;
    const group = Object.entries(counts).sort((a, b2) => b2[1] - a[1])[0][0];
    const mine = members.filter(m => m.patch.group === group);

    // Pick the start that satisfies the most channels, rather than whichever
    // happened to come first. After a stereo expansion the inputs no longer sit
    // one-per-slot, so the first channel is often the worst anchor available.
    //
    // The desk only has fixed blocks (AN1-8, AN9-16 ... never AN3-10), so a
    // start is only a candidate when it sits on a block boundary. A channel
    // votes for the block that would give it exactly its input; if none can,
    // the block holding most of the channels' inputs is the least-bad choice.
    const aligned = (s) => (s - 1) % BLOCK === 0 && s >= 1;
    const blockOf = (input) => Math.floor((Math.max(1, input) - 1) / BLOCK) * BLOCK + 1;
    const tally = (list) => {
      const votes = {};
      for (const s of list) votes[s] = (votes[s] || 0) + 1;
      return Number(Object.entries(votes).sort((a, b2) => b2[1] - a[1] || a[0] - b2[0])[0][0]);
    };
    const exact = mine.map(m => m.patch.input - m.offset).filter(aligned);
    const start = exact.length ? tally(exact) : tally(mine.map(m => blockOf(m.patch.input)));

    // One warning per block naming the channels, not one per channel: a stereo
    // expansion can knock every later channel out of line, and a wall of near
    // identical warnings buries the ones that matter.
    const stray = members.filter(m => m.patch.group !== group || m.patch.input !== start + m.offset);
    if (stray.length) {
      warnings.push(loss('patch.block-granularity', {
        desk: DESK, first, last: first + BLOCK - 1,
        token: `${BLOCK_PREFIX[group] || 'AN'}${start}-${start + BLOCK - 1}`,
        stray: stray.map(m => `ch ${m.ch}${m.name ? ` "${m.name}"` : ''} → ${m.patch.group} ${m.patch.input}`),
      }, { kind: 'block', first, last: first + BLOCK - 1 }));
    }
    tokens.push(`${BLOCK_PREFIX[group] || 'AN'}${start}-${start + BLOCK - 1}`);
  }

  // The aux inputs are really six, but the desk keeps the token AUX1-4 for
  // backward compatibility (X32 OSC protocol, /config/routing/IN).
  tokens.push('AUX1-4');
  return tokens;
}

export function emitX32Scene(ir, opts = {}) {
  const warnings = [...(ir.losses || [])];
  const include = Object.assign(
    { names: true, colors: true, patch: true, preamp: true, levels: true,
      eq: true, dynamics: true, sends: true, groups: true },
    opts.include || {}
  );

  // A source the X32 has no routing block for (a Wing's third AES50 port, its
  // USB audio, an internal bus) cannot be patched. Say so and leave the channel
  // unpatched, rather than letting it fall into a block of local inputs.
  const placed = allocate(ir, warnings, { desk: DESK, slots: MAX_CH }).map(p => {
    if (!p.c.patch || BLOCK_PREFIX[p.c.patch.group] || bySource(p.c.patch)) return p;
    if (include.patch) {
      warnings.push(loss('patch.group-unsupported',
        { label: `ch ${p.ch} "${p.c.name}"`, group: p.c.patch.group, desk: DESK },
        { kind: 'channel', n: p.ch, name: p.c.name }));
    }
    return { ...p, c: { ...p.c, patch: null } };
  });
  const lines = [];
  const preview = [];

  const sceneName = q(ir.name || 'Converted').slice(0, 12) || 'Converted';
  lines.push(`#4.0# "${sceneName}" "" %000000000 1`);

  if (include.colors) reportColourCollapse(warnings, placed, { desk: DESK, target: 'x32' });

  const chlink = Array(MAX_CH / 2).fill(false);
  const headamps = new Map();

  // Every slot the show does not reach still gets written, blank. A scene
  // file that only covers the channels it knows about leaves the REST of the
  // desk holding the last show — you load a converted scene and channels
  // 17-32 are still yesterday's band. The Wing snapshot is deliberately
  // partial and says so; a .scn is not.
  const used = new Set();
  for (const { ch, width } of placed) { used.add(ch); if (width === 2) used.add(ch + 1); }
  for (let n = 1; n <= MAX_CH; n++) {
    if (used.has(n)) continue;
    const id = pad2(n);
    lines.push(`/ch/${id}/config "" 1 OFF ${n}`);
    if (include.levels) lines.push(`/ch/${id}/mix ON ${lvl(-Infinity)} ON +0 OFF ${lvl(-Infinity)}`);
    if (include.groups) lines.push(`/ch/${id}/grp %00000000 %000000`);
  }

  for (const { c, ch, width } of placed) {
    if (width === 2) chlink[Math.ceil(ch / 2) - 1] = true;
    if (include.groups) reportLostMembership(warnings, c, ch, c.name || '', DESK, 8, 6);
    // A stereo channel that came from a natively-stereo desk carries a real
    // balance. One that came from a linked pair carries -100/+100, which is
    // an artefact of being the left strip, not a balance the engineer set —
    // the Scene's pairing says which one this is.
    const whole = { label: `ch ${ch} "${c.name}"`, n: ch, name: c.name };
    if (include.sends) reportLostBuses(warnings, c.sends, { desk: DESK, limit: 16 }, whole);

    reportBalanceLost(warnings, c, { desk: DESK }, { ...whole, label: `ch ${ch} "${c.name || ''}"` });

    for (let k = 0; k < width; k++) {
      const n = ch + k;
      const id = pad2(n);
      // A stereo source becomes two strips; the desk has no room for a shared
      // name, so the halves are suffixed the way an engineer would write them.
      // A name that already carries a side marker ("OH L", from a source that
      // was itself an X32 pair) loses it first, or the result reads "OH L L".
      // The marker has to be its own word — VOCAL must not become VOCA L.
      const name = stripName(c.name, { width, half: k, max: 12, names: include.names });
      const at = { label: `ch ${n} "${name}"`, n, name };
      const icon = include.names ? mapIcon(c.icon, 'x32') : 1;
      const color = include.colors ? mapColor(c.color, 'x32') : 'OFF';
      const via = bySource(c.patch);
      const source = via ? via.base + c.patch.input + k : n;
      lines.push(`/ch/${id}/config "${name}" ${icon} ${color} ${source}`);

      if (include.preamp) {
        const h = c.hpf;
        lines.push(`/ch/${id}/preamp ${sign1(c.trim || 0)} ${onOff(c.invert)} ${onOff(h.on)} ${Math.round(h.slope || 24)} ${dec(h.freq || 20, 1)}`);
      }

      if (include.levels) {
        const pan = width === 2 ? (k === 0 ? -100 : 100) : Math.round(c.pan || 0);
        lines.push(`/ch/${id}/mix ${onOff(!c.muted)} ${lvl(c.fader)} ${onOff(c.toMain !== false)} ${pan >= 0 ? '+' : ''}${pan} OFF ${lvl(-Infinity)}`);
      }

      if (include.dynamics) {
        const g = c.gate;
        lines.push(`/ch/${id}/gate ${onOff(g.on)} GATE ${dec(g.thr, 1)} ${dec(g.range, 1)} ${dec(g.att, 0)} ${dec(g.hold, 2)} ${dec(g.rel, 0)} 0`);
      }
      if (include.dynamics) {
        const d = c.dyn;
        const ratio = k === 0
          ? snapRatioReported(warnings, d.ratio, { desk: DESK, target: 'x32' }, at)
          : snapRatio(d.ratio, 'x32');
        lines.push(`/ch/${id}/dyn ${onOff(d.on)} COMP ${d.det === 'RMS' ? 'RMS' : 'PEAK'} ${d.env === 'LIN' ? 'LIN' : 'LOG'} ${dec(d.thr, 1)} ${ratioToken(ratio.value)} ${dec(d.knee, 0)} ${dec(d.gain, 2)} ${dec(d.att, 0)} ${dec(d.hold, 2)} ${dec(d.rel, 0)} ${d.pos === 'PRE' ? 'PRE' : 'POST'} 0 ${dec(d.mix, 0)} OFF`);
      }

      if (include.eq) {
        lines.push(`/ch/${id}/eq ${onOff(c.eq.on !== false)}`);
        const bands = k === 0
          ? fitBandsReported(warnings, c.eq.bands, { desk: DESK, limit: MAX_EQ_BANDS }, at)
          : fitBands(c.eq.bands, MAX_EQ_BANDS);
        // Every band is written. One left out keeps whatever that band held on
        // the desk before, so a source with fewer bands pads out flat.
        for (let i = 0; i < MAX_EQ_BANDS; i++) {
          const b = bands[i] || FLAT_BANDS[i];
          lines.push(`/ch/${id}/eq/${i + 1} ${EQ_TOKEN[b.type] || 'PEQ'} ${dec(b.f, 1)} ${sign2(b.g)} ${dec(b.q, 1)}`);
        }
      }

      if (include.sends) {
        for (const s of c.sends) {
          if (s.bus < 1 || s.bus > 16) continue;
          // Odd buses carry on, level, pan, tap and pan-follow; an even bus
          // carries on and level only, and shares its odd partner's tap.
          lines.push(s.bus % 2 === 1
            ? `/ch/${id}/mix/${pad2(s.bus)} ${onOff(s.on)} ${lvl(s.level)} ${(s.pan || 0) >= 0 ? '+' : ''}${Math.round(s.pan || 0)} ${tapTo('x32', s.tap).token} 0`
            : `/ch/${id}/mix/${pad2(s.bus)} ${onOff(s.on)} ${lvl(s.level)}`);
        }
      }

      if (include.groups) {
        lines.push(`/ch/${id}/grp ${mask(c.dcas, 8)} ${mask(c.muteGroups, 6)}`);
      }

      if (include.preamp && c.patch && c.headamp) {
        const base2 = HEADAMP_BASE[c.patch.group];
        if (base2 !== undefined) {
          const idx = base2 + (c.patch.input + k) - 1;
          if (idx >= 0 && idx < 128) headamps.set(idx, c.headamp);
        }
      }
    }

    preview.push({
      n: ch, name: c.name, colorHex: c.color?.hex || null,
      outColorHex: codeToHex('x32', mapColor(c.color, 'x32')),
      source: `ch ${c.srcChannels.join('+')}`, stereo: !!c.stereo,
      patch: c.patch ? `${BLOCK_PREFIX[c.patch.group] || bySource(c.patch)?.label || '?'}${c.patch.input}` : '—',
      groups: [...c.dcas.map(n2 => `#D${n2}`), ...c.muteGroups.map(n2 => `#M${n2}`)].join('') || '—',
      span: c.stereo ? `${ch}+${ch + 1}` : String(ch),
    });
  }

  if (include.patch) lines.push(`/config/routing/IN ${routingBlocks(placed, warnings).join(' ')}`);
  if (include.groups || include.levels) lines.push(`/config/chlink ${chlink.map(onOff).join(' ')}`);

  if (include.preamp) {
    for (const idx of [...headamps.keys()].sort((a, b) => a - b)) {
      const h = headamps.get(idx);
      lines.push(`/headamp/${String(idx).padStart(3, '0')} ${sign1(h.gain || 0)} ${onOff(h.phantom)}`);
    }
  }

  if (include.names) {
    (ir.buses || []).forEach(b => {
      if (b.n < 1 || b.n > 16 || !b.name) return;
      lines.push(`/bus/${pad2(b.n)}/config "${q(b.name).slice(0, 12)}" ${mapIcon(b.icon, 'x32')} ${mapColor(b.color, 'x32')}`);
      lines.push(`/bus/${pad2(b.n)}/mix ${onOff(!b.muted)} ${lvl(b.fader)} ON +0 OFF ${lvl(-Infinity)}`);
    });
    const mtx = (ir.matrices || []).filter(m => m.name);
    if (mtx.length > MAX_MATRIX) warnings.push(loss('matrix.overflow', { count: mtx.length, desk: DESK, limit: MAX_MATRIX }));
    mtx.slice(0, MAX_MATRIX).forEach(m => {
      lines.push(`/mtx/${pad2(m.n)}/config "${q(m.name).slice(0, 12)}" ${mapIcon(m.icon, 'x32')} ${mapColor(m.color, 'x32')}`);
      lines.push(`/mtx/${pad2(m.n)}/mix ${onOff(!m.muted)} ${lvl(m.fader)}`);
    });
  }

  if (include.groups) {
    const dcas = (ir.dcas || []).filter(d => d.n >= 1 && d.n <= 8);
    if ((ir.dcas || []).length > 8) warnings.push(loss('dca.overflow', { count: ir.dcas.length, desk: DESK, limit: 8 }));
    dcas.forEach(d => {
      lines.push(`/dca/${d.n} ${onOff(!d.muted)} ${lvl(d.fader)}`);
      lines.push(`/dca/${d.n}/config "${q(d.name).slice(0, 12)}" ${mapIcon(d.icon, 'x32')} ${mapColor(d.color, 'x32')}`);
    });
  }

  return {
    text: lines.join('\n') + '\n',
    warnings: renderAll(warnings),
    losses: warnings,
    preview,
    stats: {
      channels: placed.reduce((n, p) => n + p.width, 0),
      stereoPairs: placed.filter(p => p.width === 2).length,
    },
  };
}
