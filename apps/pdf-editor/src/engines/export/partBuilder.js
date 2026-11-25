// Builds the PDF form XObject for one block part: filtered original content
// (graphics clipped to the part, text glyphs unclipped), optional box slices,
// erase fills and newly drawn text runs.
import { filterStream, cloneResources, addXObjects } from '../pdf/filter.js';
import { usedNames, minimalResources } from './resources.js';
import { fillColorOps, rgbOps } from './colorOps.js';
import { fmtNum } from '../pdf/lexer.js';
import { mul, inv, transformBox, rectToBox, intersectBox, boxContains, translate } from '../../core/geometry.js';
import { PDFName, PDFDict, resolve } from '../pdf/pdfobj.js';
import { coverBands } from './coverOps.js';
import { boxOps, boxPath } from './boxOps.js';
import { vecRuleIdx, vecRuleOps } from './vecRules.js';
import { vectorGlyphOps } from '../text/vectorGlyphs.js';
import { cellFill, migrateTableStyle } from '../../core/tableStyle.js';
import { PDFHexString } from '../../../vendor/pdf-lib.esm.min.js';

const inR = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const boxOfRect = (r) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
const f = fmtNum;

function makeForm(doc, bytes, bboxUser, resources) {
  const ctx = doc.context;
  const stream = ctx.flateStream(bytes, {
    Type: 'XObject', Subtype: 'Form', FormType: 1,
    BBox: [bboxUser.x0, bboxUser.y0, bboxUser.x1, bboxUser.y1],
  });
  stream.dict.set(PDFName.of('Resources'), resources);
  return ctx.register(stream);
}

function isContainerFill(an, item, src, part) {
  const b = an.uiBox(item);
  if (!b) return false;
  const area = (b.x1 - b.x0) * (b.y1 - b.y0);
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  if (item.kind === 'path' && (item.fill || item.stroke)) {
    return area > 0.18 * src.w * src.h || (!!item.fill && bw > 0.55 * src.w && bh >= 5);
  }
  if ((part && (part.obj === 'deco' || part.obj === 'bg')) && (item.kind === 'image' || item.kind === 'form')) {
    return area > 0.65 * src.w * src.h && (b.x1 - b.x0) > 0.8 * src.w && (b.y1 - b.y0) > 0.8 * src.h;
  }
  return false;
}

// Pass 1+2 in the SOURCE document (user space, part at its original place)
export function buildSourceForms(doc, an, part, opts = {}) {
  const src = part.src;
  const srcBox = boxOfRect(src);
  const erase = part.erase || [];
  const removeSet = new Set([...((part.edit && part.edit.removeGlyphs) || []), ...(part.removedG || [])]);
  const whiteBg = !!opts.whiteBg;
  const inErase = (x, y) => erase.some((r) => inR(r, x, y));
  const fullyErased = (b) => erase.some((r) => boxContains(boxOfRect(r), b, 0.3));
  // object parts (area editor) draw exactly their own graphic items and glyphs
  const keepItems = part.obj ? new Set((part.keep || []).map((i) => an.atoms.gfx[i] && an.atoms.gfx[i].item).filter(Boolean)) : null;
  const keepGlyphs = part.obj ? new Set(part.keepG || []) : null;
  // word highlights redrawn by a text edit: the original drawing is left out
  // + frames / rules of a stretched part: redrawn as vectors (vecRules.js)
  const dropSet = new Set([...((part.edit && part.edit.dropGfx) || []), ...vecRuleIdx(an, part)].map((i) => an.atoms.gfx[i] && an.atoms.gfx[i].item).filter(Boolean));
  const dropBoxes = (part.edit && part.edit.dropBoxes) || [];
  // a form XObject is drawn only when something inside it belongs to the object
  const formHasKept = (inf) => ((inf.child && inf.child.info) || []).some((c) => c && (keepItems.has(c) || (c.kind === 'form' && formHasKept(c))));
  const formHasWm = (inf) => ((inf.child && inf.child.info) || []).some((c) => c && (an.wmItemSet && an.wmItemSet.has(c) || (c.kind === 'form' && formHasWm(c))));
  const gfxPred = {
    removeGlyph: () => true,
    dropItem: (item) => {
      const isWm = an.wmItemSet && an.wmItemSet.has(item);
      if (part.watermark) return item.kind === 'form' ? !formHasWm(item) : !isWm;
      if (isWm) return true;
      if (dropSet.has(item)) return true;
      if (item.kind !== 'form' && dropBoxes.length) {
        const bi = an.uiBox(item);
        if (bi && dropBoxes.some((db) => boxContains(db, bi, 1.5))) return true;
      }
      if (part.bgMode && part.obj !== 'photo' && isContainerFill(an, item, src, part)) return true;
      if (keepItems) return item.kind === 'form' ? !formHasKept(item) : !keepItems.has(item);
      const b = an.uiBox(item);
      if (!b) return false;
      if (!intersectBox(b, srcBox)) return true;
      if (fullyErased(b)) return true;
      if (whiteBg && an.bgItemSet.has(item)) return true;
      return false;
    },
  };
  const textPred = {
    removeGlyph: (g) => {
      const isWmG = an.wmGlyphSet && an.wmGlyphSet.has(g.idx);
      if (part.watermark) return !isWmG;
      if (isWmG) return true;
      return (keepGlyphs ? !keepGlyphs.has(g.idx) : !inR(src, g.ucx, g.ucy)) || removeSet.has(g.idx) || inErase(g.ucx, g.ucy);
    },
    dropItem: (item) => item.kind !== 'form',
  };
  const res = an.page.node.Resources();
  const out = {};
  const userBox = transformBox(an.Minv, srcBox);
  for (const [key, pred] of [['gfx', gfxPred], ['text', textPred]]) {
    const r = filterStream(doc, an.rec, pred);
    let bytes = r.bytes;
    if (key === 'gfx') {
      const clip = `${f(userBox.x0)} ${f(userBox.y0)} ${f(userBox.x1 - userBox.x0)} ${f(userBox.y1 - userBox.y0)} re W n\n`;
      bytes = concatBytes(clip, bytes);
    }
    const used = usedNames(bytes);
    const minRes = minimalResources(doc.context, res, used, { XObject: r.extraXObjects });
    const pageBox = transformBox(an.Minv, { x0: 0, y0: 0, x1: an.geo.width, y1: an.geo.height });
    out[key] = makeForm(doc, bytes, pageBox, minRes);
  }
  return out;
}

