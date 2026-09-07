// Tree compositor. Renders a node tree into a document-space raster.
//
// ctx = { scale, full, doc, assets, cache, W, H }
//   scale   render pixels per document pixel (1 for export)
//   full    true for full-quality sources (export), false for preview sources
//   cache   Map(node.id -> entry) with per-node caches:
//             entry.local = {key, raster}          local raster (kind render)
//             entry.doc   = {key, raster, rx, ry}  document-space raster after modifiers (preview only)
//             entry.mask  = {key, cov}             full-size coverage of a mask node
//             entry.group = {key, raster}          composite of a group's children (+ its modifiers)
// In preview mode a node's translation is quantized to whole render pixels, so a moved layer
// reuses its document raster with a shifted origin instead of being resampled again.
import { createRaster, fillRaster, blendInto, applyCoverageMask, flatten } from './raster.js';
import { resampleToDoc, boxAABB, unionAABB } from './transform.js';
import { applyModifiers, modifierPad } from './modifiers.js';
import { KINDS } from './kinds.js';

const MAXPX = 4200 * 4200;
const FAST_PX = 360 * 360; // local raster budget while the user is dragging (ctx.fast)
const MAX_CACHED_DOC_PX = 6 * 1024 * 1024; // larger document rasters are clipped to the page and not shift-cached
let asyncHook = null;
export function setAsyncHook(fn) { asyncHook = fn; }

export function makeContext(state, scale, full, cache, fast = false) {
  const W = Math.max(1, Math.round(state.doc.w * scale)), H = Math.max(1, Math.round(state.doc.h * scale));
  return { scale, full, doc: state.doc, assets: state, cache: cache || new Map(), W, H, fast: !!fast && !full };
}
function entry(ctx, node) { let e = ctx.cache.get(node.id); if (!e) { e = {}; ctx.cache.set(node.id, e); } return e; }

// Returns {w, h, height: Float32Array} flattened against the document background.
export function renderDocument(state, scale, full, cache, fast = false) {
  const ctx = makeContext(state, scale, full, cache, fast);
  const acc = createRaster(ctx.W, ctx.H);
  fillRaster(acc, state.doc.bg, 1);
  compositeChildren(state.root, acc, ctx);
  return { w: ctx.W, h: ctx.H, height: flatten(acc, state.doc.bg) };
}

function compositeChildren(group, acc, ctx) {
  const masks = [];
  for (const child of group.children) {
    if (!child.visible) continue;
    if (KINDS[child.kind] && KINDS[child.kind].isMask) { const cov = maskCoverage(child, ctx); if (cov) masks.push(cov); continue; }
    let r = renderNodeDoc(child, ctx); if (!r) continue;
    if (masks.length) { r = { w: r.w, h: r.h, origin: r.origin, height: r.height, coverage: r.coverage.slice() }; for (const m of masks) applyCoverageMask(r, m, ctx.W, ctx.H); }
    blendInto(acc, r, child.blend || 'max');
  }
}

// ---- keys
function quant(v, scale) { return Math.round(v * scale); }
function transformKey(node) { return `${node.sx},${node.sy},${node.rot}|${JSON.stringify(node.modifiers)}`; }
// Key describing a node's document raster including its position (used by parents).
function nodeStateKey(node, ctx) {
  if (node.kind === 'group') return 'g[' + node.children.map(c => c.visible ? nodeStateKey(c, ctx) + '/' + c.blend : '-').join(';') + ']' + JSON.stringify(node.modifiers) + '|' + node.id;
  const kind = KINDS[node.kind]; if (!kind) return '?';
  const lk = kind.cacheKey ? kind.cacheKey(node, ctx) : JSON.stringify(node.params);
  return `${node.kind}|${lk}|${transformKey(node)}|${quant(node.x, ctx.scale)},${quant(node.y, ctx.scale)}|${node.id}`;
}

