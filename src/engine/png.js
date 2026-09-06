// Minimal PNG codec: decodes 8/16-bit gray, gray+alpha, RGB, RGBA and palette
// images (non-interlaced) into a single 16-bit channel; encodes 8/16-bit gray.
// Uses the browser/Node built-in CompressionStream / DecompressionStream.

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export async function decodePNG(buf) {
  const d = new Uint8Array(buf);
  for (let i = 0; i < 8; i++) if (d[i] !== SIG[i]) throw new Error('Not a PNG file');
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let p = 8, w = 0, h = 0, bits = 0, ctype = 0, interlace = 0, palette = null;
  const idat = [];
  while (p < d.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(d[p + 4], d[p + 5], d[p + 6], d[p + 7]);
    const body = d.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); bits = d[p + 16]; ctype = d[p + 17]; interlace = d[p + 20]; }
    else if (type === 'PLTE') palette = body.slice();
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!w || !h) throw new Error('PNG missing IHDR');
  if (interlace) throw new Error('Interlaced PNG is not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error('Unsupported PNG colour type ' + ctype);
  if (bits !== 8 && bits !== 16 && !(ctype === 3 && bits <= 8) && !(ctype === 0 && bits < 8)) throw new Error('Unsupported PNG bit depth ' + bits);
  const total = idat.reduce((s, a) => s + a.length, 0);
  const z = new Uint8Array(total); let o = 0; for (const a of idat) { z.set(a, o); o += a.length; }
  const raw = await inflate(z);
  const bpp = Math.max(1, Math.ceil(channels * bits / 8));
  const stride = Math.ceil(w * channels * bits / 8);
  const out = new Uint16Array(w * h);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    cur.set(raw.subarray(rp, rp + stride)); rp += stride;
    unfilter(f, cur, prev, bpp);
    // extract first channel as 16-bit
    if (bits === 16) {
      for (let x = 0; x < w; x++) { const i = x * channels * 2; out[y * w + x] = (cur[i] << 8) | cur[i + 1]; }
    } else if (bits === 8) {
      if (ctype === 3) { for (let x = 0; x < w; x++) { const pi = cur[x] * 3; const v = palette ? palette[pi] : cur[x]; out[y * w + x] = v * 257; } }
      else for (let x = 0; x < w; x++) out[y * w + x] = cur[x * channels] * 257;
    } else { // sub-byte gray or palette
      const per = 8 / bits, mask = (1 << bits) - 1, maxv = mask;
      for (let x = 0; x < w; x++) {
        const byte = cur[Math.floor(x / per)], shift = 8 - bits * (1 + (x % per));
        const v = (byte >> shift) & mask;
        out[y * w + x] = ctype === 3 && palette ? palette[v * 3] * 257 : Math.round(v / maxv * 65535);
      }
    }
    const t = prev; prev = cur; cur = t;
  }
  return { w, h, bits, channels, data: out };
}

function unfilter(f, cur, prev, bpp) {
  const n = cur.length;
  switch (f) {
    case 0: return;
    case 1: for (let i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 255; return;
    case 2: for (let i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 255; return;
    case 3: for (let i = 0; i < n; i++) cur[i] = (cur[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 255; return;
    case 4: for (let i = 0; i < n; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
      cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    } return;
    default: throw new Error('Bad PNG filter ' + f);
  }
}

// Encode a grayscale image. data: Uint8Array (bits=8) or Uint16Array (bits=16).
export async function encodeGrayPNG(w, h, data, bits) {
  const bpp = bits === 16 ? 2 : 1, stride = w * bpp;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1); raw[o] = 0;
    if (bits === 16) for (let x = 0; x < w; x++) { const v = data[y * w + x]; raw[o + 1 + x * 2] = v >> 8; raw[o + 2 + x * 2] = v & 255; }
    else raw.set(data.subarray(y * w, y * w + w), o + 1);
  }
  const z = await deflate(raw);
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = bits; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const chunks = [chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const total = 8 + chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total); out.set(SIG, 0); let o = 8; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function chunk(type, body) {
  const out = new Uint8Array(12 + body.length); const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

let CRC_TABLE = null;
export function crc32(bytes) {
  if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function inflate(z) {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter(); w.write(z); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
async function deflate(raw) {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter(); w.write(raw); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
