// ─── .scn writer core ──────────────────────────────────────────────────────
// What the X32 and X Air writers have in common: both write the same plain
// text scene format, lay channels out on mono slots with stereo as linked
// pairs, and trim EQ to four bands. Each writer keeps only what is its desk's:
// node names, argument layouts, routing.

import { loss } from './losses.js';
import { nearestExp } from './scn-codec.js';
import { mapColor, snapRatio } from './console-map.js';

// ── text ─────────────────────────────────────────────────────────────────
export const q = (s) => String(s ?? '').replace(/"/g, '');
export const pad2 = (n) => String(n).padStart(2, '0');
export { onOff, dec, sign1, sign2 } from './scn-codec.js';

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

// ── per-channel ──────────────────────────────────────────────────────────
// A stereo source becomes two strips; the desk has no shared name, so the
// halves are suffixed the way an engineer would write them, and a name that
// already carries a side marker loses it first ("OH L" must not become
// "OH L L"). The marker has to be its own word — VOCAL must not become VOCA L.
export function stripName(raw, { width, half, max, names = true }) {
  const base = names ? q(raw).trim().slice(0, max).trim() : '';
  const stem = base.replace(/\s+[LR]$/i, '').trim();
  return width === 2 ? stem.slice(0, max - 2).trim() + (half === 0 ? ' L' : ' R') : base;
}

// The checks below each report one kind of loss for one channel. `at` is how
// the report names the channel: { label, n, name }.
const scope = (at) => ({ kind: 'channel', n: at.n, name: at.name });

// Color loss is real on the way down: a Wing's 18 colors collapse onto 8.
export function reportColorCollapse(losses, placed, { desk, target }) {
  const seen = new Map();
  for (const { c } of placed) {
    const from = c.color?.code;
    if (from === null || from === undefined) continue;
    const to = mapColor(c.color, target);
    if (!seen.has(to)) seen.set(to, new Set());
    seen.get(to).add(String(from));
  }
  const collapsed = [...seen.values()].filter(s => s.size > 1).length;
  if (collapsed) losses.push(loss('color.palette-collapse', { desk, to: 8, from: 18, count: collapsed }));
}

// A send to a bus the desk lacks cannot be written. One at -oo carries
// nothing, and a real scene holds sixteen of those per channel, so only sends
// with a level are worth a line.
export function reportLostBuses(losses, sends, { desk, limit }, at) {
  const buses = sends.filter(s => (s.bus < 1 || s.bus > limit) && s.level > -Infinity).map(s => s.bus);
  if (buses.length) losses.push(loss('send.bus-overflow', { label: at.label, buses, desk, limit }, scope(at)));
}

// A stereo channel from a natively-stereo desk carries a real balance. One
// built from a linked pair carries -100/+100, which is an artefact of being
// the left strip, not a balance the engineer set; the pairing says which.
export function reportBalanceLost(losses, c, { desk }, at) {
  if (c.pairing === 'native' && Math.round(c.pan) !== 0) {
    losses.push(loss('stereo.balance-lost', { label: at.label, balance: Math.round(c.pan), desk }, scope(at)));
  }
}

// The nearest ratio the desk has; a ratio that had to move is reported.
export function snapRatioReported(losses, ratio, { desk, ratios }, at) {
  const r = snapRatio(ratio, ratios);
  if (!r.exact) losses.push(loss('dyn.ratio-snapped', { label: at.label, from: ratio, to: r.value, desk }, scope(at)));
  return r;
}

// An expander ratio the .scn desks lack is written as the nearest; say so.
export function reportGateRatio(losses, gate, { desk }, at) {
  if (gate?.mode !== 'exp') return;
  const to = nearestExp(Number(gate.ratio) || 2);
  if (to !== Number(gate.ratio)) {
    losses.push(loss('dyn.gate-ratio-snapped', { label: at.label, from: gate.ratio, to, desk }, scope(at)));
  }
}

// The bands the desk can hold; if some had to go, say how many there were.
export function fitBandsReported(losses, bands, { desk, limit }, at) {
  const fitted = fitBands(bands, limit);
  if (fitted.length < bands.length) {
    losses.push(loss('eq.band-overflow', { label: at.label, count: bands.length, desk, limit }, scope(at)));
  }
  return fitted;
}
