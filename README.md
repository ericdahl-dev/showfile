# Showfile

Free browser tools for live production, served at <https://showfile.ericdahl.dev>:

- **Console Scene Converter** (`/convert/`): moves a show between the Behringer X32 / Midas M32,
  X Air / Midas MR and Behringer Wing, in any direction.
- **LTC Timecode Generator** (`/timecode-generator/`): SMPTE LTC WAV files at any frame rate,
  one file or a batch in a zip.

Both run entirely in the browser. There is no build step, no backend and no analytics: each page
is static HTML that loads plain ES modules from `js/`.

## Develop

```sh
npm run dev     # http://localhost:8080/convert/ and /timecode-generator/
npm test        # node --test, no dependencies
```

Pages use root-absolute paths (`/js/`, `/css/`, `/fonts/`), so open them through the dev server,
not from `file://`. `npm run dev` needs `python3`, and so does the zip test, which checks archives
with Python's `zipfile`.

## Layout

| Path | What it is |
|---|---|
| `convert/index.html` | Converter page |
| `timecode-generator/index.html` | LTC generator page (its UI script is inline) |
| `js/x32-scene.js`, `js/xair-scene.js`, `js/wing-scene.js` | Readers: desk file → neutral IR |
| `js/x32-emit.js`, `js/xair-emit.js`, `js/wing-snap.js` | Writers: IR → desk file |
| `js/console-map.js` | Color and icon mapping between desks |
| `js/losses.js` | The graded "check these on the desk" report |
| `js/scene-text.js` | Shared `.scn` tokenising |
| `js/convert.js` | Converter page UI |
| `js/ltc.js`, `js/zip.js` | LTC encoder and the zip writer for batch export |
| `js/ltc-batch.js` | LTC batch plan: file names, timecode spans, limits, sizes, manifest |
| `js/nav-tools.js`, `js/version-tag.js`, `css/brand.css`, `fonts/` | Shared chrome |
| `favicon.svg` | The mark (a fresnel, head-on); also the logo in the lockup. PNG icons are rendered from it |
| `css/brand.css` | Every color and font token, the stage-wash background and the logo lockup |
| `index.html` | Home page listing the tools |
| `og/index.html` | Source for the share images (not linked from the site) |

## Testing on a desk

`test/desk-pack/` holds each real fixture converted to every other desk, with a checklist
(`test/desk-pack/README.md`) of what to look for when loading it: on an XR18 through X-AIR-Edit, or
offline in X32-Edit and WING-EDIT. Regenerate with `npm run desk-pack`; the tests fail if the pack
no longer matches the converter.

## Share images

`og-image.jpg`, `og-image-convert.jpg` and `og-image-timecode.jpg` are screenshots of
`og/index.html`, which is kept as their source. To regenerate one after a copy or brand change:

1. `npm run dev`
2. Open `http://localhost:8080/og/?page=home` (or `convert`, `timecode`) with the browser viewport
   at exactly 1200×630 and a device pixel ratio of 1. In Chrome DevTools, use device toolbar,
   Responsive, 1200 × 630.
3. Capture the viewport as JPEG and save it over the matching file at the site root.

The timecode waveform is drawn from `js/ltc.js`, so it is real LTC for 01:00:00;00.

## Tests and their limits

`test/fixtures/real/` holds real scene files off an X32, an X Air and a Wing (see its `SOURCES.md`); the
tests read each one and convert it to both other desks. `test/fixtures/synthetic-x32.scn` is
hand-written, for cases the real files don't cover. Passing tests still don't prove a console loads
the output: that needs a round trip through the desk or its editor.

## History

The first commit is the site exactly as stagebuilderpro.com served it on 2026-09-24
(APP_VERSION 2.6), recovered because the original source repo was not available.
The tools began as part of StageBuilder Pro and were split out as Showfile on the same day,
with their own name, mark and domain. Releases: v1.0.0 is that untouched snapshot; v2.0.0 is Showfile with the Stage Wash redesign.

## Icons

```sh
rsvg-convert -w 32 -h 32 favicon.svg -o favicon.png
rsvg-convert -w 120 -h 120 favicon.svg -o /tmp/mark.png
magick -size 180x180 xc:'#0B1026' /tmp/mark.png -gravity center -composite -strip apple-touch-icon.png
```

## Licence

Showfile is free software under the GNU General Public License, version 3 or later
([`LICENSE`](LICENSE)). The real scene files in `test/fixtures/real/` come from other projects
under MIT and Apache-2.0; each folder keeps its own licence, and
[`SOURCES.md`](test/fixtures/real/SOURCES.md) lists where each file came from.

The X32, X Air and Wing file formats were checked against Patrick Maillot's unofficial protocol
documentation (https://sites.google.com/site/patrickmaillot/x32). It is used as a reference only;
none of it is copied here.
