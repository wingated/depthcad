// WebGL2 orthographic depth baker and shaded preview for mesh import.
//
// View space: the mesh is centred on its bounding-box centre and rotated by R (3x3); the
// camera looks down -Z. "dist" is -z (larger = farther from the camera). The bake window is
// w x h pixels at `scale` pixels per model unit, centred on (pan[0], pan[1]) in view units.
import { eulerToMat, apply3 } from './mesh.js';

const UNCOVERED = 1e30;

export function createBaker(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 is required for mesh import');
  const floatOk = !!gl.getExtension('EXT_color_buffer_float');

  const depthProg = program(gl, `#version 300 es
    in vec3 aPos; uniform mat3 uR; uniform vec3 uCenter; uniform vec2 uPan; uniform float uScale; uniform vec2 uSize; uniform float uRadius;
    out float vDist;
    void main(){ vec3 v = uR * (aPos - uCenter); vDist = -v.z;
      gl_Position = vec4((v.x - uPan.x) * uScale / (uSize.x * 0.5), (v.y - uPan.y) * uScale / (uSize.y * 0.5), vDist / (uRadius * 1.05), 1.0); }`,
    `#version 300 es
    precision highp float; in float vDist; uniform int uPacked; uniform float uRadius; out vec4 o;
    void main(){
      if (uPacked == 1) { // 24-bit fixed-point fallback for GPUs without float render targets
        float t = clamp((vDist + uRadius) / (2.0 * uRadius), 0.0, 0.999999);
        vec3 enc = fract(vec3(1.0, 255.0, 65025.0) * t); enc -= enc.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
        o = vec4(enc, 1.0);
      } else o = vec4(vDist, 0.0, 0.0, 1.0); }`);
  const shadeProg = program(gl, `#version 300 es
    in vec3 aPos; uniform mat3 uR; uniform vec3 uCenter; uniform mat4 uVP; out vec3 vPos;
    void main(){ vec3 v = uR * (aPos - uCenter); vPos = v; gl_Position = uVP * vec4(v, 1.0); }`,
    `#version 300 es
    precision highp float; in vec3 vPos; uniform vec3 uEye; uniform vec2 uClip; out vec4 o;
    void main(){ vec3 N = normalize(cross(dFdx(vPos), dFdy(vPos))); vec3 L = normalize(vec3(-0.4, 0.8, 0.9)); vec3 L2 = normalize(vec3(0.6, 0.2, -0.7));
      float d = max(dot(N, L), 0.0) * 0.75 + max(dot(N, L2), 0.0) * 0.25 + 0.2; vec3 base = vec3(0.78, 0.74, 0.68);
      float dist = -vPos.z; if (dist < uClip.x) base = vec3(0.55, 0.85, 0.55); else if (dist > uClip.y) base = vec3(0.9, 0.45, 0.45);
      o = vec4(base * d, 1.0); }`);
  const lineProg = program(gl, `#version 300 es
    in vec3 aPos; uniform mat4 uVP; void main(){ gl_Position = uVP * vec4(aPos, 1.0); }`,
    `#version 300 es
    precision highp float; uniform vec4 uColor; out vec4 o; void main(){ o = uColor; }`);

  const vbo = gl.createBuffer(); let count = 0, center = [0, 0, 0];
  const lineVbo = gl.createBuffer();
  let fbo = null, tex = null, rbo = null, fw = 0, fh = 0, packed = !floatOk;

  function ensureFBO(w, h) {
    if (fbo && fw === w && fh === h) return;
    if (fbo) { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); gl.deleteRenderbuffer(rbo); }
    fw = w; fh = h; fbo = gl.createFramebuffer(); tex = gl.createTexture(); rbo = gl.createRenderbuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (packed) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindRenderbuffer(gl.RENDERBUFFER, rbo); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rbo);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      if (!packed) { packed = true; gl.bindFramebuffer(gl.FRAMEBUFFER, null); fw = 0; ensureFBO(w, h); return; }
      throw new Error('Could not create bake framebuffer');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  const api = {
    gl, canvas,
    setMesh(mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
      count = mesh.positions.length / 3; center = mesh.bounds.center; api.mesh = mesh;
    },
    // Render depth (distance) into a w x h buffer. Returns {w, h, dist: Float32Array} with UNCOVERED where nothing was hit.
    bakeDist(p, w, h) {
      ensureFBO(w, h);
      const R = eulerToMat(p.rot); const radius = api.mesh.bounds.radius + Math.hypot(p.pan[0], p.pan[1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      if (packed) gl.clearColor(1, 1, 1, 1); else gl.clearColor(UNCOVERED, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(depthProg.prog);
      gl.uniformMatrix3fv(depthProg.u.uR, true, new Float32Array(R)); gl.uniform3fv(depthProg.u.uCenter, new Float32Array(center));
      gl.uniform2f(depthProg.u.uPan, p.pan[0], p.pan[1]); gl.uniform1f(depthProg.u.uScale, p.scale); gl.uniform2f(depthProg.u.uSize, w, h); gl.uniform1f(depthProg.u.uRadius, radius);
      gl.uniform1i(depthProg.u.uPacked, packed ? 1 : 0);
      bindPos(depthProg.a.aPos); gl.drawArrays(gl.TRIANGLES, 0, count);
      const dist = new Float32Array(w * h);
      if (packed) {
        // 24-bit fixed point normalised over [-radius, radius]; clear colour (all 255) marks uncovered pixels
        const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = ((h - 1 - y) * w + x) * 4, o = y * w + x;
          if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255) { dist[o] = UNCOVERED; continue; }
          const t = px[i] / 255 + px[i + 1] / 65025 + px[i + 2] / 16581375;
          dist[o] = t * 2 * radius - radius;
        }
      } else {
        const buf = new Float32Array(w * h); gl.readPixels(0, 0, w, h, gl.RED, gl.FLOAT, buf);
        for (let y = 0; y < h; y++) dist.set(buf.subarray((h - 1 - y) * w, (h - y) * w), y * w);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { w, h, dist };
    },
    // Full bake: supersampled distance -> normalized height + coverage.
    bake(p, w, h, ss = 2) {
      const maxDim = Math.max(w, h); if (maxDim * ss > 8192) ss = 1;
      const d = api.bakeDist({ ...p, scale: p.scale * ss }, w * ss, h * ss);
      const height = new Float32Array(w * h), coverage = new Float32Array(w * h);
      const span = Math.max(1e-9, p.far - p.near);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let sum = 0, n = 0;
        for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) { const v = d.dist[(y * ss + j) * d.w + x * ss + i]; if (v < UNCOVERED) { n++; let hh = (p.far - v) / span; sum += hh < 0 ? 0 : hh > 1 ? 1 : hh; } }
        const o = y * w + x;
        if (n) { height[o] = sum / n; coverage[o] = n / (ss * ss); }
      }
      if (p.bg === 'far') { for (let i = 0; i < coverage.length; i++) { if (coverage[i] < 1) { height[i] = height[i] * coverage[i]; coverage[i] = 1; } } }
      return { w, h, height, coverage };
    },
    // Statistics of a distance buffer: min/max over covered pixels and a histogram.
    distStats(d, bins = 64, range) {
      let min = Infinity, max = -Infinity, n = 0;
      for (let i = 0; i < d.dist.length; i++) { const v = d.dist[i]; if (v >= UNCOVERED) continue; n++; if (v < min) min = v; if (v > max) max = v; }
      const lo = range ? range[0] : min, hi = range ? range[1] : max; const hist = new Float32Array(bins);
      if (n && hi > lo) for (let i = 0; i < d.dist.length; i++) { const v = d.dist[i]; if (v >= UNCOVERED) continue; const b = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / (hi - lo) * bins))); hist[b]++; }
      let peak = 0; for (const v of hist) peak = Math.max(peak, v);
      return { min, max, count: n, hist, peak, lo, hi };
    },
    // Shaded perspective preview into the visible canvas, with the bake box and the near/far planes.
    renderPreview(p, cam, w, h) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.clearColor(0.06, 0.065, 0.08, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const R = eulerToMat(p.rot); const r = api.mesh.bounds.radius;
      const eye = [cam.tx + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist * r, cam.ty + Math.sin(cam.pitch) * cam.dist * r, cam.tz + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist * r];
      const VP = mul4(persp(45 * Math.PI / 180, w / h, r * 0.02, r * 40), lookAt(eye, [cam.tx, cam.ty, cam.tz], [0, 1, 0]));
      gl.useProgram(shadeProg.prog); gl.uniformMatrix4fv(shadeProg.u.uVP, false, new Float32Array(VP));
      gl.uniformMatrix3fv(shadeProg.u.uR, true, new Float32Array(R)); gl.uniform3fv(shadeProg.u.uCenter, new Float32Array(center));
      gl.uniform3fv(shadeProg.u.uEye, new Float32Array(eye)); gl.uniform2f(shadeProg.u.uClip, p.near, p.far);
      bindPos(shadeProg.a.aPos); gl.drawArrays(gl.TRIANGLES, 0, count);
      // bake box and clip planes
      const hw = p.w / p.scale / 2, hh = p.h / p.scale / 2, cx = p.pan[0], cy = p.pan[1];
      const zN = -p.near, zF = -p.far;
      const quad = z => [cx - hw, cy - hh, z, cx + hw, cy - hh, z, cx + hw, cy + hh, z, cx - hw, cy + hh, z];
      gl.useProgram(lineProg.prog); gl.uniformMatrix4fv(lineProg.u.uVP, false, new Float32Array(VP));
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      drawLines(lineProg, quad(zN), gl.LINE_LOOP, [0.4, 0.95, 0.4, 1]); drawFan(lineProg, quad(zN), [0.4, 0.95, 0.4, 0.18]);
      drawLines(lineProg, quad(zF), gl.LINE_LOOP, [0.95, 0.4, 0.4, 1]); drawFan(lineProg, quad(zF), [0.95, 0.4, 0.4, 0.18]);
      const qa = quad(zN), qb = quad(zF); const edges = []; for (let i = 0; i < 4; i++) edges.push(qa[i * 3], qa[i * 3 + 1], qa[i * 3 + 2], qb[i * 3], qb[i * 3 + 1], qb[i * 3 + 2]);
      drawLines(lineProg, edges, gl.LINES, [0.6, 0.7, 1, 0.8]);
      // view axis through the centre of the window
      drawLines(lineProg, [cx, cy, zN + (p.far - p.near) * 0.6, cx, cy, zF - (p.far - p.near) * 0.6], gl.LINES, [1, 1, 1, 0.35]);
      gl.depthMask(true); gl.disable(gl.BLEND);
      return { VP, eye };
    },
    project(VP, v, w, h) { const x = VP[0] * v[0] + VP[4] * v[1] + VP[8] * v[2] + VP[12], y = VP[1] * v[0] + VP[5] * v[1] + VP[9] * v[2] + VP[13], ww = VP[3] * v[0] + VP[7] * v[1] + VP[11] * v[2] + VP[15]; return { x: (x / ww * 0.5 + 0.5) * w, y: (0.5 - y / ww * 0.5) * h, w: ww }; },
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
  function bindPos(loc) { gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); }
  function drawLines(pr, arr, mode, color) { gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(pr.a.aPos); gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0); gl.uniform4fv(pr.u.uColor, color); gl.drawArrays(mode, 0, arr.length / 3); }
  function drawFan(pr, arr, color) { drawLines(pr, arr, gl.TRIANGLE_FAN, color); }
  return api;
}

function program(gl, vs, fs) {
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const u = {}, a = {};
  const nu = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); for (let i = 0; i < nu; i++) { const n = gl.getActiveUniform(prog, i).name; u[n] = gl.getUniformLocation(prog, n); }
  const na = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES); for (let i = 0; i < na; i++) { const n = gl.getActiveAttrib(prog, i).name; a[n] = gl.getAttribLocation(prog, n); }
  return { prog, u, a };
}
export function persp(fov, ar, n, f) { const t = 1 / Math.tan(fov / 2); return [t / ar, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
export function lookAt(e, c, u) {
  const zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]; let l = Math.hypot(zx, zy, zz) || 1; const z = [zx / l, zy / l, zz / l];
  let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; l = Math.hypot(...x) || 1; x = x.map(v => v / l);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
}
export function mul4(a, b) { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
export { UNCOVERED };
