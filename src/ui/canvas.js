// 2D editor: pan/zoom view of the composite, selection outlines, handles, dragging.
import { state, findNode, visibleLeaves, selectedNodes, primarySelected, fmtDepth } from '../app/state.js';
import * as cmd from '../app/commands.js';
import { commit } from '../app/history.js';
import { getComposite, onComposite, onFrame, invalidate, valueAt } from '../app/render.js';
import { boxCorners, boxPoint, boxContains, boxAABB, unionAABB, DEG } from '../engine/transform.js';
import { KINDS } from '../engine/kinds.js';
import { $ } from './dom.js';

let cv, vctx, dpr = 1, compCanvas = null, drag = null, spaceDown = false, hoverCursor = 'default';
const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

export function initCanvas() {
  cv = $('#view'); vctx = cv.getContext('2d');
  onComposite(updateCompCanvas);
  onFrame(drawView);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  window.addEventListener('keydown', e => { if (e.key === ' ' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) { spaceDown = true; } });
  window.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });
}
export function isSpaceDown() { return spaceDown; }

function updateCompCanvas(comp) {
  if (!comp) return;
  if (!compCanvas || compCanvas.width !== comp.w || compCanvas.height !== comp.h) { compCanvas = document.createElement('canvas'); compCanvas.width = comp.w; compCanvas.height = comp.h; }
  const x = compCanvas.getContext('2d'); const id = x.createImageData(comp.w, comp.h); const d = id.data; const h = comp.height;
  for (let i = 0, k = 0; i < h.length; i++, k += 4) { const v = h[i]; const g = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); d[k] = g; d[k + 1] = g; d[k + 2] = g; d[k + 3] = 255; }
  x.putImageData(id, 0, 0);
}

export function viewSize() { return { w: cv.clientWidth, h: cv.clientHeight }; }
export function toScreen(dx, dy) { return { x: state.view.x + dx * state.view.zoom, y: state.view.y + dy * state.view.zoom }; }
export function toDoc(sx, sy) { return { x: (sx - state.view.x) / state.view.zoom, y: (sy - state.view.y) / state.view.zoom }; }
export function fitView() { const { w, h } = viewSize(); if (!w || !h) return; const z = Math.min((w - 60) / state.doc.w, (h - 60) / state.doc.h); state.view.zoom = z; state.view.x = (w - state.doc.w * z) / 2; state.view.y = (h - state.doc.h * z) / 2; updateZoomLbl(); }
export function zoom100() { const { w, h } = viewSize(); state.view.zoom = 1; state.view.x = (w - state.doc.w) / 2; state.view.y = (h - state.doc.h) / 2; updateZoomLbl(); }
function zoomAt(sx, sy, f) { const v = state.view; const nz = Math.min(64, Math.max(0.01, v.zoom * f)); const d = toDoc(sx, sy); v.zoom = nz; v.x = sx - d.x * nz; v.y = sy - d.y * nz; updateZoomLbl(); }
function updateZoomLbl() { const l = $('#zoomLbl'); if (l) l.textContent = Math.round(state.view.zoom * 100) + '%'; }

function handlePositions(b) {
  const hs = HANDLES.map(([hx, hy]) => { const p = boxPoint(b, hx * b.w / 2, hy * b.h / 2); const s = toScreen(p.x, p.y); return { hx, hy, x: s.x, y: s.y }; });
  const tm = boxPoint(b, 0, -b.h / 2); const ts = toScreen(tm.x, tm.y); const r = b.rot * DEG;
  hs.push({ rot: true, x: ts.x + Math.sin(r) * 26, y: ts.y - Math.cos(r) * 26 });
  return hs;
}
function hitHandle(b, sx, sy) { const hs = handlePositions(b); for (let i = hs.length - 1; i >= 0; i--) { const h = hs[i]; if (Math.abs(h.x - sx) <= 7 && Math.abs(h.y - sy) <= 7) return h; } return null; }

