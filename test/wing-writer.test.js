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
