// Commands: every mutation of the document goes through here. This is the API used
// by the UI, keyboard shortcuts, tests and (later) extension tools and the agent.
// Each command mutates state, invalidates rendering and records an undo step unless
// opts.transient is set (drags call the same command repeatedly and commit at the end).
import { state, findNode, parentOf, newNode, selectedNodes, walk } from './state.js';
import { commit } from './history.js';
import { KINDS } from '../engine/kinds.js';
import { createModifier } from '../engine/modifiers.js';
import { nodeBox, measureNode, makeContext } from '../engine/composite.js';
import { boxAABB, unionAABB } from '../engine/transform.js';
import { uid, deepClone, clamp } from '../engine/util.js';

const changeListeners = new Set();
export function onChange(fn) { changeListeners.add(fn); }
function changed(what = 'render') { for (const fn of changeListeners) fn(what); }
function finish(opts) { changed('render'); if (!opts || !opts.transient) commit(); }

const ctx = () => makeContext(state, 1, false, null);
export function boxOf(node) { return nodeBox(node, ctx()); }
export function measureOf(node) { return measureNode(node, ctx()); }

// ---- selection
export function select(ids, opts = {}) {
  ids = Array.isArray(ids) ? ids : ids ? [ids] : [];
  if (opts.toggle) { const s = new Set(state.sel); for (const id of ids) s.has(id) ? s.delete(id) : s.add(id); state.sel = [...s]; }
  else if (opts.add) state.sel = [...new Set([...state.sel, ...ids])];
  else state.sel = ids;
  changed('selection');
}
export function selectAll() { select(state.root.children.map(c => c.id)); }

// ---- structure
export function add(kind, params = {}, opts = {}) {
  const n = newNode(kind); Object.assign(n.params, params);
  if (opts.name) n.name = opts.name;
  if (opts.node) Object.assign(n, opts.node);
  const parent = (opts.parentId && findNode(opts.parentId)) || currentContainer();
  const index = opts.index ?? parent.children.length;
  parent.children.splice(clamp(index, 0, parent.children.length), 0, n);
  state.sel = [n.id]; finish(opts); changed('tree'); return n;
}
// The group that new nodes go into: the selected group, or the parent of the selection, or root.
function currentContainer() {
  const n = state.sel.length ? findNode(state.sel[0]) : null;
  if (!n) return state.root;
  if (n.kind === 'group') return n;
  return parentOf(n.id) || state.root;
}
export function insertNode(n, parentId, index, opts = {}) {
  const parent = findNode(parentId) || state.root; parent.children.splice(clamp(index ?? parent.children.length, 0, parent.children.length), 0, n);
  finish(opts); changed('tree'); return n;
}
export function remove(ids, opts = {}) {
  ids = Array.isArray(ids) ? ids : [ids];
  for (const id of ids) { const p = parentOf(id); if (p) p.children.splice(p.children.findIndex(c => c.id === id), 1); }
  state.sel = state.sel.filter(id => !ids.includes(id));
  finish(opts); changed('tree');
}
export function reorder(id, parentId, index, opts = {}) {
  const n = findNode(id), oldParent = parentOf(id), newParent = findNode(parentId);
  if (!n || !oldParent || !newParent || newParent.kind !== 'group') return;
  if (n.kind === 'group' && (n === newParent || isInside(newParent, n))) return; // no cycles
  const oldIdx = oldParent.children.indexOf(n); oldParent.children.splice(oldIdx, 1);
  if (oldParent === newParent && index > oldIdx) index--;
  newParent.children.splice(clamp(index, 0, newParent.children.length), 0, n);
  finish(opts); changed('tree');
}
function isInside(node, group) { let found = false; walk(group, n => { if (n === node) { found = true; return false; } }); return found; }
export function moveInStack(id, delta, opts = {}) {
  const p = parentOf(id); if (!p) return; const i = p.children.findIndex(c => c.id === id);
  const j = clamp(i + delta, 0, p.children.length - 1); if (i === j) return;
  const [n] = p.children.splice(i, 1); p.children.splice(j, 0, n); finish(opts); changed('tree');
}
export function group(ids = state.sel, opts = {}) {
  const nodes = ids.map(id => findNode(id)).filter(Boolean); if (!nodes.length) return null;
  const parent = parentOf(nodes[0].id) || state.root;
  const inParent = nodes.filter(n => parentOf(n.id) === parent);
  const indices = inParent.map(n => parent.children.indexOf(n)).sort((a, b) => a - b);
  const g = newNode('group'); g.name = opts.name || 'Group';
  g.children = indices.map(i => parent.children[i]);
  for (const n of g.children) parent.children.splice(parent.children.indexOf(n), 1);
  parent.children.splice(Math.min(indices[0], parent.children.length), 0, g);
  state.sel = [g.id]; finish(opts); changed('tree'); return g;
}
export function ungroup(id = state.sel[0], opts = {}) {
  const g = findNode(id); if (!g || g.kind !== 'group' || g === state.root) return;
  const p = parentOf(id); const i = p.children.indexOf(g);
  p.children.splice(i, 1, ...g.children); state.sel = g.children.map(c => c.id);
  finish(opts); changed('tree');
}
export function duplicate(ids = state.sel, opts = {}) {
  const out = [];
  for (const id of ids) {
    const n = findNode(id); if (!n) continue; const p = parentOf(id); if (!p) continue;
    const c = deepClone(JSON.parse(JSON.stringify(n, (k, v) => k.startsWith('_') ? undefined : v)));
    walk(c, m => { m.id = uid(); }); c.name = n.name + ' copy';
    p.children.splice(p.children.indexOf(n) + 1, 0, c); out.push(c.id);
  }
  if (out.length) state.sel = out; finish(opts); changed('tree'); return out;
}
// Wrap a node in a group together with a new mask below it.
export function addMaskTo(id, shape = 'ellipse', opts = {}) {
  const n = findNode(id); if (!n) return null;
  const b = boxOf(n); const m = newNode('mask'); m.params.shape = shape;
  Object.assign(m, { x: b.x, y: b.y, rot: b.rot }); m.params.w = Math.round(b.w); m.params.h = Math.round(b.h);
  let g = n;
  if (n.kind !== 'group') { g = group([id], { transient: true, name: n.name + ' (masked)' }); }
  g.children.splice(0, 0, m);
  state.sel = [m.id]; finish(opts); changed('tree'); return m;
}

