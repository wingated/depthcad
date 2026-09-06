# DepthCAD

A browser-based, layer-oriented editor for building **grayscale depth maps** for laser engraving (LightBurn and friends).

Import scanned or rendered depth maps, composite them with geometric primitives and text, mask and transform each layer, preview the result as a 3D surface, and export a clean grayscale PNG.

![DepthCAD editing a medallion](docs/screenshot.png)

The whole application ships as a single HTML file with no dependencies. Open `depthcad.html` in Chrome, Edge, Safari or Firefox and start working.

## Why

Making a good engraving depth map usually means combining several pieces of 3D information: a sculpted relief from a scan, a decorative ring or base plate, a flat area for text, a hole for a keychain. Doing that in an image editor is awkward because "max" compositing and height profiles are not first-class operations. DepthCAD treats the depth map as a stack of 3D layers and gives each one the tools that matter for engraving.

## Conventions

* **0 = deepest (black), maximum = highest (white).** The whole pipeline is 16-bit: values are stored as normalized floats and shown as 0–65535 by default (or 8-bit, percent, or millimetres, chosen in the document settings).
* **8-bit images are stretched to the full 16-bit range on import; 16-bit PNGs are used as they are.** Export writes 16-bit PNG, or 8-bit PNG with dithering so gradients do not band.
* **Layers combine with a per-pixel max** ("Union"). Overlapping geometry therefore intersects the way real solids would.
* Black (value 0) in an imported image is transparent by default, so the background of a scan never covers the layers below it.
* All coordinates are document pixels. The document size is set on first import (to the image size) and can be changed at any time from the status bar.

## Features

**Layers**

* **Image layers**: import 8- or 16-bit PNG (or JPEG) depth maps; drag and drop works. The PNG codec is built in, so 16-bit data is never squashed to 8 bits by the browser.
* **Shape layers**: rectangles (optional corner radius) and ellipses, with an *inner* ratio to make rings and frames. Height profiles: flat, linear (cone), dome (a ring with the dome profile is a torus), cosine, and bevel (a ramp of a fixed number of pixels). Each shape has a low and high value.
* **Text layers**: any installed font, or a loaded `.ttf`/`.otf`/`.woff` file that is embedded in the project. Weight, italic, size, line height, letter spacing, alignment. The font menu previews every family in its own face.

**Compositing**

* Blend modes per layer: **Union** (max), **Clamp** (min: flattens whatever is under it), **Replace**, **Cut** (erases everything below inside the layer: engrave text into a surface, punch a hole), **Keep** (erases everything below outside the layer: crop to a shape).
* **Groups** nest layers. Moving or scaling a group moves its contents; blend modes and modifiers on a group apply to the group's composite.
* **Masks** are layers of their own: a mask clips every layer above it in the same group. Rect or ellipse, optionally inverted. "Add mask" on a layer wraps it in a group with a mask so the effect stays local.
* **Modifiers** are stacked on any layer or group: Levels, Curve (an editable nonlinear depth remap), Clamp, Feather (soft coverage edge), Blur, Offset. Lifting *Out black* in Levels puts a model on a pedestal.

**Editing**

* Drag to move, corner and edge handles to scale, a rotation handle, numeric fields for everything. Per-layer aspect lock, Shift and Alt modifiers, arrow-key nudging.
* Multi-selection (Shift-click), align and distribute, group and ungroup, copy and paste (also between browser tabs), duplicate, lock, hide.
* Unlimited undo/redo, layer reordering by drag, including into and out of groups.
* Interactive preview at a chosen resolution (export is always full resolution).
* Cursor readout of the composite value under the mouse.

**3D view**

* WebGL2 heightfield sampling the float composite directly, with orbit, zoom and pan, a height exaggeration slider, grid resolution up to 4096, clay / gray / heat shading and a smoothing toggle.

**Files**

* Projects save as a single `.dcad.json` that embeds the imported images and fonts. Version 1 projects open and are migrated.
* Autosave to the browser's IndexedDB; the last project is restored on reload.
* Export: 16-bit grayscale PNG, or 8-bit grayscale PNG with Floyd–Steinberg or ordered dithering, at document resolution.

## Getting started

1. Open `depthcad.html` in a browser (double-click the file, or serve the folder with any static server).
2. Click **+ Image** (or drop a file on the window) to import a depth map. The document takes the image's size.
3. Add a **+ Ellipse**: it appears as a torus ring by default. Drag its handles to size it around the model.
4. Add **+ Text**, type a caption, pick a font.
5. Spin the 3D view to check the result, then **Export PNG**.

To try the tool immediately, open one of the projects in [`examples/`](examples/) with the **Open** button.

### Keyboard

| Key | Action |
| --- | --- |
| Drag / arrows | Move (Shift: constrain / nudge 10 px) |
| Corner or edge handle | Scale (Shift toggles aspect lock, Alt scales about the center) |
| Round handle | Rotate (Shift snaps to 15°) |
| Wheel / pinch | Zoom |
| Space + drag, middle drag, drag empty space | Pan |
| Ctrl/Cmd + Z, Ctrl/Cmd + Shift + Z | Undo, redo |
| Ctrl/Cmd + C, Ctrl/Cmd + V, Ctrl/Cmd + X | Copy, paste, cut layers |
| Ctrl/Cmd + D | Duplicate layer |
| Ctrl/Cmd + G, Ctrl/Cmd + Shift + G | Group, ungroup |
| Ctrl/Cmd + A | Select all |
| Delete | Delete selection |
| Ctrl/Cmd + S, Ctrl/Cmd + O, Ctrl/Cmd + E | Save, open, export |
| F, 1 | Fit view, 100 % |
| Esc | Deselect |

The **?** button in the toolbar shows the same reference inside the app.

