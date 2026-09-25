// What the Wing writer puts in a snapshot, checked against the WING protocol
// document (channel EQ outer bands are PEQ or SHV; cuts live in flt).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readScene, writeScene } from '../js/conversion.js';

const synthetic = readFileSync(new URL('./fixtures/synthetic-x32.scn', import.meta.url), 'utf8');
const wingChannel = (text, name) =>
  Object.values(JSON.parse(text).ae_data.ch).find(c => c.name === name);

test('an X32 high cut becomes the Wing high-cut filter, not a bell (#18)', () => {
  const scene = readScene('x32', synthetic + '/ch/03/eq/4 HCut 8k00 +0.0 1.0\n');
  const vox = wingChannel(writeScene(scene, 'wing').file.text, 'Vox');
  assert.equal(vox.flt.hc, true);
  assert.equal(vox.flt.hcf, 8000);
  assert.notEqual(vox.eq.hf, 8000);          // not squeezed into the EQ's outer band
  assert.ok(['PEQ', 'SHV'].includes(vox.eq.heq));
});

test('bus, USB and AES50-C sources carry over to the Wing (#16, #22)', () => {
  const scene = readScene('x32', synthetic);
  scene.channels[1].patch = { group: 'bus', input: 11 };
  const out = writeScene(scene, 'wing');
  assert.equal(out.losses.filter(l => l.code === 'patch.group-unsupported').length, 0);
  assert.deepEqual(wingChannel(out.file.text, 'Vox').in.conn, { grp: 'BUS', in: 11 });
});

test('the gate is written as the Wing GATE model (#21)', () => {
  const vox = wingChannel(writeScene(readScene('x32', synthetic), 'wing').file.text, 'Vox');
  assert.equal(vox.gate.mdl, 'GATE');
});

test('stereo is recorded on the input, not as a strip mode, headamp or not (#21)', () => {
  const scene = readScene('x32', synthetic);
  const keys = scene.channels.find(c => c.name === 'Keys L');
  keys.headamp = null;                                    // e.g. a card input, no preamp
  keys.patch = { group: 'card', input: 3 };
  const snap = JSON.parse(writeScene(scene, 'wing').file.text);
  const node = Object.values(snap.ae_data.ch).find(c => c.name === 'Keys L');
  assert.equal(node.mode, undefined);
  assert.equal(snap.ae_data.io.in.CRD['3'].mode, 'ST');
});

test('values outside the Wing ranges are clamped and reported (#21)', () => {
  const scene = readScene('x32', synthetic);
  const vox = scene.channels.find(c => c.name === 'Vox');
  vox.dyn = { ...vox.dyn, gain: 20 };                       // X32 allows 0..24, Wing -6..12
  vox.headamp = { gain: 55, phantom: false };                // X32 -12..60, Wing local -3..45.5
  vox.patch = { group: 'local', input: 3 };
  vox.eq = { on: true, bands: [{ type: 'bell', f: 1000, g: 3, q: 0.3 }] };   // Wing Q >= 0.44
  const out = writeScene(scene, 'wing');
  const snap = JSON.parse(out.file.text);
  const node = Object.values(snap.ae_data.ch).find(c => c.name === 'Vox');
  assert.equal(node.dyn.gain, 12);
  assert.equal(snap.ae_data.io.in.LCL['3'].g, 45.5);
  assert.equal(node.eq['1q'], 0.44);
  const clamped = out.losses.filter(l => l.code === 'range.clamped').map(l => l.detail.what).sort();
  assert.deepEqual(clamped, ['compressor gain', 'preamp gain']);
});

test('channels the show does not reach are cleared of icon, color and patch too', () => {
  // WING-EDIT kept the last snapshot's icons on them: blanking only the name
  // and fader leaves the previous show showing through.
  const out = writeScene(readScene('x32', synthetic), 'wing');
  const snap = JSON.parse(out.file.text);
  const spare = snap.ae_data.ch['40'];
  assert.equal(spare.icon, 0);
  assert.equal(spare.col, 17);                               // grey: the Wing has no "no color"
  assert.equal(spare.in?.conn?.grp, 'OFF');
  // Read back, the cleared channels are still not channels.
  assert.equal(readScene('wing', out.file.text).channels.length, readScene('x32', synthetic).channels.length);
});

test('DCA and mute-group tags are comma-separated, as WING-EDIT writes them (#24)', () => {
  // Real WING-EDIT 3.1 snapshot: "#D1,#M1". Written run together ("#D3#M1"),
  // WING-EDIT 3.3.3 honoured neither tag.
  const snap = JSON.parse(writeScene(readScene('x32', synthetic), 'wing').file.text);
  const vox = Object.values(snap.ae_data.ch).find(c => c.name === 'Vox');
  assert.equal(vox.tags, '#D3,#M1');
});
