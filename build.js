// Bundles src/ into the single-file depthcad.html (no dependencies).
// Each ES module becomes a function in a tiny module registry so module scope is preserved.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'src');
const ENTRY = './app/main.js';

const modules = new Map(); // id -> transformed source
function resolve(fromId, spec) { return './' + path.posix.normalize(path.posix.join(path.posix.dirname(fromId), spec)); }

function transform(id) {
  if (modules.has(id)) return;
  let src = fs.readFileSync(path.join(SRC, id), 'utf8');
  const deps = [];
  const exportsList = [];
  // imports (single-line forms)
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm, (m, names, spec) => {
    const dep = resolve(id, spec); deps.push(dep);
    const list = names.split(',').map(s => s.trim()).filter(Boolean).map(s => { const [a, b] = s.split(/\s+as\s+/); return b ? `${a.trim()}: ${b.trim()}` : a.trim(); });
    return `const { ${list.join(', ')} } = __require('${dep}');`;
  });
  src = src.replace(/^import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"];?\s*$/gm, (m, ns, spec) => { const dep = resolve(id, spec); deps.push(dep); return `const ${ns} = __require('${dep}');`; });
  src = src.replace(/^import\s*['"]([^'"]+)['"];?\s*$/gm, (m, spec) => { const dep = resolve(id, spec); deps.push(dep); return `__require('${dep}');`; });
  // exports
  src = src.replace(/^export\s+(async\s+function|function|class|const|let|var)\s+([\w$]+)/gm, (m, kw, name) => { exportsList.push(name); return `${kw} ${name}`; });
  src = src.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (m, names) => { for (const s of names.split(',')) { const n = s.trim(); if (n) exportsList.push(n); } return ''; });
  if (/^export\s+default/m.test(src)) throw new Error(`export default not supported (${id})`);
  const getters = exportsList.map(n => `get ${n}() { return ${n}; }`).join(', ');
  modules.set(id, `__define('${id}', function (__exports) {\n${src}\nObject.defineProperties(__exports, Object.getOwnPropertyDescriptors({ ${getters} }));\n});`);
  for (const d of deps) transform(d);
}
transform(ENTRY);

const runtime = `const __mods = {}, __cache = {};
function __define(id, fn) { __mods[id] = fn; }
function __require(id) { if (__cache[id]) return __cache[id]; const exp = {}; __cache[id] = exp; if (!__mods[id]) throw new Error('Missing module ' + id); __mods[id](exp); return exp; }`;
const order = [...modules.keys()].sort();
const bundle = ['\'use strict\';', runtime, ...order.map(id => modules.get(id)), `__require('${ENTRY}');`].join('\n');

const template = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
if (!template.includes('<!-- @scripts -->')) throw new Error('template missing <!-- @scripts -->');
const html = template.replace('<!-- @scripts -->', () => `<script>\n${bundle}\n</script>`);
fs.writeFileSync(path.join(here, 'depthcad.html'), html);
console.log(`built depthcad.html: ${order.length} modules, ${(html.length / 1024).toFixed(0)} KB`);
