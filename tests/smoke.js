// Headless smoke test: drives depthcad.html in a local Chrome via puppeteer-core.
//   npm install && npm test
// Set CHROME=/path/to/chrome if Chrome is not at the default macOS location.
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function check(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); console.log('ok  ' + msg); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    page.on('dialog', d => d.accept());
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('file://' + path.join(ROOT, 'depthcad.html'));
    await sleep(800);
    await page.evaluate(() => newProject());

    // import an image
    const input = await page.$('#fileImg');
    await input.uploadFile(path.join(ROOT, 'examples/assets/christus_depth_1024.png'));
    await sleep(2000);
    let r = await page.evaluate(() => ({ n: state.layers.length, doc: state.doc }));
    check(r.n === 1 && r.doc.w === 1024 && r.doc.h === 1024, 'image import sets document size');

    // shapes, text, masks, blend modes
    r = await page.evaluate(async () => {
      const img = state.layers[0];
      img.masks.push(Object.assign(newMask(img, 'ellipse'), { w: 700, h: 700, feather: 5 }));
      const ring = newLayer('ellipse'); Object.assign(ring, { w: 900, h: 900, inner: 0.85, profile: 'dome', high: 200 }); addLayer(ring);
      const cut = newLayer('rect'); Object.assign(cut, { w: 200, h: 60, x: 512, y: 930, mode: 'cut' }); addLayer(cut);
      const txt = newLayer('text'); Object.assign(txt, { text: 'TEST', family: 'Helvetica', size: 80, y: 800, value: 240 }); addLayer(txt);
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const full = renderComposite(1, true);
      const d = full.getContext('2d').getImageData(0, 0, full.width, full.height).data;
      let gray = true, opaque = true;
      for (let k = 0; k < d.length; k += 4) { if (d[k] !== d[k + 1] || d[k] !== d[k + 2]) gray = false; if (d[k + 3] !== 255) opaque = false; }
      const at = (x, y) => d[(y * full.width + x) * 4];
      return { size: [full.width, full.height], gray, opaque, center: at(512, 512), ring: at(512 + 415, 512), cut: at(512, 930), outsideMask: at(100, 100), text: (() => { let m = 0; for (let y = 760; y < 840; y++) for (let x = 400; x < 624; x++) m = Math.max(m, at(x, y)); return m; })() };
    });
    check(r.size[0] === 1024 && r.size[1] === 1024, 'export is document resolution');
    check(r.gray && r.opaque, 'export is opaque grayscale');
    check(r.center > 100, 'image contributes at center (value ' + r.center + ')');
    check(r.ring === 200, 'ring crest value is 200 (value ' + r.ring + ')');
    check(r.cut === 0, 'cut layer erases below (value ' + r.cut + ')');
    check(r.outsideMask === 0, 'circular mask clips the image');
    check(r.text >= 230, 'text renders at its value (value ' + r.text + ')');

    // save/load round trip and undo
    r = await page.evaluate(async () => {
      const before = snapshot();
      const p = JSON.parse(JSON.stringify(serialize()));
      await loadProject(p);
      const same = JSON.parse(before).layers.length === state.layers.length && JSON.parse(before).doc.w === state.doc.w;
      const n0 = state.layers.length; deleteSelected(); const n1 = state.layers.length; undo(); const n2 = state.layers.length;
      return { same, n0, n1, n2, images: Object.keys(state.images).length };
    });
    check(r.same && r.images === 1, 'project save/load round trip');
    check(r.n1 === r.n0 - 1 && r.n2 === r.n0, 'delete + undo');

    // 3D view rendered something
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'smoke.png') });
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('\nAll smoke checks passed. Screenshot: ' + path.join(OUT, 'smoke.png'));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