// ---- properties
export function setNodeProps(id, patch, opts = {}) { const n = findNode(id); if (!n) return; Object.assign(n, patch); finish(opts); if ('name' in patch || 'visible' in patch || 'blend' in patch) changed('tree'); }
export function setParam(id, key, value, opts = {}) { const n = findNode(id); if (!n) return; n.params[key] = value; finish(opts); }
export function setParams(id, patch, opts = {}) { const n = findNode(id); if (!n) return; Object.assign(n.params, patch); finish(opts); }
export function addModifier(id, kind, opts = {}) { const n = findNode(id); if (!n) return null; const m = createModifier(kind); n.modifiers.push(m); finish(opts); changed('props'); return m; }
export function setModifier(id, index, patch, opts = {}) { const n = findNode(id); if (!n || !n.modifiers[index]) return; Object.assign(n.modifiers[index], patch); finish(opts); }
export function removeModifier(id, index, opts = {}) { const n = findNode(id); if (!n) return; n.modifiers.splice(index, 1); finish(opts); changed('props'); }
export function moveModifier(id, index, delta, opts = {}) { const n = findNode(id); if (!n) return; const j = clamp(index + delta, 0, n.modifiers.length - 1); if (j === index) return; const [m] = n.modifiers.splice(index, 1); n.modifiers.splice(j, 0, m); finish(opts); changed('props'); }

// ---- transforms. setBox writes a document-space box {x,y,w,h,rot} onto a node.
export function setBox(id, b, opts = {}) {
  const n = findNode(id); if (!n) return;
  b = { ...b, w: Math.max(1, b.w), h: Math.max(1, b.h) };
  if (n.kind === 'group') {
    // move/scale the children about the group box
    const old = boxOf(n); const kx = b.w / (old.w || 1), ky = b.h / (old.h || 1);
    for (const c of n.children) transformDescendant(c, old, b, kx, ky);
  } else {
    const def = KINDS[n.kind]; const nat = measureOf(n);
    n.x = b.x; n.y = b.y; n.rot = b.rot;
    if (def.sizeInParams) { n.params.w = b.w; n.params.h = b.h; n.sx = 1; n.sy = 1; }
    else { n.sx = b.w / (nat.w || 1); n.sy = b.h / (nat.h || 1); }
  }
  finish(opts);
}
function transformDescendant(c, old, nb, kx, ky) {
  if (c.kind === 'group') { for (const cc of c.children) transformDescendant(cc, old, nb, kx, ky); return; }
  const def = KINDS[c.kind];
  c.x = nb.x + (c.x - old.x) * kx; c.y = nb.y + (c.y - old.y) * ky;
  if (def && def.sizeInParams) { c.params.w *= kx; c.params.h *= ky; } else { c.sx *= kx; c.sy *= ky; }
}
export function moveBy(ids, dx, dy, opts = {}) {
  for (const id of ids) { const n = findNode(id); if (!n) continue; if (n.kind === 'group') walk(n, m => { if (m.kind !== 'group') { m.x += dx; m.y += dy; } }); else { n.x += dx; n.y += dy; } }
  finish(opts);
}
export function setTransform(id, patch, opts = {}) { const n = findNode(id); if (!n) return; Object.assign(n, patch); finish(opts); }
export function centerInDoc(ids = state.sel, opts = {}) { for (const id of ids) { const n = findNode(id); const b = boxOf(n); setBox(id, { ...b, x: state.doc.w / 2, y: state.doc.h / 2 }, { transient: true }); } finish(opts); }
export function fitToDoc(id, fill = false, opts = {}) {
  const n = findNode(id); const b = boxOf(n);
  if (fill) setBox(id, { x: state.doc.w / 2, y: state.doc.h / 2, w: state.doc.w, h: state.doc.h, rot: 0 }, opts);
  else { const r = Math.min(state.doc.w / b.w, state.doc.h / b.h); setBox(id, { x: state.doc.w / 2, y: state.doc.h / 2, w: b.w * r, h: b.h * r, rot: b.rot }, opts); }
}