// Document-space raster of a node (group composite or resampled local raster), modifiers applied.
// The returned raster must be treated as read-only (it may be cached).
export function renderNodeDoc(node, ctx) {
  if (node.kind === 'group') return renderGroupDoc(node, ctx);
  const kind = KINDS[node.kind]; if (!kind) return null;
  const nat = measureNode(node, ctx); if (!nat || !(nat.w > 0) || !(nat.h > 0)) return null;
  const local = renderLocal(node, kind, nat, ctx); if (!local) return null;
  const e = entry(ctx, node);
  const pad = modifierPad(node.modifiers, ctx.scale);
  const rx = quant(node.x, ctx.scale), ry = quant(node.y, ctx.scale);
  if (ctx.full) {
    // export: exact position, clipped to the page, not cached
    const r = resampleToDoc(local, 0, node, nat, ctx.scale, ctx.W, ctx.H, pad); if (!r) return null;
    return applyModifiers(r, node.modifiers, ctx.scale);
  }
  const box = { x: 0, y: 0, w: nat.w * node.sx, h: nat.h * node.sy, rot: node.rot }; const a = boxAABB(box);
  const areaPx = (a.x1 - a.x0) * ctx.scale * (a.y1 - a.y0) * ctx.scale;
  const shiftable = areaPx <= MAX_CACHED_DOC_PX;
  const key = e.local.key + '|' + transformKey(node) + '|' + ctx.scale + (shiftable ? '' : `|${rx},${ry}`);
  if (e.doc && e.doc.key === key) {
    if (!shiftable) return e.doc.raster;
    const r = e.doc.raster; const dx = rx - e.doc.rx, dy = ry - e.doc.ry;
    return dx || dy ? { w: r.w, h: r.h, origin: { x: r.origin.x + dx, y: r.origin.y + dy }, height: r.height, coverage: r.coverage } : r;
  }
  // render at the quantized position; unclipped when shiftable so a moved copy stays complete
  const t = { x: rx / ctx.scale, y: ry / ctx.scale, sx: node.sx, sy: node.sy, rot: node.rot };
  const r = shiftable ? resampleToDoc(local, 0, t, nat, ctx.scale, null, null, pad) : resampleToDoc(local, 0, t, nat, ctx.scale, ctx.W, ctx.H, pad);
  if (!r) return null;
  applyModifiers(r, node.modifiers, ctx.scale);
  e.doc = { key, raster: r, rx, ry };
  return r;
}

function renderGroupDoc(node, ctx) {
  const e = entry(ctx, node);
  const key = ctx.full ? null : nodeStateKey(node, ctx) + '|' + ctx.scale + '|' + ctx.W + 'x' + ctx.H;
  if (key && e.group && e.group.key === key) return e.group.raster;
  const acc = createRaster(ctx.W, ctx.H);
  compositeChildren(node, acc, ctx);
  applyModifiers(acc, node.modifiers, ctx.scale);
  if (key) e.group = { key, raster: acc };
  return acc;
}

function maskCoverage(node, ctx) {
  const e = entry(ctx, node);
  const key = ctx.full ? null : nodeStateKey(node, ctx) + '|' + ctx.scale + '|' + ctx.W + 'x' + ctx.H + '|' + (node.params.invert ? 1 : 0);
  if (key && e.mask && e.mask.key === key) return e.mask.cov;
  const r = renderNodeDoc(node, ctx);
  const inv = !!node.params.invert;
  const cov = new Float32Array(ctx.W * ctx.H); if (inv) cov.fill(1);
  if (r) {
    const y0 = Math.max(0, -r.origin.y), y1 = Math.min(r.h, ctx.H - r.origin.y), x0 = Math.max(0, -r.origin.x), x1 = Math.min(r.w, ctx.W - r.origin.x);
    for (let y = y0; y < y1; y++) { const row = (y + r.origin.y) * ctx.W + r.origin.x, src = y * r.w; if (inv) for (let x = x0; x < x1; x++) cov[row + x] = 1 - r.coverage[src + x]; else for (let x = x0; x < x1; x++) cov[row + x] = r.coverage[src + x]; }
  }
  if (key) e.mask = { key, cov };
  return cov;
}

