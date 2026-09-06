// Headless test of mesh import: bakes a generated STL (cube with a pyramid on top) through the dialog.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeBinarySTL } from '../src/engine/mesh.js';
import { cubeTriangles } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(here, '..'); const OUT = path.join(here, 'out');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function check(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); console.log('ok  ' + msg); }

// cube of size 2 (z from -1..1) with a pyramid apex at z = 2 on its top face
const cube = cubeTriangles(2);
const apex = [0, 0, 2], h = 0.5;
const pyr = [[-h, -h, 1], [h, -h, 1], [h, h, 1], [-h, h, 1]];
const tris = [...cube];
for (let i = 0; i < 4; i++) { const a = pyr[i], b = pyr[(i + 1) % 4]; tris.push(...a, ...b, ...apex); }
fs.mkdirSync(OUT, { recursive: true });
const stlPath = path.join(OUT, 'cube-pyramid.stl');
fs.writeFileSync(stlPath, Buffer.from(encodeBinarySTL(Float32Array.from(tris))));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 900 });
    page.on('dialog', d => { console.log('dialog:', d.message()); d.accept(); });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + path.join(ROOT, 'depthcad.html')); await sleep(800);
    await page.evaluate(() => { depthcad.io.newProject(); depthcad.refreshAll(); });
    await (await page.$('#fileMesh')).uploadFile(stlPath); await sleep(2500);
    let r = await page.evaluate(() => ({ open: document.querySelector('#modal').classList.contains('on'), bake: !!document.querySelector('#mBake'), meshes: Object.values(depthcad.state.meshes).map(m => m.triangles) }));
    check(r.open && r.bake && r.meshes[0] === 16, 'mesh parsed (16 triangles) and import dialog opened');
    await page.screenshot({ path: path.join(OUT, 'mesh-dialog.png') });
    // default view is +Z: looking at the cube's +Z face, so the pyramid apex points at the camera
    await page.click('#mBake'); await sleep(3000);
    r = await page.evaluate(async () => {
      const { state } = depthcad; const n = state.root.children[0]; const im = state.images[n.params.imageId];
      const out = await depthcad.renderFull(); const at = (x, y) => out.height[y * out.w + x];
      const cx = Math.floor(out.w / 2), cy = Math.floor(out.h / 2);
      return { kind: n && n.kind, bake: n && n.params.bake, w: im && im.w, h: im && im.h, hasCov: !!(im && im.cov), apex: at(cx, cy), face: at(Math.floor(out.w * 0.12), cy), corner: at(2, 2), doc: [state.doc.w, state.doc.h] };
    });
    check(r.kind === 'mesh' && r.hasCov, 'mesh layer created with baked coverage');
    check(r.w === r.bake.w && r.h === r.bake.h && r.bake.w >= 1000, `bake resolution ${r.w}×${r.h}`);
    check(r.apex > 0.97, `apex is near maximum height (${r.apex.toFixed(3)})`);
    check(Math.abs(r.face - 2 / 3) < 0.02, `cube top face at 2/3 of the range (${r.face.toFixed(3)})`);
    check(r.corner === 0, 'outside the model is background');
    // rotate to view from +X and re-bake through the dialog: the silhouette becomes a square with a triangle on top
    await page.evaluate(() => depthcad.openMeshImport({ meshId: Object.keys(depthcad.state.meshes)[0], nodeId: depthcad.state.root.children[0].id })); await sleep(800);
    await page.evaluate(() => { for (const b of document.querySelectorAll('#modalBox button')) if (b.textContent === '+X') b.click(); }); await sleep(600);
    await page.screenshot({ path: path.join(OUT, 'mesh-dialog-x.png') });
    await page.click('#mBake'); await sleep(3000);
    r = await page.evaluate(async () => { const n = depthcad.state.root.children[0]; const out = await depthcad.renderFull(); return { rot: n.params.bake.rot, w: out.w, h: out.h, top: out.height[Math.floor(out.h * 0.03) * out.w + Math.floor(out.w / 2)], nodes: depthcad.state.root.children.length }; });
    check(r.nodes === 1 && r.rot[1] === -90 && r.top > 0, `re-bake from +X updated the same layer (rot ${r.rot.join('/')})`);
    // save/load keeps the embedded mesh
    r = await page.evaluate(async () => { const p = JSON.parse(JSON.stringify(depthcad.serialize())); const hasMesh = Object.keys(p.meshes).length; await depthcad.io.loadProject(p); depthcad.refreshAll(); return { hasMesh, meshes: Object.keys(depthcad.state.meshes).length, kind: depthcad.state.root.children[0].kind, cov: !!Object.values(depthcad.state.images)[0].cov }; });
    check(r.hasMesh === 1 && r.meshes === 1 && r.kind === 'mesh' && r.cov, 'project round trip keeps the mesh and the baked coverage');
    await sleep(400); await page.screenshot({ path: path.join(OUT, 'mesh-result.png') });
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('\nAll mesh checks passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exit(1); });
