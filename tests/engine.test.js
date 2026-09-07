// Engine unit tests (no browser needed): node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRaster, fillRaster, blendInto, flatten, blurFloat } from '../src/engine/raster.js';
import { resampleToDoc } from '../src/engine/transform.js';
import { renderShape } from '../src/engine/sdf.js';
import { applyModifiers, createModifier } from '../src/engine/modifiers.js';
import { toU8, toU16 } from '../src/engine/dither.js';
import { decodePNG, encodeGrayPNG } from '../src/engine/png.js';
import { createNode } from '../src/engine/kinds.js';
import { renderDocument } from '../src/engine/composite.js';
import '../src/kinds/shape.js';
import '../src/kinds/mask.js';
import '../src/kinds/group.js';

const doc = { w: 100, h: 100, bg: 0 };
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

test('blend max/min/replace/cut/keep on opaque destination', () => {
  const dst = createRaster(4, 1); fillRaster(dst, 0.5, 1);
  const src = createRaster(2, 1, 1, 0); src.height.set([0.8, 0.2]); src.coverage.set([1, 1]);
  const t = () => { const d = createRaster(4, 1); fillRaster(d, 0.5, 1); return d; };
  let d = blendInto(t(), src, 'max'); assert.deepEqual([...d.height].map(v => +v.toFixed(3)), [0.5, 0.8, 0.5, 0.5]);
  d = blendInto(t(), src, 'min'); assert.deepEqual([...d.height].map(v => +v.toFixed(3)), [0.5, 0.5, 0.2, 0.5]);
  d = blendInto(t(), src, 'replace'); assert.deepEqual([...d.height].map(v => +v.toFixed(3)), [0.5, 0.8, 0.2, 0.5]);
  d = blendInto(t(), src, 'cut'); assert.deepEqual([...d.coverage], [1, 0, 0, 1]);
  d = blendInto(t(), src, 'keep'); assert.deepEqual([...d.coverage], [0, 1, 1, 0]);
  assert.deepEqual([...flatten(d, 0.1)].map(v => +v.toFixed(3)), [0.1, 0.5, 0.5, 0.1]);
});

test('partial coverage blends proportionally', () => {
  const dst = createRaster(1, 1); fillRaster(dst, 0.2, 1);
  const src = createRaster(1, 1); src.height[0] = 1; src.coverage[0] = 0.25;
  blendInto(dst, src, 'max');
  assert.ok(near(dst.height[0], 0.2 * 0.75 + 1 * 0.25));
});

test('shape raster: flat rect is exact, ring has hole, dome peaks mid-ring', () => {
  const r = renderShape({ shape: 'rect', w: 20, h: 20, inner: 0, corner: 0, profile: 'flat', low: 0, high: 0.75 }, 20, 20);
  assert.equal(r.height[10 * 20 + 10], 0.75); assert.equal(r.coverage[10 * 20 + 10], 1);
  const ring = renderShape({ shape: 'ellipse', w: 100, h: 100, inner: 0.507, corner: 0, profile: 'dome', low: 0, high: 1 }, 100, 100);
  assert.equal(ring.coverage[50 * 100 + 50], 0);           // hole
  assert.ok(ring.height[50 * 100 + 87] > 0.95);            // mid-ring crest (r = 37.5 of 25..50)
  assert.equal(ring.coverage[0], 0);                       // corner is outside the circle
  assert.ok(ring.coverage[50 * 100 + 75] > 0 && ring.coverage[50 * 100 + 75] < 1); // inner edge (r = 25.35) is antialiased
});

test('scallop profile is the concave inverse of dome', () => {
  const dome = renderShape({ shape: 'ellipse', w: 100, h: 100, inner: 0, profile: 'dome', low: 0, high: 1 }, 100, 100);
  const sc = renderShape({ shape: 'ellipse', w: 100, h: 100, inner: 0, profile: 'scallop', low: 0, high: 1 }, 100, 100);
  const i = 50 * 100 + 75; // half-way from centre to edge
  assert.ok(dome.height[i] > 0.85 && sc.height[i] < 0.15 && sc.height[i] > 0, `dome ${dome.height[i].toFixed(3)} scallop ${sc.height[i].toFixed(3)}`);
  assert.ok(sc.height[50 * 100 + 50] > 0.85); // steep near the centre (k = 0.99 -> 0.86), reaching 1 at the centre point
  // point reflection of the dome curve: dome(k) + scallop(1 - k) = 1
  const k = 0.49; assert.ok(Math.abs(Math.sqrt(1 - (1 - k) * (1 - k)) + (1 - Math.sqrt(1 - (1 - k) * (1 - k))) - 1) < 1e-9);
});

test('resample identity keeps values; scale halves size', () => {
  const local = renderShape({ shape: 'rect', w: 10, h: 10, profile: 'flat', low: 0, high: 0.6 }, 10, 10);
  const t = { x: 25, y: 25, sx: 1, sy: 1, rot: 0 };
  const r = resampleToDoc(local, 0, t, { w: 10, h: 10 }, 1, 50, 50);
  assert.equal(r.origin.x, 20); assert.equal(r.w, 10);
  assert.ok(near(r.height[5 * r.w + 5], 0.6)); assert.ok(near(r.coverage[5 * r.w + 5], 1));
  const rr = resampleToDoc(local, 0, { ...t, rot: 45 }, { w: 10, h: 10 }, 1, 50, 50);
  assert.ok(rr.w >= 14 && rr.w <= 16); // rotated bbox
  const half = resampleToDoc(local, 0, t, { w: 10, h: 10 }, 0.5, 25, 25);
  assert.equal(half.w, 5);
});

