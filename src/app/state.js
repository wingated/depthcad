// Application state, tree helpers, serialization and v1 migration.
import { createNode, KINDS, schemaDefaults } from '../engine/kinds.js';
import { createModifier } from '../engine/modifiers.js';
import { localToWorld } from '../engine/transform.js';
import { uid, deepClone } from '../engine/util.js';

export const FORMAT_VERSION = 2;

export const state = {
  doc: { w: 1024, h: 1024, bg: 0, unit: 'u16', mmPerPx: 0.1, depthMm: 2 },
  root: null,
  images: {},   // id -> image asset (see kinds/image.js)
  fonts: {},    // id -> {name, dataURL}
  meshes: {},   // id -> {name, positions, triangles, bounds, dataURL?}
  tools: {},    // id -> tool definition (embedded in the project; see kinds/tool.js)
  sel: [],      // selected node ids
  name: 'untitled',
  view: { x: 0, y: 0, zoom: 1 },
  previewMax: 1024,
  showOutlines: true,
};

export function resetDocument(doc) {
  state.doc = Object.assign({ w: 1024, h: 1024, bg: 0, unit: 'u16', mmPerPx: 0.1, depthMm: 2 }, doc || {});
  state.root = { id: 'root', kind: 'group', name: 'Document', visible: true, locked: false, x: 0, y: 0, sx: 1, sy: 1, rot: 0, lockAspect: false, blend: 'max', modifiers: [], params: {}, children: [] };
  state.images = {}; state.fonts = {}; state.meshes = {}; state.tools = {}; state.sel = []; state.name = 'untitled';
}
resetDocument();

// ---- tree helpers
export function walk(node, fn, parent = null, depth = 0) {
  if (fn(node, parent, depth) === false) return;
  if (node.children) for (const c of node.children) walk(c, fn, node, depth + 1);
}
export function findNode(id, root = state.root) { let out = null; walk(root, n => { if (n.id === id) { out = n; return false; } }); return out; }
export function parentOf(id, root = state.root) { let out = null; walk(root, (n, p) => { if (n.id === id) { out = p; return false; } }); return out; }
export function allNodes(root = state.root) { const out = []; walk(root, n => { if (n !== root) out.push(n); }); return out; }
// Leaves (non-groups) in paint order, bottom to top, only visible ancestors.
export function visibleLeaves(root = state.root) {
  const out = [];
  (function rec(g) { for (const c of g.children) { if (!c.visible) continue; if (c.kind === 'group') rec(c); else out.push(c); } })(root);
  return out;
}
export function isAncestor(maybeAncestor, node) { let p = parentOf(node.id); while (p) { if (p === maybeAncestor) return true; p = p.id === 'root' ? null : parentOf(p.id); } return false; }
export function selectedNodes() { return state.sel.map(id => findNode(id)).filter(Boolean); }
export function primarySelected() { return state.sel.length ? findNode(state.sel[0]) : null; }

export function newNode(kind) { return createNode(kind, state.doc); }

// ---- serialization
const stripPrivate = (k, v) => (typeof k === 'string' && k.startsWith('_')) ? undefined : v;
export function serializeTree() { return JSON.parse(JSON.stringify(state.root, stripPrivate)); }
export function usedImageIds() { const s = new Set(); walk(state.root, n => { if ((n.kind === 'image' || n.kind === 'mesh') && n.params.imageId) s.add(n.params.imageId); }); return s; }
export function usedToolIds() { const s = new Set(); walk(state.root, n => { if (n.kind.startsWith('tool:')) s.add(n.kind.slice(5)); }); return s; }
export function usedMeshIds() { const s = new Set(); walk(state.root, n => { if (n.kind === 'mesh' && n.params.meshId && n.params.embed !== false) s.add(n.params.meshId); }); return s; }

export function serialize() {
  const used = usedImageIds(); const images = {};
  for (const [id, im] of Object.entries(state.images)) if (used.has(id)) { images[id] = { dataURL: im.dataURL, w: im.w, h: im.h, bits: im.bits }; if (im.covDataURL) images[id].covDataURL = im.covDataURL; }
  const usedM = usedMeshIds(); const meshes = {};
  for (const [id, m] of Object.entries(state.meshes)) if (usedM.has(id) && m.dataURL) meshes[id] = { name: m.name, dataURL: m.dataURL };
  const usedT = usedToolIds(); const toolsOut = {};
  for (const [id, t] of Object.entries(state.tools)) if (usedT.has(id)) toolsOut[id] = JSON.parse(JSON.stringify(t, (k, v) => k.startsWith('_') ? undefined : v));
  return { app: 'DepthCAD', version: FORMAT_VERSION, name: state.name, doc: deepClone(state.doc), root: serializeTree(), images, fonts: deepClone(state.fonts), meshes, tools: toolsOut };
}

