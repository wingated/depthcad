// Quantization of normalized float height to 8- or 16-bit integers.

export function toU16(h) {
  const out = new Uint16Array(h.length);
  for (let i = 0; i < h.length; i++) { const v = h[i]; out[i] = v <= 0 ? 0 : v >= 1 ? 65535 : Math.round(v * 65535); }
  return out;
}

// mode: 'none' | 'fs' (Floyd-Steinberg error diffusion) | 'ordered' (Bayer 8x8)
export function toU8(h, w, hgt, mode = 'fs') {
  const out = new Uint8Array(h.length);
  if (mode === 'fs') {
    const err = new Float32Array(h.length);
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = clamp(h[i] * 255 + err[i], 0, 255);
        const q = Math.round(v); out[i] = q;
        const e = v - q; if (e === 0) continue;
        if (x + 1 < w) err[i + 1] += e * 7 / 16;
        if (y + 1 < hgt) {
          if (x > 0) err[i + w - 1] += e * 3 / 16;
          err[i + w] += e * 5 / 16;
          if (x + 1 < w) err[i + w + 1] += e * 1 / 16;
        }
      }
    }
  } else if (mode === 'ordered') {
    const B = BAYER8;
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = h[i] * 255, f = Math.floor(v), frac = v - f;
      const t = (B[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
      out[i] = clamp(frac > t ? f + 1 : f, 0, 255);
    }
  } else {
    for (let i = 0; i < h.length; i++) out[i] = clamp(Math.round(h[i] * 255), 0, 255);
  }
  return out;
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const BAYER8 = new Uint8Array([
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
]);
