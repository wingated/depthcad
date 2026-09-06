import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLib, LIB_SOURCE } from '../src/engine/toolkit.js';
import { createRaster } from '../src/engine/raster.js';
import { BUILTIN_TOOLS } from '../src/tools/builtin.js';
import { validateTool } from '../src/kinds/tool.js';

function raster(w, h, nat) { const r = createRaster(w, h); return { w, h, height: r.height, coverage: r.coverage, scale: w / nat.w, nat }; }

test('lib.each fills a circle with antialiased edge', () => {
  const r = raster(50, 50, { w: 50, h: 50 }); const lib = makeLib(r);
  lib.each((u, v) => { const d = lib.sdf.circle(u, v, 20.25); const c = lib.aa(d); return c > 0 ? [lib.profile('dome', d, 20.25), c] : null; });
  assert.ok(r.height[25 * 50 + 25] > 0.99); assert.equal(r.coverage[0], 0);
  assert.ok(r.coverage[25 * 50 + 45] > 0 && r.coverage[25 * 50 + 45] < 1);
});
test('sdf primitives', () => {
  const lib = makeLib(raster(1, 1, { w: 1, h: 1 })).sdf;
  assert.ok(lib.box(0, 0, 10, 5) === 5 && lib.box(11, 0, 10, 5) < 0);
  assert.ok(lib.star(0, 0, 10, 4, 5) > 0 && lib.star(0, -12, 10, 4, 5) < 0);
  assert.ok(lib.polygon(0.5, 0.5, [[0, 0], [1, 0], [1, 1], [0, 1]]) > 0 && lib.polygon(2, 2, [[0, 0], [1, 0], [1, 1], [0, 1]]) < 0);
  assert.ok(Math.abs(lib.ring(7, 0, 10, 5) - 2) < 1e-9);
});
test('lib source can be re-evaluated (worker embedding) and noise is deterministic', () => {
  const fn = new Function('return ' + LIB_SOURCE)(); const lib = fn(raster(4, 4, { w: 4, h: 4 }));
  assert.equal(lib.noise2(1.5, 2.5), makeLib(raster(4, 4, { w: 4, h: 4 })).noise2(1.5, 2.5));
  assert.ok(lib.fbm(0.3, 0.7) >= 0 && lib.fbm(0.3, 0.7) <= 1);
});
test('built-in tools validate', () => { for (const t of BUILTIN_TOOLS) assert.deepEqual(validateTool(t), [], t.id); });
test('validation catches bad tools', () => {
  const errs = validateTool({ format: 'x', id: 'bad id', schema: { a: { type: 'weird' } }, render: 'return (', measure: '' });
  assert.ok(errs.length >= 4);
});
