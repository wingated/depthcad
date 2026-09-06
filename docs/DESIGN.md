# DepthCAD v2 architecture proposal

Status: implemented 2026-09-06 (all four phases). Details that changed during implementation are noted inline; the README documents the shipped behaviour.

This document covers five things that arrived together and interact: a 16-bit depth pipeline, mesh (STL/OBJ) import, a node tree instead of a flat layer list, UI conventions, and an extension/AI layer. The short version:

1. **Depth becomes a float raster.** Every layer renders to a `Raster` of `Float32` height in [0, 1] plus `Float32` coverage. Compositing is plain JS over typed arrays. 16-bit PNG in and out is handled by a small built-in codec. 8-bit export dithers.
2. **The document becomes a node tree.** Groups, masks, and adjustment layers are nodes. Every node kind implements one small interface (`measure`, `render`), and everything else (transform, masks, blend, modifiers, caching, serialization, undo) is shared.
3. **Every edit is a command.** The UI, keyboard shortcuts, copy/paste, align/distribute, tests, and the AI agent all go through the same command API with built-in undo.
4. **Extension tools are data.** A tool is a JSON document: a parameter schema (from which the UI is generated) plus a render function body, run in a Worker. The AI agent's job is to write these and call commands. Tools can be exported and shared.
5. **Mesh import is a node kind plus a modal.** The modal renders the mesh orthographically into a float framebuffer and bakes a 16-bit raster; the node keeps the bake parameters so it can be re-baked.

## 1. Depth pipeline

### Representation

```ts
interface Raster {
  w: number; h: number;
  height:   Float32Array;   // 0 = farthest, 1 = nearest
  coverage: Float32Array;   // 0 = transparent, 1 = opaque (antialiased edges are fractional)
  origin?:  { x: number; y: number };  // document-space offset; rasters cover only their bbox
}
```

Internally values are normalized floats, not `uint16`. This makes nonlinear remapping, feathering, blending, and plugin code trivial, avoids overflow bugs, and separates bit depth from the math. Quantization happens at exactly two places: on import (8-bit → /255, 16-bit → /65535) and on export.

Rasters are bbox-sized, not document-sized. A 400 px ring in a 4096 document touches 160k pixels, not 16.7M. The compositor blends a raster into the document accumulator at its origin.

### Why CPU typed arrays rather than WebGL compositing

v1 composites with Canvas 2D `lighten`, which is 8-bit and cannot continue. The two candidates are a Float32 CPU compositor and a WebGL2 float-texture compositor with `MAX` blending. The CPU path is recommended because:

* Plugin and AI-generated tools become plain JavaScript over arrays, which is the most accessible possible surface and runs in a Worker.
* The engine has no DOM dependency, so it can run in Node for tests and for batch rendering.
* Results are deterministic and exact.
* Cost is fine: the preview composites at ≤1024², about 1M pixels per layer; a full 4096² export of ten layers is a few hundred milliseconds per layer in tight loops, which is acceptable for a batch action.

A WebGL fast path can be added later for individual expensive kinds (mesh, large images) without changing the model, because the interface is "produce a Raster."

### Layer rendering

Each kind renders in its own local space at a requested pixel scale, exactly as v1 does. The engine then resamples into document space (inverse-mapping each document pixel through the node transform, bilinear on height and coverage). This replaces `drawImage` with a transform and keeps full precision.

| Kind | Local render |
| --- | --- |
| image | decoded 8- or 16-bit source → height; coverage 1 (0 where source is 0 if "zero is transparent") |
| shape | SDF loop, as today, writing floats |
| text | Canvas 2D for glyph coverage only (8-bit antialiasing is fine for coverage); height is the constant value |
| mesh | baked raster stored on the node (see §3) |
| tool (plugin) | Worker executes the tool's render function |
| group | composites its children into a raster |

### Modifiers

Each node has a modifier stack applied to its raster before blending, in order. v1's image "levels" become the first modifier kind and stop being image-specific.

