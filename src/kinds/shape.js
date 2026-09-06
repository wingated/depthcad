import { registerKind } from '../engine/kinds.js';
import { renderShape, PROFILES } from '../engine/sdf.js';

registerKind({
  kind: 'shape', label: 'Shape', icon: '▭', sizeInParams: true,
  schema: {
    shape: { type: 'enum', label: 'Shape', default: 'rect', options: { rect: 'Rectangle', ellipse: 'Ellipse' } },
    w: { type: 'number', label: 'Width', default: 400, min: 1, hidden: true },
    h: { type: 'number', label: 'Height', default: 400, min: 1, hidden: true },
    inner: { type: 'number', label: 'Inner (ring) %', default: 0, min: 0, max: 99, step: 0.5, slider: true, scale: 100 },
    corner: { type: 'number', label: 'Corner radius', default: 0, min: 0, max: 2000, step: 1, slider: true, showIf: p => p.shape === 'rect' },
    profile: { type: 'enum', label: 'Profile', default: 'flat', options: PROFILES },
    bevel: { type: 'number', label: 'Bevel width (px)', default: 50, min: 1, max: 2000, step: 1, slider: true, showIf: p => p.profile === 'bevel' },
    low: { type: 'depth', label: 'Low value', default: 0 },
    high: { type: 'depth', label: 'High value', default: 1 },
  },
  hint: 'Profile shapes the height from the edge (Low) to the middle (High). A ring with the Dome profile is a torus; Bevel ramps over a fixed number of pixels.',
  init(n, doc) { const s = Math.round(Math.min(doc.w, doc.h) * 0.5); n.params.w = s; n.params.h = s; n.params.bevel = Math.round(s * 0.1); },
  measure(n) { return { w: n.params.w, h: n.params.h }; },
  render(n, { cw, ch }) { const p = n.params; return renderShape({ shape: p.shape, w: p.w, h: p.h, inner: p.inner, corner: p.corner, profile: p.profile, bevel: p.bevel, low: p.low, high: p.high }, cw, ch); },
});

// Convenience presets used by the toolbar
export function ringPreset(n) { n.name = 'Ring'; Object.assign(n.params, { shape: 'ellipse', inner: 0.8, profile: 'dome' }); return n; }
export function rectPreset(n) { n.name = 'Rect'; Object.assign(n.params, { shape: 'rect', inner: 0, profile: 'flat' }); return n; }
