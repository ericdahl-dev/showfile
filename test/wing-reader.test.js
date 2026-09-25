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