* `levels`: in black/white, gamma, out black/white, invert
* `curve`: arbitrary height → height mapping (the "nonlinear depth mapper"), editable as control points
* `feather`: blur coverage by n px
* `blur` / `smooth`: blur height
* `clamp`: min/max

A modifier on a **group** acts as an adjustment layer for everything in it. That gives Photoshop-style adjustment semantics with one concept instead of two.

### Masks

A mask is a node whose output is coverage only. It applies to its **siblings above it within the same group**; where several masks sit below a layer, all of them apply (their coverages multiply), which is what makes an intersection of masks and a v1 project with several masks on one layer express directly. Implementation note: the proposal said "until the next mask"; the multiplied form was adopted instead because it needs no special case and matches the migration. To mask a single layer, group it with a mask; the "Add mask" button does exactly that. Mask nodes get the same transform, modifiers (feather), and tree operations as any node, which is what makes them first-class.

### Blend modes

Unchanged in meaning, now on floats: `max` (union), `min` (clamp), `replace`, `cut`, `keep`. The document background is a float too.

### PNG codec

Browsers decode 16-bit PNG to 8-bit in Canvas, so a small decoder is required: PNG chunk walk, `DecompressionStream('deflate')` for IDAT, unfilter (five filter types), unpack 8/16-bit gray, RGB, RGBA, and palette. About 150 lines, no dependency. The encoder is the mirror: filter type 0, `CompressionStream('deflate')`, CRC32. Both stream, so a 4096² 16-bit export (32 MB raw) is fine.

Import rule: 8-bit → v/255, 16-bit → v/65535. Both land in the same float space.

### Export

Options in an export dialog: 16-bit gray PNG, or 8-bit gray PNG with dither `none` / `Floyd–Steinberg` / `ordered (Bayer 8×8)`. Default 8-bit with Floyd–Steinberg. Error diffusion has a useful property here: pixels that already sit exactly on an 8-bit level (every flat shape layer) receive no noise, so only gradients get dithered and flats stay clean. The dialog previews a zoomed crop.

### Displayed units

Values are shown in the UI as 0–65535 by default. A document setting chooses the display unit: 16-bit integers, 8-bit integers, percent, or **millimetres** given a document "full depth" value, which is the unit an engraver actually thinks in. The internal float never changes.

### Migration

v1 project files load with values ÷ 255 and the flat layer list wrapped in a root group; attached masks become sibling mask nodes in a group. A `version: 2` field is written on save.

## 2. Node tree and commands

### Node

Implementation note: groups carry no transform of their own. Moving, scaling or rotating a group applies the change to its children, and a group's box is the bounding box of its children. This keeps the compositor free of nested transforms; a group with a transform can be added later without changing the file format (the fields already exist on every node).

```ts
interface Node {
  id: string; kind: string; name: string;
  visible: boolean; locked: boolean;
  transform: { x: number; y: number; sx: number; sy: number; rot: number; lockAspect: boolean };
  blend: 'max' | 'min' | 'replace' | 'cut' | 'keep';
  modifiers: Modifier[];
  params: Record<string, unknown>;   // kind-specific, validated by the kind's schema
  children?: Node[];                 // groups only
}
```

Kinds register themselves:

```ts
interface NodeKind {
  kind: string; label: string; icon: string;
  schema: ParamSchema;                        // drives the properties panel and validation
  create(doc): Node;
  measure(node, ctx): { w: number; h: number };   // natural size in local px
  render(node, ctx: { scale: number; full: boolean }): Raster | Promise<Raster>;
  cacheKey(node): string;                    // which params invalidate the local raster
}
```

