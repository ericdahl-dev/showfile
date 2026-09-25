// ─── Console scene converter page ──────────────────────────────────────────
// Everything runs in the browser: the file is read with FileReader, converted
// in memory, and handed back as a download. Nothing is uploaded.
//
// Reading and writing scenes lives in conversion.js, which has no DOM and is
// tested directly. This page owns only what a person sees: the desk pickers,
// the wording for each pairing, the report and the download.

import { DESKS, canConvert, readScene, writeScene, reportRows } from './conversion.js';

const $ = (id) => document.getElementById(id);

const CONSOLES = DESKS;

// What the page says about each pairing. Which pairings exist is conversion.js's
// call (canConvert); this is only the wording.
const TO_WING = {
  pairLabel: 'stereo pairs merged',
  hint: 'Snapshot covering all 40 channels. Ones your show does not use are cleared.',
};
const COPY = {
  'x32>wing':  TO_WING,
  'xair>wing': TO_WING,
  'xair>x32': { pairLabel: 'stereo split to pairs',
    hint: 'Full scene file, all 32 channels. The X32 is the bigger desk, so they all fit — the patch is what to check.' },
  'x32>xair': { pairLabel: 'stereo split to pairs',
    hint: 'Full scene file, all 16 channels. The X Air is the smaller desk, so expect to check the notes below.' },
  'wing>xair': { pairLabel: 'stereo split to pairs',
    hint: 'Full scene file, all 16 channels. The X Air is the smallest desk here, so expect the most to check.' },
  'wing>x32': { pairLabel: 'stereo split to pairs',
    hint: 'Full scene file, all 32 channels. The X32 is the smaller desk, so expect to check the notes below.' },
};

const SECTIONS = [
  ['names', 'Names & icons'], ['colors', 'Strip colours'], ['patch', 'Input patch'],
  ['preamp', 'Gain, 48V, filters'], ['levels', 'Faders, mutes, pan'], ['eq', 'EQ'],
  ['dynamics', 'Gate & compressor'], ['sends', 'Bus sends'], ['groups', 'DCAs & mute groups'],
];

let state = { ir: null, out: null, baseName: 'scene', shown: false };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const routeKey = () => `${$('from').value}>${$('to').value}`;
const route    = () => canConvert($('from').value, $('to').value) ? COPY[routeKey()] : null;

function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

// render() runs on every Include checkbox too. Replaying the flip and the
// stagger each time turns a nice touch into a twitch, so motion is opt-in per
// render and only the two moments that are really a NEW conversion ask for it:
// a file landing, and the route changing.
// The conversion itself is instant, so nothing here is waiting on work. The
// curtain is a transition: it hides the swap so the file appears to change
// rather than to have been replaced, and it gives "Convert" something to
// visibly do.
//
// SPEED is the one number worth touching. 1 runs the whole thing in about
// five seconds, which is slow enough to read as a house drape with weight
// rather than a flicker. Raise it to stretch everything proportionally —
// 2 is roughly ten seconds — or drop it below 1 to tighten it up. The bar
// fills across the whole hold either way, because the CSS durations are
// driven from these numbers rather than written twice.
const SPEED = 1;
const DROP_MS = Math.round(1100 * SPEED);
const HOLD_MS = Math.round(2800 * SPEED);
const LIFT_MS = Math.round(1100 * SPEED);

const wantsMotion = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// render() also runs on every Include checkbox. Replaying the report's
// entrance each time turns a nice touch into a twitch, so motion is opt-in
// per render and only a real conversion asks for it.
let animateNext = false;

// Restart a CSS animation by taking the class off and forcing a reflow.
function replay(el, cls, on) {
  if (!el) return;
  el.classList.remove(cls);
  if (!on || !wantsMotion()) return;
  void el.offsetWidth;
  el.classList.add(cls);
}

// The card shows one file: what came in, or what is going out.
function paintCard() {
  const src = CONSOLES[$('from').value];
  const r = route();
  const card = $('filecard');
  if (!state.ir) { card.classList.remove('on', 'done'); return; }

  card.classList.add('on');
  card.classList.toggle('done', state.shown);
  const ext = state.shown && r ? CONSOLES[$('to').value].ext : src.ext;
  const desk = state.shown ? CONSOLES[$('to').value]?.label : src.label;
  $('fcExt').textContent = ext.toUpperCase();
  $('fcName').textContent = `${state.baseName}.${ext}`;
  $('fcDesk').textContent = desk || '';
}

