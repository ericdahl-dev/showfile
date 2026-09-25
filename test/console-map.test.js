import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WING_PALETTE, X32_PALETTE, hexToRgb, xairIdxToX32Code, x32CodeToXairIdx,
  codeToHex, colorFrom, mapColor, x32IconToWing, wingIconToX32, snapRatio,
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

test('mapColor falls back to the target default with no color', () => {
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

test('all 16 X32 colors, inverted ones included, survive X32 -> X Air -> X32 (#25)', () => {
  // The real GDQ show uses RDi, GNi, MGi, OFFi...; real X Air scenes write 8-15.
  const codes = ['OFF', 'RD', 'GN', 'YE', 'BL', 'MG', 'CY', 'WH',
                 'OFFi', 'RDi', 'GNi', 'YEi', 'BLi', 'MGi', 'CYi', 'WHi'];
  const viaXair = codes.map(code => mapColor(colorFrom('xair', mapColor(colorFrom('x32', code), 'xair')), 'x32'));
  assert.deepEqual(viaXair, codes);
  assert.deepEqual(codes.map(code => mapColor(colorFrom('x32', code), 'xair')), [...Array(16).keys()]);
});

// Wing icon numbers are group base + position: general 0-14, vocals 100-114,
// drums 200-224, strings/winds 300-319, keys 400-409, speakers 500-524,
// specials 600-614 (WING protocol doc, p.246).
const WING_ICON_RANGES = [[0, 14], [100, 114], [200, 224], [300, 319], [400, 409], [500, 524], [600, 614]];
const isWingIcon = (n) => WING_ICON_RANGES.some(([lo, hi]) => n >= lo && n <= hi);

test('every X32 icon lands on a real Wing icon, matched by picture (#42)', () => {
  for (let i = 1; i <= 74; i++) assert.ok(isWingIcon(x32IconToWing(i)), `X32 icon ${i} -> ${x32IconToWing(i)}`);
  // The two desks draw the same pictures; a few that cannot be mistaken:
  assert.equal(x32IconToWing(37), 312);   // saxophone
  assert.equal(x32IconToWing(45), 603);   // talk A
  assert.equal(x32IconToWing(66), 523);   // line array
  assert.equal(x32IconToWing(27), 400);   // grand piano
  assert.equal(x32IconToWing(43), 112);   // choir
  assert.equal(x32IconToWing(1), 0);      // none
});

test('a Wing icon with an X32 picture comes back as that picture (#42)', () => {
  assert.equal(wingIconToX32(312), 37);
  assert.equal(wingIconToX32(603), 45);
  assert.equal(wingIconToX32(999), 1);    // unknown -> the X32's blank icon
});

test('a desk\'s send taps come back through its tap codec; a missing tap falls back to pre-fader', async () => {
  const { tapCodec } = await import('../js/console-map.js');
  const x32 = tapCodec(['IN/LC', '<-EQ', 'EQ->', 'PRE', 'POST', 'GRP']);
  for (const tap of ['input', 'preeq', 'posteq', 'pre', 'post', 'group']) assert.equal(x32.read(x32.write(tap).token), tap);
  const wing = tapCodec([null, null, null, 'PRE', 'POST', 'GRP']);
  assert.deepEqual(wing.write('posteq'), { token: 'PRE', exact: false });
  assert.equal(wing.read('???'), 'pre');
});

test('snapRatio picks the nearest ratio in the list it is given (#56)', () => {
  assert.deepEqual(snapRatio(7, [1.1, 2, 4, 6, 8]), { value: 6, exact: false });
  assert.deepEqual(snapRatio(4, [1.1, 2, 4]), { value: 4, exact: true });
});
