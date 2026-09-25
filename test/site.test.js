// The site as a crawler and a lost visitor see it: sitemap, robots, 404 page
// and each public page's share metadata.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ORIGIN = 'https://showfile.ericdahl.dev';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));

const PAGES = [
  { url: `${ORIGIN}/`, file: 'index.html' },
  { url: `${ORIGIN}/convert`, file: 'convert/index.html' },
  { url: `${ORIGIN}/timecode-generator`, file: 'timecode-generator/index.html' },
];
const meta = (html, key) =>
  html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];

test('the sitemap lists every public page, and only those', () => {
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(locs.sort(), PAGES.map(p => p.url).sort());
});

test('robots.txt points at the sitemap and keeps crawlers out of non-pages', () => {
  const robots = read('robots.txt');
  assert.match(robots, new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, 'm'));
  for (const dir of ['/og/', '/test/', '/scripts/']) assert.match(robots, new RegExp(`^Disallow: ${dir}$`, 'm'));
});

test('there is a branded 404 page that leads home and is not indexed', () => {
  assert.ok(exists('404.html'));
  const html = read('404.html');
  assert.match(html, /<meta name="robots" content="noindex"/);
  assert.match(html, /href="\/"/);
  assert.match(html, /href="\/css\/brand\.css"/);
});

for (const p of PAGES) {
  test(`${p.file} has matching canonical and complete share metadata`, () => {
    const html = read(p.file);
    assert.equal(html.match(/<link rel="canonical" href="([^"]+)"/)[1], p.url);
    assert.equal(meta(html, 'og:url'), p.url);
    for (const key of ['description', 'og:title', 'og:description', 'og:image', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
      assert.ok(meta(html, key), `${p.file} missing ${key}`);
    }
    const img = meta(html, 'og:image').replace(ORIGIN + '/', '');
    assert.ok(exists(img), `${p.file} share image ${img} missing`);
  });
}
