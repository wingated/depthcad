// Edge profile picker and editor. Profiles are documents (engine/profile.js); custom ones
// live in the project, in the user's library (IndexedDB) and as .profile.json files.
import { state } from '../app/state.js';
import { commit } from '../app/history.js';
import { clearCaches, invalidate } from '../app/render.js';
import { idb } from '../app/io.js';
import { BUILTIN_PROFILES, SEGMENT_KINDS, newProfile, validateProfile, sampleSegment, sampleProfile, defaultHandles, profileKey } from '../engine/profile.js';
import { openModal, closeModal } from './dialogs.js';
import { $, el, btn, setMsg, downloadBlob, readAsText } from './dom.js';
import { clamp, clamp01, deepClone } from '../engine/util.js';

let library = {};
export async function loadProfileLibrary() { try { library = (await idb.get('profiles')) || {}; } catch (e) { library = {}; } }
async function saveLibrary() { try { await idb.set('profiles', library); } catch (e) { } }
export function libraryProfiles() { return library; }
function strip(doc) { return JSON.parse(JSON.stringify(doc, (k, v) => k.startsWith('_') ? undefined : v)); }

export function allProfileGroups() {
  const builtin = Object.values(BUILTIN_PROFILES).filter(p => !p.example), examples = Object.values(BUILTIN_PROFILES).filter(p => p.example);
  return [['Built-in', builtin], ['In this project', Object.values(state.profiles)], ['My profiles', Object.values(library).filter(p => !state.profiles[p.id])], ['Examples', examples]];
}
export function installProfile(doc, { toLibrary = false } = {}) {
  const errors = validateProfile(doc); if (errors.length) throw new Error(errors.join('; '));
  state.profiles[doc.id] = doc; if (toLibrary) { library[doc.id] = strip(doc); saveLibrary(); }
  clearCaches(); return doc;
}
export function exportProfile(doc) { downloadBlob(new Blob([JSON.stringify(strip(doc), null, 2)], { type: 'application/json' }), doc.id + '.profile.json'); }

// Picker control for the properties panel: get() -> id, set(id, transient)
export function profilePicker(get, set, tracked) {
  const wrap = el('div', 'row'); const s = document.createElement('select'); s.style.flex = '1';
  const fill = () => {
    s.innerHTML = '';
    for (const [title, list] of allProfileGroups()) { if (!list.length) continue; const g = document.createElement('optgroup'); g.label = title; for (const p of list) { const o = el('option', null, p.name); o.value = p.id; g.appendChild(o); } s.appendChild(g); }
    const o = el('option', null, 'New profile…'); o.value = '__new'; s.appendChild(o);
    const o2 = el('option', null, 'Import profile file…'); o2.value = '__import'; s.appendChild(o2);
    s.value = get(); if (s.value !== get()) { s.value = 'flat'; }
  };
  fill();
  s.addEventListener('change', () => {
    if (s.value === '__new') { fill(); openProfileEditor(newProfile('My profile', BUILTIN_PROFILES[get()] || BUILTIN_PROFILES.dome), { onApply: d => { set(d.id, false); }, live: d => { installProfile(d); set(d.id, true); } }); return; }
    if (s.value === '__import') { fill(); importProfileFile().then(d => { if (d) set(d.id, false); }); return; }
    const id = s.value; if (library[id] && !state.profiles[id] && !BUILTIN_PROFILES[id]) installProfile(deepClone(library[id]));
    set(id, false);
  });
  const edit = btn('Edit…', () => { const cur = state.profiles[get()] || BUILTIN_PROFILES[get()]; if (!cur) return;
    if (cur.builtin) { const d = newProfile(cur.name + ' copy', cur); openProfileEditor(d, { onApply: dd => set(dd.id, false), live: dd => { installProfile(dd); set(dd.id, true); } }); }
    else openProfileEditor(cur, { onApply: () => { clearCaches(); set(cur.id, false); }, live: () => { clearCaches(); set(cur.id, true); } }); }, 'small', 'Edit this profile (a built-in one is copied first)');
  wrap.append(s, edit); if (tracked) tracked.push([s, get]);
  return wrap;
}
async function importProfileFile() {
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
    inp.addEventListener('change', async () => { try { const d = JSON.parse(await readAsText(inp.files[0])); installProfile(d, { toLibrary: true }); setMsg(`Profile "${d.name}" imported`); resolve(d); } catch (e) { alert('Could not import profile: ' + e.message); resolve(null); } });
    inp.click();
  });
}

