// Node transforms and box geometry. A node's transform is a centre (x, y) in
// document pixels, scale factors sx/sy applied to the natural size, and a
// rotation in degrees. A "box" is {x, y, w, h, rot} in document space.
import { createRaster } from './raster.js';

export const DEG = Math.PI / 180;

export function localToWorld(t, lx, ly) {
  const c = Math.cos(t.rot * DEG), s = Math.sin(t.rot * DEG);
  const x = lx * t.sx, y = ly * t.sy;
  return { x: t.x + x * c - y * s, y: t.y + x * s + y * c };
}
export function worldToLocal(t, wx, wy) {
  const c = Math.cos(t.rot * DEG), s = Math.sin(t.rot * DEG);
  const dx = wx - t.x, dy = wy - t.y;
  return { x: (dx * c + dy * s) / t.sx, y: (-dx * s + dy * c) / t.sy };
}
export function boxPoint(b, lx, ly) {
  const c = Math.cos(b.rot * DEG), s = Math.sin(b.rot * DEG);
  return { x: b.x + lx * c - ly * s, y: b.y + lx * s + ly * c };
}
export function boxCorners(b) {
  const hw = b.w / 2, hh = b.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => boxPoint(b, x, y));
}
export function boxContains(b, wx, wy) {
  const c = Math.cos(b.rot * DEG), s = Math.sin(b.rot * DEG);
  const dx = wx - b.x, dy = wy - b.y;
  const x = dx * c + dy * s, y = -dx * s + dy * c;
  return Math.abs(x) <= b.w / 2 && Math.abs(y) <= b.h / 2;
}
export function boxAABB(b) {
  const cs = boxCorners(b);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of cs) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
}
export function unionAABB(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const a of list) { x0 = Math.min(x0, a.x0); y0 = Math.min(y0, a.y0); x1 = Math.max(x1, a.x1); y1 = Math.max(y1, a.y1); }
  return { x0, y0, x1, y1 };
}

// Resample a local raster (pixel scale ps: local-raster pixels per local unit, covering the
// natural box nat centred at the node origin) into document space at render scale `scale`,
// clipped to clipW x clipH document pixels and padded by `pad` render pixels (for blur).
// Height is sampled coverage-weighted so soft edges keep their height.
export function resampleToDoc(local, ps, t, nat, scale, clipW, clipH, pad = 0) {
  const box = { x: t.x, y: t.y, w: nat.w * t.sx, h: nat.h * t.sy, rot: t.rot };
  const aabb = boxAABB(box);
  let bx0 = Math.floor(aabb.x0 * scale - pad), by0 = Math.floor(aabb.y0 * scale - pad);
  let bx1 = Math.ceil(aabb.x1 * scale + pad), by1 = Math.ceil(aabb.y1 * scale + pad);
  if (clipW != null) { bx0 = Math.max(0, bx0); by0 = Math.max(0, by0); bx1 = Math.min(clipW, bx1); by1 = Math.min(clipH, by1); }
  if (bx1 <= bx0 || by1 <= by0) return null;
  const out = createRaster(bx1 - bx0, by1 - by0, bx0, by0);
  const lw = local.w, lh = local.h, lcov = local.coverage;
  const pm = local._premul || (local._premul = premultiply(local));
  const oh = out.height, oc = out.coverage, ow = out.w;
  const kx = lw / nat.w, ky = lh / nat.h;
  // Fast path: axis-aligned and the local raster already has the target pixel scale -> whole-pixel copy
  const unit = t.rot === 0 && Math.abs(kx * t.sx - scale) < 1e-9 && Math.abs(ky * t.sy - scale) < 1e-9;
  const ox = (t.x - nat.w * t.sx / 2) * scale, oy = (t.y - nat.h * t.sy / 2) * scale; // local pixel (0,0) lands here
  if (unit && Math.abs(ox - Math.round(ox)) < 1e-6 && Math.abs(oy - Math.round(oy)) < 1e-6) {
    const sx0 = Math.round(ox) - bx0, sy0 = Math.round(oy) - by0; // where local (0,0) sits inside out
    const lhgt = local.height;
    for (let ly = 0; ly < lh; ly++) { const y = ly + sy0; if (y < 0 || y >= out.h) continue; const xs = Math.max(0, -sx0), xe = Math.min(lw, ow - sx0); if (xe <= xs) continue; oh.set(lhgt.subarray(ly * lw + xs, ly * lw + xe), y * ow + sx0 + xs); oc.set(lcov.subarray(ly * lw + xs, ly * lw + xe), y * ow + sx0 + xs); }
    return out;
  }
  // General path: inverse-map each output pixel; the mapping is affine so step per pixel
  const c = Math.cos(t.rot * DEG), s = Math.sin(t.rot * DEG);
  const isx = 1 / t.sx, isy = 1 / t.sy;
  const ax = c * isx * kx / scale, ay = -s * isy * ky / scale;   // d(fx)/dx, d(fy)/dx per output pixel
  const bxs = s * isx * kx / scale, bys = c * isy * ky / scale;  // d(fx)/dy, d(fy)/dy
  for (let y = 0; y < out.h; y++) {
    const dy = (y + by0 + 0.5) / scale - t.y, dx0 = (bx0 + 0.5) / scale - t.x;
    let fx = ((dx0 * c + dy * s) * isx + nat.w / 2) * kx - 0.5, fy = ((-dx0 * s + dy * c) * isy + nat.h / 2) * ky - 0.5;
    const row = y * ow;
    for (let x = 0; x < ow; x++, fx += ax, fy += ay) {
      if (fx < -1 || fy < -1 || fx > lw || fy > lh) continue;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const in00 = x0 >= 0 && y0 >= 0 && x0 < lw && y0 < lh, in10 = x0 + 1 >= 0 && y0 >= 0 && x0 + 1 < lw && y0 < lh, in01 = x0 >= 0 && y0 + 1 >= 0 && x0 < lw && y0 + 1 < lh, in11 = x0 + 1 >= 0 && y0 + 1 >= 0 && x0 + 1 < lw && y0 + 1 < lh;
      const i00 = y0 * lw + x0;
      const c00 = in00 ? lcov[i00] : 0, c10 = in10 ? lcov[i00 + 1] : 0, c01 = in01 ? lcov[i00 + lw] : 0, c11 = in11 ? lcov[i00 + lw + 1] : 0;
      const cov = (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty;
      if (cov <= 0) continue;
      const p00 = in00 ? pm[i00] : 0, p10 = in10 ? pm[i00 + 1] : 0, p01 = in01 ? pm[i00 + lw] : 0, p11 = in11 ? pm[i00 + lw + 1] : 0;
      const hp = (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
      oc[row + x] = cov; oh[row + x] = hp / cov;
    }
  }
  return out;
}

function premultiply(r) {
  const out = new Float32Array(r.w * r.h);
  for (let i = 0; i < out.length; i++) out[i] = r.height[i] * r.coverage[i];
  return out;
}

// Bilinear sample; outside the array counts as 0.
export function bilinear(a, w, h, fx, fy) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const v00 = at(a, w, h, x0, y0), v10 = at(a, w, h, x0 + 1, y0), v01 = at(a, w, h, x0, y0 + 1), v11 = at(a, w, h, x0 + 1, y0 + 1);
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}
function at(a, w, h, x, y) { return (x < 0 || y < 0 || x >= w || y >= h) ? 0 : a[y * w + x]; }
