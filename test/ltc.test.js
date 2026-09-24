// Expected values come from SMPTE 12M, not from this implementation: the 29.97
// drop-frame counts (17982 frames per ten minutes, 107892 per hour) and the
// sync word that closes every 80-bit LTC frame.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimecode, formatTimecode, nextFrame, timecodeToFrames, framesToTimecode,
  ltcFrameBits, wavFromPCM, wavByteSize,
} from '../js/ltc.js';

test('parseTimecode accepts : and ; and rejects out-of-range fields', () => {
  assert.deepEqual(parseTimecode('01:23:45:12'), { h: 1, m: 23, s: 45, f: 12 });
  assert.deepEqual(parseTimecode('01:00:00;02'), { h: 1, m: 0, s: 0, f: 2 });
  assert.equal(parseTimecode('24:00:00:00'), null);
  assert.equal(parseTimecode('00:60:00:00'), null);
  assert.equal(parseTimecode('1:2:3'), null);
  assert.equal(parseTimecode('aa:00:00:00'), null);
});

test('formatTimecode uses ; only for drop-frame', () => {
  assert.equal(formatTimecode({ h: 1, m: 2, s: 3, f: 4 }), '01:02:03:04');
  assert.equal(formatTimecode({ h: 1, m: 2, s: 3, f: 4 }, true), '01:02:03;04');
});

test('drop-frame skips labels 00 and 01 except on every tenth minute', () => {
  assert.deepEqual(nextFrame({ h: 0, m: 0, s: 59, f: 29 }, 30, true), { h: 0, m: 1, s: 0, f: 2 });
  assert.deepEqual(nextFrame({ h: 0, m: 9, s: 59, f: 29 }, 30, true), { h: 0, m: 10, s: 0, f: 0 });
  assert.deepEqual(nextFrame({ h: 0, m: 0, s: 59, f: 29 }, 30, false), { h: 0, m: 1, s: 0, f: 0 });
  assert.deepEqual(nextFrame({ h: 23, m: 59, s: 59, f: 24 }, 25, false), { h: 0, m: 0, s: 0, f: 0 });
});

test('29.97 drop-frame frame counts match SMPTE', () => {
  assert.equal(timecodeToFrames({ h: 0, m: 10, s: 0, f: 0 }, 30, true), 17982);
  assert.equal(timecodeToFrames({ h: 1, m: 0, s: 0, f: 0 }, 30, true), 107892);
  assert.equal(timecodeToFrames({ h: 0, m: 1, s: 0, f: 2 }, 30, true), 1800);
});

test('framesToTimecode inverts timecodeToFrames across the drop points', () => {
  for (const [nominal, df] of [[30, true], [30, false], [25, false], [24, false]]) {
    let tc = { h: 0, m: 0, s: 0, f: 0 };
    // Walk past several minute and ten-minute boundaries.
    for (let n = 0; n < 40000; n++) {
      assert.deepEqual(framesToTimecode(n, nominal, df), tc, `frame ${n} @${nominal}${df ? 'df' : ''}`);
      assert.equal(timecodeToFrames(tc, nominal, df), n);
      tc = nextFrame(tc, nominal, df);
    }
  }
});

test('an LTC frame is 80 bits ending in the SMPTE sync word', () => {
  const bits = ltcFrameBits({ h: 1, m: 2, s: 3, f: 4 });
  assert.equal(bits.length, 80);
  assert.deepEqual([...bits.slice(64)], [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1]);
});

test('LTC frame units and tens are BCD, least-significant bit first', () => {
  const bits = ltcFrameBits({ h: 0, m: 0, s: 0, f: 27 });
  assert.deepEqual([...bits.slice(0, 4)], [1, 1, 1, 0]);   // 7
  assert.deepEqual([...bits.slice(8, 10)], [0, 1]);        // 2
  assert.equal(ltcFrameBits({ h: 0, m: 0, s: 0, f: 0 }, { dropFrame: true })[10], 1);
});

test('wavFromPCM writes a 16-bit mono RIFF header sized to the data', () => {
  const buf = wavFromPCM(new Int16Array([0, 1000, -1000, 32767]), 48000);
  const v = new DataView(buf);
  const ascii = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 4), 'WAVE');
  assert.equal(ascii(36, 4), 'data');
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 8);
  assert.equal(buf.byteLength, 44 + 8);
  assert.equal(v.getInt16(44 + 6, true), 32767);
  assert.equal(wavByteSize(1, 48000), 44 + 96000);
});
