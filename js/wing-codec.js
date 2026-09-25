// ─── Wing snapshot encodings, both directions ─────────────────────────────
// Each Wing concept that the reader (wing-scene.js) and the writer
// (wing-snap.js) both touch is defined here once, as a read/write pair, so the
// two cannot drift apart. They did: the writer joined tags without commas,
// and the reader, doing its own parsing, accepted that where WING-EDIT did not.
//
// The shapes follow WING-EDIT: what it writes is what we write, and what it
// ignores we ignore when reading.

export const NEG_INF = -144;                   // the Wing's -oo sentinel

// DCA and mute-group membership: "#D5,#M1". Comma-separated, as WING-EDIT
// writes it; a tag it cannot read (like the run-together "#D5#M1") counts
// for nothing, as on the desk.
export const tags = {
  write: ({ dcas, muteGroups }) => [...dcas.map(n => `#D${n}`), ...muteGroups.map(n => `#M${n}`)].join(','),
  read(s) {
    const out = { dcas: [], muteGroups: [] };
    for (const t of String(s || '').split(',')) {
      const m = /^#([DM])(\d+)$/.exec(t.trim());
      if (m && Number(m[2]) > 0) (m[1] === 'D' ? out.dcas : out.muteGroups).push(Number(m[2]));
    }
    return out;
  },
};

// A channel's input: { grp, in }, with grp 'OFF' for unpatched. The Wing's
// source groups against the neutral ones, written once with the inverse
// derived. C is the Wing's third AES50 port, USB its computer audio, BUS an
// internal bus used as a channel source (a sidechain key).
const GROUP = { local: 'LCL', aes50a: 'A', aes50b: 'B', aes50c: 'C', card: 'CRD', user: 'USR', aux: 'AUX',
                usb: 'USB', bus: 'BUS' };
const NEUTRAL = Object.fromEntries(Object.entries(GROUP).map(([n, w]) => [w, n]));

export const conn = {
  off: () => ({ grp: 'OFF', in: 1 }),
  group: (neutral) => GROUP[neutral],                        // undefined: no Wing equivalent
  isPatched: (c) => c !== null && typeof c === 'object' && !!c.grp && c.grp !== 'OFF',
  knows: (grp) => grp in NEUTRAL,
  read: (c) => (conn.isPatched(c)
    ? { group: NEUTRAL[c.grp] || null, input: typeof c.in === 'number' && Number.isFinite(c.in) ? c.in : 1 }
    : null),
};

// A channel the show does not reach is written blank, so the desk does not
// keep the last show on it: no name, icon or input, grey (the Wing has no "no
// color"), muted at -oo. Read back, a channel in that state is not a channel.
export const spare = {
  write: () => ({ name: '', icon: 0, col: 17, in: { conn: conn.off() }, fdr: NEG_INF, mute: true, pan: 0 }),
  is: (c) => !c.name && c.mute === true && c.fdr === NEG_INF
    && !conn.isPatched(c.in?.conn) && !c.eq && !c.gate && !c.dyn && !c.flt,
};

// The gate, compressor and EQ slots each hold one of several models (a
// de-esser, a vintage compressor, an emulated console EQ...). Only these mean
// what the other desks' gate, compressor and EQ mean; anything else is left
// off rather than misread.
//
// Gate: a ducker is its own model; a gate and an expander share GATE, told
// apart by its ratio ("gate", or "1:3").
export const gateModel = {
  models: ['GATE', 'DUCK'],
  write: (g) => (g.mode === 'duck' ? { mdl: 'DUCK' }
    : { mdl: 'GATE', ratio: g.mode === 'exp' ? `1:${g.ratio}` : 'gate' }),
  read(node) {
    if (String(node.mdl).toUpperCase() === 'DUCK') return { mode: 'duck', ratio: null };
    const exp = /^1:([\d.]+)$/.exec(String(node.ratio || ''));
    return exp ? { mode: 'exp', ratio: Number(exp[1]) } : { mode: 'gate', ratio: null };
  },
};

// Compressor slot: COMP, or EXP for an expander.
export const dynModel = {
  models: ['COMP', 'EXP'],
  write: (d) => (d.mode === 'exp' ? 'EXP' : 'COMP'),
  read: (node) => (String(node.mdl).toUpperCase() === 'EXP' ? 'exp' : 'comp'),
};

// EQ slot: only STD's bands are frequencies and gains. The emulations (SOUL,
// E88 ...) store knob positions under some of the same keys.
export const EQ_MODEL = 'STD';

// The channel filter block, flt: a low cut (lc) and a high cut (hc). The low
// cut is the channel high-pass; an EQ low cut moves into it when the high-pass
// leaves it free, and an EQ high cut always moves into hc, since the Wing's
// EQ has no cut bands (wing-snap.js reports those moves). Read back, lc is the
// high-pass and hc is a high-cut EQ band.
const round = (v) => Math.round(v * 1e4) / 1e4;
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export const filter = {
  hpf: (h) => ({ lc: !!h.on, lcf: round(h.freq), lcs: String(h.slope || 24) }),
  lowCut: (f) => ({ lc: true, lcf: round(f), lcs: '12' }),
  highCut: (f) => ({ hc: true, hcf: round(f), hcs: '12' }),
  readHpf: (flt) => ({ on: flt.lc === true, slope: num(parseInt(flt.lcs, 10), 24), freq: num(flt.lcf, 20) }),
  readHighCut: (flt) => (flt?.hc === true ? { type: 'highcut', f: num(flt.hcf, 20000), g: 0, q: 1 } : null),
};
