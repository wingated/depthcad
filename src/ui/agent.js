// Optional AI assistant: a chat drawer that drives the command API and can write tools.
// Providers: Anthropic (official SDK loaded on demand), OpenAI, Google. Keys stay in localStorage.
import { state, findNode, walk, depthToDisplay, UNITS } from '../app/state.js';
import * as cmd from '../app/commands.js';
import { undo, undoDepth } from '../app/history.js';
import { valueAt, getComposite } from '../app/render.js';
import { KINDS } from '../engine/kinds.js';
import { MODIFIERS } from '../engine/modifiers.js';
import { installTool, addToolNode } from './tools.js';
import { $, el, btn } from './dom.js';

const SETTINGS_KEY = 'depthcad.ai';
const DEFAULT_MODELS = { anthropic: 'claude-opus-5', openai: 'gpt-5', google: 'gemini-2.5-pro' };
let settings = { provider: 'anthropic', models: { ...DEFAULT_MODELS }, keys: {} };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); settings.models = { ...DEFAULT_MODELS, ...(settings.models || {}) }; settings.keys = settings.keys || {}; } catch (e) { }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { } }

// ---------------------------------------------------------------- document summary & tools for the model
function summarizeNode(n) {
  const b = cmd.boxOf(n); const def = KINDS[n.kind] || {};
  const o = { id: n.id, kind: n.kind, name: n.name, x: +n.x.toFixed(1), y: +n.y.toFixed(1), w: +b.w.toFixed(1), h: +b.h.toFixed(1), rot: n.rot, blend: n.blend, visible: n.visible };
  if (n.kind !== 'group') { const p = { ...n.params }; delete p.imageId; delete p.meshId; delete p.bake; o.params = p; }
  if (n.modifiers && n.modifiers.length) o.modifiers = n.modifiers.map(m => { const c = { ...m }; delete c.enabled; return c; });
  if (n.kind === 'group') o.children = n.children.map(summarizeNode);
  if (def.isMask) o.note = 'mask: clips siblings above it in its group';
  if (n._error) o.error = n._error;
  return o;
}
function kindSchemas() {
  const out = {};
  for (const [k, d] of Object.entries(KINDS)) { if (k === 'group' || k === 'mesh' || k === 'image') continue; out[k] = Object.fromEntries(Object.entries(d.schema || {}).filter(([, s]) => !s.hidden).map(([key, s]) => [key, { type: s.type, default: s.default, ...(s.min != null ? { min: s.min } : {}), ...(s.max != null ? { max: s.max } : {}), ...(s.options ? { options: Object.keys(s.options) } : {}) }])); if (d.sizeInParams) out[k]._size = 'w/h in params'; }
  return out;
}
export function documentSummary() {
  return {
    document: { width: state.doc.w, height: state.doc.h, background: state.doc.bg, displayUnit: UNITS[state.doc.unit] },
    selection: state.sel,
    layers_bottom_to_top: state.root.children.map(summarizeNode),
    kinds: kindSchemas(),
    modifiers: Object.fromEntries(Object.entries(MODIFIERS).map(([k, d]) => [k, Object.keys(d.schema)])),
    tools_in_project: Object.values(state.tools).map(t => ({ kind: 'tool:' + t.id, name: t.name, schema: t.schema })),
  };
}