function drawView() {
  const w = cv.clientWidth, h = cv.clientHeight; dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = vctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = '#111214'; c.fillRect(0, 0, w, h);
  const v = state.view;
  if (compCanvas) { c.imageSmoothingEnabled = v.zoom * (compCanvas.width / state.doc.w) < 1; c.imageSmoothingQuality = 'high'; c.drawImage(compCanvas, v.x, v.y, state.doc.w * v.zoom, state.doc.h * v.zoom); }
  c.strokeStyle = '#555'; c.lineWidth = 1; c.strokeRect(v.x - 0.5, v.y - 0.5, state.doc.w * v.zoom + 1, state.doc.h * v.zoom + 1);
  if (drag && drag.kind === 'marquee' && drag.moved) { const r = marqueeRect(drag); const a = toScreen(r.x0, r.y0), b = toScreen(r.x1, r.y1); c.fillStyle = 'rgba(76,154,255,.12)'; c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); c.strokeStyle = '#4c9aff'; c.setLineDash([4, 3]); c.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y); c.setLineDash([]); }
  if (drag && drag.kind === 'move' && drag.guides && drag.guides.length) { c.strokeStyle = '#ff5fa2'; c.lineWidth = 1; for (const g of drag.guides) { c.beginPath(); if (g.axis === 'x') { const s = toScreen(g.pos, 0); c.moveTo(s.x + 0.5, 0); c.lineTo(s.x + 0.5, h); } else { const s = toScreen(0, g.pos); c.moveTo(0, s.y + 0.5); c.lineTo(w, s.y + 0.5); } c.stroke(); } }
  if (!state.showOutlines) return;
  const sel = selectedNodes(); if (!sel.length) return;
  const single = sel.length === 1;
  for (const n of sel) {
    const b = cmd.boxOf(n); const isMask = KINDS[n.kind]?.isMask;
    const color = isMask ? '#ffb347' : n.kind === 'group' ? '#8fd18f' : '#4c9aff';
    if (isMask && n.params.shape === 'ellipse') {
      c.save(); const s = toScreen(b.x, b.y); c.translate(s.x, s.y); c.rotate(b.rot * DEG); c.beginPath(); c.ellipse(0, 0, b.w / 2 * v.zoom, b.h / 2 * v.zoom, 0, 0, Math.PI * 2); c.restore();
      c.setLineDash(n.params.invert ? [3, 3] : []); c.strokeStyle = color; c.lineWidth = 1.2; c.stroke(); c.setLineDash([]);
    }
    const cs = boxCorners(b).map(p => toScreen(p.x, p.y));
    c.beginPath(); cs.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath();
    c.setLineDash(n.kind === 'group' || (isMask && n.params.shape === 'ellipse') ? [4, 4] : []); c.strokeStyle = color; c.lineWidth = 1.2; c.stroke(); c.setLineDash([]);
    if (!single || n.locked) continue;
    const hs = handlePositions(b); c.fillStyle = '#fff'; c.strokeStyle = color;
    for (const hd of hs) {
      if (hd.rot) { const tm = hs[1]; c.beginPath(); c.moveTo(tm.x, tm.y); c.lineTo(hd.x, hd.y); c.stroke(); c.beginPath(); c.arc(hd.x, hd.y, 5, 0, Math.PI * 2); c.fill(); c.stroke(); }
      else { c.fillRect(hd.x - 4, hd.y - 4, 8, 8); c.strokeRect(hd.x - 4.5, hd.y - 4.5, 9, 9); }
    }
  }
}

