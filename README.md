# DepthCAD

A browser-based, layer-oriented editor for building **16-bit grayscale depth maps** for laser engraving (LightBurn and friends).

Import scanned or rendered depth maps, take depth "screenshots" of 3D models, composite them with shapes, text and parametric tools, mask and transform every layer, preview the result as a 3D surface, and export a clean grayscale PNG.

![DepthCAD editing a medallion](docs/screenshot.png)

The whole application ships as a single HTML file with no dependencies. Open `depthcad.html` in Chrome, Edge, Safari or Firefox and start working.

## Why

Making a good engraving depth map usually means combining several pieces of 3D information: a sculpted relief from a scan, a decorative ring or base plate, a flat area for text, a hole for a keychain. Doing that in an image editor is awkward because "max" compositing, edge profiles and 16-bit precision are not first-class operations. DepthCAD treats the depth map as a stack of 3D layers and gives each one the tools that matter for engraving.

## Conventions

* **0 = deepest (black), maximum = highest (white).** The pipeline is 16-bit end to end: values are stored as normalized floats and shown as 0–65535 by default, or as 8-bit, percent, or millimetres (chosen in the document settings, where you also set mm per pixel and the full engraving depth).
* **8-bit images are stretched to the full 16-bit range on import; 16-bit PNGs are used as they are.** Export writes 16-bit PNG, or 8-bit PNG with dithering so gradients do not band.
* **Layers combine with a per-pixel max** ("Union"). Overlapping geometry therefore intersects the way real solids would.
* Black (value 0) in an imported image is transparent by default, so the background of a scan never covers the layers below it.
* All coordinates are document pixels. The document size is set on first import (to the image size) and can be changed at any time from the status bar.

## Features

### Layers

* **Image layers**: import 8- or 16-bit PNG (or JPEG) depth maps; drag and drop works. The PNG codec is built in, so 16-bit data is never squashed to 8 bits by the browser.
* **Shape layers**: rectangles (optional corner radius) and ellipses, with an *inner* ratio to make rings and frames. The edge is shaped by an **edge profile** applied over an **edge width** measured inward from the edge, independent of the ring width; rings and frames have a second profile and width on the inner edge, and where both bands overlap the lower height wins. Built-in profiles: flat, linear (bevel), dome, scallop (cove), cosine, plus ogee, ledge, fluted and stepped examples. Each shape has a low and high value.
* **Profile editor**: build your own edge profiles on a small workspace. The curve runs from the inside of the shape at full height (upper left) to the edge at zero (lower right) and is made of segments: line, dome (convex), cove (concave), smooth, step, and bezier with handles. Drag points and handles, split segments, start from any built-in, and watch the layer update live. Profiles are named, kept in the project and in your personal library, and exported or imported as `.profile.json` files.
* **Text layers**: any installed font, or a loaded `.ttf`/`.otf`/`.woff` file that is embedded in the project. Weight, italic, size, line height, letter spacing, alignment. The font menu previews every family in its own face.
* **Mesh layers**: import an STL or OBJ and take an orthographic depth screenshot of it. The import dialog shows the depth result live next to an orbitable 3D view with the bake box and the near/far clipping planes. Orient the model with view-from and 90° buttons, numeric angles, or by dragging the depth image; set the clipping range on a depth histogram, by dragging the planes, or with presets (farthest geometry, farthest visible, nearest visible); choose the resolution. The bake is 16-bit with supersampled edges, the mesh is embedded in the project, and the layer can be re-baked later.
* **Tool layers**: parametric generators defined as small JSON documents (a parameter schema plus a JavaScript render function) that run in a Worker and get a generated properties panel. Three ship as examples: a ring of stars, a noise texture, and text on an arc. Tools you import or write live in "My tools"; the ones a project uses are saved inside it. There is an editor with a test render, plus import and export.

### Compositing