export function concatBytes(prefix, bytes, suffix = '') {
  const p = new TextEncoder().encode(prefix);
  const s = new TextEncoder().encode(suffix);
  const o = new Uint8Array(p.length + bytes.length + s.length);
  o.set(p, 0); o.set(bytes, p.length); o.set(s, p.length + bytes.length);
  return o;
}

// slices in UI source coords: [{sx, sy, sw, sh, dx, dy}]
export function partSlices(part) {
  const e = part.edit;
  const src = part.src;
  if (part.nine) {
    const W = part.nine.w, H = part.nine.h;
    const c = Math.max(0.5, Math.min(10, src.w / 3, src.h / 3, W / 3, H / 3));
    const cols = [[src.x, c, 0, 1], [src.x + c, src.w - 2 * c, 0, (W - 2 * c) / (src.w - 2 * c)], [src.x + src.w - c, c, W - src.w, 1]];
    const rows = [[src.y, c, 0, 1], [src.y + c, src.h - 2 * c, 0, (H - 2 * c) / (src.h - 2 * c)], [src.y + src.h - c, c, H - src.h, 1]];
    const out = [];
    for (const [sx, sw, ddx, kx] of cols) for (const [sy, sh, ddy, ky] of rows) {
      const dx = sx === src.x ? 0 : (kx === 1 ? ddx : 0), dy = sy === src.y ? 0 : (ky === 1 ? ddy : 0);
      out.push({ sx, sy, sw, sh, dx, dy, kx, ky });
    }
    return out;
  }
  const full = { sx: src.x, sy: src.y, sw: src.w, sh: src.h, dx: 0, dy: 0 };
  if (!e) return [full];
  const dx = e.deltaX || 0, dl = e.deltaLeft || 0, dy = e.delta || 0, dt = e.deltaTop || 0;
  const cuts = Array.isArray(e.cuts) && e.cuts.length ? e.cuts : null;
  const colCuts = Array.isArray(e.colCuts) && e.colCuts.length ? e.colCuts : null;
  const hasX = Math.abs(dx) > 0.01 || dl > 0.01 || !!colCuts, hasY = Math.abs(dy) > 0.01 || dt > 0.01 || !!cuts;
  if (!hasX && !hasY) return [full];
  let cols;
  if (!hasX) {
    cols = [{ sx: src.x, sw: src.w, dx: 0, kx: 1 }];
 } else if (colCuts) {
    cols = [];
    let curX = src.x, dxAcc = 0;
    const endX = src.x + src.w;
    for (const c of colCuts) {
      if (c.insert) {
        const rawSplitX = Math.max(src.x, Math.min(endX, c.splitX));
        const resumeX = c.resumeX != null ? Math.max(src.x, Math.min(endX, c.resumeX)) : rawSplitX;
        const splitX = Math.max(curX, rawSplitX);
        if (splitX - curX > 0.05) cols.push({ sx: curX, sw: splitX - curX, dx: dxAcc, kx: 1 });
        let curDestX = splitX + dxAcc;

        if (c.cloneRight) {
          const w = Math.max(4, c.w || 24);
          const rightBorderW = Math.max(1.5, Math.min(4, endX - splitX));
          if (rightBorderW > 0.05) {
            cols.push({ sx: splitX, sw: rightBorderW, dx: dxAcc, kx: 1 });
            curDestX += rightBorderW;
            dxAcc += rightBorderW;
          }
          const fw = Math.max(0.5, c.fillX1 - c.fillX0);
          const innerW = Math.max(1, w - rightBorderW);
          cols.push({ sx: c.fillX0, sw: fw, dx: curDestX - c.fillX0, kx: innerW / fw });
          curDestX += innerW;
          dxAcc += innerW;
          curX = splitX;
          continue;
        }

        const borderDupW = Math.max(0, rawSplitX - resumeX);
        const fw = Math.max(0.5, c.fillX1 - c.fillX0);
        const innerW = Math.max(1, (c.w || 24) - borderDupW);
        cols.push({ sx: c.fillX0, sw: fw, dx: curDestX - c.fillX0, kx: innerW / fw });
        dxAcc += innerW + borderDupW;
        curX = resumeX;
        continue;
      }
      const d = c.delta || 0;
      if (d >= 0) {
        const x0 = Math.max(curX, Math.min(endX, c.x0));
        const x1 = Math.max(x0, Math.min(endX, c.x1));
        if (x0 - curX > 0.05) cols.push({ sx: curX, sw: x0 - curX, dx: dxAcc, kx: 1 });
        const sw = x1 - x0;
        if (sw > 0.05) cols.push({ sx: x0, sw, dx: dxAcc, kx: (sw + d) / sw });
        dxAcc += d;
        curX = x1;
      } else {
        const cropEnd = Math.max(curX, Math.min(endX, c.x1));
        const cropStart = Math.max(curX, Math.min(cropEnd, c.deleteCol ? c.x0 : (cropEnd + d)));
        const actualCrop = cropEnd - cropStart;
        if (cropStart - curX > 0.05) cols.push({ sx: curX, sw: cropStart - curX, dx: dxAcc, kx: 1 });
        dxAcc -= actualCrop;
        curX = cropEnd;
      }
    }
    if (endX - curX > 0.05) cols.push({ sx: curX, sw: endX - curX, dx: dxAcc, kx: 1 });
    if (!cols.length) cols.push({ sx: src.x, sw: src.w, dx: 0, ky: 1, kx: 1 });
  } else {
    const origX = src.x + dl, origW = Math.max(4, src.w - dl);
    let midStart = origX;
    const leftCols = [];
    if (dl > 0.01) {
      let leftKeep, stripL;
      if (e.cutLeftX != null) {
        const cLeft = Math.max(origX + 2, Math.min(origX + origW - 3.5, e.cutLeftX));
        stripL = Math.max(1.5, Math.min(3.5, (cLeft - origX) * 0.45));
        leftKeep = Math.max(2, cLeft - origX - stripL * 0.5);
      } else {
        leftKeep = Math.max(2, Math.min(origW * 0.42, Math.max(12, origW * 0.3)));
        stripL = Math.max(1.5, Math.min(6, origW * 0.12));
      }
      leftCols.push(
        { sx: origX, sw: leftKeep, dx: -dl, kx: 1 },
        { sx: origX + leftKeep, sw: stripL, dx: -dl, kx: (stripL + dl) / stripL },
      );
      midStart = origX + leftKeep + stripL;
    }
    const remW = Math.max(0.5, origX + origW - midStart);
    if (Math.abs(dx) <= 0.01) {
      cols = [...leftCols, { sx: midStart, sw: remW, dx: 0, kx: 1 }];
    } else {
      const cutX = Math.max(midStart + 1.5, Math.min(origX + origW - 1.5, e.cutX || (origX + origW * 0.5)));
      if (dx < 0) {
        const sh1 = Math.max(0.5, cutX + dx - midStart);
        cols = [
          ...leftCols,
          { sx: midStart, sw: sh1, dx: 0, kx: 1 },
          { sx: cutX, sw: Math.max(0.5, origX + origW - cutX), dx, kx: 1 },
        ];
      } else {
        const stripW = Math.max(1, Math.min(cutX - midStart - 0.5, 6, (cutX - midStart) / 3));
        cols = [
          ...leftCols,
          { sx: midStart, sw: Math.max(0.2, cutX - stripW - midStart), dx: 0, kx: 1 },
          { sx: cutX - stripW, sw: stripW, dx: 0, kx: (stripW + dx) / stripW },
          { sx: cutX, sw: Math.max(0.5, origX + origW - cutX), dx, kx: 1 },
        ];
      }
    }
    cols = cols.filter((c) => c.sw > 0.05);
  }
  let rows;
  if (cuts) {
    rows = [];
    let curY = src.y, dyAcc = 0;
    const endY = src.y + src.h;
    for (const c of cuts) {
      if (c.insert) {
        const rawSplitY = Math.max(src.y, Math.min(endY, c.splitY));
        const resumeY = c.resumeY != null ? Math.max(src.y, Math.min(endY, c.resumeY)) : rawSplitY;
        const splitY = Math.max(curY, rawSplitY);
        if (splitY - curY > 0.05) rows.push({ sy: curY, sh: splitY - curY, dy: dyAcc, ky: 1 });
        const curDestY = splitY + dyAcc;
        const borderDupH = Math.max(0, rawSplitY - resumeY);
        const fh = Math.max(0.5, c.fillY1 - c.fillY0);
        const innerH = Math.max(4, (c.h || 18) - borderDupH);
        rows.push({ sy: c.fillY0, sh: fh, dy: curDestY - c.fillY0, ky: innerH / fh });
        dyAcc += innerH + borderDupH;
        curY = resumeY;
        continue;
      }
      const d = c.delta != null ? c.delta : -(c.y1 - c.y0);
      if (d > 0) {
        const y0 = Math.max(curY, Math.min(endY, c.y0));
        const y1 = Math.max(y0, Math.min(endY, c.y1));
        if (y0 - curY > 0.05) rows.push({ sy: curY, sh: y0 - curY, dy: dyAcc, ky: 1 });
        const sh = y1 - y0;
        if (sh > 0.05) rows.push({ sy: y0, sh, dy: dyAcc, ky: (sh + d) / sh });
        dyAcc += d;
        curY = y1;
      } else {
        const cropEnd = Math.max(curY, Math.min(endY, c.y1));
        const cropStart = Math.max(curY, Math.min(cropEnd, c.deleteRow ? c.y0 : (cropEnd + d)));
        const actualCrop = cropEnd - cropStart;
        if (cropStart - curY > 0.05) rows.push({ sy: curY, sh: cropStart - curY, dy: dyAcc, ky: 1 });
        dyAcc -= actualCrop;
        curY = cropEnd;
      }
    }
    if (endY - curY > 0.05) rows.push({ sy: curY, sh: endY - curY, dy: dyAcc, ky: 1 });
    if (!rows.length) rows.push({ sy: src.y, sh: src.h, dy: 0, ky: 1 });
  } else if (!hasY) {
    rows = [{ sy: src.y, sh: src.h, dy: 0, ky: 1 }];
  } else {
    const origY = src.y + dt, origH = Math.max(4, src.h - dt);
    let midY = origY;
    const topRows = [];
    if (dt > 0.01) {
      const cornerT = Math.max(1, Math.min(3, origH * 0.2));
      const stripT = Math.max(1, Math.min(3, origH * 0.2));
      topRows.push(
        { sy: origY, sh: cornerT, dy: -dt, ky: 1 },
        { sy: origY + cornerT, sh: stripT, dy: -dt, ky: (stripT + dt) / stripT },
      );
      midY = origY + cornerT + stripT;
    }
    const remH = Math.max(0.5, origY + origH - midY);
    if (Math.abs(dy) <= 0.01) {
      rows = [...topRows, { sy: midY, sh: remH, dy: 0, ky: 1 }];
    } else {
      const cutY = Math.max(midY + 1.5, Math.min(origY + origH - 1.5, e.oldBottom || (origY + origH * 0.5)));
      if (dy < 0) {
        const syCut = Math.max(midY + 1.5, cutY);
        const sh1 = Math.max(0.5, syCut + dy - midY);
        rows = [
          ...topRows,
          { sy: midY, sh: sh1, dy: 0, ky: 1 },
          { sy: syCut, sh: Math.max(0.5, origY + origH - syCut), dy, ky: 1 },
        ];
      } else {
        const stripH = Math.max(2, Math.min(cutY - midY - 0.5, e.stripH || 12));
        rows = [
          ...topRows,
          { sy: midY, sh: Math.max(0.2, cutY - stripH - midY), dy: 0, ky: 1 },
          { sy: cutY - stripH, sh: stripH, dy: 0, ky: (stripH + dy) / stripH },
          { sy: cutY, sh: Math.max(0.5, origY + origH - cutY), dy, ky: 1 },
        ];
      }
    }
    rows = rows.filter((r) => r.sh > 0.05);
  }
  const out = [];
  for (const c of cols) for (const r of rows) out.push({ sx: c.sx, sw: c.sw, sy: r.sy, sh: r.sh, dx: c.dx, dy: r.dy, kx: c.kx, ky: r.ky });
  return out;
}

