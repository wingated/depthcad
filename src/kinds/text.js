import { registerKind } from '../engine/kinds.js';
import { createRaster } from '../engine/raster.js';

// Text is laid out by a pluggable layout (params.layout.kind). A layout provides
//   measure(p, ctx2d) -> metrics {w, h, ...}   natural box in local px, centred at 0,0
//   draw(p, ctx2d, metrics)                    paints the text into a ctx whose origin is the box centre
// Text on a path will be another entry drawing glyph by glyph.
export const TEXT_LAYOUTS = {};
export const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
export let fontsVersion = 0;
export function bumpFontsVersion() { fontsVersion++; }

export function fontString(p) {
  const fam = GENERIC_FONTS.has(p.family) ? p.family : `"${String(p.family).replace(/"/g, '')}", sans-serif`;
  return `${p.italic ? 'italic ' : ''}${p.weight} ${p.size}px ${fam}`;
}
function applyFont(ctx, p) { ctx.font = fontString(p); try { ctx.letterSpacing = (p.spacing || 0) + 'px'; } catch (e) { } }

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c;
}
let measureCtx = null;
function getMeasureCtx() { if (!measureCtx) measureCtx = makeCanvas(1, 1).getContext('2d'); return measureCtx; }

TEXT_LAYOUTS.linear = {
  label: 'Linear',
  // Lines are measured and aligned on their ink bounds (actualBoundingBox), not on the advance
  // width: the advance includes side bearings and, with letter spacing, a trailing space after the
  // last glyph, which would leave the visible text off-centre inside its box.
  measure(p, ctx) {
    applyFont(ctx, p); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const lines = String(p.text).split('\n');
    let asc = 0, desc = 0, w = 0; const ink = [];
    for (const t of lines) {
      const m = ctx.measureText(t.length ? t : ' ');
      asc = Math.max(asc, m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || p.size * 0.9);
      desc = Math.max(desc, m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || p.size * 0.25);
      const hasInk = typeof m.actualBoundingBoxLeft === 'number' && typeof m.actualBoundingBoxRight === 'number' && t.trim().length;
      const l = hasInk ? m.actualBoundingBoxLeft : 0, r = hasInk ? m.actualBoundingBoxRight : m.width;
      ink.push({ l, w: Math.max(0, l + r) }); w = Math.max(w, l + r);
    }
    const pad = Math.max(2, p.size * 0.04), lh = p.size * p.lineHeight;
    return { w: Math.max(1, w + pad * 2), h: Math.max(1, lh * (lines.length - 1) + asc + desc + pad * 2), lines, ink, asc, desc, lh, pad };
  },
  draw(p, ctx, m) {
    applyFont(ctx, p); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    let y = -m.h / 2 + m.pad + m.asc;
    m.lines.forEach((line, i) => {
      const k = m.ink[i]; // draw so the ink (not the advance) sits where the alignment says
      const x = p.align === 'left' ? -m.w / 2 + m.pad + k.l : p.align === 'right' ? m.w / 2 - m.pad - k.w + k.l : -k.w / 2 + k.l;
      ctx.fillText(line, x, y); y += m.lh;
    });
  },
};

function metricsKey(p) { return [p.text, p.family, p.weight, p.italic, p.size, p.lineHeight, p.spacing, p.align, JSON.stringify(p.layout), fontsVersion].join(''); }
function textMetrics(n) {
  const key = metricsKey(n.params);
  if (n._tm && n._tm.key === key) return n._tm.m;
  const lay = TEXT_LAYOUTS[n.params.layout?.kind] || TEXT_LAYOUTS.linear;
  const m = lay.measure(n.params, getMeasureCtx());
  n._tm = { key, m }; return m;
}

registerKind({
  kind: 'text', label: 'Text', icon: 'T',
  schema: {
    text: { type: 'text', label: 'Text', default: 'Text' },
    family: { type: 'font', label: 'Family', default: 'Helvetica' },
    weight: { type: 'enum', label: 'Weight', default: '700', options: { 100: '100 Thin', 200: '200 Extra light', 300: '300 Light', 400: '400 Regular', 500: '500 Medium', 600: '600 Semibold', 700: '700 Bold', 800: '800 Extra bold', 900: '900 Black' } },
    italic: { type: 'bool', label: 'Italic', default: false },
    size: { type: 'number', label: 'Size (px)', default: 120, min: 1, max: 20000, step: 1 },
    lineHeight: { type: 'number', label: 'Line height', default: 1.2, min: 0.5, max: 3, step: 0.05, slider: true },
    spacing: { type: 'number', label: 'Letter spacing', default: 0, min: -200, max: 400, step: 1, slider: true },
    align: { type: 'enum', label: 'Align', default: 'center', options: { left: 'Left', center: 'Center', right: 'Right' } },
    value: { type: 'depth', label: 'Value', default: 1 },
    layout: { type: 'layout', label: 'Layout', default: { kind: 'linear' } },
  },
  hint: 'Size is in document pixels; the transform scales on top of it. Any installed font works; loaded font files are embedded in the project.',
  init(n, doc) { n.params.size = Math.round(Math.min(doc.w, doc.h) / 8); },
  measure(n) { const m = textMetrics(n); return { w: m.w, h: m.h }; },
  cacheKey(n) { return metricsKey(n.params) + '|' + n.params.value; },
  render(n, { cw, ch }) {
    const m = textMetrics(n);
    const c = makeCanvas(cw, ch); const ctx = c.getContext('2d');
    ctx.setTransform(cw / m.w, 0, 0, ch / m.h, cw / 2, ch / 2); ctx.fillStyle = '#fff';
    (TEXT_LAYOUTS[n.params.layout?.kind] || TEXT_LAYOUTS.linear).draw(n.params, ctx, m);
    const id = ctx.getImageData(0, 0, cw, ch).data;
    const r = createRaster(cw, ch); const v = n.params.value;
    for (let i = 0, k = 3; i < r.coverage.length; i++, k += 4) { const a = id[k] / 255; if (a > 0) { r.coverage[i] = a; r.height[i] = v; } }
    return r;
  },
});
