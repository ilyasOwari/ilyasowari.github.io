// Mini PDF content interpreter. Walks a content stream (recursing into form
// XObjects) and records, per operator, what it draws and where (user space),
// plus every glyph with its code, Unicode value, font and exact position.
// The records are used by segmentation, text editing and the content filter.
import { isBadUni } from './glyphRecover.js';
import { tokenize, PdfName, PdfStr } from './lexer.js';
import { dget, nameOf, numArr, streamBytes, resolve, PDFDict, PDFRef } from './pdfobj.js';
import { splitCodes } from './fonts.js';
import { mul, apply, bboxOfPoints, transformBox, intersectBox, IDENT } from '../../core/geometry.js';

const PATH_CONS = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);
const PAINT = new Set(['f', 'F', 'f*', 'S', 's', 'B', 'B*', 'b', 'b*', 'n']);
const FILL_OPS = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const STROKE_OPS = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);

let streamSeq = 0;

function cmykToRgb(c, m, y, k) {
  return [255 * (1 - Math.min(1, c + k)), 255 * (1 - Math.min(1, m + k)), 255 * (1 - Math.min(1, y + k))];
}
function colorToRgb(op, args, csInfo) {
  const n = args.filter((a) => typeof a === 'number');
  if (op === 'g' || op === 'G') return [n[0] * 255, n[0] * 255, n[0] * 255];
  if (op === 'rg' || op === 'RG') return [n[0] * 255, n[1] * 255, n[2] * 255];
  if (op === 'k' || op === 'K') return cmykToRgb(n[0], n[1], n[2], n[3]);
  if (csInfo === 4 || n.length === 4) return cmykToRgb(n[0], n[1], n[2], n[3]);
  if (n.length === 3) return [n[0] * 255, n[1] * 255, n[2] * 255];
  if (n.length === 1 && csInfo === 1) return [n[0] * 255, n[0] * 255, n[0] * 255];
  return null; // pattern / separation: unknown
}

function csComponents(ctx, resources, csName) {
  if (csName === 'DeviceGray' || csName === 'CalGray' || csName === 'G') return 1;
  if (csName === 'DeviceRGB' || csName === 'CalRGB' || csName === 'RGB') return 3;
  if (csName === 'DeviceCMYK' || csName === 'CMYK') return 4;
  const csDict = dget(ctx, resources, 'ColorSpace');
  let cs = dget(ctx, csDict, csName);
  if (cs && cs.asArray) {
    const a = cs.asArray().map((x) => resolve(ctx, x));
    const kind = nameOf(a[0]);
    if (kind === 'ICCBased') { const N = dget(ctx, a[1] && a[1].dict, 'N'); return N && N.asNumber ? N.asNumber() : 3; }
    if (kind === 'Separation' || kind === 'DeviceN') return 'spot';
    if (kind === 'Pattern') return 'pattern';
    if (kind === 'Indexed') return 'indexed';
    return csComponents(ctx, resources, kind);
  }
  return 0;
}

// every point of a straight-edged path sits on its bounding box edges (a rectangle drawn with lines)
function axisBoxPts(pts) {
  const b = bboxOfPoints(pts), e = 0.05;
  for (let k = 0; k + 1 < pts.length; k += 2) {
    const x = pts[k], y = pts[k + 1];
    if (Math.abs(x - b.x0) > e && Math.abs(x - b.x1) > e) return false;
    if (Math.abs(y - b.y0) > e && Math.abs(y - b.y1) > e) return false;
  }
  return pts.length >= 6;
}
export class Interpreter {
  constructor(ctx, fontCache) {
    this.ctx = ctx;
    this.fonts = fontCache;
    this.glyphs = [];
    this.items = [];
    this.maxDepth = 12;
  }

