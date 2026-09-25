// ─── Wing snapshot emitter ─────────────────────────────────────────────────
// Turns the console-independent IR into a partial Wing snapshot (.snap). The
// Wing merges partial snapshots, so we deliberately write only what the source
// console actually specified rather than a full 28,000-key console state.
//
// Key names and value encodings were derived by diffing snapshots saved from
// WING-EDIT: an initialised baseline against files with known values set.

import { mapColor, mapIcon, codeToHex, snapRatio, tapTo } from './console-map.js';
import { loss, renderAll } from './losses.js';

const NEG_INF = -144;                 // the Wing's -oo sentinel
const DESK = 'Wing';
const MAX_CH = 40;
const LCL_INPUTS = 24;                // local inputs present in the snapshot

const dB = (v) => (v === -Infinity || v === null || v === undefined ? NEG_INF : round(v));
const round = (v) => Math.round(v * 1e4) / 1e4;

// X32 EQ bands each choose their own type; the Wing has six bands where only
// the outer two switch between shelf and bell. So bands route by type rather
// than by position: shelves and cuts claim the dedicated low/high bands, and
// everything else fills the four parametric mids in order.
// Wing parameter ranges (WING protocol document). Values from a wider desk are
// pulled in; the ones an engineer would notice are reported.
const RANGE = { dynGain: [-6, 12], lclGain: [-3, 45.5], eqQ: [0.44, 10] };
const clampTo = (v, [lo, hi]) => Math.min(Math.max(Number(v) || 0, lo), hi);
const eqQ = (q) => round(clampTo(q, RANGE.eqQ));

function clamped(warnings, label, what, from, range, extra) {
  const to = clampTo(from, range);
  if (to !== Number(from)) warnings.push(loss('range.clamped', { label, what, from, to, desk: DESK }, extra));
  return to;
}

function mapEq(eq, warnings, label, filterFree) {
  const out = { on: !!eq.on, mdl: 'STD' };
  const mids = [];
  // Cuts are kept apart from shelves: a channel can carry both, and only the
  // shelf belongs in the EQ's outer band.
  let low = null, high = null, lowCut = null, highCut = null;
  out.cut = null;                                  // a cut to fold into node.flt

  for (const b of eq.bands || []) {
    const t = b.type || 'bell';
    if (t === 'lowcut') { if (!lowCut) lowCut = b; else mids.push(b); }
    else if (t === 'highcut') { if (!highCut) highCut = b; else mids.push(b); }
    else if (t === 'lowshelf') { if (!low) low = b; else mids.push(b); }
    else if (t === 'highshelf') { if (!high) high = b; else mids.push(b); }
    else mids.push(b);
  }

  // A low-CUT band has no home in the Wing's EQ: its outer band switches
  // between shelf and bell, and a bell at 0 dB does nothing at all, so
  // writing one silently throws the rolloff away. The Wing does have a real
  // low cut — in the dedicated filter section — so use that when the channel
  // high-pass has not already claimed it, and say so when it has.
  if (lowCut) {
    if (filterFree) { out.cut = { lc: true, lcf: round(lowCut.f), lcs: '12' }; }
    else {
      warnings.push(loss('eq.lowcut-no-slot',
        { label, freq: Math.round(lowCut.f), desk: DESK }));
    }
  }

  // Same for a high cut. The filter block's high cut is always free, since
  // the high-pass only ever takes the low cut.
  if (highCut) out.cut = { ...(out.cut || {}), hc: true, hcf: round(highCut.f), hcs: '12' };

  // Every one of the six bands is written, including the ones the source
  // does not use. The Wing merges a snapshot key by key, so a band left out
  // keeps whatever the last show put there — the converted channel then has
  // two EQ curves fighting, and the one you cannot see came from a different
  // gig. An unused band is written flat at 0 dB rather than omitted.
  const MID_DEFAULT_F = [250, 1000, 4000, 8000];

  out.lf = round(low ? low.f : 80);
  out.lg = round(low ? low.g : 0);
  out.lq = eqQ(low ? low.q : 1);
  out.leq = 'SHV';

  out.hf = round(high ? high.f : 12000);
  out.hg = round(high ? high.g : 0);
  out.hq = eqQ(high ? high.q : 1);
  out.heq = 'SHV';

  const fitMids = mids.length > 4 ? mids.filter(b => Number(b.g) !== 0).slice(0, 4) : mids;
  for (let i = 0; i < 4; i++) {
    const b = fitMids[i];
    const n = i + 1;
    out[`${n}f`] = round(b ? b.f : MID_DEFAULT_F[i]);
    out[`${n}g`] = round(b ? b.g : 0);
    out[`${n}q`] = eqQ(b ? b.q : 1);
  }
  if (mids.filter(b => Number(b.g) !== 0).length > 4) {
    warnings.push(loss('eq.mid-band-overflow', { label, count: mids.length, desk: DESK }));
  }
  return out;
}