// ---------------------------------------------------------------- editor
const W = 560, H = 340, PAD = 30;
export function openProfileEditor(doc, { onApply = null, live = null } = {}) {
  const original = strip(doc); let selSeg = 0, selPt = -1, drag = null;
  const wrap = el('div', 'profwrap');
  const left = el('div', 'mcol'); const right = el('div', 'mcol'); right.style.flex = '0 0 250px';
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.className = 'profcv'; left.appendChild(cv);
  left.appendChild(el('div', 'hint', 'Left = inside of the shape (full height), right = edge. Drag points and handles; click a segment to select it and change its kind; double-click a segment to split it. Shift snaps to the grid.'));
  const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.value = doc.name; nameIn.style.width = '100%'; nameIn.addEventListener('input', () => { doc.name = nameIn.value; });
  right.append(el('label', null, 'Name'), nameIn);
  right.appendChild(el('label', null, 'Selected segment'));
  const kindRow = el('div', 'btnrow'); const kindBtns = {};
  for (const [k, l] of Object.entries(SEGMENT_KINDS)) { const b = btn(l, () => { const s = doc.segments[selSeg]; if (!s) return; s.kind = k; if (k === 'bezier' && !s.c1) Object.assign(s, defaultHandles(doc.points[selSeg], doc.points[selSeg + 1])); changed(); }); kindBtns[k] = b; kindRow.appendChild(b); }
  right.appendChild(kindRow);
  const opRow = el('div', 'btnrow');
  opRow.append(btn('Split segment', () => splitSegment(selSeg)), btn('Delete point', () => deletePoint(selPt >= 0 ? selPt : selSeg + 1), 'small danger'), btn('Reset to line', () => { const a = doc.points[0], b = doc.points[doc.points.length - 1]; doc.points = [a, b]; doc.segments = [{ kind: 'line' }]; selSeg = 0; selPt = -1; changed(); }));
  right.appendChild(opRow);
  right.appendChild(el('label', null, 'Start from'));
  const presetRow = el('div', 'btnrow');
  for (const p of Object.values(BUILTIN_PROFILES)) presetRow.appendChild(btn(p.name, () => { doc.points = p.points.map(q => ({ ...q })); doc.segments = p.segments.map(s => ({ ...s })); selSeg = 0; selPt = -1; changed(); }));
  right.appendChild(presetRow);
  const ioRow = el('div', 'btnrow'); ioRow.append(btn('Export file', () => exportProfile(doc)), btn('Import file', async () => { const d = await importProfileFile(); if (d) { doc.points = d.points; doc.segments = d.segments; doc.name = d.name; nameIn.value = d.name; changed(); } }));
  right.appendChild(ioRow);
  const libChk = document.createElement('input'); libChk.type = 'checkbox'; libChk.checked = true; const ll = el('label', 'wide'); ll.append(libChk, ' Also save to my profiles'); right.appendChild(ll);
  const status = el('div', 'hint'); right.appendChild(status);
  wrap.append(left, right);
  openModal('Edge profile', wrap, [
    btn('Cancel', () => { Object.assign(doc, original); closeModal(); if (live) live(doc); }, ''),
    btn('Save', () => { const errs = validateProfile(doc); if (errs.length) { status.textContent = errs.join('; '); return; } installProfile(doc, { toLibrary: libChk.checked }); closeModal(); if (onApply) onApply(doc); commit(); setMsg(`Profile "${doc.name}" saved`); }, 'primary'),
  ], () => $('#modalBox').classList.remove('wide'));
  $('#modalBox').classList.add('wide');

  const toPx = p => ({ x: PAD + p.x * (W - 2 * PAD), y: PAD + (1 - p.y) * (H - 2 * PAD) });
  const fromPx = (x, y) => ({ x: clamp01((x - PAD) / (W - 2 * PAD)), y: clamp01(1 - (y - PAD) / (H - 2 * PAD)) });
  function changed() { doc._lut = null; draw(); if (live) live(doc); }
  function splitSegment(i) {
    const s = doc.segments[i]; if (!s) return; const a = doc.points[i], b = doc.points[i + 1];
    const mid = sampleSegment(s.kind, a, b, s, 16)[8] || { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    doc.points.splice(i + 1, 0, { x: mid.x, y: mid.y }); const k = s.kind === 'bezier' ? 'line' : s.kind;
    doc.segments.splice(i, 1, { kind: k }, { kind: k }); selSeg = i + 1; selPt = i + 1; changed();
  }
  function deletePoint(i) { if (i <= 0 || i >= doc.points.length - 1) return; doc.points.splice(i, 1); const k = doc.segments[i - 1].kind; doc.segments.splice(i - 1, 2, { kind: k === 'bezier' ? 'line' : k }); selSeg = Math.max(0, i - 1); selPt = -1; changed(); }
  function draw() {
    const c = cv.getContext('2d'); c.clearRect(0, 0, W, H); c.fillStyle = '#17181b'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#2c2d32'; c.lineWidth = 1;
    for (let i = 0; i <= 10; i++) { const x = PAD + i * (W - 2 * PAD) / 10, y = PAD + i * (H - 2 * PAD) / 10; c.beginPath(); c.moveTo(x, PAD); c.lineTo(x, H - PAD); c.stroke(); c.beginPath(); c.moveTo(PAD, y); c.lineTo(W - PAD, y); c.stroke(); }
    c.strokeStyle = '#555'; c.strokeRect(PAD + 0.5, PAD + 0.5, W - 2 * PAD, H - 2 * PAD);
    c.fillStyle = '#8f9096'; c.font = '11px sans-serif'; c.fillText('inside', PAD, H - 10); c.textAlign = 'right'; c.fillText('edge', W - PAD, H - 10); c.textAlign = 'left'; c.fillText('high', 4, PAD + 4); c.fillText('low', 4, H - PAD + 4);
    // cross-section fill
    const s = sampleProfile(doc, 48); c.beginPath(); c.moveTo(PAD, H - PAD); for (const p of s) { const q = toPx(p); c.lineTo(q.x, q.y); } c.lineTo(W - PAD, H - PAD); c.closePath(); c.fillStyle = 'rgba(120,130,150,.22)'; c.fill();
    // segments
    for (let i = 0; i < doc.segments.length; i++) {
      const seg = doc.segments[i]; const pts = sampleSegment(seg.kind, doc.points[i], doc.points[i + 1], seg, 48);
      c.beginPath(); pts.forEach((p, k) => { const q = toPx(p); k ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }); c.strokeStyle = i === selSeg ? '#ffb347' : '#4c9aff'; c.lineWidth = i === selSeg ? 3 : 2; c.stroke();
      if (seg.kind === 'bezier') { const h = seg.c1 ? seg : defaultHandles(doc.points[i], doc.points[i + 1]); const a = toPx(doc.points[i]), b = toPx(doc.points[i + 1]), c1 = toPx(h.c1), c2 = toPx(h.c2); c.setLineDash([3, 3]); c.strokeStyle = '#8fd18f'; c.lineWidth = 1; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(c1.x, c1.y); c.moveTo(b.x, b.y); c.lineTo(c2.x, c2.y); c.stroke(); c.setLineDash([]); c.fillStyle = '#8fd18f'; c.fillRect(c1.x - 4, c1.y - 4, 8, 8); c.fillRect(c2.x - 4, c2.y - 4, 8, 8); }
    }
    doc.points.forEach((p, i) => { const q = toPx(p); c.beginPath(); c.arc(q.x, q.y, 6, 0, Math.PI * 2); c.fillStyle = i === selPt ? '#ffb347' : '#fff'; c.fill(); c.strokeStyle = '#333'; c.lineWidth = 1; c.stroke(); });
    for (const [k, b] of Object.entries(kindBtns)) b.classList.toggle('primary', doc.segments[selSeg] && doc.segments[selSeg].kind === k);
  }
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  function hitPoint(m) { for (let i = doc.points.length - 1; i >= 0; i--) { const q = toPx(doc.points[i]); if (Math.hypot(q.x - m.x, q.y - m.y) < 9) return i; } return -1; }
  function hitHandle(m) { for (let i = 0; i < doc.segments.length; i++) { const s = doc.segments[i]; if (s.kind !== 'bezier') continue; if (!s.c1) Object.assign(s, defaultHandles(doc.points[i], doc.points[i + 1])); for (const key of ['c1', 'c2']) { const q = toPx(s[key]); if (Math.abs(q.x - m.x) < 7 && Math.abs(q.y - m.y) < 7) return { i, key }; } } return null; }
  function hitSegment(m) { let best = -1, bd = 8; for (let i = 0; i < doc.segments.length; i++) { const pts = sampleSegment(doc.segments[i].kind, doc.points[i], doc.points[i + 1], doc.segments[i], 32).map(toPx); for (let k = 1; k < pts.length; k++) { const d = distToSeg(m, pts[k - 1], pts[k]); if (d < bd) { bd = d; best = i; } } } return best; }
  function distToSeg(m, a, b) { const dx = b.x - a.x, dy = b.y - a.y; const t = clamp01(((m.x - a.x) * dx + (m.y - a.y) * dy) / ((dx * dx + dy * dy) || 1e-9)); return Math.hypot(m.x - a.x - dx * t, m.y - a.y - dy * t); }
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); const m = pos(e);
    const pi = hitPoint(m); if (pi >= 0) { selPt = pi; selSeg = Math.min(pi, doc.segments.length - 1); drag = { kind: 'point', i: pi }; draw(); return; }
    const hh = hitHandle(m); if (hh) { selSeg = hh.i; selPt = -1; drag = { kind: 'handle', ...hh }; draw(); return; }
    const si = hitSegment(m); if (si >= 0) { selSeg = si; selPt = -1; draw(); }
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) return; const m = pos(e); let p = fromPx(m.x, m.y);
    if (e.shiftKey) p = { x: Math.round(p.x * 20) / 20, y: Math.round(p.y * 20) / 20 };
    if (drag.kind === 'point') { const i = drag.i; const pt = doc.points[i]; pt.y = p.y; if (i > 0 && i < doc.points.length - 1) pt.x = clamp(p.x, doc.points[i - 1].x, doc.points[i + 1].x); }
    else { doc.segments[drag.i][drag.key] = p; }
    changed();
  });
  const end = () => { drag = null; }; cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('dblclick', e => { const m = pos(e); const si = hitSegment(m); if (si >= 0) splitSegment(si); });
  window.addEventListener('keydown', function onKey(e) { if (!$('#modal').classList.contains('on')) { window.removeEventListener('keydown', onKey); return; } if ((e.key === 'Delete' || e.key === 'Backspace') && selPt > 0 && document.activeElement !== nameIn) { e.preventDefault(); deletePoint(selPt); } });
  draw();
}
