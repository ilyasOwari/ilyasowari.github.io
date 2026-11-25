// Draws user-inserted text boxes and images on the output page.
import { fmtNum as f } from '../pdf/lexer.js';
import { PDFName } from '../pdf/pdfobj.js';
import { mul } from '../../core/geometry.js';
import { insertedTextOps } from './insertedText.js';
import { boxOps } from './boxOps.js';
import { boxGeom, roomAround } from '../../model/textBox.js';
import { blockRect } from '../../model/blockOps.js';
import { imgSrc } from '../../core/imageStore.js';
const mstr = (m) => m.map(f).join(' ');

export async function drawInsertedItems(env, an, pageModel, xobjs, extraFonts, extraGs = new Map()) {
  const out = [];
  const doc = env.doc;
  let n = 0;
  for (const b of orderFreeLast(pageModel.blocks)) {
    const bs = b.s || 1;
    for (const p of b.parts) {
      if (p.kind === 'insimg' && p.img && !p.inline) out.push(...await drawImagePart(env, an, b, p, xobjs, extraFonts, () => ++n));
      else if (p.kind === 'instext' && p.inserted) out.push(...await insertedTextOps(env, an, { x: b.x + p.dx * bs, y: b.y + p.dy * bs, s: bs * (p.sc || 1), bw: p.dw, bh: p.dh, inserted: p.inserted }, extraFonts, extraGs));
    }
    if (!b.inserted) continue;
    const s = b.s || 1;
    const ins = b.inserted;
    if (ins.type === 'image') {
      const url = imgSrc(ins);
      if (!url) continue;
      const img = await embedDataUrl(doc, url);
      const name = `PIM${++n}`;
      xobjs.set(name, img.ref);
      const w = b.bw * s, h = b.bh * s;
      const m = mul([w, 0, 0, -h, b.x, b.y + h], an.Minv);
      out.push(`q ${mstr(m)} cm /${name} Do Q`);
    } else if (ins.type === 'text') {
      out.push(...await insertedTextOps(env, an, b, extraFonts, extraGs));
    }
  }
  return out;
}
// one embedded XObject per distinct picture in a document (same id -> same ref)
const embedCache = new WeakMap();
async function embedDataUrl(doc, url) {
  let m = embedCache.get(doc);
  if (!m) { m = new Map(); embedCache.set(doc, m); }
  if (!m.has(url)) {
    const bytes = dataUrlToBytes(url);
    m.set(url, /png/.test(url.slice(0, 30)) ? doc.embedPng(bytes) : doc.embedJpg(bytes));
  }
  return m.get(url);
}
export function dataUrlToBytes(u) {
  const b64 = u.split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// image inserted inside a text block (with optional caption below it)
export async function drawImagePart(env, an, b, p, xobjs, extraFonts, nextN) {
  const out = [];
  const doc = env.doc;
  const bs = b.s || 1, s = bs * (p.sc || 1);
  const x = b.x + p.dx * bs, y = b.y + p.dy * bs;
  const w = p.img.iw * s, ih = p.img.ih * s;
  const url = imgSrc(p.img);
  if (!url) return out;
  const img = await embedDataUrl(doc, url);
  const name = `PIM${nextN()}`;
  xobjs.set(name, img.ref);
  out.push(`q ${mstr(mul([w, 0, 0, -ih, x, y + ih], an.Minv))} cm /${name} Do Q`);
  if (p.img.caption) {
    const pf = await env.fonts.get('Carlito-Italic.ttf');
    extraFonts.set(pf.name, pf.font.ref);
    const size = p.img.capSize * s;
    const tw = pf.font.widthOfTextAtSize(p.img.caption, size);
    const m = mul([size, 0, 0, -size, x + Math.max(0, (w - tw) / 2), y + ih + size * 1.05], an.Minv);
    out.push(`q 0.25 0.27 0.32 rg BT /${pf.name} 1 Tf ${mstr(m)} Tm ${pf.font.encodeText(p.img.caption).toString()} Tj ET Q`);
  }
  return out;
}

// free (floating) blocks are drawn last: on top of everything
export function orderFreeLast(blocks) {
  return blocks.filter((b) => b.free && b.behind)
    .concat(blocks.filter((b) => !b.free), blocks.filter((b) => b.free && !b.behind));
}
// box (border / fill) behind an original text block
export function blockBoxOps(env, an, b, extraGs, page = null) {
  if (!b.box) return [];
  const g = boxGeom(blockRect(b), b.box, 10, page ? roomAround(page, b) : null);
  return [`q ${an.Minv.map(f).join(' ')} cm`, ...boxOps(env, extraGs, g, b.box), 'Q'];
}
