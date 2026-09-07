// Edge profiles: a function from position across a profile band to height factor.
//
// A profile document describes a curve on a 0..1 workspace: x = 0 is the inside end of the
// band (normally full height, y = 1), x = 1 is the edge (normally y = 0). It is a chain of
// points joined by segments of kind line | dome | cove | smooth | step | bezier. The engine
// compiles it into a lookup table; shapes evaluate it with x = 1 - dist / width.
import { clamp01 } from './util.js';

export const PROFILE_FORMAT = 'depthcad-profile/1';
export const SEGMENT_KINDS = { line: 'Line', dome: 'Dome (convex)', cove: 'Cove (concave)', smooth: 'Smooth (S-curve)', step: 'Step', bezier: 'Bezier' };

const two = (kind) => ({ points: [{ x: 0, y: 1 }, { x: 1, y: 0 }], segments: [{ kind }] });
export const BUILTIN_PROFILES = {
  flat: { format: PROFILE_FORMAT, id: 'flat', name: 'Flat', builtin: true, ...two('step') },
  linear: { format: PROFILE_FORMAT, id: 'linear', name: 'Linear (bevel)', builtin: true, ...two('line') },
  dome: { format: PROFILE_FORMAT, id: 'dome', name: 'Dome (round)', builtin: true, ...two('dome') },
  scallop: { format: PROFILE_FORMAT, id: 'scallop', name: 'Scallop (cove)', builtin: true, ...two('cove') },
  cosine: { format: PROFILE_FORMAT, id: 'cosine', name: 'Smooth (cosine)', builtin: true, ...two('smooth') },
  ogee: { format: PROFILE_FORMAT, id: 'ogee', name: 'Ogee', builtin: true, example: true, points: [{ x: 0, y: 1 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }], segments: [{ kind: 'dome' }, { kind: 'cove' }] },
  ledge: { format: PROFILE_FORMAT, id: 'ledge', name: 'Ledge', builtin: true, example: true, points: [{ x: 0, y: 1 }, { x: 0.45, y: 1 }, { x: 0.55, y: 0.5 }, { x: 1, y: 0.5 }], segments: [{ kind: 'line' }, { kind: 'dome' }, { kind: 'step' }] },
  fluted: { format: PROFILE_FORMAT, id: 'fluted', name: 'Fluted', builtin: true, example: true, points: [{ x: 0, y: 1 }, { x: 0.33, y: 0.6 }, { x: 0.66, y: 0.3 }, { x: 1, y: 0 }], segments: [{ kind: 'cove' }, { kind: 'cove' }, { kind: 'cove' }] },
  steps: { format: PROFILE_FORMAT, id: 'steps', name: 'Stepped', builtin: true, example: true, points: [{ x: 0, y: 1 }, { x: 0.33, y: 0.66 }, { x: 0.66, y: 0.33 }, { x: 1, y: 0 }], segments: [{ kind: 'step' }, { kind: 'step' }, { kind: 'step' }] },
};

export function newProfile(name = 'My profile', from = null) {
  const src = from || BUILTIN_PROFILES.dome;
  return { format: PROFILE_FORMAT, id: 'p' + Math.random().toString(36).slice(2, 8), name, points: src.points.map(p => ({ ...p })), segments: src.segments.map(s => ({ ...s, ...(s.c1 ? { c1: { ...s.c1 } } : {}), ...(s.c2 ? { c2: { ...s.c2 } } : {}) })) };
}

export function validateProfile(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['Profile must be an object'];
  if (doc.format !== PROFILE_FORMAT) errors.push(`format must be "${PROFILE_FORMAT}"`);
  if (!doc.id) errors.push('id is required'); if (!doc.name) errors.push('name is required');
  if (!Array.isArray(doc.points) || doc.points.length < 2) errors.push('points must have at least 2 entries');
  else { for (const p of doc.points) if (typeof p.x !== 'number' || typeof p.y !== 'number') errors.push('points must be {x, y} numbers'); for (let i = 1; i < doc.points.length; i++) if (doc.points[i].x < doc.points[i - 1].x - 1e-9) errors.push('points must not go backwards in x'); }
  if (!Array.isArray(doc.segments) || (doc.points && doc.segments.length !== doc.points.length - 1)) errors.push('segments must have one entry per pair of points');
  else for (const s of doc.segments) if (!SEGMENT_KINDS[s.kind]) errors.push('unknown segment kind ' + s.kind);
  return errors;
}

