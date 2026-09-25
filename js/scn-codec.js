// ─── .scn encodings shared by the X32 and the X Air, both directions ──────
// Each token the two .scn readers and the two .scn writers both touch is
// defined here once, as a read/write pair, so a reader and a writer cannot
// drift apart (the Wing's equivalent is wing-codec.js). What only one desk has
// lives with that desk: x32-codec.js, xair-codec.js.

import { num, bool } from './scene-text.js';

// Values as both desks write them: ON/OFF, fixed decimals, signed decimals.
// (num and bool in scene-text.js are the read side.)
export const onOff = (b) => (b ? 'ON' : 'OFF');
export const dec = (v, p = 1) => (Number(v) || 0).toFixed(p);
export const sign1 = (v) => ((Number(v) || 0) >= 0 ? '+' : '') + (Number(v) || 0).toFixed(1);
export const sign2 = (v) => ((Number(v) || 0) >= 0 ? '+' : '') + (Number(v) || 0).toFixed(2);

// Membership mask, least-significant-bit first: group 1 is the RIGHTMOST
// character, so "%0001" is group 1 and "%0100" is group 3. Reading it
// left-to-right files every channel under the wrong group, and still looks
// plausible. The X32 writes 8 DCA bits, the X Air 4; a member past the width
// is dropped (losses.js reports it).
export const membership = {
  read(mask) {
    const chars = String(mask || '').replace('%', '').split('').reverse();
    return chars.map((c, i) => (c === '1' ? i + 1 : 0)).filter(Boolean);
  },
  write(members, width) {
    const bits = Array(width).fill('0');
    for (const n of members || []) if (n >= 1 && n <= width) bits[n - 1] = '1';
    return '%' + bits.reverse().join('');
  },
};

// EQ band type. VEQ is the X32's vintage bell, read as a bell and never written.
const EQ_TYPE = { LCUT: 'lowcut', LSHV: 'lowshelf', PEQ: 'bell', VEQ: 'bell', HSHV: 'highshelf', HCUT: 'highcut' };
const EQ_TOKEN = { lowcut: 'LCut', lowshelf: 'LShv', bell: 'PEQ', highshelf: 'HShv', highcut: 'HCut' };
export const eqBand = {
  read: (t) => EQ_TYPE[String(t || 'PEQ').toUpperCase()] || 'bell',
  write: (type) => EQ_TOKEN[type] || 'PEQ',
};

// Gate mode: GATE, DUCK, or EXP2-EXP4 for an expander at 1:2-1:4. An expander
// ratio the desks lack goes to the nearest (scn-core.js reports it).
const EXP_RATIOS = [2, 3, 4];
export const nearestExp = (r) => EXP_RATIOS.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a));
export const gateMode = {
  read(t) {
    const tok = String(t || 'GATE').toUpperCase();
    const exp = /^EXP(\d)$/.exec(tok);
    if (exp) return { mode: 'exp', ratio: Number(exp[1]) };
    return { mode: tok === 'DUCK' ? 'duck' : 'gate', ratio: null };
  },
  write(gate) {
    if (gate?.mode === 'duck') return 'DUCK';
    if (gate?.mode === 'exp') return 'EXP' + nearestExp(Number(gate.ratio) || 2);
    return 'GATE';
  },
};

// The compressor line's first three tokens after on/off, the same on both
// desks: mode (COMP / EXP), detector (PEAK / RMS), envelope (LOG / LIN).
export const dynModes = {
  read: (args) => ({
    mode: args[1] === 'EXP' ? 'exp' : 'comp',
    det: args[2] === 'RMS' ? 'RMS' : 'PEAK',
    env: args[3] === 'LIN' ? 'LIN' : 'LOG',
  }),
  write: (d) => `${d.mode === 'exp' ? 'EXP' : 'COMP'} ${d.det === 'RMS' ? 'RMS' : 'PEAK'} ${d.env === 'LIN' ? 'LIN' : 'LOG'}`,
};

// /ch/NN/eq/B: type freq gain q, the same on both desks.
export const eqLine = {
  read: (a) => ({ type: eqBand.read(a[0]), f: num(a[1]), g: num(a[2]), q: num(a[3]) }),
  write: (b) => `${eqBand.write(b.type)} ${dec(b.f, 1)} ${sign2(b.g)} ${dec(b.q, 1)}`,
};

// The gate and compressor lines open the same way on both desks: on, the
// mode token(s), then the threshold. Each desk's codec lays out the rest.
export const readGateHead = (a) => ({ on: bool(a[0]), ...gateMode.read(a[1]) });
export const readDynHead = (a) => ({ on: bool(a[0]), ...dynModes.read(a) });
