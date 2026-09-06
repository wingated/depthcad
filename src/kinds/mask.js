import { registerKind } from '../engine/kinds.js';
import { renderShape } from '../engine/sdf.js';

// A mask node contributes coverage only. It masks every sibling above it in its group
// (all masks below a node apply, multiplied). Invert removes the inside instead.
registerKind({
  kind: 'mask', label: 'Mask', icon: '◐', sizeInParams: true, isMask: true,
  schema: {
    shape: { type: 'enum', label: 'Shape', default: 'ellipse', options: { rect: 'Rectangle', ellipse: 'Ellipse' } },
    w: { type: 'number', label: 'Width', default: 400, min: 1, hidden: true },
    h: { type: 'number', label: 'Height', default: 400, min: 1, hidden: true },
    inner: { type: 'number', label: 'Inner %', default: 0, min: 0, max: 99, step: 0.5, slider: true, scale: 100 },
    corner: { type: 'number', label: 'Corner radius', default: 0, min: 0, max: 2000, step: 1, slider: true, showIf: p => p.shape === 'rect' },
    invert: { type: 'bool', label: 'Invert (remove inside)', default: false },
  },
  hint: 'A mask clips every layer above it in the same group. Add a Feather modifier for a soft edge. Group a layer with its mask to keep the effect local.',
  init(n, doc) { const s = Math.round(Math.min(doc.w, doc.h) * 0.6); n.params.w = s; n.params.h = s; },
  measure(n) { return { w: n.params.w, h: n.params.h }; },
  render(n, { cw, ch }) { const p = n.params; return renderShape({ shape: p.shape, w: p.w, h: p.h, inner: p.inner, corner: p.corner, profile: 'flat', low: 0, high: 0 }, cw, ch, true); },
});
