// Headless test of extension tools (Worker runtime) and the agent loop with a fake provider.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(here, '..'); const OUT = path.join(here, 'out');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function check(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); console.log('ok  ' + msg); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 900 });
    page.on('dialog', d => { console.log('dialog:', d.message()); d.accept(); });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + path.join(ROOT, 'depthcad.html')); await sleep(800);
    await page.evaluate(() => { depthcad.io.newProject(); depthcad.refreshAll(); });

    // built-in tool through the Worker
    let r = await page.evaluate(async () => {
      const t = depthcad.tools.BUILTIN_TOOLS.find(t => t.id === 'star-ring');
      await depthcad.tools.installTool(t, { silent: true });
      const n = depthcad.tools.addToolNode(t, { count: 8, radius: 300, size: 60 });
      const out = await depthcad.renderFull();
      const at = (x, y) => out.height[y * out.w + x];
      let covered = 0; for (let i = 0; i < out.height.length; i += 7) if (out.height[i] > 0) covered++;
      return { kind: n.kind, center: at(512, 512), star: at(512 + 300, 512), covered, err: n._error || null, w: out.w };
    });
    check(r.kind === 'tool:star-ring', 'tool node created');
    check(r.center === 0 && r.star > 0.9 && r.covered > 100, `stars render in the Worker (centre ${r.center}, star ${r.star.toFixed(3)})`);
    check(!r.err, 'no tool render error');

    // text-on-arc tool uses OffscreenCanvas in the Worker
    r = await page.evaluate(async () => {
      const t = depthcad.tools.BUILTIN_TOOLS.find(t => t.id === 'text-arc');
      await depthcad.tools.installTool(t, { silent: true });
      const n = depthcad.tools.addToolNode(t, { radius: 350, size: 70, text: 'DEPTH' });
      const out = await depthcad.renderFull(); let covered = 0; for (let i = 0; i < out.height.length; i += 3) if (out.height[i] > 0.9) covered++;
      return { covered, err: n._error || null };
    });
    check(r.covered > 50 && !r.err, `text on an arc rendered (${r.covered} samples)`);

    // a broken tool reports an error instead of crashing
    r = await page.evaluate(async () => { try { await depthcad.tools.installTool({ format: 'depthcad-tool/1', id: 'bad', name: 'Bad', version: 1, schema: {}, measure: 'return {w:10,h:10}', render: 'throw new Error("boom")' }, { silent: true }); return 'installed'; } catch (e) { return e.message; } });
    check(/boom/.test(r), 'broken tool is rejected with its error (' + r + ')');

    // project round trip keeps tools
    r = await page.evaluate(async () => { const p = JSON.parse(JSON.stringify(depthcad.serialize())); const ids = Object.keys(p.tools); await depthcad.io.loadProject(p); depthcad.refreshAll(); const out = await depthcad.renderFull(); return { ids, kinds: depthcad.state.root.children.map(c => c.kind), star: out.height[512 * out.w + 812] }; });
    check(r.ids.length === 2 && r.kinds[0] === 'tool:star-ring' && r.star > 0.9, 'tools survive save/load and still render');

    // agent loop with a scripted fake provider
    r = await page.evaluate(async () => {
      const script = [
        { text: '', calls: [{ id: 'c1', name: 'get_document', args: {} }] },
        { text: '', calls: [{ id: 'c2', name: 'run_commands', args: { commands: [{ name: 'add', args: { kind: 'shape', params: { shape: 'ellipse', w: 500, h: 500, profile: 'dome', high: 0.8 }, name: 'Agent dome', x: 512, y: 512 } }, { name: 'addModifier', args: { id: 'LAST', kind: 'feather', settings: { radius: 3 } } }] } }] },
        { text: '', calls: [{ id: 'c3', name: 'create_tool', args: { tool: { format: 'depthcad-tool/1', id: 'agent-bumps', name: 'Bumps', version: 1, description: 'grid of bumps', schema: { n: { type: 'int', default: 4, min: 1, max: 20 }, size: { type: 'number', default: 200, min: 10, max: 2000 } }, measure: 'return {w:p.size,h:p.size}', render: 'lib.each((u,v)=>{const cell=p.size/p.n;const cu=((u+p.size/2)%cell)-cell/2,cv=((v+p.size/2)%cell)-cell/2;const d=lib.sdf.circle(cu,cv,cell*0.4);const c=lib.aa(d);return c>0?[lib.profile("dome",d,cell*0.4),c]:null;});' } } }] },
        { text: '', calls: [{ id: 'c4', name: 'run_commands', args: { commands: [{ name: 'add', args: { kind: 'tool:agent-bumps', params: { n: 5, size: 300 }, name: 'Bumps', x: 200, y: 200 } }] } }, { id: 'c5', name: 'sample_values', args: { points: [{ x: 512, y: 512 }] } }] },
        { text: 'Added a dome and a grid of bumps.', calls: [] },
      ];
      const seen = [];
      depthcad.agent.setAdapterFactory(() => { let i = 0; return { addUser() { }, async send() { return script[i++]; }, addResults(rs) { seen.push(rs.map(r => r.result)); const last = rs.find(x => x.name === 'run_commands'); if (last) { const id = last.result.results[0].result && last.result.results[0].result.id; for (const s of script) for (const c of s.calls) if (c.name === 'run_commands') for (const cc of c.args.commands) if (cc.args.id === 'LAST') cc.args.id = id; } } }; });
      await depthcad.agent.ui.submit('make something');
      await new Promise(r => setTimeout(r, 800));
      const out = await depthcad.renderFull();
      const names = depthcad.state.root.children.map(c => c.name);
      const log = [...document.querySelectorAll('#aiDrawer .aimsg')].map(d => d.className.replace('aimsg ', '') + ': ' + d.textContent.slice(0, 60));
      return { names, kinds: depthcad.state.root.children.map(c => c.kind), docKeys: Object.keys(seen[0][0]), sample: seen[3] && seen[3][1] && seen[3][1].values[0].value, center: out.height[512 * out.w + 512], log, tool: !!depthcad.state.tools['agent-bumps'] };
    });
    check(r.names.includes('Agent dome') && r.kinds.includes('tool:agent-bumps') && r.tool, 'agent added a shape, created a tool and added a tool layer');
    check(r.docKeys.includes('layers_bottom_to_top') && r.docKeys.includes('kinds'), 'get_document returns the summary');
    check(r.center > 0.7 && r.sample > 0.7, `dome height read back through sample_values (${(+r.sample).toFixed(3)})`);
    check(r.log.some(l => l.startsWith('ai: Added')) && r.log.some(l => /changes applied/.test(l)), 'chat log shows the reply and the revert control');
    await page.screenshot({ path: path.join(OUT, 'agent.png') });
    // revert
    r = await page.evaluate(async () => { document.querySelector('#aiDrawer .aimsg.sys button').click(); await new Promise(r => setTimeout(r, 300)); return depthcad.state.root.children.map(c => c.name); });
    check(!r.includes('Agent dome') && !r.includes('Bumps'), 'revert undoes the reply');
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('\nAll tool/agent checks passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exit(1); });
