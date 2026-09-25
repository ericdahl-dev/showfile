// The X Air's output GEQs carried to the X32 (#61). The X Air has a 31-band
// graphic EQ on each of its 6 buses and on the main; the X32 has none built
// in, so FX 5-8 become GEQs inserted on the same outputs: dual GEQs on buses
// 1-2, 3-4, 5-6 and a stereo GEQ on the main.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readScene, writeScene } from '../js/conversion.js';
import { num } from '../js/scene-text.js';

const meeting = readFileSync(new URL('./fixtures/real/hedgcoxekhav/meeting.scn', import.meta.url), 'utf8');

// A distinct curve per output, so a band landing in the wrong place shows.
const curve = (seed) => Array.from({ length: 31 }, (_, i) => ((i * 7 + seed * 5) % 25 - 12) / 2);
const setGeq = (text, node, gains) => text.replace(new RegExp(`^${node}/geq .*$`, 'm'), `${node}/geq ${gains.map(g => g.toFixed(1)).join(' ')}`);
const xair = [1, 2, 3, 4, 5, 6].reduce((t, b) => setGeq(t, `/bus/${b}`, curve(b)), setGeq(meeting, '/lr', curve(7)));

const toX32 = () => writeScene(readScene('xair', xair, 'meeting.scn'), 'x32').file.text;
const node = (text, path) => text.match(new RegExp(`^${path.replace(/\//g, '\\/')} (.*)$`, 'm'))?.[1];
const pars = (text, fx) => node(text, `/fx/${fx}/par`).trim().split(/\s+/).map(num);

test('X Air buses 1 and 2 arrive as X32 FX 5, a dual GEQ: bus 1 on side A, bus 2 on side B', () => {
  const text = toX32();
  assert.equal(node(text, '/fx/5'), 'GEQ2');
  const p = pars(text, 5);
  assert.deepEqual(p.slice(0, 31), curve(1));
  assert.equal(p[31], 0);                          // master A
  assert.deepEqual(p.slice(32, 63), curve(2));
  assert.equal(p[63], 0);                          // master B
});

test('buses 3-4 and 5-6 arrive as FX 6 and 7; the main as FX 8, a stereo GEQ', () => {
  const text = toX32();
  for (const [fx, a, b] of [[6, 3, 4], [7, 5, 6]]) {
    assert.equal(node(text, `/fx/${fx}`), 'GEQ2');
    const p = pars(text, fx);
    assert.deepEqual([p.slice(0, 31), p.slice(32, 63)], [curve(a), curve(b)], `FX ${fx}`);
  }
  assert.equal(node(text, '/fx/8'), 'GEQ');
  const main = pars(text, 8);
  assert.deepEqual(main.slice(0, 31), curve(7));
  assert.equal(main[31], 0);                       // master
});

test('buses 1-6 and the main have their GEQ inserted, each on its own side of the FX', () => {
  // As a real X32 show spells them: a dual effect's sides are FXnL / FXnR,
  // a stereo effect on the main is FXnL (GDQ: /main/st/insert ON PRE FX8L).
  const text = toX32();
  const want = { '01': 'FX5L', '02': 'FX5R', '03': 'FX6L', '04': 'FX6R', '05': 'FX7L', '06': 'FX7R' };
  for (const [bus, sel] of Object.entries(want)) assert.equal(node(text, `/bus/${bus}/insert`), `ON POST ${sel}`, `bus ${bus}`);
  assert.equal(node(text, '/main/st/insert'), 'ON POST FX8L');
});

test('the report says FX 5-8 now hold the GEQs', async () => {
  const { render } = await import('../js/losses.js');
  const out = writeScene(readScene('xair', xair, 'meeting.scn'), 'x32');
  const line = out.losses.find(l => l.code === 'fx.geq-slots');
  assert.equal(line?.severity, 'check');
  assert.match(render(line), /FX 5-8/);
  assert.match(render(line), /buses 1-6/);
});

test('a source without output GEQs (X32, Wing) leaves the X32\'s FX 5-8 and inserts alone', () => {
  for (const [desk, file] of [['x32', 'synthetic-x32.scn'], ['wing', 'real/gdq/pre-sgdq2025.snap']]) {
    const out = writeScene(readScene(desk, readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')), 'x32');
    assert.doesNotMatch(out.file.text, /^\/fx\/[5-8] |^\/bus\/0[1-6]\/insert |^\/main\/st\/insert /m, desk);
    assert.ok(!out.losses.some(l => l.code === 'fx.geq-slots'), desk);
  }
});