// DCA and mute-group membership is a tag string ("#D5#M1"), not the bitmask the
// X32 uses.
function tagsFor(c) {
  return c.dcas.map(n => `#D${n}`).join('') +
         c.muteGroups.map(n => `#M${n}`).join('');
}

// X32 input classes map onto the Wing's own source groups. The Wing exposes
// 24 local inputs in a snapshot (and only 8 physical XLRs on the desk), so a
// scene patched to local inputs beyond that needs a stagebox on the day.
const SRC_GROUP = { local: 'LCL', aes50a: 'A', aes50b: 'B', aes50c: 'C', card: 'CRD', user: 'USR', aux: 'AUX',
                    usb: 'USB', bus: 'BUS' };

function mapPatch(patch, warnings, label) {
  if (!patch) return { grp: 'OFF', in: 1 };
  const grp = SRC_GROUP[patch.group];
  if (!grp) { warnings.push(loss('patch.group-unsupported', { label, group: patch.group, desk: DESK })); return { grp: 'OFF', in: 1 }; }
  if (grp === 'LCL' && patch.input > LCL_INPUTS) {
    warnings.push(loss('patch.input-overflow', { label, input: patch.input, desk: DESK, limit: LCL_INPUTS }));
    return { grp: 'OFF', in: 1 };
  }
  return { grp, in: patch.input };
}

