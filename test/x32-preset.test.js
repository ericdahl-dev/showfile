// X32 channel presets (.chn) and snippets (.snp) read as partial scenes.
//
// synthetic-x32.chn is hand-written in the shape of real presets off desks;
// the snippets are real, from GamesDoneQuick (MIT; see fixtures/real/SOURCES.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readScene, writeScene, accepts } from '../js/conversion.js';
import { render } from '../js/losses.js';

const fixture = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');
const chn = fixture('synthetic-x32.chn');

test('a channel preset reads as one channel, with its name, color, EQ and dynamics', () => {
  const scene = readScene('x32', chn, 'Lead Vox.chn');
  assert.equal(scene.channels.length, 1);
  const [c] = scene.channels;
  assert.equal(c.name, 'Lead Vox');
  assert.equal(c.color.hex, '#ff0000');
  assert.equal(c.fader, -3);
  assert.deepEqual(c.eq.bands.map(b => b.type), ['lowcut', 'bell', 'bell', 'highshelf']);
  assert.equal(c.eq.bands[2].f, 3000);
  assert.equal(c.dyn.thr, -20);
});

test('a channel preset keeps its preamp gain and phantom but claims no input patch', () => {
  const [c] = readScene('x32', chn).channels;
  assert.deepEqual(c.headamp, { gain: 34, phantom: true });
  assert.equal(c.patch, null);
});

test('the report says a preset became a whole scene, whichever desk it is written for', () => {
  const scene = readScene('x32', chn);
  for (const to of ['wing', 'xair']) {
    const line = writeScene(scene, to).losses.find(l => l.code === 'file.channel-preset');
    assert.ok(line, to);
    assert.match(render(line), /channel preset "Lead Vox"/);
    assert.match(render(line), /replaces the whole desk/);
  }
});

const rtmp1 = fixture('real/gdq/snippet-rtmp1.snp');

test('a snippet written as single values reads its channels (names, mute, fader)', () => {
  const scene = readScene('x32', rtmp1, 'RTMP1.snp');
  assert.deepEqual(scene.channels.map(c => c.name), ['RTMP 1 Mic', 'RTMP 1 Game']);
  assert.deepEqual(scene.channels.map(c => c.muted), [true, true]);     // mix/on OFF
  assert.deepEqual(scene.channels.map(c => c.fader), [-Infinity, -Infinity]);
});

test('a snippet\'s single chlink value links its pair into one stereo channel', () => {
  const scene = readScene('x32', fixture('real/gdq/snippet-rtmp8.snp'));
  assert.equal(scene.channels.length, 1);
  assert.equal(scene.channels[0].stereo, true);
  assert.deepEqual(scene.channels[0].srcChannels, [31, 32]);
});

test('a snippet\'s single routing block patches its channels', () => {
  const scene = readScene('x32', fixture('real/gdq/snippet-sd-patch.snp'));
  assert.equal(scene.channels[0].name, 'SD Game 1 L');
  assert.deepEqual(scene.channels.map(c => c.patch?.input), [9, 10, 11, 12, 13, 14, 15, 16]);
  assert.ok(scene.channels.every(c => c.patch.group === 'local'));
});

test('a snippet\'s single user-routing values are followed too (#17)', () => {
  const text = ['#4.0# "UIN" 0 1 0 0 1', '/config/routing/IN/1-8 UIN1-8',
    '/config/userrout/in/01 35', '/ch/01/config "Vox" 1 RD 1'].join('\n');
  assert.deepEqual(readScene('x32', text).channels[0].patch, { group: 'aes50a', input: 3 });
});

test('a snippet\'s single DCA and mute-group values assign its channels', () => {
  const text = ['#4.0# "Groups" 0 1 0 0 1', '/ch/01/config "Vox" 1 RD 1',
    '/ch/01/grp/dca %00000101', '/ch/01/grp/mute %000010'].join('\n');
  const [c] = readScene('x32', text).channels;
  assert.deepEqual(c.dcas, [1, 3]);
  assert.deepEqual(c.muteGroups, [2]);
});

test('a snippet\'s single DCA values set the DCA; its config line still names it', () => {
  const text = ['#4.0# "DCAs" 0 1 0 0 1', '/ch/01/config "Vox" 1 RD 1', '/ch/01/grp/dca %00000100',
    '/dca/3/config "Vocals" 1 RD', '/dca/3/on OFF', '/dca/3/fader -6.0'].join('\n');
  const [dca] = readScene('x32', text).dcas;
  assert.deepEqual({ n: dca.n, name: dca.name, fader: dca.fader, muted: dca.muted },
    { n: 3, name: 'Vocals', fader: -6, muted: true });
});

test('the report says a snippet became a whole scene, with unsaved settings at defaults', () => {
  const out = writeScene(readScene('x32', rtmp1), 'wing');
  const line = out.losses.find(l => l.code === 'file.snippet');
  assert.ok(line);
  assert.match(render(line), /snippet "RTMP1"/);
  assert.match(render(line), /2 channels/);
  assert.match(render(line), /replaces the whole desk/);
});

test('a snippet with no channel to convert is refused with a reason', () => {
  // Reset DCAs only switches channels off and clears their DCAs: no names,
  // preamps or EQ, so there is no channel to put in a scene.
  assert.throws(() => readScene('x32', fixture('real/gdq/snippet-reset-dcas.snp')),
    /snippet "Reset DCAs" sets no channel/);
});

test('the X32 source takes scenes, channel presets and snippets; the others only their own file', () => {
  for (const f of ['Show.scn', 'Lead Vox.CHN', 'RTMP1.snp']) assert.ok(accepts('x32', f), f);
  assert.ok(!accepts('x32', 'Show.snap'));
  assert.ok(accepts('xair', 'Room.scn') && !accepts('xair', 'Vox.chn'));
  assert.ok(accepts('wing', 'Show.snap') && !accepts('wing', 'Show.scn'));
});