const SYSTEM = () => `You are the assistant inside DepthCAD, a browser app that builds grayscale depth maps for laser engraving by compositing layers.
Conventions: depth values are normalized floats 0..1 (0 = deepest/farthest, 1 = highest); the user sees them as ${UNITS[state.doc.unit]}. Coordinates are document pixels, origin top-left, y down; every layer has a centre (x, y), scale (sx, sy), rotation in degrees, a blend mode (max = union, min = clamp, replace, cut = erase below inside, keep = erase below outside), and a modifier stack (levels, curve, clamp, feather, blur, offset). Layers composite bottom to top with per-pixel max. Groups contain layers; a mask node clips the siblings above it inside its group. Shapes and masks store their size in params.w/params.h; images and text use sx/sy.
You act through tools: call get_document first to see the current state, then run_commands to change it. Batch several commands in one run_commands call. Report ids returned by add/group so you can refer to them. Use sample_values to verify heights at points when it matters.
When the user wants geometry the built-in kinds cannot express (patterns, repeated shapes, procedural textures, text on paths), write an extension tool with create_tool: a JSON document {format:"depthcad-tool/1", id, name, version, description, schema, measure, render}. schema maps parameter names to {type: number|int|bool|enum|depth|text|string, label, default, min, max, step, slider, options}. measure is a JS function body (p, lib) returning {w, h} in local px. render is a JS function body (p, r, lib): r = {w, h, height, coverage, scale, nat} is the raster to fill (height and coverage are Float32Array 0..1, local coords are centred at 0,0, scale = pixels per local unit). Prefer lib.each((u, v) => value) which sets each pixel from local coords: return a height, or [height, coverage], or null. lib has sdf.{circle, ellipse, box, ring, segment, polygon, star, union, intersect, subtract, rotate} (signed distance, positive inside), aa(d) for antialiased coverage, profile(kind, d, dmax) for flat|linear|dome|cosine|bevel, noise2/fbm, clamp/mix/smoothstep, add(x, y, h, c) for union-compositing pixels, and canvas()/fromCanvas(ctx, height) for drawing text or paths with Canvas 2D in local units. create_tool test-renders the tool and returns errors; fix them and retry. After creating a tool, add a layer that uses it with run_commands (kind "tool:<id>") and position it.
Keep replies brief: say what you did and what the user can adjust.`;

const TOOL_DEFS = [
  { name: 'get_document', description: 'Current document: size, selection, the layer tree with ids and parameters, the parameter schemas of layer kinds, modifiers, and tools available in this project.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'run_commands', description: 'Apply a batch of editing commands in order. Each command is {name, args}. Commands: add {kind, params?, name?, x?, y?, rot?, sx?, sy?, blend?, parentId?, index?} -> {id}; remove {ids}; setParams {id, params}; setNode {id, name?, visible?, locked?, blend?, lockAspect?}; setTransform {id, x?, y?, sx?, sy?, rot?}; setBox {id, x, y, w, h, rot?} (document-space box, resizes shapes/masks or rescales images/text); moveBy {ids, dx, dy}; group {ids, name?} -> {id}; ungroup {id}; duplicate {ids} -> {ids}; align {ids, how: left|hcenter|right|top|vcenter|bottom, to: selection|document}; distribute {ids, axis: horizontal|vertical}; addModifier {id, kind, settings?} -> {index}; setModifier {id, index, settings}; removeModifier {id, index}; reorder {id, parentId, index}; addMask {id, shape: rect|ellipse} -> {id} (wraps the layer in a group with a mask below it); centerInDoc {ids}; fitToDoc {id, fill?}; select {ids}; setDocument {w?, h?, bg?}.',
    parameters: { type: 'object', properties: { commands: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'object' } }, required: ['name', 'args'] } } }, required: ['commands'] },
  },
  { name: 'create_tool', description: 'Install an extension tool (see the system prompt for the format). Validates it and test-renders it; returns {ok} or {errors}. Then add a layer with kind "tool:<id>" using run_commands.', parameters: { type: 'object', properties: { tool: { type: 'object' } }, required: ['tool'] } },
  { name: 'sample_values', description: 'Read the composited depth value (0..1) at document points.', parameters: { type: 'object', properties: { points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } } }, required: ['points'] } },
];

