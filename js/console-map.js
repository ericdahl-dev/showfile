// ─── Console colour / icon mapping tables ──────────────────────────────────
// Shared by the Input List console exporter (ui.js) and the scene converter.
//
// The Wing palette below was derived empirically: eighteen channels were set to
// the eighteen swatches in picker order and the resulting `col` integers read
// back out of the saved snapshot. All 18 indices appear exactly once.
//
// This matters because the widely-used XM32-to-Wing converter passes the X32's
// colour *index* straight through, and the two palettes are unrelated — an X32
// green channel (GN = 2) lands on Wing colour 2, which is blue.

export const WING_PALETTE = [
  { col: 1,  name: 'indigo',      rgb: [ 79,  70, 229] },
  { col: 2,  name: 'blue',        rgb: [ 37,  99, 235] },
  { col: 3,  name: 'blue-violet', rgb: [109,  40, 217] },
  { col: 4,  name: 'turquoise',   rgb: [ 45, 178, 200] },
  { col: 5,  name: 'green',       rgb: [ 34, 160,  80] },
  { col: 6,  name: 'lime',        rgb: [132, 204,  22] },
  { col: 7,  name: 'yellow',      rgb: [234, 215,  60] },
  { col: 8,  name: 'brown',       rgb: [166,  92,  40] },
  { col: 9,  name: 'crimson',     rgb: [220,  50,  75] },
  { col: 10, name: 'salmon',      rgb: [248, 136, 136] },
  { col: 11, name: 'magenta',     rgb: [232,  40, 220] },
  { col: 12, name: 'lavender',    rgb: [147,  51, 234] },
  { col: 13, name: 'goldenrod',   rgb: [240, 160,  50] },
  { col: 14, name: 'sky blue',    rgb: [ 60, 180, 240] },
  { col: 15, name: 'orange-red',  rgb: [248,  80,  50] },
  { col: 16, name: 'mint',        rgb: [ 80, 224, 168] },
  { col: 17, name: 'grey',        rgb: [128, 128, 128] },
  { col: 18, name: 'white',       rgb: [235, 235, 235] },
];

