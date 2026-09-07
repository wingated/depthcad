// Extension tools: JSON documents with a parameter schema and JavaScript measure/render
// bodies. Each registered tool becomes a node kind "tool:<id>" whose raster is produced
// in a Worker (with a timeout) from the tool's render function.
import { registerKind, KINDS, schemaDefaults } from '../engine/kinds.js';
import { createRaster } from '../engine/raster.js';
import { makeLib, LIB_SOURCE } from '../engine/toolkit.js';

export const TOOL_FORMAT = 'depthcad-tool/1';
export const tools = {}; // id -> definition (registered kinds)

export function validateTool(def) {
  const errors = [];
  if (!def || typeof def !== 'object') return ['Tool must be an object'];
  if (def.format !== TOOL_FORMAT) errors.push(`format must be "${TOOL_FORMAT}"`);
  if (!def.id || !/^[a-z0-9][a-z0-9-_]*$/i.test(def.id)) errors.push('id must be a short identifier (letters, digits, - or _)');
  if (!def.name) errors.push('name is required');
  if (!def.schema || typeof def.schema !== 'object') errors.push('schema must be an object of parameters');
  else for (const [k, s] of Object.entries(def.schema)) { if (!s || !s.type) errors.push(`schema.${k} needs a type`); else if (!['number', 'int', 'bool', 'enum', 'depth', 'text', 'string'].includes(s.type)) errors.push(`schema.${k}: unsupported type ${s.type}`); if (s.type === 'enum' && !s.options) errors.push(`schema.${k}: enum needs options`); }
  if (typeof def.render !== 'string' || !def.render.trim()) errors.push('render must be a string of JavaScript (function body)');
  if (typeof def.measure !== 'string' || !def.measure.trim()) errors.push('measure must be a string of JavaScript returning {w, h}');
  try { if (def.measure) new Function('p', 'lib', def.measure); } catch (e) { errors.push('measure does not compile: ' + e.message); }
  try { if (def.render) new Function('p', 'r', 'lib', def.render); } catch (e) { errors.push('render does not compile: ' + e.message); }
  return errors;
}

export function registerTool(def) {
  const errors = validateTool(def); if (errors.length) throw new Error(errors.join('; '));
  const kind = 'tool:' + def.id;
  const measureFn = new Function('p', 'lib', def.measure);
  tools[def.id] = def;
  registerKind({
    kind, label: def.name, icon: '✦', isTool: true, tool: def,
    schema: def.schema, hint: def.description || '',
    measure(n) { try { const m = measureFn(n.params, makeLib({ w: 1, h: 1, scale: 1, nat: { w: 1, h: 1 }, height: new Float32Array(1), coverage: new Float32Array(1) })); return { w: Math.max(1, +m.w || 1), h: Math.max(1, +m.h || 1) }; } catch (e) { return { w: 100, h: 100 }; } },
    cacheKey(n) { return JSON.stringify(n.params) + '|' + def.version + '|' + def._rev; },
    renderAsync(n, { cw, ch, ctx }) { const nat = KINDS[kind].measure(n); return runTool(def, n.params, cw, ch, nat); },
  });
  def._rev = (def._rev || 0) + 1;
  return kind;
}
export function unregisterTool(id) { delete tools[id]; delete KINDS['tool:' + id]; }
export function toolDefaults(def) { return schemaDefaults(def.schema); }

// ---- worker runtime
const WORKER_SRC = `'use strict';
const makeLib = ${LIB_SOURCE};
self.onmessage = e => {
  const { id, code, params, w, h, nat } = e.data;
  try {
    const height = new Float32Array(w * h), coverage = new Float32Array(w * h);
    const r = { w, h, height, coverage, scale: w / nat.w, nat };
    const lib = makeLib(r);
    const fn = new Function('p', 'r', 'lib', code);
    fn(params, r, lib);
    self.postMessage({ id, height, coverage }, [height.buffer, coverage.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err && err.stack || err) }); }
};`;
// One Worker runs tool jobs one at a time from a queue; a job's timeout starts when it is
// dispatched, so a slow job does not expire the jobs waiting behind it. A timed-out job
// terminates the Worker and the queue continues on a fresh one.
let worker = null, seq = 0, running = null; const queue = [];
const TIMEOUT_MS = 60000;
function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
    worker.onmessage = e => { const job = running; if (!job || job.id !== e.data.id) return; running = null; clearTimeout(job.timer); if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data); dispatch(); };
    worker.onerror = e => { const job = running; running = null; if (worker) { worker.terminate(); worker = null; } if (job) { clearTimeout(job.timer); job.reject(new Error('Tool worker error: ' + (e.message || 'unknown'))); } dispatch(); };
  } catch (e) { worker = null; }
  return worker;
}
function dispatch() {
  if (running || !queue.length) return;
  const wk = getWorker(); if (!wk) { const job = queue.shift(); runToolSync(job.def, job.params, job.w, job.h, job.nat).then(job.resolveRaster, job.reject); dispatch(); return; }
  const job = queue.shift(); running = job;
  job.timer = setTimeout(() => { if (running !== job) return; running = null; if (worker) { worker.terminate(); worker = null; } job.reject(new Error(`Tool "${job.def.name}" timed out after ${TIMEOUT_MS / 1000}s`)); dispatch(); }, TIMEOUT_MS);
  wk.postMessage({ id: job.id, code: job.def.render, params: job.params, w: job.w, h: job.h, nat: job.nat });
}
export function runTool(def, params, w, h, nat) {
  return new Promise((resolve, reject) => {
    const job = { id: ++seq, def, params, w, h, nat, reject, resolveRaster: resolve, resolve: d => { const r = createRaster(w, h); r.height = d.height; r.coverage = d.coverage; resolve(r); } };
    queue.push(job); dispatch();
  });
}
// Main-thread fallback (no Worker available) and quick validation renders.
export async function runToolSync(def, params, w, h, nat) {
  const r = createRaster(w, h); const rr = { w, h, height: r.height, coverage: r.coverage, scale: w / nat.w, nat };
  const fn = new Function('p', 'r', 'lib', def.render); fn(params, rr, makeLib(rr)); return r;
}
// Try a small render to surface runtime errors; returns null or an error message.
export async function testTool(def) {
  try {
    const params = toolDefaults(def); const measureFn = new Function('p', 'lib', def.measure);
    const m = measureFn(params, makeLib({ w: 1, h: 1, scale: 1, nat: { w: 1, h: 1 }, height: new Float32Array(1), coverage: new Float32Array(1) }));
    if (!m || !(m.w > 0) || !(m.h > 0)) return 'measure must return {w, h} with positive numbers';
    const nat = { w: +m.w, h: +m.h }; const s = 96 / Math.max(nat.w, nat.h);
    const r = await runTool(def, params, Math.max(1, Math.round(nat.w * s)), Math.max(1, Math.round(nat.h * s)), nat);
    let cov = 0; for (let i = 0; i < r.coverage.length; i++) cov += r.coverage[i];
    return cov > 0 ? null : 'render produced no coverage (nothing drawn) with the default parameters';
  } catch (e) { return String(e.message || e); }
}