* Blend modes per layer: **Union** (max), **Clamp** (min: flattens whatever is under it), **Replace**, **Cut** (erases everything below inside the layer: engrave text into a surface, punch a hole), **Keep** (erases everything below outside the layer: crop to a shape).
* **Groups** nest layers. Moving or scaling a group moves its contents; blend modes and modifiers on a group apply to the group's composite.
* **Masks** are layers of their own: a mask clips every layer above it in the same group. Rect or ellipse, optionally inverted. "Add mask" on a layer wraps it in a group with a mask so the effect stays local.
* **Modifiers** are stacked on any layer or group: Levels, Curve (an editable nonlinear depth remap), Clamp, Feather (soft coverage edge), Blur, Offset. Lifting *Out black* in Levels puts a model on a pedestal.

### Editing

* Drag to move, corner and edge handles to scale, a rotation handle, numeric fields for everything. Per-layer aspect lock, Shift and Alt modifiers, arrow-key nudging.
* Marquee selection and Shift-click, snapping to the document and to other layers with guide lines (hold Ctrl or Cmd to disable), align and distribute, group and ungroup, copy and paste (also between browser tabs), duplicate, lock, hide.
* Unlimited undo/redo, layer reordering by drag, including into and out of groups.
* Interactive preview at a chosen resolution (export is always full resolution). Moves reuse cached layer rasters, and scaling or rotating renders at reduced detail until you release, so a 4096 × 4096 document stays responsive.
* Cursor readout of the composite value under the mouse.

### 3D view

* WebGL2 heightfield sampling the float composite directly, with orbit, zoom and pan, a height exaggeration slider, grid resolution up to 4096, clay / gray / heat shading and a smoothing toggle.

### Assistant (optional)

* The ✦ button in the lower right opens a chat drawer. Bring your own API key for Anthropic (Claude), OpenAI, or Google; keys are stored only in your browser and sent only to that provider.
* The assistant reads the document, edits it through the same command API as the UI, samples heights to check its work, and writes new tools and edge profiles when the built-in ones cannot express what you ask for ("a ring of twelve raised stars around the statue", "a bead-and-cove edge on this frame"). Every reply is undoable in one click.

### Files

* Projects save as a single `.dcad.json` that embeds the imported images, fonts, meshes, tools and profiles. Version 1 projects open and are migrated.
* Autosave to the browser's IndexedDB; the last project is restored on reload.
* Export: 16-bit grayscale PNG, or 8-bit grayscale PNG with Floyd–Steinberg or ordered dithering, at document resolution.

## Getting started

1. Open `depthcad.html` in a browser (double-click the file, or serve the folder with any static server).
2. Click **+ Image** (or drop a file on the window) to import a depth map. The document takes the image's size. Or click **+ Mesh** to bake an STL or OBJ.
3. Add a **+ Ring**: it appears as a torus. Drag its handles to size it around the model, then change its edge profiles or widths in the panel.
4. Add **+ Text**, type a caption, pick a font. Try **Tools ▾** for a ring of stars or text on an arc.
5. Spin the 3D view to check the result, then **Export…**.

To try the tool immediately, open one of the projects in [`examples/`](examples/) with the **Open** button.

### Keyboard

| Key | Action |
| --- | --- |
| Drag / arrows | Move (Shift: constrain / nudge 10 px; Ctrl/Cmd: no snapping) |
| Drag on empty canvas | Marquee select (Shift adds) |
| Corner or edge handle | Scale (Shift toggles aspect lock, Alt scales about the center) |
| Round handle | Rotate (Shift snaps to 15°) |
| Wheel / pinch | Zoom |
| Space + drag, middle or right drag | Pan |
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
| ![](examples/shapes-primer.png) | **[shapes-primer](examples/shapes-primer.dcad.json)**: one of everything. Cone, dome and ogee profiles, a frame with a bevel outside and a cove inside, a torus, Clamp and Cut layers, an inverted image with a mask, rotated text. |
| ![](examples/tool-showcase.png) | **[tool-showcase](examples/tool-showcase.dcad.json)**: the three example tools at work. A hammered noise plate, a fluted ring, a ring of stars and text on an arc around the masked relief. |

