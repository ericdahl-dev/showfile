// The Wing reader against a real WING-EDIT export (test/fixtures/real).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readScene } from '../js/conversion.js';

const realWing = readFileSync(new URL('./fixtures/real/gdq/pre-sgdq2025.snap', import.meta.url), 'utf8');

test('a WING-EDIT export is a Wing file, not a model mismatch (#22)', () => {
  const scene = readScene('wing', realWing);
  assert.ok(!scene.warnings.some(w => /WING-EDIT/.test(w)), scene.warnings.join('\n'));
});

test('AES50-C, USB and bus sources are read, not left unpatched (#22)', () => {
  const scene = readScene('wing', realWing);
  assert.ok(!scene.warnings.some(w => /not one this converter knows/.test(w)), scene.warnings.join('\n'));
  const byName = Object.fromEntries(scene.channels.filter(c => c.name).map(c => [c.name, c.patch]));
  assert.deepEqual(byName['Headset 1'], { group: 'aes50c', input: 1 });
  assert.equal(byName['Music L/R'].group, 'usb');
  assert.equal(byName['VoxDuckKey'].group, 'bus');
});

// Edit one channel of the real snapshot and read it back.
function withChannel1(edit) {
  const snap = JSON.parse(realWing);
  edit(snap.ae_data.ch['1']);
  return readScene('wing', JSON.stringify(snap)).channels.find(c => c.ch === 1);
}

test('an outer EQ band set to PEQ is a bell, not a cut (#18)', () => {
  const c = withChannel1(ch => Object.assign(ch.eq, { leq: 'PEQ', lf: 120, lg: 3, heq: 'PEQ', hf: 9000, hg: -2 }));
  const low = c.eq.bands.find(b => b.f === 120);
  const high = c.eq.bands.find(b => b.f === 9000);
  assert.equal(low.type, 'bell');
  assert.equal(high.type, 'bell');
});

test('the filter block high cut is read as a high-cut band (#18)', () => {
  const c = withChannel1(ch => Object.assign(ch.flt, { hc: true, hcf: 8000 }));
  assert.deepEqual(c.eq.bands.filter(b => b.type === 'highcut').map(b => b.f), [8000]);
  const off = withChannel1(ch => Object.assign(ch.flt, { hc: false, hcf: 8000 }));
  assert.equal(off.eq.bands.filter(b => b.type === 'highcut').length, 0);
});

test('a gate slot holding another model is not read as a gate (#21)', () => {
  // The real ch 1 gate slot is a DS902 de-esser.
  const scene = readScene('wing', realWing);
  const c = scene.channels.find(ch => ch.ch === 1);
  assert.equal(c.gate.on, false);
  assert.ok(scene.warnings.some(w => /ch 1 .*DS902/.test(w)), scene.warnings.join('\n'));
  // A plain GATE model still reads as a gate.
  const gate = withChannel1(ch => { ch.gate = { on: true, mdl: 'GATE', thr: -30, range: 40 }; });
  assert.equal(gate.gate.on, true);
  assert.equal(gate.gate.thr, -30);
});
