// Mesh parsing (binary/ASCII STL, OBJ) and small rotation helpers. DOM-free.

export function parseMesh(name, buf) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'obj') return parseOBJ(new TextDecoder().decode(buf));
  if (ext === 'stl') return parseSTL(buf);
  // sniff
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(512, buf.byteLength)));
  if (/^\s*(v |f |#|o |g |mtllib)/m.test(head) && !/^solid/.test(head)) return parseOBJ(new TextDecoder().decode(buf));
  return parseSTL(buf);
}

export function parseSTL(buf) {
  const u8 = new Uint8Array(buf);
  const isAscii = (() => {
    if (u8.length < 84) return true;
    const head = new TextDecoder().decode(u8.subarray(0, Math.min(1024, u8.length)));
    if (!/^\s*solid/.test(head)) return false;
    const n = new DataView(buf).getUint32(80, true);
    return u8.length !== 84 + n * 50 && /facet\s+normal/.test(head);
  })();
  if (isAscii) return parseAsciiSTL(new TextDecoder().decode(u8));
  const dv = new DataView(buf); const n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9); let o = 84;
  for (let i = 0; i < n; i++) {
    o += 12; // face normal
    for (let k = 0; k < 9; k++) { pos[i * 9 + k] = dv.getFloat32(o, true); o += 4; }
    o += 2;
  }
  return finish(pos);
}
function parseAsciiSTL(text) {
  const out = []; const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g; let m;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  const tris = Math.floor(out.length / 9);
  return finish(Float32Array.from(out.slice(0, tris * 9)));
}

export function parseOBJ(text) {
  const v = []; const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (line[0] === 'v' && line[1] === ' ') { const p = line.trim().split(/\s+/); v.push(+p[1], +p[2], +p[3]); }
    else if (line[0] === 'f' && line[1] === ' ') {
      const idx = line.trim().split(/\s+/).slice(1).map(t => { let i = parseInt(t.split('/')[0], 10); if (i < 0) i = v.length / 3 + i + 1; return i - 1; });
      for (let k = 1; k + 1 < idx.length; k++) for (const i of [idx[0], idx[k], idx[k + 1]]) out.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
    }
  }
  return finish(Float32Array.from(out));
}
function finish(pos) {
  if (!pos.length) throw new Error('No triangles found in mesh');
  return { positions: pos, triangles: pos.length / 9, bounds: meshBounds(pos) };
}

export function meshBounds(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  const center = [0, 1, 2].map(k => (min[k] + max[k]) / 2), size = [0, 1, 2].map(k => max[k] - min[k]);
  return { min, max, center, size, radius: Math.hypot(size[0], size[1], size[2]) / 2 || 1 };
}

// ---- rotations: 3x3 row-major matrices; Euler angles in degrees, R = Rz * Ry * Rx
const D = Math.PI / 180;
export function rotX(a) { const c = Math.cos(a * D), s = Math.sin(a * D); return [1, 0, 0, 0, c, -s, 0, s, c]; }
export function rotY(a) { const c = Math.cos(a * D), s = Math.sin(a * D); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
export function rotZ(a) { const c = Math.cos(a * D), s = Math.sin(a * D); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
export function mul3(a, b) { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; return o; }
export function apply3(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
export function eulerToMat(e) { return mul3(rotZ(e[2]), mul3(rotY(e[1]), rotX(e[0]))); }
export function matToEuler(m) {
  // R = Rz*Ry*Rx  =>  m[6] = -sin(ry)
  const sy = -m[6]; const ry = Math.asin(Math.max(-1, Math.min(1, sy)));
  let rx, rz;
  if (Math.abs(Math.cos(ry)) > 1e-6) { rx = Math.atan2(m[7], m[8]); rz = Math.atan2(m[3], m[0]); }
  else { rx = Math.atan2(-m[5], m[4]); rz = 0; }
  return [rx / D, ry / D, rz / D].map(v => +v.toFixed(3));
}
export function snapEuler(e) { return e.map(v => { const r = Math.round(v / 90) * 90; return Math.abs(v - r) < 1e-3 ? (((r % 360) + 540) % 360) - 180 : v; }); }

// Extents of the rotated bounding box in view space: x, y and distance (= -z) ranges.
export function rotatedExtents(bounds, m) {
  const ex = [Infinity, -Infinity], ey = [Infinity, -Infinity], ed = [Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const c = [i & 1 ? bounds.max[0] : bounds.min[0], i & 2 ? bounds.max[1] : bounds.min[1], i & 4 ? bounds.max[2] : bounds.min[2]];
    const p = apply3(m, [c[0] - bounds.center[0], c[1] - bounds.center[1], c[2] - bounds.center[2]]);
    ex[0] = Math.min(ex[0], p[0]); ex[1] = Math.max(ex[1], p[0]); ey[0] = Math.min(ey[0], p[1]); ey[1] = Math.max(ey[1], p[1]);
    ed[0] = Math.min(ed[0], -p[2]); ed[1] = Math.max(ed[1], -p[2]);
  }
  return { x: ex, y: ey, dist: ed };
}

// Build a binary STL from a triangle soup (used by tests and examples).
export function encodeBinarySTL(pos) {
  const n = pos.length / 9; const out = new ArrayBuffer(84 + n * 50); const dv = new DataView(out);
  dv.setUint32(80, n, true); let o = 84;
  for (let i = 0; i < n; i++) { o += 12; for (let k = 0; k < 9; k++) { dv.setFloat32(o, pos[i * 9 + k], true); o += 4; } o += 2; }
  return out;
}