The example images live in `examples/assets/`; the example tools are in `examples/tools/` (import them from the Tools menu). The Christus relief is included at 1024 px for size.

## LightBurn notes

* Export, then import the PNG into LightBurn as an image and set the image mode to **Grayscale** (or your controller's equivalent). Because 0 is deepest, the engraver removes the most material where the map is black.
* Set the document size to match your engraving resolution. A 100 mm piece at 0.1 mm/pixel is a 1000 px document. Export is always at document resolution, so the preview setting does not affect the output.
* Keep flat regions at exactly the same value (shape layers guarantee this); avoid gradients in areas you want to remain smooth after multiple passes.
* If your controller accepts 16-bit PNG, export 16-bit and there is no banding at all. For 8-bit output, the default Floyd–Steinberg dither spreads the quantization error so gradients stay smooth; pixels that already sit on an exact 8-bit level (flat shapes) are not touched.

## File formats

### Project

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
    { "kind": "shape", "params": { "shape": "ellipse", "w": 940, "h": 940, "inner": 0.86, "outerProfile": "dome", "outerWidth": 33, "innerProfile": "dome", "innerWidth": 33, "low": 0, "high": 0.78 }, "…": "…" },
    { "kind": "text", "params": { "text": "HE IS RISEN", "family": "Georgia", "weight": "700", "size": 62, "value": 0.92, "layout": { "kind": "linear" } }, "…": "…" },
    { "kind": "mesh", "params": { "imageId": "…", "meshId": "…", "bake": { "rot": [0, -90, 0], "scale": 480, "pan": [0, 0], "near": -1.5, "far": 1.5, "w": 1024, "h": 1024 } }, "…": "…" },
    { "kind": "tool:star-ring", "params": { "count": 16, "radius": 400, "size": 34 }, "…": "…" }
  ] },
  "images":   { "<id>": { "dataURL": "data:image/png;base64,…", "w": 1024, "h": 1024, "bits": 8, "covDataURL": "…(baked meshes only)" } },
  "fonts":    { "<id>": { "name": "Chalkduster", "dataURL": "data:font/ttf;base64,…" } },
  "meshes":   { "<id>": { "name": "cube", "dataURL": "data:application/octet-stream;base64,…" } },
  "tools":    { "star-ring": { /* tool document */ } },
  "profiles": { "p3k9x": { /* profile document */ } }
}
```

Every node has `x`/`y` (centre, document pixels), `sx`/`sy` (scale of the natural size: image pixels or measured text box), `rot`, `lockAspect`, `blend`, `modifiers`, and kind-specific `params`. Shapes and masks store their size in `params.w`/`params.h`. Depth values are normalized floats in 0–1. Version 1 files (flat layer list, 0–255 values) and shapes saved with the older single `profile` parameter are migrated on load.

### Edge profile

An edge profile is a curve on a 0–1 workspace: x = 0 is the inside end of the profile band (normally full height), x = 1 is the edge (normally zero). Points are joined by segments:

```jsonc
{ "format": "depthcad-profile/1", "id": "ogee", "name": "Ogee",
  "points":   [ { "x": 0, "y": 1 }, { "x": 0.5, "y": 0.5 }, { "x": 1, "y": 0 } ],
  "segments": [ { "kind": "dome" }, { "kind": "cove" } ] }        // kinds: line, dome, cove, smooth, step, bezier (with c1, c2 handles)
