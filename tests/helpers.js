// unit cube triangles (12)
export function cubeTriangles(s = 1) {
  const h = s / 2, P = [];
  const quad = (a, b, c, d) => P.push(...a, ...b, ...c, ...a, ...c, ...d);
  const v = (x, y, z) => [x * h, y * h, z * h];
  quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)); quad(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1));
  quad(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1)); quad(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1));
  quad(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)); quad(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1));
  return Float32Array.from(P);
}

