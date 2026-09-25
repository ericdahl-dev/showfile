// ─── X32 / M32 scene encodings, both directions ────────────────────────────
// What only the X32 has, as read/write pairs shared by x32-scene.js and
// x32-emit.js (tokens both .scn desks share are in scn-codec.js). Neutral
// group names describe the physical thing (a local XLR, an AES50 port) rather
// than any desk's spelling.

import { num } from './scene-text.js';
import { onOff, dec, gateMode, dynModes, readGateHead, readDynHead } from './scn-codec.js';
import { ratioToken } from './console-map.js';

// /config/routing/IN patches channels in blocks of eight: "A1-8" means the
// block's channels come from AES50-A inputs 1-8. A UIN block points into the
// user routing table instead (x32-scene.js follows it); AUX names the aux
// block. Only the prefixes in WRITE are written: UIN only means something
// through /config/userrout/in, which the writer does not fill.
const BLOCK_WRITE = { local: 'AN', aes50a: 'A', aes50b: 'B', card: 'CARD' };
const BLOCK_READ = { ...Object.fromEntries(Object.entries(BLOCK_WRITE).map(([g, p]) => [p, g])), UIN: 'user', AUX: 'aux' };
const BLOCK_RE = /^(AN|CARD|UIN|AUX|A|B)(\d+)-(\d+)$/;

export const routingBlock = {
  prefix: (group) => BLOCK_WRITE[group],                  // undefined: not patched by block
  read(tok) {
    const m = BLOCK_RE.exec(String(tok || ''));
    return m ? { group: BLOCK_READ[m[1]], start: parseInt(m[2], 10) } : null;
  },
};

// A channel's /ch/NN/config source number: 1-32 play a routing slot (In01-32);
// the rest name an input directly: 33-38 Aux 1-6, 39-40 USB L/R, 41-48 FX
// returns 1L-4R, 49-64 Bus 01-16.
const SOURCES = [
  { group: 'aux', base: 32, size: 6, label: 'AUX' },
  { group: 'usb', base: 38, size: 2, label: 'USB' },
  { group: 'fx',  base: 40, size: 8, label: 'FX' },
  { group: 'bus', base: 48, size: 16, label: 'BUS' },
];

export const channelSource = {
  // { slot } for a routing slot, { group, input } for a direct input, or null (OFF).
  read(s) {
    if (s >= 1 && s <= 32) return { slot: s };
    const g = SOURCES.find(r => s > r.base && s <= r.base + r.size);
    return g ? { group: g.group, input: s - g.base } : null;
  },
  // The direct source for a patch, or null when it is reached through a routing slot.
  write(patch) {
    const g = patch && SOURCES.find(r => r.group === patch.group);
    return g && patch.input >= 1 && patch.input <= g.size ? { base: g.base, label: g.label } : null;
  },
};

// /headamp/NNN: 0-31 local, 32-79 AES50-A, 80-127 AES50-B. The card, USB and
// the rest have no preamp.
const HEADAMP_BASE = { local: 0, aes50a: 32, aes50b: 80 };
export const headampIndex = (patch) => {
  const base = patch ? HEADAMP_BASE[patch.group] : undefined;
  return base === undefined ? null : base + patch.input - 1;
};

// A slot the show does not reach is written blank (a scene file that skips it
// leaves the desk's last show there). Read back, a slot with no name, preamp
// or EQ is padding, not a channel: a scene off a real desk always has those.
export const spareSlot = {
  write: (n, { levels, groups }, lvl) => [
    `/ch/${String(n).padStart(2, '0')}/config "" 1 OFF ${n}`,
    ...(levels ? [`/ch/${String(n).padStart(2, '0')}/mix ON ${lvl(-Infinity)} ON +0 OFF ${lvl(-Infinity)}`] : []),
    ...(groups ? [`/ch/${String(n).padStart(2, '0')}/grp %00000000 %000000`] : []),
  ],
  is: (cfg, preamp, eq) => !cfg[0] && !preamp.length && !eq.length,
};

// /ch/NN/gate: on mode thr range att hold rel keysrc
// /ch/NN/dyn:  on mode det env thr ratio knee gain att hold rel pos keysrc mix auto
// The ratio is passed in already snapped to the X32's list (x32-emit.js reports it).
export const gateLine = {
  read: (a) => ({ ...readGateHead(a), thr: num(a[2]), range: num(a[3]), att: num(a[4]), hold: num(a[5]), rel: num(a[6]) }),
  write: (g) => `${onOff(g.on)} ${gateMode.write(g)} ${dec(g.thr, 1)} ${dec(g.range, 1)} ${dec(g.att, 0)} ${dec(g.hold, 2)} ${dec(g.rel, 0)} 0`,
};
export const dynLine = {
  read: (a) => ({
    ...readDynHead(a), thr: num(a[4]), ratio: num(a[5], 3), knee: num(a[6]), gain: num(a[7]),
    att: num(a[8]), hold: num(a[9]), rel: num(a[10]), pos: a[11] || 'POST', mix: num(a[13], 100),
  }),
  write: (d, ratio) => `${onOff(d.on)} ${dynModes.write(d)} ${dec(d.thr, 1)} ${ratioToken(ratio)} ${dec(d.knee, 0)} ${dec(d.gain, 2)} ${dec(d.att, 0)} ${dec(d.hold, 2)} ${dec(d.rel, 0)} ${d.pos === 'PRE' ? 'PRE' : 'POST'} 0 ${dec(d.mix, 0)} OFF`,
};

// What the X32 / M32 is, for everything that has to know (#55): the writer's
// limits, the page's wording, which files its reader takes.
export const x32Desk = {
  label: 'Behringer X32 / Midas M32', short: 'X32', ext: 'scn', what: 'scene file', mime: 'text/plain',
  reads: ['scn', 'chn', 'snp'], partials: { chn: 'channel preset', snp: 'snippet' },
  channels: 32, dcas: 8, muteGroups: 6, buses: 16, stereo: 'linked',
};
