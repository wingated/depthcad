// Node kind registry. A kind provides:
//   kind, label, icon        identity
//   schema                   parameter schema (drives the properties panel and defaults)
//   measure(node, ctx)       natural size {w, h} in local units
//   render(node, opts)       local Raster; opts = {cw, ch, full, ctx} (cw x ch is the requested pixel size)
//   cacheKey?(node, ctx)     string; the local raster is re-rendered when it changes (default: params JSON)
//   sizeInParams?            true when the natural size lives in params.w/params.h (shapes, masks):
//                            resizing then edits the params instead of the scale factors
//   isMask?                  node output is coverage only and masks the siblings above it
//   init?(node, doc)         adjust a freshly created node (e.g. sensible default size)
import { uid } from './util.js';

export const KINDS = {};
export function registerKind(def) { KINDS[def.kind] = def; return def; }

export function schemaDefaults(schema) {
  const out = {};
  for (const [k, s] of Object.entries(schema || {})) out[k] = Array.isArray(s.default) || (s.default && typeof s.default === 'object') ? JSON.parse(JSON.stringify(s.default)) : s.default;
  return out;
}

export function createNode(kind, doc) {
  const def = KINDS[kind]; if (!def) throw new Error('Unknown node kind ' + kind);
  const n = {
    id: uid(), kind, name: def.label, visible: true, locked: false,
    x: doc.w / 2, y: doc.h / 2, sx: 1, sy: 1, rot: 0, lockAspect: false,
    blend: 'max', modifiers: [], params: schemaDefaults(def.schema),
  };
  if (kind === 'group') n.children = [];
  if (def.init) def.init(n, doc);
  return n;
}

export const BLEND_MODES = { max: 'Union (max)', min: 'Clamp (min)', replace: 'Replace', cut: 'Cut below', keep: 'Keep below' };