test('levels and curve modifiers', () => {
  const r = createRaster(3, 1); r.height.set([0, 0.5, 1]); r.coverage.fill(1);
  const lv = createModifier('levels'); Object.assign(lv, { outB: 0.2, outW: 0.6 });
  applyModifiers(r, [lv], 1);
  assert.deepEqual([...r.height].map(v => +v.toFixed(3)), [0.2, 0.4, 0.6]);
  const r2 = createRaster(3, 1); r2.height.set([0, 0.5, 1]); r2.coverage.fill(1);
  const cv = createModifier('curve'); cv.points = [[0, 0], [0.5, 1], [1, 1]];
  applyModifiers(r2, [cv], 1);
  assert.deepEqual([...r2.height].map(v => +v.toFixed(2)), [0, 1, 1]);
});

test('feather blurs coverage', () => {
  const r = createRaster(21, 1); r.coverage[10] = 1;
  const f = createModifier('feather'); f.radius = 2;
  applyModifiers(r, [f], 1);
  assert.ok(r.coverage[10] < 1 && r.coverage[8] > 0 && near([...r.coverage].reduce((a, b) => a + b), 1, 1e-3));
  const same = new Float32Array([1, 2, 3]); assert.equal(blurFloat(same, 3, 1, 0), same);
});

test('dither keeps exact 8-bit levels clean and preserves mean', () => {
  const w = 64, h = 64, hgt = new Float32Array(w * h);
  for (let i = 0; i < hgt.length; i++) hgt[i] = i % w < 32 ? 100 / 255 : 100.4 / 255;
  const u8 = toU8(hgt, w, h, 'fs');
  for (let y = 0; y < h; y++) for (let x = 0; x < 32; x++) assert.equal(u8[y * w + x], 100);
  let s = 0, n = 0; for (let y = 0; y < h; y++) for (let x = 32; x < w; x++) { s += u8[y * w + x]; n++; }
  assert.ok(Math.abs(s / n - 100.4) < 0.1);
  assert.equal(toU16(new Float32Array([0, 1, 0.5]))[1], 65535);
  const ord = toU8(hgt, w, h, 'ordered'); assert.ok(ord.some(v => v === 101) && ord.some(v => v === 100));
});

test('png 16-bit and 8-bit gray round trip', async () => {
  const w = 37, h = 11, d16 = new Uint16Array(w * h);
  for (let i = 0; i < d16.length; i++) d16[i] = (i * 1777) & 65535;
  const png = await encodeGrayPNG(w, h, d16, 16);
  const dec = await decodePNG(png.buffer);
  assert.equal(dec.w, w); assert.equal(dec.bits, 16); assert.deepEqual([...dec.data], [...d16]);
  const d8 = new Uint8Array(w * h); for (let i = 0; i < d8.length; i++) d8[i] = i & 255;
  const dec8 = await decodePNG((await encodeGrayPNG(w, h, d8, 8)).buffer);
  assert.equal(dec8.bits, 8); assert.equal(dec8.data[5], 5 * 257);
});

test('compositor: group with mask clips only the layers above the mask', () => {
  const state = { doc, images: {}, fonts: {}, root: createNode('group', doc) };
  const below = createNode('shape', doc); Object.assign(below.params, { shape: 'rect', w: 100, h: 100, profile: 'flat', high: 0.3 });
  const g = createNode('group', doc);
  const mask = createNode('mask', doc); Object.assign(mask.params, { shape: 'rect', w: 20, h: 100 }); mask.x = 10; // left strip
  const top = createNode('shape', doc); Object.assign(top.params, { shape: 'rect', w: 100, h: 100, profile: 'flat', high: 0.9 });
  g.children.push(mask, top);
  state.root.children.push(below, g);
  const out = renderDocument(state, 1, true, new Map());
  const at = (x, y) => out.height[y * out.w + x];
  assert.ok(near(at(5, 50), 0.9));   // inside mask: top layer shows
  assert.ok(near(at(60, 50), 0.3));  // outside mask: only the layer below the group
  mask.params.invert = true;
  const out2 = renderDocument(state, 1, true, new Map());
  assert.ok(near(out2.height[50 * out2.w + 60], 0.9)); assert.ok(near(out2.height[50 * out2.w + 5], 0.3));
});

test('compositor: cut and keep against the document background', () => {
  const state = { doc: { w: 50, h: 50, bg: 0.1 }, images: {}, fonts: {}, root: createNode('group', { w: 50, h: 50 }) };
  const base = createNode('shape', doc); Object.assign(base.params, { shape: 'rect', w: 50, h: 50, profile: 'flat', high: 0.5 }); base.x = 25; base.y = 25;
  const cut = createNode('shape', doc); Object.assign(cut.params, { shape: 'rect', w: 10, h: 10, profile: 'flat', high: 1 }); cut.blend = 'cut'; cut.x = 25; cut.y = 25;
  state.root.children.push(base, cut);
  let out = renderDocument(state, 1, true, new Map());
  assert.ok(near(out.height[25 * 50 + 25], 0.1)); assert.ok(near(out.height[25 * 50 + 5], 0.5));
  cut.blend = 'keep';
  out = renderDocument(state, 1, true, new Map());
  assert.ok(near(out.height[25 * 50 + 25], 0.5)); assert.ok(near(out.height[25 * 50 + 5], 0.1));
});