function renderLocal(node, kind, nat, ctx) {
  const ps = ctx.scale * Math.max(node.sx, node.sy);
  let cw = Math.ceil(nat.w * ps), ch = Math.ceil(nat.h * ps);
  if (cw * ch > MAXPX) { const f = Math.sqrt(MAXPX / (cw * ch)); cw = Math.floor(cw * f); ch = Math.floor(ch * f); }
  cw = Math.max(1, cw); ch = Math.max(1, ch);
  const e = entry(ctx, node); const ent = e.local;
  const baseKey = (kind.cacheKey ? kind.cacheKey(node, ctx) : JSON.stringify(node.params));
  let key = baseKey + '|' + cw + 'x' + ch + (ctx.full ? '|f' : '|p');
  if (ent && ent.key === key) return ent.raster;
  // while dragging, render a reduced local raster if the full one is not already cached
  if (ctx.fast && !kind.renderAsync && cw * ch > FAST_PX) { const f = Math.sqrt(FAST_PX / (cw * ch)); cw = Math.max(1, Math.floor(cw * f)); ch = Math.max(1, Math.floor(ch * f)); key = baseKey + '|' + cw + 'x' + ch + '|fast'; if (ent && ent.key === key) return ent.raster; }
  if (kind.renderAsync) {
    // asynchronous kinds (extension tools run in a Worker): start the render, show the previous raster meanwhile
    if (ent && ent.pendingKey === key) return ent.raster || null;
    const promise = kind.renderAsync(node, { cw, ch, full: ctx.full, ctx });
    e.local = { key: ent ? ent.key : null, raster: ent ? ent.raster : null, pendingKey: key, promise };
    promise.then(r => { const cur = e.local; if (cur && cur.pendingKey === key) e.local = { key, raster: r }; node._error = null; if (asyncHook) asyncHook(node); },
      err => { const cur = e.local; if (cur && cur.pendingKey === key) e.local = { key, raster: null }; node._error = String(err && err.message || err); if (asyncHook) asyncHook(node, node._error); });
    return ent ? ent.raster : null;
  }
  const raster = kind.render(node, { cw, ch, full: ctx.full, ctx });
  if (!raster) return null;
  e.local = { key, raster };
  return raster;
}
// Wait for every asynchronous kind in the tree to have a raster at this scale, then render.
export async function renderDocumentAsync(state, scale, full, cache) {
  for (let pass = 0; pass < 3; pass++) {
    renderDocument(state, scale, full, cache); // kicks off pending renders
    const waits = []; for (const [, e] of cache) if (e.local && e.local.pendingKey && e.local.promise) waits.push(e.local.promise.catch(() => null));
    if (!waits.length) break;
    await Promise.all(waits);
  }
  return renderDocument(state, scale, full, cache);
}

// Natural (unscaled) size of a node in local units. Groups measure as the AABB of their children.
export function measureNode(node, ctx) {
  if (node.kind === 'group') { const a = groupAABB(node, ctx); return a ? { w: a.x1 - a.x0, h: a.y1 - a.y0 } : { w: 0, h: 0 }; }
  const kind = KINDS[node.kind]; return kind ? kind.measure(node, ctx) : { w: 0, h: 0 };
}

// Document-space box {x, y, w, h, rot} of a node.
export function nodeBox(node, ctx) {
  if (node.kind === 'group') {
    const a = groupAABB(node, ctx); if (!a) return { x: node.x, y: node.y, w: 0, h: 0, rot: 0 };
    return { x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2, w: a.x1 - a.x0, h: a.y1 - a.y0, rot: 0 };
  }
  const n = measureNode(node, ctx);
  return { x: node.x, y: node.y, w: n.w * node.sx, h: n.h * node.sy, rot: node.rot };
}
export function nodeAABB(node, ctx) { return boxAABB(nodeBox(node, ctx)); }
function groupAABB(group, ctx) {
  const list = group.children.map(c => nodeAABB(c, ctx)).filter(a => isFinite(a.x0));
  return list.length ? unionAABB(list) : null;
}
