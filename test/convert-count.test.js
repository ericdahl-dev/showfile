import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldCount } from '../js/convert-count.js';

test('counts on the production host', () => {
  assert.equal(shouldCount('stagebuilder.ericdahl.dev'), true);
});

test('does not count in local dev, on the old domain or on other hosts', () => {
  for (const host of ['localhost', '127.0.0.1', '', 'example.com', 'stagebuilderpro.com',
                      'stagebuilder.ericdahl.dev.evil.test']) {
    assert.equal(shouldCount(host), false, host);
  }
});
