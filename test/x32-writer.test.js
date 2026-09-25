// What the X32 writer puts in a scene file, checked against the X32's own
// rules (Patrick Maillot's unofficial X32/M32 OSC protocol document and his
// X32 emulator) and against a real scene off a desk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readScene, writeScene } from '../js/conversion.js';

const synthetic = readFileSync(new URL('./fixtures/synthetic-x32.scn', import.meta.url), 'utf8');
const realWing = readFileSync(new URL('./fixtures/real/gdq/pre-sgdq2025.snap', import.meta.url), 'utf8');

const routingIn = (text) => text.match(/^\/config\/routing\/IN (.*)$/m)[1].trim().split(/\s+/);

// The four channel-block tokens the desk accepts: fixed blocks of eight.
const BLOCK_TOKEN = /^(AN|A|B|CARD|UIN)(1-8|9-16|17-24|25-32|33-40|41-48)$/;

test('routing blocks always start on 1, 9, 17... (#13)', () => {
  // Patch the two channels to local inputs 3 and 5, so a start-voting writer
  // would pick "AN3-10".
  const scene = readScene('x32', synthetic);
  scene.channels[0].patch = { group: 'local', input: 3 };
  scene.channels[1].patch = { group: 'local', input: 5 };
  const tokens = routingIn(writeScene(scene, 'x32').file.text);
  for (const t of tokens.slice(0, 4)) assert.match(t, BLOCK_TOKEN, `token ${t}`);
});

test('routing blocks from a real Wing show are all valid (#13)', () => {
  const tokens = routingIn(writeScene(readScene('wing', realWing), 'x32').file.text);
  for (const t of tokens.slice(0, 4)) assert.match(t, BLOCK_TOKEN, `token ${t}`);
});

test('the aux-input token is AUX1-4 (#14)', () => {
  assert.equal(routingIn(writeScene(readScene('x32', synthetic), 'x32').file.text)[4], 'AUX1-4');
});

test('nothing is sent to the mono bus (#15)', () => {
  const text = writeScene(readScene('wing', realWing), 'x32').file.text;
  const mixes = text.split('\n').filter(l => /^\/(ch|bus)\/\d\d\/mix /.test(l));
  assert.ok(mixes.length >= 32);
  for (const l of mixes) assert.match(l, /\sOFF\s+-oo$/, l);
});

test('inputs the X32 has no route for are reported, not patched to local (#22)', () => {
  const out = writeScene(readScene('wing', realWing), 'x32');
  const lost = out.losses.filter(l => l.code === 'patch.group-unsupported');
  const groups = new Set(lost.map(l => l.detail.group));
  // The bus-sourced channel is Wing ch 40, past the X32's 32, so it never gets this far.
  assert.ok(groups.has('aes50c') && groups.has('usb'), [...groups].join(','));
  assert.ok(lost.some(l => /Headset 1/.test(l.detail.label)));
  // A channel on an unroutable input is not counted as local input in any block.
  const row = out.preview.find(p => p.name === 'Headset 1');
  assert.equal(row.patch, '—');
});

test('a cut survives when the X32 runs short of EQ bands (#18)', () => {
  // Five active bands plus a Wing high cut: something has to go, but not the cut.
  const snap = JSON.parse(realWing);
  Object.assign(snap.ae_data.ch['1'].eq, { lg: 2, '1g': 1, '2g': -3, '3g': 2, '4g': -1, hg: 3 });
  Object.assign(snap.ae_data.ch['1'].flt, { hc: true, hcf: 8000 });
  const text = writeScene(readScene('wing', JSON.stringify(snap)), 'x32').file.text;
  assert.match(text, /^\/ch\/01\/eq\/\d HCut 8000\.0 /m);
});
