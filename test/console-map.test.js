import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WING_PALETTE, X32_PALETTE, hexToRgb, xairIdxToX32Code, x32CodeToXairIdx,
  codeToHex, colorFrom, mapColor,
} from '../js/console-map.js';

test('the Wing palette has each of its 18 col values exactly once', () => {
  const cols = WING_PALETTE.map(e => e.col).sort((a, b) => a - b);
  assert.deepEqual(cols, Array.from({ length: 18 }, (_, i) => i + 1));
});

test('hexToRgb parses with or without # and rejects junk', () => {
  assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
  assert.deepEqual(hexToRgb('00FF00'), [0, 255, 0]);
  assert.equal(hexToRgb('red'), null);
});

test('X Air index and X32 code convert both ways', () => {
  for (const { code, idx } of X32_PALETTE) {
    assert.equal(xairIdxToX32Code(idx), code);
    assert.equal(x32CodeToXairIdx(code), idx);
  }
});

test('X32 green does not land on Wing blue (the index pass-through bug)', () => {
  const wing = mapColor(colorFrom('x32', 'GN'), 'wing');
  assert.notEqual(wing, 2);
  assert.equal(WING_PALETTE.find(e => e.col === wing).name, 'green');
});

test('mapColor falls back to the target default with no colour', () => {
  assert.equal(mapColor(null, 'x32'), 'WH');
  assert.equal(mapColor(null, 'wing'), 17);
  assert.equal(mapColor(null, 'xair'), 7);
});

test('codeToHex resolves each desk format', () => {
  assert.equal(codeToHex('x32', 'RD'), '#ff0000');
  assert.equal(codeToHex('xair', 4), '#0000ff');
  assert.equal(codeToHex('wing', 18), '#ebebeb');
  assert.equal(codeToHex('nope', 1), null);
});
