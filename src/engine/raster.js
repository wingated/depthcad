// Raster: the unit of depth data. Height is normalized (0 = farthest, 1 = nearest);
// coverage is 0..1 (antialiased edges are fractional). Rasters sit in a coordinate
// space at an integer origin so they can cover only their bounding box.

export function createRaster(w, h, ox = 0, oy = 0) {
  w = Math.max(0, w | 0); h = Math.max(0, h | 0);
  return { w, h, origin: { x: ox | 0, y: oy | 0 }, height: new Float32Array(w * h), coverage: new Float32Array(w * h) };
}

export function fillRaster(r, height, coverage) {
  r.height.fill(height); r.coverage.fill(coverage); return r;
}

export function cloneRaster(r) {
  return { w: r.w, h: r.h, origin: { x: r.origin.x, y: r.origin.y }, height: r.height.slice(), coverage: r.coverage.slice() };
}

// Blend src into dst in place. Both are in the same coordinate space (origins honoured).
// Coverage composes like Porter-Duff "over"; height inside the overlap follows the mode:
//   max     union of solids (default)        min  clamp: lowers what is under it
//   replace stamps the source height         cut  removes coverage under the source
//   keep    keeps only what is under the source (everything else becomes uncovered)
export function blendInto(dst, src, mode = 'max') {
  const dh = dst.height, dc = dst.coverage, sh = src.height, sc = src.coverage;
  if (mode === 'keep') {
    for (let y = 0; y < dst.h; y++) {
      const sy = y + dst.origin.y - src.origin.y;
      const rowIn = sy >= 0 && sy < src.h;
      for (let x = 0; x < dst.w; x++) {
        const di = y * dst.w + x;
        if (!rowIn) { dc[di] = 0; continue; }
        const sx = x + dst.origin.x - src.origin.x;
        dc[di] *= (sx >= 0 && sx < src.w) ? sc[sy * src.w + sx] : 0;
      }
    }
    return dst;
  }
  const x0 = Math.max(dst.origin.x, src.origin.x), y0 = Math.max(dst.origin.y, src.origin.y);
  const x1 = Math.min(dst.origin.x + dst.w, src.origin.x + src.w), y1 = Math.min(dst.origin.y + dst.h, src.origin.y + src.h);
  if (x1 <= x0 || y1 <= y0) return dst;
  const isMax = mode === 'max', isMin = mode === 'min', isCut = mode === 'cut';
  for (let y = y0; y < y1; y++) {
    let di = (y - dst.origin.y) * dst.w + (x0 - dst.origin.x);
    let si = (y - src.origin.y) * src.w + (x0 - src.origin.x);
    for (let x = x0; x < x1; x++, di++, si++) {
      const rc = sc[si]; if (rc <= 0) continue;
      const ac = dc[di];
      if (isCut) { dc[di] = ac * (1 - rc); continue; }
      const ah = dh[di], rh = sh[si];
      const m = isMax ? (ah > rh ? ah : rh) : isMin ? (ah < rh ? ah : rh) : rh;
      const nc = ac + rc - ac * rc;
      dh[di] = nc > 0 ? (ac * rc * m + ac * (1 - rc) * ah + rc * (1 - ac) * rh) / nc : 0;
      dc[di] = nc;
    }
  }
  return dst;
}

// Multiply a raster's coverage by a full-size coverage array (same space, origin 0,0).
export function applyCoverageMask(r, maskCov, maskW, maskH) {
  const c = r.coverage;
  for (let y = 0; y < r.h; y++) {
    const my = y + r.origin.y;
    for (let x = 0; x < r.w; x++) {
      const mx = x + r.origin.x;
      const i = y * r.w + x;
      c[i] *= (mx >= 0 && my >= 0 && mx < maskW && my < maskH) ? maskCov[my * maskW + mx] : 0;
    }
  }
  return r;
}

// Flatten coverage against a background height: returns Float32Array of height.
export function flatten(r, bg) {
  const out = new Float32Array(r.w * r.h);
  const h = r.height, c = r.coverage;
  for (let i = 0; i < out.length; i++) { const cv = c[i]; out[i] = cv >= 1 ? h[i] : h[i] * cv + bg * (1 - cv); }
  return out;
}

// Separable box blur run three times (close to Gaussian). radius in pixels (sigma-ish).
export function blurFloat(src, w, h, radius) {
  if (radius < 0.3 || w === 0 || h === 0) return src;
  // three box passes whose combined variance matches a gaussian of the given sigma
  const boxes = boxesForGauss(radius, 3);
  let a = src.slice(), b = new Float32Array(src.length);
  for (const r of boxes) { boxBlurH(a, b, w, h, r); boxBlurV(b, a, w, h, r); }
  return a;
}
function boxesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const out = []; for (let i = 0; i < n; i++) out.push(((i < m ? wl : wu) - 1) / 2);
  return out;
}
function boxBlurH(src, dst, w, h, r) {
  if (r < 1) { dst.set(src); return; }
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w; let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + clampI(x, w)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * iarr;
      sum += src[row + clampI(x + r + 1, w)] - src[row + clampI(x - r, w)];
    }
  }
}
function boxBlurV(src, dst, w, h, r) {
  if (r < 1) { dst.set(src); return; }
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += src[clampI(y, h) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * iarr;
      sum += src[clampI(y + r + 1, h) * w + x] - src[clampI(y - r, h) * w + x];
    }
  }
}
function clampI(i, n) { return i < 0 ? 0 : i >= n ? n - 1 : i; }

// Downsample a float array by an integer factor with box filtering (for previews).
export function downsampleBox(src, w, h, f) {
  if (f <= 1) return { w, h, data: src };
  const nw = Math.max(1, Math.floor(w / f)), nh = Math.max(1, Math.floor(h / f));
  const out = new Float32Array(nw * nh); const inv = 1 / (f * f);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let s = 0; const y0 = y * f, x0 = x * f;
    for (let j = 0; j < f; j++) { const row = (y0 + j) * w + x0; for (let i = 0; i < f; i++) s += src[row + i]; }
    out[y * nw + x] = s * inv;
  }
  return { w: nw, h: nh, data: out };
}
