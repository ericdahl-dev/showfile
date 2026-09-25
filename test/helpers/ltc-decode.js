// A minimal LTC reader for tests, written from SMPTE 12M rather than from our
// encoder, so a shared misunderstanding cannot make both sides agree.
//
// Biphase-mark: every bit cell starts with a transition; a 1 has a second one
// half way through. So the gaps between transitions are either a whole cell
// (a 0) or two half cells in a row (a 1). A frame is 80 bits ending in the
// sync word 0011 1111 1111 1101.

const SYNC = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];

// Least-significant bit first, as LTC sends them.
const bcd = (bits, at, n) => bits.slice(at, at + n).reduce((v, b, i) => v | (b << i), 0);

export function decodeLTC(samples, sampleRate, fps) {
  const cell = sampleRate / (fps * 80);

  // Sample 0 is the first cell boundary; every sign change after it is another.
  const edges = [0];
  for (let i = 1; i < samples.length; i++) {
    if (Math.sign(samples[i]) !== Math.sign(samples[i - 1])) edges.push(i);
  }
  // The end of the audio closes the last cell; without it the final frame's
  // last bit, and so the whole final frame, would be lost.
  edges.push(samples.length);

  const bits = [];
  for (let k = 1; k < edges.length; ) {
    const gap = edges[k] - edges[k - 1];
    if (gap > cell * 0.75) { bits.push(0); k += 1; continue; }
    // A half cell must be followed by another half cell to make a 1. The
    // audio can end half way through a bit; that is the end, not an error.
    if (k + 1 >= edges.length) break;
    const next = edges[k + 1] - edges[k];
    if (!(next < cell * 0.75)) throw new Error(`lone half cell at sample ${edges[k]}`);
    bits.push(1);
    k += 2;
  }

  const frames = [];
  for (let end = 79; end < bits.length; end++) {
    const tail = bits.slice(end - 15, end + 1);
    if (!SYNC.every((b, i) => b === tail[i])) continue;
    const w = bits.slice(end - 79, end + 1);
    frames.push({
      h: bcd(w, 48, 4) + 10 * bcd(w, 56, 2),
      m: bcd(w, 32, 4) + 10 * bcd(w, 40, 3),
      s: bcd(w, 16, 4) + 10 * bcd(w, 24, 3),
      f: bcd(w, 0, 4) + 10 * bcd(w, 8, 2),
      dropFrame: w[10] === 1,
    });
  }
  return frames;
}
