// Preview rendering scheduler. Keeps the composite (float height array) for the 2D
// view, the value readout and the 3D view; renders lazily on animation frames.
import { state, allNodes } from './state.js';
import { renderDocument, setAsyncHook } from '../engine/composite.js';
setAsyncHook((node, err) => { invalidate(); if (err) console.warn('tool error in', node.name, err); });

export const previewCache = new Map();
export const exportCache = new Map();
let comp = null, compScale = 1, dirty = true;
const frameListeners = new Set(), compListeners = new Set();

export function invalidate() { dirty = true; }
export function onFrame(fn) { frameListeners.add(fn); }
export function onComposite(fn) { compListeners.add(fn); }
export function getComposite() { return comp; }
export function getCompositeScale() { return compScale; }
export function previewScale() { return Math.min(1, state.previewMax / Math.max(state.doc.w, state.doc.h)); }

export function renderPreviewNow() {
  dirty = false; compScale = previewScale();
  try { comp = renderDocument(state, compScale, false, previewCache); }
  catch (e) { console.error(e); }
  for (const fn of compListeners) fn(comp);
}
export function valueAt(dx, dy) {
  if (!comp) return null;
  const px = Math.floor(dx * compScale), py = Math.floor(dy * compScale);
  if (px < 0 || py < 0 || px >= comp.w || py >= comp.h) return null;
  return comp.height[py * comp.w + px];
}
export function pruneCaches() {
  const ids = new Set(allNodes().map(n => n.id));
  for (const m of [previewCache, exportCache]) for (const k of [...m.keys()]) if (!ids.has(k)) m.delete(k);
}
export function clearCaches() { previewCache.clear(); exportCache.clear(); invalidate(); }
export function startLoop() {
  (function tick() { if (dirty) renderPreviewNow(); for (const fn of frameListeners) fn(); requestAnimationFrame(tick); })();
}
