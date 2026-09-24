// Round trips through every writer and back through the matching reader.
//
// The fixture is SYNTHETIC: hand-written from the node paths the X32 parser
// reads, not saved off a desk. These tests prove the readers and writers agree
// with each other. They do not prove a real console will load the output;
// that needs real .scn / .snap files from each desk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseX32Scene } from '../js/x32-scene.js';
import { parseXAirScene } from '../js/xair-scene.js';
import { parseWingSnapshot } from '../js/wing-scene.js';
import { emitX32Scene } from '../js/x32-emit.js';
import { emitXAirScene } from '../js/xair-emit.js';
import { emitWingSnapshot } from '../js/wing-snap.js';
import { renderAll } from '../js/losses.js';

const scn = readFileSync(new URL('./fixtures/synthetic-x32.scn', import.meta.url), 'utf8');

// The parts of a channel that should survive any desk-to-desk trip.
const essentials = (ir) => ir.channels
  .filter(c => c.name)
  .map(c => ({ name: c.name, stereo: c.stereo, hex: c.color.hex, fader: c.fader,
               muted: c.muted, dcas: c.dcas }));

const X32_EXPECTED = [
  { name: 'Keys L', stereo: true,  hex: '#00ff00', fader: -5, muted: false, dcas: [1] },
  { name: 'Vox',    stereo: false, hex: '#ff0000', fader: 0,  muted: true,  dcas: [3] },
];

test('the X32 reader merges linked pairs and reads the synthetic scene', () => {
  const ir = parseX32Scene(scn);
  assert.equal(ir.name, 'Synthetic');
  assert.deepEqual(essentials(ir), X32_EXPECTED);
  assert.deepEqual(ir.channels[0].srcChannels, [1, 2]);
  assert.equal(ir.channels[0].eq.bands[1].f, 3430);
  assert.deepEqual(ir.dcas.map(d => d.name), ['Keys', 'Vox']);
});

test('X32 -> Wing -> X32 comes back unchanged', () => {
  const wing = emitWingSnapshot(parseX32Scene(scn));
  const wir = parseWingSnapshot(JSON.stringify(wing.snapshot));
  assert.deepEqual(wir.channels.filter(c => c.name).map(c => c.name), ['Keys L', 'Vox']);

  const x32 = emitX32Scene(wir);
  assert.deepEqual(essentials(parseX32Scene(x32.text)), X32_EXPECTED);
});

test('X32 -> X Air keeps names, colours, levels and DCAs', () => {
  const out = emitXAirScene(parseX32Scene(scn));
  assert.deepEqual(essentials(parseXAirScene(out.text, 'converted.scn')), X32_EXPECTED);
});

test('the X32 writer fills every slot, so the previous show is cleared', () => {
  const out = emitX32Scene(parseX32Scene(scn));
  for (let n = 1; n <= 32; n++) {
    assert.match(out.text, new RegExp(`^/ch/${String(n).padStart(2, '0')}/config `, 'm'), `ch ${n}`);
  }
});

test('every writer reports its losses as renderable text', () => {
  const ir = parseX32Scene(scn);
  for (const out of [emitWingSnapshot(ir), emitX32Scene(ir), emitXAirScene(ir)]) {
    for (const line of renderAll(out.warnings)) assert.equal(typeof line, 'string');
  }
});

test('an X Air scene is refused by the X32 reader', () => {
  const xair = emitXAirScene(parseX32Scene(scn)).text;
  assert.throws(() => parseX32Scene(xair), /X Air scene/);
});
