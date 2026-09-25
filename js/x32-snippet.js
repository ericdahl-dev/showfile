// ─── X32 / M32 snippets ────────────────────────────────────────────────────
// A snippet (.snp) holds the part of a scene its filters chose to save. Its
// header carries four filter masks after the name, where a scene's carries a
// note and a safes mask: #4.0# "Name" <event> <channels> <aux> <main> 1.
//
// Its body mixes the scene's compound lines (/ch/09/config "Kick" 5 RD 9)
// with single values (/ch/17/config/name "Kick", /ch/17/mix/fader -oo). The
// single values are folded back into compound lines, a field the snippet
// does not set taking the desk's default, and the result is read as a scene.

import { parseX32Scene } from './x32-scene.js';
import { loss } from './losses.js';

const SNIPPET_HEADER = /^#[\d.]+#\s+"([^"]*)"\s+-?\d+\s+-?\d+\s+-?\d+\s+-?\d+\s+1\b/;

export const isSnippet = (text) => SNIPPET_HEADER.test(String(text).split(/\r?\n/, 1)[0]);

// Compound node -> its fields in order, with the default for each.
const FIELDS = {
  config: [['name', '""'], ['icon', '1'], ['color', 'OFF'], ['source', '0']],
  mix:    [['on', 'ON'], ['fader', '-oo'], ['st', 'ON'], ['pan', '+0'], ['mono', 'OFF'], ['mlevel', '-oo']],
  grp:    [['dca', '%00000000'], ['mute', '%000000']],
  // A DCA left at unity: an unset DCA fader must not silence its channels.
  dca:    [['on', 'ON'], ['fader', '0.0']],
};

// Nodes the scene writes as one array and a snippet as single slots:
// /config/chlink/31-32 ON is the 16th pair link, /config/routing/IN/9-16 the
// second routing block, /config/userrout/in/05 the fifth user-routing slot.
// Each maps a slot's key to its index; an unset slot takes the default.
const ARRAYS = {
  '/config/chlink':      { size: 16, fill: 'OFF', index: (k) => (parseInt(k, 10) - 1) >> 1 },
  '/config/routing/IN':  { size: 5,  fill: 'OFF', index: (k) => ['1-8', '9-16', '17-24', '25-32', 'AUX'].indexOf(k) },
  '/config/userrout/in': { size: 32, fill: '0',   index: (k) => parseInt(k, 10) - 1 },
};

function compoundOf(path) {
  let m = /^(\/ch\/\d\d\/(config|mix|grp))(?:\/([a-z]+))?$/.exec(path);
  if (m) return { node: m[1], kind: m[2], field: m[3] };
  m = /^(\/dca\/\d)(?:\/(on|fader))?$/.exec(path);
  if (m) return { node: m[1], kind: 'dca', field: m[2] };
  return null;
}

const tokens = (s) => s.match(/"[^"]*"|\S+/g) || [];

function asScene(text) {
  const lines = String(text).split(/\r?\n/);
  const name = SNIPPET_HEADER.exec(lines[0])[1];
  const compound = new Map();                    // '/ch/17/mix' -> token array
  const out = [];
  const node = (path, kind) => {
    if (!compound.has(path)) {
      compound.set(path, FIELDS[kind].map(f => f[1]));
      out.push(path);                            // placeholder, filled at the end
    }
    return compound.get(path);
  };
  const array = (path, arr) => {
    if (!compound.has(path)) { compound.set(path, Array(arr.size).fill(arr.fill)); out.push(path); }
    return compound.get(path);
  };

  for (const line of lines.slice(1)) {
    if (line[0] !== '/') continue;
    const sp = line.indexOf(' ');
    const path = sp === -1 ? line : line.slice(0, sp);
    const args = sp === -1 ? [] : tokens(line.slice(sp + 1));

    const slash = path.lastIndexOf('/');
    const arr = ARRAYS[path.slice(0, slash)];
    if (arr) {
      const at = arr.index(path.slice(slash + 1));
      if (at >= 0 && at < arr.size && args.length) array(path.slice(0, slash), arr)[at] = args[0];
      continue;
    }

    // A compound line, and a single value of one: /ch/17/mix, /ch/17/mix/fader;
    // /dca/3, /dca/3/fader. /dca/3/config is a line of its own and passes through.
    const c = compoundOf(path);
    if (c && !c.field) { node(path, c.kind).splice(0, args.length, ...args); continue; }
    if (c) {
      const at = FIELDS[c.kind].findIndex(f => f[0] === c.field);
      if (at > -1 && args.length) node(c.node, c.kind)[at] = args[0];
      continue;
    }
    out.push(line);
  }

  const body = out.map(l => (compound.has(l) ? `${l} ${compound.get(l).join(' ')}` : l));
  return [`#4.0# "${name}"`, ...body].join('\n');
}

export function readSnippet(text) {
  const scene = parseX32Scene(asScene(text));
  if (!scene.channels.length) {
    throw new Error(`The snippet "${scene.name}" sets no channel's name, preamp or EQ, so there is no channel to convert.`);
  }
  scene.losses.unshift(loss('file.snippet', { name: scene.name, count: scene.channels.length }));
  return scene;
}
