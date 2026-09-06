export const $ = s => document.querySelector(s);
export function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
export function btn(label, fn, cls = 'small', title) { const b = el('button', cls, label); if (title) b.title = title; b.addEventListener('click', fn); return b; }
export function setMsg(s) { const m = $('#stMsg'); if (!m) return; m.textContent = s; clearTimeout(setMsg.t); setMsg.t = setTimeout(() => { m.textContent = ''; }, 5000); }
export function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
export function readAsDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); }); }
export function readAsText(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); }); }
export function readAsArrayBuffer(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); }); }
export function decodeImageEl(dataURL) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Could not decode image')); im.src = dataURL; }); }
export function dataURLToBytes(dataURL) { const b64 = dataURL.slice(dataURL.indexOf(',') + 1); const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
export function isInputFocused() { return /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '') && document.activeElement.type !== 'checkbox' && document.activeElement.type !== 'range'; }
