// Headless smoke test: drives depthcad.html in a local Chrome via puppeteer-core.
//   npm install && npm test
// Set CHROME=/path/to/chrome if Chrome is not at the default macOS location.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(here, '..');
const OUT = path.join(here, 'out');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function check(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); console.log('ok  ' + msg); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 900 });
    page.on('dialog', d => d.accept());
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + path.join(ROOT, 'depthcad.html')); await sleep(800);
    await page.evaluate(() => { depthcad.io.newProject(); depthcad.refreshAll(); });

    // image import (8-bit PNG through the built-in decoder)
    await (await page.$('#fileImg')).uploadFile(path.join(ROOT, 'examples/assets/violin_depth_1024.png')); await sleep(2500);
    let r = await page.evaluate(() => ({ n: depthcad.state.root.children.length, doc: depthcad.state.doc, bits: Object.values(depthcad.state.images)[0].bits }));
    check(r.n === 1 && r.doc.w === 553 && r.doc.h === 1024 && r.bits === 16, 'image import sets document size (16-bit source)');
    await page.evaluate(() => { const s = depthcad.state; s.doc.w = 1024; s.doc.h = 1024; s.root.children[0].x = 512; s.root.children[0].y = 512; depthcad.refreshAll(); });

    // build a scene: mask via group, ring, cut, text, modifier
    r = await page.evaluate(async () => {
      const { cmd, state } = depthcad;
      const img = state.root.children[0];
      const mask = cmd.addMaskTo(img.id, 'ellipse'); cmd.setParams(mask.id, { w: 700, h: 700 }); cmd.addModifier(mask.id, 'feather'); cmd.setModifier(mask.id, 0, { radius: 5 });
      const ring = cmd.add('shape', { shape: 'ellipse', w: 900, h: 900, inner: 0.85, profile: 'dome', high: 200 / 255 }, { parentId: 'root' });
      const cut = cmd.add('shape', { shape: 'rect', w: 200, h: 60 }, { parentId: 'root', node: { x: 512, y: 930, blend: 'cut' } });
      const txt = cmd.add('text', { text: 'TEST', family: 'Helvetica', size: 80, value: 240 / 255 }, { parentId: 'root', node: { y: 800 } });
      cmd.addModifier(img.id, 'levels'); cmd.setModifier(img.id, 0, { outB: 0.1 });
      await new Promise(res => setTimeout(res, 300));

      return { kinds: state.root.children.map(c => c.kind + (c.children ? '[' + c.children.map(k => k.kind).join(',') + ']' : '')), sel: state.sel.length };
    });
    check(r.kinds[0] === 'group[mask,image]' && r.kinds.slice(1).join() === 'shape,shape,text', 'tree structure: ' + r.kinds.join(' '));

    // full-resolution export render through the export dialog pipeline
    r = await page.evaluate(async () => {
      const { state } = depthcad;
      // reach into the bundle: exportPNG is wired to the dialog; use the render path directly via io
      const out = await depthcad.renderFull();
      const at = (x, y) => out.height[y * out.w + x];
      let tmax = 0; for (let y = 760; y < 840; y++) for (let x = 400; x < 624; x++) tmax = Math.max(tmax, at(x, y));
      return { size: [out.w, out.h], center: at(512, 512), ring: at(512 + 415, 512), cut: at(512, 930), outsideMask: at(100, 100), text: tmax };
    });
    check(r.size[0] === 1024 && r.size[1] === 1024, 'export render is document resolution');
    check(r.center > 0.4, 'image contributes at center (' + r.center.toFixed(3) + ')');
    check(Math.abs(r.ring - 200 / 255) < 0.01, 'ring crest value (' + r.ring.toFixed(3) + ')');
    check(r.cut === 0, 'cut layer erases below (' + r.cut + ')');
    check(r.outsideMask === 0, 'mask clips the image');
    check(Math.abs(r.text - 240 / 255) < 0.01, 'text renders at its value (' + r.text.toFixed(3) + ')');

    // 16-bit PNG export and re-import round trip
    r = await page.evaluate(async () => {
      const bytes = await depthcad.encode16();

      const id = await depthcad.io.registerImage('data:image/png;base64,' + depthcad.toBase64(bytes));
      const im = depthcad.state.images[id];
      const out = await depthcad.renderFull();
      let maxErr = 0; for (let i = 0; i < out.height.length; i += 97) maxErr = Math.max(maxErr, Math.abs(im.full[i] / 65535 - out.height[i]));
      return { bits: im.bits, w: im.w, maxErr, bytes: bytes.length };
    });
    check(r.bits === 16 && r.w === 1024 && r.maxErr < 1 / 65535 + 1e-6, `16-bit PNG export/import round trip (max err ${r.maxErr.toExponential(2)}, ${r.bytes} bytes)`);

    // save/load round trip, undo/redo, copy/paste, align
    r = await page.evaluate(async () => {
      const { state, cmd } = depthcad;
      const before = JSON.stringify(state.root, (k, v) => k.startsWith('_') ? undefined : v);
      const p = JSON.parse(JSON.stringify(depthcad.serialize()));
      await depthcad.io.loadProject(p); depthcad.refreshAll();
      const after = JSON.stringify(state.root, (k, v) => k.startsWith('_') ? undefined : v);
      const n0 = state.root.children.length; cmd.select([state.root.children[1].id]); cmd.remove(state.sel); const n1 = state.root.children.length; depthcad.undo(); const n2 = state.root.children.length; depthcad.redo(); const n3 = state.root.children.length; depthcad.undo();
      const ids = state.root.children.slice(1, 3).map(c => c.id); cmd.select(ids); cmd.align(ids, 'left'); const a = ids.map(id => cmd.boxOf(depthcad.findNode(id))).map(b => b.x - b.w / 2);
      const payload = cmd.copyNodes([ids[0]]); cmd.pasteNodes(payload); const n4 = state.root.children.length;
      return { same: before === after, n0, n1, n2, n3, n4, alignedLeft: Math.abs(a[0] - a[1]) < 1e-6, images: Object.keys(state.images).length };
    });
    check(r.same, 'project save/load round trip');
    check(r.n1 === r.n0 - 1 && r.n2 === r.n0 && r.n3 === r.n0 - 1, 'delete, undo, redo');
    check(r.alignedLeft, 'align left');
    check(r.n4 === r.n0 + 1, 'copy/paste');

    // v1 project migration
    await (await page.$('#fileProj')).uploadFile(path.join(here, 'fixtures/v1-medallion.dcad.json')); await sleep(4000);
    r = await page.evaluate(async () => { const { state } = depthcad; const out = await depthcad.renderFull(); return { n: state.root.children.length, kinds: state.root.children.map(c => c.kind), w: out.w, max: out.height.reduce((m, v) => v > m ? v : m, 0) }; });
    check(r.n === 5 && r.kinds.includes('group') && r.max > 0.5, 'v1 project migrates and renders (' + r.kinds.join(',') + ')');

    await sleep(500); await page.screenshot({ path: path.join(OUT, 'smoke.png') });
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('\nAll smoke checks passed. Screenshot: ' + path.join(OUT, 'smoke.png'));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exit(1); });
