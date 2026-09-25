// The tool pages share their chrome through css/site.css. A rule copied back
// into a page's <style> block would drift from the shared one unnoticed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TOOL_PAGES = ['convert/index.html', 'timecode-generator/index.html'];

// Top-level rules (an @media block counts as one), comments dropped and
// whitespace collapsed, so the same rule compares equal however it's indented.
function rules(css) {
  const out = [];
  let depth = 0, start = 0;
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) {
      out.push(css.slice(start, i + 1).replace(/\s+/g, ' ').trim());
      start = i + 1;
    }
  }
  return out;
}
const pageStyle = (html) => html.match(/<style>([\s\S]*?)<\/style>/)[1];

for (const file of TOOL_PAGES) {
  test(`${file} loads the shared chrome after the brand tokens`, () => {
    const html = read(file);
    const brand = html.indexOf('href="/css/brand.css"');
    const site = html.indexOf('href="/css/site.css"');
    assert.ok(brand > -1 && site > brand, 'site.css must follow brand.css');
    assert.ok(site < html.indexOf('<style>'), 'site.css must load before the page styles');
  });

  test(`${file} does not repeat a rule from site.css`, () => {
    const shared = new Set(rules(read('css/site.css')));
    const repeated = rules(pageStyle(read(file))).filter(r => shared.has(r));
    assert.deepEqual(repeated, []);
  });
}