```

A shape evaluates the profile at x = 1 − distance / width for its outer edge and, for rings and frames, its inner edge; where both bands overlap the lower height wins.

### Tool

A tool is a JSON file:

```jsonc
{
  "format": "depthcad-tool/1", "id": "star-ring", "name": "Ring of stars", "version": 1,
  "description": "N stars on a circle.",
  "schema": {                     // generates the properties panel
    "count":  { "type": "int",    "label": "Stars", "default": 12, "min": 1, "max": 200, "slider": true },
    "radius": { "type": "number", "label": "Ring radius (px)", "default": 300, "min": 1, "max": 4000 },
    "high":   { "type": "depth",  "label": "Height", "default": 1 }
  },
  "measure": "return { w: 2 * (p.radius + 60), h: 2 * (p.radius + 60) };",   // natural size in local px
  "render":  "lib.each((u, v) => { ... return [height, coverage]; });"        // fills the raster
}
```

`render` runs as `(p, r, lib)` in a Worker: `p` are the parameters, `r` is the raster to fill (`w`, `h`, `height`, `coverage` as Float32Arrays in 0–1, `scale` pixels per local unit), and `lib` provides signed-distance primitives (`circle`, `ellipse`, `box`, `ring`, `polygon`, `star`, `segment`, boolean ops), `aa()` for antialiased coverage, height `profile()`s (flat, linear, dome, scallop, cosine, bevel), `noise2`/`fbm`, per-pixel iteration with `each()`, union compositing with `add()`, and a Canvas 2D context in local units (`canvas()`/`fromCanvas()`) for text and paths. Parameter types are `number`, `int`, `bool`, `enum`, `depth`, `text`, `string`. Tool layers transform, mask, blend and take modifiers like any other layer.

## Architecture

The source lives in `src/` as ES modules and `build.js` bundles them into the single-file `depthcad.html`:

* `engine/`: DOM-free core. `raster.js` (Float32 height + coverage rasters, blending), `transform.js` (boxes, resampling with whole-pixel fast paths), `sdf.js` (shape distance fields), `profile.js` (edge profile documents and lookup tables), `modifiers.js`, `composite.js` (the tree compositor: groups, sibling masks, per-node caches of local and document-space rasters), `png.js` (8/16-bit codec), `dither.js`, `kinds.js` (node kind registry), `mesh.js` and `meshbake.js` (STL/OBJ parsing and the WebGL2 orthographic depth baker), `toolkit.js` (the helper library given to tools).
* `kinds/`: one file per node kind (`image`, `shape`, `text`, `mask`, `group`, `mesh`, `tool`). A kind provides a parameter schema, `measure` and `render` (or `renderAsync` for Worker-backed kinds); everything else (transform, blend, masks, modifiers, caching, undo, serialization) is shared, so a new kind is a small file and gets a generated properties panel.
* `app/`: `state.js` (document, tree helpers, serialization, migrations, display units), `commands.js` (every mutation, the API used by the UI, tests and the assistant), `history.js` (undo), `render.js` (preview scheduling and interactive mode), `io.js` (import, export, autosave).
* `ui/`: canvas editor, layer tree, schema-driven properties panel, font picker, profile editor, 3D view, dialogs, the mesh import dialog, the Tools menu and editor, and the assistant drawer with its provider adapters.

Performance notes: the preview composites on the CPU at the chosen preview resolution. Each layer caches its local raster and its document-space raster; a move only shifts the cached raster, and a scale or rotation re-renders that one layer (at reduced detail while dragging). Export renders every layer exactly at full resolution.

See [docs/DESIGN.md](docs/DESIGN.md) for the design notes behind this.

## Development

```bash
npm install          # puppeteer-core for the browser tests (uses your installed Chrome)
npm run build        # bundles src/ into depthcad.html
npm run test:unit    # engine, mesh, toolkit and profile unit tests in Node (no browser)
npm run test:smoke   # drives the built app in headless Chrome: core, mesh import, tools and assistant
npm test             # both
npm run examples     # regenerates the example projects and screenshots
```

Edit files under `src/`, rebuild, reload. The built `depthcad.html` is committed so the app can be used and deployed without any tooling.

## Roadmap

* Built-in text on a path as a text layout (the `text-arc` tool covers the common case today).
* Group transforms (rotate a group as a unit) and image edge profiles.
* Tool packs: sharing sets of tools and profiles as one file.

## License

MIT, see [LICENSE](LICENSE).
