// ─── X32 / M32 channel presets ─────────────────────────────────────────────
// A channel preset (.chn) is a channel's nodes without the /ch/NN prefix,
// since it can be loaded onto any channel, under a header that carries its
// library slot before the name: #4.0# <pos> "Name" <type> %<flags> 1.
// It is read as a one-channel scene: the nodes are placed on channel 1 and
// handed to the scene reader.

import { parseX32Scene } from './x32-scene.js';
import { num, bool } from './scene-text.js';
import { loss } from './losses.js';

const PRESET_HEADER = /^#[\d.]+#\s+\d+\s+"([^"]*)"/;

export const isChannelPreset = (text) => PRESET_HEADER.test(String(text).split(/\r?\n/, 1)[0]);

function asScene(text) {
  const lines = String(text).split(/\r?\n/);
  const name = PRESET_HEADER.exec(lines[0])[1];
  const body = lines.slice(1).map(l => (l[0] === '/' && !l.startsWith('/headamp/') ? '/ch/01' + l : l));
  return [`#4.0# "${name}"`, ...body].join('\n');
}

// A preset names no input: it takes whatever the channel it lands on is
// patched to. Its one headamp is that input's gain and phantom, so the channel
// keeps them and is left unpatched rather than given an input it never had.
export function readChannelPreset(text) {
  const scene = parseX32Scene(asScene(text));
  const ha = /^\/headamp\/\d+ (\S+) (\S+)/m.exec(String(text));
  if (ha && scene.channels[0]) scene.channels[0].headamp = { gain: num(ha[1]), phantom: bool(ha[2]) };
  scene.losses.unshift(loss('file.channel-preset', { name: scene.name }));
  return scene;
}
