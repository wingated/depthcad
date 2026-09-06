// Layer tree panel: nested groups, visibility, rename, drag to reorder / into groups.
import { state, parentOf } from '../app/state.js';
import * as cmd from '../app/commands.js';
import { KINDS, BLEND_MODES } from '../engine/kinds.js';
import { $, el } from './dom.js';

const collapsed = new Set();
let root;

export function initTree() { root = $('#layers'); buildTree(); }

export function buildTree() {
  if (!root) return; root.innerHTML = '';
  const frag = document.createDocumentFragment();
  const rec = (group, depth) => {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const n = group.children[i];
      frag.appendChild(row(n, depth, group));
      if (n.kind === 'group' && !collapsed.has(n.id)) rec(n, depth + 1);
    }
  };
  rec(state.root, 0);
  root.appendChild(frag);
  if (!state.root.children.length) { const h = el('div', 'hint', 'No layers yet. Import a depth-map image, or add a shape or text.'); h.style.padding = '8px'; root.appendChild(h); }
}
export function refreshSelection() { for (const r of root.querySelectorAll('.layer')) r.classList.toggle('sel', state.sel.includes(r.dataset.id)); }

function row(n, depth, parent) {
  const def = KINDS[n.kind] || {}; const isMask = !!def.isMask;
  const r = el('div', 'layer' + (state.sel.includes(n.id) ? ' sel' : '') + (n.visible ? '' : ' hidden') + (isMask ? ' mask' : '') + (n.kind === 'group' ? ' group' : ''));
  r.dataset.id = n.id; r.draggable = true; r.style.paddingLeft = (6 + depth * 14) + 'px';
  const tri = el('span', 'tri', n.kind === 'group' ? (collapsed.has(n.id) ? '▸' : '▾') : '');
  if (n.kind === 'group') tri.addEventListener('click', e => { e.stopPropagation(); collapsed.has(n.id) ? collapsed.delete(n.id) : collapsed.add(n.id); buildTree(); });
  const eye = el('span', 'eye', n.visible ? '👁' : '◌'); eye.title = 'Toggle visibility';
  eye.addEventListener('click', e => { e.stopPropagation(); cmd.setNodeProps(n.id, { visible: !n.visible }); });
  const ico = el('span', 'ico', def.icon || '?');
  const name = el('span', 'lname', n.name); name.title = 'Double-click to rename';
  name.addEventListener('dblclick', e => { e.stopPropagation(); const v = prompt('Name', n.name); if (v != null && v.trim()) cmd.setNodeProps(n.id, { name: v.trim() }); });
  const badge = el('span', 'mode', isMask ? (n.params.invert ? 'inv' : '') : (n.blend === 'max' ? '' : BLEND_MODES[n.blend].split(' ')[0]));
  const lock = el('span', 'lock', n.locked ? '🔒' : ''); lock.title = 'Locked';
  r.append(tri, eye, ico, name, badge, lock);
  r.addEventListener('click', e => { if (e.shiftKey || e.metaKey || e.ctrlKey) cmd.select([n.id], { toggle: true }); else cmd.select([n.id]); });
  r.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', n.id); e.dataTransfer.effectAllowed = 'move'; });
  r.addEventListener('dragover', e => { e.preventDefault(); const z = zone(e, r, n); r.classList.toggle('dragover-top', z === 'before'); r.classList.toggle('dragover-bot', z === 'after'); r.classList.toggle('dragover-into', z === 'into'); });
  r.addEventListener('dragleave', () => r.classList.remove('dragover-top', 'dragover-bot', 'dragover-into'));
  r.addEventListener('drop', e => {
    e.preventDefault(); r.classList.remove('dragover-top', 'dragover-bot', 'dragover-into');
    const id = e.dataTransfer.getData('text/plain'); if (!id || id === n.id) return;
    const z = zone(e, r, n);
    if (z === 'into') { cmd.reorder(id, n.id, n.children.length); collapsed.delete(n.id); return; }
    const p = parentOf(n.id); const idx = p.children.indexOf(n);
    // rows are listed top-of-stack first, so "before" (above in the list) means a higher index
    cmd.reorder(id, p.id, z === 'before' ? idx + 1 : idx);
  });
  return r;
}
function zone(e, r, n) {
  const rect = r.getBoundingClientRect(); const f = (e.clientY - rect.top) / rect.height;
  if (n.kind === 'group' && f > 0.3 && f < 0.7) return 'into';
  return f < 0.5 ? 'before' : 'after';
}
