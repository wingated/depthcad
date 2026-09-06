// 3D heightfield view. WebGL2: the grid is derived from gl_VertexID (no mesh buffers) and
// the height is a float texture, so 16-bit data shows without terracing. WebGL1 falls back
// to a buffered mesh and an 8-bit texture.
import { $ } from './dom.js';
import { clamp } from '../engine/util.js';
import { DEG } from '../engine/transform.js';
import { onComposite } from '../app/render.js';

export const view3d = { setHeight() { }, requestRender() { }, reset() { }, resize() { } };

export function initView3d() {
  const cv = $('#gl'); let gl = cv.getContext('webgl2', { antialias: true, alpha: false }); const isGL2 = !!gl;
  if (!gl) gl = cv.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) { $('#ctl3d').innerHTML = '<span>WebGL not available</span>'; return view3d; }
  const extU = isGL2 ? null : gl.getExtension('OES_element_index_uint');
  const floatLinear = isGL2 ? gl.getExtension('OES_texture_float_linear') : null;
  const VS_HEAD2 = `#version 300 es
    precision highp float;precision highp int;uniform ivec2 uGrid;
    #define VARYING out
    #define TEX texture
    vec2 gridUV(){int vid=gl_VertexID;int quad=vid/6;int c=vid-quad*6;int qx=quad-(quad/uGrid.x)*uGrid.x;int qy=quad/uGrid.x;
      int cx=(c==2||c==3||c==5)?1:0;int cy=(c==1||c==4||c==5)?1:0;return vec2(float(qx+cx)/float(uGrid.x),float(qy+cy)/float(uGrid.y));}`;
  const VS_HEAD1 = `attribute vec2 aUV;
    #define VARYING varying
    #define TEX texture2D
    vec2 gridUV(){return aUV;}`;
  const VS = (isGL2 ? VS_HEAD2 : VS_HEAD1) + `
    uniform sampler2D uH;uniform float uExag;uniform vec2 uAspect;uniform vec2 uTexel;uniform mat4 uMVP;uniform float uSmooth;
    VARYING vec3 vN;VARYING float vH;VARYING vec3 vPos;
    float h0(vec2 uv){return TEX(uH,uv).r;}
    float h(vec2 uv){if(uSmooth<0.5)return h0(uv);vec2 t=uTexel*0.75;return (4.0*h0(uv)+2.0*(h0(uv+vec2(t.x,0.))+h0(uv-vec2(t.x,0.))+h0(uv+vec2(0.,t.y))+h0(uv-vec2(0.,t.y)))+h0(uv+t)+h0(uv-t)+h0(uv+vec2(t.x,-t.y))+h0(uv-vec2(t.x,-t.y)))/16.0;}
    void main(){
      vec2 aUV=gridUV();
      float hc=h(aUV);
      vec2 t=uTexel*1.5;float hl=h(aUV-vec2(t.x,0.)),hr=h(aUV+vec2(t.x,0.)),hu=h(aUV-vec2(0.,t.y)),hd=h(aUV+vec2(0.,t.y));
      vec3 p=vec3((aUV.x-0.5)*2.0*uAspect.x,hc*uExag,(aUV.y-0.5)*2.0*uAspect.y);
      float dx=4.0*uAspect.x*t.x,dz=4.0*uAspect.y*t.y;
      vec3 tx=vec3(dx,(hr-hl)*uExag,0.0);vec3 tz=vec3(0.0,(hd-hu)*uExag,dz);
      vN=normalize(cross(tz,tx));vH=hc;vPos=p;gl_Position=uMVP*vec4(p,1.0);}`;
  const FS = (isGL2 ? `#version 300 es
    precision mediump float;in vec3 vN;in float vH;in vec3 vPos;out vec4 fragColor;
    #define gl_FragColor fragColor` : `
    precision mediump float;varying vec3 vN;varying float vH;varying vec3 vPos;`) + `
    uniform vec3 uEye;uniform int uShade;
    vec3 heat(float t){return clamp(vec3(1.5*t-0.2, 1.5*abs(t-0.5)>0.5?0.0:1.0-2.0*abs(t-0.5), 1.2-1.6*t),0.0,1.0);}
    void main(){
      vec3 N=normalize(vN);vec3 L1=normalize(vec3(-0.5,0.9,0.6));vec3 L2=normalize(vec3(0.7,0.3,-0.6));
      float d=max(dot(N,L1),0.0)*0.8+max(dot(N,L2),0.0)*0.3+0.18;
      vec3 V=normalize(uEye-vPos);vec3 H=normalize(L1+V);float sp=pow(max(dot(N,H),0.0),36.0)*0.22;
      vec3 base=vec3(0.80,0.76,0.70);
      if(uShade==1)base=mix(vec3(0.12),vec3(1.0),vH);
      else if(uShade==2)base=heat(vH);
      gl_FragColor=vec4(base*d+sp,1.0);}`;
  function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = {}; for (const n of ['uH', 'uExag', 'uAspect', 'uTexel', 'uMVP', 'uEye', 'uShade', 'uSmooth', 'uGrid']) U[n] = gl.getUniformLocation(prog, n);
  const aUV = gl.getAttribLocation(prog, 'aUV');
  const vbo = gl.createBuffer(), ibo = gl.createBuffer(); let nIdx = 0, idxType = gl.UNSIGNED_SHORT, gridNx = 0, gridNy = 0;
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const filt = (isGL2 && !floatLinear) ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
  gl.enable(gl.DEPTH_TEST); gl.clearColor(0.05, 0.055, 0.07, 1);
  let texW = 1, texH = 1, aspect = [1, 1], gridKey = '', needRender = true;
  const cam0 = { yaw: 0.45, pitch: 0.75, dist: 4.8, tx: 0, ty: 0, tz: 0 }; const cam = { ...cam0 };
  function buildGrid(N) {
    if (!isGL2) N = Math.min(N, 1024);
    const ar = texW / texH; let nx = N, ny = N; if (ar >= 1) ny = Math.max(2, Math.round(N / ar)); else nx = Math.max(2, Math.round(N * ar));
    if (!isGL2 && !extU && (nx + 1) * (ny + 1) > 65535) { const f = Math.sqrt(65535 / ((nx + 1) * (ny + 1))); nx = Math.floor(nx * f); ny = Math.floor(ny * f); }
    const key = nx + 'x' + ny; if (key === gridKey) return; gridKey = key; gridNx = nx; gridNy = ny; nIdx = nx * ny * 6;
    if (isGL2) return;
    const uv = new Float32Array((nx + 1) * (ny + 1) * 2); let k = 0; for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { uv[k++] = i / nx; uv[k++] = j / ny; }
    const big = extU && (nx + 1) * (ny + 1) > 65535; const idx = big ? new Uint32Array(nx * ny * 6) : new Uint16Array(nx * ny * 6); k = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); idxType = big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  }
  function persp(fov, ar, n, f) { const t = 1 / Math.tan(fov / 2); return [t / ar, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
  function lookAt(e, c, u) {
    const zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]; let l = Math.hypot(zx, zy, zz) || 1; const z = [zx / l, zy / l, zz / l];
    let x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]]; l = Math.hypot(...x) || 1; x = x.map(v => v / l);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
  }
  function mul(a, b) { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
  function eye() { const cp = Math.cos(cam.pitch); return [cam.tx + Math.sin(cam.yaw) * cp * cam.dist, cam.ty + Math.sin(cam.pitch) * cam.dist, cam.tz + Math.cos(cam.yaw) * cp * cam.dist]; }
  function render() {
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return; const pr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * pr) || cv.height !== Math.round(h * pr)) { cv.width = Math.round(w * pr); cv.height = Math.round(h * pr); }
    gl.viewport(0, 0, cv.width, cv.height); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!nIdx) return;
    const e = eye(); const mvp = mul(persp(45 * DEG, w / h, 0.05, 100), lookAt(e, [cam.tx, cam.ty, cam.tz], [0, 1, 0]));
    gl.useProgram(prog); gl.uniformMatrix4fv(U.uMVP, false, new Float32Array(mvp)); gl.uniform3fv(U.uEye, new Float32Array(e));
    gl.uniform1f(U.uExag, parseFloat($('#exag').value)); gl.uniform2f(U.uAspect, aspect[0], aspect[1]); gl.uniform2f(U.uTexel, 1 / texW, 1 / texH);
    gl.uniform1i(U.uShade, parseInt($('#shade').value)); gl.uniform1f(U.uSmooth, $('#smooth3d').checked ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uH, 0);
    if (isGL2) { gl.uniform2i(U.uGrid, gridNx, gridNy); gl.drawArrays(gl.TRIANGLES, 0, nIdx); }
    else { gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.drawElements(gl.TRIANGLES, nIdx, idxType, 0); }
  }
  view3d.setHeight = comp => {
    if (!comp) return; texW = comp.w; texH = comp.h; const m = Math.max(texW, texH); aspect = [texW / m, texH / m];
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    try {
      if (isGL2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, texW, texH, 0, gl.RED, gl.FLOAT, comp.height);
      else { const u8 = new Uint8Array(comp.height.length); for (let i = 0; i < u8.length; i++) u8[i] = clamp(Math.round(comp.height[i] * 255), 0, 255); gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, texW, texH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, u8); }
    } catch (e) { console.error(e); }
    buildGrid(parseInt($('#gridRes').value)); needRender = true;
  };
  view3d.requestRender = () => { needRender = true; };
  view3d.reset = () => { Object.assign(cam, cam0); needRender = true; };
  view3d.rebuildGrid = () => { gridKey = ''; buildGrid(parseInt($('#gridRes').value)); needRender = true; };
  view3d.resize = () => { needRender = true; };
  (function loop() { if (needRender && !$('#pane3d').classList.contains('hidden')) { needRender = false; render(); } requestAnimationFrame(loop); })();
  let d3 = null; cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); d3 = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || e.button === 1 }; });
  cv.addEventListener('pointermove', e => {
    if (!d3) return; const dx = e.clientX - d3.x, dy = e.clientY - d3.y; d3.x = e.clientX; d3.y = e.clientY;
    if (d3.pan) { const s = cam.dist * 0.0015; const rx = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)]; const up = [-Math.sin(cam.yaw) * Math.sin(cam.pitch), Math.cos(cam.pitch), -Math.cos(cam.yaw) * Math.sin(cam.pitch)]; cam.tx += (-dx * rx[0] + dy * up[0]) * s; cam.ty += (-dx * rx[1] + dy * up[1]) * s; cam.tz += (-dx * rx[2] + dy * up[2]) * s; }
    else { cam.yaw -= dx * 0.008; cam.pitch = clamp(cam.pitch + dy * 0.008, -1.5, 1.55); }
    needRender = true;
  });
  const end3 = () => { d3 = null; }; cv.addEventListener('pointerup', end3); cv.addEventListener('pointercancel', end3);
  cv.addEventListener('wheel', e => { e.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0015), 0.3, 30); needRender = true; }, { passive: false });
  $('#exag').addEventListener('input', () => needRender = true); $('#smooth3d').addEventListener('change', () => needRender = true);
  $('#shade').addEventListener('change', () => needRender = true);
  $('#gridRes').addEventListener('change', () => view3d.rebuildGrid()); $('#bReset3d').addEventListener('click', () => view3d.reset());
  onComposite(c => view3d.setHeight(c));
  return view3d;
}
