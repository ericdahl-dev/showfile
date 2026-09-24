// ─── Nav "Tools" dropdown ──────────────────────────────────────────────────
// Shared across the tool pages. Opens on hover where there's a real pointer,
// and on click/keyboard everywhere — hover alone would strand touch users.

const root = document.querySelector('[data-nav-tools]');

if (root) {
  const btn = root.querySelector('.nav-tools-btn');
  const menu = root.querySelector('.nav-tools-menu');
  const items = [...menu.querySelectorAll('a')];
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let closeTimer = null;

  const setOpen = (open) => {
    clearTimeout(closeTimer);
    root.dataset.open = open ? 'true' : 'false';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const isOpen = () => root.dataset.open === 'true';

  btn.addEventListener('click', (e) => { e.preventDefault(); setOpen(!isOpen()); });

  if (canHover) {
    root.addEventListener('pointerenter', () => setOpen(true));
    // A short grace period so crossing the gap between button and panel — or
    // clipping a corner on the way to an item — doesn't snap the menu shut.
    root.addEventListener('pointerleave', () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => setOpen(false), 180);
    });
  }

  document.addEventListener('click', (e) => {
    if (isOpen() && !root.contains(e.target)) setOpen(false);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { setOpen(false); btn.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen()) { setOpen(true); items[0]?.focus(); return; }
      const i = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown'
        ? (i + 1) % items.length
        : (i <= 0 ? items.length - 1 : i - 1);
      items[next]?.focus();
    }
  });

  // Focus leaving the whole group closes it, so tabbing past doesn't strand an
  // open panel behind the rest of the page.
  root.addEventListener('focusout', () => {
    setTimeout(() => { if (!root.contains(document.activeElement)) setOpen(false); }, 0);
  });
}
