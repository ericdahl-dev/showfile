// One structured conversion report: every loss, from reader or writer, is a
// { code, severity, detail } object; the text is rendered from it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readScene, writeScene } from '../js/conversion.js';
import { render } from '../js/losses.js';

const realWing = readFileSync(new URL('./fixtures/real/gdq/pre-sgdq2025.snap', import.meta.url), 'utf8');

test('losses found while reading reach the report as structured entries (#8)', () => {
  const out = writeScene(readScene('wing', realWing), 'x32');
  const model = out.losses.filter(l => l.code === 'dyn.model-unsupported');
  assert.ok(model.length >= 1, 'reader loss missing from structured report');
  assert.equal(model[0].severity, 'unsupported');
  // warnings are exactly the rendered losses, nothing extra, nothing missing
  assert.deepEqual(out.warnings, out.losses.map(render));
});

test('report rows come graded, the most serious first (#8)', async () => {
  const { reportRows } = await import('../js/conversion.js');
  const out = writeScene(readScene('wing', realWing), 'x32');
  const rows = reportRows(out.losses);
  assert.ok(rows.length > 0 && rows.length <= out.losses.length);
  const order = rows.map(r => r.rank);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(rows[0].severity, 'dropped');
  for (const r of rows) assert.equal(typeof r.text, 'string');
});

test('lines that differ only in the channel become one line (#33)', async () => {
  const { reportRows } = await import('../js/conversion.js');
  const losses = writeScene(readScene('wing', realWing), 'x32').losses;
  const rows = reportRows(losses);
  const ds902 = rows.filter(r => /DS902/.test(r.text));
  assert.equal(ds902.length, 1);
  // Headsets 1-8 carry a DS902; ch 9's slot is a DUCK, so it keeps its own line.
  assert.ok(ds902[0].text.startsWith('8 channels (Headset 1, Headset 2, Headset 3, Headset 4, Headset 5, Headset 6, Headset 7, Headset 8): '), ds902[0].text);
  assert.ok(rows.some(r => /^ch 9 "": the gate slot holds a DUCK/.test(r.text)));
  assert.match(ds902[0].text, /the gate slot holds a DS902/);
  // Different messages stay apart.
  assert.ok(rows.some(r => /past the X32's 32 channels/.test(r.text)));
});
