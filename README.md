# StageBuilder free tools

The free tools from StageBuilder, served at <https://stagebuilder.ericdahl.dev>:

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
| `js/console-map.js` | Colour and icon mapping between desks |
| `js/losses.js` | The graded "check these on the desk" report |
| `js/scene-text.js` | Shared `.scn` tokenising |
| `js/convert.js` | Converter page UI |
| `js/ltc.js`, `js/zip.js` | LTC encoder and the zip writer for batch export |
| `js/nav-tools.js`, `js/version-tag.js`, `css/brand.css`, `fonts/` | Shared chrome |

## Tests and their limits

`test/fixtures/synthetic-x32.scn` is hand-written, not saved off a desk. The round-trip tests prove
the readers and writers agree with each other; they do not prove a console will load the output.
Real `.scn` and `.snap` files from each desk would make much stronger fixtures.

## History

The first commit is the site exactly as stagebuilderpro.com served it on 2026-09-24
(APP_VERSION 2.6), recovered because the original source repo was not available.
`js/constants.js` still carries the stage-plot app's constants; only `APP_VERSION` is used here.
