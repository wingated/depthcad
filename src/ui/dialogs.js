// Modal dialogs: document settings, export, help.
import { state, UNITS } from '../app/state.js';
import * as cmd from '../app/commands.js';
import { exportPNG } from '../app/io.js';
import { $, el, btn, setMsg } from './dom.js';

let onCloseCb = null;
export function openModal(title, body, buttons = [], onClose = null) {
  if (onCloseCb) { const f = onCloseCb; onCloseCb = null; f(); }
  onCloseCb = onClose;
  const m = $('#modal'); const box = $('#modalBox'); box.innerHTML = '';
  box.appendChild(el('h3', null, title)); box.appendChild(body);
  const row = el('div', 'btnrow'); row.style.justifyContent = 'flex-end';
  for (const b of buttons) row.appendChild(b); box.appendChild(row);
  m.classList.add('on');
  return { close: closeModal };
}
export function closeModal() { $('#modal').classList.remove('on'); if (onCloseCb) { const f = onCloseCb; onCloseCb = null; f(); } }
export function initDialogs() { $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); }); }

function field(label, input) { const r = el('div', 'row'); const l = el('label', null, label); l.style.width = '120px'; r.append(l, input); return r; }
function num(v, min, max, step = 1) { const i = document.createElement('input'); i.type = 'number'; i.value = v; if (min != null) i.min = min; if (max != null) i.max = max; i.step = step; i.style.width = '110px'; return i; }
function sel(options, v) { const s = document.createElement('select'); for (const [k, l] of Object.entries(options)) { const o = el('option', null, l); o.value = k; s.appendChild(o); } s.value = v; return s; }

export function documentDialog() {
  const d = state.doc; const body = el('div');
  const w = num(d.w, 1, 16384), h = num(d.h, 1, 16384), bg = num(Math.round(d.bg * 65535), 0, 65535), unit = sel(UNITS, d.unit), mmpp = num(d.mmPerPx, 0.0001, 100, 0.001), depth = num(d.depthMm, 0.01, 1000, 0.01);
  body.append(field('Width (px)', w), field('Height (px)', h), field('Background (0–65535)', bg), field('Display values as', unit), field('mm per pixel', mmpp), field('Full depth (mm)', depth));
  body.appendChild(el('div', 'hint', 'Values are stored as normalized 16-bit depth; the display unit only changes how numbers are shown. Full depth is the engraving depth that a value of 65535 corresponds to, used for the millimetre display.'));
  const info = el('div', 'hint'); const upd = () => { info.textContent = `${(w.value * mmpp.value).toFixed(1)} × ${(h.value * mmpp.value).toFixed(1)} mm at ${mmpp.value} mm/px`; }; upd();
  for (const i of [w, h, mmpp]) i.addEventListener('input', upd); body.appendChild(info);
  openModal('Document settings', body, [
    btn('Cancel', closeModal, ''),
    btn('Apply', () => { cmd.setDocument({ w: Math.round(+w.value) || d.w, h: Math.round(+h.value) || d.h, bg: Math.min(1, Math.max(0, (+bg.value || 0) / 65535)), unit: unit.value, mmPerPx: +mmpp.value || d.mmPerPx, depthMm: +depth.value || d.depthMm }); closeModal(); }, 'primary'),
  ]);
}

export function exportDialog() {
  const body = el('div');
  const bits = sel({ 8: '8-bit grayscale PNG', 16: '16-bit grayscale PNG' }, '8');
  const dither = sel({ fs: 'Floyd–Steinberg (recommended)', ordered: 'Ordered (Bayer 8×8)', none: 'None' }, 'fs');
  const name = document.createElement('input'); name.type = 'text'; name.value = state.name || 'depthmap'; name.style.width = '220px';
  const dRow = field('Dither', dither);
  bits.addEventListener('change', () => { dRow.style.display = bits.value === '8' ? '' : 'none'; });
  body.append(field('File name', name), field('Format', bits), dRow);
  body.appendChild(el('div', 'hint', `Exports the document at full resolution (${state.doc.w}×${state.doc.h}). 0 is deepest, maximum is highest. Dithering hides 8-bit banding in gradients; pixels that already sit on an exact 8-bit level (flat shapes) are left untouched.`));
  const status = el('div', 'hint'); body.appendChild(status);
  openModal('Export PNG', body, [
    btn('Cancel', closeModal, ''),
    btn('Export', async () => { status.textContent = 'Rendering…'; try { await exportPNG({ bits: +bits.value, dither: dither.value, name: name.value.trim() }); closeModal(); } catch (e) { status.textContent = 'Export failed: ' + e.message; } }, 'primary'),
  ]);
}

export function helpDialog() {
  const body = el('div', 'hint'); body.style.whiteSpace = 'pre-wrap';
  body.innerHTML = `Build depth maps for laser engraving by compositing layers. 0 is deepest, the maximum value is highest.

<b>Layers</b> composite bottom-to-top with a per-pixel <b>max</b> ("Union"), so overlapping geometry intersects realistically. Other blend modes: <b>Clamp</b> (min), <b>Replace</b>, <b>Cut</b> (erase everything below inside the layer), <b>Keep</b> (erase everything below outside it).

<b>Groups</b> nest layers; moving a group moves its contents. <b>Masks</b> are layers of their own: a mask clips every layer above it in the same group. "Add mask" on a layer wraps it in a group with a mask.

<b>Modifiers</b> (Levels, Curve, Clamp, Feather, Blur, Offset) are applied per layer, in order. A modifier on a group acts on everything in it.

<b>Canvas</b>: drag a layer to move it, drag handles to scale (<kbd>Shift</kbd> toggles the aspect lock, <kbd>Alt</kbd> scales about the centre), drag the round handle to rotate (<kbd>Shift</kbd> snaps to 15°). <kbd>Shift</kbd>-click adds to the selection; drag on empty space for a marquee. Moving snaps to the document and to other layers (hold <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> to disable). Wheel or pinch to zoom, hold <kbd>Space</kbd> or use the middle/right button to pan, arrow keys nudge (<kbd>Shift</kbd> = 10 px).

<b>Shortcuts</b>: <kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Shift+Z</kbd> undo/redo, <kbd>Ctrl+C</kbd>/<kbd>Ctrl+V</kbd> copy/paste, <kbd>Ctrl+D</kbd> duplicate, <kbd>Ctrl+G</kbd>/<kbd>Ctrl+Shift+G</kbd> group/ungroup, <kbd>Del</kbd> delete, <kbd>Ctrl+A</kbd> select all, <kbd>Ctrl+S</kbd> save, <kbd>Ctrl+O</kbd> open, <kbd>Ctrl+E</kbd> export, <kbd>F</kbd> fit, <kbd>1</kbd> 100%, <kbd>Esc</kbd> deselect.

<b>3D view</b>: drag to orbit, wheel to zoom, right-drag / <kbd>Shift</kbd>-drag to pan.

Projects (.dcad.json) embed images and fonts. The project is also autosaved in this browser. Export writes 8-bit (dithered) or 16-bit grayscale PNG.`;
  openModal('DepthCAD', body, [btn('Close', closeModal, 'primary')]);
}
