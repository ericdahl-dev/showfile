// ltc.js — SMPTE 12M Linear Timecode (LTC) encoder.
//
// LTC is an 80-bit word per video frame, biphase-mark encoded onto an audio
// signal: every bit cell starts with a transition, and a '1' adds a second
// transition mid-cell. That makes the signal polarity- and direction-agnostic,
// which is why it survives being run down a mic line into whatever the venue has.
//
// Pure functions with no DOM or Web Audio dependency, so the bit layout can be
// unit-tested (tests/ltc.test.js) rather than trusted by eye.

/**
 * The rates that actually turn up on a show. `nominal` is the integer count the
 * frame field counts to — 29.97 fps timecode still counts 0…29, it just runs
 * 0.1% slow against the clock, which is the whole reason drop-frame exists.
 */
export const FRAME_RATES = {
  '23.976': { fps: 24000 / 1001, nominal: 24, dropFrame: false, label: '23.976 fps', note: 'Film transferred to NTSC video' },
  '24':     { fps: 24,           nominal: 24, dropFrame: false, label: '24 fps',     note: 'Film' },
  '25':     { fps: 25,           nominal: 25, dropFrame: false, label: '25 fps',     note: 'PAL / EBU — most of the world' },
  '29.97ndf': { fps: 30000 / 1001, nominal: 30, dropFrame: false, label: '29.97 fps non-drop', note: 'NTSC video, count drifts from wall clock' },
  '29.97df':  { fps: 30000 / 1001, nominal: 30, dropFrame: true,  label: '29.97 fps drop-frame', note: 'NTSC broadcast — matches wall clock' },
  '30':     { fps: 30,           nominal: 30, dropFrame: false, label: '30 fps',     note: 'Audio / legacy NTSC' },
};

/**
 * Display order. Not derivable from FRAME_RATES: JS enumerates integer-like keys
 * ('24', '25', '30') ahead of the rest, which would list the rates out of order.
 */
export const RATE_KEYS = ['23.976', '24', '25', '29.97ndf', '29.97df', '30'];

export const DEFAULT_RATE = '30';

/** "01:23:45:12" → { h, m, s, f }. Accepts ';' as the drop-frame separator. */
export function parseTimecode(str) {
  const parts = String(str || '').trim().split(/[:;.]/);
  if (parts.length !== 4) return null;
  const [h, m, s, f] = parts.map(p => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 ? n : NaN;
  });
  if ([h, m, s, f].some(Number.isNaN)) return null;
  if (h > 23 || m > 59 || s > 59) return null;
  return { h, m, s, f };
}

const pad = n => String(n).padStart(2, '0');

export function formatTimecode(tc, dropFrame = false) {
  return `${pad(tc.h)}:${pad(tc.m)}:${pad(tc.s)}${dropFrame ? ';' : ':'}${pad(tc.f)}`;
}

/**
 * Advance one frame. Drop-frame skips frame numbers 00 and 01 at the top of every
 * minute except minutes divisible by ten — it drops *labels*, never frames, which
 * is how a 29.97 count stays honest against a wall clock.
 */
export function nextFrame(tc, nominal, dropFrame) {
  let { h, m, s, f } = tc;
  f += 1;
  if (f >= nominal) {
    f = 0;
    s += 1;
    if (s >= 60) {
      s = 0;
      m += 1;
      if (m >= 60) { m = 0; h = (h + 1) % 24; }
    }
    if (dropFrame && s === 0 && m % 10 !== 0) f = 2;
  }
  return { h, m, s, f };
}

/** Frames from 00:00:00:00 to tc, honouring drop-frame numbering. */
export function timecodeToFrames(tc, nominal, dropFrame) {
  const total = ((tc.h * 60 + tc.m) * 60 + tc.s) * nominal + tc.f;
  if (!dropFrame) return total;
  const totalMinutes = tc.h * 60 + tc.m;
  return total - 2 * (totalMinutes - Math.floor(totalMinutes / 10));
}

/**
 * The inverse of timecodeToFrames — O(1), so a running clock can be labelled from
 * elapsed audio time instead of by stepping frames.
 *
 * Drop-frame works on the fact that ten minutes of 29.97 is exactly 17982 frames
 * and every minute inside it but the first is short by two labels. Recover how
 * many labels were skipped, add them back, and the count decodes like plain 30.
 */
