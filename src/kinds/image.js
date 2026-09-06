import { registerKind } from '../engine/kinds.js';
import { createRaster, downsampleBox } from '../engine/raster.js';

// Image assets: { id, dataURL, w, h, bits, full: Uint16Array, small: {w, h, data: Float32Array} }
export const PREVIEW_MAX = 1024;

export function makeImageAsset(dataURL, w, h, bits, u16) {
  const f = Math.max(1, Math.ceil(Math.max(w, h) / PREVIEW_MAX));
  const f32 = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) f32[i] = u16[i] / 65535;
  const small = downsampleBox(f32, w, h, f);
  return { dataURL, w, h, bits, full: u16, small, _fullF32: f === 1 ? f32 : null };
}

registerKind({
  kind: 'image', label: 'Image', icon: '▦',
  schema: {
    zeroAlpha: { type: 'bool', label: 'Source value 0 is transparent', default: true },
  },
  hint: 'Use a Levels or Curve modifier to remap the value range. With value 0 transparent, the black background of a scan never covers layers below.',
  measure(n, ctx) { const im = ctx.assets.images[n.params.imageId]; return im ? { w: im.w, h: im.h } : { w: 256, h: 256 }; },
  cacheKey(n) { return n.params.imageId + '|' + (n.params.zeroAlpha ? 1 : 0); },
  render(n, { full, ctx }) {
    const im = ctx.assets.images[n.params.imageId]; if (!im) return null;
    let src, w, h;
    if (full) {
      if (!im._fullF32) { im._fullF32 = new Float32Array(im.full.length); for (let i = 0; i < im.full.length; i++) im._fullF32[i] = im.full[i] / 65535; }
      src = im._fullF32; w = im.w; h = im.h;
    } else { src = im.small.data; w = im.small.w; h = im.small.h; }
    const r = createRaster(w, h);
    r.height.set(src);
    if (n.params.zeroAlpha) { for (let i = 0; i < src.length; i++) r.coverage[i] = src[i] > 0 ? 1 : 0; }
    else r.coverage.fill(1);
    return r;
  },
});
