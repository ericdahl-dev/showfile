// Each desk's reader and writer against each other (#52). One Scene that sets
// every channel field is written to a desk and read back; it must come back as
// it went in, unless the write's report says what changed. A reader and a
// writer that disagree both pass their own string tests, which is how the
// Wing tag-comma bug (#48) shipped. This catches that whole class.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readScene, writeScene } from '../js/conversion.js';
import { mapColor } from '../js/console-map.js';
import { fullScene } from './helpers/full-scene.js';

// Fields a desk has no place for. Leaving them out is the desk, not a bug.
const CANNOT_HOLD = {
  x32: [],
  xair: ['icon', 'hpf.slope'],        // no channel icons; a fixed 12 dB/oct low cut
  wing: [],
};

// Report codes that excuse a field changing on the channel they name.
const EXCUSES = {
  eq: ['eq.band-overflow', 'eq.lowcut-no-slot', 'eq.lowcut-to-filter', 'eq.mid-band-overflow', 'eq.model-unsupported'],
  hpf: ['eq.lowcut-to-filter'],
  gate: ['dyn.gate-ratio-snapped', 'dyn.model-unsupported'],
  dyn: ['dyn.ratio-snapped', 'dyn.model-unsupported'],
  sends: ['send.bus-overflow', 'send.tap-approximated', 'send.tap-shared'],
  patch: ['patch.aux-overflow', 'patch.group-unsupported', 'patch.group-unknown', 'patch.input-overflow', 'patch.block-granularity'],
  headamp: ['patch.group-unsupported', 'patch.input-overflow'],
  pan: ['stereo.balance-lost'],
  dcas: ['group.membership-dropped', 'dca.overflow'],
  muteGroups: ['group.membership-dropped'],
};

// The desk's view of a channel, with what the desk treats as nothing removed:
// flat EQ bands and switched-off sends are how writers blank a slot, an
// unknown preamp reads back as 0 dB, and a linked pair's left strip is "L".
function view(c) {
  const flatBand = (b) => (b.type === 'bell' || /shelf/.test(b.type)) && Number(b.g) === 0;
  const liveSend = (s) => s.on && typeof s.level === 'number' && s.level > -Infinity;
  const headamp = c.headamp || { gain: 0, phantom: false };
  return {
    name: c.name.replace(/ L$/, ''), stereo: c.stereo, icon: c.icon, color: mapColor(c.color, 'x32'),
    patch: c.patch, headamp: { gain: headamp.gain, phantom: headamp.phantom },
    hpf: c.hpf, fader: c.fader, muted: c.muted, pan: c.stereo ? 0 : c.pan,
    gate: c.gate, dyn: c.dyn,
    eq: c.eq.bands.filter(b => !flatBand(b)).map(({ type, f, g, q }) => ({ type, f, g, q })),
    sends: c.sends.filter(liveSend).map(({ bus, level, tap }) => ({ bus, level, tap })),
    dcas: c.dcas, muteGroups: c.muteGroups,
  };
}

function drop(v, path) {
  const [k, sub] = path.split('.');
  if (sub) { if (v[k]) v[k] = { ...v[k], [sub]: undefined }; } else delete v[k];
}

// Every unexcused difference, as "Vox patch: {…} -> {…}".
function unexplained(desk) {
  const scene = fullScene(desk);
  const out = writeScene(scene, desk);
  const back = readScene(desk, out.file.text, `identity.${out.file.ext}`);
  const found = [];
  for (const c of scene.channels) {
    const b = back.channels.find(x => x.name.replace(/ L$/, '') === c.name);
    if (!b) { found.push(`${c.name}: missing`); continue; }
    const [want, got] = [view(c), view(b)];
    for (const path of CANNOT_HOLD[desk]) { drop(want, path); drop(got, path); }
    for (const k of Object.keys(want)) {
      if (JSON.stringify(want[k]) === JSON.stringify(got[k])) continue;
      const excused = out.losses.some(l => (EXCUSES[k] || []).includes(l.code)
        && (!l.scope || l.scope.name === c.name || l.scope.name === b.name));
      if (!excused) found.push(`${c.name} ${k}: ${JSON.stringify(want[k])} -> ${JSON.stringify(got[k])}`);
    }
  }
  return found;
}

// Known disagreements, each with its issue. The desk tests below ignore these,
// so the suite stays green; each has its own todo test, which starts passing
// (and should then be removed from here) when the issue is fixed.
const KNOWN = {
  x32:  [],
  xair: [],
  wing: [],
};

for (const [desk, label] of [['x32', 'X32'], ['xair', 'X Air'], ['wing', 'Wing']]) {
  test(`${label}: a scene written and read back comes back unchanged`, () => {
    const known = KNOWN[desk];
    assert.deepEqual(unexplained(desk).filter(d => !known.some(k => k.line.test(d))), []);
  });

  for (const k of KNOWN[desk]) {
    test(`${label}: ${k.what} (#${k.issue})`, { todo: `#${k.issue}` }, () => {
      assert.deepEqual(unexplained(desk).filter(d => k.line.test(d)), []);
    });
  }
}
