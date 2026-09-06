// Font family picker: a dropdown where every entry is rendered in its own typeface.
import { state } from '../app/state.js';
import { el, setMsg } from './dom.js';
import { clamp } from '../engine/util.js';

export const BUILTIN_FONTS = ['Helvetica', 'Helvetica Neue', 'Arial', 'Arial Black', 'Impact', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Gill Sans', 'Futura', 'Avenir', 'Avenir Next', 'Optima', 'Times New Roman', 'Times', 'Georgia', 'Baskerville', 'Didot', 'Palatino', 'Garamond', 'Hoefler Text', 'Copperplate', 'Courier New', 'Menlo', 'Monaco', 'Brush Script MT', 'Snell Roundhand', 'Chalkduster', 'Papyrus', 'Marker Felt', 'Comic Sans MS', 'American Typewriter', 'Rockwell', 'serif', 'sans-serif', 'monospace'];
let localFontNames = [];
let menu = null, pick = null;

function ensureMenu() { if (!menu) { menu = document.createElement('div'); menu.id = 'fontMenu'; document.body.appendChild(menu);
  window.addEventListener('pointerdown', e => { if (pick && !menu.contains(e.target) && e.target !== pick.input) closeFontMenu(); }, true);
  window.addEventListener('resize', () => { if (pick) closeFontMenu(); });
  const right = document.querySelector('#right'); if (right) right.addEventListener('scroll', () => { if (pick) closeFontMenu(); }); } }

export async function listInstalledFonts() {
  if (!window.queryLocalFonts) { alert('This browser cannot enumerate installed fonts (Chrome/Edge only). You can still type any installed font name.'); return; }
  try { const fs = await window.queryLocalFonts(); localFontNames = [...new Set(fs.map(f => f.family))].sort(); if (pick) renderFontMenu(); setMsg(`${localFontNames.length} installed font families listed`); }
  catch (e) { alert('Font access denied: ' + e.message); }
}
function fontGroups() {
  const g = []; const proj = [...new Set(Object.values(state.fonts).map(f => f.name))];
  if (proj.length) g.push(['Project fonts', proj]);
  if (localFontNames.length) g.push(['Installed fonts', localFontNames.filter(n => !proj.includes(n))]); else g.push(['Common fonts', BUILTIN_FONTS]);
  return g;
}
function renderFontMenu() {
  const st = pick; if (!st) return; const q = st.typed ? st.input.value.trim().toLowerCase() : ''; menu.innerHTML = ''; st.items = []; st.active = -1;
  if (!localFontNames.length && window.queryLocalFonts) { const o = el('div', 'fopt action', 'Load the list of installed fonts…'); o.addEventListener('pointerdown', async e => { e.preventDefault(); o.textContent = 'Loading…'; await listInstalledFonts(); }); menu.appendChild(o); }
  const cur = st.input.value.trim();
  for (const [title, names] of fontGroups()) {
    const f = names.filter(n => !q || n.toLowerCase().includes(q)); if (!f.length) continue;
    menu.appendChild(el('div', 'fhdr', title));
    for (const n of f) {
      const o = el('div', 'fopt' + (n === cur ? ' active' : '')); o.style.fontFamily = `"${n.replace(/"/g, '')}"`; o.textContent = n; o.title = n; o.appendChild(el('span', 'sub', n));
      o.addEventListener('pointerdown', e => { e.preventDefault(); pickFont(n); }); o.addEventListener('pointermove', () => setActive(st.items.indexOf(o)));
      menu.appendChild(o); st.items.push(o); if (n === cur) st.active = st.items.length - 1;
    }
  }
  if (!st.items.length) menu.appendChild(el('div', 'fopt empty', 'No matching fonts. Press Enter to use the typed name.'));
  const r = st.input.getBoundingClientRect(); const top = r.bottom + 2;
  menu.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 300)) + 'px'; menu.style.top = top + 'px';
  menu.style.width = Math.max(r.width, 280) + 'px'; menu.style.maxHeight = Math.max(120, Math.min(340, window.innerHeight - top - 10)) + 'px'; menu.classList.add('on');
  if (st.active >= 0) st.items[st.active].scrollIntoView({ block: 'center' });
}
function setActive(i) { const st = pick; if (!st || !st.items.length) return; if (st.active >= 0) st.items[st.active].classList.remove('active'); st.active = clamp(i, 0, st.items.length - 1); st.items[st.active].classList.add('active'); }
function pickFont(name) { const st = pick; if (!st) return; st.input.value = name; st.onPick(name); closeFontMenu(); }
function openFontMenu(input, onPick) { ensureMenu(); pick = { input, onPick, typed: false, items: [], active: -1 }; renderFontMenu(); }
function closeFontMenu() { pick = null; if (menu) { menu.classList.remove('on'); menu.innerHTML = ''; } }

// get() -> current family; set(name, transient) applies it.
export function fontPicker(get, set) {
  const wrap = el('div', 'fontpick'); const fi = document.createElement('input'); fi.type = 'text'; fi.value = get(); fi.placeholder = 'Font family'; fi.spellcheck = false;
  const onPick = n => set(n, false);
  fi.addEventListener('focus', () => openFontMenu(fi, onPick));
  fi.addEventListener('pointerdown', () => { if (!pick || pick.input !== fi) setTimeout(() => openFontMenu(fi, onPick), 0); });
  fi.addEventListener('input', () => { if (pick && pick.input === fi) { pick.typed = true; renderFontMenu(); } if (fi.value.trim()) set(fi.value.trim(), true); });
  fi.addEventListener('keydown', e => {
    const st = pick; if (!st || st.input !== fi) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(st.active + 1); st.items[st.active]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(st.active - 1); st.items[st.active]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); if (st.active >= 0 && st.items[st.active]) pickFont(st.items[st.active].title); else { onPick(fi.value.trim() || get()); closeFontMenu(); } fi.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); fi.value = get(); closeFontMenu(); fi.blur(); }
  });
  fi.addEventListener('blur', () => { setTimeout(() => { if (pick && pick.input === fi) closeFontMenu(); }, 120); if (fi.value.trim() !== get()) fi.value = get(); else set(get(), false); });
  wrap.append(fi, el('span', 'caret', '▼')); wrap.input = fi; return wrap;
}
