// The X32 reader against small hand-written scenes, one behaviour each.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseX32Scene } from '../js/x32-scene.js';

// A scene whose channels 1-8 come through the user routing table (UIN1-8),
// with the table's first eight slots as given.
function userRouted(slots) {
  const table = [...slots, ...Array(32 - slots.length).fill(0)];
  return [
    '#4.0# "UIN" "" %000000000 1',
    '/config/userrout/in ' + table.join(' '),
    '/config/routing/IN UIN1-8 AN9-16 AN17-24 AN25-32 AUX1-4',
    ...slots.flatMap((_, i) => {
      const id = String(i + 1).padStart(2, '0');
      return [`/ch/${id}/config "Ch ${i + 1}" 1 WH ${i + 1}`,
              `/ch/${id}/preamp +0.0 OFF ON 24 100`, `/ch/${id}/eq ON`];
    }),
  ].join('\n') + '\n';
}

test('a UIN block is followed through /config/userrout/in to the real input (#17)', () => {
  const ir = parseX32Scene(userRouted([35]));        // user slot 1 = AES50-A 3
  assert.deepEqual(ir.channels[0].patch, { group: 'aes50a', input: 3 });
});

test('every input class in the user routing table resolves, at both ends of its range (#17)', () => {
  const cases = [
    [1, { group: 'local', input: 1 }],   [32, { group: 'local', input: 32 }],
    [33, { group: 'aes50a', input: 1 }], [80, { group: 'aes50a', input: 48 }],
    [81, { group: 'aes50b', input: 1 }], [128, { group: 'aes50b', input: 48 }],
    [129, { group: 'card', input: 1 }],  [160, { group: 'card', input: 32 }],
  ];
  const ir = parseX32Scene(userRouted(cases.map(c => c[0])));
  assert.deepEqual(ir.channels.map(c => c.patch), cases.map(c => c[1]));
});

test('aux inputs resolve; OFF is unpatched; talkback is unpatched and reported (#17)', () => {
  const ir = parseX32Scene(userRouted([161, 166, 0, 167, 168]));
  assert.deepEqual(ir.channels.map(c => c.patch),
    [{ group: 'aux', input: 1 }, { group: 'aux', input: 6 }, null, null, null]);
  const reported = ir.losses.filter(l => l.code === 'patch.group-unknown');
  assert.deepEqual(reported.map(l => l.detail.group), ['talkback', 'talkback']);
});

test('a user-routed channel takes the gain and phantom of the input it resolves to (#17)', () => {
  const ir = parseX32Scene(userRouted([35]) + '/headamp/034 +40.0 ON\n');   // AES50-A 3
  assert.deepEqual(ir.channels[0].headamp, { gain: 40, phantom: true });
});
