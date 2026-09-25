// Each Wing encoding in js/wing-codec.js read back is what was written (#53).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tags, conn, spare, gateModel, dynModel, filter } from '../js/wing-codec.js';

test('tags: DCAs and mute groups come back from their tag string', () => {
  for (const g of [{ dcas: [3], muteGroups: [1] }, { dcas: [1, 16], muteGroups: [] }, { dcas: [], muteGroups: [2, 8] }, { dcas: [], muteGroups: [] }]) {
    assert.deepEqual(tags.read(tags.write(g)), g);
  }
  assert.equal(tags.write({ dcas: [3], muteGroups: [1] }), '#D3,#M1');   // as WING-EDIT writes it
});

test('conn: every group the Wing names comes back; unpatched reads as no patch', () => {
  for (const group of ['local', 'aes50a', 'aes50b', 'aes50c', 'card', 'user', 'aux', 'usb', 'bus']) {
    assert.deepEqual(conn.read({ grp: conn.group(group), in: 5 }), { group, input: 5 });
  }
  assert.equal(conn.read(conn.off()), null);
  assert.equal(conn.group('dante'), undefined);
});

test('spare: a blanked channel is recognized as not a channel', () => {
  assert.ok(spare.is(spare.write()));
  assert.ok(!spare.is({ ...spare.write(), name: 'Vox' }));
  assert.ok(!spare.is({ ...spare.write(), in: { conn: { grp: 'LCL', in: 3 } } }));
});

test('gate and compressor models come back as the modes they were written from', () => {
  for (const g of [{ mode: 'gate', ratio: null }, { mode: 'duck', ratio: null }, { mode: 'exp', ratio: 3 }, { mode: 'exp', ratio: 1.5 }]) {
    assert.deepEqual(gateModel.read(gateModel.write(g)), g);
  }
  for (const mode of ['comp', 'exp']) assert.equal(dynModel.read({ mdl: dynModel.write({ mode }) }), mode);
});

test('filter: the high-pass and a high cut come back from the filter block', () => {
  const hpf = { on: true, slope: 24, freq: 80 };
  assert.deepEqual(filter.readHpf(filter.hpf(hpf)), hpf);
  assert.deepEqual(filter.readHighCut(filter.highCut(12000)), { type: 'highcut', f: 12000, g: 0, q: 1 });
  // An EQ low cut moved into the filter reads back as the high-pass (reported when written).
  assert.deepEqual(filter.readHpf(filter.lowCut(100)), { on: true, slope: 12, freq: 100 });
});
