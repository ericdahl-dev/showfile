// ─── Behringer X Air / Midas MR scene emitter ──────────────────────────────
// Turns the console-independent IR into an X AIR Edit .scn scene.
//
// The X Air is the smallest desk in the lexicon, so this is the writer that
// loses the most, and every limit is reported rather than quietly applied:
// 16 channels, 6 buses, 4 DCAs, 4 mute groups, 4 EQ bands, no matrices.
//
// Two things make it easier than the X32 to write:
//
//   * Input patch is per channel ("In10" on channel 9), so there is no block
//     of eight to negotiate and a scattered patch survives intact.
//   * The colour is the palette index of the same eight colours the X32 uses,
//     so x32 <-> xair colour is lossless.
//
// And one that makes it harder: a scene is only loadable if the whole node
// set is present. X AIR Edit will not take a partial file the way the Wing
// accepts a partial snapshot, so every node a real scene contains is written
// here, with the desk's own defaults where the IR has nothing to say.

import { mapColor, codeToHex } from './console-map.js';
import { loss, renderAll, reportLostMembership } from './losses.js';

const DESK = 'X Air';
const MAX_CH = 16;
const MAX_EQ_BANDS = 4;
const BUSES = 6;
const FX_SENDS = 4;
const DCAS = 4;
const MUTE_GROUPS = 4;

// Neutral band types -> the X Air's own tokens.
const EQ_TOKEN = { lowcut: 'LCut', lowshelf: 'LShv', bell: 'PEQ', highshelf: 'HShv', highcut: 'HCut' };

// Neutral groups -> the X Air's source tokens. It has local XLRs and USB and
// nothing else — no AES50, no expansion card.
const SRC = { local: 'In', card: 'U', aux: 'In' };

