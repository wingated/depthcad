// Signed-distance primitives (positive inside, in local units) and shape rasterization.
import { createRaster } from './raster.js';

export function ellipseDist(u, v, a, b) {
  if (a <= 0 || b <= 0) return -1e9;
  const r = Math.sqrt(u * u / (a * a) + v * v / (b * b));
  if (r < 1e-6) return Math.min(a, b);
  const g = Math.sqrt(u * u / (a * a * a * a) + v * v / (b * b * b * b)) / r;
  return (1 - r) / g;
}
export function rectDist(u, v, a, b, rc) {
  const qx = Math.abs(u) - (a - rc), qy = Math.abs(v) - (b - rc);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return -(Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - rc);
}
// Distance for a rect/ellipse of size w x h with optional inner ratio (ring/frame) and corner radius.
export function shapeDist(shape, w, h, inner, corner, u, v) {
  const a = w / 2, b = h / 2;
  let d;
  if (shape === 'ellipse') {
    d = ellipseDist(u, v, a, b);
    if (inner > 0) d = Math.min(d, -ellipseDist(u, v, a * inner, b * inner));
  } else {
    const rc = Math.min(Math.max(corner, 0), a, b);
    d = rectDist(u, v, a, b, rc);
    if (inner > 0) d = Math.min(d, -rectDist(u, v, a * inner, b * inner, rc * inner));
  }
  return d;
}

export const PROFILES = { flat: 'Flat', linear: 'Linear (cone)', dome: 'Dome (round)', scallop: 'Scallop (cove)', cosine: 'Smooth (cosine)', bevel: 'Bevel (px)' };

export function profileT(profile, dist, dmax, bevel) {
  switch (profile) {
    case 'linear': return clamp01(dist / dmax);
    case 'dome': { const k = clamp01(dist / dmax); return Math.sqrt(1 - (1 - k) * (1 - k)); }
    case 'scallop': { const k = clamp01(dist / dmax); return 1 - Math.sqrt(1 - k * k); } // concave: the inverse of dome
    case 'cosine': { const k = clamp01(dist / dmax); return 0.5 - 0.5 * Math.cos(Math.PI * k); }
    case 'bevel': return clamp01(dist / Math.max(1e-6, bevel));
    default: return 1;
  }
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

// Rasterize a shape into a local raster of cw x ch pixels covering w x h local units.
// p: {shape, w, h, inner, corner, profile, bevel, low, high}; low/high are normalized heights.
// When coverageOnly is true only coverage is written (masks).
export function renderShape(p, cw, ch, coverageOnly = false) {
  const r = createRaster(cw, ch);
  const ps = cw / p.w; // pixels per local unit (assumed isotropic enough for antialiasing)
  const a = p.w / 2, b = p.h / 2;
  const dmax = Math.max(1e-6, p.inner > 0 ? Math.min(a, b) * (1 - p.inner) / 2 : Math.min(a, b));
  const low = p.low ?? 0, span = (p.high ?? 1) - low;
  const H = r.height, C = r.coverage;
  for (let j = 0; j < ch; j++) {
    const v = (j + 0.5) / ch * p.h - b;
    for (let i = 0; i < cw; i++) {
      const u = (i + 0.5) / cw * p.w - a;
      const dist = shapeDist(p.shape, p.w, p.h, p.inner || 0, p.corner || 0, u, v);
      const alpha = clamp01(dist * ps + 0.5);
      if (alpha <= 0) continue;
      const k = j * cw + i;
      C[k] = alpha;
      if (!coverageOnly) H[k] = low + profileT(p.profile, dist, dmax, p.bevel) * span;
    }
  }
  return r;
}
