// Regenerates the example projects (v2 format), their preview PNGs and the README screenshot
// by driving the built app in headless Chrome:  node tests/gen-examples.js
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const A = path.join(ROOT, 'examples/assets');
const OUT = path.join(here, 'out'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
  page.on('dialog', d => d.accept()); page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto('file://' + path.join(ROOT, 'depthcad.html')); await sleep(800);
  const fresh = async (w, h) => { await page.evaluate((w, h) => { depthcad.io.newProject(); depthcad.state.doc.w = w; depthcad.state.doc.h = h; depthcad.refreshAll(); depthcad.fitView(); }, w, h); };
  const importImg = async (f, w, h) => { await (await page.$('#fileImg')).uploadFile(f); await sleep(1500); await page.evaluate((w, h) => { const s = depthcad.state; if (w) { s.doc.w = w; s.doc.h = h; const n = s.root.children[0]; n.x = w / 2; n.y = h / 2; } depthcad.refreshAll(); depthcad.fitView(); }, w, h); };
  const finish = async (name, previewSize) => {
    await page.evaluate(() => { depthcad.cmd.select([]); }); await sleep(600);
    const out = await page.evaluate(async (name) => {
      depthcad.state.name = name; depthcad.commit(); depthcad.refreshAll();
      const png = await depthcad.encode8('fs');
      return { json: JSON.stringify(depthcad.serialize()), png: depthcad.toBase64(png) };
    }, name);
    fs.writeFileSync(path.join(ROOT, `examples/${name}.dcad.json`), out.json);
    fs.writeFileSync(path.join(ROOT, `examples/${name}.full.png`), Buffer.from(out.png, 'base64'));
    console.log(name, 'json', out.json.length, 'bytes');
  };

  // 1. medallion: base plate, masked relief (feathered), torus ring, captions
  await fresh(1024, 1024); await importImg(path.join(A, 'violin_depth_1024.png'), 1024, 1024);
  await page.evaluate(() => {
    const { cmd, state } = depthcad; const img = state.root.children[0]; cmd.setNodeProps(img.id, { name: 'Violin (mesh bake)', sx: 0.78, sy: 0.78 });
    const mask = cmd.addMaskTo(img.id, 'ellipse'); cmd.setParams(mask.id, { w: 820, h: 820 }); cmd.addModifier(mask.id, 'feather'); cmd.setModifier(mask.id, 0, { radius: 6 });
    const plate = cmd.add('shape', { shape: 'ellipse', w: 820, h: 820, inner: 0, outerProfile: 'flat', high: 24 / 255 }, { parentId: 'root', index: 0, name: 'Base plate' });
    cmd.add('shape', { shape: 'ellipse', w: 940, h: 940, inner: 0.86, outerProfile: 'dome', innerProfile: 'dome', outerWidth: 33, innerWidth: 33, high: 200 / 255 }, { parentId: 'root', name: 'Torus ring' });
    cmd.add('text', { text: 'CON BRIO', family: 'Georgia', weight: '700', size: 62, spacing: 6, value: 235 / 255 }, { parentId: 'root', name: 'Caption', node: { y: 512 + 345 } });
    cmd.add('text', { text: 'Allegro', family: 'Snell Roundhand', weight: '400', italic: true, size: 58, value: 225 / 255 }, { parentId: 'root', name: 'Script', node: { y: 512 - 380, rot: -4 } });
  });
  await finish('violin-medallion', 512);
  await page.evaluate(() => { const { cmd, state } = depthcad; cmd.select([state.root.children[2].id]); }); await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'screenshot-medallion.png') }); // docs/screenshot.png is a hand-made screenshot

  // 2. terrain coaster: bevelled base, levels + circular mask, rim, clamp, engraved (cut) label
  await fresh(1024, 1024); await importImg(path.join(A, 'terrain.png'), 1024, 1024);
  await page.evaluate(() => {
    const { cmd, state } = depthcad; const terr = state.root.children[0];
    cmd.setNodeProps(terr.id, { name: 'Terrain (levels + mask)', x: 512, y: 512, sx: 800 / 768, sy: 800 / 768 });
    cmd.addModifier(terr.id, 'levels'); cmd.setModifier(terr.id, 0, { outB: 70 / 255, gamma: 0.9 });
    const mask = cmd.addMaskTo(terr.id, 'ellipse'); cmd.setParams(mask.id, { w: 700, h: 700 });
    cmd.add('shape', { shape: 'rect', w: 940, h: 940, corner: 140, outerProfile: 'linear', outerWidth: 36, high: 70 / 255 }, { parentId: 'root', index: 0, name: 'Coaster base' });
    cmd.add('shape', { shape: 'ellipse', w: 770, h: 770, inner: 0.94, outerProfile: 'dome', innerProfile: 'dome', outerWidth: 11.5, innerWidth: 11.5, high: 110 / 255 }, { parentId: 'root', name: 'Rim' });
    cmd.add('text', { text: 'TERRA', family: 'Helvetica', weight: '900', size: 70, spacing: 14 }, { parentId: 'root', name: 'Engraved label (Cut)', node: { y: 512 + 430, blend: 'cut' } });
    cmd.add('shape', { shape: 'rect', w: 1024, h: 1024, outerProfile: 'flat', high: 215 / 255 }, { parentId: 'root', name: 'Flatten peaks (Clamp)', node: { blend: 'min' } });
    const g = cmd.group([state.root.children[1].id, state.root.children[2].id], { name: 'Landscape' });
    cmd.addModifier(g.id, 'curve'); cmd.setModifier(g.id, 0, { points: [[0, 0], [0.3, 0.2], [0.7, 0.85], [1, 1]] });
  });
  await finish('terrain-coaster', 512);

  // 3. shapes primer: every profile, a frame, a torus, clamp and cut, inverted image, rotated text
  await fresh(1400, 700); await importImg(path.join(A, 'sphere.png'), 1400, 700);
  await page.evaluate(() => {
    const { cmd, state } = depthcad; const sph = state.root.children[0];
    cmd.setNodeProps(sph.id, { name: 'Sphere image, inverted levels', x: 1225, y: 190, sx: 0.5, sy: 0.5 }); cmd.setParam(sph.id, 'zeroAlpha', false);
    cmd.addModifier(sph.id, 'levels'); cmd.setModifier(sph.id, 0, { invert: true });
    const m = cmd.addMaskTo(sph.id, 'ellipse'); cmd.setParams(m.id, { w: 256, h: 256 });
    const mk = (name, p, node) => cmd.add('shape', p, { parentId: 'root', name, node });
    mk('Flat rect', { shape: 'rect', w: 260, h: 260, outerProfile: 'flat', high: 160 / 255 }, { x: 175, y: 190 });
    mk('Linear (cone)', { shape: 'ellipse', w: 260, h: 260, inner: 0, outerProfile: 'linear', outerWidth: 130, high: 1 }, { x: 525, y: 190 });
    mk('Dome', { shape: 'ellipse', w: 260, h: 260, inner: 0, outerProfile: 'dome', outerWidth: 130, high: 1 }, { x: 875, y: 190 });
    mk('Ogee rounded rect', { shape: 'rect', w: 260, h: 260, corner: 60, outerProfile: 'ogee', outerWidth: 90, high: 220 / 255 }, { x: 175, y: 520 });
    mk('Frame: bevel outside, cove inside', { shape: 'rect', w: 260, h: 260, inner: 0.55, corner: 30, outerProfile: 'linear', outerWidth: 30, innerProfile: 'scallop', innerWidth: 22, high: 200 / 255 }, { x: 525, y: 520 });
    mk('Torus ring', { shape: 'ellipse', w: 260, h: 260, inner: 0.7, outerProfile: 'dome', innerProfile: 'dome', outerWidth: 19.5, innerWidth: 19.5, high: 1 }, { x: 875, y: 520 });
    mk('Clamp (min) flattens the cone', { shape: 'rect', w: 300, h: 300, outerProfile: 'flat', high: 180 / 255 }, { x: 525, y: 190, blend: 'min' });
    mk('Cut notch', { shape: 'rect', w: 320, h: 36, outerProfile: 'flat', high: 1 }, { x: 875, y: 590, blend: 'cut' });
    cmd.add('text', { text: 'DepthCAD', family: 'Helvetica', weight: '700', size: 64, value: 200 / 255 }, { parentId: 'root', name: 'Label', node: { x: 1225, y: 520, rot: -12 } });
  });
  await finish('shapes-primer', 700);

  // 4. tool showcase: ring of stars and arc text around the relief, noise texture plate
  await fresh(1024, 1024); await importImg(path.join(A, 'violin_depth_1024.png'), 1024, 1024);
  await page.evaluate(async () => {
    const { cmd, state } = depthcad; const img = state.root.children[0]; cmd.setNodeProps(img.id, { name: 'Violin (mesh bake)', sx: 0.52, sy: 0.52 });
    const mask = cmd.addMaskTo(img.id, 'ellipse'); cmd.setParams(mask.id, { w: 560, h: 560 }); cmd.addModifier(mask.id, 'feather'); cmd.setModifier(mask.id, 0, { radius: 4 });
    const T = depthcad.tools.BUILTIN_TOOLS; const by = id => T.find(t => t.id === id);
    for (const id of ['noise-texture', 'star-ring', 'text-arc']) await depthcad.tools.installTool(by(id), { silent: true });
    const plate = depthcad.tools.addToolNode(by('noise-texture'), { w: 1000, h: 1000, cell: 40, octaves: 5, low: 0.08, high: 0.22, seed: 3 }, { parentId: 'root', index: 0 }); cmd.setNodeProps(plate.id, { name: 'Hammered plate' });
    const pm = cmd.addMaskTo(plate.id, 'ellipse'); cmd.setParams(pm.id, { w: 980, h: 980 });
    cmd.add('shape', { shape: 'ellipse', w: 620, h: 620, inner: 0.9, outerProfile: 'fluted', innerProfile: 'dome', outerWidth: 24, innerWidth: 14, high: 0.75 }, { parentId: 'root', name: 'Inner ring' });
    const stars = depthcad.tools.addToolNode(by('star-ring'), { count: 16, radius: 400, size: 34, inner: 45, profile: 'dome', high: 0.85 }, { parentId: 'root' }); cmd.setNodeProps(stars.id, { name: 'Ring of stars' });
    const arc = depthcad.tools.addToolNode(by('text-arc'), { text: 'ALLEGRO MA NON TROPPO  ·  CON BRIO  ·', radius: 455, size: 44, family: 'Georgia', weight: '700', start: -90, spacing: 0.6, value: 0.92 }, { parentId: 'root' }); cmd.setNodeProps(arc.id, { name: 'Arc text' });
    await depthcad.renderFull();
  });
  await finish('tool-showcase', 512);

  // 5. the hand-made violin project: re-save through the app and render its preview
  await page.evaluate(async (txt) => { await depthcad.io.loadProject(JSON.parse(txt)); depthcad.refreshAll(); depthcad.fitView(); }, fs.readFileSync(path.join(ROOT, 'examples/violin-staff.dcad.json'), 'utf8'));
  await sleep(1500);
  await finish('violin-staff', 512);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
