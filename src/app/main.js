// Application wiring: toolbar, keyboard, drag & drop, event dispatch, startup.
import { state, findNode, selectedNodes } from './state.js';
import * as cmd from './commands.js';
import { onChange } from './commands.js';
import { undo, redo, canUndo, canRedo, onHistory, commit } from './history.js';
import { invalidate, startLoop, pruneCaches, clearCaches } from './render.js';
import { importImageFile, importFontFile, openProjectFile, saveProject, newProject, autosave, restoreAutosave, registerImage, loadProject, renderFull } from './io.js';
import { serialize } from './state.js';
import { encodeGrayPNG } from '../engine/png.js';
import { toU16, toU8 } from '../engine/dither.js';
import { initCanvas, fitView, zoom100 } from '../ui/canvas.js';
import { initTree, buildTree, refreshSelection } from '../ui/tree.js';
import { initProps, buildProps, refreshProps } from '../ui/props.js';
import { initView3d, view3d } from '../ui/view3d.js';
import { initDialogs, documentDialog, exportDialog, helpDialog } from '../ui/dialogs.js';
import { ringPreset, rectPreset } from '../kinds/shape.js';
import '../kinds/group.js';
import '../kinds/mask.js';
import '../kinds/image.js';
import '../kinds/text.js';
import { $, setMsg, isInputFocused } from '../ui/dom.js';
import { UNITS } from './state.js';

let clipboard = null;

function refreshAll() { invalidate(); buildTree(); buildProps(); updateStatus(); updateButtons(); }
function updateStatus() { const d = state.doc; $('#stDoc').textContent = `Document ${d.w}×${d.h} · ${UNITS[d.unit] || d.unit} · ${(d.w * d.mmPerPx).toFixed(1)}×${(d.h * d.mmPerPx).toFixed(1)} mm`; $('#projName').value = state.name; }
function updateButtons() {
  $('#bUndo').disabled = !canUndo(); $('#bRedo').disabled = !canRedo();
  const n = state.sel.length; for (const b of document.querySelectorAll('.needsel')) b.disabled = n < 1;
  for (const b of document.querySelectorAll('.need2')) b.disabled = n < 2; for (const b of document.querySelectorAll('.need3')) b.disabled = n < 3;
  const one = n === 1 ? findNode(state.sel[0]) : null; $('#bUngroup').disabled = !(one && one.kind === 'group');
}

onChange(what => {
  if (what === 'render') { invalidate(); refreshProps(); }
  else if (what === 'tree') { invalidate(); buildTree(); buildProps(); updateButtons(); }
  else if (what === 'selection') { refreshSelection(); buildProps(); updateButtons(); }
  else if (what === 'props') buildProps();
  else if (what === 'doc') { invalidate(); updateStatus(); buildProps(); }
});
onHistory(kind => { if (kind === 'restore') { refreshAll(); } if (kind === 'commit') { pruneCaches(); autosave(); } updateButtons(); });