export function framesToTimecode(frameNumber, nominal, dropFrame) {
  let n = Math.max(0, Math.floor(frameNumber));
  if (dropFrame) {
    const FRAMES_PER_10MIN = 17982;   // 30 × 600 − 18
    const FRAMES_PER_MIN   = 1798;    // 30 × 60 − 2
    const tenMinBlocks = Math.floor(n / FRAMES_PER_10MIN);
    const within       = n % FRAMES_PER_10MIN;
    n += 18 * tenMinBlocks + 2 * Math.floor(Math.max(0, within - 2) / FRAMES_PER_MIN);
  }
  const perMin  = nominal * 60;
  const perHour = perMin * 60;
  return {
    h: Math.floor(n / perHour) % 24,
    m: Math.floor(n / perMin) % 60,
    s: Math.floor(n / nominal) % 60,
    f: n % nominal,
  };
}

// Write `count` BCD-ish bits of `value`, least-significant bit first — the order
// LTC puts them on the wire.
function writeBits(bits, start, count, value) {
  for (let i = 0; i < count; i++) bits[start + i] = (value >> i) & 1;
}

const SYNC_WORD = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];

/**
 * The 80-bit LTC word for one frame, in transmission order.
 *
 * opts.userBits: up to 8 hex digits, mapped left-to-right onto user-bit fields
 * 1…8 (the spare nibbles interleaved through the word — commonly a date, a reel
 * number, or nothing at all).
 * opts.is25: at 25 fps the polarity-correction bit lives at 59 instead of 27,
 * with BGF0/BGF2 shifted accordingly.
 */
export function ltcFrameBits(tc, opts = {}) {
  const { dropFrame = false, colorFrame = false, userBits = '', is25 = false } = opts;
  const bits = new Uint8Array(80);

  const ub = String(userBits).replace(/[^0-9a-fA-F]/g, '').padEnd(8, '0').slice(0, 8);
  const nib = i => parseInt(ub[i], 16) || 0;

  writeBits(bits, 0,  4, tc.f % 10);
  writeBits(bits, 4,  4, nib(0));
  writeBits(bits, 8,  2, Math.floor(tc.f / 10));
  bits[10] = dropFrame ? 1 : 0;
  bits[11] = colorFrame ? 1 : 0;
  writeBits(bits, 12, 4, nib(1));
  writeBits(bits, 16, 4, tc.s % 10);
  writeBits(bits, 20, 4, nib(2));
  writeBits(bits, 24, 3, Math.floor(tc.s / 10));
  // bit 27: PC at 24/30 fps, BGF0 at 25 fps
  writeBits(bits, 28, 4, nib(3));
  writeBits(bits, 32, 4, tc.m % 10);
  writeBits(bits, 36, 4, nib(4));
  writeBits(bits, 40, 3, Math.floor(tc.m / 10));
  // bit 43: BGF0 at 24/30 fps, BGF2 at 25 fps
  writeBits(bits, 44, 4, nib(5));
  writeBits(bits, 48, 4, tc.h % 10);
  writeBits(bits, 52, 4, nib(6));
  writeBits(bits, 56, 2, Math.floor(tc.h / 10));
  bits[58] = 0; // BGF1 — user bits are unformatted here
  // bit 59: BGF2 at 24/30 fps, PC at 25 fps
  writeBits(bits, 60, 4, nib(7));
  for (let i = 0; i < 16; i++) bits[64 + i] = SYNC_WORD[i];

  // Polarity correction: chosen so every word carries an even number of 1s, which
  // keeps each frame starting on the same biphase polarity.
  const pcIndex = is25 ? 59 : 27;
  bits[pcIndex] = 0;
  let ones = 0;
  for (let i = 0; i < 80; i++) ones += bits[i];
  bits[pcIndex] = ones % 2;

  return bits;
}

/**
 * Round a duration to a whole number of frames at this rate.
 *
 * A timecode file should contain whole frames. 20 seconds at 29.97 is 599.4 of
 * them, and leaving that fraction in place means a batch's second file starts on
 * the same frame number the first one ended on — a duplicated label, which is
 * exactly the kind of thing that desyncs a show at 2am. Snap first, then every
 * file in a run abuts the next perfectly.
 */
