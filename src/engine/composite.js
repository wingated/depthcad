// Tree compositor. Renders a node tree into a document-space raster.
//
// ctx = { scale, full, doc, assets, cache, W, H }
//   scale   render pixels per document pixel (1 for export)
//   full    true for full-quality sources (export), false for preview sources
//   cache   Map(node.id -> {key, raster}) of local rasters
import { createRaster, fillRaster, blendInto, applyCoverageMask, flatten } from './raster.js';
import { resampleToDoc, boxAABB, unionAABB } from './transform.js';
import { applyModifiers, modifierPad } from './modifiers.js';
import { KINDS } from './kinds.js';

const MAXPX = 4200 * 4200;
let asyncHook = null;
export function setAsyncHook(fn) { asyncHook = fn; }

export function makeContext(state, scale, full, cache) {
  const W = Math.max(1, Math.round(state.doc.w * scale)), H = Math.max(1, Math.round(state.doc.h * scale));
  return { scale, full, doc: state.doc, assets: state, cache, W, H };
}

// Returns {w, h, height: Float32Array} flattened against the document background.
export function renderDocument(state, scale, full, cache) {
  const ctx = makeContext(state, scale, full, cache);
  const acc = createRaster(ctx.W, ctx.H);
  fillRaster(acc, state.doc.bg, 1);
  compositeChildren(state.root, acc, ctx);
  return { w: ctx.W, h: ctx.H, height: flatten(acc, state.doc.bg) };
}

function compositeChildren(group, acc, ctx) {
  const masks = [];
  for (const child of group.children) {
    if (!child.visible) continue;
    if (KINDS[child.kind] && KINDS[child.kind].isMask) { const cov = renderMaskCoverage(child, ctx); if (cov) masks.push(cov); continue; }
    const r = renderNodeDoc(child, ctx); if (!r) continue;
    for (const m of masks) applyCoverageMask(r, m, ctx.W, ctx.H);
    blendInto(acc, r, child.blend || 'max');
  }
}

// Document-space raster of a node (group composite or resampled local raster), modifiers applied.
export function renderNodeDoc(node, ctx) {
  if (node.kind === 'group') {
    const acc = createRaster(ctx.W, ctx.H);
    compositeChildren(node, acc, ctx);
    applyModifiers(acc, node.modifiers, ctx.scale);
    return acc;
  }
  const kind = KINDS[node.kind]; if (!kind) return null;
  const nat = measureNode(node, ctx); if (!nat || !(nat.w > 0) || !(nat.h > 0)) return null;
  const local = renderLocal(node, kind, nat, ctx); if (!local) return null;
  const pad = modifierPad(node.modifiers, ctx.scale);
  const r = resampleToDoc(local, 0, node, nat, ctx.scale, ctx.W, ctx.H, pad); if (!r) return null;
  applyModifiers(r, node.modifiers, ctx.scale);
  return r;
}

function renderMaskCoverage(node, ctx) {
  const r = renderNodeDoc(node, ctx);
  const inv = !!node.params.invert;
  const cov = new Float32Array(ctx.W * ctx.H); if (inv) cov.fill(1);
  if (!r) return inv ? cov : cov; // no coverage: masks everything (or nothing when inverted)
  for (let y = 0; y < r.h; y++) {
    const dy = y + r.origin.y; if (dy < 0 || dy >= ctx.H) continue;
    for (let x = 0; x < r.w; x++) {
      const dx = x + r.origin.x; if (dx < 0 || dx >= ctx.W) continue;
      const c = r.coverage[y * r.w + x];
      cov[dy * ctx.W + dx] = inv ? 1 - c : c;
    }
  }
  return cov;
}

function renderLocal(node, kind, nat, ctx) {
  const ps = ctx.scale * Math.max(node.sx, node.sy);
  let cw = Math.ceil(nat.w * ps), ch = Math.ceil(nat.h * ps);
  if (cw * ch > MAXPX) { const f = Math.sqrt(MAXPX / (cw * ch)); cw = Math.floor(cw * f); ch = Math.floor(ch * f); }
  cw = Math.max(1, cw); ch = Math.max(1, ch);
  const key = (kind.cacheKey ? kind.cacheKey(node, ctx) : JSON.stringify(node.params)) + '|' + cw + 'x' + ch + (ctx.full ? '|f' : '|p');
  const ent = ctx.cache && ctx.cache.get(node.id);
  if (ent && ent.key === key) return ent.raster;
  if (kind.renderAsync) {
    // asynchronous kinds (extension tools run in a Worker): start the render, show the previous raster meanwhile
    if (!ctx.cache) return null;
    if (ent && ent.pendingKey === key) return ent.raster || null;
    const promise = kind.renderAsync(node, { cw, ch, full: ctx.full, ctx });
    ctx.cache.set(node.id, { key: ent ? ent.key : null, raster: ent ? ent.raster : null, pendingKey: key, promise });
    promise.then(r => { const cur = ctx.cache.get(node.id); if (cur && cur.pendingKey === key) ctx.cache.set(node.id, { key, raster: r }); node._error = null; if (asyncHook) asyncHook(node); },
      err => { const cur = ctx.cache.get(node.id); if (cur && cur.pendingKey === key) ctx.cache.set(node.id, { key, raster: null }); node._error = String(err && err.message || err); if (asyncHook) asyncHook(node, node._error); });
    return ent ? ent.raster : null;
  }
  const raster = kind.render(node, { cw, ch, full: ctx.full, ctx });
  if (!raster) return null;
  if (ctx.cache) ctx.cache.set(node.id, { key, raster });
  return raster;
}
// Wait for every asynchronous kind in the tree to have a raster at this scale, then render.
export async function renderDocumentAsync(state, scale, full, cache) {
  const ctx = makeContext(state, scale, full, cache);
  for (let pass = 0; pass < 3; pass++) {
    renderDocument(state, scale, full, cache); // kicks off pending renders
    const waits = []; for (const [, ent] of cache) if (ent.pendingKey && ent.promise) waits.push(ent.promise.catch(() => null));
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