// Drop the drape, swap everything behind it, lift it.
function runCurtain(apply) {
  const curtain = $('curtain');
  if (!wantsMotion()) { apply(); return; }
  clearTimeout(runCurtain._a); clearTimeout(runCurtain._b);

  // One source of truth for the timings: the CSS reads them back out.
  curtain.style.setProperty('--drop', DROP_MS + 'ms');
  curtain.style.setProperty('--hold', HOLD_MS + 'ms');
  curtain.style.setProperty('--lift', LIFT_MS + 'ms');

  curtain.classList.add('on');
  requestAnimationFrame(() => curtain.classList.add('down'));

  runCurtain._a = setTimeout(() => {
    apply();                                   // swapped while it cannot be seen
    curtain.classList.remove('down');
    runCurtain._b = setTimeout(() => curtain.classList.remove('on'), LIFT_MS);
  }, DROP_MS + HOLD_MS);
}

function cancelCurtain() {
  clearTimeout(runCurtain._a); clearTimeout(runCurtain._b);
  $('curtain').classList.remove('on', 'down');
}

// ── selectors ──────────────────────────────────────────────────────────────
function fillSelectors() {
  const from = $('from');
  from.innerHTML = Object.entries(CONSOLES).map(([id, c]) =>
    `<option value="${id}"${c.read ? '' : ' disabled'}>${esc(c.label)}${c.read ? '' : ' — reading not supported yet'}</option>`
  ).join('');
  from.value = 'x32';
  syncTargets();
}

// Every desk stays listed as a target, including the one selected as the source.
// Filtering the source out left a single-entry list that read as "this desk
// cannot be converted to", when the real answer is "swap the direction".
function syncTargets() {
  const fromId = $('from').value;
  const to = $('to');
  const prev = to.value;
  to.innerHTML = Object.entries(CONSOLES)
    .map(([id, c]) => {
      const same = id === fromId;
      const ok = canConvert(fromId, id);
      const why = same ? ' — same as source, use swap' : (ok ? '' : ' — not yet');
      return `<option value="${id}"${ok ? '' : ' disabled'}>${esc(c.label)}${why}</option>`;
    }).join('');
  const firstOk = [...to.options].find(o => !o.disabled);
  to.value = [...to.options].some(o => o.value === prev && !o.disabled) ? prev : (firstOk ? firstOk.value : '');
  syncHints();
}

function syncHints() {
  const src = CONSOLES[$('from').value];
  const r = route();
  $('fromHint').textContent = `Expects a .${src.ext} ${src.what}.`;
  $('toHint').textContent = r ? r.hint : 'No converter for this pairing yet.';
  $('file').setAttribute('accept', '.' + src.ext);
  $('dropTitle').innerHTML = `Drop a <code>.${esc(src.ext)}</code> file here`;
  $('optcard').hidden = !r;
  if (state.ir) { state.shown = false; cancelCurtain(); render(); } else reset(false);
}

// ── conversion ─────────────────────────────────────────────────────────────
function currentInclude() {
  const include = {};
  for (const [key] of SECTIONS) {
    const box = document.querySelector(`input[data-sec="${key}"]`);
    include[key] = box ? box.checked : true;
  }
  return include;
}

function renderOptions() {
  if ($('opts').children.length) return;          // keep the user's choices
  $('opts').innerHTML = SECTIONS.map(([key, label]) =>
    `<label class="opt"><input type="checkbox" data-sec="${esc(key)}" checked /><span>${esc(label)}</span></label>`
  ).join('');
  $('opts').querySelectorAll('input').forEach(b => b.addEventListener('change', render));
}