function wire() {
  $('#bNew').addEventListener('click', () => { if (state.root.children.length && !confirm('Start a new project? Unsaved changes will be lost.')) return; newProject(); refreshAll(); autosave(); });
  $('#bOpen').addEventListener('click', () => $('#fileProj').click());
  $('#fileProj').addEventListener('change', async e => { const f = e.target.files[0]; if (f) { try { await openProjectFile(f); refreshAll(); autosave(); } catch (err) { alert('Could not open project: ' + err.message); } } e.target.value = ''; });
  $('#bSave').addEventListener('click', saveProject);
  $('#projName').addEventListener('change', e => cmd.setName(e.target.value.trim()));
  $('#bImport').addEventListener('click', () => $('#fileImg').click());
  $('#fileImg').addEventListener('change', async e => { for (const f of Array.from(e.target.files)) { try { await importImageFile(f); } catch (err) { alert('Could not import image: ' + err.message); } } if (state.root.children.length === 1) fitView(); e.target.value = ''; });
  $('#fileFont').addEventListener('change', async e => { for (const f of Array.from(e.target.files)) { try { const name = await importFontFile(f); const n = selectedNodes()[0]; if (n && n.kind === 'text') cmd.setParam(n.id, 'family', name); buildProps(); } catch (err) { alert('Could not load font: ' + err.message); } } e.target.value = ''; });
  $('#bRect').addEventListener('click', () => { const n = cmd.add('shape'); rectPreset(n); cmd.setNodeProps(n.id, { name: 'Rect' }); });
  $('#bRing').addEventListener('click', () => { const n = cmd.add('shape'); ringPreset(n); cmd.setNodeProps(n.id, { name: 'Ring' }); });
  $('#bText').addEventListener('click', () => cmd.add('text'));
  $('#bMask').addEventListener('click', () => { const n = selectedNodes()[0]; if (n && n.kind !== 'mask') cmd.addMaskTo(n.id, 'ellipse'); else cmd.add('mask'); });
  $('#bGroup').addEventListener('click', () => cmd.group());
  $('#bUngroup').addEventListener('click', () => cmd.ungroup());
  $('#bUndo').addEventListener('click', undo); $('#bRedo').addEventListener('click', redo);
  $('#bFit').addEventListener('click', fitView); $('#bZoom1').addEventListener('click', zoom100);
  $('#previewMax').addEventListener('change', e => { state.previewMax = parseInt(e.target.value); clearCaches(); });
  $('#b3d').addEventListener('click', () => { $('#pane3d').classList.toggle('hidden'); $('#splitter').classList.toggle('hidden'); view3d.requestRender(); });
  $('#bExport').addEventListener('click', exportDialog);
  $('#bHelp').addEventListener('click', helpDialog);
  $('#stDoc').addEventListener('click', documentDialog);
  $('#bDoc').addEventListener('click', documentDialog);
  document.addEventListener('depthcad:documentDialog', documentDialog);
  $('#bUp').addEventListener('click', () => { for (const id of state.sel) cmd.moveInStack(id, 1); });
  $('#bDown').addEventListener('click', () => { for (const id of state.sel) cmd.moveInStack(id, -1); });
  $('#bDup').addEventListener('click', () => cmd.duplicate());
  $('#bDel').addEventListener('click', () => cmd.remove(state.sel));
  for (const b of document.querySelectorAll('[data-align]')) b.addEventListener('click', () => cmd.align(state.sel, b.dataset.align, state.sel.length === 1 ? 'document' : 'selection'));
  for (const b of document.querySelectorAll('[data-dist]')) b.addEventListener('click', () => cmd.distribute(state.sel, b.dataset.dist));
  $('#showOutlines').addEventListener('change', e => state.showOutlines = e.target.checked);

  // splitter
  const sp = $('#splitter'), p2 = $('#pane2d'), p3 = $('#pane3d'); let sd = null;
  sp.addEventListener('pointerdown', e => { sp.setPointerCapture(e.pointerId); sd = { x: e.clientX, w2: p2.getBoundingClientRect().width, w3: p3.getBoundingClientRect().width }; });
  sp.addEventListener('pointermove', e => { if (!sd) return; const dx = e.clientX - sd.x; const w2 = Math.min(Math.max(sd.w2 + dx, 150), sd.w2 + sd.w3 - 150); p2.style.flex = `0 0 ${w2}px`; p3.style.flex = '1 1 0'; view3d.resize(); });
  sp.addEventListener('pointerup', () => sd = null);
  new ResizeObserver(() => view3d.resize()).observe(p3);

  // drag & drop
  let depth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); depth++; $('#drop').classList.add('on'); });
  window.addEventListener('dragleave', e => { e.preventDefault(); if (--depth <= 0) { depth = 0; $('#drop').classList.remove('on'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; $('#drop').classList.remove('on');
    for (const f of Array.from(e.dataTransfer.files)) {
      try {
        if (/\.(json|dcad)$/i.test(f.name)) { await openProjectFile(f); refreshAll(); autosave(); }
        else if (/\.(ttf|otf|woff2?)$/i.test(f.name)) await importFontFile(f);
        else if (f.type.startsWith('image/')) { const first = !state.root.children.length; await importImageFile(f); if (first) fitView(); }
      } catch (err) { alert(err.message); }
    }
  });

  // keyboard
  window.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase(); const inInput = isInputFocused();
    if (mod && k === 's') { e.preventDefault(); saveProject(); return; }
    if (mod && k === 'o') { e.preventDefault(); $('#fileProj').click(); return; }
    if (mod && k === 'e') { e.preventDefault(); exportDialog(); return; }
    if (inInput) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'a') { e.preventDefault(); cmd.selectAll(); return; }
    if (mod && k === 'd') { e.preventDefault(); cmd.duplicate(); return; }
    if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? cmd.ungroup() : cmd.group(); return; }
    if (mod && k === 'c') { if (state.sel.length) { clipboard = cmd.copyNodes(); try { navigator.clipboard.writeText(JSON.stringify(clipboard)); } catch (err) { } setMsg('Copied'); } return; }
    if (mod && k === 'x') { if (state.sel.length) { clipboard = cmd.copyNodes(); cmd.remove(state.sel); setMsg('Cut'); } return; }
    if (mod && k === 'v') { e.preventDefault(); pasteFromClipboard(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (state.sel.length) cmd.remove(state.sel); return; }
    if (k === 'f' && !mod) { fitView(); return; }
    if (e.key === '1' && !mod) { zoom100(); return; }
    if (e.key === 'Escape') { cmd.select([]); return; }
    if (!state.sel.length) return;
    const step = e.shiftKey ? 10 : 1; let dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step; else if (e.key === 'ArrowRight') dx = step; else if (e.key === 'ArrowUp') dy = -step; else if (e.key === 'ArrowDown') dy = step; else return;
    e.preventDefault(); cmd.moveBy(state.sel, dx, dy, { transient: true }); refreshProps(); clearTimeout(window._nudgeT); window._nudgeT = setTimeout(commit, 400);
  });
}

async function pasteFromClipboard() {
  let payload = clipboard;
  try { const t = await navigator.clipboard.readText(); const p = JSON.parse(t); if (p && p.format === 'depthcad/nodes') payload = p; } catch (err) { }
  if (!payload) return;
  for (const [id, im] of Object.entries(payload.images || {})) if (!state.images[id]) { try { await registerImage(im.dataURL, id); } catch (err) { } }
  cmd.pasteNodes(JSON.parse(JSON.stringify(payload))); setMsg('Pasted');
}

// Debug / scripting API (also used by the headless tests)
window.depthcad = {
  state, cmd, undo, redo, commit, findNode, serialize, refreshAll, fitView, renderFull,
  io: { importImageFile, importFontFile, openProjectFile, saveProject, newProject, registerImage, loadProject },
  async encode16() { const out = renderFull(); return encodeGrayPNG(out.w, out.h, toU16(out.height), 16); },
  async encode8(dither = 'fs') { const out = renderFull(); return encodeGrayPNG(out.w, out.h, toU8(out.height, out.w, out.h, dither), 8); },
  toBase64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s); },
};

(async () => {
  initCanvas(); initTree(); initProps(); initView3d(); initDialogs(); wire();
  let restored = false;
  try { restored = await restoreAutosave(); if (restored) setMsg('Restored autosaved project'); } catch (e) { console.warn('autosave restore failed', e); }
  if (!restored) newProject();
  refreshAll(); fitView(); startLoop();
})();