function runCommand(c) {
  const a = c.args || {};
  const nodeFields = ({ x, y, rot, sx, sy, blend }) => Object.fromEntries(Object.entries({ x, y, rot, sx, sy, blend }).filter(([, v]) => v !== undefined));
  switch (c.name) {
    case 'add': { if (!KINDS[a.kind]) throw new Error('unknown kind ' + a.kind); const n = cmd.add(a.kind, a.params || {}, { name: a.name, node: nodeFields(a), parentId: a.parentId, index: a.index }); return { id: n.id, box: cmd.boxOf(n) }; }
    case 'remove': cmd.remove(a.ids); return { ok: true };
    case 'setParams': cmd.setParams(a.id, a.params); return { ok: true };
    case 'setNode': { const p = { ...a }; delete p.id; cmd.setNodeProps(a.id, p); return { ok: true }; }
    case 'setTransform': { const p = { ...a }; delete p.id; cmd.setTransform(a.id, p); return { ok: true }; }
    case 'setBox': { const n = findNode(a.id); if (!n) throw new Error('no node ' + a.id); const b = cmd.boxOf(n); cmd.setBox(a.id, { x: a.x ?? b.x, y: a.y ?? b.y, w: a.w ?? b.w, h: a.h ?? b.h, rot: a.rot ?? b.rot }); return { ok: true, box: cmd.boxOf(n) }; }
    case 'moveBy': cmd.moveBy(a.ids, a.dx || 0, a.dy || 0); return { ok: true };
    case 'group': { const g = cmd.group(a.ids, { name: a.name }); return { id: g && g.id }; }
    case 'ungroup': cmd.ungroup(a.id); return { ok: true };
    case 'duplicate': return { ids: cmd.duplicate(a.ids) };
    case 'align': cmd.align(a.ids, a.how, a.to || 'selection'); return { ok: true };
    case 'distribute': cmd.distribute(a.ids, a.axis); return { ok: true };
    case 'addModifier': { const n = findNode(a.id); const m = cmd.addModifier(a.id, a.kind); if (a.settings) cmd.setModifier(a.id, n.modifiers.length - 1, a.settings); return { index: n.modifiers.length - 1 }; }
    case 'setModifier': cmd.setModifier(a.id, a.index, a.settings || {}); return { ok: true };
    case 'removeModifier': cmd.removeModifier(a.id, a.index); return { ok: true };
    case 'reorder': cmd.reorder(a.id, a.parentId || 'root', a.index ?? 0); return { ok: true };
    case 'addMask': { const m = cmd.addMaskTo(a.id, a.shape || 'ellipse'); return { id: m && m.id }; }
    case 'centerInDoc': cmd.centerInDoc(a.ids); return { ok: true };
    case 'fitToDoc': cmd.fitToDoc(a.id, !!a.fill); return { ok: true };
    case 'select': cmd.select(a.ids || []); return { ok: true };
    case 'setDocument': { const p = { ...a }; cmd.setDocument(p); return { ok: true }; }
    default: throw new Error('unknown command ' + c.name);
  }
}
async function executeTool(name, args) {
  if (name === 'get_document') return documentSummary();
  if (name === 'run_commands') { const results = []; for (const c of args.commands || []) { try { results.push({ name: c.name, result: runCommand(c) }); } catch (e) { results.push({ name: c.name, error: String(e.message || e) }); } } return { results }; }
  if (name === 'create_tool') { try { await installTool(args.tool, { toLibrary: false, silent: true }); return { ok: true, kind: 'tool:' + args.tool.id, defaults: Object.fromEntries(Object.entries(args.tool.schema).map(([k, s]) => [k, s.default])) }; } catch (e) { return { errors: [String(e.message || e)] }; } }
  if (name === 'sample_values') { return { values: (args.points || []).map(p => { const v = valueAt(p.x, p.y); return { x: p.x, y: p.y, value: v, display: v == null ? null : +depthToDisplay(v).toFixed(2) }; }) }; }
  throw new Error('unknown tool ' + name);
}