function screenPt(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function onWheel(e) { e.preventDefault(); const p = screenPt(e); zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }

function hitTest(d) {
  const leaves = visibleLeaves();
  for (let i = leaves.length - 1; i >= 0; i--) { const n = leaves[i]; if (n.locked) continue; if (boxContains(cmd.boxOf(n), d.x, d.y)) return n; }
  return null;
}

function onDown(e) {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  cv.setPointerCapture(e.pointerId); const p = screenPt(e); const d = toDoc(p.x, p.y);
  if (e.button === 1 || e.button === 2 || spaceDown) { drag = { kind: 'pan', sx: p.x, sy: p.y, vx: state.view.x, vy: state.view.y }; return; }
  if (e.button !== 0) return;
  const prim = primarySelected();
  if (prim && state.sel.length === 1 && !prim.locked && state.showOutlines) {
    const b = cmd.boxOf(prim); const h = hitHandle(b, p.x, p.y);
    if (h) {
      if (h.rot) drag = { kind: 'rotate', id: prim.id, box0: { ...b }, a0: Math.atan2(d.y - b.y, d.x - b.x) };
      else drag = { kind: 'scale', id: prim.id, box0: { ...b }, hx: h.hx, hy: h.hy };
      return;
    }
  }
  // inside any selected box: move the selection
  const sel = selectedNodes();
  const inside = sel.find(n => boxContains(cmd.boxOf(n), d.x, d.y));
  if (inside && !e.shiftKey) { drag = startMove(sel.map(n => n.id), d); return; }
  const hit = hitTest(d);
  if (hit) {
    if (e.shiftKey) { cmd.select([hit.id], { toggle: true }); return; }
    cmd.select([hit.id]);
    drag = startMove([hit.id], d); return;
  }
  drag = { kind: 'marquee', sx: d.x, sy: d.y, ex: d.x, ey: d.y, spx: p.x, spy: p.y, moved: false, base: e.shiftKey ? state.sel.slice() : [] };
}

function startMove(ids, d) {
  const boxes = ids.map(id => findNode(id)).filter(Boolean).map(n => boxAABB(cmd.boxOf(n)));
  return { kind: 'move', ids, sx: d.x, sy: d.y, ax: 0, ay: 0, moved: false, aabb0: boxes.length ? unionAABB(boxes) : null, guides: [] };
}
// Snap targets: document edges/centre and the edges/centres of unselected visible leaves.
function snapTargets(excludeIds) {
  const xs = [0, state.doc.w / 2, state.doc.w], ys = [0, state.doc.h / 2, state.doc.h];
  for (const n of visibleLeaves()) { if (excludeIds.includes(n.id)) continue; const a = boxAABB(cmd.boxOf(n)); xs.push(a.x0, (a.x0 + a.x1) / 2, a.x1); ys.push(a.y0, (a.y0 + a.y1) / 2, a.y1); }
  return { xs, ys };
}
function snapOffset(aabb, dx, dy, targets, thr) {
  let bx = null, by = null, gx = null, gy = null;
  for (const v of [aabb.x0 + dx, (aabb.x0 + aabb.x1) / 2 + dx, aabb.x1 + dx]) for (const t of targets.xs) { const d = t - v; if (Math.abs(d) < thr && (bx === null || Math.abs(d) < Math.abs(bx))) { bx = d; gx = t; } }
  for (const v of [aabb.y0 + dy, (aabb.y0 + aabb.y1) / 2 + dy, aabb.y1 + dy]) for (const t of targets.ys) { const d = t - v; if (Math.abs(d) < thr && (by === null || Math.abs(d) < Math.abs(by))) { by = d; gy = t; } }
  return { dx: dx + (bx || 0), dy: dy + (by || 0), guides: [gx !== null && { axis: 'x', pos: gx }, gy !== null && { axis: 'y', pos: gy }].filter(Boolean) };
}
function marqueeRect(dk) { return { x0: Math.min(dk.sx, dk.ex), y0: Math.min(dk.sy, dk.ey), x1: Math.max(dk.sx, dk.ex), y1: Math.max(dk.sy, dk.ey) }; }
function marqueeSelection(dk) {
  const r = marqueeRect(dk); const ids = [];
  for (const n of visibleLeaves()) { if (n.locked) continue; const a = boxAABB(cmd.boxOf(n)); if (a.x1 >= r.x0 && a.x0 <= r.x1 && a.y1 >= r.y0 && a.y0 <= r.y1) ids.push(n.id); }
  return [...new Set([...dk.base, ...ids])];
}

function onMove(e) {
  const p = screenPt(e); const d = toDoc(p.x, p.y);
  const inDoc = d.x >= 0 && d.y >= 0 && d.x < state.doc.w && d.y < state.doc.h;
  const val = inDoc ? valueAt(d.x, d.y) : null;
  const st = $('#stPos'); if (st) st.textContent = inDoc && val != null ? `x ${Math.floor(d.x)}  y ${Math.floor(d.y)}  value ${fmtDepth(val)}` : '–';
  if (!drag) {
    let cur = 'default'; const prim = primarySelected();
    if (spaceDown) cur = 'grab';
    else if (prim && state.sel.length === 1 && state.showOutlines && !prim.locked) { const b = cmd.boxOf(prim); const h = hitHandle(b, p.x, p.y); if (h) cur = h.rot ? 'crosshair' : 'nwse-resize'; else if (boxContains(b, d.x, d.y)) cur = 'move'; }
    if (cur !== hoverCursor) { hoverCursor = cur; cv.style.cursor = cur; }
    return;
  }
  const n = drag.id ? findNode(drag.id) : null;
  const uniform = n ? (n.lockAspect !== e.shiftKey) : e.shiftKey;
  switch (drag.kind) {
    case 'pan': { state.view.x = drag.vx + (p.x - drag.sx); state.view.y = drag.vy + (p.y - drag.sy); break; }
    case 'marquee': {
      drag.ex = d.x; drag.ey = d.y;
      if (Math.hypot(p.x - drag.spx, p.y - drag.spy) > 3) drag.moved = true;
      if (drag.moved) { const ids = marqueeSelection(drag); if (ids.join() !== state.sel.join()) cmd.select(ids); }
      break;
    }
    case 'move': {
      let dx = d.x - drag.sx, dy = d.y - drag.sy;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      drag.guides = [];
      if (!(e.ctrlKey || e.metaKey) && drag.aabb0) { const s = snapOffset(drag.aabb0, dx, dy, snapTargets(drag.ids), 6 / state.view.zoom); dx = s.dx; dy = s.dy; drag.guides = s.guides; }
      const mx = dx - drag.ax, my = dy - drag.ay;
      if (mx || my) { drag.moved = true; drag.ax = dx; drag.ay = dy; cmd.moveBy(drag.ids, mx, my, { transient: true }); }
      break;
    }
    case 'rotate': {
      const b = drag.box0; let rot = b.rot + (Math.atan2(d.y - b.y, d.x - b.x) - drag.a0) / DEG;
      if (e.shiftKey) rot = Math.round(rot / 15) * 15; rot = ((rot % 360) + 540) % 360 - 180;
      cmd.setBox(drag.id, { ...b, rot }, { transient: true }); break;
    }
    case 'scale': {
      const b = drag.box0, { hx, hy } = drag; const c = Math.cos(b.rot * DEG), s = Math.sin(b.rot * DEG);
      const toLocal = (px, py, ox, oy) => { const dx = px - ox, dy = py - oy; return { x: dx * c + dy * s, y: -dx * s + dy * c }; };
      let nb;
      if (e.altKey) {
        const l = toLocal(d.x, d.y, b.x, b.y); let w = hx ? Math.max(1, Math.abs(l.x) * 2) : b.w, h = hy ? Math.max(1, Math.abs(l.y) * 2) : b.h;
        if (uniform) { if (hx && hy) { const r = Math.max(w / b.w, h / b.h); w = b.w * r; h = b.h * r; } else if (hx) h = b.h * w / b.w; else w = b.w * h / b.h; }
        nb = { ...b, w, h };
      } else {
        const alx = -hx * b.w / 2, aly = -hy * b.h / 2; const ax = b.x + alx * c - aly * s, ay = b.y + alx * s + aly * c;
        const l = toLocal(d.x, d.y, ax, ay);
        let w = hx ? Math.max(1, l.x * hx) : b.w, h = hy ? Math.max(1, l.y * hy) : b.h;
        if (uniform) { if (hx && hy) { const r = Math.max(w / b.w, h / b.h); w = b.w * r; h = b.h * r; } else if (hx) h = b.h * w / b.w; else w = b.w * h / b.h; }
        const lx = hx * w / 2, ly = hy * h / 2; nb = { x: ax + lx * c - ly * s, y: ay + lx * s + ly * c, w, h, rot: b.rot };
      }
      cmd.setBox(drag.id, nb, { transient: true }); break;
    }
  }
}
function endDrag() {
  if (!drag) return; const dk = drag; drag = null;
  if (dk.kind === 'marquee') { if (!dk.moved) cmd.select(dk.base); return; }
  if (dk.kind === 'move' || dk.kind === 'rotate' || dk.kind === 'scale') commit();
}