const q = (s) => String(s ?? '').replace(/"/g, '');
const pad2 = (n) => String(n).padStart(2, '0');
const onOff = (b) => (b ? 'ON' : 'OFF');
const dec = (v, p = 1) => (Number(v) || 0).toFixed(p);
const sign2 = (v) => ((Number(v) || 0) >= 0 ? '+' : '') + (Number(v) || 0).toFixed(2);
const sign1 = (v) => ((Number(v) || 0) >= 0 ? '+' : '') + (Number(v) || 0).toFixed(1);
const panTok = (v) => ((Math.round(v) || 0) >= 0 ? '+' : '') + Math.round(v || 0);

// The X Air right-aligns level fields to five columns and writes -oo for
// silence, which is why these carry their own padding.
function lvl(v) {
  if (v === -Infinity || v === null || v === undefined) return '  -oo';
  const s = (Number(v) >= 0 ? '' : '') + Number(v).toFixed(1);
  return s.padStart(5, ' ');
}

// Membership mask, least-significant-bit first: group 1 is the rightmost.
function mask(members, width) {
  const bits = Array(width).fill('0');
  for (const n of members || []) if (n >= 1 && n <= width) bits[n - 1] = '1';
  return '%' + bits.reverse().join('');
}

// Lay the IR out on 16 mono slots. Like the X32, a stereo channel takes an
// odd-aligned pair and one landing on an even slot leaves a gap rather than
// renumbering everything after it.
function allocate(ir, losses) {
  const placed = [];
  const gaps = [];
  let slot = 1;

  for (const c of ir.channels) {
    if (c.stereo && slot % 2 === 0) { gaps.push(slot); slot += 1; }
    const width = c.stereo ? 2 : 1;
    if (slot + width - 1 > MAX_CH) {
      losses.push(loss('channel.overflow-from',
        { name: c.name || 'ch ' + c.index, desk: DESK, limit: MAX_CH },
        { kind: 'channel', n: c.index, name: c.name }));
      break;
    }
    placed.push({ c, ch: slot, width });
    slot += width;
  }

  if (gaps.length) losses.push(loss('stereo.pair-alignment', { desk: DESK, gaps }));
  const dropped = ir.channels.length - placed.length;
  if (dropped > 0 && !losses.some(l => l.code === 'channel.overflow-from')) {
    losses.push(loss('channel.overflow-count', { count: dropped, desk: DESK, limit: MAX_CH }));
  }
  return placed;
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

export function emitXAirScene(ir, opts = {}) {
  const losses = [];
  const carried = (ir.warnings || []);            // reader warnings, already strings
  const include = Object.assign(
    { names: true, colors: true, patch: true, preamp: true, levels: true,
      eq: true, dynamics: true, sends: true, groups: true },
    opts.include || {}
  );

  const placed = allocate(ir, losses);
  const byCh = new Map(placed.map(p => [p.ch, p]));
  const lines = [];
  const preview = [];

  if ((ir.matrices || []).filter(m => m.name).length) {
    losses.push(loss('matrix.overflow', { count: ir.matrices.filter(m => m.name).length, desk: DESK, limit: 0 }));
  }
  if ((ir.dcas || []).length > DCAS) {
    losses.push(loss('dca.overflow', { count: ir.dcas.length, desk: DESK, limit: DCAS }));
  }

  // 18 Wing colours collapse onto 8 here exactly as they do on an X32.
  if (include.colors) {
    const seen = new Map();
    for (const { c } of placed) {
      if (c.color?.code === null || c.color?.code === undefined) continue;
      const to = mapColor(c.color, 'xair');
      if (!seen.has(to)) seen.set(to, new Set());
      seen.get(to).add(String(c.color.code));
    }
    const collapsed = [...seen.values()].filter(s => s.size > 1).length;
    if (collapsed) losses.push(loss('color.palette-collapse', { desk: DESK, to: 8, from: 18, count: collapsed }));
  }

  // ── /config ──────────────────────────────────────────────────────────────
  const chlink = Array(MAX_CH / 2).fill(false);
  for (const { ch, width } of placed) if (width === 2) chlink[Math.ceil(ch / 2) - 1] = true;
  lines.push(`/config/chlink ${chlink.map(onOff).join(' ')}`);
  lines.push('/config/buslink OFF OFF OFF');
  lines.push('/config/linkcfg ON ON ON ON');
  lines.push('/config/solo   0.0 LRAFL 0.0 PFL PFL -20 OFF OFF OFF OFF');
  lines.push('/config/amixenable OFF OFF');
  lines.push('/config/amixlock OFF OFF');
  lines.push(`/config/mute ${Array(MUTE_GROUPS).fill('OFF').join(' ')}`);

  // ── /ch ──────────────────────────────────────────────────────────────────
  const headamps = new Map();

  for (let n = 1; n <= MAX_CH; n++) {
    const id = pad2(n);
    const hit = byCh.get(n) || [...byCh.values()].find(p => p.width === 2 && p.ch + 1 === n);
    const c = hit?.c;
    const half = hit && hit.ch !== n ? 1 : 0;            // right half of a pair
    const width = hit?.width || 1;

    if (!c) {
      // A slot the show does not reach still needs its nodes, or the file
      // will not load.
      lines.push(`/ch/${id}/config "" 0 In${id} U${id}`);
      lines.push(`/ch/${id}/preamp +0.0 OFF OFF OFF  20`);
      pushChannelTail(lines, id, null, null, null, [], 0, 0);
      continue;
    }

    // A stereo source becomes two strips; the desk has no shared name, so the
    // halves are suffixed the way an engineer would write them, and a name
    // that already carries a side marker loses it first ("OH L" must not
    // become "OH L L"). The marker has to be its own word.
    const base = include.names ? q(c.name).trim().slice(0, 12).trim() : '';
    const stem = base.replace(/\s+[LR]$/i, '').trim();
    const name = width === 2 ? stem.slice(0, 10).trim() + (half === 0 ? ' L' : ' R') : base;
    const color = include.colors ? mapColor(c.color, 'xair') : 0;

    // Per-channel patch — the whole reason this writer is simpler than the
    // X32's. A scattered patch needs no warning because it survives.
    let src = `In${id}`;
    if (include.patch && c.patch) {
      const prefix = SRC[c.patch.group];
      if (!prefix) {
        losses.push(loss('patch.group-unsupported',
          { label: `ch ${n} "${name}"`, group: c.patch.group, desk: DESK },
          { kind: 'channel', n, name }));
      } else {
        const port = Math.min(c.patch.input + half, prefix === 'In' ? MAX_CH : 18);
        if (c.patch.input + half > MAX_CH && prefix === 'In') {
          losses.push(loss('patch.input-overflow',
            { label: `ch ${n} "${name}"`, input: c.patch.input + half, desk: DESK, limit: MAX_CH },
            { kind: 'channel', n, name }));
        }
        src = `${prefix}${pad2(port)}`;
        if (prefix === 'In' && include.preamp && c.headamp) headamps.set(port, c.headamp);
      }
    }

    if (half === 0 && include.groups) {
      reportLostMembership(losses, c, n, name, DESK, DCAS, MUTE_GROUPS);
    }

    lines.push(`/ch/${id}/config "${name}" ${color} ${src} U${id}`);

    const h = c.hpf;
    // The frequency is written whether or not the filter is engaged. Zeroing
    // it on bypass loses a setting the engineer dialled in and expects to find
    // when they switch the filter back on.
    lines.push(`/ch/${id}/preamp ${sign1(include.preamp ? c.trim || 0 : 0)} OFF ${onOff(include.preamp && c.invert)} ${onOff(include.preamp && h.on)}  ${Math.round(h.freq || 20)}`);


    // A stereo channel that came from a natively-stereo desk carries a real
    // balance. One that came from a linked pair carries -100/+100, which is
    // an artefact of being the left strip, not a balance the engineer set —
    // the Scene's pairing says which one this is.
    // Sends past the X Air's six buses cannot be written. Only sends with a
    // level are reported; a send at -oo carries nothing.
    const lostBuses = half === 0 && include.sends
      ? c.sends.filter(s => (s.bus < 1 || s.bus > BUSES) && s.level > -Infinity).map(s => s.bus)
      : [];
    if (lostBuses.length) {
      losses.push(loss('send.bus-overflow',
        { label: `ch ${n} "${name}"`, buses: lostBuses, desk: DESK, limit: BUSES },
        { kind: 'channel', n, name }));
    }

    if (half === 0 && c.pairing === 'native' && Math.round(c.pan) !== 0) {
      losses.push(loss('stereo.balance-lost',
        { label: `ch ${n} "${name}"`, balance: Math.round(c.pan), desk: DESK },
        { kind: 'channel', n: n, name: name }));
    }
    const pan = width === 2 ? (half === 0 ? -100 : 100) : Math.round(c.pan || 0);
    pushChannelTail(lines, id,
      include.dynamics ? c.gate : null,
      include.dynamics ? c.dyn : null,
      include.eq ? c.eq : null,
      include.sends ? c.sends : [],
      include.groups ? c.dcas : [],
      include.groups ? c.muteGroups : [],
      include.levels ? { muted: c.muted, fader: c.fader, toMain: c.toMain, pan } : null);

    if (include.eq && fitBands(c.eq.bands, MAX_EQ_BANDS).length < c.eq.bands.length && half === 0) {
      losses.push(loss('eq.band-overflow',
        { label: `ch ${n} "${name}"`, count: c.eq.bands.length, desk: DESK, limit: MAX_EQ_BANDS },
        { kind: 'channel', n, name }));
    }

    if (half === 0) {
      preview.push({
        n, span: width === 2 ? `${n}+${n + 1}` : String(n),
        name, colorHex: c.color?.hex || null,
        outColorHex: codeToHex('xair', mapColor(c.color, 'xair')),
        source: `ch ${c.srcChannels.join('+')}`, stereo: width === 2,
        patch: src,
        groups: [...c.dcas.map(d => `#D${d}`), ...c.muteGroups.map(m => `#M${m}`)].join('') || '—',
      });
    }
  }

  // ── /rtn, /bus, /fxsend, /lr, /dca, /fx, /routing, /headamp ──────────────
  for (const [tag, usb] of [['aux', 'U1718'], ['1', 'U0102'], ['2', 'U0304'], ['3', 'U0506'], ['4', 'U0708']]) {
    lines.push(`/rtn/${tag}/config "" ${tag === 'aux' ? 1 : 2} ${usb}`);
    lines.push(`/rtn/${tag}/preamp +0.0 OFF`);
    pushEq4(lines, `/rtn/${tag}`);
    lines.push(`/rtn/${tag}/mix ON   ${tag === 'aux' ? '-oo' : '0.0'} ON +0`);
    for (let b = 1; b <= BUSES + FX_SENDS; b++) {
      lines.push(`/rtn/${tag}/mix/${pad2(b)}   -oo OFF POST${b <= BUSES && b % 2 === 1 ? ' +0' : ''}`);
    }
    lines.push(`/rtn/${tag}/grp %0000 %0000`);
  }

  const buses = ir.buses || [];
  for (let b = 1; b <= BUSES; b++) {
    const bus = buses.find(x => x.n === b);
    lines.push(`/bus/${b}/config "${include.names ? q(bus?.name || '').slice(0, 12) : ''}" ${bus && include.colors ? mapColor(bus.color, 'xair') : 3}`);
    lines.push(`/bus/${b}/dyn OFF COMP PEAK LOG 0.0 3.0 1 0.00 10 10.0 151 100 SELF OFF`);
    lines.push(`/bus/${b}/dyn/filter OFF 3.0 990.9`);
    lines.push(`/bus/${b}/insert OFF OFF`);
    pushEq6(lines, `/bus/${b}`);
    lines.push(`/bus/${b}/geq ${Array(31).fill('0.0').join(' ')}`);
    lines.push(`/bus/${b}/mix ${onOff(!(bus?.muted))} ${lvl(bus ? bus.fader : 0)} OFF +0`);
    lines.push(`/bus/${b}/grp %0000 %0000`);
  }

  for (let f = 1; f <= FX_SENDS; f++) {
    lines.push(`/fxsend/${f}/config "" 4`);
    lines.push(`/fxsend/${f}/mix ON   0.0`);
    lines.push(`/fxsend/${f}/grp %0000 %0000`);
  }

  lines.push('/lr/config "" 6');
  lines.push('/lr/dyn OFF COMP PEAK LOG 0.0 3.0 1 0.00 10 10.0 151 100 OFF');
  lines.push('/lr/dyn/filter OFF 3.0 990.9');
  lines.push('/lr/insert OFF OFF');
  pushEq6(lines, '/lr');
  lines.push(`/lr/geq ${Array(31).fill('0.0').join(' ')}`);
  lines.push('/lr/mix ON   -oo +0');

  for (let d = 1; d <= DCAS; d++) {
    const dca = (ir.dcas || []).find(x => x.n === d);
    lines.push(`/dca/${d} ${onOff(!(dca?.muted))} ${lvl(dca ? dca.fader : 0)}`);
    lines.push(`/dca/${d}/config "${include.names ? q(dca?.name || '').slice(0, 12) : ''}" ${dca && include.colors ? mapColor(dca.color, 'xair') : 8}`);
  }

  for (const [n, name, par] of [[1, 'VRM', '20 1.94 24 30 22 0.0 1.10 0.69 97 10k4 28 34 OFF'],
                                 [2, 'HALL', '20 1.57 60 5k74 25 0.0 83 7k2 0.95 25 50 30'],
                                 [3, 'MODD', '300 1 30.0 97 9k5 20 1.08 SER CLUB 5.0 5k6 +0 100'],
                                 [4, 'DIMC', 'ON ST OFF ON OFF ON OFF']]) {
    lines.push(`/fx/${n} ${name} OFF`);
    const pad = par.split(' ').length;
    lines.push(`/fx/${n}/par ${par} ${Array(Math.max(0, 64 - pad)).fill('0').join(' ')}`.trimEnd());
  }

  lines.push('/routing/main/01 LR');
  lines.push('/routing/main/02 MON');
  for (let b = 1; b <= BUSES; b++) lines.push(`/routing/aux/${pad2(b)} Bus${b} POST`);
  for (let n = 1; n <= MAX_CH; n++) lines.push(`/routing/p16/${pad2(n)} Ch${pad2(n)} IN+M`);
  for (let n = 1; n <= 18; n++) lines.push(`/routing/usb/${pad2(n)} Ch${pad2(n)} AIN`);

  for (let i = 1; i <= 24; i++) {
    const ha = headamps.get(i);
    lines.push(`/headamp/${pad2(i)} ${sign1(ha ? ha.gain : 0)} ${onOff(ha ? ha.phantom : false)}`);
  }

  return {
    text: lines.join('\n') + '\n',
    warnings: [...carried, ...renderAll(losses)],
    losses,
    preview,
    stats: {
      channels: placed.reduce((n, p) => n + p.width, 0),
      stereoPairs: placed.filter(p => p.width === 2).length,
    },
  };

  // ── node-set helpers ───────────────────────────────────────────────────
  function pushEq4(out, prefix) {
    out.push(`${prefix}/eq ON`);
    out.push(`${prefix}/eq/1 PEQ 124.7 +0.00 2.0`);
    out.push(`${prefix}/eq/2 PEQ 496.6 +0.00 2.0`);
    out.push(`${prefix}/eq/3 PEQ 1k97 +0.00 2.0`);
    out.push(`${prefix}/eq/4 HShv 10k02 +0.00 2.0`);
  }
  function pushEq6(out, prefix) {
    out.push(`${prefix}/eq ON PEQ`);
    out.push(`${prefix}/eq/1 LShv 124.7 +0.00 2.0`);
    out.push(`${prefix}/eq/2 PEQ 496.6 +0.00 2.0`);
    out.push(`${prefix}/eq/3 PEQ 1k97 +0.00 2.0`);
    out.push(`${prefix}/eq/4 PEQ 10k02 +0.00 2.0`);
    out.push(`${prefix}/eq/5 PEQ 20.0 +0.00 2.0`);
    out.push(`${prefix}/eq/6 HShv 20.0 +0.00 2.0`);
  }
  function pushChannelTail(out, id, gate, dyn, eq, sends, dcas, mgs, mix) {
    out.push(gate
      ? `/ch/${id}/gate ${onOff(gate.on)} GATE ${dec(gate.thr, 1)} ${dec(gate.range, 1)} ${Math.round(gate.att || 1)} ${dec(gate.hold, 1)} ${Math.round(gate.rel || 983)} SELF`
      : `/ch/${id}/gate OFF GATE -80.0 60.0 1  502 983 SELF`);
    out.push(`/ch/${id}/gate/filter OFF 3.0 990.9`);
    out.push(dyn
      ? `/ch/${id}/dyn ${onOff(dyn.on)} COMP ${dyn.det === 'RMS' ? 'RMS' : 'PEAK'} ${dyn.env === 'LIN' ? 'LIN' : 'LOG'} ${dec(dyn.thr, 1)} ${dec(dyn.ratio, 1)} ${Math.round(dyn.knee || 1)} ${dec(dyn.gain, 2)} ${Math.round(dyn.att || 10)} ${dec(dyn.hold, 1)} ${Math.round(dyn.rel || 151)} ${Math.round(dyn.mix ?? 100)} SELF OFF`
      : `/ch/${id}/dyn OFF COMP PEAK LOG 0.0 3.0 1 0.00 10 10.0 151 100 SELF OFF`);
    out.push(`/ch/${id}/dyn/filter OFF 3.0 990.9`);
    out.push(`/ch/${id}/insert OFF OFF`);

    if (eq && (eq.bands || []).length) {
      out.push(`/ch/${id}/eq ${onOff(eq.on !== false)}`);
      const bands = fitBands(eq.bands, MAX_EQ_BANDS);
      const DEF = ['PEQ 124.7 +0.00 2.0', 'PEQ 496.6 +0.00 2.0', 'PEQ 1k97 +0.00 2.0', 'HShv 10k02 +0.00 2.0'];
      for (let i = 0; i < MAX_EQ_BANDS; i++) {
        const b = bands[i];
        out.push(`/ch/${id}/eq/${i + 1} ${b ? `${EQ_TOKEN[b.type] || 'PEQ'} ${dec(b.f, 1)} ${sign2(b.g)} ${dec(b.q, 1)}` : DEF[i]}`);
      }
    } else {
      pushEq4(out, `/ch/${id}`);
    }

    out.push(mix
      ? `/ch/${id}/mix ${onOff(!mix.muted)} ${lvl(mix.fader)} ${onOff(mix.toMain !== false)} ${panTok(mix.pan)}`
      : `/ch/${id}/mix ON   -oo ON +0`);

    const byBus = new Map((sends || []).map(s => [s.bus, s]));
    for (let b = 1; b <= BUSES + FX_SENDS; b++) {
      const s = b <= BUSES ? byBus.get(b) : null;
      const tap = b > BUSES ? 'POST' : (s && String(s.tap).toUpperCase() === 'POST' ? 'POST' : 'POSTEQ');
      const trailingPan = b <= BUSES && b % 2 === 1 ? ' +0' : '';
      out.push(`/ch/${id}/mix/${pad2(b)} ${s ? lvl(s.level) : '  -oo'} ${onOff(!!s?.on)} ${tap}${trailingPan}`);
    }

    out.push(`/ch/${id}/grp ${mask(dcas, DCAS)} ${mask(mgs, MUTE_GROUPS)}`);
    out.push(`/ch/${id}/automix OFF  +0.0`);
  }
}