// ---- align / distribute (multi-selection; 'document' aligns to the page)
export function align(ids, how, to = 'selection', opts = {}) {
  const nodes = ids.map(id => findNode(id)).filter(Boolean); if (!nodes.length) return;
  const boxes = nodes.map(n => boxAABB(boxOf(n)));
  const ref = to === 'document' ? { x0: 0, y0: 0, x1: state.doc.w, y1: state.doc.h } : unionAABB(boxes);
  nodes.forEach((n, i) => {
    const a = boxes[i]; let dx = 0, dy = 0;
    if (how === 'left') dx = ref.x0 - a.x0; else if (how === 'right') dx = ref.x1 - a.x1; else if (how === 'hcenter') dx = (ref.x0 + ref.x1) / 2 - (a.x0 + a.x1) / 2;
    else if (how === 'top') dy = ref.y0 - a.y0; else if (how === 'bottom') dy = ref.y1 - a.y1; else if (how === 'vcenter') dy = (ref.y0 + ref.y1) / 2 - (a.y0 + a.y1) / 2;
    moveBy([n.id], dx, dy, { transient: true });
  });
  finish(opts);
}
export function distribute(ids, axis, opts = {}) {
  const nodes = ids.map(id => findNode(id)).filter(Boolean); if (nodes.length < 3) return;
  const items = nodes.map(n => ({ n, a: boxAABB(boxOf(n)) }));
  const k0 = axis === 'horizontal' ? 'x0' : 'y0', k1 = axis === 'horizontal' ? 'x1' : 'y1';
  items.sort((p, q) => (p.a[k0] + p.a[k1]) - (q.a[k0] + q.a[k1]));
  const first = items[0], last = items[items.length - 1];
  const total = items.reduce((s, it) => s + (it.a[k1] - it.a[k0]), 0);
  const gap = ((last.a[k1] - first.a[k0]) - total) / (items.length - 1);
  let pos = first.a[k0];
  for (const it of items) { const d = pos - it.a[k0]; moveBy([it.n.id], axis === 'horizontal' ? d : 0, axis === 'horizontal' ? 0 : d, { transient: true }); pos += (it.a[k1] - it.a[k0]) + gap; }
  finish(opts);
}

// ---- document
export function setDocument(patch, opts = {}) { Object.assign(state.doc, patch); finish(opts); changed('doc'); }
export function setName(name) { state.name = name || 'untitled'; commit(); changed('doc'); }

// ---- clipboard
export function copyNodes(ids = state.sel) {
  const nodes = ids.map(id => findNode(id)).filter(Boolean);
  const images = {}; for (const n of nodes) walk(n, m => { if (m.kind === 'image' && state.images[m.params.imageId]) { const im = state.images[m.params.imageId]; images[m.params.imageId] = { dataURL: im.dataURL, w: im.w, h: im.h, bits: im.bits }; } });
  return { format: 'depthcad/nodes', nodes: JSON.parse(JSON.stringify(nodes, (k, v) => k.startsWith('_') ? undefined : v)), images };
}
export function pasteNodes(payload, opts = {}) {
  if (!payload || payload.format !== 'depthcad/nodes') return [];
  const parent = currentContainer(); const out = [];
  for (const n of payload.nodes) { walk(n, m => { m.id = uid(); }); parent.children.push(n); out.push(n.id); }
  state.sel = out; finish(opts); changed('tree'); return out;
}
