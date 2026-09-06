// Regenerates the example projects (v2 format), their preview PNGs and the README screenshot
// by driving the built app in headless Chrome:  node tests/gen-examples.js
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const A = path.join(ROOT, 'examples/assets');
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

  // 1. medallion: base plate, masked scan (feathered), torus ring, captions
  await fresh(1024, 1024); await importImg(path.join(A, 'christus_depth_1024.png'));
  await page.evaluate(() => {
    const { cmd, state } = depthcad; const img = state.root.children[0]; cmd.setNodeProps(img.id, { name: 'Christus (scan)' });
    const mask = cmd.addMaskTo(img.id, 'ellipse'); cmd.setParams(mask.id, { w: 820, h: 820 }); cmd.addModifier(mask.id, 'feather'); cmd.setModifier(mask.id, 0, { radius: 6 });
    const plate = cmd.add('shape', { shape: 'ellipse', w: 820, h: 820, inner: 0, profile: 'flat', high: 24 / 255 }, { parentId: 'root', index: 0, name: 'Base plate' });
    cmd.add('shape', { shape: 'ellipse', w: 940, h: 940, inner: 0.86, profile: 'dome', high: 200 / 255 }, { parentId: 'root', name: 'Torus ring' });
    cmd.add('text', { text: 'HE IS RISEN', family: 'Georgia', weight: '700', size: 62, spacing: 6, value: 235 / 255 }, { parentId: 'root', name: 'Caption', node: { y: 512 + 345 } });
    cmd.add('text', { text: 'Come unto me', family: 'Snell Roundhand', weight: '400', italic: true, size: 58, value: 225 / 255 }, { parentId: 'root', name: 'Script', node: { y: 512 - 380, rot: -4 } });
  });
  await finish('christus-medallion', 512);
  await page.evaluate(() => { const { cmd, state } = depthcad; cmd.select([state.root.children[2].id]); }); await sleep(600);
  await page.screenshot({ path: path.join(ROOT, 'docs/screenshot.png') });

  // 2. terrain coaster: bevelled base, levels + circular mask, rim, clamp, engraved (cut) label
  await fresh(1024, 1024); await importImg(path.join(A, 'terrain.png'), 1024, 1024);
  await page.evaluate(() => {
    const { cmd, state } = depthcad; const terr = state.root.children[0];
    cmd.setNodeProps(terr.id, { name: 'Terrain (levels + mask)', x: 512, y: 512, sx: 800 / 768, sy: 800 / 768 });
    cmd.addModifier(terr.id, 'levels'); cmd.setModifier(terr.id, 0, { outB: 70 / 255, gamma: 0.9 });
    const mask = cmd.addMaskTo(terr.id, 'ellipse'); cmd.setParams(mask.id, { w: 700, h: 700 });
    cmd.add('shape', { shape: 'rect', w: 940, h: 940, corner: 140, profile: 'bevel', bevel: 36, high: 70 / 255 }, { parentId: 'root', index: 0, name: 'Coaster base' });
    cmd.add('shape', { shape: 'ellipse', w: 770, h: 770, inner: 0.94, profile: 'dome', high: 110 / 255 }, { parentId: 'root', name: 'Rim' });
    cmd.add('text', { text: 'TERRA', family: 'Helvetica', weight: '900', size: 70, spacing: 14 }, { parentId: 'root', name: 'Engraved label (Cut)', node: { y: 512 + 430, blend: 'cut' } });
    cmd.add('shape', { shape: 'rect', w: 1024, h: 1024, profile: 'flat', high: 215 / 255 }, { parentId: 'root', name: 'Flatten peaks (Clamp)', node: { blend: 'min' } });
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
    mk('Flat rect', { shape: 'rect', w: 260, h: 260, profile: 'flat', high: 160 / 255 }, { x: 175, y: 190 });
    mk('Linear (cone)', { shape: 'ellipse', w: 260, h: 260, inner: 0, profile: 'linear', high: 1 }, { x: 525, y: 190 });
    mk('Dome', { shape: 'ellipse', w: 260, h: 260, inner: 0, profile: 'dome', high: 1 }, { x: 875, y: 190 });
    mk('Cosine rounded rect', { shape: 'rect', w: 260, h: 260, corner: 60, profile: 'cosine', high: 220 / 255 }, { x: 175, y: 520 });
    mk('Bevel frame (inner)', { shape: 'rect', w: 260, h: 260, inner: 0.55, corner: 30, profile: 'bevel', bevel: 30, high: 200 / 255 }, { x: 525, y: 520 });
    mk('Torus ring', { shape: 'ellipse', w: 260, h: 260, inner: 0.7, profile: 'dome', high: 1 }, { x: 875, y: 520 });
    mk('Clamp (min) flattens the cone', { shape: 'rect', w: 300, h: 300, profile: 'flat', high: 180 / 255 }, { x: 525, y: 190, blend: 'min' });
    mk('Cut notch', { shape: 'rect', w: 320, h: 36, profile: 'flat', high: 1 }, { x: 875, y: 590, blend: 'cut' });
    cmd.add('text', { text: 'DepthCAD', family: 'Helvetica', weight: '700', size: 64, value: 200 / 255 }, { parentId: 'root', name: 'Label', node: { x: 1225, y: 520, rot: -12 } });
  });
  await finish('shapes-primer', 700);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
