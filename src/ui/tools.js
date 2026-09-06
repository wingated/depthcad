// Tools menu, tool editor, import/export, and the user's tool library (IndexedDB).
import { state } from '../app/state.js';
import * as cmd from '../app/commands.js';
import { commit } from '../app/history.js';
import { clearCaches } from '../app/render.js';
import { idb } from '../app/io.js';
import { registerTool, validateTool, testTool, tools, TOOL_FORMAT } from '../kinds/tool.js';
import { BUILTIN_TOOLS } from '../tools/builtin.js';
import { openModal, closeModal } from './dialogs.js';
import { $, el, btn, setMsg, downloadBlob, readAsText } from './dom.js';

let library = {}; // id -> def (persisted)
export async function loadLibrary() { try { library = (await idb.get('tools')) || {}; } catch (e) { library = {}; } }
async function saveLibrary() { try { await idb.set('tools', library); } catch (e) { } }

// Install a tool into the project (and optionally the library). Returns the kind name.
export async function installTool(def, { toLibrary = false, silent = false } = {}) {
  const errors = validateTool(def); if (errors.length) throw new Error(errors.join('; '));
  const err = await testTool(def); if (err) throw new Error('Tool test render failed: ' + err);
  const kind = registerTool(def); state.tools[def.id] = def;
  if (toLibrary) { library[def.id] = JSON.parse(JSON.stringify(def, (k, v) => k.startsWith('_') ? undefined : v)); await saveLibrary(); }
  clearCaches(); if (!silent) setMsg(`Tool "${def.name}" ready`);
  return kind;
}
export function addToolNode(def, params = {}) {
  const n = cmd.add('tool:' + def.id, params, { name: def.name });
  return n;
}
export function exportTool(def) { downloadBlob(new Blob([JSON.stringify(def, (k, v) => k.startsWith('_') ? undefined : v, 2)], { type: 'application/json' }), def.id + '.tool.json'); }

export function initToolsMenu() {
  const menu = el('div'); menu.id = 'toolsMenu'; document.body.appendChild(menu);
  const b = $('#bTools');
  const close = () => menu.classList.remove('on');
  b.addEventListener('click', e => { e.stopPropagation(); if (menu.classList.contains('on')) return close(); render(); const r = b.getBoundingClientRect(); menu.style.left = r.left + 'px'; menu.style.top = (r.bottom + 4) + 'px'; menu.classList.add('on'); });
  window.addEventListener('pointerdown', e => { if (!menu.contains(e.target) && e.target !== b) close(); }, true);
  $('#fileTool').addEventListener('change', async e => { for (const f of Array.from(e.target.files)) { try { const def = JSON.parse(await readAsText(f)); await installTool(def, { toLibrary: true }); addToolNode(def); } catch (err) { alert('Could not import tool: ' + err.message); } } e.target.value = ''; });
  function item(label, fn, cls = '') { const d = el('div', 'titem ' + cls, label); d.addEventListener('click', async () => { close(); try { await fn(); } catch (err) { alert(err.message); } }); return d; }
  function render() {
    menu.innerHTML = '';
    const proj = Object.values(state.tools), lib = Object.values(library).filter(t => !state.tools[t.id]), builtin = BUILTIN_TOOLS.filter(t => !state.tools[t.id] && !library[t.id]);
    const section = (title, list, install) => { if (!list.length) return; menu.appendChild(el('div', 'thdr', title)); for (const t of list) { const d = item(t.name, async () => { if (install) await installTool(t, { silent: true }); addToolNode(state.tools[t.id] || t); }); d.title = t.description || ''; menu.appendChild(d); } };
    section('In this project', proj, false); section('My tools', lib, true); section('Examples', builtin, true);
    menu.appendChild(el('div', 'tsep'));
    menu.appendChild(item('Import tool file…', () => $('#fileTool').click()));
    menu.appendChild(item('New tool…', () => toolEditor(null)));
    menu.appendChild(el('div', 'hint', 'A tool is a JSON file with a parameter schema and a small render function. Tools you write or import here stay in "My tools"; the ones a project uses are saved inside it.'));
  }
}

// JSON editor for a tool (new or existing). onSave(def) is called after a successful install.
export function toolEditor(def, onSave) {
  const body = el('div'); const ta = document.createElement('textarea'); ta.rows = 22; ta.spellcheck = false; ta.style.fontFamily = 'Menlo, Consolas, monospace'; ta.style.fontSize = '11px';
  ta.value = JSON.stringify(def || {
    format: TOOL_FORMAT, id: 'my-tool', name: 'My tool', version: 1, description: 'What it makes.',
    schema: { radius: { type: 'number', label: 'Radius (px)', default: 200, min: 1, max: 4000, step: 1, slider: true }, high: { type: 'depth', label: 'Height', default: 1 } },
    measure: 'return { w: 2 * p.radius, h: 2 * p.radius };',
    render: 'lib.each((u, v) => { const d = lib.sdf.circle(u, v, p.radius); const c = lib.aa(d); return c > 0 ? [p.high * lib.profile("dome", d, p.radius), c] : null; });',
  }, (k, v) => k.startsWith('_') ? undefined : v, 2);
  const status = el('div', 'hint'); body.append(ta, status);
  const lib = document.createElement('input'); lib.type = 'checkbox'; lib.checked = true; const ll = el('label', 'wide'); ll.append(lib, ' Also save to my tools'); body.appendChild(ll);
  openModal(def ? `Edit tool: ${def.name}` : 'New tool', body, [
    btn('Cancel', closeModal, ''),
    btn('Test', async () => { try { const d = JSON.parse(ta.value); const errs = validateTool(d); if (errs.length) throw new Error(errs.join('; ')); const err = await testTool(d); status.textContent = err ? 'Test render failed: ' + err : 'Test render OK'; } catch (e) { status.textContent = e.message; } }),
    btn('Save', async () => { try { const d = JSON.parse(ta.value); await installTool(d, { toLibrary: lib.checked }); commit(); closeModal(); if (onSave) onSave(d); else if (!def) addToolNode(d); } catch (e) { status.textContent = e.message; } }, 'primary'),
  ]);
  $('#modalBox').classList.add('wide');
  const old = closeModal; // widen only for this dialog
  const observer = new MutationObserver(() => { if (!$('#modal').classList.contains('on')) { $('#modalBox').classList.remove('wide'); observer.disconnect(); } });
  observer.observe($('#modal'), { attributes: true });
}
export function libraryTools() { return library; }
export async function saveToLibrary(def) { library[def.id] = JSON.parse(JSON.stringify(def, (k, v) => k.startsWith('_') ? undefined : v)); await saveLibrary(); setMsg(`Saved "${def.name}" to my tools`); }
