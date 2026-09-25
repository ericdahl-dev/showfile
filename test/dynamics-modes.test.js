// Gate and compressor modes across desks. A gate can be a hard gate, an
// expander at some ratio, or a ducker; a compressor can be a compressor or an
// expander. Every desk here has all of them, spelled differently:
//   X32 / X Air: /ch/NN/gate ON EXP3 ...   (GATE, EXP2, EXP3, EXP4, DUCK)
//                /ch/NN/dyn  ON COMP ...   (COMP, EXP)
//   Wing:        gate { mdl: 'GATE', ratio: '1:3' } or { mdl: 'DUCK' }
//                dyn  { mdl: 'COMP' } or { mdl: 'EXP' }

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readScene, writeScene } from '../js/conversion.js';

const fixture = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');
const gdqX32 = fixture('real/gdq/sgdq2023-post.scn');

const wingChannel = (out, name) =>
  Object.values(JSON.parse(out.file.text).ae_data.ch).find(c => c.name === name);

test('an X32 expander gate arrives on the Wing as its gate at the same ratio', () => {
  const out = writeScene(readScene('x32', gdqX32), 'wing');
  const g = wingChannel(out, 'Interview 1').gate;            // X32: gate ON EXP3
  assert.deepEqual({ mdl: g.mdl, ratio: g.ratio }, { mdl: 'GATE', ratio: '1:3' });
});

test('an X32 ducker arrives on the Wing as its ducker, with its settings', () => {
  // GDQ snippet: /ch/18/gate ON DUCK -24.0 6.0 100 2000 4000 49
  const out = writeScene(readScene('x32', fixture('real/gdq/snippet-rtmp1.snp')), 'wing');
  const g = wingChannel(out, 'RTMP 1 Game').gate;
  assert.deepEqual({ mdl: g.mdl, thr: g.thr, range: g.range, att: g.att, hld: g.hld, rel: g.rel, ratio: g.ratio },
    { mdl: 'DUCK', thr: -24, range: 6, att: 100, hld: 2000, rel: 4000, ratio: undefined });
});

const gdqWing = fixture('real/gdq/pre-sgdq2025.snap');

test('the Wing reader keeps an expander\'s ratio and reads a ducker as a ducker', () => {
  const scene = readScene('wing', gdqWing);
  const gate = (n) => scene.channels.find(c => c.index === n).gate;
  assert.deepEqual([gate(9).mode, gate(10).mode, gate(10).ratio], ['duck', 'exp', 3]);
  assert.ok(!scene.losses.some(l => l.code === 'dyn.model-unsupported' && l.detail.model === 'DUCK'));
});

const synthetic = fixture('synthetic-x32.scn');
const gateLine = (text, ch) => text.split('\n').find(l => l.startsWith(`/ch/${ch}/gate `));

for (const to of ['x32', 'xair']) {
  test(`the ${to} writer writes the gate's mode: gate, EXP2-4 or DUCK`, () => {
    const scene = readScene('x32', synthetic);                // Keys (pair), Vox
    scene.channels[0].gate = { ...scene.channels[0].gate, on: true, mode: 'exp', ratio: 3 };
    scene.channels[1].gate = { ...scene.channels[1].gate, on: true, mode: 'duck', ratio: null };
    const text = writeScene(scene, to === 'x32' ? 'xair' : 'x32').file.text;   // via the other .scn desk
    const back = writeScene(readScene(to === 'x32' ? 'xair' : 'x32', text, 'a.scn'), to).file.text;
    assert.equal(gateLine(back, '01').split(/\s+/)[2], 'EXP3');
    assert.equal(gateLine(back, '03').split(/\s+/)[2], 'DUCK');
  });
}

test('a Wing 1:1.5 expander becomes EXP2 on the X32, and the report says so', () => {
  const snap = JSON.parse(gdqWing);
  snap.ae_data.ch['10'].name = 'Soft Exp';
  snap.ae_data.ch['10'].gate.ratio = '1:1.5';
  const out = writeScene(readScene('wing', JSON.stringify(snap)), 'x32');
  const id = out.preview.find(p => p.name === 'Soft Exp').n;
  assert.equal(gateLine(out.file.text, String(id).padStart(2, '0')).split(/\s+/)[2], 'EXP2');
  const line = out.losses.find(l => l.code === 'dyn.gate-ratio-snapped');
  assert.deepEqual({ from: line.detail.from, to: line.detail.to }, { from: 1.5, to: 2 });
});

test('a compressor in expander mode stays an expander, X32 -> Wing -> X32', () => {
  const x32 = synthetic.replace(/^\/ch\/03\/mix .*$/m, (l) => l + '\n/ch/03/dyn ON EXP RMS LOG -30.0 2.0 1 0.00 10 10.00 151 POST 0 100 OFF');
  const wing = writeScene(readScene('x32', x32), 'wing');
  assert.equal(wingChannel(wing, 'Vox').dyn.mdl, 'EXP');
  const back = writeScene(readScene('wing', wing.file.text), 'x32');
  const id = String(back.preview.find(p => p.name === 'Vox').n).padStart(2, '0');
  assert.equal(back.file.text.split('\n').find(l => l.startsWith(`/ch/${id}/dyn `)).split(/\s+/)[2], 'EXP');
});

test('a compressor in expander mode stays an expander, X32 -> X Air -> X32', () => {
  const x32 = synthetic.replace(/^\/ch\/03\/mix .*$/m, (l) => l + '\n/ch/03/dyn ON EXP RMS LOG -30.0 2.0 1 0.00 10 10.00 151 POST 0 100 OFF');
  const xair = writeScene(readScene('x32', x32), 'xair');
  const back = writeScene(readScene('xair', xair.file.text, 'a.scn'), 'x32');
  const id = String(back.preview.find(p => p.name === 'Vox').n).padStart(2, '0');
  assert.equal(back.file.text.split('\n').find(l => l.startsWith(`/ch/${id}/dyn `)).split(/\s+/)[2], 'EXP');
});

test('a Wing EQ model other than STD is reported and left flat, not misread as STD', () => {
  // SOUL's "lf" is a knob position (0-10), not Hz: read as STD it would be a 5 Hz band.
  const snap = JSON.parse(gdqWing);
  snap.ae_data.ch['1'].eq = { on: true, mdl: 'SOUL', mix: 100, lf: 5, lg: 3, lmf: 5, lmf3: 0, lmq: 5, lmg: -2, hmf: 5, hmf3: 0, hmq: 5, hmg: 1, hf: 5, hg: 2 };
  const scene = readScene('wing', JSON.stringify(snap));
  assert.deepEqual(scene.channels.find(c => c.name === 'Headset 1').eq.bands, []);
  const line = scene.losses.find(l => l.code === 'eq.model-unsupported');
  assert.deepEqual({ label: line.detail.label, model: line.detail.model }, { label: 'ch 1 "Headset 1"', model: 'SOUL' });
});