  // Interpret a stream. Returns a record tree used by the filter.
  run(bytes, resources, ctm = IDENT, clip = null, depth = 0, path = [], inherit = null) {
    const ops = tokenize(bytes);
    const rec = { id: ++streamSeq, bytes, ops, resources, info: new Array(ops.length), children: new Map(), depth };
    const ctx = this.ctx;
    const gsStack = [];
    let gs = {
      ctm, clip, fill: { op: 'g', args: [0], cs: null }, fillRgb: [0, 0, 0], fillCs: 1, strokeRgb: [0, 0, 0], strokeCs: 1,
      lw: 1, dash: null, cap: 0, ca: 1, CA: 1, font: null, fontKey: null, Tfs: 0, Tc: 0, Tw: 0, Th: 1, TL: 0, Tr: 0, Ts: 0, gsName: null,
    };
    if (inherit) gs = { ...inherit, ctm, clip };
    let Tm = IDENT, Tlm = IDENT;
    let pathPts = [], pathStart = -1, pendingClip = false, isRectOnly = true, nSub = 0, hasCurve = false, sawClose = false;
    const fontDict = dget(ctx, resources, 'Font');
    const xobjDict = dget(ctx, resources, 'XObject');
    const extDict = dget(ctx, resources, 'ExtGState');

    const showString = (strBytes, opIndex, elemIndex, glyphList) => {
      const font = gs.font;
      if (!font) return;
      const codes = splitCodes(font, strBytes);
      let byteOff = 0;
      const fm = font.fontMatrix;
      const isT3 = font.isType3;
      for (const { code, len } of codes) {
        const wRaw = font.widthOf(code);
        const w0 = isT3 ? wRaw * fm[0] : wRaw / 1000;
        const trm = mul(mul([gs.Tfs * gs.Th, 0, 0, gs.Tfs, 0, gs.Ts], Tm), gs.ctm);
        const asc = Math.min(1.0, Math.max(0.6, (font.descriptor.ascent || 750) / 1000));
        const desc = Math.max(-0.35, Math.min(-0.1, (font.descriptor.descent || -250) / 1000));
        const bw = Math.max(w0, 0.05);
        const bb = bboxOfPoints([...apply(trm, 0, desc), ...apply(trm, bw, desc), ...apply(trm, 0, asc), ...apply(trm, bw, asc)]);
        const [ox, oy] = apply(trm, 0, 0);
        const [ex, ey] = apply(trm, w0, 0);
        let uni = font.toUni.get(code) ?? '';
        if (isBadUni(uni) && font.recoverUni) uni = font.recoverUni(code) ?? uni;
        const g = {
          sid: rec.id, opIndex, elemIndex, byteOff, len, code, uni,
          x: ox, y: oy, ex, ey, bbox: bb, trm, font, fontKey: gs.fontKey, w0,
          size: Math.hypot(trm[2], trm[3]), hsize: Math.hypot(trm[0], trm[1]),
          fill: gs.fill, fillRgb: gs.fillRgb, ca: gs.ca, CA: gs.CA, Tr: gs.Tr, gsName: gs.gsName, clip: gs.clip, ctm: gs.ctm,
          Tfs: gs.Tfs, Tc: gs.Tc, Tw: gs.Tw, Th: gs.Th, Ts: gs.Ts, depth, path,
        };
        glyphList.push(g);
        this.glyphs.push(g);
        const wordSp = (len === 1 && code === 32) ? gs.Tw : 0;
        const tx = (w0 * gs.Tfs + gs.Tc + wordSp) * gs.Th;
        Tm = mul([1, 0, 0, 1, tx, 0], Tm);
        byteOff += len;
      }
    };

    for (let i = 0; i < ops.length; i++) {
      const { op, args } = ops[i];
      const a = args;
      switch (op) {
        case 'q': gsStack.push({ ...gs }); break;
        case 'Q': if (gsStack.length) gs = gsStack.pop(); break;
        case 'cm': if (a.length >= 6) gs.ctm = mul(a.slice(0, 6), gs.ctm); break;
        case 'w': gs.lw = a[0] || 0; break;
        case 'd': gs.dash = Array.isArray(a[0]) && a[0].length ? { arr: a[0].map((v) => +v || 0), ph: +a[1] || 0 } : null; break;
        case 'J': gs.cap = +a[0] || 0; break;
        case 'gs': {
          gs.gsName = a[0] instanceof PdfName ? a[0].n : null;
          const gd = gs.gsName && extDict ? dget(ctx, extDict, gs.gsName) : null;
          if (gd) {
            const ca = dget(ctx, gd, 'ca')?.asNumber?.();
            const CA = dget(ctx, gd, 'CA')?.asNumber?.();
            if (typeof ca === 'number') gs.ca = ca;
            if (typeof CA === 'number') gs.CA = CA;
          }
          break;
        }
        case 'g': case 'rg': case 'k':
          gs.fill = { op, args: a.slice(), cs: null }; gs.fillRgb = colorToRgb(op, a); break;
        case 'G': case 'RG': case 'K': gs.strokeRgb = colorToRgb(op, a); break;
        case 'cs': {
          const n = a[0] instanceof PdfName ? a[0].n : 'DeviceGray';
          gs.fillCs = csComponents(ctx, resources, n);
          gs.fill = { op: 'cs', args: a.slice(), cs: n, set: null };
          gs.fillRgb = gs.fillCs === 4 ? [0, 0, 0] : [0, 0, 0];
          break;
        }
        case 'sc': case 'scn':
          gs.fill = { op, args: a.slice(), cs: gs.fill.cs || null };
          gs.fillRgb = typeof gs.fillCs === 'number' ? colorToRgb(op, a, gs.fillCs) : null;
          break;
        case 'CS': {
          const n = a[0] instanceof PdfName ? a[0].n : 'DeviceGray';
          gs.strokeCs = csComponents(ctx, resources, n);
          gs.strokeRgb = [0, 0, 0];
          break;
        }
        case 'SC': case 'SCN':
          gs.strokeRgb = typeof gs.strokeCs === 'number' ? colorToRgb(op, a, gs.strokeCs) : null;
          break;
        case 'BT': Tm = IDENT; Tlm = IDENT; break;
        case 'ET': break;
        case 'Tf': {
          const key = a[0] instanceof PdfName ? a[0].n : null;
          gs.Tfs = typeof a[1] === 'number' ? a[1] : 0;
          gs.fontKey = key;
          let raw = null;
          if (fontDict instanceof PDFDict && key) {
            for (const [k, v] of fontDict.entries()) { if (k.decodeText() === key) { raw = v; break; } }
          }
          gs.font = raw ? this.fonts.get(raw, key) : null;
          break;
        }
        case 'Tc': gs.Tc = a[0] || 0; break;
        case 'Tw': gs.Tw = a[0] || 0; break;
        case 'Tz': gs.Th = (a[0] ?? 100) / 100; break;
        case 'TL': gs.TL = a[0] || 0; break;
        case 'Tr': gs.Tr = a[0] || 0; break;
        case 'Ts': gs.Ts = a[0] || 0; break;
        case 'Td': Tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], Tlm); Tm = Tlm; break;
        case 'TD': gs.TL = -(a[1] || 0); Tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], Tlm); Tm = Tlm; break;
        case 'Tm': if (a.length >= 6) { Tlm = a.slice(0, 6); Tm = Tlm; } break;
        case 'T*': Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm; break;
        case 'Tj': case "'": case '"': case 'TJ': {
          if (op === "'" || op === '"') {
            if (op === '"') { gs.Tw = a[0] || 0; gs.Tc = a[1] || 0; }
            Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm;
          }
          const glyphList = [];
          const state = { Tfs: gs.Tfs, Tc: gs.Tc, Tw: gs.Tw, Th: gs.Th, font: gs.font, fontKey: gs.fontKey };
          if (op === 'TJ') {
            const arrA = Array.isArray(a[0]) ? a[0] : [];
            arrA.forEach((el, k) => {
              if (el instanceof PdfStr) showString(el.bytes, i, k, glyphList);
              else if (typeof el === 'number') Tm = mul([1, 0, 0, 1, -el / 1000 * gs.Tfs * gs.Th, 0], Tm);
            });
          } else {
            const s = a[a.length - 1];
            if (s instanceof PdfStr) showString(s.bytes, i, 0, glyphList);
          }
          rec.info[i] = { kind: 'text', glyphs: glyphList, state };
          break;
        }
        case 'Do': {
          const nm = a[0] instanceof PdfName ? a[0].n : null;
          let xo = null;
          if (xobjDict instanceof PDFDict && nm) {
            for (const [k, v] of xobjDict.entries()) { if (k.decodeText() === nm) { xo = v; break; } }
          }
          const xobj = resolve(ctx, xo);
          if (!xobj || !xobj.dict) break;
          const st = nameOf(dget(ctx, xobj.dict, 'Subtype'));
          if (st === 'Image') {
            const bb0 = transformBox(gs.ctm, { x0: 0, y0: 0, x1: 1, y1: 1 });
            const bb = gs.clip ? intersectBox(bb0, gs.clip) : bb0;
            const isMask = !!dget(ctx, xobj.dict, 'ImageMask');
            const item = { kind: 'image', sid: rec.id, opIndex: i, name: nm, bbox: bb, rawBox: bb0, mask: isMask, ref: xo instanceof PDFRef ? xo : null, depth, fillRgb: gs.fillRgb, ca: gs.ca, CA: gs.CA };
            rec.info[i] = item;
            if (bb) this.items.push(item);
          } else if (st === 'Form' && depth < this.maxDepth) {
            const fm = numArr(ctx, dget(ctx, xobj.dict, 'Matrix'));
            const m = fm.length === 6 ? fm : IDENT;
            const ctm2 = mul(m, gs.ctm);
            const fbb = numArr(ctx, dget(ctx, xobj.dict, 'BBox'));
            let clip2 = gs.clip;
            if (fbb.length === 4) {
              const b = transformBox(ctm2, { x0: Math.min(fbb[0], fbb[2]), y0: Math.min(fbb[1], fbb[3]), x1: Math.max(fbb[0], fbb[2]), y1: Math.max(fbb[1], fbb[3]) });
              clip2 = clip2 ? intersectBox(clip2, b) : b;
            }
            const res2 = dget(ctx, xobj.dict, 'Resources') || resources;
            const savedGs = { ...gs };
            const child = this.run(streamBytes(xobj), res2, ctm2, clip2, depth + 1, [...path, i], gs);
            gs = savedGs;
            child.xobjRef = xo instanceof PDFRef ? xo : null;
            child.xobj = xobj;
            rec.children.set(i, child);
            const isGroup = !!dget(ctx, xobj.dict, 'Group');
            rec.info[i] = { kind: 'form', name: nm, child, bbox: clip2, isGroup, gsName: gs.gsName };
          }
          break;
        }
        case 'BI': {
          const bb0 = transformBox(gs.ctm, { x0: 0, y0: 0, x1: 1, y1: 1 });
          const bb = gs.clip ? intersectBox(bb0, gs.clip) : bb0;
          const item = { kind: 'image', inline: true, sid: rec.id, opIndex: i, bbox: bb, rawBox: bb0, depth };
          rec.info[i] = item; if (bb) this.items.push(item);
          break;
        }
        case 'sh': {
          const bb = gs.clip;
          const item = { kind: 'shading', sid: rec.id, opIndex: i, bbox: bb, depth };
          rec.info[i] = item; if (bb) this.items.push(item);
          break;
        }
        case 'W': case 'W*': pendingClip = true; break;
        default:
          if (PATH_CONS.has(op)) {
            if (pathStart < 0) { pathStart = i; pathPts = []; isRectOnly = true; nSub = 0; hasCurve = false; sawClose = false; }
            const m = gs.ctm;
            if (op === 're') {
              const [x, y, w, h] = a;
              pathPts.push(...apply(m, x, y), ...apply(m, x + w, y), ...apply(m, x, y + h), ...apply(m, x + w, y + h));
              nSub++;
            } else if (op === 'h') sawClose = true;
            else {
              isRectOnly = false;
              if (op === 'c' || op === 'v' || op === 'y') hasCurve = true;
              for (let k = 0; k + 1 < a.length; k += 2) pathPts.push(...apply(m, a[k], a[k + 1]));
              if (op === 'm') nSub++;
            }
          } else if (PAINT.has(op)) {
            if (pathStart >= 0 && pathPts.length) {
              let bb = bboxOfPoints(pathPts);
              const doFill = FILL_OPS.has(op), doStroke = STROKE_OPS.has(op);
              if (doStroke) {
                const lw = Math.max(gs.lw, 0.1) * Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])) / 2;
                bb = { x0: bb.x0 - lw, y0: bb.y0 - lw, x1: bb.x1 + lw, y1: bb.y1 + lw };
              }
              const clipped = gs.clip ? intersectBox(bb, gs.clip) : bb;
              const item = {
                kind: 'path', sid: rec.id, opStart: pathStart, opIndex: i, op, bbox: clipped, rawBox: bb, fill: doFill, stroke: doStroke,
                isClip: pendingClip, isRect: isRectOnly && nSub === 1, nSub, fillRgb: gs.fillRgb, strokeRgb: gs.strokeRgb, ca: gs.ca, CA: gs.CA, depth,
                gsName: gs.gsName, fillOp: gs.fill, lw: Math.max(gs.lw, 0.1) * Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])),
                axisBox: !hasCurve && nSub === 1 && (doFill || sawClose || op === 's' || op === 'b' || op === 'b*' || (Math.abs(pathPts[0] - pathPts[pathPts.length - 2]) < 0.05 && Math.abs(pathPts[1] - pathPts[pathPts.length - 1]) < 0.05)) && axisBoxPts(pathPts),
                cap: gs.cap, dash: gs.dash && { arr: gs.dash.arr.map((v) => v * Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2]))), ph: gs.dash.ph * Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])) },
              };
              rec.info[i] = item;
              if (pendingClip) gs.clip = gs.clip ? (intersectBox(gs.clip, bb) || { x0: 0, y0: 0, x1: 0, y1: 0 }) : bb;
              if ((doFill || doStroke) && clipped) this.items.push(item);
            }
            pathStart = -1; pathPts = []; pendingClip = false;
          }
      }
    }
    return rec;
  }
}

export function pageGeometry(page) {
  const mb = page.getMediaBox();
  let cb;
  try { cb = page.getCropBox(); } catch (e) { cb = mb; }
  const x0 = Math.max(mb.x, cb.x), y0 = Math.max(mb.y, cb.y);
  const x1 = Math.min(mb.x + mb.width, cb.x + cb.width), y1 = Math.min(mb.y + mb.height, cb.y + cb.height);
  const W = x1 - x0, H = y1 - y0;
  const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
  // user -> unrotated UI (y down)
  let M = [1, 0, 0, -1, -x0, y1];
  let w = W, h = H;
  if (rot === 90) { M = mul(M, [0, 1, -1, 0, H, 0]); w = H; h = W; }
  else if (rot === 180) { M = mul(M, [-1, 0, 0, -1, W, H]); }
  else if (rot === 270) { M = mul(M, [0, -1, 1, 0, 0, W]); w = H; h = W; }
  return { M, width: w, height: h, rot, box: { x0, y0, x1, y1 } };
}