`ParamSchema` is a small JSON schema dialect: `number` (with min/max/step, optional slider), `int`, `bool`, `enum`, `string`, `text` (multi-line), `depth` (a value shown in the document's display unit), `point`, `font`, `curve`. The properties panel is generated from it, so a new kind, including an AI-written one, gets a UI for free. Kinds can still register a custom panel section when they need one (the font picker, the mesh re-bake button).

### Commands

Every mutation is a command, and commands are the API. Implementation note: undo is still JSON snapshots of the tree, which stays small because rasters, images and (later) baked meshes live in caches and asset stores keyed by node or asset id and are never part of a snapshot. Commands that take an `opts.transient` flag are called repeatedly during a drag and commit once at the end.

```
add(kind, params?, parentId?, index?)        remove(ids)
setParam(id, path, value)                    setTransform(id, patch)
reorder(ids, parentId, index)                group(ids) / ungroup(id)
duplicate(ids)                               copy(ids) → clipboard JSON / paste(json, parentId?)
align(ids, 'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom', to: 'selection'|'document')
distribute(ids, 'horizontal'|'vertical')
addModifier(id, modifier) / setModifier / removeModifier
importImage(file) / importMesh(file, bakeParams) / export(options)
select(ids) / selectAll / deselect
```

Commands are also the boundary for multi-selection, which v1 lacks and which align/distribute/group need. Selection is a set of ids; the canvas supports Shift-click and marquee.

Copy/paste serializes nodes (with the rasters and images they reference) to the system clipboard as JSON with a `depthcad/nodes` marker, so nodes move between documents and browser tabs.

### Caching

Each node caches its local raster keyed by `cacheKey(node)` and the pixel scale, and each group caches its composite keyed by its children's keys. Dragging a layer invalidates only the resample-and-composite step, not the local render. This is the same scheme v1 uses per kind, generalized.

## 3. Mesh import

### Node kind `mesh`

Params: the bake settings (orientation as a quaternion or three Euler angles, orthographic scale in px per model unit, pan, near/far planes in model units, output resolution, background = transparent | farthest) and the baked 16-bit raster. The source mesh is stored in IndexedDB and optionally embedded in the project (default: embed if the file is under a size threshold, with a checkbox). Editing the node's transform on the canvas is instant because it works on the baked raster; "Re-bake…" reopens the modal.

### Baking

WebGL2 renders the mesh with an **orthographic** camera (an engraving depth map is an orthographic projection; perspective would be wrong) into an `R32F` colour attachment holding view-space depth, with a normal depth buffer for hidden-surface removal. Reading the float buffer back and mapping `[far, near] → [0, 1]` gives full float precision that is then stored as 16-bit. Output resolution is a user choice up to 8192.

Parsers: binary and ASCII STL, and OBJ with polygon triangulation. Both are under 100 lines. Large meshes (millions of triangles) are fine for the GPU; parsing runs in a Worker so the UI stays responsive.

Implementation notes: the depth is rendered into an `R32F` colour attachment (with a 24-bit packed fallback when float render targets are unavailable) and read back as distances; the final bake supersamples 2× and averages coverage. The inspection view is the same WebGL2 context drawn on screen with flat shading from screen-space derivatives, so no normals are stored. Plane handles sit on the top edge of the bake window and drag along the projected view axis.

### Modal layout

Split pane, both sides showing the same mesh:

* **Left: result.** The depth image exactly as it will be baked, live, plus the output size. Below it a **depth histogram** of the visible surface with two draggable handles for near and far; this is the primary clipping control, because it shows directly which depth range the visible geometry occupies and which parts would be clipped.
* **Right: inspection.** A perspective, orbitable, shaded view of the mesh with the orthographic camera's box drawn as a wireframe and the near and far planes as translucent quads. The planes can be dragged along the view axis; the histogram handles and the numeric fields stay in sync.

Orientation controls:

* Six "view from" buttons (±X, ±Y, ±Z) and four 90° steps (roll left/right, pitch, yaw) for the common cases.
* Three numeric angle fields for precision.
* Orbit-drag in the left view, with Shift for 1/10 speed. A ring gizmo ("fins") can be added later; the numeric fields cover the precision case at far lower cost.

Clipping presets: **far = farthest geometry** (back of the bounding box, so hidden geometry still sets the floor), **far = farthest visible surface**, **near = nearest visible surface**, and **fit** (both). These are one click each and also settable by typing.

Zoom: px per model unit, "fit to view", and pan. Background outside the mesh: transparent (coverage 0) or set to farthest.

## 4. UI

The goal is conventional and quiet: someone who has used any layer-based editor should not need the help dialog.

* **Top bar.** File (New, Open, Save, Import image, Import mesh, Export…), Add (Image, Shape, Text, Mesh, Group, Mask, Tools…), Edit (Undo, Redo, Copy, Paste, Duplicate, Group, Ungroup, Delete), and an **align/distribute strip** that is enabled when two or more nodes are selected (six align buttons, two distribute buttons, plus "to document" toggle). View (Fit, 1:1, 3D).
* **Left: layer tree.** Nested groups with disclosure triangles, drag to reorder and to move into or out of groups, visibility and lock icons, kind icon, blend badge. Masks show an indent marker on the siblings they affect.
* **Right: properties for the selection.** Transform first, with W and H joined by a **lock icon** that toggles the node's own `lockAspect`; X, Y, rotation; then the kind's generated panel; then Modifiers as a stack with add/remove/reorder; then Blend. Multi-selection shows the common transform fields and applies edits to all.
* **Document settings** leave the panel. The status bar shows `4096 × 4096 · 16-bit · 0.1 mm/px` and clicking it opens a small dialog (size, background, display unit, mm per px, full depth in mm).
* **Canvas.** Unchanged interaction model plus multi-select, marquee, and snapping to document center and edges.
* **3D view.** Unchanged. It samples the float composite directly, so 16-bit smoothness shows.
* **AI.** A small sparkle button in the lower right. Nothing else about the AI is visible until it is clicked.

## 5. Extension tools and the AI agent

Implementation notes: tools run in a single Worker created from a Blob URL (with a main-thread fallback when Workers are unavailable), with a 20 s timeout after which the Worker is recreated. `OffscreenCanvas` is allowed inside tools (`lib.canvas()`), which is how the text-on-arc example draws glyphs. Tool kinds are asynchronous: the compositor keeps the previous raster on screen while a new one renders and re-composites when it arrives; export waits for all pending tool renders. Tools used by a project are embedded in it; a separate library in IndexedDB holds the user's own tools across projects.

### Tool format

A tool is a JSON document that can be saved, loaded, and shared:

```jsonc
{
  "format": "depthcad-tool/1",
  "id": "star-ring", "name": "Ring of stars", "version": 1,
  "description": "N five-pointed stars arranged on a circle, each raised to a value.",
  "schema": {
    "count":  { "type": "int",   "default": 12, "min": 1, "max": 200 },
    "radius": { "type": "number","default": 400, "min": 1 },
    "star":   { "type": "number","default": 60, "min": 1 },
    "value":  { "type": "depth", "default": 1 }
  },
  "measure": "return { w: 2*(p.radius+p.star), h: 2*(p.radius+p.star) };",
  "render":  "/* JS body: (p, r) => fill r.height / r.coverage; r.w, r.h, r.scale given */"
}
```

The engine registers a tool as a node kind: the schema generates the panel, `measure` gives the natural box, and `render` runs in a Worker with a plain `Raster` to fill and a small helper library (SDF primitives, polygon fill, noise, easing). Tool nodes are ordinary nodes: they transform, mask, blend, and modify like any other, and the project embeds the tool definitions it uses so a shared project always opens.

Running tool code in a Worker keeps it off the DOM and the main thread and gives a timeout. It is still the user's own machine running code the user (or their agent) chose to add; that is the same trust model as any plugin system and should be stated plainly in the UI when a tool is installed from outside.

Implementation notes: the Anthropic adapter loads the official TypeScript SDK from a CDN on first use (`dangerouslyAllowBrowser`) and calls the Messages API with the server-side refusal fallback enabled; OpenAI and Google use their function-calling endpoints directly. All three sit behind one adapter interface (`addUser`, `send`, `addResults`), which is also how the tests drive the loop with a scripted provider. A reply's changes are counted as undo steps so "Revert this reply" undoes exactly that turn.

### Agent

The agent is optional and provider-neutral: Anthropic, OpenAI, and Google, with the user's own key stored locally and never sent anywhere but that provider. The panel is a chat drawer. The agent is given:

* a compact JSON summary of the document (nodes, params, selection, document settings),
* the command list above as tool definitions,
* the tool format and helper library reference,
* the schema of every registered kind.

It responds with command calls (applied live, each an undoable step, with a one-click "revert this reply") and, when the request needs new capability, a tool definition, which is installed and instantiated as a node in the same reply. "Make a circle of twelve raised stars around the statue" therefore becomes: write the `star-ring` tool, `add('star-ring', {...})`, `align` to the statue's center. Follow-ups ("more stars, smaller") are `setParam` calls; the user can also just use the generated sliders.

For Anthropic specifically the plan is the official TypeScript SDK's browser build, loaded lazily from a CDN only when the panel is opened (the app stays dependency-free otherwise), with tool use for the command calls and `claude-opus-5` as the default model. The other two providers use their equivalent function-calling APIs behind the same small adapter.

Tools the agent writes are the same JSON as tools a person writes, so a "toolpack" of shared tools is just a JSON array, importable from File.

## 6. Code organization

`depthcad.html` will pass 5k lines with these features, and it must stay openable from `file://` and deployable as static files. The plan is source modules plus a trivial concatenating build:

```
src/engine/     raster.js, composite.js, png.js, resample.js, sdf.js, dither.js
src/kinds/      image.js, shape.js, text.js, mesh.js, group.js, mask.js, tool.js
src/commands/   commands.js, history.js, clipboard.js, align.js
src/ui/         tree.js, props.js, canvas.js, view3d.js, meshImport.js, agent.js
src/app.js
build.js        → depthcad.html (single file, as today)
```

`npm run build` produces the same single-file artifact; tests run against the built file (browser smoke tests as today) and directly against `src/engine` in Node (unit tests for compositing, PNG codec, dithering, SDFs) because the engine has no DOM dependency.

## 7. Phasing

Each phase ships a usable app.

1. **Engine.** Float rasters, bbox rendering, resampling, PNG 8/16 codec, dithered export, modifier stack (levels, curve, feather), node tree with groups and sibling masks, command-based history, v1 migration, module split and build. UI stays close to v1 except where the data model forces change (masks become nodes; levels become a modifier).
2. **UI.** Multi-select, align/distribute, copy/paste, tree with groups, per-node aspect lock, document dialog, export dialog, display units.
3. **Mesh import.** Parsers, orthographic float bake, the split-pane modal with histogram clipping.
4. **Tools and agent.** Tool format, Worker runtime, helper library, generated panels, toolpack import/export, the agent drawer with three providers.

Phase 1 is the prerequisite for all of the others and is the largest. Phase 3 could precede phase 2 if mesh import is the more urgent need; it only depends on phase 1.

## Open questions

* Display unit default: 0–65535 integers, or millimetres once a document has a depth in mm? The proposal is 16-bit integers until the user sets a physical depth.
* Mask direction: Figma-style "affects siblings above" (proposed) versus Photoshop-style "attached to one layer." The group-with-mask convenience covers the second inside the first.
* Whether tools should be allowed to use Canvas 2D (for text and paths) in addition to raw arrays. OffscreenCanvas is available in Workers, so this is cheap to allow and makes text-based tools far easier to write; the proposal is yes.
* Embedding meshes in projects by default: size threshold, or always ask.
