// Each .scn encoding read back is what was written (#54): the tokens both
// .scn desks share (scn-codec.js) and each desk's own (x32-codec.js,
// xair-codec.js). Spellings are pinned against real files elsewhere
// (real-scenes, xair-writer); these check the two directions agree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../js/scene-text.js';
import { membership, eqBand, eqLine, gateMode, dynModes } from '../js/scn-codec.js';
import * as x32 from '../js/x32-codec.js';
import * as xair from '../js/xair-codec.js';

const args = (line) => tokenize(line);

test('membership masks come back, least-significant bit first', () => {
  for (const m of [[1], [3], [1, 8], [], [2, 4, 6]]) assert.deepEqual(membership.read(membership.write(m, 8)), m);
  assert.equal(membership.write([1], 4), '%0001');
});

test('EQ band types and lines come back', () => {
  for (const type of ['lowcut', 'lowshelf', 'bell', 'highshelf', 'highcut']) assert.equal(eqBand.read(eqBand.write(type)), type);
  const band = { type: 'highshelf', f: 10020, g: 1.5, q: 0.7 };
  assert.deepEqual(eqLine.read(args(eqLine.write(band))), band);
});

test('gate and compressor modes come back', () => {
  for (const g of [{ mode: 'gate', ratio: null }, { mode: 'duck', ratio: null }, { mode: 'exp', ratio: 2 }, { mode: 'exp', ratio: 4 }]) {
    assert.deepEqual(gateMode.read(gateMode.write(g)), g);
  }
  for (const d of [{ mode: 'comp', det: 'PEAK', env: 'LOG' }, { mode: 'exp', det: 'RMS', env: 'LIN' }]) {
    assert.deepEqual(dynModes.read(['ON', ...dynModes.write(d).split(' ')]), d);
  }
});

for (const [name, codec, gate, dyn] of [
  ['X32', x32, { on: true, mode: 'exp', ratio: 3, thr: -40, range: 30, att: 10, hold: 50, rel: 200 },
    { on: true, mode: 'comp', det: 'RMS', env: 'LOG', thr: -20, ratio: 4, knee: 2, gain: 3, att: 10, hold: 20, rel: 150, pos: 'POST', mix: 100 }],
  ['X Air', xair, { on: true, mode: 'duck', ratio: null, thr: -24, range: 6, att: 0, hold: 500, rel: 800 },
    { on: true, mode: 'exp', det: 'PEAK', env: 'LIN', thr: -30, ratio: 2, knee: 0, gain: 0, att: 5, hold: 10, rel: 100, mix: 100 }],
]) {
  test(`${name}: gate and compressor lines come back field for field`, () => {
    assert.deepEqual(codec.gateLine.read(args(codec.gateLine.write(gate))), gate);
    assert.deepEqual(codec.dynLine.read(args(codec.dynLine.write(dyn, dyn.ratio))), dyn);
  });
}

test('X32: routing blocks, channel sources and headamp slots come back', () => {
  for (const group of ['local', 'aes50a', 'aes50b', 'card']) {
    assert.deepEqual(x32.routingBlock.read(`${x32.routingBlock.prefix(group)}9-16`), { group, start: 9 });
  }
  for (const [group, size] of [['aux', 6], ['usb', 2], ['fx', 8], ['bus', 16]]) {
    for (const input of [1, size]) {
      const via = x32.channelSource.write({ group, input });
      assert.deepEqual(x32.channelSource.read(via.base + input), { group, input });
    }
  }
  assert.deepEqual(x32.channelSource.read(5), { slot: 5 });
  assert.equal(x32.headampIndex({ group: 'aes50b', input: 1 }), 80);
  assert.equal(x32.headampIndex({ group: 'card', input: 1 }), null);
});

test('X32: a spare slot reads back as padding, a real channel does not', () => {
  const lines = x32.spareSlot.write(7, { levels: true, groups: true }, () => '-oo');
  assert.ok(x32.spareSlot.is(args(lines[0].replace(/^\S+ /, '')), [], []));
  assert.ok(!x32.spareSlot.is(['Vox', '1', 'RD', '7'], [], []));
});

test('X Air: every source token comes back', () => {
  for (const p of [{ group: 'local', input: 3 }, { group: 'card', input: 12 }]) {
    assert.deepEqual(xair.source.read(`${xair.source.prefix(p.group)}${String(p.input).padStart(2, '0')}`), p);
  }
  for (const input of [1, 2]) assert.deepEqual(xair.source.read(xair.source.aux(input)), { group: 'aux', input });
  assert.equal(xair.source.aux(3), undefined);
});
