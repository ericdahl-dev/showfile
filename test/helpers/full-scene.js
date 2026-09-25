// One Scene that sets every channel field to something each desk can hold,
// for the codec identity test: written to a desk and read back, it should
// come back as it went in.

import { makeChannel } from '../../js/scene.js';
import { colorFrom } from '../../js/console-map.js';

export function fullScene(desk) {
  // The .scn desks glue stereo from a linked pair; the Wing has it natively.
  const stereo = desk === 'wing' ? { pairing: 'native', srcChannels: [3] } : { pairing: 'linked', srcChannels: [3, 4] };
  const channels = [
    makeChannel({
      ch: 1, index: 1, name: 'Kick', icon: 2, color: colorFrom('x32', 'RD'),
      patch: { group: 'local', input: 1 }, headamp: { gain: 30, phantom: false },
      hpf: { on: true, slope: 24, freq: 80 }, fader: -5, muted: false, pan: -20,
      gate: { on: true, mode: 'exp', ratio: 3, thr: -40, range: 30, att: 10, hold: 50, rel: 200 },
      dyn: { on: true, mode: 'comp', det: 'RMS', env: 'LOG', thr: -20, ratio: 4, knee: 2, gain: 3, att: 10, hold: 20, rel: 150, pos: 'POST', mix: 100 },
      eq: { on: true, bands: [
        { type: 'lowcut', f: 60, g: 0, q: 1 },
        { type: 'bell', f: 250, g: -3, q: 1.4 },
        { type: 'bell', f: 3000, g: 2, q: 1 },
        { type: 'highshelf', f: 10000, g: 1.5, q: 0.7 },
      ] },
      sends: [{ bus: 1, on: true, level: -10, pan: 0, tap: 'post' }, { bus: 2, on: true, level: -6, pan: 0, tap: 'pre' }],
      dcas: [1], muteGroups: [2],
    }),
    makeChannel({
      ch: 2, index: 2, name: 'Vox', icon: 50, color: colorFrom('x32', 'GN'),
      patch: { group: 'aux', input: 2 }, fader: 0, muted: true, pan: 10,
      gate: { on: true, mode: 'duck', ratio: null, thr: -24, range: 6, att: 20, hold: 500, rel: 800 },
      dyn: { on: true, mode: 'exp', det: 'PEAK', env: 'LIN', thr: -30, ratio: 2, knee: 1, gain: 0, att: 5, hold: 10, rel: 100, pos: 'POST', mix: 100 },
      eq: { on: true, bands: [{ type: 'lowcut', f: 100, g: 0, q: 1 }, { type: 'bell', f: 1000, g: -2, q: 2 }] },
      dcas: [2], muteGroups: [1],
    }),
    makeChannel({
      ch: 3, index: 3, name: 'Keys', icon: 27, color: colorFrom('x32', 'BL'), ...stereo,
      patch: { group: 'local', input: 3 }, fader: -3, muted: false,
      dcas: [1, 2],
    }),
  ];
  const dcas = [
    { n: 1, name: 'Band', color: colorFrom('x32', 'YE'), icon: 1, fader: -2, muted: false },
    { n: 2, name: 'Vocals', color: colorFrom('x32', 'MG'), icon: 1, fader: 0, muted: true },
  ];
  return { format: 'neutral', name: 'Identity', channels, dcas, buses: [], matrices: [], muteGroups: [], losses: [], warnings: [] };
}