// Default bezier handles for a segment (a third of the way along the chord).
export function defaultHandles(p0, p1) { return { c1: { x: p0.x + (p1.x - p0.x) / 3, y: p0.y }, c2: { x: p1.x - (p1.x - p0.x) / 3, y: p1.y } }; }

// Sample one segment as a list of {x, y} from p0 to p1 (inclusive).
export function sampleSegment(kind, p0, p1, seg, n = 48) {
  const s = sampleSegmentRaw(kind, p0, p1, seg, n);
  s[0] = { x: p0.x, y: p0.y }; s[s.length - 1] = { x: p1.x, y: p1.y }; // exact endpoints
  return s;
}
function sampleSegmentRaw(kind, p0, p1, seg, n) {
  const out = []; const dx = p1.x - p0.x, dy = p1.y - p0.y;
  switch (kind) {
    case 'step': return [{ x: p0.x, y: p0.y }, { x: p1.x, y: p0.y }, { x: p1.x, y: p1.y }];
    case 'line': return [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }];
    case 'dome': for (let i = 0; i <= n; i++) { const t = i / n * Math.PI / 2; out.push({ x: p0.x + dx * Math.sin(t), y: p0.y + dy * (1 - Math.cos(t)) }); } return out;
    case 'cove': for (let i = 0; i <= n; i++) { const t = i / n * Math.PI / 2; out.push({ x: p0.x + dx * (1 - Math.cos(t)), y: p0.y + dy * Math.sin(t) }); } return out;
    case 'smooth': for (let i = 0; i <= n; i++) { const t = i / n; out.push({ x: p0.x + dx * t, y: p0.y + dy * (0.5 - 0.5 * Math.cos(Math.PI * t)) }); } return out;
    case 'bezier': {
      const h = seg && seg.c1 && seg.c2 ? seg : defaultHandles(p0, p1); const { c1, c2 } = h;
      for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push({ x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x, y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y }); }
      return out;
    }
    default: return [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }];
  }
}
export function sampleProfile(doc, n = 48) {
  const pts = [];
  for (let i = 0; i < doc.segments.length; i++) { const s = sampleSegment(doc.segments[i].kind, doc.points[i], doc.points[i + 1], doc.segments[i], n); pts.push(...(i ? s.slice(1) : s)); }
  return pts;
}

// Lookup table: N + 1 entries over x in [0, 1]. Each bin holds the curve's value at its own x;
// at a vertical step the bin keeps the value before the step (the next bin starts after it).
export function buildLUT(doc, N = 1024) {
  const s = sampleProfile(doc, 64); const lut = new Float32Array(N + 1);
  lut.fill(clamp01(s[0].y));
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i]; const x0 = clamp01(a.x), x1 = clamp01(b.x);
    const i0 = Math.round(x0 * N), i1 = Math.round(x1 * N);
    if (i1 <= i0) continue;
    for (let k = i0 + 1; k <= i1; k++) { const t = (k / N - x0) / (x1 - x0); lut[k] = clamp01(a.y + (b.y - a.y) * t); }
  }
  return lut;
}
export function lutAt(lut, x) { const N = lut.length - 1; const f = clamp01(x) * N; const i = Math.floor(f); if (i >= N) return lut[N]; const t = f - i; return lut[i] + (lut[i + 1] - lut[i]) * t; }

export function profileKey(doc) { return JSON.stringify([doc.points, doc.segments]); }
// Cached LUT for a document (recomputed when its points/segments change).
export function profileLUT(doc) { const key = profileKey(doc); if (doc._lut && doc._lutKey === key) return doc._lut; doc._lutKey = key; doc._lut = buildLUT(doc); return doc._lut; }
export function resolveProfile(id, store) { return (store && store.profiles && store.profiles[id]) || BUILTIN_PROFILES[id] || BUILTIN_PROFILES.flat; }
