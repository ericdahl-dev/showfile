// What the X Air writer puts in a scene, checked against the X Air protocol:
// config = name color insrc rtnsrc; preamp = rtntrim rtnsw invert hpon hpf.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readScene, writeScene } from '../js/conversion.js';

const synthetic = readFileSync(new URL('./fixtures/synthetic-x32.scn', import.meta.url), 'utf8');
const line = (text, node) => text.match(new RegExp(`^/ch/03/${node} (.*)$`, 'm'))[1];

test('a USB-return channel sets the return source, switch and trim (#23)', () => {
  const scene = readScene('x32', synthetic);
  Object.assign(scene.channels.find(c => c.name === 'Vox'), { patch: { group: 'card', input: 3 }, trim: 4 });
  const text = writeScene(scene, 'xair').file.text;
  assert.match(line(text, 'config'), /^"Vox" \d+ In03 U03$/);
  assert.match(line(text, 'preamp'), /^\+4\.0 ON /);
});

test('an input channel has the return switch off and no trim to carry (#23)', () => {
  const scene = readScene('x32', synthetic);
  Object.assign(scene.channels.find(c => c.name === 'Vox'), { patch: { group: 'local', input: 5 }, trim: 6 });
  const out = writeScene(scene, 'xair');
  assert.match(line(out.file.text, 'config'), /^"Vox" \d+ In05 U03$/);
  assert.match(line(out.file.text, 'preamp'), /^\+0\.0 OFF /);
  const lost = out.losses.filter(l => l.code === 'preamp.trim-dropped');
  assert.equal(lost.length, 1);
  assert.equal(lost[0].detail.trim, 6);
});

test('names keep up to 16 characters on the X Air (#23)', () => {
  const scene = readScene('x32', synthetic);
  scene.channels.find(c => c.name === 'Vox').name = 'Lead Vocal Mic 1';        // 16
  scene.channels.find(c => c.name === 'Keys L').name = 'Backing Keys Syn L';   // stereo, 18
  const text = writeScene(scene, 'xair').file.text;
  assert.match(line(text, 'config'), /^"Lead Vocal Mic 1" /);
  assert.match(text, /^\/ch\/01\/config "Backing Keys S L" /m);                 // 14 + " L"
  assert.match(text, /^\/ch\/02\/config "Backing Keys S R" /m);
});
