// ─── .scn writer core ──────────────────────────────────────────────────────
// What the X32 and X Air writers have in common: both write the same plain
// text scene format, lay channels out on mono slots with stereo as linked
// pairs, and trim EQ to four bands. Each writer keeps only what is its desk's:
// node names, argument layouts, routing.

import { loss } from './losses.js';

// ── text ─────────────────────────────────────────────────────────────────
export const q = (s) => String(s ?? '').replace(/"/g, '');
export const pad2 = (n) => String(n).padStart(2, '0');
export const onOff = (b) => (b ? 'ON' : 'OFF');
export const dec = (v, p = 1) => (Number(v) || 0).toFixed(p);
export const sign1 = (v) => ((Number(v) || 0) >= 0 ? '+' : '') + (Number(v) || 0).toFixed(1);
export const sign2 = (v) => ((Number(v) || 0) >= 0 ? '+' : '') + (Number(v) || 0).toFixed(2);

// Neutral band types -> the tokens both desks use.
export const EQ_TOKEN = {
  lowcut: 'LCut', lowshelf: 'LShv', bell: 'PEQ',
  highshelf: 'HShv', highcut: 'HCut',
};

// Membership mask, least-significant-bit first: group 1 is the rightmost.
export function mask(members, width) {
  const bits = Array(width).fill('0');
  for (const n of members || []) if (n >= 1 && n <= width) bits[n - 1] = '1';
  return '%' + bits.reverse().join('');
}

// ── layout ───────────────────────────────────────────────────────────────
// Lay the Scene's channels out on the desk's mono slots. Stereo takes an
// odd-aligned pair (1-2, 3-4 ...); one that would land on an even slot leaves
// that slot empty rather than renumbering everything after it. What doesn't
// fit is reported, once.
export function allocate(ir, losses, { desk, slots }) {
  const placed = [];
  const gaps = [];
  let slot = 1;

  for (const c of ir.channels) {
    if (c.stereo && slot % 2 === 0) {
      gaps.push(slot);
      slot += 1;                                   // step to the next odd slot
    }
    const width = c.stereo ? 2 : 1;
    if (slot + width - 1 > slots) {
      losses.push(loss('channel.overflow-from',
        { name: c.name || 'ch ' + c.index, desk, limit: slots },
        { kind: 'channel', n: c.index, name: c.name }));
      break;
    }
    placed.push({ c, ch: slot, width });
    slot += width;
  }

  if (gaps.length) losses.push(loss('stereo.pair-alignment', { desk, gaps }));
  const dropped = ir.channels.length - placed.length;
  if (dropped > 0 && !losses.some(l => l.code === 'channel.overflow-from')) {
    losses.push(loss('channel.overflow-count', { count: dropped, desk, limit: slots }));
  }
  return placed;
}

// When a source has more EQ bands than the target has slots, the ones doing
// nothing go first. A 0 dB band is audibly absent, so keeping it while
// discarding a real cut would throw away the only part that mattered — and
// flat bands are common now that the Wing writer fills all six slots so a
// converted channel cannot inherit the last show's curve.
export function fitBands(bands, limit) {
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
