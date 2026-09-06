// Properties panel, generated from kind and modifier schemas.
import { state, findNode, selectedNodes, primarySelected, depthToDisplay, displayToDepth, depthStep, depthDecimals, UNITS } from '../app/state.js';
import * as cmd from '../app/commands.js';
import { KINDS, BLEND_MODES } from '../engine/kinds.js';
import { MODIFIERS } from '../engine/modifiers.js';
import { TEXT_LAYOUTS } from '../kinds/text.js';
import { fontPicker, listInstalledFonts } from './fontpicker.js';
import { openMeshImport } from './meshImport.js';
import { toolEditor, exportTool, saveToLibrary } from './tools.js';
import { $, el, btn } from './dom.js';
import { clamp } from '../engine/util.js';

let root; const tracked = [];
export function initProps() { root = $('#props'); }
export function refreshProps() {
  for (const [inp, get] of tracked) {
    const v = get(); if (inp.type === 'checkbox') { inp.checked = !!v; continue; }
    const s = typeof v === 'number' ? String(+v.toFixed(3)) : v;
    if (document.activeElement !== inp && inp.value !== s) inp.value = s;
  }
}

function section(title, extra) { const s = el('div', 'sec'); const h = el('h4', null, title); if (extra) h.appendChild(extra); s.appendChild(h); return s; }
function row(label, ...inputs) { const r = el('div', 'row'); r.append(el('label', null, label), ...inputs); return r; }
function numInput(get, set, opt = {}) {
  const i = document.createElement('input'); i.type = 'number'; i.className = 'n';
  if (opt.min != null) i.min = opt.min; if (opt.max != null) i.max = opt.max; i.step = opt.step || 1; i.value = +(+get()).toFixed(3);
  i.addEventListener('input', () => { const v = parseFloat(i.value); if (isNaN(v)) return; set(clamp(v, opt.min ?? -1e9, opt.max ?? 1e9), true); if (opt.after) opt.after(); });
  i.addEventListener('change', () => { const v = parseFloat(i.value); if (!isNaN(v)) set(clamp(v, opt.min ?? -1e9, opt.max ?? 1e9), false); refreshProps(); });
  tracked.push([i, get]); return i;
}
function sliderRow(label, get, set, min, max, step) {
  const r = el('div', 'row'); const s = document.createElement('input'); s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = get();
  const n = numInput(get, set, { min, max, step, after: () => { s.value = get(); } }); n.style.width = '64px';
  s.addEventListener('input', () => { set(parseFloat(s.value), true); n.value = +(+get()).toFixed(3); });
  s.addEventListener('change', () => set(parseFloat(s.value), false));
  tracked.push([s, get]); r.append(el('label', null, label), s, n); return r;
}
function checkRow(label, get, set) { const r = el('div', 'row'); const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!get(); c.addEventListener('change', () => set(c.checked, false)); const l = el('label', 'wide'); l.append(c, ' ' + label); r.append(l); tracked.push([c, get]); return r; }
function selectRow(label, get, set, options) { const r = el('div', 'row'); const s = document.createElement('select'); for (const [k, v] of Object.entries(options)) { const o = el('option', null, v); o.value = k; s.appendChild(o); } s.value = get(); s.addEventListener('change', () => set(s.value, false)); s.style.flex = '1'; r.append(el('label', null, label), s); tracked.push([s, get]); return r; }
function textArea(get, set) { const t = document.createElement('textarea'); t.rows = 3; t.value = get(); t.spellcheck = false; t.addEventListener('input', () => set(t.value, true)); t.addEventListener('change', () => set(t.value, false)); tracked.push([t, get]); return t; }

