import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_PROFILES, buildLUT, lutAt, validateProfile, newProfile, sampleSegment, profileLUT } from '../src/engine/profile.js';
import { renderShape, profileT, shapeHalfBand } from '../src/engine/sdf.js';
import { createNode, KINDS } from '../src/engine/kinds.js';
import { renderDocument } from '../src/engine/composite.js';
import '../src/kinds/shape.js';
import '../src/kinds/group.js';

const near = (a, b, eps) => Math.abs(a - b) <= eps;

test('built-in profile LUTs match the legacy named profiles', () => {
  for (const [id, legacy] of [['flat', 'flat'], ['linear', 'linear'], ['dome', 'dome'], ['scallop', 'scallop'], ['cosine', 'cosine']]) {
    const lut = buildLUT(BUILTIN_PROFILES[id]);
    // x = 1 is skipped: for 'flat' it is the step's drop
    for (let k = 0; k < 20; k++) { const x = k / 20; const dist = (1 - x) * 100; const expect = profileT(legacy, dist, 100, 1); const got = lutAt(lut, x); assert.ok(near(got, expect, 0.02), `${id} at x=${x}: ${got} vs ${expect}`); }
  }
});
test('segment kinds have the right tangents and endpoints', () => {
  const a = { x: 0, y: 1 }, b = { x: 1, y: 0 };
  for (const k of ['line', 'dome', 'cove', 'smooth', 'bezier', 'step']) { const s = sampleSegment(k, a, b, {}, 32); assert.deepEqual([s[0].x, s[0].y], [0, 1]); assert.deepEqual([s[s.length - 1].x, s[s.length - 1].y], [1, 0]); }
  const dome = sampleSegment('dome', a, b, {}, 32), cove = sampleSegment('cove', a, b, {}, 32);
  assert.ok(dome[16].y > 0.5 && cove[16].y < 0.5); // convex above the chord, concave below
  const step = sampleSegment('step', a, b, {}); assert.deepEqual(step[1], { x: 1, y: 1 });
});
test('validation and new profiles', () => {
  assert.deepEqual(validateProfile(BUILTIN_PROFILES.ogee), []);
  const p = newProfile('x'); assert.deepEqual(validateProfile(p), []);
  assert.ok(validateProfile({ format: 'nope', points: [{ x: 1, y: 0 }, { x: 0, y: 1 }], segments: [] }).length >= 3);
});
test('shape with separate inner and outer profiles', () => {
  const lutDome = profileLUT(BUILTIN_PROFILES.dome), lutFlat = profileLUT(BUILTIN_PROFILES.flat);
  // ring 200 wide, inner 50%: outer band 25px dome, inner edge flat with a 10px band
  const r = renderShape({ shape: 'ellipse', w: 200, h: 200, inner: 0.5, low: 0, high: 1, outer: { lut: lutDome, width: 25 }, innerEdge: { lut: lutFlat, width: 10 } }, 200, 200);
  const at = x => r.height[100 * 200 + x];
  assert.ok(at(100 + 99) < 0.3 && at(100 + 99) > 0);   // near the outer edge: dome falling off
  assert.ok(near(at(100 + 70), 1, 1e-3));                // beyond both bands: full height
  assert.ok(near(at(100 + 51), 1, 1e-3));                // flat inner profile: full height right up to the hole
  assert.equal(r.coverage[100 * 200 + 100], 0);          // hole
  // legacy call still works
  const l = renderShape({ shape: 'ellipse', w: 100, h: 100, inner: 0, profile: 'dome', low: 0, high: 1 }, 100, 100); assert.ok(l.height[50 * 100 + 50] > 0.99);
});
test('old shape params migrate to inner/outer profiles', () => {
  const def = KINDS.shape; const p = { shape: 'ellipse', w: 200, h: 200, inner: 0.5, profile: 'bevel', bevel: 12 };
  def.migrate(p);
  assert.equal(p.outerProfile, 'linear'); assert.equal(p.outerWidth, 12); assert.equal(p.innerWidth, 12); assert.equal(p.profile, undefined);
  const q = { shape: 'ellipse', w: 200, h: 200, inner: 0.5, profile: 'dome' }; def.migrate(q);
  assert.equal(q.outerProfile, 'dome'); assert.equal(q.outerWidth, shapeHalfBand(200, 200, 0.5));
  const untouched = { shape: 'rect', w: 10, h: 10, outerProfile: 'ogee' }; def.migrate(untouched); assert.equal(untouched.outerProfile, 'ogee');
});
test('custom profile resolves through the document store', () => {
  const doc = { w: 100, h: 100, bg: 0 };
  const custom = newProfile('half'); custom.id = 'half'; custom.points = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]; custom.segments = [{ kind: 'line' }];
  const state = { doc, images: {}, fonts: {}, profiles: { half: custom }, root: createNode('group', doc) };
  const n = createNode('shape', doc); Object.assign(n.params, { shape: 'rect', w: 100, h: 100, outerProfile: 'half', outerWidth: 50, high: 1 }); state.root.children.push(n);
  const out = renderDocument(state, 1, true, new Map());
  assert.ok(near(out.height[50 * 100 + 50], 0.5, 1e-3));
});
