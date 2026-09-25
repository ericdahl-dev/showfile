// ─── LTC batch plan ────────────────────────────────────────────────────────
// What a timecode export contains, as data: each file's name and the timecode
// it covers. No DOM, so the timecode page renders it and tests check it.

import {
  FRAME_RATES, parseTimecode, formatTimecode, timecodeToFrames, framesToTimecode,
  snapDurationToFrames, wavByteSize,
} from './ltc.js';

export const LIMITS = {
  maxMinutes: 60,         // per file — a 60 min WAV is already ~350 MB
  maxFiles: 100,
  maxTotalMinutes: 240,   // across the whole batch
};

// Out-of-range input is pulled into range rather than refused: a count of 500
// or a length of 999 min means "as much as allowed", and junk means the default.
const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : fallback;
};

export function planBatch({ rate, start, minutes: rawMinutes, count: rawCount = 1, sampleRate = 48000, levelDb = -6 }) {
  const count = Math.round(clamp(rawCount, 1, LIMITS.maxFiles, 1));
  const minutes = clamp(rawMinutes, 0.1, LIMITS.maxMinutes, 10);
  const spec = FRAME_RATES[rate];
  const tc = parseTimecode(start);
  // A start frame the rate can't count is a real mistake, not a nitpick:
  // 00:00:00:29 at 25 fps would silently roll the seconds on the first frame.
  if (!tc || tc.f >= spec.nominal) return { ok: false, error: 'start' };
  const { frames: framesPerFile, durationSec } = snapDurationToFrames(minutes * 60, rate);
  const startFrames = timecodeToFrames(tc, spec.nominal, spec.dropFrame);
  // Two digits minimum: "1_" through "9_" sorts fine on its own but reads as
  // provisional next to the 01_/02_ convention everything else on a show uses.
  const pad = Math.max(2, String(count).length);

  const files = [];
  for (let i = 0; i < count; i++) {
    // Files run continuously: each starts on the frame after the last ended.
    const first = startFrames + i * framesPerFile;
    const fileStart = framesToTimecode(first, spec.nominal, spec.dropFrame);
    const fileEnd = framesToTimecode(first + framesPerFile - 1, spec.nominal, spec.dropFrame);
    const stamp = formatTimecode(fileStart).replace(/[:;]/g, '-');
    files.push({
      index: i, start: fileStart, end: fileEnd,
      name: count > 1
        ? `${String(i + 1).padStart(pad, '0')}_LTC_${rate}_${stamp}.wav`
        : `LTC_${rate}_${stamp}_${minutes}min.wav`,
    });
  }

  const totalMinutes = count * minutes;
  // Audio bytes are known exactly. The zip is a fair estimate: LTC is a square
  // wave and deflates roughly 50-100x, so quoting the raw size would be absurd.
  const wavBytes = wavByteSize(durationSec, sampleRate);
  const totalBytes = wavBytes * count;
  return { ok: true, rate, spec, count, minutes, durationSec, framesPerFile, files, sampleRate, levelDb,
           totalMinutes, overBudget: totalMinutes > LIMITS.maxTotalMinutes,
           wavBytes, totalBytes, zipBytesEstimate: totalBytes / 60 };
}

// The manifest that ships inside a batch zip: settings, then one line per file
// with the timecode it covers. `generatedAt` is passed in so it can be tested.
export function manifestText(p, generatedAt = new Date()) {
  const df = p.spec.dropFrame;
  const head = [
    'Showfile — LTC batch',
    `Generated:    ${generatedAt.toLocaleString()}`,
    `Frame rate:   ${p.spec.label}`,
    `Sample rate:  ${p.sampleRate} Hz`,
    `Level:        ${p.levelDb} dBFS`,
    `Files:        ${p.count} × ${p.minutes} min (${p.framesPerFile} frames each)`,
    '',
  ];
  const width = Math.max(...p.files.map(f => f.name.length));
  const rows = p.files.map(f =>
    `${f.name.padEnd(width)}  ${formatTimecode(f.start, df)} → ${formatTimecode(f.end, df)}`);
  return head.concat(rows).join('\n') + '\n';
}

export const zipName = (p) => `LTC_${p.rate}_${p.count}files_${p.minutes}min.zip`;
