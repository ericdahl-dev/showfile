// Real scene files off real desks (see test/fixtures/real/SOURCES.md). These
// are the tests that say something about consoles rather than about our own
// readers and writers agreeing with each other.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESKS, readScene, writeScene } from '../js/conversion.js';
import { PAIRINGS } from '../js/scene.js';

const fixture = (p) => readFileSync(new URL(`./fixtures/real/${p}`, import.meta.url), 'utf8');

const REAL = [
  { desk: 'x32',  file: 'gdq/sgdq2023-post.scn',          named: 15, first: 'Interview 1' },
  { desk: 'wing', file: 'gdq/pre-sgdq2025.snap',          named: 10, first: 'Headset 1' },
  { desk: 'xair', file: 'hedgcoxekhav/meeting.scn',       named: 7,  first: 'CL PC L' },
  { desk: 'xair', file: 'hedgcoxekhav/initialized.scn',   named: 0 },
];

for (const r of REAL) {
  test(`reads ${r.file}`, () => {
    const scene = readScene(r.desk, fixture(r.file), r.file);
    const named = scene.channels.filter(c => c.name);
    assert.equal(named.length, r.named);
    if (r.first) assert.equal(named[0].name, r.first);
    for (const c of scene.channels) assert.ok(PAIRINGS.includes(c.pairing), `ch ${c.ch}`);
  });

  for (const to of Object.keys(DESKS).filter(d => d !== r.desk)) {
    test(`converts ${r.file} to ${to}`, () => {
      const out = writeScene(readScene(r.desk, fixture(r.file), r.file), to);
      assert.ok(out.file.text.length > 0);
      for (const w of out.warnings) assert.equal(typeof w, 'string');
      if (to === 'wing') JSON.parse(out.file.text);
    });
  }
}

test('a real X32 scene keeps its stereo pairs and patch', () => {
  const scene = readScene('x32', fixture('gdq/sgdq2023-post.scn'));
  const byName = Object.fromEntries(scene.channels.filter(c => c.name).map(c => [c.name, c]));
  assert.equal(byName['PC L'].pairing, 'linked');
  assert.deepEqual(byName['PC L'].srcChannels, [9, 10]);
  assert.deepEqual(byName['Interview 1'].patch, { group: 'local', input: 1 });
});

test('a real X32 channel is patched from its own source, not its channel number (#16)', () => {
  const scene = readScene('x32', fixture('gdq/sgdq2023-post.scn'));
  const ch = (n) => scene.channels.find(c => c.srcChannels.includes(n));
  assert.deepEqual(ch(9).patch, { group: 'aux', input: 1 });          // source 33 = Aux 1
  assert.deepEqual(ch(11).patch, { group: 'aes50a', input: 45 });     // source 29 = routing slot 29 = A41-48, 5th
  assert.equal(ch(6).patch, null);                                     // source 0 = OFF
});

test('an X Air channel switched to its USB return plays that return (#23)', () => {
  const scene = readScene('xair', fixture('hedgcoxekhav/meeting.scn'), 'meeting.scn');
  const ch = (n) => scene.channels.find(c => c.srcChannels.includes(n));
  // ch 1: config "... In01 U01", preamp "+3.0 ON ..." -> USB return 1, trim +3.
  assert.deepEqual(ch(1).patch, { group: 'card', input: 1 });
  assert.equal(ch(1).trim, 3);
  // ch 3: return switch OFF -> the local input; the X Air has no digital trim there.
  assert.equal(ch(3).patch.group, 'local');
  assert.equal(ch(3).trim, 0);
});
