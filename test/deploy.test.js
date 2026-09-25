// The nginx config Coolify runs for this app (its header says where it goes).
// Kept here so a change to it is reviewed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const conf = readFileSync(new URL('../deploy/nginx.conf', import.meta.url), 'utf8');

test('pages, scripts and styles are revalidated on every load (#40)', () => {
  // Modules import each other by name; a cached old one beside a new one breaks the page.
  assert.match(conf, /default\s+"no-cache";/);
  assert.match(conf, /add_header Cache-Control \$cache_control always;/);
});

test('the branded 404 page is still served for missing paths', () => {
  assert.match(conf, /error_page 404 \/404\.html;/);
  assert.match(conf, /try_files \$uri \$uri\.html \$uri\/index\.html/);
});
