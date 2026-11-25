// Composes one output page: the original content (with removed areas filtered
// out for real), natural-colour fills for vacated areas, then every changed
// block part as a form XObject at its new place. Unchanged blocks are left
// exactly as they are in the original content stream.
import { filterStream, cloneResources, addXObjects } from '../pdf/filter.js';
import { buildSourceForms, assemblePart, placementMatrix } from './partBuilder.js';
import { fillColorOps, rgbOps } from './colorOps.js';
import { fmtNum as f } from '../pdf/lexer.js';
import { transformBox, boxContains } from '../../core/geometry.js';
import { PDFName, PDFDict, resolve } from '../pdf/pdfobj.js';
import { PDFArray, PDFString } from '../../../vendor/pdf-lib.esm.min.js';
import { isPartChanged, isForeign } from '../../model/blockState.js';
import { drawInsertedItems, orderFreeLast, blockBoxOps, drawImagePart } from './inserted.js';
import { coverFillOps } from './coverOps.js';

const inR = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const boxOfRect = (r) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });

export function naturalFillOps(an, pageModel, noGs = false) {
  let gsObj = null;
  if (an.bgFill && an.bgFill.fill && an.bgFill.gs) gsObj = gsOf(an, an.bgFill.gs);
  const fn = () => {
    if (pageModel.whiteBg) return '1 g';
    const isLightBg = an.bgFill && an.bgFill.rgb && an.bgFill.rgb.every((v) => v >= 210);
    if (an.bgFill && an.bgFill.fill && isLightBg) {
      const ops = fillColorOps(an.bgFill.fill, an.bgFill.rgb, () => false);
      const gs = gsObj ? `/${an.bgFill.gs} gs ` : '';
      return gs + ops;
    }
    return rgbOps(pageModel.natural || [255, 255, 255]);
  };
  // forms that use this fill must carry the ExtGState in their resources
  fn.gs = gsObj && !pageModel.whiteBg ? { name: an.bgFill.gs, obj: gsObj } : null;
  void noGs;
  return fn;
}
function gsOf(an, name) {
  const res = an.page.node.Resources();
  const gd = res ? an.page.doc.context.lookup(res.get(PDFName.of('ExtGState'))) : null;
  return gd instanceof PDFDict ? gd.get(PDFName.of(name)) || null : null;
}
function hasGs(an, name) {
  const res = an.page.node.Resources();
  const gd = res ? an.page.doc.context.lookup(res.get(PDFName.of('ExtGState'))) : null;
  return gd instanceof PDFDict && !!gd.get(PDFName.of(name));
}

