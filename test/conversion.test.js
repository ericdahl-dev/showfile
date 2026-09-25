// Scene conversion through its one interface: read a desk's file, write it for
// another desk. Every pair the page offers goes through here.
//
// Source files for the X Air and Wing come from converting the synthetic X32
// fixture, so these prove the pairs agree with each other, not that a console
// will load the output (see round-trip.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESKS, canConvert, readScene, writeScene } from '../js/conversion.js';

const x32Text = readFileSync(new URL('./fixtures/synthetic-x32.scn', import.meta.url), 'utf8');

// A file for any desk, made from the X32 fixture.
function sourceFor(desk) {
  if (desk === 'x32') return x32Text;
  return writeScene(readScene('x32', x32Text), desk).file.text;
}

const PAIRS = [];
for (const from of Object.keys(DESKS)) {
  for (const to of Object.keys(DESKS)) if (from !== to) PAIRS.push([from, to]);
}

test('there are six desk pairs, and a desk never converts to itself', () => {
  assert.equal(PAIRS.length, 6);
  for (const [from, to] of PAIRS) assert.equal(canConvert(from, to), true, `${from}>${to}`);
  for (const desk of Object.keys(DESKS)) assert.equal(canConvert(desk, desk), false);
  assert.equal(canConvert('x32', 'nope'), false);
});

for (const [from, to] of PAIRS) {
  test(`${from} -> ${to} carries the named channels and names the file for the target`, () => {
    const scene = readScene(from, sourceFor(from), `show.${DESKS[from].ext}`);
    const out = writeScene(scene, to);

    assert.equal(out.file.ext, DESKS[to].ext);
    assert.equal(typeof out.file.text, 'string');
    assert.ok(out.file.text.length > 0);

    const names = out.preview.filter(p => p.name).map(p => p.name);
    assert.ok(names.includes('Keys L'), `${from}>${to}: ${names}`);
    assert.ok(names.includes('Vox'), `${from}>${to}: ${names}`);

    for (const w of out.warnings) assert.equal(typeof w, 'string');
  });
}

test('Wing output is a JSON snapshot file', () => {
  const out = writeScene(readScene('x32', x32Text), 'wing');
  assert.equal(out.file.ext, 'snap');
  assert.equal(out.file.mime, 'application/json');
  assert.equal(JSON.parse(out.file.text).type, 'snapshot.11');
});

test('.scn output is plain text', () => {
  const out = writeScene(readScene('x32', x32Text), 'xair');
  assert.equal(out.file.ext, 'scn');
  assert.equal(out.file.mime, 'text/plain');
});

test('stats count the DCAs the target actually received (#4)', () => {
  const eight = x32Text + Array.from({ length: 8 }, (_, i) =>
    `/dca/${i + 1}/config "DCA ${i + 1}" 1 GN\n/dca/${i + 1} ON 0.0`).join('\n') + '\n';
  const scene = readScene('x32', eight);
  assert.equal(writeScene(scene, 'wing').stats.dcas, 8);
  assert.equal(writeScene(scene, 'xair').stats.dcas, 4);    // the X Air has four
});

test('stats report channels, named channels and output size', () => {
  const out = writeScene(readScene('x32', x32Text), 'wing');
  assert.equal(out.stats.named, 2);
  assert.equal(out.stats.bytes, out.file.text.length);
  assert.ok(out.stats.channels >= 2);
});

test('include options turn sections off', () => {
  const scene = readScene('x32', x32Text);
  assert.match(writeScene(scene, 'xair').file.text, /"Vox"/);
  assert.doesNotMatch(writeScene(scene, 'xair', { names: false }).file.text, /"Vox"/);
});

test('reading the wrong kind of file fails with a message a person can act on', () => {
  assert.throws(() => readScene('x32', 'not a scene'), /X32\/M32 \.scn/);
  assert.throws(() => readScene('nope', x32Text), /Unknown desk/);
});