// ---------------------------------------------------------------- provider adapters
// Each adapter keeps its own message history and exposes: addUser(text), send() -> {text, calls:[{id,name,args}]}, addResults([{id,name,result}])
function anthropicAdapter({ apiKey, model }) {
  const messages = []; let client = null;
  const tools = TOOL_DEFS.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  return {
    addUser(text) { messages.push({ role: 'user', content: text }); },
    async send(signal) {
      if (!client) { const mod = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.124.0/+esm'); const Anthropic = mod.default || mod.Anthropic; client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true }); }
      const params = { model, max_tokens: 16000, system: SYSTEM(), tools, messages };
      let res;
      try { res = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal }); }
      catch (e) { if (e && e.status === 400 && /fallback|beta/i.test(String(e.message))) res = await client.messages.create(params, { signal }); else throw e; }
      if (res.stop_reason === 'refusal') throw new Error('The model declined this request' + (res.stop_details && res.stop_details.explanation ? ': ' + res.stop_details.explanation : '.'));
      messages.push({ role: 'assistant', content: res.content });
      const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const calls = res.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input }));
      return { text, calls };
    },
    addResults(results) { messages.push({ role: 'user', content: results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.result) })) }); },
  };
}
function openaiAdapter({ apiKey, model }) {
  const messages = [{ role: 'system', content: SYSTEM() }];
  const tools = TOOL_DEFS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  return {
    addUser(text) { messages.push({ role: 'user', content: text }); },
    async send(signal) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, body: JSON.stringify({ model, messages, tools }) });
      if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const j = await r.json(); const m = j.choices[0].message; messages.push(m);
      return { text: m.content || '', calls: (m.tool_calls || []).map(c => ({ id: c.id, name: c.function.name, args: JSON.parse(c.function.arguments || '{}') })) };
    },
    addResults(results) { for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.result) }); },
  };
}
function googleAdapter({ apiKey, model }) {
  const contents = []; let n = 0;
  const tools = [{ functionDeclarations: TOOL_DEFS.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
  return {
    addUser(text) { contents.push({ role: 'user', parts: [{ text }] }); },
    async send(signal) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM() }] }, contents, tools }) });
      if (!r.ok) throw new Error(`Google ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const j = await r.json(); const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      contents.push({ role: 'model', parts });
      return { text: parts.filter(p => p.text).map(p => p.text).join('\n'), calls: parts.filter(p => p.functionCall).map(p => ({ id: 'g' + (++n), name: p.functionCall.name, args: p.functionCall.args || {} })) };
    },
    addResults(results) { contents.push({ role: 'user', parts: results.map(r => ({ functionResponse: { name: r.name, response: { result: r.result } } })) }); },
  };
}
const ADAPTERS = { anthropic: anthropicAdapter, openai: openaiAdapter, google: googleAdapter };
let adapterOverride = null; // for tests
export function setAdapterFactory(fn) { adapterOverride = fn; }

// ---------------------------------------------------------------- UI
let adapter = null, busy = false, abort = null, turnCommits = 0;
export function initAgent() {
  const b = el('button', 'aibtn', '✦'); b.id = 'aiBtn'; b.title = 'AI assistant'; document.body.appendChild(b);
  const dr = el('div'); dr.id = 'aiDrawer'; document.body.appendChild(dr);
  const head = el('div', 'aihead');
  const prov = document.createElement('select'); for (const [k, l] of Object.entries({ anthropic: 'Anthropic (Claude)', openai: 'OpenAI', google: 'Google (Gemini)' })) { const o = el('option', null, l); o.value = k; prov.appendChild(o); } prov.value = settings.provider;
  const model = document.createElement('input'); model.type = 'text'; model.value = settings.models[settings.provider]; model.title = 'Model id'; model.style.width = '150px';
  const key = document.createElement('input'); key.type = 'password'; key.placeholder = 'API key (stored in this browser only)'; key.value = settings.keys[settings.provider] || ''; key.style.flex = '1';
  const closeB = btn('✕', () => dr.classList.remove('on'), 'small');
  prov.addEventListener('change', () => { settings.provider = prov.value; model.value = settings.models[prov.value]; key.value = settings.keys[prov.value] || ''; adapter = null; saveSettings(); });
  model.addEventListener('change', () => { settings.models[settings.provider] = model.value.trim() || DEFAULT_MODELS[settings.provider]; adapter = null; saveSettings(); });
  key.addEventListener('change', () => { settings.keys[settings.provider] = key.value.trim(); adapter = null; saveSettings(); });
  const row1 = el('div', 'row'); row1.append(el('b', null, 'Assistant'), el('span', null, ' '), prov, closeB); row1.style.justifyContent = 'space-between';
  const row2 = el('div', 'row'); row2.append(model, key);
  head.append(row1, row2);
  const log = el('div', 'ailog');
  const inputRow = el('div', 'aiinput'); const ta = document.createElement('textarea'); ta.rows = 3; ta.placeholder = 'Describe what to add or change… e.g. "put a ring of 12 raised stars around the statue"';
  const send = btn('Send', () => submit(), 'primary'); const stop = btn('Stop', () => { if (abort) abort.abort(); }, ''); stop.disabled = true;
  const clear = btn('New chat', () => { adapter = null; log.innerHTML = ''; }, '');
  const bar = el('div', 'btnrow'); bar.append(send, stop, clear); inputRow.append(ta, bar);
  const status = el('div', 'hint'); status.id = 'aiStatus';
  dr.append(head, log, status, inputRow);
  b.addEventListener('click', () => { dr.classList.toggle('on'); if (dr.classList.contains('on')) ta.focus(); });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
  const bubble = (cls, text) => { const d = el('div', 'aimsg ' + cls); d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };

  async function submit(textOverride) {
    const text = (textOverride ?? ta.value).trim(); if (!text || busy) return; ta.value = '';
    const apiKey = settings.keys[settings.provider];
    if (!adapterOverride && !apiKey) { bubble('sys', 'Enter an API key for the selected provider first. It is stored only in this browser.'); return; }
    if (!adapter) adapter = adapterOverride ? adapterOverride() : ADAPTERS[settings.provider]({ apiKey, model: settings.models[settings.provider] });
    bubble('user', text); busy = true; send.disabled = true; stop.disabled = false; abort = new AbortController();
    const depth0 = undoDepth(); turnCommits = 0;
    adapter.addUser(text + `\n\n(Current document: ${state.doc.w}×${state.doc.h} px, ${state.root.children.length} top-level layers, selection: ${state.sel.join(', ') || 'none'}.)`);
    try {
      for (let iter = 0; iter < 16; iter++) {
        status.textContent = iter ? `Working… (${iter})` : 'Thinking…';
        const { text: reply, calls } = await adapter.send(abort.signal);
        if (reply) bubble('ai', reply);
        if (!calls.length) break;
        const results = [];
        for (const c of calls) { const line = bubble('call', `${c.name}${c.name === 'run_commands' ? ' × ' + ((c.args.commands || []).length) : ''}`); const result = await executeTool(c.name, c.args || {}); if (result && result.errors) line.textContent += ' — ' + result.errors.join('; '); results.push({ id: c.id, name: c.name, result }); }
        adapter.addResults(results);
      }
    } catch (e) { bubble('sys', e.name === 'AbortError' ? 'Stopped.' : 'Error: ' + (e.message || e)); }
    const made = undoDepth() - depth0;
    if (made > 0) { const d = bubble('sys', `${made} change${made > 1 ? 's' : ''} applied. `); const r = btn('Revert this reply', () => { for (let i = 0; i < made; i++) undo(); d.textContent = 'Reverted.'; }, 'small'); d.appendChild(r); }
    status.textContent = ''; busy = false; send.disabled = false; stop.disabled = true; abort = null;
  }
  return { submit, isOpen: () => dr.classList.contains('on') };
}