export function snapDurationToFrames(durationSec, rate = DEFAULT_RATE) {
  const spec = FRAME_RATES[rate];
  if (!spec) throw new Error(`Unknown frame rate: ${rate}`);
  const frames = Math.max(1, Math.round(durationSec * spec.fps));
  return { frames, durationSec: frames / spec.fps };
}

/**
 * A free-running LTC signal you pull samples out of in arbitrary-sized blocks.
 *
 * Biphase-mark: toggle at every cell boundary, plus a mid-cell toggle for a 1.
 * At the pulldown rates a cell is a fractional number of samples (48000 /
 * (29.97×80) = 20.02), so cell edges are tracked as a running float against an
 * absolute sample counter. Rounding each block independently would let the count
 * creep, and timecode that creeps is worse than no timecode at all.
 *
 * Because state lives in the renderer rather than in a loop, playback can stream
 * forever in small blocks while a file render pulls one big block — same signal.
 */
export function createLTCRenderer({
  rate = DEFAULT_RATE,
  start = { h: 0, m: 0, s: 0, f: 0 },
  sampleRate = 48000,
  levelDb = -6,
  userBits = '',
} = {}) {
  const spec = FRAME_RATES[rate];
  if (!spec) throw new Error(`Unknown frame rate: ${rate}`);

  const amp = Math.round(32767 * Math.pow(10, levelDb / 20));
  const cellLen = sampleRate / (spec.fps * 80);
  const is25 = spec.nominal === 25;

  let tc = { ...start };
  let bits = ltcFrameBits(tc, { dropFrame: spec.dropFrame, userBits, is25 });
  let frames = 1;
  let bitIdx = -1;        // -1 → the next pull opens the first cell
  let level = 1;
  let cellStart = -cellLen;
  let segEnd = 0;         // absolute sample index this segment ends at
  let pendingMid = false; // a '1' cell whose second half hasn't been emitted yet
  let pos = 0;            // absolute samples emitted

  // Choose the next constant-level run: either the back half of a '1' cell, or a
  // brand new cell.
  function advance() {
    if (pendingMid) {
      level = -level;
      segEnd = cellStart + cellLen;
      pendingMid = false;
      return;
    }
    cellStart += cellLen;
    bitIdx += 1;
    if (bitIdx >= 80) {
      tc = nextFrame(tc, spec.nominal, spec.dropFrame);
      bits = ltcFrameBits(tc, { dropFrame: spec.dropFrame, userBits, is25 });
      frames += 1;
      bitIdx = 0;
    }
    level = -level;
    if (bits[bitIdx]) { segEnd = cellStart + cellLen / 2; pendingMid = true; }
    else              { segEnd = cellStart + cellLen; }
  }

  return {
    /** Write `count` samples into `out` at `offset`. Int16Array or Float32Array. */
    fill(out, offset = 0, count = out.length - offset) {
      const float = out instanceof Float32Array;
      const hi = float ? amp / 32767 : amp;
      for (let i = 0; i < count; i++) {
        while (pos >= segEnd) advance();
        out[offset + i] = level * hi;
        pos += 1;
      }
    },
    /** Timecode of the frame currently on the wire. */
    get timecode() { return { ...tc }; },
    get frameCount() { return frames; },
    get spec() { return spec; },
  };
}

/**
 * Render a fixed span of LTC in one go — the file-export path.
 * @returns {{ samples: Int16Array, endTimecode: {h,m,s,f}, frames: number }}
 */
export function renderLTC({
  rate = DEFAULT_RATE,
  start = { h: 0, m: 0, s: 0, f: 0 },
  durationSec = 60,
  sampleRate = 48000,
  levelDb = -6,
  userBits = '',
}) {
  const renderer = createLTCRenderer({ rate, start, sampleRate, levelDb, userBits });
  const samples = new Int16Array(Math.round(durationSec * sampleRate));
  renderer.fill(samples);
  return { samples, endTimecode: renderer.timecode, frames: renderer.frameCount };
}

/** Wrap PCM in a 16-bit mono WAV container. */
export function wavFromPCM(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const ascii = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20, 1, true);           // format: PCM
  view.setUint16(22, 1, true);           // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true);              // block align
  view.setUint16(34, 16, true);          // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  new Int16Array(buf, 44).set(samples);

  return buf;
}

/** Bytes a WAV of this length will occupy — shown before the user commits to it. */
export function wavByteSize(durationSec, sampleRate) {
  return 44 + Math.round(durationSec * sampleRate) * 2;
}
