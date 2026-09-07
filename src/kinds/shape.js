import { registerKind } from '../engine/kinds.js';
import { renderShape, PROFILES, shapeHalfBand } from '../engine/sdf.js';
import { resolveProfile, profileLUT, profileKey } from '../engine/profile.js';

registerKind({
  kind: 'shape', label: 'Shape', icon: '▭', sizeInParams: true,
  schema: {
    shape: { type: 'enum', label: 'Shape', default: 'rect', options: { rect: 'Rectangle', ellipse: 'Ellipse' } },
    w: { type: 'number', label: 'Width', default: 400, min: 1, hidden: true },
    h: { type: 'number', label: 'Height', default: 400, min: 1, hidden: true },
    inner: { type: 'number', label: 'Inner (ring) %', default: 0, min: 0, max: 99, step: 0.5, slider: true, scale: 100 },
    corner: { type: 'number', label: 'Corner radius', default: 0, min: 0, max: 2000, step: 1, slider: true, showIf: p => p.shape === 'rect' },
    outerProfile: { type: 'profile', label: 'Edge profile', default: 'flat' },
    outerWidth: { type: 'number', label: 'Edge width (px)', default: 200, min: 1, max: 4000, step: 1, slider: true },
    innerProfile: { type: 'profile', label: 'Inner edge profile', default: 'flat', showIf: p => p.inner > 0 },
    innerWidth: { type: 'number', label: 'Inner edge width (px)', default: 200, min: 1, max: 4000, step: 1, slider: true, showIf: p => p.inner > 0 },
    low: { type: 'depth', label: 'Low value', default: 0 },
    high: { type: 'depth', label: 'High value', default: 1 },
  },
  hint: 'The edge profile shapes the height from the edge (Low) inward over the edge width; beyond it the shape is flat at High. Rings and frames have a second profile on the inner edge; where both bands overlap the lower one wins. Edit a profile to build your own from lines, domes, coves and curves.',
  init(n, doc) { const s = Math.round(Math.min(doc.w, doc.h) * 0.5); n.params.w = s; n.params.h = s; n.params.outerWidth = Math.round(s / 2); n.params.innerWidth = Math.round(s / 2); },
  // Older documents: a single named profile (and bevel width) over the whole half band.
  migrate(p) {
    if (p.profile === undefined && p.bevel === undefined) return;
    const half = shapeHalfBand(p.w || 400, p.h || 400, p.inner || 0);
    const prof = p.profile || 'flat';
    const id = prof === 'bevel' ? 'linear' : prof; const width = prof === 'bevel' ? (p.bevel || half) : half;
    if (p.outerProfile === undefined) { p.outerProfile = id; p.outerWidth = Math.round(width * 100) / 100; }
    if (p.innerProfile === undefined) { p.innerProfile = id; p.innerWidth = Math.round(width * 100) / 100; }
    delete p.profile; delete p.bevel;
  },
  measure(n) { return { w: n.params.w, h: n.params.h }; },
  cacheKey(n, ctx) { const p = n.params; return JSON.stringify(p) + '|' + profileKey(resolveProfile(p.outerProfile, ctx.assets)) + (p.inner > 0 ? '|' + profileKey(resolveProfile(p.innerProfile, ctx.assets)) : ''); },
  render(n, { cw, ch, ctx }) {
    const p = n.params; const store = ctx.assets;
    const outer = { lut: profileLUT(resolveProfile(p.outerProfile, store)), width: p.outerWidth };
    const innerEdge = p.inner > 0 ? { lut: profileLUT(resolveProfile(p.innerProfile, store)), width: p.innerWidth } : null;
    return renderShape({ shape: p.shape, w: p.w, h: p.h, inner: p.inner, corner: p.corner, low: p.low, high: p.high, outer, innerEdge }, cw, ch);
  },
});

// Convenience presets used by the toolbar
export function ringPreset(n) { n.name = 'Ring'; const band = Math.round(shapeHalfBand(n.params.w, n.params.h, 0.8)); Object.assign(n.params, { shape: 'ellipse', inner: 0.8, outerProfile: 'dome', innerProfile: 'dome', outerWidth: band, innerWidth: band }); return n; }
export function rectPreset(n) { n.name = 'Rect'; Object.assign(n.params, { shape: 'rect', inner: 0, outerProfile: 'flat' }); return n; }