## Examples

| | |
| --- | --- |
| ![](examples/christus-medallion.png) | **[christus-medallion](examples/christus-medallion.dcad.json)**: a scanned relief on a flat base plate, clipped by a feathered circular mask (a mask node in a group), with a torus ring and two text captions. |
| ![](examples/terrain-coaster.png) | **[terrain-coaster](examples/terrain-coaster.dcad.json)**: a bevelled rounded-rect base, a terrain with a Levels modifier clipped to a circle, a rim, a group with a Curve modifier, a Clamp layer that flattens the peaks, and a label engraved with Cut mode. |
| ![](examples/shapes-primer.png) | **[shapes-primer](examples/shapes-primer.dcad.json)**: one of everything. Every profile, a frame, a torus, Clamp and Cut layers, an inverted image with a mask, rotated text. |

The example images live in `examples/assets/`. The Christus relief is included at 1024 px for size.

## LightBurn notes

* Export, then import the PNG into LightBurn as an image and set the image mode to **Grayscale** (or your controller's equivalent). Because 0 is deepest, the engraver removes the most material where the map is black.
* Set the document size to match your engraving resolution. A 100 mm piece at 0.1 mm/pixel is a 1000 px document. Export is always at document resolution, so the preview setting does not affect the output.
* Keep flat regions at exactly the same value (shape layers guarantee this); avoid gradients in areas you want to remain smooth after multiple passes.
* If your controller accepts 16-bit PNG, export 16-bit and there is no banding at all. For 8-bit output, the default Floyd–Steinberg dither spreads the quantization error so gradients stay smooth; pixels that already sit on an exact 8-bit level (flat shapes) are not touched.

## Project file format

A project is JSON with a node tree:

```jsonc
{
  "app": "DepthCAD", "version": 2, "name": "medallion",
  "doc": { "w": 1024, "h": 1024, "bg": 0, "unit": "u16", "mmPerPx": 0.1, "depthMm": 2 },
  "root": { "id": "root", "kind": "group", "children": [ /* bottom to top */
    { "id": "…", "kind": "group", "name": "Christus (masked)", "visible": true, "blend": "max", "modifiers": [], "children": [
      { "kind": "mask", "x": 512, "y": 512, "sx": 1, "sy": 1, "rot": 0, "params": { "shape": "ellipse", "w": 820, "h": 820, "invert": false },
        "modifiers": [ { "kind": "feather", "radius": 6 } ] },
      { "kind": "image", "params": { "imageId": "…", "zeroAlpha": true }, "modifiers": [ { "kind": "levels", "outB": 0.1, "outW": 1 } ], "…": "…" } ] },
    { "kind": "shape", "params": { "shape": "ellipse", "w": 940, "h": 940, "inner": 0.86, "profile": "dome", "low": 0, "high": 0.78 }, "…": "…" },
    { "kind": "text", "params": { "text": "HE IS RISEN", "family": "Georgia", "weight": "700", "size": 62, "value": 0.92, "layout": { "kind": "linear" } }, "…": "…" }
  ] },
  "images": { "<id>": { "dataURL": "data:image/png;base64,…", "w": 1024, "h": 1024, "bits": 8 } },
  "fonts":  { "<id>": { "name": "Chalkduster", "dataURL": "data:font/ttf;base64,…" } }
}
```

Every node has `x`/`y` (centre, document pixels), `sx`/`sy` (scale of the natural size: image pixels or measured text box), `rot`, `lockAspect`, `blend`, `modifiers`, and kind-specific `params`. Shapes and masks store their size in `params.w`/`params.h`. Depth values are normalized floats in 0–1. Version 1 files (flat layer list, 0–255 values) are migrated on load.

## Architecture

The source lives in `src/` as ES modules and `build.js` bundles them into the single-file `depthcad.html`:

* `engine/`: DOM-free core. `raster.js` (Float32 height + coverage rasters, blending), `transform.js` (boxes, resampling), `sdf.js` (shape distance fields and profiles), `modifiers.js`, `composite.js` (the tree compositor: groups, sibling masks, caching), `png.js` (8/16-bit codec), `dither.js`, `kinds.js` (node kind registry).
* `kinds/`: one file per node kind (`image`, `shape`, `text`, `mask`, `group`). A kind provides a parameter schema, `measure` and `render`; everything else (transform, blend, masks, modifiers, caching, undo, serialization) is shared, so a new kind is a small file and gets a generated properties panel.
* `app/`: `state.js` (document, tree helpers, serialization, v1 migration, display units), `commands.js` (every mutation, the API that the UI, tests and future extension tools use), `history.js` (undo), `render.js` (preview scheduling), `io.js` (import, export, autosave).
* `ui/`: canvas editor, layer tree, schema-driven properties panel, font picker, 3D view, dialogs.

See [docs/DESIGN.md](docs/DESIGN.md) for the roadmap: mesh (STL/OBJ) import, extension tools and the optional AI agent.

## Development

```bash
npm install          # puppeteer-core for the browser test (uses your installed Chrome)
npm run build        # bundles src/ into depthcad.html
npm run test:unit    # engine unit tests in Node (no browser)
npm run test:smoke   # drives the built app in headless Chrome
npm test             # both
node tests/gen-examples.js   # regenerates the example projects and screenshots
```

Edit files under `src/`, rebuild, reload. The built `depthcad.html` is committed so the app can be used and deployed without any tooling.

## Roadmap

* Mesh import: render an STL or OBJ orthographically into a 16-bit layer with interactive orientation and clipping planes.
* Extension tools: JSON-defined layer generators with generated mini-UIs, shareable as files, and an optional AI assistant that writes them.
* Text along a circular path (inside and outside).

## License

MIT, see [LICENSE](LICENSE).
