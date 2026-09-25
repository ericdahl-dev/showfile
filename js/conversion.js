// ─── Scene conversion ──────────────────────────────────────────────────────
// The converter's one interface, with no DOM: read a desk's file into a scene,
// then write that scene for another desk. The page reads once when a file
// lands and writes again whenever an option changes, so the two steps are
// separate calls.
//
// Everything a caller needs to hand the result to the user comes back from
// writeScene: the file (text, extension, MIME type), the report, a per-channel
// preview and the stats. The page only renders it.

import { parseX32Scene } from './x32-scene.js';
import { parseXAirScene } from './xair-scene.js';
import { parseWingSnapshot } from './wing-scene.js';
import { emitX32Scene } from './x32-emit.js';
import { emitXAirScene } from './xair-emit.js';
import { emitWingSnapshot } from './wing-snap.js';
import { SEVERITY, render } from './losses.js';

// dcas is the desk's DCA count: what a scene written for it can actually hold.
export const DESKS = {
  x32:  { label: 'Behringer X32 / Midas M32', ext: 'scn',  what: 'scene file', mime: 'text/plain',       dcas: 8 },
  xair: { label: 'Behringer X Air / Midas MR', ext: 'scn',  what: 'scene file', mime: 'text/plain',       dcas: 4 },
  wing: { label: 'Behringer Wing',            ext: 'snap', what: 'snapshot',   mime: 'application/json', dcas: 16 },
};

const READERS = {
  x32:  (text) => parseX32Scene(text),
  xair: (text, fileName) => parseXAirScene(text, fileName),
  wing: (text) => parseWingSnapshot(text),
};

// Each writer returns { text, warnings, losses, preview, stats }. The Wing
// writer hands back the snapshot object instead of text; whatever saves it
// wants JSON, so it is serialised here, once.
const WRITERS = {
  x32:  (scene, include) => emitX32Scene(scene, { include }),
  xair: (scene, include) => emitXAirScene(scene, { include }),
  wing: (scene, include) => {
    const r = emitWingSnapshot(scene, { include });
    return { ...r, text: JSON.stringify(r.snapshot, null, 2) };
  },
};

export function canConvert(from, to) {
  return from !== to && from in DESKS && to in DESKS;
}

// Throws with a message meant for the person who picked the file.
export function readScene(from, text, fileName = '') {
  const read = READERS[from];
  if (!read) throw new Error(`Unknown desk "${from}".`);
  return read(String(text), fileName);
}

export function writeScene(scene, to, include = {}) {
  const write = WRITERS[to];
  if (!write) throw new Error(`Unknown desk "${to}".`);
  const out = write(scene, include);
  const preview = out.preview || [];
  const desk = DESKS[to];

  return {
    file: { text: out.text, ext: desk.ext, mime: desk.mime },
    warnings: out.warnings || [],
    losses: out.losses || [],
    preview,
    stats: {
      channels: out.stats.channels,
      stereoPairs: out.stats.stereoPairs,
      named: preview.filter(p => p.name).length,
      // The DCAs the target received, not the source's count: going down to
      // an X Air, four is all there is room for.
      dcas: (scene.dcas || []).filter(d => d.name && d.n >= 1 && d.n <= desk.dcas).length,
      bytes: out.text.length,
    },
  };
}

// The report as the page shows it: one row per loss, graded, the most serious
// first (the order of SEVERITY), keeping the writer's order within a grade.
// Lines that say the same thing about different channels become one line
// naming them: nine headsets with the same unsupported gate read as one.
const RANK = Object.fromEntries(Object.keys(SEVERITY).map((s, i) => [s, i]));
const CHANNEL_LABEL = /^ch (\d+) "([^"]*)"(.*)$/s;

export function reportRows(losses) {
  const groups = new Map();
  losses.forEach((l, i) => {
    const text = render(l);
    const m = CHANNEL_LABEL.exec(text);
    const key = m ? `${l.code}|${m[3]}` : `${i}|${text}`;
    if (!groups.has(key)) groups.set(key, { l, i, text, rest: m?.[3], who: [] });
    if (m) groups.get(key).who.push(m[2] || `ch ${m[1]}`);
  });
  return [...groups.values()]
    .map(g => ({
      severity: g.l.severity,
      rank: RANK[g.l.severity] ?? 99,
      text: g.who.length > 1 ? `${g.who.length} channels (${g.who.join(', ')})${g.rest}` : g.text,
      i: g.i,
    }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ i, ...row }) => row);
}
