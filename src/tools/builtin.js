// Built-in example tools. These are ordinary tool documents; users and the agent write the same format.
export const BUILTIN_TOOLS = [
  {
    format: 'depthcad-tool/1', id: 'star-ring', name: 'Ring of stars', version: 1,
    description: 'N five-pointed stars arranged on a circle, each with a height profile.',
    schema: {
      count: { type: 'int', label: 'Stars', default: 12, min: 1, max: 200, step: 1, slider: true },
      radius: { type: 'number', label: 'Ring radius (px)', default: 300, min: 1, max: 4000, step: 1, slider: true },
      size: { type: 'number', label: 'Star size (px)', default: 60, min: 1, max: 2000, step: 1, slider: true },
      inner: { type: 'number', label: 'Star inner %', default: 40, min: 5, max: 95, step: 1, slider: true },
      points: { type: 'int', label: 'Points', default: 5, min: 3, max: 12, step: 1, slider: true },
      profile: { type: 'enum', label: 'Profile', default: 'dome', options: { flat: 'Flat', linear: 'Cone', dome: 'Dome', cosine: 'Smooth' } },
      high: { type: 'depth', label: 'Height', default: 1 },
      low: { type: 'depth', label: 'Base height', default: 0 },
      spin: { type: 'number', label: 'Spin (°)', default: 0, min: -180, max: 180, step: 1, slider: true },
    },
    measure: 'return { w: 2 * (p.radius + p.size), h: 2 * (p.radius + p.size) };',
    render: `const n = Math.max(1, p.count | 0);
lib.each((u, v) => {
  let best = -1e9;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + p.spin * Math.PI / 180;
    const cx = Math.cos(a) * p.radius, cy = Math.sin(a) * p.radius;
    const [lu, lv] = lib.sdf.rotate(u - cx, v - cy, -a * 180 / Math.PI - 90);
    best = Math.max(best, lib.sdf.star(lu, lv, p.size, p.size * p.inner / 100, p.points));
  }
  const c = lib.aa(best); if (c <= 0) return null;
  const t = lib.profile(p.profile, best, p.size * p.inner / 100 * 0.6);
  return [p.low + (p.high - p.low) * t, c];
});`,
  },
  {
    format: 'depthcad-tool/1', id: 'noise-texture', name: 'Noise texture', version: 1,
    description: 'A rectangle filled with fractal noise, for hammered or stone textures.',
    schema: {
      w: { type: 'number', label: 'Width (px)', default: 600, min: 1, max: 8192, step: 1 },
      h: { type: 'number', label: 'Height (px)', default: 400, min: 1, max: 8192, step: 1 },
      cell: { type: 'number', label: 'Feature size (px)', default: 60, min: 2, max: 2000, step: 1, slider: true },
      octaves: { type: 'int', label: 'Detail (octaves)', default: 4, min: 1, max: 8, step: 1, slider: true },
      low: { type: 'depth', label: 'Low', default: 0.2 },
      high: { type: 'depth', label: 'High', default: 0.6 },
      seed: { type: 'number', label: 'Seed', default: 0, min: 0, max: 1000, step: 1 },
    },
    measure: 'return { w: p.w, h: p.h };',
    render: `lib.each((u, v) => {
  const n = lib.fbm((u + p.seed * 1000) / p.cell, (v + p.seed * 700) / p.cell, p.octaves);
  return p.low + (p.high - p.low) * n;
});`,
  },
  {
    format: 'depthcad-tool/1', id: 'text-arc', name: 'Text on an arc', version: 1,
    description: 'Text laid out along a circular arc, inside or outside a ring. Uses the tool canvas for glyphs.',
    schema: {
      text: { type: 'text', label: 'Text', default: 'AROUND THE CIRCLE' },
      radius: { type: 'number', label: 'Radius (px)', default: 400, min: 10, max: 8000, step: 1, slider: true },
      size: { type: 'number', label: 'Font size (px)', default: 60, min: 4, max: 2000, step: 1 },
      family: { type: 'string', label: 'Font family', default: 'Helvetica' },
      weight: { type: 'enum', label: 'Weight', default: '700', options: { 400: 'Regular', 700: 'Bold', 900: 'Black' } },
      start: { type: 'number', label: 'Start angle (°)', default: -90, min: -360, max: 360, step: 1, slider: true },
      spacing: { type: 'number', label: 'Letter spacing (°)', default: 0, min: -10, max: 30, step: 0.1, slider: true },
      inside: { type: 'bool', label: 'Inside of the circle (reads clockwise, glyph tops toward the centre)', default: false },
      value: { type: 'depth', label: 'Value', default: 1 },
    },
    measure: 'return { w: 2 * (p.radius + p.size * 1.2), h: 2 * (p.radius + p.size * 1.2) };',
    render: `const ctx = lib.canvas();
ctx.font = p.weight + ' ' + p.size + 'px "' + p.family + '"'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
const chars = [...String(p.text)];
const widths = chars.map(ch => ctx.measureText(ch).width);
const R = p.inside ? p.radius - p.size * 0.15 : p.radius + p.size * 0.15;
const dir = p.inside ? -1 : 1;
let ang = p.start * Math.PI / 180;
for (let i = 0; i < chars.length; i++) {
  const half = widths[i] / 2 / R;
  ang += dir * half;
  ctx.save(); ctx.rotate(ang + (p.inside ? -Math.PI / 2 : Math.PI / 2)); ctx.translate(0, p.inside ? R : -R);
  if (p.inside) ctx.rotate(Math.PI);
  ctx.fillText(chars[i], 0, p.inside ? -p.size * 0.35 : p.size * 0.35);
  ctx.restore();
  ang += dir * (half + p.spacing * Math.PI / 180);
}
lib.fromCanvas(ctx, p.value);`,
  },
];
