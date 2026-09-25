// The Scene: the one shape every reader returns and every writer consumes.
// A reader that leaves a field out makes each writer guess, and a writer that
// guesses "nothing to write" leaves the previous show on the desk (#2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeChannel, PAIRINGS } from '../js/scene.js';
import { readScene, writeScene } from '../js/conversion.js';

const x32Text = readFileSync(new URL('./fixtures/synthetic-x32.scn', import.meta.url), 'utf8');
const sourceFor = (desk) => desk === 'x32' ? x32Text : writeScene(readScene('x32', x32Text), desk).file.text;

// What every channel in every Scene carries, whichever desk it came from.
function assertComplete(c, where) {
  const at = `${where} ch ${c.ch}`;
  assert.equal(typeof c.name, 'string', at);
  assert.ok(c.color && 'hex' in c.color, `${at} color`);
  assert.deepEqual(Object.keys(c.hpf).sort(), ['freq', 'on', 'slope'], `${at} hpf`);
  assert.equal(typeof c.eq.on, 'boolean', `${at} eq.on`);
  assert.ok(Array.isArray(c.eq.bands), `${at} eq.bands`);
  assert.equal(typeof c.gate.on, 'boolean', `${at} gate`);
  assert.equal(typeof c.dyn.on, 'boolean', `${at} dyn`);
  assert.ok(['PRE', 'POST'].includes(c.dyn.pos), `${at} dyn.pos`);
  for (const k of ['sends', 'dcas', 'muteGroups', 'srcChannels']) assert.ok(Array.isArray(c[k]), `${at} ${k}`);
  assert.ok(PAIRINGS.includes(c.pairing), `${at} pairing ${c.pairing}`);
  assert.equal(c.stereo, c.pairing !== 'mono', `${at} stereo agrees with pairing`);
}

test('makeChannel fills in a bare channel with a flat, switched-off strip', () => {
  const c = makeChannel({ ch: 5, name: 'Vox' });
  assertComplete(c, 'bare');
  assert.deepEqual(c.hpf, { on: false, slope: 24, freq: 20 });
  assert.deepEqual(c.eq, { on: false, bands: [] });
  assert.equal(c.gate.on, false);
  assert.equal(c.dyn.on, false);
  assert.equal(c.pairing, 'mono');
  assert.deepEqual(c.srcChannels, [5]);
});

test('makeChannel keeps what the reader did set', () => {
  const c = makeChannel({ ch: 1, name: 'Keys', pairing: 'linked', srcChannels: [1, 2],
    eq: { on: true, bands: [{ type: 'bell', f: 200, g: 2, q: 2 }] }, dyn: { on: true, thr: -12 } });
  assert.equal(c.stereo, true);
  assert.equal(c.eq.bands.length, 1);
  assert.equal(c.dyn.on, true);
  assert.equal(c.dyn.thr, -12);
  assert.equal(c.dyn.pos, 'POST');
});

test('a linked pair must name both source channels', () => {
  assert.throws(() => makeChannel({ ch: 1, pairing: 'linked', srcChannels: [1] }), /linked/);
  assert.throws(() => makeChannel({ ch: 1, pairing: 'sideways' }), /pairing/);
});

for (const desk of ['x32', 'xair', 'wing']) {
  test(`the ${desk} reader returns complete channels`, () => {
    const scene = readScene(desk, sourceFor(desk), 'show.scn');
    assert.ok(scene.channels.length >= 2);
    for (const c of scene.channels) assertComplete(c, desk);
    for (const k of ['buses', 'matrices', 'dcas', 'muteGroups']) assert.ok(Array.isArray(scene[k]), `${desk} ${k}`);
  });
}

test('pairing says where a stereo channel came from', () => {
  const byName = (s) => Object.fromEntries(s.channels.filter(c => c.name).map(c => [c.name, c.pairing]));
  assert.deepEqual(byName(readScene('x32', x32Text)), { 'Keys L': 'linked', Vox: 'mono' });
  assert.deepEqual(byName(readScene('wing', sourceFor('wing'))), { 'Keys L': 'native', Vox: 'mono' });
});

test('Wing to X32: a channel with no EQ or dynamics still overwrites the desk\'s (#2)', () => {
  const snap = JSON.parse(sourceFor('wing'));
  const ch = Object.values(snap.ae_data.ch).find(c => c.name === 'Vox');
  delete ch.eq; delete ch.gate; delete ch.dyn; delete ch.flt;

  const out = writeScene(readScene('wing', JSON.stringify(snap)), 'x32').file.text;
  const vox = out.match(/^\/ch\/(\d\d)\/config "Vox"/m)[1];
  for (const node of ['eq', 'eq/1', 'eq/2', 'eq/3', 'eq/4', 'gate', 'dyn', 'preamp']) {
    assert.match(out, new RegExp(`^/ch/${vox}/${node} `, 'm'), `missing /ch/${vox}/${node}`);
  }
  assert.match(out, new RegExp(`^/ch/${vox}/gate OFF `, 'm'));
});
