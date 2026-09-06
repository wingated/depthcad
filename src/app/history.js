// Undo history: JSON snapshots of the document tree (small: rasters live in caches
// keyed by node id, images and fonts are assets referenced by id).
import { state, serializeTree, normalizeNode } from './state.js';

let undoStack = [], redoStack = [], lastSnap = null;
const listeners = new Set();
export function onHistory(fn) { listeners.add(fn); }
function notify(kind) { for (const fn of listeners) fn(kind); }

export function snapshot() { return JSON.stringify({ doc: state.doc, root: serializeTree(), sel: state.sel, name: state.name }); }
export function commit() {
  const s = snapshot(); if (s === lastSnap) return false;
  if (lastSnap !== null) { undoStack.push(lastSnap); if (undoStack.length > 200) undoStack.shift(); }
  redoStack.length = 0; lastSnap = s; notify('commit'); return true;
}
export function resetHistory() { undoStack = []; redoStack = []; lastSnap = snapshot(); notify('reset'); }
function restore(s) {
  const o = JSON.parse(s);
  state.doc = o.doc; state.root = normalizeNode(o.root); state.sel = o.sel || []; state.name = o.name || state.name;
  notify('restore');
}
export function undo() { if (!undoStack.length) return false; redoStack.push(lastSnap); lastSnap = undoStack.pop(); restore(lastSnap); return true; }
export function redo() { if (!redoStack.length) return false; undoStack.push(lastSnap); lastSnap = redoStack.pop(); restore(lastSnap); return true; }
export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
