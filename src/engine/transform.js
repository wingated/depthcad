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
  const bx0 = Math.max(0, Math.floor(aabb.x0 * scale - pad)), by0 = Math.max(0, Math.floor(aabb.y0 * scale - pad));
  const bx1 = Math.min(clipW, Math.ceil(aabb.x1 * scale + pad)), by1 = Math.min(clipH, Math.ceil(aabb.y1 * scale + pad));
  if (bx1 <= bx0 || by1 <= by0) return null;
  const out = createRaster(bx1 - bx0, by1 - by0, bx0, by0);
  const lw = local.w, lh = local.h, lhgt = local.height, lcov = local.coverage;
  const pm = local._premul || (local._premul = premultiply(local));
  const c = Math.cos(t.rot * DEG), s = Math.sin(t.rot * DEG);
  const isx = 1 / t.sx, isy = 1 / t.sy;
  // local unit -> local raster pixel index
  const kx = lw / nat.w, ky = lh / nat.h;
  const oh = out.height, oc = out.coverage;
  for (let y = 0; y < out.h; y++) {
    const dy = (y + by0 + 0.5) / scale - t.y;
    for (let x = 0; x < out.w; x++) {
      const dx = (x + bx0 + 0.5) / scale - t.x;
      const u = (dx * c + dy * s) * isx, v = (-dx * s + dy * c) * isy;
      const fx = (u + nat.w / 2) * kx - 0.5, fy = (v + nat.h / 2) * ky - 0.5;
      if (fx < -1 || fy < -1 || fx > lw || fy > lh) continue;
      const cov = bilinear(lcov, lw, lh, fx, fy);
      if (cov <= 0) continue;
      const hp = bilinear(pm, lw, lh, fx, fy);
      const i = y * out.w + x;
      oc[i] = cov; oh[i] = hp / cov;
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
