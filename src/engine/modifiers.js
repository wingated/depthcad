// Modifiers transform a raster in place. Pointwise ones ignore the pixel scale;
// spatial ones (feather, blur) take radii in document pixels and receive `scale`
// (render pixels per document pixel).
import { blurFloat } from './raster.js';

export const MODIFIERS = {};
export function registerModifier(def) { MODIFIERS[def.kind] = def; }

// Extra padding (in render px) a modifier needs around a raster's bounding box.
export function modifierPad(mods, scale) {
  let pad = 0;
  for (const m of mods || []) { const d = MODIFIERS[m.kind]; if (d && d.pad) pad += d.pad(m, scale); }
  return Math.ceil(pad);
}

export function applyModifiers(r, mods, scale) {
  for (const m of mods || []) {
    if (m.enabled === false) continue;
    const d = MODIFIERS[m.kind]; if (!d) continue;
    d.apply(r, m, scale);
  }
  return r;
}

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

registerModifier({
  kind: 'levels', label: 'Levels',
  schema: {
    inB: { type: 'depth', label: 'In black', default: 0 }, inW: { type: 'depth', label: 'In white', default: 1 },
    gamma: { type: 'number', label: 'Gamma', default: 1, min: 0.1, max: 4, step: 0.01, slider: true },
    outB: { type: 'depth', label: 'Out black', default: 0 }, outW: { type: 'depth', label: 'Out white', default: 1 },
    invert: { type: 'bool', label: 'Invert', default: false },
  },
  apply(r, m) {
    const span = (m.inW - m.inB) || 1e-6, ig = 1 / Math.max(1e-3, m.gamma || 1), ob = m.outB || 0, ow = m.outW ?? 1;
    const h = r.height;
    for (let i = 0; i < h.length; i++) {
      let v = m.invert ? 1 - h[i] : h[i];
      v = clamp01((v - m.inB) / span);
      if (ig !== 1) v = Math.pow(v, ig);
      h[i] = ob + v * (ow - ob);
    }
  },
});

// Piecewise-linear curve through sorted control points [[x,y],...] in 0..1.
registerModifier({
  kind: 'curve', label: 'Curve',
  schema: { points: { type: 'curve', label: 'Curve', default: [[0, 0], [1, 1]] } },
  apply(r, m) {
    const pts = (m.points && m.points.length >= 2 ? m.points : [[0, 0], [1, 1]]).slice().sort((a, b) => a[0] - b[0]);
    const N = 1024, lut = new Float32Array(N + 1);
    let k = 0;
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      while (k < pts.length - 2 && x > pts[k + 1][0]) k++;
      const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
      const t = x1 > x0 ? clamp01((x - x0) / (x1 - x0)) : 0;
      lut[i] = x < pts[0][0] ? pts[0][1] : x > pts[pts.length - 1][0] ? pts[pts.length - 1][1] : y0 + (y1 - y0) * t;
    }
    const h = r.height;
    for (let i = 0; i < h.length; i++) h[i] = lut[Math.round(clamp01(h[i]) * N)];
  },
});

registerModifier({
  kind: 'clamp', label: 'Clamp',
  schema: { min: { type: 'depth', label: 'Min', default: 0 }, max: { type: 'depth', label: 'Max', default: 1 } },
  apply(r, m) { const h = r.height, lo = m.min || 0, hi = m.max ?? 1; for (let i = 0; i < h.length; i++) h[i] = h[i] < lo ? lo : h[i] > hi ? hi : h[i]; },
});

registerModifier({
  kind: 'feather', label: 'Feather (soft edge)',
  schema: { radius: { type: 'number', label: 'Radius (px)', default: 10, min: 0, max: 500, step: 0.5, slider: true } },
  pad: (m, scale) => (m.radius || 0) * scale * 3,
  apply(r, m, scale) { const rad = (m.radius || 0) * scale; if (rad < 0.3) return; r.coverage = blurFloat(r.coverage, r.w, r.h, rad); },
});

registerModifier({
  kind: 'blur', label: 'Blur (smooth height)',
  schema: { radius: { type: 'number', label: 'Radius (px)', default: 4, min: 0, max: 200, step: 0.5, slider: true } },
  pad: (m, scale) => (m.radius || 0) * scale * 3,
  apply(r, m, scale) {
    const rad = (m.radius || 0) * scale; if (rad < 0.3) return;
    // coverage-weighted blur so uncovered pixels do not darken the edges
    const n = r.w * r.h, pm = new Float32Array(n);
    for (let i = 0; i < n; i++) pm[i] = r.height[i] * r.coverage[i];
    const bp = blurFloat(pm, r.w, r.h, rad), bc = blurFloat(r.coverage, r.w, r.h, rad);
    for (let i = 0; i < n; i++) if (bc[i] > 1e-6 && r.coverage[i] > 0) r.height[i] = bp[i] / bc[i];
  },
});

registerModifier({
  kind: 'offset', label: 'Offset (add height)',
  schema: { amount: { type: 'depth', label: 'Amount', default: 0.1, min: -1, max: 1 } },
  apply(r, m) { const h = r.height, a = m.amount || 0; for (let i = 0; i < h.length; i++) h[i] = clamp01(h[i] + a); },
});

export function createModifier(kind) {
  const d = MODIFIERS[kind]; if (!d) throw new Error('Unknown modifier ' + kind);
  const m = { kind, enabled: true };
  for (const [k, s] of Object.entries(d.schema)) m[k] = Array.isArray(s.default) ? JSON.parse(JSON.stringify(s.default)) : s.default;
  return m;
}
