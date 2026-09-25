// The desk test pack (test/desk-pack/) is converter output checked into the
// repo for loading on real desks and editors. It must match what the
// converter writes today, or a desk test would check yesterday's code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { buildDeskPack } from '../scripts/desk-pack.mjs';

const root = new URL('../test/desk-pack/', import.meta.url);

test('the desk test pack is current (run `npm run desk-pack` if not)', () => {
  const files = buildDeskPack();
  assert.ok(files.length >= 9);
  for (const f of files) {
    const at = new URL(f.path, root);
    assert.ok(existsSync(at), `missing ${f.path}`);
    assert.equal(readFileSync(at, 'utf8'), f.content, `${f.path} is stale`);
  }
});
