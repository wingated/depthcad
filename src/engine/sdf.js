// Signed-distance primitives (positive inside, in local units) and shape rasterization.
import { createRaster } from './raster.js';
import { lutAt } from './profile.js';

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
// Distances for a rect/ellipse of size w x h with optional inner ratio (ring/frame) and corner radius:
// [distance inside the outer edge, distance inside the ring from the inner edge (Infinity when solid)].
export function shapeDists(shape, w, h, inner, corner, u, v) {
  const a = w / 2, b = h / 2;
  if (shape === 'ellipse') return [ellipseDist(u, v, a, b), inner > 0 ? -ellipseDist(u, v, a * inner, b * inner) : Infinity];
  const rc = Math.min(Math.max(corner, 0), a, b);
  return [rectDist(u, v, a, b, rc), inner > 0 ? -rectDist(u, v, a * inner, b * inner, rc * inner) : Infinity];
}
export function shapeDist(shape, w, h, inner, corner, u, v) { const [o, i] = shapeDists(shape, w, h, inner, corner, u, v); return Math.min(o, i); }
// Half of the band available to a profile: the half-thickness of a ring, or the half-size of a solid shape.
export function shapeHalfBand(w, h, inner) { const m = Math.min(w, h) / 2; return Math.max(1e-6, inner > 0 ? m * (1 - inner) / 2 : m); }

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
// p: {shape, w, h, inner, corner, low, high, outer: {lut, width}, innerEdge: {lut, width}}
//   outer / innerEdge: profile lookup tables (see profile.js) and band widths in local px.
//   Legacy form: {profile, bevel} (named profile over the whole half band) is still accepted.
// When coverageOnly is true only coverage is written (masks).
export function renderShape(p, cw, ch, coverageOnly = false) {
  const r = createRaster(cw, ch);
  const ps = cw / p.w; // pixels per local unit (assumed isotropic enough for antialiasing)
  const a = p.w / 2, b = p.h / 2, inner = p.inner || 0;
  const low = p.low ?? 0, span = (p.high ?? 1) - low;
  const H = r.height, C = r.coverage;
  const legacy = !p.outer; const dmax = shapeHalfBand(p.w, p.h, inner);
  const oLut = p.outer && p.outer.lut, oW = p.outer ? Math.max(1e-6, p.outer.width) : 1;
  const iLut = inner > 0 && p.innerEdge && p.innerEdge.lut, iW = p.innerEdge ? Math.max(1e-6, p.innerEdge.width) : 1;
  for (let j = 0; j < ch; j++) {
    const v = (j + 0.5) / ch * p.h - b;
    for (let i = 0; i < cw; i++) {
      const u = (i + 0.5) / cw * p.w - a;
      const [dO, dI] = shapeDists(p.shape, p.w, p.h, inner, p.corner || 0, u, v);
      const dist = dO < dI ? dO : dI;
      const alpha = clamp01(dist * ps + 0.5);
      if (alpha <= 0) continue;
      const k = j * cw + i;
      C[k] = alpha;
      if (coverageOnly) continue;
      let t;
      if (legacy) t = profileT(p.profile, dist, dmax, p.bevel);
      else { t = lutAt(oLut, 1 - clamp01(dO / oW)); if (iLut) { const ti = lutAt(iLut, 1 - clamp01(dI / iW)); if (ti < t) t = ti; } }
      H[k] = low + t * span;
    }
  }
  return r;
}
