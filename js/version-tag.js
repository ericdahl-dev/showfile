// version-tag.js — the version chip on the logo lockup. One mechanism, every page.
//
// A page needs nothing but this module:
//
//   <script type="module" src="/js/version-tag.js"></script>
//
// It injects its own styles and, if the page has a lockup but no chip markup,
// creates the chip inside the first .sf-word — which is the top-left nav
// lockup, since nav comes first in the document. Pages that already carry an
// explicit <span class="app-version-tag"></span> keep using it, and a page with
// several lockups (a footer repeat, say) still gets exactly one chip.
//
// Bundled entries import it for the side effect instead of re-querying
// APP_VERSION themselves, so js/constants.js stays the single source of truth:
//
//   import './version-tag.js';
//
// Both paths run the same code, so the number can never disagree between the
// app and the marketing pages.

import { APP_VERSION } from './constants.js';

const STYLE_ID = 'app-version-tag-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
  .app-version-tag {
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0;
    margin-left: 6px;
    vertical-align: middle;
    -webkit-text-fill-color: rgba(148,163,184,0.55);
    color: rgba(148,163,184,0.55);
    background: none;
  }
`;
  document.head.appendChild(style);
}

// Only ever adds a chip to a page that has none — never a second one.
function ensureTag() {
  if (document.querySelector('.app-version-tag')) return;
  const word = document.querySelector('.sf-word');
  if (!word) return;                       // no lockup on this page (404, manage)
  const tag = document.createElement('span');
  tag.className = 'app-version-tag';
  word.appendChild(tag);
}

export function applyVersionTag() {
  injectStyle();
  ensureTag();
  document.querySelectorAll('.app-version-tag').forEach(el => {
    el.textContent = `v${APP_VERSION}`;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyVersionTag);
} else {
  applyVersionTag();
}
