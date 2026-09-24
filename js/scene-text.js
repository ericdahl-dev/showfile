// ─── Shared node-text scene parsing ────────────────────────────────────────
// The X32/M32 and the X Air series write the same on-disk shape: one
// OSC-style path per line followed by a right-aligned argument list. Only the
// node names and field positions differ, so tokenising, the "-oo" sentinel,
// the compact "3k43" frequency notation and the membership bitmasks are
// common ground and live here.

export const INF = -Infinity;

// Split a line's argument list, honouring quoted names and runs of padding
// spaces (both desks right-align numeric fields, so "ON   0.0" is two tokens).
export function tokenize(rest) {
  const out = [];
  let i = 0;
  while (i < rest.length) {
    while (i < rest.length && rest[i] === ' ') i++;
    if (i >= rest.length) break;
    if (rest[i] === '"') {
      let j = i + 1, s = '';
      while (j < rest.length && rest[j] !== '"') s += rest[j++];
      out.push(s);
      i = j + 1;
    } else {
      let j = i;
      while (j < rest.length && rest[j] !== ' ') j++;
      out.push(rest.slice(i, j));
      i = j;
    }
  }
  return out;
}

// "-oo" is the negative-infinity sentinel; "3k43" is compact notation for
// 3.43 kHz and "10k02" for 10.02 kHz.
export function num(tok, fallback = 0) {
  if (tok === undefined || tok === null) return fallback;
  const s = String(tok).trim();
  if (s === '-oo') return INF;
  const k = /^(\d+)k(\d*)$/.exec(s);
  if (k) return parseFloat(k[1] + '.' + (k[2] || '0')) * 1000;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

export const bool = (tok) => String(tok).trim() === 'ON';

// Least-significant-bit-first membership mask: group 1 is the RIGHTMOST
// character, so "%0001" is group 1 and "%0100" is group 3. Width comes from
// the mask itself — the X32 writes 8 DCA bits, the X Air 4.
//
// Reading it left-to-right silently files every channel under the wrong DCA,
// which is easy to miss because the result still looks plausible.
export function bits(mask) {
  const chars = String(mask || '').replace('%', '').split('').reverse();
  return chars.map((c, i) => (c === '1' ? i + 1 : 0)).filter(Boolean);
}

// Read a whole scene file into a path -> tokens map.
export function parseNodes(text) {
  const nodes = new Map();
  let header = '';
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line[0] === '#') {
      const h = /^#[\d.]+#\s+"([^"]*)"/.exec(line || '');
      if (h) header = h[1];
      continue;
    }
    if (line[0] !== '/') continue;
    const sp = line.indexOf(' ');
    const path = sp === -1 ? line : line.slice(0, sp);
    nodes.set(path, sp === -1 ? [] : tokenize(line.slice(sp + 1)));
  }
  return { nodes, header };
}
