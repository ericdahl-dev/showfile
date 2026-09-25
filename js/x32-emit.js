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

import { mapColor, mapIcon, codeToHex } from './console-map.js';
import { loss, renderAll, reportLostMembership } from './losses.js';

const DESK = 'X32';
const MAX_CH = 32;
const MAX_EQ_BANDS = 4;
const MAX_MATRIX = 6;
const BLOCK = 8;

// Neutral band types -> the X32's own tokens.
const EQ_TOKEN = {
  lowcut: 'LCut', lowshelf: 'LShv', bell: 'PEQ',
  highshelf: 'HShv', highcut: 'HCut',
};

// The X32's own flat channel EQ, used for any band the source did not carry.
const FLAT_BANDS = [
  { type: 'bell',      f: 124.7, g: 0, q: 2 },
  { type: 'bell',      f: 496.6, g: 0, q: 2 },
  { type: 'bell',      f: 1970,  g: 0, q: 2 },
  { type: 'highshelf', f: 10020, g: 0, q: 2 },
];

// Neutral groups -> X32 routing-block prefixes. Groups with no preamp behind
// them (card, user, aux) still patch; they just have no /headamp node.
const BLOCK_PREFIX = { local: 'AN', aes50a: 'A', aes50b: 'B', card: 'CARD', user: 'UIN', aux: 'AUX' };
const HEADAMP_BASE = { local: 0, aes50a: 32, aes50b: 80 };