// Generic field for a schema entry. get/set operate on the raw stored value.
function schemaField(key, s, get, set, params) {
  const label = s.label || key;
  switch (s.type) {
    case 'bool': return checkRow(label, get, set);
    case 'enum': return selectRow(label, () => String(get()), v => set(v), s.options);
    case 'int': case 'number': {
      const k = s.scale || 1;
      if (s.slider) return sliderRow(label, () => get() * k, (v, t) => set(v / k, t), s.min ?? 0, s.max ?? 100, s.step ?? 1);
      return row(label, numInput(() => get() * k, (v, t) => set(v / k, t), { min: s.min, max: s.max, step: s.step }));
    }
    case 'depth': {
      const maxD = depthToDisplay(1), minD = s.min != null ? depthToDisplay(s.min) : 0, step = depthStep();
      return sliderRow(label, () => +depthToDisplay(get()).toFixed(depthDecimals()), (v, t) => set(displayToDepth(v), t), minD, maxD, step);
    }
    case 'text': { const w = el('div'); w.appendChild(el('label', null, label)); w.appendChild(textArea(get, set)); return w; }
    case 'font': { const r = el('div', 'row'); r.append(el('label', null, label), fontPicker(get, set)); const b = el('div', 'btnrow'); b.append(btn('Load font file…', () => $('#fileFont').click()), btn('List installed fonts', listInstalledFonts)); const w = el('div'); w.append(r, b); return w; }
    case 'layout': { const opts = Object.fromEntries(Object.entries(TEXT_LAYOUTS).map(([k, v]) => [k, v.label || k])); return selectRow(label, () => get().kind, v => set({ ...get(), kind: v }), opts); }
    case 'curve': return curveEditor(label, get, set);
    default: return row(label, numInput(get, set));
  }
}

// Small curve editor: drag points, click to add, double-click a point to remove.
function curveEditor(label, get, set) {
  const w = el('div'); w.appendChild(el('label', null, label));
  const cv = document.createElement('canvas'); cv.width = 260; cv.height = 160; cv.className = 'curve'; w.appendChild(cv);
  const ctx = cv.getContext('2d'); let pts = get().map(p => [...p]); let dragI = -1;
  const toPx = p => [10 + p[0] * 240, 150 - p[1] * 140]; const fromPx = (x, y) => [clamp((x - 10) / 240, 0, 1), clamp((150 - y) / 140, 0, 1)];
  const draw = () => {
    ctx.clearRect(0, 0, 260, 160); ctx.fillStyle = '#17181b'; ctx.fillRect(0, 0, 260, 160);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; for (let i = 0; i <= 4; i++) { const x = 10 + i * 60, y = 10 + i * 35; ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, 150); ctx.stroke(); ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(250, y); ctx.stroke(); }
    const s = pts.slice().sort((a, b) => a[0] - b[0]); ctx.strokeStyle = '#4c9aff'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(...toPx([0, s[0][1]])); for (const p of s) ctx.lineTo(...toPx(p)); ctx.lineTo(...toPx([1, s[s.length - 1][1]])); ctx.stroke();
    ctx.fillStyle = '#fff'; for (const p of pts) { const [x, y] = toPx(p); ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
  };
  const hit = (x, y) => pts.findIndex(p => { const [px, py] = toPx(p); return Math.hypot(px - x, py - y) < 8; });
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); let i = hit(x, y); if (i < 0) { pts.push(fromPx(x, y)); i = pts.length - 1; } dragI = i; draw(); });
  cv.addEventListener('pointermove', e => { if (dragI < 0) return; const [x, y] = pos(e); pts[dragI] = fromPx(x, y); draw(); set(pts.map(p => [...p]), true); });
  cv.addEventListener('pointerup', () => { if (dragI < 0) return; dragI = -1; set(pts.map(p => [...p]), false); });
  cv.addEventListener('dblclick', e => { const [x, y] = pos(e); const i = hit(x, y); if (i >= 0 && pts.length > 2) { pts.splice(i, 1); draw(); set(pts.map(p => [...p]), false); } });
  const b = el('div', 'btnrow'); b.append(btn('Reset', () => { pts = [[0, 0], [1, 1]]; draw(); set(pts.map(p => [...p]), false); }), btn('Invert', () => { pts = pts.map(p => [p[0], 1 - p[1]]); draw(); set(pts.map(p => [...p]), false); }), btn('Ease', () => { pts = [[0, 0], [0.25, 0.1], [0.75, 0.9], [1, 1]]; draw(); set(pts.map(p => [...p]), false); }));
  w.appendChild(b); w.appendChild(el('div', 'hint', 'Input height (left→right) to output height (bottom→top). Click to add a point, drag to move, double-click to remove.'));
  draw(); return w;
}

