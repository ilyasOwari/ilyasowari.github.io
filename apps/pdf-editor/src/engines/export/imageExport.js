// "Farklı Kaydet → JPG / PNG": the exact PDF that "Kaydet" writes is rendered
// page by page at 300 DPI (A4 ≈ 2480 × 3508 px); oversized pages are capped to
// what a browser canvas can hold (see imageScale).
import { openPdfjs, renderPage } from '../render/pdfjs.js';

export const DPI = 300;
// Browser canvas limits: Chrome/Edge refuse canvases above 16384 px per side or
// ~268 Mpx in total (Firefox: 32767 px / ~472 Mpx, Safari less) and then
// silently draw nothing (toBlob gives null). Large-format pages (signboards,
// posters: a 2.35 m board is ~27800 px wide at 300 DPI) are therefore rendered
// at the highest resolution that still fits, instead of failing.
export const MAX_SIDE = 16384;
export const MAX_AREA = 80e6; // px; ~320 MB RGBA while encoding

// px-per-pt scale for a page of w x h pt
export function imageScale(w, h, dpi = DPI) {
  let s = dpi / 72;
  s = Math.min(s, MAX_SIDE / Math.max(1, w), MAX_SIDE / Math.max(1, h), Math.sqrt(MAX_AREA / Math.max(1, w * h)));
  return Math.max(0.05, s);
}

// bytes: the final PDF; type 'jpg' | 'png'; returns [{ name, blob }]
export async function renderImages(bytes, type, onPage = () => {}) {
  const doc = await openPdfjs(bytes);
  const mime = type === 'png' ? 'image/png' : 'image/jpeg';
  const out = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      onPage(i, doc.numPages);
      const pg = await doc.getPage(i);
      const canvas = document.createElement('canvas');
      const vp1 = pg.getViewport({ scale: 1 });
      const scale = imageScale(vp1.width, vp1.height);
      await renderPage(pg, scale, canvas);
      const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(`image ${canvas.width}x${canvas.height}`))), mime, 0.92));
      out.push({ name: `Sayfa ${String(i).padStart(2, '0')}.${type}`, blob, dpi: Math.round(scale * 72), w: canvas.width, h: canvas.height });
      canvas.width = canvas.height = 1; pg.cleanup();
    }
  } finally { doc.destroy(); }
  return out;
}

// ---- minimal .zip writer (stored, UTF-8 names) for the no-folder fallback ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export async function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let off = 0;
  const d = new Date();
  const dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.blob ? new Uint8Array(await f.blob.arrayBuffer()) : new Uint8Array(0);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(38, f.dir ? 0x10 : 0, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
