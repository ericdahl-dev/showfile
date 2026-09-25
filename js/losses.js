// ─── Structured conversion losses ──────────────────────────────────────────
// Every way a show can fail to survive a conversion, as data rather than as a
// sentence assembled at the call site.
//
// Why this matters more than it looks: the list of what did NOT transfer is
// the product. Copying channel names is easy and every free converter does it;
// telling an engineer exactly what to fix before doors is the part they trust.
// Prose scattered across five emitters cannot be grouped by channel, sorted by
// urgency, exported as a checklist, or asserted on in a test without matching
// a regex against English.
//
// So a loss carries a code, a severity, what it happened to, and the numbers.
// This module owns the only place any of it becomes a sentence.
//
// Phase 1 of docs/converter-roadmap.md.

// What the engineer has to DO about it, which is how they triage at load-in.
export const SEVERITY = {
  dropped:      'did not make it at all',
  degraded:     'made it, but worse',
  approximated: 'mapped to the nearest available value',
  relocated:    'present, but somewhere else',
  unsupported:  'the concept does not exist on the target desk',
  check:        'probably fine, verify on the desk',
};

const plural = (n, one = '', many = 's') => (n === 1 ? one : many);

// code -> severity + the one place it turns into English.
//
// The renderers reproduce the strings these replaced verbatim, which is what
// lets the Phase 0 golden files prove the change was neutral. Reword freely
// later — but reword HERE, once, for every desk at the same time.
const CODES = {
  'channel.overflow-from': { severity: 'dropped', render: (d) =>
    `"${d.name}" and everything after it is past the ${d.desk}'s ${d.limit} channels and was dropped.` },

  'channel.overflow-count': { severity: 'dropped', render: (d) =>
    `${d.count} channel${plural(d.count)} did not fit the ${d.desk}'s ${d.limit}.` },

  'channel.overflow-one': { severity: 'dropped', render: (d) =>
    `Channel ${d.n} ("${d.name}") is past the ${d.desk}'s ${d.limit} and was dropped.` },

  'channel.over-limit': { severity: 'check', render: (d) =>
    `Source has ${d.count} channels; the ${d.desk} has ${d.limit}.` },

  'stereo.pair-alignment': { severity: 'relocated', render: (d) =>
    `The ${d.desk} only links channel pairs 1-2, 3-4 and so on, so ${d.gaps.length === 1
      ? 'a stereo channel left channel ' + d.gaps[0] + ' empty'
      : 'stereo channels left channels ' + d.gaps.join(', ') + ' empty'}. Channel order matches the source; the empty slots are free to reuse.` },

  'patch.block-granularity': { severity: 'check', render: (d) =>
    `Channels ${d.first}-${d.last} are routed as one block of eight (${d.token}), which is the only way the ${d.desk} patches. ${d.stray.length} channel${plural(d.stray.length)} cannot be addressed inside it and need repatching on the desk: ${d.stray.join(', ')}.` },

  'stereo.balance-lost': { severity: 'dropped', render: (d) =>
    `${d.label}: the source is a single stereo channel balanced ${d.balance > 0 ? 'right' : 'left'} (${d.balance > 0 ? '+' : ''}${d.balance}). The ${d.desk} builds stereo from two hard-panned mono strips, so the balance could not come with it — reset it on the desk if the image sounded off-centre.` },

  'patch.group-unsupported': { severity: 'unsupported', render: (d) =>
    `${d.label}: input type "${d.group}" has no ${d.desk} equivalent; left unpatched.` },

  'patch.group-unknown': { severity: 'unsupported', render: (d) =>
    `${d.label}: source group "${d.group}" is not one this converter knows; left unpatched.` },

  'patch.input-overflow': { severity: 'check', render: (d) =>
    `${d.label}: local input ${d.input} is past the ${d.desk}'s ${d.limit}; repatch to a stagebox.` },

  'send.bus-overflow': { severity: 'dropped', render: (d) =>
    `${d.label}: send${plural(d.buses.length)} to bus ${d.buses.join(', ')} dropped — the ${d.desk} has ${d.limit} buses. Rebuild ${d.buses.length === 1 ? 'that mix' : 'those mixes'} on the desk.` },

  'preamp.trim-dropped': { severity: 'dropped', render: (d) =>
    `${d.label}: ${d.trim > 0 ? '+' : ''}${d.trim} dB digital trim dropped — the ${d.desk} has no trim on an input channel. Set it with the preamp gain.` },

  'send.tap-approximated': { severity: 'approximated', render: (d) =>
    `${d.label}: send${plural(d.buses.length)} to bus ${d.buses.join(', ')} taken before the EQ or at the input — the ${d.desk} has no such tap, so ${d.buses.length === 1 ? 'it is' : 'they are'} now pre-fader.` },

  'range.clamped': { severity: 'approximated', render: (d) =>
    `${d.label}: ${d.what} ${d.from} dB is outside the ${d.desk}'s range; set to ${d.to} dB.` },

  'dyn.model-unsupported': { severity: 'unsupported', render: (d) =>
    `${d.label}: the ${d.what} slot holds a ${d.model}, which other desks don't have; left off.` },

  'dyn.ratio-snapped': { severity: 'approximated', render: (d) =>
    `${d.label}: compressor ratio ${d.from}:1 is not on the ${d.desk}; set to ${d.to}:1.` },

  'color.palette-collapse': { severity: 'degraded', render: (d) =>
    `The ${d.desk} has ${d.to} strip colours to the source's ${d.from}, so ${d.count} colour group${plural(d.count)} collapsed — channels that looked different now share a colour.` },

  'eq.band-overflow': { severity: 'dropped', render: (d) =>
    `${d.label}: ${d.count} EQ bands did not fit the ${d.desk}'s ${d.limit}; the extras were dropped.` },

  'eq.lowcut-no-slot': { severity: 'dropped', render: (d) =>
    `${d.label}: a low-cut EQ band at ${d.freq} Hz could not come across — the ${d.desk}'s own low cut is already carrying the channel high-pass, and its EQ has no cut band. Add the rolloff by hand if you need both.` },

  'eq.mid-band-overflow': { severity: 'dropped', render: (d) =>
    `${d.label}: ${d.count} parametric EQ bands did not fit the ${d.desk}'s four mids; the extras were dropped.` },

  'matrix.overflow': { severity: 'dropped', render: (d) =>
    `The source has ${d.count} matrices; the ${d.desk} has ${d.limit}, so the rest were dropped.` },

  'group.membership-dropped': { severity: 'dropped', render: (d) =>
    `${d.label}: ${d.kind} ${d.lost.join(' and ')} ${d.lost.length === 1 ? 'does' : 'do'} not exist on the ${d.desk}, which has ${d.limit}. The channel is no longer in ${d.lost.length === 1 ? 'it' : 'them'} — check anything you mute or ride as a group.` },

  'dca.overflow': { severity: 'dropped', render: (d) =>
    `The source has ${d.count} DCAs; the ${d.desk} has ${d.limit}, so the rest were dropped.` },

  'fx.engine-unsupported': { severity: 'unsupported', render: (d) =>
    `${d.count} FX send${d.count === 1 ? ' is' : 's are'} active. The ${d.desk}'s four internal FX engines have no equivalent on the target desk, so the sends were not carried across — rebuild the effects and their sends on the desk.` },

  'file.model-mismatch': { severity: 'check', render: (d) =>
    `Snapshot reports model "${d.model}" rather than "${d.expected}"; reading it as a ${d.expected} file anyway.` },
};

