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

test('sends to buses the target lacks are reported, not dropped silently (#3)', () => {
  // Vox (ch 3) sends to bus 10 at -6 dB; ch 3 also has a silent send to bus 12.
  const scene = readScene('x32', x32Text + '/ch/03/mix/10 ON -6.0 +0 POST\n/ch/03/mix/12 ON -oo +0 POST\n');
  const out = writeScene(scene, 'xair');                  // the X Air has six buses
  const lost = out.losses.filter(l => l.code === 'send.bus-overflow');
  assert.equal(lost.length, 1);
  assert.deepEqual(lost[0].detail.buses, [10]);           // a silent send is not worth a line
  assert.ok(out.warnings.some(w => /bus 10/.test(w) && /Vox/.test(w)), out.warnings.join('\n'));
  assert.equal(writeScene(scene, 'wing').losses.filter(l => l.code === 'send.bus-overflow').length, 0);
});

test('the X32 reports sends past its 16 buses', () => {
  const scene = readScene('x32', x32Text);
  scene.channels.find(c => c.name === 'Vox').sends.push({ bus: 20, on: true, level: -3, pan: 0, tap: 'POST' });
  const lost = writeScene(scene, 'x32').losses.filter(l => l.code === 'send.bus-overflow');
  assert.deepEqual(lost.map(l => l.detail.buses), [[20]]);
});

test('reading the wrong kind of file fails with a message a person can act on', () => {
  assert.throws(() => readScene('x32', 'not a scene'), /X32\/M32 \.scn/);
  assert.throws(() => readScene('nope', x32Text), /Unknown desk/);
});

test('compressor ratios snap to what the X Air and Wing offer (#19)', () => {
  const scene = readScene('x32', x32Text);
  const vox = scene.channels.find(c => c.name === 'Vox');
  vox.dyn = { ...vox.dyn, on: true, ratio: 10 };
  const xair = writeScene(scene, 'xair').file.text;
  assert.match(xair, /^\/ch\/\d\d\/dyn ON COMP \S+ \S+ \S+ 10 /m);

  vox.dyn = { ...vox.dyn, ratio: 7 };                        // an X32 ratio the Wing lacks
  const wing = writeScene(scene, 'wing');
  const node = Object.values(JSON.parse(wing.file.text).ae_data.ch).find(c => c.name === 'Vox');
  assert.equal(node.dyn.ratio, 6);
  assert.equal(wing.losses.filter(l => l.code === 'dyn.ratio-snapped').length, 1);
});

// Send taps: X32 and X Air have the same six, spelled differently.
const TAPS_X32 = ['IN/LC', '<-EQ', 'EQ->', 'PRE', 'POST', 'GRP'];
const TAPS_XAIR = ['IN', 'PREEQ', 'POSTEQ', 'PRE', 'POST', 'GRP'];

test('send taps carry between the X32 and X Air (#20)', () => {
  TAPS_X32.forEach((tap, i) => {
    const scene = readScene('x32', x32Text + `/ch/03/mix/03 ON -10.0 +0 ${tap} 0\n`);
    const xair = writeScene(scene, 'xair').file.text;
    const sent = xair.match(/^\/ch\/03\/mix\/03 \S+ \S+ (\S+)/m)[1];
    assert.equal(sent, TAPS_XAIR[i], `X32 ${tap}`);

    const back = writeScene(readScene('xair', xair, 'x.scn'), 'x32').file.text;
    assert.match(back, new RegExp(`^/ch/03/mix/03 \\S+ \\S+ \\S+ ${tap.replace(/[-/<>]/g, '\\$&')} `, 'm'), `X Air ${TAPS_XAIR[i]}`);
  });
});

test('the Wing keeps group sends and reports taps it lacks (#20)', () => {
  const real = readFileSync(new URL('./fixtures/real/gdq/pre-sgdq2025.snap', import.meta.url), 'utf8');
  const x32 = writeScene(readScene('wing', real), 'x32').file.text;
  assert.match(x32, /^\/ch\/\d\d\/mix\/\d[13579] \S+ \S+ \S+ GRP /m);          // Wing GRP -> X32 GRP

  const scene = readScene('x32', x32Text + '/ch/03/mix/03 ON -10.0 +0 EQ-> 0\n');
  const wing = writeScene(scene, 'wing');
  const vox = Object.values(JSON.parse(wing.file.text).ae_data.ch).find(c => c.name === 'Vox');
  assert.equal(vox.send['3'].mode, 'PRE');
  const lost = wing.losses.filter(l => l.code === 'send.tap-approximated');
  assert.deepEqual(lost.map(l => l.detail.buses), [[3]]);
});

test('X32 even buses carry on and level only, as the desk writes them (#20)', () => {
  const text = writeScene(readScene('x32', x32Text + '/ch/03/mix/02 ON -12.0\n'), 'x32').file.text;
  assert.match(text, /^\/ch\/03\/mix\/02 ON -12\.0$/m);
});

test('group and post-fader sends reach the Wing as GRP and POST (#20)', () => {
  const scene = readScene('x32', x32Text + '/ch/03/mix/05 ON -10.0 +0 GRP 0\n/ch/03/mix/07 ON -10.0 +0 POST 0\n');
  const vox = Object.values(JSON.parse(writeScene(scene, 'wing').file.text).ae_data.ch).find(c => c.name === 'Vox');
  assert.equal(vox.send['5'].mode, 'GRP');
  assert.equal(vox.send['7'].mode, 'POST');
});
