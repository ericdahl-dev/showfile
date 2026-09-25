// ─── X Air / MR scene encodings, both directions ───────────────────────────
// What only the X Air has, as read/write pairs shared by xair-scene.js and
// xair-emit.js (tokens both .scn desks share are in scn-codec.js).

import { num } from './scene-text.js';
import { onOff, dec, gateMode, dynModes, readGateHead, readDynHead } from './scn-codec.js';
import { ratioToken } from './console-map.js';

// A channel's source: local XLRs "In01"-"In16", USB returns "U01"-"U18", and
// one stereo aux input. X-AIR-Edit offers the aux input as LINE 17/18 and saves
// it as a bare L and R; AuxL/AuxR are its names in the USB routing, and as a
// channel source it rejects them (#50). There is no AES50 and no card. The
// neutral groups describe the physical thing, so USB lands on 'card', the same
// way the X32's expansion card does.
const PREFIX = { local: 'In', card: 'U' };
const AUX = ['L', 'R'];

export const source = {
  prefix: (group) => PREFIX[group],                      // undefined: no such input here
  aux: (input) => AUX[input - 1],                         // undefined: past the two
  auxInputs: AUX.length,
  read(tok) {
    const s = String(tok || '').trim();
    let m = /^In(\d+)$/i.exec(s);
    if (m) return { group: 'local', input: parseInt(m[1], 10) };
    m = /^U(\d+)$/i.exec(s);
    if (m) return { group: 'card', input: parseInt(m[1], 10) };
    if (/^(Aux)?[LR]$/i.test(s)) return { group: 'aux', input: /R$/i.test(s) ? 2 : 1 };   // older files: AuxL
    return null;
  },
};

// /ch/NN/gate: on mode thr range att hold rel keysrc  (keysrc SELF)
// /ch/NN/dyn:  on mode det env thr ratio knee gain att hold rel mix keysrc auto
// No pre/post token, unlike the X32. The ratio is passed in already snapped to
// the X Air's list.
export const gateLine = {
  read: (a) => ({ ...readGateHead(a), thr: num(a[2]), range: num(a[3]), att: num(a[4]), hold: num(a[5]), rel: num(a[6]) }),
  write: (g) => `${onOff(g.on)} ${gateMode.write(g)} ${dec(g.thr, 1)} ${dec(g.range, 1)} ${Math.round(g.att ?? 1)} ${dec(g.hold, 1)} ${Math.round(g.rel || 983)} SELF`,
};
export const dynLine = {
  read: (a) => ({
    ...readDynHead(a), thr: num(a[4]), ratio: num(a[5], 3), knee: num(a[6]), gain: num(a[7]),
    att: num(a[8]), hold: num(a[9]), rel: num(a[10]), mix: num(a[11], 100),
  }),
  write: (d, ratio) => `${onOff(d.on)} ${dynModes.write(d)} ${dec(d.thr, 1)} ${ratioToken(ratio)} ${Math.round(d.knee ?? 1)} ${dec(d.gain, 2)} ${Math.round(d.att ?? 10)} ${dec(d.hold, 1)} ${Math.round(d.rel || 151)} ${Math.round(d.mix ?? 100)} SELF OFF`,
};

// What the X Air / MR is, for everything that has to know (#55).
export const xairDesk = {
  label: 'Behringer X Air / Midas MR', short: 'X Air', ext: 'scn', what: 'scene file', mime: 'text/plain',
  reads: ['scn'], partials: {},
  channels: 16, dcas: 4, muteGroups: 4, buses: 6, stereo: 'linked',
};
