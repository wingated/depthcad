import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSTL, parseOBJ, parseMesh, encodeBinarySTL, eulerToMat, matToEuler, rotatedExtents, meshBounds, mul3, rotX, rotY, apply3 } from '../src/engine/mesh.js';
import { cubeTriangles } from './helpers.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
test('binary STL round trip and bounds', () => {
  const tris = cubeTriangles(2); const buf = encodeBinarySTL(tris);
  const m = parseSTL(buf); assert.equal(m.triangles, 12); assert.deepEqual(m.bounds.min, [-1, -1, -1]); assert.deepEqual(m.bounds.max, [1, 1, 1]);
  const m2 = parseMesh('cube.stl', buf); assert.equal(m2.triangles, 12);
});

test('ASCII STL and OBJ parse', () => {
  const ascii = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n`;
  const a = parseSTL(new TextEncoder().encode(ascii).buffer); assert.equal(a.triangles, 1); assert.equal(a.positions[3], 1);
  const obj = `# quad\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1/1/1 2/2/2 3/3/3 4/4/4\nf -4 -3 -2\n`;
  const o = parseOBJ(obj); assert.equal(o.triangles, 3); assert.equal(o.bounds.max[0], 1);
});

test('euler <-> matrix round trip and 90° snaps', () => {
  for (const e of [[0, 0, 0], [30, -40, 75], [90, 0, 0], [0, -90, 0], [10, 20, 30]]) {
    const m = eulerToMat(e); const back = matToEuler(m); const m2 = eulerToMat(back);
    for (let i = 0; i < 9; i++) assert.ok(near(m[i], m2[i], 1e-5), 'euler ' + e.join());
  }
  // rotating +Y by Rx(90) should point it to +Z
  const v = apply3(rotX(90), [0, 1, 0]); assert.ok(near(v[2], 1, 1e-9));
  const v2 = apply3(rotY(-90), [1, 0, 0]); assert.ok(near(v2[2], 1, 1e-9));
});

test('rotated extents of a box', () => {
  const b = meshBounds(cubeTriangles(2));
  const e = rotatedExtents(b, eulerToMat([0, 0, 0]));
  assert.deepEqual(e.x, [-1, 1]); assert.deepEqual(e.dist, [-1, 1]);
  const e45 = rotatedExtents(b, eulerToMat([0, 45, 0]));
  assert.ok(near(e45.x[1], Math.SQRT2, 1e-6) && near(e45.dist[1], Math.SQRT2, 1e-6));
});
