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
  assert.equal(rows.length, out.losses.length);
  const order = rows.map(r => r.rank);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(rows[0].severity, 'dropped');
  for (const r of rows) assert.equal(typeof r.text, 'string');
});