// Assemble the part form in the DESTINATION document.
// env: { doc, copy(ref)->ref, fonts: FontEmbedder, an, naturalFill(ui rect)->ops string, whiteBg }
export async function assemblePart(env, part, srcForms) {
  const { doc, an } = env;
  const ctx = doc.context;
  const M = an.M, Minv = an.Minv;
  const ui2user = (m) => mul(mul(M, m), Minv);
  const src = part.src;
  const ops = [];
  const xobj = new Map([['G', env.copy(srcForms.gfx)], ['T', env.copy(srcForms.text)]]);
  const fontMap = new Map();
  const gsMap = new Map();
  const csMap = new Map();
  const slices = partSlices(part);
  const pad = slices.length > 1 ? 0.05 : 0; // tiny overlap to prevent clip hairlines without doubling semi-transparent shadows
  if (part.clip) {
    const clipB = transformBox(Minv, boxOfRect(part.clip));
    ops.push(`q ${f(clipB.x0)} ${f(clipB.y0)} ${f(clipB.x1 - clipB.x0)} ${f(clipB.y1 - clipB.y0)} re W n`);
  }
  // background removal fill
  if (part.bgMode && !part.obj) {
    const bb = transformBox(Minv, boxOfRect(src));
    ops.push(`q ${part.bgMode === 'white' ? '1 g' : env.naturalFill(src)} ${f(bb.x0)} ${f(bb.y0)} ${f(bb.x1 - bb.x0)} ${f(bb.y1 - bb.y0)} re f Q`);
  }
  // covered areas ("Gizle") are cut out of the part: nothing of it shows there
  const clears = (part.erase || []).filter((r) => r.clear);
  if (clears.length) {
    const ob = transformBox(Minv, { x0: src.x - 2000, y0: src.y - 2000, x1: src.x + src.w + 2000, y1: src.y + src.h + 2000 });
    ops.push(`q ${f(ob.x0)} ${f(ob.y0)} ${f(ob.x1 - ob.x0)} ${f(ob.y1 - ob.y0)} re ` + clears.map((r) => { const bb = transformBox(Minv, boxOfRect(r)); return `${f(bb.x0)} ${f(bb.y0)} ${f(bb.x1 - bb.x0)} ${f(bb.y1 - bb.y0)} re`; }).join(' ') + ' W* n');
  }
// "Orijinal" table style: the original artwork itself (rounded / scalloped
  // frames, fills, tapes) is the most faithful picture. It is used whenever the
  // table kept its size, or when it has no inner grid lines (a plain box, which
  // stretches cleanly). Only restyled tables or resized grids are redrawn.
  const tsO = part.edit && part.edit.tableSpec;
  const tsStyle = tsO ? migrateTableStyle(tsO) : null;
  const isOrigPure = !!tsStyle && tsStyle.color === 'orijinal' && !tsStyle.pattern;
  const origLook = !!tsO && isOrigPure && !tsO.structureEdited && (
    (!tsO.gridMoved && Math.abs(part.edit.deltaX || 0) < 1.5 && Math.abs(part.edit.delta || 0) < 1.5)
    || !(tsO.origPalette && (tsO.origPalette.innerH || tsO.origPalette.innerV)));
if (part.edit && part.edit.tableSpec && !origLook) {
    const ts = part.edit.tableSpec;
    const xs = ts.xs || [], ys = ts.ys || [];
    if (xs.length >= 2 && ys.length >= 2) {
      const tx0 = xs[0], tx1 = xs[xs.length - 1], ty0 = ys[0], ty1 = ys[ys.length - 1];
      const tw = tx1 - tx0, th = ty1 - ty0;
      const rad = ts.radius || 0;
      const rgbStr = (c, op) => `${f(c[0] / 255)} ${f(c[1] / 255)} ${f(c[2] / 255)} ${op}`;

      // 1. Tablo ana zemin dolgusu (Yuvarlak köşe ve tırtıklı kutu destekli)
      if (ts.bodyBg) {
        if (rad > 0.5) {
          ops.push(`q ${Minv.map(f).join(' ')} cm ${rgbStr(ts.bodyBg, 'rg')} ${boxPath({ x: tx0, y: ty0, w: tw, h: th, r: rad })} f Q`);
        } else {
          const bb = transformBox(Minv, { x0: tx0, y0: ty0, x1: tx1, y1: ty1 });
          ops.push(`q ${rgbStr(ts.bodyBg, 'rg')} ${f(bb.x0)} ${f(bb.y0)} ${f(bb.x1 - bb.x0)} ${f(bb.y1 - bb.y0)} re f Q`);
        }
      }
      // 2. Hücre bazlı kalıp + renk dolguları
      const cellOps = [];
      for (let r = 0; r < ys.length - 1; r++) {
        for (let c = 0; c < xs.length - 1; c++) {
          const fillC = cellFill(tsStyle.pattern, tsStyle.color, r, c, ts.origPalette, tsStyle.custom);
          if (!fillC) continue;
          if (ts.bodyBg && fillC[0] === ts.bodyBg[0] && fillC[1] === ts.bodyBg[1] && fillC[2] === ts.bodyBg[2]) continue;
          if (rad > 0.5) {
            cellOps.push(`q ${rgbStr(fillC, 'rg')} ${f(xs[c])} ${f(ys[r])} ${f(xs[c + 1] - xs[c])} ${f(ys[r + 1] - ys[r])} re f Q`);
          } else {
            const cb = transformBox(Minv, { x0: xs[c], y0: ys[r], x1: xs[c + 1], y1: ys[r + 1] });
            cellOps.push(`q ${rgbStr(fillC, 'rg')} ${f(cb.x0)} ${f(cb.y0)} ${f(cb.x1 - cb.x0)} ${f(cb.y1 - cb.y0)} re f Q`);
          }
        }
      }
      if (cellOps.length) {
        if (rad > 0.5) {
          ops.push(`q ${Minv.map(f).join(' ')} cm ${boxPath({ x: tx0, y: ty0, w: tw, h: th, r: rad })} W n\n${cellOps.join('\n')}\nQ`);
        } else {
          ops.push(...cellOps);
        }
      }
      // 3. İç Yatay ve Dikey Vektör Çizgileri
      const bw = ts.borderWidth ?? 0.75;
      const bc = ts.borderColor || [203, 213, 225];
      const innerLines = [];
      if (ts.innerH !== false) {
        for (let r = 1; r < ys.length - 1; r++) {
          const [ux0, uy0] = an.toUser(tx0, ys[r]), [ux1, uy1] = an.toUser(tx1, ys[r]);
          innerLines.push(`${f(ux0)} ${f(uy0)} m ${f(ux1)} ${f(uy1)} l`);
        }
      }
      if (ts.innerV !== false && !ts.noVertLines) {
        for (let c = 1; c < xs.length - 1; c++) {
          const [ux0, uy0] = an.toUser(xs[c], ty0), [ux1, uy1] = an.toUser(xs[c], ty1);
          innerLines.push(`${f(ux0)} ${f(uy0)} m ${f(ux1)} ${f(uy1)} l`);
        }
      }
      if (innerLines.length && bw > 0) {
        ops.push(`q ${rgbStr(bc, 'RG')} ${f(bw)} w 0 J 0 j ${innerLines.join(' ')} S Q`);
      }
      // 4. Dış Çerçeve (Düz, Yuvarlak Köşeli, Kesikli veya Tırtıklı/Dalgalı Vektör Çerçeve)
      if (ts.outerBorder !== false && bw > 0) {
        const dashOp = ts.borderStyle === 'dashed' ? '[3 2] 0 d ' : '';
        if (ts.borderStyle === 'scalloped') {
          const scPath = [];
          const step = 4.2;
          const addWaveEdge = (xA, yA, xB, yB, nx, ny) => {
            const len = Math.hypot(xB - xA, yB - yA);
            const n = Math.max(4, Math.round(len / step));
            for (let i = 0; i < n; i++) {
              const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) * 0.5;
              const mx = xA + (xB - xA) * tm + nx * 1.35, my = yA + (yB - yA) * tm + ny * 1.35;
              const ex = xA + (xB - xA) * t1, ey = yA + (yB - yA) * t1;
              const [umx, umy] = an.toUser(mx, my), [uex, uey] = an.toUser(ex, ey);
              scPath.push(`${f(umx)} ${f(umy)} ${f(umx)} ${f(umy)} ${f(uex)} ${f(uey)} c`);
            }
          };
          const [startX, startY] = an.toUser(tx0, ty0);
          scPath.push(`${f(startX)} ${f(startY)} m`);
          addWaveEdge(tx0, ty0, tx1, ty0, 0, -1);
          addWaveEdge(tx1, ty0, tx1, ty1, 1, 0);
          addWaveEdge(tx1, ty1, tx0, ty1, 0, 1);
          addWaveEdge(tx0, ty1, tx0, ty0, -1, 0);
          scPath.push('h');
          ops.push(`q ${rgbStr(bc, 'RG')} ${f(bw)} w 1 J 1 j ${scPath.join(' ')} S Q`);
        } else if (rad > 0.5) {
          ops.push(`q ${Minv.map(f).join(' ')} cm ${dashOp}${rgbStr(bc, 'RG')} ${f(bw)} w ${boxPath({ x: tx0, y: ty0, w: tw, h: th, r: rad })} S Q`);
        } else {
          const bb = transformBox(Minv, { x0: tx0, y0: ty0, x1: tx1, y1: ty1 });
          ops.push(`q ${dashOp}${rgbStr(bc, 'RG')} ${f(bw)} w ${f(bb.x0)} ${f(bb.y0)} ${f(bb.x1 - bb.x0)} ${f(bb.y1 - bb.y0)} re S Q`);
        }
      }
    }
  } else {
    for (const s of slices) {
      const kx = s.kx || 1, ky = s.ky || 1;
      const inR = s.sx + s.sw < src.x + src.w - 0.01, inB = s.sy + s.sh < src.y + src.h - 0.01;
      const dest = { x0: s.sx + s.dx, x1: s.sx + s.dx + s.sw * kx + (inR ? pad : 0), y0: s.sy + s.dy, y1: s.sy + s.dy + s.sh * ky + (inB ? pad : 0) };
      const cb = transformBox(Minv, dest);
      const m = ui2user([kx, 0, 0, ky, s.sx + s.dx - s.sx * kx, s.sy + s.dy - s.sy * ky]);
      ops.push(`q ${f(cb.x0)} ${f(cb.y0)} ${f(cb.x1 - cb.x0)} ${f(cb.y1 - cb.y0)} re W n ${m.map(f).join(' ')} cm /G Do Q`);
    }
  }
  if (!(part.edit && part.edit.tableSpec && !origLook)) {
    const vr = vecRuleOps(an, part, slices);
    if (vr.length) ops.push(`q ${Minv.map(f).join(' ')} cm`, ...vr, 'Q');
  }
  ops.push('q /T Do Q');
  if (clears.length) ops.push('Q');
  for (const r of part.erase || []) {
    if (!r.fill) continue;
    for (const q of coverBands(r)) {
      const bb = transformBox(Minv, { x0: q.x, y0: q.y, x1: q.x + q.w, y1: q.y + q.h });
      ops.push(`q ${q.c.map((v) => f(v / 255)).join(' ')} rg ${f(bb.x0)} ${f(bb.y0)} ${f(bb.x1 - bb.x0)} ${f(bb.y1 - bb.y0)} re f Q`);
    }
  }
  for (const r of part.erase || []) {
    if (r.clear) continue;
    const bb = transformBox(Minv, boxOfRect(r));
    const col = r.mode === 'white' || env.whiteBg ? '1 g' : env.naturalFill(r);
    ops.push(`q ${col} ${f(bb.x0)} ${f(bb.y0)} ${f(bb.x1 - bb.x0)} ${f(bb.y1 - bb.y0)} re f Q`);
  }
  const localExtraGs = new Map();
  for (const mk of (part.edit && part.edit.marks) || []) {
    if (mk.box) {
      for (const r of mk.rects) ops.push(`q ${Minv.map(f).join(' ')} cm`, ...boxOps(env, localExtraGs, r, mk.box), 'Q');
      continue;
    }
    for (const r of mk.rects) {
      const bb = transformBox(Minv, { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
      const rect = `${f(bb.x0)} ${f(bb.y0)} ${f(bb.x1 - bb.x0)} ${f(bb.y1 - bb.y0)} re`;
      if (mk.fill) ops.push(`q ${mk.fill.map((v) => f(v / 255)).join(' ')} rg ${rect} f Q`);
      if (mk.stroke) {
        const h = (mk.lw || 0.75) / 2, sb = transformBox(Minv, { x0: r.x + h, y0: r.y + h, x1: r.x + r.w - h, y1: r.y + r.h - h });
        ops.push(`q ${mk.stroke.map((v) => f(v / 255)).join(' ')} RG ${f(mk.lw || 0.75)} w ${f(sb.x0)} ${f(sb.y0)} ${f(sb.x1 - sb.x0)} ${f(sb.y1 - sb.y0)} re S Q`);
      }
    }
  }
  if (part.edit && part.edit.runs && part.edit.runs.length) {
    const pageRes = an.page.node.Resources();
    const csDict = pageRes ? resolve(ctx, pageRes.get(PDFName.of('ColorSpace'))) : null;
    const gsDict = pageRes ? resolve(ctx, pageRes.get(PDFName.of('ExtGState'))) : null;
    const csAvailable = (n) => {
      if (csDict instanceof PDFDict && csDict.get(PDFName.of(n))) { csMap.set(n, csDict.get(PDFName.of(n))); return true; }
      return false;
    };
    for (const r of part.edit.runs) {
      let gs = '';
      if (r.gs && gsDict instanceof PDFDict && gsDict.get(PDFName.of(r.gs))) { gsMap.set(r.gs, gsDict.get(PDFName.of(r.gs))); gs = `/${r.gs} gs `; }
      const size = Math.abs(r.m[3]) || Math.hypot(r.m[0], r.m[1]);
      if (r.font === 'vec') {
        ops.push(...vectorGlyphOps(r.text, r.x, r.y, size, r.fill, r.synB, gs, an.toUser, csAvailable, fillColorOps, f));
        if (r.u && r.w > 0) {
          const color = fillColorOps(r.fill, null, csAvailable);
          const [ax, ay] = an.toUser(r.x, r.y + size * 0.1), [bx, by] = an.toUser(r.x + r.w, r.y + size * 0.1 + Math.max(0.5, size * 0.055));
          ops.push(`q ${gs}${color} ${f(Math.min(ax, bx))} ${f(Math.min(ay, by))} ${f(Math.abs(bx - ax))} ${f(Math.abs(by - ay))} re f Q`);
        }
        continue;
      }
      let fname, hex;
      if (r.font.startsWith('orig:')) {
        const info = env.fontById(r.font.slice(5));
        if (!info || !info.ref) continue;
        fname = `PO${info.ref.objectNumber}`;
        fontMap.set(fname, env.copy(info.ref));
        const bytes = [];
        for (const c of r.codes) { if (r.bpc === 2) bytes.push((c >> 8) & 255, c & 255); else bytes.push(c & 255); }
        hex = '<' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + '>';
      } else {
        const pf = await env.fonts.get(r.font.slice(3));
        fname = pf.name;
        fontMap.set(fname, pf.font.ref);
        hex = pf.font.encodeText(r.text).toString();
      }
      const [ux, uy] = an.toUser(r.x, r.y);
      const color = fillColorOps(r.fill, null, csAvailable);
      let tr = '0 Tr';
      if (r.synB && r.fill && ['g', 'rg', 'k'].includes(r.fill.op)) tr = `${r.fill.args.map(f).join(' ')} ${r.fill.op.toUpperCase()} ${f(size * 0.035)} w 1 j 2 Tr`;
      else if (r.synB && !r.fill) tr = `0 G ${f(size * 0.035)} w 1 j 2 Tr`;
      ops.push(`q ${gs}${color} BT 0 Tc 0 Tw 100 Tz 0 Ts ${tr} /${fname} 1 Tf ${r.m.map(f).join(' ')} ${f(ux)} ${f(uy)} Tm ${hex} Tj ET Q`);
      if (r.u && r.w > 0) {
        const [ax, ay] = an.toUser(r.x, r.y + size * 0.1), [bx, by] = an.toUser(r.x + r.w, r.y + size * 0.1 + Math.max(0.5, size * 0.055));
        ops.push(`q ${gs}${color} ${f(Math.min(ax, bx))} ${f(Math.min(ay, by))} ${f(Math.abs(bx - ax))} ${f(Math.abs(by - ay))} re f Q`);
      }
    }
  }
  if (part.clip) ops.push('Q');
  const res = ctx.obj({});
  const xd = ctx.obj({}); for (const [n, v] of xobj) xd.set(PDFName.of(n), v); res.set(PDFName.of('XObject'), xd);
  if (fontMap.size) { const fd = ctx.obj({}); for (const [n, v] of fontMap) fd.set(PDFName.of(n), v); res.set(PDFName.of('Font'), fd); }
  if (env.naturalFill && env.naturalFill.gs && (part.bgMode || (part.erase && part.erase.length))) gsMap.set(env.naturalFill.gs.name, env.naturalFill.gs.obj);
  if (gsMap.size || localExtraGs.size) {
    const gd = ctx.obj({});
    for (const [n, v] of gsMap) gd.set(PDFName.of(n), env.copy(v));
    for (const [n, v] of localExtraGs) gd.set(PDFName.of(n), v);
    res.set(PDFName.of('ExtGState'), gd);
  }
  if (csMap.size) { const cd = ctx.obj({}); for (const [n, v] of csMap) cd.set(PDFName.of(n), env.copy(v)); res.set(PDFName.of('ColorSpace'), cd); }
  let xMin = src.x - 4, yMin = src.y - 4;
  let xMax = src.x + src.w + (part.edit && part.edit.deltaX > 0 ? part.edit.deltaX : 0) + 4;
  let yMax = src.y + src.h + (part.edit && part.edit.delta > 0 ? part.edit.delta : 0) + 4;
  if (part.edit && part.edit.tableSpec) {
    const ts = part.edit.tableSpec;
    if (ts.xs && ts.xs.length) { xMin = Math.min(xMin, ts.xs[0] - 6); xMax = Math.max(xMax, ts.xs[ts.xs.length - 1] + 6); }
    if (ts.ys && ts.ys.length) { yMin = Math.min(yMin, ts.ys[0] - 6); yMax = Math.max(yMax, ts.ys[ts.ys.length - 1] + 6); }
  }
  if (part.nine) { xMax = Math.max(xMax, src.x + part.nine.w + 4); yMax = Math.max(yMax, src.y + part.nine.h + 4); }
  if (part.obj && part.edit && part.edit.runs) {
    for (const r of part.edit.runs) { xMin = Math.min(xMin, r.x - 2); yMin = Math.min(yMin, r.y - 16); xMax = Math.max(xMax, r.x + (r.w || 0) + 2); yMax = Math.max(yMax, r.y + 8); }
  }
  if (part.edit && part.edit.marks) {
    for (const mk of part.edit.marks) for (const r of mk.rects) {
      xMin = Math.min(xMin, r.x - 2); yMin = Math.min(yMin, r.y - 2);
      xMax = Math.max(xMax, r.x + r.w + 2); yMax = Math.max(yMax, r.y + r.h + 2);
    }
  }
  const bb = transformBox(Minv, part.clip
    ? { x0: part.clip.x - 1, y0: part.clip.y - 1, x1: part.clip.x + part.clip.w + 1, y1: part.clip.y + part.clip.h + 1 }
    : { x0: xMin, y0: yMin, x1: xMax, y1: yMax });
  const bytes = new TextEncoder().encode(ops.join('\n'));
  return makeForm(doc, bytes, bb, res);
}

export function partDestHeight(part) {
  return part.src.h + (part.edit && part.edit.delta ? part.edit.delta : 0);
}

// UI placement matrix (source rect -> current position) converted to user space
export function placementMatrix(an, part, block, anDest = an) {
  const bs = block.s || 1;
  const s = bs * (part.sc || 1);
  const dx = block.x + part.dx * bs, dy = block.y + part.dy * bs;
  const ox = part.clip ? part.clip.x : part.src.x;
  const oy = part.clip ? part.clip.y : part.src.y;
  const T = [s, 0, 0, s, dx - ox * s, dy - oy * s];
  return mul(mul(anDest.M, T), an.Minv);
}
export { rgbOps };