export function emitWingSnapshot(ir, opts = {}) {
  const warnings = [...(ir.losses || [])];
  if (ir.channels.length > MAX_CH) warnings.push(loss('channel.over-limit', { count: ir.channels.length, desk: DESK, limit: MAX_CH }));
  const include = Object.assign(
    { names: true, colors: true, patch: true, preamp: true, levels: true,
      eq: true, dynamics: true, sends: true, groups: true },
    opts.include || {}
  );

  const ch = {};
  const lcl = {};

  const preview = [];

  // The Wing has native stereo channels, so the IR's order is its order.
  ir.channels.forEach((c, i) => {
    const n = i + 1;
    if (n > MAX_CH) { warnings.push(loss('channel.overflow-one', { n, name: c.name, desk: DESK, limit: MAX_CH }, { kind: 'channel', n, name: c.name })); return; }
    const label = `ch ${n} "${c.name}"`;
    const node = {};

    if (include.names)  { node.name = c.name; node.icon = mapIcon(c.icon, 'wing'); }
    if (include.colors) node.col = mapColor(c.color, 'wing');

    if (include.levels) {
      node.fdr  = dB(c.fader);
      node.mute = !!c.muted;
      // Both desks use -100..+100, but a stereo channel built from a linked
      // mono pair inherits the LEFT strip's hard pan, and that -100 is how
      // the source desk glued the pair together, not a balance anyone dialled.
      // Copying it through would make every converted stereo channel arrive
      // hard left, and would then read back as a deliberate balance.
      node.pan  = c.pairing === 'linked' ? 0 : round(c.pan);
      node.main = { 1: { on: c.toMain !== false, lvl: 0, pre: false } };
    }

    if (include.patch || include.preamp) {
      node.in = { set: { inv: !!c.invert, trim: round(c.trim || 0) } };
      if (include.patch) node.in.conn = mapPatch(c.patch, warnings, label);
    }

    if (include.preamp) {
      node.flt = { lc: !!c.hpf.on, lcf: round(c.hpf.freq), lcs: String(c.hpf.slope || 24) };
    }

    if (include.eq) {
      const hpfUsed = include.preamp && c.hpf.on;
      const eqOut = mapEq(c.eq, warnings, label, !hpfUsed);
      const cut = eqOut.cut;
      delete eqOut.cut;
      node.eq = eqOut;
      if (cut) node.flt = { ...(node.flt || {}), ...cut };
    }

    if (include.dynamics) {
      const ratio = snapRatio(c.dyn.ratio, 'wing');
      if (!ratio.exact) {
        warnings.push(loss('dyn.ratio-snapped', { label, from: c.dyn.ratio, to: ratio.value, desk: DESK },
          { kind: 'channel', n, name: c.name }));
      }
      node.gate = { on: !!c.gate.on, mdl: 'GATE', thr: round(c.gate.thr), range: round(c.gate.range),
                                att: round(c.gate.att), hld: round(c.gate.hold), rel: round(c.gate.rel) };
      node.dyn  = { on: !!c.dyn.on, mdl: 'COMP', thr: round(c.dyn.thr),
                                ratio: snapRatio(c.dyn.ratio, 'wing').value, knee: round(c.dyn.knee),
                                att: round(c.dyn.att), hld: round(c.dyn.hold), rel: round(c.dyn.rel),
                                gain: round(clamped(warnings, label, 'compressor gain', c.dyn.gain, RANGE.dynGain, { kind: 'channel', n, name: c.name })), det: c.dyn.det === 'RMS' ? 'RMS' : 'PEAK',
                                env: c.dyn.env === 'LIN' ? 'LIN' : 'LOG', mix: round(c.dyn.mix) };
    }

    if (include.sends && c.sends?.length) {
      const send = {};
      const moved = [];
      for (const s of c.sends) {
        const tap = tapTo('wing', s.tap);
        if (!tap.exact && s.level > -Infinity) moved.push(s.bus);
        send[String(s.bus)] = { on: !!s.on, lvl: dB(s.level),
                                mode: tap.token,
                                pan: round(s.pan || 0) };
      }
      node.send = send;
      // The Wing has no input, pre-EQ or post-EQ send; those become pre-fader.
      if (moved.length) {
        warnings.push(loss('send.tap-approximated', { label, buses: moved, desk: DESK },
          { kind: 'channel', n, name: c.name }));
      }
    }

    if (include.groups) {
      const t = tagsFor(c);
      if (t) node.tags = t;
    }

    // Editing one channel of a default-linked pair breaks the link on the desk;
    // mirror that so an imported channel doesn't drag its neighbour around.
    node.clink = false;

    ch[String(n)] = node;
    preview.push({
      n, name: c.name, colorHex: c.color?.hex || null,
      outColorHex: codeToHex('wing', mapColor(c.color, 'wing')),
      source: `ch ${c.srcChannels.join('+')}`, stereo: !!c.stereo,
      patch: node.in?.conn && node.in.conn.grp !== 'OFF' ? `${node.in.conn.grp}${node.in.conn.in}` : '—',
      groups: node.tags || '—',
    });

    // Preamp gain, phantom and stereo live on the physical input, not the
    // strip (a Wing snapshot has no stereo flag on a channel). Stereo is
    // written whether or not the input has a preamp, or a card-fed stereo
    // channel would read back as mono.
    const conn = node.in?.conn;
    if (conn && conn.grp !== 'OFF' && (c.stereo || (include.preamp && c.headamp))) {
      const entry = ((lcl[conn.grp] ||= {})[String(conn.in)] = {});
      if (include.preamp && c.headamp) {
        const g = conn.grp === 'LCL'
          ? clamped(warnings, label, 'preamp gain', c.headamp.gain, RANGE.lclGain, { kind: 'channel', n, name: c.name })
          : c.headamp.gain;
        Object.assign(entry, { g: round(g), vph: !!c.headamp.phantom });
      }
      if (c.stereo) entry.mode = 'ST';
    }
  });

  // Same reasoning as the EQ bands, one level up: a channel the show does not
  // reach keeps the last scene's name, colour and patch. Blank the rest of the
  // desk so a converted show lands the same way every time.
  for (let n = ir.channels.length + 1; n <= MAX_CH; n++) {
    if (ch[String(n)]) continue;
    ch[String(n)] = { name: '', fdr: NEG_INF, mute: true, pan: 0 };
  }

  const ae = { ch };

  if (include.groups) {
    const dca = {};
    for (const d of ir.dcas || []) {
      if (!d.name && d.fader === 0) continue;
      dca[String(d.n)] = { name: d.name, icon: mapIcon(d.icon, 'wing'), col: mapColor(d.color, 'wing'), fdr: dB(d.fader), mute: !!d.muted };
    }
    if (Object.keys(dca).length) ae.dca = dca;
  }

  if (include.names) {
    const bus = {};
    (ir.buses || []).forEach(b => {
      if (!b.name) return;
      bus[String(b.n)] = { name: b.name, icon: mapIcon(b.icon, 'wing'), col: mapColor(b.color, 'wing'), fdr: dB(b.fader), mute: !!b.muted };
    });
    if (Object.keys(bus).length) ae.bus = bus;

    const mtx = {};
    (ir.matrices || []).forEach(b => {
      if (!b.name) return;
      mtx[String(b.n)] = { name: b.name, icon: mapIcon(b.icon, 'wing'), col: mapColor(b.color, 'wing'), fdr: dB(b.fader), mute: !!b.muted };
    });
    if (Object.keys(mtx).length) ae.mtx = mtx;
  }

  if (Object.keys(lcl).length) ae.io = { in: lcl };

  return {
    snapshot: { type: 'snapshot.11', creator: 'Showfile',
                creator_name: String(ir.name || '').slice(0, 32), creator_model: 'wing', ae_data: ae },
    warnings: renderAll(warnings),
    losses: warnings,
    preview,
    // The blanked slots are housekeeping, not channels the engineer converted.
    stats: { channels: Object.values(ch).filter(c => c.name).length,
             stereoPairs: ir.channels.filter(c => c.stereo).length },
  };
}
