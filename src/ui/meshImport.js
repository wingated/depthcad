// Mesh import dialog: orthographic depth "screenshot" of an STL/OBJ with interactive
// orientation, framing, resolution and near/far clipping planes.
import { state, findNode } from '../app/state.js';
import * as cmd from '../app/commands.js';
import { registerBakedRaster } from '../app/io.js';
import { createBaker, UNCOVERED } from '../engine/meshbake.js';
import { eulerToMat, matToEuler, mul3, rotX, rotY, rotZ, rotatedExtents, snapEuler } from '../engine/mesh.js';
import { openModal, closeModal } from './dialogs.js';
import { $, el, btn, setMsg } from './dom.js';
import { clamp, deepClone } from '../engine/util.js';

const PREV = 400; // preview pixel size

export function defaultBakeParams(mesh) {
  return { rot: [0, 0, 0], scale: 1, pan: [0, 0], near: 0, far: 1, res: 1024, w: 1024, h: 1024, bg: 'transparent', ss: 2 };
}

export function openMeshImport({ meshId, nodeId = null }) {
  const mesh = state.meshes[meshId]; if (!mesh) { alert('Mesh not found'); return; }
  const existing = nodeId ? findNode(nodeId) : null;
  const p = existing && existing.params.bake ? deepClone(existing.params.bake) : defaultBakeParams(mesh);
  const st = { p, autoFit: !existing, clipMode: existing ? 'manual' : 'geometry', cam: { yaw: 0.8, pitch: 0.45, dist: 3.2, tx: 0, ty: 0, tz: 0 }, embed: existing ? existing.params.embed !== false : mesh.bytes < 25e6, dist: null, stats: null, VP: null, dirty: true, fields: [] };

  // ---- DOM
  const wrap = el('div', 'meshwrap');
  const left = el('div', 'mcol'), right = el('div', 'mcol');
  const lt = el('div', 'mtitle', 'Depth result '); const resLbl = el('span', 'sub'); lt.appendChild(resLbl);
  const prev = document.createElement('canvas'); prev.width = PREV; prev.height = PREV; prev.className = 'mprev';
  const hist = document.createElement('canvas'); hist.width = PREV; hist.height = 72; hist.className = 'mhist';
  const clipRow = el('div', 'row');
  const nearIn = num(() => p.near, v => { p.near = Math.min(v, p.far - 1e-6); st.clipMode = 'manual'; touch(); }, 0.001);
  const farIn = num(() => p.far, v => { p.far = Math.max(v, p.near + 1e-6); st.clipMode = 'manual'; touch(); }, 0.001);
  clipRow.append(el('label', null, 'Near'), nearIn, el('label', null, 'Far'), farIn);
  const presetRow = el('div', 'btnrow');
  presetRow.append(
    btn('Far = farthest geometry', () => { st.clipMode = 'geometry'; applyClip(); touch(); }, 'small', 'Far plane at the back of the bounding box (hidden geometry still counts)'),
    btn('Far = farthest visible', () => { st.clipMode = 'visible'; applyClip(); touch(); }, 'small', 'Far plane at the farthest visible surface'),
    btn('Near = nearest visible', () => { if (st.stats) { p.near = st.stats.min; st.clipMode = 'manual'; touch(); } }, 'small'),
    btn('Near = nearest geometry', () => { p.near = ext().dist[0]; st.clipMode = 'manual'; touch(); }, 'small'));
  const bgRow = el('div', 'row'); const bgSel = sel({ transparent: 'Outside the model: transparent', far: 'Outside the model: farthest (0)' }, p.bg, v => { p.bg = v; touch(); }); bgRow.append(bgSel);
  left.append(lt, prev, hist, clipRow, presetRow, bgRow, el('div', 'hint', 'Drag the depth image to rotate the model. Green = clipped to maximum height, red = clipped to 0. Drag the handles on the histogram (or the planes on the right) to set the range.'));

  const rt = el('div', 'mtitle', 'Inspect '); rt.appendChild(el('span', 'sub', 'drag to orbit, wheel to zoom, drag a plane handle to move it'));
  const glWrap = el('div', 'mglwrap'); const glc = document.createElement('canvas'); glc.width = PREV; glc.height = PREV; glc.className = 'mgl';
  const ov = document.createElement('canvas'); ov.width = PREV; ov.height = PREV; ov.className = 'mov'; glWrap.append(glc, ov);
  const viewRow = el('div', 'btnrow'); viewRow.appendChild(el('label', null, 'View from'));
  for (const [l, r] of [['+Z (front)', [0, 0, 0]], ['−Z', [0, 180, 0]], ['+X', [0, -90, 0]], ['−X', [0, 90, 0]], ['+Y (top)', [90, 0, 0]], ['−Y', [-90, 0, 0]]]) viewRow.appendChild(btn(l, () => { p.rot = r.slice(); onRotate(); }));
  const rotRow = el('div', 'btnrow'); rotRow.appendChild(el('label', null, 'Rotate 90°'));
  for (const [l, ax, s] of [['X ↻', 'x', 90], ['X ↺', 'x', -90], ['Y ↻', 'y', 90], ['Y ↺', 'y', -90], ['Z ↻', 'z', 90], ['Z ↺', 'z', -90]]) rotRow.appendChild(btn(l, () => { const M = ax === 'x' ? rotX(s) : ax === 'y' ? rotY(s) : rotZ(s); p.rot = snapEuler(matToEuler(mul3(M, eulerToMat(p.rot)))); onRotate(); }));
  const angRow = el('div', 'row'); angRow.appendChild(el('label', null, 'Angles X Y Z'));
  for (let i = 0; i < 3; i++) angRow.appendChild(num(() => p.rot[i], v => { p.rot[i] = v; onRotate(); }, 0.5));
  const frameRow = el('div', 'row'); frameRow.append(el('label', null, 'Pixels / unit'), num(() => p.scale, v => { p.scale = Math.max(1e-6, v); st.autoFit = false; sizeFromScale(); touch(); }, 0.01),
    el('label', null, 'Pan'), num(() => p.pan[0], v => { p.pan[0] = v; st.autoFit = false; touch(); }, 0.01), num(() => p.pan[1], v => { p.pan[1] = v; st.autoFit = false; touch(); }, 0.01), btn('Fit', () => { st.autoFit = true; fit(); touch(); }));
  const resRow = el('div', 'row'); resRow.append(el('label', null, 'Resolution (long side)'), num(() => p.res, v => { p.res = clamp(Math.round(v), 16, 8192); if (st.autoFit) fit(); else sizeFromScale(); touch(); }, 1));
  const ssChk = check('Supersample edges (2×)', () => p.ss === 2, v => { p.ss = v ? 2 : 1; });
  const embChk = check(`Embed mesh in project (${(mesh.bytes / 1048576).toFixed(1)} MB)`, () => st.embed, v => { st.embed = v; });
  resRow.append(ssChk); right.append(rt, glWrap, viewRow, rotRow, angRow, frameRow, resRow, embChk,
    el('div', 'hint', `${mesh.name}: ${mesh.triangles.toLocaleString()} triangles, size ${mesh.bounds.size.map(v => v.toFixed(2)).join(' × ')} units. The bake is an orthographic projection; 0 = far plane, maximum = near plane.`));
  wrap.append(left, right);

  const bakeBtn = btn(existing ? 'Re-bake' : 'Bake layer', doBake, 'primary'); bakeBtn.id = 'mBake';
  openModal(existing ? 'Re-bake mesh layer' : 'Import mesh as depth layer', wrap, [btn('Cancel', closeModal, ''), bakeBtn], cleanup);
  $('#modalBox').classList.add('wide');

  // ---- baker
  let baker;
  try { baker = createBaker(glc); baker.setMesh(mesh); } catch (e) { closeModal(); alert(e.message); return; }
  if (!existing) { fit(); applyClip(); }
  let raf = 0;
  function touch() { st.dirty = true; if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); }
  function refreshFields() { for (const [inp, get] of st.fields) { if (inp.type === 'checkbox') inp.checked = !!get(); else if (document.activeElement !== inp) inp.value = +(+get()).toFixed(4); } }

  function ext() { return rotatedExtents(mesh.bounds, eulerToMat(p.rot)); }
  function fit() {
    const e = ext(); const sx = Math.max(1e-9, e.x[1] - e.x[0]), sy = Math.max(1e-9, e.y[1] - e.y[0]);
    p.scale = p.res * 0.96 / Math.max(sx, sy); p.pan = [(e.x[0] + e.x[1]) / 2, (e.y[0] + e.y[1]) / 2]; sizeFromScale();
  }
  function sizeFromScale() { const e = ext(); const sx = e.x[1] - e.x[0], sy = e.y[1] - e.y[0]; const pad = p.res * 0.02; p.w = clamp(Math.ceil(sx * p.scale + pad * 2), 4, 8192); p.h = clamp(Math.ceil(sy * p.scale + pad * 2), 4, 8192); }
  function applyClip() {
    const e = ext();
    if (st.clipMode === 'geometry') { p.near = e.dist[0]; p.far = e.dist[1]; }
    else if (st.clipMode === 'visible' && st.stats && st.stats.count) { p.near = st.stats.min; p.far = st.stats.max; }
    if (p.far - p.near < 1e-9) p.far = p.near + 1e-6;
  }
  function onRotate() { if (st.autoFit) fit(); else sizeFromScale(); if (st.clipMode === 'geometry') applyClip(); touch(); }

  function update() {
    // low-resolution preview bake
    const long = Math.max(p.w, p.h); const pw = Math.max(8, Math.round(p.w / long * PREV)), ph = Math.max(8, Math.round(p.h / long * PREV));
    const pp = { ...p, scale: p.scale * (pw / p.w) };
    st.dist = baker.bakeDist(pp, pw, ph); st.stats = baker.distStats(st.dist);
    if (st.clipMode === 'visible') applyClip();
    drawPreview(pw, ph); drawHist(); drawGL(); refreshFields();
    resLbl.textContent = `${p.w} × ${p.h} px`;
  }
  function drawPreview(pw, ph) {
    const c = prev.getContext('2d'); c.clearRect(0, 0, PREV, PREV); c.fillStyle = '#1b1c1f'; c.fillRect(0, 0, PREV, PREV);
    const img = c.createImageData(pw, ph); const d = img.data; const span = Math.max(1e-9, p.far - p.near);
    for (let i = 0; i < pw * ph; i++) {
      const v = st.dist.dist[i]; const k = i * 4;
      if (v >= UNCOVERED) { const chk = (((i % pw) >> 3) + ((i / pw | 0) >> 3)) & 1; d[k] = d[k + 1] = chk ? 44 : 36; d[k + 2] = chk ? 54 : 46; d[k + 3] = 255; continue; }
      const hh = (p.far - v) / span;
      if (hh > 1.0001) { d[k] = 90; d[k + 1] = 200; d[k + 2] = 90; } else if (hh < -0.0001) { d[k] = 200; d[k + 1] = 80; d[k + 2] = 80; } else { const g = Math.round(clamp(hh, 0, 1) * 255); d[k] = d[k + 1] = d[k + 2] = g; }
      d[k + 3] = 255;
    }
    const ox = (PREV - pw) >> 1, oy = (PREV - ph) >> 1; c.putImageData(img, ox, oy);
    c.strokeStyle = '#555'; c.strokeRect(ox - 0.5, oy - 0.5, pw + 1, ph + 1);
  }
  function histRange() { const e = ext(); const lo = Math.min(e.dist[0], p.near), hi = Math.max(e.dist[1], p.far); return [lo, hi]; }
  function drawHist() {
    const c = hist.getContext('2d'); const W = hist.width, H = hist.height; c.clearRect(0, 0, W, H); c.fillStyle = '#17181b'; c.fillRect(0, 0, W, H);
    const [lo, hi] = histRange(); const s = baker.distStats(st.dist, 96, [lo, hi]);
    const bw = (W - 20) / 96; c.fillStyle = '#6a7d9c';
    for (let i = 0; i < 96; i++) { const v = s.peak ? s.hist[i] / s.peak : 0; c.fillRect(10 + i * bw, H - 14 - v * (H - 20), Math.max(1, bw - 1), v * (H - 20)); }
    const x = v => 10 + (v - lo) / Math.max(1e-9, hi - lo) * (W - 20);
    c.fillStyle = 'rgba(90,200,90,.15)'; c.fillRect(10, 0, Math.max(0, x(p.near) - 10), H - 14);
    c.fillStyle = 'rgba(200,80,80,.15)'; c.fillRect(x(p.far), 0, Math.max(0, W - 10 - x(p.far)), H - 14);
    for (const [v, col, lbl] of [[p.near, '#5fd75f', 'near'], [p.far, '#e06a6a', 'far']]) { const hx = x(v); c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(hx, 0); c.lineTo(hx, H - 12); c.stroke(); c.fillStyle = col; c.beginPath(); c.moveTo(hx - 6, H - 12); c.lineTo(hx + 6, H - 12); c.lineTo(hx, H - 4); c.closePath(); c.fill(); c.font = '10px sans-serif'; c.fillText(lbl, hx + 8, H - 3); }
    c.fillStyle = '#8f9096'; c.font = '10px sans-serif'; c.fillText('near', 10, 10); c.textAlign = 'right'; c.fillText('far', W - 10, 10); c.textAlign = 'left';
  }
  function drawGL() {
    const r = baker.renderPreview(p, st.cam, PREV, PREV); st.VP = r.VP;
    const c = ov.getContext('2d'); c.clearRect(0, 0, PREV, PREV);
    for (const h of planeHandles()) { c.beginPath(); c.arc(h.x, h.y, 7, 0, Math.PI * 2); c.fillStyle = h.color; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); }
  }
  function planeHandles() {
    if (!st.VP) return [];
    const cx = p.pan[0], cy = p.pan[1] + p.h / p.scale / 2; // top edge centre of the window
    const n = baker.project(st.VP, [cx, cy, -p.near], PREV, PREV), f = baker.project(st.VP, [cx, cy, -p.far], PREV, PREV);
    return [{ key: 'near', x: n.x, y: n.y, color: '#5fd75f' }, { key: 'far', x: f.x, y: f.y, color: '#e06a6a' }];
  }

  // ---- interactions
  let drag = null;
  const pos = (e, cv) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  prev.addEventListener('pointerdown', e => { prev.setPointerCapture(e.pointerId); drag = { kind: 'rot', x: e.clientX, y: e.clientY }; });
  prev.addEventListener('pointermove', e => {
    if (!drag || drag.kind !== 'rot') return; const k = (e.shiftKey ? 0.05 : 0.5); const dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k; drag.x = e.clientX; drag.y = e.clientY;
    const R = mul3(rotX(dy), mul3(rotY(dx), eulerToMat(p.rot))); p.rot = matToEuler(R); onRotate();
  });
  const endDrag = () => { drag = null; };
  prev.addEventListener('pointerup', endDrag); prev.addEventListener('pointercancel', endDrag);
  ov.addEventListener('pointerdown', e => {
    ov.setPointerCapture(e.pointerId); const m = pos(e, ov);
    const h = planeHandles().find(h => Math.hypot(h.x - m.x, h.y - m.y) < 12);
    if (h) {
      const cx = p.pan[0], cy = p.pan[1] + p.h / p.scale / 2; const a = baker.project(st.VP, [cx, cy, -p.near], PREV, PREV), b = baker.project(st.VP, [cx, cy, -p.far], PREV, PREV);
      const dd = Math.max(1e-9, p.far - p.near); const dir = { x: (b.x - a.x) / dd, y: (b.y - a.y) / dd }; const l2 = dir.x * dir.x + dir.y * dir.y || 1e-9;
      drag = { kind: 'plane', key: h.key, x: m.x, y: m.y, dir, l2, near0: p.near, far0: p.far }; return;
    }
    drag = { kind: 'orbit', x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
  });
  ov.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.kind === 'orbit') { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; st.cam.yaw -= dx * 0.008; st.cam.pitch = clamp(st.cam.pitch + dy * 0.008, -1.5, 1.55); drawGL(); }
    else if (drag.kind === 'plane') {
      const m = pos(e, ov); const dd = ((m.x - drag.x) * drag.dir.x + (m.y - drag.y) * drag.dir.y) / drag.l2;
      const [lo, hi] = [ext().dist[0] - mesh.bounds.radius, ext().dist[1] + mesh.bounds.radius];
      if (drag.key === 'near') p.near = clamp(drag.near0 + dd, lo, p.far - 1e-6); else p.far = clamp(drag.far0 + dd, p.near + 1e-6, hi);
      st.clipMode = 'manual'; touch();
    }
  });
  ov.addEventListener('pointerup', endDrag); ov.addEventListener('pointercancel', endDrag); ov.addEventListener('contextmenu', e => e.preventDefault());
  ov.addEventListener('wheel', e => { e.preventDefault(); st.cam.dist = clamp(st.cam.dist * Math.exp(e.deltaY * 0.0015), 0.5, 20); drawGL(); }, { passive: false });
  hist.addEventListener('pointerdown', e => {
    hist.setPointerCapture(e.pointerId); const m = pos(e, hist); const [lo, hi] = histRange(); const x = v => 10 + (v - lo) / Math.max(1e-9, hi - lo) * (hist.width - 20);
    const key = Math.abs(x(p.near) - m.x) <= Math.abs(x(p.far) - m.x) ? 'near' : 'far'; drag = { kind: 'hist', key, lo, hi }; histDrag(m.x);
  });
  hist.addEventListener('pointermove', e => { if (drag && drag.kind === 'hist') histDrag(pos(e, hist).x); });
  hist.addEventListener('pointerup', endDrag); hist.addEventListener('pointercancel', endDrag);
  function histDrag(mx) { const v = drag.lo + clamp((mx - 10) / (hist.width - 20), 0, 1) * (drag.hi - drag.lo); if (drag.key === 'near') p.near = Math.min(v, p.far - 1e-6); else p.far = Math.max(v, p.near + 1e-6); st.clipMode = 'manual'; touch(); }

  async function doBake() {
    bakeBtn.disabled = true; bakeBtn.textContent = 'Baking…';
    try {
      await new Promise(r => setTimeout(r, 20));
      const r = baker.bake(p, p.w, p.h, p.ss);
      const imageId = await registerBakedRaster(r);
      const params = { imageId, meshId, bake: deepClone(p), embed: st.embed };
      if (existing) { cmd.setParams(existing.id, params); cmd.select([existing.id]); }
      else {
        if (!state.root.children.length) { cmd.setDocument({ w: p.w, h: p.h }, { transient: true }); }
        cmd.add('mesh', params, { name: mesh.name, node: { x: state.doc.w / 2, y: state.doc.h / 2 } });
      }
      setMsg(`Baked ${mesh.name} at ${p.w}×${p.h}`); closeModal();
    } catch (e) { alert('Bake failed: ' + e.message); bakeBtn.disabled = false; bakeBtn.textContent = 'Bake layer'; }
  }
  function cleanup() { $('#modalBox').classList.remove('wide'); if (baker) baker.dispose(); }
  touch();

  // ---- small field helpers (local so the dialog is self-contained)
  function num(get, set, step) { const i = document.createElement('input'); i.type = 'number'; i.step = step; i.value = +(+get()).toFixed(4); i.style.width = '72px'; i.addEventListener('change', () => { const v = parseFloat(i.value); if (!isNaN(v)) set(v); }); st.fields.push([i, get]); return i; }
  function sel(options, v, set) { const s = document.createElement('select'); for (const [k, l] of Object.entries(options)) { const o = el('option', null, l); o.value = k; s.appendChild(o); } s.value = v; s.addEventListener('change', () => set(s.value)); return s; }
  function check(label, get, set) { const l = el('label', 'wide'); const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!get(); c.addEventListener('change', () => set(c.checked)); l.append(c, ' ' + label); st.fields.push([c, get]); return l; }
}
