// The timecode audio itself: render it, read it back with an independent
// decoder, and check every frame.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLTC, FRAME_RATES, nextFrame, formatTimecode } from '../js/ltc.js';
import { decodeLTC } from './helpers/ltc-decode.js';

const fmt = (tc) => formatTimecode(tc);

// Every decoded frame must be the one after the frame before it.
function assertContinuous(frames, rate) {
  const spec = FRAME_RATES[rate];
  for (let i = 1; i < frames.length; i++) {
    const want = nextFrame(frames[i - 1], spec.nominal, spec.dropFrame);
    assert.equal(fmt(frames[i]), fmt(want), `frame ${i} after ${fmt(frames[i - 1])}`);
  }
}

for (const rate of ['24', '25', '30', '29.97ndf']) {
  test(`${rate} fps renders continuous, decodable LTC`, () => {
    const spec = FRAME_RATES[rate];
    const start = { h: 1, m: 0, s: 0, f: 0 };
    const { samples } = renderLTC({ rate, start, durationSec: 3, sampleRate: 48000 });
    const frames = decodeLTC(samples, 48000, spec.fps);

    assert.ok(frames.length >= Math.floor(3 * spec.fps) - 2, `${frames.length} frames`);
    assert.equal(fmt(frames[0]), '01:00:00:00');
    assertContinuous(frames, rate);
    for (const f of frames) assert.equal(f.dropFrame, false);
  });
}

test('29.97 drop-frame skips ;00 and ;01 at the minute, and flags drop-frame', () => {
  const rate = '29.97df';
  const { samples } = renderLTC({ rate, start: { h: 0, m: 0, s: 59, f: 20 }, durationSec: 1, sampleRate: 48000 });
  const frames = decodeLTC(samples, 48000, FRAME_RATES[rate].fps);
  assertContinuous(frames, rate);
  const labels = frames.map(fmt);
  assert.ok(labels.includes('00:00:59:29'));
  assert.ok(labels.includes('00:01:00:02'));
  assert.ok(!labels.includes('00:01:00:00') && !labels.includes('00:01:00:01'));
  for (const f of frames) assert.equal(f.dropFrame, true);
});

test('drop-frame keeps ;00 on the tenth minute', () => {
  const rate = '29.97df';
  const { samples } = renderLTC({ rate, start: { h: 0, m: 9, s: 59, f: 25 }, durationSec: 0.5, sampleRate: 48000 });
  const labels = decodeLTC(samples, 48000, FRAME_RATES[rate].fps).map(fmt);
  assert.ok(labels.includes('00:10:00:00'), labels.join(' '));
});

test('44.1 kHz renders the same timecode as 48 kHz', () => {
  const rate = '25';
  const start = { h: 10, m: 20, s: 30, f: 5 };
  const a = decodeLTC(renderLTC({ rate, start, durationSec: 1, sampleRate: 48000 }).samples, 48000, 25).map(fmt);
  const b = decodeLTC(renderLTC({ rate, start, durationSec: 1, sampleRate: 44100 }).samples, 44100, 25).map(fmt);
  assert.deepEqual(a.slice(0, 20), b.slice(0, 20));
});

test('renderLTC reports how far it got', () => {
  const r = renderLTC({ rate: '25', start: { h: 0, m: 0, s: 0, f: 0 }, durationSec: 2, sampleRate: 48000 });
  assert.equal(r.samples.length, 96000);
  assert.equal(r.frames, 50);
  assert.equal(fmt(r.endTimecode), '00:00:01:24');
});