export function buildProps() {
  tracked.length = 0; root.innerHTML = '';
  const sel = selectedNodes();
  if (!sel.length) {
    const h = el('div', 'hint'); h.style.padding = '10px';
    h.innerHTML = 'Select a layer to edit its properties.<br><br>';
    h.appendChild(btn(`Document: ${state.doc.w}×${state.doc.h}, ${UNITS[state.doc.unit] || state.doc.unit}…`, () => document.dispatchEvent(new CustomEvent('depthcad:documentDialog')), ''));
    root.appendChild(h); return;
  }
  if (sel.length > 1) { multiProps(sel); return; }
  const n = sel[0]; const def = KINDS[n.kind]; const id = n.id;
  const P = (key) => n.params[key];
  const setP = (key) => (v, t) => cmd.setParam(id, key, v, { transient: t });

  // ---- header
  const hs = section(def.label + (def.isMask ? '' : ' layer'));
  const nr = el('div', 'row'); const ni = document.createElement('input'); ni.type = 'text'; ni.value = n.name; ni.style.flex = '1';
  ni.addEventListener('change', () => cmd.setNodeProps(id, { name: ni.value })); nr.append(el('label', null, 'Name'), ni); hs.appendChild(nr);
  const vr = el('div', 'row'); vr.append(checkRow('Visible', () => n.visible, v => cmd.setNodeProps(id, { visible: v })).firstChild, checkRow('Locked', () => n.locked, v => cmd.setNodeProps(id, { locked: v })).firstChild); hs.appendChild(vr);
  if (!def.isMask) hs.appendChild(selectRow('Blend', () => n.blend, v => cmd.setNodeProps(id, { blend: v }), BLEND_MODES));
  root.appendChild(hs);

  // ---- transform
  const ts = section('Transform'); const g = el('div', 'grid2');
  const box = () => cmd.boxOf(n);
  const setB = (patch) => (v, t) => { const b = box(); const nb = { ...b, ...patch(v, b) }; cmd.setBox(id, nb, { transient: t }); };
  const mk = (lbl, get, set, opt) => { const r = el('div', 'row'); r.append(el('label', null, lbl), numInput(get, set, opt)); return r; };
  g.append(mk('X', () => box().x, setB(v => ({ x: v }))), mk('Y', () => box().y, setB(v => ({ y: v }))));
  const wr = mk('W', () => box().w, setB((v, b) => n.lockAspect ? { w: v, h: b.h * v / b.w } : { w: v }), { min: 1 });
  const lock = btn(n.lockAspect ? '🔒' : '🔓', () => { cmd.setNodeProps(id, { lockAspect: !n.lockAspect }); buildProps(); }, 'small lockbtn', 'Lock aspect ratio');
  wr.appendChild(lock);
  g.append(wr, mk('H', () => box().h, setB((v, b) => n.lockAspect ? { h: v, w: b.w * v / b.h } : { h: v }), { min: 1 }));
  if (n.kind !== 'group') g.append(mk('Rot', () => n.rot, (v, t) => cmd.setTransform(id, { rot: v }, { transient: t }), { step: 0.5 }));
  if (!def.sizeInParams && n.kind !== 'group') g.append(mk('%', () => n.sx * 100, (v, t) => cmd.setTransform(id, n.lockAspect ? { sx: v / 100, sy: v / 100 } : { sx: v / 100 }, { transient: t }), { min: 0.1, step: 1 }));
  ts.appendChild(g);
  const tb = el('div', 'btnrow');
  tb.append(btn('Center', () => cmd.centerInDoc([id])), btn('Fit to doc', () => cmd.fitToDoc(id, false)), btn('Fill doc', () => cmd.fitToDoc(id, true)));
  if (n.kind !== 'group') tb.append(btn('Reset', () => cmd.setTransform(id, { rot: 0, ...(def.sizeInParams ? {} : { sx: 1, sy: 1 }) })));
  if (!def.isMask) tb.append(btn('Add mask', () => cmd.addMaskTo(id, 'ellipse'), 'small', 'Wrap this layer in a group with an elliptical mask'));
  ts.appendChild(tb); root.appendChild(ts);

  // ---- kind parameters
  const entries = Object.entries(def.schema || {}).filter(([k, s]) => !s.hidden && (!s.showIf || s.showIf(n.params)));
  if (entries.length) {
    const ks = section(def.isMask ? 'Mask' : def.label);
    for (const [key, s] of entries) {
      const f = schemaField(key, s, () => P(key), (v, t) => { setP(key)(v, t); if (!t && (s.type === 'enum' || s.type === 'bool')) buildProps(); }, n.params);
      ks.appendChild(f);
    }
    if (def.hint) ks.appendChild(el('div', 'hint', def.hint));
    root.appendChild(ks);
  } else if (def.hint) { const ks = section(def.label); ks.appendChild(el('div', 'hint', def.hint)); root.appendChild(ks); }
  if (n.kind === 'image') { const im = state.images[n.params.imageId]; if (im) root.lastChild.insertBefore(el('div', 'hint', `Source ${im.w}×${im.h}, ${im.bits}-bit`), root.lastChild.children[1]); }
  if (def.isTool) {
    const ts2 = section('Tool'); const t = def.tool;
    if (n._error) ts2.appendChild(el('div', 'hint', 'Render error: ' + n._error)).style.color = '#e0575b';
    const tb2 = el('div', 'btnrow'); tb2.append(btn('Edit tool…', () => toolEditor(t, () => buildProps())), btn('Export tool', () => exportTool(t)), btn('Save to my tools', () => saveToLibrary(t))); ts2.appendChild(tb2);
    root.appendChild(ts2);
  }
  if (n.kind === 'mesh') {
    const ms = section('Mesh'); const m = state.meshes[n.params.meshId]; const b = n.params.bake || {};
    ms.appendChild(el('div', 'hint', m ? `${m.name}: ${m.triangles.toLocaleString()} triangles. Baked ${b.w}×${b.h}, angles ${(b.rot || []).map(v => +v.toFixed(1)).join(' / ')}, near ${(+b.near).toFixed(3)}, far ${(+b.far).toFixed(3)}.` : 'The source mesh is not in this project (it was not embedded), so the layer cannot be re-baked.'));
    const mb = el('div', 'btnrow'); if (m) mb.appendChild(btn('Re-bake…', () => openMeshImport({ meshId: n.params.meshId, nodeId: n.id }), 'primary small'));
    mb.appendChild(checkRow('Embed mesh in project file', () => n.params.embed !== false, v => cmd.setParam(id, 'embed', v)).firstChild); ms.appendChild(mb);
    root.appendChild(ms);
  }

  // ---- modifiers
  const addSel = document.createElement('select'); addSel.className = 'small';
  const o0 = el('option', null, '+ Add modifier…'); o0.value = ''; addSel.appendChild(o0);
  for (const [k, d] of Object.entries(MODIFIERS)) { const o = el('option', null, d.label); o.value = k; addSel.appendChild(o); }
  addSel.addEventListener('change', () => { if (addSel.value) { cmd.addModifier(id, addSel.value); } addSel.value = ''; });
  const ms = section('Modifiers', addSel);
  if (!n.modifiers.length) ms.appendChild(el('div', 'hint', n.kind === 'group' ? 'Modifiers on a group apply to everything inside it.' : 'Levels, Curve, Clamp, Feather, Blur and Offset are applied in order.'));
  n.modifiers.forEach((m, i) => {
    const d = MODIFIERS[m.kind]; if (!d) return;
    const box = el('div', 'modbox' + (m.enabled === false ? ' off' : '')); const hdr = el('div', 'hdr');
    const en = document.createElement('input'); en.type = 'checkbox'; en.checked = m.enabled !== false; en.addEventListener('change', () => cmd.setModifier(id, i, { enabled: en.checked }));
    hdr.append(en, el('span', 't', d.label), btn('▲', () => cmd.moveModifier(id, i, -1)), btn('▼', () => cmd.moveModifier(id, i, 1)), btn('✕', () => cmd.removeModifier(id, i), 'small danger'));
    box.appendChild(hdr);
    for (const [key, s] of Object.entries(d.schema)) box.appendChild(schemaField(key, s, () => m[key], (v, t) => cmd.setModifier(id, i, { [key]: v }, { transient: t })));
    ms.appendChild(box);
  });
  root.appendChild(ms);
}

function multiProps(sel) {
  const s = section(`${sel.length} layers selected`);
  s.appendChild(el('div', 'hint', 'Use the align and distribute buttons in the toolbar, or group the selection.'));
  const b = el('div', 'btnrow'); b.append(btn('Group', () => cmd.group()), btn('Duplicate', () => cmd.duplicate()), btn('Delete', () => cmd.remove(state.sel), 'small danger'));
  s.appendChild(b); root.appendChild(s);
}
