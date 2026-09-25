// What each desk says about itself (#55). Facts about a desk (its channel and
// DCA counts, the files it reads) live in one descriptor, which the writers
// and the page both use; the page's wording is built from them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESKS, writeScene, routeCopy, sourceHint } from '../js/conversion.js';
import { fullScene } from './helpers/full-scene.js';

// The page's wording before it was generated, kept as the spec.
const COPY = {
  'x32>wing':  { pairLabel: 'stereo pairs merged', hint: 'Snapshot covering all 40 channels. Ones your show does not use are cleared.' },
  'xair>wing': { pairLabel: 'stereo pairs merged', hint: 'Snapshot covering all 40 channels. Ones your show does not use are cleared.' },
  'xair>x32':  { pairLabel: 'stereo split to pairs', hint: 'Full scene file, all 32 channels. The X32 is the bigger desk, so they all fit — the patch is what to check.' },
  'x32>xair':  { pairLabel: 'stereo split to pairs', hint: 'Full scene file, all 16 channels. The X Air is the smaller desk, so expect to check the notes below.' },
  'wing>xair': { pairLabel: 'stereo split to pairs', hint: 'Full scene file, all 16 channels. The X Air is the smallest desk here, so expect the most to check.' },
  'wing>x32':  { pairLabel: 'stereo split to pairs', hint: 'Full scene file, all 32 channels. The X32 is the smaller desk, so expect to check the notes below.' },
};

for (const [key, want] of Object.entries(COPY)) {
  test(`the page's wording for ${key} comes from the desks`, () => {
    const [from, to] = key.split('>');
    assert.deepEqual(routeCopy(from, to), want);
  });
}

test('the source hint names every file a desk reads', () => {
  assert.equal(sourceHint('x32'), 'Expects a .scn scene file; .chn channel presets and .snp snippets work too.');
  assert.equal(sourceHint('wing'), 'Expects a .snap snapshot.');
});

test('each desk\'s channel and DCA counts are what its writer writes', () => {
  for (const [id, desk] of Object.entries(DESKS)) {
    const text = writeScene(fullScene(id), id).file.text;
    const channels = id === 'wing'
      ? Object.keys(JSON.parse(text).ae_data.ch).length
      : new Set(text.match(/^\/ch\/(\d\d)\/config /gm)).size;
    assert.equal(channels, desk.channels, `${id} channels`);
    const many = { ...fullScene(id), dcas: Array.from({ length: 20 }, (_, i) => ({ n: i + 1, name: `D${i + 1}`, fader: 0, muted: false, icon: 1, color: null })) };
    const out = writeScene(many, id).file.text;
    const dcas = id === 'wing'
      ? Object.keys(JSON.parse(out).ae_data.dca || {}).length
      : (out.match(/^\/dca\/\d+\/config /gm) || []).length;
    assert.equal(dcas, desk.dcas, `${id} dcas`);
  }
});
