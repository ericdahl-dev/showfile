import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, num, bool, bits, parseNodes, INF } from '../js/scene-text.js';

test('tokenize keeps quoted names whole and collapses right-aligned padding', () => {
  assert.deepEqual(tokenize('"Kick In" 1 RD 1'), ['Kick In', '1', 'RD', '1']);
  assert.deepEqual(tokenize('ON   0.0  OFF'), ['ON', '0.0', 'OFF']);
  assert.deepEqual(tokenize('"" 1'), ['', '1']);
});

test('num reads -oo, compact kHz notation and falls back on junk', () => {
  assert.equal(num('-oo'), INF);
  assert.equal(num('3k43'), 3430);
  assert.equal(num('10k02'), 10020);
  assert.equal(num('1k'), 1000);
  assert.equal(num('-12.5'), -12.5);
  assert.equal(num('nope', 7), 7);
  assert.equal(num(undefined, 3), 3);
});

test('bool is ON-only', () => {
  assert.equal(bool('ON'), true);
  assert.equal(bool('OFF'), false);
  assert.equal(bool(undefined), false);
});

test('bits reads membership masks least-significant-bit first', () => {
  assert.deepEqual(bits('%0001'), [1]);
  assert.deepEqual(bits('%0100'), [3]);
  assert.deepEqual(bits('%10000001'), [1, 8]);
  assert.deepEqual(bits(''), []);
});

test('parseNodes maps paths to tokens and reads the header name', () => {
  const { nodes, header } = parseNodes('#4.0# "My Show" "" %000000000 1\r\n/ch/01/config "Vox" 1 RD 1\n\n/config/mute OFF ON\n');
  assert.equal(header, 'My Show');
  assert.deepEqual(nodes.get('/ch/01/config'), ['Vox', '1', 'RD', '1']);
  assert.deepEqual(nodes.get('/config/mute'), ['OFF', 'ON']);
});
