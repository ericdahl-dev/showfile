// ─── The Scene ─────────────────────────────────────────────────────────────
// The neutral shape every reader returns and every writer consumes. Readers
// build each channel with makeChannel(), which fills in whatever that desk's
// file did not say: a flat EQ, a gate and compressor switched off, the filter
// off, empty group lists.
//
// That matters because a writer handed "nothing here" writes nothing, and a
// desk that is not told about a setting keeps the one it already had. A
// complete channel means every writer can write every setting, so a converted
// show never inherits last night's EQ or dynamics (#2).

// How a channel came to be what it is:
//   mono   - one strip
//   linked - two mono strips linked as a pair (X32, X Air)
//   native - one natively stereo channel (Wing)
// Writers need to know: a linked pair's left strip carries a hard pan that is
// only how the pair was glued together, while a native channel's balance was
// set by the engineer.
export const PAIRINGS = ['mono', 'linked', 'native'];

const HPF_OFF  = { on: false, slope: 24, freq: 20 };
const GATE_OFF = { on: false, thr: -80, range: 60, att: 0, hold: 50, rel: 200 };
const DYN_OFF  = { on: false, det: 'PEAK', env: 'LOG', thr: 0, ratio: 3, knee: 0,
                   gain: 0, att: 10, hold: 10, rel: 151, pos: 'POST', mix: 100 };

// Readers name the pairing. A caller that does not gets it inferred from the
// old convention: stereo from two source channels is a linked pair.
const pairingOf = (c) => {
  if (c.pairing !== undefined) return c.pairing;
  if (!c.stereo) return 'mono';
  return c.srcChannels?.length === 2 ? 'linked' : 'native';
};

export function makeChannel(c) {
  const pairing = pairingOf(c);
  if (!PAIRINGS.includes(pairing)) throw new Error(`Unknown pairing "${pairing}" on ch ${c.ch}.`);
  const srcChannels = c.srcChannels || [c.ch];
  if (pairing === 'linked' && srcChannels.length !== 2) {
    throw new Error(`ch ${c.ch} is a linked pair but names ${srcChannels.length} source channel(s).`);
  }

  return {
    ...c,
    name: c.name || '',
    color: c.color || { hex: null, code: null, format: null },
    patch: c.patch || null,
    headamp: c.headamp || null,
    pairing,
    stereo: pairing !== 'mono',
    srcChannels,

    trim: c.trim || 0,
    invert: !!c.invert,
    hpf: { ...HPF_OFF, ...(c.hpf || {}) },

    fader: c.fader ?? -Infinity,
    muted: !!c.muted,
    pan: c.pan || 0,
    toMain: c.toMain !== false,

    gate: { ...GATE_OFF, ...(c.gate || {}) },
    dyn: { ...DYN_OFF, ...(c.dyn || {}) },
    // An EQ with no bands is a flat EQ. Each writer pads it to its desk's
    // band count, so the desk's own bands are overwritten flat.
    eq: c.eq
      ? { on: typeof c.eq.on === 'boolean' ? c.eq.on : true, bands: c.eq.bands || [] }
      : { on: false, bands: [] },

    sends: c.sends || [],
    dcas: c.dcas || [],
    muteGroups: c.muteGroups || [],
  };
}
