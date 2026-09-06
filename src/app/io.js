// Import/export and persistence: images (8/16-bit PNG through the built-in codec,
// other formats through the browser), fonts, project files, autosave, PNG export.
import { state, resetDocument, serialize, normalizeNode, migrateV1, FORMAT_VERSION } from './state.js';
import { resetHistory, commit } from './history.js';
import { renderDocument } from '../engine/composite.js';
import { decodePNG, encodeGrayPNG } from '../engine/png.js';
import { toU8, toU16 } from '../engine/dither.js';
import { makeImageAsset } from '../kinds/image.js';
import { bumpFontsVersion } from '../kinds/text.js';
import { uid } from '../engine/util.js';
import { add } from './commands.js';
import { clearCaches, exportCache, invalidate } from './render.js';
import { readAsDataURL, readAsText, decodeImageEl, dataURLToBytes, downloadBlob, setMsg } from '../ui/dom.js';

// ---- images
export async function registerImage(dataURL, id) {
  id = id || uid();
  let w, h, bits, u16;
  if (/^data:image\/png/i.test(dataURL)) {
    const dec = await decodePNG(dataURLToBytes(dataURL).buffer);
    w = dec.w; h = dec.h; bits = dec.bits; u16 = dec.data;
  } else {
    const im = await decodeImageEl(dataURL); w = im.naturalWidth; h = im.naturalHeight; bits = 8;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, w, h).data; u16 = new Uint16Array(w * h);
    for (let i = 0, k = 0; i < u16.length; i++, k += 4) u16[i] = d[k] * 257;
  }
  state.images[id] = makeImageAsset(dataURL, w, h, bits, u16);
  return id;
}
export async function importImageFile(file) {
  const dataURL = await readAsDataURL(file);
  const id = await registerImage(dataURL); const im = state.images[id];
  if (!state.root.children.length) { state.doc.w = im.w; state.doc.h = im.h; }
  const n = add('image', { imageId: id }, { name: file.name.replace(/\.[^.]+$/, ''), node: { x: state.doc.w / 2, y: state.doc.h / 2 } });
  setMsg(`Imported ${file.name} (${im.w}×${im.h}, ${im.bits}-bit)`);
  return n;
}

// ---- fonts
export async function registerFont(name, dataURL, id) {
  const ff = new FontFace(name, `url(${dataURL})`); await ff.load(); document.fonts.add(ff);
  id = id || uid(); state.fonts[id] = { name, dataURL }; bumpFontsVersion(); clearCaches(); return id;
}
export async function importFontFile(file) {
  const dataURL = await readAsDataURL(file); const name = file.name.replace(/\.[^.]+$/, '');
  await registerFont(name, dataURL); commit(); setMsg('Loaded font ' + name); return name;
}

// ---- projects
export async function loadProject(p) {
  if (!p || (!p.root && !p.layers)) throw new Error('Not a DepthCAD project');
  if (!p.version || p.version < 2) p = migrateV1(p);
  resetDocument(p.doc);
  for (const [id, im] of Object.entries(p.images || {})) { try { await registerImage(im.dataURL, id); } catch (e) { console.warn('image failed', id, e); } }
  for (const [id, f] of Object.entries(p.fonts || {})) { try { await registerFont(f.name, f.dataURL, id); } catch (e) { console.warn('font failed', f.name, e); } }
  state.root = normalizeNode(p.root); state.root.id = 'root';
  state.name = p.name || 'untitled'; state.sel = [];
  clearCaches(); resetHistory();
}
export function newProject() { resetDocument(); clearCaches(); resetHistory(); }
export function saveProject() {
  const blob = new Blob([JSON.stringify(serialize())], { type: 'application/json' });
  downloadBlob(blob, (state.name || 'untitled') + '.dcad.json'); setMsg('Project saved');
}
export async function openProjectFile(file) { const p = JSON.parse(await readAsText(file)); await loadProject(p); setMsg('Opened ' + file.name); }

// ---- autosave (IndexedDB)
const idb = {
  db: null,
  open() { if (this.db) return Promise.resolve(this.db); return new Promise((res, rej) => { const r = indexedDB.open('depthcad', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); }); },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); },
};
let autosaveT = null;
export function autosave() { clearTimeout(autosaveT); autosaveT = setTimeout(() => { idb.set('autosave', serialize()).catch(() => { }); }, 1500); }
export async function restoreAutosave() { const p = await idb.get('autosave'); if (p && (p.root || p.layers)) { await loadProject(p); return true; } return false; }

// ---- export
export async function exportPNG({ bits = 8, dither = 'fs', name } = {}) {
  const out = renderDocument(state, 1, true, exportCache);
  const data = bits === 16 ? toU16(out.height) : toU8(out.height, out.w, out.h, dither);
  const png = await encodeGrayPNG(out.w, out.h, data, bits);
  downloadBlob(new Blob([png], { type: 'image/png' }), (name || state.name || 'depthmap') + '.png');
  setMsg(`Exported ${out.w}×${out.h} ${bits}-bit PNG`);
  return out;
}
export function renderFull() { return renderDocument(state, 1, true, exportCache); }
