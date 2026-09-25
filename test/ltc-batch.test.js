// The LTC batch plan: what each file in a batch is called and what timecode it
// covers. Files run continuously, so a show can play them back to back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBatch, manifestText, zipName, LIMITS } from '../js/ltc-batch.js';
import { renderLTC, formatTimecode, FRAME_RATES, nextFrame } from '../js/ltc.js';
import { decodeLTC } from './helpers/ltc-decode.js';

const base = { rate: '25', start: '01:00:00:00', minutes: 1, count: 1, sampleRate: 48000, levelDb: -6 };
const fmt = (tc, df) => formatTimecode(tc, df);

test('a single file is named after its rate, start and length', () => {
  const p = planBatch(base);
  assert.equal(p.ok, true);
  assert.equal(p.files.length, 1);
  assert.equal(p.files[0].name, 'LTC_25_01-00-00-00_1min.wav');
  assert.equal(fmt(p.files[0].start), '01:00:00:00');
  assert.equal(fmt(p.files[0].end), '01:00:59:24');
  assert.equal(p.framesPerFile, 1500);
});

test('a batch is numbered and each file starts on the frame after the last ended', () => {
  const p = planBatch({ ...base, count: 3, minutes: 5 });
  assert.deepEqual(p.files.map(f => f.name), [
    '01_LTC_25_01-00-00-00.wav', '02_LTC_25_01-05-00-00.wav', '03_LTC_25_01-10-00-00.wav',
  ]);
  const spec = FRAME_RATES['25'];
  for (let i = 1; i < p.files.length; i++) {
    assert.equal(fmt(p.files[i].start), fmt(nextFrame(p.files[i - 1].end, spec.nominal, spec.dropFrame)));
  }
});

test('batch numbers pad to the width of the count', () => {
  const p = planBatch({ ...base, count: 100, minutes: 0.1 });
  assert.equal(p.files[0].name.slice(0, 4), '001_');
  assert.equal(p.files[99].name.slice(0, 4), '100_');
});

test('drop-frame batches stay continuous across the dropped labels', () => {
  const p = planBatch({ ...base, rate: '29.97df', start: '00:00:00;00', count: 4, minutes: 0.5 });
  const spec = FRAME_RATES['29.97df'];
  for (let i = 1; i < p.files.length; i++) {
    assert.equal(fmt(p.files[i].start), fmt(nextFrame(p.files[i - 1].end, spec.nominal, true)));
  }
  assert.ok(p.files.every(f => !/-00-01-00-0[01]/.test(f.name)));
});

test('the rendered audio of consecutive files runs on without a gap', () => {
  const p = planBatch({ ...base, rate: '30', count: 2, minutes: 1 / 60 });   // one second each
  const spec = FRAME_RATES['30'];
  const decoded = p.files.map(f => decodeLTC(renderLTC({
    rate: p.rate, start: f.start, durationSec: p.durationSec, sampleRate: p.sampleRate,
  }).samples, p.sampleRate, spec.fps));
  assert.equal(fmt(decoded[0][0]), fmt(p.files[0].start));
  assert.equal(fmt(decoded[1][0]), fmt(p.files[1].start));
  assert.equal(fmt(decoded[0].at(-1)), fmt(p.files[0].end));
});

test('a start the rate cannot count is rejected', () => {
  assert.deepEqual(planBatch({ ...base, start: '01:00:00:29' }), { ok: false, error: 'start' });
  assert.deepEqual(planBatch({ ...base, start: 'soon' }), { ok: false, error: 'start' });
  assert.equal(planBatch({ ...base, rate: '30', start: '01:00:00:29' }).ok, true);
});

test('count and length are clamped to the limits', () => {
  assert.equal(planBatch({ ...base, count: 500 }).files.length, LIMITS.maxFiles);
  assert.equal(planBatch({ ...base, count: 0 }).files.length, 1);
  assert.equal(planBatch({ ...base, minutes: 999 }).minutes, LIMITS.maxMinutes);
  assert.equal(planBatch({ ...base, minutes: 'x' }).minutes, 10);
});

test('a batch over the total-length limit is flagged', () => {
  assert.equal(planBatch({ ...base, count: 4, minutes: 60 }).overBudget, false);    // 240 min
  assert.equal(planBatch({ ...base, count: 5, minutes: 60 }).overBudget, true);     // 300 min
});

test('sizes: the WAV is exact, the zip an estimate', () => {
  const p = planBatch({ ...base, minutes: 1, sampleRate: 48000 });
  assert.equal(p.wavBytes, 44 + 60 * 48000 * 2);
  assert.equal(p.totalBytes, p.wavBytes);
});

test('the manifest lists every file with its timecode span', () => {
  const p = planBatch({ ...base, rate: '29.97df', start: '01:00:00;00', count: 2, minutes: 1 });
  const text = manifestText(p, new Date('2026-09-24T12:00:00Z'));
  assert.match(text, /^Showfile — LTC batch$/m);
  assert.match(text, /Files: +2 × 1 min \(1798 frames each\)/);
  assert.match(text, /01_LTC_29\.97df_01-00-00-00\.wav +01:00:00;00 → 01:00:59;27/);
  assert.equal(zipName(p), 'LTC_29.97df_2files_1min.zip');
});