const q = (s) => String(s ?? '').replace(/"/g, '');
const pad2 = (n) => String(n).padStart(2, '0');

// The X32 writes signed one-decimal values and uses "-oo" for silence.
function lvl(v) {
  if (v === -Infinity || v === null || v === undefined) return '-oo';
  return (v >= 0 ? '+' : '') + Number(v).toFixed(1);
}
const dec = (v, p = 1) => (Number(v) || 0).toFixed(p);
const sign = (v) => ((Number(v) || 0) >= 0 ? '+' : '') + (Number(v) || 0).toFixed(2);
// Trim and headamp gain are written with one decimal; EQ and comp gain with two.
const sign1 = (v) => ((Number(v) || 0) >= 0 ? '+' : '') + (Number(v) || 0).toFixed(1);
const onOff = (b) => (b ? 'ON' : 'OFF');

// Least-significant-bit-first membership mask: group 1 is the RIGHTMOST char.
function mask(members, width) {
  const bits = Array(width).fill('0');
  for (const n of members || []) if (n >= 1 && n <= width) bits[n - 1] = '1';
  return '%' + bits.reverse().join('');
}

// Lay the IR's channels out on the X32's 32 mono slots. Stereo takes an
// odd-aligned pair; a stereo channel that would land on an even slot leaves the
// slot empty rather than reordering the show.
function allocate(ir, warnings) {
  const placed = [];
  const gaps = [];
  let slot = 1;

  for (const c of ir.channels) {
    if (c.stereo && slot % 2 === 0) {
      gaps.push(slot);
      slot += 1;                                   // step to the next odd slot
    }
    const width = c.stereo ? 2 : 1;
    if (slot + width - 1 > MAX_CH) {
      warnings.push(loss('channel.overflow-from',
        { name: c.name || 'ch ' + c.index, desk: DESK, limit: MAX_CH },
        { kind: 'channel', n: c.index, name: c.name }));
      break;
    }
    placed.push({ c, ch: slot, width });
    slot += width;
  }

  if (gaps.length) {
    warnings.push(loss('stereo.pair-alignment', { desk: DESK, gaps }));
  }
  const dropped = ir.channels.length - placed.length;
  if (dropped > 0 && !warnings.some(w => w.code === 'channel.overflow-from')) {
    warnings.push(loss('channel.overflow-count', { count: dropped, desk: DESK, limit: MAX_CH }));
  }
  return placed;
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
      if (p?.c.patch?.group) members.push({ offset: i, ch: first + i, patch: p.c.patch, name: p.c.name });
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

// When a source has more EQ bands than the target has slots, the ones doing
// nothing go first. A 0 dB band is audibly absent, so keeping it while
// discarding a real cut would throw away the only part that mattered — and
// flat bands are common now that the Wing writer fills all six slots so a
// converted channel cannot inherit the last show's curve.
function fitBands(bands, limit) {
  if (bands.length <= limit) return bands;
  // A cut does its work at 0 dB, so it counts as active whatever its gain, and
  // it is kept before any bell or shelf: losing a rolloff changes a channel
  // more than losing a boost. Low cut goes first, high cut last, as on a desk.
  const lowCuts = bands.filter(b => b.type === 'lowcut');
  const highCuts = bands.filter(b => b.type === 'highcut');
  const shaped = bands.filter(b => b.type !== 'lowcut' && b.type !== 'highcut' && Number(b.g) !== 0);
  const room = Math.max(0, limit - lowCuts.length - highCuts.length);
  return [...lowCuts, ...shaped.slice(0, room), ...highCuts].slice(0, limit);
}

export function emitX32Scene(ir, opts = {}) {
  const warnings = [...(ir.warnings || [])];
  const include = Object.assign(
    { names: true, colors: true, patch: true, preamp: true, levels: true,
      eq: true, dynamics: true, sends: true, groups: true },
    opts.include || {}
  );

  // A source the X32 has no routing block for (a Wing's third AES50 port, its
  // USB audio, an internal bus) cannot be patched. Say so and leave the channel
  // unpatched, rather than letting it fall into a block of local inputs.
  const placed = allocate(ir, warnings).map(p => {
    if (!p.c.patch || BLOCK_PREFIX[p.c.patch.group]) return p;
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

  // Colour loss is real on the way down: 18 Wing colours collapse onto 8.
  if (include.colors) {
    const seen = new Map();
    for (const { c } of placed) {
      const to = mapColor(c.color, 'x32');
      const from = c.color?.code;
      if (from === null || from === undefined) continue;
      if (!seen.has(to)) seen.set(to, new Set());
      seen.get(to).add(String(from));
    }
    const collapsed = [...seen.values()].filter(s => s.size > 1).length;
    if (collapsed) warnings.push(loss('color.palette-collapse', { desk: DESK, to: 8, from: 18, count: collapsed }));
  }

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
    // A send to a bus the X32 lacks cannot be written. One at -oo carries
    // nothing, and a real scene holds sixteen of those per channel, so only
    // sends with a level are worth a line in the report.
    const lostBuses = include.sends
      ? c.sends.filter(s => (s.bus < 1 || s.bus > 16) && s.level > -Infinity).map(s => s.bus)
      : [];
    if (lostBuses.length) {
      warnings.push(loss('send.bus-overflow',
        { label: `ch ${ch} "${c.name}"`, buses: lostBuses, desk: DESK, limit: 16 },
        { kind: 'channel', n: ch, name: c.name }));
    }

    if (c.pairing === 'native' && Math.round(c.pan) !== 0) {
      warnings.push(loss('stereo.balance-lost',
        { label: `ch ${ch} "${c.name || ""}"`, balance: Math.round(c.pan), desk: DESK },
        { kind: 'channel', n: ch, name: c.name }));
    }


    for (let k = 0; k < width; k++) {
      const n = ch + k;
      const id = pad2(n);
      // A stereo source becomes two strips; the desk has no room for a shared
      // name, so the halves are suffixed the way an engineer would write them.
      // A name that already carries a side marker ("OH L", from a source that
      // was itself an X32 pair) loses it first, or the result reads "OH L L".
      // The marker has to be its own word — VOCAL must not become VOCA L.
      const base = include.names ? q(c.name).trim().slice(0, 12).trim() : '';
      const stem = base.replace(/\s+[LR]$/i, '').trim();
      const name = width === 2 ? stem.slice(0, 10).trim() + (k === 0 ? ' L' : ' R') : base;
      const icon = include.names ? mapIcon(c.icon, 'x32') : 1;
      const color = include.colors ? mapColor(c.color, 'x32') : 'OFF';
      lines.push(`/ch/${id}/config "${name}" ${icon} ${color} ${n}`);

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
        lines.push(`/ch/${id}/dyn ${onOff(d.on)} COMP ${d.det === 'RMS' ? 'RMS' : 'PEAK'} ${d.env === 'LIN' ? 'LIN' : 'LOG'} ${dec(d.thr, 1)} ${dec(d.ratio, 1)} ${dec(d.knee, 0)} ${dec(d.gain, 2)} ${dec(d.att, 0)} ${dec(d.hold, 2)} ${dec(d.rel, 0)} ${d.pos === 'PRE' ? 'PRE' : 'POST'} 0 ${dec(d.mix, 0)} OFF`);
      }

      if (include.eq) {
        lines.push(`/ch/${id}/eq ${onOff(c.eq.on !== false)}`);
        const bands = fitBands(c.eq.bands, MAX_EQ_BANDS);
        if (bands.length < c.eq.bands.length && k === 0) {
          warnings.push(loss('eq.band-overflow',
            { label: `ch ${n} "${name}"`, count: c.eq.bands.length, desk: DESK, limit: MAX_EQ_BANDS },
            { kind: 'channel', n, name }));
        }
        // Every band is written. One left out keeps whatever that band held on
        // the desk before, so a source with fewer bands pads out flat.
        for (let i = 0; i < MAX_EQ_BANDS; i++) {
          const b = bands[i] || FLAT_BANDS[i];
          lines.push(`/ch/${id}/eq/${i + 1} ${EQ_TOKEN[b.type] || 'PEQ'} ${dec(b.f, 1)} ${sign(b.g)} ${dec(b.q, 1)}`);
        }
      }

      if (include.sends) {
        for (const s of c.sends) {
          if (s.bus < 1 || s.bus > 16) continue;
          lines.push(`/ch/${id}/mix/${pad2(s.bus)} ${onOff(s.on)} ${lvl(s.level)} ${(s.pan || 0) >= 0 ? '+' : ''}${Math.round(s.pan || 0)} ${s.tap === 'POST' ? 'POST' : 'PRE'} 0`);
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
      patch: c.patch ? `${BLOCK_PREFIX[c.patch.group] || '?'}${c.patch.input}` : '—',
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
    losses: warnings.filter(w => typeof w !== 'string'),
    preview,
    stats: {
      channels: placed.reduce((n, p) => n + p.width, 0),
      stereoPairs: placed.filter(p => p.width === 2).length,
    },
  };
}
