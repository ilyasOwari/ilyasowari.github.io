// Content filter: rewrites a stream record so that selected glyphs and drawing
// items disappear for real (not painted over). Removed glyphs are replaced by
// an exact TJ advance, so every following glyph keeps its original position.
// Untouched operators are copied byte-for-byte.
import { PdfName, PdfStr, serializeArg, fmtNum } from './lexer.js';
import { dget, resolve, PDFDict, PDFName, PDFRef } from './pdfobj.js';

const enc = new TextEncoder();
let formSeq = 0;

function glyphAdjust(g) {
  // TJ number that advances exactly like the removed glyph
  const wsp = (g.len === 1 && g.code === 32) ? g.Tw : 0;
  if (!g.Tfs) return 0;
  return -1000 * (g.w0 + (g.Tc + wsp) / g.Tfs);
}

function rewriteTextOp(o, info, removeSet) {
  const { op, args } = o;
  const glyphs = info.glyphs;
  const byElem = new Map();
  glyphs.forEach((g) => { if (!byElem.has(g.elemIndex)) byElem.set(g.elemIndex, []); byElem.get(g.elemIndex).push(g); });
  const out = [];
  let pendingNum = 0;
  let curBytes = [];
  const flushStr = () => { if (curBytes.length) { out.push(new PdfStr(Uint8Array.from(curBytes), true)); curBytes = []; } };
  const flushNum = () => { if (Math.abs(pendingNum) > 1e-6) { out.push(Math.round(pendingNum * 1000) / 1000); } pendingNum = 0; };
  const handleString = (str, k) => {
    const gl = byElem.get(k) || [];
    for (const g of gl) {
      if (removeSet.has(g)) { flushStr(); pendingNum += glyphAdjust(g); }
      else { if (pendingNum) { flushNum(); } for (let b = 0; b < g.len; b++) curBytes.push(str.bytes[g.byteOff + b]); }
    }
  };
  if (op === 'TJ') {
    const arr = Array.isArray(args[0]) ? args[0] : [];
    arr.forEach((el, k) => {
      if (el instanceof PdfStr) handleString(el, k);
      else if (typeof el === 'number') { flushStr(); pendingNum += el; }
    });
  } else {
    const s = args[args.length - 1];
    if (s instanceof PdfStr) handleString(s, 0);
  }
  flushStr(); flushNum();
  let prefix = '';
  if (op === "'") prefix = 'T* ';
  if (op === '"') prefix = `${fmtNum(args[0] || 0)} Tw ${fmtNum(args[1] || 0)} Tc T* `;
  return prefix + serializeArg(out) + ' TJ';
}

// pred: { removeGlyph(g):bool, dropItem(item):bool }
// returns { bytes:Uint8Array, changed:boolean, extraXObjects: Map(name->ref) }
export function filterStream(doc, rec, pred) {
  const ctx = doc.context;
  const parts = [];
  let changed = false;
  const extraXObjects = new Map();
  const ops = rec.ops;
  const skip = new Uint8Array(ops.length);
  // mark path ranges to drop
  for (let i = 0; i < ops.length; i++) {
    const info = rec.info[i];
    if (!info) continue;
    if (info.kind === 'path' && !info.isClip && info.bbox && pred.dropItem(info)) {
      for (let k = info.opStart; k <= i; k++) skip[k] = 1;
      changed = true;
    } else if (info.kind === 'path' && !info.isClip && !info.bbox) {
      // fully clipped away path: harmless, keep
    } else if ((info.kind === 'image' || info.kind === 'shading') && info.bbox && pred.dropItem(info)) {
      skip[i] = 1; changed = true;
    }
  }
  for (let i = 0; i < ops.length; i++) {
    if (skip[i]) continue;
    const o = ops[i];
    const info = rec.info[i];
    if (info && info.kind === 'text' && info.glyphs.length) {
      const rm = new Set(info.glyphs.filter((g) => pred.removeGlyph(g)));
      if (rm.size) { parts.push(rewriteTextOp(o, info, rm)); changed = true; continue; }
    }
    if (info && info.kind === 'form') {
      if (info.bbox && pred.dropItem({ ...info, kind: 'form' })) { changed = true; continue; }
      const sub = filterStream(doc, info.child, pred);
      if (sub.changed) {
        changed = true;
        const newRef = makeFormCopy(doc, info.child, sub);
        const nm = `PFx${++formSeq}`;
        extraXObjects.set(nm, newRef);
        parts.push(`/${nm} Do`);
        continue;
      }
    }
    parts.push(bytesToLatin1(rec.bytes, o.s, o.e));
  }
  const text = parts.join('\n');
  return { bytes: latin1ToBytes(text), changed, extraXObjects };
}

function makeFormCopy(doc, childRec, sub) {
  const ctx = doc.context;
  const src = childRec.xobj;
  const dict = src.dict.clone(ctx);
  ['Filter', 'DecodeParms', 'Length', 'DL'].forEach((k) => dict.delete(PDFName.of(k)));
  let res = dget(ctx, src.dict, 'Resources');
  if (sub.extraXObjects.size) {
    const resDict = res instanceof PDFDict ? cloneResources(ctx, res) : ctx.obj({});
    addXObjects(ctx, resDict, sub.extraXObjects);
    dict.set(PDFName.of('Resources'), resDict);
  }
  const stream = ctx.flateStream(sub.bytes, {});
  dict.entries().forEach(([k, v]) => { if (k.decodeText() !== 'Length' && k.decodeText() !== 'Filter') stream.dict.set(k, v); });
  return ctx.register(stream);
}

export function cloneResources(ctx, res) {
  const out = ctx.obj({});
  if (!(res instanceof PDFDict)) return out;
  for (const [k, v] of res.entries()) {
    const rv = resolve(ctx, v);
    if (rv instanceof PDFDict) out.set(k, rv.clone(ctx)); else out.set(k, v);
  }
  return out;
}
export function addXObjects(ctx, resDict, map) {
  let xd = resolve(ctx, resDict.get(PDFName.of('XObject')));
  if (!(xd instanceof PDFDict)) { xd = ctx.obj({}); }
  else xd = xd.clone(ctx);
  for (const [n, ref] of map) xd.set(PDFName.of(n), ref);
  resDict.set(PDFName.of('XObject'), xd);
}
export function addFonts(ctx, resDict, map) {
  let fd = resolve(ctx, resDict.get(PDFName.of('Font')));
  fd = fd instanceof PDFDict ? fd.clone(ctx) : ctx.obj({});
  for (const [n, ref] of map) fd.set(PDFName.of(n), ref);
  resDict.set(PDFName.of('Font'), fd);
}

export function bytesToLatin1(bytes, s = 0, e = bytes.length) {
  let out = '';
  const CH = 8192;
  for (let i = s; i < e; i += CH) out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(e, i + CH)));
  return out;
}
export function latin1ToBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 255;
  return out;
}
export { enc };