// env: { doc, copy, fonts, fontById }
export async function composePage(env, an, pageModel) {
  const doc = env.doc;
  const ctx = doc.context;
  const page = an.page;
  const holes = [];
  const changedParts = [];
  const rmOrig = new Set();
  for (const b of orderFreeLast(pageModel.blocks)) {
    for (const p of b.parts) {
      if (!isForeign(b) && p.removedG) for (const gi of p.removedG) rmOrig.add(gi);
      // a picture that must keep its place among the parts (Metin tara's
      // cleaned background lies under the new text, not over it)
      if (p.kind === 'insimg' && p.inline && p.img) { changedParts.push({ b, p, img: true }); continue; }
      if (!p.src) continue;
      if (isForeign(b)) { changedParts.push({ b, p }); continue; }
      if (isPartChanged(b, p) || (p.edit && p.edit.tableSpec)) { if (!p.addedText && !p.addedTable) holes.push({ ...p.src, mode: 'natural' }); changedParts.push({ b, p }); }
    }
  }
  for (const d of pageModel.deleted || []) holes.push({ ...d, mode: d.mode || 'natural' });
  for (const e of pageModel.erase || []) holes.push({ ...e });
  const natural = naturalFillOps(an, pageModel);
  const holeBoxes = holes.map(boxOfRect);
  const basePred = {
    removeGlyph: (g) => holes.some((h) => inR(h, g.ucx, g.ucy)) || rmOrig.has(g.idx),
    dropItem: (item) => {
      const b = an.uiBox(item);
      if (!b) return false;
      if (pageModel.whiteBg && an.bgItemSet.has(item)) return true;
      return holeBoxes.some((h) => boxContains(h, b, 0.3));
    },
  };
  const base = filterStream(doc, an.rec, basePred);
  const parts = base.bytes.length ? ['q\n', base.bytes, '\nQ\n'] : ['', base.bytes, ''];
  const xobjs = new Map(base.extraXObjects);
  const extraFonts = new Map();
  // vacated areas
  const fills = [];
  for (const h of holes) {
    const bb = transformBox(an.Minv, boxOfRect(h));
    if (h.fill) { fills.push(...coverFillOps(an, h)); continue; }
    const col = h.mode === 'white' ? '1 g' : natural(h);
    fills.push(`q ${col} ${f(bb.x0)} ${f(bb.y0)} ${f(bb.x1 - bb.x0)} ${f(bb.y1 - bb.y0)} re f Q`);
  }
  // changed parts
  const env2 = { ...env, an, naturalFill: naturalFillOps(an, pageModel, true), whiteBg: !!pageModel.whiteBg };
  const draws = [];
  const extraGs = new Map();
  const boxed = new Set();
  let n = 0;
  let nIn = 0;
  for (const { b, p, img } of changedParts) {
    if (b.box && !boxed.has(b.id)) { boxed.add(b.id); draws.push(...blockBoxOps(env2, an, b, extraGs, pageModel)); }
    if (img) { draws.push(...await drawImagePart(env2, an, b, p, xobjs, extraFonts, () => 'U' + (++nIn))); continue; }
    const anS = isForeign(b) ? env.analysisOf(b.from) : an;
    const sf = buildSourceForms(doc, anS, p, { whiteBg: pageModel.whiteBg });
    const ref = await assemblePart({ ...env2, an: anS, copy: (x) => x }, p, sf);
    const name = `PFP${++n}`;
    xobjs.set(name, ref);
    const m = placementMatrix(anS, p, b, an);
    draws.push(`q ${m.map(f).join(' ')} cm /${name} Do Q`);
  }
  // inserted text / images
  const ins = await drawInsertedItems({ ...env2 }, an, pageModel, xobjs, extraFonts, extraGs);
  if (env.pageExtras) ins.push(...await env.pageExtras(an, pageModel, extraFonts, extraGs));
  const enc = new TextEncoder();
  const tail = enc.encode(['', ...fills, ...draws, ...ins, ''].join('\n'));
  const head = enc.encode(parts[0]);
  const mid = enc.encode(parts[2]);
  const all = new Uint8Array(head.length + base.bytes.length + mid.length + tail.length);
  let o = 0;
  for (const chunk of [head, base.bytes, mid, tail]) { all.set(chunk, o); o += chunk.length; }
  // resources
  const res = cloneResources(ctx, page.node.Resources());
  addXObjects(ctx, res, xobjs);
  if (extraFonts.size) {
    let fd = resolve(ctx, res.get(PDFName.of('Font')));
    fd = fd instanceof PDFDict ? fd.clone(ctx) : ctx.obj({});
    for (const [k, v] of extraFonts) fd.set(PDFName.of(k), v);
    res.set(PDFName.of('Font'), fd);
  }
  if (extraGs.size) {
    let gd = resolve(ctx, res.get(PDFName.of('ExtGState')));
    gd = gd instanceof PDFDict ? gd.clone(ctx) : ctx.obj({});
    for (const [k, v] of extraGs) gd.set(PDFName.of(k), v);
    res.set(PDFName.of('ExtGState'), gd);
  }
  page.node.set(PDFName.of('Resources'), res);
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(all)));
  // Preserve untouched PDF /Annots, remove old /Link annots inside vacated areas, and emit updated /Link annots
  try {
    const linkHits = (box, lb) => {
      if (boxContains(box, lb, 3)) return true;
      const ix = Math.max(0, Math.min(box.x1, lb.x1) - Math.max(box.x0, lb.x0));
      const iy = Math.max(0, Math.min(box.y1, lb.y1) - Math.max(box.y0, lb.y0));
      return (ix * iy) / Math.max(1, (lb.x1 - lb.x0) * (lb.y1 - lb.y0)) >= 0.5;
    };
    const newLinks = [];
    for (const { b, p } of changedParts) {
      if (p.edit && p.edit.runs) {
        const sc = (b.s || 1) * (p.sc || 1);
        const px0 = b.x + (p.dx || 0) * (b.s || 1), py0 = b.y + (p.dy || 0) * (b.s || 1);
        for (const r of p.edit.runs) {
          if (!r.link || !(r.w > 0)) continue;
          const sz = Math.abs(r.m[3]) || Math.hypot(r.m[0], r.m[1]) || 10;
          const rx = px0 + (r.x - p.src.x) * sc, ry = py0 + (r.y - p.src.y) * sc;
          const ub = transformBox(an.Minv, { x0: rx, y0: ry - sz * 0.85 * sc, x1: rx + r.w * sc, y1: ry + sz * 0.25 * sc });
          newLinks.push({ rect: [ub.x0, ub.y0, ub.x1, ub.y1], uri: r.link });
        }
      } else if (p.src) {
        const anS = isForeign(b) ? env.analysisOf(b.from) : an;
        const pBox = boxOfRect(p.src);
        const sc = (b.s || 1) * (p.sc || 1);
        const px0 = b.x + (p.dx || 0) * (b.s || 1), py0 = b.y + (p.dy || 0) * (b.s || 1);
        for (const lk of (anS && anS.links) || []) {
          if (!linkHits(pBox, lk.b)) continue;
          const ub = transformBox(an.Minv, {
            x0: px0 + (lk.b.x0 - p.src.x) * sc,
            y0: py0 + (lk.b.y0 - p.src.y) * sc,
            x1: px0 + (lk.b.x1 - p.src.x) * sc,
            y1: py0 + (lk.b.y1 - p.src.y) * sc,
          });
          newLinks.push({ rect: [ub.x0, ub.y0, ub.x1, ub.y1], uri: lk.uri });
        }
      }
    }
    const existing = resolve(ctx, page.node.get(PDFName.of('Annots')));
    const editedSrcBoxes = changedParts.filter(({ b, p }) => !isForeign(b) && p.edit && p.edit.runs && p.src).map(({ p }) => boxOfRect(p.src));
    const dropIdx = new Set((an.links || []).filter((lk) => holeBoxes.some((h) => linkHits(h, lk.b)) || editedSrcBoxes.some((eb) => linkHits(eb, lk.b))).map((lk) => lk.idx));
    for (const w of an.widgets || []) dropIdx.add(w.idx);
    for (const va of an.visualAnnots || []) if (holeBoxes.some((h) => boxContains(h, va.b, 1.5))) dropIdx.add(va.idx);
    if ((existing instanceof PDFArray && dropIdx.size) || newLinks.length) {
      const nextAnnots = ctx.obj([]);
      if (existing instanceof PDFArray) {
        for (let i = 0; i < existing.size(); i++) if (!dropIdx.has(i)) nextAnnots.push(existing.get(i));
      }
      for (const nl of newLinks) {
        const linkDict = ctx.obj({
          Type: 'Annot', Subtype: 'Link', Border: [0, 0, 0], Rect: nl.rect,
          A: { Type: 'Action', S: 'URI', URI: PDFString.of(nl.uri) },
        });
        nextAnnots.push(ctx.register(linkDict));
      }
      page.node.set(PDFName.of('Annots'), nextAnnots);
    }
  } catch { /* ignore */ }
}