// Normalize a loaded node: fill defaults for missing params/modifiers, drop unknown kinds.
export function normalizeNode(n) {
  const def = KINDS[n.kind]; if (!def) return null;
  const base = createNode(n.kind, state.doc);
  const out = Object.assign(base, n, { params: Object.assign(schemaDefaults(def.schema), n.params || {}) });
  out.modifiers = (n.modifiers || []).map(m => Object.assign(createModifier(m.kind), m));
  if (n.kind === 'group') out.children = (n.children || []).map(normalizeNode).filter(Boolean);
  else delete out.children;
  return out;
}

// ---- v1 migration (flat layers, 0-255 values, masks attached to layers)
export function migrateV1(p) {
  const doc = { w: p.doc?.w || 1024, h: p.doc?.h || 1024, bg: (p.doc?.bg || 0) / 255, unit: 'u16', mmPerPx: 0.1, depthMm: 2 };
  const children = [];
  for (const L of p.layers || []) {
    let node;
    const t = { x: L.x, y: L.y, sx: L.sx ?? 1, sy: L.sy ?? 1, rot: L.rot || 0 };
    if (L.type === 'image') {
      node = mk('image', L, t); node.params = { imageId: L.imageId, zeroAlpha: L.zeroAlpha !== false };
      const identity = (L.inB ?? 0) === 0 && (L.inW ?? 255) === 255 && (L.outB ?? 0) === 0 && (L.outW ?? 255) === 255 && (L.gamma ?? 1) === 1 && !L.invert;
      if (!identity) { const m = createModifier('levels'); Object.assign(m, { inB: (L.inB ?? 0) / 255, inW: (L.inW ?? 255) / 255, gamma: L.gamma ?? 1, outB: (L.outB ?? 0) / 255, outW: (L.outW ?? 255) / 255, invert: !!L.invert }); node.modifiers.push(m); }
    } else if (L.type === 'text') {
      node = mk('text', L, t);
      node.params = { text: L.text ?? 'Text', family: L.family || 'Helvetica', weight: String(L.weight || '700'), italic: !!L.italic, size: L.size || 100, lineHeight: L.lineHeight ?? 1.2, spacing: L.spacing || 0, align: L.align || 'center', value: (L.value ?? 255) / 255, layout: L.layout || { kind: 'linear' } };
    } else {
      node = mk('shape', L, { ...t, sx: 1, sy: 1 });
      node.params = { shape: L.shape || L.type || 'rect', w: L.w || 100, h: L.h || 100, inner: L.inner || 0, corner: L.corner || 0, profile: L.profile || 'flat', bevel: L.bevel || 50, low: (L.low ?? 0) / 255, high: (L.high ?? 255) / 255 };
    }
    if (L.masks && L.masks.length) {
      const g = createNode('group', doc); g.name = node.name + ' (masked)';
      for (const m of L.masks) {
        const mn = createNode('mask', doc); const p = localToWorld(t, m.x || 0, m.y || 0);
        Object.assign(mn, { x: p.x, y: p.y, rot: (t.rot || 0) + (m.rot || 0), name: 'Mask' });
        mn.params = { shape: m.kind || 'ellipse', w: (m.w || 100) * t.sx, h: (m.h || 100) * t.sy, inner: 0, corner: 0, invert: !!m.invert };
        if (m.feather > 0) { const f = createModifier('feather'); f.radius = m.feather * (t.sx + t.sy) / 2; mn.modifiers.push(f); }
        g.children.push(mn);
      }
      g.children.push(node); node = g;
    }
    children.push(node);
  }
  return { app: 'DepthCAD', version: FORMAT_VERSION, name: p.name || 'untitled', doc, root: { id: 'root', kind: 'group', name: 'Document', visible: true, children }, images: p.images || {}, fonts: p.fonts || {} };
  function mk(kind, L, t) { const n = createNode(kind, doc); Object.assign(n, { id: L.id || uid(), name: L.name || kind, visible: L.visible !== false, blend: L.mode || 'max' }, t); return n; }
}

// ---- depth unit display
export const UNITS = { u16: '16-bit (0–65535)', u8: '8-bit (0–255)', percent: 'Percent', mm: 'Millimetres' };
export function depthToDisplay(v, doc = state.doc) {
  switch (doc.unit) { case 'u8': return v * 255; case 'percent': return v * 100; case 'mm': return v * doc.depthMm; default: return v * 65535; }
}
export function displayToDepth(d, doc = state.doc) {
  switch (doc.unit) { case 'u8': return d / 255; case 'percent': return d / 100; case 'mm': return doc.depthMm ? d / doc.depthMm : 0; default: return d / 65535; }
}
export function depthStep(doc = state.doc) { return doc.unit === 'mm' ? 0.01 : doc.unit === 'percent' ? 0.1 : 1; }
export function depthDecimals(doc = state.doc) { return doc.unit === 'mm' ? 2 : doc.unit === 'percent' ? 1 : 0; }
export function fmtDepth(v, doc = state.doc) { return depthToDisplay(v, doc).toFixed(depthDecimals(doc)); }