export function loss(code, detail = {}, scope = null) {
  const spec = CODES[code];
  if (!spec) throw new Error(`Unknown loss code "${code}" — add it to js/losses.js`);
  return { code, severity: spec.severity, scope, detail };
}

export const render = (l) => (typeof l === 'string' ? l : CODES[l.code].render(l.detail));

// Existing callers still take warnings as a flat string[]; the structured list
// rides alongside until the UI consumes it (Phase 5).
export const renderAll = (losses) => (losses || []).map(render);

export const KNOWN_CODES = Object.keys(CODES);

// A channel in DCA 6 on a desk with four DCAs does not just lose the group —
// the engineer loses a fader they were riding, and nothing on screen says so.
// mask() silently ignores members past its width, so the report has to be
// made before the mask is built.
export function reportLostMembership(out, c, n, name, desk, dcaLimit, mgLimit) {
  const label = `ch ${n} "${name}"`;
  const lostD = c.dcas.filter(d => d > dcaLimit);
  const lostM = c.muteGroups.filter(m => m > mgLimit);
  if (lostD.length) out.push(loss('group.membership-dropped',
    { label, kind: 'DCA', lost: lostD, desk, limit: dcaLimit }, { kind: 'channel', n, name }));
  if (lostM.length) out.push(loss('group.membership-dropped',
    { label, kind: 'mute group', lost: lostM, desk, limit: mgLimit }, { kind: 'channel', n, name }));
}