function render() {
  const ir = state.ir, r = route();
  if (!ir || !r) { $('report').classList.remove('on'); return; }

  renderOptions();
  const out = writeScene(ir, $('to').value, currentInclude());
  state.out = out;

  const rows = out.preview || [];
  $('stats').innerHTML = [
    [out.stats.channels, 'channels out'],
    [out.stats.stereoPairs, r.pairLabel],
    [out.stats.named, 'named'],
    [out.stats.dcas, 'DCAs'],
    [(out.stats.bytes / 1024).toFixed(0) + ' KB', 'output'],
  ].map(([n, l]) => `<div class="stat"><div class="stat-n">${esc(n)}</div><div class="stat-l">${esc(l)}</div></div>`).join('');

  $('chcount').textContent = `${rows.length} channels`;
  $('chlist').innerHTML =
    '<thead><tr><th></th><th>Name</th><th>From</th><th>Patch</th><th>Groups</th></tr></thead><tbody>' +
    rows.map((p, i) => `<tr>
        <td class="n">${esc(p.span || p.n)}</td>
        <td class="nm"><span class="swatch" style="--i:${i};--from:${esc(p.colorHex || 'transparent')};--to:${esc(p.outColorHex || p.colorHex || 'transparent')};background:${esc(p.outColorHex || p.colorHex || 'transparent')}"></span>${esc(p.name || '—')}</td>
        <td class="src">${esc(p.source)}${p.stereo ? ' <span class="pill">stereo</span>' : ''}</td>
        <td class="src">${esc(p.patch)}</td>
        <td class="src">${esc(p.groups)}</td>
      </tr>`).join('') + '</tbody>';

  // Graded, the most serious first: what did not make it at all leads.
  const report = reportRows(out.losses);
  $('warncard').hidden = report.length === 0;
  $('warns').innerHTML = report.map((r, i) =>
    `<div class="warn-row" style="--i:${i}"><span class="sev sev-${esc(r.severity)}">${esc(r.severity)}</span><span>${esc(r.text)}</span></div>`).join('');
  $('warncount').textContent = report.length ? `${report.length} to check` : '';

  $('go').disabled = state.shown;
  $('go').hidden = state.shown;
  $('dl').hidden = !state.shown;
  $('dl').disabled = !state.shown;
  $('report').classList.toggle('on', state.shown);
  setStatus(state.shown
    ? `Ready — ${rows.length} channels to ${CONSOLES[$('to').value].label}.`
    : `Loaded — press Convert for ${CONSOLES[$('to').value].label}.`);

  const moving = animateNext;
  animateNext = false;
  paintCard();
  replay($('warns'), 'staggered', moving);
  replay($('chlist'), 'landing', moving);
}

// ── file intake ────────────────────────────────────────────────────────────
function handleFile(file) {
  if (!file) return;
  const src = CONSOLES[$('from').value];

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext !== src.ext) {
    reset(false);
    setStatus(`That's a .${ext} file — ${src.label} uses .${src.ext}. Pick the right "From console", or choose a different file.`, true);
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    reset(false);
    setStatus('That file is over 8 MB — it is probably not a scene file.', true);
    return;
  }

  const fr = new FileReader();
  fr.onerror = () => setStatus('Could not read that file.', true);
  fr.onload = () => {
    try {
      state.shown = false;
      state.ir = readScene($('from').value, String(fr.result), file.name);
      state.baseName = file.name.replace(/\.[^.]+$/, '') || 'scene';
      $('fname').textContent = file.name + (state.ir.name ? ` — “${state.ir.name}”` : '');
      $('drop').classList.add('loaded');
      render();
    } catch (e) {
      reset(false);
      setStatus(e.message || 'Could not read that file.', true);
    }
  };
  fr.readAsText(file);
}

function reset(clearStatus = true) {
  state = { ir: null, out: null, baseName: 'scene', shown: false };
  $('file').value = '';
  $('report').classList.remove('on');
  cancelCurtain();
  $('filecard').classList.remove('on', 'done');
  $('drop').classList.remove('loaded');
  $('dropSub').textContent = 'or click to choose · converted locally, never uploaded';
  $('dl').disabled = true;
  if (clearStatus) setStatus('Waiting for a file.');
}

// ── wiring ─────────────────────────────────────────────────────────────────
const drop = $('drop');

// Changing the source desk invalidates whatever is loaded — the file was read
// by a different parser, so re-rendering it under the new route would show a
// conversion that was never actually performed.
$('from').addEventListener('change', () => { reset(); syncTargets(); });
$('to').addEventListener('change', syncHints);

// Swapping changes which parser reads the file, so whatever is loaded is no
// longer valid — reset first, exactly as changing the source desk does.
$('swap').addEventListener('click', () => {
  const from = $('from').value, to = $('to').value;
  if (!from || !to) return;
  if (!canConvert(to, from)) {
    setStatus(`There's no converter from ${CONSOLES[to].label} to ${CONSOLES[from].label} yet.`, true);
    return;
  }
  reset();
  $('from').value = to;
  syncTargets();
  $('to').value = from;
  syncHints();
  setStatus(`Converting ${CONSOLES[to].label} to ${CONSOLES[from].label}. Waiting for a file.`);
});
$('file').addEventListener('change', (e) => handleFile(e.target.files[0]));

drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); }
});
['dragenter', 'dragover'].forEach(ev =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));

$('go').addEventListener('click', () => {
  if (!state.ir || !route() || state.shown) return;
  $('go').disabled = true;
  // The conversion itself already ran — render() built the output when the
  // file loaded, and Convert is what reveals it.
  runCurtain(() => { state.shown = true; animateNext = true; render(); });
});

$('dl').addEventListener('click', () => {
  if (!state.out || !route()) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([state.out.file.text], { type: state.out.file.mime }));
  a.download = `${state.baseName}.${state.out.file.ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('clear').addEventListener('click', () => { reset(); drop.focus({ preventScroll: true }); });

fillSelectors();
reset();
