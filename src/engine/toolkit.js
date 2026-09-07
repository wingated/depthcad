// Helper library available to extension tools as `lib`. Written as one self-contained
// function so it can be stringified into the tool Worker and also used on the main thread.
//
// A tool's render body runs as  (p, r, lib) => { ... }  where
//   p    the tool's parameters (from its schema)
//   r    { w, h, height: Float32Array, coverage: Float32Array, scale, nat }
//        w x h pixels covering the natural box nat = {w, h} in local units, centred at (0,0);
//        scale = pixels per local unit
//   lib  this library
export function makeLib(r) {
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const hypot = Math.hypot;
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const noise2 = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1); return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy; };
  const sdf = {
    circle: (u, v, rad) => rad - hypot(u, v),
    ellipse: (u, v, a, b) => { if (a <= 0 || b <= 0) return -1e9; const rr = Math.sqrt(u * u / (a * a) + v * v / (b * b)); if (rr < 1e-6) return Math.min(a, b); const g = Math.sqrt(u * u / (a * a * a * a) + v * v / (b * b * b * b)) / rr; return (1 - rr) / g; },
    box: (u, v, hw, hh, rc = 0) => { rc = Math.min(rc, hw, hh); const qx = Math.abs(u) - (hw - rc), qy = Math.abs(v) - (hh - rc); return -(hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc); },
    ring: (u, v, rOut, rIn) => { const d = hypot(u, v); return Math.min(rOut - d, d - rIn); },
    segment: (u, v, ax, ay, bx, by, rad = 0) => { const px = u - ax, py = v - ay, dx = bx - ax, dy = by - ay; const t = clamp01((px * dx + py * dy) / ((dx * dx + dy * dy) || 1e-12)); return rad - hypot(px - dx * t, py - dy * t); },
    polygon: (u, v, pts) => { // pts: [[x,y],...] closed; positive inside
      let d = Infinity, inside = false; const n = pts.length;
      for (let i = 0, j = n - 1; i < n; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; const ex = xj - xi, ey = yj - yi; const t = clamp01(((u - xi) * ex + (v - yi) * ey) / ((ex * ex + ey * ey) || 1e-12)); d = Math.min(d, hypot(u - xi - ex * t, v - yi - ey * t)); if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) inside = !inside; }
      return inside ? d : -d;
    },
    star: (u, v, R, rIn, n = 5, rot = 0) => { const pts = []; for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n - Math.PI / 2; const rr = i % 2 ? rIn : R; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); } return sdf.polygon(u, v, pts); },
    union: (a, b) => Math.max(a, b), intersect: (a, b) => Math.min(a, b), subtract: (a, b) => Math.min(a, -b),
    rotate: (u, v, deg) => { const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180); return [u * c + v * s, -u * s + v * c]; },
  };
  const profile = (kind, d, dmax, bevel = 1) => {
    if (kind === 'linear') return clamp01(d / dmax);
    if (kind === 'dome') { const k = clamp01(d / dmax); return Math.sqrt(1 - (1 - k) * (1 - k)); }
    if (kind === 'scallop') { const k = clamp01(d / dmax); return 1 - Math.sqrt(1 - k * k); }
    if (kind === 'cosine') { const k = clamp01(d / dmax); return 0.5 - 0.5 * Math.cos(Math.PI * k); }
    if (kind === 'bevel') return clamp01(d / Math.max(1e-6, bevel));
    return 1;
  };
  const lib = {
    clamp, clamp01, mix: (a, b, t) => a + (b - a) * t, smoothstep: (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); },
    hash, noise2, fbm: (x, y, oct = 4, gain = 0.5) => { let s = 0, a = 1, f = 1, norm = 0; for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); norm += a; a *= gain; f *= 2; } return s / norm; },
    sdf, profile,
    // coverage (0..1) from a signed distance in local units, antialiased over one pixel
    aa: d => clamp01(d * r.scale + 0.5),
    // local coordinates of a pixel centre
    coord: (x, y) => [(x + 0.5) / r.w * r.nat.w - r.nat.w / 2, (y + 0.5) / r.h * r.nat.h - r.nat.h / 2],
    // iterate every pixel: cb(u, v, x, y) returns a height (coverage 1), [height, coverage], or null to skip
    each: cb => { for (let y = 0; y < r.h; y++) { const v = (y + 0.5) / r.h * r.nat.h - r.nat.h / 2; for (let x = 0; x < r.w; x++) { const u = (x + 0.5) / r.w * r.nat.w - r.nat.w / 2; const o = cb(u, v, x, y); if (o == null) continue; let h, c; if (typeof o === 'number') { h = o; c = 1; } else { h = o[0]; c = o[1]; } if (!(c > 0)) continue; const i = y * r.w + x; r.height[i] = clamp01(h); r.coverage[i] = clamp01(c); } } },
    // paint a distance field: height from a profile between low/high, coverage antialiased (max-composited with what is there)
    paint: (d, height, coverage = null) => { /* used inside each(): returns [h, c] */ const c = coverage == null ? clamp01(d * r.scale + 0.5) : coverage; return c > 0 ? [height, c] : null; },
    set: (x, y, h, c = 1) => { if (x < 0 || y < 0 || x >= r.w || y >= r.h) return; const i = y * r.w + x; r.height[i] = clamp01(h); r.coverage[i] = clamp01(c); },
    // union-composite a value into a pixel (max height where both covered)
    add: (x, y, h, c = 1) => { if (x < 0 || y < 0 || x >= r.w || y >= r.h || !(c > 0)) return; const i = y * r.w + x; const ac = r.coverage[i]; if (ac <= 0) { r.height[i] = clamp01(h); r.coverage[i] = clamp01(c); return; } const nc = ac + c - ac * c; const m = Math.max(r.height[i], h); r.height[i] = clamp01((ac * c * m + ac * (1 - c) * r.height[i] + c * (1 - ac) * h) / nc); r.coverage[i] = clamp01(nc); },
    // 2D canvas in local units (origin at the centre, y down). Draw with white; then fromCanvas() reads alpha as coverage.
    canvas: () => { if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas is not available'); const c = new OffscreenCanvas(r.w, r.h); const ctx = c.getContext('2d'); ctx.setTransform(r.w / r.nat.w, 0, 0, r.h / r.nat.h, r.w / 2, r.h / 2); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx._canvas = c; return ctx; },
    fromCanvas: (ctx, height = 1) => { const c = ctx._canvas || ctx.canvas; const d = ctx.getImageData(0, 0, c.width, c.height).data; for (let i = 0, k = 3; i < r.w * r.h; i++, k += 4) { const a = d[k] / 255; if (a > 0) lib.add(i % r.w, (i / r.w) | 0, height, a); } },
  };
  return lib;
}

// Source of makeLib for embedding into a Worker.
export const LIB_SOURCE = makeLib.toString();