// X32/M32 strip colour enum. Index is the value written in .scn files; the
// `i` suffixed entries (8-15) are the same hue shown inverted, which the Wing
// has no equivalent for, so they collapse onto the same base colour.
export const X32_PALETTE = [
  { code: 'OFF', idx: 0,  rgb: [ 32,  32,  32] },
  { code: 'RD',  idx: 1,  rgb: [255,   0,   0] },
  { code: 'GN',  idx: 2,  rgb: [  0, 255,   0] },
  { code: 'YE',  idx: 3,  rgb: [255, 255,   0] },
  { code: 'BL',  idx: 4,  rgb: [  0,   0, 255] },
  { code: 'MG',  idx: 5,  rgb: [255,   0, 255] },
  { code: 'CY',  idx: 6,  rgb: [  0, 255, 255] },
  { code: 'WH',  idx: 7,  rgb: [255, 255, 255] },
  { code: 'OFFi', idx: 8,  rgb: [ 32,  32,  32] },
  { code: 'RDi',  idx: 9,  rgb: [255,   0,   0] },
  { code: 'GNi',  idx: 10, rgb: [  0, 255,   0] },
  { code: 'YEi',  idx: 11, rgb: [255, 255,   0] },
  { code: 'BLi',  idx: 12, rgb: [  0,   0, 255] },
  { code: 'MGi',  idx: 13, rgb: [255,   0, 255] },
  { code: 'CYi',  idx: 14, rgb: [  0, 255, 255] },
  { code: 'WHi',  idx: 15, rgb: [255, 255, 255] },
];

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function dist(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

// Nearest palette entry to an [r,g,b] triple, by Euclidean RGB distance.
function nearest(rgb, palette, key, fallback) {
  if (!rgb) return fallback;
  let best = fallback, bestD = Infinity;
  for (const p of palette) {
    const d = dist(rgb, p.rgb);
    if (d < bestD) { bestD = d; best = p[key]; }
  }
  return best;
}

export function hexToWingCol(hex)  { return nearest(hexToRgb(hex), WING_PALETTE, 'col',  17); }
export function hexToX32Code(hex)  { return nearest(hexToRgb(hex), X32_PALETTE.slice(0, 8), 'code', 'WH'); }

// X32 colour code -> Wing col.
//
// Explicit rather than nearest-RGB: the eight X32 codes are the complete set a
// scene can contain, and the Wing palette has several candidates in the same
// hue family (crimson vs orange-red, turquoise vs sky blue) where an approximate
// RGB match picks the wrong one. These are the choices an engineer would make
// looking at the two palettes side by side.
//
// The `i` (inverted) variants have no Wing equivalent and collapse onto the base
// colour; OFF becomes grey, since the Wing has no "no colour" state.
export const X32_COLOR_TO_WING = {
  OFF: 17, RD:  9, GN:  5, YE:  7, BL:  2, MG: 11, CY:  4, WH: 18,
  OFFi: 17, RDi: 9, GNi: 5, YEi: 7, BLi: 2, MGi: 11, CYi: 4, WHi: 18,
};

export function x32ColorToWing(code) {
  return X32_COLOR_TO_WING[String(code || '').trim()] ?? 17;
}

// X32 icon index -> Wing icon. Wing icons are category * 100 + index, which is
// why these land in bands (200s drums, 300s guitar, 600s keys).
// Observed pairs come from converting real scenes; unmapped icons fall back to
// 0 ("no icon") rather than guessing a wrong picture.
export const X32_ICON_TO_WING = {
  1: 0, 2: 200, 3: 201, 4: 202, 5: 203, 6: 206,
  8: 209, 9: 211, 10: 205, 12: 213, 17: 300, 50: 101, 62: 605,
};

export function x32IconToWing(icon) {
  return X32_ICON_TO_WING[Number(icon)] ?? 0;
}

// ─── Neutral colour / icon exchange ────────────────────────────────────────
// Readers put a neutral value in the IR and writers take it out again, so a new
// desk needs no knowledge of the desks already here. Two wrinkles make that
// more than a hex string:
//
//   * Nearest-RGB is not always the right answer between two specific palettes.
//     X32 cyan is pure (0,255,255); by distance that lands on the Wing's sky
//     blue, but turquoise is what an engineer would pick. So a curated table for
//     a known pair wins, and nearest-RGB is the fallback for pairs nobody has
//     curated.
//   * A colour therefore travels as { hex, code, format } — the neutral value
//     plus where it came from — and mapColor consults CURATED first.

const CURATED = {
  'x32>wing': (code) => X32_COLOR_TO_WING[String(code || '').trim()],
  'wing>x32': (col)  => WING_COL_TO_X32[Number(col)],
  // An X Air colour is an X32 colour wearing a different label, so it reaches
  // the Wing through the same curated table rather than through nearest-RGB.
  'xair>wing': (idx) => X32_COLOR_TO_WING[xairIdxToX32Code(idx)],
  'xair>x32':  (idx) => xairIdxToX32Code(idx),
  'x32>xair':  (code) => x32CodeToXairIdx(code),
  'wing>xair': (col)  => x32CodeToXairIdx(WING_COL_TO_X32[Number(col)]),
};

// Wing col -> X32 colour code. The Wing's 18 collapse onto the X32's 8, so
// several entries share a target; that loss is real and is warned about at the
// call site rather than hidden here.
export const WING_COL_TO_X32 = {
  1: 'BL',  2: 'BL',  3: 'MG', 4: 'CY',  5: 'GN',  6: 'GN',
  7: 'YE',  8: 'YE',  9: 'RD', 10: 'RD', 11: 'MG', 12: 'MG',
  13: 'YE', 14: 'CY', 15: 'RD', 16: 'GN', 17: 'OFF', 18: 'WH',
};

// The X Air series shares the X32's eight colours but writes the palette INDEX
// where the X32 writes the mnemonic — /ch/01/config "Kick" 1 In01 U01 is red,
// the same colour the X32 spells RD. Same table, different key, so an X Air
// colour needs no new palette and x32<->xair is lossless.
const PALETTES = {
  x32:  { table: X32_PALETTE, key: 'code', hexKey: 'code', fallback: 'WH' },
  wing: { table: WING_PALETTE, key: 'col', hexKey: 'col', fallback: 17 },
  xair: { table: X32_PALETTE, key: 'idx', hexKey: 'idx', fallback: 7 },
};

// X Air palette index <-> X32 colour code, both directions, off the one table.
export const xairIdxToX32Code = (idx) => X32_PALETTE.find(e => e.idx === Number(idx))?.code;
export const x32CodeToXairIdx = (code) => X32_PALETTE.find(e => e.code === String(code).trim())?.idx;
export function hexToXairIdx(hex) { return nearest(hexToRgb(hex), X32_PALETTE.slice(0, 8), 'idx', 7); }

const toHexStr = (rgb) => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');

// Look a desk's own colour value up to a neutral hex string.
export function codeToHex(format, code) {
  const p = PALETTES[format];
  if (!p) return null;
  const hit = p.table.find(e => String(e[p.hexKey]) === String(code));
  return hit ? toHexStr(hit.rgb) : null;
}

// Build the neutral colour an IR carries.
export function colorFrom(format, code) {
  return { hex: codeToHex(format, code), code: code ?? null, format };
}

// Resolve a neutral colour to one desk's own value: curated pair first, then
// nearest RGB, then the target's fallback.
export function mapColor(color, target) {
  if (!color) return PALETTES[target]?.fallback;
  const curated = CURATED[`${color.format}>${target}`];
  if (curated) {
    const hit = curated(color.code);
    if (hit !== undefined) return hit;
  }
  if (target === 'wing') return hexToWingCol(color.hex);
  if (target === 'x32')  return hexToX32Code(color.hex);
  if (target === 'xair') return hexToXairIdx(color.hex);
  return PALETTES[target]?.fallback;
}

// Icons travel in the X32's numbering, which is simply the space we have a
// table for — it is a canonical choice, not a claim that the X32 is special.
export const WING_ICON_TO_X32 = Object.fromEntries(
  Object.entries(X32_ICON_TO_WING).filter(([, w]) => w).map(([x, w]) => [w, Number(x)])
);

export function wingIconToX32(icon) {
  return WING_ICON_TO_X32[Number(icon)] ?? 1;      // 1 is the X32's blank icon
}

export function mapIcon(icon, target) {
  if (target === 'wing') return x32IconToWing(icon);
  if (target === 'x32')  return Number(icon) || 1;
  if (target === 'xair') return null;      // the X Air has no channel icon
  return 0;
}

// Compressor ratios each desk offers. The X32 stores an index into its list,
// so anything else is not a setting it can hold; the Wing's list is finer.
const RATIOS = {
  x32:  [1.1, 1.3, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 20, 100],
  xair: [1.1, 1.3, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 20, 100],
  wing: [1.1, 1.2, 1.3, 1.5, 1.7, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 20, 50, 100],
};

// The nearest ratio the desk has (a tie goes to the gentler one), and whether
// that is the ratio asked for.
export function snapRatio(value, desk) {
  const list = RATIOS[desk];
  const v = Number(value) || 3;
  const best = list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return { value: best, exact: Math.abs(best - v) < 1e-9 };
}

// How an X32/X Air scene file spells a ratio: one decimal below 10, whole above.
export const ratioToken = (r) => (r >= 10 ? String(r) : r.toFixed(1));

// Send taps: where along the channel a send is taken. The X32 and X Air have
// the same six (spelled differently); the Wing has pre-fader, post-fader and
// group. Neutral names, in signal order.
const TAP_NEUTRAL = ['input', 'preeq', 'posteq', 'pre', 'post', 'group'];
const TAP_TOKENS = {
  x32:  ['IN/LC', '<-EQ', 'EQ->', 'PRE', 'POST', 'GRP'],
  xair: ['IN', 'PREEQ', 'POSTEQ', 'PRE', 'POST', 'GRP'],
  wing: [null, null, null, 'PRE', 'POST', 'GRP'],
};

// A desk's token -> the neutral tap. Unknown or missing reads as pre-fader.
export function tapFrom(desk, token) {
  const i = TAP_TOKENS[desk].indexOf(String(token ?? '').toUpperCase());
  return i >= 0 ? TAP_NEUTRAL[i] : 'pre';
}

// The neutral tap -> a desk's token. A tap the desk lacks (the Wing has no
// input, pre-EQ or post-EQ send) falls back to pre-fader, which is the nearest
// it has, and says it did.
export function tapTo(desk, tap) {
  const token = TAP_TOKENS[desk][TAP_NEUTRAL.indexOf(tap)];
  return token ? { token, exact: true } : { token: TAP_TOKENS[desk][3], exact: false };
}
